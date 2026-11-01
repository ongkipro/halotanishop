// Audit 2026-10-31 H-1: a buyer who paid an AutoLaris instruction after it was
// replaced must still reach `paid`. Real functions on the full migration chain.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAutoLarisPaymentForOrder, reconcileAutoLarisPaymentStatuses } from "./autolaris-payment.ts";
import { confirmManualAutoLarisPayment } from "./manual-payment-reconciliation.ts";
import { splitMigrationStatements } from "./schema-version.ts";
import { envTenantConfig } from "./tenant.ts";

type Value = null | number | string;

function store() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    for (const sql of splitMigrationStatements(readFileSync(new URL(name, dir), "utf8"))) sqlite.exec(sql);
  }
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  sqlite.exec(`
    INSERT INTO stores (id, name, slug, created_at, autolaris_api_key, autolaris_base_url)
      VALUES (1, 'Toko', 'toko', '2026-01-01', 'qa-key', 'https://autolaris.example.test');
    INSERT INTO admin_credentials (id, username, password_hash, role, updated_at)
      VALUES (10, 'owner.one', 'x', 'owner', '2026-01-01');
    INSERT INTO warehouses (id, store_id, name, origin_area_id, pickup_address_id, address, city, province, contact_name, contact_phone)
      VALUES (1, 1, 'Gudang', 'area-1', 'pickup-1', 'Jl. Gudang 1', 'Surabaya', 'Jawa Timur', 'PIC', '081300000000');
    INSERT INTO products (id, store_id, title, slug, created_at) VALUES (1, 1, 'Kopi', 'kopi', '2026-01-01');
    INSERT INTO product_variants (id, product_id, title, sku, price, weight_grams) VALUES (1, 1, '250 g', 'K-1', 100000, 300);
    INSERT INTO orders (id, store_id, order_number, customer_name, customer_phone, address, province, city, district,
      total_amount, payment_method, payment_status, shipping_status, created_at, warehouse_id)
      VALUES (1, 1, 'INV-10001', 'Budi', '081200000000', 'Jl. Mawar 1', 'Jawa Timur', 'Surabaya', 'Gubeng',
      118400, 'qris', 'pending', 'pending', '2026-10-31T00:00:00.000Z', 1);
    INSERT INTO order_items (order_id, variant_id, quantity, unit_price) VALUES (1, 1, 1, 100000);
    INSERT INTO payment_transactions (id, order_id, provider, provider_transaction_id, reference_id, public_token,
      channel_code, status, amount, admin_fee, total_amount, qr_payload, expires_at, created_at, updated_at)
      VALUES (91, 1, 'autolaris', 'TRX-1', '10001', 'tok-1', 'QRIS', 'pending', 117576, 824, 118400, 'qr-old',
      '${past}', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
  `);
  const statement = (sql: string, values: Value[] = []) => ({
    sql,
    values,
    bind: (...next: Value[]) => statement(sql, next.map((value) => value ?? null)),
    async first<T>() {
      return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(sql).all(...values) as T[], meta: {} };
    },
    async run() {
      const info = sqlite.prepare(sql).run(...values);
      return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  const database = {
    prepare: (sql: string) => statement(sql),
    // D1 runs a batch as one transaction.
    async batch(statements: Array<ReturnType<typeof statement>>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  const read = <T>(sql: string) => sqlite.prepare(sql).all().map((row) => ({ ...row })) as T[];
  return { sqlite, database, read };
}

const locals = {
  tenant: { ...envTenantConfig, siteUrl: "https://store.example.test" },
  runtimeEnv: { AUTOLARIS_ORDER_ORIGIN_ID: "3517100", AUTOLARIS_ORDER_DESTINATION_ID: "3518010" },
  cfContext: { waitUntil() {} } as App.Locals["cfContext"],
} as App.Locals;

/** AutoLaris stand-in: Create Order issues TRX-2; Advice answers per id. */
function provider(paid: Set<string>) {
  const original = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const raw = typeof init?.body === "string" ? init.body : "";
    if (url.includes("advice")) {
      const id = String((raw.startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))).transaction_id);
      asked.push(id);
      return Response.json(paid.has(id) ? { rc: "00", ket: "PAID", data: { awb: "" } } : { rc: "02", ket: "PENDING", data: { awb: "" } });
    }
    return Response.json({
      rc: "00",
      data: { trx_id: "TRX-2", virtual_account: "", qr: "qr-new", payment_code: "", url: "", amount: 117_576, admin: 824, total: 118_400 },
    });
  };
  return { asked, restore: () => { globalThis.fetch = original; } };
}

test("H-1: regenerating keeps the old instruction, and the hourly Advice run settles it when it was the one paid", async (context) => {
  const { database, read } = store();
  const fake = provider(new Set(["TRX-1"]));
  context.after(fake.restore);

  const renewed = await createAutoLarisPaymentForOrder(database, locals, { orderId: 1, channelCode: "QRIS" });
  assert.equal(renewed.status, "pending", String(read<{ failed_reason: string }>("SELECT failed_reason FROM payment_transactions")[0].failed_reason));
  assert.deepEqual(
    read<{ provider_transaction_id: string; superseded_at: string | null }>("SELECT provider_transaction_id, superseded_at FROM payment_transaction_attempts").map((row) => row.provider_transaction_id),
    ["TRX-1"],
    "the replaced instruction is kept, not erased",
  );
  assert.equal(read<{ provider_transaction_id: string }>("SELECT provider_transaction_id FROM payment_transactions")[0].provider_transaction_id, "TRX-2");

  const result = await reconcileAutoLarisPaymentStatuses(database, locals);
  assert.deepEqual(fake.asked.sort(), ["TRX-1", "TRX-2"], "Advice asks about the new and the replaced instruction");
  assert.deepEqual(result.paidOrderIds, [1]);
  assert.deepEqual(read("SELECT payment_status FROM orders"), [{ payment_status: "paid" }]);
  const row = read<Record<string, Value>>("SELECT status, provider_transaction_id, reference_id, qr_payload FROM payment_transactions")[0];
  assert.deepEqual({ ...row }, { status: "paid", provider_transaction_id: "TRX-1", reference_id: "10001", qr_payload: null }, "the row records what the buyer paid");
  const attempts = read<{ provider_transaction_id: string; settled_at: string | null }>("SELECT provider_transaction_id, settled_at FROM payment_transaction_attempts ORDER BY id");
  assert.equal(attempts.find((attempt) => attempt.provider_transaction_id === "TRX-1")?.settled_at !== null, true);
  assert.ok(attempts.some((attempt) => attempt.provider_transaction_id === "TRX-2"), "the unpaid new instruction stays on record");

  // Exactly once: a second run moves nothing.
  assert.deepEqual((await reconcileAutoLarisPaymentStatuses(database, locals)).paidOrderIds, []);
});

test("H-1: an operator can confirm a payment by the replaced instruction's reference", async (context) => {
  const { database, read } = store();
  const fake = provider(new Set());
  context.after(fake.restore);
  await createAutoLarisPaymentForOrder(database, locals, { orderId: 1, channelCode: "QRIS" });

  await assert.rejects(
    confirmManualAutoLarisPayment(database, { username: "owner.one", role: "owner" }, { transactionId: 91, providerReference: "TRX-9", verifiedAmount: 118_400, note: "Cek mutasi bank" }),
    /tidak cocok/,
    "an unknown reference is still refused",
  );
  const confirmed = await confirmManualAutoLarisPayment(
    database,
    { username: "owner.one", role: "owner" },
    { transactionId: 91, providerReference: "TRX-1", verifiedAmount: 118_400, note: "Dibayar ke QR lama" },
  );
  assert.equal(confirmed.transitioned, true);
  assert.equal(confirmed.transaction.provider_transaction_id, "TRX-1");
  assert.deepEqual(read("SELECT payment_status FROM orders"), [{ payment_status: "paid" }]);
  assert.deepEqual(read("SELECT provider_transaction_id FROM payment_reconciliation_audits"), [{ provider_transaction_id: "TRX-1" }]);
  assert.deepEqual(
    read("SELECT previous_transaction_status FROM payment_reconciliation_audits"),
    [{ previous_transaction_status: "pending" }],
    "the audit keeps the row's status from before it was adopted",
  );
});

test("H-1: a replaced instruction is not marked settled when the order changed before its money was recorded", async (context) => {
  const { database, sqlite, read } = store();
  const fake = provider(new Set(["TRX-1"]));
  context.after(fake.restore);
  await createAutoLarisPaymentForOrder(database, locals, { orderId: 1, channelCode: "QRIS" });

  // The order is voided between the Advice read and the settle batch.
  const racing = Object.create(database) as D1Database;
  racing.batch = async (statements) => {
    sqlite.exec("UPDATE orders SET stock_restored_at = '2026-10-31T01:00:00.000Z'");
    return database.batch(statements);
  };
  assert.deepEqual((await reconcileAutoLarisPaymentStatuses(racing, locals)).paidOrderIds, []);
  assert.deepEqual(read("SELECT payment_status FROM orders"), [{ payment_status: "pending" }]);
  assert.deepEqual(
    read("SELECT settled_at FROM payment_transaction_attempts WHERE provider_transaction_id = 'TRX-1'"),
    [{ settled_at: null }],
    "no money was recorded, so the attempt is not settled",
  );
});

test("H-1: of two simultaneous regenerations, the second does not overwrite the first", async (context) => {
  const { database, sqlite } = store();
  const fake = provider(new Set());
  context.after(fake.restore);
  // The other request wins the race: between this request's read (still
  // expired) and its write, the row became a live instruction TRX-OTHER.
  const racing = Object.create(database) as D1Database;
  racing.batch = async (statements) => {
    sqlite.exec(`UPDATE payment_transactions SET provider_transaction_id = 'TRX-OTHER', status = 'pending',
      expires_at = '2999-01-01T00:00:00.000Z'`);
    return database.batch(statements);
  };
  await assert.rejects(
    createAutoLarisPaymentForOrder(racing, locals, { orderId: 1, channelCode: "QRIS" }),
    /sedang dibuat/,
  );
  assert.deepEqual(
    sqlite.prepare("SELECT provider_transaction_id, status FROM payment_transactions").all().map((row) => ({ ...row })),
    [{ provider_transaction_id: "TRX-OTHER", status: "pending" }],
    "the live instruction is left alone",
  );
});
