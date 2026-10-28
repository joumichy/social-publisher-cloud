import { afterEach, describe, expect, it, vi } from "vitest";
import { publishMeta } from "../src/providers/meta";
import type { ProviderContext } from "../src/types";

function context(): ProviderContext {
  return {
    env: {
      PUBLIC_BASE_URL: "https://publisher.example",
      META_GRAPH_VERSION: "v23.0",
    } as ProviderContext["env"],
    account: { provider_subject: "17840000000000000" } as ProviderContext["account"],
    publication: {
      platform: "instagram",
      caption: "Caption",
      state: "scheduled",
      provider_reference: null,
    } as ProviderContext["publication"],
    media: [{ id: "med_1", public_token: "token", kind: "image" }] as ProviderContext["media"],
    accessToken: "access-token",
    settings: {},
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Meta adapter", () => {
  it("creates an Instagram image container without publishing it prematurely", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "container_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishMeta(context())).resolves.toEqual({
      state: "processing",
      reference: "container_1",
      retryAfterSeconds: 30,
    });
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(requestBody.get("image_url")).toBe("https://publisher.example/media/med_1/token");
    expect(requestBody.get("caption")).toBe("Caption");
  });

  it("resumes a finished Instagram container after an expired claim", async () => {
    const resumed = context();
    resumed.publication.state = "publishing";
    resumed.publication.provider_reference = "container_1";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "post_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishMeta(resumed)).resolves.toEqual({ state: "published", reference: "post_1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
