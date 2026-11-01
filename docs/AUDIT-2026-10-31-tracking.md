# Audit — ad-tracking installation, 2026-10-31

> Verified against disk: 2026-10-31 @ `b1707ba` (`origin/feat/admin-topbar-polish`)

A point-in-time report, not a source of truth. Findings only: every fix is
owned by the document or task named beside it. The tracking contract is
[`TRACKING_SPECS.md`](../TRACKING_SPECS.md); Google account setup is
[`GOOGLE_ADS_SETUP.md`](./GOOGLE_ADS_SETUP.md); the route and module map is
[`ROUTE-MAP.md`](./ROUTE-MAP.md). The repository review of the same day,
`docs/AUDIT-2026-10-31.md` on branch `audit/repo-review-2026-10-31`, already
reports M-3 (cancelled paid orders still uploaded to Google Ads), M-5 (Meta CAPI
`fetch` without timeout), L-11 (Google offline fetches without timeout) and L-12
(Google offline credentials env-only). They are referenced here, not re-derived.

Each finding is tagged **[run]** when it was reproduced on the local store and
**[read]** when it rests on reading the code or a provider's documentation.

## 1. Scope and method

In scope: Meta Pixel and Conversions API, the Google tag (direct Google Ads
conversion, Enhanced Conversions, Consent Mode v2), the Google Ads offline
upload, Google Tag Manager, click-ID capture, and edge-cache safety of the
tracking markup. TikTok has no pixel or Events API in this tree (removed
2026-08-24, `TRACKING_SPECS.md` §8): `ttq` and `analytics.tiktok.com` occur in
no source file, only `ttclid`/`utm_source` classification remains in
`src/lib/ad-channel.ts`, so the TikTok methodology was not applied.

Method:

1. **Code review** of every call site of `fbq(`, `gtag(`, `dataLayer.push`, the
   GTM snippet and `ttq` (`src/components/storefront/tracking/*`,
   `src/layouts/BaseLayout.astro`, `src/scripts/form-hybrid.ts`,
   `src/scripts/form-middle.ts`, `src/pages/thanks.astro`,
   `src/pages/payment.astro`, `public/adsbook-form-widget.js`), the server legs
   (`/api/meta-event`, `/api/v1/tracking/events`, `capi-outbox.ts`,
   `meta-capi.ts`, `paid-order-purchase.ts`, `meta-purchase-order.ts`,
   `google-ads-offline.ts`), click IDs (`click-ids.ts`, `middleware.ts`) and
   the edge cache (`edge-cache.ts`).
2. **Browser proof** on a local store: worktree of
   `origin/feat/admin-topbar-polish`, `npm run dev:local -- --reset --port=8817`,
   `npm run dev:seed -- --url=http://localhost:8817 --orders=6`. Chromium via
   the global `@playwright/test`. The local runtime (Wrangler 4.120) crashed
   three times under host load (load average 14–19 from other sessions); it was
   restarted with `--no-build` on the same state, and every journey reported
   here completed on a live runtime.
3. **Tests**: `npm test` and `npm run check`.

### Interception — nothing reached Meta, Google or TikTok

- `context.route` on every hostname matching `connect.facebook.net`,
  `facebook.com`, `googletagmanager.com`, `google-analytics.com`,
  `googleadservices.com`, `doubleclick.net`, `analytics.tiktok.com` and
  `google.com`. `fbevents.js`, `gtag/js` and `gtm.js` were fulfilled with a
  local recorder; every other request to those hosts was fulfilled empty and
  logged with its query.
- The `fbevents.js` stand-in sets `fbq.callMethod`, replays `fbq.queue` and
  records each call in order. An init script wraps `window.dataLayer.push`
  before any page script runs, so every `gtag()` (an `Arguments` object) and
  every ecommerce push is recorded in push order.
- Every request leaving for a host other than `localhost`/`127.0.0.1` was
  flagged `UNEXPECTED-EXTERNAL`: **zero** across all runs.
- Server credentials were never set: no Meta CAPI token, no Google Ads
  developer token or OAuth. `/api/meta-event` therefore answered
  `202 {"skipped":true,"reason":"Meta CAPI is not configured for this store."}`
  and `capi_event_outbox` and `google_ads_conversion_outbox` stayed at 0 rows.
  The "Kirim test event" and requeue buttons were not pressed. The server legs
  are verified by the request bodies the browser posted to `/api/meta-event`,
  by reading the route, and by the unit tests in §6.

## 2. Configuration used

Entered through the admin UI exactly as an operator would
(`/admin/ads/meta`, `/admin/ads/google`):

| Setting | Value |
| --- | --- |
| Meta Pixel ID | `000000000000001` |
| Meta CAPI token | not set (`meta_capi_configured: false`) |
| Google Ads conversion ID / label | `AW-000000001` / `TEST` |
| GTM container | `GTM-TEST000` |
| Offline Google Ads env (`GOOGLE_ADS_*`) | not set |

Validation observed: pixel `12ab` → 400 "Meta Pixel ID hanya boleh berisi 5–25
digit."; ID without label → blocked client-side "Conversion ID dan Label harus
diisi berpasangan."; GTM `XYZ-1` → blocked by the input's `pattern` (see L-7).
Every `GET`/`PUT /api/admin/ads` response carried only `meta_pixel_id`,
`meta_capi_configured`, `meta_capi_token_masked` (empty), the GTM id and the
Google pair. No token field and no `access_token` appeared in the page HTML.

## 3. Event matrix

Journeys, each in a fresh browser context, entering on
`/?fbclid=AUDITFBCLID<x>&gclid=AUDITGCLID<x>&utm_source=facebook&utm_medium=paid&utm_campaign=audit-<x>&utm_content=c1&utm_term=t1`:

- **COD**: home → `/contoh-landing` → `/produk/madu-hutan-dummy` →
  `/full-form?product_id=54817` → name, phone, address, district "Menteng" →
  COD → submit → `/thanks` → reload. Order `INV-10007`.
- **QRIS**: home → product → full form → QRIS → `/payment` → settled through
  the AutoLaris stand-in (`POST :8818/__dev/autolaris/pay`) plus the scheduled
  handler → `/payment` reload → `/thanks` → reload. Order `INV-10008`.
- **Middle form (product page)**: `/produk/madu-hutan-dummy?gbraid=AUDITGBRAID&utm_source=google…`
  → name "Budi", phone `+62 812-1111-2222`, address → submit → `/thanks` →
  reload. Order `INV-10009`.

Product 54817 (Madu Hutan Dummy, variant "250 ml", Rp65.000). "CAPI" below is
the body posted to `/api/meta-event`; the outbound Graph payload was not built
because the token was unset.

| Step | Meta Pixel (`fbq`) | Meta CAPI request | GTM `dataLayer` | Google tag (`gtag`) | Verdict |
| --- | --- | --- | --- | --- | --- |
| Any page load | `init` once (only `external_id` hash), then `PageView` `pv_…` | `PageView`, same `pv_…` | `page_view` with `meta_event_id` = same `pv_…` | 2× `consent default`, `js`, `config AW-000000001` | as spec; init precedes every track |
| Landing `/contoh-landing` | `ViewContent` `content_ids:["85894"]`, `contents`, 39000 IDR, `vc_contoh-landing_…` | same id, `product_id 85894`, 39000 | `view_item` `item_id 85894`, 39000 | — | as spec |
| Product page | `ViewContent` `["54817"]`, 65000 IDR | same id and value | `view_item` `item_id 54817`, 65000 | — | as spec |
| Name + valid phone typed | `AddToCart` `["54817"]`, 65000, `addtocart_…` | same id; `user_data` name, phone `6281234567890`, `external_id`, `fbc` | `add_to_cart`, `item_variant "4"` | — | fires once; `content_name`/`item_name` "250 ml" (L-3) |
| Submit | `InitiateCheckout` 65000, `initiatecheckout_…` | same id; adds province, city, district | `begin_checkout` | — | fires on submit, once (spec §16.1 says on district resolve, L-6) |
| `/thanks`, COD `INV-10007` | `init` with `ph fn ln ct st country external_id`, `PageView`, `Purchase` `["54817"]` 65000, `eventID INV-10007` | `Purchase` `event_id INV-10007`, `order_number`, `status_token`, 65000 | `purchase` `transaction_id INV-10007`, value 65000 | `set user_data` (`+62` phone hash, names in `address`, `country ID`) then `conversion` `send_to AW-000000001/TEST`, 65000 IDR, `transaction_id INV-10007` | as spec; value = goods (order total 77498) |
| `/thanks` reload | `init` + `PageView` only | `PageView` only | `page_view` only | no conversion | no duplicate |
| `/payment`, QRIS unpaid | `PageView` only | `PageView` only | `page_view` | no conversion | correct: no Purchase before payment |
| `/thanks` after settle, `INV-10008` | `Purchase` `eventID INV-10008`, 65000 | `Purchase` `INV-10008` | `purchase` `INV-10008` | `conversion` `transaction_id INV-10008`, 65000 | as spec; reload: nothing |
| `/thanks`, middle COD `INV-10009` | `Purchase` `INV-10009`, `init` with `ph fn country external_id` | `Purchase` `INV-10009` | `purchase` `INV-10009` | `conversion` `INV-10009` | as spec; reload: nothing |
| `/thanks#o=<pk>&t=<token>` in a fresh tab, unpaid QRIS `INV-10006`, unpaid bank transfer `INV-10005`, void COD `INV-10004` | **`Purchase` fired** (`content_name` = store name, no `content_ids`) | `Purchase` posted | **`purchase` fired, no `transaction_id`, empty `item_id`** | **`conversion` fired, no `transaction_id`** | **wrong — H-1** |
| Same fresh-tab path, paid `INV-10003` / COD `INV-10001` | `Purchase`, no `content_ids`, `init` with `country` + `external_id` only | `Purchase` | `purchase` without `transaction_id` | `conversion` without `transaction_id` | degraded — H-1 |

Per platform:

- **Meta Pixel:** correct on every in-tab journey. One `init` per page, issued
  before every `track`; every browser `eventID` equals the `event_id` of one
  `/api/meta-event` body; Purchase `eventID` is the `INV-` number; no Purchase
  on reload or on unpaid `/payment`. Wrong on the fresh-tab `/thanks` path
  (H-1).
- **Meta CAPI:** request side correct (same ids, server-normalised source URL,
  status-token gate); outbound delivery and the outbox not exercised
  (token unset by rule).
- **Google Ads direct tag:** correct in-tab: one conversion per order,
  `transaction_id` = `INV-` number, value = goods, Enhanced Conversions in the
  documented `set user_data` shape. Wrong on the fresh-tab path (H-1).
- **GTM:** loaded once per page, `<noscript>` iframe immediately after `<body>`;
  ecommerce pushes correct in-tab. The container loads ahead of the Consent Mode
  defaults (L-1).
- **TikTok:** not installed; nothing to verify.

**Click-ID persistence [run]:** the landing URL left `adsbook_click_ids`
(`gclid`, `fbclid`, five UTM tags, synthesized
`_fbc = fb.1.<ms>.<fbclid>`), `_fbc` and `adsbook_meta_external_id`, each
`Max-Age` 90 days, `SameSite=Lax` on HTTP. They survived three page changes and
were stored on the order:
`INV-10007.ad_click_ids = {"gclid":"AUDITGCLIDcod","_fbc":"fb.1.1793389809367.AUDITFBCLIDcod","fbclid":"AUDITFBCLIDcod","utm_source":"facebook",…,"utm_term":"t1"}`,
`meta_request_context = {"externalId":"855d6024…","fbc":"fb.1.1793389809367.AUDITFBCLIDcod","clientIp":"127.0.0.1","userAgent":"…"}`.
`INV-10008` likewise; `INV-10009` stored `gbraid` and the Google UTMs. `_fbp`
is absent because the recorder does not mint it (real fbevents does).

**Hash normalisation [run]:** for "Siti Nur Aisyah", `081234567890`, recorded
hashes equal SHA-256 of `6281234567890` (Meta `ph`), `+6281234567890` (Google),
`siti`, `nuraisyah` (Meta `ln`), `nur aisyah` (Google last name), the 32-hex
external-ID cookie, and `administrasijakartapusat` (Meta `ct`). For
`+62 812-1111-2222`: `6281211112222` / `+6281211112222`.

## 4. Findings

Counts: **High 1 · Medium 1 · Low 7**, plus four referenced from the repository
review.

### H-1 — The browser Purchase qualifies on client storage: unpaid and void orders fire Pixel, Google and GTM Purchase **[run]**

- **Where:** `src/components/storefront/tracking/MetaThanksTracker.astro:104`
  (`paymentMethod = pick('pm', pick('payment_method', 'cod'))` from
  `sessionStorage`), `:136` (the only gate:
  `paymentMethod !== 'cod' && !statusData.is_paid`), `:245` and `:287`
  (`transaction_id` from `sessionStorage` `order_id`), `:89-97` (product id,
  name, value fallback from `sessionStorage`).
- **What:** `/api/order-status` already returns the order's `payment_method`,
  `order_number` and `product_value`, but the tracker decides COD vs prepaid
  from `sessionStorage` and defaults to `cod`, never checks a void order
  (cancelled/returned/refunded, `stock_restored_at`), and takes
  `transaction_id` from storage rather than the server's order number.
  `/thanks#o=<pk>&t=<token>` is the path `thanks.astro:43-82` and
  `form-hybrid.ts:2156` rely on when the storage write did not land; it puts
  only `order_pk` and `status_token` into storage.
- **Evidence:** fresh context, `/thanks#o=…&t=…`:
  `INV-10006` (QRIS, `pending`), `INV-10005` (bank transfer, `pending`),
  `INV-10004` (COD, `payment_status cancelled`, `stock_restored_at` set) each
  produced `fbq('track','Purchase',{content_name:'Toko Dummy Lokal',value:…},{eventID:'INV-1000x'})`,
  `dataLayer` `purchase` with no `transaction_id` and `item_id ""`, and
  `gtag('event','conversion',{send_to:'AW-000000001/TEST',value:…,currency:'IDR'})`
  with no `transaction_id`. Paid `INV-10003` and COD `INV-10001` on the same
  path fired with no `content_ids`, no `transaction_id`, and advanced matching
  reduced to `country` + `external_id`.
- **What holds:** the server leg is gated — `/api/meta-event` resolves the
  order by token and `isMetaPurchaseOrderEligible`
  (`src/lib/meta-purchase-order.ts:48-55`) returns 409 for unpaid or void
  orders [read; not observed, token unset].
- **Impact:** a Purchase for an unpaid or voided order reaches the Meta Pixel
  and the Google Ads conversion action; the Google one carries no
  `transaction_id`, so it cannot deduplicate and counts on every such open.
  Smart Bidding and Meta optimise on a sale that did not happen, and the order's
  real Purchase later (QRIS paid) is a second Google conversion. Exposure needs
  the order's UUID status token in a fresh tab, so volume is bounded (lost-tab
  and storage-blocked buyers, forwarded links), but the behaviour contradicts
  TRACKING_SPECS §13 ("order creation alone is not Purchase"), the tracker's own
  comment at `:115-116`, and A-421 on the browser leg. Legitimate purchases on
  this path lose catalogue ids, Google dedup and matching.
- **Suggested fix:** gate on `statusData.payment_method`, reject a void order
  (expose a boolean from `loadPublicOrderStatus` using `isVoidOrder`), and use
  `finalEventId` as `transaction_id` for Google and GTM; add a case to
  `meta-purchase-dedup.test.ts` with empty storage and a non-COD unpaid order.
- **Owner:** `TRACKING_SPECS.md` §6/§13; task to be opened in `TASKS.md`.

### M-1 — Google Ads offline upload targets `uploadClickConversions`, which Google now refuses for new developer tokens **[read]**

- **Where:** `src/lib/google-ads-offline.ts:1` (`v25`), `:241`
  (`customers/<id>:uploadClickConversions`), `:156-175` (`decideGoogleRetry`
  marks any non-429 4xx `failed`).
- **What:** Google's upload-clicks guide, fetched 2026-10-31: "Starting June 15,
  2026, UploadClickConversions requests will fail if the developer token hasn't
  previously sent requests to upload offline conversions or enhanced conversions
  for leads … Use the Data Manager API instead." Each install brings its own
  credentials, so any install enabling this feature after that date with a
  token that never uploaded before gets a 4xx on the first row, and every queued
  delivered-COD conversion ends `failed`.
- **Impact:** the revenue-qualified COD signal TRACKING_SPECS §10 recommends as
  the Primary action never reaches Google for new installs, while the outbox
  reports the rows as processed. Not reproduced: no credentials, no live call.
- **Suggested fix:** migrate the sender to the Data Manager API
  (`datamanager.googleapis.com/v1/events:ingest`), or record in an ADR which
  installs may keep the legacy path. Also send `conversionDateTime` as the
  qualification time rather than discovery time (`:117-119`, `:147`) when the
  sender is touched.
- **Owner:** `TRACKING_SPECS.md` §10, `DECISIONS.md`.

### Low

| # | Finding | Where | Evidence / impact | Suggested fix | Owner |
| --- | --- | --- | --- | --- | --- |
| L-1 | GTM container starts ahead of Consent Mode defaults; with GTM alone there are no defaults at all **[run]** | `src/layouts/BaseLayout.astro:218-222`; `GoogleAdsBase.astro:25` | Recorded order on every page: `{event:'gtm.js'}` → `consent default ×2`. GTM's built-in triggers evaluate before consent state exists; EEA/UK visitors are not held denied for GTM tags. Low for an Indonesia-only store | Emit the two `consent default` calls in a component rendered before `GtmBase`, independent of the Google Ads pair | `TRACKING_SPECS.md` §10 |
| L-2 | Server Purchase eligibility accepts only `paid`; the rest of the code accepts `paid/settled/success` **[read]** | `src/lib/meta-purchase-order.ts:54` vs `order-status.ts:122`, `paid-order-purchase.ts:44`, `order-lifecycle.ts:1-10` (admin PATCH accepts `settled`, `success`) | A prepaid order set to `settled`/`success` fires the browser Purchase (`is_paid` true) while `/api/meta-event` and `/api/v1/tracking/events` answer 409, so Meta gets the Pixel leg only | Share one paid-status set | `TRACKING_SPECS.md` §13 |
| L-3 | `AddToCart`/`InitiateCheckout` `content_name` and GTM `item_name` are the variant label **[run]** | `src/scripts/form-hybrid.ts:366`, `src/scripts/form-middle.ts:155` | Recorded "250 ml" while `view_item`/`purchase` carry "Madu Hutan Dummy"; GA4 item reports split one product into two names. `content_ids` are correct | Product name in `content_name`/`item_name`; label stays in `item_variant` | `TRACKING_SPECS.md` §4 |
| L-4 | CAPI PageView carries `value: 1` and defaults to `content_type: product` **[run + read]** | `MetaPageViewTracker.astro:22-24`; `src/pages/api/meta-event.ts:193-203`; `src/lib/meta-capi.ts` `content_type` default | The Pixel PageView is `{}`; the server leg of the same `event_id` would carry a 1 IDR value and a product content type | Omit value/currency on PageView, pass `content_type` through | `TRACKING_SPECS.md` §4 |
| L-5 | Every page posts `/api/meta-event` even when Meta is unconfigured, and the D1 rate-limit write precedes the config check **[run + read]** | `BaseLayout.astro:224`; `meta-event.ts:92` vs `:112` | One extra request and one `rate_limits` write per page view on stores without Meta | Render `MetaPageViewTracker` only with a valid pixel, or check config first | `TRACKING_SPECS.md` §12 |
| L-6 | Contract drift in `TRACKING_SPECS.md` **[run + read]** | `TRACKING_SPECS.md:825`, `:772`, `:43`, `:3` | §16.1 says hybrid `InitiateCheckout` fires when the district resolves; it fires on submit (`form-hybrid.ts:1920-1932`, observed). §15 item 8 still says "including `ttclid`", removed by §8. §2 says `/thanks` gates Purchase from recorded state, which H-1 contradicts for the browser leg. Header stamp is 2026-10-24 | Correct the three statements and re-stamp | `TRACKING_SPECS.md` |
| L-7 | Google settings form keeps a stale error after a native-validity block **[run]** | `src/pages/admin/ads/google.astro:590-597` | Invalid GTM `XYZ-1` was blocked by `reportValidity()` while the status line still read "Conversion ID dan Label harus diisi berpasangan." from the previous attempt | Clear the status before `reportValidity()` | `DESIGN-SYSTEM.md` §7.1 |

### Referenced, not re-derived

- **M-3** (repo review): Google offline conversions are queued for paid orders
  later cancelled — `reconcileGoogleAdsConversions` has no void guard.
- **M-5** (repo review): Meta CAPI `fetch` has no timeout and is awaited on
  request paths.
- **L-11** (repo review): Google offline fetches have no timeout.
- **L-12** (repo review): Google offline credentials are env-only.

## 5. Installed correctly

Verified by running unless marked [read]:

- **One `fbq('init')` per pixel id, owned by `MetaPixelBase`.** Every recorded
  page shows exactly one `init`, issued before every `track`. On `/thanks` the
  head slot sets `__PS_META_AWAIT_MATCHING__`, so the single init carries
  `ph fn ln ct st country external_id`; on reload it falls back to
  `external_id` after the bounded wait. All `track` calls go through
  `__PS_META_TRACK__` (`MetaLandingTracker.astro:78`, `form-hybrid.ts:412`,
  `MetaThanksTracker.astro:230`); no tracker calls `fbq('track')` or
  `fbq('init')` directly [read + run].
- **Shared event ids:** every Pixel `eventID` equals the `event_id` posted to
  `/api/meta-event` (PageView via `__META_PAGEVIEW_EVENT_ID__`, ViewContent,
  AddToCart, InitiateCheckout), and Purchase is the `INV-` order number on both
  legs; the server substitutes `purchaseOrder.order_number`
  (`meta-event.ts:147`).
- **Purchase rules:** COD fires on `/thanks` after `/api/order-status` resolves
  the order; QRIS fires only after paid (none on `/payment`); reload fires
  nothing (`once()` on event id and order). Manual transfer and late-paid
  orders go through `enqueuePurchaseForPaidOrder`, which refuses void orders
  (A-421) [read + unit tests].
- **Value and currency:** every event IDR; Purchase value is the goods value
  from `order_items` (65000 against an order total of 77498 and 75000).
- **Catalogue identity:** `content_ids`, `contents[].id`, GTM `item_id` and the
  server `product_id` are the five-digit product id (`54817`, `85894`); pages
  use `defaultCatalogContentId`/`catalogProductIdOrNull`
  (`produk/[slug].astro:158`, `[slug].astro:156`, `contoh-landing.astro:78`,
  form pages) [run + read].
- **Enhanced Conversions:** `gtag('set','user_data',…)` precedes the
  conversion; phone `+E.164` SHA-256; names inside `address`, trimmed and
  lowercased; `country: 'ID'`; empty keys omitted; `transaction_id` sent only
  when present.
- **Click IDs:** captured in middleware, merged (not overwritten), 90-day
  `adsbook_click_ids`, `_fbc` synthesized from `fbclid`, persisted to
  `orders.ad_click_ids` and `meta_request_context` for both forms and
  `/api/v1/checkout` [run + read]. `zanoby_click_ids` is read only
  (`click-ids.ts:25`) [read].
- **Edge cache (ADR-029):** a product page served `X-Edge-Cache: MISS`, then
  `HIT` for a request carrying `?fbclid=X1&gclid=G1`, and the hit still set
  `adsbook_click_ids` and `_fbc`. Two fetches of the same page were identical
  after masking 32-hex strings; event ids and the external id are minted in the
  browser. `/thanks` and `/payment` send `no-store`.
- **No token leakage:** CAPI token never in admin responses or HTML; server
  reduces `event_source_url` to origin + path (`meta-event-contract.ts:161`),
  so the `/payment#o=…&t=…` fragment recorded in a PageView body does not travel
  further [run + read].
- **Tag loading:** `fbevents.js`, `gtag/js` and `gtm.js` each requested once
  per page; GTM `<noscript>` iframe is the first child of `<body>`; the Google
  tag renders only with a valid ID/label pair; the conversion and Purchase pull
  their deferred libraries forward.
- **Embed widget:** relays `AddToCart`/`InitiateCheckout` to the host page only
  with the frame's `eventId` and fires no Purchase
  (`public/adsbook-form-widget.js:72-104`) [read].

## 6. Tests and checks

- `npm test`: **1083 passed, 0 failed, 0 skipped** (the AGENTS.md baseline of
  1042 predates this branch).
- Tracking subset, 22 files, **146 passed**: `ad-channel`, `capi-outbox`,
  `catalog-identity`, `click-ids`, `e2e-full-funnel`, `edge-cache`,
  `embed-markup`, `google-ads-offline`, `gtm`, `meta-capi`,
  `meta-event-contract`, `meta-identity`, `meta-order-context`,
  `meta-pixel-ordering`, `meta-purchase-dedup`, `meta-purchase-order`,
  `order-status-api`, `order-status-core`, `order-status`,
  `paid-order-purchase`, `store-ads`, `traffic-source`.
- `npm run check`: `astro check` 0 errors / 0 warnings / 0 hints (547 files);
  `tsc --noEmit` exit 0.
- No test covers H-1: every `meta-purchase-dedup.test.ts` fixture stores
  `payment_method: "cod"` in `thanks_state`.

## 7. Not checked

- **Live delivery:** no event reached Meta or Google. CAPI acceptance, Meta
  deduplication, `fbtrace_id`s, Google conversion diagnostics and the offline
  upload response need real accounts and approval.
- **Events Manager / EMQ / Tag Assistant:** cannot be read without the
  store's pixel and accounts.
- **The CAPI outbox at runtime:** token unset by rule, so no row was written;
  the outbox, retry ladder and drain are covered only by unit tests.
- **Server-side Purchase from AutoLaris reconciliation and "Transfer
  Diterima":** returned `meta-not-configured` with no token; covered by
  `paid-order-purchase.test.ts`.
- **Real `fbevents.js`/`gtag.js` behaviour:** the recorder replaces both, so
  `_fbp` minting, Meta's automatic events, and Google's consent processing were
  not exercised. TRACKING_SPECS §16.1 notes fbevents sends nothing under
  `navigator.webdriver`.
- **Headless `/api/v1/tracking/events`:** read only; no developer key was
  issued.
- **Native Astro landing pages:** none exist in this tree (`src/pages/landing/`
  holds only a README). The CMS route `[slug].astro` was read; the local store
  had no CMS landing page, so `/contoh-landing` stood in for it.
- **Account configuration:** whether GTM also fires the same Google Ads
  conversion action as the direct tag, Primary/Secondary goal setup, and
  Enhanced Conversions acceptance live in the Google Ads account.
