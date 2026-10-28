import { CLAIM_TIMEOUT_MINUTES, DUE_BATCH_SIZE } from "./constants";
import { AppError } from "./errors";
import type { AccountRow, AdvertisementRow, MediaRow, PublicationRow } from "./types";

const MILLISECONDS_PER_MINUTE = 60_000;

function expiredClaimCutoff(now: string): string {
  return new Date(Date.parse(now) - CLAIM_TIMEOUT_MINUTES * MILLISECONDS_PER_MINUTE).toISOString();
}

export async function accountById(db: D1Database, id: string): Promise<AccountRow> {
  const account = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<AccountRow>();
  if (!account) throw new AppError(`Unknown account: ${id}`, 404);
  return account;
}

export async function publicationById(db: D1Database, id: string): Promise<PublicationRow> {
  const publication = await db.prepare("SELECT * FROM publications WHERE id = ?").bind(id).first<PublicationRow>();
  if (!publication) throw new AppError(`Unknown publication: ${id}`, 404);
  return publication;
}

export async function publicationMedia(db: D1Database, publicationId: string): Promise<MediaRow[]> {
  const result = await db.prepare(
    `SELECT media.* FROM media
     JOIN publication_media ON publication_media.media_id = media.id
     WHERE publication_media.publication_id = ? ORDER BY publication_media.position`,
  ).bind(publicationId).all<MediaRow>();
  return result.results;
}

export async function duePublications(db: D1Database, now: string): Promise<PublicationRow[]> {
  const result = await db.prepare(
    `SELECT * FROM publications
     WHERE (state = 'scheduled' AND publish_at <= ?)
        OR (state IN ('retry', 'processing') AND next_attempt_at <= ?)
        OR (state = 'publishing' AND updated_at <= ?)
     ORDER BY publish_at LIMIT ?`,
  ).bind(now, now, expiredClaimCutoff(now), DUE_BATCH_SIZE).all<PublicationRow>();
  return result.results;
}

export async function claimPublication(db: D1Database, publication: PublicationRow, now: string): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE publications SET state = 'publishing', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND state = ? AND attempts = ?`,
  ).bind(now, publication.id, publication.state, publication.attempts).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function advertisementById(db: D1Database, id: string): Promise<AdvertisementRow> {
  const advertisement = await db.prepare("SELECT * FROM advertisements WHERE id = ?")
    .bind(id)
    .first<AdvertisementRow>();
  if (!advertisement) throw new AppError(`Unknown advertisement: ${id}`, 404);
  return advertisement;
}

export async function advertisementMedia(db: D1Database, advertisementId: string): Promise<MediaRow[]> {
  const result = await db.prepare(
    `SELECT media.* FROM media
     JOIN advertisement_media ON advertisement_media.media_id = media.id
     WHERE advertisement_media.advertisement_id = ? ORDER BY advertisement_media.position`,
  ).bind(advertisementId).all<MediaRow>();
  return result.results;
}

export async function dueAdvertisements(db: D1Database, now: string): Promise<AdvertisementRow[]> {
  const result = await db.prepare(
    `SELECT * FROM advertisements
     WHERE (state IN ('scheduled', 'retry', 'processing') AND next_attempt_at <= ?)
        OR (state = 'executing' AND updated_at <= ?)
     ORDER BY next_attempt_at LIMIT ?`,
  ).bind(now, expiredClaimCutoff(now), DUE_BATCH_SIZE).all<AdvertisementRow>();
  return result.results;
}

export async function claimAdvertisement(db: D1Database, advertisement: AdvertisementRow, now: string): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE advertisements SET state = 'executing', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND state = ? AND attempts = ?`,
  ).bind(now, advertisement.id, advertisement.state, advertisement.attempts).run();
  return Number(result.meta.changes ?? 0) === 1;
}
