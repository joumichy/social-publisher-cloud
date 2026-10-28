import { ProviderError } from "../errors";
import type { ProviderContext, ProviderResult } from "../types";
import { publishLinkedIn } from "./linkedin";
import { publishMeta } from "./meta";
import { publishTikTok } from "./tiktok";

export async function publishWithProvider(context: ProviderContext): Promise<ProviderResult> {
  switch (context.publication.platform) {
    case "facebook":
    case "instagram":
      return publishMeta(context);
    case "linkedin":
      return publishLinkedIn(context);
    case "tiktok":
      return publishTikTok(context);
    default:
      throw new ProviderError(`Unsupported platform: ${String(context.publication.platform)}`);
  }
}
