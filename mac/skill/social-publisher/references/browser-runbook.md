# Native scheduler fallback runbook

Use this only when API execution is unavailable, a provider review is pending, or the user explicitly requests the native scheduler. The default workflow is `api-submit` from the main skill.

Use the real Chrome profile named on the target account, or the registry's default profile when the account has no override, through native computer control. Per-account profiles keep single-session platforms such as TikTok isolated by brand. Do not use an isolated Playwright profile for authenticated scheduling unless the user explicitly chooses and authenticates it.

## Before opening a scheduler

1. Run `validate <project-id>` and stop before side effects if any error remains.
2. Run `plan <project-id>` and process only `ready_to_schedule` deliveries.
3. Run `payload <project-id> <post-id> <delivery-id>` and inspect every resolved media path plus media metadata.
4. Confirm that the delivery state is `approved` and that the approval still matches the media, caption, target account, date, time, and timezone.
5. Open the account’s `scheduler_url` from the registry in the registered Chrome profile.
6. Verify the visible account or Page identity exactly. If it differs, do not switch, connect, convert, or create an account without specific user authorization.

## Upload invariant

For every real upload, activate the visible media control and use native computer control to operate the platform file chooser. Confirm the selected filename or media preview in the rendered UI. A hidden file input, DOM assignment, or upload response alone is not sufficient evidence.

## Meta Business Suite

- Use the planner/content calendar for the intended Facebook Page and/or Instagram professional account.
- Select only the deliveries named in the queue. Do not enable cross-posting implicitly.
- Choose the requested post, carousel, story, or Reel format; upload media in queue order.
- Enter each network’s own caption and accessibility fields when available.
- Select scheduling, enter the exact date and local time, and confirm the displayed timezone.
- Submit, then open the scheduled-content view and verify both Facebook and Instagram separately when both were targeted.

## LinkedIn

- Verify whether the target is the member profile or the intended organization Page before composing.
- Use the native media or document flow appropriate to the queue. For documents, enter `document_title` when present.
- Enter caption and accessibility text, select the clock/scheduling control, and set the requested time.
- Submit, reopen scheduled posts for that identity, and verify the preview and time. Do not treat the API upload-processing state as a scheduled-post receipt.

## TikTok Studio

- Verify the creator or business account before upload.
- Upload the video or photo set through the native chooser; confirm the preview, cover, caption, visibility, interaction settings, and commercial-content disclosure.
- Use only a date offered by TikTok’s native scheduler. If the requested date is outside its current window, leave the delivery approved and report `outside_native_window`.
- Submit, then verify the item under scheduled posts. If TikTok does not allow editing, delete and recreate only with explicit authorization.

## Buffer for TikTok

For every Buffer/TikTok delivery, keep `AI Generated`, `AI-generated content`,
or the equivalent control unchecked. Verify it immediately before saving,
scheduling, or publishing. If it is enabled or cannot be inspected, stop
without finalizing the delivery.

## Completion and failure

After visible verification, record a receipt:

```bash
~/.codex/bin/social-publisher mark-scheduled <project-id> <post-id> <delivery-id> --native-reference "<reference>"
```

If the platform returns an error, capture the visible message and preserve the delivery as `approved` unless the content itself is invalid. Never mark a delivery scheduled because the upload completed; scheduling confirmation must be visible in the platform’s queue.

When a later check confirms that the post is live, use `mark-published <project-id> <post-id> <delivery-id>` and optionally replace the scheduling reference with the final post URL.
