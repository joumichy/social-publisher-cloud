ALTER TABLE account_targets
ADD COLUMN connection_kind TEXT NOT NULL DEFAULT 'organic'
CHECK (connection_kind IN ('organic', 'advertising'));

ALTER TABLE accounts
ADD COLUMN connection_kind TEXT NOT NULL DEFAULT 'organic'
CHECK (connection_kind IN ('organic', 'advertising'));

ALTER TABLE oauth_states
ADD COLUMN connection_kind TEXT NOT NULL DEFAULT 'organic'
CHECK (connection_kind IN ('organic', 'advertising'));
