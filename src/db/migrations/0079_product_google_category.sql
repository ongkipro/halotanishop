-- The product's own Google product category, chosen in the admin product form
-- from Google's taxonomy (public/data/google-product-taxonomy.json). The Google
-- and Meta feeds send the id as `google_product_category` verbatim; a product
-- without one keeps the keyword engine's guess (src/lib/ad-taxonomy.ts).
-- The path is stored beside the id so the feed's `product_type` and the admin
-- can show it without shipping the taxonomy to the Worker.
ALTER TABLE `products` ADD COLUMN `google_category_id` integer;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `google_category_path` text;
