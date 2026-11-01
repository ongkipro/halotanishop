// The Analitik menu's reads (PRD A37, A-350..A-355) against the real migration
// chain in SQLite, with every number checked by hand on a small fixture.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test, { afterEach } from "node:test";
import {
  answerInsights,
  landingRanking,
  landingStatements,
  locationRanking,
  locationStatements,
  orderTimes,
  productRanking,
  productStatements,
  provinceKey,
  shapeLocations,
  timeStatements,
  trendSeries,
  trendStatements,
  utmReport,
  utmStatements,
} from "./insights.ts";
import { UTM_NONE_LABEL } from "./insights-view.ts";
import { previousInsightsPeriod, resolveInsightsPeriod, type InsightsPeriod } from "./insights-period.ts";
import { RELEASED_ORDER, releasedOrderSql } from "./order-metrics.ts";
import { splitMigrationStatements } from "./schema-version.ts";
import { SOURCE_SLUG_NONE_FILTER, SOURCE_SLUG_NONE_LABEL } from "./source-slug.ts";
import { GET as landingRoute } from "../pages/api/admin/insights/landing.ts";
import { GET as trendRoute } from "../pages/api/admin/insights/trend.ts";
import { GET as productsRoute } from "../pages/api/admin/insights/products.ts";
import { GET as locationsRoute } from "../pages/api/admin/insights/locations.ts";
import { GET as timesRoute } from "../pages/api/admin/insights/times.ts";
import { GET as utmRoute } from "../pages/api/admin/insights/utm.ts";

type Value = null | number | string;
type Recorded = { sql: string; values: Value[] };

const NOW = new Date("2026-10-29T05:00:00.000Z");
const OCTOBER: InsightsPeriod = { start: "2026-10-01", end: "2026-10-28", days: 28 };

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function openDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  const directory = new URL("../db/migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    for (const statement of splitMigrationStatements(readFileSync(new URL(name, directory), "utf8"))) {
      sqlite.exec(statement);
    }
  }
  sqlite.exec(`
    INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Toko Uji', 'toko-uji', '2026-10-01T00:00:00.000Z');
    INSERT INTO products (id, store_id, title, slug, created_at) VALUES
      (11111, 1, 'Kopi Robusta', 'kopi', '2026-10-01T00:00:00.000Z'),
      (22222, 1, 'Madu Hutan', 'madu', '2026-10-01T00:00:00.000Z');
    INSERT INTO product_variants (id, product_id, sku, title, price) VALUES
      (101, 11111, 'KOPI-250', '250 gr', 50000),
      (102, 11111, 'KOPI-500', '500 gr', 90000),
      (201, 22222, 'MADU-1', '1 botol', 120000),
      (999, 22222, 'MADU-GONE', 'Varian lama', 70000);
    INSERT INTO landing_pages (id, slug, title, product_id, is_active, created_at, updated_at, source)
    VALUES ('lp-1', 'promo-kopi', 'Promo Kopi Oktober', '11111', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'cms');
  `);
  const recorded: Recorded[] = [];
  const statement = (sql: string, values: Value[] = []) => ({
    sql,
    values,
    bind: (...next: Value[]) => statement(sql, next.map((value) => value ?? null)),
    async all<T>() {
      recorded.push({ sql, values });
      return { results: sqlite.prepare(sql).all(...values) as T[], meta: { rows_read: 0 } };
    },
  });
  const d1 = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Array<ReturnType<typeof statement>>) {
      return statements.map((item) => {
        recorded.push({ sql: item.sql, values: item.values });
        return { success: true, results: sqlite.prepare(item.sql).all(...item.values), meta: { rows_read: 7 } };
      });
    },
  } as unknown as D1Database;
  let nextId = 1;
  const insert = sqlite.prepare(`
    INSERT INTO orders (id, order_number, store_id, customer_name, customer_phone, address, province, city, district,
      total_amount, payment_method, payment_status, shipping_status, created_at, source_page_path, ad_click_ids,
      lead_follow_up_status)
    VALUES (?, ?, 1, 'Budi Santoso', '6281234567890', 'Jl. Melati 10', ?, ?, 'Kec', ?, 'cod', ?, ?, ?, ?, ?, ?)
  `);
  const item = sqlite.prepare("INSERT INTO order_items (order_id, variant_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
  const order = (input: {
    at: string;
    amount?: number;
    shipping?: string;
    payment?: string;
    path?: string | null;
    clicks?: string | null;
    province?: string;
    city?: string;
    followUp?: string;
    items?: Array<[variant: number, quantity: number, price: number]>;
  }) => {
    const id = nextId++;
    insert.run(
      id,
      `INV-${id}`,
      input.province ?? "Jawa Timur",
      input.city ?? "Surabaya",
      input.amount ?? 100_000,
      input.payment ?? "unpaid",
      input.shipping ?? "pending",
      input.at,
      input.path ?? null,
      input.clicks ?? null,
      input.followUp ?? "new",
    );
    for (const [variant, quantity, price] of input.items ?? []) item.run(id, variant, quantity, price);
    return id;
  };
  return { sqlite, d1, order, recorded };
}

const routeContext = (d1: D1Database, query: string) =>
  ({
    locals: { runtimeEnv: { OMS_DB: d1 } },
    url: new URL(`https://toko.test/api/admin/insights/x?${query}`),
  }) as unknown as Parameters<typeof landingRoute>[0];

const PERSONAL = /Budi|6281234567890|Melati|INV-|customer_|address|phone/;

// ── A-350 period ────────────────────────────────────────────────────────────

test("the insights period requires both ends, refuses inverted, 91-day and unbounded ranges", () => {
  const parse = (query: string) => resolveInsightsPeriod(new URLSearchParams(query), NOW);
  const missingEnd = parse("date_filter=custom&date_start=2026-10-01");
  assert.equal(missingEnd.ok, false);
  const inverted = parse("date_filter=custom&date_start=2026-10-20&date_end=2026-10-01");
  assert.equal(inverted.ok, false);
  assert.match(!inverted.ok ? inverted.reason : "", /tidak boleh melewati/);
  const ninetyOne = parse("date_filter=custom&date_start=2026-07-30&date_end=2026-10-28");
  assert.deepEqual(ninetyOne, { ok: false, reason: "Rentang tanggal maksimal 90 hari." });
  const ninety = parse("date_filter=custom&date_start=2026-07-31&date_end=2026-10-28");
  assert.deepEqual(ninety, { ok: true, period: { start: "2026-07-31", end: "2026-10-28", days: 90 } });
  // A preset longer than 90 days is refused, not truncated; "all" is not a period.
  assert.deepEqual(parse("date_filter=180d"), { ok: false, reason: "Rentang tanggal maksimal 90 hari." });
  assert.equal(parse("date_filter=all").ok, false);
  assert.equal(parse("").ok, false);
  assert.deepEqual(parse("date_filter=this_month"), { ok: true, period: { start: "2026-10-01", end: "2026-10-29", days: 29 } });
  assert.deepEqual(previousInsightsPeriod(OCTOBER), { start: "2026-09-03", end: "2026-09-30", days: 28 });
});

test("an insights route answers 400 with the stated reason for a refused period", async () => {
  const { d1 } = openDatabase();
  for (const route of [landingRoute, trendRoute, productsRoute, locationsRoute, timesRoute]) {
    const response = await route(routeContext(d1, "date_filter=custom&date_start=2026-07-01&date_end=2026-10-28"));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Rentang tanggal maksimal 90 hari.");
  }
  const badChannel = await timesRoute(routeContext(d1, "date_filter=custom&date_start=2026-10-01&date_end=2026-10-28&channel=x"));
  assert.equal(badChannel.status, 400);
  const both = await trendRoute(routeContext(d1, "date_filter=custom&date_start=2026-10-01&date_end=2026-10-28&source=a&product_id=1"));
  assert.equal(both.status, 400);
});

test("insights refuses invalid products before reading and hides database errors", async (t) => {
  const { d1, recorded } = openDatabase();
  const period = "date_filter=custom&date_start=2026-10-01&date_end=2026-10-28";
  for (const product of ["0", "-1", "1.5", "1 OR 1=1", "9999999999999"]) {
    const response = await trendRoute(routeContext(d1, `${period}&product_id=${encodeURIComponent(product)}`));
    assert.equal(response.status, 400);
  }
  assert.equal(recorded.length, 0);
  assert.equal((await landingRoute(routeContext(undefined as unknown as D1Database, period))).status, 503);
  t.mock.method(console, "error", () => {});
  const failed = await answerInsights(routeContext(d1, period), "test-insights", async () => {
    throw new Error("private database details");
  }, NOW);
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /private database/);
});

test("Jakarta period boundaries include ISO and SQLite timestamp spellings", async () => {
  const { d1, order } = openDatabase();
  for (const at of ["2026-09-30T17:00:00.000Z", "2026-09-30 17:00:00", "2026-10-01T16:59:59.999Z", "2026-10-01 16:59:59"]) order({ at });
  for (const at of ["2026-09-30T16:59:59.999Z", "2026-10-01T17:00:00.000Z"]) order({ at, amount: 999_999 });
  const period = { start: "2026-10-01", end: "2026-10-01", days: 1 };
  assert.deepEqual((await trendSeries(d1, period)).data.total, { orders: 4, leads: 0, revenue: 400_000 });
});

test("empty insights return zero totals rather than missing data", async () => {
  const { d1 } = openDatabase();
  assert.deepEqual((await landingRanking(d1, OCTOBER)).data.rows, []);
  assert.deepEqual((await productRanking(d1, OCTOBER)).data.totals, { units: 0, revenue: 0 });
  assert.deepEqual((await locationRanking(d1, OCTOBER)).data.totals, { orders: 0, revenue: 0 });
  assert.equal((await orderTimes(d1, OCTOBER)).data.total, 0);
  const trend = (await trendSeries(d1, OCTOBER)).data;
  assert.equal(trend.series.length, 28);
  assert.deepEqual(trend.total, { orders: 0, leads: 0, revenue: 0 });
});

// ── A-351 landing ranking ───────────────────────────────────────────────────

function seedLanding() {
  const db = openDatabase();
  const { order } = db;
  const meta = JSON.stringify({ fbclid: "IwAR1" });
  const google = JSON.stringify({ gclid: "Cj0K" });
  // "promo-kopi": 4 orders, Rp 500.000 each, all returned. Biggest by orders.
  for (let index = 0; index < 4; index += 1) {
    order({ at: "2026-10-05T03:00:00.000Z", amount: 500_000, shipping: "returned", path: "/promo-kopi", clicks: meta });
  }
  // "madu": 1 delivered Rp 150.000 (google), 1 pending Rp 200.000, 1 cancelled
  // Rp 300.000 (released: an order, not revenue); 2 open leads, one contacted.
  order({ at: "2026-10-06T03:00:00.000Z", amount: 150_000, shipping: "delivered", payment: "paid", path: "/produk/madu", clicks: google });
  order({ at: "2026-10-06T04:00:00.000Z", amount: 200_000, path: "/produk/madu?utm_source=x" });
  order({ at: "2026-10-06T05:00:00.000Z", amount: 300_000, shipping: "cancelled", path: "/produk/madu" });
  order({ at: "2026-10-07T03:00:00.000Z", shipping: "abandoned", path: "/produk/madu" });
  order({ at: "2026-10-07T04:00:00.000Z", shipping: "abandoned", path: "/produk/madu", followUp: "contacted" });
  // No recorded source: 1 delivered Rp 80.000 converted from a lead, 1 lead.
  order({ at: "2026-10-08T03:00:00.000Z", amount: 80_000, shipping: "delivered", followUp: "converted" });
  order({ at: "2026-10-08T04:00:00.000Z", shipping: "abandoned" });
  // Outside the period (Jakarta 1 November): never counted.
  order({ at: "2026-10-31T18:00:00.000Z", amount: 999_000, shipping: "delivered", path: "/produk/madu" });
  return db;
}

test("landing ranking: arithmetic by hand, delivered revenue wins over returned volume", async () => {
  const { d1 } = seedLanding();
  const { data } = await landingRanking(d1, OCTOBER);
  assert.deepEqual(
    data.rows.map((row) => row.slug),
    ["madu", null, "promo-kopi"],
    "the 4-order page whose orders all returned ranks last",
  );
  const [madu, none, kopi] = data.rows;

  assert.equal(madu.label, "Madu Hutan");
  assert.equal(madu.kind, "product");
  assert.equal(madu.leads, 2);
  assert.equal(madu.orders, 3);
  assert.equal(madu.live_orders, 2);
  assert.equal(madu.revenue, 350_000);
  assert.equal(madu.delivered_revenue, 150_000);
  assert.equal(madu.average_order_value, 175_000);
  assert.equal(madu.closing_rate, 60); // 3 / (3 + 2)
  assert.equal(madu.delivered_share, 33.33); // 1 / 3
  assert.equal(madu.return_share, 0);
  assert.deepEqual(madu.channels, { meta: 0, google: 1, tiktok: 0, other_paid: 0, organic: 0, direct: 2 });
  assert.deepEqual(madu.follow_up, { new: 1, contacted: 1, qualified: 0, not_interested: 0, converted: 0 });

  assert.equal(none.label, SOURCE_SLUG_NONE_LABEL);
  assert.equal(none.kind, "none");
  assert.equal(none.orders, 1);
  assert.equal(none.leads, 1);
  assert.equal(none.delivered_revenue, 80_000);
  assert.equal(none.follow_up.converted, 1);

  assert.equal(kopi.label, "Promo Kopi Oktober");
  assert.equal(kopi.kind, "landing");
  assert.equal(kopi.orders, 4);
  assert.equal(kopi.revenue, 0);
  assert.equal(kopi.delivered_revenue, 0);
  assert.equal(kopi.return_share, 100);
  assert.equal(kopi.channels.meta, 4);

  assert.deepEqual(data.totals, { leads: 3, orders: 8, revenue: 430_000, delivered_revenue: 230_000 });
  // A38 asks for the top rows only, from the same numbers.
  const top = await landingRanking(d1, OCTOBER, { limit: 2 });
  assert.deepEqual(top.data.rows, data.rows.slice(0, 2));
  assert.equal(top.data.total_sources, 3);
});

test("landing route: aggregates only, no-store and rows-read header", async () => {
  const { d1, recorded } = seedLanding();
  const response = await landingRoute(routeContext(d1, "date_filter=custom&date_start=2026-10-01&date_end=2026-10-28"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-d1-rows-read"), "14"); // 2 statements × the fake's 7
  const body = await response.text();
  assert.doesNotMatch(body, PERSONAL);
  assert.equal(recorded.length, 2);
});

// ── A-352 trend ─────────────────────────────────────────────────────────────

test("trend: zero-filled days, sources sum to the whole, previous period ends the day before", async () => {
  const { d1, order } = seedLanding();
  order({ at: "2026-09-29T03:00:00.000Z", amount: 70_000, path: "/produk/madu" });
  order({ at: "2026-09-02T18:00:00.000Z", amount: 60_000 }); // Jakarta 3 Sept: first previous day
  order({ at: "2026-09-02T16:00:00.000Z", amount: 50_000 }); // Jakarta 2 Sept: outside
  const all = (await trendSeries(d1, OCTOBER)).data;
  assert.equal(all.series.length, 28);
  assert.deepEqual(all.series[0], { date: "2026-10-01", orders: 0, leads: 0, revenue: 0 });
  assert.deepEqual(all.series.find((day) => day.date === "2026-10-06"), { date: "2026-10-06", orders: 3, leads: 0, revenue: 350_000 });
  assert.deepEqual(all.total, { orders: 8, leads: 3, revenue: 430_000 });
  assert.deepEqual(all.previous, { start: "2026-09-03", end: "2026-09-30", orders: 2, leads: 0, revenue: 130_000 });

  const sum = { orders: 0, leads: 0, revenue: 0 };
  for (const source of ["madu", "promo-kopi", SOURCE_SLUG_NONE_FILTER]) {
    const part = (await trendSeries(d1, OCTOBER, { source })).data.total;
    sum.orders += part.orders;
    sum.leads += part.leads;
    sum.revenue += part.revenue;
  }
  assert.deepEqual(sum, all.total);

  const unknown = (await trendSeries(d1, OCTOBER, { source: "no-such-page" })).data.total;
  assert.deepEqual(unknown, { orders: 0, leads: 0, revenue: 0 });
});

test("trend for one product counts its rows and its own line revenue", async () => {
  const { d1, order } = openDatabase();
  order({ at: "2026-10-10T03:00:00.000Z", amount: 999_999, items: [[101, 2, 50_000], [201, 1, 120_000]] });
  order({ at: "2026-10-11T03:00:00.000Z", amount: 999_999, items: [[102, 1, 90_000]] });
  order({ at: "2026-10-11T04:00:00.000Z", shipping: "abandoned", items: [[101, 1, 50_000]] });
  order({ at: "2026-10-12T03:00:00.000Z", shipping: "returned", items: [[101, 3, 50_000]] });
  const { data } = await trendSeries(d1, OCTOBER, { productId: 11111 });
  assert.deepEqual(data.total, { orders: 3, leads: 1, revenue: 190_000 });
});

// ── A-353 products ──────────────────────────────────────────────────────────

test("product ranking: units × price is revenue, released excluded, a deleted variant does not fail", async () => {
  const { d1, order, sqlite } = openDatabase();
  order({ at: "2026-10-10T03:00:00.000Z", shipping: "delivered", items: [[101, 2, 50_000], [201, 1, 120_000]] });
  order({ at: "2026-10-11T03:00:00.000Z", items: [[102, 1, 90_000], [101, 1, 50_000]] });
  order({ at: "2026-10-11T04:00:00.000Z", shipping: "returned", items: [[101, 5, 50_000]] });
  order({ at: "2026-10-11T05:00:00.000Z", payment: "refunded", items: [[201, 4, 120_000]] });
  order({ at: "2026-10-12T05:00:00.000Z", shipping: "abandoned", items: [[201, 9, 120_000]] });
  order({ at: "2026-10-12T06:00:00.000Z", items: [[999, 2, 70_000]] });
  assert.throws(() => sqlite.exec("DELETE FROM product_variants WHERE id = 999"), /FOREIGN KEY/);
  // Model an orphan from a legacy import in this disposable fixture only.
  // Normal writes must still reject deletion of a referenced variant.
  sqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    sqlite.exec("DELETE FROM product_variants WHERE id = 999");
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
  assert.equal(sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);

  const { data } = await productRanking(d1, OCTOBER);
  const [kopi, deleted, madu] = data.rows;
  assert.equal(kopi.label, "Kopi Robusta");
  assert.equal(kopi.units, 4);
  assert.equal(kopi.revenue, 2 * 50_000 + 1 * 90_000 + 1 * 50_000);
  assert.deepEqual(
    kopi.variants.map((variant) => [variant.label, variant.units, variant.revenue]),
    [["250 gr", 3, 150_000], ["500 gr", 1, 90_000]],
  );
  assert.equal(kopi.return_share, 71.43); // 5 returned / (2 delivered + 5 returned).
  assert.equal(kopi.delivered_units, 2);
  assert.equal(kopi.returned_units, 5);

  assert.equal(deleted.product_id, null);
  assert.equal(deleted.units, 2);
  assert.equal(deleted.revenue, 140_000);
  assert.equal(madu.units, 1, "the refunded order's 4 units are excluded");
  assert.equal(madu.revenue, 120_000);
  for (const row of data.rows) {
    assert.equal(row.revenue, row.variants.reduce((sum, variant) => sum + variant.revenue, 0));
  }
  assert.deepEqual(data.totals, { units: 7, revenue: 500_000 });
  assert.deepEqual((await productRanking(d1, OCTOBER, { limit: 1 })).data.rows, [kopi]);
});

// ── A-354 locations ─────────────────────────────────────────────────────────

test("locations: top 20 provinces plus Lainnya keep the total; spellings merge only by the catalogue", async () => {
  const { d1, order } = openDatabase();
  const codes = ["AC", "SU", "SB", "RI", "JA", "SS", "BE", "LA", "BB", "KR", "JK", "JB", "JT", "YO", "BT", "BA", "NB", "NT", "KB", "KT", "KS", "KI"];
  // 22 provinces; province i gets 22 - i orders, so the order is stable.
  codes.forEach((code, index) => {
    for (let n = 0; n < 22 - index; n += 1) {
      order({ at: "2026-10-10T03:00:00.000Z", amount: 10_000, province: `ID-${code}` });
    }
  });
  // Jawa Timur written three ways: two the catalogue knows, one it does not.
  order({ at: "2026-10-10T03:00:00.000Z", amount: 10_000, province: "Jawa Timur", city: "Surabaya" });
  order({ at: "2026-10-10T03:00:00.000Z", amount: 10_000, province: "ID-JI", city: "SURABAYA " });
  order({ at: "2026-10-10T03:00:00.000Z", amount: 10_000, province: "Jatim", city: "Malang" });
  order({ at: "2026-10-10T03:00:00.000Z", shipping: "abandoned", province: "Jawa Timur" });

  const { data } = await locationRanking(d1, OCTOBER, { province: "Jawa Timur" });
  assert.equal(data.provinces.length, 21);
  assert.equal(data.provinces.at(-1)?.label, "Lainnya");
  assert.equal(data.provinces[0].label, "Aceh");
  const sum = data.provinces.reduce((total, place) => total + place.orders, 0);
  const expected = (22 * 23) / 2 + 3;
  assert.equal(sum, expected);
  assert.equal(data.totals.orders, expected);

  const jatim = provinceKey("ID-JI");
  assert.equal(provinceKey("Jawa Timur").key, jatim.key);
  assert.equal(provinceKey("Daerah Khusus Ibukota Jakarta").key, "JK");
  assert.equal(provinceKey("Jatim").matched, false, "no catalogue alias: reported, not merged");
  assert.deepEqual(data.unmatched_provinces, ["Jatim"]);

  assert.equal(data.province?.key, "JI");
  assert.deepEqual(
    data.province?.cities.map((city) => [city.label, city.orders]),
    [["Surabaya", 2]],
    "both spellings of the province, and of the city's case, are one place",
  );
});

test("city labels are stable when grouped rows arrive in a different order", () => {
  const groups = ["SURABAYA", "Surabaya", "surabaya"].map((city) => ({
    province: "Jawa Timur", city, district: "Kec", orders: 1, revenue: 100, delivered: 1, returned: 0,
  }));
  assert.deepEqual(
    shapeLocations(groups, { province: "JI" }),
    shapeLocations([...groups].reverse(), { province: "JI" }),
  );
});

test("a city opens to its districts; spellings of one district merge and the city keeps its total", () => {
  const row = (city: string, district: string | null, orders: number) => ({
    province: "Jawa Timur", city, district, orders, revenue: orders * 100, delivered: 0, returned: 0,
  });
  const groups = [row("Surabaya", "Wonokromo", 2), row("SURABAYA", "WONOKROMO ", 1), row("Surabaya", "Rungkut", 1), row("Malang", "Klojen", 5)];
  const opened = shapeLocations(groups, { province: "JI", city: "surabaya" }).province;
  assert.equal(opened?.city?.label, "Surabaya");
  assert.deepEqual(opened?.city?.districts.map((d) => [d.label, d.orders]), [["Wonokromo", 3], ["Rungkut", 1]]);
  assert.equal(opened?.cities.find((c) => c.key === "surabaya")?.orders, 4, "the city row is the sum of its districts");
  assert.equal(shapeLocations(groups, { province: "JI" }).province?.city, null, "no city asked, no district list");
  assert.equal(shapeLocations(groups, { city: "surabaya" }).province, null, "a city never opens without its province");
  assert.deepEqual(shapeLocations(groups, { province: "JI", city: "" }).province?.city?.districts, [], "an empty city key is its own place");
});

test("an order whose address form is not complete (no district) is counted apart, never under a guessed place", () => {
  const groups = [
    { province: "Jawa Timur", city: "Surabaya", district: "Wonokromo", orders: 2, revenue: 200, delivered: 1, returned: 1 },
    // The middle form: IP-guessed province, no city, no district.
    { province: "Jawa Barat", city: "", district: "", orders: 3, revenue: 300, delivered: 0, returned: 0 },
    { province: "Jawa Barat", city: null, district: null, orders: 1, revenue: 100, delivered: 0, returned: 1 },
  ];
  const data = shapeLocations(groups);
  assert.deepEqual(data.provinces.map((p) => [p.label, p.orders]), [["Jawa Timur", 2]], "no province is credited with a guess");
  assert.deepEqual(data.incomplete_address, { orders: 4, revenue: 400, delivered: 0, returned: 1, return_share: 100 });
  assert.deepEqual(data.totals, { orders: 6, revenue: 600 }, "the total still counts every order");
});

test("an unmatched or empty province row opens by the key the drilldown sends", () => {
  const long = `Provinsi ${"x".repeat(100)}`;
  const groups = [null, long].map((province) => ({
    province, city: "Kota", district: "Kec", orders: 1, revenue: 100, delivered: 1, returned: 0,
  }));
  for (const row of shapeLocations(groups).provinces.filter((place) => place.key !== "other")) {
    const opened = shapeLocations(groups, { province: row.key }).province;
    assert.equal(opened?.label, row.label);
    assert.deepEqual(opened?.cities.map((city) => [city.label, city.orders]), [["Kota", 1]]);
  }
});

test("locations: top 50 cities plus Lainnya, and the province value never reaches SQL", async () => {
  const { d1, order, recorded } = openDatabase();
  for (let city = 1; city <= 55; city += 1) {
    for (let n = 0; n < 56 - city; n += 1) {
      order({ at: "2026-10-10T03:00:00.000Z", amount: 1_000, province: "Jawa Barat", city: `Kota ${String(city).padStart(2, "0")}` });
    }
  }
  const hostile = "Jawa Barat' OR 1=1 --";
  const { data } = await locationRanking(d1, OCTOBER, { province: "Jawa Barat" });
  const cities = data.province?.cities ?? [];
  assert.equal(cities.length, 51);
  assert.equal(cities.at(-1)?.label, "Lainnya");
  assert.equal(cities.at(-1)?.orders, 5 + 4 + 3 + 2 + 1);
  assert.equal(cities.reduce((total, city) => total + city.orders, 0), data.totals.orders);

  recorded.length = 0;
  const odd = await locationRanking(d1, OCTOBER, { province: hostile });
  assert.equal(odd.data.province?.cities.length, 0);
  assert.ok(recorded.every((entry) => !entry.sql.includes(hostile) && !entry.values.includes(hostile)));
});

// ── A-355 time heatmap ──────────────────────────────────────────────────────

test("times: weekday × hour in Asia/Jakarta", async () => {
  const { d1, order } = openDatabase();
  order({ at: "2026-10-25T16:30:00.000Z" }); // Sunday 23:30 WIB
  order({ at: "2026-10-25T17:10:00.000Z" }); // Monday 00:10 WIB
  order({ at: "2026-10-25T17:20:00.000Z", shipping: "abandoned" }); // a lead: not an order
  const { data } = await orderTimes(d1, OCTOBER);
  assert.equal(data.cells[0][23], 1, "Sunday 23:00");
  assert.equal(data.cells[1][0], 1, "Monday 00:00");
  assert.equal(data.total, 2);
  assert.equal(data.cells.length, 7);
  assert.ok(data.cells.every((row) => row.length === 24));
});

// ── Shared definitions and query plans ──────────────────────────────────────

test("one released-order rule: the dashboard and the insights import it, the lifecycle agrees", () => {
  const lifecycle = readFileSync(new URL("./order-lifecycle.ts", import.meta.url), "utf8");
  assert.ok(lifecycle.includes(`"(${releasedOrderSql("o.")})"`), "order-lifecycle.ts still releases the same set");
  const dashboard = readFileSync(new URL("../pages/api/admin/analytics.ts", import.meta.url), "utf8");
  assert.ok(dashboard.includes("RELEASED_ORDER") && !dashboard.includes("'refunded'"), "the dashboard imports the rule");
  assert.equal(RELEASED_ORDER, releasedOrderSql());
});

test("every insights statement reads orders through an index, never a table scan", () => {
  const { sqlite, d1 } = openDatabase();
  const statements = [
    ...landingStatements(d1, OCTOBER).slice(0, 1),
    ...trendStatements(d1, OCTOBER),
    ...trendStatements(d1, OCTOBER, { source: "madu" }),
    ...trendStatements(d1, OCTOBER, { productId: 11111 }),
    ...productStatements(d1, OCTOBER),
    ...locationStatements(d1, OCTOBER, { channel: "meta" }),
    ...timeStatements(d1, OCTOBER),
    ...utmStatements(d1, OCTOBER, { channel: "meta" }),
  ] as unknown as Recorded[];
  for (const { sql, values } of statements) {
    const plan = (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values) as Array<{ detail: string }>)
      .map((row) => row.detail)
      .join(" | ");
    assert.doesNotMatch(plan, /SCAN (orders|o)\b(?! USING)/, plan);
    assert.match(plan, /SEARCH (orders|o) USING (COVERING )?INDEX/, plan);
    assert.doesNotMatch(plan, /SCAN (order_items|oi)\b/, plan);
  }
});

// ── A-429 UTM campaigns ─────────────────────────────────────────────────────

function seedUtm() {
  const seeded = openDatabase();
  const { order } = seeded;
  const tags = (fields: Record<string, string>) => JSON.stringify({ fbclid: "fb.1", ...fields });
  const promo = { utm_source: "facebook", utm_medium: "paid_social" };
  // One campaign spelled two ways, two contents (one untagged content).
  order({ at: "2026-10-02T03:00:00.000Z", amount: 100_000, shipping: "delivered", clicks: tags({ ...promo, utm_campaign: "Promo-Okt ", utm_content: "Video-A" }) });
  order({ at: "2026-10-03T03:00:00.000Z", amount: 150_000, shipping: "returned", clicks: tags({ ...promo, utm_campaign: "promo-okt", utm_content: "video-a" }) });
  order({ at: "2026-10-04T03:00:00.000Z", amount: 120_000, clicks: tags({ utm_source: " FACEBOOK", utm_medium: "Paid_Social", utm_campaign: "PROMO-OKT" }) });
  order({ at: "2026-10-04T04:00:00.000Z", shipping: "abandoned", clicks: tags({ ...promo, utm_campaign: "promo-okt" }) });
  // A released order counts as an order, never as revenue.
  order({ at: "2026-10-05T03:00:00.000Z", amount: 90_000, shipping: "cancelled", clicks: tags({ utm_source: "google", utm_medium: "cpc", utm_campaign: "brand" }) });
  order({ at: "2026-10-05T04:00:00.000Z", amount: 200_000, shipping: "delivered", clicks: tags({ utm_source: "google", utm_medium: "cpc", utm_campaign: "brand" }) });
  // A blank tag and a missing tag are the same campaign row.
  order({ at: "2026-10-07T03:00:00.000Z", clicks: tags({ utm_source: "tiktok", utm_medium: "  ", utm_campaign: "flash" }) });
  order({ at: "2026-10-07T04:00:00.000Z", clicks: tags({ utm_source: "tiktok", utm_campaign: "flash" }) });
  // Untagged: no click JSON, click ids only, blank tags, broken JSON.
  order({ at: "2026-10-06T03:00:00.000Z", amount: 80_000, shipping: "delivered" });
  order({ at: "2026-10-06T04:00:00.000Z", amount: 70_000, clicks: JSON.stringify({ gclid: "g.1" }) });
  order({ at: "2026-10-06T05:00:00.000Z", amount: 60_000, clicks: tags({ utm_source: "  ", utm_campaign: "" }) });
  order({ at: "2026-10-06T06:00:00.000Z", shipping: "abandoned", clicks: "{not json" });
  // Outside the period.
  order({ at: "2026-09-20T03:00:00.000Z", amount: 999_000, clicks: tags({ ...promo, utm_campaign: "promo-okt" }) });
  return seeded;
}

test("REQ-261: UTM tags are trimmed and lower-cased into one campaign; untagged orders form the last row", async () => {
  const { d1 } = seedUtm();
  const { data } = await utmReport(d1, OCTOBER);
  assert.deepEqual(
    data.rows.map((row) => [row.source, row.medium, row.campaign, row.untagged]),
    [
      ["google", "cpc", "brand", false],
      ["facebook", "paid_social", "promo-okt", false],
      ["tiktok", null, "flash", false],
      [null, null, null, true],
    ],
  );
  const [brand, promo, flash, none] = data.rows;
  assert.equal(flash.orders, 2, "a blank utm_medium and a missing one are one row");
  assert.equal(promo.orders, 3, "`Promo-Okt `, `promo-okt` and `PROMO-OKT` are one row");
  assert.equal(promo.leads, 1);
  assert.equal(promo.revenue, 220_000, "the returned order is released, not revenue");
  assert.equal(promo.delivered, 1);
  assert.equal(promo.delivered_revenue, 100_000);
  assert.equal(promo.returned, 1);
  assert.equal(promo.closing_rate, 75); // 3 / (3 + 1)
  assert.equal(promo.delivered_share, 33.33);
  assert.equal(promo.return_share, 50);
  assert.deepEqual(
    promo.contents.map((content) => [content.content, content.orders, content.leads]),
    [["video-a", 2, 0], [null, 1, 1]],
  );
  assert.equal(brand.orders, 2);
  assert.equal(brand.live_orders, 1);
  assert.equal(brand.revenue, 200_000, "the cancelled order is no revenue");
  assert.equal(none.orders, 3);
  assert.equal(none.leads, 1);
  assert.deepEqual(none.contents, []);
  assert.equal(UTM_NONE_LABEL, "(tanpa UTM)");
  assert.equal(data.tagged_share, 70); // 7 of 10 orders

  // Totals are the landing report's for the same period: one order definition.
  const landing = await landingRanking(d1, OCTOBER);
  assert.deepEqual(data.totals, {
    leads: landing.data.totals.leads,
    orders: landing.data.totals.orders,
    revenue: landing.data.totals.revenue,
  });
  assert.deepEqual(data.totals, { leads: 2, orders: 10, revenue: 830_000 });
});

test("UTM route: aggregates only, channel filter, no-store, an empty period is empty", async () => {
  const { d1 } = seedUtm();
  const response = await utmRoute(routeContext(d1, "date_filter=custom&date_start=2026-10-01&date_end=2026-10-28"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.doesNotMatch(body, PERSONAL);
  assert.doesNotMatch(body, /fb\.1|g\.1/, "click-id values never leave");
  const google = await (await utmRoute(routeContext(d1, "date_filter=custom&date_start=2026-10-01&date_end=2026-10-28&channel=google"))).json();
  assert.ok(google.data.rows.every((row: { source: string | null }) => row.source !== "facebook"));
  const empty = await (await utmRoute(routeContext(d1, "date_filter=custom&date_start=2026-08-01&date_end=2026-08-02"))).json();
  assert.deepEqual(empty.data, { rows: [], totals: { leads: 0, orders: 0, revenue: 0 }, tagged_share: 0 });
});
