import { AES_ALGORITHM, AES_IV_BYTES } from "./constants";
import { AppError } from "./errors";

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(encodedKey);
  } catch {
    throw new AppError("TOKEN_ENCRYPTION_KEY must be valid base64", 500);
  }
  if (bytes.byteLength !== 32) {
    throw new AppError("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes", 500);
  }
  return crypto.subtle.importKey("raw", bytes, AES_ALGORITHM, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, encodedKey: string): Promise<EncryptedValue> {
  const key = await importEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const plaintext = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: AES_ALGORITHM, iv }, key, plaintext);
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptSecret(value: EncryptedValue, encodedKey: string): Promise<string> {
  const key = await importEncryptionKey(encodedKey);
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv: base64ToBytes(value.iv) },
    key,
    base64ToBytes(value.ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

export async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
