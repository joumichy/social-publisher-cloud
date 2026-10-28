import { describe, expect, it } from "vitest";
import {
  ADVERTISING_MEDIA_URL_PLACEHOLDER,
  advertisingOperationsRequireMedia,
  canonicalMetaOperationBody,
  initialAdvertisementExecutionAt,
  operationMatchesProvider,
} from "../src/advertising";
import type { AdvertisingOperation } from "../src/types";

const META_PROVIDER = "meta";
const TIKTOK_PROVIDER = "tiktok";
const META_ADSET_CREATE_OPERATION = "meta.adset.create";
const META_CAMPAIGN_CREATE_OPERATION = "meta.campaign.create";
const DELIVERY_START_AT = "2026-09-19T09:45:00.000Z";
const SUBMITTED_AT = "2026-09-12T10:00:00.000Z";

describe("advertising operation isolation", () => {
  it("accepts only Meta operations for a Meta advertising plan", () => {
    expect(operationMatchesProvider("meta.campaign.create", "meta")).toBe(true);
    expect(operationMatchesProvider("tiktok.campaign.create", "meta")).toBe(false);
  });

  it("accepts only TikTok operations for a TikTok advertising plan", () => {
    expect(operationMatchesProvider("tiktok.ad.create", "tiktok")).toBe(true);
    expect(operationMatchesProvider("meta.ad.create", "tiktok")).toBe(false);
  });
});

describe("advertising execution schedule", () => {
  it("materializes Meta objects immediately while retaining the delivery start", () => {
    expect(initialAdvertisementExecutionAt(META_PROVIDER, DELIVERY_START_AT, SUBMITTED_AT)).toBe(SUBMITTED_AT);
  });

  it("keeps TikTok execution gated by the delivery start", () => {
    expect(initialAdvertisementExecutionAt(TIKTOK_PROVIDER, DELIVERY_START_AT, SUBMITTED_AT)).toBe(DELIVERY_START_AT);
  });
});

describe("Meta ad set schedule contract", () => {
  it("forces the canonical delivery start onto ad set creation", () => {
    const planBody = { name: "Future ad set", start_time: "2026-09-20T09:45:00.000Z" };

    expect(canonicalMetaOperationBody(META_ADSET_CREATE_OPERATION, planBody, DELIVERY_START_AT)).toEqual({
      name: "Future ad set",
      start_time: DELIVERY_START_AT,
    });
    expect(planBody.start_time).toBe("2026-09-20T09:45:00.000Z");
  });

  it("does not add a start time to unrelated Meta operations", () => {
    const campaignBody = { name: "Future campaign" };
    expect(canonicalMetaOperationBody(META_CAMPAIGN_CREATE_OPERATION, campaignBody, DELIVERY_START_AT)).toBe(campaignBody);
  });
});

describe("advertising media contract", () => {
  it("allows provider-owned media references without a local upload", () => {
    const operations: AdvertisingOperation[] = [{
      id: "creative",
      type: "meta.creative.create",
      body: { source_instagram_media_id: "17890000000000000" },
    }];

    expect(advertisingOperationsRequireMedia(operations)).toBe(false);
  });

  it("finds a media URL placeholder at any nested level", () => {
    const operations: AdvertisingOperation[] = [{
      id: "creative",
      type: "meta.creative.create",
      body: {
        asset_feed_spec: {
          videos: [{ source_url: { [ADVERTISING_MEDIA_URL_PLACEHOLDER]: 0 } }],
        },
      },
    }];

    expect(advertisingOperationsRequireMedia(operations)).toBe(true);
  });

  it("treats every media URL key as a reference, including malformed placeholder objects", () => {
    const operations: AdvertisingOperation[] = [{
      id: "creative",
      type: "meta.creative.create",
      body: { source: { [ADVERTISING_MEDIA_URL_PLACEHOLDER]: 0, unexpected: true } },
    }];

    expect(advertisingOperationsRequireMedia(operations)).toBe(true);
  });
});
