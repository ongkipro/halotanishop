-- One-row operational status snapshot (PRD A39 REQ-217/222, A40 REQ-228).
-- The hourly run writes it after collecting health; POST /api/admin/health/check
-- writes it on an operator's click. The admin status icon reads this row and
-- never runs the eight-signal collection itself. `scheduler_ran_at` is the
-- scheduler heartbeat that used to be a KV write every hour; it is stamped at
-- the start of each run, apart from the snapshot, so a run whose later steps
-- fail still counts as a run. Two writers only: src/lib/health-snapshot.ts
-- (the snapshot columns) and recordSchedulerRun in
-- src/lib/operational-health.ts (`scheduler_ran_at` alone). The icon's
-- staleness is measured from `scheduler_ran_at`, so a manual check cannot
-- hide a stopped cron.
CREATE TABLE `ops_health_snapshot` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `overall` text CHECK (`overall` IS NULL OR `overall` IN ('healthy', 'degraded', 'unknown')),
  `degraded_count` integer DEFAULT 0 NOT NULL,
  -- The full OperationalHealth payload: signals, checkedAt and build. Counts,
  -- ages and states only; no order or customer content (OBSERVABILITY.md §5).
  `health_json` text,
  -- NULL when the setup facts could not be read: unknown, never "zero left".
  `setup_required_left` integer,
  `taken_at` text,
  `scheduler_ran_at` text
);
