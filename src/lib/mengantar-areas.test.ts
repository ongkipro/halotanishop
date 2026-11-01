import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fetchProviderLocations, type ProviderAddressRow } from "./location-search.ts";
import {
  MENGANTAR_AREA_MAX_AGE_DAYS,
  buildMengantarAreaKey,
  dropMengantarArea,
  readMengantarArea,
  resolveMengantarArea,
  storeMengantarArea,
} from "./mengantar-areas.ts";
import { splitMigrationStatements } from "./schema-version.ts";

// Found by suffix, never by number: parallel streams renumber on merge.
const MIGRATIONS = new URL("../db/migrations/", import.meta.url);
const CHAIN = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
const AREAS_MIGRATION = CHAIN.find((name) => name.endsWith("_mengantar_areas.sql"));
assert.ok(AREAS_MIGRATION, "the mengantar_areas migration is on disk");

function apply(sqlite: DatabaseSync, name: string) {
  for (const statement of splitMigrationStatements(readFileSync(new URL(name, MIGRATIONS), "utf8"))) {
    sqlite.exec(statement);
  }
}

type Order = { district: string; city: string; province: string; area: string | null; postal?: string; at?: string };

/**
 * The real chain on node:sqlite. Orders, when given, are inserted before the
 * areas migration runs — an upgrading store's history — and the rest of the
 * chain follows.
 */
function createDatabase(orders: Order[] = []) {
  const sqlite = new DatabaseSync(":memory:");
  const at = CHAIN.indexOf(AREAS_MIGRATION!);
  for (const name of CHAIN.slice(0, at)) apply(sqlite, name);
  // The orders below belong to no store row; only their destination matters.
  sqlite.exec("PRAGMA foreign_keys = OFF");
  const insert = sqlite.prepare(`
    INSERT INTO orders (order_number, store_id, customer_name, customer_phone, address,
      province, city, district, postal_code, total_amount, destination_area_id, created_at)
    VALUES (?, 1, 'Budi', '6281234567890', 'Jl. Contoh 1', ?, ?, ?, ?, 100000, ?, ?)
  `);
  // An order placed a day ago unless the test dates it.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  orders.forEach((order, index) => {
    insert.run(`INV-${10000 + index}`, order.province, order.city, order.district, order.postal ?? null, order.area, order.at ?? yesterday);
  });
  for (const name of CHAIN.slice(at)) apply(sqlite, name);

  let failReads = false;
  const database = {
    prepare: (sql: string) => {
      const bound: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => { bound.push(...values); return statement; },
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bound as never[]).changes) } }),
        first: async () => {
          if (failReads) throw new Error("D1_ERROR: simulated");
          return sqlite.prepare(sql).get(...bound as never[]) ?? null;
        },
        all: async () => ({ results: sqlite.prepare(sql).all(...bound as never[]) }),
      };
      return statement;
    },
  } as unknown as D1Database;
  return { sqlite, database, failReads: () => { failReads = true; } };
}

const rows = (sqlite: DatabaseSync) =>
  sqlite.prepare(`SELECT area_key, area_id, label, postal_code, payload, source, agreeing_orders, total_orders
    FROM mengantar_areas ORDER BY area_key`).all() as Record<string, unknown>[];

// Provider rows for a fake Mengantar; anything else answers [].
const PROVIDER: Record<string, ProviderAddressRow[]> = {
  "Menteng Jakarta Pusat": [
    { _id: "A-MTG-1", DISTRICT_NAME: "Menteng", SUBDISTRICT_NAME: "Pegangsaan", CITY_NAME: "Jakarta Pusat", PROVINCE_NAME: "DKI Jakarta", ZIP_CODE: "10320" },
    { _id: "A-MTG-2", DISTRICT_NAME: "Menteng", SUBDISTRICT_NAME: "Menteng", CITY_NAME: "Jakarta Pusat", PROVINCE_NAME: "DKI Jakarta", ZIP_CODE: "10310" },
    { _id: "A-SBD-1", DISTRICT_NAME: "Setiabudi", SUBDISTRICT_NAME: "Menteng Atas", CITY_NAME: "Jakarta Selatan", PROVINCE_NAME: "DKI Jakarta", ZIP_CODE: "12960" },
    { _id: "", DISTRICT_NAME: "Menteng", SUBDISTRICT_NAME: "Kosong", CITY_NAME: "Jakarta Pusat", PROVINCE_NAME: "DKI Jakarta" },
  ],
  "8 Ulu Palembang": [
    { _id: "A-PLB-8", DISTRICT_NAME: "Seberang Ulu I", SUBDISTRICT_NAME: "8 Ulu", CITY_NAME: "Palembang", PROVINCE_NAME: "Sumatera Selatan", ZIP_CODE: "30251" },
    { _id: "A-PLB-X", DISTRICT_NAME: "Seberang Ulu I", SUBDISTRICT_NAME: "1 Ulu", CITY_NAME: "Palembang", PROVINCE_NAME: "Sumatera Selatan", ZIP_CODE: "30257" },
  ],
  kebayoran: [
    { _id: "A-KBL-1", DISTRICT_NAME: "Kebayoran Lama", SUBDISTRICT_NAME: "Kebayoran Lama Utara", CITY_NAME: "Jakarta Selatan", PROVINCE_NAME: "DKI Jakarta", ZIP_CODE: "12240" },
    { _id: "A-KBB-1", DISTRICT_NAME: "Kebayoran Baru", SUBDISTRICT_NAME: "Kramat Pela", CITY_NAME: "Jakarta Selatan", PROVINCE_NAME: "DKI Jakarta", ZIP_CODE: "12130" },
    { _id: "A-KBB-1", DISTRICT_NAME: "Kebayoran Baru", SUBDISTRICT_NAME: "Kramat Pela", CITY_NAME: "Jakarta Selatan", PROVINCE_NAME: "DKI Jakarta", ZIP_CODE: "12130" },
  ],
};

function fakeMengantar() {
  const calls: string[] = [];
  const searchAddress = async (keyword: string) => {
    calls.push(keyword);
    return PROVIDER[keyword] ?? [];
  };
  return { calls, searchAddress, provider: async () => searchAddress };
}

// Bodies produced by the route before A43 (be00fee, src/pages/api/locations.ts)
// for the same provider rows, captured by running that code. REQ-247: the
// form must receive exactly these bytes.
const MTG_ITEMS = '[{"location_id":"A-MTG-2","id":"A-MTG-2","label":"Menteng, Jakarta Pusat, DKI Jakarta","district":"Menteng","subdistrict_name":"Menteng","district_name":"Menteng","city":"Jakarta Pusat","city_name":"Jakarta Pusat","province":"DKI Jakarta","province_name":"DKI Jakarta","postal_code":"10310"},{"location_id":"A-MTG-1","id":"A-MTG-1","label":"Menteng, Pegangsaan, Jakarta Pusat, DKI Jakarta","district":"Menteng","subdistrict_name":"Pegangsaan","district_name":"Menteng","city":"Jakarta Pusat","city_name":"Jakarta Pusat","province":"DKI Jakarta","province_name":"DKI Jakarta","postal_code":"10320"}]';
const PLB_ITEMS = '[{"location_id":"A-PLB-8","id":"A-PLB-8","label":"Seberang Ulu I, 8 Ulu, Palembang, Sumatera Selatan","district":"Seberang Ulu I","subdistrict_name":"8 Ulu","district_name":"Seberang Ulu I","city":"Palembang","city_name":"Palembang","province":"Sumatera Selatan","province_name":"Sumatera Selatan","postal_code":"30251"}]';
const KBY_ITEMS = '[{"location_id":"A-KBB-1","id":"A-KBB-1","label":"Kebayoran Baru, Kramat Pela, Jakarta Selatan, DKI Jakarta","district":"Kebayoran Baru","subdistrict_name":"Kramat Pela","district_name":"Kebayoran Baru","city":"Jakarta Selatan","city_name":"Jakarta Selatan","province":"DKI Jakarta","province_name":"DKI Jakarta","postal_code":"12130"},{"location_id":"A-KBL-1","id":"A-KBL-1","label":"Kebayoran Lama, Kebayoran Lama Utara, Jakarta Selatan, DKI Jakarta","district":"Kebayoran Lama","subdistrict_name":"Kebayoran Lama Utara","district_name":"Kebayoran Lama","city":"Jakarta Selatan","city_name":"Jakarta Selatan","province":"DKI Jakarta","province_name":"DKI Jakarta","postal_code":"12240"}]';
const GOLDEN = [
  { input: ["Menteng", "Jakarta Pusat", "DKI Jakarta", true], calls: 1, body: `{"success":true,"items":${MTG_ITEMS},"locations":${MTG_ITEMS},"alternatives":[]}` },
  { input: ["Jakabaring", "Palembang", "Sumatera Selatan", true], calls: 15, body: `{"success":true,"items":${PLB_ITEMS},"locations":${PLB_ITEMS},"alternatives":[]}` },
  { input: ["Nowhere", "Kota Fiktif", "Provinsi Fiktif", true], calls: 10, body: '{"success":true,"items":[],"locations":[],"alternatives":[]}' },
  { input: ["kebayoran", "", "", false], calls: 1, body: `{"success":true,"items":${KBY_ITEMS},"locations":${KBY_ITEMS},"alternatives":[]}` },
] as const;

test("provider resolve and search bodies are byte-identical to the pre-A43 route", async () => {
  for (const golden of GOLDEN) {
    const { calls, searchAddress } = fakeMengantar();
    const [search, city, province, resolve] = golden.input;
    const payload = await fetchProviderLocations(searchAddress, { search, city, province, resolve });
    assert.equal(JSON.stringify(payload), golden.body, golden.input.join("|"));
    assert.equal(calls.length, golden.calls, `${golden.input.join("|")} provider calls`);
  }
});

test("a resolved district is answered from D1 the second time, same bytes, no Mengantar call", async () => {
  const { sqlite, database } = createDatabase();
  const mengantar = fakeMengantar();
  const input = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };

  const first = await resolveMengantarArea(database, mengantar.provider, input);
  assert.deepEqual(first, { body: GOLDEN[0].body, stored: false });
  assert.equal(mengantar.calls.length, 1);

  const second = await resolveMengantarArea(database, mengantar.provider, { district: " menteng ", city: "JAKARTA PUSAT", province: "dki jakarta" });
  assert.deepEqual(second, { body: GOLDEN[0].body, stored: true });
  assert.equal(mengantar.calls.length, 1, "no second Mengantar call");

  const [row] = rows(sqlite);
  assert.equal(row.area_key, "menteng|jakarta pusat|dki jakarta");
  assert.equal(row.area_id, "A-MTG-2");
  assert.equal(row.label, "Menteng, Jakarta Pusat, DKI Jakarta");
  assert.equal(row.postal_code, "10310");
  assert.equal(row.source, "resolve");
  assert.equal(row.payload, GOLDEN[0].body);
});

test("a district Mengantar does not resolve is not stored, so it is asked again", async () => {
  const { sqlite, database } = createDatabase();
  const mengantar = fakeMengantar();
  const input = { district: "Nowhere", city: "Kota Fiktif", province: "Provinsi Fiktif" };
  assert.equal((await resolveMengantarArea(database, mengantar.provider, input))?.body, GOLDEN[2].body);
  assert.equal(rows(sqlite).length, 0);
  await resolveMengantarArea(database, mengantar.provider, input);
  assert.equal(mengantar.calls.length, 20);
});

test("a fallback answer (Jakabaring → Seberang Ulu I, 8 Ulu) is returned but never stored", async () => {
  const { sqlite, database } = createDatabase();
  const mengantar = fakeMengantar();
  const input = { district: "Jakabaring", city: "Palembang", province: "Sumatera Selatan" };
  assert.deepEqual(await resolveMengantarArea(database, mengantar.provider, input), { body: GOLDEN[1].body, stored: false });
  assert.equal(rows(sqlite).length, 0, "a guess is not kept");
  await resolveMengantarArea(database, mengantar.provider, input);
  assert.equal(mengantar.calls.length, GOLDEN[1].calls * 2, "asked again, like any unstored district");
});

test("a stored area older than the bound is resolved again and refreshed", async () => {
  const day = 86_400_000;
  const menteng = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };
  // A seeded row with a stale id, as an upgrading store could carry.
  const { sqlite, database } = createDatabase([{ ...menteng, area: "A-RETIRED", postal: "10310" }]);
  const age = (days: number) => sqlite
    .prepare("UPDATE mengantar_areas SET resolved_at = ?")
    .run(new Date(Date.now() - days * day).toISOString());

  age(MENGANTAR_AREA_MAX_AGE_DAYS - 1);
  assert.match((await readMengantarArea(database, menteng)) ?? "", /A-RETIRED/, "inside the bound it answers");

  age(MENGANTAR_AREA_MAX_AGE_DAYS + 1);
  assert.equal(await readMengantarArea(database, menteng), null, "past the bound it is a miss");

  const mengantar = fakeMengantar();
  assert.deepEqual(await resolveMengantarArea(database, mengantar.provider, menteng), { body: GOLDEN[0].body, stored: false });
  assert.equal(mengantar.calls.length, 1);
  const [row] = rows(sqlite);
  assert.equal(row.area_id, "A-MTG-2", "the fresh answer replaces the stale row");
  assert.equal(row.source, "resolve");
  assert.equal((await resolveMengantarArea(database, mengantar.provider, menteng))?.stored, true);
  assert.equal(mengantar.calls.length, 1, "and is answered from D1 again");
});

test("a seeded row is dated by its newest order, so an old district is re-checked, not served", async () => {
  const day = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
  const jakabaring = { district: "Jakabaring", city: "Palembang", province: "Sumatera Selatan" };
  const menteng = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };
  const recent = ago(3);
  const { sqlite, database } = createDatabase([
    // Orders saved under the catalogue district with the fallback id the form took.
    { ...jakabaring, area: "A-PLB-8", postal: "30251", at: ago(MENGANTAR_AREA_MAX_AGE_DAYS + 40) },
    { ...jakabaring, area: "A-PLB-8", postal: "30251", at: ago(MENGANTAR_AREA_MAX_AGE_DAYS + 5) },
    { ...menteng, area: "A-MTG-2", postal: "10310", at: ago(MENGANTAR_AREA_MAX_AGE_DAYS + 9) },
    { ...menteng, area: "A-MTG-2", postal: "10310", at: recent },
    // Unparsable date: stale, never fresh.
    { district: "Coblong", city: "Bandung", province: "Jawa Barat", area: "A-CBL-1", at: "not a date" },
  ]);
  const dated = Object.fromEntries((sqlite.prepare("SELECT area_key, resolved_at FROM mengantar_areas").all() as { area_key: string; resolved_at: string }[])
    .map((row) => [row.area_key, row.resolved_at]));
  assert.equal(dated["menteng|jakarta pusat|dki jakarta"], recent, "dated by the newest order");
  assert.equal(dated["coblong|bandung|jawa barat"], "1970-01-01T00:00:00.000Z");

  assert.match((await readMengantarArea(database, menteng)) ?? "", /A-MTG-2/, "recently ordered: answers");
  assert.equal(await readMengantarArea(database, jakabaring), null, "last ordered past the bound: not served");

  const mengantar = fakeMengantar();
  assert.deepEqual(await resolveMengantarArea(database, mengantar.provider, jakabaring), { body: GOLDEN[1].body, stored: false });
  assert.equal(mengantar.calls.length, GOLDEN[1].calls, "re-checked with Mengantar");
});

test("a stale row whose re-resolve is a fallback or empty is deleted, not left to linger", async () => {
  const day = 86_400_000;
  const stale = new Date(Date.now() - (MENGANTAR_AREA_MAX_AGE_DAYS + 1) * day).toISOString();
  const jakabaring = { district: "Jakabaring", city: "Palembang", province: "Sumatera Selatan" };
  const nowhere = { district: "Nowhere", city: "Kota Fiktif", province: "Provinsi Fiktif" };
  const menteng = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };
  const { sqlite, database } = createDatabase([
    { ...jakabaring, area: "A-PLB-8", postal: "30251", at: stale },
    { ...nowhere, area: "A-GONE", at: stale },
    { ...menteng, area: "A-MTG-2", postal: "10310" },
  ]);
  const keys = () => rows(sqlite).map((row) => row.area_key);
  assert.equal(keys().length, 3);

  const mengantar = fakeMengantar();
  assert.equal((await resolveMengantarArea(database, mengantar.provider, jakabaring))?.body, GOLDEN[1].body);
  assert.equal((await resolveMengantarArea(database, mengantar.provider, nowhere))?.body, GOLDEN[2].body);
  assert.deepEqual(keys(), ["menteng|jakarta pusat|dki jakarta"], "both stale rows gone; the fresh one untouched");

  // A fallback resolve with nothing stored is still a no-op.
  await resolveMengantarArea(database, mengantar.provider, jakabaring);
  assert.deepEqual(keys(), ["menteng|jakarta pusat|dki jakarta"]);
});

test("a fresh row survives a fallback re-resolve reached through a failed read", async () => {
  const jakabaring = { district: "Jakabaring", city: "Palembang", province: "Sumatera Selatan" };
  const { sqlite, database, failReads } = createDatabase([
    { ...jakabaring, area: "A-PLB-8", postal: "30251" },
  ]);
  failReads();
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await resolveMengantarArea(database, fakeMengantar().provider, jakabaring))?.body, GOLDEN[1].body);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(rows(sqlite).map((row) => row.area_key), ["jakabaring|palembang|sumatera selatan"]);
});

test("a stored area is read back, a second store replaces it, and drop removes it", async () => {
  const { sqlite, database } = createDatabase();
  const district = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };
  assert.equal(await readMengantarArea(database, district), null);

  assert.equal(await storeMengantarArea(database, district, GOLDEN[0].body), true);
  assert.equal(await readMengantarArea(database, district), GOLDEN[0].body);

  assert.equal(await storeMengantarArea(database, district, GOLDEN[1].body), true);
  assert.equal(await readMengantarArea(database, district), GOLDEN[1].body);
  assert.equal(rows(sqlite).length, 1);
  assert.equal(rows(sqlite)[0].area_id, "A-PLB-8");

  // Dropped by area id — what a quote or dispatch knows — wherever it is stored.
  const other = { district: "Jakabaring", city: "Palembang", province: "Sumatera Selatan" };
  await storeMengantarArea(database, other, GOLDEN[1].body);
  assert.equal(await dropMengantarArea(database, " A-PLB-8 "), 2);
  assert.equal(await readMengantarArea(database, district), null);
  assert.equal(await readMengantarArea(database, other), null);
  assert.equal(await dropMengantarArea(database, ""), 0);
  assert.equal(await storeMengantarArea(database, district, GOLDEN[2].body), false, "an empty answer is never stored");
});

test("the area key is case- and whitespace-insensitive, like the KV key it replaces", () => {
  assert.equal(
    buildMengantarAreaKey("  Menteng ", "Jakarta Pusat", "DKI Jakarta"),
    buildMengantarAreaKey("menteng", "JAKARTA PUSAT", "dki jakarta"),
  );
  assert.equal(buildMengantarAreaKey("A", "B", "C"), "a|b|c");
});

test("the migration applies to an empty store with no rows", () => {
  const { sqlite } = createDatabase();
  assert.equal(rows(sqlite).length, 0);
});

test("the migration seeds one row per district from orders, the majority id winning", () => {
  const menteng = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };
  const { sqlite } = createDatabase([
    { ...menteng, area: "A-MTG-2", postal: "10310" },
    { ...menteng, area: "A-MTG-2", postal: "10310" },
    { ...menteng, area: "A-MTG-2", postal: "10311" },
    // Same district, different case and padding: one key.
    { district: " menteng", city: "JAKARTA PUSAT ", province: "dki jakarta", area: "A-MTG-2" },
    // A precise kelurahan pick (or a stale id) for the same district.
    { ...menteng, area: "A-MTG-1", postal: "10320" },
    // Tie: 1 each, the most recent order's id wins.
    { district: "Coblong", city: "Bandung", province: "Jawa Barat", area: "A-CBL-1" },
    { district: "Coblong", city: "Bandung", province: "Jawa Barat", area: "A-CBL-2", postal: "40132" },
    // No area id: not a resolve, not seeded.
    { district: "Sleman", city: "Sleman", province: "DI Yogyakarta", area: null },
    { district: "Depok", city: "Sleman", province: "DI Yogyakarta", area: "  " },
  ]);
  assert.deepEqual(rows(sqlite).map((row) => ({ ...row })), [
    { area_key: "coblong|bandung|jawa barat", area_id: "A-CBL-2", label: "Coblong, Bandung, Jawa Barat", postal_code: "40132", payload: null, source: "order-history", agreeing_orders: 1, total_orders: 2 },
    { area_key: "menteng|jakarta pusat|dki jakarta", area_id: "A-MTG-2", label: "menteng, JAKARTA PUSAT, dki jakarta", postal_code: "10310", payload: null, source: "order-history", agreeing_orders: 4, total_orders: 5 },
  ]);
});

test("a seeded district answers without Mengantar, in the provider item's shape", async () => {
  const menteng = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };
  const { database } = createDatabase([{ ...menteng, area: "A-MTG-2", postal: "10310" }]);
  const mengantar = fakeMengantar();
  const resolved = await resolveMengantarArea(database, mengantar.provider, menteng);
  assert.equal(mengantar.calls.length, 0);
  assert.equal(resolved?.stored, true);
  const item = '{"location_id":"A-MTG-2","id":"A-MTG-2","label":"Menteng, Jakarta Pusat, DKI Jakarta","district":"Menteng","subdistrict_name":"","district_name":"Menteng","city":"Jakarta Pusat","city_name":"Jakarta Pusat","province":"DKI Jakarta","province_name":"DKI Jakarta","postal_code":"10310"}';
  assert.equal(resolved?.body, `{"success":true,"items":[${item}],"locations":[${item}],"alternatives":[]}`);
});

test("a failing D1 read still resolves through Mengantar; no provider means no answer", async () => {
  const { database, failReads } = createDatabase();
  failReads();
  const mengantar = fakeMengantar();
  const input = { district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta" };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await resolveMengantarArea(database, mengantar.provider, input))?.body, GOLDEN[0].body);
  } finally {
    console.error = originalError;
  }
  const empty = createDatabase();
  assert.equal(await resolveMengantarArea(empty.database, async () => null, input), null);
});

test("the /api/locations route writes no KV on any path", () => {
  const route = readFileSync(new URL("../pages/api/locations.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /SESSION|KVNamespace|\.put\(|location-cache/);
  assert.match(route, /resolveMengantarArea/);
});
