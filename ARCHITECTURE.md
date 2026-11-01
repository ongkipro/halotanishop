# AdsBookCMS — System Architecture

> **Product:** AdsBookCMS (single) — a self-contained direct-response commerce CMS that installs onto Cloudflare Workers.
> **Install model:** **1 installer = 1 Worker = 1 store.** Isolation comes from the deployment boundary, not from request-time tenant routing.
> **This repository:** the product. It deploys nothing; each install deploys from its own repository against its own resources.
> **First install:** `permatamall.shop`, in the separate `ongkipro/permatamall` repository, carrying its own catalogue in its own database. Its `cmsads-*` resource names are legacy and deliberately not renamed.
> Verified against disk: 2026-10-31 @ `7a8f26e` + fix/ui-actions-audit (§3 tables, migration chain and payment retry; §7 quote origin; remaining sections retain their recorded evidence); feeds row re-verified 2026-10-31 @ `83534ef` + feat/payment-copy-ux

This document describes what the system **actually is**. Where the intended AdsBookCMS product differs from what ships today, the gap is stated explicitly in §10 rather than written as if it were already true. Code and executable evidence win over this document; when they disagree, fix the document.

---

## 1. Install Model

An AdsBookCMS install is one Cloudflare Worker with its own private resources:

| Resource | Binding | Instance value (reference deployment) |
| --- | --- | --- |
| Worker | — | one per install, named by that install |
| D1 database | `OMS_DB` | one per install |
| KV namespace | `SESSION` | caches only — COD-province policy, alert transition state; every write is best-effort (ADR-021). Kecamatan → Mengantar area lookups moved to D1 `mengantar_areas` (PRD A43) |
| R2 bucket | `ASSET_BUCKET` | product uploads + CMS media |
| Workers AI | `AI` | optional platform binding; not used by the public content workflow |
| Static assets | `ASSETS` | `dist/client`, served by the Cloudflare adapter |

A new install is normally created by the **Deploy to Cloudflare** button, which copies this repository into the operator's GitHub account and provisions these resources there (ADR-026); the terminal path in `INSTALLATION.md` creates the same set by hand.

There is **no `env.<tenant>` block** in `wrangler.jsonc` and `definedEnvironments` in the built config is empty. One repository checkout deploys exactly one store. A second store means a second install: separate Worker, separate D1, separate bucket, separate domain.

**Why single-install instead of shared multi-tenant.** A shared runtime would require every query, cache key, session key, R2 object key, webhook lookup, and provider credential to carry a verified store scope. Today the data layer legitimately assumes one logical merchant (`SELECT ... FROM stores ORDER BY id LIMIT 1` is the canonical store read). Cloudflare also does not allow selecting a D1 binding from request input, so "one Worker, many databases" is not available without Workers for Platforms. The platform boundary is therefore the isolation boundary. See `DECISIONS.md` ADR-001.

---

## 2. Runtime Topology

```mermaid
flowchart TD
    V[Visitor] --> CF[Cloudflare edge · the install's domain]
    CF --> MW[src/middleware.ts]
    MW --> SSR[Astro SSR routes]
    MW --> API[/api/* endpoints/]
    SSR --> D1[(D1 · OMS_DB)]
    API --> D1
    SSR --> R2[(R2 · ASSET_BUCKET)]
    MW --> KV[(KV · SESSION)]
    API --> MG[Mengantar 3PL]
    API --> AL[AutoLaris payments]
    API --> META[Meta CAPI]
    API --> AI[Workers AI]
```

Every route is server-rendered: `astro.config.mjs` sets `output: 'server'` with the Cloudflare adapter. Nothing is prerendered, which is why the sitemap is hand-authored at `src/pages/sitemap.xml.ts` instead of using `@astrojs/sitemap`.

### Middleware responsibilities (`src/middleware.ts`)

Runs on every request, in order: canonical host redirect (`www` → apex), ad click-ID capture into first-party cookies, admin session validation against `admin_sessions` joined to `admin_credentials` in one D1 query (ADR-021), role-based admin route policy, same-origin enforcement on unsafe admin API methods, and the embed frame policy (replaces `X-Frame-Options: DENY` with a `frame-ancestors` CSP built from `stores.embed_allowed_origins`, failing closed to an empty allowlist on database error).

---

## 3. Route Surface

> The table below is a summary and has drifted before — it said `/admin/*` was
> 27 pages when there were 28, and §4 described a 41-file migration chain that
> was already 52. **`docs/ROUTE-MAP.md` and `docs/route-map.xml` are the map to
> trust**: `npm run route-map` derives the routes from `src/pages/` with
> their files, HTTP verbs, auth boundary and the roles `canAccessAdminRoute`
> actually admits, and `src/lib/route-map.test.ts` fails when the committed map
> and the filesystem disagree.

| Family | Entry points |
| --- | --- |
| Storefront | `/`, `/produk`, `/produk/[slug]`, `/404`, `/thanks`, `/payment` |
| Content pages | `/tentang`, `/kontak`, `/testimoni`, `/sitemap`, `/disclaimer`, `/kebijakan-privasi`, `/kebijakan-cookie`, `/syarat-ketentuan`, `/pengiriman` |
| Landing pages | `/[slug]` — catch-all resolved from D1 `landing_pages`; falls back to a `301` to `/produk/<slug>` (query string kept, cached five minutes) when the slug is a product, else 404. Supports `?preview=1` behind an admin session |
| Checkout forms | `/hybrid-form`, `/middle-form`, `/full-form`, `/geoipform`, `/embed/form`. `/form-hybrid`, `/form-middle`, `/form-full` are query-preserving 308 redirects that **do** exist |
| Feeds | `/sitemap.xml` (`src/lib/sitemap.ts`), `/feed/google-catalog.xml`, `/feed/meta-catalog.xml`, `/robots.txt` (dynamic, `src/pages/robots.txt.ts`), `/llms.txt` (`src/lib/llms-txt.ts`) — for a `PUBLIC_SITE_NOINDEX` store the sitemap is empty, `/llms.txt` answers 404 and robots drops its `Sitemap:` line but keeps crawling open so `noindex` is seen; the catalog feeds are unaffected (ads still need them) |
| Media | `/assets/[...key]` (R2 `uploads/` prefix), `/media/[...key]` (R2 `content/` prefix) |
| Admin | `/hello` (login), `/admin/*` — see generated route map for the page inventory |
| Public API | `/api/*` — checkout, locations, shipping rates, payment methods, order status, Meta events |
| Headless API | `/api/v1/*` — storefront descriptor, products, geo, shipping rates, checkout, tracking events |
| Admin payment reconciliation | `/api/admin/payment-reconciliation` |
| Insights (A37 backend, not yet released) | `/api/admin/insights/{landing,trend,products,locations,times}` — owner/admin/advertiser only, aggregates, bounded 90-day Jakarta period, one D1 batch per request; `order-metrics.ts` shares revenue rules with dashboard. No-store follows admin middleware. Five `/admin/analytics/*` pages share InsightsPage/InsightsReport; trend alone imports the lazy chart. UI acceptance remains A-357–A-362 (browser blocked). |

The headless `/api/v1/*` family is **implemented and shipping**, authenticated by `X-App-Key`/`Bearer` against the `developer_api_keys` table (`src/lib/headless-api.ts`) plus an origin allowlist. Keys are issued at `/admin/settings/developer`.

---

## 4. Data Layer

D1 is the only persistent store for operational state. **All runtime data access is raw `D1Database.prepare()` / `.batch()`**. There is no ORM and no schema-generation step: Drizzle was removed on 2026-08-16 (ADR-005), so `src/db/migrations/*.sql` is the only description of the schema in the tree.

### Tables (34)

`stores` · `warehouses` · `products` · `product_variants` · `orders` · `order_items` · `order_number_counters` · `courier_rules` · `pickup_schedules` · `admin_credentials` · `admin_sessions` · `rate_limits` · `payment_transactions` · `payment_transaction_attempts` · `payment_reconciliation_audits` · `autolaris_callbacks` · `storefront_content` · `storefront_templates` · `provider_dispatch_locks` · `seller_bank_accounts` · `capi_event_outbox` · `google_ads_conversion_outbox` · `developer_api_keys` · `developer_api_key_usage` · `headless_api_audit_events` · `landing_pages` · `landing_sections` · `notifications` · `notification_reads` · `install_secrets` · `plugins` · `whatsapp_numbers` · `ops_health_snapshot` · `mengantar_areas`

`order_items.weight_grams` (migration `0070`) is the unit weight a line was quoted with, copied from `product_variants` at checkout and at CS lead conversion. Every reader of an order's shipped weight — Mengantar dispatch, the order detail API, the Kelola plugin — reads `COALESCE(oi.weight_grams, pv.weight_grams)`; NULL means a line written before the column existed. Catalogue and quote readers still use `product_variants.weight_grams`.

`warehouses` holds up to ten rows (`src/lib/warehouses.ts` is their writer). Exactly one is `is_primary` (a partial unique index) and it cannot be made inactive; `is_active = 0` takes a row out of every new quote; `served_provinces` is a JSON array of province codes, NULL meaning the row's own province. A row with orders or pickups is never deleted. `orders.warehouse_id` records the quote's warehouse, and dispatch and the pickup schedule read it. Screens that show one warehouse show the primary.

`stores` is a single-row table that carries the runtime-editable half of the configuration: provider keys and base URLs, tracking IDs, fee-bearer policy, payment toggles, CRM templates, embed origins, AI content instructions, and COD province exclusions.

`ops_health_snapshot` (A39) is a single-row (`CHECK (id = 1)`) operational status row. The hourly cron writes the snapshot columns last (`writeHealthSnapshot`, `src/lib/health-snapshot.ts`) and stamps `scheduler_ran_at` first (`recordSchedulerRun`, `src/lib/operational-health.ts`; it replaced a KV write per hour, A-379); `POST /api/admin/health/check` rewrites the snapshot but never the heartbeat. The admin status icon and `/admin/status` read this one row and never collect health per page view; staleness is either clock older than 120 minutes (`staleReason`): `scheduler_ran_at` ("pemeliharaan berhenti"), so a manual check cannot mask a stopped cron, or `taken_at` ("status tidak diperbarui"), so a failing snapshot write behind a fresh heartbeat cannot pass old signals off as current.

Trigger `product_variants_stock_nonnegative` (migration `0003`) still exists and would raise `INSUFFICIENT_STOCK` on a negative stock write, but it is inert: since ADR-023 nothing reads, reserves, decrements or restores stock, so nothing can trip it.

### Migration chain

78 files, `0000`–`0077` (ADR-024 gave the product sole ownership of the
numbering after three different `0051` files appeared across the fleet). The Worker bundle contains the exact checked-in SQL and applies any missing suffix automatically before serving a database-backed request. Each migration's SQL statements and `d1_migrations` claim row execute in one D1 batch; concurrent requests serialize on the claim, re-read history, and continue without double-applying. `wrangler d1 migrations apply OMS_DB` remains an optional operator preflight, not the runtime correctness boundary. Migration `0040` adds provider status text, provider event time, and synchronization time to `orders`.

**Migrations are hand-authored.** There is no generator to keep in sync, which is deliberate: the schema contains data-integrity triggers, ordered indexes, CHECK constraints, and data migrations that a schema generator cannot represent safely.

### `orders.source_slug` — where an order or a lead came from (A36)

`orders.source_slug` (migration `0068_order_source_slug.sql`) is a `VIRTUAL` generated column over `source_page_path`: the last
path segment, query and hash cut, trailing `/` stripped, ASCII lower-cased, at
most 80 characters; `/` is `beranda`, empty or NULL stays NULL and reads
"(tidak tercatat)". SQLite computes it on read, so rows older than the
migration have it too and no order or lead write path fills it. Index
`idx_orders_source_slug_created (source_slug, created_at)` serves the source
filter on `/admin/orders` and the abandoned-lead list. `src/lib/source-slug.ts`
mirrors the expression for labels, and `source-slug.test.ts` runs the SQL and
the function over the same paths. Applied on local D1 through the Worker's own
claim-plus-statements batch on 2026-10-29, `PRAGMA optimize` included; remote D1
not yet exercised.

**The slug is the last segment only, so `/produk/kopi` and a landing page at
`/kopi` are one source, `kopi`.** That is deliberate: a product page a landing
has claimed is the same offer, and one name per offer is what the lists and A37
rank by. `resolveSourceLabels` resolves the name, landing title first, then a
native page, then the product title, then the slug itself, so the operator
sees one label rather than two rows for the same slug. Two genuinely different
pages that share a last segment are counted together; the full path stays in
`source_page_path` and the chip's `title`.

---

## 5. Configuration Resolution — the sharpest edge in the system

Configuration comes from **three independent sources** that are easy to mistake for one:

| Source | Read path | Changes take effect after |
| --- | --- | --- |
| **D1 `stores` row** | `readStoreIdentity` → `resolveTenantConfig` in `src/lib/tenant.ts` | immediately |
| **Worker runtime env** | `getRuntimeEnv(locals)` in `src/lib/env.ts` | deploy (no rebuild needed) |
| **Build-time bundle** | `import.meta.env`, via `envTenantConfig` | `astro build` + deploy |
| **D1 `stores` row (provider half)** | `provider-config.ts`, `store-ads.ts`, `public-store.ts` | immediately |

Identity resolves **row first, env second, product default last**. Middleware reads
the `stores` row once per request and puts the resolved config on
`Astro.locals.tenant`, so the 125 consumers stay synchronous (ADR-003). The
`PUBLIC_SITE_*` vars are the fallback for a store that has not set a field, and
they do reach the bundle: `import.meta.env` is frozen by Astro at build time and
both `wrangler.jsonc` `vars` and a local `.env` feed it — verified by changing a
var in `wrangler.jsonc` alone and observing the new value in
`dist/server/chunks/env_*.mjs`.

> §5 previously described identity as baked into the bundle, and stated that
> `stores.name` and the resolved name were *different values*. That was true
> before migration `0036` and gap G1's closure, and it contradicted §10 four rows
> below. It also named a symbol, `tenantConfig`, that does not exist; the exports
> are `resolveTenantConfig`, `envTenantConfig`, `readStoreIdentity` and
> `loadStoreIdentity`.

Things to understand before touching identity:

- Renaming the store in `/admin` moves every storefront `<title>`, header,
  footer, JSON-LD and OG tag on the next request. No rebuild.
- `slug` resolves from `stores.slug`, then `"adsbook"`.
  The install wizard writes it per install. It is diagnostic only.
- An unknown `PUBLIC_STOREFRONT_TEMPLATE` **no longer throws**. It logs
  `tenant-malformed-storefront-template` and degrades to `compact-market`;
  `tenant.test.ts` asserts exactly that. It used to throw at module load, which
  in a Worker meant every route returned 500.
- `theme_color`, `locale` and `admin_name` have no admin editor yet. The store
  settings screen edits six fields: name, site_url, description, tagline, logo,
  storefront_template.

Provider credentials follow a **D1-first, env-fallback** rule: a key saved in the admin dashboard wins over the deployed secret, and `provider-config.ts` reports which one won as `source: "dashboard" | "server" | "none"`.

---

## 6. Authentication and Access

Session is a signed JWT in the `adsbook_session` cookie (`SESSION_COOKIE_NAME` in `src/lib/auth.ts` — the single source for the name), verified in middleware against an `admin_sessions` row joined to the `admin_credentials` row in one D1 query (`src/lib/admin-session.ts`, ADR-021). `admin_credentials.updated_at` doubles as a session revision: rotating a credential invalidates existing sessions. Public rate limits (`src/lib/rate-limit.ts`) count in the `rate_limits` table with one atomic upsert per spend; a store failure fails open and is logged as `rate-limit-store-failed`. Roles are defined in `src/lib/auth.ts` (`ADMIN_ROLES`) and enforced per route by `canAccessAdminRoute`.

The login route is `/hello` rather than `/admin/login`, and `robots.txt` — served from `src/pages/robots.txt.ts`, not a static file —
disallows `/admin/`, `/api/`, `/embed/`, `/hello` and `/install` **inside every
user-agent group**. Per RFC 9309 a crawler obeys only its most specific matching
group, so the named groups for Googlebot, Bingbot and the AI crawlers each need
their own copy; when they held nothing but `Allow: /`, those six crawlers saw no
disallows at all.

`src/lib/auth.ts` is covered by `src/lib/auth.test.ts` — 15 tests over signing,
verification, claim validation, role routing and the middleware gate itself,
including the normalized-path shapes that once walked past it.

> This paragraph used to read "currently has **no test coverage** … the
> highest-risk untested module in the repository", while that suite sat beside
> it. Believing it invites either a redundant second suite or an edit to
> `auth.ts` made on the assumption that nothing would catch it.

---

## 7. Commerce Flow

1. **Catalog** — `products` + `product_variants` in D1 carry identity, price, weight, and stock. `src/lib/catalog.ts` merges those operational rows with published presentation JSON from `storefront_content`.
2. **Form** — `/hybrid-form` resolves COD eligibility from trusted Cloudflare geo; a known eligible province routes to the middle form, a disabled or unknown province routes to the full form (`src/lib/form-mode.ts`).
3. **Rates** — the form's district is resolved to a Mengantar area by `/api/locations?level=resolve`, which answers from `mengantar_areas` (`src/lib/mengantar-areas.ts`) before asking Mengantar: one row per district|city|province, seeded from the store's own orders and filled by live resolves (exact district matches only), each answering for 30 days from `resolved_at` before it is resolved again. A stored row answers even when Mengantar is not configured. `/api/shipping-rates` then quotes Mengantar live for that destination, filtered by `courier_rules` and store-level COD province exclusions; rates are never stored. The quote's origin is one warehouse (ADR-032, `src/lib/shipping-quote.ts` → `src/lib/warehouse-choice.ts`): among active, ready rows (Mengantar origin and pickup address both set), the one serving the buyer's province (derived from the city via the bundled district index), else one on the same island group, else the primary. One rate call per quote, plus one from the primary when a warehouse the quote chose (not one named by `warehouse_id`) fails or returns no usable rate (REQ-270; headless checkout fails closed instead). A store with one warehouse always quotes from it.
4. **Submit** — `/api/submit-order` persists order and items atomically. It is rate-limited, honeypot-guarded, and idempotent via `submit_token`. **Checkout never dispatches to the courier.**
Stock is not part of this flow: a variant is sellable when it is active and priced, and no step reads, reserves, or returns a counter (ADR-023).

5. **Payment** — online orders create one AutoLaris payment through `POST /api/h2h/create_payment`. AutoLaris is a payment gateway here and nothing else: shipping belongs to Mengantar, so no origin, destination, courier, weight, or parcel detail is sent, and the combined shipping-and-payment path `POST /api/h2h/submit` is deliberately unused. A failed or expired instruction is regenerated on the buyer's request through `POST /api/order-status` (`retry_payment`), reusing the order's single `payment_transactions` row while the replaced instruction's provider id is kept in `payment_transaction_attempts` (migration `0076`), so a late payment on it still settles through Advice or manual reconciliation; `expired` is derived from `expires_at` at read time (`effectivePaymentStatus`). Provider callbacks to `/api/webhooks/autolaris` are recorded verbatim in `autolaris_callbacks` and acknowledged — they never move payment state (ADR-022). A manual paid confirmation enqueues the server-side Meta Purchase from the order row (`src/lib/paid-order-purchase.ts`). The adapter sends the buyer's payment identity and the fee-policy amount from D1, and enforces the three provider constraints that return an undifferentiated `Invalid parameter`: a digits-only `reff_id` derived from the order number, a non-empty `customer_id`, and a non-empty `callback_url`. That callback URL is `/api/webhooks/autolaris`, which records the delivery and answers `200` (ADR-022). Payment truth comes from two paths: the hourly job asks the provider's Advice endpoint (`reconcileAutoLarisPaymentStatuses`) and marks paid only on `rc:"00"` with an allowlisted settlement word (ADR-025), and the owner/admin manual-reconciliation boundary — exact amount/reference re-entry, explicit acknowledgement, immutable actor/status snapshots, and one atomic idempotent transition. A manual transfer (seller's own bank account) is marked paid by the operator from the order detail. The public payment page reads that D1 state and redirects to `/thanks`; neither confirmation nor its one-minute queue refresh dispatches shipment.
6. **Dispatch** — an operator explicitly pushes eligible orders to Mengantar from `/admin/orders`, each from the pickup address of its own `orders.warehouse_id`. Requests run sequentially under a `provider_dispatch_locks` lease. Only an accepted provider response moves an order to `processing`.
7. **Provider status synchronization** — `/admin/shipping` explicitly polls Mengantar `GET /order?tracking_id=<cnote_no>` through the configured server-side client. Eligible rows are processed sequentially; raw provider status evidence is persisted, and only monotonic lifecycle advances pass through the shared atomic order-lifecycle boundary.
8. **Ad tracking** — browser Pixel plus server-side Meta CAPI through `capi_event_outbox`, a durable transactional outbox with retry and a shared per-order `event_id` for deduplication.

---

## 8. Content Management

Two independent content systems:

- **Storefront content** (`storefront_content`) — legacy draft/published presentation records remain preserved for migration compatibility. Public homepage availability no longer depends on a published home record; active catalog rows remain the authority for product identity, price, stock, and listing.
- **Landing pages** (`landing_pages` + `landing_sections`) — an ordered section builder with bounded `headline`, `paragraph`, `numbered_list`, `bullet_list`, `image`, legacy `html`, and `form` types, rendered by the `/[slug]` catch-all.

Missing optional homepage content falls back to a neutral catalog composition.
The current `admin/content` JSON/AI workbench is retired from navigation; A18
defines its replacement as a bounded field editor for banner, slider, and copy.
content. No compiled or generated merchant-facing fallback copy runs in that path.

---

## 9. Build and Release

```
this repo:   push to main → .github/workflows/ci.yml → npm ci → npm run check → npm test → npm run build → stop
an install:  push to main → its own deploy workflow → …same gates… → npx wrangler deploy → live traffic
```

**This repository deploys nothing.** CI runs check, test and build. Deployment happens from an install's own repository, against that install's Worker and database, and pushing to `main` there is what reaches live traffic. Release detail lives in `RELEASE.md`.

Local verification, in the order CI runs it:

```bash
npm test          # node --test over src/lib/*.test.ts
npm run check     # astro check && tsc --noEmit
npm run build     # astro build
```

npm is authoritative (`package-lock.json`, `npm ci` in CI). This is a single-package repository; the pnpm workspace stub and its stale lockfile were removed on 2026-08-16 and neither file exists.

---

## 10. Gap Register — what AdsBookCMS still needs

These rows record the original architecture gaps and their closures. **No item in
this register remains open.** Remaining audited defects and blocked provider work
live in `UNIMPLEMENTED_SPECS.md`.

| # | Gap | Why it blocks the installer | Primary surface |
| --- | --- | --- | --- |
| ~~G1~~ | ~~Identity is build-time~~ | **Closed 2026-08-16.** Migration 0036 moved identity into `stores`; middleware resolves it once per request onto `Astro.locals.tenant`; `/admin/settings/store` edits six of the nine fields (`theme_color`, `locale` and `admin_name` have no editor yet) without a rebuild | `src/lib/tenant.ts`, `src/middleware.ts` |
| ~~G2~~ | ~~No `/install` wizard~~ | **Closed 2026-08-16.** A migrated database with no store row routes to `/install`; the wizard writes identity and the operator's credential in one batch and then refuses to run again | `src/pages/install.astro`, `src/lib/install.ts` |
| ~~G3~~ | ~~No schema auto-upgrade~~ | **Closed 2026-08-17.** The Worker embeds the checked-in chain and atomically applies its missing suffix before database-backed requests; invalid, unknown, or ahead history fails closed | `src/lib/schema-version.ts`, `src/lib/bundled-migrations.ts`, middleware |
| ~~G4~~ | ~~Sample product is another merchant's~~ | **Closed 2026-08-16.** Migration `0034` removes the foreign row under identity and order-reference guards; the immutability concept was dropped rather than repointed, since the demo catalog already serves the purpose and is fully editable | `src/db/migrations/0034_remove_foreign_sample_product.sql` |
| ~~G5~~ | ~~Home shell falls back to built-in copy~~ | **Closed 2026-08-17.** Missing published home content returns `setup-required`; the built-in home and Headless descriptor expose an explicit setup state without compiled merchant copy | `src/lib/tenant-content.ts`, `src/pages/index.astro`, `src/pages/api/v1/storefront.ts` |
| ~~G6~~ | ~~Theme set is compile-time~~ | **Closed 2026-08-17.** Migration `0039` adds editable D1 template definitions; built-in layouts render runtime composition and operator-created definitions require no rebuild | `src/lib/storefront-template.ts`, `/admin/settings/store` |
| ~~G7~~ | ~~Partial observability with no alerting~~ | **Closed 2026-08-17 for actionable per-install alerts.** The scheduled Worker evaluates schema and CAPI outbox health, persists transition state in KV, and sends deduplicated firing/recovery webhook events without commerce payloads. External uptime and cross-install aggregation remain separate product decisions | `src/lib/operational-alerts.ts`, `src/worker.ts`, `OBSERVABILITY.md` |
| ~~G8~~ | ~~Drizzle journal broken~~ | **Closed 2026-08-16.** Drizzle retired rather than repaired: its snapshots could not represent the stock trigger, so a repaired generator would have emitted SQL that silently dropped a data-integrity guarantee (ADR-005) | — |
| ~~G9~~ | ~~Meta Purchase deduplication is broken~~ | **Closed 2026-08-16.** Both legs now key on the `INV-` order number. Historical data stays inflated — Meta offers no retroactive merge | `src/components/storefront/tracking/MetaThanksTracker.astro` |
| ~~G10~~ | ~~Embedded checkout fired Purchase before verified confirmation~~ | **Closed 2026-08-16.** Embedded forms now send only a constrained completion-navigation message; the parent navigates to the same verified `/payment` or `/thanks` flow, whose browser and CAPI legs share the order number as `event_id` | `src/lib/embed-markup.ts`, `src/lib/checkout-navigation.ts` |

**One caveat on G7, now closed.** Its original closure covered schema and the
**Meta** CAPI outbox only. The Google Ads offline outbox (migration `0048`)
arrived afterwards with no health signal and no alert, which is why a
head-of-line block stopped Google uploads while the hourly cron logged
`queuedGoogleAdsConversions: 0` (BUILD-LOG 89). A-227 added the
`google-ads-outbox` health signal; the 2026-09-25 audit added the matching
`OperationalAlertId`, so a stalled or terminally failing Google queue now fires
the same webhook the Meta queue does.

---

## 11. Non-Goals

- Request-time tenant routing by `Host` inside one Worker.
- Selecting a D1 binding from request input.
- Workers for Platforms / customer-authored Worker code.
- Public self-service signup. Installs are provisioned deliberately, one at a time.
