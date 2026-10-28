---
name: social-publisher
description: Prepare, validate, approve, and API-schedule photo, video, carousel, or document posts from any registered local project to Facebook, Instagram, LinkedIn, and TikTok without a persistent VPS.
---

# Social Publisher

Use this skill when the user asks Codex to prepare, queue, schedule, publish, inspect, or manage organic social content for a registered brand or project.

The global registry is `~/.codex/social-publisher/registry.json`. It owns project roots, account aliases, API execution state, and browser-fallback routing. It never contains passwords, cookies, access tokens, refresh tokens, or recovery codes. Each project owns its content queue at the path declared in that registry. The serverless service lives at `C:/stellark/social-publisher`; encrypted provider tokens and remote execution state live in its Cloudflare D1/R2 deployment.

Use `~/.codex/bin/social-publisher` for deterministic queue operations. Start with:

```bash
~/.codex/bin/social-publisher projects
~/.codex/bin/social-publisher validate <project-id>
~/.codex/bin/social-publisher plan <project-id>
```

When the user chooses between an organic post and paid advertising, use the unified command after the applicable approval gate:

```bash
~/.codex/bin/social-publisher publish <project-id> <post-id> --kind post --platform instagram --platform tiktok
~/.codex/bin/social-publisher publish <project-id> <group-id> --kind ad --platform instagram --platform tiktok --plan <project-relative-plan.json>
```

Organic targets are Facebook, Instagram, LinkedIn, and TikTok. Paid targets are Meta placements (Facebook or Instagram) and TikTok. Paid plans are project-owned, use immutable advertiser and connection-account identifiers, and require separate approval of the exact copy, targeting, budget, media, operations, and start time before `ad-approve` or `publish --kind ad` may create an external object or spend.

Read [references/queue-contract.md](references/queue-contract.md) when creating or changing queue entries. Prefer the API workflow below. Read [references/browser-runbook.md](references/browser-runbook.md) only when an API is unavailable, a developer-app review is pending, or the user explicitly requests the native interface.

## Caption and hashtag approval gate

Treat media approval and publication-copy approval as separate decisions. A content item being in a validated, pre-approved, approved, or export folder does not authorize its description, caption, mentions, emojis, call to action, or hashtags.

Before approving, uploading, scheduling, or publishing any delivery:

1. Show the user the exact platform-specific copy for every post, including line breaks, mentions, emojis, calls to action, and the complete hashtag list.
2. Ask for explicit approval of that exact copy, or ask what description and hashtags the user wants when no approved copy exists.
3. Keep the delivery in `draft` and perform no external write until that approval is given in the current conversation. A general instruction such as “publish these posts” does not approve copy that Codex drafted but has not shown.

A single grouped approval may cover several posts only when every final caption and hashtag set is displayed and clearly mapped to its post. If the user explicitly supplies the final copy or explicitly delegates both copywriting and immediate publication in the same request, that satisfies this gate. Any later copy change invalidates the approval and must be shown again. Never add, remove, or alter hashtags silently.

## API-first workflow

After validation and explicit approval, submit the exact delivery to the remote scheduler:

```bash
~/.codex/bin/social-publisher api-submit <project-id> <post-id> <delivery-id>
~/.codex/bin/social-publisher api-status <api-publication-id>
```

The deployed API URL comes from the registry. On Windows, the admin token comes from the current user’s Windows Credential Manager; the Mac source uses macOS Keychain. Never display either token. Connect or renew a registered provider account with:

```bash
~/.codex/bin/social-publisher api-sync-account <account-ref>
~/.codex/bin/social-publisher api-oauth <account-ref>
```

`api-sync-account` registers the account's immutable project, platform, and expected provider identity in the remote service without starting OAuth. `api-oauth` performs that synchronization automatically before issuing the authorization URL.

Open the returned ten-minute `authorization_url` in the registered browser and visibly verify the exact brand identity before consent. The callback stores provider tokens encrypted in D1. `api-connect` is only a recovery path; when used, access and refresh tokens must come from `SOCIAL_PROVIDER_ACCESS_TOKEN` and `SOCIAL_PROVIDER_REFRESH_TOKEN`, never command arguments.

## Operating rules

- Treat the queue as the canonical local content plan and the serverless publication record as the canonical execution state. The final provider ID is the canonical published receipt.
- Use the first-party Meta, LinkedIn, and TikTok APIs. Buffer and other publishing services are out of scope.
- Use Business Login for Instagram without a Facebook Page when the brand owns an Instagram professional account. Use LinkedIn Community Management for organization posts. For TikTok accounts owned by Stellark, use TikTok API for Business Organic API—not the general Content Posting API, whose audit policy excludes private tools limited to the developer’s own team.
- Keep project media inside that project root. Never borrow a similarly named asset or account from another project.
- Resolve the registry account and its API provider subject before every external write. The service rejects account/project/platform mismatches.
- Never put social credentials in the registry, queue, command arguments, logs, screenshots, or project files. Tokens are accepted only through temporary environment variables and encrypted server-side.
- Preparing and validating content is non-mutating. Scheduling, publishing, rescheduling, deleting, reconnecting, or changing a social account is an external mutation and requires current user authorization for the exact content, account, and time.
- A draft must not be uploaded. Set its time, obtain the user’s approval, and run the `approve` command with `--confirmed-by user` before opening a scheduler.
- After `api-submit`, retain its `api:<publication-id>` receipt. Use `api-status` to inspect processing, retry, published, or failed state without uploading the content again.
- If one network succeeds and another fails, preserve the successful receipt and report a partial result. Do not retry a confirmed success.
- The computer may be turned off after `api-submit` returns `scheduled`; the Cloudflare Cron Trigger publishes at the due time.

## Cross-project registration

Register a future project without changing the engine:

```bash
~/.codex/bin/social-publisher register-project <project-id> <absolute-root> --brand "<brand>"
```

Then register only the account aliases needed by that project with `register-account`. Keep brand-specific copy, media, dates, and receipts in its queue; keep reusable execution logic in the serverless service and this skill.

After visibly confirming a connected account, record it with `set-account-state <account-ref> ready --observed-identity "<visible identity>"`. The command rejects an identity that differs from the registry target.

## Windows execution

PowerShell: `& "$HOME\.codex\bin\social-publisher.cmd" projects` (and the same entry point for `validate` and `plan`). Git Bash may use `~/.codex/bin/social-publisher`. These launchers use the same canonical service code under `C:/stellark/social-publisher` and the project-owned queues. Credential Manager access is verified in the logged-in Windows session used by native Codex Remote Control. A key-only SSH session has no Windows vault logon session and may return error 1312; never copy the token into a project or command line to bypass it.
