-- Incremental order sync for the operations API (PRD A45, REQ-254):
-- `GET /api/ops/v1/orders?updated_since=` needs one timestamp every write
-- path advances. Orders are written from a dozen places (order-lifecycle.ts,
-- payment-switch.ts, the admin PATCH, Mengantar sync, payment webhooks), so
-- the database keeps it rather than each writer.
--
-- An insert stamps it; an update that did not set it itself is stamped by the
-- AFTER UPDATE trigger. The WHEN clause keeps the trigger's own UPDATE from
-- firing it again (and D1 runs with recursive triggers off). ISO-8601 UTC with
-- milliseconds, the format `Date.prototype.toISOString` writes elsewhere.
ALTER TABLE `orders` ADD COLUMN `updated_at` text;
--> statement-breakpoint
UPDATE `orders` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `orders_updated_at_id` ON `orders` (`updated_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `orders_updated_at_on_insert`
AFTER INSERT ON `orders`
FOR EACH ROW WHEN NEW.`updated_at` IS NULL
BEGIN
  UPDATE `orders` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `orders_updated_at_on_update`
AFTER UPDATE ON `orders`
FOR EACH ROW WHEN NEW.`updated_at` IS OLD.`updated_at`
BEGIN
  UPDATE `orders` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `id` = NEW.`id`;
END;
