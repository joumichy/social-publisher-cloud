# Stellark Social Publisher

API-first, cross-project social publishing for Facebook Pages, Instagram professional accounts, LinkedIn organizations, and TikTok accounts. A Cloudflare Worker executes approved publications on schedule, so the local computer may be offline.

## Architecture

1. Each brand keeps its queue and media in its own project.
2. The global Codex command validates and approves the exact delivery.
3. `api-submit` streams media to R2 and creates an idempotent scheduled publication in D1.
4. A one-minute Cron Trigger claims due publications and advertising operations, then calls the provider API.
5. Tokens are encrypted with AES-256-GCM before D1 storage. They never live in a project or registry.

Uploaded media is served through an unguessable URL only while providers need it, then removed after the configured retention period (seven days by default). The initial upload endpoint accepts files up to 100 MiB, matching the practical Worker request limit on the intended plan.

The native-browser scheduler remains a manual fallback while developer-app reviews are pending.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Generate independent secrets without saving them in shell history:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Put the base64 value in `TOKEN_ENCRYPTION_KEY` and the hex value in `ADMIN_API_TOKEN` inside the untracked `.dev.vars` file.

## Cloudflare deployment

```bash
npx wrangler login
npx wrangler d1 create social-publisher
npx wrangler r2 bucket create social-publisher-media
```

Cloudflare requires enabling the R2 subscription before the first bucket can be created. The dashboard currently advertises a 10 GB monthly free allowance but requires a saved payment method and can bill usage above the free allowance; activate it only with the account owner's explicit authorization.

Replace the placeholder `database_id` in `wrangler.jsonc` with the returned UUID, then:

```bash
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put META_APP_SECRET
npx wrangler secret put INSTAGRAM_APP_SECRET
npx wrangler secret put TIKTOK_CLIENT_KEY
npx wrangler secret put TIKTOK_CLIENT_SECRET
npx wrangler secret put TIKTOK_BUSINESS_CLIENT_ID
npx wrangler secret put TIKTOK_BUSINESS_CLIENT_SECRET
npm run db:remote
npm run deploy
```

Set `PUBLIC_BASE_URL` to the deployed Worker or verified custom domain before publishing. TikTok pull-from-URL publishing additionally requires that domain or URL prefix to be verified in the corresponding TikTok developer product. `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` serve Content Posting creator-inbox connections. `TIKTOK_BUSINESS_CLIENT_ID` and `TIKTOK_BUSINESS_CLIENT_SECRET` serve Business Organic direct-publish connections and advertising. Set `TIKTOK_BUSINESS_AUTHORIZATION_URL` only to the HTTPS authorization URL issued for the TikTok for Business advertising flow.

## Connect an account

Create one developer app per platform, configure the callback URLs below, then authorize each brand account separately. One provider application can serve several projects and accounts; the remote account target keeps every project, platform, username, and provider subject isolated. The callback encrypts account tokens directly in D1.

```text
https://stellark-social-publisher.ginozapro.workers.dev/oauth/meta/callback
https://stellark-social-publisher.ginozapro.workers.dev/oauth/linkedin/callback
https://stellark-social-publisher.ginozapro.workers.dev/oauth/tiktok/callback/
```

```bash
/Users/gideon/.codex/bin/social-publisher api-sync-account <account-ref>
/Users/gideon/.codex/bin/social-publisher api-oauth <account-ref>
```

The sync command registers the immutable project/platform/identity target without starting OAuth. For TikTok organic targets it also persists the required `publication_mode`; this field, not platform or connection metadata alone, selects the provider contract. The OAuth command performs the same synchronization automatically and returns an `authorization_url` valid for ten minutes. Open it in the browser, authenticate the exact brand account, and approve the requested scopes. TikTok and Instagram callbacks verify the username and atomically bind the provider subject on the first successful authorization. Manual token injection remains available as a recovery path; put tokens only in temporary environment variables:

```bash
read -s SOCIAL_PROVIDER_ACCESS_TOKEN && export SOCIAL_PROVIDER_ACCESS_TOKEN
read -s SOCIAL_PROVIDER_REFRESH_TOKEN && export SOCIAL_PROVIDER_REFRESH_TOKEN
/Users/gideon/.codex/bin/social-publisher api-connect <account-ref> <provider-subject> --scopes "..."
unset SOCIAL_PROVIDER_ACCESS_TOKEN SOCIAL_PROVIDER_REFRESH_TOKEN
```

Provider subjects:

- Instagram: the app-scoped professional-account ID returned by Instagram Login; it is bound automatically after the expected username is verified.
- Facebook: Page numeric ID, with a Page access token.
- LinkedIn: organization URN such as `urn:li:organization:123`.
- TikTok: `open_id`; provide both access and refresh tokens.

Required application access:

- Meta: Instagram Login with `instagram_business_basic` and `instagram_business_content_publish`; Facebook Page publishing additionally requires an existing Page and `pages_manage_posts`.
- LinkedIn: Community Management API access and `w_organization_social`.
- TikTok organic `creator_inbox_draft`: Content Posting OAuth with `user.info.basic`, `user.info.profile`, and `video.upload`. The Worker transfers a draft to the authenticated creator's TikTok inbox; the creator chooses final privacy/settings and publishes in TikTok. Delivery to the inbox becomes the terminal state `awaiting_creator`: it is never reported as `published` and is not polled again. Shortlistable and Sibyl (`sibylinsight`) use this mode.
- TikTok organic `direct_publish`: API for Business Organic OAuth with `user.info.basic` and `video.publish`. The app must be approved for Account User, Video Publish, and Photo Publish. This mode is retained for future approved accounts.
- Both TikTok organic modes verify the authorized `open_id` and exact expected username (an optional leading `@` is ignored), persist `publication_mode` in the target, OAuth state, and account, and reject hybrid credentials or metadata.
- TikTok advertising: TikTok API for Business Marketing API with `ads_management`.

## Schedule from a project queue

```bash
export SOCIAL_PUBLISHER_API_URL=https://your-worker.example
read -s SOCIAL_PUBLISHER_ADMIN_TOKEN && export SOCIAL_PUBLISHER_ADMIN_TOKEN
/Users/gideon/.codex/bin/social-publisher validate sibyl
/Users/gideon/.codex/bin/social-publisher plan sibyl
/Users/gideon/.codex/bin/social-publisher api-submit sibyl <post-id> <delivery-id>
```

TikTok `direct_publish` deliveries require an explicitly approved `settings.privacy_level`. Immediately before the first publish request, the Worker reads `/business/video/settings/` and refuses unavailable privacy or engagement settings. A provider `share_id` remains a processing cursor; only `post_ids[0]` is stored as the canonical published receipt. `creator_inbox_draft` deliberately does not require a privacy level because the creator selects it in TikTok.

Instagram image publishing receives JPEG media. When an approved organic delivery references a PNG, `api-submit` preserves the source and creates a content-addressed JPEG copy under `~/.codex/social-publisher/prepared-media/`. Facebook keeps the approved source format because its organic photo endpoint accepts PNG.

TikTok photo publishing accepts JPEG and WebP, not PNG. When an approved queue references PNG slides, `api-submit` preserves those source files and automatically creates separate lossless, content-addressed WebP copies under `~/.codex/social-publisher/prepared-media/` before upload. A later submission reuses the same prepared copy while the source hash remains unchanged.

## Unified CLI: organic post or paid advertisement

The `publish` command is the single entry point when the caller needs to choose the action and its target platforms. It dispatches platforms sequentially so one provider failure cannot duplicate a successful delivery.

```bash
# Organic delivery from the registered project queue
/Users/gideon/.codex/bin/social-publisher publish shortlistable <post-id> \
  --kind post --platform instagram --platform tiktok

# Paid delivery from an approved advertising plan
/Users/gideon/.codex/bin/social-publisher publish shortlistable <group-id> \
  --kind ad \
  --platform instagram --platform tiktok \
  --plan marketing/content/campaigns/<campaign>/ads.json
```

Organic publishing supports Facebook, Instagram, LinkedIn, and TikTok. Paid execution supports Meta placements (Facebook and Instagram) and TikTok. Every paid entry names the connection account, immutable advertiser ID, canonical budget, start time, and an ordered list of allow-listed provider operations. The Worker injects credentials, advertiser IDs, media URLs, and canonical budget values; plans cannot choose arbitrary provider URLs.

Local media may be omitted when every operation uses provider-owned media, such as a Meta creative with `source_instagram_media_id`. If `$media_url` appears anywhere inside an operation body, the plan and API both require at least one uploaded media item.

Paid plans use `schema_version: 1` and contain an `advertisements` array. An entry remains inert until its exact media, copy, targeting, budget, operations, and start time have been approved:

```bash
/Users/gideon/.codex/bin/social-publisher ad-approve shortlistable <plan-path> <advertisement-id> --confirmed-by user
/Users/gideon/.codex/bin/social-publisher ad-submit shortlistable <plan-path> <advertisement-id>
/Users/gideon/.codex/bin/social-publisher ad-status <api-advertisement-id>
/Users/gideon/.codex/bin/social-publisher run-due
```

An advertisement becomes `submitted` after the final provider operation succeeds. This means the provider accepted the campaign objects; it does not claim that moderation has finished or that impressions have started.

Meta advertisements are materialized in Ads Manager immediately after `ad-submit`, even when their delivery starts later. The Worker keeps `start_at` as the canonical delivery time and forces it onto the Meta ad set's `start_time`; campaign, ad set, creative, and ad are therefore visible before launch without being eligible to spend early. TikTok advertising execution remains gated by `start_at`.

Operation bodies may refer to values owned by the Worker:

```json
{ "$media_url": 0 }
{ "$budget_minor": true }
{ "$budget_major": true }
{ "$result": { "operation": "campaign", "path": "data.campaign_id" } }
```

`$budget_minor` is suitable for Meta budget fields. `$budget_major` is suitable for provider fields expressed in major currency units. A result placeholder can only reference a prior named operation.

## Supported media in this release

- Instagram: image, Reel video, image carousel.
- Facebook: image, video, multi-image post.
- LinkedIn: image, video, multi-image post.
- TikTok: one video or a 1–35 image JPEG/WebP carousel. `creator_inbox_draft` uses Content Posting and `direct_publish` uses Business Organic; both use media URLs under a verified HTTPS property and are selected only by the account target's canonical `publication_mode`.

LinkedIn PDF/document posts remain on the native fallback until the Documents API adapter is added.

## Windows — environnement migré

La racine partagée est `C:/stellark/social-publisher`. Depuis PowerShell, utiliser
`& "$env:USERPROFILE/.codex/bin/social-publisher.cmd" projects`, puis `validate`
et `plan` avec la marque voulue. Les chemins Mac des exemples historiques
ci-dessus ne sont pas des commandes PowerShell. Le secret administrateur est
stocké dans le Gestionnaire d'identifiants du compte Windows : lecture
réellement vérifiée dans la session interactive. SSH par clé seule n'a pas
cette session de coffre (1312) ; utiliser Codex natif ou Remote Control.
Voir [les runtimes](../tools/windows/PROJECT_RUNTIME_WINDOWS.md). Les validations
et plans des trois marques passent ; aucune publication ni dépense réalisée.
Les approbations existantes restent applicables.
