import { AppError } from "./errors";
import { runDueAdvertisements } from "./advertising";
import { jsonResponse } from "./http";
import { cleanupExpiredMedia, runDuePublications } from "./publisher";
import { route } from "./router";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof AppError) return jsonResponse({ error: error.message }, error.status);
      console.error("Unhandled error", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(Promise.all([
      runDuePublications(env),
      runDueAdvertisements(env),
      cleanupExpiredMedia(env),
    ]).then(() => undefined));
  },
};
