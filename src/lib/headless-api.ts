import type { APIRoute } from 'astro';
import { getRuntimeEnv } from './env.ts';
import {
  DEFAULT_API_KEY_DAILY_QUOTA,
  DEFAULT_API_KEY_RATE_LIMIT,
  hashApiKeySecret,
  parseStoredApiKeyScopes,
  type ApiKeyScope,
  type HeadlessApiScope,
} from './developer-api-keys.ts';

export const HEADLESS_OPERATIONS = {
  storefrontRead: { scope: 'storefront:read', method: 'GET', path: '/api/v1/storefront' },
  catalogList: { scope: 'catalog:read', method: 'GET', path: '/api/v1/products' },
  catalogDetail: { scope: 'catalog:read', method: 'GET', path: '/api/v1/products/{slug}' },
  districtSearch: { scope: 'shipping:read', method: 'GET', path: '/api/v1/geo/districts' },
  shippingQuote: { scope: 'shipping:read', method: 'POST', path: '/api/v1/geo/shipping-rates' },
  checkoutCreate: { scope: 'checkout:write', method: 'POST', path: '/api/v1/checkout' },
  orderStatusRead: { scope: 'orders:read', method: 'POST', path: '/api/v1/orders/status' },
  trackingCreate: { scope: 'tracking:write', method: 'POST', path: '/api/v1/tracking/events' },
  openApiRead: { scope: 'storefront:read', method: 'GET', path: '/api/v1/openapi.json' },
} as const satisfies Record<string, {
  scope: HeadlessApiScope;
  method: 'GET' | 'POST';
  path: string;
}>;

export type HeadlessOperation = keyof typeof HEADLESS_OPERATIONS;

export const DEFAULT_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-App-Key',
  'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-DailyQuota-Limit, X-DailyQuota-Remaining',
  'Access-Control-Max-Age': '86400',
};

type DeveloperApiKeyRow = {
  id: number;
  key_hash: string;
  scopes?: string | null;
  rate_limit_per_minute?: number | null;
  daily_quota?: number | null;
};

type ApiKeyPolicyHeaders = Record<string, string>;

export type AuthenticatedApiKey = {
  id: number;
  scopes: ApiKeyScope[];
  corsHeaders: ApiKeyPolicyHeaders;
  database: D1Database;
  rateLimit: number;
  dailyQuota: number;
};

type HeadlessAuditOutcome =
  | 'allowed'
  | 'scope_denied'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'origin_denied';

function getApiKeySecret(request: Request) {
  const appKey = request.headers.get('x-app-key')?.trim();
  if (appKey) return appKey;

  const legacyKey = request.headers.get('x-api-key')?.trim();
  if (legacyKey) return legacyKey;

  const authorization = request.headers.get('authorization')?.trim() || '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return '';
}

function headlessAuthError(
  message: string,
  code: string,
  status: number,
  headers: Record<string, string>,
) {
  return headlessJson(
    {
      success: false,
      timestamp: new Date().toISOString(),
      error: { message, code },
    },
    status,
    { ...headers, 'cache-control': 'no-store' },
  );
}

export async function recordHeadlessApiAudit(
  database: D1Database,
  apiKeyId: number,
  /** A storefront operation, or an operations one (`ops.<name>`, PRD A45). */
  operation: string,
  outcome: HeadlessAuditOutcome,
  statusCode: number,
  createdAt: string,
) {
  await database.prepare(`
    INSERT INTO headless_api_audit_events (
      api_key_id, operation, outcome, status_code, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).bind(apiKeyId, operation, outcome, statusCode, createdAt).run();
}

async function consumeUsageBucket(
  database: D1Database,
  apiKeyId: number,
  bucketKind: 'minute' | 'day',
  bucketStart: string,
  limit: number,
): Promise<number | null> {
  const row = await database.prepare(`
    INSERT INTO developer_api_key_usage (
      api_key_id, bucket_kind, bucket_start, request_count
    ) VALUES (?, ?, ?, 1)
    ON CONFLICT(api_key_id, bucket_kind, bucket_start)
    DO UPDATE SET request_count = request_count + 1
    WHERE request_count < ?
    RETURNING request_count
  `).bind(apiKeyId, bucketKind, bucketStart, limit).first<{ request_count: number }>();
  return row ? Number(row.request_count) : null;
}

/**
 * Key lookup and scope check, shared by the storefront API and the operations
 * API (`ops-api.ts`). `operation` is only the audit label; `requiredScope` is
 * the one scope the route needs.
 */
export async function validateHeadlessApiKey(
  request: Request,
  locals: App.Locals | undefined,
  corsHeaders: Record<string, string>,
  operation: string,
  requiredScope: ApiKeyScope,
): Promise<
  | { allowed: true; key: AuthenticatedApiKey }
  | { allowed: false; errorResponse: Response }
> {
  const secret = getApiKeySecret(request);
  if (!secret) {
    return {
      allowed: false,
      errorResponse: headlessAuthError(
        'API key headless wajib dikirim lewat X-App-Key atau Authorization Bearer.',
        'API_KEY_REQUIRED',
        401,
        corsHeaders,
      ),
    };
  }

  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!database?.prepare) {
    return {
      allowed: false,
      errorResponse: headlessAuthError(
        'Database API key headless belum dikonfigurasi.',
        'API_KEY_STORE_UNAVAILABLE',
        503,
        corsHeaders,
      ),
    };
  }

  try {
    const candidateHash = await hashApiKeySecret(secret);
    const record = await database.prepare(`
      SELECT *
      FROM developer_api_keys
      WHERE key_hash = ? AND revoked_at IS NULL
      LIMIT 1
    `).bind(candidateHash).first<DeveloperApiKeyRow>();
    if (!record || record.key_hash !== candidateHash) {
      return {
        allowed: false,
        errorResponse: headlessAuthError(
          'API key headless tidak valid atau sudah dicabut.',
          'API_KEY_INVALID',
          401,
          corsHeaders,
        ),
      };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const scopes = parseStoredApiKeyScopes(record.scopes);
    const rateLimit = Number.isInteger(record.rate_limit_per_minute)
      ? Number(record.rate_limit_per_minute)
      : DEFAULT_API_KEY_RATE_LIMIT;
    const dailyQuota = Number.isInteger(record.daily_quota)
      ? Number(record.daily_quota)
      : DEFAULT_API_KEY_DAILY_QUOTA;
    const policyHeaders = {
      ...corsHeaders,
      'X-RateLimit-Limit': String(rateLimit),
      'X-DailyQuota-Limit': String(dailyQuota),
    };

    if (!scopes.includes(requiredScope)) {
      await recordHeadlessApiAudit(database, record.id, operation, 'scope_denied', 403, nowIso);
      return {
        allowed: false,
        errorResponse: headlessAuthError(
          'API key tidak memiliki scope yang diperlukan untuk operasi ini.',
          'API_SCOPE_FORBIDDEN',
          403,
          policyHeaders,
        ),
      };
    }

    return {
      allowed: true,
      key: {
        id: record.id,
        scopes,
        corsHeaders: policyHeaders,
        database,
        rateLimit,
        dailyQuota,
      },
    };
  } catch {
    return {
      allowed: false,
      errorResponse: headlessAuthError(
        'Kebijakan API key tidak dapat diverifikasi.',
        'API_KEY_POLICY_UNAVAILABLE',
        503,
        corsHeaders,
      ),
    };
  }
}

export async function enforceHeadlessUsageLimits(
  key: AuthenticatedApiKey,
  operation: string,
): Promise<
  | { allowed: true; corsHeaders: Record<string, string> }
  | { allowed: false; errorResponse: Response }
> {
  const now = new Date();
  const nowIso = now.toISOString();
  const minuteBucket = `${nowIso.slice(0, 16)}:00.000Z`;
  const minuteCount = await consumeUsageBucket(
    key.database,
    key.id,
    'minute',
    minuteBucket,
    key.rateLimit,
  );
  const nextMinute = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
  const minuteHeaders = {
    ...key.corsHeaders,
    'X-RateLimit-Remaining': String(Math.max(0, key.rateLimit - (minuteCount ?? key.rateLimit))),
    'X-RateLimit-Reset': nextMinute.toISOString(),
  };
  if (minuteCount === null) {
    await recordHeadlessApiAudit(key.database, key.id, operation, 'rate_limited', 429, nowIso);
    return {
      allowed: false,
      errorResponse: headlessAuthError(
        'Batas request API key per menit telah tercapai.',
        'API_RATE_LIMITED',
        429,
        minuteHeaders,
      ),
    };
  }

  const dayBucket = nowIso.slice(0, 10);
  const dailyCount = await consumeUsageBucket(
    key.database,
    key.id,
    'day',
    dayBucket,
    key.dailyQuota,
  );
  const usageHeaders = {
    ...minuteHeaders,
    'X-DailyQuota-Remaining': String(Math.max(0, key.dailyQuota - (dailyCount ?? key.dailyQuota))),
  };
  if (dailyCount === null) {
    await recordHeadlessApiAudit(key.database, key.id, operation, 'quota_exhausted', 429, nowIso);
    return {
      allowed: false,
      errorResponse: headlessAuthError(
        'Kuota harian API key telah habis.',
        'API_QUOTA_EXHAUSTED',
        429,
        usageHeaders,
      ),
    };
  }

  await key.database.prepare(`
    UPDATE developer_api_keys
    SET last_used_at = ?
    WHERE id = ?
  `).bind(nowIso, key.id).run();

  return { allowed: true, corsHeaders: usageHeaders };
}

/**
 * Extracts origin from Request using Origin header or Referer header URL.
 */
export function getRequestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null' && origin !== 'undefined') {
    return origin.trim();
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      // Invalid referer
    }
  }

  return null;
}

/**
 * Parses a domain pattern into a structural matcher.
 * Supports:
 * - "*" (open access)
 * - "example.com", "https://example.com" (exact domain)
 * - "*.example.com", "https://*.example.com" (wildcard subdomains)
 * - "localhost", "127.0.0.1" (local development)
 */
export function parseDomainPattern(pattern: string): {
  raw: string;
  host: string;
  isWildcardSubdomain: boolean;
  scheme?: string;
  port?: string;
} | null {
  const raw = pattern.trim().toLowerCase();
  if (!raw) return null;
  if (raw === '*') return { raw: '*', host: '*', isWildcardSubdomain: false };

  let work = raw;
  let scheme: string | undefined;
  if (work.startsWith('http://')) {
    scheme = 'http:';
    work = work.slice(7);
  } else if (work.startsWith('https://')) {
    scheme = 'https:';
    work = work.slice(8);
  }

  const slashIdx = work.indexOf('/');
  if (slashIdx !== -1) {
    work = work.slice(0, slashIdx);
  }

  let port: string | undefined;
  const colonIdx = work.indexOf(':');
  if (colonIdx !== -1) {
    port = work.slice(colonIdx + 1);
    work = work.slice(0, colonIdx);
  }

  let isWildcardSubdomain = false;
  if (work.startsWith('*.')) {
    isWildcardSubdomain = true;
    work = work.slice(2);
  } else if (work.startsWith('*')) {
    isWildcardSubdomain = true;
    work = work.slice(1);
  }

  if (!work) return null;

  return {
    raw,
    host: work,
    isWildcardSubdomain,
    scheme,
    port,
  };
}
export const MAX_HEADLESS_ALLOWED_ORIGINS = 25;

export function parseHeadlessAllowedOrigins(value: unknown): {
  patterns: string[];
  valid: boolean;
} {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : null;
  if (!candidates || candidates.length > MAX_HEADLESS_ALLOWED_ORIGINS * 4) {
    return { patterns: [], valid: false };
  }

  const patterns = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') return { patterns: [], valid: false };
    const pattern = candidate.trim().toLowerCase();
    if (!pattern) continue;
    const hostPart = pattern.replace(/^https?:\/\//, '');
    const wildcardValid = !hostPart.startsWith('*') || hostPart.startsWith('*.');
    const parsed = parseDomainPattern(pattern);
    const hostValid =
      parsed?.host === 'localhost' ||
      parsed?.host === '127.0.0.1' ||
      Boolean(parsed?.host.match(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/));
    const portValid = !parsed?.port || /^\d{1,5}$/.test(parsed.port);
    if (
      pattern.length > 300 ||
      pattern === '*' ||
      /[/?#@]/.test(hostPart) ||
      !wildcardValid ||
      !parsed ||
      !hostValid ||
      !portValid
    ) {
      return { patterns: [], valid: false };
    }
    patterns.add(pattern);
    if (patterns.size > MAX_HEADLESS_ALLOWED_ORIGINS) {
      return { patterns: [], valid: false };
    }
  }

  return { patterns: [...patterns], valid: true };
}


/**
 * Checks whether an incoming origin string matches a single domain pattern.
 */
export function matchOriginAgainstPattern(originUrlStr: string, patternStr: string): boolean {
  const parsedPattern = parseDomainPattern(patternStr);
  if (!parsedPattern) return false;
  if (parsedPattern.raw === '*') return true;

  let originHost = originUrlStr.trim().toLowerCase();
  let originScheme: string | undefined;
  let originPort: string | undefined;

  try {
    const url = new URL(originUrlStr.startsWith('http') ? originUrlStr : `https://${originUrlStr}`);
    originHost = url.hostname.toLowerCase();
    originScheme = url.protocol;
    originPort = url.port || (originScheme === 'https:' ? '443' : '80');
  } catch {
    // Treat raw input as hostname if not parseable URL
  }

  // Handle local development origins
  if (
    (parsedPattern.host === 'localhost' || parsedPattern.host === '127.0.0.1') &&
    (originHost === 'localhost' || originHost === '127.0.0.1')
  ) {
    return true;
  }

  // Scheme matching if explicitly required by pattern
  if (parsedPattern.scheme && originScheme && parsedPattern.scheme !== originScheme) {
    return false;
  }

  // Port matching if explicitly required by pattern
  if (parsedPattern.port && originPort && parsedPattern.port !== originPort) {
    return false;
  }

  // Domain & Subdomain matching
  if (parsedPattern.isWildcardSubdomain) {
    // Matches sub.domain.com AND base domain.com
    return originHost === parsedPattern.host || originHost.endsWith(`.${parsedPattern.host}`);
  }

  // Exact host match
  return originHost === parsedPattern.host;
}

/**
 * Checks if a given origin is allowed under the provided pattern list.
 * Note: If no origin is provided (server-to-server / curl / native apps), returns true.
 */
export function isOriginAllowed(requestOrigin: string | null, allowedPatterns: string[]): boolean {
  // Server-to-server, cURL, or native app requests without browser origin header are allowed
  if (!requestOrigin) return true;

  if (!allowedPatterns || allowedPatterns.length === 0) return true;

  for (const pattern of allowedPatterns) {
    if (matchOriginAgainstPattern(requestOrigin, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves the full list of allowed domain/subdomain patterns for the headless system.
 */
type AllowedOriginInput = string | AllowedOriginInput[] | null | undefined;

export function resolveAllowedOrigins(
  locals?: App.Locals,
  extraAllowed?: AllowedOriginInput
): string[] {
  const patterns: string[] = [];

  const addPatterns = (input: unknown) => {
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach((item) => addPatterns(item));
      return;
    }
    if (typeof input === 'string') {
      input.split(/[,\n]/).forEach((p) => {
        const trimmed = p.trim();
        if (trimmed) patterns.push(trimmed);
      });
    }
  };

  addPatterns(extraAllowed);

  try {
    const env = getRuntimeEnv(locals);
    if (env) {
      addPatterns(env.PUBLIC_HEADLESS_ALLOWED_ORIGINS);
      addPatterns(env.PUBLIC_SITE_URL);
    }
  } catch {
    // Fallback if env is unavailable
  }

  // Default local development origins
  patterns.push('localhost', '127.0.0.1');

  return [...new Set(patterns)];
}
async function loadStoredHeadlessAllowedOrigins(locals?: App.Locals) {
  try {
    const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
    if (!database?.prepare) return null;
    const row = await database
      .prepare('SELECT headless_allowed_origins FROM stores ORDER BY id LIMIT 1')
      .first<{ headless_allowed_origins: string | null }>();
    return row?.headless_allowed_origins ?? null;
  } catch {
    return null;
  }
}

/**
 * Builds dynamic CORS response headers tailored to the request origin.
 */
export function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': requestOrigin || '*',
    'Access-Control-Allow-Credentials': 'true',
    ...DEFAULT_CORS_HEADERS,
  };
}

/**
 * Validates incoming Headless API requests against the domain/subdomain allowlist
 * and a live developer API key.
 */
export async function validateHeadlessRequest(
  request: Request,
  locals: App.Locals | undefined,
  options: {
    operation: HeadlessOperation;
    extraAllowed?: string | string[] | null;
  },
): Promise<
  | {
      allowed: false;
      origin: string | null;
      corsHeaders: Record<string, string>;
      apiKeyId?: number;
      errorResponse: Response;
    }
  | {
      allowed: true;
      origin: string | null;
      corsHeaders: Record<string, string>;
      apiKeyId: number;
      finalize: (response: Response) => Promise<Response>;
    }
> {
  const origin = getRequestOrigin(request);
  const allowedPatterns = resolveAllowedOrigins(locals, [
    options.extraAllowed,
    await loadStoredHeadlessAllowedOrigins(locals),
  ]);
  const initialCorsHeaders = buildCorsHeaders(origin);

  const auth = await validateHeadlessApiKey(
    request,
    locals,
    initialCorsHeaders,
    options.operation,
    HEADLESS_OPERATIONS[options.operation].scope,
  );
  if (!auth.allowed) {
    return {
      allowed: false,
      origin,
      corsHeaders: initialCorsHeaders,
      errorResponse: auth.errorResponse,
    };
  }

  const corsHeaders = auth.key.corsHeaders;
  const allowed = isOriginAllowed(origin, allowedPatterns);
  if (!allowed && origin) {
    try {
      await recordHeadlessApiAudit(
        auth.key.database,
        auth.key.id,
        options.operation,
        'origin_denied',
        403,
        new Date().toISOString(),
      );
    } catch {
      return {
        allowed: false,
        origin,
        corsHeaders,
        errorResponse: headlessAuthError(
          'Audit penggunaan API tidak dapat disimpan.',
          'API_AUDIT_UNAVAILABLE',
          503,
          corsHeaders,
        ),
      };
    }
    const errorResponse = headlessJson(
      {
        success: false,
        timestamp: new Date().toISOString(),
        error: {
          message: `Akses ditolak: Domain origin '${origin}' tidak terdaftar dalam allowlist domain/subdomain Headless API.`,
          code: 'ORIGIN_FORBIDDEN',
          origin,
          allowed_domains: allowedPatterns.filter((p) => p !== 'localhost' && p !== '127.0.0.1'),
        },
      },
      403,
      corsHeaders,
    );
    return {
      allowed: false,
      origin,
      corsHeaders,
      apiKeyId: auth.key.id,
      errorResponse,
    };
  }

  let usage;
  try {
    usage = await enforceHeadlessUsageLimits(auth.key, options.operation);
  } catch {
    return {
      allowed: false,
      origin,
      corsHeaders,
      errorResponse: headlessAuthError(
        'Kebijakan penggunaan API tidak dapat diterapkan.',
        'API_KEY_POLICY_UNAVAILABLE',
        503,
        corsHeaders,
      ),
    };
  }
  if (!usage.allowed) {
    return {
      allowed: false,
      origin,
      corsHeaders,
      apiKeyId: auth.key.id,
      errorResponse: usage.errorResponse,
    };
  }

  let finalized = false;
  const finalize = async (response: Response) => {
    if (finalized) return response;
    finalized = true;
    try {
      await recordHeadlessApiAudit(
        auth.key.database,
        auth.key.id,
        options.operation,
        'allowed',
        response.status,
        new Date().toISOString(),
      );
    } catch (error) {
      console.error('headless-api-audit-write-failed', {
        operation: options.operation,
        statusCode: response.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return response;
  };

  return {
    allowed: true,
    origin,
    corsHeaders: usage.corsHeaders,
    apiKeyId: auth.key.id,
    finalize,
  };
}

/**
 * Every `/api/v1` response is gated by a developer API key, but shared caches key on the
 * request URL and never on that key, so a `public` response would be stored once and then
 * replayed to callers holding no key at all. Client-side caching stays allowed; shared-cache
 * storage does not. Routes may narrow this further (e.g. `no-store`), never widen it.
 */
const AUTHENTICATED_CACHE_CONTROL = 'private, max-age=60';

export function headlessJson(
  data: Record<string, unknown>,
  status = 200,
  extraHeaders?: HeadersInit
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? AUTHENTICATED_CACHE_CONTROL : 'no-store',
      ...DEFAULT_CORS_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}

export function headlessOk(
  data: Record<string, unknown>,
  status = 200,
  extraHeaders?: HeadersInit
) {
  return headlessJson({ success: true, timestamp: new Date().toISOString(), ...data }, status, extraHeaders);
}

/**
 * Always pass `validation.corsHeaders` from `validateHeadlessRequest` so a browser-based
 * integration can read the error body instead of seeing an opaque network failure. Without
 * it the response carries no `Access-Control-Allow-Origin` at all — the error path echoes
 * exactly the origin the success path would, never a blanket `*`.
 */
export function headlessError(
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
  corsHeaders?: Record<string, string>
) {
  return headlessJson(
    {
      success: false,
      timestamp: new Date().toISOString(),
      error: {
        message,
        code: extra?.code || 'BAD_REQUEST',
        ...(extra || {}),
      },
    },
    status,
    { ...(corsHeaders || {}), 'cache-control': 'no-store' }
  );
}

export const handleOptions: APIRoute = async ({ request, locals }) => {
  const origin = getRequestOrigin(request);
  const allowedPatterns = resolveAllowedOrigins(
    locals,
    await loadStoredHeadlessAllowedOrigins(locals),
  );
  const corsHeaders = buildCorsHeaders(origin);
  if (!isOriginAllowed(origin, allowedPatterns) && origin) {
    return headlessJson(
      {
        success: false,
        timestamp: new Date().toISOString(),
        error: {
          message: `Akses ditolak: Domain origin '${origin}' tidak terdaftar dalam allowlist domain/subdomain Headless API.`,
          code: 'ORIGIN_FORBIDDEN',
          origin,
          allowed_domains: allowedPatterns.filter((p) => p !== 'localhost' && p !== '127.0.0.1'),
        },
      },
      403,
      corsHeaders
    );
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};
