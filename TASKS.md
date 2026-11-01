# Tasks: AdsBookCMS

> Verified against disk: 2026-10-31 @ `d61afbe` (A38 cancelled; A-444; other sections retain their recorded evidence)

## A21 — A landing page may become the product page

- [x] **A-147** — Add the product-page claim to `landing_pages`, enforced by a partial unique index. **Done 2026-08-22** — migration `0046`, schema 47. Focused tests prove a second page targeting the same product is refused with the holding slug, that releasing frees it, and that an unknown page reports not-found instead of throwing.
      -> REQ: REQ-159, REQ-161 · deps: [] · Done when: the migration applies to an empty local D1 and a focused test proves only one landing page can hold a product page.
- [x] **A-148** — Serve a claimed landing page at the product URL, and redirect its own slug there. **Done 2026-08-22** — verified live in all four states: claimed renders at `/produk/<slug>` with that canonical and no redirect; the landing slug answers exactly one `308` to it; unpublishing returns the product template; releasing the claim restores both independent URLs.
      -> REQ: REQ-160, REQ-162, REQ-163 · deps: [A-147] · Done when: a running install proves one live URL per claimed page and a product that never 404s when the claim goes away.
- [x] **A-149** — Add the operator action and keep the copied link canonical. **Done 2026-08-22** — "Jadikan halaman produk" / "Lepas dari halaman produk" in both the card and table menus; a conflict returns `409` with the holding slug; the list carries `product_slug` so a claimed page copies `/produk/<slug>` rather than an address that only redirects.
      -> REQ: REQ-159 · deps: [A-147] · Done when: the action round-trips through the API and the list shows the address the page actually answers on.
- [x] **A-150** — Give the landing surface a real stylesheet and write the authoring contract. **Done 2026-08-22** — `.lp-section` was used by every operator-authored HTML block and styled nowhere, so those sections had no rhythm or type contract at all; `src/styles/landing-pages/landing.css` now owns it. `docs/LANDING-PAGES.md` is corrected to the no-prefix URL contract, documents the product-page takeover, states the slug-collision hazard, and records what the unbuilt native registry (A-133) must read.
      -> REQ: REQ-163 · deps: [] · Done when: the shared landing stylesheet is imported by the surface that needs it and the doc matches disk.

## A20 — One date-range control across every reporting surface

- [x] **A-143** — Extend `admin-date-filter.ts` with a validated custom range and one shared query-parameter parser. **Done 2026-08-22** — `resolveAdminDateSelection` returns a refusal with a reason instead of a range it cannot justify, and `parseAdminDateSelection` gives all three routes one parameter contract.
      -> REQ: REQ-155, REQ-157 · deps: [] · Done when: focused tests prove an inverted, unparseable, over-long, or future range is refused rather than coerced, and that `custom` no longer resolves to the 7-day default.
- [x] **A-144** — Teach the order and shipping APIs to accept an explicit range and to refuse an unresolvable one. **Done 2026-08-22** — verified live against both routes: an inverted range, a future end, missing dates and an unknown preset each return a stated 422/400, while 17 Aug alone returned 10 orders, 18 Aug alone 3, both days 13, and July 0 — arithmetic consistent with the 13 the store holds.
      -> REQ: REQ-155, REQ-157 · deps: [A-143] · Done when: focused tests prove both routes filter on a valid custom range and return a stated error for an invalid one instead of a different period's rows.
- [x] **A-145** — Add the shared period control: presets plus an explicit range, with the surface's cap stated. **Done 2026-08-22** — verified at 1280px and 390px: preset list with the active one checked, range panel stacking below on a phone, the cap stated in the copy and enforced by the inputs' own `min`/`max`, and no horizontal overflow.
      -> REQ: REQ-154, REQ-156, REQ-158 · deps: [A-143] · Done when: browser evidence at 390px and 1280px proves preset selection, custom-range entry, the cap being enforced in the inputs, the active period legible on the closed control, and no layout overflow.
- [x] **A-146** — Adopt the shared control on the dashboard, order list, and shipping workspace, retiring the dashboard's own custom-range section. **Done 2026-08-22** — the dashboard shows a 31-day cap and hides the 90/180-day presets while the lists keep the 180-day default; the separate custom-range section below the dashboard filter is gone.
      -> REQ: REQ-154, REQ-158 · deps: [A-144, A-145] · Done when: browser evidence proves all three surfaces filter by both a preset and a custom range, and the dashboard keeps its 30-day cap while the lists do not inherit it.

## A19 — Operator notifications for revenue events

- [x] **A-136** — Add the `notifications` table plus its per-operator read state, with a uniqueness constraint on event type + subject id. **Done 2026-08-22** — migration `0045`, schema 46. No `store_id`: one Worker is one store (ADR-001), so it would be a column with one value forever. A live local D1 insert proved the unique index rejects the duplicate.
      -> REQ: REQ-146, REQ-147, REQ-148, REQ-151 · deps: [] · Done when: the migration applies to an empty local D1 and a focused test proves a second insert for the same event type + subject is rejected rather than duplicated.
- [x] **A-137** — Record an `order` notification from the checkout order write. **Done 2026-08-22** — recorded inside `persistOrder` rather than in each of its three callers, so a new checkout entry point cannot forget it. An adversarial review caught this first ticked against evidence that did not exist: because recording is fail-open, the existing fixtures swallowed the write (`no such table: notifications`) and every test still passed. The fixtures now load the real migration and assert the recorded subject and copy.
      -> REQ: REQ-146, REQ-149 · deps: [A-136] · Done when: a focused test proves one order produces one notification, a replayed submit produces none, and a failing notification store leaves the order committed and the buyer response unchanged.
- [x] **A-138** — Record a `lead` notification from the missed-order lead capture. **Done 2026-08-22** — recorded in the route, which has one exit; the 2-hour dedupe window reuses the same row, so the unique constraint collapses a repeat capture. Its fixture had no `run()`, so the write failed open and proved nothing until the review found it; the fake now captures the insert and the test asserts type, order and copy. A converted lead links to the order detail rather than the abandoned workspace it has left.
      -> REQ: REQ-147, REQ-149 · deps: [A-136] · Done when: a focused test proves one qualified lead produces one notification and a suppressed duplicate capture produces none.
- [x] **A-139** — Record a `payment` notification from every path that sets an order paid. **Done 2026-08-22** — both paths covered: AutoLaris manual reconciliation and an operator setting `payment_status` on order detail. The unique constraint keeps them from double-notifying, and the idempotency test now asserts a double confirmation still leaves exactly one notification. Its fixture also had to load the real migration before the assertion meant anything.
      -> REQ: REQ-148, REQ-149 · deps: [A-136] · Done when: a focused test proves manual reconciliation and provider confirmation each produce exactly one notification for the same order, not two.
- [x] **A-140** — Add the authenticated unread-count and list endpoints, role-scoped, with mark-read and mark-all-read. **Done 2026-08-22** — `/api/admin/notifications`, registered in the deny-by-default route policy for owner/admin/customer_service only.
      -> REQ: REQ-150, REQ-151 · deps: [A-136] · Done when: focused tests prove `advertiser` is denied, two operators keep independent read state, and the list returns newest first.
- [x] **A-141** — Add the admin notification bell, unread badge, and panel. **Done 2026-08-22** — verified in a real browser at 390px and 1280px: badge showed 2, panel listed newest-first with per-type icons and relative time, mark-all-read cleared the badge, the cleared state survived a reload, and the console was empty.
      -> REQ: REQ-150, REQ-151 · deps: [A-140] · Done when: browser evidence at 390px and 1280px proves the badge, the panel, mark-read, and no layout overflow.
- [ ] **A-142** — Raise a browser notification for an unread event while an admin page is open, at most once per event per browser. **Partial 2026-08-22** — implemented with a bounded `localStorage` set of already-announced ids and a permission request on first panel open; the absent/denied path degrades to the in-app list. **Not proven**: the automation profile never grants Notification permission, so no OS-level toast was observed. Needs a manual check in a normal browser before this is ticked.
      -> REQ: REQ-152 · deps: [A-141] · Done when: browser evidence proves one notification per event, no repeat across a reload, and a clean degrade to the in-app list when permission is absent or denied.

## A18 — Deterministic storefront home and structured content editor

- [x] **A-130** — Establish the canonical compact homepage composition and remove alternate-template selection from the public home path. **Confirmed done 2026-09-25:** `src/pages/index.astro` renders only `CompactMarketHome`; `validateStorefrontTemplateDefinition` refuses a wide layout (`storefront-template.test.ts`) and `0044` removed `wide-catalog`.
      -> REQ: REQ-140 · deps: [] · Done when: a local route test proves every stored template choice renders the compact homepage without changing product or landing URLs.
- [ ] **A-131** — Render active product cards as a two-column homepage catalog with ten initial cards and accessible Load more behavior.
      -> REQ: REQ-141 · deps: [A-130] · Done when: browser evidence at 390px and 1280px proves ten initial cards, two-column layout, no horizontal overflow, and correct remaining-card reveal.
- [x] **A-132** — Add the unified CMS/native landing-page homepage index and sitemap feed. **Confirmed done 2026-09-25:** `listPublicLandingPages` feeds home, `/landing-page`, `/sitemap` and `sitemap.xml`, once per page, by the URL it answers on, and only when its product is active (`landing-pages.test.ts`).
      -> REQ: REQ-142 · deps: [A-130] · Done when: focused tests prove only active CMS pages and typed native entries are listed once with canonical URLs.
- [x] **A-133** — Add a typed native Astro landing-page registry with build-time slug and metadata validation. **Done 2026-08-22** — `src/data/native-landing-pages.ts` is the manifest; `validateNativeLandingPages` refuses a duplicate slug, a slug that cannot match a filename, or a missing title/product/description. The register is reconciled into `landing_pages` as `source='native'` rows on every list load, so the CMS lists and links a deployed page with no sync step, and a removed entry takes its row and any claim with it. Editing and deleting are refused with `409`. Verified live: a registered page appeared in the admin list with its product resolved from `productSlug`, took over `/produk/<slug>` with the product canonical, redirected its own slug once, and vanished from the list and both sitemaps when the entry was withdrawn.
      -> REQ: REQ-143 · deps: [] · Done when: duplicate or incomplete registry entries fail the focused test while a registered route appears in the homepage index.
- [ ] **A-134** — Replace the operator JSON content workbench with bounded homepage banner, slider, and supporting-copy fields.
      -> REQ: REQ-144 · deps: [A-130] · Done when: `/admin/content` contains no raw JSON/AI control, saves validated named fields, and preserves existing content safely.
- [x] **A-135** — Add the fallback automatic homepage state for missing or invalid structured content. **Superseded 2026-08-21 by `7d2462d`, recorded as ADR-025:** an unpublished store composes its home from its own identity, catalogue and landing pages.
      -> REQ: REQ-145 · deps: [A-131, A-132, A-134] · Done when: a local route/browser test proves the homepage stays useful and truthful with unavailable optional content.

> Last executed baseline: 2026-08-17 @ `5cb1d32` + A13.

## Provenance — read before citing any task

Phases 1–80 (T1–T295) were inherited from the upstream CMSAds engine when this repository was forked on 2026-08-15. They are lineage, not an active backlog, and they carry known structural damage:

- **Phase numbers 71–80 appear twice** with different subjects.
- **T243 and T244 do not exist**; numbering jumps from T242 to T245.
- **Traceability is broken from T266 onward** — those tasks reference `SEC-*`, `PAY-*`, `ORD-*`, `TRK-*`, `TYP-*`, `DOC-*`, `CAT-*`, and `UI-*` identifiers that exist in no version of `PRD.md`.
- Several completed tasks assert behaviour that is false in this repository, most importantly T71 (`./scripts/install.sh` — the file does not exist) and T100/T107 (pushing to `main` does not deploy — correct for this repository; ADR-012 and `ci.yml`).
- T174 and T175 remain unchecked although the contracts they describe now ship.

Historical rows are left exactly as they landed. Do not retro-fit them and do not treat an inherited `[x]` as evidence. Active work starts at **Phase A** at the end of this file and references the requirement IDs in the current `PRD.md`.

---

## Rules for AI Agent

- Execute work in traceable slices and use the smallest runnable proof that exercises the changed contract; build/typecheck alone do not prove browser behavior or live-provider side effects.
- Maintain requirement traceability: every implementation task names its owning requirement (`-> REQ: REQ-x`).
- Completed rows preserve the historical status recorded when they landed. New or still-open backlog items use one primary requirement plus optional constraints; unchecked items labelled historical/superseded are lineage only, not active backlog.
- Do NOT introduce unrequested abstractions, uncoordinated colors, or AI slop tells.

---

## Phase 1: Design Tokens & Layout Architecture

- [x] **T1** — Design Tokens Specification (`design-tokens.md`).
      -> REQ: REQ-2 · deps: [] · Done when: single Agricultural Emerald & Slate color tokens created in `design-tokens.md` and `ui-variants.ts`.
- [x] **T2** — Mobile-First 480px Container (`BaseLayout.astro`).
      -> REQ: REQ-1 · deps: [T1] · Done when: storefront layout wraps content in `max-w-[480px]` container centered with backdrop shadow.
- [x] **T3** — Clean Non-Sticky Header & Top Announcement Bar (`SiteHeader.astro`).
      -> REQ: REQ-4 · deps: [T1] · Done when: non-sticky clean header renders top announcement bar and `SiteBrand` logo without AI tells.
- [x] **T4** — Mini Store Direct-Response Footer (`SiteFooter.astro`).
      -> REQ: REQ-5 · deps: [T1] · Done when: streamlined footer renders 6 legal links and copyright note.

## Phase 2: Frameless Product Photography & Storefront Pages

- [x] **T5** — Frameless Pure-White Product Showcase Grid (`ProductsSection.astro`).
      -> REQ: REQ-3 · deps: [T1] · Done when: product photos sit frameless directly on pure white canvas (`bg-white`).
- [x] **T6** — Product List Item & PDP Photography (`ProductListItem.astro`, `[slug].astro`).
      -> REQ: REQ-3 · deps: [T5] · Done when: product images in catalog and detail pages render frameless on pure white canvas.
- [x] **T7** — Storefront 6 Legal Policy Routes (`/kebijakan-privasi`, `/syarat-ketentuan`, etc.).
      -> REQ: REQ-5 · deps: [T4] · Done when: all 6 legal policy pages return HTTP 200 OK with `max-w-[480px]` container.

## Phase 3: Order Engine & AutoLaris Payment Integration

- [x] **T8** — Order Submission API (`/api/submit-order` & `/api/submit-middle-order`).
      -> REQ: REQ-10 · deps: [] · Done when: POST payload creates order & order_items records in Cloudflare D1.
- [x] **T9** — AutoLaris Webhook Receiver (`/api/webhooks/autolaris`).
      -> REQ: REQ-11 · deps: [T8] · Done when: valid webhook callback updates `payment_status = 'paid'` in D1.
- [x] **T10** — Token-Protected Payment Status and Instructions API (`/api/order-status`).
      -> REQ: REQ-12 · deps: [T9] · Done when: GET with matching order identity and `public_status_token` returns current D1 status plus the latest recorded payment instructions without customer PII, while unknown or mismatched orders fail closed.

## Phase 4: Tracking & Meta CAPI Edge Resolver

- [x] **T11** — Edge D1 Store Ads Config Resolver (`getStoreAdsConfig`).
      -> REQ: REQ-7 · deps: [] · Done when: `src/lib/store-ads.ts` fetches pixel & token from D1 with env fallback.
- [x] **T12** — Meta Pixel Advanced Matching & Dual Deduplication (`MetaThanksTracker.astro`).
      -> REQ: REQ-6, REQ-8, REQ-9 · deps: [T11] · Done when: SHA-256 matched Purchase fires on `/thanks` without duplicate counts on reload.
- [x] **T13** — Meta CAPI Server Trigger (`/api/meta-event.ts`).
      -> REQ: REQ-6, REQ-7 · deps: [T11] · Done when: POST `/api/meta-event` sends server CAPI event with D1 pixel credentials.

## Phase 5: Production Verification & Build Proof

- [x] **T14** — Production Verification & Build Proof.
      -> REQ: REQ-1..12 · deps: [T1..T13] · Done when: `npm run check` returns 0 errors and `npm run build` succeeds.

## Phase 6: Storefront Checkout & Logistics Integration

- [x] **T15** — Mengantar Client Library (`src/lib/mengantar-client.ts`).
      -> REQ: REQ-14, REQ-38 · deps: [] · Done when: `MengantarClient` provides typed address, pickup, rate, receiver-history, and shipment transport methods with a 10-second timeout; application-level shipment/pickup workflows remain tracked separately.
- [x] **T16** — Address Autocomplete API (`/api/locations`).
      -> REQ: REQ-13 · deps: [T15] · Done when: `GET /api/locations?search=<prefix>&level=district` returns only matching kecamatan from the bundled index, while `level=resolve` resolves a representative Mengantar area ID for the selected kecamatan and city.
- [x] **T17** — Shipping Rates API with D1 Origin Fallback (`/api/shipping-rates`).
      -> REQ: REQ-14 · deps: [T15] · Done when: GET `/api/shipping-rates?destination_id=...` resolves origin from D1 `warehouses.origin_area_id` first, env fallback, and returns courier rates from Mengantar `/order/estimate`.
- [x] **T18** — Payment Methods API with COD Province Exclusion (`/api/payment-methods`).
      -> REQ: REQ-15 · deps: [] · Done when: GET `/api/payment-methods?province=...` excludes COD for provinces in `PUBLIC_COD_DISABLED_PROVINCES` list.
- [x] **T19** — Hybrid Checkout Form (`FormHybridContent`).
      -> REQ: REQ-13, REQ-15, REQ-16 · deps: [T16, T17, T18] · Done when: checkout renders kecamatan-only autocomplete without village selection, resolves the destination ID server-side, loads dynamic shipping rates, preserves honest payment availability, and enforces honeypot plus durable submit-token protection.
- [x] **T20** — Middle Funnel Checkout Form (`FormMiddleContent`).
      -> REQ: REQ-16 · deps: [T18] · Done when: middle funnel captures the minimum validated COD order contract, persists through `/api/submit-middle-order`, and uses the same durable submit-token protection as hybrid checkout.
- [x] **T21** — AutoLaris Payment Client (`src/lib/autolaris-client.ts`).
      -> REQ: REQ-11 · deps: [] · Done when: `AutoLarisClient` class supports 10 channel codes (QRIS, VABCA, VAMANDIRI, VABNI, VABRI, VAPERMATA, VABSI, VACIMB, VADANAMON, DANA), `YYYYMMDDHHMMSS` expiry serialization, Bearer auth, timeout, and error propagation.

## Phase 7: Admin Authentication & Security Hardening

- [x] **T22** — PBKDF2-SHA256 Password Hashing & HMAC-SHA256 JWT (`src/lib/auth.ts`).
      -> REQ: REQ-17 · deps: [] · Done when: `signJwt` creates HS256 JWT with `jti`/`iat`/`exp`, `verifyJwt` validates signature and expiry, `verifyPasswordHash` uses PBKDF2-SHA256 with salt, `secureEqual` uses constant-time comparison. AUTH_SECRET minimum 32 chars enforced.
- [x] **T23** — Admin Middleware with KV Session Revocation (`src/middleware.ts`).
      -> REQ: REQ-18, REQ-19 · deps: [T22] · Done when: middleware protects `/admin/*` and `/api/admin/*` with JWT, KV liveness, and D1 credential-revision checks; forces bootstrap users to `/admin/profile`; applies security headers; and blocks cross-origin unsafe mutations.
- [x] **T24** — Admin Login Page & Logout API (`/hello`, `/api/admin/logout`).
      -> REQ: REQ-17, REQ-18 · deps: [T22, T23] · Done when: `/hello` authenticates the D1-backed PBKDF2 credential, sets `cmsads_session`, stores the versioned session in KV, redirects the bootstrap account to profile, and logout deletes the KV session and cookie.
- [x] **T25** — R2 Upload Validation & Security (`/api/admin/upload-r2`).
      -> REQ: REQ-20, REQ-28 · deps: [T23] · Done when: upload endpoint enforces 5 MB limit, MIME + magic-byte check, cryptorandom R2 key, immutable cache-control, and KV-backed hourly quota.

## Phase 8: Admin Dashboard & Analytics

- [x] **T26** — Analytics Dashboard (`AnalyticsDashboard.tsx`, `/api/admin/analytics`).
      -> REQ: REQ-21 · deps: [T23] · Done when: `/admin/dashboard` renders KPI cards (total revenue, total orders, conversion rate, RTS rate) and payment mix breakdown (COD/transfer/QRIS percentages) from D1 aggregate queries.

## Phase 9: Admin Order Management

- [x] **T27** — Order List with Search & Filters (`/admin/orders`, `/api/admin/orders`).
      -> REQ: REQ-22 · deps: [T23] · Done when: `/admin/orders` lists D1 orders with search (invoice/name/phone), payment and shipping status filters, pagination (max 100/page), responsive desktop table and mobile cards.
- [x] **T28** — Order Shipping Status Update (PATCH `/api/admin/orders/[id]`).
      -> REQ: REQ-23 · deps: [T27] · Done when: PATCH updates `shipping_status` without mutating `payment_status`, shows pending/success/error feedback. shadcn/ui Select with semantic color indicators and keyboard navigation.
- [x] **T29** — Invoice Detail Page with Receiver Performance (`/admin/orders/[invoice]`).
      -> REQ: REQ-24, REQ-38 · deps: [T27] · Done when: detail page shows CMS-derived receiver delivery rate/risk and courier totals, customer data, ordered products, shipping/payment information, and inline status updates.
- [x] **T30** — WhatsApp CRM Follow-Up Buttons & Template Engine.
      -> REQ: REQ-25 · deps: [T29] · Done when: responsive 44px-minimum Welcome + Follow-up 1–7 controls render configured templates with `{{nama}}`, `{{wa}}`, `{{alamat}}`, `{{kecamatan}}`, `{{inv}}`, `{{produk}}`, `{{ongkir}}`, `{{total}}`, `{{resi}}`, and `{{kurir}}`, then open a digit-normalized `wa.me` URL.

## Phase 10: Admin Product Catalog

- [x] **T31** — Product Catalog List (`ProductCatalog.tsx`, `/api/admin/products`).
      -> REQ: REQ-26 · deps: [T23] · Done when: `/admin/products` lists products with the canonical D1 product ID, category, variant count, status, and search; product titles link to edit; desktop/mobile action menus expose explicit deletion confirmation.
- [x] **T32** — Product Create, Edit & Protected Deletion (`/admin/products/new`, `/admin/products/edit`, `/api/admin/products`).
      -> REQ: REQ-27 · deps: [T31, T25] · Done when: product + variant inserts/updates are atomic, slug/SKU collisions are rejected, referenced variants and products cannot be deleted, and an unreferenced confirmed deletion removes variants before its product. R2 image upload remains integrated.

## Phase 11: Admin Shipping & Logistics Operations

- [x] **T33** — Shipping Operations Surface (`ShippingOperations.tsx`, `/api/admin/shipping`).
      -> REQ: REQ-29 · deps: [T23, T15] · Done when: `/admin/shipping` renders responsive React surface with D1 shipments, search, status filters, desktop table and mobile cards, loading/error/empty states.
- [x] **T34** — Shipment Status Update & Pickup Scheduling.
      -> REQ: REQ-30 · deps: [T33] · Done when: admin can update shipment status and schedule pickups via `/api/admin/shipping` with pending/success/error feedback.
- [x] **T35** — Courier Enable/Disable & COD Rules (`courier_rules`).
      -> REQ: REQ-31 · deps: [T33] · Done when: admin can toggle courier enabled state and COD support per courier in D1, with rollback on failure.

## Phase 12: Admin Ads & Tracking Configuration

- [x] **T36** — Meta Pixel & CAPI Configuration (`/admin/ads/meta`).
      -> REQ: REQ-32, REQ-34 · deps: [T23, T11] · Done when: Meta Pixel ID and CAPI token displayed with masked secrets, dirty-state detection, save with blank-preserves-existing behavior, server-side test.
- [x] **T37** — Google Ads Conversion Pair (`/admin/ads/google`).
      -> REQ: REQ-33, REQ-34 · deps: [T23] · Done when: Google Ads Conversion ID and Label configured as a validated pair (both present or both absent).

## Phase 13: Admin Settings — Store, Warehouse & CRM

- [x] **T38** — Store & Customer Service Settings (`/admin/settings/store`).
      -> REQ: REQ-35 · deps: [T23] · Done when: store identity and WhatsApp number persisted to D1 `stores` table.
- [x] **T39** — Warehouse Configuration with Kecamatan Lookup (`/admin/settings/warehouse`).
      -> REQ: REQ-36 · deps: [T23, T15] · Done when: warehouse settings show PIC name and normalized phone, group Mengantar results by kecamatan, request kelurahan/desa only after a kecamatan is chosen, and persist the precise origin label plus area ID to D1.
- [x] **T40** — CRM Template Editor (`/admin/settings/crm`).
      -> REQ: REQ-37 · deps: [T23] · Done when: collapsible editors for Welcome + 1–7 provide labeled, 44px insertion controls including phone, address, district, and shipping cost, then persist JSON to `stores.crm_templates`.

## Phase 14: Admin Receiver Performance & Payment Gateway

- [x] **T41** — Receiver Performance Lookup (historical `/admin/scoring`, current `/admin/check`).
      -> REQ: REQ-38 · deps: [T23, T15] · Done when: an admin phone lookup parses Mengantar's actual per-courier history, displays transparent delivery-rate metrics, risk policy, operator guidance, and all courier breakdowns without fabricating a provider score.
- [x] **T42** — Payment Gateway Control Panel (`/admin/payments`).
      -> REQ: REQ-39 · deps: [T23, T21] · Done when: `/admin/payments` separately shows masked API-key and callback-secret readiness, explains each incomplete state and COD impact, displays the runtime callback URL, runs an explicitly local configuration check, and lists the 10 client-supported channels without fabricated merchant account data.

## Phase 15: Admin Navigation & Responsive UX

- [x] **T43** — Grouped Sidebar Navigation (Operational / Growth / System).
      -> REQ: REQ-40 · deps: [T23] · Done when: the desktop sidebar organizes routes into Operational, Growth, and System groups, remains independently scrollable at short viewport heights, and does not narrow the main content pane.
- [x] **T44** — Mobile Admin Drawer & Responsive Tables.
      -> REQ: REQ-40 · deps: [T43] · Done when: below the desktop breakpoint the hamburger opens a scroll-contained modal drawer, closed content is inert, focus is trapped and restored, `Escape` and backdrop activation close it, its footer remains reachable, and admin routes retain 44px controls without horizontal page overflow.

## Phase 16: Full-System Verification

- [x] **T45** — Full-System Typecheck & Build.
      -> REQ: REQ-1..40 · deps: [T1..T44] · Done when: `npm run check` returns 0 errors and `npm run build` succeeds with all admin + storefront routes functional.

## Phase 17: Implementation Completion & Data Integrity

- [x] **T46** — Persist Product Photos from Validated R2 Uploads.
      -> REQ: REQ-28 · deps: [T25, T32] · Done when: product create/edit form uploads a validated image to R2, persists `/assets/uploads/...` in `products.image_url`, reloads it on edit, and displays it in the catalog.
- [x] **T47** — Use Configured CRM Templates in Order Actions.
      -> REQ: REQ-25, REQ-37 · deps: [T30, T40] · Done when: order list and invoice detail load `stores.crm_templates`, fall back safely to defaults, and render Welcome + 1–7 WhatsApp links from the configured text.
- [x] **T48** — Complete Warehouse Origin Schema Migration.
      -> REQ: REQ-14, REQ-36 · deps: [T17, T39] · Done when: Drizzle schema and migration add `warehouses.origin_label`, settings use a typed field, and local migrations report no pending changes.
- [x] **T49** — Remove Fabricated Payment Account State.
      -> REQ: REQ-39 · deps: [T42] · Done when: payment UI derives credential readiness from the protected settings API, derives callback URL from runtime origin, lists supported channel capabilities, and reports connection failures as errors.

## Phase 18: Durable Checkout & Fail-Closed Payment State

- [x] **T50** — Atomic D1 Order Persistence.
      -> REQ: REQ-10 · deps: [T9, T17] · Done when: both checkout endpoints validate an existing variant, derive product value from D1, atomically insert order + item, decrement stock once, return the persisted `order_pk`, and return an error instead of false success on persistence failure.
- [x] **T51** — Durable Submit-Token Idempotency.
      -> REQ: REQ-16 · deps: [T50] · Done when: migration `0003_lyrical_luckman.sql` adds a unique nullable `orders.submit_token` and duplicate requests return `409` across Worker isolates.
- [x] **T52** — Strict Checkout Trust-Boundary Validation.
      -> REQ: REQ-10, REQ-16 · deps: [T50] · Done when: phone validation runs after normalization, quantity is a bounded integer, token is mandatory, variant must exist, stock must suffice, and shipping cost is a bounded non-negative integer.
- [x] **T53** — Fail-Closed Order Status and Webhook Mutations.
      -> REQ: REQ-11, REQ-12 · deps: [T50] · Done when: unknown order status returns `404`, missing D1 returns `503`, and AutoLaris webhook reports missing orders or failed mutations rather than success.
- [x] **T54** — Honest Storefront Payment Availability.
      -> REQ: REQ-15 · deps: [T11, T21] · Done when: unimplemented H2H methods are inactive in `/api/payment-methods`, direct online submissions fail explicitly, and COD-excluded areas show an unavailable message instead of a fabricated online fallback.
- [x] **T55** — Native Contract Test Suite.
      -> REQ: REQ-10, REQ-16, REQ-25 · deps: [T50, T52] · Done when: `npm test` runs Node's built-in test runner and protects phone normalization, order boundaries, province aliases, and CRM rendering without a new dependency.

## Phase 19: Receiver Performance Integrity

- [x] **T56** — Durable Receiver Performance Refresh.
      -> REQ: REQ-38 · deps: [T41, T50] · Done when: both checkout endpoints schedule the Mengantar lookup with Cloudflare `waitUntil()`, persist delivery rate, CMS risk, full courier snapshot, and checked timestamp to D1, while order list/detail/shipping views consume the renamed API contract.

## Phase 20: Pending Provider-Integrated Operations

- [x] **T57** — Mengantar Shipment Creation and Sequential Queue.
      -> REQ: REQ-41 · deps: [T15, T31, T39] · Done when: a focused admin scenario explicitly releases multiple eligible orders without concurrent `/order` calls, persists each provider-accepted result independently, keeps failures in Order Management, returns per-order results, and never fabricates `cnote_no`.
- [x] **T58** — Provider-Synchronized Pickup Address and Schedule.
      -> REQ: REQ-42 · deps: [T15, T39, T57] · Done when: admin address/schedule mutations call verified Mengantar `/address` and `/time` contracts and only mark D1 state confirmed after provider success.
- [ ] **T59** — Mengantar Unpaid Shipment Recovery.
      -> REQ: REQ-43 · deps: [T57] · Done when: a real non-COD insufficient-wallet response remains unpaid without a resi and the admin recovery action obtains and persists `cnote_no` after `/order/pay-unpaid` succeeds.
- [ ] **T60** — Verify Official AutoLaris Callback Authentication.
      -> REQ: REQ-44 · deps: [T85] · Done when: the implemented idempotent checkout and reconciliation flow verifies the provider's official callback signature/header contract from canonical documentation; the current configured custom-secret header remains explicit until that contract is available.

## Phase 21: Provider Configuration & Expedition Controls

- [x] **T61** — Editable Provider API Configuration.
      -> REQ: REQ-45 · deps: [T23, T39] · Done when: admin can replace Mengantar and AutoLaris keys/base URLs from `/admin/profile`, values persist in D1 with dashboard-over-environment precedence, GET responses remain masked, and provider consumers use the shared persisted resolver.
- [x] **T62** — Checkout-Enforced Expedition Toggles.
      -> REQ: REQ-46 · deps: [T15, T39] · Done when: `/admin/expeditions` exposes accessible service/COD switches for every courier, mutations persist through a dedicated API, and `/api/shipping-rates` removes service-disabled or COD-disabled couriers from the relevant checkout response.

## Phase 22: Storefront UI/UX Perfection & Design System

- [x] **T63** — Storefront Design System & Token Specification (`STOREFRONT_DESIGN_SYSTEM.md`).
      -> REQ: REQ-2 · deps: [] · Done when: canonical UI/UX tokens, sleek input physics, card padding, and element hierarchies are documented in `STOREFRONT_DESIGN_SYSTEM.md`.
- [x] **T64** — Compact Form Element Physics & Micro-Interactions (`form-hybrid.css`).
      -> REQ: REQ-1, REQ-2 · deps: [T63] · Done when: input height is `2.6rem` (~41.6px), un-typed floating label is centered at `1.3rem`, floated label is thin gray (`0.65rem`, `font-weight: 500`), typed background is `#f0fdf4`, border lines are clean 1px gray `#cbd5e1`, and variant/summary cards use compact padding (`0.65rem 0.85rem` / `0.62rem 0.85rem`).
- [x] **T65** — District Search Dropdown Elevation & Picked Badge Layout (`FormHybridContent.astro`, `form-hybrid.css`).
      -> REQ: REQ-13 · deps: [T64] · Done when: district search dropdown uses `0.55rem 0.85rem` item padding with elevated shadow and soft light green hover tint, selected district badge (`#district-picked`) and status note (`#district-help`) sit cleanly below the search box with `margin-top: 0.55rem`, and redundant top form review headers are removed.

## Phase 23: Kecamatan Search Precision

- [x] **T66** — District-Only Checkout Autocomplete.
      -> REQ: REQ-13 · deps: [T16, T19] · Done when: entering `suko` returns Sukodono, Sukoharjo, Sukodadi, and other matching kecamatan without unrelated districts matched through village names; selecting a row resolves a Mengantar area ID and loads shipping rates without a village step.
- [x] **T67** — Precise Admin Pickup Area Picker.
      -> REQ: REQ-36 · deps: [T39, T66] · Done when: admin warehouse search first displays grouped kecamatan and only then displays available kelurahan/desa before persisting the pickup area ID.

## Phase 24: Cloudflare Deployment-per-Tenant Foundation

- [x] **T68** — Named Tenant Worker Environments.
      -> REQ: REQ-47 · constraints: [REQ-48] · deps: [] · Done when: `wrangler.jsonc` contains a complete `petanisejahtera` environment with independently named Worker and stable isolated binding names, and `CLOUDFLARE_ENV=petanisejahtera npm run build` emits that flattened Worker configuration.
- [x] **T69** — Custom Domain Configuration Validation.
      -> REQ: REQ-49 · deps: [T68] · Done when: tenant validation accepts only exact `custom_domain: true` route objects when production routes are present and rejects wildcard custom-domain patterns.
- [x] **T70** — Tenant-Aware Storefront Shell.
      -> REQ: REQ-50 · deps: [T68] · Done when: typed public tenant configuration controls document language, canonical origin, default SEO description, Open Graph/JSON-LD identity, theme color, and shared header/footer branding while preserving Petani Sejahtera defaults.
- [x] **T71** — Reproducible Local Installer.
      -> REQ: REQ-51 · deps: [] · Done when: `./scripts/install.sh` verifies Node/npm, runs the lockfile-pinned install containing TypeScript and Wrangler, generates binding types, and runs static validation without global installs.
- [x] **T72** — Guarded Tenant Lifecycle Commands.
      -> REQ: REQ-52 · deps: [T68] · Done when: list, validate, dev, build, type-generation, and deployment dry-run commands reject unknown tenant names before launching tools, operate on exactly one tenant, and expose no implicit bulk remote mutation.

## Phase 25: Dashboard-Managed Meta & Google Tracking

- [x] **T73** — Tenant Runtime Tracking Configuration.
      -> REQ: REQ-53 · deps: [T36, T37, T68] · Done when: the Google admin page persists a validated GTM container independently from the Google Ads conversion pair, storefront GTM resolves the tenant's D1 configuration at request time, and Meta secrets remain masked with explicit replacement semantics.
- [x] **T74** — Validated Meta CAPI Ingress & Test Events.
      -> REQ: REQ-54 · deps: [T13, T36] · Done when: unsupported or malformed public CAPI payloads are rejected before outbound fetch, Meta connection tests require and forward a Test Event Code, and outbound requests use a currently supported Graph API version.

## Phase 26: Build-Selected Tenant Content

- [ ] **T75** — Historical Build-Selected Tenant Content Packs (superseded by REQ-63).
      -> REQ: REQ-55 (Superseded by REQ-63) · deps: [T68, T70] · Done when: retained for traceability only. New tenant-content work must target the runtime D1/R2 flow in T96+ rather than reviving build-selected content packs.

## Phase 27: Admin Profile & Credential Rotation

- [x] **T76** — D1-Backed Admin Credential Rotation.
      -> REQ: REQ-17 · deps: [T22, T23, T24] · Done when: migration `0007_flimsy_marvel_apes.sql` creates the documented bootstrap `admin` / `admin` account with forced replacement; `/admin/profile` requires the current password, validates and hashes the replacement, invalidates all credential revisions and KV sessions, then requires login with the new username and password.

## Phase 28: D1-Backed Storefront Catalog

- [x] **T77** — Connect Admin Catalog Operations to Every Storefront Surface.
      -> REQ: REQ-56 · deps: [T31, T32] · Done when: D1 product/variant identity, status, stock, image override, and pricing merge with editorial content by canonical D1 Product ID across home, catalog, detail, campaign checkout, social proof, confirmation, and 404 surfaces; checkout submits the canonical D1 Variant ID; the five-product/ten-variant fixture retains Baja Aussie as a non-public draft until editorial content exists.

## Phase 29: Identifier-Driven Adaptive Checkout Forms

- [x] **T78** — Generate Middle, Full, and Hybrid Forms from Product/Variant IDs.
      -> REQ: REQ-57 · deps: [T77] · Done when: `/api/form-config` accepts a D1 product ID or public slug plus an optional canonical D1 variant ID, rejects inactive/mismatched records, returns canonical URLs for all three form modes, hybrid resolves from trusted geo context, and each existing form route renders the selected D1 price and variant ID without a UI redesign.

## Phase 30: Checkout API Trust Boundary

- [x] **T79** — Revalidate Shipping Quotes Before Order Persistence (retained after REQ-58 supersession).
      -> REQ: REQ-58 (Superseded by REQ-74) · constraints: [REQ-74] · deps: [T77, T78] · Historical and still-required boundary: `/api/shipping-options` derives weight from the selected D1 variant, `/api/submit-order` independently re-fetches eligible rates, a valid quote persists its authoritative cost, and a manipulated quote returns `409 SHIPPING_QUOTE_CHANGED` with no order or stock mutation. This task is not evidence of provider dispatch.
- [x] **T80** — Block Draft Variants and Throttle Order Submission.
      -> REQ: REQ-59 · deps: [T77] · Done when: both order paths reject variants whose product is inactive or whose price/stock is not sellable, enforce the existing per-IP submission limiter before payload processing, and return `429 RATE_LIMITED` after the configured threshold.

## Phase 31: AutoLaris Checkout, Reconciliation, and Recorded Balance

- [x] **T81** — Finish Payment Transaction Persistence and Migration.
      -> REQ: REQ-11 · deps: [T79] · Done when: `orders.customer_email` and `payment_transactions` have a generated, inspected D1 migration; payment attempts persist provider transaction ID, reference, public token, channel, status, amount, admin fee, billed total, VA/QR/code/link, expiry, paid timestamp, failure reason, and timestamps without storing API credentials.
- [x] **T82** — Finish AutoLaris Full/Hybrid Checkout UI.
      -> REQ: REQ-11 · deps: [T81] · Done when: configured AutoLaris channels appear in the full/hybrid form, each option maps to the correct `payment_method` and `payment_channel`, online checkout requires a valid email, COD remains usable without email, and provider-unavailable fallback exposes COD only.
- [x] **T83** — Finish AutoLaris Payment Creation and Customer Instructions.
      -> REQ: REQ-11, REQ-12 · deps: [T81, T82] · Done when: `/api/submit-order` records the D1 order, creates exactly one AutoLaris payment, returns the canonical structured order/payment response, and non-COD checkout opens `/payment` with the actual QRIS, VA, payment code, amount, admin fee, billed total, expiry, provider link, or an honest failure state.
- [x] **T84** — Historical Payment-Gated Automatic Dispatch (superseded by T110).
      -> REQ: REQ-58 (Superseded by REQ-74) · deps: [T83] · Historical boundary: COD dispatched automatically and paid online reconciliation claimed a shipment. The automatic trigger is retired; payment status now determines eligibility only, and explicit operator release is tracked by T110.
- [x] **T85** — Reconcile AutoLaris Callback into Payments and Orders.
      -> REQ: REQ-11 · deps: [T81, T84] · Done when: the authenticated webhook resolves a payment by provider transaction/reference, updates payment and order statuses idempotently, records `paid_at`, and rejects malformed or unauthorized callbacks. Its former automatic Mengantar trigger is superseded by REQ-74 and T110.
- [x] **T86** — Expose Payment Details in Order Management.
      -> REQ: REQ-19 · deps: [T85] · Done when: order detail shows AutoLaris channel, provider transaction, base amount, fee, billed total, payment status, expiry/paid time, and failure reason without exposing secrets.
- [x] **T87** — Build Recorded AutoLaris Balance Page.
      -> REQ: REQ-21 · deps: [T85] · Done when: `/admin/balance` uses the existing admin shell, shows paid recorded funds, pending billed amount, recorded fees, failed count, and a responsive incoming-transfer table linked to orders; the page explicitly labels values as D1 reconciliation rather than live withdrawable AutoLaris balance and contains no unverified withdrawal action.
- [x] **T88** — Add AutoLaris Contract and Ledger Tests (pre-Phase 37 boundary).
      -> REQ: REQ-11 · deps: [T81, T85, T87] · Historical boundary: Node tests covered response parsing, channel mapping, online schema requirements, idempotent paid reconciliation, recorded-balance aggregation, and the then-current payment-gated dispatch. Phase 37 must replace automatic dispatch expectations with paid eligibility plus explicit operator release.
- [x] **T89** — Verify AutoLaris Checkout and Admin Balance Locally (pre-Phase 37 boundary).
      -> REQ: REQ-11 · deps: [T82, T83, T84, T85, T86, T87, T88] · Historical boundary: the local payment/order/admin flow and its former automatic shipment trigger were verified with the checks recorded at the time. This task is not evidence for REQ-74–REQ-76; T113 owns the replacement verification.

## Phase 32: Multi-Worker Tenant Templates and Isolated Admin

- [x] **T90** — Enforce Typed Tenant Template Contract.
      -> REQ: REQ-60 · deps: [T68, T70] · Done when: every tenant environment declares a known content pack, storefront template, and admin identity; unknown values fail `npm run tenant:validate` before Astro or Wrangler executes.
- [x] **T91** — Build Distinct Storefront Home Templates.
      -> REQ: REQ-55 · deps: [T90] · Done when: `/` resolves a registered `compact-market` or `wide-catalog` Astro template at build time, both templates compile against the same D1 catalog contract, and no request-hostname dispatch is introduced.
- [x] **T92** — Brand the Admin Shell per Worker.
      -> REQ: REQ-61 · deps: [T90] · Done when: the admin document title, sidebar identity, logo, and accent derive from the selected tenant configuration while existing admin routes and authorization remain shared.
- [x] **T93** — Prove Per-Worker Provider Replacement Isolation.
      -> REQ: REQ-45 · deps: [T92] · Done when: a local tenant D1 scenario replaces Mengantar and AutoLaris keys/base URLs through the existing authenticated contract, read responses remain masked, and another tenant binding is not read or mutated.
- [x] **T94** — Validate Multi-Worker Domains and Resources.
      -> REQ: REQ-62 · deps: [T90] · Done when: validation rejects duplicate domains/resources and a `PUBLIC_SITE_URL` that does not match an exact custom domain, while both committed environments validate and build without remote mutation.

## Phase 33: Operational Checker Features

- [x] **T95** — Implement "Cek Ongkir" & "Cek WA" Admin Tool.
      -> REQ: REQ-68 · constraints: [REQ-13, REQ-14, REQ-38] · deps: [T56, T67] · Done when: `/admin/check` combines receiver scoring with tenant-scoped shipping estimation; origin is locked to warehouse configuration; destination uses the supported area-resolution flow; and the prior `/admin/scoring` route is removed.

## Phase 34: Runtime AI Content and Fleet Delivery

- [x] **T96** — Add Tenant Runtime Content Persistence.
      -> REQ: REQ-63 · deps: [T90] · Done when: D1 stores tenant-scoped AI instructions plus validated draft/published content records, contains no seeded tenant instruction, and generated migrations apply independently to both local tenant databases.
- [x] **T97** — Generate and Publish Typed AI Drafts.
      -> REQ: REQ-64 · deps: [T96] · Done when: an authenticated Worker-scoped API saves instructions, generates or accepts schema-valid home/product drafts, never auto-publishes, and explicit publication cannot modify operational product/provider/order fields.
- [x] **T98** — Render Published Runtime Content First.
      -> REQ: REQ-63 · deps: [T96, T97] · Done when: home and product renderers prefer published content from the active Worker's D1, ignore drafts, retain D1 price/stock/provider identity as authoritative, and safely preserve the existing storefront during the migration window.
- [x] **T99** — Verify Operations-Only Admin and Order Ingestion.
      -> REQ: REQ-65 · deps: [T50, T92] · Done when: product IDs, Meta/Google, Mengantar/AutoLaris, warehouse/courier, and order lifecycle remain admin-owned; both public submit endpoints use shared atomic D1 persistence and their orders appear through admin APIs.
- [x] **T100** — Add Failure-Isolated Fleet Release Matrix.
      -> REQ: REQ-66 · deps: [T94] · Done when: CI derives every tenant from validated configuration, validates once, dry-runs pull requests, deploys the same revision to each Worker with `fail-fast: false`, retains per-tenant concurrency and secrets, and never applies remote D1 migrations automatically.
- [x] **T101** — Verify Runtime Content and Fleet Contracts Locally.
      -> REQ: REQ-67 · deps: [T96, T97, T98, T99, T100] · Done when: contract tests reject invalid keys, raw HTML, operational AI fields, and publish-without-draft; local D1 proves draft versus published behavior; `npm test`, `npm run check`, tenant validation, workflow syntax, and both tenant builds pass without remote mutation.
- [ ] **T102** — Remove Compiled Tenant Content Fallback.
      -> REQ: REQ-63 · deps: [T101] · Done when: every active public route in every deployed tenant has reviewed published D1 content and tenant-owned R2 media, a preflight proves runtime completeness, and the legacy Petani Sejahtera content source is deleted from Git without blanking a storefront.

## Phase 35: Runtime Content Operator Surface

- [x] **T103** — Build Tenant Runtime Content Workbench.
      -> REQ: REQ-69 · constraints: [REQ-61, REQ-63, REQ-64, REQ-67] · deps: [T97, T98] · Done when: a committed `/admin/content` surface lists tenant content keys and draft/published status from `/api/admin/content`, saves instructions without echoing them, supports manual draft save plus Workers AI generation plus explicit publish and R2 media upload, and works at desktop and 390px without leaking cross-tenant data.

## Phase 36: Merchant Provisioning and Delegated Content Operations

- [x] **T104** — Build Guarded Cloudflare Tenant Installer.
      -> REQ: REQ-70 · deps: [T90, T94] · Done when: `tenant:install` validates a no-side-effect plan, rejects registry/resource overlap, provisions isolated Worker/D1/KV/R2/AI configuration only with `--yes`, bootstraps a named owner, and deploys only with explicit `--publish`.
- [x] **T105** — Add Owner and Content Collaborator Roles.
      -> REQ: REQ-71 · deps: [T92] · Done when: an owner can create/revoke named collaborators; collaborator sessions expose only content/media/profile routes; and owner-only pages/APIs fail closed.
- [x] **T106** — Enforce Runtime-Only Storefront Content.
      -> REQ: REQ-72 · deps: [T96, T103] · Done when: missing home content renders an honest setup state, products without published D1 content are omitted, and no public runtime path falls back to compiled merchant copy.
- [x] **T107** — Make Fleet Releases Explicit per Tenant.
      -> REQ: REQ-66 · deps: [T100, T104] · Done when: pull requests validate/dry-run all tenants, pushes to `main` do not deploy, and manual dispatch requires one exact tenant slug.
- [x] **T108** — Historical Middle-Order Shipping Selection (superseded by Phase 37).
      -> REQ: REQ-73 (Superseded by REQ-74) · deps: [T57, T85] · Historical boundary: middle-form orders were routed into shipping selection, but the middle-only rule did not establish the canonical lifecycle for every checkout path and is not evidence that Phase 37 is complete.
- [x] **T109** — Verify Provisioning, Roles, Content, and Media Locally.
      -> REQ: REQ-67, REQ-69, REQ-70, REQ-71, REQ-72 · deps: [T103, T104, T105, T106, T107] · Done when: installer contract tests prove no-side-effect planning and approval gates; browser checks prove owner/collaborator isolation, D1 draft/publish, R2 upload/serve, and 390px layout; static checks, tests, tenant validation, and both tenant builds pass.

## Phase 37: Confirmed Shipping Queue and Explicit Mengantar Push — Complete Locally

Implementation, contract tests, static checks, build, and focused authenticated desktop/mobile browser scenarios passed on 2026-08-11. Live provider mutation, remote migration, and deployment remain operator-gated.

- [x] **T110** — Keep Every New Order Pending Until Operator Confirmation.
      -> REQ: REQ-74 · deps: [T50, T79, T85] · Done when: both checkout paths persist without calling Mengantar, every order starts in Order Management, and confirmation—not payment or checkout—moves a verified order to `processing` in Shipping.
- [x] **T111** — Add Searchable Optional-Precision Order Destination Editing.
      -> REQ: REQ-75 · deps: [T27, T66, T67] · Done when: the order editor searches district or city terms, defaults to one real Mengantar area per grouped district, optionally exposes precise kelurahan/desa results, persists the selected provider identity and human-readable location, re-quotes actual public courier prices, and blocks confirmation while destination or courier data is incomplete.
- [x] **T112** — Add Explicit Eligible Single/Bulk Mengantar Push in Shipping.
      -> REQ: REQ-41 · constraints: [REQ-74, REQ-76] · deps: [T57, T110, T111] · Done when: Shipping exposes per-row Push plus bulk checklists, eligibility is server-derived, eligible calls execute sequentially, and the response reports independent success/unpaid/skipped/failed outcomes.
- [x] **T113** — Verify Confirmation, Retry, and Waybill Semantics.
      -> REQ: REQ-76 · constraints: [REQ-43] · deps: [T112] · Done when: a focused scenario proves confirmation moves an order into Shipping without provider mutation, failed dispatch remains `processing` and retryable, provider identity is accepted only from provider output, and absent `cnote_no` is never fabricated.

## Phase 38: Petani Sejahtera Preview Catalog — Deployed

- [x] **T114** — Import the Selected Product Catalog into Preview D1.
      -> REQ: REQ-70, REQ-71, REQ-72 · deps: [T103, T105, T106] · Done when: Aussie, Bensu, Saratoga, and Kojien are active with 500ml and 1 Liter variants, source-backed prices and copy, and published runtime content without a compiled storefront fallback.
- [x] **T115** — Refine Catalog and Product Presentation.
      -> REQ: REQ-72 · deps: [T114] · Done when: catalog cards disclose the starting-price basis and variant count, product pages expose both variant prices and SKUs, shipping guidance is factual, and no countdown or fabricated scarcity message appears.
- [x] **T116** — Verify and Release the Preview Catalog.
      -> REQ: REQ-66 · deps: [T114, T115] · Done when: tests, static checks, build, tenant dry-run, remote D1 verification, guarded preview deployment, and desktop/mobile live browser checks pass without changing the production domain or invoking Mengantar.

## Phase 39: Mobile-First Petani Sejahtera Storefront — Deployed

- [x] **T117** — Lock the Preview Storefront to the Mobile Web-App Shell.
      -> REQ: REQ-72 · deps: [T115] · Done when: the preview uses the compact storefront, remains fluid below 480px, and stays centered at exactly 480px on wider viewports without desktop-only internal layouts.
- [x] **T118** — Adapt Home, Catalog, and Product Presentation.
      -> REQ: REQ-72 · deps: [T114, T117] · Done when: the visual hierarchy follows the standalone Petani Sejahtera storefront, preserves runtime D1 content, exposes product variants and prices, and keeps every product route touch-accessible.
- [x] **T119** — Preserve and Verify the Existing Checkout Form.
      -> REQ: REQ-11, REQ-72 · deps: [T118] · Done when: product pages retain the current CMSAds form fields, validation, selectors, and interaction flow; mobile controls remain at least 16px; local and live browser checks pass at 390px, 480px, and a wide viewport.


## Phase 40: Mobile Checkout Field Polish — Deployed

- [x] **T120** — Use Compact Shopify-Style Floating Labels.
      -> REQ: REQ-11, REQ-72 · deps: [T119] · Done when: both middle and full checkout modes show a single-line control whose label sits inside at rest and shrinks above the value on focus/fill, with 16px text, compact height, and no change to field IDs, names, or validation contracts.
- [x] **T121** — Establish Accessible Field and Summary States.
      -> REQ: REQ-11 · deps: [T120] · Done when: neutral, focus, valid, and invalid states are visually distinct; the recipient group, variants, payment choice, and summary share one restrained surface hierarchy.
- [x] **T122** — Verify Checkout Polish Locally.
      -> REQ: REQ-11, REQ-72 · deps: [T120, T121] · Done when: static validation and build pass; 390px middle/full form checks cover focus, error feedback, district selection, and overflow; the 1280px shell remains 480px wide.
- [x] **T123** — Release and Smoke Test the Preview Form.
      -> REQ: REQ-66, REQ-72 · deps: [T122] · Done when: guarded preview deployment succeeds and live 390px middle/full checks confirm the new surfaces, 16px/52px controls, district lookup, zero overflow, and clean console/network results without submitting an order.
- [x] **T124** — Compact the Selected-District Chip.
      -> REQ: REQ-11, REQ-75 · deps: [T111, T120] · Done when: the confirmed kecamatan renders as one precise, minimal line block (small title, truncated subtitle, small `Ubah` link) without a tall card, and the `Ubah` reset flow still works.
- [x] **T125** — Shrink and Group Payment Methods.
      -> REQ: REQ-11 · deps: [T121] · Done when: payment rows are compact but clear; COD and QRIS stay top-level; all bank/Virtual Account channels collapse into one accordion that shows the bank count when closed and the selected bank when chosen, auto-expands on bank selection, fills only the chosen bank's radio, and collapses when COD/QRIS is selected — with no change to payment field names, hidden inputs, validation, or submission contracts.
- [x] **T126** — Verify and Release District/Payment Polish.
      -> REQ: REQ-66, REQ-11 · deps: [T124, T125] · Done when: static validation, tests, and build pass; 390px checks prove the compact chip, grouped payment expand/collapse, and single-selection behavior with zero overflow; guarded preview deployment succeeds and the live full form renders the grouped payment UI without console/network errors and without submitting an order.

## Phase 41: Remove Checkout Email Field — Deployed

- [x] **T127** — Remove the Customer Email Input Without Breaking Online Payment.
      -> REQ: REQ-11 · deps: [T119] · Done when: the checkout form no longer shows or requires an email, submit readiness no longer gates on email, online (non-COD) orders still receive a valid synthesized email server-side for AutoLaris, COD stays email-null, tests/checks/build pass, and a live preview smoke reaches the ready state for COD and Virtual Account without an email field or console/network errors.

## Phase 42: City/District Search, Normal-Price Summary, and Actual Shipping — Deployed

- [x] **T128** — Match Location Search by City or District.
      -> REQ: REQ-75 · deps: [T111, T124] · Done when: the full-form search returns kecamatan for both a district query and a city query (district-first ranking), a city search lets the buyer pick a kecamatan that resolves to the real Mengantar area id, and copy reads "kecamatan atau kota"; a catalog test covers district and city lookups.
- [x] **T129** — Label the Summary Strikethrough as "Harga Normal".
      -> REQ: REQ-11 · deps: [T121] · Done when: both full and middle summary cards label the strikethrough row "Harga Normal", the after-discount price remains the valid total, and no id/value changes.
- [x] **T130** — Quote the Actual Courier Shipping Cost.
      -> REQ: REQ-43, REQ-75 · deps: [T57] · Done when: `estimateRates` returns the actual courier `price` (falling back to the special price only when missing), and the client summary plus server-side re-quote stay consistent.
- [x] **T131** — Verify and Release the Checkout Improvements.
      -> REQ: REQ-66 · deps: [T128, T129, T130] · Done when: tests/checks/build pass and a live preview smoke proves city search, the "Harga Normal" label, kecamatan resolution, actual shipping, and a correct after-discount total without submitting an order.

## Phase 43: Responsive Admin Commerce Workspace — Deployed to Preview

- [x] **T132** — Establish One Responsive Admin Navigation Contract.
      -> REQ: REQ-40, REQ-50, REQ-61 · deps: [T87] · Done when: desktop sidebar, command search, mobile app bar, and all-menu sheet consume one route definition; tenant identity and active-route state stay consistent; all controls remain keyboard-operable.
- [x] **T133** — Recompose Dashboard and Core Operations Surfaces.
      -> REQ: REQ-21, REQ-22, REQ-29 · deps: [T132] · Done when: Dashboard, Order Management, Shipping, Product, and Content use the shared page hierarchy, compact KPI/filter patterns, responsive desktop/mobile layouts, and existing APIs without changing business contracts.
- [x] **T134** — Standardize Admin Configuration and Feedback Surfaces.
      -> REQ: REQ-31, REQ-32, REQ-33, REQ-35, REQ-36, REQ-37, REQ-39, REQ-46 · deps: [T132] · Done when: Ads, payments, expeditions, settings, profile, access, warehouse, and CRM routes use consistent headers, loading/error/status regions, form controls, and navigation back paths.
- [x] **T135** — Repair the Desktop Order Data Grid.
      -> REQ: REQ-22, REQ-25, REQ-41 · deps: [T133] · Done when: every desktop row has one cell per header, dispatch eligibility feedback sits with the invoice instead of the checkbox, timestamps render in WIB, CRM controls align under their own column, and bulk/order actions remain reachable.
- [x] **T136** — Verify the Complete Admin Workspace.
      -> REQ: REQ-18, REQ-40 · deps: [T132, T133, T134, T135] · Done when: tests, static checks, and the Cloudflare build pass; every static admin route plus real product-edit and order-detail routes returns HTTP 200; 1440px and 390px browser flows prove the shell, app menu, filters, tables/cards, and route navigation without page-level horizontal overflow.
- [x] **T137** — Release and Smoke Test the Preview Admin Build.
      -> REQ: REQ-18, REQ-40, REQ-66 · deps: [T136] · Done when: guarded tenant deployment publishes only `petanisejahtera-preview`; live storefront/product routes return HTTP 200 at 390px without horizontal overflow; unauthenticated admin navigation reaches the branded login; and the protected orders API returns HTTP 401 without mutating D1 or calling live providers.

## Phase 44: Precise Admin Date Filters — Deployed to Preview

- [x] **T138** — Unify Admin Date Presets and Defaults.
      -> REQ: REQ-21, REQ-22, REQ-29, REQ-77 · deps: [T133] · Done when: Dashboard, Order Management, and Shipping use one labelled preset contract, list `Semua waktu` first, default to it, and render sentence-case Indonesian labels instead of raw internal values.
- [x] **T139** — Correct Filter Boundaries, Search, and Reset Behavior.
      -> REQ: REQ-22, REQ-29, REQ-77 · deps: [T138] · Done when: seven/30-day windows contain exactly 7/30 inclusive Jakarta dates; Orders and Shipping apply the same server range; order search genuinely matches the advertised resi field; every Reset clears the period; custom analytics ranges reject invalid or over-31-day input.
- [x] **T140** — Verify Responsive Filter Workflows.
      -> REQ: REQ-40, REQ-77 · deps: [T138, T139] · Done when: tests/check/build pass; authenticated desktop and 390px browser flows exercise all-time, yesterday, seven-day, custom, search, empty, and reset states without horizontal overflow.
 
## Phase 45: Order Workflow, Editor, and Command Search Refinement — Historical, Dispatch Flow Superseded by T199

- [x] **T141** — Route Confirmation into the Shipping Queue (Superseded by T199).
      -> REQ: REQ-74, REQ-76 · deps: [T110] · Historical result: implemented a local `confirm-shipping` transition. T199 removed that transition so only provider acceptance can expose an order in Shipping.
- [x] **T142** — Place Single and Bulk Provider Push in Shipping (Superseded by T199).
      -> REQ: REQ-41, REQ-76 · deps: [T112, T141] · Historical result: implemented sequential provider Push controls in Shipping. T199 moved them to Order Management and retained per-order outcomes.
- [x] **T143** — Refine the Order Destination and Courier Editor.
      -> REQ: REQ-75 · deps: [T111, T130] · Done when: the editor has grouped customer/address/destination sections, city-or-district search resolves subdistrict choices, deep-linked Shipping edits open automatically, and actual public prices render without duplicate courier or day labels.
- [x] **T144** — Rebuild Responsive Admin Command Search.
      -> REQ: REQ-40 · deps: [T132] · Done when: desktop and mobile triggers plus `Ctrl/Cmd+K` open one full command palette, normalization tolerates Indonesian text, route label/description/group/keyword search returns the correct item, and Enter navigates.
- [x] **T145** — Verify the Refined Order Workflow Locally (Historical proof superseded by T199).
      -> REQ: REQ-40, REQ-41, REQ-74, REQ-75, REQ-76 · deps: [T141, T142, T143, T144] · Historical result: verified the then-current local-confirmation flow, location editor, and command search. T199 supplies the current provider-accepted-only workflow proof.

## Phase 46: Canonical Multi-Tenant Admin and Workflow Release — Deployed to Preview

- [x] **T146** — Separate the Canonical Admin System from Storefront Presentation.
      -> REQ: REQ-40, REQ-50, REQ-61 · deps: [T132, T145] · Done when: every tenant build consumes the same admin navigation, ADScms visual tokens, responsive behavior, lifecycle, and operator components while storefront template/theme/content remain tenant-selectable.
- [x] **T147** — Release and Smoke Test the Refined Preview Admin.
      -> REQ: REQ-41, REQ-66, REQ-74, REQ-75, REQ-76 · deps: [T145, T146] · Done when: tests, static checks, tenant validation/build/dry-run pass; the guarded preview deployment succeeds; live storefront and unauthenticated admin/API checks pass without a production-domain, remote-D1, or live-provider mutation.

## Phase 47: Canonical Admin Density and Login Background — Deployed to Preview

- [x] **T148** — Refine Canonical Admin Density and Search Placement.
      -> REQ: REQ-40, REQ-78 · deps: [T146] · Done when: every static admin workspace plus real order/product detail routes uses the compact shared hierarchy; desktop search is viewport-centered, mobile search is a full-width bottom sheet, the mobile all-menu remains scrollable, and no audited route has page-level horizontal overflow.
- [x] **T149** — Add the Fixed Responsive Admin Login Background.
      -> REQ: REQ-40, REQ-78 · deps: [T148] · Done when: the Mac-provided `ferioyes.png` is converted to the repository-owned `admin-login.webp`, the canonical login uses it behind a readable fixed credential card, 320px through 2560px viewports fit without horizontal or vertical overflow, and mobile inputs remain 16px.
- [x] **T150** — Validate and Release the Refined Preview Admin.
      -> REQ: REQ-18, REQ-40, REQ-66, REQ-78 · deps: [T148, T149] · Done when: tests, static checks, preview tenant build/dry-run, authenticated local route screening, guarded preview deployment, live storefront/login/API smoke, and desktop/mobile visual checks pass without remote D1 or live-provider mutation.

## Phase 48: Mobile Search Sheet and Session Exit — Deployed to Preview

- [x] **T151** — Replace Mobile Search Dialog with a Bottom Sheet.
      -> REQ: REQ-40, REQ-78 · deps: [T148] · Done when: the mobile search icon opens a bounded, bottom-anchored Sheet with focused 16px command input and scrollable results; `pengiriman` resolves to one Shipping route and Enter navigates; desktop `Ctrl/Cmd+K` remains a centered dialog.
- [x] **T152** — Add and Verify Mobile All-Menu Logout.
      -> REQ: REQ-18, REQ-40, REQ-78 · deps: [T151] · Done when: the all-menu shows a visible 44px-or-taller `Keluar` row, submits the existing POST logout contract, invalidates the active session, redirects to `/hello`, and tests/checks/tenant validation/build/dry-run plus guarded preview release pass without changing storefront presentation or another tenant.

## Phase 49: Precise Mobile Bulk Selection — Deployed to Preview

- [x] **T153** — Normalize Order and Shipping Mobile Density.
      -> REQ: REQ-40, REQ-78, REQ-79 · deps: [T148] · Done when: Order Management and Shipping filters use two aligned mobile columns, cards align to the shared workspace gutter, action controls remain at least 44px, and neither page has horizontal overflow at 390px.
- [x] **T154** — Add Filter-Aware Bulk Selection Navigation.
      -> REQ: REQ-41, REQ-79 · deps: [T141, T153] · Done when: selection starts empty; separate master controls select/deselect every visible push or pickup row; partial selection is indeterminate; selected cards, live counts, clear-selection, and explicit Push/Pickup actions remain visible in a sticky mobile toolbar; desktop exposes an equivalent master checkbox.
- [x] **T155** — Verify Bulk Selection without Provider Mutation.
      -> REQ: REQ-18, REQ-41, REQ-79 · deps: [T154] · Done when: tests/checks/tenant validation/build/dry-run pass, browser QA proves zero/partial/all/clear states and sticky behavior at 390×844, and no Push or Pickup mutation is submitted during verification.
- [x] **T156** — Add the AI-Agent Cloudflare Deployment Runbook.
      -> REQ: REQ-18, REQ-66 · deps: [T147] · Done when: repository docs require one exact tenant, local release gates, separately approved deployment and migration commands, wrapper-only release, selected-host smoke checks, fail-closed behavior, and evidence/non-action reporting.
- [x] **T157** — Release and Smoke Test Mobile Bulk Selection.
      -> REQ: REQ-18, REQ-79 · deps: [T155, T156] · Done when: the scoped commit is pushed, the guarded wrapper deploys only `petanisejahtera-preview`, and selected-host storefront/login/API smoke passes without remote D1, provider, pickup, or order mutation.

## Phase 50: Indonesian Visual System Guide — Complete Locally

- [x] **T158** — Build the Multi-Page Visual System Guide.
      -> REQ: REQ-80 · deps: [T156] · Done when: `doc/preview` contains one responsive shared shell plus Indonesian overview, architecture/data, admin operations, order/shipping, tenant/Cloudflare, and setup/release pages using Tailwind Play CDN and repository-local CSS/JavaScript.
- [x] **T159** — Verify Visual Guide Structure and Responsive Navigation.
      -> REQ: REQ-78, REQ-80 · deps: [T158] · Done when: all local references and section anchors resolve, six pages render at 1440×1000 and 390×844 with the correct active navigation and zero page-level horizontal overflow, mobile navigation opens and changes pages, and browser QA reports no console error or failed request.

## Phase 51: a retired tenant Storefront Integrity — Complete Locally

- [x] **T160** — Remove Synthetic Storefront Trust and Discount Signals.
      -> REQ: REQ-64, REQ-81 · deps: [T135] · Done when: product pages no longer synthesize ratings, review/sales counts, bestseller badges, guarantees, or comparison discounts; structured data includes ratings/reviews only when evidence-backed content supplies them; and no-discount variants hide comparison rows after selection.
- [x] **T161** — Align the Wide-Catalog Tenant Shell.
      -> REQ: REQ-50, REQ-72, REQ-82 · deps: [T160] · Done when: a retired tenant product detail, shared header/footer, legal links, theme color, metadata image, and product-image semantics match the `wide-catalog` tenant at desktop and 320–390px mobile widths without horizontal overflow or another merchant's copy.
- [x] **T162** — Ground AI Homepage Generation in D1 Facts.
      -> REQ: REQ-63, REQ-64, REQ-67, REQ-81 · deps: [T160] · Done when: homepage generation receives active product and variant facts through one D1 batch, fabricated asset paths are prohibited, and AI-created testimonial/review arrays remain empty pending evidence-backed manual entry.
- [x] **T163** — Validate and Record a retired tenant Audit.
      -> REQ: REQ-18, REQ-66, REQ-81, REQ-82 · deps: [T160, T161, T162] · Done when: tests, Astro/TypeScript checks, tenant validation, a retired tenant build/dry-run, local fixture storefront/browser QA, default-gated admin login, legal-route checks, and no-provider-mutation reporting pass before the scoped commit.

## Phase 52: Canonical Documentation and AI-Agent Operations — Complete Locally

- [x] **T164** — Reconcile the Canonical Documentation Pack.
      -> REQ: REQ-63, REQ-66, REQ-74, REQ-76, REQ-80, REQ-81, REQ-82 · deps: [T159, T163] · Done when: README, AGENTS, PLAN, PRD, STATUS, remaining-work ledger, Cloudflare runbook, Mengantar specification, and storefront design contract agree on current ownership, runtime content, order/shipping lifecycle, tenant roster, evidence boundaries, and genuine blockers without stale pending-Main claims or absolute workstation paths.
- [x] **T165** — Audit and Remove the Orphan a retired tenant Worker.
      -> REQ: REQ-62, REQ-66, REQ-83 · deps: [T163] · Done when: account-wide inventory proves `deleted-orphan-worker` has no Custom Domain, zone route, or enabled workers.dev endpoint; exact deletion is approved; only that Worker is deleted; canonical `retired-backend-worker`, `retired-tenant.example`, and shared D1/KV/R2 remain; and the hostname still responds.
- [x] **T166** — Add and Verify the Visual AI-Agent Runbook.
      -> REQ: REQ-66, REQ-80, REQ-83 · deps: [T164, T165] · Done when: `doc/preview/ai-agent.html` covers source selection, task flow, validation, approval gates, release, orphan cleanup, and handoff; every visual-guide page shares the seven-page navigation; all Markdown/HTML links and fragments resolve; portable-path and duplicate-ID audits pass; and desktop/mobile browser QA reports correct navigation with no console error, failed request, or page-level horizontal overflow.

## Phase 53: a retired tenant Headless Storefront Boundary — Deployed

- [x] **T167** — Restore the Standalone a retired tenant Storefront.
      -> REQ: REQ-84 · deps: [T165] · Done when: the GitHub-tracked standalone Astro storefront owns `retired-tenant.example/*`, public home and product pages render the original frontend at mobile and desktop widths, and no CMSAds setup state replaces it.
- [x] **T168** — Add the Private CMSAds Gateway Boundary.
      -> REQ: REQ-49, REQ-62, REQ-84 · deps: [T167] · Done when: the storefront Worker serves static paths, forwards `/admin`, `/api`, `/hello`, `/payment`, `/thanks`, and canonical checkout routes through a `CMSADS` service binding, and routing tests prevent accidental public-path delegation.
- [x] **T169** — Make a retired tenant Backend Service-Only.
      -> REQ: REQ-49, REQ-52, REQ-62, REQ-66, REQ-84 · deps: [T168] · Done when: the CMSAds registry declares a retired tenant service-only with no public route, validation rejects both ingress-mode inversions, both tenant dry-runs pass, deployment reports no CMSAds target, and live delegated login/API checks still pass.
- [x] **T170** — Reconcile and Verify the Headless Architecture.
      -> REQ: REQ-66, REQ-84 · deps: [T169] · Done when: README, PRD, TASKS, STATUS, build log, and Cloudflare runbook agree on route/data ownership; standalone tests/check/build/dry-run and CMSAds tests/check/registry/dry-runs pass; and live mobile/desktop smoke records concrete results.

## Phase 54: Portable New-Account Installation Proof — Planned

- [x] **T171** — Prove the Portable Local Installer Boundary. **Obsolete 2026-09-25:** `scripts/install.sh` no longer exists; installation is the `/install` wizard (`INSTALLATION.md`).
      -> REQ: REQ-85 · deps: [] · Done when: a clean supported workstation runs `./scripts/install.sh` with the default and one explicit registered profile, records the expected lockfile/registry/type/static-check results, and records that no Cloudflare authentication, resource creation, remote migration, deployment, DNS/secret change, or data import occurred.
- [ ] **T172** — Prove Immutable-Sample Provisioning in a New Account.
      -> REQ: REQ-87, REQ-98 · deps: [T171] · Done when: an explicitly approved test tenant plan reports unique D1/KV/R2/AI resources, `runtime-managed`, the canonical immutable sample, and `importsExistingTenantData: false`; approved provisioning creates schema, one store row, one forced-rotation owner, product `10001`, and variants `20001`/`20002`; repository queries prove no sibling merchant products, content, media, customers, orders, payments, provider config, tracking credentials, sessions, or secrets were copied.
- [ ] **T173** — Exercise Both Ingress Topologies.
      -> REQ: REQ-88 · deps: [T172] · Done when: an integrated test tenant proves an exact CMSAds Custom Domain, a headless test tenant proves no CMSAds public route plus one reviewed storefront service binding, and independent dry-run/smoke evidence distinguishes each Worker and every non-action.

## Phase 55: Headless Public Data, Locked Forms, and Tracking Adapters — Planned

- [x] **T174** — Implement the Public Non-Secret Storefront Bootstrap. **Confirmed done 2026-09-25:** `/api/v1/storefront` (`headless-api.test.ts`).
      -> REQ: REQ-92 · deps: [T173] · Done when: a documented public read endpoint returns only reviewed tenant identity and browser tracking fields, rejects cross-tenant resolution, never serializes CAPI/provider/session/customer/payment secrets, and contract tests cover configured, unconfigured, and malformed requests.
- [x] **T175** — Implement the Canonical Public Catalog Contract. **Confirmed done 2026-09-25:** `/api/v1/products` and `/api/v1/products/[slug]` (`headless-api.test.ts`, `headless-client.test.ts`).
      -> REQ: REQ-93 · deps: [T174] · Done when: public product/list reads expose only active canonical products and variants with D1 identity, presentation, price, availability, weight, and media; inactive/unknown/cross-tenant inputs fail closed; a headless storefront renders from the contract without maintaining a second product identity.
- [ ] **T176** — Prove Canonical Form Delegation in a Selected Headless Gateway.
      -> REQ: REQ-94, REQ-96 · deps: [T174, T175] · Done when: the selected headless gateway delegates `/hybrid-form`, `/middle-form`, and `/full-form` through its private CMSAds binding, rejects legacy `/form-*` aliases, routing tests prove public storefront paths remain local, and mobile/desktop flows preserve product, variant, campaign, click, event, source, and error/focus context without duplicating form markup.
- [ ] **T177** — Publish a Framework-Neutral Executable Storefront Adapter.
      -> REQ: REQ-94, REQ-100 · deps: [T176] · Done when: the smallest reusable adapter or reference implementation covers bootstrap, catalog, form handoff, order confirmation, error mapping, attribution identity, and accessible focus return, and executable contract scenarios pass for every declared supported frontend. The reusable documentation prompt alone does not complete this task.
- [ ] **T178** — Complete the Meta Browser/CAPI Storefront Adapter.
      -> REQ: REQ-91 · deps: [T174, T177] · Done when: PageView/ViewContent/AddToCart/InitiateCheckout/Purchase use canonical D1 `content_ids`, approved `_fbp`/`_fbc` and click identifiers are preserved, CAPI secrets remain server-only, COD versus paid Purchase gates are proven, and browser/server Purchase share one dedicated event ID without refresh duplication.
- [ ] **T179** — Implement Consent-Aware Cross-Storefront Tracking.
      -> REQ: REQ-95 · deps: [T178] · Done when: optional tags and events obey the selected tenant's reviewed consent rule, consent context survives the locked-form handoff, checkout remains usable when tracking is declined or unavailable, and browser emission, CMSAds acceptance, Meta acceptance, attribution, and reporting are displayed and tested as separate states.

## Phase 56: Canonical Forms, Province Policy, Sample, Sidebar, and Handoff — Complete Locally

- [x] **T180** — Maintain Canonical Form Routes with Legacy Link Compatibility.
      -> REQ: REQ-94, REQ-96 · deps: [] · Done when: local requests render `/hybrid-form`, `/middle-form`, and `/full-form`; `/form-hybrid`, `/form-middle`, and `/form-full` permanently redirect to their corresponding renderer with the full query string preserved; known eligible province resolves middle; and COD-disabled or unknown/unresolved province resolves full.
- [x] **T181** — Persist and Enforce the Tenant Province Policy.
      -> REQ: REQ-97 · deps: [T180] · Done when: `cod_disabled_province_codes` is store-scoped and distinct from courier exclusions, the admin renders all 38 recognized provinces with the observed tenant policy selecting 15, and server form/payment behavior rejects disabled COD consistently.
- [x] **T182** — Install and Protect the Canonical Sample.
      -> REQ: REQ-87, REQ-98 · deps: [] · Done when: local migration `0017` succeeds; product `10001` (`aussie`, `Aussie Sample`) and variants `20001` (`500ml`, Rp150,000, `600g`) and `20002` (`1 Liter`, Rp300,000, `1100g`) are present; installer verification preserves exact IDs/values; and admin/API mutation attempts return `409`.
- [x] **T183** — Make the Admin Sidebar Accordion Accessible and Short-Viewport Safe.
      -> REQ: REQ-99 · deps: [] · Done when: desktop browser proof shows the active section opens, opening another section closes the first, accessible expanded state follows the visible state, and the navigation scrolls independently in a short viewport.
- [x] **T184** — Publish the Reusable Storefront Implementation Prompt.
      -> REQ: REQ-100 · deps: [T180, T181] · Done when: `STOREFRONT_INTEGRATION.md` contains the framework/domain/Worker/account-neutral prompt, canonical routes and fail-closed province policy, service-only isolation, no-animation boundary, explicit remote-approval gates, and the rule that absent public bootstrap/catalog APIs block catalog implementation instead of permitting fake static data.
- [ ] **T185** — Prove New-Account Provisioning and Remote Release.
      -> REQ: REQ-86, REQ-87, REQ-88, REQ-98 · deps: [T171, T172, T173] · Done when: exact-tenant approval is recorded; isolated remote resources, migration, canonical sample, owner bootstrap, ingress topology, and no imported sibling data are proved; deployment is separately approved and observed; and provider acceptance remains separately evidenced.

## Phase 57: AutoLaris Payment Confirmation Boundary — Complete Locally

- [x] **T186** — Render QRIS and Gate the Success Receipt.
      -> REQ: REQ-11, REQ-12, REQ-84 · deps: [T83, T168] · Done when: online checkout routes to `/payment`; a recorded QRIS payload renders as a scannable QR; pending, failed, and expired states do not show a successful receipt; token-authorized polling redirects paid orders to `/thanks`; the paid receipt omits raw QR payload; Permata gateway tests include `/payment`; CMSAds tests/check/build and mobile/desktop browser proof pass without creating an order or calling a provider.

## Phase 58: Checkout Price, Destination, and Payment Precision — Complete Locally

- [x] **T187** — Synchronize Variant Pricing and Shipping.
      -> REQ: REQ-101 · deps: [T180, T182] · Done when: changing between the canonical sample variants updates the summary label, comparison price, discount, final total, and re-quotes shipping for an already selected destination.
- [x] **T188** — Resolve Ambiguous Kecamatan in Customer and Admin Flows.
      -> REQ: REQ-102 · deps: [T180] · Done when: `Taman` presents district-plus-city choices, selecting `Taman, Sidoarjo` resolves a real Mengantar destination ID with postal code `61257`, the district representative ranks before villages, and customer/admin flows use the same two-stage contract.
- [x] **T189** — Clarify Indonesian Online Payment and OMS Status.
      -> REQ: REQ-103 · deps: [T186] · Done when: QRIS, Virtual Account, and supported e-wallet records render channel-specific instructions and transparent amount/fee details without mobile overflow, while Order Management labels all paid-equivalent statuses as `Lunas`.

## Phase 59: AutoLaris Active Channel Enforcement — Complete Locally

- [x] **T190** — Disable Provider-Rejected DANA Checkout.
      -> REQ: REQ-104 · deps: [T186, T189] · Done when: `DANA` is absent from the public payment-method response and checkout UI, a forged `payment_channel=DANA` order fails schema validation before persistence or provider invocation, historical DANA payment details remain renderable, and tests/check/build pass.

## Phase 60: Retired Tenant Cloudflare Cleanup — Complete

- [x] **T191** — Retire the Removed Tenant Cloudflare Stack.
      -> REQ: REQ-105 · deps: [T170] · Done when: both exact tenant Workers and its isolated D1/KV/R2 resources are permanently deleted with explicit approval, sibling Petani resources remain present, the tenant is absent from deployable configuration, the standalone deployment config is removed, and remote inventory confirms absence.

## Phase 61: Final Removed-Tenant Purge — In Progress

- [x] **T192** — Remove Local Repository, Assets, and Named References.
      -> REQ: REQ-105 · deps: [T191] · Done when: the local standalone repository and tenant-specific CMSAds assets are deleted, and no tenant name, domain, Worker, repository, or branch identifier remains in the current CMSAds working tree.
- [ ] **T193** — Delete the Standalone GitHub Repository.
      -> REQ: REQ-105 · deps: [T192] · Done when: the exact private repository is absent from GitHub. Current blocker: the authenticated `gh` token lacks the `delete_repo` OAuth scope; `gh repo delete` returned HTTP `403`, and the interrupted device authorization did not complete.
- [x] **T194** — Rename the CMSAds Release Branch and Finalize.
      -> REQ: REQ-105 · deps: [T192] · Done when: the cleanup is committed and pushed to `petanisejahtera-preview`, the obsolete remote branch is removed, and CMSAds tests/check/build pass.

## Phase 62: Documentation Current-State Hardening — Complete Locally

- [x] **T195** — Reconcile Current Documentation and Visual Guide.
      -> REQ: REQ-66, REQ-80, REQ-105 · deps: [T192, T194] · Done when: current-state documentation reflects the single registered tenant, historical headless releases are not presented as active inventory, all local links/fragments and semantic landmarks pass static audit, the changed guide pages pass desktop/mobile browser QA without overflow or console/network errors, and tenant validation plus tests/check/build pass.

## Phase 63: Connected Multi-Tenant Architecture Guide - Complete Locally

- [x] **T196** — Visualize CMSAds Fleet and Tenant Isolation.
      -> REQ: REQ-66, REQ-80, REQ-88 · deps: [T195] · Done when: the HTML guide draws connected lanes from shared CMSAds source to current and future integrated/headless tenant runtimes; each lane identifies Worker, Admin/API, D1/KV/R2/AI, secrets, and provider boundaries; future examples cannot be mistaken for active inventory; and desktop/mobile browser QA plus project validation pass.

## Phase 64: Tenant Frontend Repository Boundary - Complete Locally

- [x] **T197** — Document Integrated and Headless Repository Ownership.
      -> REQ: REQ-66, REQ-88, REQ-93 · deps: [T196] · Done when: the HTML guide explains which tenants need a separate frontend repository, diagrams both repository-to-Worker-to-domain paths, keeps CMSAds backend ownership canonical, distinguishes independent release pipelines, blocks per-merchant backend forks, and passes desktop/mobile browser plus project validation.

## Phase 65: Invoice Receiver Scoring Route Repair - Complete Locally

- [x] **T198** — Repair Invoice Scoring Navigation and Lookup.
      -> REQ: REQ-38, REQ-68 · deps: [T95] · Done when: `Cek skor lengkap` from an invoice opens canonical `/admin/check` with the customer phone prefilled, receiver lookup calls implemented `/api/admin/check`, obsolete `/admin/scoring` references are absent from source, and browser plus project validation pass.

## Phase 66: Order-to-Mengantar Operational Cutover - Complete Locally

- [x] **T199** — Enforce Provider-Accepted Shipping and Order-Owned Dispatch.
      -> REQ: REQ-74, REQ-75, REQ-76, REQ-79 · deps: [T147] · Done when: pending orders stay in Order Management; district and city token search resolves a real Mengantar destination; eligible rows expose single and checklist bulk Push actions; bulk calls remain sequential with per-order results; only provider-accepted orders enter Shipping; rejected orders remain pending with an actionable error; Shipping owns resi/status/pickup only; and tests, typecheck, tenant validation, build, plus desktop/mobile browser QA pass.

## Phase 67: Product Form Links and Lightweight HTML Embed — In Progress Locally

- [x] **T200** — Expose Canonical Product Form Integration Links.
      -> REQ: REQ-106 · deps: [T199] · Done when: an authenticated operator viewing an active checkout-complete product can copy tenant-origin `middle`, `full`, and `hybrid` URLs for its canonical D1 product ID, optionally select a canonical variant ID, and copy a responsive no-parent-JavaScript iframe snippet when embedding is enabled; inactive or checkout-incomplete products show the exact blocker rather than a usable checkout link.
- [x] **T201** — Implement the Scoped Server-Rendered Embed Boundary.
      -> REQ: REQ-107 · deps: [T200] · Done when: one dedicated embed route renders the existing CMSAds form state machine without copying commerce logic; plain iframe HTML remains usable at mobile and desktop widths with a fixed-height fallback; an optional tiny adapter only synchronizes height; the response uses an explicit tenant origin allowlist in CSP `frame-ancestors` and omits `X-Frame-Options` only there; missing/invalid origins fail closed; every other route retains the non-frameable security contract.
- [ ] **T202** — Prove Cross-Origin Form Embed End to End.
      -> REQ: REQ-107 · deps: [T201] · Done when: an executable fixture on an allowed distinct origin loads the iframe without parent JavaScript, product/variant switching and destination/shipping/payment behavior use live CMSAds contracts, a valid submission creates exactly one pending D1 order, a disallowed origin is blocked by CSP, no secrets appear in browser responses, keyboard/focus/error behavior works, and mobile/desktop browser evidence plus project validation pass without invoking a live Mengantar mutation.

## Phase 68: Tenant Operator Role-Based Access Control — Complete Locally

- [x] **T203** — Implement Owner-Managed Operational Roles.
      -> REQ: REQ-17, REQ-18, REQ-71 · deps: [T196] · Done when: owner can create and revoke admin, advertiser, and customer-service credentials with forced password rotation; legacy collaborators migrate to advertiser; one deny-by-default policy governs sidebar/search visibility plus page/API enforcement including child routes; owner alone manages users; admin operates all other tenant workflows; advertiser is limited to dashboard/products/content/media/ads/profile; customer service is limited to dashboard/orders/shipping/check/rates/profile; unauthorized APIs return `403`; unauthorized pages redirect to the role default; and unit, type, tenant, build, plus desktop/mobile browser proof pass.

## Phase 69: Responsive Landing-Page Form Widget — Complete Locally

- [x] **T204** — Ship the Progressive CMSAds Form Widget.
      -> REQ: REQ-108 · deps: [T201] · Done when: the product embed dialog emits a copy-ready custom element with canonical product/variant/mode attributes, an eager fixed-height iframe fallback, exact-origin auto-height synchronization, reactive attribute updates, responsive mobile sizing, and retained plain iframe options; the loader adds no checkout or tracking fork; focused contract tests, typecheck, build, and mobile/desktop browser proof pass.

## Phase 70: Tenant Embed Policy and District Resolution — Complete Locally

- [x] **T205** — Move Embed Origin Policy into Tenant Settings.
      -> REQ: REQ-107, REQ-109 · deps: [T201] · Done when: owner/admin can view, normalize, save, clear, and immediately apply at most 25 exact HTTPS origins from Store & CS settings; domains and subdomains remain distinct; invalid origins are rejected; NULL rows retain the environment cutover fallback; stored empty and D1 failures fail closed; non-embed routes remain non-frameable; and focused tests, migration, project validation, plus desktop/mobile browser proof pass.
- [x] **T206** — Resolve Administrative District Names to Provider IDs.
      -> REQ: REQ-102 · deps: [T199] · Done when: the newer local district catalog remains discovery-only; administrative district/city prefixes normalize without a place-specific exception; Cakung plus Administrasi Jakarta Timur resolves only provider Cakung/Jakarta Timur results; same-name results from another city are excluded; unresolved IDs cannot reach quote/estimate calls; and focused tests, project validation, plus an executable provider-backed scenario pass.

## Phase 71: Provider District Coverage Hardening — Complete Locally

- [x] **T207** — Harden District Resolution Across Provider Naming Differences.
      -> REQ: REQ-102 · deps: [T206] · Done when: resolution retries bounded exact, compact-prefix-plus-city, and compact-prefix provider queries; acceptance still requires exact compact district plus normalized city; same-city provider results become explicit subdistrict alternatives when an exact match remains unavailable; a representative cross-region audit is executable; and focused tests, project checks, plus browser quote proof pass without saving an order.

## Phase 72: Exhaustive District Provider Screening — Complete Locally

- [x] **T208** — Screen Every Active District Against Mengantar.
      -> REQ: REQ-102 · deps: [T207] · Done when: all 7,284 unique active district-city-province records are screened through a resumable read-only provider audit; exact, explicit-provider-alternative, unavailable, and request-error outcomes are counted; measured spacing, punctuation, administrative, and historical city aliases are normalized without cross-city auto-selection; unresolved checkout selections switch to direct kelurahan/desa provider search; and browser proof reaches a real quote without saving an order.

## Phase 73: Historical Provider District Split Recovery — Complete Locally

- [x] **T209** — Resolve Jakabaring Against Mengantar's Legacy Palembang District.
      -> REQ: REQ-102 · deps: [T208] · Done when: selecting current `Jakabaring / Palembang` returns only its five verified kelurahan from Mengantar's legacy `Seberang Ulu I` records; unrelated legacy kelurahan and other cities are excluded; each choice preserves its real provider ID and postal code; and browser proof loads a real shipping quote without saving an order.

## Phase 74: COD Province Policy Normalization — Deployed to Preview

- [x] **T210** — Normalize Provider Province Names Before Applying COD Policy.
      -> REQ: REQ-103 · deps: [T209] · Done when: Mengantar's formal province names for DKI Jakarta and DI Yogyakarta normalize to the same canonical codes used by Store & CS Settings; only provinces listed in `cod_disabled_province_codes` lose COD; server validation uses the same policy; and mobile browser proof covers Jakarta, Yogyakarta, Jawa Barat, and disabled Jawa Timur without saving an order.

## Phase 75: Embed Checkout Handoff and Pickup Recovery — Deployed to Preview

- [x] **T211** — Redirect Embedded Checkout at the Parent Page.
      -> REQ: REQ-110 · deps: [T210] · Done when: successful embedded COD checkout replaces the landing page with `/thanks`; pending QRIS/VA checkout replaces it with `/payment`; widget and auto-height adapters validate message origin, iframe source, target origin, and allowed path; and plain iframe checkout attempts direct top navigation.
- [x] **T212** — Recover Missing or Stale Mengantar Pickup Address IDs.
      -> REQ: REQ-111 · deps: [T211] · Done when: Pickup Address ID is optional in warehouse settings; a valid provider address is reused by ID or exact profile; a stale ID is never sent back as an update target; a missing address is created by Mengantar; and only the confirmed provider ID is persisted locally.

## Phase 76: Payment Fee Attribution and City Shipping Fallback — Deployed to Preview

- [x] **T213** — Make AutoLaris Fee Ownership Explicit.
      -> REQ: REQ-112 · deps: [T212] · Done when: Store Payment Gateway settings expose one buyer/seller fee toggle; buyer is the schema and migration default; API responses calculate the configured AutoLaris fixed or percentage tariff; seller-paid fees are excluded from the customer total; and order plus payment records retain the applied bearer and amounts.
- [x] **T214** — Keep Advertising Conversion Value Merchandise-Only.
      -> REQ: REQ-113 · deps: [T213] · Done when: checkout receipts retain merchandise unit price and quantity separately from shipping, admin fee, and billed total; Meta browser/server Purchase, Google Ads conversion, and GTM ecommerce purchase receive only unit price times quantity; and duplicate transaction identifiers remain unchanged.
- [x] **T215** — Add the Internal ICO City-Average Expedition.
      -> REQ: REQ-114 · deps: [T214] · Done when: a destination with no eligible direct quote samples up to three distinct same-city provider destinations, averages their cheapest eligible quotes, rounds to Rp1,000, exposes `ICO · Estimasi rata-rata kota`, and returns no fabricated fallback when every sample is invalid.

## Phase 77: COD Service Fee and VAT Attribution — Pushed to Preview Branch

- [x] **T216** — Apply the COD Service Fee and VAT Policy.
      -> REQ: REQ-115 · deps: [T213] · Done when: COD charges 3% of merchandise plus shipping and 11% VAT on that service fee; Payment Gateway settings expose an independent buyer/seller COD policy; all checkout variants, order persistence, admin edits, order detail, and Mengantar collection amounts use the same fee breakdown; and seller-paid fees remain excluded from the customer total.

## Phase 78: Provider-Neutral Location Recovery and Payment UX — Deployed to Preview

- [x] **T217** — Remove Provider Branding from Browser Surfaces.
      -> REQ: REQ-116 · deps: [T216] · Done when: a repository scan of browser-rendered copy and browser-consumed API errors finds no `Mengantar` brand, while courier names and internal provider implementation identifiers remain intact.
- [x] **T218** — Open Related Destinations for District Mismatches.
      -> REQ: REQ-117 · deps: [T217] · Done when: focused location contracts and a browser search show that selecting an unresolved district opens same-city alternatives immediately, and Jakabaring prioritizes related Seberang Ulu destinations without another typed query.
- [x] **T219** — Remove Fee-Bearer Copy from Public Checkout.
      -> REQ: REQ-118 · deps: [T217] · Done when: COD, QRIS, and Virtual Account options still disclose their tariff but public payment copy contains neither buyer-paid nor seller-paid attribution; authenticated policy controls remain explicit.
- [x] **T220** — Add Approved Bank Image Marks.
      -> REQ: REQ-119 · deps: [T219] · Done when: the nine approved PNG assets from the operator workstation are represented as optimized local SVG image assets, checkout and `/payment` map every supported channel to the right mark, and failed assets retain a readable bank label.
- [x] **T221** — Persist Seller Bank Accounts.
      -> REQ: REQ-120 · deps: [T216] · Done when: a D1 migration creates ordered store-scoped seller bank accounts, validation accepts only supported bank codes plus valid holder/account data, duplicates are rejected, and focused contracts cover normalization and ordering.
- [x] **T222** — Manage Seller Accounts in Payment Settings.
      -> REQ: REQ-120 · deps: [T221] · Done when: an authenticated owner/admin can add, edit, activate, reorder, and remove multiple seller accounts with inline errors and persisted reload results at mobile and desktop widths.
- [x] **T223** — Separate Virtual Account and Seller Transfer Checkout.
      -> REQ: REQ-121 · deps: [T220, T221] · Done when: checkout exposes distinct Virtual Account and Transfer Bank groups, selecting seller transfer submits a manual-transfer order without an AutoLaris request, snapshots the chosen account, applies zero admin fee, and routes to `/payment`.
- [x] **T224** — Render Manual Bank Transfer Payment Instructions.
      -> REQ: REQ-122 · deps: [T223] · Done when: a stored manual-transfer order reloads through the public status token and `/payment` shows the snapshotted logo, holder, account number, exact amount, copy controls, manual verification notice, and transfer guide without an automatic confirmation claim.
- [x] **T225** — Refine Buyer and Admin Payment Interfaces.
      -> REQ: REQ-123 · deps: [T218, T219, T220, T222, T224] · Done when: browser checks at 390px and 1280px exercise checkout selection, seller-account management, QRIS/VA payment, and manual transfer with no page-level overflow, clipped controls, keyboard-inaccessible actions, console errors, or failed application requests.
- [x] **T226** — Release Payment and Location Refinements to Preview.
      -> REQ: REQ-123 · deps: [T225] · Done when: focused tests, `npm run check`, tenant validation, and production build pass; documentation records evidence; commits are pushed; the remote migration precedes the approved preview Worker deployment; and deployed mobile/desktop browser smoke checks pass.

## Phase 79: Public Checkout Payment Mark Alignment — Deployed to Preview

- [x] **T227** — Center and Standardize Public Payment Marks.
      -> REQ: REQ-119 · deps: [T226] · Done when: COD, QRIS, Virtual Account, and seller-bank rows use compact `3:2` marks with subtle rounding, COD has a text treatment matching the image footprint, every mark is vertically centered against the complete payment row, and mobile/desktop browser checks show no horizontal overflow.

## Phase 80: Payment Fee Clarity and Public Asset Payload — Deployed to Preview

- [x] **T228** — Expose Actual Checkout Fees Across Variant and Shipping Changes.
      -> REQ: REQ-124 · deps: [T216, T225] · Done when: full checkout recalculates the displayed COD and QRIS amount after variant or shipping changes, Virtual Account rows retain their concrete fixed fee with readable label spacing, and middle checkout plus its thank-you state distinguish the product estimate from Customer Service-confirmed final charges.
- [x] **T229** — Standardize Public Payment Assets and Discovery Records.
      -> REQ: REQ-119, REQ-125 · deps: [T227] · Done when: COD uses a compressed local `3:2` image, all checkout marks share one compact frame, and `/api/payment-methods` returns only frontend-safe channel, fee, state, and local asset data.
- [x] **T230** — Clarify Authenticated Payment Policy and Login Identity.
      -> REQ: REQ-126 · deps: [T225] · Done when: Payment Gateway settings explain fixed and percentage AutoLaris tariffs plus buyer/seller effects, and the login header no longer repeats the tenant domain below the CMS logo.

## Phase 81: Seller Bank Validation and Stable Payment Selection — Deployed to Preview

- [x] **T231** — Rebuild Seller Bank Management with Canonical shadcn Controls.
      -> REQ: REQ-120, REQ-127 · deps: [T230] · Done when: bank selection, recipient and account inputs, save/cancel controls, account actions, loading/status states, and responsive layout use the installed shadcn components; recipient names reject digits; account numbers reject non-digits at both browser and API boundaries; and operators see a cross-check warning before saving.
- [x] **T232** — Stabilize and Order Checkout Payment Selection.
      -> REQ: REQ-128 · deps: [T228, T229] · Done when: checkout renders QRIS, Transfer Bank, Virtual Account, and COD in that order; payment and group clicks preserve existing DOM nodes; and browser evidence records zero payment-list replacements, layout shift, or horizontal overflow.

## Phase 82: Vector Assets, Admin Indexing, and Hybrid Form Refinements — Deployed to Preview

- [x] **T233** — Vector SVG Logo Assets, Favicon, and Profile Integration.
      -> REQ: REQ-129 · deps: [T232] · Done when: the official ChatGPT logo is converted to transparent vector SVG, favicon.ico, and PNG/WebP assets, and renders flat without frame or border on CMS Login and Admin Header Profile.
- [x] **T234** — Enforce Strict Indexing Boundaries for Admin & Auth Surfaces.
      -> REQ: REQ-130 · deps: [T233] · Done when: all admin layouts and login/auth pages set `<meta name="robots" content="noindex, nofollow" />`.
- [x] **T235** — Refine GeoIP Hybrid Form Dispatch & Order Tracking.
      -> REQ: REQ-131 · deps: [T234] · Done when: hybrid form dispatch defaults to Full Form when user location is unknown, resolves to Middle Form for COD-eligible provinces and Full Form for COD-excluded provinces, direct Middle Form remains accessible when location is non-restricted, and `/thanks` automatically fires Meta Purchase Pixel and Google Ads conversion upon order confirmation.

## Phase 83: Order Cleanup, Manual Deletion & WhatsApp CRM UI Refinement

- [x] **T236** — Trigger Abandoned Order on Storefront Phone Input & Auto-Delete (>7 Days Expiry).
      -> REQ: REQ-132 · deps: [T235] · Done when: entering Name + WhatsApp number on storefront forms records an abandoned lead draft (`shipping_status = 'abandoned'`), and abandoned/unpaid orders older than 7 days are automatically purged from D1 database `orders` and `order_items` during administrative queries to clean up cache bloat.
- [x] **T237** — Authenticated Admin Manual & Bulk Order Deletion API.
      -> REQ: REQ-133 · deps: [T236] · Done when: operators can delete single or bulk selected orders from `/admin/orders` via API `DELETE /api/admin/orders`, deleting associated D1 order rows, line items, and transaction logs with confirmation.
- [x] **T238** — Modular WhatsApp CRM Action Component & Visual State (WhatsApp Green / Black Clicked).
      -> REQ: REQ-134 · deps: [T237] · Done when: WhatsApp CRM follow-up buttons are refactored into modular React components (`CrmActionButton`, `CrmActionGroup`), displaying short labels (`W`, `D`, `F1`–`F5`, `P`, `C`, `U`), defaulting to WhatsApp Green (`#25D366`), and turning BLACK upon click to track completed operator follow-ups.
## Phase 84: Section-Based Landing Page Builder & 480px Canvas Engine — Deployed to Production

- [x] **T239** — Native Section-Based Landing Page Builder & 480px Mobile Canvas Parity.
      -> REQ: REQ-135 · deps: [T238] · Done when: `/admin/landing-pages` and `/admin/landing-pages/[id]` provide a native section-based landing page editor (`LandingPageEditor.tsx`) supporting HTML & Form sections, shortcode pills (`{{product_name}}`, `{{product_price}}`, etc.), drag/reordering, and a 480px mobile WYSIWYG canvas matching storefront rendering at `/[slug]`.

## Phase 85: Catalog Sorting, Auto-Active Embed, CRM Accordion & Clean Invoice UI — Deployed to Production

- [x] **T240** — Newest-First Product Catalog Sorting & Default Auto-Active Embed Status.
      -> REQ: REQ-136, REQ-137 · deps: [T239] · Done when: catalog query uses `ORDER BY created_at DESC, id DESC`, new products default to active status (`is_active = 1`), and manual D1 products synthesize automatically into storefront catalog and embed forms.
- [x] **T241** — Modular WhatsApp CRM Accordion, Clean Invoice Column & 3-Row Product Cell Hierarchy.
      -> REQ: REQ-138 · deps: [T240] · Done when: `CrmActionGroup` renders a trigger button `WA CRM (X/10)` expanding to a 2-col desktop / 5-col mobile grid, Invoice column omits duplicated product titles, and "Produk & Total" cell displays Product Title, Variant Title, and Total Amount in bold.
- [x] **T242** — Short 5-Digit Sequential Order Invoice Numbering (`INV-10001`).
      -> REQ: REQ-139 · deps: [T241] · Done when: public invoice numbers are generated as `INV-10001` upwards using `MAX(id)` from D1 `orders` table.

- [x] **T245** - Order Submission Failure & Redirect Repair (`/api/submit-order`, `/api/submit-middle-order`, checkout forms).
  -> REQ: REQ-10, REQ-16 · deps: [] · Done when: submit order storefront succeeds with 200 response, stores order in D1 without throw, and correctly redirects customer to `/thanks` or `/payment` page.
- [x] **T246** - Admin Invoice / Order Detail Blank Page Prevention & Safety Audit (`OrderDetail.tsx`, `/admin/orders/[invoice]`).
  -> REQ: REQ-24 · deps: [T245] · Done when: opening `/admin/orders/[invoice]` loads the order detail completely without React hook mismatch or blank white screen.

## Phase 71: Landing Page Catalog Dropdown UI/UX Refinement

- [x] **T247** - Sempurnakan UI/UX List Dropdown Produk Katalog D1 di Landing Page Editor (`LandingPageEditor.tsx`).
  -> REQ: REQ-135 · deps: [T239] · Done when: dropdown catalog product list in `/admin/landing-pages/*` renders 2-line title wrapping (`line-clamp-2`), price badge in bold font-mono emerald style, image/icon thumbnail preview, and clean item spacing without awkward text truncation.

## Phase 72: Full-System Heavy Audit & Code Precisioning (Order Submission & Admin Invoice Engine)

- [x] **T248** - Comprehensive Tracing & Security Audit of Submit Order APIs (`/api/submit-order`, `/api/submit-middle-order`, `cmsads-form-widget.js`, `form-middle.ts`). **Done 2026-09-09.**
  -> REQ: REQ-10, REQ-16 · deps: [] · Done when: end-to-end tracing guarantees 100% reliable redirect to `/thanks` for COD and `/payment?order=...` for online payment, with strict payload validation, D1 mutation safety, and zero unhandled errors.
      -> **The `?order=...` half of this acceptance text is superseded and was not
      implemented.** `payment.astro` 303-redirects away every query parameter but
      `preview`, and `checkout-navigation.ts` clears `search` on both completion
      paths, because no order identifier or status token belongs in a URL a
      server or a referrer can read. The locator rides in the fragment instead,
      which browsers never transmit. Building `?order=...` would have undone a
      deliberate decision in two places.
      -> **The reliability half was genuinely broken.** `sessionStorage.setItem`
      sat outside the try/catch, *after* the order was committed to D1. Safari's
      private mode has historically thrown on any write and a browser set to
      block site data does the same — so that throw stranded the buyer on the
      submitting spinner with a real order behind them, and because the server
      Purchase is only ever triggered from `/thanks`, neither leg fired. Guarded
      in both forms, and both now carry the fragment locator, so `/thanks` can
      recover the order the way `/payment` already could.
      -> Opening the page found what the tests could not: recovered that way the
      summary rendered `Rp0` beside a real order, because the fragment carries a
      locator and not the money. `/api/order-status` already returned the right
      figures; the page now fills only what the local state could not.
      -> Payload validation, D1 mutation safety and error handling were audited
      and found sound: `orderSubmitSchema` guards the boundary, `persistOrder`
      writes through one `db.batch`, price is server-authoritative (shipping is
      re-quoted and `unit_price` comes from the D1 variant), and every fetch path
      already terminates in a user-visible message.
      -> Evidence: 679 tests, `astro check` clean, build passed, route map
      regenerated; and in Chromium with `sessionStorage` cleared,
      `/thanks#o=42&t=…` recovered the order, removed the fragment from the
      address bar, and rendered `Rp95.000` / `Rp89.000` with zero horizontal
      overflow and a clean console.
- [x] **T249** - Comprehensive Tracing & React Hydration Audit of Admin Invoice Page (`/admin/orders/[id].ts`, `/admin/orders/[invoice].astro`, `OrderDetail.tsx`). **Done 2026-09-09.**
  -> REQ: REQ-24 · deps: [T248] · Done when: invoice page handles numeric IDs, invoice strings (`INV-10018`), and fallback keys with 100% uptime, zero React hook order violations, and clean fallback state rendering.
      -> **No code change was needed; what was missing was the evidence.** The
      audit found the behaviour already correct and this entry records how that
      was established, so the next reader does not re-open it.
      -> Key resolution is exhaustive: the lookup matches `order_number`, a
      case-insensitive `order_number`, `public_status_token`, `CAST(id AS TEXT)`
      and the integer `id`. Verified live — `42`, `INV-10042`, `inv-10042` and
      the status token all answered `200`; an unknown key answered `404`.
      -> **Zero hook-order violations.** The two early returns sit at the end of
      the component (`loading`, then `error || !order`), and no hook is called
      after either — checked mechanically, not by eye. The `useMemo` bodies guard
      `!order` *inside* the hook rather than around it, which is the correct
      shape.
      -> Fallback state is clean: an unknown key renders "Detail Order Tidak
      Ditemukan" with a route back to the order list — no stuck spinner, no blank
      island. The only console entry is the `404` the page is reporting.
      -> Evidence: Chromium, logged in against a seeded local D1. `INV-10042`
      and `42` both hydrated with the customer visible; `tidak-ada` rendered the
      empty state; zero horizontal overflow on all three.

- [x] **A-58** — Browser verification debt on two admin surfaces. **Cleared 2026-09-09.**
      -> Both surfaces were seen rendered at 390 px and 1440 px, which is what
      the entry asked for. The schema notice on `/admin/dashboard` (A-13) reads
      `skema 56/56` against a real migrated local D1, and the operational health
      panel renders beside it — including the two signals added this week,
      `Saluran peringatan` and `Antrean Google Ads offline`. The renamed
      embed-dialog strings (A-9) render as `Embed Checkout Form - <product>` with
      the `ADSBOOKCMS WIDGET SNIPPET` label, and the dialog does not overflow the
      viewport at 390 px.
      -> Zero horizontal overflow on both surfaces at both widths; console clean.

## Phase 73: Cloudflare Maximum Acceleration Engine Implementation
- [x] **T250** — Zero-Waterfall SSR Data Injection for Admin Pages (`/admin/orders`, `/admin/products`, `OrdersTable.tsx`, `ProductCatalog.tsx`).
      -> REQ: REQ-24, REQ-136 · deps: [T248, T249] · Done when: Astro server script fetches initial page data directly from D1 during SSR and passes it as `initialOrders` / `initialProducts` props to React islands (`client:load`), eliminating client-side `useEffect` fetch waterfalls on page load.
- [x] **T251** — D1 Multi-Column Performance Indexing & Query Batching (`migrations/0029_cloudflare_perf_indexes.sql`, `db.batch`).
      -> REQ: REQ-24 · deps: [T250] · Done when: migration `0029_cloudflare_perf_indexes.sql` adds composite indexes for orders, products, and order_items, and multi-query API routes execute via `db.batch([...])` in a single Cloudflare Edge roundtrip.
- [x] **T252** — Cloudflare Edge Micro-Caching & KV Storefront Acceleration (`/api/form-config`, `/api/v1/products`, KV `SESSION`).
      -> REQ: REQ-1, REQ-10 · deps: [T251] · Done when: storefront public endpoints emit Cloudflare Edge cache headers (`Cache-Control: public, max-age=60, s-maxage=300`) and store configurations use Cloudflare KV cache for 300s TTL.

- [x] **T253** — 100% E2E Checkout & Abandoned Lead Recovery Precision (`/api/record-abandoned-order`, `/api/submit-order`, `form-middle.ts`, `form-hybrid.ts`).
      -> REQ: REQ-10, REQ-16 · deps: [] · Done when: partial customer phone/name input records an abandoned lead (`shipping_status = 'abandoned'`), and submitting the order updates/promotes the lead to `shipping_status = 'pending'` without duplicating order records.
- [x] **T254** — Ads Signal Engine & CAPI Outbox Deduplication (`gclid`, `_fbp`, `_fbc`, `ttclid`, `capi_event_outbox`).
      -> REQ: REQ-16, REQ-18 · deps: [T253] · Done when: click IDs across Google, Meta, and TikTok are captured, stored in `orders.ad_click_ids`, and authoritative server CAPI `Purchase` events are queued with unique `event_id = order_number`.
- [x] **T255** — Mobile Core Web Vitals, SEO JSON-LD Schemas & PageSpeed Optimization (`src/layouts/BaseLayout.astro`, `src/components/seo/`, `src/pages/[slug].astro`).
      -> REQ: REQ-1, REQ-5 · deps: [T254] · Done when: JSON-LD schemas (`Product`, `Offer`, `BreadcrumbList`, `FAQPage`) render valid structured data, hero images use `fetchpriority="high"`, fonts/CSS avoid layout shifts (`CLS = 0`), and mobile LCP < 1.2s.
- [x] **T256** — Comprehensive Automated E2E Behavioral & Integration Test Suite (`src/lib/e2e-full-funnel.test.ts`).
      -> REQ: REQ-10, REQ-16, REQ-24 · deps: [T255] · Done when: automated test suite covers the complete funnel (partial abandoned lead -> order submission -> D1 persistence -> CAPI outbox queuing -> SEO markup rendering) with 100% pass rate.
- [x] **T257** — Product Catalog & Landing Page Admin UX Precision (`ProductCatalog.tsx`, `LandingPageCatalog.tsx`, `/api/admin/products`, `/api/admin/landing-pages`).
      -> REQ: REQ-136, REQ-137 · deps: [] · Done when: `ProductCatalog.tsx` provides instant inline active/inactive toggle switches, `LandingPageCatalog.tsx` enables one-click page duplication, and both offer responsive status filter badges.
- [x] **T258** — Order Management & CRM Workflow Precision (`OrdersTable.tsx`, `OrderDetail.tsx`, `/api/admin/orders`).
      -> REQ: REQ-24, REQ-138 · deps: [T257] · Done when: `OrdersTable.tsx` features quick status filter chips (`Semua`, `Terbengkalai`, `Menunggu`, `Diproses`, `Dikirim`), bulk status updates, and invoice search highlights.
- [x] **T259** — Developer Security & Access Manager UX Precision (`HeadlessApiManagement.tsx`, `AccessManager.tsx`, `/api/admin/settings/developer`).
      -> REQ: REQ-120, REQ-121 · deps: [T258] · Done when: `HeadlessApiManagement.tsx` offers instant API key creation, revocation, copy-to-clipboard buttons, and `AccessManager.tsx` provides clear role badge indicators.
- [x] **T260** — Comprehensive Automated System Precision Test Suite (`src/lib/system-precision.test.ts`).
      -> REQ: REQ-24, REQ-120, REQ-136 · deps: [T259] · Done when: automated test suite verifies inline catalog toggling, landing page duplication, bulk order updates, API key management, and security policies with 100% pass rate.
## Phase 74: Payment Options, Verified Health-Check & Manual Bank Sync

- [x] **T261** — Payment Master & Channel Toggle Backend Precision (`/api/admin/settings`, `save-payment-toggles`, `save-autolaris-channels`).
      -> REQ: REQ-11, REQ-24 · deps: [] · Done when: `save-payment-toggles` and `save-autolaris-channels` execute cleanly without throwing 500 error, `stores` columns exist/migrate safely, and single-string error response eliminates duplicated notices.
- [x] **T262** — Manual Bank Transfer Active/Inactive Synchronization (`/api/payment-methods.ts`, `seller_bank_accounts`, `form-hybrid.ts`).
      -> REQ: REQ-11, REQ-24 · deps: [T261] · Done when: `/api/payment-methods` includes `is_active` status for manual bank accounts, storefront hides inactive bank accounts from checkout options, and admin badge displays accurate active bank counts.
- [x] **T263** — Verified Read-Only AutoLaris Health-Check & Channel Status Matrix (`src/lib/autolaris-client.ts`, `/api/admin/settings`, `/admin/payments`).
      -> REQ: REQ-11 · deps: [T261, T262] · Done when: `verifyCredentials()` performs a zero-payload read-only authentication probe against AutoLaris server and channel status matrix displays live verified status (`● Aktif & Siap`, `○ Nonaktif`, `⚠ Key Ditolak Server`).
- [x] **T264** — E2E Payment & Health-Check Verification (`src/lib/autolaris-client.test.ts`, `node --test`).
      -> REQ: REQ-11, REQ-24 · deps: [T263] · Done when: unit test suite verifies read-only credential probing, payment fee calculations, and manual bank active filtering with 100% pass rate.

## Phase 75: Manual Product Upload Sorting, Auto-Active Embed & API Error Boundary

- [x] **T265** — Newest-First Product Catalog Sorting, Auto-Active Embed Status & Payment Methods Production Safety.
      -> REQ: REQ-11, REQ-136 · deps: [T264] · Done when: `/api/admin/products` and `catalog.ts` query products ordered by `created_at DESC, id DESC`, new products default to active (`is_active: 1`), `/api/payment-methods` handles missing DB configuration gracefully with HTTP 200 JSON responses, and live deployment on `permatamall.shop` is verified.

## Phase 76: System Audit Remediation & Hardening (Batches 1–6)

- [x] **T266** — Batch 1: Security & Privacy Hardening (`src/pages/thanks.astro`, `[slug].astro`, `LandingPageEditor.tsx`, `payment.astro`, `AccessManager.tsx`, `/api/v1/*`, `meta-event.ts`, `mengantar-client.ts`, `admin-credentials.ts`).
      -> REQ: SEC-1..11 · deps: [] · Done when: XSS sinks escaped, draft page preview requires admin auth, stored XSS in editor/bank fields sanitized, CSPRNG password generation active, /api/v1/* gated by API key validation, shipping cost server re-quoted, Mengantar API key hidden from path/D1 error logs, bootstrap admin credentials randomized, and checkout redirect URL PII stripped.
- [x] **T267** — Batch 2: Payment & Checkout Resilience (`src/pages/payment.astro`, `form-hybrid.ts`, `form-middle.ts`, `excluded-area.ts`).
      -> REQ: PAY-1..5 · deps: [T266] · Done when: payment.astro TDZ resolved, status_token query optional on refresh, submit_token generated per session, payment total preserves admin fee, shipping rate race conditions guarded, and COD excluded area province codes matched.
- [x] **T268** — Batch 3: Order, Stock & Dispatch Correctness (`settings.ts`, `orders/[id].ts`, `OrderDetail.tsx`, `validation.ts`, `order-schema.ts`, `stock-restore.ts`, `mengantar-dispatch.ts`).
      -> REQ: ORD-1..7 · deps: [T267] · Done when: AutoLarisClient imported, nextCustomerPhone TDZ fixed, order delete SQL references reference_id, order address edit updates destination_area_id & calls setShippingRates, phone format standardized, stock restored on all cancel/delete paths, and dispatch retry is idempotent.
- [x] **T268b** — Mengantar Location Provider Destination ID Resolution & Shipping Rates Display (`/api/locations.ts`, `OrderDetail.tsx`, `form-hybrid.ts`).
      -> REQ: ORD-8 · deps: [T268] · Done when: location resolution preserves `location_id` / `id` for Mengantar shipping estimation and `OrderDetail.tsx` updates `shippingRates` state properly.
- [x] **T269** — Batch 4: Tracking & Analytics Signals (`src/lib/meta-event-contract.ts`, `MetaPageViewTracker.astro`, `src/lib/json-ld.ts`, `public/robots.txt`).
      -> REQ: TRK-1..2 · deps: [T268b] · Done when: Meta CAPI Purchase event_id derived securely without URL pollution, and server-side PageView accepts slug-based product paths without 400 rejection.
- [x] **T270** — Batch 5: Type Safety, CI Gate & Performance (`npx astro check`, `npx tsc --noEmit`, `.github/workflows/deploy.yml`).
      -> REQ: TYP-1..3 · deps: [T269] · Done when: `npx astro check` and `npx tsc --noEmit` exit 0 with 0 errors, CI deploy gate passes, and lighthouse/a11y verified.
- [x] **T271** — Batch 6: Documentation & Production Deployment Alignment (`AGENTS.md`, `VERSION.md`, `STATUS.md`, `BUILD-LOG.md`, `TASKS.md`).
      -> REQ: DOC-1 · deps: [T270] · Done when: all system docs reflect latest single-tenant Permatamall CLI scripts, real repository contracts, 187/187 test pass rate, 0 type errors, and clean live deployment to permatamall.shop.
- [x] **T272** — Abandoned Lead Invoice Number Promotion & Payload Enrichment (`src/lib/order-persistence.ts`, `src/scripts/form-hybrid.ts`, `e2e-full-funnel.test.ts`).
      -> REQ: PAY-6 · deps: [T271] · Done when: `persistOrder()` promotes draft lead order numbers from `ABN-` to official `INV-` invoice numbers upon order submission, `form-hybrid.ts` captures selected `variant_id` and calculated `total_amount` during partial lead auto-save, unit test suite passes with 187/187 100% pass rate, 0 TypeScript/Astro check errors, and live build deployed to permatamall.shop.
- [x] **T273** — Google Merchant & Meta Commerce Catalog Feed Content-ID Synchronization (`src/lib/catalog-feed.ts`, `src/lib/catalog-feed.test.ts`, `src/pages/feed/google-catalog.xml.ts`, `src/pages/feed/meta-catalog.xml.ts`).
      -> REQ: TRK-3 · deps: [T272] · Done when: `google-catalog.xml` and `meta-catalog.xml` generate `<g:id>` strictly matching tracking `content_id` (`product.productId` for single variants and primary variant, ignoring variant SKUs like `variant_...`, with `<g:item_group_id>` for multi-variant products), unit test suite passes with 192/192 100% pass rate, 0 TypeScript/Astro check errors, and live build deployed to permatamall.shop.
- [x] **T274** — Full Catalog Restoration, Responsive Multi-Photo Slider & D1 Product Variants Seed (`scripts/seed-catalog.sql`, `src/components/storefront/ProductImageSlider.tsx`, `src/lib/catalog-data.ts`, `src/data/products.ts`, D1 `OMS_DB`).
      -> REQ: CAT-1 · deps: [T273] · Done when: 22 products and 110 variants are seeded into D1 database `OMS_DB`, product page mounts interactive `ProductImageSlider` component with adaptive ratio frame and multi-photo thumbnail gallery, `catalog-data.ts` builds 7-photo image galleries per product, test suite passes with 192/192 100% pass rate, 0 TypeScript/Astro check errors, git pushed to main, and live deployment on `https://permatamall.shop/` verified.

- [x] **T275** - Luxury Header, Footer & Base Layout Polish (`SiteHeader.astro`, `SiteFooter.astro`, `BaseLayout.astro`).
 -> REQ: UI-1 · deps: [T274] · Done when: header announcement ticker uses dark onyx `#09090B` container with pulsing live status dot, glassmorphism sticky header with clean links, and footer uses deep onyx canvas with refined legal links.
- [x] **T276** - Luxury Homepage Templates Rebuild (`WideCatalogHome.astro`, `CompactMarketHome.astro`, `ProductListItem.astro`).
 -> REQ: UI-2 · deps: [T275] · Done when: `WideCatalogHome` displays warm studio canvas `#FBFBFB`, editorial typography, elevated product cards with discount badges, COD available indicator, and 4-point minimalist trust grid.
- [x] **T277** - Product Detail Page PDP Luxury Overhaul (`src/pages/produk/[slug].astro`, `ProductImageSlider.tsx`).
 -> REQ: UI-3 · deps: [T276] · Done when: PDP renders clean price block, aggregate rating summary, variant list, verified buyer reviews, and mounts a sticky mobile purchase bar for instant COD checkout trigger.
- [x] **T278** - Order Form & Checkout Minimalist Visual Refinement (`GeoIpResolvedForm.astro`, `form-hybrid.css`).
 -> REQ: UI-4 · deps: [T277] · Done when: order form visual colors align with luxury minimalist palette while preserving 100% of underlying form bindings, field handlers, and checkout submit logic.
- [x] **T279** - Full Verification, Build & Live Production Deployment (`npm test`, `npx tsc --noEmit`, `npx astro check`, `wrangler deploy`).

## Phase 77: Public Storefront Luxury Minimalist UI/UX Overhaul (Mobile-First 480px)

- [x] **T280** — Non-Sticky Clean Header & Luxury Navigation (`SiteHeader.astro`, `SiteFooter.astro`).
      -> REQ: UI-1 · deps: [T279] · Done when: header uses non-sticky clean document flow layout on homepage, top announcement ticker uses Onyx `#09090B` background with pulsing status dot, and footer presents clean luxury branding inside 480px container.
- [x] **T281** — Frameless Rounded Luxury Product Cards & Homepage Showcase (`CompactMarketHome.astro`, `ProductsSection.astro`, `HeroSection.astro`, `SolutionsSection.astro`, `ProofsSection.astro`).
      -> REQ: UI-2 · deps: [T280] · Done when: homepage product grid uses rounded luxury card presentation without bulky borders/shadows, 3:4 portrait image frame, discount tags, rating summary pill, and warm studio canvas `#FBFBFB` background inside max-w-[480px] shell.
- [x] **T282** — Product Detail Page PDP & Form Visual Refresh (`src/pages/produk/[slug].astro`, `ProductImageSlider.tsx`, `GeoIpResolvedForm.astro`).
      -> REQ: UI-3 · deps: [T281] · Done when: PDP renders rounded luxury product gallery, Onyx price typography, and checkout form container matches emerald/slate visual styling without touching form logic or DOM field structure.
- [x] **T283** — Full Verification & Local Preview (`npm test`, `npx tsc --noEmit`, `npx astro check`).
      -> REQ: UI-4 · deps: [T282] · Done when: unit test suite passes 192/192, 0 TypeScript and Astro check errors, local dev server running on Tailscale IP `http://100.127.67.86:4321/`, and 0 git push / 0 wrangler deploy executed.

## Phase 78: Ground-Up Sharp Luxury Boutique Redesign (Mobile-First 480px)

- [x] **T284** — Simple Minimalist Header & Footer (`SiteHeader.astro`, `SiteFooter.astro`).
      -> REQ: UI-1 · deps: [T283] · Done when: header and footer present ultra-simple minimalist aesthetic with thin 1px borders, deep ebony #111111 ticker, and non-sticky document flow inside max-w-[480px] shell.
- [x] **T285** — Vertical Left Thumbnail Product Gallery (`ProductImageSlider.tsx`).
      -> REQ: UI-2 · deps: [T284] · Done when: PDP image slider presents miniature thumbnails stacked vertically on the LEFT side of the main active image frame.
- [x] **T286** — Catalog List Capped at Max 15 Products (`src/pages/produk/index.astro`).
      -> REQ: UI-3 · deps: [T285] · Done when: product catalog page strictly limits item rendering to maximum 15 products with high-precision luxury layout.
- [x] **T287** — Homepage & PDP Sharp Luxury Overhaul (`CompactMarketHome.astro`, `HeroSection.astro`, `ProductsSection.astro`, `src/pages/produk/[slug].astro`).
      -> REQ: UI-4 · deps: [T286] · Done when: homepage and PDP render sharp luxury boutique styling without bulky rounded cards, warm alabaster #F8F7F4 canvas, champagne gold #C5A880 accents, and 100% untouched checkout form logic.
- [x] **T288** — Full System Verification & Tailscale Preview (`npm test`, `npx tsc --noEmit`, `npx astro check`).
      -> REQ: UI-5 · deps: [T287] · Done when: unit test suite passes 192/192, 0 TypeScript and Astro check errors, local dev server running on Tailscale IP `http://100.127.67.86:4321/`, and 0 git push / 0 wrangler deploy executed.
 -> REQ: UI-5 · deps: [T278] · Done when: unit test suite passes 192/192, 0 TypeScript and Astro check errors, production build deployed to Cloudflare Worker, git committed to main, and verified on `https://permatamall.shop/`.

## Phase 79: Storefront 22-Product Content, Realistic Compare Prices & Full SEO Schema Overhaul

- [x] **T289** — Complete 22/22 Bespoke Product Descriptions (`src/lib/catalog-data.ts`).
      -> REQ: UI-6 · deps: [T288] · Done when: bespoke editorial details (subheadline, boutique description, 4 benefits, QC guarantee, usage scenario) are implemented for all 22 products in catalog-data.ts.
- [x] **T290** — Realistic Compare Price & Dynamic Discount Calculation (`src/lib/catalog-data.ts`).
      -> REQ: UI-7 · deps: [T289] · Done when: `getRealisticComparePrice` calculates dynamic compare prices (26%–41% discount) and static 300k placeholders are eliminated.
- [x] **T291** — Sticky Mobile Purchase Bar Auto-Hide (`src/pages/produk/[slug].astro`, `StickyCTA.astro`).
      -> REQ: UI-8 · deps: [T290] · Done when: IntersectionObserver rootMargin `0px 0px -40px 0px` smoothly hides sticky bar upon reaching `#form-pemesanan`.
- [x] **T292** — Full SEO Meta & Google Merchant Schema Compliance (`json-ld.ts`, `JsonLdSchema.astro`, `[slug].astro`).
      -> REQ: UI-9 · deps: [T291] · Done when: Open Graph, Twitter Cards, Canonical URLs, and Google Merchant Schema (MerchantReturnPolicy & OfferShippingDetails) are active.
- [x] **T293** — Verification & Production Live Deployment (`npm test`, `npx tsc --noEmit`, `npx astro check`, `wrangler deploy`).
      -> REQ: UI-10 · deps: [T292] · Done when: 192/192 Node tests pass, 0 typecheck/Astro check errors, clean build deployed live to `https://permatamall.shop/` (commit `f44c2f1`).

## Phase 80: 5-Digit Minimum Product Content-ID Pattern Lock & Auto-Taxonomy Feed Synchronization

- [x] **T294** — 5-Digit Minimum Product Content-ID Pattern Lock (`src/lib/meta-event-contract.ts`).
 -> Historical contract superseded by ADR-017 and A-115: the validator now accepts only safe decimal Product IDs with at least five digits.
- [x] **T295** — Automated Product Content ID Normalization & Feed Synchronization (`src/lib/catalog-feed.ts`, `src/lib/catalog-feed.test.ts`).
 -> Historical contract superseded by ADR-017 and A-115: no ID is padded or offset; both feeds publish the actual Product ID once per product and omit `item_group_id`.

---

# Phase A — AdsBookCMS Foundation

Active backlog. Every task below references a requirement in the current `PRD.md` and, where relevant, a gap from `ARCHITECTURE.md` §10. Ordered by severity, not by dependency.

## Phase A order of work

Phase A is not a checklist to work top to bottom. It has one critical path and a set of tasks that are genuinely independent of it.

**Critical path — everything about being installable runs through here:**

```
A-10 runtime identity  →  A-11 /install wizard  →  A-12b fail-closed setup state
      ↓
A-50 install topology (blocked until A-10 removes the build-time constraint)
```

`A-10` was the keystone, and it has landed. Identity now resolves from the `stores` row per request, so the wizard can set a store's name, one build can serve two installs, and the topology question in **A-50** can finally be judged on its merits — which makes A-50 the next decision, not the next implementation task.

**Independent of the critical path** — these touch disjoint files and can proceed in any order, including in parallel: A-5, A-7, A-8, A-9, A-13, A-21, A-24, A-25, A-30, A-31, A-32, A-41, A-42.

**Ordering constraints that are not obvious:**
- `A-13` (schema version check at boot) is small and independent, but it is what makes `A-51` measurable — without it there is no way to ask an install which product version it is running.
- `A-30`/`A-31`/`A-32` are browser-visible. They need visual verification, not just a green build; `A-37` is the precedent for why.
- `A-24` (Drizzle) is settled: retired, not repaired. There is no journal left to trap the next contributor; migrations are hand-authored and `wrangler` reads the directory.

---

## A1 — Live integrity (production is currently wrong)

- [x] **A-1** — Remove fabricated social proof from product presentation (`src/lib/catalog-data.ts`). **Done 2026-08-16.**
 -> REQ: REQ-16 · Done when: the three hardcoded named reviews, `METRICS_TABLE` rating/review/sold values, and `getRealisticComparePrice()` no longer reach any public page; `aggregateRating` is emitted only from recorded data or omitted entirely; `npm test` green.
- [x] **A-2** — Replace vendor advertising artwork used as store brand (`public/images/logo.webp`, `public/favicon.*`, `public/admin-login.webp`, `public/og-admin.webp`). **Done 2026-08-16** — placeholders pending real brand assets.
 -> REQ: REQ-18 · Done when: no CMS Ads artwork remains reachable; `tenantConfig.logo`, the admin shell logo, the product-image fallback (`catalog-data.ts`), the landing-card image (`tenant-content.ts`), and the admin `og:image` all resolve to this store's own assets.
- [x] **A-3** — Neutralise the canonical sample product. **Done 2026-08-16** — resolved by *removing* the immutability concept, not repointing it.
 -> REQ: REQ-9 · gap: G4 · ADR-006 · Done when: a new forward migration replaces product 10001 with a neutral, clearly labelled placeholder using an owned image; `src/lib/sample-product.ts` and the admin strings in `ProductForm.tsx` / `ProductCatalog.tsx` / `admin/products/edit.astro` agree with it; the record is deletable once a real product exists.
- [x] **A-4** — Scrub or delete `src/db/seed.sql`. **Done 2026-08-16** — deleted and consolidated into `scripts/seed-catalog.sql` behind `npm run db:reset:demo:local`.
 -> REQ: REQ-9 · Done when: the file no longer contains another merchant's catalog, the two genuine-looking Mengantar ObjectIds, the Surabaya warehouse address, or the contact phone number; either replaced by a neutral install seed or removed with its image trees.
- [x] **A-5** — Make ad taxonomy matching deterministic. **Done 2026-08-16.** Whole-word matching, title weighted above description, description capped below a single title hit, and a `MIN_SCORE` floor so the default wins ties and under-confidence. Proven by running the new tests against the old file: a leather shoulder bag classified as fertilizer, a face serum as soap, a data cable as a handbag because "bagus" contains "bag".
 -> REQ: REQ-56 · Done when: category resolution no longer relies on an unweighted keyword count across title and description with no minimum score; a handbag whose description mentions unrelated terms cannot be shipped to Merchant Center under a fertilizer, skincare, or cutlery category. Note: the handbag rule (`6551`) is already both the first rule and the default — the defect is the scoring, not the mapping.
- [x] **A-6** — Align Meta Purchase `event_id` across browser and server. **Done 2026-08-16.**
 -> REQ: REQ-50 · gap: G9 · The browser now derives the Purchase `eventID` from `order_number` in the `/api/order-status` response — the same D1 column the CAPI leg uses — instead of minting `purchase_<slug>_<random>`. If the order cannot be resolved the tracker fires nothing rather than a mismatched id. The server gate (`order_number` + `status_token`, 404 on mismatch) and the outbox idempotency key are untouched. Test `src/lib/meta-purchase-dedup.test.ts` executes the real inline tracker script against a stubbed browser and asserts the Pixel `eventID`, the posted `event_id`, and `resolveMetaEventId()` all produce one string; mutation-checked.
 · **Forward-only.** Meta dedups at ingestion within 48 hours with no retroactive merge, so historical Purchase counts stay roughly doubled and historical ROAS stays understated. Treat the deploy date as a reporting break.

- [x] **A-7** — Embedded checkout fired Purchase with no event ID. **Closed in `c967faa`, verified 2026-08-16.**
 -> REQ: REQ-50, REQ-55 · The parent listener that fired Meta `Purchase`, a Google `conversion` and TikTok `CompletePayment` on a positive total alone — unqualified, pre-payment, no `event_id` — was removed. Embed snippets now carry no conversion tracking at all, which is the correct answer: the embed sits on a third-party page, has no order number at redirect time, and cannot reach D1, so it can never qualify a purchase. `src/lib/embed-markup.test.ts` asserts every generated snippet is free of `fbq`/`ttq`/`gtag`/`dataLayer`.
 · Also fixed while verifying: `public/adsbook-form-widget.js` relayed `AddToCart`/`InitiateCheckout` to the parent pixel with `eventID` omitted when absent, so a merchant page carrying the store's pixel double-counted one event down the funnel. It now relays nothing without an id.

## A2 — Installer foundation

- [x] **A-10** — Make store identity resolve at runtime. **Done 2026-08-16.**
 -> REQ: REQ-7 · gap: G1 · ADR-003 · Migration `0036` adds eight nullable identity columns to `stores` (`site_url`, `description`, `logo`, `tagline`, `theme_color`, `locale`, `storefront_template`, `admin_name`; `name` and `slug` already existed). `src/lib/tenant.ts` became a resolver — database, then environment, then product default, per field — and `src/middleware.ts` resolves it once per request onto `Astro.locals.tenant`. All 36 consumers migrated: 30 `.astro`, 4 endpoints binding from `locals`, and `tenant-content.ts` whose `DEFAULT_HOME_CONTENT` became `buildDefaultHomeContent(tenant)`.
 · **Renaming the store in `/admin/settings/store` now changes the storefront with no rebuild** — `save-store` writes `stores.name`, which the resolver reads. That was the requirement.
 · A NULL column means "not configured here", so an install that predates `0036` keeps rendering from its environment unchanged, and a database with no row at all still renders — which is what a fresh install is before the wizard runs.
 · `storefrontTemplate` no longer throws on an unknown value. It used to throw at module load, which in a Worker meant every route returned 500; now that an operator can type the value, it degrades to the default and logs `tenant-unknown-storefront-template`.
 · 6 tests in `src/lib/tenant.test.ts` cover precedence, blank-as-unset, every validator degrading rather than throwing, a missing table, a failing database, and the frozen result.
 · **Closed 2026-08-16:** all of it is now editable from `/admin/settings/store` — address, tagline, description, logo and storefront template alongside the name. A blank field clears the column to NULL, which the resolver reads as "not configured here" and falls back for, so clearing is a real action rather than a way to store an empty name. `site_url` is validated as https and the template against the known set, both server-side.


- [x] **A-11** — First-run `/install` wizard. **Done 2026-08-16.**
 -> REQ: REQ-6 · gap: G2 · ADR-004 · deps: [A-10] · A migrated database with no `stores` row is now routed to `/install`, which collects store name, address, support number, admin credential and template, writes them, and disappears.
 · **The uninstalled signal costs nothing.** No migration inserts a `stores` row, so its absence is exactly "migrated but never set up" — and middleware already read that row every request to resolve identity. `readStoreIdentity` returns three states instead of two, so the gate is free.
 · **`unknown` never redirects.** A database that fails to read is not an empty one; conflating them would send a live store to its own installer on a transient fault.
 · Writes go through `batch()` so identity and credential land together — a half-installed store is worse than one that refused, because the operator cannot tell which half took. The insert carries `WHERE NOT EXISTS`, so two simultaneous submissions cannot both win.
 · Once installed the wizard redirects to `/hello` for good: it is the one unauthenticated write in the product and must not linger as a re-runnable surface.
 · The page imports no layout, deliberately — every layout resolves store identity, and on this page there is no store yet.
 · Verified end to end against a real SQLite built from the migration chain: fresh database reports uninstalled; install writes the store, rotates the credential, and the chosen password verifies against the stored hash; a second attempt is refused with one store still present.

- [~] **A-12a** — Stop inheriting marketing copy on missing home content (`src/lib/tenant-content.ts`). **Done 2026-08-16.**
 -> REQ: REQ-13 · gap: G5 · ADR-007 · Done when: the fallback carries only this store's own identity and generic section labels, never marketing claims; the unpublished path and the missing-binding path each log a distinct label so a degraded render is visible in logs. A D1 query failure was already logged separately as `storefront-home-content-load`.
- [x] **A-12b** — Render an explicit setup state instead of the structural shell. **Done 2026-08-17 by A-100.**
 -> REQ: REQ-13 · gap: G5 · ADR-007 · deps: [A-12a] · Missing published home content now resolves to `setup-required`; the built-in route and Headless storefront response expose that state without rendering compiled merchant copy. Focused resolver/template tests and the isolated fresh-install browser smoke cover the path.
- [x] **A-13** — Schema version check. **Done 2026-08-16.**
 -> REQ: REQ-8 · gap: G3 · Done when: the applied migration count is compared with `CMS_VERSION.schemaVersion` and a mismatch is surfaced to the operator instead of failing at the first broken query.
- [x] **A-14** — Remove inert tenant machinery. **Done 2026-08-16.**
 -> REQ: REQ-1 · ADR-002 · Removed `CONTENT_PACK_IDS`, `TenantContentPackId`, `isTenantContentPackId`, the `contentPack` default, `PUBLIC_TENANT_SLUG`, `PUBLIC_CONTENT_PACK`, and the dead `CMSADS_TENANT_CONFIG` / `CMSADS_INSPECTOR_PORT` hooks in `astro.config.mjs`. `astro check` hints dropped 38 -> 36.

## A3 — Correctness and security

- [x] **A-20** — Test coverage for `src/lib/auth.ts`. **Done 2026-08-16.**
 -> REQ: REQ-60, REQ-61 · 12 tests in `src/lib/auth.test.ts` covering round-trip, wrong secret, six tampering shapes, validly-signed-but-hostile claims, lifetime and clock skew, 15 malformed inputs, exact cookie-name matching, credential-rotation invalidation driven through the real `onRequest`, cross-user session records, and the full role matrix including denied routes. Mutation-verified: five deliberate breaks in `auth.ts` were each caught.

- [x] **A-25** — Harden the authorisation policy in `src/lib/auth.ts`. **Fixes landed in `c967faa`; pinned by tests 2026-08-16.**
 -> REQ: REQ-61 · Four of the six findings were real and are fixed: deny-by-default for an unknown role, `admin` converted from a two-entry blacklist to an allowlist, `/api/admin` gated as an exact path as well as a prefix, and the double URL-decode removed.
 · Two were **rejected on inspection**: the `/admin` grant is not unconditional — it sits after the role check, and `/admin` renders nothing but a redirect; and `verifyJwt` does cap lifetime, rejecting `exp - iat > 24h`.
 · The gap that remained was that the tests did not actually pin the fixes. The deny-by-default assertion wrapped the call in `try/catch`, so it would have passed against the throwing version it existed to guard. That is fixed, and a new test walks `src/pages/admin/**` and `src/pages/api/admin/**` off disk and asserts every route on it is reachable by `owner` and `admin` — so an allowlist that goes stale fails the suite instead of silently locking an operator out of a page that exists.
 · Mutation-verified: six deliberate regressions, each caught.

- [x] **A-21** — Connect the headless origin allowlist to the admin (`src/lib/headless-api.ts`). **Done 2026-08-16.**
 -> REQ: REQ-71 · Done when: authorising a new storefront origin is an admin action rather than a code change and deploy; the currently undeclared `PUBLIC_HEADLESS_ALLOWED_ORIGINS` is either implemented or removed; the embed allowlist and the API allowlist have documented, distinct scopes.
- [x] **A-22** — Stop marking authenticated API responses publicly cacheable. **Done 2026-08-16.**
 -> REQ: REQ-71 · Done when: authenticated `/api/v1/*` 200s, including `/api/v1/storefront`, are not served with `public` cache directives that permit shared-cache storage.
- [x] **A-23** — Add CORS headers to headless error responses. **Done 2026-08-16.**
 -> REQ: REQ-70 · Done when: `headlessError` includes `Access-Control-Allow-Origin` so cross-origin callers can read error bodies.
- [x] **A-24** — Repair or retire the Drizzle layer. **Done 2026-08-16 — retired, not repaired.**
 -> ADR-005 · gap: G8 · Removed `schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, all of `migrations/meta/`, both dependencies and the `db:generate` script. Repair was rejected on evidence: drizzle-kit's SQLite snapshots cannot represent the `product_variants_stock_nonnegative` trigger, so the first generated migration rebuilding that table would have silently dropped a data-integrity guarantee. The audit also found 6 of the 8 indexes declared in `schema.ts` existed in no migration at all, while 10 real indexes went undeclared.

## A4 — Consistency and hygiene

- [x] **A-37** — Fix unreachable controls in admin mobile card lists. **Done 2026-08-16.**
 -> REQ: REQ-62 · Reported symptom: on mobile, some menus and the row action ("Aksi") could not be tapped. Root cause was not pointer handling — the mobile card lists used `display: grid` with **no** `grid-template-columns`, so the implicit column was sized `auto`. A card's min-content width (set by the `truncate`/`white-space: nowrap` title and slug) then widened the column to 491px inside a 390px viewport, and the `overflow-hidden` wrapper clipped it, putting the status switch and the Aksi trigger off-screen with no way to scroll to them. Adding `grid-cols-1` (`minmax(0, 1fr)`) caps the column at the container width and lets `truncate` do its job. Applied to `ProductCatalog.tsx`, `OrdersTable.tsx`, `ShippingOperations.tsx`.
 · Verified in Chrome at 390x844 with touch emulation against the built Worker: overflowing elements on `/admin/products` went 400 -> 5, card width 491px -> 335px, and the Aksi menu opens with all five items hit-testing to themselves. On `/admin/orders` every remaining overflow sits inside a horizontally scrollable filter row, so nothing is clipped. `/admin/shipping` carries the identical change but was **not** exercised end to end — the local database has no shipments, so its mobile grid never rendered.

- [x] **A-30** — Unify checkout presentation. **Done 2026-08-16.**
 -> REQ: REQ-20 · The second style layer was **deleted** rather than extended: 110 lines of `:global([data-canonical-order-form])` in `GeoIpResolvedForm.astro` that repainted the base stylesheet. It could only ever reach six of the seven checkout routes, because `/hybrid-form` renders the content components directly and never sets that attribute — which is exactly why one checkout stayed green and orange. The base stylesheet now *is* the shipped palette, so there is no second declaration to win or lose.
 · Cascade proved rather than assumed: the submit button previously matched `.submit-main` (0,1,0) alone on `/hybrid-form` and `[data-canonical-order-form] .submit-main` (0,2,0) elsewhere. Built CSS now shows zero orange, zero green, and the champagne/ebony palette throughout.
 · **Three defects found that were not in the brief**, each affecting all seven routes rather than one: a filled-then-blurred float label stayed green because the override only handled `:focus`; `/hybrid-form`'s submit button had **no keyboard focus indicator at all**, since `:focus-visible` lived only in the deleted layer; and the disabled submit and address-picked card were slate and green because the override never covered them.
- [x] **A-31** — Stop shipping checkout CSS to the admin. **Done 2026-08-16.** The premise in this task was wrong: the five page-level imports were **not** no-ops — the build emitted `form-hybrid` twice — and the PDP and every landing page had no import at all, relying on the global one. Removing them as written would have unstyled all seven checkouts. Global import dropped, two missing imports added, 17.8 KB off all 28 admin routes and `/hello`.
 -> Done when: `form-hybrid.css` is imported only by the routes that need it; the five redundant page-level imports are removed.
- [x] **A-32** — Remove unused font payload. **Done 2026-08-16.**
 -> Two premises in this task were wrong, and checking them changed the work. Plus Jakarta Sans was never *downloaded* — `@fontsource` gates each `@font-face` behind `unicode-range`, so a family nothing uses is never fetched. The real cost was a **25,098-byte render-blocking stylesheet on `/embed/form` that was 100% Plus Jakarta Sans and matched nothing**. And Inter's weights were not being synthesised: CSS font matching resolves 500 to the loaded 400 and 800/900 to 700, so the selected face is already bold — the defect is hierarchy collapse, not smearing.
 · Removed the family and its dependency; corrected Cinzel from 600 to 700, which is what all four declaration sites actually ask for. Font assets in `dist` fell from 1,041,364 to 719,680 bytes.
 · Deliberately **not** done: adding Inter 500/800 would cost +48,672 bytes of render-blocking latin woff2 on the homepage, every product page and every landing page, to lift substitutions that already degrade gracefully. Costed and recorded in `BaseLayout.astro` rather than silently skipped.
- [x] **A-33** — Align `themeColor` with the shipped palette. **Done 2026-08-16.**
 -> REQ: REQ-7 · `PUBLIC_SITE_THEME_COLOR` and the code default are now `#111111` (ebony), verified baked into the build output. Also corrected a documentation error found while testing this: `wrangler.jsonc` vars *do* reach the bundle — they are read at build time, so a change needs a rebuild, not merely a redeploy.
- [x] **A-34** — Delete orphan components and stale artifacts. **Done 2026-08-16.**
 -> Removed: eight zero-importer components, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the root `migrations/` duplicate. The root copy was not actually unreferenced — `src/lib/landing-pages.test.ts` read it to build its SQLite fixture; the fixture now points at the byte-identical `src/db/migrations/0027_landing_page_builder.sql`. ADR-009.
- [x] **A-35** — Fix `/solusi-terbaru` and the HTML sitemap. **Done 2026-08-16.**
 -> `/solusi-terbaru` now redirects to `/produk` instead of a slug with no route; `/sitemap` reads products and active landing pages from D1 like `/sitemap.xml` does.
- [x] **A-36** — Decide the fate of the `zanoby_*` cookie namespace. **Done 2026-08-16.**
 -> Renamed to `adsbook_click_ids` **with** a read-only fallback on the legacy name, so no in-flight attribution was lost. Delete the fallback once 90 days have passed since deploy. The session cookie moved to `adsbook_session` and the embed namespace to `adsbook:` in the same change.

- [x] **A-8** — Migrate the developer API key prefix off `cmsads_live_`. **Done 2026-08-16 — no migration needed, and that is the finding.** `key_hash` is a SHA-256 digest, so the prefix never took part in matching; rewriting it would have broken every live key. New keys carry `adsbook_live_`, old ones still validate, and the legacy prefix survives only in the mask. (`src/lib/developer-api-keys.ts`).
 -> REQ: REQ-71 · Done when: newly issued keys carry an AdsBookCMS prefix and previously issued keys still validate. The prefix is part of every stored and masked key, so this needs a dual-prefix read, not a rename.

- [x] **A-9** — Finish the brand sweep in the admin embed dialog. **Done 2026-08-16.**
 -> Done when: the `cmsads-order-form-<id>` embed id template and the four user-visible "CMSAds" strings match the snippet the dialog actually generates, which now emits `adsbook-*`.


- [x] **A-53** — Make a stale embed snippet detectable. **Done 2026-08-16.**
 -> REQ: REQ-50 · Every generated snippet now stamps `v=<EMBED_SNIPPET_VERSION>` onto the `/embed/form` URL. `src/pages/embed/form.astro` compares it and logs `embed-snippet-stale` with the parent origin, so Workers Logs shows both *that* a merchant page is stale and *how much live traffic* still runs it. An absent marker reads as version 1 — which is every snippet generated before this existed, including the pre-`c967faa` ones that fire an unqualified Purchase.
 · Only the referrer **origin** and two integers are logged; `new URL(referer).origin` drops the path and query, so nothing about a visitor is recorded.
 · Verified against a running dev server across four request shapes: current marker, no referrer, and same-origin referrer all log nothing; only a third-party referrer without a current marker logs.
 · Known blind spot: an HTTP merchant page sends no referrer to an HTTPS store, so it cannot be attributed.

- [x] **A-54** — Decide the fate of the `autoHeightIframe` snippet. **Deleted 2026-08-16.**
 -> **Correction:** this task previously claimed `autoHeightIframe` was the only variant forwarding click IDs, and that was wrong — I propagated it from an earlier report without checking. The `widget` variant forwards the same twelve keys, and additionally recovers `_fbp`/`_fbc` from parent cookies when they are absent from the URL. That is now pinned by a test asserting the mounted widget's real frame URL carries the tracking parameters, so the claim cannot rot again.
 · With that premise corrected the decision was straightforward: the widget is a strict superset — auto-height, origin-checked redirect, and an `event_id`-gated funnel relay the inline variant never had — and it is served by the store, so it heals on deploy. `autoHeightIframe` froze that logic onto a merchant page permanently, which is exactly the failure mode A-53 exists to detect. `buildParentListener()` went with it. `plainIframe` stays as the no-JavaScript option.
 · Deleting it removes only the ability to generate new ones. Snippets already pasted are unaffected and still need re-copying.

- [ ] **A-55** — Embedded checkouts may emit no Purchase at all.
 -> REQ: REQ-50 · The mirror of A-7, and under-reporting rather than over-reporting. `thanks_state` is the only carrier of `order_pk`/`status_token` and lives in `sessionStorage`. In an embed the form writes it from a partitioned third-party store-origin context; the parent then navigates top-level to store-origin `/thanks`, which reads the **unpartitioned** store. In a partitioning browser that state is gone, the thanks tracker returns early, and because the CAPI leg is only ever triggered by that browser post, the server never fires either. A fix needs a completion token in the URL, which `checkout-navigation.ts` deliberately forbids — so this is a product decision, not a patch.

- [x] **A-56** — Fresh installs could not be created at all. **Fixed 2026-08-16.** *(found while retiring Drizzle)*
 -> REQ: REQ-2 · Migration `0017` seeded a sample product with `INSERT INTO products … SELECT … FROM stores`, a no-op on the empty `stores` table of a new database, then inserted two variants with a hardcoded `product_id = 10001` — violating the foreign key and aborting the chain at migration 17 of 36. **No new install could get past it**, which is fatal for a product whose premise is installability. Reproduced independently in an isolated SQLite before fixing.
 · A forward migration cannot repair this, because `0017` fails before any later migration runs. `0017` was edited in place — the one documented exception — with the reasoning in its header: `0034` already deletes that row, so a migrated database and a fresh one converge on the same end state and the edit creates no divergence.
 · **Correction 2026-08-17:** all 37 migrations apply from zero and produce 17 tables, not the 15 originally recorded here; no foreign sample product is created.

- [x] **A-57** — Two maintenance scripts point at a repository that no longer exists. **Deleted 2026-08-16.** Their inputs, their dependencies and the repository they pointed at were all gone, and their outputs matched nothing in the tree.
 -> `scripts/generate-logo-assets.cjs` and `scripts/generate-webp-logo.cjs` hardcode `projectRoot = '/home/ongki/Projects/cmsads'` and `require` sharp from that checkout's `node_modules`. That repository is gone. Both are unrunnable from this tree and would write into the wrong project if it returned. Done when: they resolve paths relative to this repository and take their dependency from it, or they are deleted. They also still emit `adscms-logo.*` filenames.

- [x] **A-58** — Browser verification debt on two admin surfaces. **Cleared 2026-09-09**, recorded above with T249.

- [x] **A-59** — A fresh install could not be logged into. **Fixed 2026-08-16.**
 -> REQ: REQ-3 · LOGIN-1 · The seeded `admin` credential accepted only a password supplied through `BOOTSTRAP_ADMIN_PASSWORD`, and nothing sets that on a new Worker — so a new install had an admin account no password could open. This is the second install blocker found today, after the migration chain (A-56); together they meant the product could not be installed at all.
 · `admin` / `admin` now opens a fresh install. A configured `BOOTSTRAP_ADMIN_PASSWORD` still replaces the default entirely, and a value under 16 characters is rejected outright rather than degrading to it.
 · The exposure is bounded by middleware, not by convention: while `must_change_password` is set the session reaches only `/admin/profile`, `/api/admin/profile` and `/api/admin/logout`. It cannot read an order, a customer, a payment or a provider key.
 · This **reverses a deliberate hardening**. The test that encoded the old decision was rewritten rather than deleted, and carries the reason. `PRD-ADMIN-LOGIN.md` records the full trade.

- [~] **A-60** — Close the open admin-login requirements. **Six of seven done 2026-08-16; LOGIN-7 open.**
 -> `PRD-ADMIN-LOGIN.md` · Each of these was a real defect, not a checkbox:
 · **LOGIN-13** — the message was already generic but the **timing was not**. An unknown username returned immediately while a known one paid for PBKDF2, so a fast response meant "no such operator" — the limiter and the clock answered the question the message refused to. Every branch now performs one verification, and the rate-limit check moved ahead of the credential lookup. Measured over HTTP: unknown 188/193/272 ms, known 194/198/193 ms.
 · **LOGIN-19** — three buckets, keyed on the `username|ip` pair so knowing an operator's username cannot lock them out, spent only on failure so a correct password never costs an attempt. Accepted failure modes are documented in the module rather than hidden.
 · **LOGIN-15** — the submit button was 40 px, and `.admin-input-flat` drops to 14 px at ≥768 px, which is exactly where an iPad zooms on focus.
 · **LOGIN-17** — the in-flight lock survived a back/forward-cache restore, leaving the button disabled and the operator unable to log in.
 · **LOGIN-6** — the notice renders only while the default actually opens the account, built from the same constants, so it cannot advertise a credential that does not work.

- [x] **A-67** — The login screen shipped one store's brand and a third-party asset to every install. **Fixed 2026-08-16.**
 -> REQ: REQ-18 · LOGIN-18 · **I recorded LOGIN-18 as done before it was.** The vendor advertisement had indeed been replaced — but with the *reference store's* brand mark, which every install would then have worn on its login screen. Replacing one brand leak with another is not a fix, and writing the status from intent rather than from disk is how it survived.
 · Also removed: a Google Fonts stylesheet and two preconnects for a family the page never applied, which told a third party the address of every operator opening the admin for no rendering benefit; and `og:image`/`twitter:image` on **every** admin page, pointing at the same store-branded panel — an admin area is `noindex`, so a social card serves nothing and leaked identity everywhere.
 · The product default logo is now a neutral AdsBookCMS mark. Before this, an install that had not set its own logo wore the demo store's.

- [x] **A-61** — Ten admin controls were unreachable on a phone. **Fixed 2026-08-16.**
 -> REQ: REQ-62 · The same defect class as A-37, found across the admin by sweeping for it deliberately. Each was invisible to every static check and made a feature unusable rather than ugly.
 · `CrmActionGroup.tsx` had **inverted breakpoints** — `grid-cols-5` on mobile, `sm:grid-cols-2` on desktop. Five columns on a 360px phone against a ~74px min-content button that cannot shrink, overflowing ~80px into a `Card` whose `overflow-hidden` clipped the last CRM follow-up steps away entirely.
 · `/admin/settings/crm` — the save bar was `sticky bottom-3 z-10` under a `fixed bottom-0 z-40` mobile nav. "Simpan semua template" was completely covered, and the page had no other save path: **CRM templates could not be saved from a phone at all.**
 · `/admin/expeditions` — the live tariff table sat in an `overflow-hidden` wrapper, clipping the *Tarif* column, which is the entire output of the rate simulation.
 · `/admin/check` — both kecamatan autocompletes opened at `z-20` beneath the `z-40` nav, which also swallowed the taps.
 · Plus: resi copy button clipped out of its column, the permission matrix losing its right-hand role column, the 5kg presets pushed off-screen, the order header row overflowing, two modals with no scroll under an open keyboard, and a `90vh` dialog that overflows on iOS.

- [x] **A-62** — Tap targets, truncation and heading order across the admin. **Fixed 2026-08-16.**
 -> REQ: REQ-62 · Pagination links were 32×32 icons — the shell's 44px rule targets `button`, and shadcn renders them as `<a>`, so order paging on a phone had no compliant target. Same gap for the ten CRM step links, the back link on seven pages, and the all-menu sheet items, which are portalled outside `.admin-main` where no shell rule reaches. Payment channel switches had a 20×36px hit area — the enable/disable control for every channel.
 · Nine `truncate` declarations were inert because their wrapper lacked `min-w-0`: `white-space: nowrap` was setting the grid item's automatic minimum size, so long values widened cards instead of ellipsising.
 · Four heading-order skips corrected, all without visual change.

- [x] **A-63** — Two admin surfaces were desktop-only or lossy on mobile. **Fixed 2026-08-16.**
 -> REQ: REQ-62 · `LandingPageCatalog` now pairs a mobile card list with the untouched desktop table, matching the pattern its siblings already establish. Every desktop action is reachable: Preview and Edit as visible anchors, Duplikasi as a full-width button so its loading state is actually visible, Salin Link both as an icon button and in the menu, Hapus in the menu.
 · The layout defect is closed on both halves, which matters because closing only one is what let it recur: the track is capped by `grid-cols-1`, **and** the `<article>` itself carries `min-w-0`, removing the grid item's automatic minimum size. An inner `min-w-0` alone would not have held the action row on screen.
 · Tap targets are floored explicitly rather than left to the shell rule — that rule stops at 767px while the card list runs to 1023px, and it never reaches an `<a>` styled by `buttonVariants`, which is the same gap that left pagination at 32px.
 · `/admin/balance`'s mobile card now shows the provider transaction id and expiry its desktop row already had, with `break-all` so a long id wraps instead of pushing the status pill off screen.

- [x] **A-64** — Dialogs escape the mobile sizing net. **Fixed 2026-08-16.**
 -> REQ: REQ-62 · `body` carries `.admin-shell` even though the portal escapes `.admin-main`, so the net was cast at `.admin-shell [data-slot="dialog-content"]` without widening any other selector. Inputs and buttons inside any admin dialog now floor at 44px with 16px text, and the close button at 44×44. Verified from the compiled stylesheet that the rules land **inside** `@media (width<=767px)`, so desktop is untouched.
 · `ui/dialog.tsx` now carries a default `max-h-[calc(100dvh-2rem)] overflow-y-auto`, so a consumer can no longer forget one. `100dvh` rather than `vh`: on iOS `vh` resolves against the large viewport, so a centred panel overflows while the toolbar shows.
 · `AccessManager`'s two hand-rolled modals are plain `<div>`s: no Escape, no focus trap, no backdrop dismiss.

- [x] **A-65** — Latent instances of the unreachable-control defect. **Guarded 2026-08-16.**
 -> Replaced vigilance with a test. `src/lib/mobile-layout-guard.test.ts` walks every admin component and page and fails on a `grid` that declares no columns, because Tailwind's `grid-cols-*` expands to `repeat(n, minmax(0, 1fr))` and that `minmax(0, …)` is exactly what stops min-content from widening the track. It accepts columns declared through an inline style.
 · Mutation-verified: removing `grid-cols-1` from the product catalogue's mobile list — the original defect — fails the test and names the line. Eight further grids were made explicit while the guard was written.

- [x] **A-66** — Five page-level admin components emit no headings at all. **Fixed 2026-08-16.**
 -> `ContentWorkbench`, `HeadlessApiManagement`, `SellerBankAccounts`, `OperationalHealth`, and `AnalyticsDashboard`'s success branch. Every visual heading is a `CardTitle`, which shadcn renders as a `<div>`, so those pages contribute nothing to the document outline below the topbar `h1` — a screen-reader user cannot navigate them by heading.

- [x] **A-68** — A fresh install could be completed and then not logged into. **Fixed 2026-08-16.**
 -> REQ: REQ-3 · LOGIN-1 · The login route needs `AUTH_SECRET` at 32 characters or more to sign a session and returns 503 without it, but the wizard never checked. An operator could complete the install and be locked out of the store they had just created, with no indication why. This is the **fourth** install blocker found, after the migration chain, the unopenable credential, and the missing store row — each was hidden behind the one before it.
 · `/api/install` now checks before writing anything and names the exact command to run. Refusing costs a retry; refusing after the write costs an install nobody can enter.
 · **Found by running the built Worker against a real empty database over HTTP** — no unit test would have caught it, because every unit test supplies its own secret.

- [x] **A-69** — An unmigrated database served a placeholder storefront with a 200. **Fixed 2026-08-16.**
 -> REQ: REQ-2 · `readStoreIdentity` folded "the `stores` table does not exist" into `unknown`, and `unknown` deliberately never redirects so a transient fault cannot send a live store to its own installer. But a missing table is neither a fault nor transient — it means the migration chain was never applied, and treating the two alike meant a Worker pointed at an empty database rendered a working-looking store with fallback identity and told nobody.
 · There is now a fourth state, `unmigrated`, matched on the SQLite message rather than an error code D1 does not expose. It routes to `/install`, where the operator gets an accurate message. Genuine faults still do not redirect.
 · Found by accident: a migration command was cut short during live testing, producing exactly this state.

- [x] **A-70** — Every fresh store announced itself as "not configured". **Fixed 2026-08-16.**
 -> The `wrangler.jsonc` template shipped `PUBLIC_SITE_TAGLINE: "Belum Dikonfigurasi"`, and the wizard collected no tagline — so a store's `<title>` read *"Toko Anda — Belum Dikonfigurasi"* on every page from the moment it went live. My own defect, introduced when writing the template. The template value is now empty, and the wizard collects an optional tagline.

## A5 — Operability

- [x] **A-40** — Enable Workers Logs. **Done 2026-08-16.**
 -> REQ: REQ-82 · gap: G7 · `wrangler.jsonc` declares `observability: { enabled: true, head_sampling_rate: 1 }`, validated against the wrangler config schema and a `--dry-run`. Takes effect on the next deploy.
- [x] **A-41** — Log degradation paths. **Done 2026-08-16.**
 -> REQ: REQ-82 · Done when: every silent fallback listed in `OBSERVABILITY.md` §3 emits a labelled warning distinguishing degraded operation from success.
- [x] **A-42** — Surface outbox and provider health in `/admin`. **Done 2026-08-16.** Verdicts come from recorded outcomes rather than clock thresholds, so a store doing two orders a week does not show red every Tuesday, and *unknown* is kept distinct from *degraded* — a provider never contacted is not one that failed. Each read is windowed to the newest 200 rows with the ceiling and upgrade path noted inline.
 -> REQ: REQ-82 · Done when: undelivered `capi_event_outbox` depth, last successful Mengantar call, last AutoLaris callback, and last CAPI delivery are visible to the operator.
- [x] **A-43** — Reconcile the version registries. **Done 2026-08-16.**
 -> REQ: REQ-83 · `package.json` is now `adsbookcms@1.2.0`, matching `src/lib/version.ts`.

## A6 — Install topology *(closed 2026-09-25 by ADR-020)*

- [x] **A-50** — Decide how a second install is created and kept current.
  **Closed by ADR-020:** one repository per store, updated by merge or manual
  copy (`RELEASE.md` §7). The shared-repository options (`--config` per store,
  `env.<slug>` blocks) were the upstream multi-store shape and are removed from
  `INSTALLATION.md` §10 rather than kept as live alternatives.
- [x] **A-51** — Define how an install receives product updates. Procedure in
  `RELEASE.md` §7; `npm run fleet:status -- <install-dir>...` reports each
  install's version, sync state, distance behind the product, last deploy and
  applied schema. **Done 2026-10-12 (1.5.2).**
- [x] **A-52** — Decide whether the product ships as a package. **Rejected by
  ADR-020** (a package registry is a non-goal until manual copy stops scaling).

---

## Phase A — added 2026-09-07

Parity with the two forked installs, taken upstream after screening each
behaviour against both. BUILD-LOG Entry 175 carries the evidence.

- [x] **A-257** — The route map is a dictionary: libs, tables and tests per route, and a module index. **Done 2026-09-07.**
 -> `src/lib/route-map.ts` derives every column; `route-map.test.ts` fails on drift. 14 of 99 modules named as untested.
- [x] **A-258** — Checkout deduplication guard for the columns `0053` shipped. **Done 2026-09-07.**
 -> `persistOrder` fingerprints and reuses inside two hours; test verified by disabling the guard.
- [x] **A-259** — Meta identity captured at checkout reaches the Purchase sent later. **Done 2026-09-07.**
 -> three capture points, two consumers, `country` sent; ported by hand around `buyerEmail`/`matchableCustomerEmail`.
- [x] **A-260** — CAPI outbox: claim-before-send lease, thirty-day purge, recovery requeue. **Done 2026-09-07.**
 -> `UPDATE … RETURNING` claim, Purchases first; tests on real SQLite for the two-writer property.
- [x] **A-261** — AutoLaris digital orders submitted; Advice reconciliation hourly, paid on `rc: "00"` only. **Done 2026-09-07.**
 -> `reconcileAutoLarisPaymentStatuses` from the cron; health reads `paid_at`; RELEASE/STATUS/UNIMPLEMENTED corrected.
- [x] **A-262** — Pixel ID verified against Meta before save; ads settings report their source. **Done 2026-09-07.**
 -> `verifyMetaPixelIdentity`; `AdsConfigSource`; Google Ads destination taken whole from one source.
- [x] **A-263** — Notification floor stamped at operator creation; ninety-day purge. **Done 2026-09-07.**
 -> the `// lazy:` ceiling in `notifications.ts` is closed.
- [x] **A-264** — Deploy preflight refuses a stale or dirty tree, after fetching. **Done 2026-09-07.**
 -> `evaluateDeployPreflight`; placeholder refusal kept and non-overridable; `ALLOW_STALE_DEPLOY=1` documented in RELEASE §7.
- [x] **A-265** — A Purchase requires an eligible order and carries the order's catalog identity. **Done 2026-09-07.**
 -> `isMetaPurchaseOrderEligible` (409 on both routes); `resolveMetaPurchaseContentIds` replaces the caller's list.
- [x] **A-266** — One robots directive per page; product brand in the feeds. **Done 2026-09-07.**
 -> `nofollow={noindex}` through `astro-seo`; `<g:brand>` from `products.brand`, store name as fallback.
- [ ] **A-267** — Decide the fleet's Meta Pixel loading strategy: deferred (product, measured 2522 → 45 ms Purchase) or synchronous (two installs, "immediate detection"). Owner decision; not a port.
- [ ] **A-268** — Bring `zvarashop` and `zanobyshop` forward. Proven behaviour is upstream; what remains is pages and config. Each needs a backup, a maintenance window and its own session.

## Phase A — added 2026-08-17

Found by an adversarial audit of the install and auth paths against the built
Worker, and by reading the emitted stylesheets rather than the source.

- [x] **A-68b** — The admin gate read the raw request path while Astro routed on a normalized one. **Done 2026-08-17.**
 -> gap: — · ADR-013 · `//api/admin/settings` returned 200 with provider settings and no cookie; a cross-site `PUT` on the same path rewrote the courier API key. `src/middleware.ts` now derives every path decision from `context.url`. Pinned by `middleware-path-source.test.ts` and by `auth.test.ts`, whose harness previously supplied only `request` — which is why this passed CI. Verified before and after against `wrangler dev` on a real installed D1.

- [x] **A-72** — The installer's credential write was unguarded, so a second submission took the admin account. **Done 2026-08-17.**
 -> REQ: REQ-6 · A zero-row `INSERT` is not an error, so D1 kept the batch: the second caller was told "already installed" and had just replaced the operator's username and password. `hashAdminPassword` parks every request in ~100ms of PBKDF2 before the write, so an attacker polling an un-installed Worker owns the store the moment its operator installs it. The credential `UPDATE` now carries `AND must_change_password = 1` — order-independent, claimable once — and `runInstall` refuses outright when no credential row exists rather than writing a store with no admin. Reproduced and pinned in `install.test.ts` against real SQLite.

- [x] **A-73** — Anyone knowing the admin username could lock the operator out. **Done 2026-08-17.**
 -> ADR-014 · Ten addresses × the 5-per-pair allowance is exactly the 50 identifier ceiling, so sixty requests denied the real operator, with the correct password, from a clean address — repeatable indefinitely. The identifier bucket now denies only an address that has itself failed for that account.

- [x] **A-74** — `robots.txt` told Google nothing and shipped the demo store's sitemap. **Done 2026-08-17.**
 -> Per RFC 9309 a crawler obeys only its most specific matching group; the named groups held nothing but `Allow: /`, so six crawlers saw no disallows and `/admin` and `/hello` were fair game. It also carried `Sitemap: <demo domain>`. Now served from `src/pages/robots.txt.ts` against the store's own identity, with the disallow list repeated in every group.

- [x] **A-75** — Reference-store branding was still shipping on three surfaces. **Done 2026-08-17.**
 -> The storefront wordmark was the demo name in literal text while its own `aria-label` resolved correctly; the favicon every admin page and the login screen load spelled it out in two 62px words; and the Google/Meta ads pages printed the demo store's feed URLs for the operator to register. All now resolve from identity, and `brand-contamination.test.ts` fails the build if any of it returns.

- [x] **A-76** — 27 routes asked for Inter and loaded no font faces at all. **Done 2026-08-17.**
 -> The `@fontsource` imports lived in `BaseLayout`, so all 23 `@font-face` rules landed in that layout's stylesheet. The 26 admin routes, `/hello` and `/embed/form` load `global.css` and never that one, while `global.css` names Inter for `body` and `.admin-shell` — the entire operator UI, plus the checkout merchants iframe onto their own pages, silently rendered in `system-ui`. Faces moved to `global.css`; the 400/600/700 ramp is unchanged (A-32).

- [x] **A-77** — The mobile grid guard passed the defect it exists to stop. **Done 2026-08-17.**
 -> It accepted `grid-cols-*` "at any breakpoint prefix", so `grid gap-3 sm:grid-cols-2` — which below `sm` has no `grid-template-columns` at all — was green, and 48 live admin grids matched that shape. It also read only double-quoted `class` attributes, missing `cn()`, template literals, single-quoted Astro attributes and `class:list`: six of seven spellings. Guard rewritten and mutation-verified against all seven; the 48 grids given an explicit mobile column; scope widened to `src/components/ui` and `src/layouts`.

- [x] **A-78** — Three holes in the mobile tap-target net. **Done 2026-08-17.**
 -> An `<a class="h-8">` inside the very dialog the net was written for (anchors were not in any selector); `sheet-content`, which portals exactly as dialogs do and carries the mobile menu and search; and portaled `select-item` / `dropdown-menu-item` / `command-item` rows at ~28px across seven admin components.

- [x] **A-79** — A fresh store described itself to customers as unconfigured. **Done 2026-08-17.**
 -> Same defect as A-70, one field over: `PUBLIC_SITE_DESCRIPTION` shipped `"Belum dikonfigurasi."`, which becomes the meta description Google prints under the store and the second half of the home page `<title>`. Both the template value and the code default are now empty, and the resolver composes a plain sentence from the store's own name.

- [x] **A-71** — Make the login brake exact under concurrency. **Done 2026-08-27 (ADR-021).**
 -> ADR-014 · Was a non-atomic KV get-then-put: 50 parallel wrong passwords cost 1 of a 5-attempt bucket. Now one D1 `INSERT … ON CONFLICT DO UPDATE … RETURNING count` per spend — no Durable Object needed.

- [ ] **A-80** — See the admin rendered in a browser.
 -> deps: [A-58] · Everything in A-76, A-77 and A-78 is a cascade change reasoned from the built stylesheet, not from pixels. Not established: that the 44px floors do not break a compact row, that growing `dialog-close` to 44×44 under `absolute top-2 right-2` clears the header in `OrderDetail`'s `p-0` dialog, or that admin reads acceptably now that it renders in Inter rather than the platform's `system-ui`. Done when the admin has been opened at 320px, 390px and desktop.

- [x] **A-81** — Catalog id, pixel `content_ids` and feed `<g:id>` were three different values. **Done 2026-08-17.**
 -> Historical ADR-015 implementation, superseded by ADR-017/A-115 on 2026-08-18. The cross-surface regression test remains, but the accepted identity is now the numeric Product ID and feeds are product-grained.

- [ ] **A-82** — Give `product_variants` a variant axis.
 -> deps: [A-81] · Every variant label ships to Google as `g:size` whatever it really is, because the row records one free-text label ("30ml", "Merah", "isi 2") and nothing that says which attribute it varies. Google treats size as free text, so this is imprecise rather than invalid. Done when a colour variant ships as `g:color` and a size variant as `g:size`, chosen from stored data rather than guessed from the string.

- [x] **A-83** — 12 MB of a former merchant's assets, and their wordmark, shipped in every install. **Done 2026-08-17.**
 -> Found while verifying the history rewrite: the rewrite dropped the old *history*, but `public/images/` still carried the assets in the **current** tree. 500 files (`produk/`, plus 15 top-level product directories) referenced by nothing at all — no code, no seed, no migration, no content. And `logo.webp` was the demo store's wordmark, hardcoded in eight places including `AdminShell`, `AppSidebar` and `/thanks`, and named by `wrangler.jsonc` as `PUBLIC_SITE_LOGO` — so every install's admin chrome and confirmation page wore another merchant's brand. Sixth surface of the LOGIN-10 defect, and invisible to `brand-contamination.test.ts` because a `.webp` carries no matchable text. The logo now flows from `Astro.locals.tenant.logo` through the existing identity chain; product-owned fallbacks use the neutral mark. `public/images` 21 MB → 9.1 MB.

- [x] **A-84** — A missing image answered 302 to the login screen instead of 404. **Done 2026-08-17.**
 -> `isInstallerPath` covers `/images/`, `/_astro/` and the favicons so the wizard can render before a store exists. It was reused for the installed case, so on a live store any request for an absent asset redirected to `/hello` — an `<img>` receiving an HTML login page. Split into `isInstallerRoute` (the wizard's own routes, used when installed) and `isInstallerPath` (routes plus assets, used only when uninstalled). Verified live: absent images now 404, `/install` still 302s on an installed store.

- [x] **A-85** — Ship an empty CMS: remove the bundled catalogue. **Done 2026-08-17.**
 -> ADR-016 · `scripts/seed-catalog.sql`, `public/images/products/` (22 products, 110 variants, 8.9MB) and `db:reset:demo:local` removed. Verified first on a migrated, installed, product-free database that the empty states already existed and read well — `/produk` "Katalog sedang disiapkan", `/kontak` "Kontak Belum Tersedia", valid empty catalog XML, every route 200 — so nothing broke by having nothing. The home page then gained the empty state its siblings had: the product grid, the search box and the "0 dari 0" counter are `hidden` when there is nothing to count. `public/images` 21MB → 232KB across this and A-83. Whether to reintroduce sample data, and in what form, is deferred — not decided against.

- [x] **A-86** — The ad taxonomy defaulted every unclassified product to Handbags. **Done 2026-08-17.**
 -> Fallout of A-85, and the reason it could not be a pure deletion. `DEFAULT_TAXONOMY` was Google category `6551`, justified in its own comment as "at least a category this catalog sells". With no catalogue that premise is false, and the default would have submitted every unclassified product in every store to Merchant Center as a handbag — the exact misrepresentation the adjacent comment warns about. `getAdTaxonomy` now returns no category when no rule reaches the confidence bar, and both feeds omit `google_product_category` / `fb_product_category` rather than assert one. Both fields are optional and Google auto-classifies what is missing. The scoring rules are unchanged; only the fallback is.

- [ ] **A-87** — Let a merchant tell the taxonomy engine what they sell.
 -> deps: [A-86] · The keyword rules are inherited from earlier merchants and match no particular install. A product now falls through to no category rather than a wrong one, which is safe but leaves Merchant Center auto-classifying. Done when a store can set its own category mapping from `/admin`, or confirm the engine's guess, instead of the engine inferring from Indonesian keyword lists that predate it.

## A9 — Admin access and adaptive operator workspace

- [x] **A-88** — Make the session cookie follow the request transport. **Done 2026-08-17.**
 -> Primary requirement: LOGIN-20 · Constraints: LOGIN-13, LOGIN-19, REQ-60 · Dependencies: none · Done when: a focused automated check proves HTTPS login cookies retain `HttpOnly`, `SameSite=Lax`, and `Secure`; a plain-HTTP local login omits only `Secure`; and a real browser on the Tailscale development origin reaches the forced password-rotation page instead of looping to `/hello`.

- [x] **A-89** — Make the shared admin shell deliberately adaptive. **Done 2026-08-17.**
 -> Primary requirement: REQ-66 · Constraints: REQ-65, REQ-69 · Dependencies: A-88 · Done when: the existing `AdminLayout`, `AdminShell`, `AppSidebar`, mobile sheets, and bottom navigation form one shell with no page-level horizontal overflow at 320, 390, 768, and 1280 CSS px; the active location remains visible in every mode; and no second shell or navigation dependency is introduced.

- [x] **A-90** — Make dashboard content and actions role-correct. **Done 2026-08-17.**
 -> Primary requirement: REQ-67 · Constraints: REQ-61, REQ-68 · Dependencies: A-89 · Done when: owner/admin retain the operational health and commerce actions they may use; advertiser and customer-service dashboard loads make no forbidden health request, expose no denied action link, and render a useful role-specific overview instead of an error panel.

- [x] **A-91** — Complete shared login and dashboard state feedback. **Done 2026-08-17.**
 -> Primary requirement: REQ-68 · Constraints: LOGIN-10..19, REQ-69 · Dependencies: A-88, A-90 · Done when: login preserves the submitted username and announces validation/server failures; pending submission cannot double-run and recovers after navigation restore; dashboard health/analytics preserve useful content during recoverable failure; search has explicit empty state; and changed controls retain visible focus and accessible names.

- [x] **A-92** — Prove the adaptive admin in a real browser. **Done 2026-08-17.**
 -> Primary requirement: REQ-69 · Constraints: REQ-66, REQ-67, REQ-68 · Dependencies: A-89, A-90, A-91 · Done when: the local Worker flow is exercised at 320, 390, 768, and 1280 CSS px through login, forced password rotation, dashboard, mobile navigation, search, and logout; overflow delta is at most 1 px; relevant console/network failures are zero; keyboard focus is visible and ordered; and screenshots plus exact runtime evidence are recorded before documentation status is changed.
 -> Evidence: built-Worker Chromium runs measured 0 px overflow at all four widths, 48 px tablet rail, 256 px desktop sidebar, working mobile Menu/search/logout, no runtime exceptions or failed requests, and correct first-run restriction. Screenshots: `/tmp/adsbook-login-final-390.png`, `/tmp/adsbook-profile-{320,390,768,1280}.png`, and `/tmp/adsbook-dashboard-{320,390,768,1280}.png`.

- [x] **A-93** — Make admin navigation structurally motionless. **Done 2026-08-17.**
 -> Primary requirement: REQ-66 · Constraints: REQ-65, REQ-69 · Dependencies: A-89 · Done when: desktop menu clicks cannot expand rows, auto-scroll the sidebar, or resize the shell; phone navigation sheets do not slide or fade; child routes remain reachable; and no animation dependency is added.
 -> The desktop accordion, `scrollIntoView`, sidebar trigger, and resize rail were removed. A compact static child list now renders below the active desktop workspace without disclosure state or structural movement; its parent remains a direct overview link. Tablet retains the fixed icon rail, while role-allowed child routes remain in overview pages and global search; phone All Menu renders every child. Admin navigation and Sheet transitions are disabled by the scoped visual contract. Source guards, 309 tests, the 318-file check, production build, and isolated Chromium renders at 1280/768 px pass. The full authenticated flow was not bypassed because the current local credential is no longer the documented default.

- [x] **A-94** — Make sidebar typography quiet and dashboard hierarchy truthful. **Done 2026-08-17.**
 -> Primary requirements: REQ-67, REQ-69 · Constraints: REQ-61, REQ-68 · Dependencies: A-90, A-93 · Done when: desktop and mobile navigation use regular text with medium weight only for current state; analytics and KPIs precede secondary health diagnostics; period controls cannot request an API-invalid range; labels describe the values actually calculated; and payment actions remain hidden from roles without access.
 -> Sidebar labels are regular, current labels medium, and navigation remains motionless. The dashboard now leads with a 7-day WIB analytics overview, four unclipped KPIs, revenue trend, and payment mix; health follows as owner/admin diagnostics. The paid-order ratio is labelled `Pembayaran berhasil`, 90/180-day presets are omitted from this 31-day endpoint, custom range is capped at 31 inclusive days, and `Kelola payment` follows route authorization. Escape from mobile All Menu returns focus to its trigger. Focused tests, the full 310-test suite, 318-file check, production build, and isolated Chromium at 390/768/1280 px pass.

## A10 — Permatamall-derived correctness and installer hardening

- [x] **A-95** — Unify order lifecycle and stock restoration. **Done 2026-08-17.**
 -> Primary requirements: REQ-30, REQ-31 · Done when: single and bulk mutations share one transition policy; cancellation/return and destructive deletion restore reserved stock exactly once; provider-dispatched orders cannot be deleted; focused lifecycle and retention tests pass.

- [x] **A-96** — Make identifiers and abandoned-lead retention race-safe. **Done 2026-08-17.**
 -> Primary requirements: REQ-20, REQ-30 · Done when: order numbers use one atomic counter across checkout and abandoned capture; abandoned capture has honeypot plus rate limiting; scheduled maintenance purges eligible rows through the same stock-safe deletion boundary; concurrency and retention tests pass.

- [x] **A-97** — Close payment-policy and Purchase-signal divergence. **Done 2026-08-17.**
 -> Primary requirements: REQ-36, REQ-37, REQ-50, REQ-53 · Done when: bank transfer has an operator verification transition; persisted payment master/channel policy is enforced at submit boundaries; Meta browser/server Purchase uses canonical order/product identity and paid-state eligibility.

- [x] **A-98** — Remove fake AutoLaris runtime health. **Done 2026-08-17.**
 -> Primary requirement: REQ-4 · Done when: runtime defaults contain no fabricated AutoLaris credential; missing credentials are reported as missing rather than healthy; the source and focused tests prove the absence.

- [x] **A-99** — Remove the bundled merchant catalog and assets. **Done 2026-08-17.**
 -> Primary requirements: REQ-9, REQ-11, REQ-12 · Done when: no product dataset, seed command, product asset directory, or hardcoded merchant catalog ships; fresh catalog state is empty and all storefront product facts come from D1.

- [x] **A-100** — Fail closed when home content is unpublished. **Done 2026-08-17.**
 -> Primary requirements: REQ-13 · Done when: the content resolver returns `setup-required`; built-in and Headless home responses expose an explicit setup state; compiled/generated merchant-facing fallback copy cannot render.

- [x] **A-101** — Apply the bundled migration chain at runtime. **Done 2026-08-17.**
 -> Primary requirements: REQ-2, REQ-8, REQ-81 · Done when: the Worker embeds the checked-in chain, atomically claims and applies a valid missing suffix before database-backed routes, handles concurrent first requests, and fails closed on invalid/unknown/ahead history.

- [x] **A-102** — Make storefront definitions runtime-extensible. **Done 2026-08-17.**
 -> Primary requirements: REQ-14 · Done when: D1 owns editable template definitions and composition; built-in templates are seeded as runtime data; an operator can add a definition without rebuilding the Worker.

- [x] **A-103** — Enforce Headless scopes, quotas, audits, and status reads. **Done 2026-08-17.**
 -> Primary requirements: REQ-73, REQ-74, REQ-75, REQ-76 · Done when: every operation has one minimum scope; per-key minute/daily quotas are atomic in D1; write audits contain no commerce payload; order status requires its public token and returns no customer PII.

- [x] **A-104** — Send actionable per-install operational alerts. **Done 2026-08-17.**
 -> Primary requirements: REQ-82, REQ-85 · Done when: scheduled schema/CAPI checks persist transition state in KV; firing and recovery webhook events deduplicate; failed notifications retry; disabled/missing state is explicit; payloads contain no commerce data.

- [x] **A-105** — Reconcile canonical documents and executable evidence. **Done 2026-08-17.**
 -> Dependencies: A-95..A-104 · Done when: PRD, architecture, decisions, status, install/release/integration/observability runbooks, remaining-work ledger, task ledger, and build log describe the implemented tree; focused tests, full check/test/build, fresh-install migration smoke, and real-browser login pass.
 -> Canonical documents now describe A10's implemented contracts and retain only evidenced gaps. The 61-test focused regression passed, followed by 354/354 tests, a 335-file zero-diagnostic check, and a complete Cloudflare server build. An isolated local Worker applied all 40 migrations to an empty D1, redirected to `/install`, stored an operator-chosen owner credential, accepted that login in Chromium at 390 px, and rendered the unpublished fresh-store setup state with no product links or horizontal overflow.
- [x] **A-106** — Publish executable Headless contract assets. **Done 2026-08-17.**
 -> Primary requirements: REQ-73, REQ-74, REQ-75, REQ-76 · Dependencies: A-103 · Done when: an authenticated OpenAPI 3.1 document describes every `/api/v1` operation; a framework-neutral server adapter covers bootstrap, catalog, quote, checkout, token-scoped status, tracking submission, and accessible confirmation focus; and executable tests traverse the commerce handlers without exposing the developer key to browser code.
 -> Evidence: the focused OpenAPI, adapter, and attribution contracts passed 11/11 tests; the full suite passed 356/356; `npm run check` inspected 335 files with zero diagnostics; and `npm run build` completed the Cloudflare server bundle.

## A11 — Provider-backed shipping operations

- [x] **A-107** — Synchronize and surface Mengantar shipment status. **Done 2026-08-17.**
 -> Primary requirement: REQ-46 · Dependencies: T57, T58 · Done when: Shipping explicitly polls provider-created rows by stored waybill without concurrent provider calls; persists the latest raw provider description, event timestamp, and sync timestamp; advances only monotonic lifecycle states through the shared atomic policy; isolates per-order failures; and presents summary, filter, pickup, status-evidence, loading/error/empty, desktop-table, and mobile-card states without horizontal overflow.
 -> Evidence: migration `0040_provider_shipping_status.sql` applied to the local D1; focused Mengantar, lifecycle, Shipping route, and provider-sync contracts passed 25/25; the full suite passed 356/356; `npm run check` inspected 336 files with zero diagnostics; `npm run build` bundled 41 migrations; Chromium exercised empty and populated local API states at 390, 768, and 1280 CSS px, including search/reset and sync feedback, without a live Mengantar call.

## A12 — Fresh-install warehouse recovery

- [x] **A-108** — Create the first warehouse from Admin settings. **Done 2026-08-17.**
 -> Primary requirements: REQ-36, REQ-62 · Dependencies: T39, T212 · Done when: `/admin/settings/warehouse` treats an absent warehouse as an actionable setup state; the first valid save creates the single-row warehouse after provider-backed pickup-address resolution; later saves update that row; dynamic provider location labels render as text; and loading, error, saved, 390 px, 768 px, and 1280 px states remain accessible without horizontal overflow.
 -> Evidence: focused create/update route contracts passed 2/2; the full suite passed 363/363; `npm run check` inspected 337 files with zero diagnostics; `npm run build` completed; and Chromium exercised real empty-D1 loading plus intercepted create, existing-row, provider-label, and failure states at 390, 768, and 1280 CSS px without a live provider request or database mutation.

## A13 — Session-safe lead capture and four-queue Shipping

- [x] **A-109** — Make abandoned capture session-idempotent. **Done 2026-08-17.**
  -> Primary requirement: REQ-29 · Dependencies: A-96 · Done when: hybrid and middle forms store the successful fingerprints of normalized name, WhatsApp number, and product/variant selection in a v2 `sessionStorage` set that reads the legacy v1 value; any identical prior combination is suppressed after blur or reload in the same tab session; a changed qualified combination may capture; the fingerprint is added only after success, so failed requests and unavailable or quota-limited storage remain retryable without blocking capture; and focused browser-unit contracts cover identical, changed, failed, legacy, and unavailable-storage states.
  -> Evidence: focused identity, changed-combination, retry, legacy, and unavailable-storage contracts passed 6/6; Chromium at 390, 768, and 1280 CSS px captured the initial and changed combinations, suppressed a repeated identical combination, retained the per-session set, and had zero root overflow. The 390 px reload also suppressed the prior identical combination.

- [x] **A-110** — Prove submitted online checkouts remain orders. **Done 2026-08-17.**
  -> Primary requirement: REQ-36 · Constraints: REQ-23, REQ-26, REQ-27 · Done when: focused checkout/persistence contracts prove bank-transfer and successfully-created VA/QRIS submissions remain real orders with `payment_status = 'pending'` and `shipping_status = 'pending'` before authenticated, idempotent payment confirmation; an explicit AutoLaris creation failure may set `payment_status = 'failed'` but keeps `shipping_status = 'pending'`; and no pending, failed, cancelled, or expired payment path reclassifies the row as abandoned or invokes Mengantar dispatch.
  -> Evidence: the focused full-funnel contract kept non-COD payment and shipping pending before confirmation; the automatic-dispatch contract made zero provider requests for an unpaid online order; and the full repository suite passed 379/379.

- [x] **A-111** — Expose the four Shipping queues. **Done 2026-08-17.**
  -> Primary requirement: REQ-48 · Constraints: REQ-43, REQ-47 · Dependencies: A-95, A-107 · Done when: the authenticated Shipping read model classifies shipping-active orders deterministically into exactly **Semua Pengiriman**, **Perlu Dibuatkan Resi**, **Perlu Pickup**, and **Sampai Tujuan** without making a provider request; **Perlu Dibuatkan Resi** includes a provider-created unpaid draft only when `provider_order_id` exists and no cnote exists; and eligible pending orders not yet pushed to Mengantar remain in Order Management for retry rather than being represented as provider drafts.
  -> Evidence: focused queue predicates passed 5/5, and the protected Shipping workspace exposed only the four accepted selectors against intercepted populated data without a live provider request.

- [x] **A-112** — Refine the Shipping operator interface. **Done 2026-08-17.**
  -> Primary requirement: REQ-48 · Constraints: REQ-42, REQ-43, REQ-45, REQ-46, REQ-69 · Dependencies: A-111 · Done when: `/admin/shipping` presents exactly four count-bearing accessible selectors labelled **Semua Pengiriman**, **Perlu Dibuatkan Resi**, **Perlu Pickup**, and **Sampai Tujuan**, each with a distinct icon; desktop and mobile order cards expose order number, customer, destination, amount, payment, courier, waybill/provider evidence, and pickup state only when relevant; actions are limited to inspect/open order, schedule pickup, and sync tracking according to row state; a provider unpaid draft is visible without a fabricated waybill or an unverified internal `/order/pay-unpaid` action; and no horizontal overflow occurs at 390, 768, or 1280 CSS px.
  -> Evidence: Chromium exercised the four selectors, search/reset, state-valid sync feedback, cards/table, nested scrolling, and zero root horizontal overflow at 390, 768, and 1280 CSS px.

- [x] **A-113** — Verify and reconcile the A13 contracts. **Done 2026-08-17.**
  -> Primary requirements: REQ-29, REQ-36, REQ-47, REQ-48 · Dependencies: A-109..A-112, A-114 · Done when: focused lifecycle and queue tests, the full test suite, repository check, and production build pass; Chromium exercises identical/changed abandoned capture plus all four Shipping queues at 390, 768, and 1280 CSS px without live provider calls; and PRD, STATUS, TASKS, and BUILD-LOG match the executable result.
  -> Evidence: focused lifecycle, payment, automatic-dispatch, and queue contracts passed 37/37; `npm test` passed 379/379; `npm run check` inspected 341 files with zero diagnostics; `npm run build` completed the Cloudflare server bundle; Chromium covered abandoned-capture and Shipping behavior at 390, 768, and 1280 CSS px; and the canonical ledgers were reconciled.

- [x] **A-114** — Automatically dispatch eligible persisted orders. **Retired 2026-08-18; superseded by the explicit operator-release invariant.**
  -> Primary requirement: REQ-47 · Constraints: REQ-25, REQ-26, REQ-36, REQ-42, REQ-43 · Dependencies: A-95 · Done when: one shared server-side function is called only after checkout persistence succeeds and after authenticated, idempotent non-COD payment confirmation; it applies the existing eligibility policy and requires valid provider configuration plus warehouse data; preserves sequential dispatch; suppresses a provider call when `provider_order_id` already exists; returns `dispatched`, `unpaid_provider_draft`, `skipped`, or `failed`; persists only accepted provider identifiers and a provider-supplied cnote; records a bounded provider error while leaving a failed order pending and retryable; and never rolls back the order or fabricates a waybill.
  -> Superseding evidence: checkout and payment reconciliation now make zero Mengantar shipment calls; only authenticated single/bulk operator actions invoke the dispatcher, and concurrency tests prevent cancellation or buyer edits from being overwritten after provider latency.

## A14 — Catalog identity and advertising signal precision

- [x] **A-115** — Make Product ID the single advertising catalog identity. **Done 2026-08-18.**
  -> Primary requirements: REQ-50, REQ-57, REQ-58 · Dependencies: T74, T77 · Done when: Product ID, API `content_id`, Meta `content_ids`, Google ecommerce `item_id`, and both feeds' `<g:id>` are the same safe decimal ID with at least five digits; each product creates one feed item; variants retain raw selectable IDs; and cross-surface tests reject short, prefixed, leading-zero, and unsafe identities.
  -> The shared catalog helper now enforces the numeric Product ID contract. Google and Meta feeds emit one item per product with no duplicate group identity, hosted and Headless surfaces return the same content ID for product and variants, and embed selection uses the raw variant row ID.

- [x] **A-116** — Repair Payment fee choices and remove the admin live-rate simulator. **Done 2026-08-18.**
  -> Primary requirements: REQ-37, REQ-69 · Done when: Seller/Pembeli choices remain visibly labelled and keyboard-operable, selected state is exposed with `role=radio`/`aria-checked`, fee persistence remains explicit, and the isolated admin-only Mengantar rate simulator plus its orphan POST action are removed without changing public checkout quoting.

- [x] **A-117** — Verify and reconcile the A14 runtime contract. **Done 2026-08-18.**
  -> Primary requirements: REQ-50, REQ-57, REQ-58 · Dependencies: A-115, A-116 · Done when: focused identity tests, full test/check/build, and authenticated Chromium validation for Payments and Expeditions pass; canonical documents match the executable tree; and no live provider request or deployment occurs.
  -> Evidence: focused identity contracts passed 28/28, the full suite passed 380/380, `npm run check` reported zero diagnostics across 342 files, and the Cloudflare server build completed. Isolated authenticated Chromium at 390 px proved four labelled Seller/Pembeli radios, a visible selected-state change, an enabled Save action, 66 px choice targets, and zero page overflow; Expeditions omitted the simulator with zero overflow at 390 and 1280 px. No relevant request failed.

## A15 — Dedicated missed-order lead recovery

- [x] **A-118** — Separate **Pesanan tertinggal** from operational orders. **Done 2026-08-18.**
  -> Primary requirements: REQ-27, REQ-29 · Done when: abandoned lead rows never appear in the normal Order API, SSR initial list, summaries, status filters, bulk actions, or Shipping; a dedicated protected workspace exposes only abandoned leads with product, customer name, WhatsApp, and follow-up state.

- [x] **A-119** — Convert a followed-up lead into one complete pending order. **Done 2026-08-18.**
  -> Primary requirements: REQ-23, REQ-24, REQ-25, REQ-29 · Dependencies: A-118 · Done when: CS can edit a lead, select a valid D1 destination and courier, and explicitly convert it using current D1 product, price, weight, warehouse, and stock; conversion reserves stock exactly once, preserves the lead/order identity without duplication, lands in Order Management as pending, and makes zero Mengantar shipment calls.

- [x] **A-120** — Repair the buyer and address editor on order invoices. **Done 2026-08-18.**
  -> Primary requirements: REQ-25, REQ-47 · Done when: the shadcn Dialog opens only for editable orders, pre-fills and saves permitted buyer/address changes, requires a valid location/rate when shipping selection changes, retains input and focuses an inline error on failure, exposes courier choices with radio semantics, and clearly explains provider-locked orders.

- [x] **A-121** — Verify and reconcile the missed-order recovery flow. **Done 2026-08-18.**
  -> Primary requirements: REQ-23, REQ-24, REQ-25, REQ-27, REQ-29, REQ-47 · Dependencies: A-118..A-120 · Done when: focused lifecycle/API tests, the full test/check/build gates, and authenticated Chromium at 390, 768, and 1280 CSS px prove list separation, lead editing/conversion, order editing, dispatch eligibility, keyboard/focus behavior, and zero page overflow without a live provider call or deployment.
  -> Evidence: focused lead, authorization, lifecycle, concurrency, and order-edit contracts passed; the full suite passed 401/401; `npm run check` reported zero diagnostics across 349 files; and the Cloudflare server build completed. Isolated authenticated Chromium at 390, 768, and 1280 CSS px proved the dedicated empty queue and invoice editor have zero root overflow. A controlled populated state proved product/customer/follow-up rendering, focused invalid conversion input, exact conversion payload, INV redirect, and a dirty-field-only buyer edit. No provider request, remote database mutation, deployment, commit, or push occurred.

## A16 — Lead UI, AutoLaris Create Order, and install defaults

- [x] **A-122** — Apply the installed shadcn system to **Pesanan tertinggal**. **Done 2026-08-18.**
  -> Primary requirements: REQ-27, REQ-29 · Dependencies: A-118 · Done when: the dedicated lead workspace uses the installed Card, Badge, Button, Dialog, Separator, Skeleton, and Pagination primitives with semantic tokens; retains the follow-up and conversion behavior; focuses inline validation; returns focus after dismissal; and has no page overflow at 390, 768, or 1280 CSS px.

- [x] **A-123** — Cut AutoLaris online checkout over to Create Order. **Done 2026-08-18.**
  -> Primary requirements: REQ-30, REQ-36 · Done when: online checkout calls only `POST /api/h2h/submit`, sends the exact provider field `courir_id: 1`, sources origin/destination/warehouse/receiver/weight/items from D1, maps the nested payment instructions, and fails before fetch when required provider facts are missing. The fixed value is an operational provider-team instruction, not a value inferred from the published examples.

- [x] **A-124** — Bootstrap the expedition catalogue on fresh and empty installs. **Done 2026-08-18.**
  -> Primary requirements: REQ-40 · Done when: install atomically creates the neutral ten-courier policy; migration `0042` repairs only stores with zero courier rows; an existing customized policy is unchanged; and `/api/admin/expeditions` exposes the rows after a fresh install.

- [x] **A-125** — Verify and reconcile A16. **Done 2026-08-18.**
  -> Primary requirements: REQ-27, REQ-29, REQ-30, REQ-36, REQ-40 · Dependencies: A-122..A-124 · Done when: exact adapter, orchestration, migration, install, API, full test/check/build, and isolated browser gates pass; canonical documents match the executable tree; and no live provider call, remote mutation, or deployment occurs.
  -> Evidence: the full suite passed 408/408; `npm run check` reported zero diagnostics across 350 files; the Cloudflare build completed; and the corrected `0042` migration applied through Wrangler after a browser gate caught and removed a compound-SELECT incompatibility. A fresh isolated install returned ten couriers. Authenticated Chromium at 390, 768, and 1280 CSS px proved the populated shadcn lead workspace, zero overflow, validation focus, focus return, and no console/network error. No live provider request, remote database mutation, or deployment occurred.

## A17 — Manual AutoLaris reconciliation and payment-status hardening

- [x] **A-126** — Replace webhook reconciliation with immutable manual confirmation. **Done 2026-08-18.**
  -> Primary requirements: REQ-11, REQ-12, REQ-21 · Done when: `/api/admin/payment-reconciliation` lists only scoped AutoLaris online transactions, owner/admin can confirm one payment only by exact billed amount and provider reference, the update is atomic and idempotent, an append-only audit row is written, the retired public webhook returns `410`, and destructive order deletion rejects audited payments up front.

- [x] **A-127** — Ship the admin and buyer UI for manual confirmation. **Done 2026-08-18.**
  -> Primary requirements: REQ-11, REQ-12, REQ-21, REQ-27 · Dependencies: A-126 · Done when: `/admin/balance` becomes the manual verification queue with eligibility/lock reasons, inline validation, mobile/desktop shadcn rendering, and no callback-secret readiness copy; `/payment` truthfully says admin verification/manual refresh, polls CMS status every minute, and still replaces itself with `/thanks` after a server-confirmed paid state.

- [x] **A-128** — Align operational semantics, install/runtime guards, and docs. **Done 2026-08-18.**
  -> Primary requirements: REQ-40, REQ-82, REQ-85 · Dependencies: A-126, A-127 · Done when: operational health reflects manual confirmation instead of webhook success, fresh/empty installs still expose the neutral courier policy, provider-created online checkout uses `POST /api/h2h/submit` with exact `courir_id: 1`, and canonical docs stop describing callback-based readiness as current runtime truth.

- [x] **A-129** — Verify and reconcile A17. **Done 2026-08-18.**
  -> Primary requirements: REQ-11, REQ-12, REQ-21, REQ-27, REQ-40, REQ-82, REQ-85 · Dependencies: A-126..A-128 · Done when: focused reconciliation/lifecycle/operational-health tests, full suite, repository check, production build, isolated browser queue validation, and isolated paid redirect proof pass; canonical docs match the executable tree; and no live provider call, remote mutation, deployment, commit, or push occurs.
  -> Evidence: the full suite passed 419/419; `npm run check` reported zero diagnostics across 353 files; the Cloudflare build completed; and the manual confirmation surface plus paid redirect were exercised on isolated local runtime only.
## A22 — Release-driven updates for isolated installs

**Execution status:** Revised 2026-08-23 per ADR-020. Updates are distributed by
manual copy, not a fleet engine — the automation tasks below are withdrawn as
YAGNI. Only A-151 (done), A-153-as-manifest, and A-159 (optional) remain.

- [x] **A-151** — Close the audited raw-text JSON script breakout in both
  canonical storefront forms and leave a literal `</script>` regression test.
      -> REQ: REQ-164 · deps: [] · **Done 2026-08-23:** both form config scripts
      render through `jsonForScript` (`src/lib/json-script.ts`, escapes `<` as
      `<`); `src/lib/json-script.test.ts` proves a `</script>` payload
      cannot terminate the JSON element and round-trips through `JSON.parse`;
      full `npm test` (511) / `npm run check` / `npm run build` pass.
- [x] **A-153** — Produce and maintain the **path-ownership manifest**: a
  documented list classifying every synchronized path as product-owned (copied
  on update) or install-owned (never overwritten — `wrangler` config, Cloudflare
  / D1 / KV / R2 ids, secrets/`.dev.vars`, domain, merchant assets, per-install
  `RELEASE.md`). Reduced from an enforced engine to a copy-paste checklist.
      -> REQ: REQ-167 · deps: [] · **Done 2026-08-23:**
      `docs/UPDATE-PATH-OWNERSHIP.md` classifies every path, derived from the
      real repo layout (`wrangler.jsonc` ids/domain/vars, `.gitignore` secrets,
      `public/images/` brand assets), including the `wrangler.jsonc`
      structural-fields-to-hand-merge case. Per-store values are confirmed when
      a second real install exists; the path classification is complete.
- [x] **A-159** *(optional hygiene)* — Reconcile local product worktrees **Confirmed done 2026-09-25:** `git worktree list` shows only `main`.
  (`adsbookcms-dev` detached, `adsbookcms-lp`) into one canonical `main` without
  losing pre-existing work; removal or branch attachment only after explicit
  operator approval.
      -> REQ: REQ-172 · deps: [] · **Inventory recorded 2026-08-23 (read-only;
      nothing removed).** Both non-canonical worktrees are clean — zero
      uncommitted entries — and neither holds work at risk:
      · `adsbookcms-dev` — detached at `7883095` ("Merge pull request #26 …
        retire-wide-catalog-ui"), a 1.2.0-era revision that is an **ancestor of
        `origin/main`**, so it contains nothing main does not.
      · `adsbookcms-lp` — branch `fix/adr-019-token-list`, upstream **gone**
        (deleted after merge), at `7fbb600` ("the re-brand contract is eight
        tokens, not five"). Its content reached main as `dcd42ba` (#64): a
        file-by-file diff against `origin/main` shows **no line present in the
        worktree and missing from main** — main only adds ADR-020 on top.
      · The `ProductImageGallery.astro` change the audit told us to preserve was
        in the canonical worktree and is merged (#63).
      Remaining step is the destructive half — `git worktree remove` and/or
      branch attachment — which stays pending explicit operator approval.
- [x] **A-160** — Adopt audit §2.6: give the two untested modules that fail
  silently a direct test — `store-ads.ts` (resolves the pixel id, CAPI token and
  Google identifiers every tracking path depends on) and `rts-scoring.ts`
  (return-to-sender risk, i.e. money).
      -> REQ: — · deps: [] · **Done 2026-08-23:** `src/lib/store-ads.test.ts`
      pins dashboard-over-secret precedence, blank-field fallthrough, all four
      pixel aliases, degrade-to-env on a failed store read, and empty-string
      (never `undefined`) output; `src/lib/rts-scoring.test.ts` pins the
      short-number and unconfigured-provider guards before any provider call,
      and proves a failed background refresh is handed to `waitUntil` and can
      never reject into the request. Fixing the bare `'./env'` specifier in
      `store-ads.ts` was the precondition — it was why the module could not be
      loaded by the test runner at all. Suite 511 -> 522.

**Withdrawn per ADR-020 (fleet-automation engine — YAGNI at current scale):**
~~A-152~~ immutable release-identity check · ~~A-154~~ single-install update
engine · ~~A-155~~ private target registry + fleet planner · ~~A-156~~ per-install
CI/D1 gate engine · ~~A-157~~ canary-first rollout state · ~~A-158~~ redacted
fleet reports. Reinstate only if the number of installs makes manual copy
genuinely unmanageable.

## A23 — Stable Meta first-party customer matching

- [x] **A-161** — Carry one privacy-safe external ID through the native Meta funnel. **Done locally 2026-08-25.**
  -> Primary requirements: REQ-6, REQ-8, REQ-9 · Dependencies: T12, T13 · Done when: a configured Pixel mints one cryptographically random 128-bit first-party visitor ID; PageView, ViewContent, AddToCart, InitiateCheckout, and Purchase reuse it; Pixel and CAPI send only its SHA-256 hash to Meta; `_fbp`/`_fbc` remain raw; normalized phone remains an upgrade fallback; the deliberately email-free native checkout is unchanged; malformed cookies fail closed; focused/full tests, check, build, and local browser proof pass; and no live token, provider mutation, deployment, commit, or push occurs.
  -> Evidence: focused Meta contract tests 27/27; full suite 563/563; `npm run check` 390 files with zero diagnostics; Cloudflare build complete; local Chromium observed one stable 32-hex cookie across navigation, a 64-hex Pixel `external_id`, and identical Pixel/CAPI PageView event IDs.

## A24 — KV quota outage and payment regeneration

- [x] **A-162** — Take admin sessions and rate-limit counters off the account-shared KV write allowance. **Done 2026-08-27 (ADR-021, migration `0049`).**
  -> Done when: a fleet-wide `KV put() limit exceeded` no longer fails login or kecamatan search; sessions revoke on rotation/logout from D1; the pair brake is exact; every remaining KV write is best-effort and labelled. Evidence: BUILD-LOG entry 84.
- [x] **A-163** — A failed or expired AutoLaris instruction is regenerable, not a dead order. **Done 2026-08-27.**
  -> Done when: `create_payment` failure leaves the order `pending` with a `failed` transaction; `expired` is derived from `expires_at`; `/api/order-status` regenerates on `retry_payment` under a 5/10 min limit; `/payment` offers the retry and stops polling a dead instruction. Evidence: `autolaris-payment.test.ts` (+3), local `wrangler dev` limits observed.
- [x] **A-164** — Stop sending the retired webhook as `callbackUrl`. **Done 2026-08-27 (ADR-022, migration `0050`).**
  -> The URL stays; the endpoint now records every callback in `autolaris_callbacks` and answers 200, moving no payment state. Evidence: BUILD-LOG entry 85.
- [x] **A-165** — `/payment` survives losing `sessionStorage`. **Done 2026-08-27.**
  -> Fragment locator `/payment#o=…&t=…` from checkout and from the page's own copy-link button; never a query string. Evidence: BUILD-LOG entry 85.
- [x] **A-166** — A Purchase for an order paid after the buyer left `/thanks`. **Done 2026-08-27.**
  -> `enqueuePurchaseForPaidOrder` after manual confirmation; deduplicated by the outbox's `event_id`. Evidence: `paid-order-purchase.test.ts`.
- [x] **A-167** — Retire the half-wired `DANA` channel code paths. **Done 2026-08-27.**
  -> Removed from `AUTOLARIS_CHANNELS`, `form-hybrid.ts`, and `payment.astro`.
- [x] **A-168** — Review pass on 1.3.2–1.3.3 (`/code-review high 75f606d...main`). **Done 2026-08-27, BUILD-LOG entry 86.**
  -> Six confirmed findings fixed: `/payment` rendered a stale `failed` over a regenerated VA on pre-1.3.2 orders; `expired` reached only buyer readers (now an hourly sweeper plus the admin detail); the upload quota counted rejected files; an unguarded purge could skip the whole cron hour; dead-instruction orders were invisible in the admin list; the retry gate had no route test. Also from the review's candidates: the gate now refuses cancelled/refunded orders, limits are CGNAT-tolerant with a per-order ceiling, a retry sends a fresh `reff_id`, and a store error during a peek no longer reads as a spent slot.
- [x] **A-169** — Decide the lifecycle of an online order whose instruction was never paid. **Closed 2026-08-27 by ADR-023.**
  -> The harm this tracked was stock held hostage by an order nobody would pay. Stock is no longer reserved by anything, so an unpaid instruction now costs only list clutter, and the admin list flags it as *Instruksi gagal/kedaluwarsa*. An auto-cancel policy would be a merchant decision with no engineering pressure behind it; reopen only if one is wanted.
- [x] **A-170** — A provider failure before the instruction row exists leaves no retry handle. **Done 2026-08-27 (1.4.0).**
  -> `recordFailedPaymentAttempt` writes the `failed` row from the committed order when `createAutoLarisPaymentForOrder` throws before its INSERT, so `/payment` can offer the retry. Evidence: BUILD-LOG entry 88.

## A25 — The blank admin order list

- [x] **A-171** — `/admin/orders` returned an empty 200 on every install. **Done 2026-08-27 (1.3.5).**
  -> Cause: `InstructionHint` (entry 86) read a field the server-rendered producer never supplied. Done when: the predicate lives in `src/lib/` with a test for the missing-field case, `OrderItem` marks it optional, the page query supplies it, and every admin route was opened against a seeded store and returned a non-empty body. Evidence: BUILD-LOG entry 87.
- [x] **A-172** — Give the React islands a rendering check the runner can see.
  **Done 2026-09-16** — `src/lib/admin-islands-render.test.ts` bundles each of
  `OrdersTable`, `OrderDetail`, `PaymentReconciliationQueue`, `ProductForm`,
  and `LandingPageEditor` with esbuild (JSX transform, `@/*` alias resolved,
  `react`/`react-dom` externalized, CJS output so Node's own `require`
  resolves them — an ESM bundle left a bare `require("react")` inside a
  transitive dependency that threw at import time) and renders each with
  `react-dom/server`'s `renderToString`, asserting non-empty, structurally
  meaningful output. `node --experimental-strip-types` strips TS syntax but
  cannot parse JSX, which is why the bundle step exists rather than importing
  the `.tsx` files directly. 6 tests (`OrdersTable` covered both empty and a
  populated `initialOrders` row, in the camelCase `OrderItem` shape `mapOrder`
  actually produces). 731 tests passing, `astro check`/`tsc` clean.
  -> `npm test` globs `src/lib/*.test.ts`, so no island is ever executed; a component that throws during SSR returns a blank 200 that `check`, `test` and `build` all call healthy. Done when either the admin islands are smoke-rendered in CI (react-dom/server over a compiled entry) or a route-level check asserts a non-empty body for every admin page against a seeded database.

## A26 — Stock stops gating a sale

- [x] **A-173** — A variant must be purchasable whatever its stock figure says. **Done 2026-08-27 (ADR-023, 1.4.0).**
  -> Done when: no checkout, CS conversion, storefront publication, admin picker or product save consults stock; releasing an order returns nothing; the suite asserts the inverse of every rule that was removed; and a store whose only variant carries `stock = 0` renders and offers it in a browser. Evidence: BUILD-LOG entry 88.

## A27 — Bounded landing-page content and images

- [x] **A-174** — Extend `landing_sections` for typed CMS content without
  changing any existing `html` or `form` row.
      -> Primary requirement: REQ-173 · Constraints: REQ-178 · Dependencies:
      None · Done when: a new forward migration applies on an empty local D1
      and on a fixture containing existing HTML/form rows, and focused tests
      prove the five typed section kinds round-trip in their declared order.
- [x] **A-175** — Validate typed landing-section configuration at the shared
  create/update boundary.
      -> Primary requirement: REQ-174 · Constraints: REQ-173, REQ-178 ·
      Dependencies: A-174 · Done when: focused tests prove missing required
      text, malformed list items, unsupported image configuration, and raw
      markup in a plain-text field are refused without replacing stored
      sections; valid typed input persists unchanged.
- [x] **A-176** — Replace the common-content HTML authoring path with bounded
  headline, paragraph, numbered-list, and bullet-list controls.
      -> Primary requirement: REQ-174 · Constraints: REQ-173, REQ-178 ·
      Dependencies: A-175 · Done when: a browser session creates, edits,
      reorders, previews, saves, and reloads every text/list section at 390 px
      and desktop width without losing draft values or introducing horizontal
      overflow.
- [ ] **A-177** — Add the browser-side landing-image conversion and WebP-only
  R2 acceptance boundary.
      -> Primary requirement: REQ-175 · Constraints: REQ-176, REQ-178 ·
      Dependencies: A-175 · Done when: focused tests cover the size and WebP
      signature gates; a browser uploads a supported source image and stores
      one `/assets/uploads/...webp` object; an oversized, unsupported, malformed,
      or encode-failed source leaves no object behind.
- [x] **A-178** — Render typed landing sections through semantic public markup
  with fluid, uncropped images.
      -> Primary requirement: REQ-177 · Constraints: REQ-173, REQ-178 ·
      Dependencies: A-175, A-177 · Done when: route tests prove semantic
      heading, paragraph, `ol`, `ul`, and image output without `set:html` for
      typed sections; Chromium at 390 px and desktop proves portrait and
      landscape WebP images retain aspect ratio, no page overflow, lazy
      below-fold loading, and a working checkout form.
- [ ] **A-179** — Prove legacy landing-page compatibility through the new
  section schema and renderer.
      -> Primary requirement: REQ-178 · Constraints: REQ-173–REQ-177 ·
      Dependencies: A-174, A-178 · Done when: focused migration/route tests
      prove a legacy HTML shortcode and form remain byte-for-byte behaviorally
      equivalent, and browser smoke proves preview, inactive-page access
      control, product-page claim, and canonical redirect remain intact.

- [x] **A-180** — Make canvas section insertion work from a Tailscale HTTP
  development origin. **Done locally 2026-08-28.**
      -> Primary requirement: REQ-174 · Constraints: REQ-173, REQ-178 ·
      Dependencies: A-176 · Evidence: an isolated Worker fixture served at
      `http://100.127.67.86:8791` reported `typeof crypto.randomUUID ===
      "undefined"`; clicking Headline still added the selected canvas card,
      produced no browser error, and left mobile overflow at 0 px. The fallback
      is transient only; D1 continues to assign persisted section IDs.

- [x] **A-181** — Make a long canvas navigable without a drag-only editor.
  **Done locally 2026-08-28.**
      -> Primary requirement: REQ-174 · Constraints: REQ-178, REQ-179 ·
      Evidence: the 480px canvas exposes a numbered navigator; choosing a
      number selects and smooth-scrolls its card, while direct card clicks and
      up/down controls remain touch/keyboard alternatives.

## A28 — Ad signal review, 2026-08-28

- [x] **A-182** — Google Ads offline conversions must not stop uploading once
  fifty unattributable orders accumulate. **Done 2026-08-28.**
      -> Primary requirement: REQ-58 (catalog/signal integrity) · Constraints:
      TRACKING_SPECS §10 · Dependencies: None · Done when: the discovery query
      and `buildGoogleClickConversion` share one definition of an eligible
      order, and a focused D1 test proves that sixty organic delivered COD
      orders ahead of one Google-clicked order still queue that order.
      Evidence: `reconcileGoogleAdsConversions` had no database test at all;
      the new one failed before the fix (0 queued after repeated passes) and
      passes after (`INV-10062` / `cod_delivered`, idempotent on re-run).

- [x] **A-183** — One legacy product row must not take both catalog feeds down.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Constraints: ADR-017 identity rule ·
      Dependencies: None · Done when: a catalog containing an unpublishable
      short id emits every other product and omits that one, on both feeds,
      and the same row reports no catalog identity on its product page instead
      of a 500. Evidence: `catalog-identity.test.ts` — "one unpublishable row
      is skipped, not allowed to take the whole feed down".

- [x] **A-184** — A typed landing section must never fall through to the
  checkout form. **Done 2026-08-28.**
      -> Primary requirement: REQ-177 · Constraints: REQ-178 · Dependencies:
      A-178 · Done when: `[slug].astro` renders a form only for `type ===
      'form'`. The final `return` was a safe else while the type was
      `'html' | 'form'`; with seven kinds, any typed section whose stored
      config failed to parse would have injected a second checkout form.

- [x] **A-185** — Refused landing-page input must answer 400, not 500.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-174 · Constraints: REQ-178 · Dependencies:
      A-175 · Done when: `LandingPageValidationError` carries its own status
      and both admin routes map it — 400 for malformed input, 409 for a slug
      already in use — so an empty title or a `<` in a headline no longer
      tells the operator the server broke.

- [x] **A-186** — Remove the duplicated ViewContent tracker. **Done 2026-08-28.**
      -> Primary requirement: REQ-174 (maintainability) · Dependencies: None ·
      Done when: `MetaViewContentTracker.astro` is deleted and
      `/produk/[slug]` renders `MetaLandingTracker`. The two files were
      identical apart from a `checkoutSelector` prop that was declared, passed
      into `define:vars`, never read, and never supplied by the one caller —
      two copies of an 85-line inline script that had to be edited in step.

## A29 — Ad signal audit, second pass, 2026-08-28

- [x] **A-187** — A headless storefront's Purchase must actually reach Meta.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Constraints: TRACKING_SPECS §12,
      STOREFRONT_INTEGRATION §4.8 · Dependencies: None · Done when:
      `/api/v1/tracking/events` resolves a Purchase against D1 and sets
      `customData.orderNumber`, and a focused test proves that a Purchase
      without it never opens a connection to Meta at all. Evidence:
      `meta-purchase-order.test.ts` — the refused call records
      `fetched === false`, so no retry could ever have recovered those events.

- [x] **A-188** — A campaign-tagged link must not erase the ad click that was
  paid for. **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Constraints: TRACKING_SPECS §7 ·
      Dependencies: None · Done when: `mergeClickIds` keeps a stored
      `gclid`/`gbraid`/`wbraid`/`fbclid` through a UTM-only landing, a genuine
      new ad click still replaces attribution wholesale, and no stale tag from
      an older click survives. Evidence: `click-ids.test.ts` — "a
      campaign-tagged link never erases the ad click that was paid for".

- [x] **A-189** — The headline size control must change the headline size.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-174 · Constraints: REQ-178, DESIGN-SYSTEM
      type ramp · Dependencies: A-176 · Done when: Kecil/Sedang/Besar render
      18/20/24 px in a browser. Evidence: headless Chrome at 390 px reported
      all three at `20px` before the fix — `.lp-section h2` (0-1-1) beat
      `.lp-headline-large` (0-1-0) — and `18px / 20px / 24px` after.

- [x] **A-190** — A list must survive the operator's closing Enter.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-174 · Constraints: REQ-178 · Dependencies:
      A-176 · Done when: trailing and blank lines are dropped at save rather
      than refused by the server. Filtering while the operator types would make
      Enter impossible to press, so it happens once, in the save payload; the
      server boundary stays strict for direct API callers.

- [x] **A-191** — Refused landing input must read as Indonesian.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-174 · Dependencies: A-185 · Done when: every
      `LandingPageValidationError` message is Indonesian, because the editor
      toasts it verbatim to an operator working in an Indonesian admin.

- [x] **A-192** — Collapse the two catalog feed generators into one.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Dependencies: A-183 · Done when: Google
      and Meta declare only their three real differences — channel title,
      `fb_product_category`, GTIN-substitute identity — and the emitted XML is
      byte-identical to before. Evidence: a fixture covering sale pricing, an
      absent taxonomy, an absolute image URL, XML-escaped text and an
      unpublishable row diffed clean on both feeds; `catalog-feed.ts` 222 → 228
      lines with ~55 duplicated lines removed.

- [x] **A-193** — Browser evidence for the typed landing sections.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-177 · Constraints: REQ-178 · Dependencies:
      A-178, A-184 · Evidence: a seeded page carrying all five typed kinds plus
      legacy `html` and `form`, served by `astro dev` against local D1, in
      headless Chrome at 390 px / DPR 2.625 — semantic `h2`/`p`/`ol`/`ul`,
      shortcodes parsed with no `{{...}}` left, exactly one checkout form with
      18 fields, `scrollWidth === clientWidth` and zero overflowing elements.
      Two deliberately unusable typed rows rendered **three** checkout forms
      without the A-184 guard and one with it. Fixture rows were removed from
      the local D1 afterwards.

## A30 — Admin editor driven in a browser, 2026-08-28

- [x] **A-194** — Prove the landing editor through a real operator session, not
  by reasoning. **Done 2026-08-28.**
      -> Primary requirement: REQ-174 · Constraints: REQ-178 · Dependencies:
      A-176, A-185, A-190, A-191 · Evidence: headless Chrome against
      `astro dev` and local D1, signed in as a throwaway `auditbot` owner
      created for the run and deleted after it (the operator's own account was
      never touched). Login → `/admin/landing-pages/new` → title, slug and the
      D1 product picker → insert Headline and Daftar angka → numbered
      navigator re-selects card 1 → save → redirect to `.../edit`. Zero console
      errors throughout.

- [x] **A-195** — A-190 proven by A/B, not argued.
  **Done 2026-08-28.**
      -> Evidence: the operator's literal input `"Buka kemasan\nLarutkan ke
      air\n"` — a closing Enter. **Without** the save-time filter: toast
      "Daftar harus berisi minimal satu item teks tanpa tanda < atau >.",
      HTTP 400, stuck on `/admin/landing-pages/new`. **With** it: no error
      toast, redirect to `.../edit`, and D1 holds
      `{"items":["Buka kemasan","Larutkan ke air"]}`.

- [x] **A-196** — A-185 and A-191 proven in the browser.
  **Done 2026-08-28.**
      -> Evidence: a headline of `<script>alert(1)</script>` produced HTTP
      **400** (not 500), the toast read "Teks section harus diisi tanpa tanda <
      atau >." in Indonesian, and the operator stayed on the editor with the
      draft intact. Correcting the field then saved and redirected.

- [x] **A-197** — The 390 px claim in A-176 measured rather than asserted.
  **Done 2026-08-28.**
      -> Evidence: at 390 px / DPR 2.625, the login page, the empty editor, and
      an editor carrying **all seven** section kinds each reported
      `scrollWidth === clientWidth` and `horizontalScrollPossible === false`.
      Draft values survived every insertion and the navigator listed 1–7. The
      one element extending past 390 px is Sonner's `ol.toaster`, confirmed
      `position: fixed`, so it adds no scrollable width.

## A31 — Upstreamed from the zvarashop install, 2026-08-28

Reported by another session working in the install repo. Each claim was
re-verified against this repository's code before anything was changed.

- [x] **A-198** — The browser Purchase must match on eight keys, not one.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Constraints: TRACKING_SPECS §4a ·
      Dependencies: None · Done when: `MetaPixelBase` owns the only
      `fbq('init')` and exposes `__PS_META_INIT__`; `/thanks` declares
      `__PS_META_AWAIT_MATCHING__` in the head slot rendered ahead of it; no
      other file calls `fbq('init')`. Evidence: probed against the live
      `fbevents.js` — a second init left
      `fbq.instance.pixelsByID[id].userData` at **1 key** (`external_id`); the
      single init leaves it at **8**. Guarded at runtime by
      `meta-purchase-dedup.test.ts` and at source by `meta-identity.test.ts`.

- [x] **A-199** — `client_user_agent` removed from Pixel advanced matching.
  **Done 2026-08-28.**
      -> It is a Conversions API field; Meta's Pixel reference does not list it
      and the browser attaches its own user agent anyway.

- [x] **A-200** — A conversion must not wait on the pixel's deferral timer.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Dependencies: A-198 · Done when
      `__PS_LOAD_META_PIXEL__` mirrors the `__PS_LOAD_GOOGLE_TAG__` hatch the
      Google leg already had, and the Purchase calls it. The stub queues the
      event but transmits nothing until the library lands, and a buyer who
      reads `/thanks` and closes it trips neither the interaction listeners nor
      the 2.5 s timer.

- [x] **A-201** — A manufactured provider email must never be hashed into `em`.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Constraints: TRACKING_SPECS §7 ·
      Dependencies: None · Done when `matchableCustomerEmail` guards all three
      CAPI legs. Confirmed in this repo that `submit-order.ts:269` persists
      `<phone>@<host>` into `orders.customer_email` for every non-COD order, so
      the column is not only a `buyerEmail()` product. The guard requires the
      store's own host as well as an all-digits local part: numeric Gmail
      addresses are ordinary in Indonesia and must not be discarded.

- [x] **A-202** — A deploy must refuse the product's placeholder target.
  **Done 2026-08-28.**
      -> Resolved by reading the repository's own contract rather than by
      opinion. The scripts stay: `npm run deploy` is the **install's**
      documented deploy path (README §Deploy, INSTALLATION §163, RELEASE §8),
      and AGENTS.md's "this repository deploys nothing" means no CI deploy and
      no Cloudflare credentials here — not no script. RELEASE §7 already
      *requires* the check (`--dry-run`, stop on `adsbookcms-your-store` or an
      all-zero database id) and then admits "nothing verifies that an install
      ran it". Done when: `predeploy` and `precf:deploy` run
      `preflight:deploy`, which refuses a placeholder Worker name, D1 name or
      id, or R2 bucket name. Evidence: `deploy-preflight.test.ts` — a real
      install passes, this repository's own `wrangler.jsonc` is refused (which
      §1 says is correct), each placeholder is caught alone, and the JSONC
      comments and trailing commas the file actually uses parse.

## A32 — Product audit: public surface and the signal chain, 2026-08-28

- [x] **A-203** — Rate-limit the public Meta event endpoint. **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Constraints: TRACKING_SPECS §12 ·
      Dependencies: None · Done when `/api/meta-event` counts 60/minute per IP
      and fails open. It was the only public POST in the repository with no
      limit; each accepted event writes an unpruned outbox row and calls
      graph.facebook.com, and `event_id` deduplication stops a replay but never
      a flood. Evidence: `meta-purchase-order.test.ts`.

- [x] **A-204** — One minting shape for the provider's placeholder email.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Dependencies: A-201 · Done when
      `submit-order.ts` calls `buyerEmail` instead of hand-rolling the same
      string against `new URL(request.url).hostname`, and
      `matchableCustomerEmail` accepts every host the store answers on.
      A-201's guard checked one host and the fabricated address reached the
      CAPI payload anyway. Evidence: a live `/thanks` run enqueued
      `email: '6281234567890@localhost'` before the fix and no `email` at all
      after; `autolaris-payment.test.ts` covers the multi-host case.

- [x] **A-205** — Watch the whole signal chain fire on a real page.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Dependencies: A-188, A-198, A-200 ·
      Evidence: headless Chrome at 390 px against `astro dev`, a configured
      pixel and local D1. An ad landing stored `{gclid, utm_source, utm_campaign}`;
      a following `?utm_source=whatsapp` visit left the `gclid` intact and
      replaced only the tags. The landing page sent Pixel `PageView` and
      `ViewContent` and the matching CAPI pair. On `/thanks` the Pixel
      `Purchase` carried `eid=INV-19001` — byte-identical to the CAPI leg's
      `event_id` — `value=135000` (the goods, not the 214000 invoice), and
      **eight** `ud[...]` keys. `__PS_META_INIT__` returned `false` to a second
      caller. Zero console errors throughout.

## A33 — Validation audit, 2026-08-28

- [x] **A-206** — Bound every landing-page field an operator can submit.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-174 · Constraints: REQ-178 · Dependencies:
      A-185 · Done when `title`, `meta_title`, `meta_description`, the section
      count, one HTML section, typed text, list items and the form mode all
      carry a bound, and focused tests prove each refusal writes nothing. The
      public checkout schema bounds every field it takes; this path bounded
      none, and two of them ship inside `<title>` and `<meta name="description">`
      on every render of a page ads point at.

- [x] **A-207** — A landing page must point at a product this store carries.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-174 · Dependencies: A-206 · Done when
      `createLandingPage` and a submitted `product_id` on update resolve the
      product in D1. An unknown id saved, listed in the admin, and answered
      `404` to every visitor who clicked the ad. The native-landing register
      has always refused this; the CMS path had not. Evidence: this file's own
      fixtures created pages against product `10001`, which the fixture never
      inserted — the tests described broken pages as normal until now.

- [x] **A-208** — The throwing catalogue id must not escape its own row.
  **Done 2026-08-28.**
      -> Primary requirement: REQ-58 · Dependencies: A-183 · Done when every
      strict `catalogProductId` call sits where a throw cannot escape, proven
      by an allowlist scan. `getStorefrontProduct` ran it inside a `.find`
      predicate over every product, so **one** legacy row returned 500 for the
      product page, the landing page, every form page, `/api/form-config` and
      `/api/v1/products/<slug>` — the whole storefront, not the bad row. Also
      fixed: `/api/v1/products` (whole list failed), `ProductForm.tsx` (a throw
      in render blanks the form, leaving the operator unable to repair the very
      product that needs it), and the three checkout form routes.

- [x] **A-209** — A masked secret must not disclose a meaningful fraction of
  itself. **Done 2026-08-28.**
      -> Primary requirement: AGENTS.md §3 (never echo a stored credential) ·
      Done when values below 24 characters are shown as mask alone. The
      five-to-eight branch returned `ab••••de`, four of five characters for a
      short secret. The credentials in play are long provider tokens so this
      was never exploited, but nothing guarantees a length and a setup
      placeholder is exactly the short value it handled worst. `env.ts` had no
      test file at all; it has one now, covering masking and the env
      resolution order.

## A34 — Closing the landing-builder queue honestly, 2026-08-28

- **A-174, A-175, A-176, A-178 closed.** Migration `0051` applies from zero and
  over a fixture holding existing HTML/form rows; the shared create/update
  boundary refuses missing text, malformed list items, unsupported image
  configuration, raw markup in a plain-text field, and now every field bound
  and an unknown product (A-206, A-207); a browser session created, edited,
  reordered, previewed, saved and reloaded text and list sections at 390 px and
  desktop with no lost draft and no overflow (A-193, A-194, A-197); and the
  route emits semantic `h2`/`p`/`ol`/`ul` and `img` with no `set:html` for
  typed sections, proven in Chromium at 390 px with zero horizontal overflow
  and a working checkout form.

- [ ] **A-177** — Landing-image upload remains unproven end to end.
      -> The size and WebP-signature gates are covered by focused tests and the
      editor path is wired, but no browser has stored an object: `ASSET_BUCKET`
      is an R2 binding the local run does not provide. This closes on the first
      install, not here.

- [ ] **A-179** — Legacy landing-page compatibility is proven for the renderer,
  not for the admin.
      -> A legacy `html` section with shortcodes and a `form` section both
      render byte-for-byte as before (browser-verified alongside the five typed
      kinds), and preview, inactive-page access control, the product-page claim
      and the canonical redirect are covered by focused tests. What is missing
      is a browser pass over those four admin behaviours; they were exercised
      as route tests only.

---

# Forward backlog — QA, security, Cloudflare, Meta Ads, Google Ads

> Written 2026-08-28 @ `0042e75`. Every item below was grounded against the
> tree, not proposed from a checklist: each names what is true today and what
> would have to become true. Items marked **needs an ADR** record a decision
> that does not exist yet — write the ADR when the task is picked up, not now,
> because an ADR for an undecided question is a guess with a number on it.

## What is already true, so nobody re-does it

**Ad signal.** Both catalog feeds publish the Product ID the Pixel sends, byte
for byte, and one unpublishable row no longer takes a feed or the storefront
down. The browser Purchase matches on eight keys through the single
`fbq('init')` MetaPixelBase owns, shares its `event_id` with the CAPI leg, and
reports the goods rather than the invoice. The Meta outbox is transactional
with bounded retries and an hourly drain. Google offline conversions discover
only click-attributed orders. A campaign tag no longer erases a paid click. A
minted provider email never reaches Meta's `em`. `/api/meta-event` is rate
limited. All of this is browser-verified end to end (BUILD-LOG 89–93).

**Security.** Admin routes are gated centrally — 401 without a session, 403
through a default-deny role policy, an origin check on unsafe methods. Sessions
and rate limits are D1-backed. `X-Content-Type-Options`, `X-Frame-Options`,
HSTS, `Referrer-Policy` and `Permissions-Policy` ship on every response.
Provider credentials are D1-first, masked on read, never echoed. `npm audit`
reports zero vulnerabilities. Checkout re-quotes shipping server-side, prices
come from D1, and `submit_token` is uniquely indexed against replay.

**QA.** 618 checks across 102 test files, `astro check` clean over 400 files, a
Cloudflare build, and CI running all three on every push.

## QA — the verification that does not exist yet

- [ ] **A-210** — Give the repository a runnable browser suite.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when: the
      browser evidence this project keeps producing by hand — a landing page at
      390 px, an operator session through the admin editor, the storefront
      signal chain — runs from one command and fails CI when it breaks.
      Today every such run has been ad-hoc: driven from a scratch CDP script,
      reported in BUILD-LOG, and then thrown away. That is why A-179's admin
      half and A-172's island check are still open, and why the headline-size
      defect (A-189) survived every static check. **Needs an ADR**: whether the
      runner belongs in CI at all, given CI has no browser today and adding one
      changes what a green build means.

- [x] **A-211** — Cover the twelve modules no test imports. **Done
      2026-09-16** — ten of the twelve got a real importing test:
      `catalog-core.test.ts` (including the A-208 short-numeric-id-sorts-first
      regression shape), `geo.test.ts` (the full `cf.regionCode` →
      `cf-region-code` header → `x-user-province` header precedence chain),
      `public-store.test.ts`, `tenant-content.test.ts`,
      `tenant-contract.test.ts`, `gtm.test.ts` (the exact push path the
      thanks-page Purchase event goes through), `api.test.ts`,
      `order-status-core.test.ts`, `cn.test.ts`, `ui-variants.test.ts`. Two
      are recorded here as deliberately untestable: `utils.ts` is a pure
      re-export of `cn.ts` (`export { cn } from './cn.ts'`) — `cn.test.ts`
      already covers the real logic, a duplicate test would assert nothing
      new; `bundled-migrations.ts` uses `import.meta.glob`, a Vite build-time
      API with no meaning under this repo's plain Node test runner
      (`node --experimental-strip-types --test`) — its own top-of-file
      comment already documents this, and the Node tests that exercise
      migrations use their own focused chains instead. 731 tests passing,
      `astro check`/`tsc` clean.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when:
      `catalog.ts`, `geo.ts`, `public-store.ts`, `tenant-content.ts`,
      `tenant-contract.ts`, `gtm.ts`, `api.ts`, `order-status.ts`,
      `bundled-migrations.ts`, `utils.ts`, `cn.ts` and `ui-variants.ts` each
      have an importing test, or are recorded here as deliberately untestable
      with the reason. This exact question — which modules does no test
      *import*, not which files lack a same-named test — is what surfaced the
      `getStorefrontProduct` defect (A-208) and the province gating gap
      (BUILD-LOG 95). The list is the remainder of that sweep.

- [ ] **A-212** — Prove a fresh install from zero, in a browser.
      -> Primary requirement: REQ-179 · Dependencies: A-210 · Done when: an
      empty D1 runs `0000`–`0051`, the install wizard completes, an operator
      logs in, creates a product, publishes a landing page, and a buyer
      completes a COD order — all in one recorded run. Migrations are asserted
      to apply from zero; nothing asserts the store is *usable* afterwards.

- [x] **A-213** — Decide what the admin's React islands are allowed to break. **Done 2026-09-16 with A-172:** `admin-islands-render.test.ts` server-renders all five named islands; `esbuild` is now a declared devDependency rather than a transitive one.
      -> Supersedes the framing of A-172 · Dependencies: A-210 · Done when: the
      islands that carry money or state — `OrdersTable`, `OrderDetail`,
      `PaymentReconciliationQueue`, `ProductForm`, `LandingPageEditor` — each
      have a rendering check the runner can see. A throw inside a React render
      blanks the surface silently; that has now happened twice
      (`ProductCatalog`, then `ProductForm` in A-208).

## Security — what the current posture does not cover

- [ ] **A-214** — Ship a real Content-Security-Policy for the storefront.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when: public
      responses carry a CSP that constrains script, style, connect and frame
      sources, and the embed's `frame-ancestors` keeps working. Today CSP is
      set **only** on the embed, to carry `frame-ancestors`; every other
      response has none, so `X-Frame-Options` is the whole story. The obstacle
      is real and must be solved rather than waved at: this storefront runs
      many `is:inline` scripts by design (`define:vars` forces it), so a
      meaningful policy needs nonces or hashes threaded through Astro's inline
      output, and a wrong one silently breaks tracking. **Needs an ADR**: the
      nonce-vs-hash choice and what `connect-src` admits — Meta, Google, and
      the store's own origin at minimum.

- [x] **A-215** — Put a ceiling on the CAPI outbox. **Already done** (`6eb9842`,
      confirmed 2026-09-16) — `purgeExpiredCapiOutboxEvents` deletes
      `sent`/`failed` rows older than `OUTBOX_RETENTION_DAYS` (30), wired
      hourly in `worker.ts`'s `runScheduledMaintenance`, and covered by
      `capi-outbox.test.ts`. The stale "the outbox is never pruned" comment
      in `readCapiDeliveryWindow` (which predates the fix) has been
      corrected; the `(status, updated_at)` index upgrade path still stands
      as a follow-up, not a blocker.
      -> Primary requirement: REQ-58 · Dependencies: None · Done when:
      delivered rows are pruned on a retention window the way
      `autolaris_callbacks` already is, and the table cannot grow without
      bound.

- [x] **A-216** — Give the install token a brute-force ceiling. **Done
      2026-09-16** — `/api/install` now keys a `checkRateLimit` bucket on
      client IP (`install-token:<ip>`, 10 attempts / 15 min, same window as
      admin login). **Revised 2026-09-25 (A-271):** this first version peeked
      and spent only on a wrong token, which a parallel burst walked straight
      past; every attempt now spends up front. 684 tests
      passing, `astro check`/`tsc` clean, `docs/ROUTE-MAP.md` regenerated to
      show the new `rate-limit` dependency and `rate_limits` table on this
      route.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when:
      `/api/install` counts failed token attempts per IP the way every other
      public POST does. The token must be at least 16 characters, which makes
      guessing impractical rather than impossible, and this is the only public
      POST left with no counter after A-203.

- [ ] **A-217** — Decide the credential rotation story.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when: an
      operator can rotate a Meta CAPI token, a Mengantar key or an AutoLaris
      key and know that in-flight work survives it. Today a token is replaced
      in place; a Meta outbox row queued under the old one fails with code
      `190`, which `decideRetry` treats as terminal and drops. **Needs an ADR.**

## Cloudflare — what the platform offers that this install does not use

- [ ] **A-218** — Give the ad-signal outboxes a Queue, or record why not.
      -> Primary requirement: REQ-58 · Dependencies: None · Done when: either
      Cloudflare Queues carries CAPI and Google Ads delivery with its own
      retry and dead-letter semantics, or an ADR records that the D1 outbox
      plus the hourly cron is the deliberate choice. The current design is
      documented as a consequence of the Astro adapter owning the Worker
      entrypoint (TRACKING_SPECS §11); Queues did not exist in that reasoning.
      Weigh it honestly — a queue binding is another resource every install must
      provision, which ADR-012 says costs more than it looks. **Needs an ADR.**

- [ ] **A-219** — Read the storefront's own performance from Cloudflare rather
  than from a laptop.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when:
      `observability` (already enabled, with `head_sampling_rate`) is paired
      with an Analytics Engine dataset or Logpush so p75 TTFB, D1 query time
      and outbox drain outcomes are readable per install. Every performance
      number in this repository was measured locally; none came from a live
      store.

- [ ] **A-220** — Evaluate Smart Placement for the D1-bound routes.
      -> Primary requirement: REQ-179 · Dependencies: A-219 · Done when: a
      measurement decides it. Checkout, `/api/shipping-rates` and the admin all
      make several sequential D1 round trips; Smart Placement moves the Worker
      toward the data. It can also make a mostly-static storefront slower, so
      this closes on numbers from A-219, not on the feature existing.

- [ ] **A-221** — Serve storefront images through Cloudflare Images or a
  Worker-side transform.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when: a
      product image is resized and re-encoded at the edge rather than in the
      operator's browser. `client-image.ts` compresses on upload — forward-only,
      no backfill — so every object stored before that rule, and every size
      other than the two it emits, is served as-is from R2. The adapter runs
      `imageService: 'passthrough'` today, which is what makes this visible.

- [ ] **A-222** — Set explicit Worker limits and a tail consumer.
      -> Primary requirement: REQ-179 · Dependencies: None · Done when:
      `wrangler.jsonc` declares a CPU limit and errors reach somewhere an
      operator looks. `runScheduledMaintenance` now does migrations, four
      purges, two outbox drains, a reconcile and a health evaluation in one
      invocation; nothing bounds it, and a failure is a `console.error` nobody
      is subscribed to.

## Meta Ads — beyond "the events arrive"

- [ ] **A-223** — Surface Event Match Quality where the operator configures the
  pixel.
      -> Primary requirement: REQ-58 · Dependencies: None · Done when:
      `/admin/ads/meta` shows the dataset's match quality and recent event
      volume, read from Meta rather than asserted by this repository. A-198
      raised browser matching from one key to eight, and the only way anyone
      can see the difference today is by opening Events Manager. A store that
      never opens it cannot tell a working pixel from a silent one.

- [ ] **A-224** — Verify deduplication from Meta's side, not ours.
      -> Primary requirement: REQ-58 · Dependencies: A-223 · Done when: a
      Purchase is confirmed deduplicated in Events Manager for a real order.
      Both legs are proven to send the same `event_id` — asserted in tests and
      observed on the wire — but no one has confirmed Meta *counted* it once.
      That is the claim the whole design rests on and the only one still taken
      on trust.

- [ ] **A-225** — Validate the catalog feed against Meta's own diagnostics.
      -> Primary requirement: REQ-58 · Dependencies: None · Done when
      `/feed/meta-catalog.xml` is ingested by a real Commerce catalog and its
      diagnostics are clean, or each warning is recorded here with a decision.
      The feed is asserted against the Pixel's `content_ids` and against its own
      shape; it has never been read by Meta.

- [ ] **A-226** — Decide what happens to a Purchase when a store has no CAPI
  token.
      -> Primary requirement: REQ-58 · Dependencies: None · Done when the
      behaviour is deliberate. `/api/meta-event` answers `202 skipped` when the
      token is unset, so the browser leg fires alone and the server leg is lost
      with no record — invisible to the operator who has not finished setup.

## Google Ads — the leg with the least instrumentation

- [x] **A-227** — Give the Google Ads offline outbox a health signal and an
  alert. **Alert half completed 2026-09-25:** `google-ads-outbox` is now an
  `OperationalAlertId` fed by `alertsFromOperationalHealth`
  (`operational-alerts.test.ts`); until then only the health half existed.
  **Health half done 2026-09-09** (`807a104`) — `readGoogleAdsOutboxDepth` and
  `classifyGoogleAdsOutbox` mirror the Meta pair, including the
  stalled-with-terminal-failures reason; an unreadable table reports
  `unknown`, never a depth of zero. 674 tests passing.
      -> Primary requirement: REQ-58 · Constraints: OBSERVABILITY.md ·
      Dependencies: None · Done when `google_ads_conversion_outbox` reports
      depth, overdue rows and last delivery the way `capi_event_outbox` does,
      and a stalled queue fires. `HealthSignalId` is `capi-outbox | meta-capi |
      mengantar | autolaris` and `OperationalAlertId` is `schema | capi-outbox`
      — Google previously had neither, which is exactly why A-182's
      head-of-line block was invisible: the cron logged
      `queuedGoogleAdsConversions: 0`, which is also what a quiet week looks
      like.

- [ ] **A-228** — Prove one offline conversion lands in Google Ads.
      -> Primary requirement: REQ-58 · Dependencies: A-227 · Done when a real
      `uploadClickConversions` call is accepted and the conversion appears in
      the account. The transport is contract-matched and unit-tested against
      `v25`; A-182's fix is proven against a D1 fixture. No call has ever been
      made to Google.

- [ ] **A-229** — Close the Consent Mode gap or state it as policy.
      -> Primary requirement: REQ-58 · Dependencies: None · Done when either a
      CMP calls `gtag('consent', 'update', …)`, or the region list stops
      claiming to serve EEA/UK traffic. `GoogleAdsBase.astro` defaults those 32
      regions to `denied` with `wait_for_update: 500`, and nothing in this
      repository ever sends the update — so an EEA visitor stays denied for the
      whole session and is measured not at all. Deliberate for an Indonesian
      store; a blocker the moment one advertises into those regions.
      **Needs an ADR.**

- [ ] **A-230** — Reconcile the two Google conversion actions in the account.
      -> Primary requirement: REQ-58 · Dependencies: A-228 · Done when the
      browser action and the offline action are confirmed as Secondary and
      Primary respectively in a live account, per TRACKING_SPECS §10. The
      repository documents the recommended policy; `transaction_id` does not
      make two Primary actions safe, and nothing here can see which they are.

- [ ] **A-231** — Submit the feed to Merchant Center and read its diagnostics.
      -> Primary requirement: REQ-58 · Dependencies: None · Done when
      `/feed/google-catalog.xml` is fetched on schedule and every item is
      either approved or its disapproval recorded with a decision. The
      taxonomy engine picks `google_product_category` from the product's own
      text and omits it when unsure; whether Google accepts those choices has
      never been observed.

---

## Audit — 2026-09-25 (full-system read)

Evidence for every done item: `BUILD-LOG.md` entry of the same date; gates 741
tests, `astro check` 0/0/0, build complete; browser checks in `STATUS.md`.

### Done

- [x] **A-270** — HTML landing sections are owner/admin only (stored XSS →
  owner takeover by `advertiser`). `changesHtmlSections`, both landing-page
  routes; `landing-pages.test.ts`.
- [x] **A-271** — Login and install-token limits spend atomically up front
  (`spendAdminLoginAttempt`; `/api/install` consumes before comparing).
  `rate-limit.test.ts` wave test.
- [x] **A-272** — Home-content links refuse script schemes
  (`storefront-content.ts`). Provider strings escaped in `/admin/check`.
- [x] **A-273** — CAPI outbox keyed on `(event_name, event_id)` (`0057`);
  immediate delivery claims the row; `event_time` stamped at enqueue and kept
  on retry. `capi-outbox.test.ts`, `paid-order-purchase.test.ts`.
- [x] **A-274** — An embed's `_fbp`/`_fbc` no longer erases a stored `gclid`
  (`mergeClickIds`). `click-ids.test.ts`.
- [x] **A-275** — Google outbox alert (A-227), 401/403 stops the batch with rows
  pending, every cron step isolated, pending alert state not re-written to KV,
  webhook bounded to 5 s. `operational-alerts.test.ts`,
  `google-ads-offline.test.ts`.
- [x] **A-276** — A void COD order is never dispatched (policy + both dispatch
  SQL guards); manual transfer can be marked paid; paid or dispatched orders
  cannot be deleted; `results[1]` batch index. `payment-dispatch-policy`,
  `order-lifecycle`, `mengantar-dispatch` tests.
- [x] **A-277** — Provider COD fee no longer added to shipping in headless
  checkout, CS conversion, admin courier edit, or `/api/v1/geo/shipping-rates`
  `total_shipping`. `headless-checkout.test.ts`.
- [x] **A-278** — Headless QRIS/VA creates the AutoLaris payment and returns
  it; manual transfer no longer requires an AutoLaris key on either checkout.
  Route-level only: **no test**, `tsc` clean.
- [x] **A-279** — CS conversion obeys COD-province policy; admin shipping-status
  write is bound to the validated status (409 on a race); `ICO` fallback is COD
  only. Route/branch changes: **no dedicated test**.
- [x] **A-280** — Storefront: public listings read-only and product-active
  filtered, claimed pages linked by product URL, reserved landing slugs,
  product change releases a claim, noindex pages out of `sitemap.xml`, one
  Product JSON-LD, every middle form on a page wired, storage-throwing
  browsers keep their forms and Purchase, non-WebP canvas output refused, no
  inherited `Zanoby`/`asahan-portable`/real-looking phone copy, no blanket
  "COD Available" claim.
- [x] **A-281** — Multi-tenant remnants removed: `X-Tenant-Slug`,
  `PUBLIC_TENANT_SLUG`, `tenantSlug`; A6 closed on ADR-020.

### Open — found by the audit, not fixed here

- [ ] **A-282** — Browser ViewContent may be dropped on product and landing
  pages: `MetaPixelBase` creates the `fbq` stub only after an awaited SHA-256,
  while `MetaLandingTracker` calls `window.fbq` synchronously. Moving the stub
  earlier would queue `track` before `init`. Done when a browser trace shows
  the pixel request for ViewContent and the single-init invariant still holds
  (TRACKING_SPECS §4a).
- [x] **A-283** — **Done 2026-09-25:** only failures inside a 24 h window (`recentFailed`) degrade either queue; older ones read `earlier-failures`, visible but not alerting. `operational-health.test.ts`. The outbox alerts stay `terminal-failures` for the whole
  30-day retention after one failed row, so a later outage with the same reason
  is deduplicated and never notified. Done when the degraded reason is based on
  failures inside a recent window and a test shows a second outage notifies.
- [x] **A-284** — **Done 2026-09-25:** `partialFailureError` is read by its `ConversionUploadError` code (checked against the v25 proto): already-recorded is `sent`, `TOO_RECENT_*` retries in 6 h, anything else is terminal; settled/failed rows now purge after 30 days. Requeue path for Google is still not built. `google-ads-offline.test.ts`. Google `partialFailureError` (HTTP 200) is retried as
  transient; a duplicate-order error after a lost response ends `failed` though
  Google accepted it. Done when partial-failure codes are classified (duplicate
  = sent, others terminal) with a test. Also: Google has no requeue path and no
  retention purge for `failed` rows.
- [ ] **A-285** — AutoLaris money edges (need provider evidence): the
  **Live read 2026-10-29** (owner's AutoLaris account, read-only,
  `05-autolaris.json`): `GET /api/h2h/list_payment` → `rc "00"`, 8 channels
  (COD, QRIS 0.7%, VA BNI/Permata/Mandiri/BRI 3,000, VA BCA 6,500, OVO 3%).
  `POST /api/h2h/advice` for an unknown `transaction_id` → HTTP 200
  `{"rc":"02","ket":"NOT FOUND","data":[]}`. `rc "02"` is also PENDING, and
  `inquirePayment` maps every `"02"` to pending, so a transaction AutoLaris
  does not know stays pending forever. Fix needs `autolaris-*.ts` (protected):
  treat `rc 02` + `ket "NOT FOUND"` + empty `data` as its own state.
  fee-bearer amount is stored but `grand_total` is always the order total; a
  payment retry clears the old `provider_transaction_id` so a late payment to
  the old VA is never matched, and two concurrent retries both create provider
  orders; a Mengantar `createShipment` timeout after acceptance clears the claim
  and a second push can duplicate the shipment.
- [~] **A-286** — Smaller UI gaps. **Partly done 2026-09-25:** catalogue and
  landing picker load the newest 200 (API ceiling) with a notice at the
  ceiling (`lazy:` in `ProductCatalog.tsx`); checkout label ids are unique per
  form. Still open: the requeue probe's real `PageView`, and
  `shippingQuote` answering GET while declared POST. Original list: admin product list and landing-page product
  picker cap at 50 with no paging; two middle forms on one page share element
  ids (labels bind to the first); `/api/admin/ads` requeue probe sends a real
  `PageView` with no test event code; `HEADLESS_OPERATIONS.shippingQuote`
  declares POST while the route also serves GET.
- [ ] **A-287** — Documents the audit read but did not re-verify:
  `DESIGN-SYSTEM.md` §1.1 hex usage counts and §5 (describes two templates,
  `contentWidth`, a template-aware `Breadcrumb`; the tree has one template and a
  fixed 480 px column); `docs/UPDATE-PATH-OWNERSHIP.md` omits `scripts/**`,
  `.gitattributes` and seven product docs; `RELEASE.md` §7 (merge) and
  `PLAN.md` §4 (copy) describe the two install shapes without cross-reference;
  `scripts/check-docs.ts` checks neither `#anchors` nor paths written as inline
  code. Done when each is re-extracted from the tree and re-stamped.

## One-click install — 2026-09-25 (ADR-026)

- [x] **A-288** — Deploy to Cloudflare button in README and INSTALLATION §0;
  `wrangler.jsonc` deployable as a template (real default names, zero ids, no
  `routes`, `workers_dev: true`); `package.json` binding descriptions;
  `.dev.vars.example` with an empty `INSTALL_TOKEN`. Verified: build and
  `wrangler deploy --dry-run` resolve every binding.
- [x] **A-289** — `INSTALL_TOKEN` the only required secret; `AUTH_SECRET`
  generated into `install_secrets` (`0058`) when unset. `auth-secret.test.ts`
  (env wins, one key under concurrency, fail closed); a fresh local D1 with
  only `INSTALL_TOKEN` went `/` → `/install` → login → dashboard.
- [x] **A-290** — Deploy preflight refuses zero or missing D1/KV ids instead of
  names, and stands its git checks down under Workers Builds.
  `deploy-preflight.test.ts`.
- [x] **A-291** — Dashboard **Siapkan toko** checklist, derived from D1
  (`setup-checklist.test.ts`); installer prefills the site address from the
  URL it is opened on; `*.workers.dev` answers `X-Robots-Tag: noindex`.
  Rendered at 390 px, no overflow, no console error.
- [ ] **A-292** — Press the button once against a real Cloudflare account and
  record it. Done when a store deployed by the button reaches `/install`, and
  the two unobserved behaviours in ADR-026 are recorded: that the provisioned
  ids land in the copy before the deploy command runs, and which of
  `.dev.vars.example` / the tracked `.env.example` the setup page reads (if the
  latter, it will ask for every key listed there — trim or rename that file).
  **Needs the owner:** a real account and a production deploy.

## Local development — 2026-09-25

- [x] **A-293** — `npm run dev:local`: build, local stand-ins for Mengantar and
  AutoLaris (`scripts/dev-providers.ts`, contract-tested against the real
  clients in `dev-providers.test.ts`), `wrangler dev --local` with its own
  state, a fixed install token and the scheduled handler exposed. Refuses to
  start on busy ports. Verified in headless Chrome: install → login →
  warehouse → R2 upload → product → middle and full checkout (COD) → QRIS →
  settle → hourly job → paid → dispatch (two accepted with waybills, an unpaid
  one refused, a courier-less one failed with a reason).
- [x] **A-294** — Bugs the local run surfaced: warehouse origin search without
  a Mengantar key pinned an empty Area ID (now explains); the setup checklist
  asked for the warehouse before Mengantar (reordered); a minted buyer email on
  a dotless host was refused by AutoLaris (`.invalid` domain, still recognised
  as synthetic); `/payment` showed a live countdown, copyable total and "Nomor
  Virtual Account" wording beside a failed QRIS instruction, and printed the
  error twice; a store address could not be `http://localhost` (loopback only).

## Admin dropdowns — 2026-09-25

- [x] **A-295** — Every admin dropdown is a shadcn component. The COD
  province policy became one searchable, island-grouped multi-select with chips
  (`Combobox`, ported from the base-nova registry with `input-group` and
  `popover`) instead of 38 always-visible checkbox tiles. The seven remaining
  native `<select>`s in React islands (`AccessManager`, `ProductCatalog`,
  `ContentWorkbench`) became `Select` with `items` so the trigger shows labels.
  Static Astro pages use `NativeSelect.astro`, shadcn's native-select pattern,
  rather than hydrating a page for a dropdown; `/install` keeps its own styled
  select. The template-definition form stopped offering "Wide", a layout the
  server schema refuses. Verified in headless Chrome at 1280 and 390 px: no
  native select left on six admin pages, no console error, no horizontal
  overflow; typing "papua" filters to its group and toggles a chip.
  **Note:** `shadcn add` tries to `npm install cn` (a registry alias, not a
  real package) and would overwrite the customised `button`/`input`/`textarea`;
  components are ported by hand from `shadcn view` until that is fixed.
- [x] **A-296** — SPX (Shopee Express) as a courier. The earlier "not
  buildable" verdict came from the local `mengantar-documentation`, which is
  stale: the live `/order/estimate?courier=all` returns `spx` with price,
  ETA and COD coverage (probed 2026-09-25), and Mengantar confirmed create-order
  support directly. SPX joins `DEFAULT_COURIER_RULES`; migration `0059` adds an
  enabled, COD-on SPX rule to every store that already has a courier policy;
  `unsupportedOriginSpx` hides the quote like `unsupported`; the admin shows
  "SPX Express". The single-courier estimate (`courier=<name>`) still answers
  `Invalid courier` for every SPX spelling tried, so a create-order with `spx`
  is confirmed by Mengantar, not yet observed here — watch the first SPX
  dispatch.
- [x] **A-297** — Pos Indonesia COD refusal (403 `new_seller`/`insufficient`/
  `blocked`, delivered rate < 82%, documented by Mengantar) is recognised at
  dispatch: the order keeps a reason with the delivered rate, and the Pos COD
  rule is switched off so checkout stops offering it. Tests cover the refusal
  and an unrelated 403; mutation-checked. Not observed against a real blocked
  account.
- [x] **A-298** — `npm run dev:seed`: dummy products and orders for a running
  `dev:local`, placed only through the store's own HTTP surface (install,
  `/hello`, admin APIs, public checkout), so a run is also a smoke test.
  Refuses a non-local host; nothing in `src/` imports it and no migration
  seeds data. The AutoLaris stand-in lists its transactions
  (`GET /__dev/autolaris/payments`) and quotes `lion`, `pos` and `spx` with
  their live keys.
- [x] **A-299** — Form audit on the seeded store (headless Chrome, 390 and
  1280 px, 57 pages, then each checkout and admin form driven by hand).
  Fixed: the checkout button unlocked at 8 typed characters of phone, 3 of
  address and 3 of name while the endpoints demand a valid mobile number,
  10 and 2 — buyers were invited to submit and then refused; one
  `missingCheckoutContact` in `validation.ts` now drives both forms, and the
  middle-form endpoint uses the canonical `isValidWa62` instead of its own
  regex (it refused valid 9–10-digit numbers). `/payment` claimed the admin
  checks AutoLaris and the CMS updates every minute (the page polls every
  minute; the status arrives by webhook or the hourly job); the checkout
  claimed stock is re-validated (ADR-023). Accessible names added to the
  COD-province chip remove buttons, the access-page password toggle, the
  landing publish switch, four search boxes and unlinked labels in the access
  and landing forms. Verified working as designed: honeypot off-screen and
  aria-hidden, checkout dedupe window, 10/min checkout limit, wrong-password
  401, product validation shown to the operator, temporary-password change
  ending the session, customer-service role limits (pages redirect, APIs 403).
- [x] **A-300** — `SocialProofToast` rotated twenty invented buyers ("Ibu
  Ratna, Bekasi — baru saja memesan") under a verified badge on product and
  landing pages: a fabricated purchase claim. Decided with the owner: one real
  store-wide aggregate, product-free because a store runs many landing pages —
  "N orang memesan dalam 24 jam terakhir", counted at render by
  `src/lib/social-proof.ts` (void, cancelled and returned excluded), shown
  once per page view and not at all below 3 orders or on a failed query. No
  names, cities or badge; the rotation helpers and their tests are gone.
- [x] **A-301** — Dead code removed: `autolaris-balance.ts` (its loader lost
  its last caller when the manual reconciliation queue replaced it; its one
  test covered only that summary), four unused helpers in `validation.ts`,
  three unused UI variants, and the empty `testimonialEntries` /
  `footerProducts` with their type. Found by a repository-wide scan for
  exports nothing imports, then confirmed by grep; `tsc --noUnusedLocals
  --noUnusedParameters` reports nothing. The ~200 exports used only inside
  their own file were left as they are. `dev:seed --images=<dir>` adds real
  photos from a folder outside the repository, plus six more products.
- [x] **A-302** — Every admin dropdown is shadcn. The three hand-built
  kecamatan lists (rate checker, warehouse origin, abandoned-lead recovery)
  became one `DistrictCombobox` on the shadcn Combobox; the caller supplies
  the search, since the screens resolve different area identities. The
  warehouse page stays static Astro with one island that hands its pick back
  as a `warehouse-origin` event. Inside a modal dialog the popup is portaled
  into the dialog: portaled to `<body>` it inherited the dialog's
  `pointer-events: none` and ignored every tap (keyboard still worked).
  `/install` keeps its own `<select>`: it loads no admin CSS.
- [x] **A-303** — `/admin/check` rebuilt as the `RateCheckTools` island
  (Card, Input, Button, Select, Table, Badge, sonner). Removed: a permanent
  "Mengantar API Connected" badge that checked nothing, a "Reguler" filter
  that matched service text the provider never sends (it showed an empty
  table), a hard-coded "Gudang Utama AdsBookCMS" note (now the store's own
  warehouse name), emoji icons and the tab switcher. ETAs read "1–3 hari"
  whatever unit the provider sends (it rendered "1 - 3 days hari"). Filter,
  sort and WhatsApp text are `src/lib/rate-check.ts`, tested; the island is
  in the SSR render test. The receiver-history stand-in now answers per
  phone in every risk band, so the check works under `dev:local`.
- [x] **A-304** — UI clean-up across admin: navigation, page titles and tab
  labels in Indonesian (they mixed "Commerce", "Growth", "Order Management",
  "Tutorial Step-by-Step"); page-header eyebrows removed (English jargon
  such as "Google Ads Signal OS" on every page); emoji removed from the ads
  pages and the access page; `alert()` on the Meta test event replaced by an
  inline status; a static green "CMS Core" dot that measured nothing
  replaced by the version alone. InputGroup controls no longer get the admin
  input frame, height and focus outline a second time (the combobox drew two
  borders on a phone); the group carries the focus ring instead. In the
  abandoned-lead dialog the variant select showed an id ("13"), couriers
  read "JNE · JNE", and ETAs had no unit. `components.json` pointed at a
  `global.css` that no longer exists; it now names `admin.css`, where the
  tokens are. Measured at 390 px: every input on 30 pages and their popups
  is 16 px, so iOS does not zoom; no change was needed there.
- [x] **A-306** — Admin desktop precision. Measured every admin page at 1280,
  1440 and 1920px: at 1920 five page-level `max-w-*` wrappers gave five
  different content edges (and payments sat left of the rest). Page width is
  now AdminShell's `max-w-[1560px]` alone; all 25 pages share one edge at all
  three widths, guarded by `admin-page-width.test.ts`. The orders and shipping
  filter rows scrolled 34px sideways at 1280 (`flex-nowrap`); they wrap now.
  One thin radius (`0.375rem`) for the whole admin, popups included (they
  read `:root`, so they were rounder than their triggers), cards on
  `rounded-xl`; trigger, popup and item measured 6 / 6 / 4.8px. Remaining
  English titles and labels ("Order management", "Return to Sender",
  "Snapshot performa toko", "Shipping Rates API") moved to Indonesian.
- [x] **A-307** — Admin control contract. Controls were sized per call — five
  heights (28–44px), radii from 4 to 17px, filter rows with fixed
  `w-[140px]` columns that overlapped, five searches built as an icon over an
  input. Now the shadcn primitives own it (40px everywhere on desktop), filter
  rows are `FilterBar`/`FilterField`, search is `SearchInput`, and 60+ per-call
  overrides and 28 `size="xl"` buttons were removed. `admin-controls.test.ts`
  refuses a regression; writing it found that the first sweep had missed every
  control whose `className` followed an arrow-function prop (the scanner
  stopped at the `>` of `=>`), so the guard now reads tags brace-aware and was
  mutation-checked. The admin CSS lacked shadcn's base `border-color` rule, so
  every bare `border` drew black (currentColor); it is restored once. Courier
  list became one compact table with locally drawn initials (the logos loaded
  from a third-party avatar service); payment methods became rows in one card;
  `/admin/settings` rewritten, its AutoLaris line had claimed confirmation was
  manual although the hourly job settles it; an auto-settled payment read
  "Operator tidak tersedia" and now reads "Otomatis · Status dari AutoLaris";
  top-bar titles now match page titles. Checked after: 108 of 114 page/width
  combinations clean (the six are correct 404/400s), one content edge on all
  25 admin pages at three widths, inputs 16px on 30 pages at 390px, no control
  overlaps, Meta Ads saved and reloaded, one pixel init at runtime, both feeds
  valid with 10 items.
  Follow-up the same day: filter selects rendered the raw value "all" until
  hydration (no `items` map) and looked unlike the date filter, so toolbars
  use `FilterSelect` (icon, value, chevron, `items` always set); every select
  trigger carried a hidden "▼" text node from Base UI's default icon children,
  copied with the page text; the kecamatan combobox's hidden input held the
  option as JSON. The courier list became two columns with the couriers' own
  marks, and the rate checker two side-by-side panels with `kg`/`Rp` addons.
  Then: couriers are one-line cards in a 3/2/1-column grid; shadcn `Card`
  gets the 1px frame the hand-built panels had (it drew none, so panels
  floated on the page background); the mobile gutter is 16px instead of 8px.
  Then: toolbar filters became DropdownMenu radio groups sharing one trigger
  class with the date filter (orders, shipping, access role, product category,
  lead follow-up), so every filter is the same control; form fields keep
  `Select` with `items`. `/admin/settings` rebuilt on Card + item rows (icon,
  name with status badge, one-line purpose, technical detail, action).
- [x] **A-308** — One vocabulary for shipping status and courier names.
  `processing` read "Diproses", "Siap push Mengantar" and "Antrean Mengantar"
  on three screens — the middle one wrong, since dispatch sets `processing`
  only after Mengantar accepts the shipment; `src/lib/shipping-status.ts` now
  labels it "Diproses Mengantar" everywhere. Couriers printed
  `${code} · ${service}` and Mengantar repeats the code as the service
  ("JNE · JNE", "lion · lion"); `src/lib/courier-names.ts` names each courier
  once from any spelling of its code (tested). The order-detail status select
  showed the raw value before hydration (no `items`). The edit-buyer dialog is
  two columns (form | total and save), address two rows, the four read-only
  location inputs one line, kecamatan search the shared `DistrictCombobox`,
  couriers two columns. Order detail dropped its all-caps section titles,
  field labels and badges; payments and settings are two-column on wide
  screens, the fee policy no longer nests a framed box in a card.
- [x] **A-309** — Button tiers and the last imprecise blocks.
  32 static `.btn-*` call sites carried their own `min-h-11 px-6 text-xs`, so
  Astro pages showed 44/36/32px buttons beside the 40px `Button`; the classes
  now own geometry (h-10) and a guard refuses call-site overrides.
  `buttonVariants()` returns a merged string — unmerged, `border-transparent`
  beat the outline border on every Astro page using it. Header actions (order
  detail edit/delete, landing save/preview, access refresh) moved to the
  default size. Landing product picker: five rows then scroll, one-line
  titles, price on the second line, `items` map for the server label. Meta
  test event: input and button one 40px row, hint and result below.
  Reconciliation: "Cek AutoLaris" and "Verifikasi" one row, one size.
- [x] **A-310** — Admin type anatomy and phone layout. Measured: twelve
  font sizes (9–30px) and weights to 900 on desktop, ~250 labels at 10px on a
  phone, and every `font-medium` primitive rendering at 400 because the 500
  face was never loaded. Now five sizes (12/14/16/20/24), weights 400/500/600,
  a 12px floor, Inter 500 loaded for admin only; a guard enforces it. Phone:
  filters two-up, KPI tiles two-up without their sentence, settings rows
  icon-beside-text, landing source filter a `FilterSelect`, the duplicate
  "Tambah produk" removed, `StoreMark` initial instead of an illegible
  wordmark. Desktop: filter labels no longer truncate (`sm` field 176px), the
  orders table pins its row actions at 1440.
- [x] **A-311** — Checkout routing and tracking, form to thanks, re-verified
  end to end in headless Chrome with the Meta and Google tags stubbed locally.
  `/form-full`, `/form-hybrid`, `/form-middle` answer 308 to their canonical
  routes keeping `fbclid`/`gclid`/UTM; each form fires PageView, ViewContent,
  AddToCart and InitiateCheckout on Pixel, CAPI and GTM; `/thanks` fires one
  Purchase keyed on the `INV-` number on the Pixel, CAPI and Google Ads
  (`transaction_id`) and none on reload; QRIS fires nothing on `/payment` until
  the hourly Advice job marks it paid, then the same Purchase. Click ids are on
  every order. Found and fixed: a hashing failure (no Web Crypto) silently
  killed AddToCart/InitiateCheckout on all three legs, and the thanks page
  sent Google blank hashed keys. Not verified: CAPI delivery to Meta (no token
  used locally, by design) and a real Google Ads account.
- [x] **A-312** — Responsive sweep and rate-checker trim. Eight admin pages
  at twelve viewports (320, 360, 390, 414, 768, 820, 1024, 1280, 1440, 1920,
  2560 and 844×390): no horizontal overflow; nav transforms at 768/1024px.
  Dashboard header links (hand-built, `min-h-11 rounded-xl text-xs`) wrapped
  at 768px; they and three siblings now use `buttonVariants`/`.btn-*`, and a
  guard refuses the pattern. The rate checker's optional COD value field and
  its always-empty "Biaya COD" column were removed; its toolbar wraps inside
  the card instead of spilling past it.
- [x] **A-305** — The four destructive actions (order delete, bulk order
  delete, revoke access, revoke API key) confirm through `useConfirm`, a
  shadcn Dialog returning a promise, instead of `window.confirm`; each names
  its consequence and its action ("Hapus pesanan", "Cabut akses"). A guard in
  `admin-controls.test.ts` refuses `window.confirm` in admin.
- [x] **A-313** — Seller bank form stacked top to bottom (bank, holder,
  number, then the action) instead of four squeezed columns; the bank select
  shows each bank's logo in the list and the trigger, opens below it, and
  carries an `items` map. COD fee copy reads one figure, "3,33% dari harga +
  ongkir, sudah termasuk PPN", on the payment settings and at checkout —
  `COD_EFFECTIVE_RATE_LABEL`, derived from the two rates. The charge itself
  is unchanged: 3% and 11% VAT, each rounded up, never more than Rp2 above a
  flat 3,33% (tested).

## Fleet, landing and signal pass — 2026-09-29/30

- [x] **A-314** — Operational alerts name their store and render in Slack,
  Google Chat and Discord webhooks (`text`/`content`); OBSERVABILITY §5
  documents the body actually sent.
- [x] **A-315** — Native landing slugs and an install's other route files
  (`installRouteSlugs`) are reserved from CMS slugs; a runtime test requires the
  Pixel bootstrap hooks `__PS_META_INIT__` and `__PS_LOAD_META_PIXEL__`.
- [x] **A-316** — The hourly cron re-syncs the native register (sitemap, product
  page) and the re-sync writes only a real change, so `lastmod` stops moving.
- [x] **A-317** — The AutoLaris Advice run checks every pending instruction and
  those expired within 24 h, newest first, instead of the 25 oldest forever.
- [x] **A-318** — Product-page redirects keep the query string, then became a
  `301` with `Cache-Control: max-age=300` (`productPageRedirect`).
- [x] **A-319** — CMS landing images after the first are deferred at render,
  except script-bearing `onerror`/`onload` images.
- [x] **A-320** — Optional WhatsApp hand-off from `/thanks` for COD orders
  after the Purchase is sent (`0060`, Settings → Store; off by default); the
  message carries invoice, name, product and variant; CAPI leg uses keepalive.
- [x] **A-321** — Pages render the order form only through
  `GeoIpResolvedForm`; a landing served as a product page forwards the
  visitor's Cloudflare location through the rewrite.
- [x] **A-322** — Ninja courier removed (`0061`); a fresh install enables JNE and
  J&T only.
- [x] **A-323** — Fleet rollout: taniniaga, zvarashop (rejoined the product
  line, ADR-024 ledger repair rehearsed on a production copy) and carukesi at
  product `dd83acd`.
- [ ] **A-324** — Identify the test that fails intermittently across full runs.
- [ ] **A-325** — Browser evidence for the `/thanks` WhatsApp hand-off and the
  `_fbc` cookie after a product-page redirect, once a working headless browser
  is available.

- [x] **A-326** — The deploy preflight refuses when production lists native
  landing pages that the tree's register does not. **Done 2026-10-16
  (1.5.10).** `findUnregisteredNativeLandings` in `deploy-preflight.ts`
  (tested) compares the production `landing_pages` rows that have
  `source = 'native'` against `activeNativeLandingPages()`. The hourly
  reconcile would otherwise delete those rows and their product-page claims.
  `ALLOW_NATIVE_LANDING_REMOVAL=1` allows an intended removal. Verified
  read-only on production: taniniaga passed (14 registered), and zvarashop
  refused with 55 slugs.
- [x] **A-327** — permatamall and zanobyshop deployed from GitHub Actions with a
  bare `wrangler deploy`, which skips `preflight:deploy` and all four of its
  refusals. **2026-10-19: both workflows moved** onto `npm run deploy`
  (permatamall `46aaaab`, zanobyshop `9d944fd`), plus a strict step that fails
  the run when the preflight cannot read production D1. zanobyshop deploys
  through it, preflight complete (ledger 62). permatamall's token could not
  read D1, so every run failed; **2026-10-24** its `deploy.yml` was removed
  (permatamall `5499583`) and it deploys by hand with `npm run deploy` like
  every other install (STATUS 2026-10-24). **Closed:** nothing remains in this
  repository, which deploys nothing (ADR-012).
- [x] **A-328** — Script-carrier images in merchant html (`<img src="x"
  onerror>`) no longer request `/x` on every view; the placeholder becomes
  `data:,`. **Done 2026-10-19 (1.5.11).**
- [x] **A-329** — Optional Kelola CRM push: every new order to Kelola's order
  webhook (checkout `waitUntil`, hourly retry for 24 h, resend from the order
  detail), abandoned orders still abandoned after 30 min to its lead webhook,
  and the source landing path on every order. Migrations `0062`-`0065`.
  **Done 2026-10-19 (1.5.12).**

## Releases 1.6.0–1.7.13

Shipped without task ids; one line per release, from the commit subjects
(`0e080be..3e73f04`) and BUILD-LOG entries 181–183. Fleet state per release
is owned by `STATUS.md`.

- [x] **1.6.0** — First-party plugins installed per store; Kelola CRM becomes
  the first (`5b9cb1b`).
- [x] **1.6.1** — Kelola failure count turns red; Plugin stays lit on plugin
  settings (`0e1c87d`).
- [x] **1.6.2** — Receiver score retries a stored refusal at any age; the
  refusal names its key (`ff9cc5f`).
- [x] **1.6.3** — CRM templates name variant, quantity and unit price; real
  strike price only; scheduler heartbeat (`29c884f`).
- [x] **1.6.4** — `/thanks` hands a middle-form COD order to WhatsApp; clearer
  buyer-number note (`8a6baf3`).
- [x] **1.6.5** — HTTP to HTTPS in the Worker; `PUBLIC_ALIAS_HOSTS` sends older
  domains to the canonical one (`13157d5`).
- [x] **1.7.0** — Two-minute edge cache for anonymous storefront HTML; Inter
  preloaded (`a1ae4fd`).
- [x] **1.7.1** — Inter latin faces use `font-display: optional` (`905b9a9`).
- [x] **1.7.2** — Inter declared only as optional faces, so no swap face can
  reflow text (`4ae3ebf`).
- [x] **1.7.3** — Uploaded images kept a day in the Workers cache, answered
  before D1 and R2 (`01dc44d`).
- [x] **1.7.4** — Product and landing pages cached per province in the Workers
  Cache API (`eac81ac`).
- [x] **1.7.5** — Optional store brand mark in the header (`a14b08a`).
- [x] **1.7.6** — No dangling separator in the home h1 and brand title
  (`4837478`).
- [x] **1.7.7** — Optional store-wide noindex via `PUBLIC_SITE_NOINDEX`
  (`f42b627`).
- [x] **1.7.8** — Never host-redirect a bare IP address (`9df9fb4`).
- [x] **1.7.9** — COD city fallback on a failed estimate; clearer transfer
  options (`b3ff8cd`).
- [x] **1.7.10** — Gates report install drift and owe a courier in setup
  (`86a0fb5`).
- [x] **1.7.11** — Storefront runs beside D1 and reads the catalogue once per
  request (`ca7331d`).
- [x] **1.7.12** — Canonical-elsewhere landing slugs kept out of the sitemap;
  the store named once in titles (`69999a2`, BUILD-LOG 181).
- [x] **1.7.13** — "Transfer Diterima" confirms a manual transfer and sends its
  Meta Purchase (`8849a28`, BUILD-LOG 183).
- [ ] **A-421** — A void order never sends a Purchase. **Built 2026-10-29
  (uncommitted, a35). Exception, approved by Paduka 2026-10-29** (protected:
  `paid-order-purchase.ts`, `order-lifecycle.ts`,
  `src/pages/api/admin/orders/[id].ts`). 1.7.13 let a manual-transfer order
  whose shipping was cancelled or returned be marked paid and enqueue a Meta
  Purchase. `isVoidOrder()` in `order-lifecycle.ts` (the admin guard's own
  expression) now gates `enqueuePurchaseForPaidOrder`, read after the edit is
  saved; "Transfer Diterima" hides for a void order. Marking it paid stays
  allowed, since the money arrived and must be refunded. Test:
  `paid-order-purchase.test.ts` "a paid but void order never enqueues a
  Purchase" (its mock returns only the columns the query names, so dropping
  one from the SELECT fails it; mutation-checked). Open: browser evidence;
  release entry.

## Protected surfaces for A35–A43 — read before any of those tasks

Ad tracking, the three order forms, and the order flow and its processing are
working and are **not** in scope for A35–A43. Every task below is held to this
list; a task that cannot be done inside it stops and asks first. The only
planned edits to it are the tasks marked **Exception** (A42, A43), each
approved by Paduka on its own, and each held to the same gate.

**Untouched — no edit, no reformat, no import change:**

- Tracking: `src/components/storefront/tracking/*`, `meta-*.ts`,
  `capi-outbox.ts`, `google-ads-offline.ts`, `paid-order-purchase.ts`,
  `click-ids.ts`, `traffic-source.ts`, `meta-purchase-order.ts`.
- Forms: `src/scripts/form-hybrid.ts`, `form-middle.ts`,
  `src/components/storefront/forms/*`, `form-config.ts`, `form-mode.ts`,
  `geo.ts`, `checkout-navigation.ts`.
- Order flow and processing: `src/pages/api/submit-order.ts`,
  `submit-middle-order.ts`, `src/pages/api/v1/checkout.ts`, `persistOrder` and
  every order statement in `order-persistence.ts`, `order-lifecycle.ts`,
  `order-status*.ts`, `order-schema.ts`, `mengantar-*.ts`, `autolaris-*.ts`,
  the location and shipping-quote modules, `src/pages/api/admin/orders/*`.

**Allowed, and only this much:**

| Task | File | The whole change |
| --- | --- | --- |
| A-334 | `src/pages/thanks.astro` | The support number becomes a list and the module script picks one. `MetaThanksTracker`, `ps:purchase-done`, the redirect timing and the message stay byte-identical. |
| A-344 | `src/pages/api/record-abandoned-order.ts` and the abandoned-lead upsert in `order-persistence.ts` | One bound `source_page_path` value read from `Referer`. The converted-lead and order statements are not edited. |
| A-346 | `OrdersTable.tsx`, `AbandonedOrders.tsx` and their list APIs | A display chip and a read filter. No status, release or bulk action is edited. |
| A-368 | `src/worker.ts` `scheduled()` | One snapshot write appended after the alert evaluation, inside the existing `housekeeping()` isolation. The CAPI drain, Google reconcile, payment reconciliation, plugins and receiver-score steps are untouched and keep their order. |

**Gate on every task:**

1. `git diff --name-only` lists no untouched file, and an allowed file's diff is
   no larger than its row above.
2. These suites pass unchanged, with no test edited to make them pass: every
   `meta-*`, `capi-outbox`, `google-ads-offline`, `paid-order-purchase`,
   `checkout-*`, `form-*`, `order-*`, `headless-checkout`, `mengantar-*` and
   `thanks-whatsapp` test. Then the full `npm test`, `npm run check` and
   `npm run build`.
3. The A-338 and A-339 findings are reports. A change to a protected file is a
   separate proposal, one finding at a time, made only on Paduka's approval.

## A35 — Rotate the support WhatsApp number on the thank-you page

Proposed 2026-10-29. Scope is `/thanks` only (PRD A35). Order: A-330 → A-332 →
A-333 → A-334 can run before the admin screen; A-335 and A-336 follow A-331.

- [ ] **A-330** — Measure first: time the order-form submit (`/api/submit-*-order`
  and what the buyer waits on after the click) and read the Mengantar kecamatan
  path (`/api/locations`, `/address/search`, the exact-district estimate). Record
  numbers, not impressions; list anything awaited that the buyer does not need.
  -> REQ: REQ-190 · deps: [] · Done when: a written before-figure for submit
  latency (local and one live read-only GET at most) and a list of awaited work,
  with no provider write and no remote D1 command.
- [x] **A-331** — **Done 2026-10-29** (uncommitted in the worktree):
  `0067_whatsapp_numbers.sql`, `src/lib/whatsapp-numbers.ts`, and
  `CMS_VERSION.schemaVersion` 68. The cap and the last-active rule are part of
  the writing SQL statement, so concurrent admins cannot both pass a check.
  `whatsapp-numbers.test.ts` (7 tests, real SQLite with the migration) covers
  the seed, each refusal and the mirror. Not yet run on local D1 under wrangler.
  Migration `0067` creates `whatsapp_numbers` (id, label, phone,
  is_active, created_at; unique on phone) and seeds one row from
  `stores.support_whatsapp` where it is set. Add `src/lib/whatsapp-numbers.ts`
  (list, add, update, remove; normalize to `62…`; reject unusable, duplicate, an
  11th number, and removing or deactivating the last active one; sync the
  `stores.support_whatsapp` mirror to the first active number).
  -> REQ: REQ-184, REQ-185, REQ-189 · deps: [] · Done when: the migration applies
  to an empty local D1 and to one holding a store number (one seeded row), and
  focused tests prove each refusal and that the mirror follows the first active.
- [x] **A-332** — **Done 2026-10-29.** FNV-1a over the order number. Measured
  over INV-10001..INV-11000: 50.1/49.9 for two numbers, 34.1/32.4/33.5 for three,
  25.0 each for four; the test allows three points.
  Add the pure picker `pickThanksWhatsapp(numbers, orderNumber,
  random)` to `thanks-whatsapp.ts`: filter numbers `thanksWhatsappUrl` rejects,
  `fnv1a(orderNumber) mod n`, random only when there is no order number, null for
  an empty list.
  -> REQ: REQ-186, REQ-187 · deps: [] · Done when: tests prove 1 number → always
  it, the same order → the same number, 2 and 3 numbers over 1,000 sequential
  invoices land inside the measured tolerance around 50% and 33.3%, and an
  unusable number is never returned.
- [x] **A-333** — **Done 2026-10-29.** `getThanksWhatsappSettings` returns `{ phones, autoRedirect }` from `activeThanksNumbers` (legacy `support_whatsapp` fallback covered in `whatsapp-numbers.test.ts`).
  `getThanksWhatsappSettings` returns the active, usable numbers
  (falling back to `support_whatsapp` for an empty list) instead of one phone;
  `thanks.astro` is its only caller.
  -> REQ: REQ-185, REQ-189 · deps: [A-331] · Done when: `public-store.test.ts`
  proves the list, the fallback, and a store with no number returning an empty
  list.
- [x] **A-334** — **Done 2026-10-29.** `thanks.astro` diff is 18 lines, all in the number hand-off; `MetaThanksTracker`, `ps:purchase-done`, the timing and the message are untouched (68 thanks, tracking and WhatsApp tests pass). Playwright on a local store with two active numbers: INV-10001/3/5 → 0898…, INV-10002/4/6 → 0812…, each stable across a reload, the invoice in every message, a deactivated third number never picked.
  `/thanks` ships the list and picks per order in the module
  script; the button and the automatic hand-off both use the pick. The inline
  `data-phone` single value is removed.
  -> REQ: REQ-186, REQ-187, REQ-188 · deps: [A-332, A-333] · Done when: browser
  evidence with two numbers shows two different orders landing on different
  numbers, a reload keeping the same one, and the COD hand-off URL carrying the
  picked number; with one number the page is identical to PRD A28. Closes the
  browser-evidence half of A-325.
- [x] **A-335** — **Done 2026-10-29.** `api/admin/whatsapp-numbers.ts`; `ADMIN_API_ROUTES` and `ADMIN_PAGE_ROUTES` entries; `auth.test.ts` proves owner and admin in, advertiser and customer service out.
  `/api/admin/whatsapp-numbers` (GET, POST, PATCH, DELETE),
  for owner and admin only. Owner passes every route; admin is held to explicit
  lists, so add the endpoint to `ADMIN_API_ROUTES` and the page
  `/admin/settings/whatsapp` to `ADMIN_PAGE_ROUTES` in `auth.ts`. Advertiser and
  customer service get neither.
  -> REQ: REQ-184, REQ-185 · deps: [A-331] · Done when: tests prove owner and
  admin reach both, advertiser and customer service get 403 on both, every
  refusal from A-331 reaches the client
  as a stated 4xx, and no response carries anything but label, number, state.
- [x] **A-336** — **Done 2026-10-29.** `WhatsappNumbers.tsx` + `/admin/settings/whatsapp`. One responsive list (rows wrap on a phone) instead of a separate table and cards. Playwright: add, the browser-side phone refusal, the last-active guard (server 409 text), 3 active → "±33,3%", no overflow at 390 and 1280 px. Edit and delete through the UI not yet clicked in the evidence run.
  The page `/admin/settings/whatsapp` ("Nomor WhatsApp CS"), on
  `AdminLayout` + `AdminPageHeader` (back to Pengaturan), one React island
  modelled on `SellerBankAccounts.tsx`:
  - header line: "2 nomor aktif · tiap nomor ±50% order COD" (1 → "semua
    order", 3 → "±33,3%"), and a note that the split is per order, not an
    alternation;
  - list (table at `md`, cards below): label, number shown as `0812-…`,
    active switch, share for active rows, edit and delete with `useConfirm`;
  - add form: label (optional, 60) and number, both validated in the browser
    with the server's messages; the add button disabled at 10 with the reason;
  - the last-active guard shown as the server's 409 text, never as a silent
    no-op; loading skeleton, empty state ("Belum ada nomor — tambahkan nomor
    CS pertama"), and an error state.
  Controls follow DESIGN-SYSTEM §7.1 (shadcn primitives, `FilterBar` rules).
  -> REQ: REQ-184, REQ-185, REQ-186 · deps: [A-335] · Done when: browser
  evidence at 390px and 1280px proves add, edit, deactivate, delete, the share
  text for 1, 2 and 3 numbers, the 10-number limit, the guard message, no
  horizontal overflow and an empty console; `admin-controls.test.ts` and
  `admin-page-width.test.ts` pass.
- [x] **A-399** — **Done 2026-10-29.** Pengaturan child "Nomor WhatsApp", palette keywords, and a card on `/admin/settings`; route map 117 routes.
  Navigation: a "Nomor WhatsApp" child under Pengaturan in
  `admin-navigation.ts` (after "Toko & CS"), command-palette keywords
  (whatsapp, wa, cs, rotator, nomor), shown to owner and admin only, and a card
  on `/admin/settings`. `npm run route-map` after the page exists.
  -> REQ: REQ-184 · deps: [A-336] · Done when: the item opens the page for owner
  and admin, is absent for advertiser and customer service, and the route-map
  drift test passes.
- [x] **A-400** — **Done 2026-10-29.** The store form shows the first active number read-only with a link; the save no longer validates or writes `support_whatsapp` (`tenant.test.ts`).
  Settings → Store: the "WhatsApp customer service" input
  becomes a read-only line showing the first active number with a link
  "Kelola nomor WhatsApp"; the PRD A28 redirect switch stays. The store PUT
  in `api/admin/settings.ts` no longer requires `support_whatsapp` and never
  writes it (only `whatsapp-numbers.ts` does).
  -> REQ: REQ-189 · deps: [A-336] · Done when: a test proves saving the store
  without the field keeps `support_whatsapp` and the list unchanged; browser
  evidence shows the line and the link; saving store settings still works for
  every other field.
- [ ] **A-401** — Release: version and changelog entry per `RELEASE.md`
  (schema 68, migration `0067`), `STATUS.md`, and the A-340 close-out.
  -> REQ: REQ-184 … REQ-189 · deps: [A-334, A-336, A-337, A-399, A-400] · Done
  when: the release notes name the migration and the Settings → Store change.
- [x] **A-337** — **Done 2026-10-29.** The install batch adds the number into an empty list; `install.test.ts` proves the seeded row and the empty list (real SQLite). `dev:seed` installed with it end to end.
  The installer inserts its number as the first
  `whatsapp_numbers` row, and an install given no number leaves the list empty.
  -> REQ: REQ-189 · deps: [A-331] · Done when: an `install.test.ts` case proves
  both, and the admin page opens empty without error.
- [ ] **A-338** — Report on submit speed; change nothing. From A-330, list each
  thing the buyer waits on that it need not (work that could move to
  `waitUntil`, sequential D1 reads that could be one `batch`, a provider call
  on the buyer's path), each with its measured cost, the file it lives in, and
  the risk of changing it. The submit routes and `order-persistence.ts` are
  protected surfaces.
  -> REQ: REQ-190 · deps: [A-330] · Done when: the report is written in this
  task's entry and no file outside `TASKS.md` changed. Any fix becomes its own
  task, approved by Paduka one at a time.
- [ ] **A-339** — Prove the Mengantar kecamatan path; change nothing. Run the
  local district and location tests first; then only read-only provider calls
  (`/address/search` and a rate estimate), after Paduka approves the live call,
  for a sample of kecamatan that share a name across cities and for a plain one.
  -> REQ: REQ-190 · deps: [A-330] · Done when: each sampled kecamatan is recorded
  as resolved to a `destination_area_id` or failing with its reason, the
  exact-district estimate (1.7.9) is exercised, nothing is dispatched or created
  at the provider, and no source file changed. A failure becomes a proposed fix
  (district + city resolution, `buildProviderDestinationSearches`), approved
  separately.
- [ ] **A-340** — Close out: `npm run route-map`, a short mention in
  `ARCHITECTURE.md`, version and changelog per `RELEASE.md`, `STATUS.md`.
  -> REQ: REQ-184 … REQ-189 · deps: [A-334, A-336, A-337, A-399, A-400, A-401] · Done when:
  `npm test` (≥ 833 plus the new checks), `npm run check` and `npm run build`
  pass and the doc headers cite the commit they were checked at. The rotator
  does not wait on A-338 or A-339: those ship on their own, and A-339 waits on
  an approval the rotator does not need.

## A36 — Know where a lead came from

Proposed 2026-10-29. Prerequisite of A37. Migration numbers are provisional
(`0067` is A35's): take the next free one at merge.

- [x] **A-341** — Pure `sourceSlugFromPath(path)` (lower-case, strip query, hash
  and trailing slash, last segment, ≤ 80 chars, `/` → `beranda`, nothing usable →
  null) in `src/lib/source-slug.ts`.
  -> REQ: REQ-191 · deps: [] · Done when: tests cover `/promo-a`, `/produk/x`,
  `/PROMO/`, `/a?utm=1#h`, `/`, an empty string, a 500-character path, and an
  encoded or non-ASCII segment.
  **Done 2026-10-29:** `source-slug.ts`; "sourceSlugFromPath covers every
  A-341 shape" in `source-slug.test.ts`.
- [x] **A-342** — Migration adds `orders.source_slug` as
  `GENERATED ALWAYS AS (…) VIRTUAL` over `source_page_path`, plus
  `INDEX (source_slug, created_at)`, then `PRAGMA optimize` (D1 recommends it
  after creating an index; PRD A40 E7). No backfill and no write path: SQLite
  computes it for every row. Proven in plain SQLite on 2026-10-29 (`/Promo-A/` →
  `promo-a`, `/produk/kopi` → `kopi`, `/` → `beranda`, NULL → NULL, index used
  for `=`); D1 is not yet proven.
  -> REQ: REQ-191, REQ-193 · deps: [A-341] · Done when: it applies to an empty
  local D1 and to a copy holding paths of every shape in A-341, the column reads
  correctly on old rows, `EXPLAIN QUERY PLAN` shows the index, and a test feeds
  the same paths through the SQL and the function and gets equal results. If
  local D1 refuses a generated column, stop and bring the alternative to Paduka;
  do not fall back to editing the order write path.
  **Done 2026-10-29** as `0068_order_source_slug.sql`. **Local D1 result:**
  the chain `0000`–`0067` applied to an empty local D1 (workerd through
  wrangler's `getPlatformProxy`, never `--remote`) via `ensureSchemaUpgraded`,
  six orders of every A-341 shape seeded, then `0068` applied in the Worker's
  own claim-plus-statements `batch` — `ALTER TABLE … ADD … GENERATED ALWAYS AS
  (…) VIRTUAL`, the index and `PRAGMA optimize` all accepted, claim row
  written (`upgraded: 1`). The pre-existing rows read `/kopi` → `kopi`,
  `/produk/kopi/` → `kopi`, `/lp/Promo-Kopi?utm=fb#x` → `promo-kopi`,
  `/` → `beranda`, NULL and `''` → NULL; `table_xinfo` shows `hidden = 2`
  (virtual); `EXPLAIN QUERY PLAN` is `SEARCH orders USING INDEX
  idx_orders_source_slug_created (source_slug=? AND created_at>?)`. SQL and
  function agree in "the generated column and the function agree on every
  path, old rows included". No migration change was needed. **Not proven:**
  remote D1 (its statement allowlist may differ from workerd's local SQLite);
  the first install that deploys it is the proof.
- [x] **A-343** — Dropped 2026-10-29: the generated column (A-342) gives every
  order its slug without touching `persistOrder` or the submit routes.
- [x] **A-344** — Capture the source on a lead without touching the forms.
  `/api/record-abandoned-order` reads the page from the `Referer` header (the
  form's `fetch` is same-origin and the store sends
  `Referrer-Policy: strict-origin-when-cross-origin`, so it carries the full
  URL), keeps its pathname clipped to 500 characters, and passes it to the
  abandoned-lead insert; the 2-hour repeat keeps the first value
  (`COALESCE(source_page_path, ?)`). Form scripts and the converted-lead and
  order statements are not edited.
  -> REQ: REQ-192 · deps: [A-342] · Done when: tests prove a captured lead has a
  slug, a missing or foreign-origin `Referer` stores null, a repeat capture
  inside two hours keeps the first page, conversion still leaves the order with
  the submit page's path, and `git diff` shows `form-hybrid.ts` and
  `form-middle.ts` unchanged.
  **Done 2026-10-29:** `sourcePathFromReferer`, the `COALESCE` repeat in
  `recordAbandonedOrder`; four tests in `source-slug.test.ts`; both form
  scripts unchanged in `git status`.
- [x] **A-345** — Resolve a slug to a label: CMS landing title, native page name,
  product name, else the slug. One batched read, reused by the lists and A37.
  -> REQ: REQ-195 · deps: [A-342] · Done when: tests prove each kind, a product
  page that a landing has claimed showing one name, and an unknown slug falling
  back to itself.
  **Done 2026-10-29:** `resolveSourceLabels` (one `sourceLabelsStatement`
  read); the labels test in `source-slug.test.ts`. **Deliberate collision:**
  the slug is the last segment, so `/produk/kopi` and a landing at `/kopi` are
  one source, `kopi`; the label resolves it (landing title, then native page,
  then product title, then the slug). See `ARCHITECTURE.md` §4,
  "`orders.source_slug`".
- [x] **A-346** — Show and filter the source in the order list and the
  abandoned-lead list. The slug is a chip beside the existing
  `TrafficSourceBadge` (≤ 16 characters, the full path in `title`), not a new
  column; a filter built from `FilterBar`/`FilterField` lists the present slugs
  by frequency, and the API parameter sits behind it.
  -> REQ: REQ-194, REQ-196 · deps: [A-342, A-345] · Done when: tests prove the
  filter and an unknown slug returning no rows rather than all; browser evidence
  at 390px and 1280px shows the chip, the filter, the table's width unchanged and
  a phone card without a chip unchanged (a card with one may wrap the chip to
  its own line — Paduka 2026-10-29: readable over one-line), no overflow, and `admin-controls.test.ts` still
  passing.
  **Built 2026-10-29:** `SourceSlugChip`, the source filter on `OrdersTable`
  and `AbandonedOrders` (both rows now `FilterBar`/`FilterField`; the
  abandoned-lead row was a hand-built label/div until the review), the
  `source_slug` / `source_options` API parameters; "the order and lead lists
  filter by source; an unknown slug returns no rows, not all" and
  `admin-controls.test.ts` pass. **Browser evidence 2026-10-29 (local dev,
  `scratchpad/evidence/s1/`, script `pw/s1-admin.mjs`, 52/55 checks):** real
  data from the storefront — a partial fill on `/contoh-landing` and
  `/produk/madu-hutan-dummy` recorded leads with the page from `Referer`
  (`a344-lead-partial-form-*-390.png`); COD orders from
  `/produk/kaos-katun-dummy` and `/full-form` (`a346-order-thanks-full-form-390.png`).
  Passing at 390 and 1280: chip with label and full path in `title`, ≤ 16
  characters, seeded rows without a source show none (`a346-orders-chip-*`,
  `a346-leads-chip-*`); options by frequency plus "(tidak tercatat)"
  (`a346-*-filter-open-*`); a slug filter returns only its rows
  (`a346-orders-filtered-kaos-*`, `a346-leads-filtered-madu-*`); none
  returns the 12 sourceless orders and the empty state on leads
  (`a346-*-filtered-none-*`); an unknown slug returns 0 rows, not all
  (`a346-*-unknown-slug-*`); no page overflow; phone-card badge row 22px with
  and without the chip; leads list console clean. **Not met, so not ticked:**
  (1) at 1280 the chip widens the order table's invoice column 180 → 296px
  (table 1363 → 1479px inside its scroll wrapper) — the table width is not
  unchanged; (2) `/admin/orders?source_slug=<any>` throws React #418 (hydration
  text mismatch): the island is server-rendered with "Semua halaman" while the
  `useState` initializer reads `window.location`; the leads list (no SSR) is
  clean. Also seen: on a 390px order card the chip shrinks to one letter
  ("K…") beside the RTS badge.
  **Fixed and done 2026-10-29** (`pw/s1-hyd-fixed.mjs`, `pw/s1-admin-fixed.mjs`,
  54/54, `*-fixed` screenshots): both islands take `initialQuery` from
  `Astro.url.search`, so no `useState` reads `window.location` (test in
  `admin-islands-render.test.ts`, mutation-checked; `?search=`/`?status=` had
  the same mismatch and are fixed with it); no console error with any
  `source_slug`; at 1280 the table stays 1363px and the invoice column 180px
  with or without chips; the chip reads in full and wraps to its own line when
  it does not fit (card 574 → 600px only when a chip is present).
- [x] **A-347** — Channel split, read-only. `traffic-source.ts` is a protected
  surface, so it is called, not edited: a new `src/lib/ad-channel.ts` maps
  `parseTrafficSource(ad_click_ids)` to a plain channel (meta, google, tiktok,
  other paid, organic, direct). Check which keys of `CLICK_ID_KEYS` end up in
  `ad_click_ids`, and write the SQL `CASE` the aggregation needs to match it.
  -> REQ: REQ-203 · deps: [] · Done when: tests cover each channel from a real
  stored value, a malformed value and null, and the SQL `CASE` and the function
  agree on every one; the stored shape is written into the function's header
  comment.
  **Done 2026-10-29:** `ad-channel.ts` + `ad-channel.test.ts` (each channel,
  malformed, null; SQL `CASE` agreement); `traffic-source.ts` unchanged.

## A37 — Analytics: which landing page wins, what sells, and where

Backend resumed and verified 2026-10-30 in `feat/s1-a36-a38`; A-357–A-362
screens/close-out and A38 remain open. Evidence: `scratchpad/evidence/analytics-resume/`
(ignored local logs); reproducible commands and figures live in PRD A37 and
`scripts/measure-insights.ts`. Full suite: 1024 passing, check/build pass.
No protected order, tracking or form module was changed. Existing uncommitted
backend work was preserved and completed, not replaced.

A-348 establishes the fixed-fixture budget; A-362 must verify finished screens.

Code review 2026-10-30 (working tree, high): ten findings, all addressed.
Province drill-down sends the row key, so an empty or unmatched province opens;
non-JSON error bodies keep the 401/403/5xx states; a follow-up 409 reloads the
stage list; a URL `source`/`product_id` on a screen without that control is shown
as "Filter aktif" and kept on Apply; the period reaches Analitik links on
pointerdown/focus as well as click, and the palette uses `withInsightsPeriod`;
shared constants replace literals; the follow-up route reuses `orderRowSql()` and
answers 404 for an order that vanishes mid-save; both layout instances of an
order's follow-up stay in step. Closing rate keeps every lead in the denominator
(PRD amended). Suite 1039/1039, check 0/0/0, build. Browser on the 8795 demo at
1366/390px: drill-down, filter chip, sidebar/palette period, 401/403/502 states,
follow-up save sync and 409 recovery. Not browser-proven: an empty-province row
(no such row in the demo data; covered by `insights.test.ts`).

UI checkpoint 2026-10-30: 1033 tests pass, check 521 files with zero
errors/warnings/hints, build passes. Evidence: `scratchpad/evidence/analytics-ui/`.
Independent attached-source review accepted code fixes; no visual approval.
Native browser tool failed `missing-binary` (`agent-browser` not on PATH), and
`pi-agent-browser-doctor` is also absent. No browser package installed, no
alternate unaudited browser harness used. Geometry and visual/interaction checks
are UNVERIFIED. Local dev server started on 8795 and was stopped by its own
process group; no seed, credential read or live mutation was performed.

- [ ] **A-348** — **Measured 2026-10-30; pending the explicitly required Git commit.**
  Ephemeral local D1: 20,000 orders / 27,000 items / 40 sources / 30 products /
  300 cities. Real rows-read, elapsed times, indexed range plans, covering-index
  experiment and runnable ceilings recorded in PRD A37. Script is present but
  uncommitted; no commit was authorized. Seed a realistic local D1 (≥ 20,000 orders over 90 days, 40
  slugs, 30 products, 300 cities) and measure `meta.rows_read` and time for the
  queries the dashboard runs today. Every new A37 or A38 query is checked
  with `EXPLAIN QUERY PLAN`: no `SCAN orders` and no `USE TEMP B-TREE` where an
  index could serve, with a covering index tried before a plan is accepted
  (PRD A40 E2). Write the figure and the budget (a ceiling of
  rows read per screen) into the PRD's A37 technical decisions.
  -> REQ: REQ-198, REQ-208 · deps: [] · Done when: the figures are recorded, the
  seed script is committed under `scripts/` and never touches a remote database.
- [x] **A-349** — **Done locally 2026-10-30.** Shared `order-metrics.ts` imported
  by dashboard and insights; `admin-analytics.test.ts` unchanged and green.
  Protected lifecycle keeps its own equivalent write predicate, checked by test.
  Move `RELEASED_ORDER` and the "abandoned is a lead" rule out of
  `api/admin/analytics.ts` into one `src/lib` module and import it there.
  -> REQ: REQ-206 · deps: [] · Done when: `admin-analytics.test.ts` is unchanged
  and green, and a grep finds the expression in one place.
- [x] **A-350** — **Done locally 2026-10-30.** Existing parser reused; 90-day,
  missing/inverted range, zero-fill, prior period and Jakarta boundary tests pass.
  Shared period handling for the new routes: required start and
  end, 90-day ceiling with a stated 400, the dashboard's `'+7 hours'` expression,
  zero-filled day series. Reuse `admin-date-filter.ts`; add no second parser.
  -> REQ: REQ-198 · deps: [A-349] · Done when: tests prove a missing end, an
  inverted range, a 91-day range and a valid one, and a day with no orders
  returned as zero.
- [x] **A-351** — **Done locally 2026-10-30.** Hand-checked ranking/funnel,
  aggregates-only response and local D1 fixture budget pass. Response is no-store,
  matching admin middleware; PRD corrected rather than weakening session policy.
  Landing ranking: `GET /api/admin/insights/landing` returns, per
  source, leads, orders, revenue, average order value, closing rate, delivered
  and return share and channel split, in one `D1.batch`, labels joined, with a
  `(tidak tercatat)` row and the default sort on delivered revenue.
  -> REQ: REQ-199, REQ-203, REQ-205, REQ-206, REQ-207 · deps: [A-344, A-345,
  A-347, A-350] · Done when: tests on a seeded fixture prove the arithmetic by
  hand (including a page with many orders that all returned ranking below a
  smaller page that was delivered), leads counted per source, no personal field
  in the response, and `rows_read` under the A-348 ceiling. Role access is
  A-356's.
- [x] **A-352** — **Done locally 2026-10-30.** Source totals, product revenue,
  zero-filled days and previous-period arithmetic pass. Trend: `GET /api/admin/insights/trend` returns daily orders,
  leads and revenue for the period, optionally for one source or product, plus
  the previous period's total.
  -> REQ: REQ-200 · deps: [A-350] · Done when: tests prove zero-filled days, the
  filtered series summing to the unfiltered total across all sources, and the
  previous period being the same length ending the day before.
- [x] **A-353** — **Done locally 2026-10-30.** Line arithmetic and released-order
  exclusions pass. Legacy orphan test first proves normal FK rejection, then
  simulates an old import only in disposable SQLite; schema stays unchanged.
  Product ranking: `GET /api/admin/insights/products` returns
  units, revenue, variant split and return share per product (`order_items` ⋈
  `product_variants`), live orders only.
  -> REQ: REQ-201, REQ-206 · deps: [A-350] · Done when: tests prove units × price
  equals revenue on a fixture, a released order excluded, and a deleted variant
  not failing the query.
- [x] **A-354** — **Done locally 2026-10-30.** Top-N + Lainnya totals, unknown
  aliases and hostile province input pass; city label is stable across row order.
  Location ranking: `GET /api/admin/insights/locations` returns
  provinces, then a province's cities on request, top 20 and top 50 plus
  `Lainnya`, each with orders, revenue and return share.
  -> REQ: REQ-202 · deps: [A-350] · Done when: tests prove the cut-off and that
  `Lainnya` makes the total equal the unfiltered total; the city param is bound,
  never interpolated; and a province spelled two ways in old rows is reported
  (the finding recorded, merged only if the catalogue defines the alias).
- [x] **A-355** — **Done locally 2026-10-30.** Sunday/Monday WIB boundaries,
  7×24 zero cells and landing follow-up aggregates pass. Order time heatmap: `GET /api/admin/insights/times` returns
  orders by weekday × hour in Asia/Jakarta, and the lead follow-up funnel is
  folded into A-351's response.
  -> REQ: REQ-204, REQ-205 · deps: [A-350] · Done when: tests prove an order at
  Sunday 23:30 WIB (16:30 UTC) lands in Sunday 23:00, and one at Monday 00:10 WIB
  (Sunday 17:10 UTC) lands in Monday 00:00.
- [x] **A-356** — **Done locally 2026-10-30.** Real request-gate tests admit
  owner/admin/advertiser and refuse customer service for every insights endpoint;
  dashboard access is unchanged. Page-policy tests pass; pages await A-357.
  Route policy in `auth.ts`: add `/api/admin/insights` to
  `ADMIN_API_ROUTES` and the advertiser API list, and `/admin/analytics` to
  `ADMIN_PAGE_ROUTES` and the advertiser page list. Only owner passes by
  default; admin is held to its lists. Customer service gets neither. Do not put
  the endpoints under `/api/admin/analytics`: `matchesRoute` is a prefix match
  and customer service holds that entry.
  -> REQ: REQ-207 · deps: [A-351] · Done when: the policy tests prove owner, admin
  and advertiser reach every `/api/admin/insights/*` path and `/admin/analytics`,
  customer service gets 403 on all of them, and the dashboard's own
  `/api/admin/analytics` access is unchanged for every role.
- [ ] **A-357** — **Implemented, browser acceptance in progress 2026-10-30.** Five
  Astro routes and Analitik sidebar children; owner/admin/advertiser only. Shared
  period picker, explicit Apply, applied-period label, source/product/channel
  choices, source-to-order links and page-width guard. URL helper tests pass;
  Owner browser proof now covers explicit Apply and seven-day period persistence
  from Ringkasan to Lokasi, plus keyboard province drill-down. Full role/menu
  acceptance remains open.
  Navigation and shell: an **Analitik** item in
  `admin-navigation.ts` with children (Ringkasan, Landing page, Produk, Lokasi,
  Waktu beli), one `/admin/analytics/*` page each on `AdminLayout`,
  `AdminPageHeader`, the shared period control, no page-level width of its own.
  -> REQ: REQ-197, REQ-198, REQ-208 · deps: [A-350] · Done when: the menu item
  opens each page, the period survives switching screens, the limits notice
  (REQ-208) is on every page, and `admin-page-width.test.ts` still passes.
- [ ] **A-358** — **Implemented, browser acceptance in progress 2026-10-30.** Numeric
  sorting, delivered-revenue default, phone cards, desktop table, closing bars,
  expandable channel/follow-up counts and role-gated source links. SSR test
  covers populated and empty rows. Browser captures cover phone cards and desktop
  table; the table now has a named focusable scroll region, with ArrowRight
  movement verified at 1280px. Multi-row sorting and source deep links remain open.
  Landing screen: a sortable table (delivered revenue default)
  with a closing-rate bar, a channel mini-split, the `(tidak tercatat)` row, and
  a link to the order list filtered by that source (A-346).
  -> REQ: REQ-199, REQ-203 · deps: [A-351, A-357] · Done when: browser evidence at
  390px (cards) and 1280px (table) shows sorting, the link, an empty state and no
  overflow; the console is empty.
- [ ] **A-359** — **Partial 2026-10-30.** Lazy trend chart with metric selector,
  previous total and accessible daily table; failed chart import degrades to a
  reload action while the data table remains. Product summaries expand variant
  tables. Desktop product ranking is now a table; phone retains cards. Native
  keyboard expansion, empty/reset, and injected network failure/retry with period
  preserved pass in-browser. Tooltip/network lazy-load proof remains open. Trend and product screens: a daily chart with the previous
  period beside it, a source or product selector, and the product table with
  variant split. Lazy island per screen.
  -> REQ: REQ-200, REQ-201 · deps: [A-352, A-353, A-357] · Done when: browser
  evidence shows the chart, the selector changing it, tooltips, the empty state
  and both widths; the network panel shows the chart code loading only on these
  screens.
- [ ] **A-360** — **Implemented, browser acceptance in progress 2026-10-30.** Province
  to city drill-down, Lainnya, stated 20% RTS attention threshold and numeric
  7×24 heatmap. Keyboard province-to-city drill-down is verified; heatmap theme
  and keyboard/scroll acceptance remain open.
  Location and time screens: province table opening to cities,
  return share highlighted above a stated threshold, and the weekday × hour
  heatmap with a legible scale in both themes.
  -> REQ: REQ-202, REQ-204 · deps: [A-354, A-355, A-357] · Done when: browser
  evidence at both widths proves drill-down, `Lainnya`, the heatmap in light and
  dark, and keyboard reach for every control.
- [x] **A-361** — **Verified locally 2026-10-30.** Shared InsightsReport island
  renders loading/empty cases for all five reports and populated landing,
  product, location and time data through the existing esbuild/SSR harness.
  Chart remains lazy; its client rendering requires A-359 browser proof.
  Island render safety: add each new data island to
  `admin-islands-render.test.ts`, or keep the branch logic in `src/lib` where
  the runner reaches it.
  -> REQ: REQ-197 · deps: [A-358, A-359, A-360] · Done when: the render test fails
  if an island throws on empty and on populated data.
- [ ] **A-362** — **Partial 2026-10-30:** measurement rerun passes all eight
  existing fixture budgets unchanged; five real handlers pass local D1 smoke.
  Full suite 1033/1033, check 0/0/0, build, docs check and route-map generation
  (131 routes) pass after desktop-product/keyboard-scroll refinement. Full screen
  budget including selector reads, browser matrix and release closure remain.
  Weight gate and close-out: re-run the A-348 measurement against
  the finished screens, record the figures, `npm run route-map`, document the menu
  in `ARCHITECTURE.md`, version and changelog per `RELEASE.md`.
  -> REQ: REQ-198, REQ-208 · deps: [A-361] · Done when: every screen is under its
  A-348 ceiling, `npm test` (≥ 833 plus the new checks), `npm run check` and
  `npm run build` pass, and the doc headers cite the commit they were checked at.

### Deferred — needs a decision before any task

- **Visits and visit-to-order rate.** Not buildable honestly from D1 without a
  write per visit. Options to weigh in an ADR when wanted: Workers Analytics
  Engine, a sampled counter, or reading the ad platforms' own landing views.
- **Customer repeat rate** (needs an index on `customer_phone`).
- **Rollup table** (`analytics_daily`), only if A-362 shows a screen past its
  ceiling on a real store.

## A38 — Dashboard: best landing pages, best sellers and recent buyers

Proposed 2026-10-29. **Cancelled 2026-10-31 by the owner** (PRD A38): Every panel repeats a screen the admin already has: Pembeli terbaru is the head of `/admin/orders`, and the landing-page and product rankings are Analitik.
The unintegrated `recentBuyers` commit `d408b32` (branch `feat/s2-a39`) was
discarded with it.

- [x] **A-363** — **Cancelled 2026-10-31 with A38.** Recent buyers read: `recentBuyers(db, 8)` in `src/lib/` — the 8
  latest non-abandoned orders, then their first items in one bound query, name
  shortened to first name plus initial, no phone or address selected.
  -> REQ: REQ-211 · deps: [] · Done when: tests prove leads are excluded, an order
  with three items shows the first plus "+2", a one-word name, and that the
  returned object has no phone, address or full-name field.
- [x] **A-364** — **Cancelled 2026-10-31 with A38.** `GET /api/admin/dashboard-panels` returning only the sections
  the role may see, from one `D1.batch`, landing and product via the A37 query
  functions with `limit = 5`. Add it to `ADMIN_API_ROUTES` and to the advertiser
  and customer-service API lists in `auth.ts`, and check the role per section in
  the handler.
  -> REQ: REQ-210, REQ-212, REQ-213 · deps: [A-351, A-353, A-363] · Done when:
  tests prove owner and admin get three sections, advertiser two and customer
  service one, a section outside the role is a 403 and not an empty list, and the
  period parameter is capped at 31 days.
- [x] **A-365** — **Cancelled 2026-10-31 with A38.** Draw the row: three equal panels under the trend and payment
  mix, loaded after them, skeletons of final size, empty states, the "Lihat
  semua" links carrying the period, rows linking to the order.
  -> REQ: REQ-209, REQ-210, REQ-211, REQ-213, REQ-214 · deps: [A-364] · Done when:
  browser evidence at 390px, 1024px and 1280px shows one, two and three columns,
  equal heights, no layout shift when the row arrives, an empty store, each role,
  and the KPI cards and chart painted before the row's request is sent.
- [x] **A-366** — **Cancelled 2026-10-31 with A38.** Consistency check: the dashboard panel and its Analitik screen
  agree for the same period and role.
  -> REQ: REQ-215 · deps: [A-358, A-365] · Done when: a test or a recorded manual
  comparison on a seeded store shows identical orders and revenue for the top 5
  rows, including `(tidak tercatat)`.

## A39 — Operational status beside the notification bell, with its own page

Proposed 2026-10-29. Independent of A36 to A38; it can ship first.

- [x] **A-367** — Migration `ops_health_snapshot` (single row) and
  `src/lib/health-snapshot.ts`: write, read, and the staleness rule (older than
  120 minutes reports the stalled state), plus a pure `statusIconState()` for the
  precedence in REQ-217.
  -> REQ: REQ-217, REQ-222 · deps: [] · Done when: the migration applies to an
  empty local D1, and tests prove the precedence (degraded beats setup beats
  healthy beats unknown), that "belum ada data" alone is not red, that a 3-hour-
  old healthy snapshot reads as a problem, and that no row reads as neutral.
  **Done 2026-10-29:** `0069_ops_health_snapshot.sql` (0068 until the A-419 renumber) applied to an empty
  local D1 (workerd via `getPlatformProxy`, through `ensureSchemaUpgraded`'s
  claim-plus-statements batch; `CHECK (id = 1)` enforced); precedence,
  "belum ada data", 3-hour-stale and no-row tests in `health-snapshot.test.ts`.
  Review fix: staleness is measured from `scheduler_ran_at`, not `taken_at`,
  so a manual **Periksa ulang** cannot hide a dead cron (test "a manual check
  does not reset staleness", fails without the fix). Second review fix
  (finding 18): stale when **either** `scheduler_ran_at` or `taken_at` is over
  120 minutes (`staleReason`), so a snapshot write that keeps failing behind a
  fresh heartbeat turns the icon and `/admin/status` red ("status tidak
  diperbarui"); test "a snapshot write that keeps failing turns the icon
  stale", mutation-checked. Finding 19: `OperationalStatus` is in
  `admin-islands-render.test.ts`, and an unknown stored signal state or icon
  tone degrades to "Belum ada data" instead of throwing.
- [x] **A-368** — The hourly run upserts the snapshot after it collects health,
  including the required-setup-left count; alert evaluation stays where it is.
  The write is the last step of `scheduled()`, inside `housekeeping()`, so its
  failure is logged and nothing else.
  -> REQ: REQ-217, REQ-223 · deps: [A-367] · Done when: a scheduled-handler test
  proves one row after a run, a second run replaces it, a failing collection
  leaves the old snapshot rather than a blank one, a throwing snapshot write
  leaves the CAPI drain and payment reconciliation results unchanged, and the
  diff of `worker.ts` is only the appended step.
  **Done 2026-10-29:** scheduled-handler tests (one row, replaced on a second
  run, failing collection keeps the old snapshot, throwing write leaves the
  drain and reconciliation results unchanged, last-step source check). The
  `worker.ts` diff also carries the A-379 heartbeat move.
- [x] **A-369** — API: `GET /api/admin/health/status` (the snapshot, with the
  staleness applied, `private, max-age=60`), `POST /api/admin/health/check`
  (live collection, writes the snapshot, 15-second reuse, no alerts), and remove
  `evaluateOperationalAlerts` from `GET /api/admin/health`.
  -> REQ: REQ-216, REQ-223 · deps: [A-367] · Done when: tests prove owner and admin
  succeed and advertiser and customer service get 403, a GET no longer writes KV
  or calls the webhook, a second check inside 15 seconds returns the stored one,
  and the cron path still fires an alert on a stalled outbox.
  **Done 2026-10-29**, tests in `health-snapshot.test.ts`. **Deviation:** no
  `private, max-age=60` — the middleware sends `no-store` on every admin
  response, so the five-minute reuse lives in the icon's `sessionStorage`.
- [x] **A-370** — `health-actions.ts`: the map from signal and reason to its
  button (a route, or a setting name to copy), written from the reasons
  `OperationalHealth.tsx` already words.
  -> REQ: REQ-220 · deps: [] · Done when: a test fails for any reason in the
  component's table that has neither an action nor an explicit "none", and every
  route in the map is a real page in the route map.
  **Done 2026-10-29:** `health-actions.ts` + `health-actions.test.ts`.
- [x] **A-371** — The icon: a link beside `NotificationBell` in `AdminShell`,
  owner and admin only, tone and count from the snapshot, `sessionStorage` for
  five minutes, a re-check on focus, no interval; accessible name in words.
  -> REQ: REQ-216, REQ-217, REQ-218 · deps: [A-369] · Done when: browser evidence at
  390px and 1280px proves each of the four states, the name read by the
  accessibility tree, no overflow in the top bar, no request for the other two
  roles, and the network panel showing one request per load and none after.
  **Built 2026-10-29** (`OperationalStatusIcon.tsx`, `AdminShell.tsx`);
  role gating covered by tests. **Done 2026-10-29**, browser evidence (local
  dev, snapshot row written in local D1, playwright-core + Chrome, 390x844 and
  1280x800): healthy, setup (amber, count 1), problem (red, count 2), stale
  scheduler ("pemeliharaan berhenti"), stale snapshot ("status tidak
  diperbarui"), unknown-only and no-row (neutral, no badge). In every state the
  accessible name is in words and is the link's name in the Chrome AX tree, the
  top bar has no overflow, the first load sends one
  `GET /api/admin/health/status`, and the next admin page plus a `focus` event
  inside five minutes send none. Advertiser and customer service: no icon, no
  `/api/admin/health*` request, `/admin/status` redirects to the dashboard, the
  API answers 403. Screenshots: `a371-<state>-dashboard-{390,1280}.png`,
  `a371-role-{advertiser,customer_service}-{390,1280}.png`.
- [x] **A-372** — `/admin/status`: the header with **Periksa ulang**, **Perlu
  tindakan**, **Setup toko** (the checklist and its `readSetupFacts`, moved from
  the dashboard), and **Semua sinyal**; the copyable setting names for causes
  outside the admin. Add `/admin/status` to `ADMIN_PAGE_ROUTES` (the API is
  already covered: `/api/admin/health` is in `ADMIN_API_ROUTES`, and
  `matchesRoute` reaches its sub-paths).
  -> REQ: REQ-219, REQ-220 · deps: [A-369, A-370] · Done when: browser evidence
  proves a degraded, an unknown-only, a fully healthy and a fresh-install state,
  each button landing on the page it names, **Periksa ulang** refreshing the
  icon, and both widths without overflow.
  **Built 2026-10-29** (`src/pages/admin/status.astro`, `OperationalStatus.tsx`,
  `/admin/status` in `ADMIN_PAGE_ROUTES`). **Browser evidence 2026-10-29**
  (390x844 and 1280x800, no console errors, no 4xx/5xx, no overflow of the page
  or `#admin-main`): degraded, unknown-only, fully healthy, setup-needed, both
  stale reasons, and a no-row fresh state; **Periksa ulang** sends one
  `POST /api/admin/health/check` (200), rewrites the header and turns the icon
  from neutral to amber without a GET; **Salin nama** copies `triggers.crons`.
  Screenshots: `a372-<state>-status[-full]-{390,1280}.png`,
  `a372-no-snapshot-after-recheck-{390,1280}.png`. **Remaining (bug):** the
  **Setup toko** step "Aktifkan minimal satu kurir" links `/admin/couriers`
  (`setup-checklist.ts`, since 86a0fb5), which redirects to `/admin/shipping`;
  couriers are enabled on `/admin/expeditions`. **Fixed 2026-10-29:** the step
  links `/admin/expeditions` (`setup-checklist.test.ts` asserts it; the link
  was not re-clicked in a browser). Every other button lands on
  the page it names (`/admin/ads/meta`, `/admin/profile`,
  `/admin/settings/store`). Observation: with no snapshot row the header reads
  "Belum ada data" even while a required setup step is left (the icon rule
  says no row is neutral; the page follows it).
- [ ] **A-373** — Dashboard: delete the health card and keep one slim line while
  a required setup step is left.
  -> REQ: REQ-221 · deps: [A-372] · Done when: the dashboard no longer imports
  `OperationalHealth`, the line shows with a required step left and not without,
  and the dashboard's request count is lower than before.
  **Built 2026-10-29:** the dashboard no longer imports the health panel and
  shows the slim setup line only while a required step is left.
  **Measured 2026-10-29** (owner, 1280x800, local dev): the slim line shows
  with one required step left and is absent with none; no health card
  (`a371-setup-needed-dashboard-*.png`, `a371-healthy-dashboard-*.png`). Cold
  load: 55 requests, 3 of them fetches (`/api/admin/notifications`,
  `/api/admin/health/status`, `/api/admin/analytics`); a second load inside
  five minutes: 54, 2 fetches (the status answer comes from sessionStorage).
  Base `be00fee` was not measured (no second build allowed); from its source
  the dashboard fetched `/api/admin/notifications`, `/api/admin/analytics` and
  `GET /api/admin/health` (the full eight-signal collection plus alert
  evaluation) once each. **Remaining:** the cold-load fetch count is equal to
  base, not lower (3 vs 3; the replaced request is a one-row read instead of
  the collection); lower only on a warm load (2). Decide whether that meets
  "lower than before", or measure base directly.
- [ ] **A-374** — Close-out: update `OBSERVABILITY.md` §4 item 4, `ARCHITECTURE.md`
  and the command-palette keywords (status, kesehatan, health, setup);
  `npm run route-map`; version and changelog per `RELEASE.md`.
  -> REQ: REQ-216 … REQ-223 · deps: [A-373] · Done when: `npm test` (≥ 833 plus the
  new checks), `npm run check` and `npm run build` pass and the doc headers cite
  the commit they were checked at.
  **Partly done 2026-10-29:** `OBSERVABILITY.md` (§3 schema row, §4, §6 and the
  two `scheduled-*-failed` labels), `ARCHITECTURE.md` (`ops_health_snapshot`),
  palette keywords (`statusNavItem`), route map regenerated; `npm test` 915/915.
  **Remaining:** version bump and changelog per `RELEASE.md`; re-stamp the
  headers at the real commit. **Follow-up:** `GET /api/admin/health` has no UI
  consumer left (the dashboard panel was its only one; the icon and page read
  `/status` and `/check`). Callers today: its own test, the `auth.ts` route
  list, and the unauthenticated-`401` smoke probe in `STATUS.md` /
  `BUILD-LOG.md`. Kept on purpose; decide whether to retire it or keep it as
  the probe (REQ-83).

## A40 — Cloudflare fit: stay inside what the plan allows

Proposed 2026-10-29. Evidence in PRD A40. Nothing here deploys, and nothing runs
`--remote` without Paduka's approval (`AGENTS.md` §5).

- [x] **A-375** — Read the account's D1 usage. **Done 2026-10-29** with Paduka's
  approval: `wrangler d1 insights --remote --time-period 30d` over all 14
  databases, read-only. Account average 13.5M rows read and 83k written a day
  (`STATUS.md`). **Not met:** the worst single day, because insights returns
  30-day totals per query; and KV writes, which no command here reads. Both
  come from the dashboard's D1 and KV metrics.
  -> REQ: REQ-224 · deps: [] · Done when: `STATUS.md` holds the figures with
  their date and the worst day of the 30.
- [ ] **A-376** — Count the D1 writes each storefront request makes, locally:
  page view, kecamatan search, browser Meta event, abandoned capture, order
  submit. Multiply by one install's daily traffic and by the fleet's.
  -> REQ: REQ-224, REQ-226 · deps: [] · Done when: a table of writes per request
  type and an estimated daily total against the 100k Free allowance, measured
  with a counting proxy on `OMS_DB` that is never committed (ADR-030's method).
- [x] **A-377** — ADR: Workers Free or Paid. **Done 2026-10-29:** ADR-031,
  Workers Paid, accepted by Paduka. The A-375 reads alone decide it (2.7× the
  Free allowance), so it did not wait on A-376. The plan change is Paduka's
  dashboard action.
  -> REQ: REQ-225 · deps: [A-375, A-376] · Done when: the ADR is in
  `DECISIONS.md` with its status and the decision is Paduka's.
- [ ] **A-378** — Proposal only: options to cut the `rate_limits` writes (WAF
  rate-limiting rule, threshold counting, coarser window), each with its write
  saving from A-376 and its risk to the form and tracking paths.
  -> REQ: REQ-227 · deps: [A-376] · Done when: the options are written in this
  entry; no file under the protected surfaces changed.
- [x] **A-379** — **Exception, approved by Paduka 2026-10-29** (`src/worker.ts`
  beyond the A-368 row; recorded at the integration review). Move the scheduler heartbeat into the A39 snapshot row and
  delete the KV write (`recordSchedulerRun`, `SCHEDULER_HEARTBEAT_KEY`); the
  `scheduler` signal reads the D1 value. Written at the start of `scheduled()`
  inside `housekeeping()`, so a later failing step still records the run.
  -> REQ: REQ-228 · deps: [A-367, A-368] · Done when: tests prove the signal reads
  the D1 heartbeat, a missing row reads as "never ran", the stale threshold is
  unchanged, and a grep finds no KV write left in the scheduled path apart from
  alert state.
  **Done 2026-10-29** (s2-a39): `recordSchedulerRun` writes
  `ops_health_snapshot.scheduler_ran_at` inside `housekeeping("scheduled-heartbeat-failed")`;
  tests prove the D1 read, never-ran, the unchanged 150-minute threshold, no
  `SCHEDULER_HEARTBEAT_KEY`, and that the cron's only KV writes are alert state.
- [x] **A-380** — Record the Workers Cache finding (E6). **Done 2026-10-29:**
  ADR-031 decision 3, with the Workers Cache URL.
  -> REQ: REQ-229 · deps: [] · Done when: `DECISIONS.md` carries it with the
  Workers Cache URL, and no code changed.

### Measured read reductions (from A-375)

Each figure is the fleet's 30-day average from `STATUS.md` 2026-10-29. "Free to
do" means outside the protected surfaces; "proposal" means it touches one and
waits for Paduka's approval of that item alone.

- [x] **A-381** — **Done 2026-10-29** (worktree `feat/a35-a40-analytics-fit`).
  Every writer of `orders.created_at` uses `toISOString()`
  (`order-persistence.ts` insert and abandoned upsert). A real-SQLite test
  shows the new predicate and the old `unixepoch` one give the same count at
  the 24-hour edge, and that the plan uses `idx_orders_created_at`. Fleet
  rows-read effect is measured only after a release reaches the stores.
  Free to do. `recentOrderCount` (`src/lib/social-proof.ts`):
  replace `unixepoch(created_at) >= unixepoch('now', '-24 hours')` with
  `created_at >= ?` bound to the ISO time 24 hours ago, so
  `idx_orders_created_at` serves it. 2.13M rows read a day, about 470 per run.
  -> REQ: REQ-226 · deps: [] · Done when: a test proves the same count on
  fixtures straddling the 24-hour edge, `EXPLAIN QUERY PLAN` shows the index,
  and the stored `created_at` format (`toISOString`) is confirmed on every
  writer of `orders.created_at`, so string order equals time order.
- [x] **A-382** — **Done 2026-10-29.** The cost was not the subquery but the
  join: `CAST(p.id AS TEXT) = lp.product_id` made SQLite scan every landing page
  once per active product (`SEARCH p … SCAN lp`). The join now adds
  `p.id = CAST(lp.product_id AS INTEGER)` and keeps the text equality, so each
  product is a primary-key lookup and the matches are unchanged. A plan test
  fails on the old join and passes on the new one; the 25 existing tests pass
  unchanged. No migration needed.
  Free to do. The public landing-page list
  (`src/lib/landing-pages.ts`, the query selecting `AS product_image`) runs a
  correlated subquery per row: 2.75M rows read a day, about 1,700 per run.
  Rewrite it as a join or a second batched query; same output.
  -> REQ: REQ-226 · deps: [] · Done when: `landing-pages.test.ts` passes
  unchanged, a test proves identical output on a fixture, and `meta.rows_read`
  on a seeded 40-page store drops, figures recorded here.
- [x] **A-383** — **Closed 2026-10-29, no change.** The plan is already
  fully indexed: a rowid range over `notifications` above the operator's floor
  and a covering-index probe into `notification_reads`. Its cost is the number
  of retained notifications, which no index removes. A per-operator read
  watermark would, but that changes read-state semantics; not worth 2.8 % of
  fleet reads now.
  Free to do. The notification unread count
  (`src/lib/notifications.ts`), polled every 30 seconds by the bell: 375k rows a
  day, about 450 per run. Check its plan and add the index it needs.
  -> REQ: REQ-226 · deps: [] · Done when: `EXPLAIN QUERY PLAN` shows an index
  search, the notification tests pass unchanged, and the per-run rows read on a
  seeded store are recorded before and after.
- [ ] **A-384** — **Proposal** (tracking). The CAPI and Google outbox retention
  `DELETE`s (`capi-outbox.ts`, `google-ads-offline.ts`) compare
  `unixepoch(updated_at)`, so each hourly run scans the outbox: 1.98M rows a
  day, about 11,750 per run. Option: `updated_at < ?` with the ISO cut-off and
  an index on `(status, updated_at)`. Write the option with its test plan;
  change nothing until Paduka approves this item.
  -> REQ: REQ-226 · deps: [] · Done when: the proposal is written in this entry.
- [ ] **A-385** — **Proposal** (forms). The storefront catalog reads every
  `products` and `product_variants` row per request: 3.6M rows a day together,
  about 27k runs each. Option: an in-isolate memo with a short lifetime for
  storefront rendering only, never for checkout pricing (`AGENTS.md` §3: price
  comes from D1). Write the option, its staleness, and how checkout is kept off
  it; change nothing until approved.
  -> REQ: REQ-226 · deps: [] · Done when: the proposal is written in this entry.
- [ ] **A-386** — **Proposal** (tracking). The CAPI outbox writes about 58k rows
  a day: one insert and two updates per event. Write what each update is for and
  whether one can be folded, with its risk to delivery and dedup; change nothing
  until approved.
  -> REQ: REQ-226 · deps: [] · Done when: the proposal is written in this entry.
- [ ] **A-387** — Read-only investigation. `SELECT name FROM d1_migrations` runs
  12.8k times a day (0.83M rows): find why the schema check runs that often per
  isolate (`schema-version.ts`) without weakening the AGENTS §3 rule that the
  chain applies on the first database-backed request after a deploy.
  -> REQ: REQ-226 · deps: [] · Done when: the cause and an option are written
  here; a change is its own approved task.

### Dependencies and security

- [x] **A-388** — In-range dependency update and `npm audit fix`. **Done
  2026-10-29.** `npm update` within the existing semver ranges (no
  `package.json` change): astro 7.2.0 → 7.4.4, @astrojs/cloudflare 14.2.0 →
  14.4.3, react/react-dom 19.2.8 → 19.3.1, recharts 3.8 → 3.10.1, radix-ui,
  @base-ui/react, lucide-react, tailwind-merge, wrangler 4.120 → 4.155, and
  others. `npm audit`: 26 vulnerabilities (2 critical, among them astro ≤ 7.3.2)
  → 4 (3 low, 1 high). recharts 3.10 deprecates `verticalAlign`, so
  `ChartLegendContent` (unused in the app) reads it untyped and `astro check` is
  back to 0 hints. Evidence: `npm test` 880/880, `npm run check` 0/0/0,
  `npm run build` passes. `npm run dev:seed` on a fresh local store passed
  install, login, 11 products, 6 orders (COD, QRIS, transfer), payment settle,
  cron, Mengantar dispatch and cancel. A Playwright run at 390 and 1280 px
  showed home, a product page with its form island (6 inputs, 1 submit),
  dashboard, order list and order detail, all 200, no console error, no
  horizontal overflow.
  **Not upgraded (major versions):** @astrojs/react 7, TypeScript 7, zod 4,
  @types/node 26. **Install scripts:** npm now blocks the `esbuild` and
  `workerd` postinstall scripts until approved (`npm install-scripts approve`);
  the build and local Worker ran without them.
- [ ] **A-389** — **Proposal** (checkout validation). The remaining high
  advisory is zod < 4.6.6 (GHSA-mrhx-c7xc-m3w5: memory exhaustion on oversized
  *constrained collections*). `order-schema.ts` validates only bounded strings
  and numbers, so checkout exposure looks low. Other zod users are admin-only
  or authenticated, and their arrays are not yet reviewed. The fix is zod 4, a
  major version touching `order-schema.ts`, a protected surface. Write the
  migration plan and its test coverage; change nothing until approved.
  -> REQ: REQ-226 · deps: [] · Done when: the plan is written here.
- [ ] **A-390** — Remaining low advisory `deepmerge` comes through the `shadcn`
  CLI (a development tool, not in the Worker bundle); its fix is shadcn 1.0
  (a downgrade path npm proposes under `--force`). Leave it and recheck at the
  next shadcn release.
  -> REQ: REQ-226 · deps: [] · Done when: rechecked after a shadcn update.

## A41 — Variant weight: required for new products, visible on every order

Proposed 2026-10-29. PRD A41. The quote and dispatch already use
`weight_grams`; nothing here edits `shipping-quote.ts`, `mengantar-*.ts` or
the order write path.

- [x] **A-391** — **Done 2026-10-29** with Paduka's approval; figures in
  `STATUS.md`. zanobyshop (34 of 34 active products) and skincarebpom (11 of 13)
  still sit entirely at the 1000 g default.
  Read-only, needs Paduka's approval for `--remote`: per live
  store, `SELECT weight_grams, COUNT(*) FROM product_variants GROUP BY 1`, and
  the active products whose variants are all at 1000 g. Record the counts in
  `STATUS.md`; nothing is written to any store.
  -> REQ: REQ-236 · deps: [] · Done when: `STATUS.md` lists each store's
  variants at 1000 g and at other weights, with the date.
- [x] **A-392** — **Done 2026-10-29** (worktree s3-a41): `product-mutation.test.ts`
  "a new variant without a weight is refused with a 422", "a new variant saves
  the weight it states", "an existing variant saved without a weight keeps its
  stored one", "zero, negative, fractional and non-numeric weights are refused".
  Save API: `product-mutation.ts` returns null for a missing
  weight instead of 1000; a new variant (no id) with null is refused with
  "Berat varian <SKU> wajib diisi (gram)." (422). `api/admin/products.ts`
  updates with `weight_grams = COALESCE(?, weight_grams)`, so an omitted weight
  keeps the stored one.
  -> REQ: REQ-230, REQ-231, REQ-232 · deps: [] · Done when: tests prove a new
  variant without weight is refused, a new variant with 250 saves 250, an
  existing variant saved without weight keeps its stored value (not 1000), and
  zero, negative and fractional weights are refused as before.
- [x] **A-393** — **Done 2026-10-29** (worktree s3-a41): SSR proof
  (`admin-islands-render.test.ts` "ProductForm starts a new variant with an empty
  weight and states its use", 9/9 pass) plus browser evidence on `dev:local`
  (Chrome headless, 390px and 1280px, 0 overflow, no console errors, no 4xx/5xx
  except the intended 422): a new and an added row start empty and `required`
  with "Dipakai untuk ongkir Mengantar" (`a393-new-empty-*`,
  `a393-new-second-row-empty-*`); Simpan with no weight sends no request and
  shows "Berat varian <SKU> wajib diisi (gram)." (`a393-new-refused-*`); a
  direct POST without weight gets the 422 with the same message; 1250 → "1,25 kg",
  250 → "0,25 kg" (`a393-new-kg-hint-*`); with weights it saves and reopens with
  1250/250 (`a393-new-saved-*`); seeded "Madu" opens with 400/750 and an edit
  persists (`a393-existing-open-*`, `a393-existing-saved-*`). Screenshots are
  in the session scratchpad `evidence/s3/` (not committed).
  Form: a new variant row starts with an empty, required weight
  (not `"1000"`); the input carries the hint "Dipakai untuk ongkir Mengantar"
  and a live kg equivalent (1250 → "1,25 kg", `Intl.NumberFormat("id-ID")`);
  existing variants show their stored grams.
  -> REQ: REQ-231, REQ-233 · deps: [A-392] · Done when: browser evidence at 390px
  and 1280px shows an empty new row blocking save with the message, the kg hint
  updating, an existing product opening with its stored weights, and
  `ProductForm` still passing `admin-islands-render.test.ts`.
- [x] **A-394** — **Done 2026-10-29** (worktree s3-a41): `weight.test.ts` "each
  line is unit × quantity and the order total is their sum", "a deleted variant
  reads as unknown, never as zero". The query reads `COALESCE(oi.weight_grams,
  pv.weight_grams)`; the "order statements untouched" clause is superseded by
  A-397's approved exception.
  Order detail API: the item query adds the variant's current
  `weight_grams` (one joined column, no extra round trip); a pure helper sums
  line and order weight.
  -> REQ: REQ-234, REQ-235 · deps: [] · Done when: a test proves unit × quantity
  per line and the order total, a deleted variant reads as unknown (not 0), and
  the order statements in `order-persistence.ts` are untouched.
- [x] **A-395** — **Done 2026-10-29** (worktree s3-a41): `OrderDetail` renders per-item
  "Berat", "Total berat" and the A-397 label ("Berat saat order, …" when
  recorded, "Berat varian saat ini, …" otherwise; `weight.test.ts` covers the
  choice) and still passes `admin-islands-render.test.ts`. Browser evidence
  (390px and 1280px, 0 overflow, no console errors, no 4xx/5xx; the edit dialog
  opens, so the island is hydrated) on two seeded orders given a second line in
  local D1: INV-10007, both lines recorded — "300 g (0,3 kg)", "2 x 250 g =
  500 g (0,5 kg)", total "800 g (0,8 kg)", "Berat saat order, …"
  (`a395-INV-10007-*`); INV-10008, one line with no recorded weight — "260 g
  (0,26 kg) · berat varian saat ini", total "610 g (0,61 kg)", "Berat varian
  saat ini, …" (`a395-INV-10008-*`). Screenshots are in the session scratchpad
  `evidence/s3/` (not committed).
  Order detail page (the invoice): per item "Berat" (unit and
  line) and an order total "Total berat 2.500 g (2,5 kg)", labelled "berat
  varian saat ini, dipakai saat kirim ke Mengantar".
  -> REQ: REQ-234, REQ-235 · deps: [A-394] · Done when: browser evidence at 390px
  and 1280px shows the weights on a two-item order, the label, no overflow, and
  `OrderDetail` still passing `admin-islands-render.test.ts`.
- [x] **A-396** — **Done 2026-10-29** (worktree s3-a41): `order-item-weight.test.ts`
  "quote and dispatch agree on 1000 g × 3" and "… 250 g × 3". The "no diff
  under `mengantar-*.ts`" clause is **superseded** by A-397's approved
  exception: `mengantar-dispatch.ts` changes one line (the `COALESCE`);
  `shipping-quote.ts` is untouched.
  Lock the existing contract with tests, no source change:
  the quote's weight is `weight_grams / 1000 × quantity` and dispatch sends the
  same per item, from a variant at 1000 g and one at 250 g.
  -> REQ: REQ-230 · deps: [] · Done when: the tests exist and pass, and
  `git diff` shows no change under `shipping-quote.ts` or `mengantar-*.ts`.
- [x] **A-397** — **Done 2026-10-29** (worktree s3-a41): migration
  `0070_order_item_weight.sql` (0068 until the A-419 renumber); `order-item-weight.test.ts` "a new order line
  records the variant's weight at checkout", "editing the variant after
  checkout does not change what dispatch sends", "an order placed before the
  column existed dispatches with the variant weight", and (review fix) "CS
  conversion of a lead records the variant's weight at conversion". The Kelola
  plugin follows the same `COALESCE` (`sync.test.ts` "the Kelola payload carries the order's
  recorded weight, …").
  Integration review fix 2026-10-29: the admin courier re-quote of an existing
  order (`src/pages/api/admin/orders/[id].ts`) quotes the line's recorded
  weight, `MAX(0.001, COALESCE(oi.weight_grams, pv.weight_grams) / 1000)` × quantity
  of the first line — dispatch's own expression — passed as the quote's
  explicit weight; OrderDetail's preview sends the same figure as `weight=`
  (`quoteUnitWeightKg` in `weight.ts`), so preview, save and dispatch agree
  after the variant is edited (`admin-requote-weight.test.ts`,
  mutation-checked). `shipping-quote.ts` is unchanged. The no-variant-write
  assertion in `order-persistence.test.ts` now also catches a quoted
  identifier (`"…"`, `` `…` ``, `[…]`), `OR <conflict>` and `REPLACE INTO`, with a
  self-check of each form and of the two reads it must accept.
  **Exception, approved by Paduka 2026-10-29** (order flow):
  record `weight_grams` on `order_items` at checkout so dispatch sends exactly
  the weight that was quoted, even if the variant is edited later. The insert
  copies the variant's weight in SQL (`SELECT weight_grams FROM
  product_variants`), so no submit route changes; dispatch reads
  `COALESCE(order_items.weight_grams, product_variants.weight_grams)`, so
  orders placed before the migration still dispatch as today.
  -> REQ: REQ-235 · deps: [] · Done when: tests prove a new order stores the
  variant's weight, editing the variant afterwards does not change what
  dispatch sends, an old order without the column value still dispatches with
  the variant weight, and the order detail label (A-395) then says "berat saat
  order".
- [ ] **A-398** — **Partial 2026-10-29.** Limit: regular 50 kg, cargo 100 kg,
  **Live read 2026-10-29** (owner's Mengantar account, read-only
  `GET /order/estimate`, Surabaya → Tebet, `scratchpad/live/out/03-main.json`):
  every weight 0.5–150 kg answered 200 `success:true`; no error text at any
  weight. A courier past its limit stays listed `unsupported:true, price:0`.
  J&T, AnterAja, SPX and Pos stop at 50 kg; JNE, SiCepat, SAP, iDexpress and
  Lion quote regular service at 101 and 150 kg; cargo quotes at 150 kg (no
  100 kg cap seen); iDlite stops above 0.5 kg. So 50 kg is a per-courier
  limit, not a parcel limit: the product's 50 kg per-unit cap refuses
  variants that several couriers ship. Create-order limits were not tested
  (it would create an order).
  lite 0.5 kg. Source: `~/Projects/mengantar-documentation/docs/02-couriers-and-rules.md`
  §3.1 (local notes that cite the official Mengantar API docs plus live
  analysis; not re-checked against app.mengantar.com/docs). Applied as
  `MAX_VARIANT_WEIGHT_GRAMS = 50_000` in `product-mutation.ts`, tested in
  `product-mutation.test.ts`. **Remaining:** confirm the figure against
  Mengantar's own published documentation; the cap is per unit, not per parcel
  (a `// lazy:` comment names the upgrade path).
  Verify Mengantar's maximum parcel weight from its own
  documentation (not inferred) and, if it exists, add it as the save API's
  upper bound with its source in a comment.
  -> REQ: REQ-231 · deps: [] · Done when: the limit and its source are written
  here, or "not documented" is.

## A42 — Multiple warehouses, each quote from the warehouse nearest the buyer

Proposed 2026-10-29. PRD A42. Tasks marked **Exception** edit a protected
surface; each needs Paduka's approval as its own item, and each must keep a
one-warehouse store byte-identical (REQ-242).

Status 2026-10-29 (worktree `adsbookcms-s5-a42`, uncommitted): A-402 to A-405
done; A-407 and A-408 built and tested but their Exception approval is **not
recorded** in this file; A-406, A-409 and A-410 closed with browser and
stand-in evidence the same day (below); A-411 docs written, closing now
unblocked. Verification on that tree:
`npm test` 926 pass / 0 fail, `npm run check` 0 errors / 0 warnings / 0 hints,
`npm run build` complete.

**Upgrade risk (read before any deploy).** An install that already holds more
than one `warehouses` row changes behaviour on the deploy that carries the
migration: until now every quote and dispatch used the lowest-id row; after it,
every other ready row serves buyers in its own province. Count rows per install
(`SELECT COUNT(*) FROM warehouses`, a `--remote` read that needs approval)
before deploying, and have the operator confirm or deactivate extra rows first.
One-row installs are unchanged (REQ-242). Recorded in `RELEASE.md` §3 and
ADR-032. No install was read or touched.

- [x] **A-402** — **Done 2026-10-29.** `src/db/migrations/0072_multi_warehouse.sql` (0068 until the A-419 renumber)
  (renumbered at integration; tests find it by suffix). `warehouses.test.ts`:
  "A-402: the migration applies to an empty store" and "the first existing
  warehouse becomes primary; a second primary is refused by the index".
  Migration: `warehouses.is_primary` (the first existing row
  becomes 1), `is_active` (default 1), `served_provinces` (JSON array of
  province codes, NULL meaning "its own province"); a partial unique index so
  only one row can be primary.
  -> REQ: REQ-237, REQ-239 · deps: [] · Done when: it applies to an empty local
  D1 and to one holding a warehouse (which becomes primary), and a second
  primary is refused by the index.
- [x] **A-403** — **Done 2026-10-29.** `warehouse-choice.test.ts` covers one
  warehouse, coverage, island, primary, unknown province, ties, not-ready and
  inactive skipped, and all 38 codes in exactly one group.
  Pure chooser `chooseWarehouse(warehouses, buyerProvinceCode)`
  in `src/lib/warehouse-choice.ts`, plus the static island-group map of the 38
  province codes. Order: ready and serving the province, then same island
  group, then primary; ties to primary, then lowest id; not-ready and
  inactive rows never chosen.
  -> REQ: REQ-239 · deps: [] · Done when: tests cover one warehouse (always it),
  coverage, island fallback, primary fallback, an unknown province, a not-ready
  warehouse skipped, and every province code mapped to exactly one group.
- [x] **A-404** — **Done 2026-10-29.** `provinceCodeForCity` in
  `warehouse-choice.ts`. Every city in the index resolves to one province except
  **`banjar`** (Kota Banjar, Jawa Barat / Kabupaten Banjar, Kalimantan Selatan),
  pinned by the A-404 test. **Decision: no form change.** The rate route and
  every submit route already carry the city; an unknown or ambiguous city
  quotes from the primary on both the rate call and submit, so they agree.
  Buyer province on the server: derive the province code from
  the destination the rate route already receives (city, and district where
  given) using the bundled district index. Report ambiguous city names.
  -> REQ: REQ-239 · deps: [] · Done when: a test resolves every city in the index
  to one province or lists the ambiguous ones, and the result decides whether a
  form change is needed (if it is, that becomes a separate proposal).
- [x] **A-405** — **Done 2026-10-29.** `src/lib/warehouses.ts`,
  `/api/admin/warehouses` (in `ADMIN_API_ROUTES`, owner/admin only).
  `warehouses.test.ts` proves each rule with `ensurePickup` stubbed; no test
  reaches Mengantar. Screens that show one warehouse (expeditions, `/admin/check`,
  settings GET + `save-warehouse`, lead conversion) now read the primary, not
  `ORDER BY id LIMIT 1`, with a test guarding it.
  Warehouse management: `src/lib/warehouses.ts` and
  `/api/admin/warehouses` (list, add, edit, delete, set primary). Saving needs a
  precise Mengantar origin and a pickup address from `ensurePickupAddress`, as
  the current single form does; at most 10; deleting a warehouse with orders is
  refused (deactivate instead); the primary cannot be deactivated. Add the route
  to `ADMIN_API_ROUTES`.
  -> REQ: REQ-237, REQ-238, REQ-248 · deps: [A-402] · Done when: tests with the
  Mengantar client stubbed prove each rule, that a warehouse without
  `origin_area_id` or `pickup_address_id` is stored as not ready, and that no
  test calls Mengantar.
- [x] **A-406** — **Done 2026-10-29.** `Warehouses.tsx` replaces the single
  form on `/admin/settings/warehouse`. Browser evidence (local `dev:local`
  store, headless Chrome via playwright-core, screenshots in the session's
  `evidence/s5/`, each at 390px and 1280px): add "Gudang Surabaya" (origin
  Gubeng, Jawa Timur) through the editor (`a406-04-added-two-*`); edit saved
  (`a406-05-edit-390`, "Gudang tersimpan."); validation — empty submit stops
  at the browser's required check, missing origin shows "Pilih kecamatan
  origin…" (`a406-02-validation-origin-390`), a short phone shows the server's
  "Telepon PIC harus berisi 9-15 digit." (`a406-03-validation-phone-1280`);
  deactivate shows "Nonaktif", `aria-checked=false`, "Jadikan utama" disabled
  (`a406-06-inactive-settled-*`); primary switch both ways, the primary loses
  its delete button and its switch is disabled (`a406-07-primary-switched-*`);
  delete guard on a warehouse with an order shows "Gudang ini sudah dipakai
  order…" (`a406-09-delete-confirm-390`, `a406-10-delete-guard-*`); 10-row
  limit — "10 dari 10 gudang", "Tambah gudang" disabled, notice shown, an 11th
  POST answers 409 "Maksimal 10 gudang." (`a406-11-ten-limit-*`; the eight
  fixtures were added through `/api/admin/warehouses`); not-ready — "Belum
  lengkap" with the pickup message and "Jadikan utama" disabled
  (`a406-12-not-ready-*`; fixture: one test row's `pickup_address_id` blanked
  in local D1, because the stand-in always registers a pickup); deleting an
  unused row works (`a406-13-deleted-unused-390`); "Tambah gudang" opens the
  editor from the keyboard. Horizontal overflow 0 on every capture. Console:
  no JS or hydration errors; the only entries are Chrome's resource-load lines
  for the deliberately provoked 422 and 409 answers.
  Pengaturan → Gudang becomes a list: each warehouse with name,
  city, Mengantar status (siap / belum lengkap), primary badge, served
  provinces; an editor reusing `WarehouseOriginPicker`, the PIC fields and a
  province multi-select; "Jadikan utama", deactivate, delete with confirm.
  `save-warehouse` in `api/admin/settings.ts` stays working for older clients
  until this page no longer calls it.
  -> REQ: REQ-237, REQ-238 · deps: [A-405] · Done when: browser evidence at 390px
  and 1280px proves add, edit, primary switch, the not-ready state, the 10-row
  limit and the delete guard, with no overflow and an empty console.
- [x] **A-407** — **Done 2026-10-29. Exception, approved by Paduka
  2026-10-29** (recorded after the build, at the review of the protected-file
  edits; `docs/AUDIT-2026-10-29.md` §5). `warehouse-quote.test.ts`: the one-warehouse
  results recorded before the change pass unchanged; a two-warehouse store
  quotes from the chosen one with exactly one rate call. An explicit
  `warehouseId` is honoured only while active and ready (or the primary).
  **Exception** (`shipping-quote.ts`): replace the
  first-warehouse read with one read of ready warehouses fed to
  `chooseWarehouse`, and accept `destinationProvince` in `ShippingQuoteInput`.
  `input.originId` still wins when given.
  -> REQ: REQ-239, REQ-240, REQ-242 · deps: [A-403, A-404] · Done when: the
  existing quote tests pass unchanged, a one-warehouse fixture returns the
  identical result, a two-warehouse fixture quotes from the chosen one, and
  the quote makes still exactly one rate call.
- [x] **A-408** — **Done 2026-10-29. Exception, approved by Paduka
  2026-10-29**, including the headless change in `src/lib/headless-checkout.ts`
  and `/api/v1/geo/shipping-rates` (checkout re-quotes from the echoed
  `warehouse_id` or the primary). Audit finding 23 closed 2026-10-29: a
  checkout with `city` and no `warehouse_id` also quotes the way the rate route
  would for that city, and answers 409 `SHIPPING_QUOTE_CHANGED` when that
  warehouse is not the primary and the chosen courier's price differs, so a
  client that sent `city` to rates is never silently charged the primary's
  price (`headless-checkout.test.ts`, mutation-checked). It first asks which
  warehouse the city picks (`warehouseOnly`, no rate call) and quotes that
  warehouse only when it is not the primary, so a one-warehouse store makes
  the one Mengantar call it made before A42 and is charged exactly as before;
  a failed extra quote fails the checkout (`warehouse-quote.test.ts`). `headless-client.ts` now echoes the rate
  call's `warehouse_id`.
  Tests: submit re-verifies from the warehouse the form was quoted from (409
  `SHIPPING_QUOTE_CHANGED` on the primary's price); the admin re-quote keeps the
  order's warehouse while it is active, else chooses by the order's province,
  and OrderDetail previews with the same two values; `/api/shipping-rates`
  ignores an inactive or not-ready `warehouse_id`. Headless: the rate route
  returns `warehouse_id` and `/api/v1/checkout` re-quotes from the echoed one
  (primary when absent, 409 when no longer quotable), so a client that quotes
  without `city` is never charged another warehouse's price
  (`STOREFRONT_INTEGRATION.md` §4.6–4.7, OpenAPI). `submit-middle-order` makes
  no quote and stores no warehouse. `headless-client.ts` does not send `city`
  to rates, so it quotes from the primary and echoes that `warehouse_id`.
  Re-review 2026-10-29: a store with no warehouse rows (env origin) also makes
  one rate call (`?? null` comparison; test "headless checkout on a store with
  no warehouse rows (env origin) makes one rate call", mutation-checked).
  Behaviour change to record in the release: a headless COD checkout whose
  Mengantar estimate fails no longer falls back to the city average and
  answers 422 `SHIPPING_RATE_NOT_FOUND`; it now fails as a provider error
  (500 `CHECKOUT_PROCESSING_ERROR`). The v1 rate route never offered the
  city average, so no correct client was charged it.
  **Exception** (rate and submit routes): `/api/shipping-rates`,
  `/api/v1/geo/shipping-rates`, `submit-order`, `submit-middle-order`,
  `v1/checkout`, lead conversion in `abandoned-orders`, and the admin re-quote
  pass the buyer province (or, for a re-quote, the order's `warehouse_id` as the
  origin).
  -> REQ: REQ-240, REQ-241 · deps: [A-407] · Done when: tests prove the submit
  re-verifies from the same warehouse the form was quoted from, an admin
  re-quote keeps the order's warehouse, and every protected suite listed in the
  gate passes unchanged.
- [x] **A-409** — **Done 2026-10-29.** The order detail shows "Gudang
  Pengirim"; the shipping workspace shows "Dari <gudang>" per shipment when a
  store has more than one. Browser evidence: INV-10005 (buyer in Malang,
  Jawa Timur) shows "Gudang Pengirim: Gudang Surabaya" before and after
  dispatch (`a409-order-detail-INV-10005-surabaya-{390,1280}`,
  `…-dispatched-1280`); INV-10006 and INV-10008 show "Gudang Dummy Jakarta";
  `/admin/shipping` shows "Dari Gudang Surabaya" on INV-10005 and "Dari Gudang
  Dummy Jakarta" on the others, in the table (1280) and the cards (390)
  (`a409-shipping-dari-{1280,390}`). No overflow, empty console.
  Show the warehouse where it matters: the order detail and the
  shipping workspace name the warehouse each order ships from (the workspace
  already groups pickups per warehouse).
  -> REQ: REQ-240 · deps: [A-407] · Done when: browser evidence shows the
  warehouse name on an order shipped from the second warehouse.
- [x] **A-410** — **Done 2026-10-29** on a local `dev:local` store (Mengantar
  and AutoLaris stand-ins on 127.0.0.1; nothing reached a real account). Two
  warehouses: primary "Gudang Dummy Jakarta" (origin `dev-area-1974`, pickup
  `dev-pickup-mvtfdqbj1`) and "Gudang Surabaya" (origin `dev-area-3931`,
  pickup `dev-pickup-mvtfhjdq7`). Orders placed through `/full-form` in the
  browser (the product page renders the middle form locally, which makes no
  quote); dispatched with "Push Order ke Mengantar"; payloads read from the
  stand-in's memory over a local Node inspector
  (`a410-standin-dispatch-payloads.json`, `…-aceh.json`):
  - Jawa Timur, INV-10005 (Klojen, Malang, COD): `/api/shipping-options`
    answered `origin_id: dev-area-3931`; `orders.warehouse_id = 2`; dispatch
    `pickup.address_id = dev-pickup-mvtfhjdq7` (`a410-jatim-*`).
  - DKI Jakarta, INV-10006 (Tebet, COD): origin `dev-area-1974`;
    `warehouse_id = 1`; pickup `dev-pickup-mvtfdqbj1` (`a410-dki-*`).
  - Aceh, INV-10008 (Kuta Alam, Banda Aceh; QRIS because Aceh is COD-disabled
    by default, settled on the stand-in): origin `dev-area-1974`;
    `warehouse_id = 1`; pickup `dev-pickup-mvtfdqbj1` (`a410-aceh-*`).
  - Contrast: with Surabaya deactivated the same Malang quote came from
    `dev-area-1974` (J&T 15,000 against 18,000), and from `dev-area-3931`
    again once reactivated (`a410-quote-contrast.json`).
  - One warehouse: the four seed orders placed before the second warehouse
    existed (INV-10001…10004, a Jawa Timur buyer among them) all carry
    `warehouse_id = 1`. Their dispatch payloads were not captured; the
    byte-identical one-warehouse result rests on the A-407 tests.
  Mengantar's create-order payload carries no origin field, so the origin is
  proven by the rate answer and the pickup by the payload. **Still owed
  before any deploy:** the per-install row count above.
  End-to-end on a local store: two warehouses on the local
  Mengantar stand-in (`dev-providers`), a buyer in Jawa Timur quoted and
  dispatched from the Surabaya warehouse, one in Aceh from the primary, and a
  one-warehouse store unchanged.
  -> REQ: REQ-239, REQ-240, REQ-242 · deps: [A-408, A-406] · Done when: the
  dispatch payload's pickup address and origin match the chosen warehouse in
  each case, recorded here; nothing reaches a real Mengantar account.
- [ ] **A-411** — **Partial 2026-10-29.** ADR-032 in `DECISIONS.md`;
  `ARCHITECTURE.md` (§4 warehouse model, §7 quote origin and dispatch),
  `MENGANTAR_INTEGRATION_SPEC.md` (§3 origin and pickup per warehouse),
  `RELEASE.md` §3 (upgrade risk), `STOREFRONT_INTEGRATION.md` (headless
  `city`/`warehouse_id`). Route map current. Remaining: changelog and version
  (only `schemaVersion` is bumped), and closing after A-410.
  ADR for the choice rule (province coverage over distance or
  cheapest-of-all), `MENGANTAR_INTEGRATION_SPEC.md`, `ARCHITECTURE.md`, route
  map, version and changelog.
  -> REQ: REQ-237 … REQ-242, REQ-248 · deps: [A-410] · Done when: the docs match
  disk and `npm test`, `npm run check` and `npm run build` pass.
- [x] **A-444** — **Done 2026-10-30.** A branch warehouse whose rate call fails
  or comes back empty hands the quote to the primary
  (`resolveEligibleShippingRates` in `src/lib/shipping-quote.ts`; result field
  `primaryFallbackFrom`; `console.warn("shipping-quote-primary-fallback", …)`
  with both ids and `error`/`no_rates`). Headless checkout sets
  `noPrimaryFallback`; a named `warehouseId` is never swapped. Protected
  surface (the quote path), changed at Paduka's explicit request.
  Independent review (2026-10-30): one medium — the admin re-quote with the
  order's own `warehouseId` was swapped to the primary at save with no price
  compare against its preview, against REQ-241 — fixed by never swapping a
  named warehouse; lows fixed: the branch's provider error is surfaced when
  the primary has no rate either, `noPrimaryFallback` added to the headless
  resolver type, a misnamed test renamed. Not fixed (pre-existing, low): lead
  conversion's preview and save also compare no price.
  Evidence: `warehouse-quote.test.ts` +7 — failing and empty branch for COD and
  prepaid, a named warehouse never swapped, primary with no rate surfaces the
  branch error, primary failing too (prepaid throws, COD city average from
  the primary), a chosen primary never retried, rate route → submit at the
  fallback price accepted (the persisted `warehouse_id` is inferred from
  `quote.warehouse`: the fixture has no order tables); the REQ-242 golden
  tests and "headless checkout fails closed" unchanged and passing. Mutation:
  fallback disabled → 5 fail; headless opt-out removed → 1; named-warehouse
  guard removed → 1; branch-error restore removed → 1. `npm test` 1049 pass,
  `npm run check` 0 errors (524 files), `npm run build` complete. Not run: a
  browser or live Mengantar outage.
  -> REQ: REQ-270 (constraints REQ-240, REQ-241, REQ-242) · deps: [] · Done when: the
  tests above pass and the full suite, check and build are green.

## A43 — Resolve kecamatan to Mengantar areas without calling Mengantar

Proposed 2026-10-29. PRD A43. Rates stay live; only the area lookup is stored.

- [x] **A-412** — **Done 2026-10-29** (uncommitted, s4-a43 worktree):
  `0071_mengantar_areas.sql` (0068 and schemaVersion 69 until the A-419 renumber) and `src/lib/mengantar-areas.ts`;
  `mengantar-areas.test.ts` applies the real chain on node:sqlite to an empty
  store and to one with orders (one row per district, majority id, ties to the
  newest order) and proves read-back, replace-on-store and drop. Precision mode
  leaves no marker on an order, so the seed counts every order with an area id
  and records `agreeing_orders` / `total_orders` (migration header). Not run
  against a miniflare local D1.
  Migration: `mengantar_areas` (key `district|city|province`
  normalised as `location-cache.ts` already did, `area_id`, `label`,
  `source` ('order-history' or 'resolve'), `resolved_at`), seeded in the same
  migration from `orders` (distinct district, city, province with the most
  frequent `destination_area_id`), and `src/lib/mengantar-areas.ts` (read,
  store, drop). Check first how the order editor's precision mode marks its
  orders, so the seed can leave them out.
  -> REQ: REQ-243 · deps: [] · Done when: it applies to an empty local D1 and to
  a copy with orders (one row per district, the majority id), and tests prove a
  stored area is read back, a second store of the same key replaces it, and
  drop removes it.
- [x] **A-413** — **Done 2026-10-29** (uncommitted). **Exception, approved by
  Paduka 2026-10-29** (recorded at review; audit §5). `/api/locations` resolve
  goes through `resolveMengantarArea`; tests pin the pre-A43 bodies byte for
  byte (golden captured from `be00fee`), prove a second resolve makes no
  Mengantar call, and assert the route names no `SESSION`/KV. Two refinements
  from review: only an exact district match is stored (a fallback such as
  Jakabaring → Seberang Ulu I, 8 Ulu is returned but asked again next time),
  and a row answers for `MENGANTAR_AREA_MAX_AGE_DAYS` (30) from `resolved_at`
  before it is resolved again — the bound that stands in for A-415 until that
  is approved. Behaviour change: a stored district now answers even when
  Mengantar is not configured (before, no API key meant catalogue only).
  Review finding 20: the seed cannot tell an exact id from a fallback the form
  accepted, so a seeded row is dated by its newest order (not the migration)
  and a stale row whose re-resolve is a fallback or empty is deleted; a
  district ordered within the bound still answers from its seed until then.
  The delete touches only an expired row, so a fresh row reached through a
  failed read is kept (test "a fresh row survives a fallback re-resolve
  reached through a failed read", mutation-checked).
  **Exception** (`/api/locations` resolve): read `mengantar_areas`
  before Mengantar; on a miss resolve as today and store in D1 instead of the
  24-hour KV entry.
  -> REQ: REQ-243, REQ-247 · deps: [A-412] · Done when: a test pins the resolve
  response byte-identical to today's for the same input, a second resolve of
  the same district makes no Mengantar call, and no KV write remains on the
  resolve path.
- [x] **A-414** — **Done 2026-10-29** (uncommitted). **Exception, approved by
  Paduka 2026-10-29** (recorded at review; audit §5). Decision: **dropped**, not
  bounded. Free-text provider search is now uncached; the response is the same
  `fetchProviderLocations` body (golden test, `kebayoran`). Numbers: the hit
  rate **could not be measured** — the repository has no KV hit/miss counter
  and the fleet's KV analytics need `--remote` access, which was not requested.
  The decision rests on the shape of the traffic instead: the key was the raw
  query, so each typed prefix was its own entry and its own KV write; the
  buyer form searches the bundled district index locally and reaches the
  provider search only for the kelurahan fallback; the admin pickers are a
  handful of operators. If A-416's fleet figures show repeat queries, a bounded
  D1 or in-memory cache is the upgrade, never KV.
  **Exception** (`/api/locations` search): drop the 10-minute KV
  cache for free-text searches, or bound it, based on how often it is hit;
  the local district index already answers the form.
  -> REQ: REQ-245 · deps: [A-413] · Done when: the decision and its numbers are
  written here, and the search response is unchanged.
- [ ] **A-415** — **Proposal** (quote and dispatch): when Mengantar answers
  **Live read 2026-10-29** (read-only estimates, `04-unknown.json`): an
  unknown or malformed destination **or origin** id answers HTTP 200
  `{"success":false,"data":0}` with no `message`; an empty id answers 400
  `"origin_id or destination_id is empty"`; an unknown search keyword answers
  `success:true, data:[]`. There is no "area not found" text, and origin and
  destination failures are identical, so A-415 must match
  `success === false && data === 0 && !message` and drop the destination row
  only when the same origin quotes another destination.
  "area not found" for a stored area, drop it so the next resolve heals it.
  Touches `shipping-quote.ts` and `mengantar-dispatch.ts`; write the change and
  its tests; change nothing until approved.
  -> REQ: REQ-244 · deps: [A-412] · Done when: the proposal is written here.
  **Proposal, 2026-10-29 — not implemented, awaiting approval.** Interim: the
  30-day bound in A-413 heals a wrong id within a month with no protected-file
  edit. The change, once approved: (1) in `shipping-quote.ts`, when
  `/order/estimate` fails with Mengantar's area refusal for the destination,
  call `dropMengantarArea(db, destinationAreaId)` inside a try/catch that only
  logs, then return the quote error unchanged; (2) the same in
  `mengantar-dispatch.ts` for the dispatch's destination id, after the dispatch
  is recorded as failed, never before. The exact refusal text must first be
  captured from the provider stand-in or a sandbox answer — none is on disk, so
  matching it would be a guess today. Tests (Mengantar stubbed): a refusal drops
  every row carrying that id and the next resolve asks Mengantar; any other
  error drops nothing; a D1 failure in the drop leaves the quote/dispatch
  result identical; every protected suite passes unchanged. `dropMengantarArea`
  and its test already exist; it has no caller until this is approved.
- [ ] **A-416** — **Not started.** Remaining: run `dev:local` with the
  `dev-providers` stand-in on `be00fee` and on this tree, time N resolves of
  the same districts (cold and warm), and take the KV-writes-per-day estimate
  from the fleet's analytics (needs `--remote` approval; `STATUS.md` carries no
  per-key location figures today).
  Measure: resolve latency before and after A-413 on a local
  store with the provider stand-in, and the KV writes removed per day from the
  fleet figures (`STATUS.md`).
  -> REQ: REQ-243 · deps: [A-413] · Done when: the before and after figures are
  recorded here.
- [ ] **A-417** — **Not started; needs Paduka's approval for `--remote`** before
  any query runs. Open.
  Stability study from order history, read-only, needs approval
  for `--remote`: for each district|city|province, the `destination_area_id`
  values across all 14 databases' orders, with counts. No waiting for A-413.
  -> REQ: REQ-246 · deps: [] · Done when: the share of districts whose majority
  id agrees across stores, and the districts that disagree, are recorded in
  `STATUS.md`, which decides A-418.
- [ ] **A-418** — **Not started; blocked on A-417** and on its own approval for
  ~7,300 live Mengantar searches. Open.
  Only if A-417 shows stable ids: a throttled, read-only script
  resolves all 7,285 districts once (about 7,300 Mengantar searches, needs
  approval) and adds the area id to the bundled district data, with the D1
  table kept as the fallback.
  -> REQ: REQ-246 · deps: [A-417] · Done when: the bundle grows by the measured
  size (target under 150 KB raw), a new install resolves a sampled district
  with no Mengantar call, and the generator is committed under `scripts/`.

## A44 — Operator switches a COD order to transfer/VA on the admin order

Added 2026-10-30 on request: a COD order whose buyer then wants to transfer;
the operator switches it on the admin invoice page ("admin yang mengganti di
halaman inv admin"). A first cut put the chooser on the buyer's `/thanks`; the
owner corrected that it is an operator action, and the buyer-side switch was
removed before merge. Direction: COD → prepaid only. Kelola: its order webhook
keys on the order code and answers a resend as a duplicate
(`src/plugins/kelola/sync.ts`); no update route is known, so the order is
flagged for a manual Kelola correction instead.

- [x] **A-421** — `src/lib/payment-switch.ts`, PATCH
  `/api/admin/orders/[id]` action `switch-payment` (session operator recorded),
  `payment_switch` / `payment_link` on the admin order read,
  `PaymentSwitchDialog`, migration `0074` (`payment_switched_from/_at/_by`),
  the Kelola notice, and the local AutoLaris simulator charging the store's
  own fee table.
  -> REQ: REQ-250 · deps: [] · Done when: tests prove the COD-fee drop, the
  operator record, the refusals, the failed-provider path and the guarded
  write (mutation-checked); a browser run switches a demo COD order to VA from
  the admin order and the buyer link resolves to the new instruction.
  Done 2026-10-30: `payment-switch.test.ts` 5/5 (dispatch guard and COD-fee
  mutations each fail a test); `dev-providers.test.ts` pins QRIS 0.7% and VA
  BCA Rp6.500. Demo: admin INV-10014 COD Rp142.596 → VA BCA, total Rp138.000,
  "Diganti dari COD … oleh admin", Mengantar push held for payment; the copied
  link's instruction is VABCA Rp138.000 + Rp6.500. Earlier INV-10019 showed
  the Kelola notice with Kelola enabled locally on a dummy URL. A Base UI
  Select inside the Radix dialog dropped its selection, so the dialog lists
  the methods as buttons. Not run in a browser: manual transfer (no demo
  seller account; covered by the test) and the dialog at 390 px.

## A45 — Operations API and `adsbook` CLI (beside the storefront headless API)

Accepted 2026-10-30 (PRD A45, REQ-251–REQ-269); the storefront headless API
stays, so A-432 and A-433 are cancelled. Migration numbers are
provisional: take the next free one at merge. Every task: `npm test`,
`npm run check`, `npm run build`, `npm run route-map` when a route or lib
module is added, and the A40 `rows_read` measurement for any new list or
report query.

**v1 — read**

- [x] **A-422** — **Done locally 2026-10-30.** Six `ops:` scopes, never a default; a key is created or changed only with an explicit scope list (400 otherwise — an omitted list on PATCH used to reset an ops key to the storefront defaults); only the owner issues, changes or revokes a key with an `ops:` scope. Browser: developer page at 1280 and 390 px lists scopes, last use and the audit rows, no page overflow.
  Operations scopes beside the storefront scopes in
  `src/lib/developer-api-keys.ts`: `ops:orders:read`, `ops:orders:read_pii`,
  `ops:orders:write`, `ops:shipping:write`, `ops:reports:read`,
  `ops:catalog:read`; a null or empty stored scope list keeps the storefront
  defaults and never grants an `ops:` scope; key creation requires at least one
  scope and is owner-only (`src/pages/api/admin/settings/developer.ts`,
  `src/pages/admin/settings/developer.astro`, its island).
  -> REQ: REQ-252 (constraints REQ-263, REQ-265) · deps: [] · Done when: tests
  prove a null-scope key gets 403 on an operations route and still passes a
  storefront route, creation without scopes is
  400, a non-owner gets 403 on create and revoke; the developer page lists
  scopes, last use and usage at 390 and 1280 px.
- [x] **A-423** — **Done locally 2026-10-30.** Key lookup, usage limits and audit exported from `headless-api.ts`, not copied; no CORS headers, `no-store`.
  `src/lib/ops-api.ts`: `OPS_OPERATIONS` (one minimum scope
  each) and `validateOpsRequest`, sharing the key lookup, usage limits and
  audit of `headless-api.ts` (extracted, not duplicated); Bearer auth, no CORS,
  no origin allowlist.
  -> REQ: REQ-251 (constraints REQ-263) · deps: [A-422] · Done when: tests
  cover absent, malformed and revoked keys (401, no audit row) and an
  out-of-scope key (403 with an audit row); a storefront scope never satisfies
  an operations operation nor the reverse; a test fails when a route file under
  `src/pages/api/ops/v1` is not in the table.
- [x] **A-424** — **Done locally 2026-10-30.** Migration `0075` (schema 76). Applied by workerd D1 on a fresh install (`dev:local`) and to a copy of the A36–A38 demo D1 (20 orders backfilled). A test drives `order-lifecycle.ts`, `updateAdminOrderShippingStatuses`, `payment-switch.ts` and an admin edit; dropping the trigger fails it.
  Migration: `orders.updated_at` backfilled from `created_at`,
  kept by an `AFTER UPDATE` trigger (one place instead of every write path),
  index `(updated_at, id)`.
  -> REQ: REQ-254 · deps: [] · Done when: it applies to an empty local D1 and
  to the demo copy; a test updates an order through `order-lifecycle.ts`,
  `payment-switch.ts` and the admin PATCH SQL and sees `updated_at` advance
  each time; `EXPLAIN QUERY PLAN` uses the index for `updated_at > ?`. If D1
  refuses the trigger, stop and bring the alternative to Paduka.
- [x] **A-425** — **Done locally 2026-10-30.**
  Pure order serializer `src/lib/ops-order.ts`: attribution
  (`source_slug`, traffic source via `traffic-source.ts`, five UTM tags from
  `ad_click_ids`) and PII omission without `ops:orders:read_pii`.
  -> REQ: REQ-256 (constraints REQ-253) · deps: [] · Done when: tests prove a
  `ops:orders:read` payload has no name, phone, email, street address or click-id
  value, and a `ops:orders:read_pii` payload has them; UTM values match the stored
  JSON.
- [x] **A-426** — **Done locally 2026-10-30.** Browsing pages by `(created_at, id)`, syncing by `(updated_at, id)`; both walk an index. `scripts/measure-ops-orders.ts` (20k orders/27k lines, local workerd D1): a 90-day page read 37,930 rows when ordered by id, 399 now; every page ≤ 1,240 rows, ceilings in the script.
  `GET /api/ops/v1/orders`: filters (status, payment method/status,
  period by the admin rules, `source_slug`, `utm_campaign`, `kind`), opaque
  cursor, ≤ 100 per page, `updated_since`.
  -> REQ: REQ-254 · deps: [A-423, A-424, A-425] · Done when: a test pages 250
  fixture orders and sees each once; an order edited after `t` appears under
  `updated_since=t`; `rows_read` for a 90-day page is recorded and under the
  A40 ceiling.
- [x] **A-427** — **Done locally 2026-10-30.** Amounts and items equal the admin GET's; unknown number 404 with an audit row.
  `GET /api/ops/v1/orders/{number}`: items with recorded weight,
  payment, shipping, `payment_switched_*`.
  -> REQ: REQ-255 · deps: [A-423, A-425] · Done when: a test reads a fixture
  order and its totals equal the admin GET's; unknown number is 404 with an
  audit row.
- [x] **A-428** — **Done locally 2026-10-30.** Logic in `src/lib/adsbook-cli.ts`, entry `scripts/adsbook.ts`, contract in `docs/OPS-API.md` §5. The test drives the CLI through the real route handlers: `--json` equals the API page and detail, the file is 0600, a 401 key is not stored, no output carries the key (mutation-checked for the mode and a leak). The entry was smoke-run through `npm run -s adsbook` with a piped key, and the hidden prompt inside a pseudo-terminal (`script`): the key was not echoed.
  `adsbook` CLI (`scripts/adsbook.ts`, `npm run adsbook --`):
  `login`, `logout`, `orders list|show`, `--json`; credentials at
  `~/.config/adsbook/credentials.json` mode 0600; plain `fetch`.
  -> REQ: REQ-260 · deps: [A-426, A-427] · Done when: a test runs the CLI
  against the real route handlers (as `headless-client.test.ts` does) and its
  `--json` output equals the API page; the credentials file is 0600 and the key
  never appears in stdout or stderr.
- [x] **A-429** — **Done locally 2026-10-30.** `utmStatements`/`shapeUtm`/`utmReport` in `insights.ts`, tags normalised in SQL (`utmTagSql`: trim, lower, blank = NULL). Tests: `Promo-Okt `, `promo-okt`, `PROMO-OKT` share a row; a blank and a missing medium share a row; untagged (no JSON, click ids only, blank tags, broken JSON) is the last row; totals equal the landing report; the statement walks `idx_orders_created_at`. Mutation-checked (no `lower`, no `NULLIF`). `measure-insights.ts`: `utm-90d` reads 79,600 rows on the 20k fixture (ceiling 90,000, the landing screen's), route totals equal the independent arithmetic.
  UTM aggregation in `src/lib/insights.ts`: source / medium /
  campaign, drill to content, "(tanpa UTM)" row, trim + lower-case, same
  `orderRowSql()` and period rules; `GET /api/admin/insights/utm`.
  -> REQ: REQ-261 · deps: [] · Done when: tests prove `Promo-Okt ` and
  `promo-okt` share a row, untagged orders land in "(tanpa UTM)", totals equal
  the summary report for the same period; `rows_read` recorded on the
  locations-90d fixture.
- [x] **A-430** — **Done locally 2026-10-30.** `UtmView` in `InsightsReport.tsx`, nav child "UTM", `/admin/analytics/utm`. Headless Chromium on a seeded `dev:local` store: table at 1366 px and cards at 390 px, drill to content and back at both widths, no horizontal overflow, the sidebar link carries the period, empty state, error state (500) with retry; an advertiser opens it and its API answers 200, customer service is redirected and its API answers 403.
  Analitik › UTM screen (`InsightsReport.tsx`, nav entry,
  period carry) in the existing report idiom.
  -> REQ: REQ-261 · deps: [A-429] · Done when: browser run at 1366 and 390 px
  shows the table, the drill to content and back, empty and error states, no
  horizontal overflow; advertiser role can open it.
- [x] **A-431** — **Done locally 2026-10-30.** `src/lib/ops-openapi.ts` served by `openapi.json.ts` (ops key, no CORS, `no-store`); `ops-openapi.test.ts` fails on a path/method/scope mismatch in either direction and on a serializer field the Order schema does not name (three mutations each caught).
  `docs/OPS-API.md` (ownership row in AGENTS.md §2), OpenAPI
  3.1 at `/api/ops/v1/openapi.json` from the operations table.
  -> REQ: REQ-264 · deps: [A-426, A-427] · Done when: a test fails when a
  registered operation and an OpenAPI path disagree; `npm run docs:check`
  passes.
- [x] **A-432** — **Cancelled 2026-10-30** (Paduka: "headless tidak perlu di
  hapus"). The storefront routes stay; REQ-263 now asks for scope isolation,
  delivered by A-422 and A-423.

**v1.1**

- [x] **A-433** — **Cancelled 2026-10-30** with A-432; no per-install usage
  read is needed (PRD A45 Q1 moot).
- [x] **A-434** — **Done locally 2026-10-31.** Pure `src/lib/utm-link.ts` (Q3 lists, `normalizeUtmTag`, `buildUtmLink`), `UtmLinkBuilder.tsx`, page `/admin/ads/utm` (Iklan & tracking › Link UTM), pages listed as the sitemap lists them on the store's own origin. `utm-link.test.ts`: normalisation (diacritics, symbols, length), encoding, the page's own query and fragment kept, an existing `utm_*` replaced, refusals. Headless Chromium on a seeded `dev:local` store at 1280 and 390 px: medium follows the source, the stored campaign is shown, the copied link equals the field, the target page answers 200 for a product and a landing page, no overflow; Analitik › UTM links to it.
  UTM link builder in admin (landing/product picker, fixed
  source/medium list, normalised campaign, copy).
  -> REQ: REQ-262 · deps: [] · Source/medium list per PRD A45 Q3. Done when: a test of the pure
  builder proves normalisation and encoding; browser run at 390 and 1280 px.

**v1.1 — native landing pages** (PRD A45 Q5). The CLI works in an install's
own repository; nothing here builds, deploys or writes to a live store.

**A46 — pickup or drop-off at push** (PRD A46)

- [x] **A-445** — Push dialog (drop-off | pickup: date, hour, motor/mobil) on the
  order list (row, selection, "Push semua yang siap") and the order page;
  `parseMengantarPickupChoice`, `scheduledPickup` payload with `time_id` and
  `volume`, one slot per pickup address per request, accepted orders linked to
  `pickup_schedules`. -> REQ: REQ-271, REQ-273 · **Done locally 2026-10-31.**
  Tests: choice parsing and refusals, slot reuse vs booking, payload shape,
  schedule link (mutation-checked: a misspelt type and a 30-minute lead each
  fail). Browser against the local stand-in: three ready orders pushed as a
  14.00 car pickup, one schedule row, three resi. Not yet run against live
  Mengantar (needs Paduka's approval for one order).
- [x] **A-446** — `/time` slot per hour and either response shape: the shipping
  page sends date and hour through the shared picker; `resolveMengantarPickupSlot`
  no longer sends `"9:00 - 18:00"`. -> REQ: REQ-272 · **Done locally 2026-10-31.**

- [ ] **A-440** — Update manifest names the native landing page paths:
  install-owned `src/pages/<slug>.astro`, `src/styles/landing-pages/<slug>.css`,
  `src/components/storefront/landing-pages/<slug>/` per registered slug;
  `src/data/native-landing-pages.ts` under "Merge by hand"; root `scripts/**`
  product-owned (`docs/UPDATE-PATH-OWNERSHIP.md`, RELEASE.md §7 step that
  copies `src/**`).
  -> REQ: REQ-269 · deps: [] · Done when: a test reads the manifest and fails
  when any of those paths or `scripts/**` is missing from its section;
  RELEASE.md §7 names the register merge; `npm run docs:check` passes.
- [ ] **A-441** — `ops:catalog:read` scope; `GET /api/ops/v1/catalog/products/{slug}`
  and `GET /api/ops/v1/catalog/landing-pages` (CMS rows from `landing_pages`,
  native rows from the register, product-page claim), registered in the
  operations table and the OpenAPI document.
  -> REQ: REQ-268 (constraints REQ-251, REQ-264) · deps: [A-423, A-431] ·
  Done when: tests prove a `ops:catalog:read`-only key gets 403 on orders, an
  inactive product answers 200 `active: false`, an unknown slug 404 with an
  audit row, and no response carries section bodies.
- [ ] **A-442** — Pure checker `src/lib/native-landing-check.ts` (file ↔
  register, `validateNativeLandingPages`, `BaseLayout`, `MetaLandingTracker`,
  one `GeoIpResolvedForm` in `hybrid` or a waiver comment, no `fbq(`, no strict
  `catalogProductId(`, rupiah-literal and `noindex`/inactive warnings, named
  manual items) and `adsbook lp check [<slug>] [--json]`, adding the store-side
  items through A-441 when logged in. Orphan detection skips reserved and
  install route slugs.
  -> REQ: REQ-267 · deps: [A-428; A-441 for the store-side items only] · Done
  when: a test runs the checker over the shipped tree (no fail: the reserved
  form and sample routes are not orphans), over `contoh-landing.astro` as a
  registered entry (no fail), over a copy with one strict
  `catalogProductId(` (fail naming file and line), with an orphan register
  entry (fail) and with a second form (fail); the CLI exits non-zero on a fail
  and `--json` equals the library report.
- [ ] **A-443** — Template `src/lib/native-landing-scaffold.ts` (pure:
  slug + product slug → the three file changes) and `adsbook lp new <slug>
  --product <slug>`: refusals before any write, `isActive: false` entry,
  offline warning, next steps printed.
  -> REQ: REQ-266 (constraints REQ-267, REQ-269) · deps: [A-442] · Done when:
  a test proves the scaffold output passes A-442 with no fail and every
  refusal writes nothing; in a scratch copy of the repo `adsbook lp new
  promo-okt --product <seeded product>` then `npm test`, `npm run check`,
  `npm run build` pass and `/promo-okt` answers 200 in `wrangler dev --local`
  at 390 and 1280 px with no console error.

**v2 — act**

- [ ] **A-435** — Idempotency store (migration `api_idempotency`: key id +
  `Idempotency-Key` → status + body, 24 h) and `POST
  /api/ops/v1/orders/{number}/actions` for confirm, shipping status, cancel,
  switch payment, transfer received — each calling the admin's own library
  function.
  -> REQ: REQ-257 · deps: [A-423] · Done when: tests prove a repeated key
  returns the first result without a second write, each action matches the
  admin path's resulting row, and a write without `ops:orders:write` is 403.
- [ ] **A-436** — Dispatch to Mengantar and pickup scheduling under
  `ops:shipping:write`, through `mengantar-dispatch.ts`.
  -> REQ: REQ-257 · deps: [A-435] · Done when: against the local provider
  simulator, a repeated `Idempotency-Key` dispatch calls Mengantar once.
- [ ] **A-437** — CLI actions with `--dry-run` and `--yes`.
  -> REQ: REQ-260 · deps: [A-435, A-436] · Done when: a test proves
  `--dry-run` sends nothing and an action without `--yes` in a non-TTY exits
  non-zero.

**v2.1**

- [ ] **A-438** — `GET /api/ops/v1/reports/{summary|landing|products|locations|times|utm}`
  under `ops:reports:read`, reusing `insights.ts`.
  -> REQ: REQ-258 · deps: [A-423, A-429] · Done when: each report's totals equal
  the Analitik screen's for the same period.
- [ ] **A-439** — Outbound webhooks: owner-only endpoint registration in admin,
  HMAC-signed events from the write paths via `waitUntil`, cron retries,
  delivery log.
  -> REQ: REQ-259 · deps: [A-424] · Done when: a test proves
  the signature verifies, a failing endpoint is retried and never delays the
  order write, and the log records each attempt.

## Integration — parallel streams and one release

Added 2026-10-29 after the plan review. A36–A43 run as parallel streams on
their own branches from `feat/a35-a40-analytics-fit`; this section is how
they come back together.

**Migration rule for parallel work.** The chain must be gap-free
(`schema-version.test.ts`). Each stream names its migration `0068_<topic>.sql`
and sets `schemaVersion` to 69 on its own branch; tests find a migration by
its `_<topic>.sql` suffix, never by number. Integration renumbers them in merge
order.

- [ ] **A-419** — **Merged 2026-10-29** on `feat/a35-a40-analytics-fit`:
  s1 → s2 → s3 → s4 → s5, migrations renumbered `0068`–`0072`, `schemaVersion`
  73, route map regenerated; 1007 tests, check and build pass; the chain
  applies to a fresh and an upgraded database (node:sqlite). Browser run on the
  merged tree at 390/1280 (`scratchpad/evidence/integration*/`): COD order to
  `/thanks`, order detail (weight, source, warehouse), dashboard icon,
  `/admin/status`, a second warehouse quoting its province, source deep links.
  Post-merge fixes (Exceptions A-397/A-408): the admin courier re-quote and its
  preview quote the order's recorded weight; `/admin/orders` server-renders
  its deep-link filters. **Open:** A37 backend now passes locally in s1 but is
  uncommitted and not integrated; Analitik screen code now exists but its
  browser acceptance is in progress (tool restored; five-report demo smoke
  passed), and A38 panels remain open.
  A-363's recent-buyers commit `d408b32` exists in s2 but is not integrated.
  (2026-10-31: A38 cancelled; `d408b32` discarded, nothing left to integrate.)
  Upstream `c85fe5b`/`be08fc6` (Kelola backfill / 1.7.14) also remain to be
  integrated. Upstream CI run 40884103654 is now green. Merged 2026-10-30:
  STATUS resolved, maps regenerated, BUILD-LOG local entries renumbered 186–189
  (Entry 190).
  Before accepting backfill, address/review the proven first-50-row starvation
  and old-counter/all-age-send mismatch, and verify the settings UI and request
  duration against a synthetic receiver. No live Kelola call is authorized.
  This task's Done when cannot close yet.
  Merge the streams in this order: A36→A37→A38, A39 (+A-379),
  A41, A43, A42. Renumber migrations gap-free, set `schemaVersion`, regenerate
  the route map, resolve the known shared files (`auth.ts` route lists,
  `admin-navigation.ts`, `version.ts`, `order-persistence.ts`).
  -> REQ: all of A36–A43 · deps: every stream · Done when: `npm test`,
  `npm run check` and `npm run build` pass on the merged branch; `dev:local`
  with `dev:seed` passes; a Playwright run covers a COD order through the
  hybrid form, `/thanks`, the order detail, the dashboard, Analitik, the status
  page and Gudang at 390 and 1280 px; every protected suite passes unchanged.
- [ ] **A-420** — One release: version and changelog per `RELEASE.md` naming
  every migration, `STATUS.md`, `ARCHITECTURE.md`, `MENGANTAR_INTEGRATION_SPEC.md`,
  and the doc headers re-stamped. Deploying to any install stays a separate,
  per-install approval (`AGENTS.md` §5).
  -> REQ: all of A35–A43 · deps: [A-419] · Done when: the release notes list
  each migration and each behaviour change an operator will see.

