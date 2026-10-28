import {
  ADVERTISEMENT_TERMINAL_STATES,
  ALLOWED_MEDIA_TYPES,
  MAX_AD_OPERATIONS,
  MAX_UPLOAD_BYTES,
  PUBLICATION_TERMINAL_STATES,
} from "./constants";
import {
  ADVERTISING_MEDIA_URL_PLACEHOLDER,
  advertisingOperationsRequireMedia,
  initialAdvertisementExecutionAt,
  operationMatchesProvider,
  runDueAdvertisements,
} from "./advertising";
import { registerAccountTarget } from "./account-targets";
import { saveConnection } from "./accounts";
import { randomId } from "./crypto";
import { AppError } from "./errors";
import { jsonResponse, readJson, requireAdmin, requireString } from "./http";
import { dataDeletionPage, privacyPage, termsPage } from "./legal";
import { completeOAuth, startOAuth } from "./oauth";
import { runDuePublications } from "./publisher";
import { accountById, advertisementById, publicationById } from "./repository";
import {
  asTikTokPublicationMode,
  requireTikTokBusinessOrganicScopes,
  requireTikTokContentOAuthScopes,
  TIKTOK_BUSINESS_ORGANIC_CONNECTION,
  TIKTOK_CONTENT_CONNECTION,
  TIKTOK_CREATOR_INBOX_DRAFT_MODE,
  TIKTOK_DIRECT_PUBLISH_MODE,
  validateTikTokPublicationInput,
  verifyTikTokBusinessIdentity,
  verifyTikTokContentIdentity,
} from "./tiktok-organic";
import type {
  AdvertisingOperation,
  AdvertisingOperationType,
  AdvertisingPlacement,
  AdvertisingProvider,
  Env,
  Platform,
} from "./types";

const PLATFORMS = new Set<Platform>(["facebook", "instagram", "linkedin", "tiktok"]);
const TIKTOK_VERIFICATION_PATH = "tiktokNz0JweJKXeUiLFDwKA2yArroecARj7jL.txt";
const TIKTOK_VERIFICATION_CONTENT = "tiktok-developers-site-verification=Nz0JweJKXeUiLFDwKA2yArroecARj7jL";
const ADVERTISING_PROVIDERS = new Set<AdvertisingProvider>(["meta", "tiktok"]);
const ADVERTISING_PLACEMENTS = new Set<AdvertisingPlacement>(["facebook", "instagram", "tiktok"]);
const ADVERTISING_OPERATION_TYPES = new Set<AdvertisingOperationType>([
  "meta.video.upload",
  "meta.campaign.create",
  "meta.campaign.update",
  "meta.page.list",
  "meta.asset.list",
  "meta.adaccount.asset.list",
  "meta.adset.create",
  "meta.creative.create",
  "meta.ad.create",
  "tiktok.video.upload",
  "tiktok.campaign.create",
  "tiktok.adgroup.create",
  "tiktok.ad.create",
]);
const ADVERTISING_MEDIA_REQUIRED_ERROR =
  `media_ids must contain at least one item when operations reference ${ADVERTISING_MEDIA_URL_PLACEHOLDER}`;
const ADVERTISING_MEDIA_LIST_ERROR = "media_ids must be an array when provided";

interface ConnectionInput {
  account_id?: unknown;
  project_id?: unknown;
  platform?: unknown;
  connection_kind?: unknown;
  publication_mode?: unknown;
  provider_subject?: unknown;
  display_name?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  refresh_expires_at?: unknown;
  scopes?: unknown;
  metadata?: unknown;
}

interface AccountTargetInput {
  project_id?: unknown;
  platform?: unknown;
  connection_kind?: unknown;
  publication_mode?: unknown;
  provider_subject?: unknown;
  display_name?: unknown;
}

function asConnectionKind(value: unknown): "organic" | "advertising" {
  if (value === undefined || value === "organic") return "organic";
  if (value === "advertising") return "advertising";
  throw new AppError("connection_kind is invalid");
}

interface PublicationInput {
  idempotency_key?: unknown;
  project_id?: unknown;
  post_id?: unknown;
  delivery_id?: unknown;
  account_id?: unknown;
  platform?: unknown;
  caption?: unknown;
  title?: unknown;
  alt_text?: unknown;
  publish_at?: unknown;
  media_ids?: unknown;
  settings?: unknown;
}

interface AdvertisementInput {
  idempotency_key?: unknown;
  project_id?: unknown;
  campaign_id?: unknown;
  delivery_id?: unknown;
  connection_account_id?: unknown;
  provider?: unknown;
  placement?: unknown;
  advertiser_id?: unknown;
  budget_type?: unknown;
  budget_amount_minor?: unknown;
  currency?: unknown;
  start_at?: unknown;
  media_ids?: unknown;
  operations?: unknown;
}

function asBudgetType(value: unknown): "daily" | "lifetime" {
  if (value !== "daily" && value !== "lifetime") throw new AppError("budget_type is invalid");
  return value;
}

function asBudgetAmountMinor(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new AppError("budget_amount_minor must be a positive integer");
  }
  return Number(value);
}

function pathParts(request: Request): string[] {
  return new URL(request.url).pathname.split("/").filter(Boolean);
}

function asPlatform(value: unknown): Platform {
  if (typeof value !== "string" || !PLATFORMS.has(value as Platform)) throw new AppError("platform is invalid");
  return value as Platform;
}

function asAdvertisingProvider(value: unknown): AdvertisingProvider {
  if (typeof value !== "string" || !ADVERTISING_PROVIDERS.has(value as AdvertisingProvider)) {
    throw new AppError("advertising provider is invalid");
  }
  return value as AdvertisingProvider;
}

function asAdvertisingPlacement(value: unknown): AdvertisingPlacement {
  if (typeof value !== "string" || !ADVERTISING_PLACEMENTS.has(value as AdvertisingPlacement)) {
    throw new AppError("advertising placement is invalid");
  }
  return value as AdvertisingPlacement;
}

function asAdvertisingOperations(value: unknown, provider: AdvertisingProvider): AdvertisingOperation[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_AD_OPERATIONS) {
    throw new AppError(`operations must contain between 1 and ${MAX_AD_OPERATIONS} items`);
  }
  const identifiers = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new AppError("advertising operation is invalid");
    const input = candidate as Record<string, unknown>;
    const id = requireString(input.id, "operations[].id");
    if (identifiers.has(id)) throw new AppError(`duplicate advertising operation: ${id}`);
    identifiers.add(id);
    const type = requireString(input.type, "operations[].type") as AdvertisingOperationType;
    if (!ADVERTISING_OPERATION_TYPES.has(type) || !operationMatchesProvider(type, provider)) {
      throw new AppError(`advertising operation does not match provider: ${type}`);
    }
    if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) {
      throw new AppError("operations[].body must be an object");
    }
    return { id, type, body: input.body as Record<string, unknown> };
  });
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function upsertConnection(request: Request, env: Env): Promise<Response> {
  const input = await readJson<ConnectionInput>(request);
  const accountId = requireString(input.account_id, "account_id");
  const projectId = requireString(input.project_id, "project_id");
  const platform = asPlatform(input.platform);
  const connectionKind = asConnectionKind(input.connection_kind);
  const publicationMode = platform === "tiktok" && connectionKind === "organic"
    ? asTikTokPublicationMode(input.publication_mode)
    : null;
  const providerSubject = requireString(input.provider_subject, "provider_subject");
  const displayName = requireString(input.display_name, "display_name");
  const accessToken = requireString(input.access_token, "access_token");
  const refreshToken = optionalString(input.refresh_token);
  let scopes = optionalString(input.scopes) ?? "";
  let metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata as Record<string, unknown>
    : {};
  if (platform === "tiktok" && connectionKind === "organic") {
    if (!refreshToken) throw new AppError("TikTok organic connections require a refresh token");
    const creatorInbox = publicationMode === TIKTOK_CREATOR_INBOX_DRAFT_MODE;
    scopes = creatorInbox
      ? requireTikTokContentOAuthScopes(scopes)
      : requireTikTokBusinessOrganicScopes(scopes);
    const identity = creatorInbox
      ? await verifyTikTokContentIdentity(accessToken, providerSubject, displayName)
      : await verifyTikTokBusinessIdentity(accessToken, providerSubject, displayName);
    metadata = {
      oauth: creatorInbox ? TIKTOK_CONTENT_CONNECTION : TIKTOK_BUSINESS_ORGANIC_CONNECTION,
      publish_mode: publicationMode,
      expected_identity: displayName,
      username: identity.username,
      provider_display_name: identity.displayName,
    };
  }
  await saveConnection(env, {
    accountId,
    projectId,
    platform,
    connectionKind,
    publicationMode,
    providerSubject,
    displayName,
    accessToken,
    refreshToken,
    expiresAt: optionalString(input.expires_at),
    refreshExpiresAt: optionalString(input.refresh_expires_at),
    scopes,
    metadata,
  });
  return jsonResponse({ account_id: accountId, connection_status: "ready" }, 201);
}

async function listAccounts(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, project_id, platform, provider_subject, display_name, connection_status,
      connection_kind, publication_mode, expires_at, refresh_expires_at, scopes, created_at, updated_at FROM accounts ORDER BY project_id, platform`,
  ).all();
  return jsonResponse({ accounts: result.results });
}

async function upsertAccountTarget(request: Request, env: Env, accountId: string): Promise<Response> {
  const input = await readJson<AccountTargetInput>(request);
  const platform = asPlatform(input.platform);
  const connectionKind = asConnectionKind(input.connection_kind);
  const publicationMode = platform === "tiktok" && connectionKind === "organic"
    ? asTikTokPublicationMode(input.publication_mode)
    : null;
  const providerSubject = optionalString(input.provider_subject);
  if (platform === "facebook" || platform === "linkedin") {
    if (!providerSubject) throw new AppError("provider_subject is required for this platform");
  }
  const target = await registerAccountTarget(env, {
    id: accountId,
    projectId: requireString(input.project_id, "project_id"),
    platform,
    connectionKind,
    publicationMode,
    providerSubject,
    displayName: requireString(input.display_name, "display_name"),
  });
  return jsonResponse(target, 201);
}

async function listAccountTargets(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, project_id, platform, connection_kind, publication_mode, provider_subject, display_name, created_at, updated_at
     FROM account_targets ORDER BY project_id, platform, id`,
  ).all();
  return jsonResponse({ account_targets: result.results });
}

async function uploadMedia(request: Request, env: Env): Promise<Response> {
  const projectId = requireString(request.headers.get("x-project-id"), "x-project-id");
  const filename = requireString(request.headers.get("x-filename"), "x-filename");
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const kind = ALLOWED_MEDIA_TYPES.get(contentType);
  if (!kind) throw new AppError(`Unsupported content-type: ${contentType}`);
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    throw new AppError(`content-length must be between 1 and ${MAX_UPLOAD_BYTES}`);
  }
  const sha256 = requireString(request.headers.get("x-content-sha256"), "x-content-sha256");
  if (!request.body) throw new AppError("Media body is required");
  const existing = await env.DB.prepare(
    "SELECT id, project_id, filename, content_type, kind, size_bytes FROM media WHERE project_id = ? AND sha256 = ? AND filename = ?",
  ).bind(projectId, sha256, filename).first();
  if (existing) return jsonResponse(existing);
  const id = randomId("med");
  const publicToken = randomId("pub");
  const objectKey = `${projectId}/${id}/${encodeURIComponent(filename)}`;
  await env.MEDIA.put(objectKey, request.body, { httpMetadata: { contentType } });
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO media (id, project_id, object_key, public_token, filename, content_type, kind, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, projectId, objectKey, publicToken, filename, contentType, kind, contentLength, sha256, now).run();
  } catch (error) {
    await env.MEDIA.delete(objectKey);
    throw error;
  }
  return jsonResponse({ id, project_id: projectId, filename, content_type: contentType, kind, size_bytes: contentLength }, 201);
}

async function createPublication(request: Request, env: Env): Promise<Response> {
  const input = await readJson<PublicationInput>(request);
  const accountId = requireString(input.account_id, "account_id");
  const projectId = requireString(input.project_id, "project_id");
  const platform = asPlatform(input.platform);
  const account = await accountById(env.DB, accountId);
  if (account.project_id !== projectId || account.platform !== platform || account.connection_kind !== "organic") {
    throw new AppError("Account does not match organic project/platform");
  }
  const mediaIds = Array.isArray(input.media_ids) ? input.media_ids.map((value) => requireString(value, "media_ids[]")) : [];
  if (!mediaIds.length) throw new AppError("media_ids must contain at least one item");
  const placeholders = mediaIds.map(() => "?").join(",");
  const media = await env.DB.prepare(
    `SELECT id, project_id, content_type, kind, size_bytes FROM media WHERE id IN (${placeholders})`,
  ).bind(...mediaIds).all<{ id: string; project_id: string; content_type: string; kind: string; size_bytes: number }>();
  if (media.results.length !== mediaIds.length || media.results.some((item) => item.project_id !== projectId)) {
    throw new AppError("One or more media items are unknown or belong to another project");
  }
  const settings = input.settings && typeof input.settings === "object" ? input.settings as Record<string, unknown> : {};
  if (platform === "tiktok") {
    validateTikTokPublicationInput(asTikTokPublicationMode(account.publication_mode), media.results, settings);
  }
  const publishAt = requireString(input.publish_at, "publish_at");
  if (!Number.isFinite(Date.parse(publishAt))) throw new AppError("publish_at must be an ISO 8601 date");
  const idempotencyKey = requireString(input.idempotency_key, "idempotency_key");
  const existing = await env.DB.prepare("SELECT id, state FROM publications WHERE idempotency_key = ?").bind(idempotencyKey).first();
  if (existing) return jsonResponse(existing);
  const id = randomId("pub");
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT INTO publications (
        id, idempotency_key, project_id, post_id, delivery_id, account_id, platform, caption,
        title, alt_text, settings_json, publish_at, state, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
    ).bind(
      id,
      idempotencyKey,
      projectId,
      requireString(input.post_id, "post_id"),
      requireString(input.delivery_id, "delivery_id"),
      accountId,
      platform,
      requireString(input.caption, "caption"),
      optionalString(input.title),
      optionalString(input.alt_text),
      JSON.stringify(settings),
      new Date(publishAt).toISOString(),
      new Date(publishAt).toISOString(),
      now,
      now,
    ),
    ...mediaIds.map((mediaId, position) => env.DB.prepare(
      "INSERT INTO publication_media (publication_id, media_id, position) VALUES (?, ?, ?)",
    ).bind(id, mediaId, position)),
  ];
  await env.DB.batch(statements);
  return jsonResponse({ id, state: "scheduled", publish_at: new Date(publishAt).toISOString() }, 201);
}

async function createAdvertisement(request: Request, env: Env): Promise<Response> {
  const input = await readJson<AdvertisementInput>(request);
  const projectId = requireString(input.project_id, "project_id");
  const connectionAccountId = requireString(input.connection_account_id, "connection_account_id");
  const provider = asAdvertisingProvider(input.provider);
  const placement = asAdvertisingPlacement(input.placement);
  if ((provider === "meta" && placement === "tiktok") || (provider === "tiktok" && placement !== "tiktok")) {
    throw new AppError("advertising placement does not match provider");
  }
  const account = await accountById(env.DB, connectionAccountId);
  const expectedAccountPlatform = provider === "meta" ? "facebook" : "tiktok";
  if (account.project_id !== projectId || account.platform !== expectedAccountPlatform) {
    throw new AppError("advertising account does not match project/provider");
  }
  if (account.connection_kind !== "advertising") {
    throw new AppError("advertising account connection is required");
  }
  const operations = asAdvertisingOperations(input.operations, provider);
  let mediaIds: string[];
  if (input.media_ids === undefined) {
    mediaIds = [];
  } else if (Array.isArray(input.media_ids)) {
    mediaIds = input.media_ids.map((value) => requireString(value, "media_ids[]"));
  } else {
    throw new AppError(ADVERTISING_MEDIA_LIST_ERROR);
  }
  if (!mediaIds.length && advertisingOperationsRequireMedia(operations)) {
    throw new AppError(ADVERTISING_MEDIA_REQUIRED_ERROR);
  }
  if (mediaIds.length) {
    const placeholders = mediaIds.map(() => "?").join(",");
    const media = await env.DB.prepare(
      `SELECT id, project_id FROM media WHERE id IN (${placeholders})`,
    ).bind(...mediaIds).all<{ id: string; project_id: string }>();
    if (media.results.length !== mediaIds.length || media.results.some((item) => item.project_id !== projectId)) {
      throw new AppError("One or more advertising media items are unknown or belong to another project");
    }
  }
  const startAt = requireString(input.start_at, "start_at");
  if (!Number.isFinite(Date.parse(startAt))) throw new AppError("start_at must be an ISO 8601 date");
  const budgetType = asBudgetType(input.budget_type);
  const budgetAmountMinor = asBudgetAmountMinor(input.budget_amount_minor);
  const currency = requireString(input.currency, "currency").toUpperCase();
  const idempotencyKey = requireString(input.idempotency_key, "idempotency_key");
  const existing = await env.DB.prepare("SELECT id, state FROM advertisements WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first();
  if (existing) return jsonResponse(existing);
  const id = randomId("adv");
  const now = new Date().toISOString();
  const normalizedStart = new Date(startAt).toISOString();
  const initialExecutionAt = initialAdvertisementExecutionAt(provider, normalizedStart, now);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO advertisements (
        id, idempotency_key, project_id, campaign_id, delivery_id, connection_account_id,
        provider, placement, advertiser_id, budget_type, budget_amount_minor, currency,
        start_at, operations_json, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      idempotencyKey,
      projectId,
      requireString(input.campaign_id, "campaign_id"),
      requireString(input.delivery_id, "delivery_id"),
      connectionAccountId,
      provider,
      placement,
      requireString(input.advertiser_id, "advertiser_id"),
      budgetType,
      budgetAmountMinor,
      currency,
      normalizedStart,
      JSON.stringify(operations),
      initialExecutionAt,
      now,
      now,
    ),
    ...mediaIds.map((mediaId, position) => env.DB.prepare(
      "INSERT INTO advertisement_media (advertisement_id, media_id, position) VALUES (?, ?, ?)",
    ).bind(id, mediaId, position)),
  ]);
  return jsonResponse({ id, state: "scheduled", start_at: normalizedStart }, 201);
}

async function getAdvertisement(env: Env, id: string): Promise<Response> {
  const advertisement = await advertisementById(env.DB, id);
  return jsonResponse({
    ...advertisement,
    operations: JSON.parse(advertisement.operations_json),
    results: JSON.parse(advertisement.results_json),
    operations_json: undefined,
    results_json: undefined,
  });
}

async function cancelAdvertisement(env: Env, id: string): Promise<Response> {
  const advertisement = await advertisementById(env.DB, id);
  if (ADVERTISEMENT_TERMINAL_STATES.has(advertisement.state)) {
    throw new AppError(`Cannot cancel ${advertisement.state} advertisement`, 409);
  }
  await env.DB.prepare("UPDATE advertisements SET state = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
  return jsonResponse({ id, state: "cancelled" });
}

async function getPublication(env: Env, id: string): Promise<Response> {
  const publication = await publicationById(env.DB, id);
  return jsonResponse({ ...publication, settings: JSON.parse(publication.settings_json), settings_json: undefined });
}

async function cancelPublication(env: Env, id: string): Promise<Response> {
  const publication = await publicationById(env.DB, id);
  if (PUBLICATION_TERMINAL_STATES.has(publication.state)) throw new AppError(`Cannot cancel ${publication.state} publication`, 409);
  await env.DB.prepare("UPDATE publications SET state = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id).run();
  return jsonResponse({ id, state: "cancelled" });
}

async function serveMedia(env: Env, id: string, token: string): Promise<Response> {
  const media = await env.DB.prepare("SELECT * FROM media WHERE id = ? AND public_token = ?").bind(id, token).first<{ object_key: string; content_type: string }>();
  if (!media) throw new AppError("Media not found", 404);
  const object = await env.MEDIA.get(media.object_key);
  if (!object || !object.body) throw new AppError("Media object not found", 404);
  return new Response(object.body, {
    headers: {
      "content-type": media.content_type,
      "content-length": String(object.size),
      "cache-control": "public, max-age=3600",
      etag: object.httpEtag,
    },
  });
}

export async function route(request: Request, env: Env): Promise<Response> {
  const parts = pathParts(request);
  if (request.method === "GET" && parts[0] === "health") return jsonResponse({ ok: true });
  if (request.method === "GET" && parts.length === 1 && parts[0] === TIKTOK_VERIFICATION_PATH) {
    return new Response(TIKTOK_VERIFICATION_CONTENT, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  }
  if (request.method === "GET" && parts.length === 1 && parts[0] === "privacy") return privacyPage();
  if (request.method === "GET" && parts.length === 1 && parts[0] === "terms") return termsPage();
  if (request.method === "GET" && parts.length === 1 && parts[0] === "data-deletion") return dataDeletionPage();
  if (request.method === "GET" && parts[0] === "media" && parts[1] && parts[2]) return serveMedia(env, parts[1], parts[2]);
  if (request.method === "GET" && parts[0] === "oauth" && parts[1] && parts[2] === "callback") {
    return completeOAuth(request, env, parts[1]);
  }
  requireAdmin(request, env.ADMIN_API_TOKEN);
  if (request.method === "PUT" && parts[0] === "v1" && parts[1] === "account-targets" && parts[2]) {
    return upsertAccountTarget(request, env, parts[2]);
  }
  if (request.method === "GET" && parts.join("/") === "v1/account-targets") return listAccountTargets(env);
  if (request.method === "POST" && parts.join("/") === "v1/connections") return upsertConnection(request, env);
  if (request.method === "POST" && parts.join("/") === "v1/oauth/start") return startOAuth(request, env);
  if (request.method === "GET" && parts.join("/") === "v1/accounts") return listAccounts(env);
  if (request.method === "POST" && parts.join("/") === "v1/media") return uploadMedia(request, env);
  if (request.method === "POST" && parts.join("/") === "v1/publications") return createPublication(request, env);
  if (request.method === "GET" && parts[0] === "v1" && parts[1] === "publications" && parts[2]) return getPublication(env, parts[2]);
  if (request.method === "POST" && parts[0] === "v1" && parts[1] === "publications" && parts[2] && parts[3] === "cancel") {
    return cancelPublication(env, parts[2]);
  }
  if (request.method === "POST" && parts.join("/") === "v1/advertisements") return createAdvertisement(request, env);
  if (request.method === "GET" && parts[0] === "v1" && parts[1] === "advertisements" && parts[2]) {
    return getAdvertisement(env, parts[2]);
  }
  if (request.method === "POST" && parts[0] === "v1" && parts[1] === "advertisements" && parts[2] && parts[3] === "cancel") {
    return cancelAdvertisement(env, parts[2]);
  }
  if (request.method === "POST" && parts.join("/") === "v1/run-due") {
    const [publications, advertisements] = await Promise.all([runDuePublications(env), runDueAdvertisements(env)]);
    return jsonResponse({ processed: { publications, advertisements } });
  }
  throw new AppError("Not found", 404);
}
