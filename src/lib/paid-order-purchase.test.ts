import assert from "node:assert/strict";
import test from "node:test";
import { enqueuePurchaseForPaidOrder, manualTransferBecamePaid } from "./paid-order-purchase.ts";

type Row = Record<string, unknown>;

function createDatabase(options: {
  paymentStatus: string;
  shippingStatus?: string;
  stockRestoredAt?: string | null;
  pixel: boolean;
  alreadyQueued?: boolean;
  /** What the checkout stored on the order, if anything. */
  metaRequestContext?: string;
}) {
  const outbox: Row[] = [];
  const database = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async first() {
          if (sql.includes("SELECT meta_pixel_id")) {
            return options.pixel
              ? { meta_pixel_id: "123", meta_capi_token: "tok", google_tag_manager_id: null, google_ads_conversion_id: null, google_ads_conversion_label: null }
              : { meta_pixel_id: null, meta_capi_token: null };
          }
          if (sql.includes("FROM orders o")) {
            return {
              order_number: "INV-10041",
              customer_name: "Siti Rahayu",
              customer_phone: "081234567890",
              customer_email: null,
              province: "Jawa Barat",
              city: "Bogor",
              postal_code: "16111",
              payment_status: options.paymentStatus,
              // Only what the query names: dropping a column from the SELECT
              // must reach the guard as a missing value, the way D1 would.
              ...(sql.includes("o.shipping_status") ? { shipping_status: options.shippingStatus ?? "pending" } : {}),
              ...(sql.includes("o.stock_restored_at") ? { stock_restored_at: options.stockRestoredAt ?? null } : {}),
              ad_click_ids: null,
              meta_request_context: options.metaRequestContext ?? null,
              product_value: 150_000,
            };
          }
          if (sql.includes("capi_event_outbox")) return null;
          throw new Error(`unexpected first(): ${sql}`);
        },
        async all() {
          if (sql.includes("FROM order_items oi")) {
            return { results: [{ product_id: 100001, title: "Pupuk Organik" }] };
          }
          if (sql.includes("FROM capi_event_outbox")) return { results: [] };
          throw new Error(`unexpected all(): ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO capi_event_outbox")) {
            if (options.alreadyQueued) return { meta: { changes: 0 } };
            outbox.push({ event_id: values[0], event_name: values[1], payload: JSON.parse(String(values[2])) });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { database, outbox };
}

const locals = (database: D1Database) =>
  ({ runtimeEnv: { OMS_DB: database }, tenant: { siteUrl: "https://store.example.test" } }) as unknown as App.Locals;

test("a paid order enqueues one Purchase keyed on its order number", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => Response.json({ events_received: 1 });
  const { database, outbox } = createDatabase({ paymentStatus: "paid", pixel: true });

  const result = await enqueuePurchaseForPaidOrder(database, locals(database), 41);
  assert.equal(result.status, "queued");
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].event_id, "INV-10041");
  assert.equal(outbox[0].event_name, "Purchase");
  const payload = outbox[0].payload as { eventSourceUrl: string; customData: Row; userData: Row };
  assert.equal(payload.eventSourceUrl, "https://store.example.test/thanks");
  // Goods only, the same figure the browser leg sends.
  assert.equal(payload.customData.value, 150_000);
  assert.deepEqual(payload.customData.contentIds, ["100001"]);
  assert.equal(payload.userData.externalId, "6281234567890");
  // This order carries no stored context, so there is nothing to send and
  // nothing is invented to fill the gap.
  assert.equal("fbp" in payload.userData, false);
});

test("an unpaid order, an unconfigured pixel, and an already-sent Purchase are all no-ops", async () => {
  const unpaid = createDatabase({ paymentStatus: "pending", pixel: true });
  assert.deepEqual(await enqueuePurchaseForPaidOrder(unpaid.database, locals(unpaid.database), 41), {
    status: "skipped",
    reason: "order-not-paid",
  });
  const noPixel = createDatabase({ paymentStatus: "paid", pixel: false });
  assert.equal((await enqueuePurchaseForPaidOrder(noPixel.database, locals(noPixel.database), 41)).status, "skipped");
  const sent = createDatabase({ paymentStatus: "paid", pixel: true, alreadyQueued: true });
  assert.deepEqual(await enqueuePurchaseForPaidOrder(sent.database, locals(sent.database), 41), {
    status: "deduplicated",
  });
  assert.equal(sent.outbox.length, 0);
});

/**
 * "Transfer Diterima" on an order already cancelled or returned records the
 * money, but a void order is a refund to make, not a conversion to report.
 * The guard sits in the shared enqueue, so the cron and reconciliation paths
 * hold it too.
 */
test("a paid but void order never enqueues a Purchase", async () => {
  for (const void_ of [
    { shippingStatus: "cancelled" },
    { shippingStatus: "returned" },
    { shippingStatus: "pending", stockRestoredAt: "2026-10-28 10:00:00" },
  ]) {
    const { database, outbox } = createDatabase({ paymentStatus: "paid", pixel: true, ...void_ });
    assert.deepEqual(await enqueuePurchaseForPaidOrder(database, locals(database), 41), {
      status: "skipped",
      reason: "order-void",
    });
    assert.equal(outbox.length, 0);
  }
});

/**
 * A COD Purchase is confirmed hours or days later, from a cron or an admin
 * click, with no request of the buyer's own. Everything Meta matches on beyond
 * the phone number has to come off the order or the event goes out weak — so
 * this fails if the wiring between checkout capture and the server-side event
 * is ever broken.
 */
test("a stored checkout context reaches the server-side Purchase", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => Response.json({ events_received: 1 });

  const { database, outbox } = createDatabase({
    paymentStatus: "paid",
    pixel: true,
    metaRequestContext: JSON.stringify({
      fbp: "fb.1.1700000000000.1234567890",
      fbc: "fb.1.1700000000000.AbCdEf",
      externalId: "0123456789abcdef0123456789abcdef",
      clientIp: "203.0.113.9",
      userAgent: "Mozilla/5.0 (Linux; Android 13)",
    }),
  });

  const result = await enqueuePurchaseForPaidOrder(database, locals(database), 41);
  assert.equal(result.status, "queued");
  const payload = outbox[0].payload as { userData: Row };

  assert.equal(payload.userData.fbp, "fb.1.1700000000000.1234567890");
  assert.equal(payload.userData.fbc, "fb.1.1700000000000.AbCdEf");
  assert.equal(payload.userData.clientIp, "203.0.113.9");
  assert.equal(payload.userData.userAgent, "Mozilla/5.0 (Linux; Android 13)");
  // The stored external id is the browser's own; the phone is only the fallback.
  assert.equal(payload.userData.externalId, "0123456789abcdef0123456789abcdef");
  // Meta reads a missing country as a missing key rather than a default.
  assert.equal(payload.userData.country, "id");
});

test("only a manual transfer turning paid is an operator-confirmed Purchase", () => {
  assert.equal(manualTransferBecamePaid("manual_transfer", "pending", "paid"), true);
  assert.equal(manualTransferBecamePaid("manual_transfer", "unpaid", "settled"), true);
  // Already paid: re-saving the order must not report it again.
  assert.equal(manualTransferBecamePaid("manual_transfer", "paid", "paid"), false);
  assert.equal(manualTransferBecamePaid("manual_transfer", "pending", "failed"), false);
  // COD's Purchase is the persisted order, sent from /thanks.
  assert.equal(manualTransferBecamePaid("cod", "unpaid", "paid"), false);
  // QRIS and VA are confirmed by AutoLaris reconciliation, which sends its own.
  assert.equal(manualTransferBecamePaid("bank_transfer", "pending", "paid"), false);
});
