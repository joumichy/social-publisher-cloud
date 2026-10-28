UPDATE account_targets
SET display_name = 'STELLARK LLC',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'shortlistable-tiktok-ads'
  AND project_id = 'shortlistable'
  AND platform = 'tiktok'
  AND connection_kind = 'advertising'
  AND provider_subject = '7635848844487458833'
  AND display_name = 'Shortlistable Ads';
