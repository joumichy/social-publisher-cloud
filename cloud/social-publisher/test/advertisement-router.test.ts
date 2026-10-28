import { describe, expect, it } from "vitest";
import { ADVERTISING_MEDIA_URL_PLACEHOLDER } from "../src/advertising";
import { route } from "../src/router";
import type { Env } from "../src/types";

const ADMIN_TOKEN = "test-admin-token";
const ACCOUNT_ID = "sibyl-meta-ads";
const PROJECT_ID = "sibyl";
const ADVERTISER_ID = "972240608516319";
const ADVERTISEMENTS_URL = "https://publisher.example/v1/advertisements";
const META_CREATIVE_OPERATION = "meta.creative.create";

function advertisingDatabase(): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind: () => statement,
        first: async () => {
          if (sql.includes("FROM accounts")) {
            return {
              id: ACCOUNT_ID,
              project_id: PROJECT_ID,
              platform: "facebook",
              connection_kind: "advertising",
            };
          }
          if (sql.includes("FROM advertisements")) return null;
          throw new Error(`Unexpected first query: ${sql}`);
        },
      };
      return statement;
    },
    batch: async () => [],
  } as unknown as D1Database;
}

function advertisementRequest(body: Record<string, unknown>): Request {
  return new Request(ADVERTISEMENTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: "sibyl:existing-post",
      project_id: PROJECT_ID,
      campaign_id: "sibyl-launch",
      delivery_id: "sibyl-instagram-existing-post",
      connection_account_id: ACCOUNT_ID,
      provider: "meta",
      placement: "instagram",
      advertiser_id: ADVERTISER_ID,
      budget_type: "daily",
      budget_amount_minor: 1000,
      currency: "USD",
      start_at: "2026-09-15T10:00:00Z",
      operations: [{ id: "creative", type: META_CREATIVE_OPERATION, body }],
    }),
  });
}

function environment(): Env {
  return { DB: advertisingDatabase(), ADMIN_API_TOKEN: ADMIN_TOKEN } as Env;
}

describe("advertisement media routing contract", () => {
  it("accepts a provider-owned Instagram media reference without media_ids", async () => {
    const response = await route(
      advertisementRequest({ source_instagram_media_id: "17890000000000000" }),
      environment(),
    );

    expect(response.status).toBe(201);
  });

  it("rejects a nested media URL placeholder when media_ids are absent", async () => {
    const request = advertisementRequest({
      asset_feed_spec: {
        videos: [{ source_url: { [ADVERTISING_MEDIA_URL_PLACEHOLDER]: 0 } }],
      },
    });

    await expect(route(request, environment())).rejects.toThrow("when operations reference $media_url");
  });
});
