# Queue contract

The queue is UTF-8 JSON with `schema_version: 1`. Dates use ISO 8601 with an explicit UTC offset. The queue timezone is an IANA name such as `Europe/Zurich` and is used for human review; `publish_at` remains self-contained.

```json
{
  "schema_version": 1,
  "project_id": "brand-id",
  "brand": "Brand",
  "timezone": "Europe/Zurich",
  "posts": [
    {
      "id": "launch-video-01",
      "title": "Launch video",
      "media": [
        { "path": "../campaign/video.mp4", "kind": "video" }
      ],
      "deliveries": [
        {
          "id": "linkedin",
          "platform": "linkedin",
          "account_ref": "brand-linkedin",
          "publish_at": "2026-09-15T09:00+02:00",
          "caption": "Platform-specific copy",
          "alt_text": "Accessible media description",
          "state": "draft",
          "receipt": null
        }
      ]
    }
  ]
}
```

## Ownership

- `post.id` identifies one creative concept and media set inside one project.
- A delivery identifies one platform-specific rendition. Put platform-specific caption, title, accessibility text, settings, time, state, and receipt on that delivery.
- Media paths are relative to the directory containing the queue and must resolve inside the registered project root.
- `account_ref` must resolve to an account in the global registry with the same project and platform.

## States

- `draft`: editable and not authorized for external upload. `publish_at` may be null.
- `approved`: the user has authorized this exact delivery, account, caption, media set, and time.
- `scheduled`: the API scheduler or native platform holds the authorized publication; a receipt is mandatory.
- `published`: publication is visibly live; retain the receipt.
- `failed`: an attempted operation failed and may be reviewed before a retry.
- `cancelled`: intentionally withdrawn.

Changing the media, caption, account, platform, or date of an approved delivery returns it to `draft` and clears its receipt. Never infer approval from an old campaign, filename, or prior conversation.

## Scheduler receipt

For `scheduled` and `published`, store:

```json
{
  "native_reference": "api:<publication-id>, provider ID, URL, or precise visible reference",
  "verified_at": "2026-09-07T21:45:00+00:00"
}
```

The receipt records where the delivery is scheduled. For `api:` references, query `api-status`; for native references, open the platform’s scheduled-content view when the user requests a fresh status.

## Paid advertising plan

Paid advertising stays separate from the organic queue because its lifecycle includes advertiser identity, budget, targeting, provider operations, and spend. Store the plan inside the owning project and invoke it through the same `social-publisher publish` CLI with `--kind ad`.

```json
{
  "schema_version": 1,
  "project_id": "brand-id",
  "advertisements": [
    {
      "id": "launch-create-01-instagram",
      "group_id": "summer-launch",
      "platform": "instagram",
      "provider": "meta",
      "account_ref": "brand-meta-ads",
      "advertiser_id": "123456789",
      "start_at": "2026-09-15T09:00+02:00",
      "budget": {
        "type": "lifetime",
        "amount_minor": 3000,
        "currency": "USD"
      },
      "media": [
        { "path": "../../../pipeline/export/video.mp4", "kind": "video" }
      ],
      "operations": [
        {
          "id": "video",
          "type": "meta.video.upload",
          "body": { "file_url": { "$media_url": 0 } }
        }
      ],
      "state": "draft",
      "receipt": null
    }
  ]
}
```

`amount_minor` is the only canonical stored budget. Provider operations refer to it with `$budget_minor` or `$budget_major`; they must not duplicate a literal budget. Result placeholders reference prior named operations. The Worker accepts only its fixed Meta and TikTok operation allow-list and constructs provider URLs internally.

After the final provider operation, the local API state is `submitted`: provider review and delivery reporting remain distinct from successful submission.
