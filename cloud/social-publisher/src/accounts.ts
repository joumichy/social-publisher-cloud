import { encryptSecret } from "./crypto";
import { accountTargetById, assertConnectionMatchesTarget } from "./account-targets";
import type { ConnectionKind, Env, Platform, TikTokPublicationMode } from "./types";

export interface ConnectionDetails {
  accountId: string;
  projectId: string;
  platform: Platform;
  connectionKind: ConnectionKind;
  publicationMode?: TikTokPublicationMode | null;
  providerSubject: string;
  displayName: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  refreshExpiresAt?: string | null;
  scopes?: string;
  metadata?: Record<string, unknown>;
}

export async function saveConnection(env: Env, connection: ConnectionDetails): Promise<void> {
  const target = await accountTargetById(env.DB, connection.accountId);
  assertConnectionMatchesTarget(target, {
    projectId: connection.projectId,
    platform: connection.platform,
    connectionKind: connection.connectionKind,
    publicationMode: connection.publicationMode ?? null,
    providerSubject: connection.providerSubject,
    displayName: connection.displayName,
  });
  const encryptedAccess = await encryptSecret(connection.accessToken, env.TOKEN_ENCRYPTION_KEY);
  const encryptedRefresh = connection.refreshToken
    ? await encryptSecret(connection.refreshToken, env.TOKEN_ENCRYPTION_KEY)
    : null;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO accounts (
       id, project_id, platform, connection_kind, publication_mode, provider_subject, display_name, connection_status,
       access_token_ciphertext, access_token_iv, refresh_token_ciphertext, refresh_token_iv,
       expires_at, refresh_expires_at, scopes, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id, platform = excluded.platform, connection_kind = excluded.connection_kind,
       publication_mode = excluded.publication_mode,
       provider_subject = excluded.provider_subject, display_name = excluded.display_name,
       connection_status = 'ready', access_token_ciphertext = excluded.access_token_ciphertext,
       access_token_iv = excluded.access_token_iv, refresh_token_ciphertext = excluded.refresh_token_ciphertext,
       refresh_token_iv = excluded.refresh_token_iv, expires_at = excluded.expires_at,
       refresh_expires_at = excluded.refresh_expires_at, scopes = excluded.scopes,
       metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
  ).bind(
    connection.accountId,
    connection.projectId,
    connection.platform,
    connection.connectionKind,
    connection.publicationMode ?? null,
    connection.providerSubject,
    connection.displayName,
    encryptedAccess.ciphertext,
    encryptedAccess.iv,
    encryptedRefresh?.ciphertext ?? null,
    encryptedRefresh?.iv ?? null,
    connection.expiresAt ?? null,
    connection.refreshExpiresAt ?? null,
    connection.scopes ?? "",
    JSON.stringify(connection.metadata ?? {}),
    now,
    now,
  ).run();
}
