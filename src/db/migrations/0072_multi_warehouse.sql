-- Several warehouses, each quote from the one nearest the buyer (PRD A42,
-- REQ-237, REQ-239, REQ-248). Only src/lib/warehouses.ts writes these columns;
-- src/lib/warehouse-choice.ts reads them to pick the quote's origin.
--
-- is_primary: exactly one row may be 1 (the partial unique index below). It is
-- the warehouse a quote falls back to, and the only one a store with a single
-- warehouse ever uses.
-- is_active: an inactive warehouse is never chosen for a new quote. An order
-- already tied to it keeps it for dispatch and pickup.
-- served_provinces: JSON array of two-letter province codes (src/lib/province.ts).
-- NULL means "its own province", read from the row's `province` text.
ALTER TABLE `warehouses` ADD `is_primary` integer DEFAULT 0 NOT NULL CHECK (`is_primary` IN (0, 1));--> statement-breakpoint
ALTER TABLE `warehouses` ADD `is_active` integer DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1));--> statement-breakpoint
ALTER TABLE `warehouses` ADD `served_provinces` text;--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_one_primary` ON `warehouses` (`is_primary`) WHERE `is_primary` = 1;--> statement-breakpoint
-- The warehouse every quote used until now (`ORDER BY id LIMIT 1`) becomes the
-- primary, so an upgrading store quotes from the same origin as before.
UPDATE `warehouses` SET `is_primary` = 1 WHERE `id` = (SELECT MIN(`id`) FROM `warehouses`);
