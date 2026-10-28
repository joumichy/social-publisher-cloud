import { describe, expect, it } from "vitest";
import { buildAuthorizationUrl, defaultScopes, normalizeOAuthScopes } from "../src/oauth";
import type { Env } from "../src/types";

const OAUTH_STATE = {
  id: "oauth_state",
  account_id: "account",
  project_id: "project",
  platform: "instagram",
  connection_kind: "organic",
  publication_mode: null,
  provider_subject: "17840000000000000",
  display_name: "shortlistable",
  scopes: "instagram_business_basic,instagram_business_content_publish",
  expires_at: "2026-09-11T15:00:00.000Z",
  consumed_at: null,
  last_error: null,
} as Parameters<typeof buildAuthorizationUrl>[1];

function oauthEnvironment(): Env {
  return {
    PUBLIC_BASE_URL: "https://publisher.example",
    META_GRAPH_VERSION: "v26.0",
    META_APP_ID: "facebook-client",
    META_APP_SECRET: "facebook-secret",
    INSTAGRAM_APP_ID: "instagram-client",
    INSTAGRAM_APP_SECRET: "instagram-secret",
    TIKTOK_BUSINESS_CLIENT_ID: "tiktok-business-client",
    TIKTOK_BUSINESS_CLIENT_SECRET: "tiktok-business-secret",
    TIKTOK_CLIENT_KEY: "tiktok-content-client",
    TIKTOK_CLIENT_SECRET: "tiktok-content-secret",
  } as Env;
}

describe("OAuth provider credentials", () => {
  it("uses the dedicated Instagram application for Instagram Login", () => {
    const authorizationUrl = new URL(buildAuthorizationUrl(oauthEnvironment(), OAUTH_STATE));

    expect(authorizationUrl.hostname).toBe("www.instagram.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("instagram-client");
  });

  it("does not fall back to Facebook credentials when Instagram credentials are absent", () => {
    const environment = oauthEnvironment();
    delete environment.INSTAGRAM_APP_SECRET;

    expect(() => buildAuthorizationUrl(environment, OAUTH_STATE)).toThrow("Instagram OAuth is not configured");
  });

  it("uses Content Posting OAuth for creator-inbox drafts", () => {
    const authorizationUrl = new URL(buildAuthorizationUrl(oauthEnvironment(), {
      ...OAUTH_STATE,
      platform: "tiktok",
      publication_mode: "creator_inbox_draft",
      provider_subject: null,
      scopes: defaultScopes("tiktok", "organic", "creator_inbox_draft"),
    }));

    expect(authorizationUrl.origin).toBe("https://www.tiktok.com");
    expect(authorizationUrl.pathname).toBe("/v2/auth/authorize/");
    expect(authorizationUrl.searchParams.get("client_key")).toBe("tiktok-content-client");
    expect(authorizationUrl.searchParams.get("scope")).toBe("user.info.basic,user.info.profile,video.upload");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://publisher.example/oauth/tiktok/callback/");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
  });

  it("uses Business Organic OAuth for direct publishing", () => {
    const authorizationUrl = new URL(buildAuthorizationUrl(oauthEnvironment(), {
      ...OAUTH_STATE,
      platform: "tiktok",
      publication_mode: "direct_publish",
      provider_subject: null,
      scopes: defaultScopes("tiktok", "organic", "direct_publish"),
    }));

    expect(authorizationUrl.origin).toBe("https://ads.tiktok.com");
    expect(authorizationUrl.pathname).toBe("/marketing_api/auth");
    expect(authorizationUrl.searchParams.get("app_id")).toBe("tiktok-business-client");
    expect(authorizationUrl.searchParams.get("scope")).toBe("user.info.basic,video.publish");
  });

  it("does not substitute Business credentials for creator-inbox OAuth", () => {
    const environment = oauthEnvironment();
    delete environment.TIKTOK_CLIENT_SECRET;

    expect(() => buildAuthorizationUrl(environment, {
      ...OAUTH_STATE,
      platform: "tiktok",
      publication_mode: "creator_inbox_draft",
      provider_subject: null,
      scopes: defaultScopes("tiktok", "organic", "creator_inbox_draft"),
    })).toThrow("TikTok Content Posting OAuth is not configured");
  });

  it("does not substitute Content Posting credentials for direct publishing", () => {
    const environment = oauthEnvironment();
    delete environment.TIKTOK_BUSINESS_CLIENT_SECRET;

    expect(() => buildAuthorizationUrl(environment, {
      ...OAUTH_STATE,
      platform: "tiktok",
      publication_mode: "direct_publish",
      provider_subject: null,
      scopes: defaultScopes("tiktok", "organic", "direct_publish"),
    })).toThrow("TikTok Business OAuth is not configured");
  });
});

describe("OAuth scope persistence", () => {
  it("normalizes Instagram permission arrays for D1", () => {
    expect(normalizeOAuthScopes(["instagram_business_basic", "instagram_business_content_publish"], "fallback"))
      .toBe("instagram_business_basic,instagram_business_content_publish");
  });
});
