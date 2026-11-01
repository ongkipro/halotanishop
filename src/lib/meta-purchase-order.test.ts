import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { checkRateLimit } from "./rate-limit.ts";
import {
  findPurchaseOrderByStatusToken,
  findPurchaseOrderForApiKeyCaller,
  isMetaPurchaseOrderEligible,
  parseMetaPurchaseContentIds,
  resolveMetaPurchaseContentIds,
} from "./meta-purchase-order.ts";
import { sendMetaCapiEvent } from "./meta-capi.ts";

class Statement {
  sqlite: DatabaseSync;
  sql: string;
  values: unknown[];

  constructor(sqlite: DatabaseSync, sql: string, values: unknown[] = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new Statement(this.sqlite, this.sql, values);
  }

  async first<T>() {
    return (this.sqlite.prepare(this.sql).get(...(this.values as never[])) as T) ?? null;
  }
}

function purchaseDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, order_number TEXT NOT NULL,
      customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, customer_email TEXT,
      province TEXT NOT NULL, city TEXT NOT NULL, postal_code TEXT,
      total_amount INTEGER NOT NULL, payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL, public_status_token TEXT,
      ad_click_ids TEXT, meta_request_context TEXT,
      shipping_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL,
      unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL,
      variant_id INTEGER
    );
    CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL);
    INSERT INTO products VALUES (100001, 'Pupuk Organik');
    INSERT INTO product_variants VALUES (1, 100001);
    INSERT INTO orders VALUES (
      41, 'INV-10041', 'Nur Aisyah', '081234567890', NULL,
      'Jawa Barat', 'Bandung', '40111', 214000, 'cod', 'unpaid', 'tok-41',
      NULL, NULL, 'pending'
    );
    -- 135000 of goods; the 214000 invoice also carries shipping and the COD fee.
    INSERT INTO order_items VALUES (1, 41, 45000, 3, 1);
  `);
  return { sqlite, database: { prepare: (sql: string) => new Statement(sqlite, sql) } as unknown as D1Database };
}

test("the public lookup needs the order's own status token, the API-key lookup does not", async () => {
  const { database } = purchaseDatabase();

  // First-party surface: anyone can reach it, so guessing the order number is
  // not enough.
  assert.equal(await findPurchaseOrderByStatusToken(database, "INV-10041", "wrong"), null);
  assert.equal(
    (await findPurchaseOrderByStatusToken(database, "INV-10041", "tok-41"))?.order_number,
    "INV-10041",
  );
  // The numeric row id is an accepted locator on both, because `/thanks` holds
  // `order_pk` while a headless caller holds the order number.
  assert.equal(
    (await findPurchaseOrderByStatusToken(database, "41", "tok-41"))?.order_number,
    "INV-10041",
  );

  // API-key surface: already authenticated, so no token — but the order must
  // still exist. An unknown locator resolves to nothing rather than to a
  // Purchase the caller invented.
  assert.equal(await findPurchaseOrderForApiKeyCaller(database, "INV-99999"), null);
  const resolved = await findPurchaseOrderForApiKeyCaller(database, "INV-10041");
  assert.equal(resolved?.order_number, "INV-10041");

  // The goods, not the invoice: 45000 x 3, never the 214000 total.
  assert.equal(resolved?.product_value, 135000);
  assert.equal(resolved?.total_amount, 214000);
});

/**
 * The trap that made a headless storefront's Purchase signal vanish.
 *
 * `resolveMetaEventId` substitutes `customData.orderNumber` for a Purchase, so
 * an enqueued Purchase that carries no order number is not merely mis-keyed —
 * it is undeliverable, and `sendMetaCapiEvent` refuses it before opening a
 * connection. `/api/v1/tracking/events` never set that field, so every headless
 * Purchase was enqueued, refused five times against the retry ladder, and
 * marked `failed`, while the route had already answered `200 { queued: true }`.
 *
 * The assertion that matters is `fetched === false`: not one of those events
 * ever reached Meta, so no amount of retrying could have recovered them.
 */
test("a Purchase with no order number never reaches Meta at all", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const refused = await sendMetaCapiEvent(
      "Purchase",
      "INV-10041",
      "https://shop.example/thanks",
      { phone: "081234567890" },
      { contentIds: ["10001"], value: 135000, currency: "IDR" },
      "1234567890",
      "capi-token",
    );
    assert.equal(refused.success, false);
    assert.match(String(refused.reason), /order_number/);
    assert.equal(fetched, false);

    // The same event, carrying the order number the route now reads from D1.
    const accepted = await sendMetaCapiEvent(
      "Purchase",
      "INV-10041",
      "https://shop.example/thanks",
      { phone: "081234567890" },
      { contentIds: ["10001"], value: 135000, currency: "IDR", orderNumber: "INV-10041" },
      "1234567890",
      "capi-token",
    );
    assert.equal(accepted.success, true);
    assert.equal(fetched, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * `/api/meta-event` was the only public POST in the repository with no rate
 * limit, and the one with the most to spend on an unauthenticated caller.
 *
 * `event_id` deduplication stops a replay, never a flood: fresh ids are never
 * deduplicated, and each accepted event writes a row to an outbox nothing
 * prunes and then calls graph.facebook.com, with the opportunistic drain free
 * to make ten more. Purchase was already safe — it must resolve to an order
 * and its status token — but `PageView` and `ViewContent` were not, so
 * fabricated funnel events could be pushed into a merchant's pixel to degrade
 * the very optimisation data they pay Meta to learn from.
 *
 * This asserts the shape of the counter rather than driving the route, which
 * would need the tenant, ads config and outbox tables stood up for what is one
 * decision: sixty a minute, keyed per IP, and failing open when the counter
 * itself cannot be read.
 */
test("the public Meta event endpoint counts sixty a minute per IP and fails open", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../db/migrations/0049_admin_sessions_and_rate_limits.sql", import.meta.url),
      "utf8",
    ).replaceAll("--> statement-breakpoint", ""),
  );
  const database = {
    prepare: (sql: string) => new Statement(sqlite, sql),
  } as unknown as D1Database;

  const call = () => checkRateLimit(database, "public-meta-event:203.0.113.7", 60, 60_000);
  let last = await call();
  assert.equal(last.allowed, true);
  for (let i = 1; i < 60; i += 1) last = await call();
  assert.equal(last.allowed, true, "sixty events in a minute is an ordinary session");
  assert.equal(last.remaining, 0);

  const overflow = await call();
  assert.equal(overflow.allowed, false, "the sixty-first is a machine, not a shopper");

  // A different visitor behind a different address is unaffected.
  assert.equal(
    (await checkRateLimit(database, "public-meta-event:198.51.100.2", 60, 60_000)).allowed,
    true,
  );

  // Spam damping, never a quota: a counter that cannot be read must not stop a
  // storefront reporting its conversions.
  assert.equal(
    (await checkRateLimit(undefined, "public-meta-event:203.0.113.7", 60, 60_000)).allowed,
    true,
  );

  // The route wires exactly this key and ceiling.
  const route = readFileSync(new URL("../pages/api/meta-event.ts", import.meta.url), "utf8");
  assert.match(route, /checkRateLimit\(database, `public-meta-event:\$\{clientIp\}`, 60, 60_000\)/);
});

test("a Purchase is only ever a submitted order, never a lead", () => {
  const cod = { payment_method: "cod", payment_status: "unpaid", shipping_status: "pending" };
  assert.equal(isMetaPurchaseOrderEligible(cod), true, "COD is purchased at submit");
  // Audit 2026-10-31 tracking L-2: every word the code reads as paid.
  for (const paid of ["paid", "settled", "success"]) {
    assert.equal(isMetaPurchaseOrderEligible({ payment_method: "qris", payment_status: paid, shipping_status: "pending" }), true, paid);
  }
  // The failure this exists for: an abandoned lead carries COD-like defaults
  // and its own status token, and used to be enough to send Meta a Purchase.
  assert.equal(isMetaPurchaseOrderEligible({ ...cod, shipping_status: "abandoned" }), false);
  assert.equal(isMetaPurchaseOrderEligible({ payment_method: "qris", payment_status: "pending", shipping_status: "pending" }), false, "prepaid waits for payment");
  assert.equal(isMetaPurchaseOrderEligible({ payment_method: "qris", payment_status: "paid", shipping_status: "pending" }), true);
  for (const shipping_status of ["failed", "cancelled", "returned"]) assert.equal(isMetaPurchaseOrderEligible({ ...cod, shipping_status }), false, shipping_status);
  for (const payment_status of ["failed", "refunded", "cancelled"]) assert.equal(isMetaPurchaseOrderEligible({ payment_method: "qris", payment_status, shipping_status: "pending" }), false, payment_status);
});

test("a Purchase carries the order's catalog identity, whatever the caller sent", async () => {
  const { database } = purchaseDatabase();
  const order = await findPurchaseOrderForApiKeyCaller(database, "INV-10041");
  assert.ok(order);
  assert.equal(order.product_ids, "100001");
  // The caller's list is discarded for a Purchase: attribution must agree
  // with the invoice, and only the order knows the invoice.
  assert.deepEqual(resolveMetaPurchaseContentIds(order, ["999999", "100001"]), ["100001"]);
  // No order — a ViewContent or AddToCart — keeps what was submitted.
  assert.deepEqual(resolveMetaPurchaseContentIds(null, ["100002"]), ["100002"]);
  // Ids that cannot be a catalog id are dropped, not forwarded.
  assert.deepEqual(parseMetaPurchaseContentIds("100001, 42, abc, 100001, 07777"), ["100001"]);
  assert.equal(resolveMetaPurchaseContentIds({ product_ids: "42" }, ["100003"]), undefined);
});
