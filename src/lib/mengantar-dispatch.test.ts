import assert from "node:assert/strict";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import test from "node:test";
import { dispatchOrderToMengantar, linkAcceptedMengantarShipment, releaseUnknownMengantarDispatch } from "./mengantar-dispatch.ts";

type QueryValue = null | number | string | Uint8Array;

class SqliteD1Statement {
  readonly #database: DatabaseSync;
  readonly #sql: string;
  readonly #values: QueryValue[];

  constructor(
    database: DatabaseSync,
    sql: string,
    values: QueryValue[] = [],
  ) {
    this.#database = database;
    this.#sql = sql;
    this.#values = values;
  }

  bind(...values: QueryValue[]) {
    return new SqliteD1Statement(this.#database, this.#sql, values);
  }

  async first<T>() {
    return (this.prepare().get(...this.#values) as T | undefined) ?? null;
  }

  async run() {
    const result = this.prepare().run(...this.#values);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  private prepare(): StatementSync {
    return this.#database.prepare(this.#sql);
  }
}

class DispatchDatabase {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE stores (
        id INTEGER PRIMARY KEY,
        mengantar_api_key TEXT,
        mengantar_base_url TEXT,
        autolaris_api_key TEXT,
        autolaris_base_url TEXT
      );
      CREATE TABLE warehouses (
        id INTEGER PRIMARY KEY,
        pickup_address_id TEXT
      );
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL
      );
      CREATE TABLE product_variants (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        weight_grams INTEGER NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        order_number TEXT NOT NULL,
        warehouse_id INTEGER,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        address TEXT NOT NULL,
        destination_area_id TEXT,
        courier_code TEXT,
        payment_method TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        shipping_status TEXT NOT NULL,
        total_amount INTEGER NOT NULL,
        provider_order_id TEXT,
        provider_batch_id TEXT,
        cnote_no TEXT,
        provider_dispatch_error TEXT,
        provider_dispatch_claimed_at TEXT,
        provider_dispatched_at TEXT,
        confirmed_at TEXT,
        stock_restored_at TEXT
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY,
        order_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price INTEGER NOT NULL
      );
      CREATE TABLE courier_rules (
        id INTEGER PRIMARY KEY,
        courier_code TEXT NOT NULL,
        is_enabled INTEGER NOT NULL,
        is_cod_enabled INTEGER NOT NULL
      );
      INSERT INTO courier_rules (courier_code, is_enabled, is_cod_enabled)
      VALUES ('JNE', 1, 1), ('Pos', 1, 1);
      CREATE TABLE provider_dispatch_locks (
        provider TEXT PRIMARY KEY,
        lease_token TEXT,
        lease_expires_at TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT INTO stores VALUES (
        1, 'test-mengantar-key', 'https://provider.test', NULL, NULL
      );
      INSERT INTO warehouses VALUES (1, 'pickup-1');
      INSERT INTO products VALUES (1, 'Produk Uji');
      INSERT INTO product_variants VALUES (1, 1, 'Default', 500);
      INSERT INTO orders VALUES (
        1, 'INV-TEST-1', 1, 'Siti Rahayu', '6281234567890',
        'Jl. Melati 10, Surabaya', 'destination-1', 'JNE',
        'cod', 'unpaid', 'pending', 168000,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
      INSERT INTO order_items VALUES (1, 1, 1, 1, 150000);
      -- 0070_order_item_weight: the row above predates it, so it stays NULL.
      ALTER TABLE order_items ADD weight_grams INTEGER;
      ALTER TABLE orders ADD pickup_schedule_id INTEGER;
      CREATE TABLE pickup_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        shipment_count INTEGER NOT NULL DEFAULT 0,
        provider_reference TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.sqlite.exec("ALTER TABLE orders ADD COLUMN mengantar_handover TEXT");
  }

  prepare(sql: string) {
    return new SqliteD1Statement(this.sqlite, sql);
  }

  async batch(statements: SqliteD1Statement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const acceptedResponse = () =>
  new Response(
    JSON.stringify({
      success: true,
      batch_id: "batch-1",
      data: [
        {
          _id: "provider-order-1",
          ORDER_ID: "MG-1",
          cnote_no: "RESI-1",
          isPaid: true,
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const asD1 = (database: DispatchDatabase) =>
  database as unknown as D1Database;

const locals = { runtimeEnv: {} } as unknown as App.Locals;

test("explicit dispatch advances an unchanged eligible order", async (context) => {
  const database = new DispatchDatabase();
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => acceptedResponse();

  const outcome = await dispatchOrderToMengantar(asD1(database), locals, 1);
  const stored = database.sqlite
    .prepare(
      `SELECT shipping_status, provider_order_id, cnote_no,
        provider_dispatch_error, provider_dispatch_claimed_at
      FROM orders WHERE id = 1`,
    )
    .get() as Record<string, unknown>;

  assert.equal(outcome.status, "dispatched");
  assert.equal(stored.shipping_status, "processing");
  assert.equal(stored.provider_order_id, "provider-order-1");
  assert.equal(stored.cnote_no, "RESI-1");
  assert.equal(stored.provider_dispatch_error, null);
  assert.equal(stored.provider_dispatch_claimed_at, null);
});

test("provider acceptance cannot resurrect an order cancelled during dispatch", async (context) => {
  const database = new DispatchDatabase();
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    database.sqlite
      .prepare("UPDATE orders SET shipping_status = 'cancelled' WHERE id = 1")
      .run();
    return acceptedResponse();
  };

  const outcome = await dispatchOrderToMengantar(asD1(database), locals, 1);
  const stored = database.sqlite
    .prepare(
      `SELECT shipping_status, provider_order_id, cnote_no,
        provider_dispatch_error, provider_dispatch_claimed_at
      FROM orders WHERE id = 1`,
    )
    .get() as Record<string, unknown>;

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.providerOrderId, "provider-order-1");
  assert.equal(stored.shipping_status, "cancelled");
  assert.equal(stored.provider_order_id, "provider-order-1");
  assert.equal(stored.cnote_no, "RESI-1");
  assert.match(String(stored.provider_dispatch_error), /order berubah/i);
  assert.equal(stored.provider_dispatch_claimed_at, null);
});

test("provider acceptance cannot overwrite buyer data changed during dispatch", async (context) => {
  const database = new DispatchDatabase();
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    database.sqlite
      .prepare("UPDATE orders SET address = 'Jl. Mawar 20, Surabaya' WHERE id = 1")
      .run();
    return acceptedResponse();
  };

  const outcome = await dispatchOrderToMengantar(asD1(database), locals, 1);
  const stored = database.sqlite
    .prepare(
      `SELECT address, shipping_status, provider_order_id,
        provider_dispatch_error, provider_dispatch_claimed_at
      FROM orders WHERE id = 1`,
    )
    .get() as Record<string, unknown>;

  assert.equal(outcome.status, "failed");
  assert.equal(stored.address, "Jl. Mawar 20, Surabaya");
  assert.equal(stored.shipping_status, "pending");
  assert.equal(stored.provider_order_id, "provider-order-1");
  assert.match(String(stored.provider_dispatch_error), /order berubah/i);
  assert.equal(stored.provider_dispatch_claimed_at, null);
});

test("a Pos COD refusal records why and stops offering Pos COD", async (context) => {
  const database = new DispatchDatabase();
  database.sqlite.exec("UPDATE orders SET courier_code = 'pos' WHERE id = 1");
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: false,
        message: "Pos Indonesia COD is not available for this account",
        status: "blocked",
        deliveredRate: 70,
        minimumDeliveredRate: 82,
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );

  const outcome = await dispatchOrderToMengantar(asD1(database), locals, 1);
  const stored = database.sqlite
    .prepare(
      `SELECT shipping_status, provider_order_id, provider_dispatch_error,
        provider_dispatch_claimed_at
      FROM orders WHERE id = 1`,
    )
    .get() as Record<string, unknown>;
  const rules = database.sqlite
    .prepare("SELECT courier_code, is_enabled, is_cod_enabled FROM courier_rules ORDER BY id")
    .all()
    .map((row) => ({ ...row }));

  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /COD Pos Indonesia diblokir/);
  assert.match(outcome.error ?? "", /delivered rate 70% < 82%/);
  assert.equal(stored.shipping_status, "pending");
  assert.equal(stored.provider_order_id, null);
  assert.equal(stored.provider_dispatch_error, outcome.error);
  assert.equal(stored.provider_dispatch_claimed_at, null);
  // Pos stays enabled for prepaid; only its COD is withdrawn. Other couriers
  // are untouched.
  assert.deepEqual(rules, [
    { courier_code: "JNE", is_enabled: 1, is_cod_enabled: 1 },
    { courier_code: "Pos", is_enabled: 1, is_cod_enabled: 0 },
  ]);
});

test("any other provider refusal leaves the courier policy alone", async (context) => {
  const database = new DispatchDatabase();
  database.sqlite.exec("UPDATE orders SET courier_code = 'pos' WHERE id = 1");
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  // A 403 without one of the three documented statuses is not a Pos COD block.
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: false, message: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });

  const outcome = await dispatchOrderToMengantar(asD1(database), locals, 1);
  const posCod = database.sqlite
    .prepare("SELECT is_cod_enabled FROM courier_rules WHERE courier_code = 'Pos'")
    .get() as { is_cod_enabled: number };

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error, "Forbidden");
  assert.equal(posCod.is_cod_enabled, 1);
});

// PRD A46: a scheduled pickup carries `scheduledPickup`, the vehicle and the
// provider slot's `time_id`, found or created once per pickup address.
test("a scheduled pickup books one provider slot per address and links each order to it", async (context) => {
  const database = new DispatchDatabase();
  database.sqlite.exec(`
    INSERT INTO orders (id, order_number, warehouse_id, customer_name, customer_phone, address, destination_area_id,
      courier_code, payment_method, payment_status, shipping_status, total_amount)
    VALUES (2, 'INV-TEST-2', 1, 'Budi', '6281234567891', 'Jl. Mawar 7, Surabaya', 'destination-1', 'JNE', 'cod', 'unpaid', 'pending', 168000);
    INSERT INTO order_items VALUES (2, 2, 1, 1, 150000, NULL);
  `);
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls: Array<{ method: string; path: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method, path: url.pathname.replace(/^.*\/api\/public\/[^/]+/, ""), body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.pathname.endsWith("/time") && method === "GET") return json({ success: true, data: [{ _id: "other", date: "11-02-2026", time: "9:00" }] });
    // POST /time answers one slot object, not an array (Mengantar docs).
    if (url.pathname.endsWith("/time")) return json({ success: true, data: { _id: "time-13", date: "11-02-2026", time: "13:00" } });
    return acceptedResponse();
  };
  const pickup = {
    choice: { type: "scheduledPickup" as const, date: "2026-11-02", hour: 13, volume: "volumeMotor" as const },
    timeIds: new Map<string, string>(),
  };

  assert.equal((await dispatchOrderToMengantar(asD1(database), locals, 1, pickup)).status, "dispatched");
  // The second order reuses the slot; the fake answers the same provider id.
  assert.equal((await dispatchOrderToMengantar(asD1(database), locals, 2, pickup)).status, "dispatched");

  const timeCalls = calls.filter((call) => call.path === "/time");
  assert.deepEqual(timeCalls.map((call) => call.method), ["GET", "POST"], "one lookup and one booking for the batch");
  const booked = new URLSearchParams(timeCalls[1].body);
  assert.equal(booked.get("address_id"), "pickup-1");
  assert.equal(booked.get("date"), "11-02-2026");
  assert.equal(booked.get("time"), "13:00");

  const orderBodies = calls.filter((call) => call.path === "/order").map((call) => JSON.parse(call.body));
  assert.equal(orderBodies.length, 2);
  for (const body of orderBodies) {
    assert.deepEqual(body.pickup, { type: "scheduledPickup", volume: "volumeMotor", address_id: "pickup-1", time_id: "time-13" });
  }
  const schedules = database.sqlite.prepare("SELECT warehouse_id, provider_reference, shipment_count, scheduled_at, notes FROM pickup_schedules").all();
  assert.deepEqual(schedules.map((row) => ({ ...row })), [
    { warehouse_id: 1, provider_reference: "time-13", shipment_count: 2, scheduled_at: "2026-11-02T06:00:00.000Z", notes: "Motor" },
  ]);
  const linked = database.sqlite.prepare("SELECT id, pickup_schedule_id, mengantar_handover FROM orders ORDER BY id").all() as Array<{ pickup_schedule_id: number; mengantar_handover: string }>;
  assert.ok(linked.every((row) => row.pickup_schedule_id !== null));
  assert.ok(linked.every((row) => row.mengantar_handover === "pickup"));
});

test("an existing provider slot is reused, and drop-off stays the default", async (context) => {
  const database = new DispatchDatabase();
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls: Array<{ method: string; path: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method || "GET", path: url.pathname, body: typeof init?.body === "string" ? init.body : "" });
    if (url.pathname.endsWith("/time")) {
      return new Response(JSON.stringify({ success: true, data: [{ _id: "time-existing", date: "11-02-2026", time: "10:00" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return acceptedResponse();
  };
  await dispatchOrderToMengantar(asD1(database), locals, 1, {
    choice: { type: "scheduledPickup", date: "2026-11-02", hour: 10, volume: "volumeMobil" },
    timeIds: new Map(),
  });
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/time")).map((call) => call.method), ["GET"], "no new booking");
  assert.equal(JSON.parse(calls.find((call) => call.path.endsWith("/order"))!.body).pickup.time_id, "time-existing");

  const plain = new DispatchDatabase();
  calls.length = 0;
  await dispatchOrderToMengantar(asD1(plain), locals, 1);
  assert.deepEqual(JSON.parse(calls.find((call) => call.path.endsWith("/order"))!.body).pickup, { type: "dropOff", address_id: "pickup-1" });
  assert.equal(calls.some((call) => call.path.endsWith("/time")), false);
  // Audit 2026-10-31 M5: stored, so the shipping page does not queue it for pickup.
  assert.equal((plain.sqlite.prepare("SELECT mengantar_handover FROM orders WHERE id = 1").get() as { mengantar_handover: string }).mengantar_handover, "drop_off");
});

// Audit 2026-10-31 M-1: an unknown outcome must not read as a plain failure,
// or the next click pushes a second parcel.
test("a timeout or unreadable answer to POST /order blocks the order until an operator releases it", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const stored = (database: DispatchDatabase) =>
    database.sqlite.prepare("SELECT provider_dispatch_error, provider_dispatch_claimed_at, shipping_status FROM orders WHERE id = 1").get() as Record<string, string | null>;

  for (const answer of [
    async () => { throw new TypeError("fetch failed"); },
    async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; },
    async () => new Response("<html>gateway</html>", { status: 200 }),
    async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
    async () => new Response(JSON.stringify({ message: "upstream" }), { status: 502 }),
  ]) {
    const database = new DispatchDatabase();
    let orderCalls = 0;
    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/order")) orderCalls += 1;
      return answer();
    };
    const first = await dispatchOrderToMengantar(asD1(database), locals, 1);
    assert.equal(first.status, "outcome_unknown");
    assert.match(String(stored(database).provider_dispatch_error), /^DISPATCH_UNKNOWN: /);
    assert.equal(stored(database).shipping_status, "pending");
    // The next push, single or bulk, does not reach Mengantar.
    assert.equal((await dispatchOrderToMengantar(asD1(database), locals, 1)).status, "outcome_unknown");
    assert.equal(orderCalls, 1, "no second POST /order");

    // Released after the operator checked Mengantar: the push goes through.
    assert.equal(await releaseUnknownMengantarDispatch(asD1(database), 1), true);
    globalThis.fetch = async () => acceptedResponse();
    assert.equal((await dispatchOrderToMengantar(asD1(database), locals, 1)).status, "dispatched");
    assert.equal(await releaseUnknownMengantarDispatch(asD1(database), 1), false, "nothing left to release");
  }
});

test("a clear refusal stays a plain failure that may be pushed again", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const database = new DispatchDatabase();
  let orderCalls = 0;
  globalThis.fetch = async () => {
    orderCalls += 1;
    return new Response(JSON.stringify({ success: false, message: "Alamat tidak valid" }), { status: 400 });
  };
  const first = await dispatchOrderToMengantar(asD1(database), locals, 1);
  assert.equal(first.status, "failed");
  assert.equal(first.error, "Alamat tidak valid");
  assert.equal((await dispatchOrderToMengantar(asD1(database), locals, 1)).status, "failed");
  assert.equal(orderCalls, 2, "a refused order is offered again");
});

test("a pickup slot that cannot be booked fails before any shipment exists, so it is not unknown", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const database = new DispatchDatabase();
  globalThis.fetch = async (input) => {
    if (String(input).includes("/time")) throw new TypeError("fetch failed");
    return acceptedResponse();
  };
  const outcome = await dispatchOrderToMengantar(asD1(database), locals, 1, {
    choice: { type: "scheduledPickup", date: "2026-11-02", hour: 13, volume: "volumeMotor" },
    timeIds: new Map(),
  });
  assert.equal(outcome.status, "failed");
  const row = database.sqlite.prepare("SELECT provider_dispatch_error FROM orders WHERE id = 1").get() as { provider_dispatch_error: string };
  assert.doesNotMatch(row.provider_dispatch_error, /^DISPATCH_UNKNOWN/);
});

test("a local failure after Mengantar accepted the shipment blocks the order instead of offering a second push", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const database = new DispatchDatabase();
  const prepare = database.prepare.bind(database);
  let failPersistence = true;
  database.prepare = (sql: string) => {
    if (failPersistence && sql.includes("provider_order_id = ?, provider_batch_id = ?")) {
      const statement = prepare(sql);
      statement.run = async () => {
        throw new Error("D1_ERROR: transient");
      };
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: QueryValue[]) => {
        const bound = bind(...values);
        bound.run = statement.run;
        return bound;
      };
      return statement;
    }
    return prepare(sql);
  };
  let orderCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/order")) orderCalls += 1;
    return acceptedResponse();
  };

  const first = await dispatchOrderToMengantar(asD1(database), locals, 1);
  assert.equal(first.status, "outcome_unknown");
  const row = database.sqlite.prepare("SELECT provider_dispatch_error FROM orders WHERE id = 1").get() as { provider_dispatch_error: string };
  assert.match(row.provider_dispatch_error, /^DISPATCH_UNKNOWN: Mengantar menerima provider-order-1: /);

  failPersistence = false;
  assert.equal((await dispatchOrderToMengantar(asD1(database), locals, 1)).status, "outcome_unknown");
  assert.equal(orderCalls, 1, "no second POST /order");

  // It is never released for a second push; it is linked to its shipment.
  assert.equal(await releaseUnknownMengantarDispatch(asD1(database), 1), false);
  assert.equal(await linkAcceptedMengantarShipment(asD1(database), 1), "provider-order-1");
  const linked = database.sqlite.prepare("SELECT provider_order_id, provider_dispatch_error, shipping_status FROM orders WHERE id = 1").get();
  assert.deepEqual({ ...(linked as object) }, { provider_order_id: "provider-order-1", provider_dispatch_error: null, shipping_status: "processing" });
  assert.equal((await dispatchOrderToMengantar(asD1(database), locals, 1)).status, "already_dispatched");
  assert.equal(orderCalls, 1, "still one POST /order");
  assert.equal(await linkAcceptedMengantarShipment(asD1(database), 1), null, "nothing left to link");
});
