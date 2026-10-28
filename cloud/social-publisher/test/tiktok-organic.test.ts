import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asTikTokPublicationMode,
  requireTikTokOrganicAccount,
  TIKTOK_CREATOR_INBOX_DRAFT_MODE,
  TIKTOK_DIRECT_PUBLISH_MODE,
  validateTikTokPublicationInput,
  verifyTikTokBusinessIdentity,
  verifyTikTokContentIdentity,
} from "../src/tiktok-organic";
import type { AccountRow } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

function account(mode: "creator_inbox_draft" | "direct_publish"): AccountRow {
  return {
    id: "sibyl-tiktok",
    platform: "tiktok",
    connection_kind: "organic",
    publication_mode: mode,
    scopes: mode === TIKTOK_CREATOR_INBOX_DRAFT_MODE
      ? "user.info.basic,video.upload"
      : "user.info.basic,video.publish",
    metadata_json: JSON.stringify({
      oauth: mode === TIKTOK_CREATOR_INBOX_DRAFT_MODE
        ? "tiktok_content_posting"
        : "tiktok_business_organic",
      publish_mode: mode,
      username: "sibylinsight",
    }),
  } as AccountRow;
}

describe("TikTok organic account contract", () => {
  it("accepts only canonical persisted publication modes", () => {
    expect(asTikTokPublicationMode("creator_inbox_draft")).toBe(TIKTOK_CREATOR_INBOX_DRAFT_MODE);
    expect(asTikTokPublicationMode("direct_publish")).toBe(TIKTOK_DIRECT_PUBLISH_MODE);
    expect(() => asTikTokPublicationMode("inbox_draft")).toThrow("publication_mode");
  });

  it("routes creator drafts and direct publishing from the account column", () => {
    expect(requireTikTokOrganicAccount(account("creator_inbox_draft"))).toEqual({
      mode: "creator_inbox_draft", username: "sibylinsight",
    });
    expect(requireTikTokOrganicAccount(account("direct_publish"))).toEqual({
      mode: "direct_publish", username: "sibylinsight",
    });
  });

  it("rejects hybrid or mismatched metadata", () => {
    const hybrid = account("creator_inbox_draft");
    hybrid.metadata_json = JSON.stringify({
      oauth: "tiktok_business_organic", publish_mode: "creator_inbox_draft", username: "sibylinsight",
    });
    expect(() => requireTikTokOrganicAccount(hybrid)).toThrow("must use Content Posting");

    const mismatch = account("direct_publish");
    mismatch.metadata_json = JSON.stringify({
      oauth: "tiktok_business_organic", publish_mode: "creator_inbox_draft", username: "sibylinsight",
    });
    expect(() => requireTikTokOrganicAccount(mismatch)).toThrow("invalid publication mode contract");
  });
});

describe("TikTok identity verification", () => {
  it("verifies Content Posting open_id and exact username", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { user: { open_id: "open-id", display_name: "Sibyl", username: "sibylinsight" } },
      error: { code: "ok" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTikTokContentIdentity("token", "open-id", "@SibylInsight")).resolves.toEqual({
      displayName: "Sibyl", username: "sibylinsight",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("fields=open_id%2Cdisplay_name%2Cusername");
  });

  it("rejects a Content Posting token for another open_id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { user: { open_id: "other", username: "sibylinsight" } }, error: { code: "ok" },
    }), { status: 200 })));
    await expect(verifyTikTokContentIdentity("token", "open-id", "sibylinsight"))
      .rejects.toThrow("does not match the token open_id");
  });

  it("verifies Business Organic identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: { display_name: "Sibyl", username: "sibylinsight" },
    }), { status: 200 })));
    await expect(verifyTikTokBusinessIdentity("token", "open-id", "@SibylInsight")).resolves.toEqual({
      displayName: "Sibyl", username: "sibylinsight",
    });
  });
});

describe("TikTok publication validation", () => {
  const video = [{ kind: "video", content_type: "video/mp4", size_bytes: 10 }];

  it("lets creator-inbox drafts defer privacy selection to the creator", () => {
    expect(() => validateTikTokPublicationInput("creator_inbox_draft", video, {})).not.toThrow();
  });

  it("requires privacy for direct publishing", () => {
    expect(() => validateTikTokPublicationInput("direct_publish", video, {})).toThrow("privacy_level");
    expect(() => validateTikTokPublicationInput("direct_publish", video, {
      privacy_level: "PUBLIC_TO_EVERYONE",
    })).not.toThrow();
  });

  it("rejects unsupported or oversized photo media in both modes", () => {
    expect(() => validateTikTokPublicationInput("creator_inbox_draft", [
      { kind: "image", content_type: "image/png", size_bytes: 10 },
    ], {})).toThrow("JPEG or WebP");
    expect(() => validateTikTokPublicationInput("direct_publish", [
      { kind: "image", content_type: "image/jpeg", size_bytes: 21 * 1024 * 1024 },
    ], { privacy_level: "SELF_ONLY" })).toThrow("20 MiB");
  });
});
