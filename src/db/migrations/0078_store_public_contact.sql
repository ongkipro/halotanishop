-- The store's public contact beyond WhatsApp: an email and a business address,
-- set in Pengaturan → Store and rendered by the storefront's legal and contact
-- pages (privacy, shipping & returns, terms). Both optional; a page drops the
-- sentence that needs a value the store has not set.
ALTER TABLE `stores` ADD COLUMN `support_email` text;
ALTER TABLE `stores` ADD COLUMN `business_address` text;
