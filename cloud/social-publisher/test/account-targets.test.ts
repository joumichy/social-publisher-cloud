import { describe, expect, it } from "vitest";
import { assertConnectionMatchesTarget, assertTargetRegistrationMatches } from "../src/account-targets";
import type { AccountTargetRow } from "../src/types";

const SHORTLISTABLE_TARGET: AccountTargetRow = {
  id: "shortlistable-instagram",
  project_id: "shortlistable",
  platform: "instagram",
  connection_kind: "organic",
  publication_mode: null,
  provider_subject: "17841436454673202",
  display_name: "shortlistable",
  created_at: "2026-09-11T00:00:00.000Z",
  updated_at: "2026-09-11T00:00:00.000Z",
};

describe("account target identity", () => {
  it("accepts an exact project, platform, subject, and display-name match", () => {
    expect(() => assertConnectionMatchesTarget(SHORTLISTABLE_TARGET, {
      projectId: "shortlistable",
      platform: "instagram",
      connectionKind: "organic",
      publicationMode: null,
      providerSubject: "17841436454673202",
      displayName: "shortlistable",
    })).not.toThrow();
  });

  it("rejects assigning the Shortlistable alias to the Sibyl identity", () => {
    expect(() => assertConnectionMatchesTarget(SHORTLISTABLE_TARGET, {
      projectId: "sibyl",
      platform: "instagram",
      connectionKind: "organic",
      publicationMode: null,
      providerSubject: "17841427084673186",
      displayName: "sibylinsight",
    })).toThrow("cannot be reassigned");
  });

  it("allows a registry without a provider subject to reuse a server-bound target", () => {
    expect(() => assertTargetRegistrationMatches(SHORTLISTABLE_TARGET, {
      projectId: "shortlistable",
      platform: "instagram",
      connectionKind: "organic",
      publicationMode: null,
      providerSubject: null,
      displayName: "shortlistable",
    })).not.toThrow();
  });

  it("treats TikTok publication_mode as immutable target identity", () => {
    const target = {
      ...SHORTLISTABLE_TARGET,
      id: "sibyl-tiktok",
      project_id: "sibyl",
      platform: "tiktok",
      publication_mode: "creator_inbox_draft",
      provider_subject: null,
      display_name: "sibylinsight",
    } as AccountTargetRow;

    expect(() => assertTargetRegistrationMatches(target, {
      projectId: "sibyl",
      platform: "tiktok",
      connectionKind: "organic",
      publicationMode: "direct_publish",
      providerSubject: null,
      displayName: "sibylinsight",
    })).toThrow("cannot be reassigned");
  });
});
