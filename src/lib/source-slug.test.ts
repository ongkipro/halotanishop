import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  resolveSourceLabels,
  sourceLabelsFromRows,
  sourcePathFromReferer,
  sourceSlugFromPath,
} from "./source-slug.ts";
import { recordAbandonedOrder } from "./order-persistence.ts";

type SqlValue = null | number | string;

const MIGRATIONS_DIR = new URL("../db/migrations/", import.meta.url);
const migrationText = (name: string) =>
  readFileSync(new URL(name, MIGRATIONS_DIR), "utf8").replaceAll("--> statement-breakpoint", "");
/** Found by suffix, never by number: integration renumbers the chain. */
const SLUG_MIGRATION = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith("_order_source_slug.sql"));

/**
 * The whole checked-in chain, in order: these tests run today's code, which
 * writes columns later migrations add (A41's `order_items.weight_grams`).
 * The pre-slug rows test below stops before the slug migration on its own.
 */
function migratedSqlite() {
  assert.ok(SLUG_MIGRATION, "the source-slug migration exists");
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(migrationText(name));
  }
  return sqlite;
}

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
    return this.execute();
  }
  execute() {
    if (/^\s*SELECT\b/i.test(this.sql)) {
      return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values), meta: { changes: 0 } };
    }
    const info = this.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
}

function d1(sqlite: DatabaseSync) {
  return {
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

const LONG_SEGMENT = "a".repeat(497);
/** Every shape A-341 names, plus the edges the SQL has to agree on. */
const PATHS: Array<[string | null, string | null]> = [
  ["/promo-a", "promo-a"],
  ["/produk/x", "x"],
  ["/PROMO/", "promo"],
  ["/Promo-A/", "promo-a"],
  ["/produk/kopi", "kopi"],
  ["/a?utm=1#h", "a"],
  ["/a#h?x=1", "a"],
  ["/promo/?utm_source=fb", "promo"],
  ["/", "beranda"],
  ["//", "beranda"],
  ["/?fbclid=1", "beranda"],
  ["", null],
  ["?x=1", null],
  [null, null],
  [`/${LONG_SEGMENT}`.slice(0, 500), "a".repeat(80)],
  ["/x/" + "B".repeat(120), "b".repeat(80)],
  ["/promo-%C3%A9", "promo-%c3%a9"],
  ["/CAFÉ-Ñ", "cafÉ-Ñ"],
  ["/kopi-🙂-susu", "kopi-🙂-susu"],
  ["promo", "promo"],
];

test("sourceSlugFromPath covers every A-341 shape", () => {
  for (const [path, expected] of PATHS) {
    assert.equal(sourceSlugFromPath(path), expected, `path ${JSON.stringify(path)}`);
  }
  assert.equal(sourceSlugFromPath(undefined), null);
  assert.ok((sourceSlugFromPath("/" + "é".repeat(200)) ?? "").length <= 80);
});

test("the generated column and the function agree on every path, old rows included", () => {
  const sqlite = new DatabaseSync(":memory:");
  // An "old" database: orders exist with paths before the slug migration runs.
  const names = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  for (const name of names) {
    if (name === SLUG_MIGRATION) break;
    sqlite.exec(migrationText(name));
  }
  sqlite.exec("INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Toko', 'toko', '2026-10-01T00:00:00.000Z')");
  const insert = sqlite.prepare(`INSERT INTO orders (order_number, store_id, customer_name, customer_phone, address,
    province, city, district, total_amount, created_at, source_page_path)
    VALUES (?, 1, 'Budi', '6281200000000', 'Jl', 'Jawa Barat', 'Bandung', 'Coblong', 1000, '2026-10-01T00:00:00.000Z', ?)`);
  PATHS.forEach(([path], index) => insert.run(`INV-${10000 + index}`, path));

  sqlite.exec(migrationText(SLUG_MIGRATION as string));
  // New rows after the migration get it with no change to how they are written.
  insert.run("INV-20000", "/Baru/");

  const rows = sqlite.prepare("SELECT order_number, source_page_path, source_slug FROM orders ORDER BY id").all() as Array<{
    order_number: string;
    source_page_path: string | null;
    source_slug: string | null;
  }>;
  assert.equal(rows.length, PATHS.length + 1);
  for (const row of rows) {
    assert.equal(row.source_slug, sourceSlugFromPath(row.source_page_path), `path ${JSON.stringify(row.source_page_path)}`);
  }
  assert.equal(rows.at(-1)?.source_slug, "baru");

  const plan = sqlite
    .prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM orders WHERE source_slug = ? AND created_at >= ?")
    .all("promo", "2026-01-01") as Array<{ detail: string }>;
  assert.match(plan.map((step) => step.detail).join("\n"), /idx_orders_source_slug_created/);
});

test("sourcePathFromReferer keeps a same-origin path and refuses anything else", () => {
  const request = new URL("https://toko.test/api/record-abandoned-order");
  assert.equal(sourcePathFromReferer("https://toko.test/promo-a?fbclid=1", request), "/promo-a");
  assert.equal(sourcePathFromReferer(null, request), null);
  assert.equal(sourcePathFromReferer("", request), null);
  assert.equal(sourcePathFromReferer("not a url", request), null);
  assert.equal(sourcePathFromReferer("https://evil.test/promo-a", request), null);
  assert.equal(sourcePathFromReferer("http://toko.test/promo-a", request), null);
  assert.equal(sourcePathFromReferer(`https://toko.test/${"p".repeat(700)}`, request)?.length, 500);
});

function seedLeadStore(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Toko', 'toko', '2026-10-01T00:00:00.000Z');
  `);
}

test("a captured lead records its page; a repeat inside two hours keeps the first", async () => {
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  const database = d1(sqlite);

  await recordAbandonedOrder(database, {
    customerName: "Budi Santoso",
    customerPhone: "081234567890",
    sourcePagePath: "/Promo-A/",
  });
  await recordAbandonedOrder(database, {
    customerName: "Budi Santoso",
    customerPhone: "081234567890",
    sourcePagePath: "/promo-b",
  });
  await recordAbandonedOrder(database, { customerName: "Sari Dewi", customerPhone: "081298765432" });

  const rows = sqlite
    .prepare("SELECT customer_phone, source_page_path, source_slug FROM orders ORDER BY id")
    .all() as Array<{ customer_phone: string; source_page_path: string | null; source_slug: string | null }>;
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, { customer_phone: "6281234567890", source_page_path: "/Promo-A/", source_slug: "promo-a" });
  assert.deepEqual({ ...rows[1] }, { customer_phone: "6281298765432", source_page_path: null, source_slug: null });

  // A repeat on a lead that had no page yet takes the first one it sees.
  await recordAbandonedOrder(database, {
    customerName: "Sari Dewi",
    customerPhone: "081298765432",
    sourcePagePath: "/promo-c",
  });
  const later = sqlite.prepare("SELECT source_slug FROM orders WHERE customer_phone = '6281298765432'").get() as {
    source_slug: string;
  };
  assert.equal(later.source_slug, "promo-c");
});

test("the abandoned-lead route reads the page from Referer, and a foreign one stores null", async () => {
  const { POST } = await import("../pages/api/record-abandoned-order.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  const database = d1(sqlite);
  const post = (phone: string, headers: Record<string, string>) =>
    POST({
      request: new Request("https://toko.test/api/record-abandoned-order", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": phone, ...headers },
        body: JSON.stringify({ customer_name: "Budi Santoso", customer_phone: phone }),
      }),
      locals: { runtimeEnv: { OMS_DB: database } },
    } as unknown as Parameters<typeof POST>[0]);

  assert.equal((await post("081200000001", { referer: "https://toko.test/promo-a?fbclid=x" })).status, 200);
  assert.equal((await post("081200000002", { referer: "https://other.test/promo-a" })).status, 200);
  assert.equal((await post("081200000003", {})).status, 200);
  const slugs = sqlite.prepare("SELECT source_slug FROM orders ORDER BY id").all() as Array<{ source_slug: string | null }>;
  assert.deepEqual(slugs.map((row) => row.source_slug), ["promo-a", null, null]);
});

test("labels: CMS title, native name, product name, a claimed product page as one name, else the slug", async () => {
  const sqlite = migratedSqlite();
  sqlite.exec(`
    INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Toko', 'toko', '2026-10-01T00:00:00.000Z');
    INSERT INTO products (id, store_id, slug, title, created_at) VALUES
      (20001, 1, 'kopi', 'Kopi Bubuk', '2026-10-01T00:00:00.000Z'),
      (20002, 1, 'teh', 'Teh Hijau', '2026-10-01T00:00:00.000Z');
    INSERT INTO landing_pages (id, slug, title, product_id, is_active, created_at, updated_at, is_product_page, source) VALUES
      ('lp1', 'promo-kopi', 'Promo Kopi Ramadan', '20001', 1, '2026-10-01', '2026-10-01', 0, 'cms'),
      ('lp2', 'teh-sehat', 'Teh Sehat Native', '20002', 1, '2026-10-01', '2026-10-01', 1, 'native');
  `);
  const labels = await resolveSourceLabels(d1(sqlite), ["promo-kopi", "teh-sehat", "kopi", "teh", "beranda", "tak-dikenal", null]);
  assert.deepEqual(labels.get("promo-kopi"), { slug: "promo-kopi", label: "Promo Kopi Ramadan", kind: "landing" });
  assert.deepEqual(labels.get("teh-sehat"), { slug: "teh-sehat", label: "Teh Sehat Native", kind: "native" });
  assert.deepEqual(labels.get("kopi"), { slug: "kopi", label: "Kopi Bubuk", kind: "product" });
  // /produk/teh is served by the claiming landing: one name, not two.
  assert.deepEqual(labels.get("teh"), { slug: "teh", label: "Teh Sehat Native", kind: "native" });
  assert.deepEqual(labels.get("beranda"), { slug: "beranda", label: "Beranda", kind: "home" });
  assert.deepEqual(labels.get("tak-dikenal"), { slug: "tak-dikenal", label: "tak-dikenal", kind: "slug" });
  assert.equal(labels.size, 6);

  // A native page in the compiled register but not yet in the table.
  const fromRegister = sourceLabelsFromRows(["daftar"], [], [{ slug: "daftar", title: "Daftar Native" }]);
  assert.deepEqual(fromRegister.get("daftar"), { slug: "daftar", label: "Daftar Native", kind: "native" });
});

test("converting a lead leaves the order with the page it was submitted on", async () => {
  const { persistOrder } = await import("./order-persistence.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  sqlite.exec(`
    INSERT INTO products (id, store_id, slug, title, created_at) VALUES (20001, 1, 'kopi', 'Kopi', '2026-10-01T00:00:00.000Z');
    INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams) VALUES (101, 20001, 'KOPI-1', '250 g', 50000, 250);
  `);
  const database = d1(sqlite);
  await recordAbandonedOrder(database, {
    customerName: "Budi Santoso",
    customerPhone: "081234567890",
    sourcePagePath: "/promo-a",
  });
  await persistOrder(database, {
    submitToken: "sb_convert_1",
    customerName: "Budi Santoso",
    // The submit routes hand persistOrder a normalised number.
    customerPhone: "6281234567890",
    address: "Jl. Merdeka 1",
    province: "Jawa Barat",
    city: "Bandung",
    district: "Coblong",
    variantKey: "101",
    quantity: 1,
    shippingCost: 10000,
    paymentMethod: "cod",
    sourcePagePath: "/produk/kopi",
  });
  const rows = sqlite.prepare("SELECT shipping_status, source_page_path, source_slug FROM orders").all() as Array<{
    shipping_status: string;
    source_page_path: string;
    source_slug: string;
  }>;
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { shipping_status: "pending", source_page_path: "/produk/kopi", source_slug: "kopi" });
});

test("the order and lead lists filter by source; an unknown slug returns no rows, not all", async () => {
  const { GET: listOrders } = await import("../pages/api/admin/orders/index.ts");
  const { GET: listLeads } = await import("../pages/api/admin/abandoned-orders.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  sqlite.exec(`
    INSERT INTO landing_pages (id, slug, title, product_id, is_active, created_at, updated_at) VALUES
      ('lp1', 'promo-a', 'Promo A Ramadan', '1', 1, '2026-10-01', '2026-10-01');
  `);
  const insert = sqlite.prepare(`INSERT INTO orders (order_number, store_id, customer_name, customer_phone, address,
    province, city, district, total_amount, created_at, source_page_path, shipping_status, rts_risk_label)
    VALUES (?, 1, 'Budi', '6281200000000', 'Jl', 'Jawa Barat', 'Bandung', 'Coblong', 1000, '2026-10-01T00:00:00.000Z', ?, ?, 'LOW')`);
  insert.run("INV-1", "/promo-a", "pending");
  insert.run("INV-2", "/promo-a?fbclid=1", "pending");
  insert.run("INV-3", "/promo-b", "pending");
  insert.run("INV-4", null, "pending");
  insert.run("ABN-5", "/promo-b", "abandoned");
  const database = d1(sqlite);
  const call = async (handler: typeof listOrders, query: string) => {
    const response = await handler({
      url: new URL(`https://toko.test/api/admin/x?${query}`),
      locals: { runtimeEnv: { OMS_DB: database } },
    } as unknown as Parameters<typeof listOrders>[0]);
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      data: Array<{ order_number: string; source_slug: string | null; source_label: string | null; source_page_path: string | null }>;
      source_options?: Array<{ value: string; label: string; count: number }>;
    }>;
  };

  const all = await call(listOrders, "source_options=1");
  assert.equal(all.data.length, 4);
  assert.deepEqual(all.source_options, [
    { value: "promo-a", label: "Promo A Ramadan", count: 2 },
    { value: "promo-b", label: "promo-b", count: 1 },
  ]);
  const first = all.data.find((row) => row.order_number === "INV-2");
  assert.deepEqual(
    { slug: first?.source_slug, label: first?.source_label, path: first?.source_page_path },
    { slug: "promo-a", label: "Promo A Ramadan", path: "/promo-a?fbclid=1" },
  );

  const promoA = await call(listOrders, "source_slug=promo-a");
  assert.deepEqual(promoA.data.map((row) => row.order_number).sort(), ["INV-1", "INV-2"]);
  assert.equal((await call(listOrders, "source_slug=tidak-ada")).data.length, 0);
  assert.deepEqual((await call(listOrders, "source_slug=__none__")).data.map((row) => row.order_number), ["INV-4"]);
  // No options unless asked: the menu is read once per list load.
  assert.equal(promoA.source_options, undefined);

  const leads = await call(listLeads, "source_slug=promo-b&source_options=1");
  assert.deepEqual(leads.data.map((row) => row.order_number), ["ABN-5"]);
  assert.deepEqual(leads.source_options, [{ value: "promo-b", label: "promo-b", count: 1 }]);
  assert.equal((await call(listLeads, "source_slug=promo-a")).data.length, 0);
});

test("the CSV export holds the rows each list shows, under the same filters", async () => {
  const { GET: exportOrders } = await import("../pages/api/admin/orders/export.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  sqlite.exec(`
    INSERT INTO products (id, store_id, title, slug, created_at) VALUES (1, 1, 'Pupuk Kojien', 'kojien', '2026-10-01');
    INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams) VALUES (11, 1, 'K1', '1 kg', 50000, 1000), (12, 1, 'K5', '5 kg', 200000, 5000);
  `);
  const insert = sqlite.prepare(`INSERT INTO orders (id, order_number, store_id, customer_name, customer_phone, address,
    province, city, district, total_amount, created_at, source_page_path, shipping_status, provider_order_id)
    VALUES (?, ?, 1, ?, '6281200000000', 'Jl. Mawar, 1', 'Jawa Barat', 'Bandung', 'Coblong', 250000, '2026-10-01T00:00:00.000Z', ?, ?, ?)`);
  insert.run(1, "INV-1", "Budi", "/promo-a", "pending", null);
  insert.run(2, "INV-2", "Sari", "/promo-b", "shipped", "MGT-2");
  insert.run(3, "ABN-3", "=cmd", "/promo-b", "abandoned", null);
  sqlite.exec(`
    INSERT INTO order_items (order_id, variant_id, quantity, unit_price) VALUES (1, 11, 1, 50000), (1, 12, 1, 200000), (2, 11, 1, 50000), (3, 11, 1, 50000);
  `);
  const database = d1(sqlite);
  const csv = async (query: string) => {
    const response = await exportOrders({
      url: new URL(`https://toko.test/api/admin/orders/export?${query}`),
      locals: { runtimeEnv: { OMS_DB: database } },
    } as unknown as Parameters<typeof exportOrders>[0]);
    return { status: response.status, type: response.headers.get("content-type"), lines: (await response.text()).slice(1).trimEnd().split("\r\n") };
  };

  const orders = await csv("kind=orders");
  assert.equal(orders.status, 200);
  assert.equal(orders.type, "text/csv; charset=utf-8");
  // INV-2 then INV-1's two items; never the lead.
  assert.deepEqual(orders.lines.slice(1).map((line) => line.split(",")[0]), ["INV-2", "INV-1", "INV-1"]);
  assert.deepEqual((await csv("kind=orders&source_slug=promo-a")).lines.length, 3);
  assert.deepEqual((await csv("kind=orders&shipping_status=shipped")).lines.slice(1).map((line) => line.split(",")[0]), ["INV-2"]);
  const shipping = await csv("kind=shipping");
  assert.deepEqual(shipping.lines.slice(1).map((line) => line.split(",")[0]), ["INV-2"]);
  const leads = await csv("kind=abandoned&search=Kojien");
  assert.equal(leads.lines.length, 2);
  assert.ok(leads.lines[1].includes("'=cmd"), "a formula-like name is defused");
  assert.equal((await csv("kind=bukan")).status, 400);
  assert.equal((await csv("kind=orders&payment_status=hilang")).status, 400);
});

/*
 * The dashboard's "Perlu tindakan" and analytics read the same migrated
 * schema as the list routes above, so they are pinned here against those
 * routes: a count must equal the rows the linked list returns.
 */
test("Perlu tindakan counts what the linked lists show, under the Mengantar push gate", async () => {
  const { readOrderAttention } = await import("./order-attention.ts");
  const { GET: listOrders } = await import("../pages/api/admin/orders/index.ts");
  const { GET: listLeads } = await import("../pages/api/admin/abandoned-orders.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  sqlite.exec(`
    INSERT INTO warehouses (id, store_id, name, origin_area_id, pickup_address_id, address, city, province)
      VALUES (1, 1, 'Gudang', 'AREA-0', 'PICK-1', 'Jl', 'Bandung', 'Jawa Barat'), (2, 1, 'Tanpa pickup', 'AREA-0', '', 'Jl', 'Bandung', 'Jawa Barat');
  `);
  const insert = sqlite.prepare(`INSERT INTO orders (order_number, store_id, warehouse_id, customer_name, customer_phone, address,
    province, city, district, total_amount, created_at, payment_method, payment_status, shipping_status,
    destination_area_id, courier_code, provider_order_id, provider_dispatch_error, cnote_no, mengantar_handover, stock_restored_at, lead_follow_up_status)
    VALUES (?, 1, ?, 'Budi', '6281200000000', 'Jl', 'Jawa Barat', 'Bandung', 'Coblong', 1000, '2026-10-01T00:00:00.000Z',
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const row = (n: string, o: Record<string, unknown>) =>
    insert.run(n, (o.wh ?? 1) as number, (o.pm ?? "cod") as string, (o.ps ?? "unpaid") as string, (o.ss ?? "pending") as string,
      ("area" in o ? o.area : "AREA-1") as string | null, ("courier" in o ? o.courier : "jne") as string | null, (o.pid ?? null) as string | null,
      (o.err ?? null) as string | null, (o.awb ?? null) as string | null, (o.handover ?? null) as string | null,
      (o.void ?? null) as string | null, (o.lead ?? "new") as string);
  row("INV-READY", {});                                         // COD, complete: ready to push
  row("INV-NOAREA", { area: null });                             // waiting, not ready
  row("INV-NOPICK", { wh: 2 });                                  // warehouse without pickup: not ready
  row("INV-QRIS", { pm: "qris", ps: "pending" });                // online unpaid: waiting, not ready
  row("INV-PAID", { pm: "qris", ps: "paid" });                   // online paid: ready
  row("INV-REFUSED", { err: "Alamat ditolak kurir" });           // refused at Mengantar: problem, still ready by the gate
  row("INV-UNKNOWN", { err: "DISPATCH_UNKNOWN: timeout" });      // unknown outcome: problem, never ready
  row("INV-VOID", { pm: "qris", ps: "cancelled", void: "2026-10-02" }); // void: shown as Batal, not waiting
  row("INV-WAYBILL", { ss: "processing", pid: "M-1" });
  row("INV-PICKUP", { ss: "processing", pid: "M-2", awb: "AWB-2", handover: "pickup" });
  row("INV-DROP", { ss: "processing", pid: "M-3", awb: "AWB-3", handover: "drop_off" });
  row("ABN-NEW", { ss: "abandoned" });
  row("ABN-CALLED", { ss: "abandoned", lead: "contacted" });
  const database = d1(sqlite);

  const { items } = await readOrderAttention(database);
  const count = Object.fromEntries(items.map((item) => [item.key, item.count]));
  assert.deepEqual(count, {
    confirm: 7,
    ready_push: 3,
    push_problem: 2,
    awaiting_payment: 1,
    leads_new: 1,
    needs_waybill: 1,
    needs_pickup: 1,
    needs_drop_off: 1,
  });

  const call = async (handler: typeof listOrders, query: string) => {
    const response = await handler({
      url: new URL(`https://toko.test/api/admin/x?${query}`),
      locals: { runtimeEnv: { OMS_DB: database } },
      request: new Request("https://toko.test/api/admin/x"),
    } as unknown as Parameters<typeof listOrders>[0]);
    assert.equal(response.status, 200);
    return response.json() as Promise<{ data: Array<{ order_number: string; dispatch_eligible?: boolean }>; summary?: { unpaid_count: number } }>;
  };
  // Each count equals the rows its link opens.
  const waiting = await call(listOrders, "shipping_status=pending&limit=100");
  assert.equal(waiting.data.length, count.confirm);
  assert.equal(waiting.data.filter((order) => order.dispatch_eligible).length, count.ready_push);
  const unpaid = await call(listOrders, "payment_status=unpaid&limit=100");
  assert.deepEqual(unpaid.data.map((order) => order.order_number), ["INV-QRIS"]);
  assert.equal(unpaid.summary?.unpaid_count, 1, "the card counts online orders awaiting payment, not COD");
  const leads = await call(listLeads, "follow_up_status=new");
  assert.deepEqual(leads.data.map((order) => order.order_number), ["ABN-NEW"]);

  // The env fallback pickup makes the warehouse without one ready, as the list does.
  const withFallback = await readOrderAttention(database, { fallbackPickupAddressId: "PICK-ENV" });
  assert.equal(withFallback.items.find((item) => item.key === "ready_push")?.count, 4);
});

test("the dashboard summary carries the funnel and the period before it", async () => {
  const { GET: analytics } = await import("../pages/api/admin/analytics.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  const insert = sqlite.prepare(`INSERT INTO orders (order_number, store_id, customer_name, customer_phone, address,
    province, city, district, total_amount, created_at, payment_method, payment_status, shipping_status, provider_order_id)
    VALUES (?, 1, 'Budi', '6281200000000', 'Jl', 'Jawa Barat', 'Bandung', 'Coblong', ?, ?, 'cod', 'unpaid', ?, ?)`);
  // Period 2026-10-08..14; the period before is 10-01..07.
  insert.run("INV-1", 100000, "2026-10-09T03:00:00.000Z", "delivered", "M-1");
  insert.run("INV-2", 50000, "2026-10-10T03:00:00.000Z", "returned", "M-2");
  insert.run("INV-3", 70000, "2026-10-11T03:00:00.000Z", "pending", null);
  insert.run("ABN-4", 0, "2026-10-12T03:00:00.000Z", "abandoned", null);
  insert.run("INV-OLD", 40000, "2026-10-03T03:00:00.000Z", "pending", null);
  const response = await analytics({
    url: new URL("https://toko.test/api/admin/analytics?startDate=2026-10-08&endDate=2026-10-14"),
    locals: { runtimeEnv: { OMS_DB: d1(sqlite) } },
  } as unknown as Parameters<typeof analytics>[0]);
  const body = (await response.json()) as { data: { funnel: Record<string, number>; previous: Record<string, unknown>; total_revenue: number } };
  assert.deepEqual(body.data.funnel, { leads: 1, orders: 3, handed_over: 2, delivered: 1, returned: 1 });
  assert.equal(body.data.total_revenue, 170000, "the returned order is not revenue");
  assert.equal(body.data.previous.start_date, "2026-10-01");
  assert.equal(body.data.previous.end_date, "2026-10-07");
  assert.equal(body.data.previous.total_revenue, 40000);
  assert.equal(body.data.previous.live_orders, 1);
});

test("a lapsed QRIS/VA is not 'Belum dibayar'; it is what 'Kedaluwarsa' finds", async () => {
  const { readOrderAttention } = await import("./order-attention.ts");
  const { GET: listOrders } = await import("../pages/api/admin/orders/index.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  const insert = sqlite.prepare(`INSERT INTO orders (id, order_number, store_id, customer_name, customer_phone, address,
    province, city, district, total_amount, created_at, payment_method, payment_status, shipping_status)
    VALUES (?, ?, 1, 'Budi', '6281200000000', 'Jl', 'Jawa Barat', 'Bandung', 'Coblong', 1000, '2026-10-01T00:00:00.000Z', 'qris', 'pending', 'pending')`);
  insert.run(1, "INV-OPEN");
  insert.run(2, "INV-LAPSED");     // pending past expires_at
  insert.run(3, "INV-EXPIRED");    // marked expired by the sweep
  const tx = sqlite.prepare(`INSERT INTO payment_transactions (order_id, reference_id, public_token, channel_code, status, amount, total_amount, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, 'QRIS', ?, 1000, 1000, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`);
  tx.run(1, "R1", "T1", "pending", "2999-01-01T00:00:00.000Z");
  tx.run(2, "R2", "T2", "pending", "2026-10-01T01:00:00.000Z");
  tx.run(3, "R3", "T3", "expired", "2026-10-01T01:00:00.000Z");
  const database = d1(sqlite);
  const list = async (query: string) => {
    const response = await listOrders({
      url: new URL(`https://toko.test/api/admin/x?${query}`),
      locals: { runtimeEnv: { OMS_DB: database } },
      request: new Request("https://toko.test/x"),
    } as unknown as Parameters<typeof listOrders>[0]);
    return ((await response.json()) as { data: Array<{ order_number: string }> }).data.map((row) => row.order_number).sort();
  };
  assert.deepEqual(await list("payment_status=unpaid"), ["INV-OPEN"]);
  assert.deepEqual(await list("payment_status=expired"), ["INV-EXPIRED", "INV-LAPSED"]);
  const { items } = await readOrderAttention(database);
  assert.equal(items.find((item) => item.key === "awaiting_payment")?.count, 1);
});

test("a cut export ends on a whole order and says how many rows it kept", async () => {
  const { GET: exportOrders } = await import("../pages/api/admin/orders/export.ts");
  const { ORDER_EXPORT_ROW_LIMIT } = await import("./order-export.ts");
  const sqlite = migratedSqlite();
  seedLeadStore(sqlite);
  sqlite.exec(`
    INSERT INTO products (id, store_id, title, slug, created_at) VALUES (1, 1, 'Pupuk', 'pupuk', '2026-10-01');
    INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams) VALUES (11, 1, 'P1', '1 kg', 1000, 1000);
  `);
  // One order of three items, then single-item orders filling past the limit.
  // Newest first, so the three-item order (the oldest) straddles the cut.
  const order = sqlite.prepare(`INSERT INTO orders (id, order_number, store_id, customer_name, customer_phone, address,
    province, city, district, total_amount, created_at, shipping_status)
    VALUES (?, ?, 1, 'Budi', '6281200000000', 'Jl', 'Jawa Barat', 'Bandung', 'Coblong', 1000, '2026-10-01T00:00:00.000Z', 'pending')`);
  const item = sqlite.prepare("INSERT INTO order_items (order_id, variant_id, quantity, unit_price) VALUES (?, 11, 1, 1000)");
  sqlite.exec("BEGIN");
  order.run(1, "INV-BIG");
  for (let i = 0; i < 3; i += 1) item.run(1);
  for (let id = 2; id <= ORDER_EXPORT_ROW_LIMIT; id += 1) {
    order.run(id, `INV-${id}`);
    item.run(id);
  }
  sqlite.exec("COMMIT");
  const response = await exportOrders({
    url: new URL("https://toko.test/api/admin/orders/export?kind=orders"),
    locals: { runtimeEnv: { OMS_DB: d1(sqlite) } },
  } as unknown as Parameters<typeof exportOrders>[0]);
  const lines = (await response.text()).trimEnd().split("\r\n").slice(1);
  // 9 999 single-item rows fit; INV-BIG's three would straddle the limit, so none of them ship.
  assert.equal(lines.length, ORDER_EXPORT_ROW_LIMIT - 1);
  assert.ok(!lines.some((line) => line.startsWith("INV-BIG,")));
  assert.equal(response.headers.get("x-export-truncated"), String(ORDER_EXPORT_ROW_LIMIT - 1));
});
