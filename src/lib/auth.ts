/** Admin session cookie. Exported so every setter, reader, and deleter shares one name. */
export const SESSION_COOKIE_NAME = 'adsbook_session';
const JWT_ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

/**
 * Cookie security follows the transport the browser is actually using.
 * `wrangler dev` serves a production build over plain HTTP, so build mode is
 * not a transport signal and would make the browser discard the session.
 */
export function shouldSecureSessionCookie(url: URL) {
  return url.protocol === 'https:';
}

export const ADMIN_ROLES = [
  'owner',
  'admin',
  'advertiser',
  'customer_service',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminSession = {
  username: string;
  role: AdminRole;
  jti: string;
  iat: number;
  exp: number;
};

const ADMIN_PAGE_ROUTES = [
  '/admin/dashboard',
  '/admin/analytics',
  '/admin/orders',
  '/admin/products',
  '/admin/landing-pages',
  '/admin/content',
  '/admin/shipping',
  '/admin/check',
  '/admin/couriers',
  '/admin/expeditions',
  '/admin/payments',
  '/admin/balance',
  '/admin/ads',
  '/admin/profile',
  '/admin/settings/store',
  '/admin/settings/developer',
  '/admin/settings/warehouse',
  '/admin/settings/crm',
  '/admin/settings/plugins',
  '/admin/settings/whatsapp',
  '/admin/status',
] as const;

const ADMIN_API_ROUTES = [
  '/api/admin/analytics',
  // The Analitik menu (PRD A37). Not beneath `/api/admin/analytics`:
  // `matchesRoute` is a prefix match and customer service holds that entry.
  '/api/admin/insights',
  '/api/admin/abandoned-orders',
  '/api/admin/health',
  '/api/admin/orders',
  '/api/admin/products',
  '/api/admin/landing-pages',
  '/api/admin/content',
  '/api/admin/shipping',
  '/api/admin/check',
  '/api/admin/ongkir',
  '/api/admin/expeditions',
  '/api/admin/rules',
  '/api/admin/settings/developer',
  '/api/admin/ads',
  '/api/admin/media',
  '/api/admin/upload-r2',
  '/api/admin/seller-bank-accounts',
  '/api/admin/payment-reconciliation',
  '/api/admin/notifications',
  '/api/admin/whatsapp-numbers',
  '/api/admin/warehouses',
  '/api/admin/profile',
  '/api/admin/plugins',
  '/api/admin/logout',
] as const;

const ROLE_PAGE_ROUTES: Record<Exclude<AdminRole, 'owner' | 'admin'>, readonly string[]> = {
  advertiser: [
    '/admin/dashboard',
    '/admin/analytics',
    '/admin/products',
    '/admin/landing-pages',
    '/admin/content',
    '/admin/ads',
    '/admin/profile',
  ],
  customer_service: [
    '/admin/dashboard',
    '/admin/orders',
    '/admin/shipping',
    '/admin/check',
    '/admin/profile',
  ],
};

const ROLE_API_ROUTES: Record<Exclude<AdminRole, 'owner' | 'admin'>, readonly string[]> = {
  advertiser: [
    '/api/admin/analytics',
    '/api/admin/insights',
    '/api/admin/products',
    '/api/admin/landing-pages',
    '/api/admin/content',
    '/api/admin/media',
    '/api/admin/ads',
    '/api/admin/upload-r2',
    '/api/admin/profile',
    '/api/admin/logout',
  ],
  customer_service: [
    '/api/admin/analytics',
    '/api/admin/abandoned-orders',
    '/api/admin/orders',
    '/api/admin/shipping',
    '/api/admin/check',
    '/api/admin/ongkir',
    '/api/admin/notifications',
    '/api/admin/profile',
    '/api/admin/logout',
  ],
};

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);
}

export function getDefaultAdminRoute(_role: AdminRole) {
  return '/admin/dashboard';
}

export function canAccessAdminRoute(role: AdminRole, pathname: string) {
  // Default-deny first, so no grant below is reachable by a role that is not an
  // admin role. This ordering is load-bearing; do not move a grant above it.
  if (!isAdminRole(role)) return false;
  // `/admin` renders nothing of its own: both the middleware and the page itself
  // redirect to the role's default route, which every role may reach.
  if (pathname === '/admin') return true;
  if (role === 'owner') return true;
  if (role === 'admin') {
    if (
      pathname === '/admin/settings' ||
      pathname === '/admin/settings/' ||
      pathname === '/api/admin/settings' ||
      pathname === '/api/admin/settings/'
    ) return true;
    const routes = pathname.startsWith('/api/admin')
      ? ADMIN_API_ROUTES
      : ADMIN_PAGE_ROUTES;
    return routes.some((route) => matchesRoute(pathname, route));
  }
  const routes = pathname.startsWith('/api/admin')
    ? ROLE_API_ROUTES[role]
    : ROLE_PAGE_ROUTES[role];
  return routes.some((route) => matchesRoute(pathname, route));
}
function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(normalized + padding), (character) => character.charCodeAt(0));
}

async function importSigningKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), JWT_ALGORITHM, false, usage);
}

export async function signJwt(payload: { username: string; role: AdminRole }, secret: string) {
  if (secret.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters.');

  const now = Math.floor(Date.now() / 1000);
  const session: AdminSession = {
    ...payload,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 24 * 60 * 60,
  };
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(session));
  const unsignedToken = `${header}.${body}`;
  const key = await importSigningKey(secret, ['sign']);
  const signature = await crypto.subtle.sign(JWT_ALGORITHM, key, new TextEncoder().encode(unsignedToken));
  return { token: `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`, session };
}

export async function verifyJwt(rawToken: string, secret: string): Promise<AdminSession | null> {
  try {
    if (secret.length < 32) return null;
    const parts = rawToken.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as Record<string, unknown>;
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const key = await importSigningKey(secret, ['verify']);
    const verified = await crypto.subtle.verify(
      JWT_ALGORITHM,
      key,
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!verified) return null;

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as Partial<AdminSession>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.username !== 'string' ||
      payload.username.length === 0 ||
      typeof payload.jti !== 'string' ||
      payload.jti.length < 16 ||
      !isAdminRole(payload.role) ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.iat > now + 60 ||
      payload.exp <= now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 24 * 60 * 60
    ) return null;

    return payload as AdminSession;
  } catch {
    return null;
  }
}

export async function secureEqual(left: string, right: string) {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(left)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(right)),
  ]);
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

export async function verifyPasswordHash(password: string, encodedHash: string) {
  try {
    const [algorithm, iterationsRaw, saltRaw, expectedRaw] = encodedHash.split('$');
    const iterations = Number(iterationsRaw);
    if (algorithm !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
    const salt = decodeBase64Url(saltRaw);
    const expected = decodeBase64Url(expectedRaw);
    if (salt.length < 16 || expected.length !== 32) return false;

    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const actual = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key,
      expected.length * 8,
    ));
    let mismatch = 0;
    for (let index = 0; index < expected.length; index += 1) mismatch |= actual[index] ^ expected[index];
    return mismatch === 0;
  } catch {
    return false;
  }
}

export function getSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
