-- The weight each order line was quoted with (PRD A41, A-397). The checkout
-- insert copies product_variants.weight_grams in the same statement, so the
-- Mengantar dispatch sends exactly what the shipping quote used even when the
-- variant is edited afterwards. Rows written before this column stay NULL and
-- dispatch falls back to the variant's current weight, as it always did.
ALTER TABLE `order_items` ADD `weight_grams` integer;
