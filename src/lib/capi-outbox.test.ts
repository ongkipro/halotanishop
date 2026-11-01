import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { splitMigrationStatements } from "./schema-version.ts";
import {
  CAPI_DRAIN_LEASE_MS,
  countRecoverableEvents,
  decideRetry,
  deliverCapiEvent,
  drainCapiOutbox,
  drainCapiOutboxBacklog,
  enqueueCapiEvent,
  purgeExpiredCapiOutboxEvents,
  requeueRecoverableEvents,
} from "./capi-outbox.ts";

const MINUTE = 60_000;

test("a delivered event is settled and never retried", () => {
  assert.deepEqual(decideRetry({ success: true }, 0, 5), { status: "sent", delayMs: 0 });
});

test("transient failures back off exponentially instead of hammering Meta", () => {
  assert.deepEqual(decideRetry({ success: false }, 0, 5), { status: "pending", delayMs: 2 * MINUTE });
  assert.deepEqual(decideRetry({ success: false }, 1, 5), { status: "pending", delayMs: 4 * MINUTE });
  assert.deepEqual(decideRetry({ success: false }, 2, 5), { status: "pending", delayMs: 8 * MINUTE });
});

test("rate limits wait a flat window rather than doubling", () => {
  for (const code of [4, 17, 613]) {
    assert.deepEqual(decideRetry({ success: false, errorCode: code }, 1, 5), {
      status: "pending",
      delayMs: 15 * MINUTE,
    });
  }
});

test("a dead access token is terminal — retrying only burns quota", () => {
  assert.equal(decideRetry({ success: false, errorCode: 190 }, 0, 5).status, "failed");
});

test("events stop retrying once the attempt budget is spent", () => {
  assert.equal(decideRetry({ success: false }, 4, 5).status, "failed");
  assert.equal(decideRetry({ success: false }, 3, 5).status, "pending");
});

test("backoff is capped so a stale event cannot schedule itself years out", () => {
  assert.equal(decideRetry({ success: false }, 20, 50).delayMs, 60 * MINUTE);
});

/**
 * A real SQLite behind the D1 shape, because the claim is a property of how
 * the database serializes two writers — a hand-rolled mock that returns rows
 * on demand would prove nothing about it.
 */
function outboxDatabase(seed: string) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE capi_event_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE, event_name TEXT NOT NULL, payload TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5, last_error TEXT,
      next_retry_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    ${seed}
  `);
  const database = {
    prepare: (sql: string) => {
      const bound: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => { bound.push(...values); return statement; },
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bound as never[]).changes) } }),
        first: async () => sqlite.prepare(sql).get(...bound as never[]) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...bound as never[]) }),
      };
      return statement;
    },
  } as unknown as D1Database;
  return { sqlite, database };
}

const pageView = (eventId: string) =>
  JSON.stringify({ eventName: "PageView", eventId, eventSourceUrl: "https://toko.test/", userData: {}, customData: {} });

test("two concurrent drains never claim the same row", async () => {
  const now = new Date("2026-09-04T04:00:00.000Z");
  const seeded = Array.from({ length: 14 }, (_, i) =>
    `(${i + 1},'e-${i + 1}','PageView','${pageView(`e-${i + 1}`)}','pending',0,5,NULL,'2026-09-04T03:00:00.000Z','2026-09-04T03:00:00.000Z','t')`,
  ).join(",");
  const { sqlite, database } = outboxDatabase(`INSERT INTO capi_event_outbox VALUES ${seeded};`);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    // Slow enough that a second drain would overlap a naive select-then-send.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    // Both drains claim before either transmits — two visitors arriving
    // together, each firing a drain in `waitUntil`, or the cron and a visitor.
    await Promise.all([
      drainCapiOutbox(database, "1234567890", "token", now),
      drainCapiOutbox(database, "1234567890", "token", now),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const sent = (sqlite.prepare("SELECT event_id FROM capi_event_outbox WHERE status = 'sent' ORDER BY id").all() as { event_id: string }[]).map((r) => r.event_id);
  // Ten claimed by the first drain, four by the second: disjoint, and every
  // one of the fourteen accounted for exactly once.
  assert.equal(new Set(sent).size, sent.length, "no row may be claimed twice");
  assert.equal(sent.length, 14);
  const overBudget = sqlite.prepare("SELECT COUNT(*) AS c FROM capi_event_outbox WHERE attempts > max_attempts").get() as { c: number };
  assert.equal(overBudget.c, 0, "a double transmission is what pushed attempts past its budget in production");
});

test("a claimed row is hidden from the next drain until its lease expires", async () => {
  const now = new Date("2026-09-04T04:00:00.000Z");
  const { sqlite, database } = outboxDatabase(
    `INSERT INTO capi_event_outbox VALUES (1,'e-1','PageView','${pageView("e-1")}','pending',0,5,NULL,'2026-09-04T03:00:00.000Z','2026-09-04T03:00:00.000Z','t');`,
  );
  const originalFetch = globalThis.fetch;
  // A transmission that never resolves is a Worker killed mid-drain.
  globalThis.fetch = (async () => new Promise(() => {})) as typeof fetch;
  try {
    void drainCapiOutbox(database, "1234567890", "token", now);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const leased = sqlite.prepare("SELECT next_retry_at FROM capi_event_outbox WHERE id = 1").get() as { next_retry_at: string };
    assert.ok(Date.parse(leased.next_retry_at) > now.getTime(), "the claim must push the row out of the due window");
    // The lease is a delay, not a grave: the row returns on its own.
    assert.ok(Date.parse(leased.next_retry_at) <= now.getTime() + CAPI_DRAIN_LEASE_MS, "and it must come back once the lease expires");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the purge removes only settled rows past retention, and keeps the queue", async () => {
  const now = new Date("2026-09-05T00:00:00.000Z");
  const { sqlite, database } = outboxDatabase(`
    INSERT INTO capi_event_outbox VALUES
      (1,'old-sent','PageView','{}','sent',1,5,NULL,'t','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      (2,'old-failed','PageView','{}','failed',5,5,'x','t','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      (3,'old-pending','Purchase','{}','pending',2,5,NULL,'t','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      (4,'new-sent','PageView','{}','sent',1,5,NULL,'t','2026-09-04T00:00:00.000Z','2026-09-04T00:00:00.000Z');
  `);
  assert.equal(await purgeExpiredCapiOutboxEvents(database, now), 2);
  const left = (sqlite.prepare("SELECT event_id FROM capi_event_outbox ORDER BY id").all() as { event_id: string }[]).map((r) => r.event_id);
  // A pending row is never purged however old — that is a stuck queue to be
  // drained or recovered, not history to be swept.
  assert.deepEqual(left, ["old-pending", "new-sent"]);
});

// Recovering an outage caused by a dead access token. The classification is
// structural rather than a match on Meta's error prose, so it must stay
// pinned to the one property that makes it exact.

test("a dead token is the only reason decideRetry terminates below the attempt budget", () => {
  // This is the invariant `requeueRecoverableEvents` selects on. If a third
  // terminal reason is ever added without incrementing attempts, that reason
  // would silently become "recoverable" and be resent forever.
  assert.deepEqual(decideRetry({ success: false, errorCode: 190 }, 0, 5), {
    status: "failed",
    delayMs: 0,
  });
  assert.equal(decideRetry({ success: false, errorCode: 500 }, 0, 5).status, "pending");
  assert.equal(decideRetry({ success: false, errorCode: 4 }, 0, 5).status, "pending");
  assert.equal(decideRetry({ success: false, errorCode: 500 }, 4, 5).status, "failed");
});



test("requeue recovers a destination outage, not just a dead token", async () => {
  const now = new Date("2026-09-04T04:00:00.000Z");
  const { sqlite, database } = outboxDatabase(`
    INSERT INTO capi_event_outbox VALUES
      -- exhausted its budget honestly, against a pixel the token could not see
      (1,'vc-1','ViewContent','{}','failed',5,5,'Unsupported post request. Object with ID ...','t','2026-09-03T12:14:00.000Z','t'),
      -- the dead-token rows the first version of this function was built for
      (2,'pv-1','PageView','{}','failed',2,5,'Error validating access token','t','2026-09-03T09:00:00.000Z','t'),
      -- Purchase, and it must be requeued ahead of the rest
      (3,'INV-9','Purchase','{}','failed',9,5,'Unsupported post request. Object with ID ...','t','2026-09-03T13:00:00.000Z','t'),
      -- can never succeed
      (4,'bad-1','PageView','{}','failed',0,5,'payload tidak dapat dibaca','t','2026-09-03T13:00:00.000Z','t'),
      -- inside the 30-day retention, past Meta's 7-day event_time limit
      (5,'old-1','PageView','{}','failed',5,5,'Unsupported post request. Object with ID ...','t','2026-08-20T00:00:00.000Z','t'),
      -- already delivered
      (6,'pv-2','PageView','{}','sent',1,5,NULL,'t','2026-09-03T13:00:00.000Z','t');
  `);

  assert.equal(await countRecoverableEvents(database, now), 3);
  assert.equal(await requeueRecoverableEvents(database, now), 3);

  const rows = sqlite.prepare("SELECT event_id, status, attempts, last_error FROM capi_event_outbox ORDER BY id").all() as {
    event_id: string; status: string; attempts: number; last_error: string | null;
  }[];
  assert.deepEqual(
    rows.map((r) => `${r.event_id}:${r.status}:${r.attempts}`),
    // Budget reset, error cleared. The unreadable payload and the stale row
    // stay terminal; sending either would spend the operator's one recovery on
    // an event that can never land.
    ["vc-1:pending:0", "pv-1:pending:0", "INV-9:pending:0", "bad-1:failed:0", "old-1:failed:5", "pv-2:sent:1"],
  );
  assert.equal(rows[0].last_error, null);
  assert.equal(await countRecoverableEvents(database, now), 0, "requeue does not loop");
});

/** The outbox exactly as the checked-in chain builds it: 0026, then 0057. */
function migratedOutbox() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0026_classy_dark_phoenix.sql", "0057_capi_outbox_event_name_key.sql"]) {
    const sql = readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
    for (const statement of splitMigrationStatements(sql)) sqlite.exec(statement);
  }
  const database = {
    prepare: (sql: string) => {
      const bound: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => { bound.push(...values); return statement; },
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bound as never[]).changes) } }),
        first: async () => sqlite.prepare(sql).get(...bound as never[]) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...bound as never[]) }),
      };
      return statement;
    },
  } as unknown as D1Database;
  return { sqlite, database };
}

const outboxEvent = (eventName: string, eventId: string, eventTime?: number) => ({
  eventName,
  eventId,
  eventSourceUrl: "https://toko.test/",
  userData: {},
  customData: { orderNumber: eventId },
  eventTime,
});

test("a funnel event posted with an order number cannot swallow that order's Purchase", async () => {
  const { database } = migratedOutbox();
  assert.equal(await enqueueCapiEvent(database, outboxEvent("PageView", "INV-10500")), true);
  assert.equal(
    await enqueueCapiEvent(database, outboxEvent("Purchase", "INV-10500")),
    true,
    "the Purchase must still be recorded",
  );
  assert.equal(
    await enqueueCapiEvent(database, outboxEvent("Purchase", "INV-10500")),
    false,
    "a replayed Purchase is still deduplicated",
  );
});

test("immediate delivery and a concurrent drain transmit an event once, with its original time", async () => {
  const { sqlite, database } = migratedOutbox();
  await enqueueCapiEvent(database, outboxEvent("Purchase", "INV-7", 1_780_000_000));
  const bodies: { data: { event_time: number }[] }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    await Promise.all([
      deliverCapiEvent(database, "Purchase", "INV-7", "1234567890", "token"),
      drainCapiOutbox(database, "1234567890", "token"),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(bodies.length, 1, "exactly one transmission");
  assert.equal(bodies[0].data[0].event_time, 1_780_000_000, "a retry never restamps the event as now");
  const row = sqlite.prepare("SELECT status, attempts FROM capi_event_outbox").get() as { status: string; attempts: number };
  assert.deepEqual({ ...row }, { status: "sent", attempts: 0 });
});

test("the cron drains a backlog in several batches and stops at the first refusal", async () => {
  const now = new Date("2026-09-04T04:00:00.000Z");
  const seed = (count: number) =>
    `INSERT INTO capi_event_outbox VALUES ${Array.from({ length: count }, (_, i) =>
      `(${i + 1},'e-${i + 1}','PageView','${pageView(`e-${i + 1}`)}','pending',0,5,NULL,'2026-09-04T03:00:00.000Z','2026-09-04T03:00:00.000Z','t')`,
    ).join(",")};`;
  const originalFetch = globalThis.fetch;
  try {
    const backlog = outboxDatabase(seed(35));
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    }) as typeof fetch;
    assert.equal(await drainCapiOutboxBacklog(backlog.database, "1234567890", "token", now), 30);
    assert.equal(calls, 30, "bounded at three batches so the cron keeps inside its subrequest budget");

    const short = outboxDatabase(seed(12));
    assert.equal(await drainCapiOutboxBacklog(short.database, "1234567890", "token", now), 12);

    const refused = outboxDatabase(seed(25));
    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { code: 1, message: "down" } }), { status: 500 });
    }) as typeof fetch;
    assert.equal(await drainCapiOutboxBacklog(refused.database, "1234567890", "token", now), 0);
    assert.equal(calls, 10, "a refused batch ends the run instead of spending more rows' budgets");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
