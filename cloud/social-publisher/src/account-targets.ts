import { AppError } from "./errors";
import type { AccountTargetRow, ConnectionKind, Env, Platform, TikTokPublicationMode } from "./types";

export interface AccountTargetDetails {
  id: string;
  projectId: string;
  platform: Platform;
  connectionKind: ConnectionKind;
  publicationMode: TikTokPublicationMode | null;
  providerSubject: string | null;
  displayName: string;
}

export function assertConnectionMatchesTarget(
  target: AccountTargetRow,
  connection: Omit<AccountTargetDetails, "id">,
): void {
  const matches = target.project_id === connection.projectId
    && target.platform === connection.platform
    && target.connection_kind === connection.connectionKind
    && target.publication_mode === connection.publicationMode
    && target.provider_subject === connection.providerSubject
    && target.display_name === connection.displayName;
  if (!matches) {
    throw new AppError(`Account target ${target.id} cannot be reassigned`, 409);
  }
}

export function assertTargetRegistrationMatches(
  target: AccountTargetRow,
  registration: Omit<AccountTargetDetails, "id">,
): void {
  const matches = target.project_id === registration.projectId
    && target.platform === registration.platform
    && target.connection_kind === registration.connectionKind
    && target.publication_mode === registration.publicationMode
    && target.display_name === registration.displayName
    && (!registration.providerSubject || target.provider_subject === registration.providerSubject);
  if (!matches) {
    throw new AppError(`Account target ${target.id} cannot be reassigned`, 409);
  }
}

export async function accountTargetById(db: D1Database, id: string): Promise<AccountTargetRow> {
  const target = await db.prepare("SELECT * FROM account_targets WHERE id = ?").bind(id).first<AccountTargetRow>();
  if (!target) throw new AppError(`Unknown account target: ${id}`, 404);
  return target;
}

export async function registerAccountTarget(env: Env, details: AccountTargetDetails): Promise<AccountTargetRow> {
  const existing = await env.DB.prepare("SELECT * FROM account_targets WHERE id = ?")
    .bind(details.id)
    .first<AccountTargetRow>();
  if (existing) {
    assertTargetRegistrationMatches(existing, details);
    return existing;
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO account_targets (
       id, project_id, platform, connection_kind, publication_mode, provider_subject, display_name, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    details.id,
    details.projectId,
    details.platform,
    details.connectionKind,
    details.publicationMode,
    details.providerSubject,
    details.displayName,
    now,
    now,
  ).run();
  return accountTargetById(env.DB, details.id);
}


export async function bindAccountTargetSubject(env: Env, accountId: string, providerSubject: string): Promise<void> {
  const target = await accountTargetById(env.DB, accountId);
  if (target.provider_subject && target.provider_subject !== providerSubject) {
    throw new AppError(`Account target ${accountId} is already bound to another provider subject`, 409);
  }
  if (target.provider_subject === providerSubject) return;
  const result = await env.DB.prepare(
    `UPDATE account_targets SET provider_subject = ?, updated_at = ?
     WHERE id = ? AND provider_subject IS NULL`,
  ).bind(providerSubject, new Date().toISOString(), accountId).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new AppError(`Account target ${accountId} could not be bound`, 409);
  }
}
