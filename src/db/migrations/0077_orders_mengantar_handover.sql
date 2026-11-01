-- How a dispatched shipment reaches the courier (PRD A46): 'drop_off' when the
-- seller takes it to a counter, 'pickup' when Mengantar sends a vehicle. The
-- shipping page queued every waybilled order without a pickup schedule as
-- "Perlu pickup", drop-offs included, because the choice was never stored
-- (audit 2026-10-31 M5). NULL is a shipment dispatched before this column and
-- keeps the old reading: it may still need a pickup.
ALTER TABLE `orders` ADD COLUMN `mengantar_handover` text;
