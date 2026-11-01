import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { DEFAULT_COURIER_RULES } from "./install.ts";
import { GET as listExpeditions } from "../pages/api/admin/expeditions.ts";

function databaseBeforeCourierBootstrap() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE stores (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      cod_disabled_province_codes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE courier_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      courier_code TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      is_cod_enabled INTEGER DEFAULT 1,
      excluded_provinces TEXT
    );
    CREATE TABLE warehouses (
      id INTEGER PRIMARY KEY,
      store_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      origin_area_id TEXT NOT NULL,
      origin_label TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      province TEXT NOT NULL,
      -- The Expeditions API reads the primary (A42 migration).
      is_primary INTEGER NOT NULL DEFAULT 0
    );
  `);
  return database;
}

const bootstrapMigration = readFileSync(
  new URL("../db/migrations/0042_default_courier_rules.sql", import.meta.url),
  "utf8",
);
// 0042's own SQL still seeds Ninja — a fixed historical record of what that
// migration actually ran — so a store's *current* policy is only complete
// once 0056 has retired it too. Real installs apply both in sequence.
const retireNinjaMigration = readFileSync(
  new URL("../db/migrations/0056_retire_ninja_courier.sql", import.meta.url),
  "utf8",
);
// 0059 adds SPX to every store that already has a policy, including one
// 0042 just repaired.
const addSpxMigration = readFileSync(
  new URL("../db/migrations/0059_add_spx_courier.sql", import.meta.url),
  "utf8",
);
// 0061 removes the retired Ninja rule 0042 seeded and 0056 disabled.
const removeNinjaMigration = readFileSync(
  new URL("../db/migrations/0061_remove_ninja_courier.sql", import.meta.url),
  "utf8",
);
const migration = [bootstrapMigration, retireNinjaMigration, addSpxMigration, removeNinjaMigration].join("\n");

test("courier bootstrap repairs an installed store only when its policy is empty", () => {
  const database = databaseBeforeCourierBootstrap();
  database.exec(`
    INSERT INTO stores (id, name, slug, created_at) VALUES
      (1, 'Empty Store', 'empty', '2026-08-18T00:00:00.000Z'),
      (2, 'Configured Store', 'configured', '2026-08-18T00:00:00.000Z');
    INSERT INTO courier_rules (
      store_id, courier_code, is_enabled, is_cod_enabled, excluded_provinces
    ) VALUES (2, 'JNE', 0, 0, 'custom-policy');
  `);

  database.exec(migration);

  const repaired = database
    .prepare(`
      SELECT courier_code AS code, is_enabled AS enabled, is_cod_enabled AS cod
      FROM courier_rules WHERE store_id = 1 ORDER BY id
    `)
    .all()
    .map((row) => ({ ...row })) as Array<{
      code: string;
      enabled: number;
      cod: number;
    }>;
  // The migrations are history: 0042 repaired an empty policy with every
  // courier enabled, and 0061 removed Ninja. A fresh install enables fewer (see
  // the install bootstrap test below); the repair keeps what it ran.
  assert.deepEqual(
    repaired,
    DEFAULT_COURIER_RULES.map((rule) => ({
      code: rule.code,
      enabled: 1,
      cod: rule.cod,
    })),
  );
  assert.equal(repaired.some((rule) => String(rule.code).toLowerCase() === "ninja"), false);

  const configured = database
    .prepare(`
      SELECT courier_code AS code, is_enabled AS enabled,
             is_cod_enabled AS cod, excluded_provinces AS excluded
      FROM courier_rules WHERE store_id = 2
    `)
    .all()
    .map((row) => ({ ...row }));
  // A configured policy is kept as is; SPX, a courier it could never have
  // configured, is the only addition.
  assert.deepEqual(configured, [
    { code: "JNE", enabled: 0, cod: 0, excluded: "custom-policy" },
    { code: "SPX", enabled: 1, cod: 1, excluded: null },
  ]);

  database.exec(migration);
  const counts = database
    .prepare("SELECT store_id, COUNT(*) AS total FROM courier_rules GROUP BY store_id ORDER BY store_id")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(counts, [
    { store_id: 1, total: DEFAULT_COURIER_RULES.length },
    { store_id: 2, total: 2 },
  ]);
});

test("the Expeditions API exposes the repaired catalogue after upgrade", async () => {
  const database = databaseBeforeCourierBootstrap();
  database.exec(`
    INSERT INTO stores (id, name, slug, created_at)
    VALUES (1, 'Installed Store', 'installed', '2026-08-18T00:00:00.000Z');
  `);
  database.exec(migration);

  const binding = {
    prepare(sql: string) {
      return {
        async all<T>() {
          return { results: database.prepare(sql).all() as T[] };
        },
        async first<T>() {
          return database.prepare(sql).get() as T | null;
        },
      };
    },
  } as unknown as D1Database;

  const response = await listExpeditions({
    locals: { runtimeEnv: { OMS_DB: binding } },
  } as never);
  const payload = (await response.json()) as {
    success: boolean;
    data: { couriers: Array<{ courierCode: string; isEnabled: number; isCodEnabled: number }> };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  // Ninja is gone from the catalogue once 0061 has run.
  const expectedCouriers = [
    ...DEFAULT_COURIER_RULES.map((rule) => ({
      code: rule.code,
      enabled: 1,
      cod: rule.cod,
    })),
  // SQLite ORDER BY compares bytes, so "SPX" sorts before "SiCepat".
  ].sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
  assert.deepEqual(
    payload.data.couriers.map((courier) => ({
      code: courier.courierCode,
      enabled: courier.isEnabled,
      cod: courier.isCodEnabled,
    })),
    expectedCouriers,
  );
});

test("a fresh install offers JNE and J&T, with every other courier present but off", () => {
  assert.deepEqual(
    DEFAULT_COURIER_RULES.filter((rule) => rule.enabled === 1).map((rule) => rule.code),
    ["JNE", "J&T"],
  );
  assert.equal(DEFAULT_COURIER_RULES.some((rule) => rule.code.toLowerCase() === "ninja"), false);
  // Every other courier keeps a row, so switching one on is a toggle.
  assert.ok(DEFAULT_COURIER_RULES.length > 2);
});
