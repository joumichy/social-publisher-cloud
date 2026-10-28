CREATE TABLE account_targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'linkedin', 'tiktok')),
  provider_subject TEXT,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, platform, provider_subject)
);

CREATE INDEX account_targets_project_platform_idx ON account_targets(project_id, platform);
