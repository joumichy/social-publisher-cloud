export type Platform = "facebook" | "instagram" | "linkedin" | "tiktok";
export type AdvertisingProvider = "meta" | "tiktok";
export type AdvertisingPlacement = "facebook" | "instagram" | "tiktok";
export type ConnectionKind = "organic" | "advertising";
export type TikTokPublicationMode = "creator_inbox_draft" | "direct_publish";
export type MediaKind = "image" | "video" | "document";
export const PUBLICATION_AWAITING_CREATOR_STATE = "awaiting_creator" as const;
export type PublicationState =
  | "scheduled"
  | "publishing"
  | "processing"
  | typeof PUBLICATION_AWAITING_CREATOR_STATE
  | "published"
  | "retry"
  | "failed"
  | "cancelled";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ADMIN_API_TOKEN: string;
  TOKEN_ENCRYPTION_KEY: string;
  PUBLIC_BASE_URL: string;
  META_GRAPH_VERSION: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  LINKEDIN_VERSION: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  MEDIA_RETENTION_DAYS: string;
  MAX_ATTEMPTS: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_BUSINESS_CLIENT_ID?: string;
  TIKTOK_BUSINESS_CLIENT_SECRET?: string;
  TIKTOK_BUSINESS_AUTHORIZATION_URL?: string;
}

export interface AccountRow {
  id: string;
  project_id: string;
  platform: Platform;
  connection_kind: ConnectionKind;
  publication_mode: TikTokPublicationMode | null;
  provider_subject: string;
  display_name: string;
  connection_status: "ready" | "expired" | "revoked";
  access_token_ciphertext: string;
  access_token_iv: string;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  scopes: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface AccountTargetRow {
  id: string;
  project_id: string;
  platform: Platform;
  connection_kind: ConnectionKind;
  publication_mode: TikTokPublicationMode | null;
  provider_subject: string | null;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface MediaRow {
  id: string;
  project_id: string;
  object_key: string;
  public_token: string;
  filename: string;
  content_type: string;
  kind: MediaKind;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export interface PublicationRow {
  id: string;
  idempotency_key: string;
  project_id: string;
  post_id: string;
  delivery_id: string;
  account_id: string;
  platform: Platform;
  caption: string;
  title: string | null;
  alt_text: string | null;
  settings_json: string;
  publish_at: string;
  state: PublicationState;
  attempts: number;
  next_attempt_at: string;
  provider_reference: string | null;
  provider_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type AdvertisingState =
  | "scheduled"
  | "executing"
  | "processing"
  | "submitted"
  | "retry"
  | "failed"
  | "cancelled";

export type AdvertisingOperationType =
  | "meta.video.upload"
  | "meta.campaign.create"
  | "meta.campaign.update"
  | "meta.page.list"
  | "meta.asset.list"
  | "meta.adaccount.asset.list"
  | "meta.adset.create"
  | "meta.creative.create"
  | "meta.ad.create"
  | "tiktok.video.upload"
  | "tiktok.campaign.create"
  | "tiktok.adgroup.create"
  | "tiktok.ad.create";

export interface AdvertisingOperation {
  id: string;
  type: AdvertisingOperationType;
  body: Record<string, unknown>;
}

export interface AdvertisementRow {
  id: string;
  idempotency_key: string;
  project_id: string;
  campaign_id: string;
  delivery_id: string;
  connection_account_id: string;
  provider: AdvertisingProvider;
  placement: AdvertisingPlacement;
  advertiser_id: string;
  budget_type: "daily" | "lifetime";
  budget_amount_minor: number;
  currency: string;
  start_at: string;
  operations_json: string;
  results_json: string;
  current_operation: number;
  state: AdvertisingState;
  attempts: number;
  next_attempt_at: string;
  provider_reference: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderContext {
  env: Env;
  account: AccountRow;
  publication: PublicationRow;
  media: MediaRow[];
  accessToken: string;
  settings: Record<string, unknown>;
}

export interface ProviderResult {
  state: "processing" | typeof PUBLICATION_AWAITING_CREATOR_STATE | "published";
  reference: string;
  url?: string;
  retryAfterSeconds?: number;
}
