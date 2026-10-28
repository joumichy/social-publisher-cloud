import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/crypto";

const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("encrypted provider tokens", () => {
  it("round-trips without storing plaintext", async () => {
    const plaintext = "provider-token-value";
    const encrypted = await encryptSecret(plaintext, TEST_KEY);

    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(encrypted.iv).not.toBe("");
    await expect(decryptSecret(encrypted, TEST_KEY)).resolves.toBe(plaintext);
  });

  it("rejects an invalid key length", async () => {
    await expect(encryptSecret("secret", btoa("short"))).rejects.toThrow("exactly 32 bytes");
  });
});
