PRAGMA defer_foreign_keys = ON;

CREATE TABLE publications_next (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'linkedin', 'tiktok')),
  caption TEXT NOT NULL,
  title TEXT,
  alt_text TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  publish_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled', 'publishing', 'processing', 'awaiting_creator', 'published', 'retry', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  provider_reference TEXT,
  provider_url TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE publication_media_next (
  publication_id TEXT NOT NULL REFERENCES publications_next(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (publication_id, position),
  UNIQUE(publication_id, media_id)
);

CREATE TABLE attempts_next (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications_next(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('running', 'processing', 'awaiting_creator', 'published', 'retry', 'failed')),
  provider_reference TEXT,
  error TEXT
);

INSERT INTO publications_next (
  id, idempotency_key, project_id, post_id, delivery_id, account_id, platform, caption, title, alt_text,
  settings_json, publish_at, state, attempts, next_attempt_at, provider_reference, provider_url, last_error,
  created_at, updated_at
)
SELECT
  id, idempotency_key, project_id, post_id, delivery_id, account_id, platform, caption, title, alt_text,
  settings_json, publish_at, state, attempts, next_attempt_at, provider_reference, provider_url, last_error,
  created_at, updated_at
FROM publications;

INSERT INTO publication_media_next (publication_id, media_id, position)
SELECT publication_id, media_id, position FROM publication_media;

INSERT INTO attempts_next (id, publication_id, started_at, finished_at, outcome, provider_reference, error)
SELECT id, publication_id, started_at, finished_at, outcome, provider_reference, error FROM attempts;

DROP TABLE publication_media;
DROP TABLE attempts;
DROP TABLE publications;

ALTER TABLE publications_next RENAME TO publications;
ALTER TABLE publication_media_next RENAME TO publication_media;
ALTER TABLE attempts_next RENAME TO attempts;

CREATE INDEX publications_due_idx ON publications(state, next_attempt_at, publish_at);

PRAGMA foreign_key_check;
