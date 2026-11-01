-- Kecamatan → Mengantar area, kept in D1 (PRD A43, REQ-243). A row answers
-- for MENGANTAR_AREA_MAX_AGE_DAYS from resolved_at, then is resolved again.
-- Replaces the 24-hour KV entry `/api/locations?level=resolve` used to write.
-- Only src/lib/mengantar-areas.ts reads or writes this table.
--
-- area_key is district|city|province, each part trimmed and lower-cased, the
-- same normalisation as buildMengantarAreaKey in src/lib/mengantar-areas.ts.
-- payload is the exact resolve body for source 'resolve' rows, replayed byte
-- for byte; NULL for seeded rows, whose answer is composed from area_id and
-- postal_code. agreeing_orders / total_orders are the seed's agreement count
-- (orders on the chosen id / orders for the district), NULL for live rows.
CREATE TABLE `mengantar_areas` (
  `area_key` text PRIMARY KEY NOT NULL,
  `area_id` text NOT NULL CHECK (length(`area_id`) > 0),
  `label` text NOT NULL,
  `postal_code` text DEFAULT '' NOT NULL,
  `payload` text,
  `source` text NOT NULL CHECK (`source` IN ('order-history', 'resolve')),
  `agreeing_orders` integer,
  `total_orders` integer,
  `resolved_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `mengantar_areas_area_id_idx` ON `mengantar_areas` (`area_id`);--> statement-breakpoint
-- Seed from the store's own orders: every district it has shipped to is
-- resolved on day one with no Mengantar call. Per district the most frequent
-- destination_area_id wins (ties: the id on the most recent order), with the
-- most frequent postal code among the orders on that id.
--
-- Orders from the order editor's kelurahan precision mode cannot be told
-- apart: no column or event records how an order's area was chosen (the
-- editor's precision toggle has been fixed off since the first commit, and an
-- operator's district edit leaves no marker). So every order with an area id
-- counts, abandoned leads included, and agreeing_orders / total_orders shows
-- how settled each district was.
--
-- Nor can an order tell an exact district match from a fallback (Mengantar
-- did not know the catalogue district, the form took items[0], e.g.
-- Jakabaring → Seberang Ulu I, 8 Ulu), which the live resolve refuses to
-- store. So a seeded row is not dated today: resolved_at is the newest order
-- on the chosen id — the last time a live resolve gave a buyer that answer.
-- A district not ordered within MENGANTAR_AREA_MAX_AGE_DAYS starts stale and
-- is resolved again on first use; a recent one answers until that bound runs
-- out from its last order. Either way the re-resolve stores an exact answer
-- or deletes the row (resolveMengantarArea), so a seeded fallback ends where
-- the live path does: not stored. A created_at strftime cannot parse dates
-- the row to the epoch, i.e. stale.
INSERT INTO `mengantar_areas`
  (`area_key`, `area_id`, `label`, `postal_code`, `payload`, `source`, `agreeing_orders`, `total_orders`, `resolved_at`)
WITH tagged AS (
  SELECT
    `id`,
    lower(trim(`district`)) || '|' || lower(trim(`city`)) || '|' || lower(trim(`province`)) AS area_key,
    trim(`destination_area_id`) AS area_id,
    trim(`district`) || ', ' || trim(`city`) || ', ' || trim(`province`) AS label,
    trim(COALESCE(`postal_code`, '')) AS postal_code,
    strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`) AS ordered_at
  FROM `orders`
  WHERE trim(COALESCE(`destination_area_id`, '')) <> ''
    AND trim(COALESCE(`district`, '')) <> ''
    AND trim(COALESCE(`city`, '')) <> ''
    AND trim(COALESCE(`province`, '')) <> ''
),
pairs AS (
  SELECT
    area_key,
    area_id,
    COUNT(*) AS agreeing_orders,
    MAX(`id`) AS last_order_id,
    MAX(ordered_at) AS last_ordered_at,
    SUM(COUNT(*)) OVER (PARTITION BY area_key) AS total_orders,
    ROW_NUMBER() OVER (PARTITION BY area_key ORDER BY COUNT(*) DESC, MAX(`id`) DESC) AS pick
  FROM tagged
  GROUP BY area_key, area_id
),
postal AS (
  SELECT
    area_key,
    area_id,
    postal_code,
    ROW_NUMBER() OVER (PARTITION BY area_key, area_id ORDER BY COUNT(*) DESC, MAX(`id`) DESC) AS pick
  FROM tagged
  WHERE postal_code <> ''
  GROUP BY area_key, area_id, postal_code
)
SELECT
  pairs.area_key,
  pairs.area_id,
  tagged.label,
  COALESCE(postal.postal_code, ''),
  NULL,
  'order-history',
  pairs.agreeing_orders,
  pairs.total_orders,
  COALESCE(min(pairs.last_ordered_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), '1970-01-01T00:00:00.000Z')
FROM pairs
JOIN tagged ON tagged.`id` = pairs.last_order_id
LEFT JOIN postal ON postal.area_key = pairs.area_key AND postal.area_id = pairs.area_id AND postal.pick = 1
WHERE pairs.pick = 1;
