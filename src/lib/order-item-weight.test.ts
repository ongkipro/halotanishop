// A-397: an order line keeps the weight it was quoted with. Runs persistOrder
// and dispatchOrderToMengantar against the real migration chain in SQLite, and
// captures the body that would have gone to Mengantar (no network).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { convertAbandonedLead } from "./abandoned-lead.ts";
import { dispatchOrderToMengantar } from "./mengantar-dispatch.ts";
import { persistOrder } from "./order-persistence.ts";
import { splitMigrationStatements } from "./schema-version.ts";
import { resolveEligibleShippingRates } from "./shipping-quote.ts";

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
    VALUES (20001, 10001, 'UJI-1', '250 gr', 50000, 250);
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

const locals = { runtimeEnv: {} } as unknown as App.Locals;

async function placeOrder(d1: D1Database, token: string, quantity: number) {
  return persistOrder(d1, {
    submitToken: token,
    customerName: "Siti Rahayu",
    customerPhone: `62812345678${token.length % 10}${quantity}`,
    address: "Jl. Melati 10",
    province: "ID-JI",
    city: "Surabaya",
    district: "Wonokromo",
    variantKey: "20001",
    quantity,
    shippingCost: 18000,
    paymentMethod: "cod",
    warehouseId: 1,
    destinationAreaId: "area-surabaya",
    courierCode: "JNE",
    courierService: "REG",
  });
}

async function dispatchedWeight(d1: D1Database, orderId: number) {
  const bodies: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        success: true,
        batch_id: "batch-1",
        data: [{ _id: `provider-${orderId}`, ORDER_ID: "MG-1", cnote_no: "RESI-1", isPaid: true }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const outcome = await dispatchOrderToMengantar(d1, locals, orderId);
    assert.equal(outcome.status, "dispatched", outcome.error);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(bodies.length, 1);
  return (bodies[0] as { orders: Array<{ weight: number }> }).orders[0].weight;
}

test("a new order line records the variant's weight at checkout", async () => {
  const { sqlite, d1 } = openDatabase();
  const order = await placeOrder(d1, "submit-weight-1", 2);
  const row = sqlite
    .prepare("SELECT weight_grams FROM order_items WHERE order_id = ?")
    .get(order.id) as { weight_grams: number | null };
  assert.equal(row.weight_grams, 250);
});

test("editing the variant after checkout does not change what dispatch sends", async () => {
  const { sqlite, d1 } = openDatabase();
  const order = await placeOrder(d1, "submit-weight-2", 2);
  sqlite.exec("UPDATE product_variants SET weight_grams = 1000 WHERE id = 20001");
  // 250 g × 2, as quoted — not 1000 g × 2.
  assert.equal(await dispatchedWeight(d1, order.id), 0.5);
});

test("an order placed before the column existed dispatches with the variant weight", async () => {
  const { sqlite, d1 } = openDatabase();
  const order = await placeOrder(d1, "submit-weight-3", 2);
  sqlite.prepare("UPDATE order_items SET weight_grams = NULL WHERE order_id = ?").run(order.id);
  sqlite.exec("UPDATE product_variants SET weight_grams = 1000 WHERE id = 20001");
  assert.equal(await dispatchedWeight(d1, order.id), 2);
});

// A-396: the existing contract, locked without touching shipping-quote.ts or
// mengantar-*.ts. The quote asks Mengantar for weight_grams / 1000 × quantity
// kg, and dispatch sends that same figure for the order line.
for (const grams of [1000, 250]) {
  test(`quote and dispatch agree on ${grams} g × 3`, async () => {
    const { sqlite, d1 } = openDatabase();
    sqlite.prepare("UPDATE product_variants SET weight_grams = ? WHERE id = 20001").run(grams);
    const expectedKg = (grams / 1000) * 3;

    let quotedWeight = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      quotedWeight = new URL(String(input)).searchParams.get("weight") ?? "";
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      await resolveEligibleShippingRates(d1, locals, {
        destinationId: "area-surabaya",
        paymentMethod: "cod",
        variantKey: "20001",
        quantity: 3,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(Number(quotedWeight), expectedKg);

    const order = await placeOrder(d1, `submit-contract-${grams}`, 3);
    assert.equal(await dispatchedWeight(d1, order.id), expectedKg);
  });
}

// Review fix: a lead converted by CS records its weight like a checkout does.
test("CS conversion of a lead records the variant's weight at conversion", async () => {
  const { sqlite, d1 } = openDatabase();
  const order = await placeOrder(d1, "submit-lead-1", 1);
  sqlite
    .prepare("UPDATE orders SET shipping_status = 'abandoned', order_number = 'ABN-10001' WHERE id = ?")
    .run(order.id);
  sqlite.exec("UPDATE product_variants SET weight_grams = 400 WHERE id = 20001");
  await convertAbandonedLead(d1, order.id, {
    customerName: "Siti Rahayu",
    customerPhone: "081234567890",
    address: "Jl. Melati 10 Surabaya",
    district: "Wonokromo",
    city: "Surabaya",
    province: "ID-JI",
    destinationAreaId: "area-surabaya",
    variantId: 20001,
    quantity: 2,
    warehouseId: 1,
    courierCode: "JNE",
    courierService: "REG",
    shippingCost: 18000,
    followedUpBy: "cs",
  });
  const row = sqlite
    .prepare("SELECT weight_grams FROM order_items WHERE order_id = ?")
    .get(order.id) as { weight_grams: number | null };
  assert.equal(row.weight_grams, 400);
  sqlite.exec("UPDATE product_variants SET weight_grams = 1000 WHERE id = 20001");
  // 400 g × 2, as converted — not 1000 g × 2.
  assert.equal(await dispatchedWeight(d1, order.id), 0.8);
});
