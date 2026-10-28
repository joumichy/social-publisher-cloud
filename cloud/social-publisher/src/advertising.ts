import { AD_OPERATION_RETRY_SECONDS, DEFAULT_RETRY_SECONDS, MAX_ERROR_LENGTH, META_API_ROOT, TIKTOK_BUSINESS_API_ROOT } from "./constants";
import { AppError, ProviderError } from "./errors";
import { providerJson } from "./http";
import { accountById, advertisementMedia, claimAdvertisement, dueAdvertisements } from "./repository";
import { accessTokenFor } from "./tokens";
import type {
  AdvertisementRow,
  AdvertisingOperation,
  AdvertisingOperationType,
  AdvertisingProvider,
  Env,
  MediaRow,
} from "./types";

const META_PROVIDER = "meta";
const TIKTOK_PROVIDER = "tiktok";
const FACEBOOK_PLATFORM = "facebook";
const TIKTOK_PLATFORM = "tiktok";
export const ADVERTISING_MEDIA_URL_PLACEHOLDER = "$media_url";
const JSON_RESULT_KEY = "$result";
const JSON_BUDGET_MINOR_KEY = "$budget_minor";
const JSON_BUDGET_MAJOR_KEY = "$budget_major";
const META_CAMPAIGN_UPDATE_OPERATION = "meta.campaign.update";
const META_ADSET_CREATE_OPERATION = "meta.adset.create";
const META_ADSET_START_TIME_FIELD = "start_time";
const META_PAGE_LIST_OPERATION = "meta.page.list";
const META_ASSET_LIST_OPERATION = "meta.asset.list";
const META_AD_ACCOUNT_ASSET_LIST_OPERATION = "meta.adaccount.asset.list";
const META_NODE_ID_KEY = "$node_id";
const META_BUSINESS_ID_KEY = "business_id";
const META_ASSET_TYPE_KEY = "asset_type";
const META_ACCESS_TOKEN_FIELD = "access_token";
const META_PAGE_FIELDS = "id,name,instagram_business_account{id,username},connected_instagram_account{id,username}";
const META_INSTAGRAM_FIELDS = "id,username";
const META_ASSET_TYPES = new Set([
  "owned_pages",
  "client_pages",
  "instagram_accounts",
  "client_instagram_assets",
]);
const META_AD_ACCOUNT_ASSET_TYPES = new Set([
  "promote_pages",
  "instagram_accounts",
  "connected_instagram_accounts",
  "connected_instagram_accounts_with_iabp",
]);
const TIKTOK_ACCESS_TOKEN_HEADER = "Access-Token";
const CONTENT_TYPE_HEADER = "content-type";
const JSON_CONTENT_TYPE = "application/json";
const META_OPERATION_PATHS: Record<string, string> = {
  "meta.video.upload": "advideos",
  "meta.campaign.create": "campaigns",
  "meta.adset.create": "adsets",
  "meta.creative.create": "adcreatives",
  "meta.ad.create": "ads",
};
const TIKTOK_OPERATION_PATHS: Record<string, string> = {
  "tiktok.video.upload": "/file/video/ad/upload/",
  "tiktok.campaign.create": "/campaign/create/",
  "tiktok.adgroup.create": "/adgroup/create/",
  "tiktok.ad.create": "/ad/create/",
};

interface ResultReference {
  operation: string;
  path: string;
}

interface TikTokResponse {
  code: number;
  message?: string;
  data?: Record<string, unknown>;
}

type OperationResults = Record<string, unknown>;

export function initialAdvertisementExecutionAt(
  provider: AdvertisingProvider,
  startAt: string,
  submittedAt: string,
): string {
  return provider === META_PROVIDER ? submittedAt : startAt;
}

export function canonicalMetaOperationBody(
  operationType: AdvertisingOperationType,
  body: Record<string, unknown>,
  startAt: string,
): Record<string, unknown> {
  if (operationType !== META_ADSET_CREATE_OPERATION) return body;
  return { ...body, [META_ADSET_START_TIME_FIELD]: startAt };
}

function publicMediaUrl(env: Env, media: MediaRow): string {
  return `${env.PUBLIC_BASE_URL}/media/${media.id}/${media.public_token}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsMediaUrlPlaceholder(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsMediaUrlPlaceholder);
  if (!isPlainObject(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, ADVERTISING_MEDIA_URL_PLACEHOLDER)) return true;
  return Object.values(value).some(containsMediaUrlPlaceholder);
}

export function advertisingOperationsRequireMedia(operations: AdvertisingOperation[]): boolean {
  return operations.some((operation) => containsMediaUrlPlaceholder(operation.body));
}

function resultAt(results: OperationResults, reference: ResultReference): unknown {
  let value: unknown = results[reference.operation];
  for (const segment of reference.path.split(".")) {
    if (!isPlainObject(value) || !(segment in value)) {
      throw new ProviderError(`Advertising result is missing ${reference.operation}.${reference.path}`);
    }
    value = value[segment];
  }
  return value;
}

function resolveValue(
  value: unknown,
  env: Env,
  advertisement: AdvertisementRow,
  media: MediaRow[],
  results: OperationResults,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, env, advertisement, media, results));
  }
  if (!isPlainObject(value)) return value;
  if (Object.keys(value).length === 1 && ADVERTISING_MEDIA_URL_PLACEHOLDER in value) {
    const index = value[ADVERTISING_MEDIA_URL_PLACEHOLDER];
    if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= media.length) {
      throw new ProviderError("Advertising media placeholder is invalid");
    }
    return publicMediaUrl(env, media[Number(index)] as MediaRow);
  }
  if (Object.keys(value).length === 1 && JSON_RESULT_KEY in value) {
    const reference = value[JSON_RESULT_KEY];
    if (!isPlainObject(reference) || typeof reference.operation !== "string" || typeof reference.path !== "string") {
      throw new ProviderError("Advertising result placeholder is invalid");
    }
    return resultAt(results, reference as unknown as ResultReference);
  }
  if (Object.keys(value).length === 1 && JSON_BUDGET_MINOR_KEY in value) {
    return advertisement.budget_amount_minor;
  }
  if (Object.keys(value).length === 1 && JSON_BUDGET_MAJOR_KEY in value) {
    return advertisement.budget_amount_minor / 100;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      resolveValue(item, env, advertisement, media, results),
    ]),
  );
}

function metaBody(body: Record<string, unknown>, accessToken: string): URLSearchParams {
  const values = new URLSearchParams({ [META_ACCESS_TOKEN_FIELD]: accessToken });
  for (const [key, value] of Object.entries(body)) {
    values.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return values;
}

async function executeMetaOperation(
  env: Env,
  advertisement: AdvertisementRow,
  operation: AdvertisingOperation,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<unknown> {
  const advertiserId = advertisement.advertiser_id.replace(/^act_/, "");
  if (operation.type === META_PAGE_LIST_OPERATION) {
    const businessId = body[META_BUSINESS_ID_KEY];
    if (businessId !== undefined && typeof businessId !== "string" && typeof businessId !== "number") {
      throw new ProviderError("Meta page discovery requires a valid business id");
    }
    const query = new URLSearchParams({
      [META_ACCESS_TOKEN_FIELD]: accessToken,
      fields: META_PAGE_FIELDS,
    });
    const owner = businessId === undefined ? "me/accounts" : `${businessId}/owned_pages`;
    const url = `${META_API_ROOT}/${env.META_GRAPH_VERSION}/${owner}?${query}`;
    return providerJson<unknown>(url, { method: "GET" });
  }
  if (operation.type === META_ASSET_LIST_OPERATION) {
    const businessId = body[META_BUSINESS_ID_KEY];
    const assetType = body[META_ASSET_TYPE_KEY];
    if ((typeof businessId !== "string" && typeof businessId !== "number") || !String(businessId).trim()) {
      throw new ProviderError("Meta asset discovery requires a valid business id");
    }
    if (typeof assetType !== "string" || !META_ASSET_TYPES.has(assetType)) {
      throw new ProviderError("Meta asset discovery requires a supported asset type");
    }
    const isInstagramAsset = assetType === "instagram_accounts" || assetType === "client_instagram_assets";
    const query = new URLSearchParams({
      [META_ACCESS_TOKEN_FIELD]: accessToken,
      fields: isInstagramAsset ? META_INSTAGRAM_FIELDS : META_PAGE_FIELDS,
    });
    const url = `${META_API_ROOT}/${env.META_GRAPH_VERSION}/${businessId}/${assetType}?${query}`;
    return providerJson<unknown>(url, { method: "GET" });
  }
  if (operation.type === META_AD_ACCOUNT_ASSET_LIST_OPERATION) {
    const assetType = body[META_ASSET_TYPE_KEY];
    if (typeof assetType !== "string" || !META_AD_ACCOUNT_ASSET_TYPES.has(assetType)) {
      throw new ProviderError("Meta ad account asset discovery requires a supported asset type");
    }
    const query = new URLSearchParams({
      [META_ACCESS_TOKEN_FIELD]: accessToken,
      fields: assetType === "promote_pages" ? META_PAGE_FIELDS : META_INSTAGRAM_FIELDS,
    });
    const url = `${META_API_ROOT}/${env.META_GRAPH_VERSION}/act_${advertiserId}/${assetType}?${query}`;
    return providerJson<unknown>(url, { method: "GET" });
  }
  if (operation.type === META_CAMPAIGN_UPDATE_OPERATION) {
    const nodeId = body[META_NODE_ID_KEY];
    if (typeof nodeId !== "string" && typeof nodeId !== "number") {
      throw new ProviderError("Meta campaign update requires a node id");
    }
    const updateBody = { ...body };
    delete updateBody[META_NODE_ID_KEY];
    const url = `${META_API_ROOT}/${env.META_GRAPH_VERSION}/${nodeId}`;
    return providerJson<unknown>(url, { method: "POST", body: metaBody(updateBody, accessToken) });
  }
  const resource = META_OPERATION_PATHS[operation.type];
  if (!resource) throw new ProviderError(`Unsupported Meta advertising operation: ${operation.type}`);
  const url = `${META_API_ROOT}/${env.META_GRAPH_VERSION}/act_${advertiserId}/${resource}`;
  const canonicalBody = canonicalMetaOperationBody(operation.type, body, advertisement.start_at);
  return providerJson<unknown>(url, { method: "POST", body: metaBody(canonicalBody, accessToken) });
}

async function executeTikTokOperation(
  advertisement: AdvertisementRow,
  operation: AdvertisingOperation,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<unknown> {
  const path = TIKTOK_OPERATION_PATHS[operation.type];
  if (!path) throw new ProviderError(`Unsupported TikTok advertising operation: ${operation.type}`);
  const response = await providerJson<TikTokResponse>(`${TIKTOK_BUSINESS_API_ROOT}${path}`, {
    method: "POST",
    headers: { [TIKTOK_ACCESS_TOKEN_HEADER]: accessToken, [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
    body: JSON.stringify({ advertiser_id: advertisement.advertiser_id, ...body }),
  });
  if (response.code !== 0) {
    throw new ProviderError(`TikTok Business ${response.code}: ${response.message ?? "unknown error"}`);
  }
  return response;
}

function parseOperations(advertisement: AdvertisementRow): AdvertisingOperation[] {
  const operations = JSON.parse(advertisement.operations_json) as unknown;
  if (!Array.isArray(operations)) throw new AppError("Advertising operations are invalid", 500);
  return operations as AdvertisingOperation[];
}

function parseResults(advertisement: AdvertisementRow): OperationResults {
  const results = JSON.parse(advertisement.results_json) as unknown;
  if (!isPlainObject(results)) throw new AppError("Advertising results are invalid", 500);
  return results;
}

function retryAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function providerReference(result: unknown): string | null {
  if (!isPlainObject(result)) return null;
  const data = isPlainObject(result.data) ? result.data : result;
  const candidates = [data.ad_id, data.creative_id, data.campaign_id, data.adgroup_id, data.video_id, data.id];
  const reference = candidates.find((candidate) => typeof candidate === "string" || typeof candidate === "number");
  return reference === undefined ? null : String(reference);
}

async function completeOperation(
  env: Env,
  advertisement: AdvertisementRow,
  operation: AdvertisingOperation,
  result: unknown,
  operationCount: number,
): Promise<void> {
  const results = parseResults(advertisement);
  results[operation.id] = result;
  const nextOperation = advertisement.current_operation + 1;
  const done = nextOperation >= operationCount;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE advertisements SET results_json = ?, current_operation = ?, state = ?,
     provider_reference = COALESCE(?, provider_reference), last_error = NULL,
     next_attempt_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    JSON.stringify(results),
    nextOperation,
    done ? "submitted" : "processing",
    providerReference(result),
    done ? now : retryAt(AD_OPERATION_RETRY_SECONDS),
    now,
    advertisement.id,
  ).run();
}

async function failOperation(env: Env, advertisement: AdvertisementRow, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
  const retryable = error instanceof AppError && error.retryable;
  const maxAttempts = Number(env.MAX_ATTEMPTS);
  const state = retryable && advertisement.attempts + 1 < maxAttempts ? "retry" : "failed";
  await env.DB.prepare(
    "UPDATE advertisements SET state = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?",
  ).bind(state, message, state === "retry" ? retryAt(DEFAULT_RETRY_SECONDS) : now, now, advertisement.id).run();
}

export async function executeAdvertisement(env: Env, advertisement: AdvertisementRow): Promise<void> {
  const now = new Date().toISOString();
  if (!(await claimAdvertisement(env.DB, advertisement, now))) return;
  try {
    const operations = parseOperations(advertisement);
    const operation = operations[advertisement.current_operation];
    if (!operation) throw new AppError("Advertising operation is missing", 500);
    const [account, media] = await Promise.all([
      accountById(env.DB, advertisement.connection_account_id),
      advertisementMedia(env.DB, advertisement.id),
    ]);
    if (account.project_id !== advertisement.project_id) {
      throw new AppError("Advertising account does not match project", 409);
    }
    const expectedPlatform = advertisement.provider === META_PROVIDER ? FACEBOOK_PLATFORM : TIKTOK_PLATFORM;
    if (account.platform !== expectedPlatform) {
      throw new AppError("Advertising account does not match provider", 409);
    }
    const accessToken = await accessTokenFor(env, account);
    const resolved = resolveValue(operation.body, env, advertisement, media, parseResults(advertisement));
    if (!isPlainObject(resolved)) throw new AppError("Advertising operation body is invalid", 500);
    const result = advertisement.provider === META_PROVIDER
      ? await executeMetaOperation(env, advertisement, operation, resolved, accessToken)
      : await executeTikTokOperation(advertisement, operation, resolved, accessToken);
    await completeOperation(env, advertisement, operation, result, operations.length);
  } catch (error) {
    await failOperation(env, advertisement, error);
  }
}

export async function runDueAdvertisements(env: Env): Promise<number> {
  const due = await dueAdvertisements(env.DB, new Date().toISOString());
  await Promise.all(due.map((advertisement) => executeAdvertisement(env, advertisement)));
  return due.length;
}

export function operationMatchesProvider(type: AdvertisingOperationType, provider: string): boolean {
  return type.startsWith(`${provider}.`);
}
