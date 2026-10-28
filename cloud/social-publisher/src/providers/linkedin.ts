import { LINKEDIN_API_ROOT, LINKEDIN_PROTOCOL_VERSION } from "../constants";
import { ProviderError } from "../errors";
import { providerJson } from "../http";
import type { MediaRow, ProviderContext, ProviderResult } from "../types";

interface ImageInitializeResponse { value: { uploadUrl: string; image: string } }
interface VideoInitializeResponse {
  value: {
    video: string;
    uploadToken: string;
    uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
  };
}

function headers(context: ProviderContext, json = true): Headers {
  const result = new Headers({
    authorization: `Bearer ${context.accessToken}`,
    "linkedin-version": context.env.LINKEDIN_VERSION,
    "x-restli-protocol-version": LINKEDIN_PROTOCOL_VERSION,
  });
  if (json) result.set("content-type", "application/json");
  return result;
}

async function mediaBody(context: ProviderContext, media: MediaRow, range?: { offset: number; length: number }): Promise<ArrayBuffer> {
  const object = await context.env.MEDIA.get(media.object_key, range ? { range } : undefined);
  if (!object || !object.body) throw new ProviderError(`Stored media is missing: ${media.id}`);
  return object.arrayBuffer();
}

async function uploadImage(context: ProviderContext, media: MediaRow): Promise<string> {
  const initialized = await providerJson<ImageInitializeResponse>(`${LINKEDIN_API_ROOT}/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(context),
    body: JSON.stringify({ initializeUploadRequest: { owner: context.account.provider_subject } }),
  });
  const response = await fetch(initialized.value.uploadUrl, {
    method: "PUT",
    headers: { "content-type": media.content_type },
    body: await mediaBody(context, media),
  });
  if (!response.ok) throw new ProviderError(`LinkedIn image upload failed with ${response.status}`, 502, response.status >= 500);
  return initialized.value.image;
}

async function uploadVideo(context: ProviderContext, media: MediaRow): Promise<string> {
  const initialized = await providerJson<VideoInitializeResponse>(`${LINKEDIN_API_ROOT}/videos?action=initializeUpload`, {
    method: "POST",
    headers: headers(context),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: context.account.provider_subject,
        fileSizeBytes: media.size_bytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });
  const uploadedPartIds: string[] = [];
  for (const instruction of initialized.value.uploadInstructions) {
    const length = instruction.lastByte - instruction.firstByte + 1;
    const response = await fetch(instruction.uploadUrl, {
      method: "PUT",
      headers: { "content-type": media.content_type },
      body: await mediaBody(context, media, { offset: instruction.firstByte, length }),
    });
    if (!response.ok) throw new ProviderError(`LinkedIn video upload failed with ${response.status}`, 502, response.status >= 500);
    const etag = response.headers.get("etag")?.replaceAll('"', "");
    if (!etag) throw new ProviderError("LinkedIn video upload response is missing ETag");
    uploadedPartIds.push(etag);
  }
  await providerJson(`${LINKEDIN_API_ROOT}/videos?action=finalizeUpload`, {
    method: "POST",
    headers: headers(context),
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: initialized.value.video,
        uploadToken: initialized.value.uploadToken,
        uploadedPartIds,
      },
    }),
  });
  return initialized.value.video;
}

export async function publishLinkedIn(context: ProviderContext): Promise<ProviderResult> {
  if (context.media.some((item) => item.kind === "document")) {
    throw new ProviderError("LinkedIn document publishing is not enabled in this first API release");
  }
  if (context.media.length > 1 && context.media.some((item) => item.kind !== "image")) {
    throw new ProviderError("LinkedIn multi-media posts currently require images only");
  }

  const assetIds: string[] = [];
  for (const media of context.media) {
    assetIds.push(media.kind === "video" ? await uploadVideo(context, media) : await uploadImage(context, media));
  }
  const content = assetIds.length === 1
    ? { media: { id: assetIds[0], altText: context.publication.alt_text ?? undefined } }
    : { multiImage: { images: assetIds.map((id) => ({ id, altText: context.publication.alt_text ?? undefined })) } };
  const response = await fetch(`${LINKEDIN_API_ROOT}/posts`, {
    method: "POST",
    headers: headers(context),
    body: JSON.stringify({
      author: context.account.provider_subject,
      commentary: context.publication.caption,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content,
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: Boolean(context.settings.disable_reshare),
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new ProviderError(`LinkedIn post failed with ${response.status}: ${detail}`, 502, response.status === 429 || response.status >= 500);
  }
  const reference = response.headers.get("x-restli-id");
  if (!reference) throw new ProviderError("LinkedIn did not return a post identifier");
  return { state: "published", reference };
}
