import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canAccessAdminRoute } from "./auth.ts";
import {
  CHECK_REUSE_MS,
  readHealthSnapshot,
  refreshHealthSnapshot,
  SNAPSHOT_STALE_MINUTES,
  statusIconState,
  writeHealthSnapshot,
  type HealthSnapshot,
} from "./health-snapshot.ts";
import {
  classifyScheduler,
  collectOperationalHealth,
  readSchedulerHeartbeat,
  recordSchedulerRun,
  SCHEDULER_STALE_MINUTES,
  type HealthSignal,
  type OperationalHealth,
} from "./operational-health.ts";
import { splitMigrationStatements } from "./schema-version.ts";

// ---------------------------------------------------------------------------
// D1 over node:sqlite. `batch` is one transaction, like D1's.

type SqlValue = null | number | string;
const MIGRATIONS_DIR = new URL("../db/migrations/", import.meta.url);
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
// Found by suffix, never by number: integration renumbers the chain.
const SNAPSHOT_MIGRATION = MIGRATION_FILES.find((name) => name.endsWith("_ops_health_snapshot.sql"));

class Statement {
  readonly sqlite: DatabaseSync;
  readonly sql: string;
  readonly values: SqlValue[];
  readonly hooks: Hooks;
  constructor(sqlite: DatabaseSync, sql: string, hooks: Hooks, values: SqlValue[] = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.hooks = hooks;
    this.values = values;
  }
  bind(...values: SqlValue[]) {
    return new Statement(this.sqlite, this.sql, this.hooks, values);
  }
  async first<T>() {
    this.hooks.check(this.sql);
    return (this.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() {
    this.hooks.check(this.sql);
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values) as T[], meta: {} };
  }
  async run() {
    return this.execute();
  }
  execute() {
    this.hooks.check(this.sql);
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql)) {
      return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values), meta: { changes: 0 } };
    }
    const info = this.sqlite.prepare(this.sql).run(...this.values);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

type Hooks = { failWhen: RegExp | null; check(sql: string): void };

function createDatabase(files: string[] = SNAPSHOT_MIGRATION ? [SNAPSHOT_MIGRATION] : []) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of files) {
    for (const statement of splitMigrationStatements(readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"))) {
      sqlite.exec(statement);
    }
  }
  const hooks: Hooks = {
    failWhen: null,
    check(sql) {
      if (this.failWhen?.test(sql)) throw new Error("D1_ERROR: injected");
    },
  };
  const database = {
    prepare: (sql: string) => new Statement(sqlite, sql, hooks),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, hooks, database: database as unknown as D1Database };
}

async function quietly<T>(run: () => Promise<T>): Promise<{ value: T; errors: unknown[][] }> {
  const original = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    return { value: await run(), errors };
  } finally {
    console.error = original;
  }
}

const NOW = Date.parse("2026-10-29T08:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function signalOf(state: HealthSignal["state"], id: HealthSignal["id"] = "capi-outbox"): HealthSignal {
  return { id, state, reason: "x", lastAt: null, ageMinutes: null, metrics: {} };
}

function healthOf(signals: HealthSignal[], checkedAt = minutesAgo(1)): OperationalHealth {
  const overall = signals.some((s) => s.state === "degraded")
    ? "degraded"
    : signals.some((s) => s.state === "unknown")
      ? "unknown"
      : "healthy";
  return {
    checkedAt,
    overall,
    signals,
    build: {
      version: "test",
      releaseTag: "test",
      expectedSchemaVersion: 1,
      appliedSchemaVersion: 1,
      schemaState: "match",
    },
  };
}

function snapshotOf(
  signals: HealthSignal[],
  takenAt: string,
  setupRequiredLeft: number | null = 0,
): HealthSnapshot {
  const health = healthOf(signals, takenAt);
  return {
    overall: health.overall,
    degradedCount: signals.filter((s) => s.state === "degraded").length,
    health,
    setupRequiredLeft,
    takenAt,
    schedulerRanAt: null,
  };
}

// ---------------------------------------------------------------------------
// A-367: the migration, the row, and the icon's precedence.

test("the snapshot migration exists and applies to an empty database", () => {
  assert.ok(SNAPSHOT_MIGRATION, "a *_ops_health_snapshot.sql migration is checked in");
  const { sqlite } = createDatabase();
  const columns = (sqlite.prepare("PRAGMA table_info(ops_health_snapshot)").all() as { name: string }[])
    .map((column) => column.name);
  assert.deepEqual(columns, [
    "id",
    "overall",
    "degraded_count",
    "health_json",
    "setup_required_left",
    "taken_at",
    "scheduler_ran_at",
  ]);
  assert.throws(() => sqlite.exec("INSERT INTO ops_health_snapshot (id) VALUES (2)"), /CHECK/);
});

test("the icon's precedence: degraded beats setup beats healthy beats unknown", () => {
  const taken = minutesAgo(10);
  const degradedWithSetup = statusIconState(
    snapshotOf([signalOf("degraded"), signalOf("degraded", "meta-capi"), signalOf("healthy", "mengantar")], taken, 3),
    NOW,
  );
  assert.deepEqual(
    { tone: degradedWithSetup.tone, count: degradedWithSetup.count, label: degradedWithSetup.label },
    { tone: "problem", count: 2, label: "2 masalah operasional" },
  );

  const setup = statusIconState(snapshotOf([signalOf("healthy"), signalOf("unknown", "alerting")], taken, 2), NOW);
  assert.deepEqual({ tone: setup.tone, count: setup.count }, { tone: "setup", count: 2 });
  assert.match(setup.label, /2 langkah setup wajib/);

  const healthy = statusIconState(snapshotOf([signalOf("healthy"), signalOf("healthy", "alerting")], taken, 0), NOW);
  assert.deepEqual({ tone: healthy.tone, count: healthy.count }, { tone: "healthy", count: 0 });

  // Unknown setup (unreadable facts) is not amber.
  const unreadableSetup = statusIconState(snapshotOf([signalOf("healthy")], taken, null), NOW);
  assert.equal(unreadableSetup.tone, "healthy");
});

test('"belum ada data" alone is never red, and a healthy/unknown mix is not green', () => {
  const taken = minutesAgo(5);
  const onlyUnknown = statusIconState(snapshotOf([signalOf("unknown"), signalOf("unknown", "alerting")], taken), NOW);
  assert.equal(onlyUnknown.tone, "unknown");
  assert.equal(onlyUnknown.count, 0);
  const mixed = statusIconState(snapshotOf([signalOf("healthy"), signalOf("unknown", "alerting")], taken), NOW);
  assert.equal(mixed.tone, "unknown");
});

test("a 3-hour-old healthy snapshot reads as a problem: the checker stopped", () => {
  const stale = statusIconState(snapshotOf([signalOf("healthy")], minutesAgo(180)), NOW);
  assert.deepEqual({ tone: stale.tone, count: stale.count, stale: stale.stale }, { tone: "problem", count: 1, stale: true });
  assert.match(stale.label, /pemeliharaan berhenti/);
  // The boundary: exactly two hours is not yet stale.
  assert.equal(statusIconState(snapshotOf([signalOf("healthy")], minutesAgo(SNAPSHOT_STALE_MINUTES)), NOW).tone, "healthy");
  assert.equal(statusIconState(snapshotOf([signalOf("healthy")], minutesAgo(SNAPSHOT_STALE_MINUTES + 1)), NOW).tone, "problem");
});

test("no row reads as neutral, as does a row holding only the heartbeat", async () => {
  assert.equal(statusIconState(null, NOW).tone, "unknown");
  const { database } = createDatabase();
  assert.equal(await readHealthSnapshot(database), null);
  await recordSchedulerRun(database, new Date(NOW));
  const heartbeatOnly = await readHealthSnapshot(database);
  assert.equal(heartbeatOnly?.takenAt, null);
  assert.equal(statusIconState(heartbeatOnly, NOW).tone, "unknown");
});

test("an unreadable snapshot table reads as neutral, not as an error page", async () => {
  const { value, errors } = await quietly(() => readHealthSnapshot(createDatabase([]).database));
  assert.equal(value, null);
  assert.equal(errors[0]?.[0], "health-snapshot-unreadable");
});

// ---------------------------------------------------------------------------
// A-368 / A-379: one row, replaced; the heartbeat lives beside it in D1.

test("a write leaves one row, a second write replaces it, and neither touches the heartbeat", async () => {
  const { sqlite, database } = createDatabase();
  await recordSchedulerRun(database, new Date(minutesAgo(3)));
  await writeHealthSnapshot(database, healthOf([signalOf("degraded")], minutesAgo(2)), 4);
  await writeHealthSnapshot(database, healthOf([signalOf("healthy")], minutesAgo(1)), 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM ops_health_snapshot").get() as { n: number }).n, 1);
  const stored = await readHealthSnapshot(database);
  assert.equal(stored?.overall, "healthy");
  assert.equal(stored?.degradedCount, 0);
  assert.equal(stored?.setupRequiredLeft, 1);
  assert.equal(stored?.takenAt, minutesAgo(1));
  assert.equal(stored?.health?.signals[0].state, "healthy");
  assert.equal(stored?.schedulerRanAt, minutesAgo(3), "the snapshot write keeps the heartbeat");

  await recordSchedulerRun(database, new Date(minutesAgo(0)));
  const after = await readHealthSnapshot(database);
  assert.equal(after?.takenAt, minutesAgo(1), "the heartbeat keeps the snapshot");
  assert.equal(after?.schedulerRanAt, minutesAgo(0));
});

test("the scheduler signal reads the D1 heartbeat; a missing row is never-ran; the threshold is unchanged", async () => {
  assert.equal(SCHEDULER_STALE_MINUTES, 150);
  const { database } = createDatabase();
  assert.equal(await readSchedulerHeartbeat(database), null);
  assert.equal(classifyScheduler(await readSchedulerHeartbeat(database), NOW).reason, "scheduler-never-ran");

  await recordSchedulerRun(database, new Date(minutesAgo(30)));
  assert.equal(await readSchedulerHeartbeat(database), minutesAgo(30));
  assert.equal(classifyScheduler(await readSchedulerHeartbeat(database), NOW).state, "healthy");
  await recordSchedulerRun(database, new Date(minutesAgo(151)));
  assert.equal(classifyScheduler(await readSchedulerHeartbeat(database), NOW).reason, "scheduler-stalled");

  const { value } = await quietly(() => readSchedulerHeartbeat(createDatabase([]).database));
  assert.equal(value, undefined, "an unreadable row is unreadable, not never-ran");
  assert.equal(classifyScheduler(value, NOW).reason, "unreadable");

  // The full collection takes its scheduler signal from the same row.
  const full = createDatabase(MIGRATION_FILES);
  await recordSchedulerRun(full.database, new Date(Date.now() - 5 * 60_000));
  const health = await collectOperationalHealth(full.database);
  assert.equal(health.signals.find((signal) => signal.id === "scheduler")?.reason, "scheduler-ran");
});

test("the heartbeat is no longer a KV key", () => {
  const source = readFileSync(new URL("./operational-health.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /SCHEDULER_HEARTBEAT_KEY|KVNamespace|SESSION/);
});

// ---------------------------------------------------------------------------
// refreshHealthSnapshot: the live check behind POST /api/admin/health/check.

const locals = (database: D1Database, extra: Record<string, unknown> = {}) =>
  ({
    runtimeEnv: { OMS_DB: database, ...extra },
    tenant: { siteUrl: "https://toko.test" },
    admin: { username: "owner", role: "owner" },
  }) as unknown as App.Locals;

test("a check inside 15 seconds returns the stored snapshot without collecting", async () => {
  const { database } = createDatabase();
  const takenAt = new Date(NOW - (CHECK_REUSE_MS - 1_000)).toISOString();
  await writeHealthSnapshot(database, healthOf([signalOf("healthy")], takenAt), 0);
  let collected = 0;
  const collect = (async () => {
    collected += 1;
    return healthOf([signalOf("degraded")], new Date(NOW).toISOString());
  }) as typeof collectOperationalHealth;
  const reused = await refreshHealthSnapshot(database, locals(database), NOW, collect);
  assert.equal(reused.reused, true);
  assert.equal(collected, 0);
  assert.equal(reused.snapshot.takenAt, takenAt);

  const later = await quietly(() => refreshHealthSnapshot(database, locals(database), NOW + 2_000, collect));
  assert.equal(later.value.reused, false);
  assert.equal(collected, 1);
  assert.equal((await readHealthSnapshot(database))?.overall, "degraded");
});

test("a failing collection leaves the old snapshot rather than a blank one", async () => {
  const { database } = createDatabase();
  await writeHealthSnapshot(database, healthOf([signalOf("healthy")], minutesAgo(30)), 0);
  const failing = (async () => {
    throw new Error("collection failed");
  }) as typeof collectOperationalHealth;
  await assert.rejects(
    quietly(() => refreshHealthSnapshot(database, locals(database), NOW, failing)),
    /collection failed/,
  );
  const kept = await readHealthSnapshot(database);
  assert.equal(kept?.overall, "healthy");
  assert.equal(kept?.takenAt, minutesAgo(30));
});

// ---------------------------------------------------------------------------
// A-369: the API. Role access is the middleware's, through canAccessAdminRoute.

test("owner and admin reach the status page and its API; advertiser and customer service do not", () => {
  for (const path of ["/admin/status", "/api/admin/health", "/api/admin/health/status", "/api/admin/health/check"]) {
    assert.equal(canAccessAdminRoute("owner", path), true, `owner ${path}`);
    assert.equal(canAccessAdminRoute("admin", path), true, `admin ${path}`);
    assert.equal(canAccessAdminRoute("advertiser", path), false, `advertiser ${path}`);
    assert.equal(canAccessAdminRoute("customer_service", path), false, `customer_service ${path}`);
  }
});

type KvSpy = KVNamespace & { puts: string[] };
function kvSpy(): KvSpy {
  const puts: string[] = [];
  return {
    puts,
    get: async () => null,
    put: async (key: string) => {
      puts.push(key);
    },
  } as unknown as KvSpy;
}

async function withFetchSpy<T>(run: (calls: string[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return new Response("ok");
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** A Meta outbox row created two days ago and still pending: a stalled queue. */
function seedStalledOutbox(sqlite: DatabaseSync) {
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO capi_event_outbox (event_id, event_name, payload, status, attempts, next_retry_at, created_at, updated_at)
       VALUES ('evt-1', 'Purchase', '{}', 'pending', 1, ?, ?, ?)`,
    )
    .run(old, old, old);
}

const { GET: healthGet } = await import("../pages/api/admin/health.ts");
const { GET: statusGet } = await import("../pages/api/admin/health/status.ts");
const { POST: checkPost } = await import("../pages/api/admin/health/check.ts");

test("GET /api/admin/health only reads: no alert state in KV, no webhook, even with a stalled outbox", async () => {
  const { sqlite, database } = createDatabase(MIGRATION_FILES);
  seedStalledOutbox(sqlite);
  const kv = kvSpy();
  await withFetchSpy(async (calls) => {
    const response = await healthGet({
      locals: locals(database, { SESSION: kv, OPS_ALERT_WEBHOOK_URL: "https://hooks.test/ops" }),
      url: new URL("https://toko.test/api/admin/health"),
    } as never);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.health.signals.find((s: HealthSignal) => s.id === "capi-outbox").state, "degraded");
    assert.equal("alerts" in payload, false);
    assert.deepEqual(kv.puts, [], "no alert state written");
    assert.deepEqual(calls, [], "no webhook");
  });
});

test("GET /api/admin/health/status returns the icon from the row, with staleness applied", async () => {
  const { database } = createDatabase();
  const empty = await (await statusGet({ locals: locals(database) } as never)).json();
  assert.equal(empty.icon.tone, "unknown");

  await writeHealthSnapshot(database, healthOf([signalOf("healthy")], new Date(Date.now() - 3 * 3_600_000).toISOString()), 0);
  const stale = await (await statusGet({ locals: locals(database) } as never)).json();
  assert.equal(stale.icon.tone, "problem");
  assert.equal(stale.icon.stale, true);
});

test("a manual check does not reset staleness: it is measured from the last scheduled run", async () => {
  // The cron last ran three hours ago; an operator's check refreshed taken_at a minute ago.
  const manual = { ...snapshotOf([signalOf("healthy")], minutesAgo(1)), schedulerRanAt: minutesAgo(180) };
  const icon = statusIconState(manual, NOW);
  assert.deepEqual({ tone: icon.tone, stale: icon.stale }, { tone: "problem", stale: true });
  assert.match(icon.label, /pemeliharaan berhenti/);
  // A recent scheduled run keeps an older snapshot fresh-by-schedule.
  const ran = { ...snapshotOf([signalOf("healthy")], minutesAgo(1)), schedulerRanAt: minutesAgo(30) };
  assert.equal(statusIconState(ran, NOW).tone, "healthy");

  // The same through the real write path: heartbeat 3h old, then a manual check now.
  const { database } = createDatabase();
  await recordSchedulerRun(database, new Date(Date.now() - 3 * 3_600_000));
  const { snapshot } = await refreshHealthSnapshot(
    database,
    locals(database),
    Date.now(),
    async () => healthOf([signalOf("healthy")], new Date().toISOString()),
  );
  assert.equal(statusIconState(snapshot, Date.now()).stale, true);
  assert.equal(statusIconState(await readHealthSnapshot(database), Date.now()).stale, true);
  assert.equal(statusIconState(snapshot, Date.now()).staleReason, "scheduler");
});

test("POST /api/admin/health/check writes the snapshot, reuses it inside 15 seconds, and sends no alert", async () => {
  const { sqlite, database } = createDatabase(MIGRATION_FILES);
  seedStalledOutbox(sqlite);
  const kv = kvSpy();
  const env = { SESSION: kv, OPS_ALERT_WEBHOOK_URL: "https://hooks.test/ops" };
  await withFetchSpy(async (calls) => {
    const first = await (await checkPost({ locals: locals(database, env) } as never)).json();
    assert.equal(first.success, true);
    assert.equal(first.reused, false);
    assert.equal(first.icon.tone, "problem");
    const stored = await readHealthSnapshot(database);
    assert.equal(stored?.takenAt, first.snapshot.takenAt);
    assert.equal(typeof stored?.setupRequiredLeft, "number", "setup facts are part of the check");

    const second = await (await checkPost({ locals: locals(database, env) } as never)).json();
    assert.equal(second.reused, true);
    assert.equal(second.snapshot.takenAt, first.snapshot.takenAt);

    assert.deepEqual(kv.puts, [], "no alert state written");
    assert.deepEqual(calls, [], "no webhook");
  });
});

// ---------------------------------------------------------------------------
// A-368: the scheduled handler, run for real against the whole migration chain.
// `src/worker.ts` imports Astro's Cloudflare handler and Vite's migration glob;
// both are stubbed, everything else is the production code.

const HANDLER_STUB = "stub:astro-cloudflare-handler";
const MIGRATIONS_STUB = "stub:bundled-migrations";
const workerHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@astrojs/cloudflare/handler") return { url: HANDLER_STUB, shortCircuit: true };
    if (/bundled-migrations(\.ts)?$/.test(specifier)) return { url: MIGRATIONS_STUB, shortCircuit: true };
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!(specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier))) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
  load(url, context, nextLoad) {
    if (url === HANDLER_STUB) {
      return { format: "module", source: "export const handle = () => new Response('');", shortCircuit: true };
    }
    if (url === MIGRATIONS_STUB) {
      const migrations = MIGRATION_FILES.map((name) => ({
        name,
        sql: readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"),
      }));
      return {
        format: "module",
        source: `export const BUNDLED_MIGRATIONS = ${JSON.stringify(migrations)};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const worker = (await import("../worker.ts")).default as unknown as {
  scheduled(controller: { scheduledTime: number }, env: Record<string, unknown>, ctx: unknown): Promise<void>;
};
// Not deregistered: `schema-version.ts` imports the migration chain lazily, on
// the first run, so the stub must still resolve then. node --test gives this
// file its own process, so the hooks end with it.
void workerHooks;

async function runCron(database: D1Database, env: Record<string, unknown>, scheduledTime = Date.now()) {
  const original = { info: console.info, error: console.error };
  const infos: Record<string, unknown>[] = [];
  const errors: string[] = [];
  console.info = (label: unknown, payload: unknown) => {
    if (label === "operational-health-scheduled") infos.push(payload as Record<string, unknown>);
  };
  console.error = (label: unknown) => {
    errors.push(String(label));
  };
  try {
    await worker.scheduled({ scheduledTime }, { OMS_DB: database, ...env }, { waitUntil() {}, passThroughOnException() {} });
  } finally {
    console.info = original.info;
    console.error = original.error;
  }
  return { log: infos[0], errors };
}

/** Empty database: `ensureSchemaUpgraded` applies the real chain on the first run. */
function emptyDatabase() {
  return createDatabase([]);
}

test("the hourly run writes one snapshot row and the heartbeat; a second run replaces it", async () => {
  const { sqlite, database } = emptyDatabase();
  const first = await runCron(database, { SESSION: kvSpy() }, Date.parse("2026-10-29T07:00:00.000Z"));
  assert.ok(first.log, "the run completed");
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM ops_health_snapshot").get() as { n: number }).n, 1);
  const one = await readHealthSnapshot(database);
  assert.ok(one?.takenAt && one.health);
  assert.equal(one?.schedulerRanAt, "2026-10-29T07:00:00.000Z");
  // A fresh store has no product, no Mengantar key and no warehouse.
  assert.ok((one?.setupRequiredLeft ?? 0) > 0);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await runCron(database, { SESSION: kvSpy() }, Date.parse("2026-10-29T08:00:00.000Z"));
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM ops_health_snapshot").get() as { n: number }).n, 1);
  const two = await readHealthSnapshot(database);
  assert.equal(two?.schedulerRanAt, "2026-10-29T08:00:00.000Z");
  assert.notEqual(two?.takenAt, one?.takenAt);
});

test("a throwing snapshot write is logged and leaves the CAPI drain and payment reconciliation unchanged", async () => {
  const normal = emptyDatabase();
  const baseline = await runCron(normal.database, { SESSION: kvSpy() });

  const broken = emptyDatabase();
  // Only the snapshot upsert fails; every other statement runs.
  broken.hooks.failWhen = /INSERT INTO ops_health_snapshot\s*\(id, overall/;
  const failed = await runCron(broken.database, { SESSION: kvSpy() });

  assert.ok(failed.errors.includes("scheduled-health-snapshot-failed"));
  assert.ok(!baseline.errors.includes("scheduled-health-snapshot-failed"));
  for (const key of [
    "drainedCapiEvents",
    "autoLarisReconciliation",
    "queuedGoogleAdsConversions",
    "drainedGoogleAdsConversions",
    "pluginCron",
    "backfilledReceiverScores",
    "purgedAbandonedOrders",
  ]) {
    assert.deepEqual(failed.log[key], baseline.log[key], key);
  }
  // The heartbeat is its own statement and still landed.
  assert.ok((await readHealthSnapshot(broken.database))?.schedulerRanAt);
  assert.equal((await readHealthSnapshot(broken.database))?.takenAt, null);
});

test("a snapshot write that keeps failing turns the icon stale although the heartbeat stays fresh", async () => {
  const { hooks, database } = emptyDatabase();
  const start = Date.now();
  await runCron(database, { SESSION: kvSpy() }, start);
  const good = await readHealthSnapshot(database);
  assert.ok(good?.takenAt, "the first run wrote a snapshot");

  // Three more hourly runs: each stamps the heartbeat, none lands the snapshot.
  hooks.failWhen = /INSERT INTO ops_health_snapshot\s*\(id, overall/;
  for (const hour of [1, 2, 3]) {
    const run = await runCron(database, { SESSION: kvSpy() }, start + hour * 3_600_000);
    assert.ok(run.errors.includes("scheduled-health-snapshot-failed"));
  }
  const now = start + 3 * 3_600_000 + 60_000;
  const snapshot = await readHealthSnapshot(database);
  assert.equal(snapshot?.takenAt, good?.takenAt, "the snapshot is the first run's");
  assert.equal(snapshot?.schedulerRanAt, new Date(start + 3 * 3_600_000).toISOString(), "the heartbeat is fresh");

  // What the header icon (GET /api/admin/health/status) and /admin/status both read.
  const icon = statusIconState(snapshot, now);
  assert.deepEqual(
    { tone: icon.tone, count: icon.count, stale: icon.stale, staleReason: icon.staleReason },
    { tone: "problem", count: 1, stale: true, staleReason: "snapshot" },
  );
  assert.match(icon.label, /status tidak diperbarui/);
});

test("a throwing heartbeat is logged and the run goes on to write the snapshot", async () => {
  const { hooks, database } = emptyDatabase();
  hooks.failWhen = /INSERT INTO ops_health_snapshot \(id, scheduler_ran_at\)/;
  const run = await runCron(database, { SESSION: kvSpy() });
  assert.ok(run.errors.includes("scheduled-heartbeat-failed"));
  assert.ok(run.log);
  assert.ok((await readHealthSnapshot(database))?.takenAt);
});

test("the cron still fires an alert on a stalled outbox, and its only KV writes are alert state", async () => {
  const { sqlite, database } = emptyDatabase();
  await runCron(database, { SESSION: kvSpy() }); // applies the chain
  seedStalledOutbox(sqlite);
  const kv = kvSpy();
  await withFetchSpy(async (calls) => {
    const run = await runCron(database, { SESSION: kv, OPS_ALERT_WEBHOOK_URL: "https://hooks.test/ops" });
    const alerts = run.log.alerts as { id: string; state: string; notification: string }[];
    const capi = alerts.find((alert) => alert.id === "capi-outbox");
    assert.deepEqual({ state: capi?.state, notification: capi?.notification }, { state: "firing", notification: "sent" });
    // Under node the schema check has no `cloudflare:workers` env and fires
    // too; each sent notification is one webhook call.
    assert.equal(calls.length, alerts.filter((alert) => alert.notification === "sent").length);
    assert.ok(calls.every((url) => url === "https://hooks.test/ops"));
  });
  assert.ok(kv.puts.length > 0);
  assert.ok(kv.puts.every((key) => /alert/i.test(key)), `non-alert KV write: ${kv.puts.join(", ")}`);
});

test("worker.ts: the snapshot is the last step, inside housekeeping, after the alert evaluation", () => {
  const source = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  const order = [
    'housekeeping("scheduled-heartbeat-failed"',
    "reconcileAutoLarisPaymentStatuses(",
    '"scheduled-capi-drain-failed"',
    '"scheduled-google-ads-reconcile-failed"',
    '"scheduled-google-ads-drain-failed"',
    "runPluginCron(",
    '"scheduled-receiver-score-backfill-failed"',
    "evaluateOperationalAlerts(",
    'housekeeping("scheduled-health-snapshot-failed"',
  ].map((needle) => {
    const at = source.indexOf(needle);
    assert.ok(at >= 0, needle);
    return at;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.doesNotMatch(source, /recordSchedulerRun\(env\.SESSION/);
  const tail = source.slice(source.indexOf('housekeeping("scheduled-health-snapshot-failed"'));
  assert.ok(tail.indexOf("\n}\n") < tail.indexOf("export default"), "nothing runs after the snapshot");
});
