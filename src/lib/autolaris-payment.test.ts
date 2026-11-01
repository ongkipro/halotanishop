import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  AUTOLARIS_CHANNEL_OPTIONS,
  parseAutoLarisPaymentResponse,
} from "./autolaris-client.ts";
import { envTenantConfig } from "./tenant.ts";
import {
  buyerEmail,
  createAutoLarisPaymentForOrder,
  effectivePaymentStatus,
  isSyntheticBuyerEmail,
  matchableCustomerEmail,
  reconcileAutoLarisPaymentStatuses,
  PENDING_AUTOLARIS_INQUIRY_SQL,
  AUTOLARIS_EXPIRED_RECHECK_HOURS,
} from "./autolaris-payment.ts";

function createAutoLarisOrderDatabase(autoLarisApiKey: string | null) {
  const state = {
    transaction: null as null | Record<string, unknown>,
  };
  const order = {
    id: 41,
    order_number: "INV-10041",
    store_id: 1,
    customer_name: "Buyer",
    customer_phone: "081331000000",
    customer_email: "buyer@example.test",
    address: "Buyer Street",
    province: "Jawa Timur",
    city: "Nganjuk",
    district: "Sawahan",
    postal_code: "64475",
    total_amount: 118_400,
    payment_method: "qris",
    payment_fee_bearer: "seller",
    store_name: "QA Store",
    warehouse_name: "QA Warehouse",
    warehouse_contact_name: "Warehouse PIC",
    warehouse_contact_phone: "08123456789",
    warehouse_address: "Warehouse Street",
    warehouse_city: "Surabaya",
    warehouse_province: "Jawa Timur",
  };
  const item = {
    quantity: 2,
    unit_price: 50_000,
    weight_grams: 600,
    product_title: "QA Product",
    variant_title: "500 ml",
  };

  const database = {
    prepare(sql: string) {
      const statement = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async first() {
          if (sql.includes("FROM payment_transactions pt")) {
            return state.transaction;
          }
          if (sql.includes("SELECT o.id, o.order_number")) return order;
          if (sql.includes("SELECT mengantar_api_key")) {
            return {
              mengantar_api_key: null,
              mengantar_base_url: null,
              autolaris_api_key: autoLarisApiKey,
              autolaris_base_url: "https://autolaris.example.test",
            };
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async all() {
          if (sql.includes("FROM order_items oi")) {
            return { success: true, results: [item], meta: {} };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT INTO payment_transactions")) {
            state.transaction = {
              id: 91,
              order_id: order.id,
              order_number: order.order_number,
              public_token: statement.args[2],
              channel_code: statement.args[3],
              fee_bearer: statement.args[4],
              status: "pending",
              amount: statement.args[5],
              admin_fee: statement.args[6],
              total_amount: statement.args[7],
              virtual_account: null,
              qr_payload: null,
              payment_code: null,
              provider_payment_url: null,
              expires_at: statement.args[8],
              failed_reason: null,
            };
          } else if (sql.includes("INSERT INTO payment_transaction_attempts")) {
            // The superseded instruction is kept (H-1); its own test runs on SQLite.
            return { success: true, meta: { changes: state.transaction?.provider_transaction_id ? 1 : 0 }, results: [] };
          } else if (sql.includes("provider_transaction_id = NULL")) {
            // A failed or expired row is reused for the retry.
            Object.assign(state.transaction!, {
              reference_id: statement.args[0],
              channel_code: statement.args[1],
              fee_bearer: statement.args[2],
              status: "pending",
              amount: statement.args[3],
              admin_fee: statement.args[4],
              total_amount: statement.args[5],
              virtual_account: null,
              qr_payload: null,
              payment_code: null,
              provider_payment_url: null,
              failed_reason: null,
              expires_at: statement.args[6],
            });
          } else if (sql.includes("provider_transaction_id = ?")) {
            Object.assign(state.transaction!, {
              amount: statement.args[1],
              admin_fee: statement.args[2],
              total_amount: statement.args[3],
              virtual_account: statement.args[4],
              qr_payload: statement.args[5],
              payment_code: statement.args[6],
              provider_payment_url: statement.args[7],
              expires_at: statement.args[8],
              failed_reason: null,
            });
          } else if (sql.includes("SET status = 'failed'")) {
            Object.assign(state.transaction!, {
              status: "failed",
              failed_reason: statement.args[0],
            });
          } else {
            throw new Error(`Unexpected run query: ${sql}`);
          }
          return { success: true, meta: { changes: 1 }, results: [] };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;

  return { database, state };
}

const QA_LOCALS = {
  tenant: { ...envTenantConfig, siteUrl: "https://store.example.test" },
  runtimeEnv: {
    AUTOLARIS_ORDER_ORIGIN_ID: "3517100",
    AUTOLARIS_ORDER_DESTINATION_ID: "3518010",
  },
  cfContext: { waitUntil() {} } as App.Locals["cfContext"],
} as App.Locals;

test("payment orchestration sends one complete Create Order payload to AutoLaris", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database } = createAutoLarisOrderDatabase("qa-key");
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      rc: "00",
      data: {
        transaction_id: "TRX-PAY-41",
        biaya_admin: 824,
        total: 118_400,
        payment_info: {
          expired: "2026-09-03 16:42:00",
          va: "",
          qr: "QR-PAYLOAD",
          url: "",
        },
      },
    });
  };

  const payment = await createAutoLarisPaymentForOrder(database, QA_LOCALS, {
    orderId: 41,
    channelCode: "QRIS",
  });

  assert.equal(
    requestedUrl,
    "https://autolaris.example.test/api/h2h/submit",
  );
  assert.deepEqual(
    {
      reff_id: requestedBody?.reff_id,
      channel_code: requestedBody?.channel_code,
      courir_id: requestedBody?.courir_id,
      origin: requestedBody?.origin,
      destination: requestedBody?.destination,
      weight: requestedBody?.weight,
      length: requestedBody?.length,
      width: requestedBody?.width,
      height: requestedBody?.height,
      shipper_name: requestedBody?.shipper_name,
      shipper_email: requestedBody?.shipper_email,
      receiver_name: requestedBody?.receiver_name,
      receiver_address: requestedBody?.receiver_address,
      callback_url: requestedBody?.callback_url,
      grand_total: requestedBody?.grand_total,
      cod_value: requestedBody?.cod_value,
      remark: requestedBody?.remark,
      order_details: requestedBody?.order_details,
    },
    {
      reff_id: "10041",
      channel_code: "QRIS",
      courir_id: 1,
      origin: 3517100,
      destination: 3518010,
      weight: "1200",
      length: "1",
      width: "1",
      height: "1",
      shipper_name: "Warehouse PIC",
      shipper_email: "buyer@example.test",
      receiver_name: "Buyer",
      receiver_address: "Buyer Street, Sawahan, Nganjuk, Jawa Timur, 64475",
      callback_url: "",
      grand_total: "118400",
      cod_value: "0",
      remark: "INV-10041",
      order_details: [
        { name: "QA Product - 500 ml", qty: "2", unit_price: "50000" },
      ],
    },
  );
  assert.equal(payment.qrPayload, "QR-PAYLOAD");
  assert.equal(payment.adminFee, 824);
  assert.equal(payment.totalAmount, 118_400);
  assert.equal(payment.expiresAt, "2026-09-03T09:42:00.000Z");
});

test("payment orchestration records failure without a provider call when AutoLaris is unconfigured", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database } = createAutoLarisOrderDatabase(null);
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(null, { status: 500 });
  };

  const payment = await createAutoLarisPaymentForOrder(database, QA_LOCALS, {
    orderId: 41,
    channelCode: "QRIS",
  });

  assert.equal(providerCalls, 0);
  assert.equal(payment.status, "failed");
  assert.match(payment.failedReason || "", /belum dikonfigurasi/i);
});

test("Create Order fails before fetch when AutoLaris mirror area ids are missing", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database } = createAutoLarisOrderDatabase("qa-key");
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(null, { status: 500 });
  };
  const locals = {
    ...QA_LOCALS,
    runtimeEnv: {},
  } as App.Locals;

  const payment = await createAutoLarisPaymentForOrder(database, locals, {
    orderId: 41,
    channelCode: "QRIS",
  });
  assert.equal(providerCalls, 0);
  assert.equal(payment.status, "failed");
  assert.match(payment.failedReason || "", /origin AutoLaris tidak lengkap/i);
});

test("AutoLaris response parsing preserves provider instructions and billed total", () => {
  const payment = parseAutoLarisPaymentResponse({
    rc: "00",
    data: {
      trx_id: "TRX-123",
      virtual_account: "1234567890",
      qr: "000201010212...",
      payment_code: "PAY-123",
      url: "https://pay.example.test/TRX-123",
      amount: 180000,
      admin: 2500,
      total: 182500,
    },
  });
  assert.deepEqual(payment, {
    transactionId: "TRX-123",
    virtualAccount: "1234567890",
    qr: "000201010212...",
    paymentCode: "PAY-123",
    url: "https://pay.example.test/TRX-123",
    amount: 180000,
    admin: 2500,
    total: 182500,
  });
});

test("AutoLaris Create Order response preserves VA instructions and Jakarta expiry", () => {
  const payment = parseAutoLarisPaymentResponse(
    {
      rc: "00",
      data: {
        transaction_id: "986771",
        biaya_admin: 6500,
        total: 106500,
        payment_info: {
          expired: "2026-09-04 08:15:30",
          va: "1234567890123456",
          qr: "",
          url: "https://pay.example.test/986771",
        },
      },
    },
    100000,
  );
  assert.deepEqual(payment, {
    transactionId: "986771",
    virtualAccount: "1234567890123456",
    qr: undefined,
    paymentCode: undefined,
    url: "https://pay.example.test/986771",
    amount: 100000,
    admin: 6500,
    total: 106500,
    expiresAt: "2026-09-04T01:15:30.000Z",
  });
});

test("AutoLaris channels map QRIS separately from bank transfer channels", () => {
  const qris = AUTOLARIS_CHANNEL_OPTIONS.find((option) => option.code === "QRIS");
  assert.equal(qris?.paymentMethod, "qris");
  assert.equal(
    AUTOLARIS_CHANNEL_OPTIONS
      .filter((option) => option.code !== "QRIS")
      .every((option) => option.paymentMethod === "bank_transfer"),
    true,
  );
  assert.equal(
    AUTOLARIS_CHANNEL_OPTIONS.map((option) => String(option.code)).includes("DANA"),
    false,
  );
});

test("a failed instruction is regenerated on the next request, a live one is left alone", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database, state } = createAutoLarisOrderDatabase("qa-key");
  let providerCalls = 0;
  let providerAnswers = false;
  globalThis.fetch = async () => {
    providerCalls += 1;
    if (!providerAnswers) return new Response("upstream down", { status: 502 });
    return Response.json({
      rc: "00",
      data: {
        trx_id: "TRX-PAY-41-B",
        virtual_account: "",
        qr: "QR-PAYLOAD-B",
        payment_code: "",
        url: "",
        amount: 117_576,
        admin: 824,
        total: 118_400,
      },
    });
  };

  const first = await createAutoLarisPaymentForOrder(database, QA_LOCALS, { orderId: 41, channelCode: "QRIS" });
  assert.equal(first.status, "failed");
  assert.equal(providerCalls, 1);

  // The provider recovers; the buyer asks again and gets a real instruction on
  // the same transaction row.
  providerAnswers = true;
  const second = await createAutoLarisPaymentForOrder(database, QA_LOCALS, { orderId: 41, channelCode: "QRIS" });
  assert.equal(providerCalls, 2);
  // The retry carries a fresh, digits-only provider reference derived from the order sequence.
  assert.match(String(state.transaction?.reference_id), /^10041\d{6}$/);
  assert.equal(second.status, "pending");
  assert.equal(second.qrPayload, "QR-PAYLOAD-B");
  assert.equal(second.failedReason, undefined);
  assert.equal(state.transaction?.id, 91);

  // A live instruction is never regenerated.
  const third = await createAutoLarisPaymentForOrder(database, QA_LOCALS, { orderId: 41, channelCode: "QRIS" });
  assert.equal(providerCalls, 2);
  assert.equal(third.qrPayload, "QR-PAYLOAD-B");
});

test("a pending instruction past its expiry reads as expired and is regenerated", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database, state } = createAutoLarisOrderDatabase("qa-key");
  let providerCalls = 0;
  globalThis.fetch = async () =>
    Response.json({
      rc: "00",
      data: {
        trx_id: `TRX-${(providerCalls += 1)}`,
        virtual_account: "8877001",
        qr: "",
        payment_code: "",
        url: "",
        amount: 117_576,
        admin: 824,
        total: 118_400,
      },
    });

  const live = await createAutoLarisPaymentForOrder(database, QA_LOCALS, { orderId: 41, channelCode: "VABCA" });
  assert.equal(live.status, "pending");
  assert.ok(new Date(live.expiresAt || "").getTime() > Date.now());

  state.transaction!.expires_at = new Date(Date.now() - 60_000).toISOString();
  const expired = await createAutoLarisPaymentForOrder(database, QA_LOCALS, { orderId: 41, channelCode: "VABCA" });
  assert.equal(providerCalls, 2, "an expired row is treated like a failed one");
  assert.equal(expired.status, "pending");
  assert.ok(new Date(expired.expiresAt || "").getTime() > Date.now());
});

test("payment status expiry is derived at read time, never stored", () => {
  const past = new Date(Date.now() - 1).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(effectivePaymentStatus("pending", past), "expired");
  assert.equal(effectivePaymentStatus("pending", future), "pending");
  assert.equal(effectivePaymentStatus("pending", null), "pending");
  assert.equal(effectivePaymentStatus("pending", "not a date"), "pending");
  // A final state is final regardless of the clock.
  assert.equal(effectivePaymentStatus("paid", past), "paid");
  assert.equal(effectivePaymentStatus("failed", past), "failed");
});

/**
 * The provider needs an email; a COD checkout collects none. So two places mint
 * `<phone digits>@<store host>` — `buyerEmail` and `submit-order.ts` — and both
 * write it into `orders.customer_email`, where all three CAPI legs read it
 * straight into Meta's `em`.
 *
 * Meta scores Event Match Quality on the keys it is given. A fabricated `em`
 * does not merely fail to match; it spends a match key on a value no Meta user
 * carries, which reads as real signal that never resolves.
 */
test("a minted provider email is recognised, a real one is never thrown away", () => {
  const site = "https://permatamall.shop";

  // Both shapes the system actually mints.
  assert.equal(isSyntheticBuyerEmail("6281234567890@permatamall.shop", site), true);
  assert.equal(isSyntheticBuyerEmail("081234567890@permatamall.shop", site), true);
  assert.equal(matchableCustomerEmail("6281234567890@permatamall.shop", site), undefined);

  // A numeric local part is ordinary in Indonesia — plenty of real Gmail
  // addresses are the owner's phone number. Dropping one would throw away a
  // genuine match key, so the store's own host has to be part of the test.
  assert.equal(isSyntheticBuyerEmail("081234567890@gmail.com", site), false);
  assert.equal(
    matchableCustomerEmail("081234567890@gmail.com", site),
    "081234567890@gmail.com",
  );
  assert.equal(isSyntheticBuyerEmail("siti@permatamall.shop", site), false);

  // Absent, blank and unparseable inputs answer without throwing inside a
  // conversion path.
  assert.equal(isSyntheticBuyerEmail(null, site), false);
  assert.equal(isSyntheticBuyerEmail("   ", site), false);
  assert.equal(isSyntheticBuyerEmail("6281234567890@permatamall.shop", "not a url"), false);
  assert.equal(matchableCustomerEmail(undefined, site), undefined);
  assert.equal(matchableCustomerEmail("  siti@example.com  ", site), "siti@example.com");

  // The guard has to recognise exactly what buyerEmail produces, or the two
  // drift and the fabricated address reaches Meta again.
  const minted = buyerEmail(null, "0812-3456-7890", site);
  assert.equal(minted, "081234567890@permatamall.shop");
  assert.equal(isSyntheticBuyerEmail(minted, site), true);
  // A stored, real address passes straight through both directions.
  assert.equal(buyerEmail("siti@example.com", "081234567890", site), "siti@example.com");
});

/**
 * Found by watching a live `/thanks` enqueue its own CAPI payload, not by
 * reading the code — the first version of this guard checked one host and the
 * fabricated address sailed past it.
 *
 * The cause was two minting shapes for one concept: `buyerEmail` used the
 * configured `siteUrl`, while `submit-order.ts` hand-rolled the same string
 * against `new URL(request.url).hostname`. A store reachable on a workers.dev
 * address, a preview deployment, or any second domain therefore wrote
 * addresses the guard did not recognise. Minting is unified now; the guard
 * still takes every host the store answers on, for the rows already written.
 */
test("a store answering on more than one host is still recognised", () => {
  const configured = "https://permatamall.shop";
  const requestHost = "https://adsbookcms-permata.workers.dev/api/meta-event";

  const legacy = "6281234567890@adsbookcms-permata.workers.dev";
  assert.equal(isSyntheticBuyerEmail(legacy, configured), false, "one host cannot see it");
  assert.equal(isSyntheticBuyerEmail(legacy, configured, requestHost), true);
  assert.equal(matchableCustomerEmail(legacy, configured, requestHost), undefined);

  // Widening the check must not start swallowing real addresses.
  assert.equal(
    matchableCustomerEmail("081234567890@gmail.com", configured, requestHost),
    "081234567890@gmail.com",
  );
  // An unset or unparseable host contributes nothing rather than throwing.
  assert.equal(isSyntheticBuyerEmail(legacy, undefined, null, "not a url", requestHost), true);
  assert.equal(isSyntheticBuyerEmail(legacy, undefined, null, "not a url"), false);
});

function createAdviceReconciliationDatabase() {
  const state = {
    transactionStatus: "pending",
    orderPaymentStatus: "pending",
    notifications: 0,
  };
  const database = {
    prepare(sql: string) {
      const statement = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async first() {
          if (sql.includes("SELECT mengantar_api_key")) {
            return {
              mengantar_api_key: null,
              mengantar_base_url: null,
              autolaris_api_key: "qa-key",
              autolaris_base_url: "https://autolaris.example.test",
            };
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async all() {
          if (sql.includes("FROM payment_transaction_attempts")) return { success: true, results: [], meta: {} };
          if (sql.includes("pt.provider_transaction_id")) {
            return {
              success: true,
              results:
                state.transactionStatus === "pending" &&
                state.orderPaymentStatus === "pending"
                  ? [
                      {
                        transaction_id: 91,
                        order_id: 41,
                        order_number: "INV-10041",
                        customer_name: "Buyer",
                        provider_transaction_id: "986770",
                        total_amount: 118_400,
                      },
                    ]
                  : [],
              meta: {},
            };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO notifications")) {
            state.notifications += 1;
            return { success: true, meta: { changes: 1 }, results: [] };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
      return statement;
    },
    async batch(statements: Array<{ sql: string }>) {
      return statements.map((statement) => {
        if (statement.sql.includes("UPDATE payment_transactions")) {
          const changes = state.transactionStatus === "pending" ? 1 : 0;
          if (changes) state.transactionStatus = "paid";
          return { success: true, meta: { changes }, results: [] };
        }
        if (statement.sql.includes("UPDATE orders")) {
          const changes =
            state.transactionStatus === "paid" &&
            state.orderPaymentStatus === "pending"
              ? 1
              : 0;
          if (changes) state.orderPaymentStatus = "paid";
          return { success: true, meta: { changes }, results: [] };
        }
        throw new Error(`Unexpected batch query: ${statement.sql}`);
      });
    },
  } as unknown as D1Database;
  return { database, state };
}

test("scheduled Advice reconciliation moves a paid order exactly once", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database, state } = createAdviceReconciliationDatabase();
  let providerCalls = 0;
  let requestedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    providerCalls += 1;
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ rc: "00", ket: "PAID", data: { awb: "" } });
  };

  const first = await reconcileAutoLarisPaymentStatuses(
    database,
    QA_LOCALS,
    new Date("2026-09-02T17:00:00.000Z"),
  );
  assert.deepEqual(requestedBody, { transaction_id: "986770" });
  assert.deepEqual(first, {
    checked: 1,
    pending: 0,
    unproven: 0,
    failed: 0,
    paidOrderIds: [41],
    // Empty on a recognised settlement: the capture exists for the words the
    // allowlist does not know yet.
    unrecognisedPaidStatuses: [],
  });
  assert.equal(state.transactionStatus, "paid");
  assert.equal(state.orderPaymentStatus, "paid");
  assert.equal(state.notifications, 1);

  const duplicate = await reconcileAutoLarisPaymentStatuses(
    database,
    QA_LOCALS,
    new Date("2026-09-02T18:00:00.000Z"),
  );
  assert.equal(providerCalls, 1);
  assert.deepEqual(duplicate.paidOrderIds, []);
  assert.equal(state.notifications, 1);
});

test("scheduled Advice reconciliation leaves pending money untouched", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database, state } = createAdviceReconciliationDatabase();
  globalThis.fetch = async () =>
    Response.json({ rc: "02", ket: "PENDING", data: { awb: "" } });

  const result = await reconcileAutoLarisPaymentStatuses(database, QA_LOCALS);
  assert.equal(result.pending, 1);
  assert.deepEqual(result.paidOrderIds, []);
  assert.equal(state.transactionStatus, "pending");
  assert.equal(state.orderPaymentStatus, "pending");
  assert.equal(state.notifications, 0);
});

// No settled Advice response has ever been observed against a real payment, so
// the paid allowlist — PAID, SETTLED, LUNAS — is a conservative reading. If
// the provider answers with its success code and a word outside that guess, the
// order must not settle (a guess may not move money) but the observation must
// not be discarded either: it is exactly the capture that closes SCR1, and it
// used to be counted as `unproven` beside genuine failures and thrown away.

test("the provider's success code with an unknown word is captured, not settled", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database, state } = createAdviceReconciliationDatabase();
  globalThis.fetch = async () =>
    Response.json({ rc: "00", ket: "TERBAYAR", data: { awb: "" } });

  const result = await reconcileAutoLarisPaymentStatuses(
    database,
    QA_LOCALS,
    new Date("2026-09-09T17:00:00.000Z"),
  );

  // Nothing moved: an unrecognised word cannot settle a payment.
  assert.equal(state.transactionStatus, "pending");
  assert.equal(state.orderPaymentStatus, "pending");
  assert.equal(result.unproven, 1);
  assert.deepEqual(result.paidOrderIds, []);
  // But the exact word is carried out, so the allowlist can be revised from
  // observation rather than from another guess.
  assert.deepEqual(result.unrecognisedPaidStatuses, ["TERBAYAR"]);
});

test("a genuine failure is not mistaken for settlement evidence", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database } = createAdviceReconciliationDatabase();
  globalThis.fetch = async () =>
    Response.json({ rc: "99", ket: "FAILED", data: { awb: "" } });

  const result = await reconcileAutoLarisPaymentStatuses(
    database,
    QA_LOCALS,
    new Date("2026-09-09T17:00:00.000Z"),
  );
  assert.equal(result.unproven, 1);
  assert.deepEqual(
    result.unrecognisedPaidStatuses,
    [],
    "only the success code makes a word worth capturing",
  );
});

test("a pending read stays a silent no-op", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const { database, state } = createAdviceReconciliationDatabase();
  globalThis.fetch = async () =>
    Response.json({ rc: "02", ket: "PENDING", data: { awb: "" } });

  const result = await reconcileAutoLarisPaymentStatuses(
    database,
    QA_LOCALS,
    new Date("2026-09-09T17:00:00.000Z"),
  );
  assert.equal(result.pending, 1);
  assert.equal(result.unproven, 0);
  assert.deepEqual(result.unrecognisedPaidStatuses, []);
  assert.equal(state.orderPaymentStatus, "pending");
});

test("a local store on a dotless host still mints an address the provider accepts, and still recognises it", () => {
  const local = "http://localhost:8787";
  const minted = buyerEmail(null, "0812-3456-7890", local);
  assert.equal(minted, "081234567890@localhost.invalid");
  assert.match(minted, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "AutoLaris' own email rule");
  assert.equal(isSyntheticBuyerEmail(minted, local), true, "never handed to Meta as a match key");
  assert.equal(buyerEmail(null, "081234567890", "https://toko.example"), "081234567890@toko.example");
});

test("the hourly Advice run reaches new instructions, not the same old expired ones", () => {
  // The shape a live store reached: dozens of long-dead QRIS instructions nobody
  // paid, then today's. The old query took the 25 oldest every hour and never
  // got past them.
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE orders (id INTEGER PRIMARY KEY, order_number TEXT, customer_name TEXT,
      payment_status TEXT, shipping_status TEXT, stock_restored_at TEXT);
    CREATE TABLE payment_transactions (id INTEGER PRIMARY KEY, order_id INTEGER, provider TEXT,
      provider_transaction_id TEXT, total_amount INTEGER, status TEXT, expires_at TEXT, created_at TEXT);
  `);
  const now = new Date("2026-09-29T10:07:00.000Z");
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const addOrder = db.prepare("INSERT INTO orders VALUES (?, ?, 'x', 'pending', 'pending', NULL)");
  const addTx = db.prepare("INSERT INTO payment_transactions VALUES (?, ?, 'autolaris', ?, 1000, ?, ?, ?)");
  let id = 0;
  const add = (status: string, expiresHoursAgo: number, createdHoursAgo: number) => {
    id += 1;
    addOrder.run(id, `INV-${id}`);
    addTx.run(id, id, `P${id}`, status, at(expiresHoursAgo), at(createdHoursAgo));
    return id;
  };
  for (let i = 0; i < 30; i += 1) add("expired", 24 * 10 + i, 24 * 10 + i + 1);
  const justExpired = add("expired", 2, 3);
  const stillPending = add("pending", -1, 0.5);

  const cutoff = new Date(now.getTime() - AUTOLARIS_EXPIRED_RECHECK_HOURS * 3_600_000).toISOString();
  const rows = db.prepare(PENDING_AUTOLARIS_INQUIRY_SQL).all(cutoff, 25) as Array<{ transaction_id: number }>;
  assert.deepEqual(rows.map((row) => row.transaction_id), [stillPending, justExpired]);
});
