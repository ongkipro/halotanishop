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
