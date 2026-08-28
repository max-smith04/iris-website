-- IRIS. Run this against your Neon database, or just hit the API once:
-- both endpoints create their table on first use if it is missing.

CREATE TABLE IF NOT EXISTS ratings (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT        NOT NULL,
  stars      SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ratings_created_at_idx ON ratings (created_at DESC);

-- Glovebox.txt. Saves are append-only, so the newest row is what the site
-- shows and every earlier version is still here if someone wipes it:
--   SELECT content, editor, created_at FROM glovebox ORDER BY id DESC;

CREATE TABLE IF NOT EXISTS glovebox (
  id         BIGSERIAL PRIMARY KEY,
  content    TEXT        NOT NULL,
  editor     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS glovebox_id_desc_idx ON glovebox (id DESC);

-- Pictures visitors add from the My Pictures window. The browser downscales
-- to 1600px (and a 420px thumbnail) and re-encodes as JPEG before uploading,
-- so a row is a few hundred KB rather than a whole phone original.

CREATE TABLE IF NOT EXISTS photos (
  id         BIGSERIAL PRIMARY KEY,
  caption    TEXT,
  uploader   TEXT,
  data       BYTEA       NOT NULL,
  thumb      BYTEA       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
