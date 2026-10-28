import {
  AUTH_SCHEME,
  JSON_CONTENT_TYPE,
  PROCESSING_RETRY_SECONDS,
  TIKTOK_BUSINESS_API_ROOT,
} from "../constants";
import { AppError, ProviderError } from "../errors";
import { providerJson } from "../http";
import {
  fetchTikTokBusinessSettings,
  requireTikTokContentData,
  requireTikTokOrganicAccount,
  TIKTOK_ACCESS_TOKEN_HEADER,
  TIKTOK_CONTENT_API_ROOT,
  TIKTOK_CREATOR_INBOX_DRAFT_MODE,
  validateTikTokBusinessSettings,
  type TikTokContentEnvelope,
} from "../tiktok-organic";
import { PUBLICATION_AWAITING_CREATOR_STATE, type ProviderContext, type ProviderResult } from "../types";

const TIKTOK_STATUS_PUBLISH_COMPLETE = "PUBLISH_COMPLETE";
const TIKTOK_STATUS_FAILED = "FAILED";
const TIKTOK_BUSINESS_VIDEO_PATH = "/business/video/publish/";
const TIKTOK_BUSINESS_PHOTO_PATH = "/business/photo/publish/";
const TIKTOK_BUSINESS_STATUS_PATH = "/business/publish/status/";
const TIKTOK_VIDEO_DRAFT_PATH = "/post/publish/inbox/video/init/";
const TIKTOK_CONTENT_DRAFT_PATH = "/post/publish/content/init/";
const TIKTOK_CONTENT_STATUS_PATH = "/post/publish/status/fetch/";
const TIKTOK_PULL_FROM_URL = "PULL_FROM_URL";
const TIKTOK_MEDIA_UPLOAD_MODE = "MEDIA_UPLOAD";
const TIKTOK_PHOTO_MEDIA_TYPE = "PHOTO";
const TIKTOK_STATUS_INBOX_DELIVERED = "SEND_TO_USER_INBOX";
const CONTENT_TYPE_HEADER = "content-type";
const RETRYABLE_FAILURE_REASONS = new Set(["internal", "video_pull_failed", "photo_pull_failed"]);

interface TikTokBusinessResponse {
  code: number;
  message?: string;
  request_id?: string;
  data?: {
    share_id?: string;
    status?: string;
    post_ids?: string[];
    reason?: string;
  };
}

interface TikTokContentStatus {
  publish_id?: string;
  status?: string;
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
}

function mediaUrl(context: ProviderContext, index: number): string {
  const item = context.media[index];
  if (!item) throw new ProviderError("TikTok publication has no media");
  const url = new URL(`/media/${item.id}/${item.public_token}`, context.env.PUBLIC_BASE_URL);
  if (url.protocol !== "https:") throw new AppError("TikTok media URLs must use a verified HTTPS property", 500);
  return url.toString();
}

function ensureBusinessSuccess(response: TikTokBusinessResponse): TikTokBusinessResponse {
  if (response.code !== 0) {
    throw new ProviderError(`TikTok Business ${response.code}: ${response.message ?? "unknown error"}`);
  }
  return response;
}

async function businessPost(context: ProviderContext, path: string, body: unknown): Promise<TikTokBusinessResponse> {
  return ensureBusinessSuccess(await providerJson<TikTokBusinessResponse>(`${TIKTOK_BUSINESS_API_ROOT}${path}`, {
    method: "POST",
    headers: {
      [TIKTOK_ACCESS_TOKEN_HEADER]: context.accessToken,
      [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
    },
    body: JSON.stringify(body),
  }));
}

async function contentPost(context: ProviderContext, path: string, body: unknown): Promise<TikTokContentStatus> {
  const response = await providerJson<TikTokContentEnvelope<TikTokContentStatus>>(
    `${TIKTOK_CONTENT_API_ROOT}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `${AUTH_SCHEME}${context.accessToken}`,
        [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
      },
      body: JSON.stringify(body),
    },
  );
  return requireTikTokContentData(response, "publish");
}

async function checkBusinessStatus(context: ProviderContext, publishId: string): Promise<ProviderResult> {
  const url = new URL(`${TIKTOK_BUSINESS_API_ROOT}${TIKTOK_BUSINESS_STATUS_PATH}`);
  url.search = new URLSearchParams({ business_id: context.account.provider_subject, publish_id: publishId }).toString();
  const response = ensureBusinessSuccess(await providerJson<TikTokBusinessResponse>(url.toString(), {
    method: "GET",
    headers: { [TIKTOK_ACCESS_TOKEN_HEADER]: context.accessToken },
  }));
  const status = response.data?.status;
  if (status === TIKTOK_STATUS_PUBLISH_COMPLETE) {
    const postId = response.data?.post_ids?.[0];
    if (!postId) return { state: "processing", reference: publishId, retryAfterSeconds: PROCESSING_RETRY_SECONDS };
    const { username } = requireTikTokOrganicAccount(context.account);
    return { state: "published", reference: postId, url: `https://www.tiktok.com/@${username}/video/${postId}` };
  }
  if (status === TIKTOK_STATUS_FAILED) {
    const reason = response.data?.reason ?? publishId;
    throw new ProviderError(`TikTok processing failed: ${reason}`, 502, RETRYABLE_FAILURE_REASONS.has(reason));
  }
  return { state: "processing", reference: publishId, retryAfterSeconds: PROCESSING_RETRY_SECONDS };
}

async function checkContentStatus(context: ProviderContext, publishId: string): Promise<ProviderResult> {
  const data = await contentPost(context, TIKTOK_CONTENT_STATUS_PATH, { publish_id: publishId });
  if (data.status === TIKTOK_STATUS_PUBLISH_COMPLETE) {
    const postId = data.publicaly_available_post_id?.[0];
    if (postId === undefined) {
      return { state: PUBLICATION_AWAITING_CREATOR_STATE, reference: publishId };
    }
    return { state: "published", reference: String(postId) };
  }
  if (data.status === TIKTOK_STATUS_FAILED) {
    throw new ProviderError(`TikTok draft failed: ${data.fail_reason ?? publishId}`);
  }
  if (data.status === TIKTOK_STATUS_INBOX_DELIVERED) {
    return { state: PUBLICATION_AWAITING_CREATOR_STATE, reference: publishId };
  }
  return {
    state: "processing",
    reference: publishId,
    retryAfterSeconds: PROCESSING_RETRY_SECONDS,
  };
}

export function organicPostInfo(context: ProviderContext): Record<string, unknown> {
  return {
    privacy_level: context.settings.privacy_level,
    caption: context.publication.caption,
    disable_comment: Boolean(context.settings.disable_comment),
    disable_duet: Boolean(context.settings.disable_duet),
    disable_stitch: Boolean(context.settings.disable_stitch),
    is_brand_organic: Boolean(context.settings.brand_organic_toggle),
    is_branded_content: Boolean(context.settings.brand_content_toggle),
    is_ai_generated: Boolean(context.settings.is_aigc),
  };
}

async function publishTikTokBusiness(context: ProviderContext): Promise<ProviderResult> {
  const first = context.media[0];
  if (!first) throw new ProviderError("TikTok publication has no media");
  const settings = await fetchTikTokBusinessSettings(context.accessToken, context.account.provider_subject);
  validateTikTokBusinessSettings(context.settings, settings);
  const response = first.kind === "video"
    ? await businessPost(context, TIKTOK_BUSINESS_VIDEO_PATH, {
        business_id: context.account.provider_subject,
        video_url: mediaUrl(context, 0),
        post_info: organicPostInfo(context),
      })
    : await businessPost(context, TIKTOK_BUSINESS_PHOTO_PATH, {
        business_id: context.account.provider_subject,
        photo_images: context.media.map((_, index) => mediaUrl(context, index)),
        photo_cover_index: Number(context.settings.photo_cover_index ?? 0),
        post_info: {
          title: context.publication.title ?? undefined,
          caption: context.publication.caption,
          privacy_level: context.settings.privacy_level,
          disable_comment: Boolean(context.settings.disable_comment),
          auto_add_music: Boolean(context.settings.auto_add_music),
          is_brand_organic: Boolean(context.settings.brand_organic_toggle),
          is_branded_content: Boolean(context.settings.brand_content_toggle),
        },
      });
  const shareId = response.data?.share_id;
  if (!shareId) throw new ProviderError("TikTok Business did not return a share identifier");
  return { state: "processing", reference: shareId, retryAfterSeconds: PROCESSING_RETRY_SECONDS };
}

async function publishTikTokDraft(context: ProviderContext): Promise<ProviderResult> {
  const first = context.media[0];
  if (!first) throw new ProviderError("TikTok publication has no media");
  const data = first.kind === "video"
    ? await contentPost(context, TIKTOK_VIDEO_DRAFT_PATH, {
        source_info: { source: TIKTOK_PULL_FROM_URL, video_url: mediaUrl(context, 0) },
      })
    : await contentPost(context, TIKTOK_CONTENT_DRAFT_PATH, {
        post_info: {
          title: context.publication.title ?? undefined,
          description: context.publication.caption,
        },
        source_info: {
          source: TIKTOK_PULL_FROM_URL,
          photo_cover_index: Number(context.settings.photo_cover_index ?? 0),
          photo_images: context.media.map((_, index) => mediaUrl(context, index)),
        },
        post_mode: TIKTOK_MEDIA_UPLOAD_MODE,
        media_type: TIKTOK_PHOTO_MEDIA_TYPE,
      });
  if (!data.publish_id) throw new ProviderError("TikTok Content Posting did not return a publish identifier");
  return { state: "processing", reference: data.publish_id, retryAfterSeconds: PROCESSING_RETRY_SECONDS };
}

export async function publishTikTok(context: ProviderContext): Promise<ProviderResult> {
  const { mode } = requireTikTokOrganicAccount(context.account);
  // The provider reference remains the continuation cursor when a stale local claim is recovered.
  if (context.publication.provider_reference) {
    return mode === TIKTOK_CREATOR_INBOX_DRAFT_MODE
      ? checkContentStatus(context, context.publication.provider_reference)
      : checkBusinessStatus(context, context.publication.provider_reference);
  }
  return mode === TIKTOK_CREATOR_INBOX_DRAFT_MODE
    ? publishTikTokDraft(context)
    : publishTikTokBusiness(context);
}
