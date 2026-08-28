/* ============================================================
   /api/ratings — Vercel serverless function.

   GET   -> { average, count, ratings: [...] }
   POST  -> { average, count, ratings: [...] }   (after inserting)

   Storage is Neon (Postgres) over its serverless HTTP driver, which
   is why DATABASE_URL must be the *pooled* connection string (the
   host with `-pooler` in it). Serverless invocations are numerous
   and short-lived; the pooler is what stops them exhausting Postgres
   connection slots.
   ============================================================ */
import { neon } from '@neondatabase/serverless';

const MAX_NAME = 40;
const MAX_COMMENT = 500;
const LIST_LIMIT = 200;

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

/* Create the table on first use so a fresh Neon project just works.
   Kept as a single in-process promise so concurrent requests share it. */
let ready = null;
function ensureSchema() {
  if (!ready) {
    ready = db()`
      CREATE TABLE IF NOT EXISTS ratings (
        id         BIGSERIAL PRIMARY KEY,
        name       TEXT        NOT NULL,
        stars      SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
        comment    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* Output escaping. Everything the client renders comes through here,
   so a comment full of markup arrives as text and stays text. */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/* Strip control characters, collapse absurd whitespace, hard-cap length. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function clean(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n/g, '\n')
    .replace(CONTROL, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

async function fetchAll() {
  const sql = db();
  const rows = await sql`
    SELECT id, name, stars, comment, created_at
    FROM ratings
    ORDER BY created_at DESC, id DESC
    LIMIT ${LIST_LIMIT}
  `;
  const count = rows.length;
  const average = count
    ? Math.round((rows.reduce((a, r) => a + Number(r.stars), 0) / count) * 10) / 10
    : 0;
  return {
    average,
    count,
    ratings: rows.map((r) => ({
      id: Number(r.id),
      name: esc(r.name),
      stars: Number(r.stars),
      comment: esc(r.comment),
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
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      await ensureSchema();
      return res.status(200).json(await fetchAll());
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'That was not valid JSON.' });
      }

      const name = clean(body.name, MAX_NAME);
      const comment = clean(body.comment, MAX_COMMENT);

      /* stars: must be a real number, then clamped into 1-5 */
      const raw = Number(body.stars);
      if (!Number.isFinite(raw)) {
        return res.status(400).json({ error: 'Pick a number of stars.' });
      }
      const stars = Math.min(5, Math.max(1, Math.round(raw)));

      if (!name) {
        return res.status(400).json({ error: 'A name is required.' });
      }

      await ensureSchema();
      const sql = db();
      await sql`
        INSERT INTO ratings (name, stars, comment)
        VALUES (${name}, ${stars}, ${comment || null})
      `;
      return res.status(201).json(await fetchAll());
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    if (err && err.code === 'NO_DB') {
      return res.status(503).json({ error: 'The ratings database is not configured yet.' });
    }
    console.error('[ratings]', err);
    return res.status(500).json({ error: 'The ratings database is not answering.' });
  }
}
