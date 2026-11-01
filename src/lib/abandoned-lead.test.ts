import assert from "node:assert/strict";
import test from "node:test";
import {
  AbandonedLeadError,
  convertAbandonedLead,
  updateAbandonedLead,
} from "./abandoned-lead.ts";
import { GET as getAbandoned, POST as convertRoute } from "../pages/api/admin/abandoned-orders.ts";
import { GET as getOrders } from "../pages/api/admin/orders/index.ts";

type Statement = { sql: string; args: unknown[] };

const conversionInput = {
  customerName: "Paduka Ongki",
  customerPhone: "081234567890",
  address: "Jalan Merdeka Nomor 10",
  district: "Coblong",
  city: "Bandung",
  province: "Jawa Barat",
  postalCode: "40132",
  destinationAreaId: "area-40132",
  variantId: 202,
  quantity: 2,
  warehouseId: 4,
  courierCode: "jne",
  courierService: "REG",
  shippingCost: 18_000,
  followedUpBy: "customer-service",
};

function conversionDatabase() {
  const state: {
    order: { id: number; order_number: string; shipping_status: string; submit_token: string | null };
    item: { variantId: number; quantity: number; unitPrice: number } | null;
    stock: number;
  } = {
    order: {
      id: 7,
      order_number: "ABN-10007",
      shipping_status: "abandoned",
      submit_token: null as string | null,
    },
    item: { variantId: 101, quantity: 1, unitPrice: 25_000 },
    stock: 10,
  };
  let queue = Promise.resolve();
  const database = {
    prepare(sql: string) {
      const statement: Statement = { sql, args: [] };
      const api = {
        bind(...args: unknown[]) {
          statement.args = args;
          return api;
        },
        async first() {
          if (sql.includes("FROM orders") && sql.includes("shipping_status = 'abandoned'")) {
            return state.order.shipping_status === "abandoned"
              ? { ...state.order }
              : null;
          }
          if (sql.includes("FROM product_variants")) {
            return { id: 202, price: 50_000, stock: state.stock };
          }
          if (sql.includes("SELECT cod_fee_bearer")) {
            return { cod_fee_bearer: "buyer" };
          }
          throw new Error(`Unexpected first: ${sql}`);
        },
        statement,
      };
      return api;
    },
    batch(raw: Array<{ statement: Statement }>) {
      const run = async () => {
        const results: Array<{ results: unknown[]; meta: { changes: number } }> = [];
        for (const { statement } of raw) {
          const { sql, args } = statement;
          if (sql.includes("UPDATE orders") && sql.includes("lead_follow_up_status = 'converted'")) {
            // The abandoned state is the whole guard now: stock stopped
            // gating a conversion in ADR-023.
            const canConvert = state.order.shipping_status === "abandoned";
            if (canConvert) {
              state.order.order_number = String(args[0]);
              state.order.submit_token = String(args[1]);
              state.order.shipping_status = "pending";
            }
            results.push({ results: [], meta: { changes: canConvert ? 1 : 0 } });
          } else if (sql.includes("DELETE FROM order_items")) {
            const owns = state.order.submit_token === args[2];
            if (owns) state.item = null;
            results.push({ results: [], meta: { changes: owns ? 1 : 0 } });
          } else if (sql.includes("INSERT INTO order_items")) {
            const owns = state.order.submit_token === args[5];
            if (owns) {
              state.item = {
                variantId: Number(args[0]),
                quantity: Number(args[1]),
                unitPrice: Number(args[2]),
              };
            }
            results.push({ results: [], meta: { changes: owns ? 1 : 0 } });
          } else if (sql.includes("SELECT id, order_number")) {
            const owns = state.order.submit_token === args[1];
            results.push({
              results: owns
                ? [{ id: state.order.id, order_number: state.order.order_number }]
                : [],
              meta: { changes: 0 },
            });
          } else {
            throw new Error(`Unexpected batch: ${sql}`);
          }
        }
        return results;
      };
      const result = queue.then(run, run);
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  } as unknown as D1Database;
  return { database, state };
}

test("concurrent lead conversion writes one order and one final item", async () => {
  const { database, state } = conversionDatabase();
  const outcomes = await Promise.allSettled([
    convertAbandonedLead(database, 7, conversionInput),
    convertAbandonedLead(database, 7, conversionInput),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof AbandonedLeadError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(state.order.shipping_status, "pending");
  assert.equal(state.order.order_number, "INV-10007");
  assert.deepEqual(state.item, { variantId: 202, quantity: 2, unitPrice: 50_000 });
  // The conversion never touches the stock figure — a batch that tried would
  // have thrown "Unexpected batch" above.
  assert.equal(state.stock, 10);
});

test("follow-up persists operator evidence only while the row remains abandoned", async () => {
  const captured: Statement[] = [];
  const database = {
    prepare(sql: string) {
      const statement: Statement = { sql, args: [] };
      captured.push(statement);
      const api = {
        bind(...args: unknown[]) { statement.args = args; return api; },
        async first() {
          if (sql.includes("customer_name, customer_phone")) {
            return { customer_name: "Pembeli", customer_phone: "628123456789" };
          }
          return { id: 7, order_number: "ABN-10007", shipping_status: "abandoned" };
        },
        statement,
      };
      return api;
    },
    async batch() { return [{ meta: { changes: 1 } }]; },
  } as unknown as D1Database;

  await updateAbandonedLead(database, 7, {
    followUpStatus: "contacted",
    followUpNote: "Buyer requested a callback.",
    followedUpBy: "cs-operator",
  });
  const mutation = captured.find((statement) => statement.sql.includes("UPDATE orders"));
  assert.ok(mutation);
  assert.match(mutation.sql, /WHERE id = \? AND shipping_status = 'abandoned'/);
  assert.ok(mutation.args.includes("contacted"));
  assert.ok(mutation.args.includes("Buyer requested a callback."));
  assert.ok(mutation.args.includes("cs-operator"));
  assert.ok(mutation.args.some((value) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value),
  ));

  await assert.rejects(
    updateAbandonedLead(database, 7, {
      followUpStatus: "invalid" as never,
      followedUpBy: "cs-operator",
    }),
    (error: unknown) =>
      error instanceof AbandonedLeadError && error.status === 422,
  );
});

test("a stock figure below the quantity does not stop a conversion", async () => {
  // The inverse of the rule this test used to assert. The store sells on
  // demand (ADR-023): an operator converting a lead must never be told the
  // shelf is empty, and the figure is left exactly as it was.
  const { database, state } = conversionDatabase();
  state.stock = 1;

  const converted = await convertAbandonedLead(database, 7, conversionInput);
  assert.equal(converted.orderNumber, "INV-10007");
  assert.equal(state.order.shipping_status, "pending");
  assert.deepEqual(state.item, { variantId: 202, quantity: 2, unitPrice: 50_000 });
  assert.equal(state.stock, 1);
});

test("dedicated GET returns only abandoned rows with bounded server product options", async () => {
  const statements: Statement[] = [];
  const database = {
    prepare(sql: string) {
      const statement: Statement = { sql, args: [] };
      statements.push(statement);
      const api = {
        bind(...args: unknown[]) {
          statement.args = args;
          return api;
        },
        statement,
      };
      return api;
    },
    async batch() {
      return [
        { results: [{ total_items: 1 }] },
        { results: [{ id: 7, order_number: "ABN-10007", lead_follow_up_status: "new" }] },
        { results: [{ status: "new", count: 1 }] },
        { results: [{ product_id: 3, product_title: "Produk", variant_id: 202, variant_title: "Utama", sku: "SKU", price: 50_000, stock: 10 }] },
        { results: [{ id: 4, name: "Gudang" }] },
      ];
    },
  } as unknown as D1Database;
  const response = await getAbandoned({
    url: new URL("https://example.test/api/admin/abandoned-orders"),
    locals: { runtimeEnv: { OMS_DB: database } },
  } as never);
  const payload = await response.json() as Record<string, any>;

  assert.equal(response.status, 200);
  assert.equal(payload.data[0].order_number, "ABN-10007");
  assert.equal(payload.product_options[0].variant_id, 202);
  assert.equal(payload.warehouse.id, 4);
  assert.ok(statements.slice(0, 3).every((statement) =>
    statement.sql.includes("shipping_status = 'abandoned'"),
  ));
  assert.match(statements[3].sql, /p\.is_active = 1/);
  assert.match(statements[3].sql, /LIMIT 500/);
});

test("convert rejects a missing lead before resolving a provider quote", async () => {
  const prepared: string[] = [];
  const database = {
    prepare(sql: string) {
      prepared.push(sql);
      const api = {
        bind() { return api; },
        async first() { return null; },
      };
      return api;
    },
  } as unknown as D1Database;
  const response = await convertRoute({
    request: new Request("https://example.test/api/admin/abandoned-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "convert",
        order_id: 999,
        variant_id: 202,
        quantity: 1,
        courier_service_id: 1,
        destination_area_id: "area",
        city: "Bandung",
        courier_code: "jne",
      }),
    }),
    locals: { runtimeEnv: { OMS_DB: database }, admin: { username: "cs" } },
  } as never);

  assert.equal(response.status, 404);
  assert.equal(prepared.length, 1);
  assert.match(prepared[0], /shipping_status = 'abandoned'/);
});

test("convert rejects oversized provider inputs before any database or provider work", async () => {
  const prepared: string[] = [];
  const database = {
    prepare(sql: string) {
      prepared.push(sql);
      throw new Error("provider boundary should not be reached");
    },
  } as unknown as D1Database;
  for (const overrides of [
    { quantity: 101 },
    { destination_area_id: "x".repeat(121) },
  ]) {
    const response = await convertRoute({
      request: new Request("https://example.test/api/admin/abandoned-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "convert",
          order_id: 7,
          variant_id: 202,
          quantity: 1,
          courier_service_id: 1,
          destination_area_id: "area",
          city: "Bandung",
          courier_code: "jne",
          ...overrides,
        }),
      }),
      locals: { runtimeEnv: { OMS_DB: database }, admin: { username: "cs" } },
    } as never);
    assert.equal(response.status, 422);
  }
  assert.deepEqual(prepared, []);
});

test("normal orders GET excludes abandoned leads from rows, summary, and status counts", async () => {
  const normal = {
    id: 8,
    order_number: "INV-10008",
    customer_name: "Pembeli",
    customer_phone: "628123456789",
    payment_method: "cod",
    payment_status: "unpaid",
    shipping_status: "pending",
    receiver_risk_label: "LOW",
  };
  const abandoned = {
    ...normal,
    id: 7,
    order_number: "ABN-10007",
    shipping_status: "abandoned",
  };
  const rows = [normal, abandoned];
  const database = {
    prepare(sql: string) {
      const statement: Statement = { sql, args: [] };
      const api = {
        bind(...args: unknown[]) { statement.args = args; return api; },
        statement,
      };
      return api;
    },
    async batch(raw: Array<{ statement: Statement }>) {
      return raw.map(({ statement }, index) => {
        const filtered = statement.sql.includes("shipping_status <> 'abandoned'")
          ? rows.filter((row) => row.shipping_status !== "abandoned")
          : rows;
        if (index === 0) return { results: [{ total_items: filtered.length }] };
        if (index === 1) return { results: filtered };
        if (index === 2) {
          return { results: [{ total_orders: filtered.length, unpaid_count: filtered.length, high_risk_count: 0, total_value: 0 }] };
        }
        if (index === 3) return { results: [{ crm_templates: null }] };
        const counts = new Map<string, number>();
        for (const row of filtered) counts.set(row.shipping_status, (counts.get(row.shipping_status) || 0) + 1);
        return { results: [...counts].map(([shipping_status, count]) => ({ shipping_status, count })) };
      });
    },
  } as unknown as D1Database;

  const response = await getOrders({
    url: new URL("https://example.test/api/admin/orders"),
    locals: { runtimeEnv: { OMS_DB: database } },
  } as never);
  const payload = await response.json() as Record<string, any>;

  assert.equal(response.status, 200);
  assert.deepEqual(payload.data.map((row: any) => row.order_number), ["INV-10008"]);
  assert.equal(payload.summary.total_orders, 1);
  assert.equal(payload.status_counts.all, 1);
  assert.equal(payload.status_counts.abandoned, undefined);
});

test("the order summary follows every filter, and the chips follow all but status", async () => {
  // Captures the SQL and bindings each statement in the batch actually used.
  const captured: Statement[] = [];
  const database = {
    prepare(sql: string) {
      const statement: Statement = { sql, args: [] };
      const api = {
        bind(...args: unknown[]) { statement.args = args; return api; },
        statement,
      };
      return api;
    },
    async batch(raw: Array<{ statement: Statement }>) {
      captured.length = 0;
      captured.push(...raw.map(({ statement }) => statement));
      return raw.map((_, index) => {
        if (index === 0) return { results: [{ total_items: 0 }] };
        if (index === 1) return { results: [] };
        if (index === 2) {
          return { results: [{ total_orders: 0, unpaid_count: 0, high_risk_count: 0, total_value: 0 }] };
        }
        if (index === 3) return { results: [{ crm_templates: null }] };
        return { results: [] };
      });
    },
  } as unknown as D1Database;

  const response = await getOrders({
    url: new URL(
      "https://example.test/api/admin/orders?date_filter=custom&date_start=2026-08-18&date_end=2026-08-18&shipping_status=pending",
    ),
    locals: { runtimeEnv: { OMS_DB: database } },
  } as never);
  assert.equal(response.status, 200);

  const [, , summaryStatement, , , chipStatement] = captured;

  // The cards used to answer for the whole store regardless of the filter, so
  // a one-day range showed that day's rows beside an all-time total.
  assert.match(summaryStatement.sql, /BETWEEN \? AND \?/);
  assert.ok(summaryStatement.args.includes("2026-08-18"));
  assert.match(summaryStatement.sql, /shipping_status END\) = \?/);

  // The chips are the control for picking a status, so they must stay scoped
  // to everything except that status — otherwise choosing one zeroes the rest.
  assert.match(chipStatement.sql, /BETWEEN \? AND \?/);
  assert.ok(chipStatement.args.includes("2026-08-18"));
  assert.doesNotMatch(chipStatement.sql, /shipping_status END\) = \?/);
  assert.ok(!chipStatement.args.includes("pending"));
});
