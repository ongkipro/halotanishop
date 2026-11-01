-- The landing page an order or a lead came from, as a short slug (PRD A36,
-- REQ-191 and REQ-193).
--
-- A VIRTUAL generated column: SQLite computes it from `source_page_path` on
-- every read, for rows written before this migration and after it alike. So
-- there is no backfill, and no submit route or order statement changes to
-- fill it. `src/lib/source-slug.ts` mirrors this expression for labels;
-- `source-slug.test.ts` runs both over the same paths.
--
-- The rule: cut the path at the first `?` or `#`; strip trailing `/`; a path
-- of only `/` is the home page (`beranda`); otherwise the last segment,
-- ASCII lower-cased, at most 80 characters. Empty or NULL stays NULL and
-- reads as "(tidak tercatat)".
--
-- `rtrim(p, replace(p, '/', ''))` strips every trailing character that is not
-- a `/`, which leaves the path up to its last `/`; the segment is what follows.
ALTER TABLE `orders` ADD `source_slug` text GENERATED ALWAYS AS (
  CASE
    WHEN `source_page_path` IS NULL THEN NULL
    WHEN substr(`source_page_path`, 1, min(
      CASE WHEN instr(`source_page_path`, '?') > 0 THEN instr(`source_page_path`, '?') ELSE length(`source_page_path`) + 1 END,
      CASE WHEN instr(`source_page_path`, '#') > 0 THEN instr(`source_page_path`, '#') ELSE length(`source_page_path`) + 1 END
    ) - 1) = '' THEN NULL
    WHEN rtrim(substr(`source_page_path`, 1, min(
      CASE WHEN instr(`source_page_path`, '?') > 0 THEN instr(`source_page_path`, '?') ELSE length(`source_page_path`) + 1 END,
      CASE WHEN instr(`source_page_path`, '#') > 0 THEN instr(`source_page_path`, '#') ELSE length(`source_page_path`) + 1 END
    ) - 1), '/') = '' THEN 'beranda'
    ELSE lower(substr(substr(
      rtrim(substr(`source_page_path`, 1, min(
        CASE WHEN instr(`source_page_path`, '?') > 0 THEN instr(`source_page_path`, '?') ELSE length(`source_page_path`) + 1 END,
        CASE WHEN instr(`source_page_path`, '#') > 0 THEN instr(`source_page_path`, '#') ELSE length(`source_page_path`) + 1 END
      ) - 1), '/'),
      length(rtrim(
        rtrim(substr(`source_page_path`, 1, min(
          CASE WHEN instr(`source_page_path`, '?') > 0 THEN instr(`source_page_path`, '?') ELSE length(`source_page_path`) + 1 END,
          CASE WHEN instr(`source_page_path`, '#') > 0 THEN instr(`source_page_path`, '#') ELSE length(`source_page_path`) + 1 END
        ) - 1), '/'),
        replace(rtrim(substr(`source_page_path`, 1, min(
          CASE WHEN instr(`source_page_path`, '?') > 0 THEN instr(`source_page_path`, '?') ELSE length(`source_page_path`) + 1 END,
          CASE WHEN instr(`source_page_path`, '#') > 0 THEN instr(`source_page_path`, '#') ELSE length(`source_page_path`) + 1 END
        ) - 1), '/'), '/', '')
      )) + 1
    ), 1, 80))
  END
) VIRTUAL;--> statement-breakpoint
-- Serves the source filter on the order lists and the per-source ranking
-- (PRD A37), both of which read a `created_at` range within one source.
CREATE INDEX `idx_orders_source_slug_created` ON `orders` (`source_slug`, `created_at`);--> statement-breakpoint
-- D1 recommends it after creating an index (PRD A40 E7).
PRAGMA optimize;
