import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ADMIN_PASSWORD_HASH,
  hashAdminPassword,
  isDefaultAdminCredential,
  normalizeAdminUsername,
  validateAdminUsername,
  validateNewAdminPassword,
  verifyAdminLoginPassword,
} from './admin-credentials.ts';
import { canAccessAdminRoute, isAdminRole, secureEqual, verifyPasswordHash, type AdminRole } from './auth.ts';

/**
 * This test previously asserted the opposite: that with no configured bootstrap
 * password nothing could open the seeded credential. That hardening made a
 * fresh install unreachable — the only accepted password came from an
 * environment variable no new Worker sets — so it was deliberately reversed on
 * 2026-08-16. See PRD-ADMIN-LOGIN.md LOGIN-1 through LOGIN-5 for the reasoning
 * and for what bounds the exposure.
 */
test('default admin credential opens a fresh install and nothing more', async () => {
  const defaultCredential = {
    username: 'admin',
    passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
  };
  assert.equal(isDefaultAdminCredential(defaultCredential), true);

  // Reachable on a fresh install, which is the point.
  assert.equal(await verifyAdminLoginPassword('admin', defaultCredential, ''), true);

  // A configured-but-too-short secret is still rejected outright rather than
  // degrading to the default, so a half-hearted configuration is not worse
  // than none.
  assert.equal(await verifyAdminLoginPassword('admin', defaultCredential, 'short'), false);
  assert.equal(
    await verifyAdminLoginPassword('bootstrap-secret-1234', defaultCredential, 'bootstrap-secret-1234'),
    true,
  );
  assert.equal(
    await verifyAdminLoginPassword('admin', defaultCredential, 'bootstrap-secret-1234'),
    false,
  );
});

test('new password hashes use random salts and verify through the login contract', async () => {
  const first = await hashAdminPassword('safe-password-123');
  const second = await hashAdminPassword('safe-password-123');
  assert.notEqual(first, second);
  assert.equal(await verifyPasswordHash('safe-password-123', first), true);
  assert.equal(await verifyPasswordHash('safe-password-124', first), false);
});

/**
 * LOGIN-13. The login screen levels its response time by running a discarded
 * verification against DEFAULT_ADMIN_PASSWORD_HASH whenever the real path would
 * be cheap — an unknown username, or the seeded credential's digest compare.
 * That only hides the difference while the constant is a verification the
 * runtime will actually perform: `verifyPasswordHash` returns false immediately
 * for a hash it cannot parse, so a malformed or weakened constant would turn
 * the floor back into free work and restore the leak without failing anything
 * else. This pins the constant, not the page.
 */
test('the login timing work floor is a real PBKDF2 verification', async () => {
  const [algorithm, iterations] = DEFAULT_ADMIN_PASSWORD_HASH.split('$');
  assert.equal(algorithm, 'pbkdf2-sha256');
  assert.ok(Number(iterations) >= 100_000, 'the floor must cost at least the product minimum');

  // Not short-circuited: a wrong password still runs the derivation and returns false.
  assert.equal(await verifyPasswordHash('not-the-seeded-password', DEFAULT_ADMIN_PASSWORD_HASH), false);

  // Medians of several runs, not one measurement each. The digest compare takes
  // a few hundredths of a millisecond, so a single GC pause or a busy CI runner
  // landing inside that one sample inflated it past floorCost / 10 and failed
  // the suite with nothing wrong in the code. A median ignores the outliers a
  // shared machine produces and still moves with a floor that became free work.
  const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];
  const measure = async (runs: number, work: () => Promise<unknown>) => {
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await work();
      samples.push(performance.now() - start);
    }
    return median(samples);
  };
  const floorCost = await measure(5, () => verifyPasswordHash('not-the-seeded-password', DEFAULT_ADMIN_PASSWORD_HASH));
  const compareCost = await measure(9, () => secureEqual('not-the-seeded-password', 'admin'));

  assert.ok(
    floorCost > compareCost * 10,
    `the floor (${floorCost.toFixed(2)}ms) must dominate the digest compare it hides (${compareCost.toFixed(2)}ms)`,
  );
});

test('admin usernames are normalized and restricted to URL-safe characters', () => {
  assert.equal(normalizeAdminUsername('  Paduka.Admin  '), 'paduka.admin');
  assert.equal(validateAdminUsername('paduka.admin'), true);
  assert.equal(validateAdminUsername('paduka admin'), false);
  assert.equal(validateAdminUsername('ab'), false);
});

test('new admin passwords reject weak defaults', () => {
  assert.equal(validateNewAdminPassword('abc', 'admin'), 'Password baru harus berisi 8–128 karakter.');
  assert.equal(validateNewAdminPassword('admin', 'admin'), 'Password baru tidak boleh menggunakan username atau password default.');
});

test("operator roles use one deny-by-default route policy", () => {
  assert.equal(isAdminRole("owner"), true);
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("advertiser"), true);
  assert.equal(isAdminRole("customer_service"), true);
  assert.equal(isAdminRole("guest" as AdminRole), false);

  assert.equal(canAccessAdminRoute("owner", "/admin/settings"), true);
  assert.equal(canAccessAdminRoute("admin", "/admin/settings"), true);
  assert.equal(canAccessAdminRoute("advertiser", "/admin/settings"), false);
  assert.equal(canAccessAdminRoute("customer_service", "/admin/orders"), true);
  assert.equal(canAccessAdminRoute("customer_service", "/admin/settings"), false);
  assert.equal(canAccessAdminRoute("advertiser", "/admin/content"), true);
  assert.equal(canAccessAdminRoute("advertiser", "/admin/products"), true);
});
