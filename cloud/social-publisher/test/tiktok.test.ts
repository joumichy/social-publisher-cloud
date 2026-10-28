import { afterEach, describe, expect, it, vi } from "vitest";
import { organicPostInfo, publishTikTok } from "../src/providers/tiktok";
import type { ProviderContext } from "../src/types";

const BUSINESS_METADATA = JSON.stringify({
  oauth: "tiktok_business_organic", publish_mode: "direct_publish", username: "sibyl",
});
const CONTENT_METADATA = JSON.stringify({
  oauth: "tiktok_content_posting", publish_mode: "creator_inbox_draft", username: "sibylinsight",
});

function businessContext(kind: "image" | "video" = "video"): ProviderContext {
  const media = kind === "video"
    ? [{ id: "med_video", public_token: "video_token", kind: "video" }]
    : [
        { id: "med_photo_1", public_token: "photo_token_1", kind: "image" },
        { id: "med_photo_2", public_token: "photo_token_2", kind: "image" },
      ];
  return {
    env: { PUBLIC_BASE_URL: "https://publisher.example" } as ProviderContext["env"],
    account: {
      id: "sibyl-tiktok",
      provider_subject: "creator_open_id",
      connection_kind: "organic",
      publication_mode: "direct_publish",
      scopes: "user.info.basic,video.publish",
      metadata_json: BUSINESS_METADATA,
    } as ProviderContext["account"],
    publication: {
      platform: "tiktok",
      caption: "Launch caption",
      title: "Launch title",
      state: "scheduled",
      provider_reference: null,
    } as ProviderContext["publication"],
    media: media as ProviderContext["media"],
    accessToken: "access-token",
    settings: {
      privacy_level: "PUBLIC_TO_EVERYONE",
      photo_cover_index: 1,
      disable_comment: true,
      disable_duet: true,
      disable_stitch: true,
      brand_organic_toggle: true,
      brand_content_toggle: false,
      is_aigc: true,
      auto_add_music: true,
    },
  };
}

function settingsResponse(): Response {
  return new Response(JSON.stringify({
    code: 0,
    data: {
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: false,
      max_video_post_duration_sec: 600,
    },
  }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe("TikTok Business Organic adapter", () => {
  it("preflights settings and publishes a video with the direct-post payload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(settingsResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { share_id: "share-video" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishTikTok(businessContext())).resolves.toEqual({
      state: "processing", reference: "share-video", retryAfterSeconds: 30,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/business/video/settings/?business_id=creator_open_id");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/business/video/publish/",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      business_id: "creator_open_id",
      video_url: "https://publisher.example/media/med_video/video_token",
      post_info: {
        privacy_level: "PUBLIC_TO_EVERYONE",
        caption: "Launch caption",
        disable_comment: true,
        disable_duet: true,
        disable_stitch: true,
        is_brand_organic: true,
        is_branded_content: false,
        is_ai_generated: true,
      },
    });
  });

  it("keeps photo-only fields separate from the video payload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(settingsResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { share_id: "share-photo" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await publishTikTok(businessContext("image"));

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      business_id: "creator_open_id",
      photo_images: [
        "https://publisher.example/media/med_photo_1/photo_token_1",
        "https://publisher.example/media/med_photo_2/photo_token_2",
      ],
      photo_cover_index: 1,
      post_info: {
        title: "Launch title",
        caption: "Launch caption",
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_comment: true,
        auto_add_music: true,
        is_brand_organic: true,
        is_branded_content: false,
      },
    });
  });

  it("resumes a stale local claim from provider_reference without republishing", async () => {
    const context = businessContext();
    context.publication.state = "publishing";
    context.publication.provider_reference = "share-video";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: { status: "PROCESSING_DOWNLOAD" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishTikTok(context)).resolves.toEqual({
      state: "processing", reference: "share-video", retryAfterSeconds: 30,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("publish_id=share-video");
  });

  it("waits for a canonical post ID before marking a completed share as published", async () => {
    const context = businessContext();
    context.publication.provider_reference = "share-video";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: { status: "PUBLISH_COMPLETE", post_ids: [] },
    }), { status: 200 })));

    await expect(publishTikTok(context)).resolves.toEqual({
      state: "processing", reference: "share-video", retryAfterSeconds: 30,
    });
  });

  it("returns the canonical post ID and public URL once available", async () => {
    const context = businessContext();
    context.publication.provider_reference = "share-video";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: { status: "PUBLISH_COMPLETE", post_ids: ["post-123"] },
    }), { status: 200 })));

    await expect(publishTikTok(context)).resolves.toEqual({
      state: "published",
      reference: "post-123",
      url: "https://www.tiktok.com/@sibyl/video/post-123",
    });
  });

  it("rejects hybrid Content Posting metadata without a provider call", async () => {
    const context = businessContext();
    context.account.metadata_json = JSON.stringify({
      oauth: "tiktok_content_posting", publish_mode: "direct_publish", username: "sibyl",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishTikTok(context)).rejects.toThrow("must use Business Organic");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a privacy level missing from the provider preflight", async () => {
    const context = businessContext();
    context.settings.privacy_level = "FRIENDS_ONLY";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(settingsResponse()));

    await expect(publishTikTok(context)).rejects.toThrow("privacy level is not available");
  });
});

function draftContext(kind: "image" | "video" = "video"): ProviderContext {
  const context = businessContext(kind);
  context.account.publication_mode = "creator_inbox_draft";
  context.account.scopes = "user.info.basic,video.upload";
  context.account.metadata_json = CONTENT_METADATA;
  context.settings = { photo_cover_index: 1 };
  return context;
}

function contentResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data, error: { code: "ok" } }), { status: 200 });
}

describe("TikTok creator-inbox draft adapter", () => {
  it("uploads a video draft without Business preflight", async () => {
    const fetchMock = vi.fn().mockResolvedValue(contentResponse({ publish_id: "draft-video" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishTikTok(draftContext())).resolves.toEqual({
      state: "processing", reference: "draft-video", retryAfterSeconds: 30,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      source_info: {
        source: "PULL_FROM_URL",
        video_url: "https://publisher.example/media/med_video/video_token",
      },
    });
  });

  it("uploads a photo draft with creator-inbox fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(contentResponse({ publish_id: "draft-photo" }));
    vi.stubGlobal("fetch", fetchMock);

    await publishTikTok(draftContext("image"));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://open.tiktokapis.com/v2/post/publish/content/init/",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      post_info: { title: "Launch title", description: "Launch caption" },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 1,
        photo_images: [
          "https://publisher.example/media/med_photo_1/photo_token_1",
          "https://publisher.example/media/med_photo_2/photo_token_2",
        ],
      },
      post_mode: "MEDIA_UPLOAD",
      media_type: "PHOTO",
    });
  });

  it("terminates as awaiting_creator when TikTok delivers the draft to the inbox", async () => {
    const context = draftContext();
    context.publication.provider_reference = "draft-video";
    const fetchMock = vi.fn().mockResolvedValue(contentResponse({
      publish_id: "draft-video", status: "SEND_TO_USER_INBOX",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishTikTok(context)).resolves.toEqual({
      state: "awaiting_creator", reference: "draft-video",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ publish_id: "draft-video" });
  });

  it("terminates as awaiting_creator when processing completes without a public post ID", async () => {
    const context = draftContext();
    context.publication.provider_reference = "draft-video";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(contentResponse({
      status: "PUBLISH_COMPLETE", publicaly_available_post_id: [],
    })));

    await expect(publishTikTok(context)).resolves.toEqual({
      state: "awaiting_creator", reference: "draft-video",
    });
  });

  it("marks only a public post ID as published", async () => {
    const context = draftContext();
    context.publication.provider_reference = "draft-video";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(contentResponse({
      status: "PUBLISH_COMPLETE", publicaly_available_post_id: [12345],
    })));
    await expect(publishTikTok(context)).resolves.toEqual({ state: "published", reference: "12345" });
  });

  it("rejects a hybrid Business metadata contract before provider I/O", async () => {
    const context = draftContext();
    context.account.metadata_json = JSON.stringify({
      oauth: "tiktok_business_organic", publish_mode: "creator_inbox_draft", username: "sibylinsight",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(publishTikTok(context)).rejects.toThrow("must use Content Posting");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TikTok Business direct-post fields", () => {
  it("maps approved video settings", () => {
    expect(organicPostInfo(businessContext())).toEqual({
      privacy_level: "PUBLIC_TO_EVERYONE",
      caption: "Launch caption",
      disable_comment: true,
      disable_duet: true,
      disable_stitch: true,
      is_brand_organic: true,
      is_branded_content: false,
      is_ai_generated: true,
    });
  });
});
