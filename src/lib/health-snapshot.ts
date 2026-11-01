import {
  collectOperationalHealth,
  type HealthState,
  type OperationalHealth,
} from "./operational-health.ts";
import { buildSetupChecklist, readSetupFacts } from "./setup-checklist.ts";

/**
 * The one-row operational status snapshot (PRD A39, migration
 * `*_ops_health_snapshot.sql`).
 *
 * The admin status icon sits on every admin page, so it must not run the
 * eight-signal collection per page view. The hourly run collects health anyway
 * (`src/worker.ts`); it also writes the result here, and the icon reads this
 * one row. An operator's **Periksa ulang** writes it too, through
 * `refreshHealthSnapshot`, which never evaluates or sends alerts (REQ-223).
 *
 * A snapshot that stops changing would read healthy forever, so its age is a
 * state of its own: older than `SNAPSHOT_STALE_MINUTES` is a problem,
 * whatever the stored signals say (REQ-222). Both clocks count
 * (`staleReason`): the last *scheduled* run (`scheduler_ran_at`), so a manual
 * check that refreshes `taken_at` cannot hide a dead cron, and the last write
 * (`taken_at`), so a run that stamps its heartbeat but never lands the
 * snapshot cannot keep old signals reading current.
 */

/** Two hours: the hourly run has missed at least one slot. */
export const SNAPSHOT_STALE_MINUTES = 120;
/** A check younger than this is returned as is: the whole rate limit. */
export const CHECK_REUSE_MS = 15_000;

export type HealthSnapshot = {
  overall: HealthState | null;
  degradedCount: number;
  health: OperationalHealth | null;
  /** Null when the setup facts could not be read: unknown, never zero. */
  setupRequiredLeft: number | null;
  takenAt: string | null;
  schedulerRanAt: string | null;
};

export type StatusIconTone = "problem" | "setup" | "healthy" | "unknown";

export type StatusIconState = {
  tone: StatusIconTone;
  /** Problems or required setup steps; 0 for healthy and unknown. */
  count: number;
  /** The accessible name, in words: colour is never the only cue. */
  label: string;
  stale: boolean;
  /** Which clock made it stale (`staleReason`); absent when not stale. */
  staleReason?: "scheduler" | "snapshot";
  takenAt: string | null;
};

type SnapshotRow = {
  overall: string | null;
  degraded_count: number | null;
  health_json: string | null;
  setup_required_left: number | null;
  taken_at: string | null;
  scheduler_ran_at: string | null;
};

function parseHealth(raw: string | null): OperationalHealth | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OperationalHealth;
    return parsed && Array.isArray(parsed.signals) ? parsed : null;
  } catch {
    return null;
  }
}

function isHealthState(value: unknown): value is HealthState {
  return value === "healthy" || value === "degraded" || value === "unknown";
}

/** Null when there is no row yet or it cannot be read: both read as "not known". */
export async function readHealthSnapshot(database: D1Database): Promise<HealthSnapshot | null> {
  try {
    const row = await database
      .prepare(
        `SELECT overall, degraded_count, health_json, setup_required_left, taken_at, scheduler_ran_at
           FROM ops_health_snapshot WHERE id = 1`,
      )
      .first<SnapshotRow>();
    if (!row) return null;
    return {
      overall: isHealthState(row.overall) ? row.overall : null,
      degradedCount: Number(row.degraded_count) || 0,
      health: parseHealth(row.health_json),
      setupRequiredLeft:
        row.setup_required_left === null || row.setup_required_left === undefined
          ? null
          : Number(row.setup_required_left),
      takenAt: row.taken_at ?? null,
      schedulerRanAt: row.scheduler_ran_at ?? null,
    };
  } catch (error) {
    console.error("health-snapshot-unreadable", error);
    return null;
  }
}

/**
 * Upsert the snapshot. Leaves `scheduler_ran_at` alone: that is the scheduler's
 * own heartbeat (`recordSchedulerRun`), and an operator's check is not a run.
 * Throws on a D1 error; the scheduled caller isolates it in `housekeeping()`.
 */
export async function writeHealthSnapshot(
  database: D1Database,
  health: OperationalHealth,
  setupRequiredLeft: number | null,
): Promise<void> {
  const degradedCount = health.signals.filter((signal) => signal.state === "degraded").length;
  await database
    .prepare(
      `INSERT INTO ops_health_snapshot
         (id, overall, degraded_count, health_json, setup_required_left, taken_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         overall = excluded.overall,
         degraded_count = excluded.degraded_count,
         health_json = excluded.health_json,
         setup_required_left = excluded.setup_required_left,
         taken_at = excluded.taken_at`,
    )
    .bind(
      health.overall,
      degradedCount,
      JSON.stringify(health),
      setupRequiredLeft,
      health.checkedAt,
    )
    .run();
}

/** Required setup steps still open, or null when the facts are unreadable. */
export async function readSetupRequiredLeft(
  database: D1Database,
  locals: App.Locals,
): Promise<number | null> {
  const facts = await readSetupFacts(database, locals);
  return facts
    ? buildSetupChecklist(facts).filter((step) => step.required && !step.done).length
    : null;
}

export function snapshotAgeMinutes(takenAt: string | null, now: number): number | null {
  if (!takenAt) return null;
  const parsed = Date.parse(takenAt);
  return Number.isNaN(parsed) ? null : Math.max(0, Math.floor((now - parsed) / 60_000));
}

/**
 * Why a snapshot is stale, or null when it is not. Two clocks, either one
 * older than `SNAPSHOT_STALE_MINUTES` is enough:
 *
 * - `scheduler`: the last scheduled run (`scheduler_ran_at`). A manual check
 *   refreshes `taken_at` only, so it can never hide a stopped cron. A row the
 *   scheduler has never stamped (a fresh install checked by hand) falls back
 *   to the snapshot's own time.
 * - `snapshot`: the last write (`taken_at`). The run stamps the heartbeat
 *   first and writes the snapshot last, so a write that keeps failing, or a
 *   run that dies in between, leaves a fresh heartbeat beside an old snapshot.
 *   Judged by the heartbeat alone, those old signals would read current.
 */
export function staleReason(
  snapshot: HealthSnapshot | null,
  now: number,
): "scheduler" | "snapshot" | null {
  const over = (at: string | null) => {
    const age = snapshotAgeMinutes(at, now);
    return age !== null && age > SNAPSHOT_STALE_MINUTES;
  };
  if (over(snapshot?.schedulerRanAt ?? snapshot?.takenAt ?? null)) return "scheduler";
  if (over(snapshot?.takenAt ?? null)) return "snapshot";
  return null;
}

/**
 * REQ-217 precedence, one place: a degraded signal or a stalled check (red,
 * with a count) beats required setup left (amber) beats every signal healthy
 * (green) beats nothing known (neutral). "Belum ada data" alone is never red,
 * and a mix of healthy and unknown is neutral, not green.
 */
export function statusIconState(snapshot: HealthSnapshot | null, now: number): StatusIconState {
  const takenAt = snapshot?.takenAt ?? null;
  if (!snapshot || !takenAt || !snapshot.overall) {
    return {
      tone: "unknown",
      count: 0,
      label: "Status operasional belum diperiksa",
      stale: false,
      takenAt,
    };
  }
  const reason = staleReason(snapshot, now);
  if (reason) {
    return {
      tone: "problem",
      count: 1,
      label:
        reason === "scheduler"
          ? "1 masalah operasional: pemeliharaan berhenti, terakhir berjalan lebih dari 2 jam lalu"
          : "1 masalah operasional: status tidak diperbarui lebih dari 2 jam",
      stale: true,
      staleReason: reason,
      takenAt,
    };
  }
  if (snapshot.degradedCount > 0) {
    return {
      tone: "problem",
      count: snapshot.degradedCount,
      label: `${snapshot.degradedCount} masalah operasional`,
      stale: false,
      takenAt,
    };
  }
  if ((snapshot.setupRequiredLeft ?? 0) > 0) {
    return {
      tone: "setup",
      count: snapshot.setupRequiredLeft ?? 0,
      label: `${snapshot.setupRequiredLeft} langkah setup wajib belum selesai`,
      stale: false,
      takenAt,
    };
  }
  if (snapshot.overall === "healthy") {
    return { tone: "healthy", count: 0, label: "Status operasional sehat", stale: false, takenAt };
  }
  return {
    tone: "unknown",
    count: 0,
    label: "Status operasional: sebagian sinyal belum ada data",
    stale: false,
    takenAt,
  };
}

/**
 * Live check for `POST /api/admin/health/check`: collect, write, return. A
 * snapshot younger than `CHECK_REUSE_MS` is returned as is. Evaluates no alert
 * and writes no alert state; the hourly run is the only place that does.
 */
export async function refreshHealthSnapshot(
  database: D1Database,
  locals: App.Locals,
  now: number = Date.now(),
  collect: typeof collectOperationalHealth = collectOperationalHealth,
): Promise<{ snapshot: HealthSnapshot; reused: boolean }> {
  const current = await readHealthSnapshot(database);
  if (current?.takenAt && current.health) {
    const age = now - Date.parse(current.takenAt);
    if (age >= 0 && age < CHECK_REUSE_MS) return { snapshot: current, reused: true };
  }
  const [health, setupRequiredLeft] = await Promise.all([
    collect(database, locals),
    readSetupRequiredLeft(database, locals),
  ]);
  await writeHealthSnapshot(database, health, setupRequiredLeft);
  return {
    snapshot: {
      overall: health.overall,
      degradedCount: health.signals.filter((signal) => signal.state === "degraded").length,
      health,
      setupRequiredLeft,
      takenAt: health.checkedAt,
      schedulerRanAt: current?.schedulerRanAt ?? null,
    },
    reused: false,
  };
}
