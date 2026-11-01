-- Superseded AutoLaris instructions (audit 2026-10-31 H-1).
--
-- An order holds one payment_transactions row. When its QRIS/VA expired and
-- the buyer asked for a new one, the row was rewritten and the old provider
-- transaction id was lost. A buyer who paid the old instruction in its last
-- minute (it can settle after this side marks it expired) then had money at
-- the provider that no path could match: the hourly Advice run only asked
-- about the new id, and manual confirmation refused the old one.
--
-- Each superseded instruction is kept here before the row is rewritten. The
-- Advice run asks about the ones that expired within its recheck window, and
-- manual confirmation accepts them. A row goes with its transaction.
CREATE TABLE `payment_transaction_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_transaction_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`provider_transaction_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`channel_code` text NOT NULL,
	`amount` integer NOT NULL,
	`admin_fee` integer NOT NULL,
	`total_amount` integer NOT NULL,
	`expires_at` text,
	`superseded_at` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`payment_transaction_id`) REFERENCES `payment_transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transaction_attempts_provider_id` ON `payment_transaction_attempts` (`provider_transaction_id`);
--> statement-breakpoint
CREATE INDEX `payment_transaction_attempts_recheck` ON `payment_transaction_attempts` (`expires_at`);
