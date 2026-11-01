import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import test from "node:test";
import {
  confirmManualAutoLarisPayment,
  inquireAutoLarisPaymentStatus,
  ManualPaymentReconciliationError,
} from "./manual-payment-reconciliation.ts";
import {
  GET,
  POST,
} from "../pages/api/admin/payment-reconciliation.ts";
import { POST as LEGACY_WEBHOOK } from "../pages/api/webhooks/autolaris.ts";

// By suffix, never by number (RELEASE.md): an install with its own migrations
// renumbers the product's above them, and a fixed number would miss the file.
const migrationUrl = (suffix: string) => {
  const dir = new URL("../db/migrations/", import.meta.url);
  const name = readdirSync(dir).find((file) => file.endsWith(suffix));
  if (!name) throw new Error(`no migration ends with ${suffix}`);
  return new URL(name, dir);
};


type QueryValue = null | number | string | Uint8Array;

class SqliteStatement {
  private readonly sqlite: DatabaseSync;
  readonly sql: string;
  readonly values: QueryValue[];
  private readonly shouldFail?: (sql: string) => boolean;

  constructor(
    sqlite: DatabaseSync,
    sql: string,
    values: QueryValue[] = [],
    shouldFail?: (sql: string) => boolean,
  ) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.values = values;
    this.shouldFail = shouldFail;
  }

  bind(...values: QueryValue[]) {
    return new SqliteStatement(this.sqlite, this.sql, values, this.shouldFail);
  }

  async first<T>() {
    return (this.prepare().get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.prepare().all(...this.values) as T[],
      meta: { changes: 0, last_row_id: 0 },
    };
  }

  async run() {
    return this.execute();
  }

  execute() {
    if (this.shouldFail?.(this.sql)) throw new Error("injected batch failure");
    if (/^\s*SELECT\b/i.test(this.sql)) {
      return {
        success: true,
        results: this.prepare().all(...this.values),
        meta: { changes: 0, last_row_id: 0 },
      };
    }
    const result = this.prepare().run(...this.values);
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
    return this.sqlite.prepare(this.sql);
  }
}

class ReconciliationDatabase {
  readonly sqlite = new DatabaseSync(":memory:");
  failOnSql = "";

  constructor() {
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE stores (
        id INTEGER PRIMARY KEY,
        mengantar_api_key TEXT, mengantar_base_url TEXT,
        autolaris_api_key TEXT, autolaris_base_url TEXT
      );
      CREATE TABLE admin_credentials (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY, order_number TEXT NOT NULL, store_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
        payment_method TEXT NOT NULL, payment_status TEXT NOT NULL,
        shipping_status TEXT NOT NULL, stock_restored_at TEXT
      );
      CREATE TABLE payment_transactions (
        id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, provider TEXT NOT NULL,
        provider_transaction_id TEXT, reference_id TEXT NOT NULL,
        channel_code TEXT NOT NULL, status TEXT NOT NULL,
        amount INTEGER NOT NULL, admin_fee INTEGER NOT NULL,
        total_amount INTEGER NOT NULL, expires_at TEXT, paid_at TEXT,
        failed_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO stores VALUES (1, NULL, NULL, 'qa-key', 'https://autolaris.example.test');
      INSERT INTO admin_credentials VALUES (10, 'owner.one', 'owner');
      INSERT INTO admin_credentials VALUES (11, 'admin.one', 'admin');
      INSERT INTO admin_credentials VALUES (12, 'cs.one', 'customer_service');
    `);
    this.sqlite.exec(
      readFileSync(
        new URL("../db/migrations/0043_manual_payment_reconciliation.sql", import.meta.url),
        "utf8",
      ).replaceAll("--> statement-breakpoint", ""),
    );
    // Superseded instructions (audit 2026-10-31 H-1).
    this.sqlite.exec(
      readFileSync(
        migrationUrl("_payment_transaction_attempts.sql"),
        "utf8",
      ).replaceAll("--> statement-breakpoint", ""),
    );
    // Confirming a payment records an operator notification. Without the real
    // table that write fails open, so the call site would prove nothing.
    this.sqlite.exec(
      readFileSync(
        new URL("../db/migrations/0045_operator_notifications.sql", import.meta.url),
        "utf8",
      ).replaceAll("--> statement-breakpoint", ""),
    );
  }

  prepare(sql: string) {
    return new SqliteStatement(
      this.sqlite,
      sql,
      [],
      (candidate) => Boolean(this.failOnSql && candidate.includes(this.failOnSql)),
    );
  }

  async batch(statements: SqliteStatement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function asD1(database: ReconciliationDatabase) {
  return database as unknown as D1Database;
}

function seedPayment(
  database: ReconciliationDatabase,
  options: {
    id?: number;
    method?: string;
    provider?: string;
    providerReference?: string | null;
    transactionStatus?: string;
    orderPaymentStatus?: string;
    shippingStatus?: string;
    stockRestoredAt?: string | null;
  } = {},
) {
  const id = options.id ?? 101;
  database.sqlite
    .prepare(
      `INSERT INTO orders VALUES (?, ?, 1, 'Siti', '081234567890', ?, ?, ?, ?)`
    )
    .run(
      id,
      `INV-${id}`,
      options.method ?? "qris",
      options.orderPaymentStatus ?? "pending",
      options.shippingStatus ?? "pending",
      options.stockRestoredAt ?? null,
    );
  database.sqlite
    .prepare(
      `INSERT INTO payment_transactions VALUES (
        ?, ?, ?, ?, ?, 'QRIS', ?, 100000, 700, 100700,
        '2026-08-18T00:00:00.000Z', NULL, NULL,
        '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'
      )`,
    )
    .run(
      id,
      id,
      options.provider ?? "autolaris",
      options.providerReference === undefined ? `TRX-${id}` : options.providerReference,
      `REF-${id}`,
      options.transactionStatus ?? "pending",
    );
  return id;
}

const owner = { username: "owner.one", role: "owner" as const };
const input = (id: number) => ({
  transactionId: id,
  verifiedAmount: 100700,
  providerReference: `TRX-${id}`,
  note: "Verified against the AutoLaris dashboard.",
});

function count(database: ReconciliationDatabase, table: string) {
  return Number(
    (database.sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
      total: number;
    }).total,
  );
}

test("manual confirmation atomically records immutable audit evidence and leaves shipping untouched", async () => {
  const database = new ReconciliationDatabase();
  const id = seedPayment(database);
  let externalCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("external fetch must not run");
  };
  try {
    const result = await confirmManualAutoLarisPayment(
      asD1(database),
      owner,
      input(id),
      "2026-08-18T10:00:00.000Z",
    );
    assert.equal(result.transitioned, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const payment = database.sqlite
    .prepare("SELECT status, paid_at FROM payment_transactions WHERE id = ?")
    .get(id) as { status: string; paid_at: string };
  const order = database.sqlite
    .prepare("SELECT payment_status, shipping_status FROM orders WHERE id = ?")
    .get(id) as { payment_status: string; shipping_status: string };
  const audit = database.sqlite
    .prepare("SELECT * FROM payment_reconciliation_audits WHERE payment_transaction_id = ?")
    .get(id) as Record<string, unknown>;
  assert.equal(payment.status, "paid");
  assert.equal(payment.paid_at, "2026-08-18T10:00:00.000Z");
  assert.equal(order.payment_status, "paid");
  assert.equal(order.shipping_status, "pending");
  assert.equal(audit.actor_username, "owner.one");
  assert.equal(audit.actor_role, "owner");
  assert.equal(audit.previous_transaction_status, "pending");
  assert.equal(audit.previous_order_payment_status, "pending");
  assert.equal(audit.recorded_amount, 100000);
  assert.equal(audit.recorded_admin_fee, 700);
  assert.equal(audit.recorded_total_amount, 100700);
  assert.equal(externalCalls, 0);
  assert.throws(() =>
    database.sqlite.prepare("UPDATE payment_reconciliation_audits SET note = 'changed'").run(),
  );
  assert.throws(() =>
    database.sqlite.prepare("DELETE FROM payment_reconciliation_audits").run(),
  );
});

test("duplicate confirmation is idempotent and creates one audit", async () => {
  const database = new ReconciliationDatabase();
  const id = seedPayment(database);
  const first = await confirmManualAutoLarisPayment(asD1(database), owner, input(id));
  const duplicate = await confirmManualAutoLarisPayment(asD1(database), owner, input(id));
  assert.equal(first.transitioned, true);
  assert.equal(duplicate.transitioned, false);
  assert.equal(count(database, "payment_reconciliation_audits"), 1);
  // The confirmation must reach the notification store, and confirming twice
  // must still leave the operator with exactly one.
  assert.equal(count(database, "notifications"), 1);
  const notification = database.sqlite
    .prepare("SELECT type, order_number, title FROM notifications")
    .get() as { type: string; order_number: string; title: string };
  assert.equal(notification.type, "payment");
  assert.equal(notification.title, `Pembayaran lunas ${notification.order_number}`);
});

test("simultaneous confirmations produce one transition and one audit", async () => {
  const database = new ReconciliationDatabase();
  const id = seedPayment(database);
  const results = await Promise.all([
    confirmManualAutoLarisPayment(asD1(database), owner, input(id)),
    confirmManualAutoLarisPayment(asD1(database), owner, input(id)),
  ]);
  assert.equal(results.filter((result) => result.transitioned).length, 1);
  assert.equal(count(database, "payment_reconciliation_audits"), 1);
});

test("an expired local transaction can be confirmed only while the order remains unreleased", async () => {
  const database = new ReconciliationDatabase();
  const id = seedPayment(database, { transactionStatus: "expired" });
  const result = await confirmManualAutoLarisPayment(asD1(database), owner, input(id));
  assert.equal(result.transitioned, true);
  const audit = database.sqlite
    .prepare("SELECT previous_transaction_status FROM payment_reconciliation_audits")
    .get() as { previous_transaction_status: string };
  assert.equal(audit.previous_transaction_status, "expired");
});

test("wrong amount or provider reference fails without writes", async () => {
  for (const changed of [
    { ...input(101), verifiedAmount: 100701 },
    { ...input(101), providerReference: "TRX-WRONG" },
  ]) {
    const database = new ReconciliationDatabase();
    seedPayment(database);
    await assert.rejects(
      () => confirmManualAutoLarisPayment(asD1(database), owner, changed),
      (error: unknown) =>
        error instanceof ManualPaymentReconciliationError &&
        error.code === "PAYMENT_MISMATCH",
    );
    assert.equal(count(database, "payment_reconciliation_audits"), 0);
    assert.equal(
      (database.sqlite.prepare("SELECT status FROM payment_transactions").get() as { status: string }).status,
      "pending",
    );
  }
});

test("stock-restored, refunded, and missing-provider payments are locked without audit", async () => {
  const cases = [
    { stockRestoredAt: "2026-08-18T01:00:00.000Z" },
    { orderPaymentStatus: "refunded" },
    { providerReference: null },
  ];
  for (const options of cases) {
    const database = new ReconciliationDatabase();
    const id = seedPayment(database, options);
    await assert.rejects(
      () => confirmManualAutoLarisPayment(asD1(database), owner, input(id)),
      ManualPaymentReconciliationError,
    );
    assert.equal(count(database, "payment_reconciliation_audits"), 0);
    assert.equal(
      (database.sqlite.prepare("SELECT status FROM payment_transactions").get() as { status: string }).status,
      "pending",
    );
  }
});

test("unknown settled and success order states cannot be reactivated", async () => {
  for (const orderPaymentStatus of ["settled", "success"]) {
    const database = new ReconciliationDatabase();
    const id = seedPayment(database, { orderPaymentStatus });
    await assert.rejects(
      () => confirmManualAutoLarisPayment(asD1(database), owner, input(id)),
      (error: unknown) =>
        error instanceof ManualPaymentReconciliationError &&
        error.code === "PAYMENT_CONFLICT",
    );
    assert.equal(count(database, "payment_reconciliation_audits"), 0);
  }
});

test("a failed D1 batch rolls payment, order, and audit back together", async () => {
  const database = new ReconciliationDatabase();
  const id = seedPayment(database);
  database.failOnSql = "UPDATE orders";
  await assert.rejects(
    () => confirmManualAutoLarisPayment(asD1(database), owner, input(id)),
    (error: unknown) =>
      error instanceof ManualPaymentReconciliationError &&
      error.code === "DATABASE_ERROR",
  );
  assert.equal(count(database, "payment_reconciliation_audits"), 0);
  assert.equal(
    (database.sqlite.prepare("SELECT status FROM payment_transactions").get() as { status: string }).status,
    "pending",
  );
  assert.equal(
    (database.sqlite.prepare("SELECT payment_status FROM orders").get() as { payment_status: string }).payment_status,
    "pending",
  );
});

test("GET returns only scoped online AutoLaris rows with eligibility and bounded summary", async () => {
  const database = new ReconciliationDatabase();
  seedPayment(database, { id: 101 });
  seedPayment(database, { id: 102, stockRestoredAt: "2026-08-18T01:00:00.000Z" });
  seedPayment(database, { id: 103, method: "manual_transfer" });
  seedPayment(database, { id: 104, provider: "other" });
  const response = await GET({
    request: new Request("https://cms.test/api/admin/payment-reconciliation?page=1&page_size=20"),
    locals: { admin: owner, runtimeEnv: { OMS_DB: asD1(database) } },
  } as never);
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: { transactions: Array<Record<string, unknown>>; summary: Record<string, number> };
  };
  assert.equal(payload.data.transactions.length, 2);
  assert.equal(payload.data.transactions[0].customer_phone, "081234567890");
  assert.equal(payload.data.transactions[0].confirmation_eligible, false);
  assert.equal(payload.data.transactions[0].confirmation_block_reason, "stock_restored");
  assert.equal(payload.data.transactions[1].confirmation_eligible, true);
  assert.equal(payload.data.summary.actionable_count, 1);
  assert.equal(payload.data.summary.blocked_count, 1);
});

test("endpoint rejects scoped roles and missing or short notes without database writes", async () => {
  const database = new ReconciliationDatabase();
  const id = seedPayment(database);
  const request = (note?: string) => new Request("https://cms.test/api/admin/payment-reconciliation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      transaction_id: id,
      verified_amount: 100700,
      provider_reference: `TRX-${id}`,
      ...(note === undefined ? {} : { note }),
      confirmed: true,
    }),
  });
  const forbidden = await POST({
    request: request("Verified in provider dashboard."),
    locals: {
      admin: { username: "cs.one", role: "customer_service" },
      runtimeEnv: { OMS_DB: asD1(database) },
    },
  } as never);
  assert.equal(forbidden.status, 403);
  for (const note of [undefined, "    ", "1234"]) {
    const invalid = await POST({
      request: request(note),
      locals: { admin: owner, runtimeEnv: { OMS_DB: asD1(database) } },
    } as never);
    assert.equal(invalid.status, 422);
  }
  assert.equal(count(database, "payment_reconciliation_audits"), 0);
});

test("admin role can confirm through the protected route contract", async () => {
  const database = new ReconciliationDatabase();
  const id = seedPayment(database);
  const response = await POST({
    request: new Request("https://cms.test/api/admin/payment-reconciliation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transaction_id: id,
        verified_amount: 100700,
        provider_reference: `TRX-${id}`,
        note: "Verified in AutoLaris dashboard.",
        confirmed: true,
      }),
    }),
    locals: {
      admin: { username: "admin.one", role: "admin" },
      runtimeEnv: { OMS_DB: asD1(database) },
    },
  } as never);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { transitioned: boolean } };
  assert.equal(body.data.transitioned, true);
  assert.equal(count(database, "payment_reconciliation_audits"), 1);
});

test("an AutoLaris callback is recorded verbatim and moves no payment state", async () => {
  const rows: unknown[][] = [];
  const statements: string[] = [];
  const database = {
    prepare(sql: string) {
      statements.push(sql);
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async first() {
          if (sql.includes("SELECT count FROM rate_limits")) return null;
          if (sql.includes("INSERT INTO rate_limits")) return { count: 1 };
          throw new Error(`unexpected first(): ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT INTO autolaris_callbacks")) {
            rows.push(values);
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected run(): ${sql}`);
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  const original = console.error;
  console.error = () => {};
  let response: Response;
  try {
    response = await LEGACY_WEBHOOK({
      request: new Request("https://cms.test/api/webhooks/autolaris", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify({ rc: "00", data: { trx_id: "TRX-77", reff_id: "10041", status: "PAID" } }),
      }),
      locals: { runtimeEnv: { OMS_DB: database } },
    } as never);
  } finally {
    console.error = original;
  }
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { recorded: boolean }).recorded, true);
  assert.equal(rows.length, 1);
  // Indexed identifiers were lifted from the body; the body itself is intact.
  assert.equal(rows[0][5], "10041");
  assert.equal(rows[0][6], "TRX-77");
  assert.match(String(rows[0][4]), /"status":"PAID"/);
  // Nothing touched orders or payment_transactions: a forged "PAID" is evidence, not a transition.
  assert.equal(statements.some((sql) => /UPDATE (orders|payment_transactions)/.test(sql)), false);
});

test("a provider inquiry reports AutoLaris state without writing anything", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({ rc: "02", ket: "PENDING", data: { awb: "" } });
  };

  const database = new ReconciliationDatabase();
  const id = seedPayment(database);
  const before = count(database, "payment_transactions");

  const result = await inquireAutoLarisPaymentStatus(
    asD1(database),
    {} as App.Locals,
    owner,
    id,
  );

  assert.equal(requestedUrl, "https://autolaris.example.test/api/h2h/advice");
  assert.equal(result.provider.settlement, "pending");
  assert.equal(result.localStatus, "pending");
  assert.equal(result.contradictsLocalPaid, false);
  assert.equal(count(database, "payment_transactions"), before);
  assert.equal(count(database, "payment_reconciliation_audits"), 0);
  assert.equal(
    (
      database.sqlite
        .prepare("SELECT status FROM payment_transactions WHERE id = ?")
        .get(id) as { status: string }
    ).status,
    "pending",
  );
});

test("the provider contradicting a paid row is surfaced, not reconciled away", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({ rc: "02", ket: "PENDING", data: { awb: "" } });

  const database = new ReconciliationDatabase();
  const id = seedPayment(database, { transactionStatus: "paid" });

  const result = await inquireAutoLarisPaymentStatus(
    asD1(database),
    {} as App.Locals,
    owner,
    id,
  );

  assert.equal(result.contradictsLocalPaid, true);
  // Reading the provider must never repair the row it disagrees with.
  assert.equal(
    (
      database.sqlite
        .prepare("SELECT status FROM payment_transactions WHERE id = ?")
        .get(id) as { status: string }
    ).status,
    "paid",
  );
});

test("a scoped role cannot reach AutoLaris through the inquiry path", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(null, { status: 500 });
  };

  const database = new ReconciliationDatabase();
  const id = seedPayment(database);

  await assert.rejects(
    inquireAutoLarisPaymentStatus(asD1(database), {} as App.Locals, { username: "cs.one", role: "customer_service" as const }, id),
    /owner atau admin/i,
  );
  assert.equal(providerCalls, 0);
});
