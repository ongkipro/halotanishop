// A-397 review fix: the admin courier re-quote of an existing order quotes the
// weight recorded on its line — what dispatch sends — not the variant's current
// weight, and OrderDetail's preview quotes the same figure. Runs the real admin
// order route, the public rate route and dispatch against the migration chain
// in SQLite; Mengantar is a stub that records the weight it is asked for.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dispatchOrderToMengantar } from "./mengantar-dispatch.ts";
import { persistOrder } from "./order-persistence.ts";
import { splitMigrationStatements } from "./schema-version.ts";
import { quoteUnitWeightKg } from "./weight.ts";

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
const detailRoute = await import("../pages/api/admin/orders/[id].ts");
const { GET: shippingRatesRoute } = await import("../pages/api/shipping-rates.ts");
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
    INSERT INTO stores (id, name, slug, created_at, mengantar_api_key, mengantar_base_url)
    VALUES (1, 'Toko Uji', 'toko-uji', '2026-10-29T00:00:00.000Z', 'test-key', 'https://provider.test');
    INSERT INTO warehouses (id, store_id, name, origin_area_id, pickup_address_id, address, city, province)
    VALUES (1, 1, 'Gudang', 'origin-1', 'pickup-1', 'Jl. Gudang 1', 'Surabaya', 'ID-JI');
    INSERT INTO products (id, store_id, title, slug, created_at)
    VALUES (10001, 1, 'Produk Uji', 'produk-uji', '2026-10-29T00:00:00.000Z');
    INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams)
    VALUES (20001, 10001, 'UJI-1', '500 gr', 50000, 500);
    INSERT INTO courier_rules (store_id, courier_code, is_enabled, is_cod_enabled) VALUES (1, 'SiCepat', 1, 1);
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
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => item.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { sqlite, d1 };
}

/** Mengantar stub: records every estimate's `weight` and every dispatch body. */
function stubMengantar(context: { after: (fn: () => void) => void }) {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const quoted: number[] = [];
  const dispatched: number[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "POST" && init.body) {
      const body = JSON.parse(String(init.body)) as { orders?: Array<{ weight: number }> };
      if (body.orders) {
        dispatched.push(body.orders[0].weight);
        return Response.json({
          success: true,
          batch_id: "batch-1",
          data: [{ _id: "provider-1", ORDER_ID: "MG-1", cnote_no: "RESI-1", isPaid: true }],
        });
      }
    }
    if (url.searchParams.has("weight")) {
      quoted.push(Number(url.searchParams.get("weight")));
      // Price follows weight, so a wrong weight is also a wrong charge.
      const kg = Number(url.searchParams.get("weight"));
      return Response.json({
        success: true,
        data: { SiCepat: { price: Math.round(kg * 10_000), estimate_delivery: "2-3" } },
      });
    }
    return Response.json({ success: false, message: "not stubbed" }, { status: 404 });
  };
  return { quoted, dispatched };
}

const admin = (d1: D1Database) => ({ admin: { id: "admin-1", role: "owner" }, runtimeEnv: { OMS_DB: d1 } });

test("a courier re-quote after the variant is edited charges and ships the recorded weight (A-397)", async (context) => {
  const { sqlite, d1 } = openDatabase();
  const order = await persistOrder(d1, {
    submitToken: "requote-weight-1",
    customerName: "Siti Rahayu",
    customerPhone: "6281234567890",
    address: "Jl. Melati 10",
    province: "ID-JI",
    city: "Surabaya",
    district: "Wonokromo",
    variantKey: "20001",
    quantity: 2,
    shippingCost: 18000,
    paymentMethod: "cod",
    warehouseId: 1,
    destinationAreaId: "area-surabaya",
    courierCode: "JNE",
    courierService: "REG",
  });
  // Checkout recorded 500 g; the variant is edited to 1500 g afterwards.
  sqlite.exec("UPDATE product_variants SET weight_grams = 1500 WHERE id = 20001");
  // No background receiver-score call from the detail GET.
  sqlite.prepare("UPDATE orders SET receiver_performance_checked_at = '2026-10-29T00:00:00.000Z' WHERE id = ?").run(order.id);
  const recordedKg = 0.5 * 2;
  const mengantar = stubMengantar(context);

  // OrderDetail's preview: the query it builds from the detail GET's first item.
  const detail = (await (
    await detailRoute.GET({ params: { id: String(order.id) }, locals: admin(d1) } as never)
  ).json()) as { data: { items: Array<{ quantity: number; weight_grams: number; variant_id: number }> } };
  const firstItem = detail.data.items[0];
  const unitWeightKg = quoteUnitWeightKg(firstItem.weight_grams);
  assert.equal(unitWeightKg, 0.5);
  const previewUrl = new URL("https://toko.test/api/shipping-rates");
  previewUrl.search = new URLSearchParams({
    destination_id: "area-surabaya",
    payment_method: "cod",
    quantity: String(firstItem.quantity),
    weight: String(unitWeightKg),
    warehouse_id: "1",
  }).toString();
  const preview = (await (
    await shippingRatesRoute({ request: new Request(previewUrl), url: previewUrl, locals: { runtimeEnv: { OMS_DB: d1 } } } as never)
  ).json()) as { items: Array<{ courier_service_id: number; courier_code: string; shipping_cost: number }> };
  const picked = preview.items.find((rate) => rate.courier_code === "SiCepat");
  assert.ok(picked, `the preview offers SiCepat: ${JSON.stringify(preview)}`);

  // The save with the rate the operator picked from that preview.
  const response = await detailRoute.PATCH({
    params: { id: String(order.id) },
    locals: admin(d1),
    request: new Request("https://toko.test/api/admin/orders/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courier_code: picked.courier_code, courier_service_id: picked.courier_service_id }),
    }),
  } as never);
  assert.equal(response.status, 200, await response.clone().text());
  const saved = sqlite.prepare("SELECT shipping_cost, courier_code FROM orders WHERE id = ?").get(order.id) as {
    shipping_cost: number;
    courier_code: string;
  };
  assert.equal(saved.courier_code, "SiCepat");
  // Preview and save quote the recorded 0.5 kg × 2, not 1.5 kg × 2.
  assert.deepEqual(mengantar.quoted, [recordedKg, recordedKg]);
  assert.equal(saved.shipping_cost, picked.shipping_cost, "the save charges what the preview showed");
  assert.equal(saved.shipping_cost, 10_000);

  // Dispatch sends exactly the weight that was quoted.
  const outcome = await dispatchOrderToMengantar(d1, { runtimeEnv: {} } as unknown as App.Locals, order.id);
  assert.equal(outcome.status, "dispatched", outcome.error);
  assert.deepEqual(mengantar.dispatched, [recordedKg]);
});

// The test above builds the preview query by hand; this keeps the island on
// the same rule, so the preview the operator sees cannot drift back to the
// variant's current weight while the save charges the recorded one.
test("the order detail preview quotes the recorded weight, falling back to the variant only without one", () => {
  const source = readFileSync(new URL("../components/admin/OrderDetail.tsx", import.meta.url), "utf8");
  assert.match(source, /const unitWeightKg = quoteUnitWeightKg\(firstItem\.weight_grams\);/);
  assert.match(source, /if \(unitWeightKg === null\) params\.set\("variant_id"[^\n]*\n\s*else params\.set\("weight", String\(unitWeightKg\)\);/);
  assert.equal(source.match(/params\.set\("variant_id"/g)?.length, 1, "variant_id is set only in the no-weight fallback");
});
