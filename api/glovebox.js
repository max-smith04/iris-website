/* ============================================================
   /api/glovebox — Vercel serverless function.

   One shared, fully editable text file. A save REPLACES the whole
   thing with whatever was posted, so anyone can add lines, change
   lines or delete lines — including lines somebody else wrote.

   GET   -> { content, editor, updated_at }
   POST  -> { content, editor, updated_at }   (after saving)

   `content` is null when nobody has ever saved, which tells the
   client to keep whatever default text is in the page.

   Each save inserts a row rather than updating one, purely so old
   versions survive as a safety net. That is a storage detail and
   changes nothing about editing: the newest row is the file, and
   the previous ones are only there to be read back by hand if
   someone empties it out of spite:

     SELECT content, editor, created_at FROM glovebox ORDER BY id DESC;

   Same Neon pooled-connection story as api/ratings.js.
   ============================================================ */
import { neon } from '@neondatabase/serverless';

const MAX_CONTENT = 4000;
const MAX_NAME = 40;

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
      CREATE TABLE IF NOT EXISTS glovebox (
        id         BIGSERIAL PRIMARY KEY,
        content    TEXT        NOT NULL,
        editor     TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* Output escaping, same contract as the ratings endpoint: whatever comes back
   is HTML-safe, so the client can drop it straight into the page. */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/* Newlines and tabs are the whole point of a text file, so those two survive;
   every other control character does not. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n/g, '\n')
    .replace(CONTROL, '')
    .slice(0, max);
}
function cleanName(v) {
  return cleanText(v, MAX_NAME).replace(/\s+/g, ' ').trim();
}

async function fetchLatest() {
  const sql = db();
  const rows = await sql`
    SELECT content, editor, created_at
    FROM glovebox
    ORDER BY id DESC
    LIMIT 1
  `;
  if (!rows.length) {
    /* nothing saved yet — the page keeps its own default text */
    return { content: null, editor: null, updated_at: null };
  }
  return {
    content: esc(rows[0].content),
    editor: rows[0].editor ? esc(rows[0].editor) : null,
    updated_at: new Date(rows[0].created_at).toISOString()
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
      return res.status(200).json(await fetchLatest());
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'That was not valid JSON.' });
      }

      const content = cleanText(body.content, MAX_CONTENT);
      const editor = cleanName(body.name);

      /* the only thing you cannot do is blank it entirely — one character is
         enough, this is just a guard against an accidental select-all-delete */
      if (!content.trim()) {
        return res.status(400).json({ error: 'Leave her at least one character.' });
      }

      await ensureSchema();
      const sql = db();
      await sql`
        INSERT INTO glovebox (content, editor)
        VALUES (${content}, ${editor || null})
      `;
      return res.status(201).json(await fetchLatest());
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    if (err && err.code === 'NO_DB') {
      return res.status(503).json({ error: 'The glovebox database is not configured yet.' });
    }
    console.error('[glovebox]', err);
    return res.status(500).json({ error: 'The glovebox database is not answering.' });
  }
}
