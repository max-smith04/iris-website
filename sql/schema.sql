-- IRIS ratings. Run this against your Neon database, or just hit the
-- API once: /api/ratings creates the table on first use if it is missing.

CREATE TABLE IF NOT EXISTS ratings (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT        NOT NULL,
  stars      SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ratings_created_at_idx ON ratings (created_at DESC);
