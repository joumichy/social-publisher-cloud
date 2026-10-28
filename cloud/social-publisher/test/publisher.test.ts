import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredMedia } from "../src/publisher";
import type { Env, MediaRow } from "../src/types";

const MEDIA_ID = "med_ad_asset";
const OBJECT_KEY = "sibyl/ads/asset.mp4";

interface CapturedStatement {
  sql: string;
  values: unknown[];
  bind(...values: unknown[]): CapturedStatement;
  all<T>(): Promise<{ results: T[] }>;
}

function statement(sql: string, media: MediaRow): CapturedStatement {
  return {
    sql,
    values: [],
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    },
    async all<T>() {
      const results = sql.includes("SELECT media.*") ? [media] : [];
      return { results: results as T[] };
    },
  };
}

describe("expired media cleanup", () => {
  it("excludes active advertisements and removes terminal relationship rows", async () => {
    const media = { id: MEDIA_ID, object_key: OBJECT_KEY } as MediaRow;
    const prepared: CapturedStatement[] = [];
    const batches: CapturedStatement[][] = [];
    const database = {
      prepare(sql: string) {
        const preparedStatement = statement(sql, media);
        prepared.push(preparedStatement);
        return preparedStatement;
      },
      async batch(statements: CapturedStatement[]) {
        batches.push(statements);
        return [];
      },
    } as unknown as D1Database;
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const environment = {
      DB: database,
      MEDIA: { delete: deleteObject },
      MEDIA_RETENTION_DAYS: "7",
    } as unknown as Env;

    await expect(cleanupExpiredMedia(environment)).resolves.toBe(1);

    expect(prepared[0]?.sql).toContain("JOIN advertisements ON advertisements.id = advertisement_media.advertisement_id");
    expect(prepared[0]?.sql).toContain(
      "publications.state NOT IN ('awaiting_creator', 'published', 'failed', 'cancelled')",
    );
    expect(prepared[0]?.sql).toContain("advertisements.state NOT IN ('submitted', 'failed', 'cancelled')");
    expect(deleteObject).toHaveBeenCalledWith(OBJECT_KEY);
    expect(batches[0]?.map((item) => item.sql)).toEqual([
      "DELETE FROM publication_media WHERE media_id = ?",
      "DELETE FROM advertisement_media WHERE media_id = ?",
      "DELETE FROM media WHERE id = ?",
    ]);
  });
});
