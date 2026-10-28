import { decryptSecret, encryptSecret } from "./crypto";
import { AppError, ProviderError } from "./errors";
import { providerJson } from "./http";
import {
  requireTikTokBusinessData,
  requireTikTokBusinessOrganicScopes,
  requireTikTokContentScopes,
  requireTikTokOrganicAccount,
  TIKTOK_BUSINESS_REFRESH_URL,
  TIKTOK_CONTENT_TOKEN_URL,
  TIKTOK_CREATOR_INBOX_DRAFT_MODE,
  type TikTokBusinessEnvelope,
  type TikTokBusinessTokenBundle,
  type TikTokContentTokenBundle,
} from "./tiktok-organic";
import type { AccountRow, Env } from "./types";

interface TikTokRefreshedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  scopes: string;
}

interface InstagramRefreshResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
}

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

function expiresWithin(value: string | null, milliseconds: number): boolean {
  if (!value) return false;
  return Date.parse(value) <= Date.now() + milliseconds;
}

async function persistTikTokTokens(env: Env, account: AccountRow, tokens: TikTokRefreshedTokens): Promise<string> {
  const access = await encryptSecret(tokens.accessToken, env.TOKEN_ENCRYPTION_KEY);
  const refresh = await encryptSecret(tokens.refreshToken, env.TOKEN_ENCRYPTION_KEY);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE accounts SET access_token_ciphertext = ?, access_token_iv = ?, refresh_token_ciphertext = ?,
      refresh_token_iv = ?, expires_at = ?, refresh_expires_at = ?, scopes = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    access.ciphertext,
    access.iv,
    refresh.ciphertext,
    refresh.iv,
    new Date(now + tokens.expiresIn * 1000).toISOString(),
    new Date(now + tokens.refreshExpiresIn * 1000).toISOString(),
    tokens.scopes,
    new Date(now).toISOString(),
    account.id,
  ).run();
  return tokens.accessToken;
}

export async function accessTokenFor(env: Env, account: AccountRow): Promise<string> {
  if (account.connection_status !== "ready") throw new AppError(`Account ${account.id} is not ready`, 409);
  const encryptedAccess = { ciphertext: account.access_token_ciphertext, iv: account.access_token_iv };
  const metadata = JSON.parse(account.metadata_json) as Record<string, unknown>;
  const instagramLogin = account.platform === "instagram" && metadata.oauth === "instagram_login";
  const organicTikTok = account.platform === "tiktok" && account.connection_kind === "organic";
  const tiktokMode = organicTikTok ? requireTikTokOrganicAccount(account).mode : null;
  const needsTikTokRefresh = organicTikTok && expiresWithin(account.expires_at, 5 * 60 * 1000);
  const needsInstagramRefresh = instagramLogin && expiresWithin(account.expires_at, 7 * 24 * 60 * 60 * 1000);
  if (!needsTikTokRefresh && !needsInstagramRefresh) {
    if (account.expires_at && Date.parse(account.expires_at) <= Date.now()) throw new AppError(`Account ${account.id} access token expired`, 409);
    return decryptSecret(encryptedAccess, env.TOKEN_ENCRYPTION_KEY);
  }
  if (!needsTikTokRefresh && account.expires_at && Date.parse(account.expires_at) <= Date.now()) {
    throw new AppError(`Account ${account.id} access token expired`, 409);
  }
  if (needsInstagramRefresh) {
    const currentToken = await decryptSecret(encryptedAccess, env.TOKEN_ENCRYPTION_KEY);
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: currentToken }).toString();
    const refreshed = await providerJson<InstagramRefreshResponse>(url.toString(), { method: "GET" });
    const access = await encryptSecret(refreshed.access_token, env.TOKEN_ENCRYPTION_KEY);
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE accounts SET access_token_ciphertext = ?, access_token_iv = ?, expires_at = ?, updated_at = ? WHERE id = ?",
    ).bind(
      access.ciphertext,
      access.iv,
      new Date(now + refreshed.expires_in * 1000).toISOString(),
      new Date(now).toISOString(),
      account.id,
    ).run();
    return refreshed.access_token;
  }
  if (!account.refresh_token_ciphertext || !account.refresh_token_iv) {
    throw new AppError(`TikTok account ${account.id} has no refresh token`, 409);
  }
  if (account.refresh_expires_at && Date.parse(account.refresh_expires_at) <= Date.now()) {
    throw new AppError(`TikTok account ${account.id} refresh token expired`, 409);
  }
  const refreshToken = await decryptSecret(
    { ciphertext: account.refresh_token_ciphertext, iv: account.refresh_token_iv },
    env.TOKEN_ENCRYPTION_KEY,
  );
  if (tiktokMode === TIKTOK_CREATOR_INBOX_DRAFT_MODE) {
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      throw new AppError("TikTok Content Posting refresh credentials are not configured", 500);
    }
    const body = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const refreshed = await providerJson<TikTokContentTokenBundle>(TIKTOK_CONTENT_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": FORM_CONTENT_TYPE },
      body,
    });
    if (!refreshed.access_token || !refreshed.refresh_token) {
      throw new ProviderError("TikTok Content Posting refresh returned an incomplete token bundle");
    }
    if (refreshed.open_id !== account.provider_subject) {
      throw new AppError(`TikTok refresh identity changed for account ${account.id}`, 403);
    }
    if (refreshed.expires_in <= 0 || refreshed.refresh_expires_in <= 0
      || !Number.isFinite(refreshed.expires_in) || !Number.isFinite(refreshed.refresh_expires_in)) {
      throw new ProviderError("TikTok Content Posting refresh returned invalid token expirations");
    }
    return persistTikTokTokens(env, account, {
      accessToken: refreshed.access_token,
      expiresIn: refreshed.expires_in,
      refreshToken: refreshed.refresh_token,
      refreshExpiresIn: refreshed.refresh_expires_in,
      scopes: requireTikTokContentScopes(refreshed.scope),
    });
  }
  if (!env.TIKTOK_BUSINESS_CLIENT_ID || !env.TIKTOK_BUSINESS_CLIENT_SECRET) {
    throw new AppError("TikTok Business Organic refresh credentials are not configured", 500);
  }
  const body = JSON.stringify({
    client_id: env.TIKTOK_BUSINESS_CLIENT_ID,
    client_secret: env.TIKTOK_BUSINESS_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await providerJson<TikTokBusinessEnvelope<TikTokBusinessTokenBundle>>(
    TIKTOK_BUSINESS_REFRESH_URL,
    { method: "POST", headers: { "content-type": "application/json" }, body },
  );
  const refreshed = requireTikTokBusinessData(response, "refresh");
  if (!refreshed.access_token || !refreshed.refresh_token) {
    throw new ProviderError("TikTok refresh returned an incomplete token bundle");
  }
  if (refreshed.open_id !== account.provider_subject) {
    throw new AppError(`TikTok refresh identity changed for account ${account.id}`, 403);
  }
  if (refreshed.expires_in <= 0 || refreshed.refresh_token_expires_in <= 0
    || !Number.isFinite(refreshed.expires_in) || !Number.isFinite(refreshed.refresh_token_expires_in)) {
    throw new ProviderError("TikTok refresh returned invalid token expirations");
  }
  const scopes = requireTikTokBusinessOrganicScopes(refreshed.scope);
  return persistTikTokTokens(env, account, {
    accessToken: refreshed.access_token,
    expiresIn: refreshed.expires_in,
    refreshToken: refreshed.refresh_token,
    refreshExpiresIn: refreshed.refresh_token_expires_in,
    scopes,
  });
}
