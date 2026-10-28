import { describe, expect, it } from "vitest";
import { dataDeletionPage, privacyPage, termsPage } from "../src/legal";

describe("public legal pages", () => {
  it.each([
    [privacyPage, "Privacy Policy"],
    [termsPage, "Terms of Use"],
    [dataDeletionPage, "Data Deletion Instructions"],
  ])("serves %s as hardened HTML", async (factory, heading) => {
    const response = factory();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain(`<h1>${heading}</h1>`);
  });
});
