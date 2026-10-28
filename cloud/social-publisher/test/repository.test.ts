import { describe, expect, it } from "vitest";
import { dueAdvertisements, duePublications } from "../src/repository";
import { PUBLICATION_TERMINAL_STATES } from "../src/constants";

const NOW = "2026-09-14T12:30:00.000Z";
const EXPIRED_CLAIM_CUTOFF = "2026-09-14T12:15:00.000Z";
const DUE_BATCH_SIZE = 20;

interface CapturedQuery {
  sql: string;
  values: unknown[];
}

function queryCapture(): { db: D1Database; captured: CapturedQuery } {
  const captured: CapturedQuery = { sql: "", values: [] };
  const db = {
    prepare(sql: string) {
      captured.sql = sql;
      return {
        bind(...values: unknown[]) {
          captured.values = values;
          return {
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, captured };
}

describe("expired execution claims", () => {
  it("selects stale publishing claims for safe publication recovery", async () => {
    const { db, captured } = queryCapture();

    await duePublications(db, NOW);

    expect(captured.sql).toContain("state = 'publishing' AND updated_at <= ?");
    expect(captured.sql).not.toContain("awaiting_creator");
    expect(captured.values).toEqual([NOW, NOW, EXPIRED_CLAIM_CUTOFF, DUE_BATCH_SIZE]);
  });

  it("treats awaiting_creator as terminal", () => {
    expect(PUBLICATION_TERMINAL_STATES.has("awaiting_creator")).toBe(true);
  });

  it("selects stale executing claims for safe advertisement recovery", async () => {
    const { db, captured } = queryCapture();

    await dueAdvertisements(db, NOW);

    expect(captured.sql).toContain("state = 'executing' AND updated_at <= ?");
    expect(captured.values).toEqual([NOW, EXPIRED_CLAIM_CUTOFF, DUE_BATCH_SIZE]);
  });
});
