import { TIKTOK_BUSINESS_API_ROOT } from "./constants";
import { AppError, ProviderError } from "./errors";
import { providerJson, requireString } from "./http";
import type { AccountRow, TikTokPublicationMode } from "./types";

export const TIKTOK_CREATOR_INBOX_DRAFT_MODE: TikTokPublicationMode = "creator_inbox_draft";
export const TIKTOK_DIRECT_PUBLISH_MODE: TikTokPublicationMode = "direct_publish";
export const TIKTOK_CONTENT_CONNECTION = "tiktok_content_posting";
export const TIKTOK_BUSINESS_ORGANIC_CONNECTION = "tiktok_business_organic";
export const TIKTOK_CONTENT_REQUIRED_SCOPES = "user.info.basic,video.upload";
export const TIKTOK_CONTENT_OAUTH_SCOPES = "user.info.basic,user.info.profile,video.upload";
export const TIKTOK_BUSINESS_ORGANIC_SCOPES = "user.info.basic,video.publish";
export const TIKTOK_CONTENT_API_ROOT = "https://open.tiktokapis.com/v2";
export const TIKTOK_CONTENT_AUTHORIZATION_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_CONTENT_TOKEN_URL = `${TIKTOK_CONTENT_API_ROOT}/oauth/token/`;
export const TIKTOK_BUSINESS_AUTHORIZATION_URL = "https://ads.tiktok.com/marketing_api/auth";
export const TIKTOK_BUSINESS_TOKEN_URL = `${TIKTOK_BUSINESS_API_ROOT}/tt_user/oauth2/token/`;
export const TIKTOK_BUSINESS_REFRESH_URL = `${TIKTOK_BUSINESS_API_ROOT}/tt_user/oauth2/refresh_token/`;
export const TIKTOK_ACCESS_TOKEN_HEADER = "Access-Token";

const TIKTOK_CONTENT_USER_INFO_URL = `${TIKTOK_CONTENT_API_ROOT}/user/info/`;
const TIKTOK_BUSINESS_PROFILE_PATH = "/business/get/";
const TIKTOK_BUSINESS_SETTINGS_PATH = "/business/video/settings/";
const TIKTOK_MAX_PHOTOS = 35;
const TIKTOK_MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const TIKTOK_PHOTO_TYPES = new Set(["image/jpeg", "image/webp"]);
const TIKTOK_USER_FIELDS = ["open_id", "display_name", "username"];
const TIKTOK_CONTENT_SUCCESS_CODE = "ok";

export interface TikTokContentTokenBundle {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type?: string;
}

export interface TikTokBusinessTokenBundle {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string | string[];
  open_id: string;
}

export interface TikTokContentEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

export interface TikTokBusinessEnvelope<T> {
  code: number;
  message?: string;
  request_id?: string;
  data?: T;
}

export interface TikTokBusinessSettings {
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

interface TikTokMediaInput {
  kind: string;
  content_type: string;
  size_bytes: number;
}

function normalizedIdentity(value: string): string {
  return value.trim().replace(/^@/, "").toLocaleLowerCase();
}

export function asTikTokPublicationMode(value: unknown): TikTokPublicationMode {
  if (value === TIKTOK_CREATOR_INBOX_DRAFT_MODE || value === TIKTOK_DIRECT_PUBLISH_MODE) {
    return value as TikTokPublicationMode;
  }
  throw new AppError("TikTok publication_mode is required and invalid");
}

export function normalizeTikTokScopes(value: string | string[]): string {
  const values = Array.isArray(value) ? value : value.split(/[\s,]+/);
  return [...new Set(values.map((scope) => scope.trim()).filter(Boolean))].join(",");
}

function requireScopes(value: string | string[], requiredScopes: string, contract: string): string {
  const normalized = normalizeTikTokScopes(value);
  const granted = new Set(normalized.split(",").filter(Boolean));
  const missing = requiredScopes.split(",").filter((scope) => !granted.has(scope));
  if (missing.length) throw new AppError(`${contract} authorization is missing scopes: ${missing.join(", ")}`, 403);
  return normalized;
}

export function requireTikTokContentScopes(value: string): string {
  return requireScopes(value, TIKTOK_CONTENT_REQUIRED_SCOPES, "TikTok Content Posting");
}

export function requireTikTokContentOAuthScopes(value: string): string {
  return requireScopes(value, TIKTOK_CONTENT_OAUTH_SCOPES, "TikTok Content Posting");
}

export function requireTikTokBusinessOrganicScopes(value: string | string[]): string {
  return requireScopes(value, TIKTOK_BUSINESS_ORGANIC_SCOPES, "TikTok Business Organic");
}

export function requireTikTokContentData<T>(response: TikTokContentEnvelope<T>, operation: string): T {
  if (response.error?.code !== TIKTOK_CONTENT_SUCCESS_CODE || !response.data) {
    throw new ProviderError(
      `TikTok Content Posting ${operation} ${response.error?.code ?? "unknown_error"}: ${response.error?.message ?? "unknown error"}`,
    );
  }
  return response.data;
}

export function requireTikTokBusinessData<T>(response: TikTokBusinessEnvelope<T>, operation: string): T {
  if (response.code !== 0 || !response.data) {
    throw new ProviderError(`TikTok Business ${operation} ${response.code}: ${response.message ?? "unknown error"}`);
  }
  return response.data;
}

export function requireTikTokOrganicAccount(account: AccountRow): { mode: TikTokPublicationMode; username: string } {
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(account.metadata_json) as Record<string, unknown>;
  } catch {
    throw new AppError(`TikTok account ${account.id} has invalid connection metadata`, 409);
  }
  const mode = account.publication_mode;
  if (account.connection_kind !== "organic" || !mode || metadata.publish_mode !== mode) {
    throw new AppError(`TikTok account ${account.id} has an invalid publication mode contract`, 409);
  }
  if (mode === TIKTOK_CREATOR_INBOX_DRAFT_MODE) {
    if (metadata.oauth !== TIKTOK_CONTENT_CONNECTION) {
      throw new AppError(`TikTok account ${account.id} must use Content Posting for creator-inbox drafts`, 409);
    }
    requireTikTokContentScopes(account.scopes);
  } else if (mode === TIKTOK_DIRECT_PUBLISH_MODE) {
    if (metadata.oauth !== TIKTOK_BUSINESS_ORGANIC_CONNECTION) {
      throw new AppError(`TikTok account ${account.id} must use Business Organic for direct publishing`, 409);
    }
    requireTikTokBusinessOrganicScopes(account.scopes);
  } else {
    throw new AppError(`TikTok account ${account.id} has an unsupported publication mode`, 409);
  }
  return { mode, username: requireString(metadata.username, "TikTok verified username") };
}

export async function verifyTikTokContentIdentity(
  accessToken: string,
  openId: string,
  expectedIdentity: string,
): Promise<{ username: string; displayName: string | null }> {
  const url = new URL(TIKTOK_CONTENT_USER_INFO_URL);
  url.search = new URLSearchParams({ fields: TIKTOK_USER_FIELDS.join(",") }).toString();
  const response = await providerJson<TikTokContentEnvelope<{ user?: Record<string, unknown> }>>(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = requireTikTokContentData(response, "identity").user;
  const observedOpenId = requireString(user?.open_id, "TikTok open_id");
  if (observedOpenId !== openId) throw new AppError("TikTok identity response does not match the token open_id", 403);
  const username = requireString(user?.username, "TikTok username");
  if (normalizedIdentity(username) !== normalizedIdentity(expectedIdentity)) {
    throw new AppError(`The authorized TikTok username does not match ${expectedIdentity}`, 403);
  }
  const displayName = typeof user?.display_name === "string" && user.display_name.trim()
    ? user.display_name.trim()
    : null;
  return { username, displayName };
}

export async function verifyTikTokBusinessIdentity(
  accessToken: string,
  openId: string,
  expectedIdentity: string,
): Promise<{ username: string; displayName: string | null }> {
  const url = new URL(`${TIKTOK_BUSINESS_API_ROOT}${TIKTOK_BUSINESS_PROFILE_PATH}`);
  url.search = new URLSearchParams({
    business_id: openId,
    fields: JSON.stringify(["display_name", "username"]),
  }).toString();
  const response = await providerJson<TikTokBusinessEnvelope<{ display_name?: string; username?: string }>>(
    url.toString(),
    { method: "GET", headers: { [TIKTOK_ACCESS_TOKEN_HEADER]: accessToken } },
  );
  const profile = requireTikTokBusinessData(response, "profile");
  const username = requireString(profile.username, "TikTok username");
  if (normalizedIdentity(username) !== normalizedIdentity(expectedIdentity)) {
    throw new AppError(`The authorized TikTok username does not match ${expectedIdentity}`, 403);
  }
  const displayName = typeof profile.display_name === "string" && profile.display_name.trim()
    ? profile.display_name.trim()
    : null;
  return { username, displayName };
}

export async function fetchTikTokBusinessSettings(
  accessToken: string,
  openId: string,
): Promise<TikTokBusinessSettings> {
  const url = new URL(`${TIKTOK_BUSINESS_API_ROOT}${TIKTOK_BUSINESS_SETTINGS_PATH}`);
  url.search = new URLSearchParams({ business_id: openId }).toString();
  const response = await providerJson<TikTokBusinessEnvelope<TikTokBusinessSettings>>(url.toString(), {
    method: "GET",
    headers: { [TIKTOK_ACCESS_TOKEN_HEADER]: accessToken },
  });
  return requireTikTokBusinessData(response, "settings");
}

export function validateTikTokBusinessSettings(requested: Record<string, unknown>, available: TikTokBusinessSettings): void {
  const privacyLevel = requireString(requested.privacy_level, "TikTok settings.privacy_level");
  if (!Array.isArray(available.privacy_level_options) || !available.privacy_level_options.includes(privacyLevel)) {
    throw new AppError(`TikTok privacy level is not available for this account: ${privacyLevel}`, 409);
  }
  const restrictions = [
    ["comment_disabled", "disable_comment"],
    ["duet_disabled", "disable_duet"],
    ["stitch_disabled", "disable_stitch"],
  ] as const;
  for (const [providerFlag, requestFlag] of restrictions) {
    if (available[providerFlag] === true && requested[requestFlag] !== true) {
      throw new AppError(`TikTok requires settings.${requestFlag}=true for this account`, 409);
    }
  }
}

export function validateTikTokPublicationInput(
  mode: TikTokPublicationMode,
  media: TikTokMediaInput[],
  settings: Record<string, unknown>,
): void {
  const videos = media.filter((item) => item.kind === "video");
  const images = media.filter((item) => item.kind === "image");
  const isSingleVideo = media.length === 1 && videos.length === 1;
  const isPhotoCarousel = media.length >= 1 && media.length <= TIKTOK_MAX_PHOTOS && images.length === media.length;
  if (!isSingleVideo && !isPhotoCarousel) {
    throw new AppError("TikTok accepts exactly one video or a carousel of 1 to 35 photos");
  }
  if (isPhotoCarousel && images.some((item) => !TIKTOK_PHOTO_TYPES.has(item.content_type))) {
    throw new AppError("TikTok photos must be JPEG or WebP");
  }
  if (isPhotoCarousel && images.some((item) => item.size_bytes > TIKTOK_MAX_PHOTO_BYTES)) {
    throw new AppError("TikTok photos must not exceed 20 MiB each");
  }
  if (mode === TIKTOK_DIRECT_PUBLISH_MODE) requireString(settings.privacy_level, "TikTok settings.privacy_level");
}
