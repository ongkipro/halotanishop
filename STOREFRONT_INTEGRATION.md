# AdsBookCMS — Storefront, Form, and Ads Integration Contract

> Verified against disk: 2026-10-29 @ be00fee + s5-a42 working tree

This document is the implementation handoff for anyone — human or agent — building a public storefront experience against an **AdsBookCMS** install. Two integration shapes are supported and both are shipping today:

1. **Built-in storefront** — the install renders its own public pages (`/`, `/produk`, `/produk/[slug]`, landing pages, checkout forms) from the same Worker. This is what `permatamall.shop` runs.
2. **External storefront over the Headless API** — a separate site (any framework, any host) reads catalog, geo, and configuration from `/api/v1/*` and posts orders back to it, authenticated with a developer API key.

Commerce authority never moves. Catalog identity, price, stock, weight, destination resolution, courier eligibility, order persistence, payment reconciliation, tracking identity, and the operator dispatch lifecycle stay inside the install.

---

## 1. Status Legend

- **Implemented** — present in this repository, readable at the cited path.
- **Gap** — not implemented; tracked in `ARCHITECTURE.md` §10 or `UNIMPLEMENTED_SPECS.md`.
- **Blocked** — waits on an external provider contract or a merchant decision.

Never present a gap as an active endpoint. Per ADR-010, anything in this document that disagrees with the tree is the document being wrong.

---

## 2. Install Model and Ownership Boundary

Per ADR-001, **one install = one Worker = one store**. There is no tenant registry, no request-time store selection, no `services` block in `wrangler.jsonc`, and no service binding to a second Worker. An external storefront talks to the install over **ordinary public HTTPS** with an API key — not over a private binding.

| Concern | Owner | Customizable per install |
| --- | --- | --- |
| Public layout, route hierarchy, components, copy presentation | Storefront (built-in templates or external site) | Yes |
| Brand assets and merchant claims | Merchant-owned inputs, uploaded to R2 | Yes, after factual review |
| Catalog identity, variant identity, price, stock, weight, active state | Install D1 (`products`, `product_variants`) | No browser override |
| Address resolution, courier eligibility, shipping quote | Install API + Mengantar contract | Presentation only |
| Checkout validation and order persistence | Install API | Presentation only |
| Middle/full/hybrid form behaviour | Install system contract | Placement and mode selection only |
| Admin, order verification, dispatch, payment, provider state | Install `/admin/*` | No storefront fork |
| Meta/Google identifiers and CAPI token | `stores` row, edited in `/admin/ads/*` | Server-controlled |
| Browser event rendering | Storefront adapter | Yes, within the canonical event contract |
| Server CAPI and Purchase qualification | Install (`capi_event_outbox`) | No browser authority |

A second store is a second install — separate Worker, D1, KV, R2, and domain. Nothing in this document authorizes reading another install's data.

---

## 3. Public Route Surface

**Storefront-owned (built-in renderer):** `/`, `/produk`, `/produk/[slug]`, `/[slug]` landing catch-all, `/404`, content pages (`/tentang`, `/kontak`, `/testimoni`, `/sitemap`, `/disclaimer`, `/kebijakan-privasi`, `/kebijakan-cookie`, `/syarat-ketentuan`, `/pengiriman`), feeds (`/sitemap.xml`, `/feed/google-catalog.xml`, `/feed/meta-catalog.xml`, `/robots.txt`), and media (`/assets/[...key]`, `/media/[...key]`).

**System-owned, never forked:** `/admin/*`, `/hello`, `/api/*`, `/payment`, `/thanks`, `/hybrid-form`, `/middle-form`, `/full-form`, `/geoipform`, `/embed/form`, `/api/admin/payment-reconciliation`, and the callback recorder `/api/webhooks/autolaris` (evidence only; never a payment transition).

### Form route redirects — verified

The canonical checkout routes are `/hybrid-form`, `/middle-form`, and `/full-form`. The legacy paths `/form-hybrid`, `/form-middle`, and `/form-full` exist as **308 permanent redirects that preserve the complete query string** (`src/pages/form-hybrid.astro` and siblings issue `Astro.redirect('/hybrid-form' + Astro.url.search, 308)`). New integrations must emit the canonical form, not the legacy alias.

### Same-origin public API (`/api/*`)

These serve the built-in forms. They take no admin session or API key; each write/read boundary applies its own validation, origin, honeypot, token, or rate-limit policy as documented by the route.

| Route | Methods | Role |
| --- | --- | --- |
| `/api/form-config` | GET | Resolve one active product/variant plus canonical middle/full/hybrid render URLs. |
| `/api/locations` | GET | Search district/city and provider location identities. |
| `/api/geo-province` | GET | Resolve the trusted province for form-mode routing. |
| `/api/shipping-rates` | GET | Server-authoritative eligible courier rates. Query parameters, not a body. |
| `/api/shipping-options` | GET | Configured public shipping choices. |
| `/api/payment-methods` | GET | Eligible payment methods and COD exclusions. |
| `/api/submit-order` | POST | Persist the full/hybrid validated order. |
| `/api/submit-middle-order` | POST | Persist the compact middle-order contract. |
| `/api/order-status` | POST | Recorded payment state for a known order. Token-scoped, requires a JSON body. |
| `/api/record-abandoned-order` | POST | Record an abandoned checkout attempt. |
| `/api/meta-event` | POST | Validate and forward supported server CAPI events when configured. |

---

## 4. Headless API — `/api/v1/*` (Implemented)

Eight routes ship. They are the contract an external storefront builds against; there is no planned bootstrap endpoint and no reason to hard-code a catalog.

All eight share the same envelope from `src/lib/headless-api.ts`:

- Success: `{ "success": true, "timestamp": "<ISO>", ...payload }`
- Failure: `{ "success": false, "timestamp": "<ISO>", "error": { "message": "<Indonesian>", "code": "<CODE>", ... } }`
- Every route exports `OPTIONS = handleOptions` for CORS preflight (204, or 403 `ORIGIN_FORBIDDEN`).
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`; `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-App-Key`; `Access-Control-Expose-Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-DailyQuota-Limit, X-DailyQuota-Remaining`; `Access-Control-Max-Age: 86400`.
- Error messages are **Indonesian**; treat them as user-facing copy, and branch on `error.code`, never on the message string.

### 4.1 Access control — the real surface

Every `/api/v1/*` request passes `validateHeadlessRequest(request, locals, { operation })` before route work. Four checks run in order:

1. **Developer API key.** `X-App-Key`, legacy `X-API-Key`, then `Authorization: Bearer`. The SHA-256 hash must match one active D1 key and the secret is re-verified in constant time.
2. **Origin allowlist.** Browser callers must match the independent Headless origin policy; server-to-server callers without `Origin`/`Referer` still require the API key.
3. **Minimum scope.** `HEADLESS_OPERATIONS` maps every route operation to exactly one scope: `storefront:read`, `catalog:read`, `shipping:read`, `checkout:write`, `orders:read`, or `tracking:write`. Missing authority returns 403 `API_SCOPE_FORBIDDEN`.
4. **Per-key quota.** D1 atomically increments minute and daily buckets in `developer_api_key_usage`; exhausted keys return 429 with `Retry-After`. The default is 120 requests/minute and 10,000/day; creation accepts 1–600/minute and 1–100,000/day.

Headless write handlers record one payload-free `headless_api_audit_events` row
with key id, operation, status code, and timestamp after the response is known.
Audit insertion failure is logged but cannot turn an accepted commerce write into
a client-visible retry that could duplicate it.

**Key issuance** is at `/admin/settings/developer` backed by `/api/admin/settings/developer`. Operators choose scopes and bounded minute/daily quotas. Secrets are generated as `adsbook_live_<43-char base64url>`, stored only as a SHA-256 hash plus masked preview, and returned in full exactly once. Revocation takes effect on the next request.

**Where the allowlist comes from.** Headless API and iframe embedding have separate policies:

- `stores.headless_allowed_origins` is the primary Headless API allowlist. Owners and admins manage it in the **Domain Allowlist Headless API** field at `/admin/settings/developer`; `/api/admin/settings/developer` persists it independently from iframe origins.
- `PUBLIC_HEADLESS_ALLOWED_ORIGINS` is an optional runtime fallback, useful while provisioning a new install before the database value is saved.
- `PUBLIC_SITE_URL`, `localhost`, and `127.0.0.1` are always accepted by the Headless API resolver.
- `stores.embed_allowed_origins` controls only the `/embed/form` `frame-ancestors` CSP. `PUBLIC_EMBED_ALLOWED_ORIGINS` is its runtime fallback. Changing this policy does not authorize `/api/v1/*`.

Both admin fields accept one exact origin or wildcard subdomain pattern per line. Broad `*`, paths, query strings, fragments, and malformed patterns are rejected before persistence.

### 4.2 `GET /api/v1/storefront`

`src/pages/api/v1/storefront.ts`. Methods: `GET`, `OPTIONS`.

The bootstrap contract. Returns four groups:

- `storefront` — runtime identity from `resolveTenantConfig`.
- `content` — either published home content or `{ "state": "setup-required" }`; no compiled/generated merchant-facing fallback is emitted.
- `tracking` — public Meta/Google identifiers only. The Meta CAPI token is never included.
- `payment` — `cod_enabled` (hardcoded `true`), `cod_disabled_provinces` (live from `stores.cod_disabled_province_codes`), and `supported_methods: ["COD","BANK_TRANSFER","E_WALLET","QRIS"]` (a static list, not a live eligibility check — use `/api/payment-methods` for eligibility).

Cache: `Cache-Control: no-store`; storefront configuration changes take effect on the next authenticated request. Failure: 500 `STOREFRONT_LOAD_ERROR`.

### 4.3 `GET /api/v1/products`

`src/pages/api/v1/products/index.ts`. Methods: `GET`, `OPTIONS`.

Query: `limit` (1–100, default 20), `offset` (≥0, default 0), `q` or `search`, `category`. Filtering by search and category happens **in memory after loading the full catalog**, so `total` reflects the filtered set.

A product whose row predates the five-digit Product ID scheme cannot form a
`content_id`, which this contract declares required. Such a row is **omitted
from the catalogue**, before `total` is counted — so the count and the
pagination window stay consistent — and `/api/v1/products/<slug>` answers 404
`PRODUCT_NOT_FOUND` for it, matching what the list omits. It is the same stance
both catalog feeds take: a row with no catalogue identity is not publishable to
an ads surface. Previously such a row threw inside the response map and returned
500 for the whole list.

Returns `total`, `limit`, `offset`, `has_more`, and `products[]`. Each product carries `id` (the canonical numeric D1 Product ID), `content_id` (the same decimal Product ID, with at least five digits), `slug`, `name`, `category`, `headline`, `subheadline`, `price`, `compare_price`, `image`, `hero_image`, `rating_value`, `review_count`, `sold_count`, `variants[]` (`id`, the raw selectable variant ID; `content_id`, the parent Product ID used by ads; `label`, `price`, `compare_price`), and a `urls` block.

Cache: `Cache-Control: private, max-age=60, stale-while-revalidate=600`; browser clients may reuse a response, shared caches may not. Failure: 500 `PRODUCTS_LOAD_ERROR`.

Source is `getStorefrontProducts`, which merges operational `products`/`product_variants` rows with **published** `storefront_content` presentation. An active product without published presentation is synthesized from its own operational row; inactive or checkout-incomplete products are omitted. On a load error the function returns `[]`, so an empty catalog is ambiguous between "no products" and "D1 failed" — surface an honest empty state either way, never a fixture.

### 4.4 `GET /api/v1/products/[slug]`

`src/pages/api/v1/products/[slug].ts`. Methods: `GET`, `OPTIONS`.

The path segment resolves against slug or numeric Product ID, so a `content_id` returned by the list endpoint can be handed straight back. Returns the full product record — everything in the list payload plus `tag`, `seo_title`, `seo_description`, `description`, `benefits`, `key_points`, `ideal_for`, `offer_text`, `cta_text`, `reviews[]` — plus a `forms` block and up to four `related_products` from the same category.

Cache: envelope default, `Cache-Control: private, max-age=60`. Failures: 400 `SLUG_REQUIRED`, 404 `PRODUCT_NOT_FOUND`, 500 `PRODUCT_DETAIL_ERROR`.

The `urls`/`forms` blocks use the canonical hosted checkout paths: `/hybrid-form`, `/middle-form`, and `/full-form`. `checkout_hybrid` is a browser navigation URL, not the POST-only `/api/v1/checkout` endpoint.

### 4.5 `GET /api/v1/geo/districts`

`src/pages/api/v1/geo/districts.ts`. Methods: `GET`, `OPTIONS`.

Query: `q` or `search`, `limit` (1–100, default 30). A query shorter than 2 characters returns `{ query, districts: [] }` with **no `count` field** — handle that shape. Otherwise returns `query`, `count`, and `districts[]` of `{ district, city, province, label }` from the compiled district catalog. Cache: envelope default. Failure: 500 `DISTRICT_SEARCH_ERROR`.

### 4.6 `GET | POST /api/v1/geo/shipping-rates`

`src/pages/api/v1/geo/shipping-rates.ts`. Methods: `GET`, `POST`, `OPTIONS` — both verbs run the same handler; POST reads a JSON body, GET reads query parameters, and body wins where both are present.

Inputs: `destination_id` or `location_id` (**required**), `payment_method` (default `cod`), `variant_id`, `quantity` (default 1), `weight` (default 1; values above 100 are treated as grams and divided by 1000), `city` (optional: the buyer's city, which picks the warehouse the quote ships from, ADR-032; without it, or for an unknown or ambiguous city, the primary warehouse).

Returns `destination_id`, `payment_method`, `origin_id`, `warehouse_id` (the warehouse this quote ships from, or `null`; echo it to checkout), `fallback_used`, and `rates[]` of `{ courier_code, courier_service, price, estimated_days, cod_available, cod_fee, total_shipping }`. `total_shipping` equals `price` — what checkout charges as shipping. `cod_fee` is the provider's figure, informational only: the store's own COD service fee is added once at checkout and returned as `cod_service_fee` (+ `cod_service_fee_vat`). Before 2026-09-25 `total_shipping` and headless checkout both added `cod_fee`, charging COD twice.

Cache: envelope default, `Cache-Control: private, max-age=60`; a quote is not a durable fact, so re-quote before submit. Failures: 400 `DESTINATION_ID_REQUIRED`, 503 `DATABASE_UNAVAILABLE`, or the `ShippingQuoteError` status/code passthrough, else 500 `SHIPPING_RATES_ERROR`.

### 4.7 `POST /api/v1/checkout`

`src/pages/api/v1/checkout.ts`. Methods: `POST`, `OPTIONS` only.

The full guard stack, in order: API key + origin, then a D1 rate limit of **15 attempts per 60 s per client IP** (429 `RATE_LIMITED`), JSON parse (400 `INVALID_PAYLOAD`), honeypot on `website`/`honeypot` (400 `HONEYPOT_TRIGGERED`), `orderSubmitSchema` validation (422 `VALIDATION_ERROR` with a formatted `errors` tree), D1 availability (503 `DATABASE_UNAVAILABLE`), COD province policy (422 `COD_DISABLED_FOR_REGION`), for `qris`/`bank_transfer` a configured AutoLaris key (503 `PAYMENT_METHOD_UNAVAILABLE`), then a **server-side re-quote** through `resolveTrustedHeadlessShipping` — the browser's shipping cost is never trusted — and finally `persistOrder`.

The re-quote ships from the warehouse the rate call did: send the rate response's `warehouse_id` as `warehouse_id`. Without it, checkout quotes from the primary warehouse, which is what a rate call without `city` showed; the checkout's `city` never picks the warehouse. Because checkout cannot tell whether the rate call carried `city`, a checkout with `city` and no `warehouse_id` also quotes the way a rate call with that `city` would: when that warehouse is not the primary and its price for the chosen courier differs, it answers 409 `SHIPPING_QUOTE_CHANGED` rather than charge a price the buyer may not have been shown. Echoing `warehouse_id` avoids that refusal; on a one-warehouse store it never occurs. A `warehouse_id` that is no longer active and ready also answers 409 `SHIPPING_QUOTE_CHANGED`: re-quote and show the new price. Either way a buyer is never charged another warehouse's price than the one quoted.

On success returns **201** with `order` (`id`, `order_number`, `public_status_token`, `total_amount`, `unit_price`, `cod_service_fee`, `cod_service_fee_vat`, `cod_fee_bearer`, `seller_bank_name`, `seller_account_holder`, `seller_account_number`) and `payment` — for `qris`/`bank_transfer` the AutoLaris instruction (`channel_code`, `status`, `total_amount`, `virtual_account`, `qr_payload`, `payment_code`, `payment_url`, `expires_at`, `error`), otherwise `null`. A provider failure still returns 201 with `payment: null` and a failed transaction row, so the order stays retryable through `/api/order-status`, the same contract as storefront checkout. Because the status is 201 and not 200, the envelope marks it `Cache-Control: no-store`. The API does not return a hosted confirmation URL: a Headless client owns its confirmation UI and must not navigate to the system's same-origin `/thanks` page.

On a hosted storefront, ad click IDs are read server-side from the first-party click-ID cookie and persisted with the order. A generic external headless storefront cannot rely on that cookie: the install did not receive the external landing query, and `/api/v1/checkout` has no trusted click-ID forwarding field. Cross-domain click-ID forwarding remains an explicit adapter/API gap.

Other failures: 409 `DUPLICATE_ORDER` (idempotent `submit_token` replay), the shipping-quote status/code passthrough, 422 `ORDER_INPUT_ERROR`, 500 `CHECKOUT_PROCESSING_ERROR`.

**This route never dispatches to a courier.** It persists an order; an operator dispatches it later.

### 4.8 `POST /api/v1/tracking/events`

`src/pages/api/v1/tracking/events.ts`. Methods: `POST`, `OPTIONS` only.

Payload is validated by `validateMetaEventPayload` (400 `INVALID_TRACKING_PAYLOAD`). If the store has no Pixel ID or no CAPI token the route returns **200** with `{ skipped: true, reason }` rather than an error — check `skipped`, not the status code. With D1 unavailable it returns 503 `DATABASE_UNAVAILABLE`.

**A `Purchase` resolves against D1 before anything is enqueued.** The `event_id`
*is* the order number (§7), so it is also the locator: the route reads that
order and takes the canonical `order_number`, the customer identity and
`product_value` from the row. An `event_id` naming no known order is **404
`PURCHASE_ORDER_NOT_FOUND`**. The API key authorises the ask; it does not
replace the lookup.

Until 2026-08-28 the route did none of that, and the consequence was total
rather than partial: `resolveMetaEventId` substitutes the order number for a
Purchase, nothing set it, and `sendMetaCapiEvent` therefore refused every
headless Purchase **before opening a connection to Meta** — enqueued, five
retries, `failed`, while this route had already answered `200 { queued: true }`.
A headless storefront's entire Purchase signal was discarded, and §8's checklist
could not detect it because the route reported success. If you integrated
against the old behaviour, nothing in your code changes; the events simply start
arriving.

Accepted events are written to the `capi_event_outbox` through `enqueueCapiEvent`. A repeated `event_id` returns 200 `{ deduplicated: true, event_id }` without re-sending. Otherwise the event is delivered immediately, the rest of the outbox is drained in the background via `waitUntil`, and the response reports `{ event_id, event_name, delivered, queued }`.

Client IP and user agent are taken **server-side** from request headers, not from the payload. `event_source_url` must match either the API origin or the already-validated Headless request origin; the server adapter sets `Origin` from that URL so an allowlisted external storefront preserves its real source without weakening the origin gate. Failure: 500 `TRACKING_SIGNAL_ERROR`.

### 4.9 `POST /api/v1/orders/status`

Requires scope `orders:read`. The JSON body must contain both `order_number` and
the matching `status_token` returned by Headless checkout. The response contains
only public order/payment state and recorded amounts/instructions; it excludes
name, phone, address, provider credentials, and internal ids.

### 4.10 Executable contract assets

- **Authenticated OpenAPI 3.1 contract:** `GET /api/v1/openapi.json` with a key carrying `storefront:read`.
- **Framework-neutral server adapter:** `src/lib/headless-client.ts` validates API envelopes and covers storefront bootstrap, catalog, shipping quote, checkout, token-scoped confirmation/status, tracking submission, and confirmation focus. `src/lib/headless-client.test.ts` executes the commerce journey through the real route handlers.
- The adapter is repository source, not a separately published npm package. A consuming storefront keeps its developer key server-side and imports or vendors this reviewed module.

---

## 5. Locked Form System

The install owns the form state machine and the mutation contract. A storefront chooses:

- CTA position and the surrounding section;
- form mode;
- canonical product and optional variant;
- a brand-safe wrapper and transition into the system form;
- confirmation presentation based on the returned order.

A storefront must not fork field meaning or validation, product/variant identity, price, stock, weight, shipping cost, COD rules, destination resolution, submit-token idempotency, the bot boundary, payment qualification, order persistence, Meta event identity, or any success/invoice/provider/shipping/waybill state.

### Middle form

Compact variant selection plus customer name, WhatsApp number, full address, COD method, and summary, persisted through the middle-order contract. Optimized for minimum direct-response friction. It still resolves the active D1 product/variant, cannot bypass server validation, and does not authorize courier dispatch.

### Full form

Variant, name, WhatsApp, address, district/city search, selected location identity, eligible shipping and payment options, summary, and full order persistence. Use when geography, shipping, COD eligibility, or online payment must be resolved before submit.

### Hybrid form

`src/lib/form-mode.ts` resolves trusted geo from Cloudflare `request.cf.regionCode`, then verified province-name and header fallbacks. A known province eligible under store policy renders **middle** mode. A province listed in `cod_disabled_province_codes`, or an unknown/unresolved province, renders **full** mode. Query parameters and route choice cannot override canonical commerce validation.

`cod_disabled_province_codes` is the merchant's store-level form-routing and COD policy, distinct from courier service exclusions. Admin presents all 38 Indonesian provinces. The default in `src/lib/province.ts` (`DEFAULT_COD_DISABLED_PROVINCE_CODES`) is **15 excluded provinces** — `PA`, `PB`, `PD`, `PT`, `PE`, `PS`, `MA`, `MU`, `NT`, `KU`, `SR`, `GO`, `KR`, `AC`, `BE` — mirrored by the `PUBLIC_COD_DISABLED_PROVINCES` var in `wrangler.jsonc`. A saved `stores` row overrides the default.

---

## 6. Ads, Attribution, and Consent

### Configuration owner

The `stores` row, edited under `/admin/ads/*`, owns the Meta Pixel ID, the masked Meta CAPI token, the Meta Test Event Code, the GTM container ID, and the Google Ads conversion ID/label pair. The CAPI token is server-only and must never reach a browser or a `/api/v1` response. Submitting a blank token in admin preserves the existing secret.

### Canonical Meta event map

| Event | Browser trigger | Server rule | Required identity |
| --- | --- | --- | --- |
| `PageView` | Eligible page load once the consent rule allows it | Optional CAPI mirror through the validated endpoint | Unique event ID when mirrored |
| `ViewContent` | Canonical product becomes the viewed product | Validate supported event and product payload | Numeric Product ID in `content_ids` |
| `AddToCart` | Qualified customer intent, never arbitrary scroll or click | Validate supported event | Product ID, value, currency, event ID |
| `InitiateCheckout` | Valid form submission begins | Validate supported event | Product ID, value, currency, event ID |
| `Purchase` | Only after the install confirms the qualifying order state | CAPI reuses the same Purchase event ID; unsupported or unqualified requests fail closed | Persisted order identity and canonical product ID |

Do not map page scroll, CTA impression, menu click, or form focus to `Lead` or `Purchase`.

### Deduplication

- Key the Purchase event ID on the order number (`INV-<n>`); never reuse a funnel event ID and never mint a random one.
- Browser Pixel and server CAPI must send the identical Purchase event ID. Both read it from the server-authoritative `order_number`, so an order that cannot be resolved emits no Purchase at all rather than a mismatched one.
- `/thanks` guards `Purchase_order_<order_id>` in the browser against refresh and revisit.
- COD Purchase requires a successfully persisted order. Online Purchase waits for authenticated paid reconciliation.
- Refreshing or revisiting confirmation must not emit another Purchase for the same order.
- Server-side, `capi_event_outbox` deduplicates on `event_id` and retries delivery.

### Product identity

`content_ids` is the decimal **Product ID** returned as `content_id` by
`/api/v1/products`. It has at least five digits and is the same string both
catalog feeds publish as `<g:id>`. A selected variant remains a separate raw
`variant_id`; never substitute that row ID, a slug, SKU, array index, or provider
ID for the Product ID. Storefront events, CAPI, Google ecommerce, and connected
catalogs must agree exactly.

**Changed 2026-08-18.** ADR-017 supersedes the earlier variant-grained
`p{product}-v{variant}` contract. Existing external catalogs need a coordinated
refresh when this change is deployed.

### Attribution and matching

- Preserve `_fbp` and `_fbc` as raw Meta browser identifiers; never SHA-256 hash them.
- Normalize phone to the accepted Indonesian international form before hashing.
- Trim and normalize names before hashing Advanced Matching fields.
- Keep client IP and user agent server-derived.
- Preserve `gclid`, `gbraid`, and `wbraid` through the order handoff.
- Never place raw customer data, CAPI tokens, or payment data in URLs, logs, `localStorage`, `dataLayer`, or public configuration responses.

### Consent boundary

Define the applicable consent behaviour before loading optional browser tags. Tracking must never block checkout. Consent state, tag load, browser event, install acceptance, Meta API acceptance, attribution, and ad-platform reporting are seven separate facts — prove each one separately. A completed cross-storefront consent adapter does not exist; see `UNIMPLEMENTED_SPECS.md`.

### Verification checklist

1. Confirm the Pixel ID belongs to this install; never inspect or expose the CAPI token in browser output.
2. Inspect the browser network tab and `dataLayer` for the exact route and event.
3. Confirm `content_ids`, `value`, `currency`, and event name match D1 facts.
4. Confirm browser and CAPI Purchase share one event ID.
5. Confirm `_fbp`/`_fbc` are preserved un-hashed when present.
6. Confirm refresh and revisit do not duplicate Purchase.
7. Confirm the COD and online Purchase gates differ correctly.
8. Use Meta Test Events only with an operator-provided test code and explicit outbound-call approval.
9. Record local validation separately from live Meta acceptance and attribution.

---

## 7. Brand Contamination Guardrail

This repository was re-founded from a prior deployment. Most of the inherited
identity is gone; what remains is listed here, and `src/lib/brand-contamination.test.ts`
now fails the build on two axes: if the reference store's brand re-enters `src/`
or `public/` as text, and if any top-level entry under `public/images/` is
referenced by nothing. The second exists because a `.webp` carries no matchable
text — the demo store's wordmark shipped as `logo.webp`, hardcoded in eight
places, alongside 500 unreferenced files of a former merchant's photography. That guard exists because this leaked five times on five
surfaces that each looked like the last one: the login artwork, the login card's
logo, the storefront wordmark, the favicon every admin page loads, and
`robots.txt`, which handed every merchant's crawler someone else's sitemap.

The rows below are load-bearing strings, not comments — renaming one changes
runtime behaviour and will silently break attribution for in-flight sessions:

| Path | What it is | Consequence of a careless rename |
| --- | --- | --- |
| `src/lib/click-ids.ts` | `CLICK_ID_COOKIE = "adsbook_click_ids"`, with `LEGACY_CLICK_ID_COOKIE` read-only | Renamed 2026-08-16 with a read fallback, so no in-flight attribution was lost. Delete the fallback only after 90 days from deploy |
| `src/lib/checkout-navigation.ts` | Reads the `adsbook_click_ids` `sessionStorage` key | Writer and reader ship in one page load, so no migration window was needed |
| `src/pages/admin/ads/google.astro` | Documents the Google Ads conversion name `Zanoby Purchase` | Operator-facing copy that references a conversion action **configured in a Google Ads account**; changing the docs does not rename the conversion action |

Do not relabel these opportunistically while doing unrelated work. Renaming the cookie is a deliberate migration: change the constant, both embed writers, and the reader together, and accept that click IDs captured under the old name are lost unless a dual-read fallback ships first.

One further contamination, non-blocking: `src/lib/meta-event-contract.test.ts` documents Zanoby catalog IDs. That is a test fixture — no runtime effect. The `petanisejahtera.com` fixture was removed.

---

## 8. Order and Fulfillment Handoff

Every storefront ends at the same lifecycle:

1. The install validates and persists the order with `shipping_status = pending`.
2. Order Management owns customer, destination, payment, warehouse, courier, and rate verification.
3. Explicit operator confirmation moves the order to `processing` **without** calling Mengantar.
4. Dispatch is an explicit single or checklist bulk Push from `/admin/orders`.
5. Mengantar order creation runs sequentially under a `provider_dispatch_locks` lease and returns per-order outcomes.
6. Provider identity and `cnote_no` are stored only from accepted responses.

No storefront may dispatch Mengantar during checkout, infer a waybill, or skip operator confirmation.

---

## 9. Acceptance Criteria for a Storefront Integration

An integration is complete only when:

- the storefront and its target install are named explicitly;
- public storefront routes stay owned by the storefront; system routes are never forked;
- checkout entry points emit the canonical `/hybrid-form`, `/middle-form`, `/full-form` — legacy `/form-*` aliases are not exposed to users, and `/api/v1/products*` never emits a legacy `/form-*` URL, so there is nothing for a client to rewrite;
- no Zanoby, Petani Sejahtera, or other prior-merchant content, cookie name, or conversion label is introduced into new code;
- product and variant data comes from `/api/v1/products` and `/api/v1/products/[slug]` (external) or `src/lib/catalog.ts` (built-in) — never from a fixture, a copied JSON blob, or a manually maintained parallel catalog;
- the developer API key is stored as a server-side secret in the storefront and never shipped to the browser;
- location, rate, payment, submit, status, and confirmation failure states are all exercised, including 401, 403, 429, and 422 from the Headless API;
- known-eligible, COD-disabled, and unknown-province outcomes match server policy;
- the chosen middle/full/hybrid form preserves canonical validation;
- Meta browser events use the correct config, IDs, values, event IDs, and Purchase gate;
- mobile and desktop journeys have no page-level horizontal overflow, no inaccessible controls, and no silent errors;
- the repository's own checks pass;
- remote migration, deployment, provider calls, test events, and data imports are reported separately and never performed without explicit approval.

### Verification commands

There is no dry-run script. The real gates, in the order CI runs them (`.github/workflows/ci.yml`):

```bash
npm test          # node --test over src/lib/*.test.ts
npm run check     # astro check && tsc --noEmit
npm run build     # astro build
```

A green build is not proof the customer journey works. For any browser-visible change, open the page and exercise the path. Pushing to `main` in the **product** repository deploys nothing (ADR-012, `RELEASE.md` §1); ADR-008 describes an install repository and is superseded here.

---

## 10. Reusable Brief: Build an AdsBookCMS-Integrated Storefront

```text
You are implementing a production storefront against an AdsBookCMS install — a single-Worker
direct-response commerce CMS that owns catalog, checkout, payment, logistics, and tracking.
The storefront may use any framework, repository, host, or domain. Adapt to the target
repository's installed stack; never assume Astro, React, or Next.js.

INPUTS
- TARGET_REPOSITORY: <path or URL>
- ADSBOOKCMS_ORIGIN: <https origin of the install, e.g. https://permatamall.shop>
- ADSBOOKCMS_API_KEY: <developer API key, server-side secret only>
- STOREFRONT_DOMAIN: <exact domain — must be on the install's headless origin allowlist>
- MERCHANT_NAME / LOCALE / CURRENCY: <verified values>
- JOURNEY: catalog | direct-response | mixed
- APPROVED_BRAND_ASSETS_AND_COPY: <paths or source>

NON-NEGOTIABLE BOUNDARIES
1. Inspect the target repository, its package scripts, routing, and deployment config before
   editing. Reuse its framework and components. Do not add a dependency for what native code
   or an installed package already does.
2. The storefront owns presentation, navigation, merchandising, accessibility, legal pages,
   and responsive layout. The install owns product and variant identity, price, stock, weight,
   location resolution, courier eligibility, shipping quotes, payment eligibility, order
   persistence, tracking identity, and the Order Management -> dispatch lifecycle.
3. The API key is a server-side secret. Proxy /api/v1 calls through the storefront's own
   server. Never put the key in client JavaScript, a public env var, or a URL.
4. Never deploy, migrate remote D1, write production data, change DNS, rotate secrets, send
   Meta test events, or call Mengantar without explicit operator approval.
5. Do not invent products, testimonials, claims, discounts, stock, shipping rates, payment
   availability, Pixel IDs, or API fields. A failing endpoint is a blocker, not permission to
   ship a fixture.
6. No decorative or scroll-dependent animation. The purchase path must work with keyboard
   navigation, visible focus, 44px touch targets, 16px mobile inputs, reduced motion, and no
   horizontal overflow.

DATA AND COMMERCE INTEGRATION
1. Bootstrap identity and tracking config from GET /api/v1/storefront. Treat the response as
   runtime data and honour its cache policy; store identity can change in D1 without a redeploy.
2. Render the catalog from GET /api/v1/products and GET /api/v1/products/[slug]. Use the
   numeric product `content_id` in ads `content_ids`; use each variant's raw `id` only as `variant_id`.
3. Use only the canonical `/hybrid-form`, `/middle-form`, and `/full-form` routes. The API never returns legacy `/form-*` URLs.
4. Resolve destinations with GET /api/v1/geo/districts and quote with
   GET|POST /api/v1/geo/shipping-rates. Re-quote before submit; never trust a cached price.
5. Submit with `POST /api/v1/checkout`, echoing the quote's `warehouse_id`. Handle 401, 403, 422, 429, and 409 distinctly.
   On 201, persist only the returned identifiers needed by the storefront and render its own
   confirmation state. Checkout is never courier dispatch.
6. Do not send a Headless customer to `/thanks` or `/payment`; both are same-origin hosted
   checkout surfaces backed by session state. Read confirmation state with
   `POST /api/v1/orders/status` using the returned `order_number` and `public_status_token`.
7. Render honest loading, empty, unavailable, out-of-stock, error, and retry states. An empty
   catalog response may mean a backend failure — never present it as "no products" silently.

TRACKING
- Emit PageView, ViewContent, AddToCart, InitiateCheckout, and Purchase only at their
  documented lifecycle points. A click, scroll, focus, or impression is not a Purchase.
- Mirror server-side events through POST /api/v1/tracking/events. A 200 with skipped:true
  means tracking is unconfigured, not that the event succeeded.
- Use one unique event_id per event and the identical Purchase event_id on browser and server.
- Preserve _fbp and _fbc unhashed. Preserve gclid, gbraid, and wbraid through the handoff.
- Implement the merchant's consent behaviour before optional tags load. Tracking failures must
  never block checkout.

DONE WHEN
- Catalog and product pages are dynamic and canonical, with no duplicated fixtures.
- Canonical form routes are reached directly, with no legacy /form-* hop.
- Eligible, COD-disabled, and unknown-province behaviour matches server policy.
- Payment, courier, totals, order persistence, confirmation, and fulfillment handoff preserve
  backend authority.
- Meta/Google identity, consent, and Purchase deduplication match this document without
  exposing secrets.
- Desktop and mobile browser evidence covers the complete customer path.
- npm test, npm run check, and npm run build pass in the storefront repository's equivalent.
- No remote mutation or deployment was performed without explicit approval.
```
