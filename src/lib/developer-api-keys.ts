const API_KEY_PREFIX = "adsbook_live_";
/**
 * Prefixes issued before the brand sweep. A key is verified by hashing the whole
 * secret with SHA-256 and comparing digests, so nothing in the credential path
 * reads the prefix and an already-issued key keeps validating untouched — and the
 * prefix cannot be recovered from a stored hash, so it could not be rewritten
 * anyway. The prefix is load-bearing in exactly two places: issuance below, and
 * the masked preview. Only the preview needs to know the old value, so that a
 * merchant's older keys do not render as a row of dots in
 * `/admin/settings/developer`. Drop this list once no unrevoked key predates the
 * sweep.
 */
const LEGACY_API_KEY_PREFIXES = ["cmsads_live_"];
const API_KEY_RANDOM_BYTES = 32;
const API_KEY_HASH_LENGTH = 64;

export const HEADLESS_API_SCOPES = [
  "storefront:read",
  "catalog:read",
  "shipping:read",
  "checkout:write",
  "orders:read",
  "tracking:write",
] as const;

export type HeadlessApiScope = (typeof HEADLESS_API_SCOPES)[number];

/**
 * The operations API (PRD A45, `/api/ops/v1`). Namespaced because the
 * storefront already owns `orders:read` (one order by its public token) and
 * `catalog:read`, and a key stored without a scope list is granted every
 * storefront scope: a shared name would hand every such key the whole order
 * book. No `ops:` scope is ever granted by default (REQ-252).
 */
export const OPS_API_SCOPES = [
  "ops:orders:read",
  "ops:orders:read_pii",
  "ops:orders:write",
  "ops:shipping:write",
  "ops:reports:read",
  "ops:catalog:read",
] as const;

export type OpsApiScope = (typeof OPS_API_SCOPES)[number];
export type ApiKeyScope = HeadlessApiScope | OpsApiScope;

export const DEFAULT_HEADLESS_API_SCOPES: readonly HeadlessApiScope[] = HEADLESS_API_SCOPES;
export const DEFAULT_API_KEY_RATE_LIMIT = 120;
export const DEFAULT_API_KEY_DAILY_QUOTA = 10_000;
export const MIN_API_KEY_RATE_LIMIT = 1;
export const MAX_API_KEY_RATE_LIMIT = 600;
export const MIN_API_KEY_DAILY_QUOTA = 1;
export const MAX_API_KEY_DAILY_QUOTA = 100_000;
const API_KEY_SCOPE_SET: ReadonlySet<string> = new Set<ApiKeyScope>([
  ...HEADLESS_API_SCOPES,
  ...OPS_API_SCOPES,
]);

export type DeveloperApiKeyPolicy = {
  scopes: ApiKeyScope[];
  rateLimitPerMinute: number;
  dailyQuota: number;
};

function parseIntegerWithin(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/** A stored list, or the storefront defaults for a key stored without one — never an `ops:` scope. */
export function parseStoredApiKeyScopes(value: unknown): ApiKeyScope[] {
  if (value === null || value === undefined || value === "") {
    return [...DEFAULT_HEADLESS_API_SCOPES];
  }
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const scopes = candidates
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter((scope): scope is ApiKeyScope => API_KEY_SCOPE_SET.has(scope));
  if (scopes.length !== candidates.length) return [];
  return [...new Set(scopes)];
}

/** A key that reaches buyer data or order actions: only the owner issues, changes or revokes it (REQ-265). */
export function hasOpsScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope.startsWith("ops:"));
}

export function normalizeApiKeyPolicy(input: {
  scopes?: unknown;
  rate_limit_per_minute?: unknown;
  daily_quota?: unknown;
}): { valid: true; policy: DeveloperApiKeyPolicy } | { valid: false; error: string } {
  const scopes = parseStoredApiKeyScopes(input.scopes);
  if (scopes.length === 0) {
    return { valid: false, error: "Pilih minimal satu scope API yang valid." };
  }
  const rateLimitPerMinute = parseIntegerWithin(
    input.rate_limit_per_minute ?? DEFAULT_API_KEY_RATE_LIMIT,
    MIN_API_KEY_RATE_LIMIT,
    MAX_API_KEY_RATE_LIMIT,
  );
  if (rateLimitPerMinute === null) {
    return {
      valid: false,
      error: `Batas request per menit harus ${MIN_API_KEY_RATE_LIMIT}–${MAX_API_KEY_RATE_LIMIT}.`,
    };
  }
  const dailyQuota = parseIntegerWithin(
    input.daily_quota ?? DEFAULT_API_KEY_DAILY_QUOTA,
    MIN_API_KEY_DAILY_QUOTA,
    MAX_API_KEY_DAILY_QUOTA,
  );
  if (dailyQuota === null) {
    return {
      valid: false,
      error: `Kuota harian harus ${MIN_API_KEY_DAILY_QUOTA}–${MAX_API_KEY_DAILY_QUOTA}.`,
    };
  }
  return {
    valid: true,
    policy: { scopes, rateLimitPerMinute, dailyQuota },
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function normalizeApiKeyName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) : "";
}

export function generateApiKeySecret(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES));
  return `${API_KEY_PREFIX}${encodeBase64Url(randomBytes)}`;
}

export async function hashApiKeySecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyApiKeySecret(secret: string, storedHash: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;
  const candidateHash = await hashApiKeySecret(secret);
  let difference = 0;
  for (let index = 0; index < API_KEY_HASH_LENGTH; index += 1) {
    difference |= candidateHash.charCodeAt(index) ^ storedHash.charCodeAt(index);
  }
  return difference === 0;
}

export function maskApiKeySecret(secret: string): string {
  const prefix = [API_KEY_PREFIX, ...LEGACY_API_KEY_PREFIXES].find((candidate) =>
    secret.startsWith(candidate),
  );
  if (!prefix || secret.length < prefix.length + 8) {
    return "••••••••";
  }
  return `${secret.slice(0, prefix.length + 6)}••••${secret.slice(-4)}`;
}

export function isApiKeyActive(revokedAt: string | null): boolean {
  return revokedAt === null;
}
