/* ============================================================
   /api/photos — upload and list visitor photos.

   GET            -> { photos: [{ id, name, caption, uploader, created_at }] }
   POST           -> { photos: [...] }   (after storing one)
   GET ?id=7      -> the full JPEG bytes
   GET ?id=7&t=1  -> the thumbnail bytes

   The images live in Postgres as bytea. That is only reasonable
   because the browser downscales and re-encodes before uploading
   (see js/photos.js), so a row is a couple of hundred KB rather
   than a 5 MB phone original. Bytes move as base64 and are cast
   with encode()/decode() in SQL, which keeps the Neon HTTP driver
   out of the business of guessing binary types.
   ============================================================ */
import { neon } from '@neondatabase/serverless';

const MAX_BYTES = 1_600_000;   /* per image, after the browser has shrunk it */
const MAX_THUMB = 200_000;
const MAX_CAPTION = 120;
const MAX_NAME = 40;
const MAX_PHOTOS = 60;         /* stop the free tier filling up with someone's camera roll */

let _sql = null;
function db() {
  if (!process.env.DATABASE_URL) {
    const err = new Error('DATABASE_URL is not set.');
    err.code = 'NO_DB';
    throw err;
  }
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

let ready = null;
function ensureSchema() {
  if (!ready) {
    ready = db()`
      CREATE TABLE IF NOT EXISTS photos (
        id         BIGSERIAL PRIMARY KEY,
        caption    TEXT,
        uploader   TEXT,
        data       BYTEA       NOT NULL,
        thumb      BYTEA       NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

const CONTROL = /[\u0000-\u001F\u007F]/g;
function clean(v, max) {
  return String(v == null ? '' : v).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Trust the bytes, not the filename or the declared type: a JPEG starts FF D8 FF. */
function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

async function list() {
  const rows = await db()`
    SELECT id, caption, uploader, created_at
    FROM photos
    ORDER BY id DESC
    LIMIT ${MAX_PHOTOS}
  `;
  return {
    photos: rows.map((r) => ({
      id: Number(r.id),
      name: 'photo-' + r.id + '.jpg',
      caption: r.caption ? esc(r.caption) : '',
      uploader: r.uploader ? esc(r.uploader) : '',
      created_at: new Date(r.created_at).toISOString()
    }))
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

export default async function handler(req, res) {
  try {
    const id = req.query && req.query.id;

    /* ---- serve one image ---- */
    if (req.method === 'GET' && id) {
      const n = Number(id);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({ error: 'Bad id.' });
      }
      await ensureSchema();
      const col = req.query.t ? 'thumb' : 'data';
      const rows = col === 'thumb'
        ? await db()`SELECT encode(thumb, 'base64') AS b FROM photos WHERE id = ${n}`
        : await db()`SELECT encode(data,  'base64') AS b FROM photos WHERE id = ${n}`;
      if (!rows.length) return res.status(404).json({ error: 'No such photo.' });
      const buf = Buffer.from(rows[0].b, 'base64');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', String(buf.length));
      /* ids are never reused, so a stored image is safe to cache forever */
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(buf);
    }

    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
      await ensureSchema();
      return res.status(200).json(await list());
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'That was not valid JSON.' });
      }

      const dataB64 = String(body.data || '');
      const thumbB64 = String(body.thumb || '');
      if (!dataB64 || !thumbB64) {
        return res.status(400).json({ error: 'No image came through.' });
      }

      let data, thumb;
      try {
        data = Buffer.from(dataB64, 'base64');
        thumb = Buffer.from(thumbB64, 'base64');
      } catch {
        return res.status(400).json({ error: 'That image could not be decoded.' });
      }

      if (!isJpeg(data) || !isJpeg(thumb)) {
        return res.status(400).json({ error: 'Only JPEG images, please.' });
      }
      if (data.length > MAX_BYTES || thumb.length > MAX_THUMB) {
        return res.status(413).json({ error: 'That image is too big even after shrinking.' });
      }

      await ensureSchema();

      const [{ count }] = await db()`SELECT count(*)::int AS count FROM photos`;
      if (count >= MAX_PHOTOS) {
        return res.status(409).json({ error: 'Her album is full. Somebody clear a few out first.' });
      }

      const caption = clean(body.caption, MAX_CAPTION);
      const uploader = clean(body.name, MAX_NAME);

      await db()`
        INSERT INTO photos (caption, uploader, data, thumb)
        VALUES (${caption || null}, ${uploader || null},
                decode(${data.toString('base64')}, 'base64'),
                decode(${thumb.toString('base64')}, 'base64'))
      `;
      return res.status(201).json(await list());
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    if (err && err.code === 'NO_DB') {
      return res.status(503).json({ error: 'The photo database is not configured yet.' });
    }
    console.error('[photos]', err);
    return res.status(500).json({ error: 'The photo database is not answering.' });
  }
}
