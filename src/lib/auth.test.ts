import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import {
  ADMIN_ROLES,
  canAccessAdminRoute,
  getDefaultAdminRoute,
  getSessionCookie,
  isAdminRole,
  shouldSecureSessionCookie,
  signJwt,
  verifyJwt,
} from './auth.ts';
import type { AdminRole, AdminSession } from './auth.ts';

const AUTH_SECRET = 'unit-test-auth-secret-0123456789abcdef';
const OTHER_SECRET = 'unit-test-auth-secret-fedcba9876543210';

test('session cookie security follows the request transport, not build mode', () => {
  assert.equal(shouldSecureSessionCookie(new URL('https://store.example/hello')), true);
  assert.equal(shouldSecureSessionCookie(new URL('http://100.127.67.86:8790/hello')), false);
});

// The admin gate that consumes these tokens lives in `src/middleware.ts`, which
// imports the virtual `astro:middleware` module and extensionless specifiers.
// Stub the virtual module and re-add `.ts` so the credential-rotation contract
// can be exercised against the production handler instead of a copy of it.
const ASTRO_MIDDLEWARE_STUB = 'stub:astro-middleware';
const middlewareHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'astro:middleware') {
      return { url: ASTRO_MIDDLEWARE_STUB, shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isRelativeWithoutExtension =
        specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier);
      if (!isRelativeWithoutExtension) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
  load(url, context, nextLoad) {
    if (url === ASTRO_MIDDLEWARE_STUB) {
      return {
        format: 'module',
        source: 'export const defineMiddleware = (handler) => handler;',
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const { createMiddleware } = await import('../middleware.ts');
middlewareHooks.deregister();
const onRequest = createMiddleware(async () => undefined);

function encodeSegment(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeSegment(segment: string) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Produce a token that carries a genuine HMAC signature over an arbitrary
 * header/payload. This separates "is the signature real?" from "are the claims
 * trustworthy?" — a forged-but-signed token must still be rejected on claims.
 */
async function forgeSignedToken(header: unknown, payload: unknown, secret = AUTH_SECRET) {
  const unsigned = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'HMAC', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
}

function validClaims(overrides: Partial<AdminSession> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    username: 'paduka.admin',
    role: 'advertiser',
    jti: '4f2f2b0e-8f3a-4a54-9d33-9b7f2c1d5e6a',
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

/** Sign as if the clock read `offsetSeconds` from now, then restore the clock. */
async function signAtClockOffset(offsetSeconds: number, role: AdminRole = 'advertiser') {
  const realNow = Date.now;
  Date.now = () => realNow() + offsetSeconds * 1000;
  try {
    return await signJwt({ username: 'paduka.admin', role }, AUTH_SECRET);
  } finally {
    Date.now = realNow;
  }
}

test('a signed session token round-trips its claims through verification', async () => {
  const before = Math.floor(Date.now() / 1000);
  const { token, session } = await signJwt({ username: 'paduka.admin', role: 'owner' }, AUTH_SECRET);

  assert.equal(token.split('.').length, 3);
  assert.equal(session.username, 'paduka.admin');
  assert.equal(session.role, 'owner');
  assert.ok(session.jti.length >= 16);
  assert.equal(session.exp - session.iat, 24 * 60 * 60);
  assert.ok(session.iat >= before);

  const verified = await verifyJwt(token, AUTH_SECRET);
  assert.deepEqual(verified, session);

  // Two sessions never share a token id, so revoking one cannot revoke another.
  const second = await signJwt({ username: 'paduka.admin', role: 'owner' }, AUTH_SECRET);
  assert.notEqual(second.session.jti, session.jti);
});

test('a token signed with a different secret is rejected', async () => {
  const { token } = await signJwt({ username: 'paduka.admin', role: 'owner' }, OTHER_SECRET);
  assert.equal(await verifyJwt(token, AUTH_SECRET), null);

  // A one-character secret difference must not verify either.
  const { token: nearMiss } = await signJwt(
    { username: 'paduka.admin', role: 'owner' },
    `${AUTH_SECRET}x`,
  );
  assert.equal(await verifyJwt(nearMiss, AUTH_SECRET), null);
});

test('a tampered payload, header, or signature is rejected', async () => {
  const { token } = await signJwt({ username: 'paduka.admin', role: 'advertiser' }, AUTH_SECRET);
  const [header, payload, signature] = token.split('.');

  // Privilege escalation by rewriting the payload, keeping the original signature.
  const escalated = { ...decodeSegment(payload), role: 'owner' };
  assert.equal(await verifyJwt(`${header}.${encodeSegment(escalated)}.${signature}`, AUTH_SECRET), null);

  // Lifetime extension by rewriting `exp`.
  const extended = { ...decodeSegment(payload), exp: Math.floor(Date.now() / 1000) + 31_536_000 };
  assert.equal(await verifyJwt(`${header}.${encodeSegment(extended)}.${signature}`, AUTH_SECRET), null);

  // Algorithm downgrade to `none` with an empty signature.
  assert.equal(
    await verifyJwt(`${encodeSegment({ alg: 'none', typ: 'JWT' })}.${payload}.`, AUTH_SECRET),
    null,
  );

  // A signature borrowed from a different, equally valid token.
  const other = await signJwt({ username: 'paduka.admin', role: 'advertiser' }, AUTH_SECRET);
  const borrowed = other.token.split('.')[2];
  assert.notEqual(borrowed, signature);
  assert.equal(await verifyJwt(`${header}.${payload}.${borrowed}`, AUTH_SECRET), null);

  // A single flipped signature character. Flip the FIRST character, not the
  // last: a 32-byte HMAC encodes to 43 base64url chars, and the final char
  // carries only 2 significant bits, so several different trailing characters
  // decode to identical bytes. Flipping the last one leaves the signature
  // unchanged whenever it happens to land in the same class, which made this
  // assertion fail intermittently. The first character is fully significant.
  const flippedChar = signature[0] === 'A' ? 'B' : 'A';
  assert.equal(
    await verifyJwt(`${header}.${payload}.${flippedChar}${signature.slice(1)}`, AUTH_SECRET),
    null,
  );

  // Segments swapped between header and payload.
  assert.equal(await verifyJwt(`${payload}.${header}.${signature}`, AUTH_SECRET), null);
});

test('a genuinely signed token is still rejected when its claims are unusable', async () => {
  // Control: a hand-built but well-formed token verifies, so the cases below
  // fail on claim validation rather than on the signature.
  assert.notEqual(await verifyJwt(await forgeSignedToken({ alg: 'HS256', typ: 'JWT' }, validClaims()), AUTH_SECRET), null);

  const rejected: unknown[] = [
    { alg: 'HS512', typ: 'JWT' },
    { alg: 'none', typ: 'JWT' },
    { alg: 'HS256', typ: 'JWS' },
    { typ: 'JWT' },
  ];
  for (const header of rejected) {
    const token = await forgeSignedToken(header, validClaims());
    assert.equal(await verifyJwt(token, AUTH_SECRET), null, `header ${JSON.stringify(header)} must not verify`);
  }

  const badClaims: Array<Record<string, unknown>> = [
    { role: 'superadmin' },
    { role: 'Owner' },
    { role: undefined },
    { username: '' },
    { username: 42 },
    { jti: 'short-jti' },
    { jti: undefined },
    { iat: String(Math.floor(Date.now() / 1000)) },
    { exp: undefined },
    { exp: String(Math.floor(Date.now() / 1000) + 3600) },
  ];
  for (const overrides of badClaims) {
    const token = await forgeSignedToken({ alg: 'HS256', typ: 'JWT' }, { ...validClaims(), ...overrides });
    assert.equal(await verifyJwt(token, AUTH_SECRET), null, `claims ${JSON.stringify(overrides)} must not verify`);
  }
});

test('token lifetime and clock skew are enforced in both directions', async () => {
  const live = await signAtClockOffset(-60 * 60);
  assert.notEqual(await verifyJwt(live.token, AUTH_SECRET), null);

  const expired = await signAtClockOffset(-25 * 60 * 60);
  assert.equal(await verifyJwt(expired.token, AUTH_SECRET), null);

  // Exactly at `exp` the session is already over.
  const atBoundary = await signAtClockOffset(-24 * 60 * 60);
  assert.equal(await verifyJwt(atBoundary.token, AUTH_SECRET), null);

  // A token minted in the future beyond the 60s skew allowance is refused,
  // so a forward-dated clock cannot mint a longer-lived session.
  const farFuture = await signAtClockOffset(60 * 60);
  assert.equal(await verifyJwt(farFuture.token, AUTH_SECRET), null);

  const withinSkew = await signAtClockOffset(30);
  assert.notEqual(await verifyJwt(withinSkew.token, AUTH_SECRET), null);

  const now = Math.floor(Date.now() / 1000);
  const overlong = await forgeSignedToken(
    { alg: 'HS256', typ: 'JWT' },
    validClaims({ iat: now, exp: now + 24 * 60 * 60 + 1 }),
  );
  assert.equal(await verifyJwt(overlong, AUTH_SECRET), null);
});

test('a malformed or corrupt token degrades to no session instead of throwing', async () => {
  const malformed: unknown[] = [
    '',
    ' ',
    'not-a-token',
    'a.b',
    'a.b.c.d',
    'a.b.c',
    '..',
    '%',
    '%%%.%%%.%%%',
    'eyJhbGciOiJIUzI1NiJ9.!!!not-base64!!!.zzzz',
    null,
    undefined,
    0,
    {},
    [],
  ];
  for (const value of malformed) {
    const result = await verifyJwt(value as string, AUTH_SECRET);
    assert.equal(result, null, `${String(value)} must resolve to no session`);
  }

  // A valid token read with an unusable secret must also fail closed rather
  // than fall back to an unsigned trust path.
  const { token } = await signJwt({ username: 'paduka.admin', role: 'owner' }, AUTH_SECRET);
  assert.equal(await verifyJwt(token, ''), null);
  assert.equal(await verifyJwt(token, 'too-short-secret'), null);
  await assert.rejects(
    () => signJwt({ username: 'paduka.admin', role: 'owner' }, 'too-short-secret'),
    /at least 32 characters/,
  );
});

test('the session cookie is read only under its exact name', async () => {
  const { token } = await signJwt({ username: 'paduka.admin', role: 'owner' }, AUTH_SECRET);
  const read = (cookie?: string) =>
    getSessionCookie(new Request('https://admin.test/admin', cookie ? { headers: { cookie } } : undefined));

  assert.equal(read(`adsbook_session=${token}`), token);
  assert.equal(read(`theme=dark; adsbook_session=${token}; other=1`), token);
  assert.equal(read(`adsbook_session=${encodeURIComponent(token)}`), token);
  assert.equal(read(), null);
  assert.equal(read('theme=dark'), null);
  // A cookie whose name merely ends with the session name must not be accepted.
  assert.equal(read('xadsbook_session=forged'), null);
  assert.equal(read('evil_adsbook_session=forged'), null);
});

test('a session is closed once the credential behind it rotates', async () => {
  const { token, session } = await signJwt({ username: 'paduka.admin', role: 'advertiser' }, AUTH_SECRET);
  const issuedAt = '2026-08-16T00:00:00.000Z';
  const storedRecord = JSON.stringify({
    username: session.username,
    role: session.role,
    must_change_password: false,
    credential_updated_at: issuedAt,
  });

  // Same token, same session row: only the stored credential row changes.
  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token, stored: storedRecord, credential: { updated_at: issuedAt, role: 'advertiser' } })).status, 200);

  // Rotation bumps `updated_at`, which is the session revision.
  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token, stored: storedRecord, credential: { updated_at: '2026-08-16T09:30:00.000Z', role: 'advertiser' } })).status, 401);

  // A role change invalidates the token's authorisation snapshot too.
  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token, stored: storedRecord, credential: { updated_at: issuedAt, role: 'customer_service' } })).status, 401);

  // A deleted operator has no credential row left to match.
  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token, stored: storedRecord, credential: null })).status, 401);

  // A revoked (deleted) session row closes the gate as well.
  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token, stored: null, credential: { updated_at: issuedAt, role: 'advertiser' } })).status, 401);

  // The same rotation on a page route sends the operator back to the login page.
  const pageResponse = await runAdminRequest({
    pathname: '/admin/products',
    token,
    stored: storedRecord,
    credential: { updated_at: '2026-08-16T09:30:00.000Z', role: 'advertiser' },
  });
  assert.equal(pageResponse.headers.get('location'), '/hello');
});

test('a session record belonging to another operator cannot be reused', async () => {
  const { token, session } = await signJwt({ username: 'paduka.admin', role: 'advertiser' }, AUTH_SECRET);
  const updatedAt = '2026-08-16T00:00:00.000Z';
  const request = (stored: unknown) =>
    runAdminRequest({
      pathname: '/api/admin/products',
      token,
      stored: typeof stored === 'string' ? stored : JSON.stringify(stored),
      credential: { updated_at: updatedAt, role: 'advertiser' },
    });

  assert.equal((await request({ username: 'someone.else', role: session.role, credential_updated_at: updatedAt })).status, 401);
  assert.equal((await request({ username: session.username, role: 'owner', credential_updated_at: updatedAt })).status, 401);
  assert.equal((await request({ username: session.username, role: session.role })).status, 401);
  assert.equal((await request('{ not json')).status, 401);
  assert.equal((await request({ username: session.username, role: session.role, credential_updated_at: updatedAt })).status, 200);
});

test('the admin gate refuses requests without a usable session token', async () => {
  const stored = JSON.stringify({
    username: 'paduka.admin',
    role: 'advertiser',
    credential_updated_at: '2026-08-16T00:00:00.000Z',
  });
  const credential = { updated_at: '2026-08-16T00:00:00.000Z', role: 'advertiser' };

  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token: null, stored, credential })).status, 401);
  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token: 'garbage', stored, credential })).status, 401);
  assert.equal((await runAdminRequest({ pathname: '/api/admin', token: null, stored, credential })).status, 401);

  const foreign = await signJwt({ username: 'paduka.admin', role: 'advertiser' }, OTHER_SECRET);
  assert.equal((await runAdminRequest({ pathname: '/api/admin/products', token: foreign.token, stored, credential })).status, 401);

  const pageResponse = await runAdminRequest({ pathname: '/admin/products', token: null, stored, credential });
  assert.equal(pageResponse.headers.get('location'), '/hello');
});

test('every admin role is confined to the routes it owns', () => {
  assert.deepEqual([...ADMIN_ROLES], ['owner', 'admin', 'advertiser', 'customer_service']);
  for (const role of ADMIN_ROLES) {
    assert.equal(isAdminRole(role), true);
    assert.equal(getDefaultAdminRoute(role), '/admin/dashboard');
    // Every role must reach the route it is redirected to after login.
    assert.equal(canAccessAdminRoute(role, '/admin/dashboard'), true);
  }

  // owner: unrestricted, including the access-control surface.
  assert.equal(canAccessAdminRoute('owner', '/admin/settings/access'), true);
  assert.equal(canAccessAdminRoute('owner', '/api/admin/access'), true);
  assert.equal(canAccessAdminRoute('owner', '/admin/anything/new'), true);

  // admin: explicit operational allowlist, excluding operator management.
  assert.equal(canAccessAdminRoute('admin', '/admin/settings'), true);
  assert.equal(canAccessAdminRoute('admin', '/api/admin/orders'), true);
  assert.equal(canAccessAdminRoute('admin', '/api/admin/abandoned-orders'), true);
  assert.equal(canAccessAdminRoute('admin', '/api/admin/payment-reconciliation'), true);
  assert.equal(canAccessAdminRoute('admin', '/admin/settings/access'), false);
  assert.equal(canAccessAdminRoute('admin', '/admin/settings/access/new'), false);
  assert.equal(canAccessAdminRoute('admin', '/api/admin/access'), false);
  assert.equal(canAccessAdminRoute('admin', '/api/admin/access/7'), false);

  // advertiser: catalogue, content, and ads only.
  assert.equal(canAccessAdminRoute('advertiser', '/admin/products'), true);
  assert.equal(canAccessAdminRoute('advertiser', '/admin/landing-pages/new'), true);
  assert.equal(canAccessAdminRoute('advertiser', '/admin/ads/campaigns'), true);
  assert.equal(canAccessAdminRoute('advertiser', '/api/admin/products/12'), true);
  assert.equal(canAccessAdminRoute('advertiser', '/api/admin/landing-pages/12'), true);
  assert.equal(canAccessAdminRoute('advertiser', '/admin/orders'), false);
  assert.equal(canAccessAdminRoute('advertiser', '/api/admin/orders'), false);
  assert.equal(canAccessAdminRoute('advertiser', '/api/admin/abandoned-orders'), false);
  assert.equal(canAccessAdminRoute('advertiser', '/api/admin/payment-reconciliation'), false);
  assert.equal(canAccessAdminRoute('advertiser', '/admin/settings/access'), false);
  assert.equal(canAccessAdminRoute('advertiser', '/api/admin/access'), false);

  // customer_service: order handling only, never the catalogue or ads.
  assert.equal(canAccessAdminRoute('customer_service', '/admin/orders'), true);
  assert.equal(canAccessAdminRoute('customer_service', '/admin/orders/abandoned'), true);
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/abandoned-orders'), true);
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/payment-reconciliation'), false);
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/shipping/label'), true);
  assert.equal(canAccessAdminRoute('customer_service', '/admin/products'), false);
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/products'), false);
  assert.equal(canAccessAdminRoute('customer_service', '/admin/ads'), false);
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/access'), false);

  // Both scoped roles keep their own profile and logout.
  for (const role of ['advertiser', 'customer_service'] as const) {
    assert.equal(canAccessAdminRoute(role, '/admin/profile'), true);
    assert.equal(canAccessAdminRoute(role, '/api/admin/profile'), true);
    assert.equal(canAccessAdminRoute(role, '/api/admin/logout'), true);
    assert.equal(canAccessAdminRoute(role, '/api/admin/health'), false);
  }
});

test('route matching is deny-by-default for unknown routes, roles, and prefix look-alikes', () => {
  // An allowed prefix must not leak into a sibling route that merely starts
  // with the same characters.
  assert.equal(canAccessAdminRoute('advertiser', '/admin/products-secret'), false);
  assert.equal(canAccessAdminRoute('advertiser', '/api/admin/productsx'), false);
  assert.equal(canAccessAdminRoute('customer_service', '/admin/ordersx'), false);
  assert.equal(canAccessAdminRoute('admin', '/admin/settings/accessible'), false);

  // A route nobody has been granted stays closed for scoped roles.
  assert.equal(canAccessAdminRoute('advertiser', '/admin/does-not-exist'), false);
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/does-not-exist'), false);
  assert.equal(canAccessAdminRoute('admin', '/admin/does-not-exist'), false);
  assert.equal(canAccessAdminRoute('admin', '/api/admin/does-not-exist'), false);

  // A role outside ADMIN_ROLES must never be granted a route. `verifyJwt`
  // already refuses such a session, so this is the second line of defence.
  // The call is made directly, without a try/catch: an authorisation function
  // that raises instead of denying is a 500 standing in for a decision, and a
  // caller that swallowed the throw would read it as a deny it never made.
  const unknownRoles: unknown[] = ['', 'guest', 'superadmin', 'OWNER', 'root', null, undefined, 0, ['owner']];
  for (const role of unknownRoles) {
    for (const pathname of ['/admin', '/admin/', '/admin/orders', '/admin/dashboard', '/api/admin', '/api/admin/access', '/api/admin/products']) {
      assert.equal(
        canAccessAdminRoute(role as AdminRole, pathname),
        false,
        `${String(role)} must be denied ${pathname} without throwing`,
      );
    }
    assert.equal(isAdminRole(role), false);
  }
});

/**
 * Enumerate the admin routes that actually exist, from the file router rather
 * than from a hand-kept list — a hand-kept list is the thing under test.
 * `index` collapses to its directory, `[param]` becomes a sample value, and an
 * Astro-private `_name` file is not a route.
 */
function listRoutesOnDisk(directory: string, prefix: string, extension: string) {
  const routes: string[] = [];
  const walk = (folder: URL, base: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue;
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, folder), `${base}/${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith(extension)) continue;
      const name = entry.name.slice(0, -extension.length);
      routes.push(name === 'index' ? base : `${base}/${name}`);
    }
  };
  walk(new URL(directory, import.meta.url), prefix);
  return routes.map((route) => route.replace(/\[[^\]]+\]/g, '42'));
}

test('the privileged allowlists cover every admin route that exists on disk', () => {
  // The other direction of the policy: denying an unlisted route is only safe
  // if the list is complete. A route added under `src/pages/admin` or
  // `src/pages/api/admin` without an allowlist entry locks an operator out of
  // their own admin, which no assertion about denied routes would catch.
  const routes = [
    ...listRoutesOnDisk('../pages/admin/', '/admin', '.astro'),
    ...listRoutesOnDisk('../pages/api/admin/', '/api/admin', '.ts'),
  ];
  assert.ok(routes.length > 30, `expected the admin route table, found ${routes.length} routes`);

  // Operator management is the one surface reserved to the owner.
  const ownerOnly = ['/admin/settings/access', '/api/admin/access'];
  for (const route of ownerOnly) {
    assert.ok(routes.includes(route), `${route} must exist for the exception to mean anything`);
  }

  for (const route of routes) {
    const reserved = ownerOnly.some((owned) => route === owned || route.startsWith(`${owned}/`));
    assert.equal(canAccessAdminRoute('owner', route), true, `owner must reach ${route}`);
    assert.equal(
      canAccessAdminRoute('admin', route),
      !reserved,
      `admin must ${reserved ? 'not ' : ''}reach ${route}`,
    );
  }

  // Every route a scoped role is granted must also still exist, so a stale
  // grant cannot outlive the page it was written for.
  for (const role of ['advertiser', 'customer_service'] as const) {
    const granted = routes.filter((route) => canAccessAdminRoute(role, route));
    assert.ok(granted.includes('/admin/dashboard'), `${role} must reach the dashboard`);
    assert.ok(
      granted.every((route) => !route.startsWith('/admin/settings/access') && !route.startsWith('/api/admin/access')),
      `${role} must never reach operator management`,
    );
  }
});

type CredentialRow = { updated_at: string; role: string } | null;

/**
 * The identity read, the credential read, and — since ADR-021 — the session
 * row joined to its credential. `stored` is the session record the login
 * wrote, as JSON, or null for a revoked one; unparseable JSON stands in for a
 * corrupt row and must read as no session.
 */
function createCredentialDatabase(row: CredentialRow, stored: string | null = null) {
  return {
    prepare: (query: string) => ({
      first: async () => ({ name: 'Test Store', slug: 'test-store' }),
      bind: () => ({
        first: async () => {
          if (!query.includes('FROM admin_sessions s')) return row;
          if (!stored) return null;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(stored) as Record<string, unknown>;
          } catch {
            return null;
          }
          return {
            username: parsed.username,
            role: parsed.role,
            must_change_password: parsed.must_change_password === true ? 1 : 0,
            credential_updated_at: parsed.credential_updated_at ?? null,
            current_updated_at: row?.updated_at ?? null,
            current_role: row?.role ?? null,
          };
        },
      }),
    }),
  } as unknown as D1Database;
}

/**
 * Astro's own path normalization, reproduced closely enough to test the gate
 * against the shapes an attacker sends: it decodes percent-escapes repeatedly
 * (so `%25%36%31` becomes `a`) and collapses runs of slashes.
 */
function normalizeAstroUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  let pathname = url.pathname;
  for (let pass = 0; pass < 5; pass += 1) {
    let decoded: string;
    try {
      decoded = decodeURI(pathname);
    } catch {
      break;
    }
    if (decoded === pathname) break;
    pathname = decoded;
  }
  url.pathname = pathname.replace(/\/{2,}/g, '/');
  return url;
}

async function runAdminRequest(options: {
  pathname: string;
  token: string | null;
  stored: string | null;
  credential: CredentialRow;
}) {
  const headers = new Headers();
  if (options.token) headers.set('cookie', `adsbook_session=${encodeURIComponent(options.token)}`);
  const request = new Request(`https://admin.test${options.pathname}`, { headers });
  const context = {
    request,
    // Astro hands middleware a normalized URL — percent-escapes decoded,
    // duplicate slashes collapsed — separately from the raw request, and the
    // gate reads that one. This harness previously supplied only `request`,
    // which is why it kept passing while `//api/admin/settings` walked past
    // every check in the built Worker.
    url: normalizeAstroUrl(request.url),
    locals: {
      runtimeEnv: {
        AUTH_SECRET,
        OMS_DB: createCredentialDatabase(options.credential, options.stored),
      },
    },
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(
    context as unknown as Parameters<typeof onRequest>[0],
    (async () => new Response('ok', { status: 200 })) as unknown as Parameters<typeof onRequest>[1],
  );
  assert.ok(response instanceof Response);
  return response;
}

test('the admin gate holds against paths Astro normalizes before routing', async () => {
  // Every one of these was measured returning 200 with real data on the built
  // Worker, with no cookie at all, because middleware classified the raw path
  // while Astro served the normalized one.
  const shapes = [
    '//api/admin/settings',
    '/api//admin/settings',
    '/%61pi/admin/settings',
    '//api/admin/orders',
    '//api/admin/analytics',
  ];

  for (const pathname of shapes) {
    const response = await runAdminRequest({
      pathname,
      token: null,
      stored: null,
      credential: null,
    });
    assert.equal(response.status, 401, `${pathname} must not reach a handler`);
  }

  for (const pathname of ['//admin/dashboard', '/%61dmin/orders', '//admin/orders']) {
    const response = await runAdminRequest({
      pathname,
      token: null,
      stored: null,
      credential: null,
    });
    assert.equal(response.status, 302, `${pathname} must be sent to the login screen`);
  }
});

test('the WhatsApp rotator page and API are owner and admin only (PRD A35)', () => {
  for (const pathname of ['/admin/settings/whatsapp', '/api/admin/whatsapp-numbers']) {
    assert.equal(canAccessAdminRoute('owner', pathname), true, `owner ${pathname}`);
    assert.equal(canAccessAdminRoute('admin', pathname), true, `admin ${pathname}`);
    assert.equal(canAccessAdminRoute('advertiser', pathname), false, `advertiser ${pathname}`);
    assert.equal(canAccessAdminRoute('customer_service', pathname), false, `cs ${pathname}`);
  }
});

test('the Analitik menu is owner, admin and advertiser; customer service gets 403 (PRD A37, A-356)', async () => {
  const insightPaths = [
    '/admin/analytics',
    '/admin/analytics/landing',
    '/api/admin/insights',
    '/api/admin/insights/landing',
    '/api/admin/insights/trend',
    '/api/admin/insights/products',
    '/api/admin/insights/locations',
    '/api/admin/insights/times',
    '/admin/analytics/utm',
    '/api/admin/insights/utm',
  ];
  for (const pathname of insightPaths) {
    for (const role of ['owner', 'admin', 'advertiser'] as const) {
      assert.equal(canAccessAdminRoute(role, pathname), true, `${role} must reach ${pathname}`);
    }
    assert.equal(canAccessAdminRoute('customer_service', pathname), false, `customer service must not reach ${pathname}`);
  }
  // The dashboard's own analytics stays open to every role, as before.
  for (const role of ADMIN_ROLES) {
    assert.equal(canAccessAdminRoute(role, '/api/admin/analytics'), true, `${role} keeps /api/admin/analytics`);
  }
  // The prefix trap the endpoints avoid: anything beneath /api/admin/analytics
  // is customer service's, so the insights must never live there.
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/analytics/landing'), true);
  assert.equal(canAccessAdminRoute('customer_service', '/api/admin/insightsx'), false);

  // Through the real gate: a customer-service session is refused with 403 on
  // every insights API, and an advertiser session passes.
  const issuedAt = '2026-08-16T00:00:00.000Z';
  for (const role of ['customer_service', 'advertiser', 'admin', 'owner'] as const) {
    const { token, session } = await signJwt({ username: `insights.${role}`, role }, AUTH_SECRET);
    const stored = JSON.stringify({
      username: session.username,
      role: session.role,
      must_change_password: false,
      credential_updated_at: issuedAt,
    });
    for (const pathname of insightPaths.filter((path) => path.startsWith('/api/'))) {
      const response = await runAdminRequest({ pathname, token, stored, credential: { updated_at: issuedAt, role } });
      assert.equal(response.status, role === 'customer_service' ? 403 : 200, `${role} ${pathname}`);
    }
  }
});
