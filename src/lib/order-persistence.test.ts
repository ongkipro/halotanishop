import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  findOrderVariant,
  OrderInputError,
  persistOrder,
  recordAbandonedOrder,
} from "./order-persistence.ts";

test("persistOrder returns the newly inserted order data", async () => {
  // Captures the order notification. Recording is fail-open, so without a
  // `run()` here the write would swallow its own failure and this call site
  // would prove nothing.
  const notificationWrites: unknown[][] = [];
  const mockDb = {
    prepare(sql: string) {
      const statementSql = sql;
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async run() {
          if (statementSql.includes("INSERT OR IGNORE INTO notifications")) {
            notificationWrites.push(bound);
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (statementSql.includes("FROM product_variants")) {
            return { id: 101, price: 50000, stock: 10 };
          }
          if (statementSql.includes("FROM stores")) {
            return { id: 1, cod_fee_bearer: "buyer" };
          }
          if (statementSql.includes("UPDATE order_number_counters")) {
            return { last_value: 10018 };
          }
          return null;
        },
      };
      return stmt;
    },
    async batch(statements: unknown[]) {
      return statements.map((_, index) => ({
        results: index === statements.length - 1 ? [{
          id: 18,
          order_number: "INV-10018",
          public_status_token: "status-18",
          total_amount: 61998,
          unit_price: 50000,
          cod_service_fee: 1800,
          cod_service_fee_vat: 198,
          cod_fee_bearer: "buyer",
          seller_bank_account_id: null,
          seller_bank_code: null,
          seller_bank_name: null,
          seller_account_holder: null,
          seller_account_number: null,
        }] : [],
        meta: { changes: index === 1 ? 1 : 0 },
      }));
    },
  } as unknown as D1Database;

  const result = await persistOrder(mockDb, {
    submitToken: "sb_test_123",
    customerName: "Paduka Ongki",
    customerPhone: "08123456789",
    address: "Jl. Merdeka No. 1",
    province: "Jawa Barat",
    city: "Bandung",
    district: "Coblong",
    variantKey: "101",
    quantity: 1,
    shippingCost: 10000,
    paymentMethod: "cod",
  });

  assert.equal(result.id, 18);
  assert.equal(result.created, true);
  assert.equal(result.orderNumber, "INV-10018");
  assert.equal(result.totalAmount, 60000 + Math.round(60000 * 0.03 * 1.11)); // COD fee applied

  assert.equal(notificationWrites.length, 1);
  const [type, orderId, orderNumber, title, body] = notificationWrites[0];
  assert.equal(type, "order");
  assert.equal(orderId, 18);
  assert.equal(orderNumber, "INV-10018");
  assert.equal(title, "Order baru INV-10018");
  assert.match(String(body), /Paduka Ongki/);
  assert.match(String(body), /Coblong, Bandung/);
});

test("persistOrder promotes the recent abandoned row and replaces its items", async () => {
  type CapturedStatement = {
    sql: string;
    args: unknown[];
  };
  let batchStatements: CapturedStatement[] = [];
  const mockDb = {
    prepare(sql: string) {
      const captured: CapturedStatement = { sql, args: [] };
      const stmt = {
        captured,
        bind(...args: unknown[]) {
          captured.args = args;
          return stmt;
        },
        async first() {
          if (sql.includes("FROM product_variants")) {
            return { id: 101, price: 50000, stock: 10 };
          }
          if (sql.includes("FROM stores")) {
            return { id: 1, cod_fee_bearer: "buyer" };
          }
          if (
            sql.includes("FROM orders") &&
            sql.includes("shipping_status = 'abandoned'")
          ) {
            return {
              id: 7,
              order_number: "ABN-10007",
              public_status_token: "status-original",
            };
          }
          if (sql.includes("checkout_fingerprint")) return null;
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ captured: CapturedStatement }>) {
      batchStatements = statements.map((statement) => statement.captured);
      return batchStatements.map((_, index) => ({
        results:
          index === batchStatements.length - 1 ? [{
            id: 7,
            order_number: "INV-10007",
            public_status_token: "status-original",
            total_amount: 113663,
            unit_price: 50000,
            cod_service_fee: 3300,
            cod_service_fee_vat: 363,
            cod_fee_bearer: "buyer",
            seller_bank_account_id: null,
            seller_bank_code: null,
            seller_bank_name: null,
            seller_account_holder: null,
            seller_account_number: null,
          }] : [],
        meta: { changes: index === 1 ? 1 : 0 },
      }));
    },
  } as unknown as D1Database;

  const result = await persistOrder(mockDb, {
    submitToken: "sb_promote_123456",
    customerName: "Paduka Ongki",
    customerPhone: "628123456789",
    customerEmail: "buyer@example.com",
    address: "Jl. Merdeka No. 1, Kota Bandung",
    province: "ID-JB",
    city: "Bandung",
    district: "Coblong",
    postalCode: "40132",
    variantKey: "101",
    quantity: 2,
    shippingCost: 10000,
    paymentMethod: "cod",
    warehouseId: 3,
    destinationAreaId: "area-40132",
    courierCode: "jne",
    courierService: "REG",
    adClickIds: '{"gclid":"click-123"}',
    metaRequestContext: '{"clientIp":"203.0.113.7"}',
  });

  assert.equal(result.id, 7);
  assert.equal(result.created, true);
  assert.equal(result.orderNumber, "INV-10007");
  assert.equal(result.publicStatusToken, "status-original");
  assert.equal(batchStatements.length, 5);
  // Five statements, and none of them a stock movement (ADR-023). The item
  // insert reads the variant's weight (A-397); nothing writes the variant,
  // under any quoting of the identifier ("", ``, []) or conflict clause.
  const writesVariants =
    /\b(?:UPDATE(?:\s+OR\s+\w+)?|(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO|DELETE\s+FROM)\s+(?:["`[]?main["`\]]?\.)?["`[]?product_variants\b/i;
  for (const write of [
    "UPDATE product_variants SET stock = stock - 1",
    "UPDATE `product_variants` SET stock = 0",
    'UPDATE "product_variants" SET stock = 0',
    "UPDATE [product_variants] SET stock = 0",
    "UPDATE OR IGNORE `product_variants` SET stock = 0",
    'INSERT INTO "product_variants" (id) VALUES (1)',
    "INSERT OR REPLACE INTO product_variants (id) VALUES (1)",
    "REPLACE INTO `product_variants` (id) VALUES (1)",
    "DELETE FROM [product_variants] WHERE id = 1",
    "delete from main.product_variants where id = 1",
  ]) {
    assert.match(write, writesVariants);
  }
  for (const read of [
    "INSERT INTO order_items (weight_grams) SELECT id, (SELECT weight_grams FROM product_variants WHERE id = ?)",
    "SELECT 1 FROM orders o INNER JOIN product_variants pv ON pv.id = ?",
  ]) {
    assert.doesNotMatch(read, writesVariants);
  }
  assert.equal(
    batchStatements.some((statement) => writesVariants.test(statement.sql)),
    false,
  );
  assert.match(batchStatements[1].sql, /^\s*UPDATE orders/);
  assert.match(batchStatements[1].sql, /shipping_status = 'pending'/);
  assert.match(batchStatements[1].sql, /warehouse_id = \?/);
  assert.ok(batchStatements[1].args.includes(3));
  assert.match(batchStatements[1].sql, /ad_click_ids = COALESCE/);
  assert.match(batchStatements[1].sql, /meta_request_context = COALESCE/);
  assert.ok(batchStatements[1].args.includes("sb_promote_123456"));
  assert.ok(batchStatements[1].args.includes('{"gclid":"click-123"}'));
  assert.ok(batchStatements[1].args.includes('{"clientIp":"203.0.113.7"}'));
  assert.ok(!batchStatements.some((statement) =>
    statement.sql.includes("INSERT INTO orders"),
  ));
  assert.match(batchStatements[2].sql, /DELETE FROM order_items/);
  assert.match(batchStatements[3].sql, /INSERT INTO order_items/);
});

test("recordAbandonedOrder normalizes an Indonesian phone and creates an unpaid abandoned row", async () => {
  type CapturedStatement = {
    sql: string;
    args: unknown[];
  };
  let batchStatements: CapturedStatement[] = [];
  const mockDb = {
    prepare(sql: string) {
      const captured: CapturedStatement = { sql, args: [] };
      const stmt = {
        captured,
        bind(...args: unknown[]) {
          captured.args = args;
          return stmt;
        },
        async first() {
          if (sql.includes("FROM product_variants")) {
            return { id: 101, price: 50000 };
          }
          if (sql.includes("UPDATE order_number_counters")) {
            return { last_value: 10101 };
          }
          if (
            sql.includes("FROM orders") &&
            sql.includes("shipping_status = 'abandoned'")
          ) {
            return null;
          }
          if (sql.includes("SELECT id FROM stores")) return { id: 9 };
          throw new Error(`Unexpected first query: ${sql}`);
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ captured: CapturedStatement }>) {
      batchStatements = statements.map((statement) => statement.captured);
      return batchStatements.map((_, index) => ({
        results:
          index === batchStatements.length - 1
            ? [{ id: 41, order_number: batchStatements[0].args[0] }]
            : [],
      }));
    },
  } as unknown as D1Database;

  const result = await recordAbandonedOrder(mockDb, {
    customerName: "Paduka Ongki",
    customerPhone: "08123456789",
    address: "Jl. Merdeka No. 1",
    province: "ID-JB",
    totalAmount: 50000,
    variantId: 101,
  });

  assert.equal(result.id, 41);
  assert.equal(result.customerPhone, "628123456789");
  assert.equal(result.action, "created");
  assert.equal(result.orderNumber, "ABN-10101");
  assert.match(batchStatements[0].sql, /'unpaid', 'abandoned'/);
  assert.ok(batchStatements[0].args.includes("628123456789"));
  assert.match(batchStatements[1].sql, /INSERT INTO order_items/);
});

test("recordAbandonedOrder upserts the matching recent lead", async () => {
  let updateSql = "";
  let updateArgs: unknown[] = [];
  let batchCalled = false;
  const mockDb = {
    prepare(sql: string) {
      if (sql.includes("UPDATE orders")) updateSql = sql;
      const stmt = {
        bind(...args: unknown[]) {
          if (sql.includes("UPDATE orders")) updateArgs = args;
          return stmt;
        },
        async first() {
          return {
            id: 22,
            order_number: "ABN-EXISTING",
          };
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch() {
      batchCalled = true;
      return [];
    },
  } as unknown as D1Database;

  const result = await recordAbandonedOrder(mockDb, {
    customerName: "Nama Terbaru",
    customerPhone: "+62 812-3456-789",
    totalAmount: 75000,
  });

  assert.equal(result.id, 22);
  assert.equal(result.orderNumber, "ABN-EXISTING");
  assert.equal(result.action, "updated");
  assert.equal(batchCalled, true);
  assert.match(updateSql, /payment_status = 'unpaid'/);
  assert.match(updateSql, /shipping_status = 'abandoned'/);
  assert.ok(updateArgs.includes(0));
  assert.ok(!updateArgs.includes(75000));
});

test("recordAbandonedOrder rejects a non-mobile Indonesian phone", async () => {
  const unusedDb = {} as D1Database;
  await assert.rejects(
    recordAbandonedOrder(unusedDb, {
      customerName: "Paduka Ongki",
      customerPhone: "0215551234",
    }),
    (error: unknown) =>
      error instanceof OrderInputError &&
      error.message === "Nomor WhatsApp tidak valid.",
  );
});

/**
 * The reason the fingerprint columns exist. A buyer who double-taps submit, or
 * whose connection retries the POST, sends two identical checkouts seconds
 * apart with two different submit tokens — and before this, that was two orders,
 * two invoices, and two Purchase events off one sale. Both live stores hit it
 * and fixed it independently; the product carried the columns without the guard
 * until now, so this is the check that fails if the guard is ever lost.
 */
test("an identical checkout inside the window reuses the order instead of creating a second", async () => {
  let inserted = false;
  const canonical = {
    id: 42,
    order_number: "INV-10042",
    public_status_token: "status-42",
    total_amount: 61998,
    unit_price: 50000,
    cod_service_fee: 1800,
    cod_service_fee_vat: 198,
    cod_fee_bearer: "buyer",
    seller_bank_account_id: null,
    seller_bank_code: null,
    seller_bank_name: null,
    seller_account_holder: null,
    seller_account_number: null,
  };
  const mockDb = {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes("FROM product_variants")) return { id: 101, price: 50000, stock: 10 };
          if (sql.includes("FROM stores")) return { id: 1, cod_fee_bearer: "buyer" };
          if (sql.includes("UPDATE order_number_counters")) return { last_value: 10041 };
          // findCanonicalOrder: a live order already carries this fingerprint.
          if (sql.includes("FROM orders o")) return canonical;
          return null;
        },
      };
      return stmt;
    },
    async batch(statements: unknown[]) {
      inserted = true;
      return statements.map(() => ({ results: [], meta: { changes: 0 } }));
    },
  } as unknown as D1Database;

  const submission = {
    customerName: "Paduka Ongki",
    customerPhone: "08123456789",
    address: "Jl. Merdeka No. 1",
    province: "Jawa Barat",
    city: "Bandung",
    district: "Coblong",
    variantKey: "101",
    quantity: 1,
    shippingCost: 10000,
    paymentMethod: "cod" as const,
  };

  const result = await persistOrder(mockDb, { ...submission, submitToken: "sb_second_tap" });

  assert.equal(result.created, false, "a duplicate must not report itself as a new order");
  assert.equal(result.id, 42, "the buyer must be sent back to the order that already exists");
  assert.equal(result.orderNumber, "INV-10042");
  assert.equal(inserted, false, "no second row may be written for the same checkout");
});

/** The variant lookup runs real SQL: the defect was in the WHERE clause itself. */
function variantDatabase(rows: Array<[id: number, productId: number, sku: string, price: number]>, inactive: number[] = []) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, sku TEXT, price INTEGER NOT NULL);
    CREATE INDEX idx_variants_sku ON product_variants (sku);
  `);
  for (const productId of new Set(rows.map((row) => row[1]))) {
    sqlite.prepare("INSERT INTO products (id, is_active) VALUES (?, ?)").run(productId, inactive.includes(productId) ? 0 : 1);
  }
  for (const row of rows) {
    sqlite.prepare("INSERT INTO product_variants (id, product_id, sku, price) VALUES (?, ?, ?, ?)").run(...row);
  }
  return {
    prepare(sql: string) {
      const statement = (values: unknown[]) => ({
        bind: (...next: unknown[]) => statement(next),
        first: async () => {
          // node:sqlite rows have a null prototype; D1's are plain objects.
          const row = sqlite.prepare(sql).get(...(values as never[]));
          return row ? { ...row } : null;
        },
      });
      return statement([]);
    },
  } as unknown as D1Database;
}

// Taniniaga, 2026-10: Saratoga is variants 1/2; Kojien was given the SKUs "1"/"2".
const SARATOGA_AND_KOJIEN: Array<[number, number, string, number]> = [
  [1, 50510, "SARATOGA-500ML", 135000],
  [2, 50510, "SARATOGA-1L", 268000],
  [7, 99118, "1", 130000],
  [8, 99118, "2", 215000],
];

test("a variant id wins over another variant whose SKU is that same number", async () => {
  const database = variantDatabase(SARATOGA_AND_KOJIEN);
  assert.deepEqual(await findOrderVariant(database, "1"), { id: 1, price: 135000 });
  assert.deepEqual(await findOrderVariant(database, "2"), { id: 2, price: 268000 });
  assert.deepEqual(await findOrderVariant(database, "7"), { id: 7, price: 130000 });
});

test("a SKU still resolves when no variant has it as an id", async () => {
  const database = variantDatabase(SARATOGA_AND_KOJIEN);
  assert.deepEqual(await findOrderVariant(database, "SARATOGA-1L"), { id: 2, price: 268000 });
  assert.equal(await findOrderVariant(database, "NOPE"), null);
});

test("an inactive product's variant id never falls through to another product's SKU", async () => {
  const database = variantDatabase(SARATOGA_AND_KOJIEN, [50510]);
  assert.equal(await findOrderVariant(database, "1"), null);
});
