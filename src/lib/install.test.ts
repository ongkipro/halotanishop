import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_COURIER_RULES,
  planInstall,
  runInstall,
  slugFromStoreName,
} from "./install.ts";
import { verifyPasswordHash } from "./auth.ts";
import { POST as installRoute } from "../pages/api/install.ts";

test("fresh install requires the one-time setup capability before any write", async () => {
  let writes = 0;
  const database = {
    prepare() {
      return { async first() { return null; } };
    },
    async batch() {
      writes += 1;
      return [];
    },
  } as unknown as D1Database;
  const response = await installRoute({
    request: new Request("https://store.example.test/api/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        install_token: "wrong-token-value",
        store_name: "Test Store",
        site_url: "https://store.example.test",
        admin_username: "owner",
        admin_password: "safe-password-123",
        admin_password_confirm: "safe-password-123",
      }),
    }),
    locals: {
      runtimeEnv: {
        OMS_DB: database,
        AUTH_SECRET: "local-auth-secret-with-at-least-32-characters",
        INSTALL_TOKEN: "correct-install-token-value",
      },
    },
  } as never);

  assert.equal(response.status, 403);
  assert.equal(writes, 0);
});

/**
 * A D1 shim over real SQLite. The stub below proves which SQL is sent; this
 * proves what the SQL does, which is where the install-takeover hid: the
 * statements were right and their combination was not.
 */
function sqliteD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE stores (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
      site_url TEXT, tagline TEXT, locale TEXT, storefront_template TEXT,
      admin_name TEXT, support_whatsapp TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE whatsapp_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL UNIQUE, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE admin_credentials (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE courier_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      courier_code TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_cod_enabled INTEGER NOT NULL DEFAULT 1,
      excluded_provinces TEXT
    );
    INSERT INTO admin_credentials (id, username, password_hash, must_change_password, updated_at)
    VALUES (1, 'admin', 'pbkdf2-sha256$100000$seed$seed', 1, '2026-08-07T00:00:00.000Z');
  `);

  const prepare = (sql: string) => {
    let args: unknown[] = [];
    return {
      bind(...next: unknown[]) {
        args = next;
        return this;
      },
      first<T>() {
        return db.prepare(sql).get(...(args as never[])) as T;
      },
      run() {
        // D1 reports affected rows as meta.changes; node:sqlite as .changes.
        return { meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } };
      },
    };
  };

  return {
    raw: db,
    database: {
      prepare,
      async batch(statements: { run(): { meta: { changes: number } } }[]) {
        // D1 runs a batch sequentially inside one implicit transaction.
        db.exec("BEGIN");
        try {
          const results = statements.map((statement) => statement.run());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as D1Database,
  };
}

const valid = {
  storeName: "Toko Bunga Segar",
  siteUrl: "https://tokobunga.example",
  adminUsername: "operator",
  adminPassword: "a-real-operator-password",
  adminPasswordConfirm: "a-real-operator-password",
  supportWhatsapp: "081234567890",
  locale: "id-ID",
  storefrontTemplate: "compact-market",
};

test("a complete submission produces a plan", () => {
  const result = planInstall(valid);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.storeName, "Toko Bunga Segar");
  assert.equal(result.plan.siteUrl, "https://tokobunga.example");
  assert.equal(result.plan.slug, "toko-bunga-segar");
  assert.equal(result.plan.adminUsername, "operator");
});

test("the install refuses anything it cannot store safely", () => {
  const rejected: Array<[string, Record<string, unknown>]> = [
    ["empty store name", { storeName: " " }],
    ["one-character store name", { storeName: "T" }],
    ["non-https address", { siteUrl: "http://tokobunga.example" }],
    ["malformed address", { siteUrl: "tokobunga" }],
    ["uppercase username", { adminUsername: "Operator!" }],
    ["two-character username", { adminUsername: "op" }],
    ["short password", { adminPassword: "short", adminPasswordConfirm: "short" }],
    [
      "password equal to the username",
      { adminUsername: "operator", adminPassword: "operator", adminPasswordConfirm: "operator" },
    ],
    [
      "the default password",
      { adminPassword: "admin", adminPasswordConfirm: "admin" },
    ],
    ["mismatched confirmation", { adminPasswordConfirm: "something-else-entirely" }],
    ["five-digit WhatsApp number", { supportWhatsapp: "12345" }],
    ["invalid locale", { locale: "indonesian" }],
    ["unknown template", { storefrontTemplate: "does-not-exist" }],
  ];

  for (const [label, override] of rejected) {
    const result = planInstall({ ...valid, ...override });
    assert.equal(result.ok, false, `must reject: ${label}`);
    if (!result.ok) {
      assert.ok(result.error.length > 0, `${label} must explain itself`);
    }
  }
});

test("plain http is accepted for this machine only, never for a real host", () => {
  for (const siteUrl of ["http://localhost:8787", "http://127.0.0.1:8787"]) {
    const result = planInstall({ ...valid, siteUrl });
    assert.equal(result.ok, true, siteUrl);
    if (result.ok) assert.equal(result.plan.siteUrl, siteUrl);
  }
  for (const siteUrl of ["http://tokosaya.com", "http://localhost.evil.test", "http://192.168.1.5"]) {
    assert.equal(planInstall({ ...valid, siteUrl }).ok, false, siteUrl);
  }
});

test("a store name that reduces to nothing still yields a usable slug", () => {
  // The slug is diagnostic only, so an unusable name must not strand the
  // operator on a form they cannot get past.
  assert.equal(slugFromStoreName("���"), "adsbook");
  assert.equal(slugFromStoreName("  Toko  Saya  "), "toko-saya");
  assert.equal(slugFromStoreName("Toko—Saya!!"), "toko-saya");
});

test("the install writes the store and the credential together", async () => {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const database = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(...args: unknown[]) {
          bindings.push(args);
          return this;
        },
        async first() {
          return { total: 1 };
        },
      };
    },
    async batch() {
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    },
  } as unknown as D1Database;

  const planned = planInstall(valid);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;

  const result = await runInstall(database, planned.plan);
  assert.equal(result.ok, true);

  const [seatCheck, storeInsert, credentialUpdate, courierInsert, whatsappInsert] = statements;
  assert.equal(statements.length, 5, "one seat check, then one atomic install batch");
  // PRD A35: the rotator's list starts with the installer's number, in the
  // same batch, and only into an empty list.
  assert.match(whatsappInsert, /INSERT INTO whatsapp_numbers/);
  assert.match(whatsappInsert, /NOT EXISTS \(SELECT 1 FROM whatsapp_numbers\)/);
  assert.match(seatCheck, /COUNT\(\*\).+FROM admin_credentials/s);
  assert.match(storeInsert, /INSERT INTO stores/);
  assert.match(
    storeInsert,
    /WHERE NOT EXISTS/,
    "a concurrent submission must not be able to create a second store",
  );
  assert.match(credentialUpdate, /UPDATE admin_credentials/);
  assert.match(
    credentialUpdate,
    /must_change_password = 0/,
    "the operator chose this password, so nothing is left to rotate",
  );
  assert.match(
    credentialUpdate,
    /AND must_change_password = 1/,
    "only the never-configured seeded credential may be claimed, and only once",
  );
  assert.match(courierInsert, /INSERT INTO courier_rules/);
  assert.match(
    courierInsert,
    /NOT EXISTS[\s\S]+FROM courier_rules/,
    "an existing courier policy must never be overwritten",
  );

  // The password must be stored hashed, never in the clear.
  const storedHash = bindings[1][1] as string;
  assert.notEqual(storedHash, valid.adminPassword);
  assert.equal(await verifyPasswordHash(valid.adminPassword, storedHash), true);
});

test("a second install finds nothing left to do", async () => {
  const database = {
    prepare: () => ({
      bind() { return this; },
      async first() { return { total: 1 }; },
    }),
    // changes: 0 is what `WHERE NOT EXISTS` produces once a store row exists.
    async batch() {
      return [{ meta: { changes: 0 } }, { meta: { changes: 1 } }];
    },
  } as unknown as D1Database;

  const planned = planInstall(valid);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;

  const result = await runInstall(database, planned.plan);
  assert.equal(result.ok, false);
});

test("a second install cannot take the admin account from the first", async () => {
  const { raw, database } = sqliteD1();

  const operator = planInstall(valid);
  assert.equal(operator.ok, true);
  if (!operator.ok) return;
  assert.deepEqual(await runInstall(database, operator.plan), { ok: true });

  // The attacker submits a valid form of their own against the same store.
  const attacker = planInstall({
    ...valid,
    storeName: "Toko Penyerang",
    adminUsername: "pwned",
    adminPassword: "attacker-chosen-password",
    adminPasswordConfirm: "attacker-chosen-password",
  });
  assert.equal(attacker.ok, true);
  if (!attacker.ok) return;
  const second = await runInstall(database, attacker.plan);
  assert.equal(second.ok, false);

  const credential = raw
    .prepare("SELECT username, password_hash FROM admin_credentials WHERE id = 1")
    .get() as { username: string; password_hash: string };

  // Being told "already installed" is not enough: the refusal must also have
  // written nothing. It previously overwrote both of these.
  assert.equal(credential.username, valid.adminUsername);
  assert.equal(
    await verifyPasswordHash(valid.adminPassword, credential.password_hash),
    true,
    "the operator must still be able to log into the store they installed",
  );
  assert.equal(
    await verifyPasswordHash("attacker-chosen-password", credential.password_hash),
    false,
  );

  const stores = raw.prepare("SELECT COUNT(*) AS total FROM stores").get() as {
    total: number;
  };
  assert.equal(stores.total, 1);
});

test("a fresh install carries the default courier catalogue without provider calls", async () => {
  const { raw, database } = sqliteD1();
  const planned = planInstall(valid);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;

  assert.deepEqual(await runInstall(database, planned.plan), { ok: true });

  const couriers = raw
    .prepare(`
      SELECT courier_code AS code, is_enabled AS enabled,
             is_cod_enabled AS cod, excluded_provinces AS excluded
      FROM courier_rules
      ORDER BY id
    `)
    .all()
    .map((row) => ({ ...row })) as Array<{
      code: string;
      enabled: number;
      cod: number;
      excluded: string | null;
    }>;

  assert.deepEqual(
    couriers,
    DEFAULT_COURIER_RULES.map((rule) => ({
      code: rule.code,
      // JNE and J&T start on; the rest are present, off (install.ts).
      enabled: rule.enabled,
      cod: rule.cod,
      excluded: null,
    })),
  );
});

test("an install with no seeded credential row refuses instead of bricking", async () => {
  const { raw, database } = sqliteD1();
  raw.exec("DELETE FROM admin_credentials");

  const planned = planInstall(valid);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;

  const result = await runInstall(database, planned.plan);
  assert.equal(result.ok, false);
  // A store row with no admin account is unrecoverable: middleware sends
  // /install to /hello once a store exists, so the wizard is gone too.
  const stores = raw.prepare("SELECT COUNT(*) AS total FROM stores").get() as {
    total: number;
  };
  assert.equal(stores.total, 0);
});

test("a failing database reports rather than throwing", async () => {
  const database = {
    prepare: () => ({
      bind() { return this; },
      async first() { return { total: 1 }; },
    }),
    async batch() {
      throw new Error("D1_ERROR: no such table: stores");
    },
  } as unknown as D1Database;

  const planned = planInstall(valid);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;

  const result = await runInstall(database, planned.plan);
  assert.equal(result.ok, false);
});

test("the install starts the WhatsApp list with its number, or leaves it empty (PRD A35)", async () => {
  const withNumber = sqliteD1();
  const planned = planInstall(valid);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(await runInstall(withNumber.database, planned.plan), { ok: true });
  assert.deepEqual(
    withNumber.raw.prepare("SELECT phone, is_active FROM whatsapp_numbers").all().map((row) => ({ ...row })),
    [{ phone: "6281234567890", is_active: 1 }],
  );

  const withoutNumber = sqliteD1();
  const blank = planInstall({ ...valid, supportWhatsapp: "" });
  assert.equal(blank.ok, true);
  if (!blank.ok) return;
  assert.deepEqual(await runInstall(withoutNumber.database, blank.plan), { ok: true });
  assert.equal(
    (withoutNumber.raw.prepare("SELECT COUNT(*) AS n FROM whatsapp_numbers").get() as { n: number }).n,
    0,
  );
});
