import { META_API_ROOT, PROCESSING_RETRY_SECONDS } from "../constants";
import { ProviderError } from "../errors";
import { providerJson } from "../http";
import type { ProviderContext, ProviderResult } from "../types";

interface MetaIdResponse { id: string }
interface MetaContainerStatus { status_code: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED"; status?: string }

function graphUrl(context: ProviderContext, path: string): string {
  const metadata = JSON.parse(context.account.metadata_json || "{}") as Record<string, unknown>;
  const root = metadata.oauth === "instagram_login" ? "https://graph.instagram.com" : META_API_ROOT;
  return `${root}/${context.env.META_GRAPH_VERSION}/${path}`;
}

function publicMediaUrl(context: ProviderContext, index: number): string {
  const item = context.media[index];
  if (!item) throw new ProviderError("Meta publication has no media");
  return `${context.env.PUBLIC_BASE_URL}/media/${item.id}/${item.public_token}`;
}

async function graphPost(context: ProviderContext, path: string, values: Record<string, string>): Promise<MetaIdResponse> {
  const body = new URLSearchParams({ ...values, access_token: context.accessToken });
  return providerJson<MetaIdResponse>(graphUrl(context, path), { method: "POST", body });
}

async function publishInstagramContainer(context: ProviderContext, containerId: string): Promise<ProviderResult> {
  const status = await providerJson<MetaContainerStatus>(
    `${graphUrl(context, containerId)}?fields=status_code,status&access_token=${encodeURIComponent(context.accessToken)}`,
    { method: "GET" },
  );
  if (status.status_code === "IN_PROGRESS") {
    return { state: "processing", reference: containerId, retryAfterSeconds: PROCESSING_RETRY_SECONDS };
  }
  if (status.status_code !== "FINISHED") {
    throw new ProviderError(`Instagram container ${status.status_code}: ${status.status ?? "unknown error"}`);
  }
  const result = await graphPost(context, `${context.account.provider_subject}/media_publish`, {
    creation_id: containerId,
  });
  return { state: "published", reference: result.id };
}

async function createInstagramContainer(context: ProviderContext): Promise<string> {
  if (context.media.length === 1) {
    const media = context.media[0];
    if (!media) throw new ProviderError("Instagram publication has no media");
    const sourceField = media.kind === "video" ? "video_url" : "image_url";
    const values: Record<string, string> = {
      [sourceField]: publicMediaUrl(context, 0),
      caption: context.publication.caption,
    };
    if (media.kind === "video") values.media_type = "REELS";
    const result = await graphPost(context, `${context.account.provider_subject}/media`, values);
    return result.id;
  }

  const children: string[] = [];
  for (let index = 0; index < context.media.length; index += 1) {
    const media = context.media[index];
    if (!media || media.kind !== "image") {
      throw new ProviderError("Instagram carousels currently require images only");
    }
    const child = await graphPost(context, `${context.account.provider_subject}/media`, {
      image_url: publicMediaUrl(context, index),
      is_carousel_item: "true",
    });
    children.push(child.id);
  }
  const parent = await graphPost(context, `${context.account.provider_subject}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: context.publication.caption,
  });
  return parent.id;
}

async function publishInstagram(context: ProviderContext): Promise<ProviderResult> {
  // The provider reference remains the continuation cursor when a stale local claim is recovered.
  if (context.publication.provider_reference) {
    return publishInstagramContainer(context, context.publication.provider_reference);
  }
  const containerId = await createInstagramContainer(context);
  return { state: "processing", reference: containerId, retryAfterSeconds: PROCESSING_RETRY_SECONDS };
}

async function publishFacebook(context: ProviderContext): Promise<ProviderResult> {
  const pageId = context.account.provider_subject;
  if (context.media.length === 1) {
    const media = context.media[0];
    if (!media) throw new ProviderError("Facebook publication has no media");
    const result = media.kind === "video"
      ? await graphPost(context, `${pageId}/videos`, {
          file_url: publicMediaUrl(context, 0),
          description: context.publication.caption,
        })
      : await graphPost(context, `${pageId}/photos`, {
          url: publicMediaUrl(context, 0),
          caption: context.publication.caption,
          published: "true",
        });
    return { state: "published", reference: result.id };
  }

  const attachedMedia: Array<{ media_fbid: string }> = [];
  for (let index = 0; index < context.media.length; index += 1) {
    const media = context.media[index];
    if (!media || media.kind !== "image") {
      throw new ProviderError("Facebook multi-media posts currently require images only");
    }
    const upload = await graphPost(context, `${pageId}/photos`, {
      url: publicMediaUrl(context, index),
      published: "false",
    });
    attachedMedia.push({ media_fbid: upload.id });
  }
  const result = await graphPost(context, `${pageId}/feed`, {
    message: context.publication.caption,
    attached_media: JSON.stringify(attachedMedia),
  });
  return { state: "published", reference: result.id };
}

export async function publishMeta(context: ProviderContext): Promise<ProviderResult> {
  return context.publication.platform === "instagram"
    ? publishInstagram(context)
    : publishFacebook(context);
}
