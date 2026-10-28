import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../src/crypto";
import { accessTokenFor } from "../src/tokens";
import type { AccountRow, Env } from "../src/types";

const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const BUSINESS_ORGANIC_CONNECTION = "tiktok_business_organic";

afterEach(() => vi.unstubAllGlobals());

describe("TikTok token refresh", () => {
  it("refreshes a creator-inbox Content Posting connection", async () => {
    const access = await encryptSecret("expired-access", TEST_KEY);
    const refresh = await encryptSecret("content-refresh", TEST_KEY);
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const environment = {
      DB: { prepare },
      TOKEN_ENCRYPTION_KEY: TEST_KEY,
      TIKTOK_CLIENT_KEY: "content-client-key",
      TIKTOK_CLIENT_SECRET: "content-client-secret",
    } as unknown as Env;
    const account = {
      id: "sibyl-tiktok",
      platform: "tiktok",
      connection_kind: "organic",
      publication_mode: "creator_inbox_draft",
      provider_subject: "creator-open-id",
      connection_status: "ready",
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: "user.info.basic,video.upload",
      metadata_json: JSON.stringify({
        oauth: "tiktok_content_posting", publish_mode: "creator_inbox_draft", username: "sibylinsight",
      }),
    } as AccountRow;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "renewed-access",
      expires_in: 86_400,
      refresh_token: "renewed-refresh",
      refresh_expires_in: 31_536_000,
      scope: "user.info.basic,video.upload",
      open_id: "creator-open-id",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(accessTokenFor(environment, account)).resolves.toBe("renewed-access");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBeInstanceOf(URLSearchParams);
    expect(String(request.body)).toContain("client_key=content-client-key");
    expect(String(request.body)).not.toContain("business-client");
    expect(run).toHaveBeenCalledOnce();
  });

  it("refreshes a Business Organic connection and persists rotated tokens", async () => {
    const access = await encryptSecret("expired-access", TEST_KEY);
    const refresh = await encryptSecret("content-refresh", TEST_KEY);
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const environment = {
      DB: { prepare },
      TOKEN_ENCRYPTION_KEY: TEST_KEY,
      TIKTOK_BUSINESS_CLIENT_ID: "business-client-id",
      TIKTOK_BUSINESS_CLIENT_SECRET: "business-client-secret",
    } as unknown as Env;
    const account = {
      id: "shortlistable-tiktok",
      platform: "tiktok",
      connection_kind: "organic",
      publication_mode: "direct_publish",
      provider_subject: "creator-open-id",
      connection_status: "ready",
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: "user.info.basic,video.publish",
      metadata_json: JSON.stringify({
        oauth: BUSINESS_ORGANIC_CONNECTION, publish_mode: "direct_publish", username: "shortlistable",
      }),
    } as AccountRow;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        access_token: "renewed-access",
        expires_in: 86_400,
        refresh_token: "renewed-refresh",
        refresh_token_expires_in: 31_536_000,
        scope: "user.info.basic,video.publish",
        open_id: "creator-open-id",
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(accessTokenFor(environment, account)).resolves.toBe("renewed-access");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/refresh_token/",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      client_id: "business-client-id",
      client_secret: "business-client-secret",
      grant_type: "refresh_token",
      refresh_token: "content-refresh",
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects a hybrid connection before using its token", async () => {
    const access = await encryptSecret("legacy-access", TEST_KEY);
    const account = {
      id: "legacy-tiktok",
      platform: "tiktok",
      connection_kind: "organic",
      publication_mode: "creator_inbox_draft",
      provider_subject: "legacy-open-id",
      connection_status: "ready",
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      scopes: "user.info.basic,video.upload",
      metadata_json: JSON.stringify({
        oauth: "tiktok_business_organic", publish_mode: "creator_inbox_draft", username: "legacy",
      }),
    } as AccountRow;

    await expect(accessTokenFor({ TOKEN_ENCRYPTION_KEY: TEST_KEY } as Env, account))
      .rejects.toThrow("must use Content Posting");
  });
});
