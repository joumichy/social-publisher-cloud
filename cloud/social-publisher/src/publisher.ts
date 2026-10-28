import { DEFAULT_RETRY_SECONDS, MAX_ERROR_LENGTH } from "./constants";
import { randomId } from "./crypto";
import { AppError } from "./errors";
import { publishWithProvider } from "./providers";
import { accountById, claimPublication, duePublications, publicationMedia } from "./repository";
import { accessTokenFor } from "./tokens";
import {
  PUBLICATION_AWAITING_CREATOR_STATE,
  type Env,
  type MediaRow,
  type PublicationRow,
} from "./types";

const MEDIA_CLEANUP_BATCH_SIZE = 100;
const MILLISECONDS_PER_DAY = 86_400_000;

function retryAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function backoffSeconds(attempts: number): number {
  return Math.min(6 * 60 * 60, DEFAULT_RETRY_SECONDS * 2 ** Math.min(attempts, 8));
}

async function recordAttemptStart(env: Env, publicationId: string, now: string): Promise<string> {
  const id = randomId("att");
  await env.DB.prepare(
    "INSERT INTO attempts (id, publication_id, started_at, outcome) VALUES (?, ?, ?, 'running')",
  ).bind(id, publicationId, now).run();
  return id;
}

async function completeAttempt(
  env: Env,
  publication: PublicationRow,
  attemptId: string,
  outcome: "processing" | typeof PUBLICATION_AWAITING_CREATOR_STATE | "published" | "retry" | "failed",
  reference: string | null,
  error: string | null,
  nextAttemptAt: string,
  providerUrl: string | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE publications SET state = ?, provider_reference = COALESCE(?, provider_reference),
       provider_url = COALESCE(?, provider_url), last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(outcome, reference, providerUrl, error, nextAttemptAt, now, publication.id),
    env.DB.prepare(
      "UPDATE attempts SET finished_at = ?, outcome = ?, provider_reference = ?, error = ? WHERE id = ?",
    ).bind(now, outcome, reference, error, attemptId),
  ]);
}

export async function executePublication(env: Env, publication: PublicationRow): Promise<void> {
  const now = new Date().toISOString();
  if (!(await claimPublication(env.DB, publication, now))) return;
  const attemptId = await recordAttemptStart(env, publication.id, now);
  // Preserve the pre-claim state for provider adapters that resume asynchronous processing.
  const current = { ...publication, attempts: publication.attempts + 1 } as PublicationRow;
  try {
    const [account, media] = await Promise.all([
      accountById(env.DB, current.account_id),
      publicationMedia(env.DB, current.id),
    ]);
    if (account.project_id !== current.project_id || account.platform !== current.platform) {
      throw new AppError("Publication account does not match project and platform", 409);
    }
    const accessToken = await accessTokenFor(env, account);
    const result = await publishWithProvider({
      env,
      account,
      publication: current,
      media,
      accessToken,
      settings: JSON.parse(current.settings_json) as Record<string, unknown>,
    });
    await completeAttempt(
      env,
      current,
      attemptId,
      result.state,
      result.reference,
      null,
      result.state === "processing" ? retryAt(result.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS) : now,
      result.url ?? null,
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
    const retryable = error instanceof AppError && error.retryable;
    const maxAttempts = Number(env.MAX_ATTEMPTS);
    const outcome = retryable && current.attempts < maxAttempts ? "retry" : "failed";
    await completeAttempt(
      env,
      current,
      attemptId,
      outcome,
      current.provider_reference,
      message,
      outcome === "retry" ? retryAt(backoffSeconds(current.attempts)) : now,
    );
  }
}

export async function runDuePublications(env: Env): Promise<number> {
  const due = await duePublications(env.DB, new Date().toISOString());
  await Promise.all(due.map((publication) => executePublication(env, publication)));
  return due.length;
}

export async function cleanupExpiredMedia(env: Env): Promise<number> {
  const retentionDays = Number(env.MEDIA_RETENTION_DAYS);
  const cutoff = new Date(Date.now() - retentionDays * MILLISECONDS_PER_DAY).toISOString();
  const candidates = await env.DB.prepare(
    `SELECT media.* FROM media
     WHERE media.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM publication_media
         JOIN publications ON publications.id = publication_media.publication_id
         WHERE publication_media.media_id = media.id
           AND publications.state NOT IN ('awaiting_creator', 'published', 'failed', 'cancelled')
       )
       AND NOT EXISTS (
         SELECT 1 FROM advertisement_media
         JOIN advertisements ON advertisements.id = advertisement_media.advertisement_id
         WHERE advertisement_media.media_id = media.id
           AND advertisements.state NOT IN ('submitted', 'failed', 'cancelled')
       )
     LIMIT ?`,
  ).bind(cutoff, MEDIA_CLEANUP_BATCH_SIZE).all<MediaRow>();
  for (const media of candidates.results) {
    await env.MEDIA.delete(media.object_key);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM publication_media WHERE media_id = ?").bind(media.id),
      env.DB.prepare("DELETE FROM advertisement_media WHERE media_id = ?").bind(media.id),
      env.DB.prepare("DELETE FROM media WHERE id = ?").bind(media.id),
    ]);
  }
  return candidates.results.length;
}
