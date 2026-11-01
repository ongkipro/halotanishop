-- Support WhatsApp numbers for the /thanks rotator (PRD A35, REQ-184 to 189).
-- /thanks hands each COD order to one active number, picked from the order
-- number (src/lib/thanks-whatsapp.ts), so the order of rows is part of the
-- pick: id ascending. Only src/lib/whatsapp-numbers.ts writes this table, and
-- it keeps stores.support_whatsapp equal to the first active number for every
-- surface outside /thanks (legal pages, /kontak, landing shortcodes).
CREATE TABLE `whatsapp_numbers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `label` text DEFAULT '' NOT NULL CHECK (length(`label`) <= 60),
  -- Normalised to the wa.me form thanksWhatsappUrl accepts: 62 then 8-13 digits.
  `phone` text NOT NULL CHECK (
    `phone` GLOB '62[0-9]*' AND `phone` NOT GLOB '*[^0-9]*'
    AND length(`phone`) BETWEEN 10 AND 15
  ),
  `is_active` integer DEFAULT 1 NOT NULL CHECK (`is_active` IN (0, 1)),
  `created_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_numbers_phone_unique` ON `whatsapp_numbers` (`phone`);--> statement-breakpoint
-- An upgrading store keeps the number it has as the first entry. The WHERE
-- repeats the CHECK, so a number /thanks could never use (a foreign one, say)
-- is left out instead of aborting the chain; the page then falls back to
-- stores.support_whatsapp exactly as it did before.
INSERT INTO `whatsapp_numbers` (`phone`, `created_at`)
SELECT normalized, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT CASE WHEN digits GLOB '0*' THEN '62' || substr(digits, 2) ELSE digits END AS normalized
  FROM (
    SELECT replace(replace(replace(replace(replace(replace(
      trim(COALESCE(support_whatsapp, '')), '+', ''), ' ', ''), '-', ''), '.', ''), '(', ''), ')', '') AS digits
    FROM stores ORDER BY id LIMIT 1
  )
)
WHERE normalized GLOB '62[0-9]*' AND normalized NOT GLOB '*[^0-9]*'
  AND length(normalized) BETWEEN 10 AND 15;
