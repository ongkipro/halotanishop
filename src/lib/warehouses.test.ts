import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canAccessAdminRoute } from "./auth.ts";
import type { MengantarPickupAddressInput } from "./mengantar-client.ts";
import {
  addWarehouse,
  deleteWarehouse,
  listWarehouses,
  servedProvincesValue,
  setPrimaryWarehouse,
  setWarehouseActive,
  updateWarehouse,
  WAREHOUSES_MAX,
  WarehouseError,
} from "./warehouses.ts";

type SqlValue = null | number | string;

const MIGRATIONS_DIR = new URL("../db/migrations/", import.meta.url);
// Found by suffix, never by number: integration renumbers migrations.
const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith("_multi_warehouse.sql"));
assert.ok(MIGRATION_FILE, "the multi-warehouse migration exists");
const MIGRATION = readFileSync(new URL(MIGRATION_FILE, MIGRATIONS_DIR), "utf8").replace(/--> statement-breakpoint/g, "");

class Statement {
  readonly sqlite: DatabaseSync;
  readonly sql: string;
  readonly values: SqlValue[];
  constructor(sqlite: DatabaseSync, sql: string, values: SqlValue[] = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: SqlValue[]) {
    return new Statement(this.sqlite, this.sql, values);
  }
  async first<T>() {
    return (this.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values) as T[], meta: {} };
  }
  async run() {
    const info = this.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

/** The pre-A42 schema (0000 + 0001 + 0002) for what this module touches. */
function createDatabase(seedWarehouses = 0) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE stores (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO stores VALUES (1, 'Toko');
    CREATE TABLE warehouses (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      store_id integer NOT NULL,
      name text NOT NULL,
      origin_area_id text NOT NULL,
      pickup_address_id text NOT NULL,
      address text NOT NULL,
      city text NOT NULL,
      province text NOT NULL,
      contact_name text,
      contact_phone text,
      origin_label text,
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );
    CREATE TABLE pickup_schedules (id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id));
    CREATE TABLE orders (id INTEGER PRIMARY KEY, warehouse_id INTEGER REFERENCES warehouses(id));
  `);
  for (let index = 1; index <= seedWarehouses; index += 1) {
    sqlite
      .prepare(
        `INSERT INTO warehouses (store_id, name, origin_area_id, pickup_address_id, address, city, province)
         VALUES (1, ?, ?, ?, 'Jl. Satu', 'Kota Bandung', 'Jawa Barat')`,
      )
      .run(`Lama ${index}`, `area-${index}`, `pickup-${index}`);
  }
  sqlite.exec(MIGRATION);
  const database = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { sqlite, database };
}

const SURABAYA = {
  name: "Gudang Surabaya",
  contact_name: "Budi",
  contact_phone: "6281234567890",
  origin_area_id: "area-sby",
  origin_label: "Genteng, Kota Surabaya",
  pickup_address_id: "",
  address: "Jl. Tunjungan 1",
  city: "Kota Surabaya",
  province: "Jawa Timur",
};

/** A stubbed Mengantar: records each registration, never touches the network. */
function stubPickup() {
  const calls: MengantarPickupAddressInput[] = [];
  const ensure = async (input: MengantarPickupAddressInput) => {
    calls.push(input);
    return `pickup-${calls.length}`;
  };
  return { calls, ensure };
}

function noNetwork(context: { after: (fn: () => void) => void }) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("a warehouses test reached the network");
  };
  context.after(() => {
    globalThis.fetch = original;
  });
}

async function rejectsWith(promise: Promise<unknown>, status: number, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof WarehouseError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

test("A-402: the migration applies to an empty store", () => {
  const { sqlite } = createDatabase(0);
  assert.deepEqual({ ...sqlite.prepare("SELECT COUNT(*) AS n FROM warehouses").get() }, { n: 0 });
});

test("A-402: the first existing warehouse becomes primary; a second primary is refused by the index", () => {
  const { sqlite } = createDatabase(2);
  assert.deepEqual(
    sqlite.prepare("SELECT id, is_primary, is_active, served_provinces FROM warehouses ORDER BY id").all().map((row) => ({ ...row })),
    [
      { id: 1, is_primary: 1, is_active: 1, served_provinces: null },
      { id: 2, is_primary: 0, is_active: 1, served_provinces: null },
    ],
  );
  assert.throws(() => sqlite.exec("UPDATE warehouses SET is_primary = 1 WHERE id = 2"), /UNIQUE constraint failed/);
});

test("adding registers the pickup at Mengantar (stubbed) and the first warehouse becomes primary", async (context) => {
  noNetwork(context);
  const { database } = createDatabase(0);
  const pickup = stubPickup();
  await addWarehouse(database, { ...SURABAYA, served_provinces: ["BA", "NB"] }, pickup.ensure);
  assert.deepEqual(pickup.calls, [
    {
      addressId: undefined,
      pickupName: "Gudang Surabaya",
      pickupPic: "Budi",
      pickupPicPhone: "6281234567890",
      pickupAddress: "Jl. Tunjungan 1",
      pickupAutofill: "area-sby",
    },
  ]);
  const [row] = await listWarehouses(database);
  assert.equal(row.is_primary, true);
  assert.equal(row.ready, true);
  assert.equal(row.pickup_address_id, "pickup-1");
  assert.deepEqual(row.served_provinces, ["JI", "BA", "NB"]);

  await addWarehouse(database, { ...SURABAYA, name: "Gudang Kedua" }, pickup.ensure);
  const rows = await listWarehouses(database);
  assert.deepEqual(rows.map((warehouse) => [warehouse.name, warehouse.is_primary]), [
    ["Gudang Surabaya", true],
    ["Gudang Kedua", false],
  ]);
});

test("REQ-238: without an origin it is refused; without a pickup address it is stored as not ready", async (context) => {
  noNetwork(context);
  const { database } = createDatabase(0);
  await rejectsWith(addWarehouse(database, { ...SURABAYA, origin_area_id: "" }, null), 422, /origin/);
  await rejectsWith(addWarehouse(database, { ...SURABAYA, contact_phone: "12" }, null), 422, /Telepon/);
  // No Mengantar key: the pickup id stays as given (empty), so not ready.
  await addWarehouse(database, SURABAYA, null);
  const [row] = await listWarehouses(database);
  assert.equal(row.ready, false);
  assert.equal(row.pickup_address_id, "");
});

test("a Mengantar failure while registering changes nothing", async (context) => {
  noNetwork(context);
  const { database } = createDatabase(1);
  const failing = async () => {
    throw new Error("Mengantar timeout");
  };
  await rejectsWith(addWarehouse(database, SURABAYA, failing), 504, /tidak diubah/);
  await rejectsWith(updateWarehouse(database, 1, SURABAYA, failing), 504, /tidak diubah/);
  const rows = await listWarehouses(database);
  assert.deepEqual(rows.map((row) => row.name), ["Lama 1"]);
});

test("at most ten warehouses; the eleventh never reaches Mengantar", async (context) => {
  noNetwork(context);
  const { database } = createDatabase(WAREHOUSES_MAX);
  const pickup = stubPickup();
  await rejectsWith(addWarehouse(database, SURABAYA, pickup.ensure), 409, /Maksimal 10/);
  assert.equal(pickup.calls.length, 0);
  assert.equal((await listWarehouses(database)).length, WAREHOUSES_MAX);
});

test("editing keeps the id, re-registers the pickup and replaces the served list", async (context) => {
  noNetwork(context);
  const { database } = createDatabase(1);
  const pickup = stubPickup();
  await updateWarehouse(database, 1, { ...SURABAYA, pickup_address_id: "pickup-1", served_provinces: ["BA"] }, pickup.ensure);
  assert.equal(pickup.calls[0].addressId, "pickup-1");
  const [row] = await listWarehouses(database);
  assert.equal(row.id, 1);
  assert.equal(row.name, "Gudang Surabaya");
  assert.deepEqual(row.served_provinces, ["JI", "BA"]);
  await updateWarehouse(database, 1, { ...SURABAYA, served_provinces: [] }, pickup.ensure);
  assert.deepEqual((await listWarehouses(database))[0].served_provinces, ["JI"]);
  await rejectsWith(updateWarehouse(database, 99, SURABAYA, pickup.ensure), 404, /tidak ditemukan/);
  await rejectsWith(updateWarehouse(database, 1, { ...SURABAYA, served_provinces: ["XX"] }, pickup.ensure), 422, /XX/);
});

test("Jadikan utama moves the flag; an inactive or not-ready warehouse cannot take it", async (context) => {
  noNetwork(context);
  const { database, sqlite } = createDatabase(3);
  await setPrimaryWarehouse(database, 2);
  assert.deepEqual(
    (await listWarehouses(database)).filter((row) => row.is_primary).map((row) => row.id),
    [2],
  );
  sqlite.exec("UPDATE warehouses SET pickup_address_id = '' WHERE id = 3");
  await rejectsWith(setPrimaryWarehouse(database, 3), 409, /siap/);
  sqlite.exec("UPDATE warehouses SET pickup_address_id = 'p', is_active = 0 WHERE id = 3");
  await rejectsWith(setPrimaryWarehouse(database, 3), 409, /aktif/);
  await rejectsWith(setPrimaryWarehouse(database, 42), 404, /tidak ditemukan/);
  // A refusal never leaves the store without a primary.
  assert.deepEqual(sqlite.prepare("SELECT id FROM warehouses WHERE is_primary = 1").all().map((row) => row.id), [2]);
  await setPrimaryWarehouse(database, 2);
});

test("REQ-248: the primary cannot be deactivated; another can, and back", async (context) => {
  noNetwork(context);
  const { database } = createDatabase(2);
  await rejectsWith(setWarehouseActive(database, 1, false), 409, /utama/);
  await setWarehouseActive(database, 2, false);
  assert.equal((await listWarehouses(database)).find((row) => row.id === 2)?.is_active, false);
  await setWarehouseActive(database, 2, true);
  assert.equal((await listWarehouses(database)).find((row) => row.id === 2)?.is_active, true);
});

test("REQ-248: a warehouse with orders or pickups is never deleted, nor the primary", async (context) => {
  noNetwork(context);
  const { database, sqlite } = createDatabase(4);
  sqlite.exec("INSERT INTO orders (id, warehouse_id) VALUES (1, 2)");
  sqlite.exec("INSERT INTO pickup_schedules (id, warehouse_id) VALUES (1, 3)");
  await rejectsWith(deleteWarehouse(database, 2), 409, /Nonaktifkan/);
  await rejectsWith(deleteWarehouse(database, 3), 409, /Nonaktifkan/);
  await rejectsWith(deleteWarehouse(database, 1), 409, /utama/);
  await deleteWarehouse(database, 4);
  await rejectsWith(deleteWarehouse(database, 4), 404, /tidak ditemukan/);
  const rows = await listWarehouses(database);
  assert.deepEqual(rows.map((row) => [row.id, row.order_count]), [[1, 0], [2, 1], [3, 0]]);
});

test("served provinces: NULL means own; the own province always leads the list", () => {
  assert.equal(servedProvincesValue("Jawa Barat", undefined), null);
  assert.equal(servedProvincesValue("Jawa Barat", []), null);
  assert.equal(servedProvincesValue("Jawa Barat", ["JB"]), null);
  assert.equal(servedProvincesValue("Jawa Barat", ["JK", "BT", "JK"]), '["JB","JK","BT"]');
  assert.throws(() => servedProvincesValue("Jawa Barat", "JK"), WarehouseError);
});

test("the warehouses API is the owner's and admin's, not CS's or an advertiser's", () => {
  assert.equal(canAccessAdminRoute("owner", "/api/admin/warehouses"), true);
  assert.equal(canAccessAdminRoute("admin", "/api/admin/warehouses"), true);
  assert.equal(canAccessAdminRoute("customer_service", "/api/admin/warehouses"), false);
  assert.equal(canAccessAdminRoute("advertiser", "/api/admin/warehouses"), false);
});

test("screens that show one warehouse show the primary, not the lowest id", () => {
  // A store whose primary is not its first row once saw the first row's origin
  // on these screens while quotes shipped from the primary.
  const screens = [
    "../pages/api/admin/expeditions.ts",
    "../pages/admin/check.astro",
    "../pages/api/admin/abandoned-orders.ts",
    "../pages/api/admin/settings.ts",
  ];
  for (const screen of screens) {
    const source = readFileSync(new URL(screen, import.meta.url), "utf8");
    assert.match(source, /ORDER BY (s\.id, )?(w\.)?is_primary DESC/, `${screen} reads the primary`);
  }
  for (const screen of screens.slice(0, 3)) {
    const source = readFileSync(new URL(screen, import.meta.url), "utf8");
    assert.doesNotMatch(source, /FROM warehouses\s+(WHERE[^\n]*\n\s*)?ORDER BY id( ASC)?\s+LIMIT 1/, `${screen} has no first-row read`);
  }
});
