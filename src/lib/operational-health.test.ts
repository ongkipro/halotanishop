import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  classifyAutoLaris,
  classifyCapiDelivery,
  classifyCapiOutbox,
  classifyMengantar,
  classifyReceiverScore,
  summarizeHealth,
  type HealthSignal,
  classifyAlerting,
  classifyScheduler,
  classifyGoogleAdsOutbox,
} from "./operational-health.ts";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

test("an empty outbox owes Meta nothing", () => {
  const health = classifyCapiOutbox(
    { pending: 0, failed: 0, overdue: 0, oldestCreatedAt: null },
    NOW,
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.reason, "empty");
});

test("a backlog still inside its backoff is draining, not stalled", () => {
  const health = classifyCapiOutbox(
    { pending: 3, failed: 0, overdue: 0, oldestCreatedAt: minutesAgo(5) },
    NOW,
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.reason, "draining");
  assert.equal(health.ageMinutes, 5);
});

test("events past every retry window and still due mean the drain stopped", () => {
  const health = classifyCapiOutbox(
    { pending: 12, failed: 0, overdue: 12, oldestCreatedAt: minutesAgo(180) },
    NOW,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.reason, "stalled");
  assert.equal(health.metrics.overdue, 12);
});

test("an old backlog that is not yet due is not called stalled", () => {
  // Age alone must not raise the alarm: a rate-limited event legitimately waits.
  const health = classifyCapiOutbox(
    { pending: 4, failed: 0, overdue: 0, oldestCreatedAt: minutesAgo(600) },
    NOW,
  );
  assert.equal(health.state, "healthy");
});

test("terminally failed conversions are degraded even when nothing is pending", () => {
  const health = classifyCapiOutbox(
    { pending: 0, failed: 2, overdue: 0, oldestCreatedAt: minutesAgo(90) },
    NOW,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.reason, "terminal-failures");
});

test("an unreadable outbox is unknown, never a depth of zero", () => {
  const health = classifyCapiOutbox(null, NOW);
  assert.equal(health.state, "unknown");
  assert.equal(health.reason, "unreadable");
  assert.deepEqual(health.metrics, {});
});

test("a pipeline nobody has used is unknown, not degraded", () => {
  const health = classifyCapiDelivery(
    { rowsScanned: 0, lastDeliveredAt: null, lastFailedAt: null },
    NOW,
  );
  assert.equal(health.state, "unknown");
  assert.equal(health.reason, "never-enqueued");
});

test("events that only ever failed are degraded", () => {
  const health = classifyCapiDelivery(
    { rowsScanned: 6, lastDeliveredAt: null, lastFailedAt: minutesAgo(20) },
    NOW,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.reason, "never-delivered");
});

test("a failure newer than the last delivery flips CAPI to degraded", () => {
  const health = classifyCapiDelivery(
    {
      rowsScanned: 40,
      lastDeliveredAt: minutesAgo(120),
      lastFailedAt: minutesAgo(5),
    },
    NOW,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.reason, "failing");
  assert.equal(health.ageMinutes, 120, "still reports the last real delivery");
});

test("a delivery newer than the last failure is healthy", () => {
  const health = classifyCapiDelivery(
    {
      rowsScanned: 40,
      lastDeliveredAt: minutesAgo(2),
      lastFailedAt: minutesAgo(300),
    },
    NOW,
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.reason, "delivered");
});

test("a store with no orders cannot say anything about Mengantar", () => {
  const health = classifyMengantar(
    { rowsScanned: 0, lastDispatchedAt: null, failedInWindow: 0 },
    NOW,
  );
  assert.equal(health.state, "unknown");
  assert.equal(health.reason, "no-orders");
});

test("orders nobody has released yet are unknown, not a courier outage", () => {
  const health = classifyMengantar(
    { rowsScanned: 30, lastDispatchedAt: null, failedInWindow: 0 },
    NOW,
  );
  assert.equal(health.state, "unknown");
  assert.equal(health.reason, "never-dispatched");
});

test("recorded dispatch attempts with no success at all are degraded", () => {
  const health = classifyMengantar(
    { rowsScanned: 30, lastDispatchedAt: null, failedInWindow: 7 },
    NOW,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.reason, "all-attempts-failed");
  assert.equal(health.metrics.failedInWindow, 7);
});

test("an accepted dispatch is healthy and reports its age", () => {
  const health = classifyMengantar(
    { rowsScanned: 30, lastDispatchedAt: minutesAgo(45), failedInWindow: 2 },
    NOW,
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.ageMinutes, 45);
});

test("a store that has never taken a gateway payment is unknown", () => {
  const health = classifyAutoLaris(
    {
      rowsScanned: 0,
      lastOutboundAt: null,
      lastPaidAt: null,
      failedInWindow: 0,
    },
    NOW,
  );
  assert.equal(health.state, "unknown");
  assert.equal(health.reason, "never-used");
});

test("payments created but not yet paid is nobody paid today, not an outage", () => {
  const health = classifyAutoLaris(
    {
      rowsScanned: 9,
      lastOutboundAt: minutesAgo(10),
      lastPaidAt: null,
      failedInWindow: 0,
    },
    NOW,
  );
  // The test's own title says it: this is not an outage. The provider has
  // accepted requests, so there is data; "unknown" rendered as "Belum ada
  // data" beside a column of real transactions. Healthy, awaiting an operator
  // step the reason already names.
  assert.equal(health.state, "healthy");
  assert.equal(health.reason, "awaiting-first-payment");
  assert.equal(health.ageMinutes, 10, "outbound contact is still reported");
});

test("create-payment calls that all failed are degraded", () => {
  const health = classifyAutoLaris(
    {
      rowsScanned: 9,
      lastOutboundAt: null,
      lastPaidAt: null,
      failedInWindow: 9,
    },
    NOW,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.reason, "create-failing");
});

test("an audited manual confirmation reports the last verified payment", () => {
  const health = classifyAutoLaris(
    {
      rowsScanned: 9,
      lastOutboundAt: minutesAgo(90),
      lastPaidAt: minutesAgo(3),
      failedInWindow: 1,
    },
    NOW,
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.reason, "payment-confirmed");
  assert.equal(health.ageMinutes, 3);
});

test("a fault is louder than a blank when the panel is summarised", () => {
  const of = (state: HealthSignal["state"]): HealthSignal => ({
    id: "meta-capi",
    state,
    reason: "test",
    lastAt: null,
    ageMinutes: null,
    metrics: {},
  });
  assert.equal(summarizeHealth([of("healthy"), of("healthy")]), "healthy");
  assert.equal(summarizeHealth([of("healthy"), of("unknown")]), "unknown");
  assert.equal(
    summarizeHealth([of("unknown"), of("degraded"), of("healthy")]),
    "degraded",
  );
});

// On a sibling install a Meta outage turned `capi-outbox` degraded within the
// hour and ran two days before anyone opened the panel. Two things made that
// possible: the queue's own signal reported only half of what was wrong, and
// nothing could tell the operator at all.

test("a queue that is both stalled and holding terminal failures reports both", () => {
  const now = Date.parse("2026-09-08T04:00:00.000Z");
  const signal = classifyCapiOutbox(
    { pending: 24, failed: 116, overdue: 24, oldestCreatedAt: "2026-09-05T12:31:09.595Z" },
    now,
  );
  assert.equal(signal.state, "degraded");
  assert.equal(signal.reason, "stalled-with-terminal-failures");
});

test("terminal failures alone still read as terminal failures", () => {
  const now = Date.parse("2026-09-08T04:00:00.000Z");
  const signal = classifyCapiOutbox(
    { pending: 0, failed: 3, overdue: 0, oldestCreatedAt: "2026-09-08T03:55:00.000Z" },
    now,
  );
  assert.equal(signal.reason, "terminal-failures");
});

test("an unwired alert channel is reported, in amber rather than red", () => {
  const signal = classifyAlerting(false, Date.now());
  assert.equal(signal.id, "alerting");
  assert.equal(signal.reason, "not-configured");
  // Deliberately not `degraded`. A store may choose to run without webhooks,
  // and this module's own rule is that colouring a deliberate choice red
  // produces an alarm nobody trusts.
  assert.equal(signal.state, "unknown");
});

test("a wired alert channel reads healthy", () => {
  const signal = classifyAlerting(true, Date.now());
  assert.equal(signal.state, "healthy");
  assert.equal(signal.reason, "configured");
});

test("the panel explains both new states", () => {
  const source = readFileSync(new URL("./health-actions.ts", import.meta.url), "utf8");
  assert.match(source, /alerting: "Saluran peringatan"/);
  assert.match(source, /OPS_ALERT_WEBHOOK_URL belum diatur/);
  assert.match(source, /"stalled-with-terminal-failures":/);
});

// The Google outbox shipped with no health signal at all, and that absence had
// a cost: a head-of-line block in reconciliation stopped discovery entirely and
// nothing reported it (UNIMPLEMENTED_SPECS.md, task A-227).

test("the Google Ads outbox reports the same states as the Meta one", () => {
  const now = Date.parse("2026-09-09T04:00:00.000Z");
  assert.equal(
    classifyGoogleAdsOutbox({ pending: 0, failed: 0, overdue: 0, oldestCreatedAt: null }, now).reason,
    "empty",
  );
  assert.equal(
    classifyGoogleAdsOutbox(
      { pending: 3, failed: 0, overdue: 0, oldestCreatedAt: "2026-09-09T03:55:00.000Z" },
      now,
    ).state,
    "healthy",
    "a backlog inside its backoff is draining, not stalled",
  );
  const stalled = classifyGoogleAdsOutbox(
    { pending: 3, failed: 0, overdue: 3, oldestCreatedAt: "2026-09-08T00:00:00.000Z" },
    now,
  );
  assert.equal(stalled.reason, "stalled");
  const both = classifyGoogleAdsOutbox(
    { pending: 3, failed: 9, overdue: 3, oldestCreatedAt: "2026-09-08T00:00:00.000Z" },
    now,
  );
  assert.equal(both.reason, "stalled-with-terminal-failures");
  assert.deepEqual(both.metrics, { pending: 3, failed: 9, overdue: 3 });
});

test("an unreadable Google outbox is unknown, never a depth of zero", () => {
  const signal = classifyGoogleAdsOutbox(null, Date.now());
  assert.equal(signal.state, "unknown");
  assert.equal(signal.reason, "unreadable");
});

test("the panel names the Google outbox and reads its counters", () => {
  assert.match(
    readFileSync(new URL("./health-actions.ts", import.meta.url), "utf8"),
    /"google-ads-outbox": "Antrean Google Ads offline"/,
  );
  const source = readFileSync(
    new URL("../components/admin/OperationalStatus.tsx", import.meta.url),
    "utf8",
  );
  // Both queues share one vocabulary rather than the second needing its own.
  assert.match(source, /signal\.id === "capi-outbox" \|\| signal\.id === "google-ads-outbox"/);
});

test("a failure older than the alert window no longer holds the alert open (A-283)", () => {
  // Failed rows are kept 30 days. Counting every one kept the queue degraded
  // for a month, so the next outage carried the same reason and was
  // deduplicated into silence.
  const old = classifyCapiOutbox(
    { pending: 0, failed: 3, recentFailed: 0, overdue: 0, oldestCreatedAt: minutesAgo(60 * 48) },
    NOW,
  );
  assert.equal(old.state, "healthy");
  assert.equal(old.reason, "earlier-failures");
  assert.equal(old.metrics.failed, 3, "still visible on the panel");

  const fresh = classifyCapiOutbox(
    { pending: 0, failed: 4, recentFailed: 1, overdue: 0, oldestCreatedAt: minutesAgo(60 * 48) },
    NOW,
  );
  assert.equal(fresh.state, "degraded");
  assert.equal(fresh.reason, "terminal-failures");

  assert.equal(
    classifyGoogleAdsOutbox({ pending: 0, failed: 2, recentFailed: 0, overdue: 0, oldestCreatedAt: minutesAgo(60 * 30) }, NOW).state,
    "healthy",
  );
});

const RECEIVER_NOW = Date.parse("2026-10-15T12:00:00.000Z");

test("receiver lookups refused after the last score are degraded: the account lost its whitelist", () => {
  const health = classifyReceiverScore(
    {
      rowsScanned: 200,
      lastScoredAt: "2026-10-06T10:00:00.000Z",
      lastRefusedAt: "2026-10-15T11:00:00.000Z",
      refusedInWindow: 150,
    },
    RECEIVER_NOW,
  );
  assert.equal(health.state, "degraded");
  assert.equal(health.reason, "not-whitelisted");
  assert.equal(health.metrics.refusedInWindow, 150);
});

test("a score newer than the last refusal is healthy again", () => {
  const health = classifyReceiverScore(
    {
      rowsScanned: 200,
      lastScoredAt: "2026-10-15T11:30:00.000Z",
      lastRefusedAt: "2026-10-15T11:00:00.000Z",
      refusedInWindow: 150,
    },
    RECEIVER_NOW,
  );
  assert.equal(health.state, "healthy");
  assert.equal(health.ageMinutes, 30);
});

test("orders that were never scored nor refused say nothing about Mengantar access", () => {
  const health = classifyReceiverScore(
    { rowsScanned: 3, lastScoredAt: null, lastRefusedAt: null, refusedInWindow: 0 },
    RECEIVER_NOW,
  );
  assert.equal(health.state, "unknown");
  assert.equal(health.reason, "never-scored");
  assert.equal(classifyReceiverScore(null, RECEIVER_NOW).reason, "unreadable");
});

test("the scheduler signal reads the hourly stamp: missing is unknown, stopped is degraded", () => {
  const now = Date.parse("2026-10-20T03:00:00.000Z");
  assert.equal(classifyScheduler(undefined, now).reason, "unreadable");
  assert.deepEqual(
    { state: classifyScheduler(null, now).state, reason: classifyScheduler(null, now).reason },
    { state: "unknown", reason: "scheduler-never-ran" },
  );
  assert.equal(classifyScheduler("2026-10-20T02:07:00.000Z", now).state, "healthy");
  const stalled = classifyScheduler("2026-10-20T00:07:00.000Z", now);
  assert.deepEqual({ state: stalled.state, reason: stalled.reason, age: stalled.ageMinutes }, { state: "degraded", reason: "scheduler-stalled", age: 173 });

  // The stamp itself is a D1 column now (A-379); health-snapshot.test.ts
  // covers the write and the read.
});
