CREATE TABLE advertisements (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  connection_account_id TEXT NOT NULL REFERENCES accounts(id),
  provider TEXT NOT NULL CHECK (provider IN ('meta', 'tiktok')),
  placement TEXT NOT NULL CHECK (placement IN ('facebook', 'instagram', 'tiktok')),
  advertiser_id TEXT NOT NULL,
  budget_type TEXT NOT NULL CHECK (budget_type IN ('daily', 'lifetime')),
  budget_amount_minor INTEGER NOT NULL CHECK (budget_amount_minor > 0),
  currency TEXT NOT NULL,
  start_at TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  results_json TEXT NOT NULL DEFAULT '{}',
  current_operation INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'executing', 'processing', 'submitted', 'retry', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  provider_reference TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE advertisement_media (
  advertisement_id TEXT NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (advertisement_id, position),
  UNIQUE(advertisement_id, media_id)
);

CREATE INDEX advertisements_due_idx ON advertisements(state, next_attempt_at, start_at);
