// `/admin/orders` server-renders its first rows under the filters a deep link
// carries, and they are the rows the list API returns for the request the
// OrdersTable island makes from the same link. Runs the real list route against
// the migration chain in SQLite.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initialOrderListFilters, orderListQuery } from "./admin-orders-initial.ts";
import { persistOrder } from "./order-persistence.ts";
import { splitMigrationStatements } from "./schema-version.ts";
import { SOURCE_SLUG_NONE_FILTER } from "./source-slug.ts";

// Routes import their siblings without an extension, as Astro allows.
const extensionResolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[a-z0-9]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
const { GET: listRoute, ORDER_LIST_PREFETCH_HEADER } = await import("../pages/api/admin/orders/index.ts");
extensionResolver.deregister();

type Value = null | number | string;

function openDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL("../db/migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    for (const statement of splitMigrationStatements(readFileSync(new URL(name, directory), "utf8"))) {
      sqlite.exec(statement);
    }
  }
  sqlite.exec(`
    INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Toko Uji', 'toko-uji', '2026-10-29T00:00:00.000Z');
    INSERT INTO warehouses (id, store_id, name, origin_area_id, pickup_address_id, address, city, province)
    VALUES (1, 1, 'Gudang', 'origin-1', 'pickup-1', 'Jl. Gudang 1', 'Surabaya', 'ID-JI');
    INSERT INTO products (id, store_id, title, slug, created_at)
    VALUES (10001, 1, 'Produk Uji', 'produk-uji', '2026-10-29T00:00:00.000Z');
    INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams)
    VALUES (20001, 10001, 'UJI-1', '500 gr', 50000, 500);
  `);
  const statement = (sql: string, values: Value[] = []) => ({
    bind: (...next: Value[]) => statement(sql, next.map((value) => value ?? null)),
    async first<T>() {
      return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(sql).all(...values) as T[] };
    },
    async run() {
      const result = sqlite.prepare(sql).run(...values);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    execute() {
      const prepared = sqlite.prepare(sql);
      if (/^\s*(SELECT|WITH)/i.test(sql) || /RETURNING/i.test(sql)) {
        return { success: true, results: prepared.all(...values), meta: { changes: 0 } };
      }
      const result = prepared.run(...values);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
  });
  const d1 = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Array<ReturnType<typeof statement>>) {
      return statements.map((item) => item.execute());
    },
  } as unknown as D1Database;
  return { sqlite, d1 };
}

async function seed() {
  const { sqlite, d1 } = openDatabase();
  const rows: Array<[name: string, status: string, slug: string | null]> = [
    ["Budi Santoso", "pending", "promo-a"],
    ["Siti Rahayu", "processing", "promo-a"],
    ["Budi Hartono", "processing", "promo-b"],
    ["Rina Wati", "cancelled", null],
    ["Agus Salim", "pending", null],
  ];
  for (const [index, [name, status, slug]] of rows.entries()) {
    const order = await persistOrder(d1, {
      submitToken: `initial-list-${index}`,
      customerName: name,
      customerPhone: `628123456780${index}`,
      address: "Jl. Melati 10",
      province: "ID-JI",
      city: "Surabaya",
      district: "Wonokromo",
      variantKey: "20001",
      quantity: 1,
      shippingCost: 18000,
      paymentMethod: "cod",
      warehouseId: 1,
      destinationAreaId: "area-surabaya",
      courierCode: "JNE",
      courierService: "REG",
    });
    sqlite
      .prepare("UPDATE orders SET shipping_status = ?, source_page_path = ?, rts_risk_label = 'LOW' WHERE id = ?")
      .run(status, slug && `/lp/${slug}`, order.id);
  }
  // A lead is never an order row on this page.
  sqlite.prepare("UPDATE orders SET shipping_status = 'abandoned' WHERE customer_name = 'Agus Salim'").run();
  return { sqlite, d1 };
}

/** What `/admin/orders` server-renders for a link: the list route, asked the island's first question. */
async function firstRows(d1: D1Database, link: string, tenant?: { siteUrl: string }) {
  const pageQuery = new URL(`https://admin.preview.test/admin/orders${link}`).searchParams;
  const url = new URL(`https://admin.preview.test/api/admin/orders?${orderListQuery(initialOrderListFilters(pageQuery), 1, false)}`);
  const request = new Request(url, { headers: { [ORDER_LIST_PREFETCH_HEADER]: "1" } });
  const response = await listRoute({ url, request, locals: { runtimeEnv: { OMS_DB: d1 }, tenant } } as never);
  const payload = (await response.json()) as {
    success: boolean;
    data: Array<{ id: number; customer_name: string; shipping_status: string; order_details_link: string | null }>;
  };
  assert.equal(payload.success, true);
  return payload.data;
}

for (const [link, expected] of [
  ["", ["Rina Wati", "Budi Hartono", "Siti Rahayu", "Budi Santoso"]],
  ["?source_slug=promo-a", ["Siti Rahayu", "Budi Santoso"]],
  [`?source_slug=${SOURCE_SLUG_NONE_FILTER}`, ["Rina Wati"]],
  ["?source_slug=unknown-page", []],
  ["?search=Budi", ["Budi Hartono", "Budi Santoso"]],
  ["?status=processing", ["Budi Hartono", "Siti Rahayu"]],
  ["?shipping_status=cancelled", ["Rina Wati"]],
  ["?search=budi&status=processing&source_slug=promo-b", ["Budi Hartono"]],
] as const) {
  test(`/admin/orders${link || " (no filter)"} paints the rows its filters select`, async () => {
    const { d1 } = await seed();
    assert.deepEqual((await firstRows(d1, link)).map((row) => row.customer_name), expected);
  });
}

test("a void order with shipping still pending is listed as cancelled, never under Menunggu", async () => {
  const { sqlite, d1 } = await seed();
  sqlite.prepare("UPDATE orders SET stock_restored_at = '2026-10-31T00:00:00.000Z' WHERE customer_name = 'Budi Santoso'").run();
  assert.deepEqual((await firstRows(d1, "?status=pending")).map((row) => row.customer_name), []);
  const cancelled = await firstRows(d1, "?status=cancelled");
  assert.deepEqual(cancelled.map((row) => row.customer_name), ["Rina Wati", "Budi Santoso"]);
});

test("a drill-down's date range reaches the first paint", async () => {
  const { sqlite, d1 } = await seed();
  sqlite.prepare("UPDATE orders SET created_at = '2020-01-01T00:00:00.000Z' WHERE customer_name <> 'Siti Rahayu'").run();
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const link = `?date_filter=custom&date_start=${today}&date_end=${today}`;
  sqlite.prepare("UPDATE orders SET created_at = ? WHERE customer_name = 'Siti Rahayu'").run(new Date().toISOString());
  assert.deepEqual((await firstRows(d1, link)).map((row) => row.customer_name), ["Siti Rahayu"]);
});

test("a link sent to a buyer starts with the store's site, not the host the admin is open on", async () => {
  const { sqlite, d1 } = await seed();
  sqlite.prepare("UPDATE orders SET public_status_token = 'tok' WHERE customer_name = 'Siti Rahayu'").run();
  const [configured] = await firstRows(d1, "?search=Siti", { siteUrl: "https://toko.test" });
  assert.match(String(configured.order_details_link), /^https:\/\/toko\.test\/thanks#/);
  const [unconfigured] = await firstRows(d1, "?search=Siti", { siteUrl: "https://example.com" });
  assert.match(String(unconfigured.order_details_link), /^https:\/\/admin\.preview\.test\/thanks#/, "an unset site URL falls back to the request");
});
