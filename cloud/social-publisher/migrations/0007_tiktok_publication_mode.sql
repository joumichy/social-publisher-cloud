ALTER TABLE account_targets ADD COLUMN publication_mode TEXT
CHECK (publication_mode IN ('creator_inbox_draft', 'direct_publish') OR publication_mode IS NULL);

ALTER TABLE accounts ADD COLUMN publication_mode TEXT
CHECK (publication_mode IN ('creator_inbox_draft', 'direct_publish') OR publication_mode IS NULL);

ALTER TABLE oauth_states ADD COLUMN publication_mode TEXT
CHECK (publication_mode IN ('creator_inbox_draft', 'direct_publish') OR publication_mode IS NULL);

UPDATE account_targets
SET publication_mode = 'creator_inbox_draft'
WHERE id IN ('shortlistable-tiktok', 'sibyl-tiktok');

UPDATE accounts
SET publication_mode = CASE json_extract(metadata_json, '$.oauth')
  WHEN 'tiktok_content_posting' THEN 'creator_inbox_draft'
  WHEN 'tiktok_business_organic' THEN 'direct_publish'
END
WHERE platform = 'tiktok' AND connection_kind = 'organic';

UPDATE accounts
SET metadata_json = json_set(
  metadata_json,
  '$.publish_mode',
  publication_mode,
  '$.username',
  COALESCE(json_extract(metadata_json, '$.username'), json_extract(metadata_json, '$.expected_identity'), display_name)
)
WHERE publication_mode IS NOT NULL AND json_valid(metadata_json);

UPDATE oauth_states
SET publication_mode = (
  SELECT account_targets.publication_mode
  FROM account_targets
  WHERE account_targets.id = oauth_states.account_id
)
WHERE platform = 'tiktok' AND connection_kind = 'organic';
