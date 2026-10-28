import { saveConnection } from "./accounts";
import { accountTargetById, bindAccountTargetSubject } from "./account-targets";
import { randomId } from "./crypto";
import { AppError } from "./errors";
import { providerJson, readJson, requireString } from "./http";
import {
  asTikTokPublicationMode,
  requireTikTokBusinessData,
  requireTikTokBusinessOrganicScopes,
  requireTikTokContentOAuthScopes,
  TIKTOK_BUSINESS_AUTHORIZATION_URL,
  TIKTOK_BUSINESS_ORGANIC_CONNECTION,
  TIKTOK_BUSINESS_ORGANIC_SCOPES,
  TIKTOK_BUSINESS_TOKEN_URL,
  TIKTOK_CONTENT_AUTHORIZATION_URL,
  TIKTOK_CONTENT_CONNECTION,
  TIKTOK_CONTENT_OAUTH_SCOPES,
  TIKTOK_CONTENT_TOKEN_URL,
  TIKTOK_CREATOR_INBOX_DRAFT_MODE,
  TIKTOK_DIRECT_PUBLISH_MODE,
  type TikTokBusinessEnvelope,
  type TikTokBusinessTokenBundle,
  type TikTokContentTokenBundle,
  verifyTikTokBusinessIdentity,
  verifyTikTokContentIdentity,
} from "./tiktok-organic";
import type { ConnectionKind, Env, Platform, TikTokPublicationMode } from "./types";

const STATE_LIFETIME_MS = 10 * 60 * 1000;
const META_PLATFORMS = new Set<Platform>(["facebook", "instagram"]);
const META_ADVERTISING_SCOPES = "ads_management,ads_read,business_management,pages_show_list,pages_read_engagement";
const TIKTOK_ADVERTISING_SCOPES = "ads_management";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

interface OAuthStartInput {
  account_id?: unknown;
  scopes?: unknown;
}

interface OAuthStateRow {
  id: string;
  account_id: string;
  project_id: string;
  platform: Platform;
  connection_kind: ConnectionKind;
  publication_mode: TikTokPublicationMode | null;
  provider_subject: string | null;
  display_name: string;
  scopes: string;
  expires_at: string;
  consumed_at: string | null;
  last_error: string | null;
}

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

interface TikTokMarketingTokenResponse {
  code: number;
  message?: string;
  data?: {
    access_token: string;
    advertiser_ids: string[];
    scope: Array<string | number>;
  };
}

interface MetaTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

interface MetaAccountsResponse {
  data?: MetaPage[];
}

interface MetaAdAccountResponse {
  id: string;
  name?: string;
  account_status?: number;
}

interface InstagramShortTokenResponse {
  access_token: string;
  user_id: string | number;
  permissions?: string | string[];
}

interface InstagramProfileResponse {
  id?: string;
  user_id?: string;
  username?: string;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeOAuthScopes(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const scopes = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    if (scopes.length) return scopes.join(",");
  }
  return fallback;
}

function asOAuthPlatform(value: unknown): Platform {
  if (value === "facebook" || value === "instagram" || value === "linkedin" || value === "tiktok") return value;
  throw new AppError("platform is invalid");
}

function providerFor(platform: Platform): "meta" | "linkedin" | "tiktok" {
  if (META_PLATFORMS.has(platform)) return "meta";
  return platform === "linkedin" ? "linkedin" : "tiktok";
}

function callbackUrl(env: Env, provider: "meta" | "linkedin" | "tiktok"): string {
  const suffix = provider === "tiktok" ? "/" : "";
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/oauth/${provider}/callback${suffix}`;
}

function requiredCredentials(
  env: Env,
  platform: Platform,
  connectionKind: ConnectionKind,
  publicationMode: TikTokPublicationMode | null,
): { clientId: string; clientSecret: string } {
  if (platform === "instagram") {
    if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) throw new AppError("Instagram OAuth is not configured", 503);
    return { clientId: env.INSTAGRAM_APP_ID, clientSecret: env.INSTAGRAM_APP_SECRET };
  }
  if (platform === "linkedin") {
    if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) throw new AppError("LinkedIn OAuth is not configured", 503);
    return { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET };
  }
  if (platform === "tiktok") {
    if (connectionKind === "organic" && publicationMode === TIKTOK_CREATOR_INBOX_DRAFT_MODE) {
      if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
        throw new AppError("TikTok Content Posting OAuth is not configured", 503);
      }
      return { clientId: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET };
    }
    if (connectionKind === "organic" && publicationMode !== TIKTOK_DIRECT_PUBLISH_MODE) {
      throw new AppError("TikTok organic publication_mode is required", 500);
    }
    if (!env.TIKTOK_BUSINESS_CLIENT_ID || !env.TIKTOK_BUSINESS_CLIENT_SECRET) {
      throw new AppError("TikTok Business OAuth is not configured", 503);
    }
    return { clientId: env.TIKTOK_BUSINESS_CLIENT_ID, clientSecret: env.TIKTOK_BUSINESS_CLIENT_SECRET };
  }
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new AppError("Facebook OAuth is not configured", 503);
  return { clientId: env.META_APP_ID, clientSecret: env.META_APP_SECRET };
}

export function defaultScopes(
  platform: Platform,
  connectionKind: ConnectionKind = "organic",
  publicationMode: TikTokPublicationMode | null = null,
): string {
  if (connectionKind === "advertising") {
    return platform === "tiktok" ? TIKTOK_ADVERTISING_SCOPES : META_ADVERTISING_SCOPES;
  }
  switch (platform) {
    case "linkedin":
      return "w_organization_social";
    case "tiktok":
      return asTikTokPublicationMode(publicationMode) === TIKTOK_CREATOR_INBOX_DRAFT_MODE
        ? TIKTOK_CONTENT_OAUTH_SCOPES
        : TIKTOK_BUSINESS_ORGANIC_SCOPES;
    case "instagram":
      return "instagram_business_basic,instagram_business_content_publish";
    case "facebook":
      return "pages_show_list,pages_read_engagement,pages_manage_posts";
  }
}

export function buildAuthorizationUrl(env: Env, state: OAuthStateRow): string {
  const provider = providerFor(state.platform);
  const { clientId } = requiredCredentials(env, state.platform, state.connection_kind, state.publication_mode);
  const redirectUri = callbackUrl(env, provider);
  if (provider === "linkedin") {
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state.id,
      scope: state.scopes,
    }).toString();
    return url.toString();
  }
  if (provider === "tiktok") {
    if (state.connection_kind === "organic" && state.publication_mode === TIKTOK_CREATOR_INBOX_DRAFT_MODE) {
      const url = new URL(TIKTOK_CONTENT_AUTHORIZATION_URL);
      url.search = new URLSearchParams({
        client_key: clientId,
        scope: requireTikTokContentOAuthScopes(state.scopes),
        response_type: "code",
        redirect_uri: redirectUri,
        state: state.id,
      }).toString();
      return url.toString();
    }
    if (state.connection_kind === "organic" && state.publication_mode === TIKTOK_DIRECT_PUBLISH_MODE) {
      const url = new URL(TIKTOK_BUSINESS_AUTHORIZATION_URL);
      url.search = new URLSearchParams({
        app_id: clientId,
        scope: requireTikTokBusinessOrganicScopes(state.scopes),
        redirect_uri: redirectUri,
        state: state.id,
        disable_auto_auth: "1",
      }).toString();
      return url.toString();
    }
    if (!env.TIKTOK_BUSINESS_AUTHORIZATION_URL) throw new AppError("TikTok Business authorization URL is not configured", 503);
    const url = new URL(env.TIKTOK_BUSINESS_AUTHORIZATION_URL);
    if (url.protocol !== "https:" || url.hostname !== "ads.tiktok.com") throw new AppError("TikTok Business authorization URL is invalid", 500);
    url.searchParams.set("state", state.id);
    url.searchParams.set("disable_auto_auth", "1");
    return url.toString();
  }
  const url = state.platform === "instagram"
    ? new URL("https://www.instagram.com/oauth/authorize")
    : new URL(`https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: state.id,
    scope: state.scopes,
  }).toString();
  return url.toString();
}

async function exchangeInstagram(env: Env, state: OAuthStateRow, code: string): Promise<void> {
  const credentials = requiredCredentials(env, state.platform, state.connection_kind, state.publication_mode);
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl(env, "meta"),
    code,
  });
  const shortToken = await providerJson<InstagramShortTokenResponse>("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const profileUrl = new URL("https://graph.instagram.com/me");
  profileUrl.search = new URLSearchParams({
    fields: "id,user_id,username",
    access_token: shortToken.access_token,
  }).toString();
  const profile = await providerJson<InstagramProfileResponse>(profileUrl.toString(), { method: "GET" });
  const observedSubject = requireString(profile.user_id, "Instagram professional account ID");
  if (state.provider_subject && observedSubject !== state.provider_subject) {
    throw new AppError(
      `The authorized Instagram account does not match ${state.display_name}; observed provider subject: ${observedSubject}`,
      403,
    );
  }
  const observedUsername = requireString(profile.username, "Instagram username");
  if (observedUsername.toLocaleLowerCase() !== state.display_name.toLocaleLowerCase()) {
    throw new AppError(`The authorized Instagram username does not match ${state.display_name}`, 403);
  }
  await bindAccountTargetSubject(env, state.account_id, observedSubject);
  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: credentials.clientSecret,
    access_token: shortToken.access_token,
  }).toString();
  const token = await providerJson<MetaTokenResponse>(longUrl.toString(), { method: "GET" });
  await saveConnection(env, {
    accountId: state.account_id,
    projectId: state.project_id,
    platform: "instagram",
    connectionKind: state.connection_kind,
    providerSubject: observedSubject,
    displayName: observedUsername,
    accessToken: token.access_token,
    expiresAt: expiration(token.expires_in),
    scopes: normalizeOAuthScopes(shortToken.permissions, state.scopes),
    metadata: { oauth: "instagram_login" },
  });
}

export async function startOAuth(request: Request, env: Env): Promise<Response> {
  const input = await readJson<OAuthStartInput>(request);
  const accountId = requireString(input.account_id, "account_id");
  const target = await accountTargetById(env.DB, accountId);
  const platform = asOAuthPlatform(target.platform);
  const publicationMode = platform === "tiktok" && target.connection_kind === "organic"
    ? asTikTokPublicationMode(target.publication_mode)
    : null;
  requiredCredentials(env, platform, target.connection_kind, publicationMode);
  const providerSubject = target.provider_subject;
  if (target.connection_kind === "advertising" && platform !== "facebook" && platform !== "tiktok") {
    throw new AppError("Advertising OAuth supports Meta and TikTok only");
  }
  if (platform === "facebook" || platform === "linkedin" || target.connection_kind === "advertising") {
    if (!providerSubject) throw new AppError("provider_subject is required for this platform");
  }
  const state: OAuthStateRow = {
    id: randomId("oauth"),
    account_id: target.id,
    project_id: target.project_id,
    platform,
    connection_kind: target.connection_kind,
    publication_mode: publicationMode,
    provider_subject: providerSubject,
    display_name: target.display_name,
    scopes: optionalString(input.scopes) ?? defaultScopes(platform, target.connection_kind, publicationMode),
    expires_at: new Date(Date.now() + STATE_LIFETIME_MS).toISOString(),
    consumed_at: null,
    last_error: null,
  };
  if (platform === "tiktok" && target.connection_kind === "organic") {
    state.scopes = publicationMode === TIKTOK_CREATOR_INBOX_DRAFT_MODE
      ? requireTikTokContentOAuthScopes(state.scopes)
      : requireTikTokBusinessOrganicScopes(state.scopes);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now),
    env.DB.prepare(
      `INSERT INTO oauth_states (
        id, account_id, project_id, platform, connection_kind, publication_mode, provider_subject, display_name, scopes, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      state.id,
      state.account_id,
      state.project_id,
      state.platform,
      state.connection_kind,
      state.publication_mode,
      state.provider_subject,
      state.display_name,
      state.scopes,
      now,
      state.expires_at,
    ),
  ]);
  return new Response(JSON.stringify({ authorization_url: buildAuthorizationUrl(env, state), expires_at: state.expires_at }), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function expiration(seconds?: number): string | null {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : null;
}

async function exchangeLinkedIn(env: Env, state: OAuthStateRow, code: string): Promise<void> {
  const credentials = requiredCredentials(env, state.platform, state.connection_kind, state.publication_mode);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: callbackUrl(env, "linkedin"),
  });
  const token = await providerJson<LinkedInTokenResponse>("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  await saveConnection(env, {
    accountId: state.account_id,
    projectId: state.project_id,
    platform: "linkedin",
    connectionKind: state.connection_kind,
    providerSubject: requireString(state.provider_subject, "provider_subject"),
    displayName: state.display_name,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: expiration(token.expires_in),
    refreshExpiresAt: expiration(token.refresh_token_expires_in),
    scopes: token.scope ?? state.scopes,
    metadata: { oauth: "linkedin" },
  });
}

async function exchangeTikTok(env: Env, state: OAuthStateRow, code: string): Promise<void> {
  const credentials = requiredCredentials(env, state.platform, state.connection_kind, state.publication_mode);
  if (state.connection_kind === "advertising") {
    const response = await providerJson<TikTokMarketingTokenResponse>(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: credentials.clientId,
          secret: credentials.clientSecret,
          auth_code: code,
        }),
      },
    );
    if (response.code !== 0 || !response.data) {
      throw new AppError(`TikTok Marketing OAuth ${response.code}: ${response.message ?? "unknown error"}`, 502);
    }
    const advertiserId = requireString(state.provider_subject, "provider_subject");
    if (!response.data.advertiser_ids.includes(advertiserId)) {
      throw new AppError(`The authorized TikTok profile cannot access ${state.display_name}`, 403);
    }
    await saveConnection(env, {
      accountId: state.account_id,
      projectId: state.project_id,
      platform: "tiktok",
      connectionKind: "advertising",
      providerSubject: advertiserId,
      displayName: state.display_name,
      accessToken: response.data.access_token,
      scopes: response.data.scope.map(String).join(","),
      metadata: { oauth: "tiktok_marketing", advertiser_id: advertiserId },
    });
    return;
  }
  const publicationMode = asTikTokPublicationMode(state.publication_mode);
  if (publicationMode === TIKTOK_DIRECT_PUBLISH_MODE) {
    const response = await providerJson<TikTokBusinessEnvelope<TikTokBusinessTokenBundle>>(
      TIKTOK_BUSINESS_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: "authorization_code",
          auth_code: code,
          redirect_uri: callbackUrl(env, "tiktok"),
        }),
      },
    );
    const token = requireTikTokBusinessData(response, "OAuth");
    const accessToken = requireString(token.access_token, "TikTok access token");
    const refreshToken = requireString(token.refresh_token, "TikTok refresh token");
    const openId = requireString(token.open_id, "TikTok open_id");
    if (token.expires_in <= 0 || token.refresh_token_expires_in <= 0
      || !Number.isFinite(token.expires_in) || !Number.isFinite(token.refresh_token_expires_in)) {
      throw new AppError("TikTok Business OAuth returned invalid token expirations", 502);
    }
    const scopes = requireTikTokBusinessOrganicScopes(token.scope);
    if (state.provider_subject && state.provider_subject !== openId) {
      throw new AppError(`The authorized TikTok account does not match ${state.display_name}`, 403);
    }
    const identity = await verifyTikTokBusinessIdentity(accessToken, openId, state.display_name);
    await bindAccountTargetSubject(env, state.account_id, openId);
    await saveConnection(env, {
      accountId: state.account_id,
      projectId: state.project_id,
      platform: "tiktok",
      connectionKind: state.connection_kind,
      publicationMode,
      providerSubject: openId,
      displayName: state.display_name,
      accessToken,
      refreshToken,
      expiresAt: expiration(token.expires_in),
      refreshExpiresAt: expiration(token.refresh_token_expires_in),
      scopes,
      metadata: {
        oauth: TIKTOK_BUSINESS_ORGANIC_CONNECTION,
        publish_mode: publicationMode,
        expected_identity: state.display_name,
        username: identity.username,
        provider_display_name: identity.displayName,
      },
    });
    return;
  }
  const body = new URLSearchParams({
    client_key: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl(env, "tiktok"),
  });
  const token = await providerJson<TikTokContentTokenBundle>(TIKTOK_CONTENT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": FORM_CONTENT_TYPE },
    body,
  });
  const accessToken = requireString(token.access_token, "TikTok access token");
  const refreshToken = requireString(token.refresh_token, "TikTok refresh token");
  const openId = requireString(token.open_id, "TikTok open_id");
  if (token.expires_in <= 0 || token.refresh_expires_in <= 0
    || !Number.isFinite(token.expires_in) || !Number.isFinite(token.refresh_expires_in)) {
    throw new AppError("TikTok Content Posting OAuth returned invalid token expirations", 502);
  }
  const scopes = requireTikTokContentOAuthScopes(token.scope);
  if (state.provider_subject && state.provider_subject !== openId) {
    throw new AppError(`The authorized TikTok account does not match ${state.display_name}`, 403);
  }
  const identity = await verifyTikTokContentIdentity(accessToken, openId, state.display_name);
  await bindAccountTargetSubject(env, state.account_id, openId);
  await saveConnection(env, {
    accountId: state.account_id,
    projectId: state.project_id,
    platform: "tiktok",
    connectionKind: state.connection_kind,
    publicationMode,
    providerSubject: openId,
    displayName: state.display_name,
    accessToken,
    refreshToken,
    expiresAt: expiration(token.expires_in),
    refreshExpiresAt: expiration(token.refresh_expires_in),
    scopes,
    metadata: {
      oauth: TIKTOK_CONTENT_CONNECTION,
      publish_mode: publicationMode,
      expected_identity: state.display_name,
      username: identity.username,
      provider_display_name: identity.displayName,
    },
  });
}

async function exchangeMeta(env: Env, state: OAuthStateRow, code: string): Promise<void> {
  if (state.platform === "instagram") return exchangeInstagram(env, state, code);
  const credentials = requiredCredentials(env, state.platform, state.connection_kind, state.publication_mode);
  const exchangeUrl = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/oauth/access_token`);
  exchangeUrl.search = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: callbackUrl(env, "meta"),
    code,
  }).toString();
  const shortToken = await providerJson<MetaTokenResponse>(exchangeUrl.toString(), { method: "GET" });
  const longUrl = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/oauth/access_token`);
  longUrl.search = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    fb_exchange_token: shortToken.access_token,
  }).toString();
  const userToken = await providerJson<MetaTokenResponse>(longUrl.toString(), { method: "GET" });
  if (state.connection_kind === "advertising") {
    const advertiserId = requireString(state.provider_subject, "provider_subject").replace(/^act_/, "");
    const accountUrl = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/act_${advertiserId}`);
    accountUrl.search = new URLSearchParams({
      fields: "id,name,account_status",
      access_token: userToken.access_token,
    }).toString();
    const account = await providerJson<MetaAdAccountResponse>(accountUrl.toString(), { method: "GET" });
    if (account.id.replace(/^act_/, "") !== advertiserId) {
      throw new AppError(`The authorized Meta profile cannot access ${state.display_name}`, 403);
    }
    await saveConnection(env, {
      accountId: state.account_id,
      projectId: state.project_id,
      platform: "facebook",
      connectionKind: "advertising",
      providerSubject: advertiserId,
      displayName: state.display_name,
      accessToken: userToken.access_token,
      expiresAt: expiration(userToken.expires_in),
      scopes: state.scopes,
      metadata: {
        oauth: "meta_marketing",
        advertiser_id: advertiserId,
        advertiser_name: account.name ?? state.display_name,
        account_status: account.account_status ?? null,
      },
    });
    return;
  }
  const pagesUrl = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/me/accounts`);
  pagesUrl.search = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
    access_token: userToken.access_token,
  }).toString();
  const pages = await providerJson<MetaAccountsResponse>(pagesUrl.toString(), { method: "GET" });
  const expected = requireString(state.provider_subject, "provider_subject");
  const page = pages.data?.find((candidate) => candidate.id === expected);
  if (!page?.access_token) throw new AppError(`The authorized Meta profile cannot access ${state.display_name}`, 403);
  await saveConnection(env, {
    accountId: state.account_id,
    projectId: state.project_id,
    platform: state.platform,
    connectionKind: state.connection_kind,
    providerSubject: expected,
    displayName: page.name,
    accessToken: page.access_token,
    expiresAt: expiration(userToken.expires_in),
    scopes: state.scopes,
    metadata: { oauth: "meta", page_id: page.id },
  });
}

function resultPage(title: string, message: string, ok: boolean): Response {
  const color = ok ? "#15803d" : "#b91c1c";
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
  const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px"><h1 style="color:${color}">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>Vous pouvez fermer cet onglet et revenir dans Codex.</p></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export async function completeOAuth(request: Request, env: Env, provider: string): Promise<Response> {
  if (provider !== "meta" && provider !== "linkedin" && provider !== "tiktok") throw new AppError("Unknown OAuth provider", 404);
  const url = new URL(request.url);
  const stateId = requireString(url.searchParams.get("state"), "state");
  if (url.searchParams.has("error")) return resultPage("Connexion annulée", "Le réseau social n’a accordé aucun accès.", false);
  const now = new Date().toISOString();
  const state = await env.DB.prepare(
    "SELECT * FROM oauth_states WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
  ).bind(stateId, now).first<OAuthStateRow>();
  if (!state || providerFor(state.platform) !== provider) throw new AppError("OAuth state is invalid or expired", 401);
  const codeParameter = provider === "tiktok"
    && (state.connection_kind === "advertising" || state.publication_mode === TIKTOK_DIRECT_PUBLISH_MODE)
    ? "auth_code"
    : "code";
  const code = requireString(url.searchParams.get(codeParameter), "authorization code");
  const claim = `${now}:${randomId("claim")}`;
  const claimed = await env.DB.prepare(
    "UPDATE oauth_states SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
  ).bind(claim, stateId, now).run();
  if (!claimed.meta.changes) throw new AppError("OAuth state was already used", 409);
  try {
    if (provider === "linkedin") await exchangeLinkedIn(env, state, code);
    else if (provider === "tiktok") await exchangeTikTok(env, state, code);
    else await exchangeMeta(env, state, code);
    await env.DB.prepare("UPDATE oauth_states SET consumed_at = ? WHERE id = ? AND consumed_at = ?")
      .bind(new Date().toISOString(), stateId, claim).run();
    return resultPage("Compte connecté", `${state.display_name} est prêt pour la publication par API.`, true);
  } catch (error) {
    const failure = error instanceof Error ? error.message : "Unknown OAuth failure";
    await env.DB.prepare(
      "UPDATE oauth_states SET consumed_at = NULL, last_error = ? WHERE id = ? AND consumed_at = ?",
    ).bind(failure.slice(0, 1000), stateId, claim).run();
    throw error;
  }
}
