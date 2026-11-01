-- An operator may move an unshipped COD order to a prepaid method from the
-- admin order page when the buyer asks to pay first (src/lib/payment-switch.ts).
-- The order keeps where it came from, when, and who switched it, so the sale's
-- history stays readable (a Kelola push already sent keeps saying COD; Kelola
-- has no update route).
ALTER TABLE `orders` ADD COLUMN `payment_switched_from` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD COLUMN `payment_switched_at` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD COLUMN `payment_switched_by` text;
