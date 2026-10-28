import { AUTH_SCHEME, JSON_CONTENT_TYPE } from "./constants";
import { AppError, ProviderError } from "./errors";

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, "cache-control": "no-store" },
  });
}

export function requireAdmin(request: Request, expectedToken: string): void {
  const authorization = request.headers.get("authorization") ?? "";
  if (!expectedToken || authorization !== `${AUTH_SCHEME}${expectedToken}`) {
    throw new AppError("Unauthorized", 401);
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError("Request body must be valid JSON");
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppError(`${field} is required`);
  return value.trim();
}

export async function providerJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw: raw.slice(0, 500) };
  }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new ProviderError(`Provider ${response.status}: ${JSON.stringify(body)}`, 502, retryable);
  }
  return body as T;
}
