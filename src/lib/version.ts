export type CmsVersionInfo = {
  version: string;
  channel: string;
  releaseTag: string;
  coreEngine: string;
  schemaVersion: number;
  lastUpdated: string;
};

export const CMS_VERSION: CmsVersionInfo = {
  version: "1.7.13",
  // 1.7.13: "Transfer Diterima" on a manual-transfer order marks it paid and sends its Meta Purchase from the server.
  // 1.7.12: a native landing page can declare canonicalSlug and leaves the sitemap; legal page titles name the store once.
  // 1.7.11: Smart Placement in the template; the catalogue is read once per request; product pages make six sequential D1 reads, not nine; shipping-quote type narrowing restored.
  // 1.7.10: setup checklist owes a courier when every courier is off; deploy preflight and fleet:status report product-owned files an install edited.
  // 1.7.9: COD city-average fallback when the district estimate fails; manual transfer shows the holder; single bank/VA renders as one row.
  // 1.7.8: bare IP hosts (LAN or Tailscale preview) are never host-redirected, like localhost.
  // 1.7.7: optional PUBLIC_SITE_NOINDEX keeps a whole store out of search (header and robots meta).
  // 1.7.6: home h1 and the header brand title no longer end in a dangling separator when the tagline is empty.
  // 1.7.5: optional PUBLIC_SITE_BRAND_MARK shows the store's own mark in the header; unset keeps the monogram.
  // 1.7.4: product and landing pages are cached per province at the edge; cache hits skip the schema check.
  // 1.7.3: uploaded images (R2) are kept a day in the Workers cache and answered before D1 and R2.
  // 1.7.2: Inter is declared only as optional faces (latin, latin-ext); the package swap faces are gone.
  // 1.7.1: Inter latin faces use font-display optional, so text never changes font mid-read (CLS).
  // 1.7.0: two-minute edge cache for anonymous storefront HTML; Inter preloaded (CLS).
  // 1.6.5: http to https in the Worker; PUBLIC_ALIAS_HOSTS 301s older domains to the canonical one.
  // 1.6.4: a middle-form COD order is handed to WhatsApp from /thanks; clearer buyer-number note.
  // 1.6.3: CRM templates name the variant, quantity and unit price; no invented strike price; cron heartbeat signal.
  // 1.6.2: a Receiver Score refusal at any age is retried hourly; the refusal names its key.
  // 1.6.1: Kelola failure count turns red; "Plugin" stays lit on a plugin's settings page.
  // 1.6.0: first-party plugins (ADR-028); Kelola CRM becomes the first plugin, off per store.
  // 1.5.12: optional Kelola CRM push — orders as sales, abandoned orders as follow-up leads.
  // 1.5.11: a script-carrier image in merchant html fails without a request.
  // 1.5.10: deploy preflight refuses when production lists native landings the register does not.
  channel: "production",
  // 1.5.9: merchant html keeps one h1; an html-only page without one gets a hidden h1.
  // 1.5.8: the landing h1 is never a second one, nor a headline that does not render.
  // 1.5.7: a CMS landing page opens with an eager hero image and its own h1.
  // 1.5.6: deploy preflight compares the D1 ledger; receiver-score review fixes.
  // 1.5.5: Receiver Score whitelist surfaced, provider summary, hourly backfill.
  // 1.5.4: a landing page's hero is its first screen, not its first section.
  // 1.5.3: the toast stays off a CMS landing page's first section (its hero).
  // 1.5.2: social-proof toast redesign, fleet:status (A-51), island-test race.
  // 1.5.1: browser Meta events ordered behind the single pixel init.
  // 1.5.0: migrations 0056-0061, GA4 ecommerce payload, variant id over SKU,
  // mobile order button, deploy builds before upload (BUILD-LOG 2026-10-11).
  releaseTag: "2026.10-plugins",
  coreEngine: "Astro 7 SSR + Cloudflare Workers",
  schemaVersion: 67,
  lastUpdated: "2026-10-21",
};
