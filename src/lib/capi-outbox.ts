import { sendMetaCapiEvent, type MetaCustomData, type MetaUserData } from "./meta-capi.ts";

/**
 * Transactional outbox for Meta CAPI.
 *
 * A conversion event is recorded in D1 *before* it is transmitted, so a network
 * blip, a Meta 429, or an expired token cannot silently discard revenue signal.
 * Failed events retry with exponential backoff, drained opportunistically by
 * later storefront traffic and, since 1.4.0, by the hourly cron in
 * `src/worker.ts` (`drainCapiOutboxBacklog`), so a store with no visitors
 * still retries. No queue binding: Queues need the Workers Paid plan.
 */

export type OutboxEvent = {
  eventName: string;
  eventId: string;
  eventSourceUrl: string;
  userData: MetaUserData;
  customData: MetaCustomData;
  /** Unix seconds, stamped at enqueue so every retry reports when it happened. */
  eventTime?: number;
};

type OutboxRow = {
  id: number;
  event_id: string;
  event_name: string;
  payload: string;
  attempts: number;
  max_attempts: number;
};

/** Meta error codes: 4/17/613 are rate limits, 190 means the token is dead. */
const RATE_LIMIT_CODES = new Set([4, 17, 613]);
const INVALID_TOKEN_CODE = 190;
const MAX_DRAIN_BATCH = 10;

export type RetryDecision = {
  status: "sent" | "pending" | "failed";
  delayMs: number;
};

/**
 * Pure so the backoff ladder is testable without a database or a live Meta.
 * Rate limits wait a flat 15 minutes; everything else doubles from two minutes
 * and caps at an hour. A dead token is terminal — retrying only burns quota.
 */
export function decideRetry(
  outcome: { success: boolean; errorCode?: number },
  attempts: number,
  maxAttempts: number,
): RetryDecision {
  if (outcome.success) return { status: "sent", delayMs: 0 };

  const nextAttempt = attempts + 1;
  if (outcome.errorCode === INVALID_TOKEN_CODE || nextAttempt >= maxAttempts) {
    return { status: "failed", delayMs: 0 };
  }
  const delayMs = RATE_LIMIT_CODES.has(outcome.errorCode ?? -1)
    ? 15 * 60_000
    : Math.min(2 ** nextAttempt, 60) * 60_000;
  return { status: "pending", delayMs };
}

function readErrorCode(response: unknown): number | undefined {
  const error = (response as { error?: { code?: unknown } } | null)?.error;
  return typeof error?.code === "number" ? error.code : undefined;
}

/**
 * Records the event as pending. Returns false when `eventId` is already known,
 * which makes a replayed browser request a no-op instead of a duplicate
 * conversion — the same guarantee `event_id` gives inside Meta, one layer up.
 */
export async function enqueueCapiEvent(
  database: D1Database,
  event: OutboxEvent,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `INSERT OR IGNORE INTO capi_event_outbox
         (event_id, event_name, payload, status, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      event.eventId,
      event.eventName,
      JSON.stringify({ ...event, eventTime: event.eventTime ?? Math.floor(Date.now() / 1000) }),
      now,
      now,
      now,
    )
    .run();
  return Boolean(result.meta?.changes);
}

async function transmit(
  database: D1Database,
  row: OutboxRow,
  pixelId: string,
  accessToken: string,
) {
  let event: OutboxEvent;
  try {
    event = JSON.parse(row.payload) as OutboxEvent;
  } catch {
    // Unparseable payloads can never succeed; retrying them is pure waste.
    await database
      .prepare(
        `UPDATE capi_event_outbox
         SET status = 'failed', last_error = 'payload tidak dapat dibaca', updated_at = ?
         WHERE id = ?`,
      )
      .bind(new Date().toISOString(), row.id)
      .run();
    return false;
  }

  const result = await sendMetaCapiEvent(
    event.eventName,
    event.eventId,
    event.eventSourceUrl,
    event.userData,
    event.customData,
    pixelId,
    accessToken,
    undefined,
    event.eventTime,
  );

  const decision = decideRetry(
    { success: result.success, errorCode: readErrorCode(result.response) },
    row.attempts,
    row.max_attempts,
  );
  const now = Date.now();

  await database
    .prepare(
      `UPDATE capi_event_outbox
       SET status = ?, attempts = attempts + ?, last_error = ?, next_retry_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      decision.status,
      decision.status === "sent" ? 0 : 1,
      decision.status === "sent" ? null : (result.reason ?? "unknown"),
      new Date(now + decision.delayMs).toISOString(),
      new Date(now).toISOString(),
      row.id,
    )
    .run();

  return decision.status === "sent";
}

/**
 * Longest delay `decideRetry` can ever schedule. A `pending` event whose
 * `next_retry_at` has passed by more than this is not merely waiting its turn —
 * nothing is draining it.
 */
export const CAPI_MAX_BACKOFF_MS = 60 * 60_000;

/** Rows inspected by the bounded delivery-window read below. */
export const CAPI_DELIVERY_WINDOW = 200;

export type CapiOutboxDepth = {
  /** Enqueued, not yet delivered, still inside its retry budget. */
  pending: number;
  /** Terminally undeliverable — a dead token or an exhausted attempt budget. */
  failed: number;
  /**
   * Subset of `failed` that failed inside `OUTBOX_FAILURE_ALERT_WINDOW_MS`.
   * Only these raise the alert: failed rows are kept 30 days, so counting all
   * of them held the alert firing for a month and deduplicated the next
   * outage into silence. Optional so older callers keep their behaviour.
   */
  recentFailed?: number;
  /** Subset of `pending` whose `next_retry_at` is already in the past. */
  overdue: number;
  /** `created_at` of the oldest undelivered row, or null when there are none. */
  oldestCreatedAt: string | null;
};

export type CapiDeliveryWindow = {
  rowsScanned: number;
  lastDeliveredAt: string | null;
  lastFailedAt: string | null;
};

/** How recent a terminal failure must be to keep an outbox alert firing. */
export const OUTBOX_FAILURE_ALERT_WINDOW_MS = 24 * 60 * 60_000;

type DepthRow = {
  pending: number | null;
  failed: number | null;
  recent_failed: number | null;
  overdue: number | null;
  oldest_created_at: string | null;
};

const count = (value: number | null | undefined) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

/**
 * How much conversion signal is owed to Meta right now.
 *
 * One statement. `status IN ('pending','failed')` is served by
 * `capi_event_outbox_due_idx (status, next_retry_at)` as two equality probes,
 * so the rows read are the *undelivered* rows only — near zero on a healthy
 * install, and proportional to the backlog exactly when the backlog is the
 * thing being asked about. Delivered rows are never touched.
 *
 * Returns null when the table cannot be read, which the caller must report as
 * "unknown" rather than as a depth of zero.
 */
export async function readCapiOutboxDepth(
  database: D1Database,
): Promise<CapiOutboxDepth | null> {
  try {
    const row = await database
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) AS recent_failed,
           SUM(CASE WHEN status = 'pending' AND next_retry_at <= ? THEN 1 ELSE 0 END) AS overdue,
           MIN(CASE WHEN status IN ('pending', 'failed') THEN created_at END) AS oldest_created_at
         FROM capi_event_outbox
         WHERE status IN ('pending', 'failed')`,
      )
      .bind(new Date(Date.now() - OUTBOX_FAILURE_ALERT_WINDOW_MS).toISOString(), new Date().toISOString())
      .first<DepthRow>();
    return {
      pending: count(row?.pending),
      failed: count(row?.failed),
      recentFailed: count(row?.recent_failed),
      overdue: count(row?.overdue),
      oldestCreatedAt: row?.oldest_created_at ?? null,
    };
  } catch (error) {
    console.error("capi-outbox-depth-unreadable", error);
    return null;
  }
}

/**
 * When Meta last accepted an event, and when one last failed.
 *
 * lazy: bounded reverse-rowid scan of the newest `CAPI_DELIVERY_WINDOW` rows
 * rather than `MAX(updated_at) WHERE status = 'sent'`, which would read every
 * delivered row on every dashboard refresh — nothing indexes `updated_at`,
 * and pruning only runs hourly, so the table can still hold weeks of rows
 * between purges. Ceiling: a delivery older than the last 200
 * events reads as "none recorded", which on a store still sending conversions
 * is itself the answer. Upgrade path: add `(status, updated_at)` in a forward
 * migration and drop the window.
 */
export async function readCapiDeliveryWindow(
  database: D1Database,
): Promise<CapiDeliveryWindow | null> {
  try {
    const row = await database
      .prepare(
        `SELECT
           COUNT(*) AS rows_scanned,
           MAX(CASE WHEN status = 'sent' THEN updated_at END) AS last_delivered_at,
           MAX(CASE WHEN status = 'failed' THEN updated_at END) AS last_failed_at
         FROM (
           SELECT status, updated_at FROM capi_event_outbox ORDER BY id DESC LIMIT ?
         )`,
      )
      .bind(CAPI_DELIVERY_WINDOW)
      .first<{
        rows_scanned: number | null;
        last_delivered_at: string | null;
        last_failed_at: string | null;
      }>();
    return {
      rowsScanned: count(row?.rows_scanned),
      lastDeliveredAt: row?.last_delivered_at ?? null,
      lastFailedAt: row?.last_failed_at ?? null,
    };
  } catch (error) {
    console.error("capi-outbox-delivery-window-unreadable", error);
    return null;
  }
}

/**
 * Sends one already-enqueued event immediately.
 *
 * Claims the row with the same lease `drainCapiOutbox` uses rather than merely
 * reading it: the row was just inserted due now, so a drain running in another
 * request would otherwise select and transmit it too — a double send whose
 * second outcome could overwrite the first and strand the row `pending` with
 * its attempt budget spent.
 *
 * Keyed by name *and* id (migration 0057): a funnel event cannot occupy a
 * Purchase's order-number `event_id` and have the Purchase deduplicated away.
 */
export async function deliverCapiEvent(
  database: D1Database,
  eventName: string,
  eventId: string,
  pixelId: string,
  accessToken: string,
  now = new Date(),
) {
  const row = await database
    .prepare(
      `UPDATE capi_event_outbox
          SET next_retry_at = ?
        WHERE event_name = ? AND event_id = ? AND status = 'pending'
          AND next_retry_at <= ? AND attempts < max_attempts
       RETURNING id, event_id, event_name, payload, attempts, max_attempts`,
    )
    .bind(
      new Date(now.getTime() + CAPI_DRAIN_LEASE_MS).toISOString(),
      eventName,
      eventId,
      now.toISOString(),
    )
    .first<OutboxRow>();
  if (!row) return false;
  return transmit(database, row, pixelId, accessToken);
}

/**
 * Retries events whose backoff has elapsed. Bounded per call so a burst of
 * failures cannot turn one storefront request into a long-running drain.
 */
/**
 * How long a claimed row is hidden from other drains. Long enough to transmit
 * a batch, short enough that a Worker killed mid-drain returns its rows to the
 * queue rather than stranding them.
 */
export const CAPI_DRAIN_LEASE_MS = 5 * 60_000;

/**
 * Rows are **claimed** before they are sent, not merely selected. Every
 * `/api/meta-event` request fires a drain in `waitUntil`, and since 1.4.0 the
 * hourly cron fires one too, so two drains arriving together selected the same
 * due rows and both transmitted them. Live evidence from an install on
 * 2026-09-04: rows carrying `attempts` of 9 against a `max_attempts` of 5,
 * unreachable through any single sequential path. Meta deduplicates on
 * `event_id` so nothing double-counted, but the quota was spent twice over and
 * the attempt budget stopped meaning anything — a row could be terminated in
 * half the retries it was granted.
 *
 * The claim is one `UPDATE … RETURNING` that pushes `next_retry_at` a lease
 * into the future. SQLite serializes writers, so a concurrent drain runs after
 * it, sees the moved timestamps and selects a disjoint set. `transmit` then
 * overwrites `next_retry_at` with the real backoff, so the lease only ever
 * governs rows nobody got to. Purchases go first: they are the rows whose
 * loss costs money.
 */
export async function drainCapiOutbox(
  database: D1Database,
  pixelId: string,
  accessToken: string,
  now = new Date(),
): Promise<number> {
  const due = await database
    .prepare(
      `UPDATE capi_event_outbox
          SET next_retry_at = ?
        WHERE id IN (
          SELECT id FROM capi_event_outbox
           WHERE status = 'pending' AND next_retry_at <= ? AND attempts < max_attempts
           ORDER BY CASE WHEN event_name = 'Purchase' THEN 0 ELSE 1 END, id ASC
           LIMIT ?
        )
       RETURNING id, event_id, event_name, payload, attempts, max_attempts`,
    )
    .bind(
      new Date(now.getTime() + CAPI_DRAIN_LEASE_MS).toISOString(),
      now.toISOString(),
      MAX_DRAIN_BATCH,
    )
    .all<OutboxRow>();

  let sent = 0;
  for (const row of due.results ?? []) {
    if (await transmit(database, row, pixelId, accessToken)) sent += 1;
  }
  return sent;
}

/**
 * Batches the hourly cron may drain in one run. A storefront request drains one
 * batch so it stays short; the cron is the only drain a quiet store gets, and
 * at one batch an hour a requeue the size of 2026-09-03's (107 rows) needs ten
 * hours to land between campaigns. Three batches stay well inside the Free plan's 50
 * subrequests per invocation alongside the cron's other fetches.
 */
export const CAPI_CRON_DRAIN_BATCHES = 3;

/**
 * Drains batch after batch while each one lands in full. A short batch means
 * the backlog is empty; a failed send means Meta is refusing, and pressing on
 * would only spend more rows' attempt budgets against the same refusal.
 */
export async function drainCapiOutboxBacklog(
  database: D1Database,
  pixelId: string,
  accessToken: string,
  now = new Date(),
  maxBatches = CAPI_CRON_DRAIN_BATCHES,
): Promise<number> {
  let sent = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const landed = await drainCapiOutbox(database, pixelId, accessToken, now);
    sent += landed;
    if (landed < MAX_DRAIN_BATCH) break;
  }
  return sent;
}

/**
 * Settled and terminal rows older than the retention window. The outbox is a
 * queue, not an archive: one install carried 3,464 rows on 2026-09-05 with
 * nothing left to send, every one of them scanned by the depth and health
 * queries each hour. Thirty days keeps enough to answer "did this Purchase go
 * out" for any order still inside a dispute window.
 */
const OUTBOX_RETENTION_DAYS = 30;

export async function purgeExpiredCapiOutboxEvents(database: D1Database, now = new Date()) {
  const result = await database
    .prepare(
      `DELETE FROM capi_event_outbox
        WHERE status IN ('sent', 'failed')
          AND unixepoch(updated_at) < unixepoch(?, '-${OUTBOX_RETENTION_DAYS} days')`,
    )
    .bind(now.toISOString())
    .run();
  return result.meta.changes;
}

/**
 * Undelivered rows offered back once the destination is proven live again.
 *
 * `decideRetry` makes a dead token terminal immediately, which is right —
 * retrying a dead token only burns quota — but it also means every event that
 * arrived during an outage is lost the moment the operator fixes the
 * credential. Nothing else in the system ever un-terminates them.
 *
 * The first version of this selected `attempts < max_attempts`, on the
 * reasoning that `decideRetry` terminates for exactly two reasons and the other
 * one increments `attempts`, so that predicate was precisely the dead-token
 * case. It was precise and too narrow. On 2026-09-03 an install started
 * getting "Object with ID … does not exist, cannot be loaded due to missing
 * permissions" on every event: a destination-side misconfiguration, entirely
 * fixable, that let 107 rows exhaust their budget honestly. Those are exactly
 * as recoverable as a token failure and that predicate excluded all of them.
 *
 * So the classification is no longer a guess about *why* a row failed. The
 * caller proves the destination works — `/api/admin/ads` sends a probe event
 * and refuses to requeue at all if Meta rejects it — and every failed row then
 * gets one more go. Meta still deduplicates on `event_id`, so a row that did
 * reach it cannot double-count.
 *
 * Two exclusions remain, and both are absolute:
 *
 * - A payload that cannot be parsed can never succeed; retrying it is waste.
 * - Meta rejects an event whose `event_time` is more than seven days old, and
 *   retries deliberately preserve the original time so a Purchase is still
 *   attributed to when it happened. Without this bound a requeue would take
 *   rows the 30-day retention still holds, send them, have Meta refuse them for
 *   being stale, and re-terminate them — spending the operator's recovery on
 *   events that could never land.
 *
 * Deliberately not automatic: resending conversions has a real advertising
 * consequence, so it stays an explicit operator decision.
 */
export const CAPI_REQUEUE_MAX_AGE_DAYS = 7;

const RECOVERABLE_PREDICATE = `status = 'failed'
   AND COALESCE(last_error, '') <> 'payload tidak dapat dibaca'
   AND unixepoch(created_at) >= unixepoch(?, '-${CAPI_REQUEUE_MAX_AGE_DAYS} days')`;

export async function requeueRecoverableEvents(
  database: D1Database,
  now = new Date(),
  limit = 500,
): Promise<number> {
  const bounded = Math.max(1, Math.min(1000, Math.trunc(limit) || 500));
  const stamp = now.toISOString();
  const result = await database
    .prepare(
      `UPDATE capi_event_outbox
          SET status = 'pending', attempts = 0, last_error = NULL,
              next_retry_at = ?, updated_at = ?
        WHERE id IN (
          SELECT id FROM capi_event_outbox
           WHERE ${RECOVERABLE_PREDICATE}
           ORDER BY CASE WHEN event_name = 'Purchase' THEN 0 ELSE 1 END, id ASC
           LIMIT ?
        )`,
    )
    .bind(stamp, stamp, stamp, bounded)
    .run();
  return Number(result.meta?.changes || 0);
}

/** How many rows `requeueRecoverableEvents` would move right now. */
export async function countRecoverableEvents(
  database: D1Database,
  now = new Date(),
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS recoverable FROM capi_event_outbox
        WHERE ${RECOVERABLE_PREDICATE}`,
    )
    .bind(now.toISOString())
    .first<{ recoverable: number }>();
  return Number(row?.recoverable || 0);
}
