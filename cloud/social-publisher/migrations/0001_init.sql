PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'linkedin', 'tiktok')),
  provider_subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'ready' CHECK (connection_status IN ('ready', 'expired', 'revoked')),
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  expires_at TEXT,
  refresh_expires_at TEXT,
  scopes TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, platform, provider_subject)
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'document')),
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE publications (
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
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'publishing', 'processing', 'published', 'retry', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  provider_reference TEXT,
  provider_url TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE publication_media (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (publication_id, position),
  UNIQUE(publication_id, media_id)
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('running', 'processing', 'published', 'retry', 'failed')),
  provider_reference TEXT,
  error TEXT
);

CREATE INDEX publications_due_idx ON publications(state, next_attempt_at, publish_at);
CREATE INDEX media_created_idx ON media(created_at);
