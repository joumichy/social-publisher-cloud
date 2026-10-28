import { PUBLICATION_AWAITING_CREATOR_STATE } from "./types";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const AUTH_SCHEME = "Bearer ";
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const DUE_BATCH_SIZE = 20;
export const CLAIM_TIMEOUT_MINUTES = 15;
export const DEFAULT_RETRY_SECONDS = 60;
export const PROCESSING_RETRY_SECONDS = 30;
export const MAX_ERROR_LENGTH = 2000;
export const AES_ALGORITHM = "AES-GCM";
export const AES_KEY_BITS = 256;
export const AES_IV_BYTES = 12;
export const META_API_ROOT = "https://graph.facebook.com";
export const LINKEDIN_API_ROOT = "https://api.linkedin.com/rest";
export const LINKEDIN_PROTOCOL_VERSION = "2.0.0";
export const TIKTOK_BUSINESS_API_ROOT = "https://business-api.tiktok.com/open_api/v1.3";
export const PUBLICATION_TERMINAL_STATES = new Set([
  PUBLICATION_AWAITING_CREATOR_STATE,
  "published",
  "failed",
  "cancelled",
]);
export const ADVERTISEMENT_TERMINAL_STATES = new Set(["submitted", "failed", "cancelled"]);
export const MAX_AD_OPERATIONS = 12;
export const AD_OPERATION_RETRY_SECONDS = 5;
export const ALLOWED_MEDIA_TYPES = new Map<string, "image" | "video" | "document">([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["video/mp4", "video"],
  ["video/quicktime", "video"],
  ["video/webm", "video"],
  ["application/pdf", "document"],
]);
