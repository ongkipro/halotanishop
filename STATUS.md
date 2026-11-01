# STATUS — AdsBookCMS

> Verified against disk: 2026-10-31 @ `d61afbe` (A38 cancelled; local development, not deployed; headless-browser evidence on a local store). Fleet evidence remains 2026-10-24 (1.7.13 on revenleather, zvarashop, taniniaga, agritani-shop, halotanishop, permatamall, numaskin-adbook, bavenshop, beranda-tani; zanobyshop on 1.7.2); not rechecked.

## 2026-10-31 — Local development (not deployed, not released)

`main` is at `6130c9d`-era 1.7.14 plus A45 (PRs #106, #108–#110: operations API,
`adsbook` CLI, Analitik › UTM, Link UTM). Not yet merged, stacked in this order
and pushed: `feat/compact-wa-follow-up` (one-tap WhatsApp chips, compact order
list), `feat/mengantar-pickup` (A46 pickup or drop-off push, `/time` slot fix),
`feat/admin-topbar-polish` (topbar, dropdown pickup fields, Link UTM polish,
Analitik table polish merged from `feat/insights-table-polish`, audit fixes),
`feat/storefront-compact-v2` (compact-market v2 storefront, BUILD-LOG 204),
`fix/ui-actions-audit` (admin UI-actions audit fixes, BUILD-LOG 205).
Schema 78 (`0077_orders_mengantar_handover`). Package version unchanged.

Audit 2026-10-31 (`docs/AUDIT-2026-10-31.md`, `docs/AUDIT-2026-10-31-tracking.md`):
fixed H-1 (late payment on a replaced AutoLaris instruction), M-1 (unknown
Mengantar push outcome blocks re-push), tracking H-1 (fresh-tab `/thanks`
Purchase for unpaid/cancelled orders), tracking L-2/L-6, M-10. Open findings are
rows `AUD-*` in `UNIMPLEMENTED_SPECS.md` §1. The admin UI-actions audit
(`docs/AUDIT-2026-10-31-ui-actions.md`, 2 high / 7 medium / 8 low) is fixed on
`fix/ui-actions-audit` except `AUD-UI-M2` (write path), `AUD-UI-TPL` and
`AUD-UI-L8` (Welcome chip).

Evidence: `npm test` 1096 pass on `fix/ui-actions-audit` (1091 before it), `npm run check` 0 errors / 0 hints, build
complete; 30 admin pages at 390 px without overflow or page errors; Mengantar
pickup push exercised only against the local stand-in. Not run against live
Mengantar, AutoLaris, Meta or Google; nothing deployed.

## 2026-10-30 — Local development handoff (not deployed)

A37 backend resumed in `adsbookcms-s1-a36-a38` at `7f59daf` plus uncommitted
work. A-349–A-356 verified locally; A-348 measured but its required commit is
not authorized. No change to the fleet/version statement above. Canonical
completion details: TASKS A37; reproducible cost figures: PRD A37; history:
BUILD-LOG Entry 186.

A-357–A-360 screen code now exists; A-361 SSR checks pass (1033 full-suite
checks, 0 type errors, successful build). The browser-tool blocker is resolved:
agent-browser 0.38.1 passes its doctor and native interaction smoke. An isolated
Tailscale demo on port 8795 has 11 synthetic products and 18 orders; login and all
five reports render, with no observed page errors. Landing captures exist at
390/1366px under `.wrangler/`. This is smoke evidence, not full acceptance.
Existing local store state and production were not modified.

Upstream review: origin/main is `be08fc6` (1.7.14, Kelola backfill, PR #101).
Merged into `feat/s1-a36-a38` on 2026-10-30 (BUILD-LOG Entry 190); the notes
below are the pre-merge review. After the owner made the repository
public, CI run 40884103654 passed check/tests/build; its earlier failure was a
billing-blocked job, not a test failure. The simulated committed-tree merge
preserves A41 recorded weights and schema 73; STATUS and generated route maps
conflict. Both histories used BUILD-LOG Entry 185; at the merge upstream kept
185 and the local entries became 186–189.

Further local QA: all five reports have zero document-width overflow at
390/1366/1536px on the synthetic data. Explicit Apply, period persistence,
keyboard province drill-down, product variant expansion, empty/reset and aborted
fetch/retry recovery are observed. Product desktop ranking is now a table;
Landing has a named focusable horizontal scroll region. Tests remain 1033/1033;
check 0/0/0, build, docs check and regenerated 131-route map pass. Existing eight
D1 fixture budgets pass unchanged. Full visual/role/theme/fixture acceptance and
selector-query accounting are still outstanding, not inferred from this smoke.

Review fixes (TASKS A37, 2026-10-30): 1039/1039 tests, check 0/0/0, build; the
8795 demo was restarted on the new build and the fixed paths were exercised in
the browser at 1366/390px. Demo D1 now holds follow-up rows written by that QA.

Next action: finish A-357–A-360 acceptance and richer historical/source/lead/return
fixtures. A38 (dashboard panels) was cancelled on 2026-10-31; its unintegrated
`d408b32` commit was discarded. Finish A-362 measurements and
browser proof before A-419/A-420. Local green tests are not release completion.

## 2026-10-29 — Variant weights across the fleet (A-391)

Read-only `wrangler d1 execute --remote` (one `SELECT` per database). A variant
"at 1000 g" carries the schema default unless an operator chose exactly 1 kg.

| Store | Variants | At 1000 g | Active products, every variant at 1000 g | Other weights in use (sample) |
| --- | ---: | ---: | --- | --- |
| zanobyshop | 64 | 63 | **34 of 34** | 981 |
| skincarebpom | 23 | 21 | **11 of 13** | 30 |
| revenleather | 208 | 9 | 3 of 79 | 400 … 1600 |
| halotanishop | 10 | 7 | 2 of 5 | 500 |
| taniniaga | 10 | 7 | 2 of 5 | 500 |
| zvarashop | 171 | 9 | 1 of 70 | 50 … 300 |
| agritani-shop | 13 | 4 | 0 of 4 | 250, 500, 2000 |
| beranda-tani | 8 | 4 | 0 of 4 | 500 |
| bavenshop | 67 | 4 | 0 of 27 | 100 … 450 |
| permatamall | 12 | 1 | 0 of 6 | 50 … 2000 |
| numaskin-adbook | 55 | 0 | 0 of 49 | 80 … 240 |
| cekat-shop, klikinaja | 0 | 0 | none | — |
| agritani-d1 | not an AdsBookCMS schema | | | |

- zanobyshop and skincarebpom quote almost every order at 1 kg per item. For
  skincare that is likely heavier than the parcel, so buyers there may be
  paying more shipping than the parcel costs. Their operators should confirm
  the real weights in the CMS; nothing was changed by this read.

## 2026-10-29 — D1 usage across the account (A-375)

Read-only `wrangler d1 insights <db> --remote --time-period 30d --sort-by reads`
over all 14 D1 databases in the account, summed per database and divided by 30.
Free-plan allowance per account and day: 5,000,000 rows read, 100,000 rows
written, enforced since 2026-09-01 (PRD A40 E1).

| Database | Rows read / day | Rows written / day |
| --- | ---: | ---: |
| revenleather | 6,455,221 | 35,567 |
| zvarashop | 3,985,578 | 10,512 |
| taniniaga | 1,196,574 | 10,846 |
| beranda-tani | 877,524 | 13,174 |
| agritani-shop | 552,111 | 10,662 |
| zanobyshop | 233,202 | 136 |
| permatamall | 86,639 | 1,105 |
| the other seven together | 143,069 | 1,416 |
| **Account** | **13,529,918** | **83,419** |

- Reads average **2.7×** the Free allowance and writes **83 %** of it. On Workers
  Free every D1 query in the account would fail for part of every day, so either
  the account is already on Paid or the fleet is failing daily. The OAuth token
  here cannot read the plan; Paduka confirms it in the dashboard (ADR-031).
- Heaviest reads, fleet-wide per day: the public landing-page list (2.75M, a
  correlated subquery per row), the social-proof 24-hour order count (2.13M; its
  `unixepoch(created_at)` predicate cannot use the index, so each run scans
  `orders`), the storefront catalog's full `product_variants` and `products`
  reads (2.02M and 1.61M), the CAPI outbox retention `DELETE` (1.98M, again a
  `unixepoch(updated_at)` scan), the schema check on `d1_migrations` (0.83M),
  `storefront_content` (0.60M), and the notification unread count (0.38M).
- Heaviest writes: the CAPI outbox (insert plus two updates per event, about
  58k a day together) and `rate_limits` (15k upserts and 3k purges).
- Raw JSON is not committed. Tasks A-381 to A-387 in TASKS act on these.

## 2026-10-29 — 1.7.14: Kelola plugin backfills old orders

- The Kelola webhook and hourly drain only cover the last 24 h, so orders taken
  before the plugin was switched on never reached Kelola. **1.7.14** adds
  "Kirim order lama" to `/admin/settings/plugins/kelola` (BUILD-LOG Entry 185).
  Not deployed to any install yet; the settings page has not been opened in a
  browser.

## 2026-10-24 — 1.7.13: manual transfer confirmation sends the Purchase

- Fleet on 1.7.13, all deployed 2026-10-24 with `placement: smart` now in every
  install's `wrangler.jsonc`: zvarashop `892b5e1c`, taniniaga `f5e5f989`,
  agritani-shop `5ff9537f`, halotanishop `221c80a2`, numaskin-adbook
  `c1abc162`, bavenshop `c5ae60ed`, beranda-tani `9450565d`, permatamall
  `613ca146` (from 1.5.11; production D1 went 62 → 67 migrations on the first
  request). Each: home, a sitemap product page with its form, and `/admin`
  (302) checked live. halotanishop and bavenshop repositories made private.
- **permatamall's GitHub Actions deploy cannot pass.** `deploy.yml` runs the
  strict preflight, and the repository's `CLOUDFLARE_API_TOKEN` cannot read D1
  ("could not read the production migration ledger"), so every push since
  2026-10-19 has failed. 1.7.13 was deployed from a workstation instead, and
  `deploy.yml` was then removed (permatamall `5499583`): it deploys by hand
  like every other install, and CI runs check, test and build only.

- Audit of revenleather D1, last 30 days: every `INV-` COD order (136/136) has
  a `sent` CAPI Purchase, fbc on 59 of the last 60. The 41 without one are
  `ABN-` abandoned leads, correctly. All 12 `manual_transfer` orders sat
  `pending` with no Purchase: the dashboard had no way to mark them paid.
- **1.7.13** adds "Transfer Diterima" to the order detail page for an unpaid
  manual transfer; the PATCH that marks it paid enqueues the server CAPI
  Purchase (TRACKING_SPECS §13). COD stays on `/thanks` by the owner's choice.

## 2026-10-24 — 1.7.12: sitemap and titles; 1.7.11 live on revenleather and beranda-tani

- 1.7.11 deployed: revenleather `49445725`, beranda-tani (petanisejahtera.com)
  `fe3f3f50`, both with `placement: smart`. The order path was walked to the
  submit button on both (hybrid form on Reven, middle form on Petani). No
  order was placed.
- **1.7.12** `canonicalSlug` on a native landing register entry keeps a second
  ad slug out of the sitemap: petanisejahtera.com listed
  `/aussie-formulabaru-evrpro`, whose canonical is `/aussie-formulabaru`.
  `withStoreName` stops legal page titles reading "… Petani Sejahtera - Petani
  Sejahtera".
- Lab caveat: local Lighthouse TBT is unreliable while other work loads the
  machine (load 13 measured); TTFB is network-bound and stays comparable. The
  keyless PageSpeed API quota is shared and was exhausted on both days.

## 2026-10-23 — 1.7.11: product pages and far colos (ADR-030)

- A PageSpeed pass over page.revenleather.com (Lighthouse mobile, every
  template) put product pages at 3.7-6 s to the first byte while the rest sat
  near 0.5 s. Cause, measured: Cloudflare served part of the Indonesian traffic
  (and all of PageSpeed) from SEA/SJC; `wrangler tail` showed 80-220 ms CPU in
  a 3.7-6 s wall, and a product page made nine sequential D1 reads to the APAC
  primary, the catalogue twice.
- **1.7.11** the catalogue is read once per request with its two queries in
  parallel, and the product page reads its landing claim beside the order
  count: nine sequential round trips become six (counted on `dev:local`). The
  template sets `"placement": { "mode": "smart" }`; the deploy preflight warns
  an install whose `wrangler.jsonc` has none. Also restores the type narrowing
  1.7.9 lost in `shipping-quote.ts`: `npm run check` had been red since 1.7.9
  while `npm test` stayed green, so both gates must run, never one.
- Not taken: delaying the Google and Meta tags (most of the 450-860 ms TBT on
  every page), because the ad signal is the product. SEO 69 on the revenleather
  run is its own `PUBLIC_SITE_NOINDEX`, by design.

## 2026-10-22/23 — 1.7.5–1.7.9: store mark and noindex opt-ins, IP preview, checkout resilience; revenleather drift

- **1.7.5** `PUBLIC_SITE_BRAND_MARK` shows a store's own mark beside the
  wordmark (root-relative or `https:` only; inverted on the light tone, sized
  by attribute because `h-7` resolves through an undefined `--spacing` in
  inlined CSS). **1.7.6** the home h1 and brand title read
  `tenant.defaultTitle`, so an empty tagline no longer leaves "Store — ".
  **1.7.7** `PUBLIC_SITE_NOINDEX=true` sends `X-Robots-Tag: noindex, nofollow`
  on every response (edge-cache hits and pages outside BaseLayout too) and
  BaseLayout's robots meta agrees. **1.7.8** bare IPv4/IPv6 hosts are never
  host-redirected, so a LAN or Tailscale preview opens.
- **1.7.9** A failed exact-district estimate no longer ends a COD checkout: it
  falls through to the existing city-average `ICO` fallback (prepaid still
  fails, it has no fallback); one test covers both. Manual transfer options
  carry fee text and the holder (`a.n. …`), and a single bank or VA renders as
  its own row instead of a one-item accordion. `GeoIpResolvedForm` passes the
  visitor province to the full form as it already did to the middle form.
  Rendered on `npm run dev:local` at 390 and 1440 px with no console errors; a
  checkout through the single bank row stored `manual_transfer` with that
  account.
- **1.7.10 — gates learned from revenleather.** `npm run deploy` now warns
  (does not refuse) with the product-owned files an install has edited since
  its last product merge, and `fleet:status` gains an `edits` column from the
  same `findProductOwnedEdits`. Install-owned paths and native landing pages
  (registered route files, their styles, the register and generated
  route-map/safelist) are not counted. First reading, 2026-10-23: revenleather
  49, zvarashop 27 (12 of them its own catalogue migrations `0067`-`0078`,
  which will collide by number with the product's next migration), taniniaga
  4 (research notes under `docs/spec`). The setup checklist owes "Aktifkan
  minimal satu kurir" when no courier rule is enabled: with every courier off
  the buyer saw only "Ongkir belum berhasil dihitung", which is what led a
  revenleather session (on a local D1 without courier rules) to make the quote
  allow every courier instead. Rendered on `dev:local` at 390 and 1440 px.
- **revenleather (`page.revenleather.com`) on 1.7.8, noindexed** because the
  brand's Shopify shop owns search for the same catalog. Its own commits on
  2026-10-23 edit 27 product-owned files under `src/` (checkout, header, footer,
  inner pages, thanks page) and this file's fleet header. Three of those
  ideas are in 1.7.9. Not taken, on purpose: allowing every courier when
  `courier_rules` is empty (the server accepts orders through the same rule
  check, and deny-by-default is the product contract), a store's bank account
  hardcoded as a client fallback, and slug lists or palettes compiled into
  shared components. The palette edits are the recurring gap (zanobyshop's
  `apply-store-palette.py` is the same need): installs fork components because
  the product has no per-store colour tokens. Its next product merge will
  conflict wherever both sides moved.

## 2026-10-21 — 1.7.3–1.7.4: uploads and province-scoped product pages cached at the edge; zvarashop back on the product line

- **1.7.4 (ADR-029 amendment).** The only visitor-dependent value in the SSR
  HTML of `/produk/<slug>` and single-segment landing pages (`/<slug>`) is the
  normalized two-letter Indonesian province code (`resolveProvinceCode` in
  `src/lib/geo.ts`), which picks the `middle` or `full` checkout form and
  prefills the province name in `GeoIpResolvedForm`. `edgeCachePath` now admits
  `/produk/<slug>`, and `edgeCacheRequest` appends `__prov=<CODE>` (resolved
  from `request.cf` or its fallback headers, never from the URL query string)
  for every path other than `/` and `/produk`. When `/produk/<slug>` rewrites
  to a claimed native landing page, the inner rewrite still carries
  `x-adsbook-product-page` and skips the cache, while the outer `/produk/<slug>`
  request caches the rendered 200 HTML under the product's province key. In
  `src/middleware.ts`, canonical host redirects and `readEdgeCache` now run
  above `ensureSchemaReady(identityDb)`, so an edge-cache `HIT` never pays a
  D1 `d1_migrations` read on a cold isolate.
- **1.7.3 (ADR-029 amendment).** `/assets/uploads/…` comes from R2 through the
  Worker, which the CDN does not cache: zvara.shop's home hero took 1.1-1.4 s
  to the first byte on every request. A served upload is now kept a day in the
  Workers cache (key = path) and answered at the top of the middleware, before
  the schema check, the store lookup and R2. Measured on the hero after deploy:
  `X-Edge-Cache: HIT`, 0.17-0.5 s to the first byte (a static `/images/` file:
  0.15 s); a missing key still answers 404 and is not stored. One middleware
  test covers miss, hit without D1 or route, the day-long edge lifetime and the
  uncached 404.
- **zvarashop 1.5.11 → 1.7.2 → 1.7.3 → 1.7.4.** Its own catalogue migrations held
  `0062`-`0073`, colliding with the product's `0062`-`0066`; a plain merge would
  have failed `validateMigrationChain` and answered 503 on every database route.
  Per ADR-024 the catalogue moved unchanged to `0067`-`0078` (schemaVersion 79)
  and the production ledger was rewritten in one batch: product `0062`-`0066`
  applied as their net DDL (`orders.source_page_path`, `plugins`; the
  `kelola_*` columns are added and dropped within the five, and never existed
  there), the twelve catalogue rows renamed in place. Rehearsed first on a copy
  of production D1: schema identical to a fresh product chain (77 tables), 72
  pages matching live on title, H1, prices, image count and variant ids.
  Backup `~/backups/zvarashop/zvarashop-d1-2026-10-21-pre-1.7.2.sql`.
  Deployed `4532afc2` (1.7.2), `4070cd45` (1.7.3), then `0c428689` (1.7.4);
  `/produk` answered 503 for about 13 s between the ledger batch and the new
  Worker. After: D1 79/79, 69 native pages, 73 routes 200 and 69 redirects 301
  as before.
- **zvarashop tests.** Three product fixtures (`rts-scoring`, `plugins/registry`,
  `plugins/kelola/sync`) replay the whole chain into an empty store; on this
  install they stop before `0067`, whose catalogue rows need store 1. The cut
  must move whenever the product's chain passes it again.
- **zvara.shop page speed (local Lighthouse 13.5, mobile, simulated, on 1.7.4).**
  CLS 0.000 everywhere. Direct HTTP/2 `X-Edge-Cache: HIT` TTFB on `/produk/<slug>`
  is 0.218-0.274 s (down from 1.0-3.8 s on a cold D1 render). Mobile Lighthouse
  scores (1.5.11 baseline → 1.7.4 warm edge): `/` 59 → 78 (LCP 4.71 s → 3.77 s,
  CLS 0.118 → 0.000), `/produk` 71 → 79 (LCP 3.86 s → 3.76 s, CLS 0.036 → 0.000,
  TTFB 368 ms), `/produk/wamena-oil` 59 → 84 (LCP 5.96 s → 2.44 s, TTFB 100 ms),
  `/produk/4g-lucky-spray-herbal-pria-dewasa` 74 → 87 (LCP 3.37 s → 2.18 s,
  TTFB 406 ms), `/produk/dragon-blood-cream` 77 → 83 (LCP 3.10 s → 2.54 s),
  `/produk/foam-pembersih-toilet-500ml` 71 → 80 (LCP 3.71 s → 2.07 s). The
  remaining Total Blocking Time (300-714 ms) is third-party ad tags (`fbevents.js`,
  `signals/config`, `gtag/js`).

## 2026-10-20 — 1.7.0-1.7.2: page speed; edge cache and font CLS

- **Measured, not guessed.** Mobile Lighthouse 12.8.2 (simulated Moto G Power,
  slow 4G) on all 21 public pages of petanisejahtera.com, once before and once
  after. PageSpeed Insights' own API was over its anonymous quota, so the
  numbers come from the same engine run locally. Lab scores move by about
  ±8 points between identical runs, so only the structural changes below are
  claimed.
- **Result.** Layout shift fell from 0.431 summed over the pages to 0.000 on
  every page (it was 0.18 on saratoga-anggrek, 0.14 on saratoga-padi and 0.10
  on saratoga-anthurium). The home page went from 74 to 92 (LCP 4.6 s to
  2.5 s). The mean over 21 pages moved only from 83.3 to 84.1: some pages gained
  (saratoga-anggrek +9, saratoga-padi +9, busukpucuk-simple +11), some lost, and
  the losses track which run landed on a cache miss.
- **1.7.0, edge cache (ADR-029).** A two-minute Workers Cache API copy of
  anonymous HTML for `/`, `/produk` and single-segment slugs, keyed without ad
  parameters, skipping the store lookup and render. `X-Edge-Cache: HIT|MISS`
  shows it. Hits reach the network floor (180-420 ms from Jakarta against
  150-400 ms for a static file), against 0.5-2 s uncached. The cache is per
  server inside a data centre, so a quiet store sees fewer hits than a busy
  one, and a lab run often lands on a miss. A miss still costs 1-2 s: that is
  the open item (see below).
- **1.7.1-1.7.2, font CLS.** Inter is preloaded and declared only as
  `font-display: optional` faces (latin, latin-ext). The first attempt kept the
  package's `swap` faces beside the `optional` ones and did not work: when an
  `optional` face is dropped, the browser falls back to the earlier face for the
  same characters, so both sets loaded and the swap still reflowed the headline
  (`document.fonts` showed both `loaded`). Removing the package CSS fixed it:
  CLS 0.000 in nine runs under 4G and 4x CPU throttling. Cyrillic, Greek and
  Vietnamese fall back to the system font.
- **beranda-tani images.** 38 landing images capped at 840 px wide (-1.4 MiB,
  hero 176 to 82 KiB), checked side by side at phone size. `scripts/shrink-images.mjs`
  repeats it for new images.
- **Not fixable in code.** Best Practices stays 79 on every page: Meta Pixel
  sets a third-party `fr` cookie. Total Blocking Time (220-530 ms) is almost all
  Meta: `fbevents.js` plus the 144 KiB `signals/config` script, which loads
  because Automatic events and Automatic Advanced Matching are on in Events
  Manager (the same setting fires the stray `SubscribedButtonClick`). Turning
  them off is an account setting for the owner.
- **Open.** The cache-miss path (1-2 s TTFB) is the next lever: count the D1
  round trips before the first byte, and try Smart Placement
  (`placement.mode = "smart"`) so the Worker runs near D1. Product pages and the
  geo form pages are not cached by design.
- **Fleet.** beranda-tani, numaskin-adbook, taniniaga, agritani-shop and
  zanobyshop run 1.7.2; `X-Edge-Cache` showed HIT on all five.

## 2026-10-20 — 1.6.5: one canonical domain; beranda-tani on petanisejahtera.com

- **Product.** `src/lib/host-redirect.ts` runs in the middleware before any
  store lookup. Every `http:` request 301s to `https:`. A host listed in
  `PUBLIC_ALIAS_HOSTS` (comma separated, `www.` implied) 301s to the origin in
  `PUBLIC_SITE_URL`, keeping path and query (UTM, fbclid). `/api/*` and local
  hosts are never moved, so webhooks and callbacks registered on an older
  domain still land. 4 tests; `INSTALLATION.md` documents the variable.
- **beranda-tani domains.** `https://petanisejahtera.com` is canonical, in
  `PUBLIC_SITE_URL` and in D1 `stores.site_url` (updated from
  `https://beranda.click`). `PUBLIC_ALIAS_HOSTS=petanisawit.com,beranda.click`.
  All six hosts (bare and `www`) are now custom domains in `wrangler.jsonc`;
  before this, only beranda.click was declared and the other two were attached
  from the dashboard. www.petanisejahtera.com and www.petanisawit.com had no
  DNS before; the deploy created it.
- **Verified live (Worker `dbdc44ae`).** http and www of every domain, and
  both alias domains, end on
  `https://petanisejahtera.com/<path>?<query>`. petanisawit.com used to answer
  plain http with 200. The two-hop cases come from zone rules that act first:
  Always Use HTTPS on beranda.click, and www→root on petanisawit.com. The
  canonical link, og:url and sitemap read petanisejahtera.com, and
  `/api/form-config` on an alias host is served, not redirected.
- **Form recheck (beranda.click, then petanisejahtera.com).** Full form
  `INV-10002`: Coblong auto-picked, iDexpress Rp7.800, COD Rp163.055. Middle
  form `INV-10001`. LP hybrid `/aussie-formulabaru` `INV-10003`, resolved to
  middle for a Jawa Timur geo-IP. In each case, the Pixel sent PageView →
  ViewContent → AddToCart → InitiateCheckout → Purchase. The CAPI leg sent the
  same, with Purchase `event_id` = order number. Since 1.6.4, `/thanks` redirects
  to wa.me/628820057575 with the invoice, name, and product + variant. A
  resubmission was deduplicated to the same order. The test dropped every
  Pixel beacon and answered `/api/meta-event` locally, and no conversion is in
  the outbox, so nothing reached the ad account. `INV-10001..10003` and the
  abandoned `ABN-10004` are named "TEST QA Jangan Diproses" and should be
  cancelled, not marked paid: a paid COD order sends a server Purchase.
- **Fleet.** beranda-tani, numaskin-adbook, taniniaga, agritani-shop and
  zanobyshop run 1.6.5, and http now 301s to https on every host.

## 2026-10-20 — 1.6.4: beranda-tani on 1.6.x; middle-form WhatsApp hand-off

- **beranda-tani** moved from 1.5.11 to 1.6.3 (`12ce4a7`, Worker `4da8b46c`). It
  passed `check` (0 errors) and `test` (859 pass). Its preflight registered all
  12 native landing pages, and D1 is at 67/67. The store holds a cron slot and
  has had 0 orders.
- **Live recheck on beranda.click.** A middle-form COD order (`INV-10001`,
  named "TEST QA Jangan Diproses") reached `/thanks`. The CAPI leg sent
  PageView → ViewContent → AddToCart → InitiateCheckout → Purchase, with
  `event_id` = order number. The test answered those `/api/meta-event` calls
  locally and dropped the Pixel beacons, so nothing reached the ad account.
  The browser Pixel calls `init`, `PageView` and `ViewContent`. Meta sends no
  beacon for a `HeadlessChrome` user agent; with a regular one, both `/tr`
  POSTs leave.
- **Bug: middle-form buyers were never sent to WhatsApp.** `form-middle.ts`
  marks every submission `lead_only` because its total waits on CS.
  `shouldAutoRedirectToWhatsapp` refused every lead-only record on the
  assumption that one has no order, which stopped being true when the middle
  form began creating orders. Hybrid shows the middle form to most provinces,
  so most COD buyers missed the hand-off. A lead-only record that carries an
  order number is now redirected.
- **Copy.** The COD note named the buyer's own number as if it were CS's. It
  now says CS confirms "ke WhatsApp Anda di nomor …".

## 2026-10-20 — 1.6.3: CRM variant and price; scheduler heartbeat

- **CRM templates.** The owner reported that the WhatsApp templates had no
  variant or price detail. Order detail sent only product titles. The list sent
  a summed price, and the default order-detail message said `Jumlah: 1` for
  every order. New variables are `{{varian}}`, `{{product_variant}}`,
  `{{jumlah}}`, `{{harga_satuan}}` and `{{rincian_pesanan}}` (one line per
  item), and both the order list and the order detail now pass the order lines.
  All eleven default templates name product + variant. Templates a store has
  already saved are left as they are.
- **Honest strike price.** `{{compare_price}}` fell back to price × 1.3, or a
  fixed Rp 180.000, which the UpSelling default sent as a discount. It is now
  the variant's own `compare_price` × quantity, or the price itself.
- **Scheduler heartbeat.** The hourly run stamps KV
  (`adsbookcms:scheduler:last-run:v1`), and the health panel shows "Tugas
  terjadwal". With no stamp it is `unknown`; with no stamp for more than 150
  minutes it is `degraded`. That makes a store like zanobyshop, with no cron
  slot, visible.
- **Verified locally.** On a fresh D1 with a 2 × 150ml order, all ten CRM
  buttons read "Paket Glow Up - 150ml". Welcome lists "Jumlah: 2 / Harga:
  Rp 150.000 / Subtotal: Rp 300.000", and Upsell uses the real Rp 360.000
  strike. The scheduler signal moved from never-ran to healthy after
  `/cdn-cgi/handler/scheduled`. 858 tests passed, 0 type errors, 0 console
  errors.

## 2026-10-20 — 1.6.2: Receiver Score refusals recover by themselves

- **Symptom (zanobyshop).** After a Receiver Score whitelist was reported, the
  admin still showed the not-whitelisted notice. D1 (read-only, 2026-10-20) had
  7 orders scored up to 2026-10-12 and 3 refused on 2026-10-19 16:48 UTC. The
  last order there dates from 2026-08-18. The key is the server secret, not
  a dashboard key.
- **Product bug.** The hourly backfill scanned only orders from the last 30
  days, so a store without recent orders never retried a refusal. Its health
  signal stayed `not-whitelisted` after access returned. Since 1.6.2 a stored
  refusal is retried at any age; the run still stops at the first refusal, so
  an account without access costs one call an hour.
- **Message.** The Cek WA text "Akses Mengantar untuk fitur ini belum aktif" is
  a live 403 from Mengantar, not a cached state. It now names the feature
  (Receiver Score, `getReceiverScoreByNumberUser`) and the key source. Mengantar
  whitelists per account and per feature, so a grant on another account's key,
  or on another feature such as `labelGeneration`, still reads as refused.
- **zanobyshop has no cron.** It runs 1.6.2 (Actions run 39303914041, D1
  67/67), but its `wrangler.jsonc` carries `"crons": []` on purpose. On
  2026-09-05 its slot went to beranda-tani, because the Free plan caps the
  account at 5 schedules. The 19:07 UTC run therefore never reached it, and
  the three refusals from 2026-10-19 16:48 UTC are unchanged. Its only
  recovery path is an admin page view. A refusal older than an hour is asked
  again when `/admin/orders` or the order is opened, and Cek WA asks live. A
  cron slot back (another store gives one up, or a paid plan) is an owner
  decision.
- **Fleet.** numaskin-adbook (`a7cf4b95`, after merging 15 native landing pages
  another session had published), taniniaga (`8abbbdd5`), agritani-shop
  (`bbd1014b`) and zanobyshop run 1.6.2.

## 2026-10-20 — 1.6.0: first-party plugins; Kelola uninstalled everywhere

- **What changed (ADR-028).** Optional integrations are now first-party
  plugins under `src/plugins/<id>/`. A store installs one at Pengaturan →
  Plugin (`/admin/settings/plugins`, owner only). Kelola CRM is the first
  plugin. Migration `0066` creates `plugins` and drops the six `kelola_*` core
  columns. Kelola's own `plugin_kelola_orders` table exists only on a store
  that activates the plugin.
- **Routing.** The route map went from 111 to 115 product routes. The four new
  ones are `/admin/settings/plugins`, `/admin/settings/plugins/kelola`,
  `/api/admin/plugins` and `/api/admin/plugins/kelola`, all owner/admin. No
  existing route changed path, auth or roles. Checkout and `/api/admin/settings`
  no longer import Kelola.
- **Verified.** 849 tests on the product, including `registry.test.ts`, which
  proves an unactivated plugin creates no table and sends no request. `check`
  reported 0 errors. A local browser run on a fresh D1 covered `/install`,
  install → activate → Kelola settings → deactivate (redirect) → remove data
  (`useConfirm`) → back to "Belum dipasang", plus 11 other routes at 200 and 0
  console errors.
- **Fleet.** numaskin-adbook (`bb2ac813`), taniniaga (`4618effa`) and
  agritani-shop (`619db41d`) run 1.6.0. Before the deploy, the `kelola_*`
  columns were confirmed empty on all three. After it, each has D1 at 67/67,
  0 plugin rows, 0 Kelola tables and 0 `kelola_*` columns. `/` and `/produk`
  answer 200, and the new admin routes answer 302 (page) and 401 (API) without
  a session. The other eight installs stay on their own heads; their next
  update runs `0062`–`0066` in order.

## 2026-10-20 — 1.5.12 on numaskin-adbook; Kelola push off until paired

- **numaskin-adbook** merged 1.5.12 (`94dc044`). The only conflict was in the
  generated route map, which was regenerated. It passed `check` (0 errors)
  and `test` (858 pass, 0 failing), then deployed as `998b5cad`. On the first
  request the Worker applied `0062`–`0065`, so production D1 is at 66/66.
- **Verified locally:** a PDP order stored
  `source_page_path = /produk/paket-clean-and-glow`. With no webhook pair,
  `kelola_attempts` stayed 0, so the push is inert as designed.
  `/produk` flows passed live with no console errors.
- **taniniaga and agritani-shop** merged 1.5.12 too. Each passed `check` (0
  errors) and `test` (848 pass, 0 failing). Each deployed with D1 at 66/66, and
  `/` and `/produk` answered 200. Kelola is unpaired on both, so it is
  dormant (ADR-027). The Kelola form fix (`516dec4`) is live on all three.
- **Kelola not paired yet.** The webhook URL and secret come from the toko
  settings in Kelola and are entered at `/admin/profile`. No other install has
  1.5.12 yet; the fleet table below records each one's own head.

## 2026-10-19 — Actions deploys run the preflight; beranda-tani defaults

- **A-327.** permatamall and zanobyshop now deploy from Actions via
  `npm run deploy`. The checkout tracks `origin/main`, so a stale re-run is
  refused as behind. A strict step fails the run when the preflight cannot
  read production D1. zanobyshop's run passed it (ledger 62, 0 native pages)
  and deployed `e37d97a8`. permatamall's run was refused at the strict step,
  with "could not read the production migration ledger"; its token lacks D1
  read. Nothing was deployed, and permatamall.shop still serves `17ddf59`
  (200).
- **beranda-tani (`0a65018`, version `07527aa9`).** The six petanisawit pages
  open their form on 1 Liter (SKU `AUSSIE1LITER`, as petanisawit did), and the
  stale "Spesial Promo Tahun Baru" headline now reads "Spesial Promo".
  Verified live on all six.

## 2026-10-19 — beranda-tani: six petanisawit.com landing pages

- **Ported.** `aussie-formulabaru`, `aussie-formulabaru-evrpro`,
  `aussie-edukasi1`, `busukpucuk-simple`, `aussie-busukpucuk` and
  `aussie-buahlandak` are now native pages on beranda.click under the same
  slugs (`3eb874a`), so ads change domain only. Each order form sells `aussie`
  (500ml Rp150.000, 1 Liter Rp275.000, as on petanisawit). The second ad
  slug, `aussie-formulabaru-evrpro`, is the formulabaru page again, canonical
  to `/aussie-formulabaru` (it was `noindex` while the sitemap listed it).
- **Strike prices.** Every petanisawit promo image strikes 550.000 (1 Liter)
  and 300.000 (500ml) against the official 275.000 and 150.000. D1 struck
  349.000 and 229.000, so the form contradicted the page above it. Aussie's
  `compare_price` is now 550000 and 300000 in production D1, and live forms on
  all eight Aussie pages show it. Selling prices are unchanged.
- **Deployed.** `npm run deploy`, preflight passing (ledger 62, 6 native pages
  before, 12 registered), version `f26d44ae`. Live at 390 px: all six answer
  200 with one `<h1>`, no overflow, no broken image, no console error; page
  heights match the Berdu source to the pixel (busukpucuk-simple) or differ
  by the form alone (+22 px).
- **Payment.** COD where the province allows it; elsewhere QRIS and VA through
  AutoLaris. Both were already live on beranda-tani (`/api/payment-methods`,
  buyer pays the fee). The store has no orders yet, so no AutoLaris
  transaction has run there; the key is a Worker secret, confirmable from
  `/admin` settings.
- **Follow-up (`d0c7e27`, version `72a4d6a3`).** The seven WhatsApp
  screenshots are now `WhatsAppChat` threads: transcribed text, with the
  customers' photos and avatars cropped from the originals. Three chats each
  render live on aussie-formulabaru(-evrpro), busukpucuk-simple and
  aussie-busukpucuk. The busukpucuk-simple countdown, an 8-minute timer that
  restarted on every visit, is removed. All six pages answer 200 with no
  console error or overflow.

## 2026-10-19 — fleet audit; 1.5.11 on all eleven installs

- **Audit.** 518 live product and landing pages across ten stores were
  rendered at 390 px (klikinaja has no products yet). No page had a form,
  variant, price, `<h1>`, title or overflow defect: every order form names
  its page's product, with D1's variant ids and prices.
- **Fixed.** permatamall `/ken-total` referenced its 18 images under
  `/assets/` (R2, where none exist) instead of `/images/`, so the page showed
  no photos (`17ddf59`). Five taniniaga CMS landings sent `/x` on every view
  through a script-carrier image; 1.5.11 removes that request.
- **Deployed.** Nine installs deployed by `npm run deploy`, with preflight
  passing on each (zvarashop: ledger 74, 69 native pages). permatamall and
  zanobyshop deployed through Actions with success. All eleven answer 200.
  Live checks: ken-total shows 18/18 images with no 4xx. The five taniniaga
  landings make 0 requests to `/x`, and their CTA still scrolls to the form.

## 2026-10-19 — 1.5.10 on all eleven installs; zvarashop recovered

- **Fleet.** All eleven installs run 1.5.10 and answer 200 on `/`. The seven
  manual installs deployed with `npm run deploy`, and the new native-landing
  preflight passed on each. permatamall (`439aa3b`) and zanobyshop
  (`cc533db`) deployed through Actions with success.
- **zvarashop unblocked.** Production's missing source was rebuilt from
  production itself: migrations `0069`–`0073` from the D1 rows each one
  introduced, 55 landing route files from their live renders, plus the 14
  already in the repo (production had redesigned them), 258 missing images
  and 52 stale ones. `install/zvarashop` `5028026` (merge `0c65489` + restore).
  Before deploy, a local Worker on a copy of the catalogue matched all 69
  pages token for token, whitespace included; 390 px screenshots differed only
  in countdown, random stock bar and the order-count toast. Deployed version
  `0deb08bb` (rollback point `b0a2cb2f`). After deploy, all 69 live pages and
  home, catalogue, legal, thanks and payment still match the pre-deploy
  capture; 69 native rows and 69 product-page claims intact.

## 2026-10-16 — 1.5.9 on ten installs; zvarashop still held

- **Fleet.** The ten installs below run 1.5.9 (`fd652b4`): 0 behind, schema
  62/62, `/` and `/produk` answer 200. Each passed `check` (0 errors) and
  `test` (0 failing) before deploy; permatamall and zanobyshop deployed
  through Actions (success).
- **One h1.** A live scan after deploy counted one `<h1>` on taniniaga
  `/saratoga` and `/aussie-sawit`, zanobyshop `/bibit` and `/lem-jaysuing`,
  and agritani `/perisai-anti-bulai`.
- **agritani.shop configured.** Four products imported from taniniaga, plus
  Mengantar key, warehouse, couriers, support WhatsApp, fee bearers and the
  BCA account set to match taniniaga. Pixel/CAPI and logo are still empty,
  and no end-to-end order has been placed yet.
- **1.5.10** (product only, not yet on installs): `npm run deploy` refuses
  when production lists native landing pages that the register does not, so
  the zvarashop loss can no longer happen through the preflight path (A-326).
  The Actions installs still skip the preflight (A-327).
- **zvarashop** is unchanged from the entry below: repo at 1.5.5, production
  on its 2026-10-14 version with `0069`–`0073` applied. Those migrations are
  data-only, and production carries 55 native landing rows that are absent
  from the repo's register. Deploying the repo as it stands would let the
  hourly reconcile delete them. It waits on the device that deployed it
  pushing its code and migrations.

## 2026-10-15 — 1.5.5 and 1.5.6 on ten installs; zvarashop held

- **Fleet.** agritani-shop, beranda-tani, carukesi, klikinaja,
  numaskin-adbook, permatamall, revenleather, skincarebpom, taniniaga and
  zanobyshop run 1.5.6 (`f3770e7`): 0 behind the product, schema 62/62, `/`
  and `/produk` answer 200 on every host, and each passed `check` (0 errors)
  and `test` (0 failing) before deploy. `fleet:status` agrees.
- **New on the line.** `agritani.shop` (`ongkipro/agritani-shop`, branch
  `install/agritani-shop`, Worker `agritani-shop`) was installed today; the
  owner ran `/install` (store "Agritani Store"). Support WhatsApp, warehouse,
  Mengantar/AutoLaris keys, couriers, Pixel/Ads and products are not set yet.
  `page.numaskin.id` (`ongkipro/numaskin-adbook`, `main`, manual deploy) was
  set up by another session the same day and moved 1.5.4 → 1.5.6 here.
- **zvarashop held.** Its production D1 has `0069`–`0073` applied from another
  device; those files are in no repository. The 1.5.5 deploy answered 503 and
  was rolled back with `wrangler rollback`; it runs its 2026-10-14 version.
  `origin/install/zvarashop` carries the 1.5.5 merge (`6006be7`), undeployed.
  The 1.5.6 preflight refuses that deploy by name. Unblocked only when the
  five files are committed from the source device.
- **RTS risk.** Mengantar's Receiver Score is whitelist-only; every store key
  gets `403 Not allowed`. Since 1.5.5 the order detail and the
  `receiver-score` health signal say so, and the hourly backfill catches up
  once an account is whitelisted. Taniniaga and carukesi each recorded one
  refusal in production after deploy, as designed.
- **Open.**
  - Ask Mengantar CS to whitelist Receiver Score for each store account.
  - permatamall and zanobyshop deploy from GitHub Actions with a bare
    `wrangler deploy`, so the ledger preflight does not run there; their
    ledgers were checked by hand this time.
  - The 1.5.6 order-detail change (no "Skor Mengantar -") was not seen in a
    browser.

## 2026-09-30 — three installs on the product line; landing, form, courier and signal fixes

- **Fleet.** taniniaga, zvarashop and carukesi run product `dd83acd` from
  their own checkouts, D1 migrated through `0061`; local, GitHub and Cloudflare
  agree for all three. zvarashop rejoined the product line after running its
  own fork since `93c110d` (273 commits behind): its store-authored `0055`–`0057`
  data migrations left the chain and their ledger rows were deleted right after
  deploy (ADR-024 pattern), rehearsed first on a local import of the production
  export. carukesi gained eleven native landings copied from the reference
  install. permatamall, zanobyshop, skincarebpom and beranda-tani were not
  updated in this pass.
- **Shipped to those three.** An optional WhatsApp hand-off from `/thanks` for
  COD orders (`0060`, off by default); product-page redirects as a cacheable
  `301` that keeps `fbclid`/UTM; a landing served as a product page keeps the
  visitor's province, so its hybrid form resolves; pages may not render a form
  component outside `GeoIpResolvedForm` (twelve taniniaga landings did); CMS
  landing images deferred below the first; native landings reach the sitemap
  from the hourly cron without moving `lastmod`; the AutoLaris Advice run checks
  new and recent instructions instead of the same 25 oldest; alerts name their
  store; Ninja removed (`0061`) and a fresh install enables JNE and J&T only —
  existing stores keep their own courier policy.
- **Verified live.** All landings on the three hosts carry the Pixel bootstrap
  and a ViewContent id present in the catalog feed (37/37); browser and server
  `event_id` pair on PageView, ViewContent and AddToCart; inactive products are
  absent from both feeds and the sitemap; the hourly cron runs on all three.
- **Open.**
  - The WhatsApp hand-off, the `_fbc` cookie after a redirect and PageSpeed
    scores were not exercised in a browser: headless Chrome on the working
    machine could not load any page, and the anonymous PageSpeed API quota was
    spent.
  - One test fails intermittently (once in several full runs, different
    stores, passes on re-run); not yet identified.
  - Meta Events Manager: automatic events and a Conversions API Gateway are
    still on for the taniniaga and zvarashop pixels; carukesi's pixel refuses
    its own domain (traffic permissions), so only CAPI reaches Meta there.
  - zvarashop: 0 of 92 QRIS orders ever paid; AutoLaris confirms them unpaid.
    A business question, not a defect.
  - Response times rose during Cloudflare's Asia-Pacific incident of the same
    days (Jakarta under maintenance); Worker CPU stayed 13–75 ms.

## 2026-09-26 — checkout tracking re-verified, admin type and phone layout

- **Checkout → thanks tracking** (this change, A-311): the three forms driven
  from their legacy URLs to `/thanks` with the Meta and Google tags stubbed
  locally. 308s keep `fbclid`/`gclid`/UTM; PageView, ViewContent, AddToCart
  and InitiateCheckout fire on Pixel, CAPI and GTM; one `INV-` Purchase on
  Pixel, CAPI and Google Ads, none on reload; QRIS silent until the hourly
  Advice job marks it paid. **Fixed:** without Web Crypto the checkout scripts
  lost AddToCart/InitiateCheckout on all three legs, and `/thanks` sent Google
  blank hashed keys. Not observed: CAPI delivery to Meta, a live Google Ads
  account.
- **Admin type anatomy and buttons** (`499f2ee`, A-309/A-310): five sizes,
  weights 400/500/600, a 12px floor, Inter 500 loaded for admin; `.btn-*` and
  `buttonVariants()` own button geometry; phone filters and KPI tiles two-up.
  All guarded in `admin-controls.test.ts` (DESIGN-SYSTEM.md §7.1).
- **Responsive sweep** (this change, A-312): eight admin pages at twelve
  viewports, 320–2560px and phone landscape — no horizontal overflow; bottom
  nav below 768px, icon rail to 1023px, full sidebar above, content capped at
  1560px. The one defect, hand-built header links wrapping at 768px, fixed and
  guarded. The rate checker's optional COD value field is gone (A-312).
- **Social proof is real** (this change, A-300): the purchase toast states the
  store's actual orders in the last 24 hours, product-free, and nothing under 3;
  the twenty invented buyers are gone.
- **Confirmations and payment copy** (this change, A-305, A-313): destructive
  admin actions confirm in a shadcn dialog; the seller bank form is stacked
  with bank logos; COD reads as 3,33% of price + shipping, VAT included.
- Open: a real-phone check. The orders table still scrolls
  at 1440px; its row actions are now pinned.

## 2026-09-26 — couriers, dev data, and the admin UI contract

- **SPX through Mengantar** (`784b0dc`, A-296): quoted as `spx`, default rule
  and migration `0059`; create-order is confirmed by Mengantar support and not
  yet observed on a live order.
- **Pos Indonesia COD refusal** (`95fa341`, A-297): the documented 403 is
  recognised at dispatch, the reason and delivered rate are kept on the order,
  and COD Pos is switched off at checkout. Not observed from a blocked account.
- **`npm run dev:seed`** (`dc85a38`, A-298/A-299): a running `dev:local` store
  filled through its own HTTP surface; the audit on it fixed checkout-button
  readiness disagreeing with the endpoints, two false copy claims and eleven
  unnamed controls. Dead code removed (A-301).
- **Admin UI** (`fd18362`, `5136e64`, A-302–A-307): every dropdown and
  search on shadcn, one page width (AdminShell), one radius, one 40px control
  height owned by the primitives, `FilterBar`/`SearchInput` for toolbars, all
  guarded by `admin-controls.test.ts` and `admin-page-width.test.ts`
  (DESIGN-SYSTEM.md §7.1). Open then: A-300 (since closed), A-305 (`window.confirm` on four destructive actions),
  the last orders-table column clipped at 1440px behind its scroll.

## 2026-09-25 — local development complete (`b504340`)

`npm run dev:local` runs the whole store on this machine with no account
anywhere: local D1/KV/R2, stand-ins for Mengantar and AutoLaris, the scheduled
handler on demand. Driven end to end in headless Chrome — install, warehouse,
product with an R2 upload, COD through both checkout forms, QRIS through
payment and the hourly reconciliation to `paid`, and dispatch with waybills.
A landing page with two forms submits from the second one correctly. That run found six defects (A-294), all fixed; A-283 and A-284 closed; A-286
partly. Gates: **754 tests**, `astro check` 0/0/0, build complete.

## 2026-09-25 — one-click install (ADR-026, `b504340`)

The store now installs like WordPress, with Cloudflare as the host: a **Deploy
to Cloudflare** button copies the repository, provisions D1/KV/R2 and deploys;
the operator types one secret (`INSTALL_TOKEN`), opens the `workers.dev`
address, finishes `/install`, and follows the dashboard's **Siapkan toko**
list. `AUTH_SECRET` is generated by the Worker when unset (`0058`).

Proven locally: build; `wrangler deploy --dry-run` resolving every binding; a
fresh local D1 with only `INSTALL_TOKEN` through `/install`, login and the
dashboard checklist (390 px, no overflow, no console error); the generated key
in `install_secrets`. **Not proven:** the button against a real account (A-292).

## 2026-09-25 — full-system audit (`b504340`)

A five-lane read of the whole tree (money path, security boundary, ad signal,
storefront/admin, docs vs disk) found 38 defects. Every one fixed here was
re-read against the code and has a test or a rendered check; the rest are
recorded as open tasks with their evidence (`TASKS.md` A-270 … A-286).

- **Security.** An `advertiser` could store `<script>` in a landing-page HTML
  section that ran on the admin's origin (owner takeover). HTML sections are
  now owner/admin only. Home-content links refuse `javascript:`/`data:`.
  Login and install-token limits are now spent atomically up front, so a
  parallel burst no longer slips past a stale peek.
- **Money.** A voided COD order could still be dispatched; manual-transfer
  orders could never be marked paid; headless QRIS/VA created no payment; the
  provider COD fee was charged twice by headless checkout, CS conversion and
  admin courier edits; paid or already-dispatched orders could be deleted; CS
  conversion ignored the COD-province policy; prepaid buyers could check out on
  a placeholder courier that could never ship.
- **Signal.** A funnel event could make a real Purchase dedupe away
  (`0057`); an embed reload erased a stored `gclid`; retries restamped
  `event_time`; immediate delivery could race the drain; the Google outbox had
  no alert; one failed cron step skipped everything after it.
- **Multi-tenant remnants removed** (`X-Tenant-Slug`, `PUBLIC_TENANT_SLUG`,
  unused `tenantSlug`), `INSTALLATION.md` §10 no longer offers one repository
  deploying several stores, and A-50/A-52 are closed on ADR-020.

Gates: **741 tests passing**, `astro check` 0/0/0, `tsc` clean, build complete,
route map regenerated. Local dev server: every public page 200 with a body; the
middle and hybrid forms, `/thanks`, `/` and a product page run with zero
console errors in headless Chrome, and a middle-form submit is intercepted
rather than posted natively. Not done: a two-form landing page in a browser,
admin pages in a browser (no local operator credential was used), and any
live provider or deploy.

## 2026-09-09 — task execution and public-readiness pass

Four ledger items closed, and the engineering-gap table is down to three rows,
all three genuinely blocked on a decision or a live provider rather than on
effort.

- **T248** — a committed order could lose its own confirmation.
  `sessionStorage.setItem` sat outside the try/catch and *after* the order
  reached D1, so a browser that refuses storage stranded the buyer on the
  spinner with a real order behind them — and because the server Purchase is
  only triggered from `/thanks`, neither leg fired. Guarded; both forms now
  carry the locator in the URL fragment so `/thanks` can recover an order the
  way `/payment` already could. The task's `?order=...` clause was
  **deliberately not built**: it is superseded by a decision that keeps order
  identifiers out of any URL a server or referrer can read.
- **T249** and **A-58** — no code change was needed; what they lacked was
  somebody opening the page. Both are now closed with browser evidence.
- **DOC1** — `DESIGN-SYSTEM.md` re-extracted from the tree rather than
  restamped.
- **A-227** — the Google Ads outbox has a health signal for the first time,
  which is the absence that let a head-of-line block go unreported.

**Public-readiness sweep.** No `.env`, `.dev.vars`, `.pem` or `.key` file is
tracked. No credential pattern appears in any tracked source, config or
document. `wrangler.jsonc` carries zeroed placeholders and the product's
placeholder worker name, which is what stops it being deployed as if it were an
install. `.env.example` was checked **without reading its values**: every
credential key holds a snake_case descriptive placeholder, and the lengths do
not match the real formats those credentials take — a Cloudflare account ID is
32 hex, a D1 database ID a 36-character UUID, a Meta CAPI token base64url, and
none of them contain underscores.

Gates at the time of writing: **679 tests passing**, `astro check` clean across
the tree, build passed, route map regenerated.

## Where this stands, for whoever picks it up next

**Committed and pushed** through `93ccb52`. Working tree clean. BUILD-LOG
Entry 175 covers the 2026-09-07 pass, tasks **A-257 … A-266** done, **A-267**
and **A-268** open.

**What changed, in one line:** everything the two forked installs had proven
in production — checkout dedupe, Meta identity on late Purchases, a claimed
and purged CAPI outbox with recovery, hourly AutoLaris reconciliation, Pixel
ID verification, notification floor, a preflight that refuses a stale tree,
Purchase eligibility and order-owned content_ids — is now the product's, and
the four installs tracking `main` run it. Start any audit at
`docs/ROUTE-MAP.md`.

**The two open decisions are A-267 and A-268.** A-267 is the fleet's Meta
Pixel loading strategy — deferred here, synchronous on two installs — and is
the owner's call, not a port. A-268 brings `zvarashop` and `zanobyshop`
forward; their behaviour is upstream, so what remains is pages and config,
each in its own release session with a backup.

**Still unobserved on this product:** a settled AutoLaris Advice response, and
a real Purchase's event match quality in Events Manager. Both are one live
order away, not another local pass.

**Do not run `npm run deploy` here** — it refuses, correctly. This repository is
the product and its `wrangler.jsonc` is placeholders; an install deploys from
its own clone (RELEASE §1).

---

> Last executed baseline: 2026-08-29 @ `9766ad6`.
> `npm run check` 400 files / 0 errors / 0 warnings / 0 hints · `npm test`
> 618 / 618 · `npm run build` Cloudflare server bundle complete · local
> `wrangler dev` run: fresh install applied `0049`–`0050` (51 claims),
> login/logout/session revocation, local district search, the 60/min and
> 5/10min public limits, and a recorded AutoLaris callback all observed.
> Landing builder local proof: a Tailscale HTTP fixture had no
> `crypto.randomUUID`, yet Headline insertion created a selected canvas card
> without a browser error or mobile horizontal overflow. The fallback applies
> only to transient unsaved section IDs; D1 remains the durable ID authority.
> The local landing canvas now reports its section count and offers numbered
> focus navigation; section cards remain directly selectable and movable with
> up/down controls, with no drag-only interaction.
>
> Ad signal audit 2026-08-28 (BUILD-LOG entries 89 and 90). Three signal
> paths were losing conversions silently and are now fixed and covered:
> Google Ads offline discovery was head-of-line blocked and uploaded nothing
> once fifty unattributable orders accumulated; the headless
> `/api/v1/tracking/events` Purchase never opened a connection to Meta at all
> while answering `200 { queued: true }`; and a plain `?utm_source=` link
> erased a stored `gclid` before the COD sale it belonged to was confirmed.
> One legacy product row no longer 500s both catalog feeds.
>
> Landing builder browser proof: a page carrying all five typed section kinds
> plus legacy `html` and `form`, served by `astro dev` against local D1, in
> headless Chrome at 390 px / DPR 2.625 — semantic markup, one checkout form
> with 18 fields, zero horizontal overflow. Headline sizes rendered 18/20/24 px
> only after `.lp-headline-*` was scoped to `.lp-section`; before that all
> three rendered 20 px. Fixture rows were removed from the local D1.
>
> Admin editor proof (BUILD-LOG entry 91): a headless-Chrome operator session
> against `astro dev` and local D1 — login, product picker, section insertion,
> the numbered navigator, save and redirect, zero console errors. A list ending
> in the operator's closing Enter now saves (`400` before the fix); a headline
> containing markup answers `400` with an Indonesian message and keeps the
> draft on screen. At 390 px the login page, the empty editor and an editor
> holding all seven section kinds each measured `scrollWidth === clientWidth`.
> The session's throwaway `auditbot` account and every fixture row were removed
> afterwards; the local D1 ends as it started.
>
> Upstreamed from the zvarashop install (BUILD-LOG entry 92): the browser
> Purchase was matching on one key, not eight — `fbq('init')` is honoured once
> per pixel id and three files init'd behind the pixel's bootstrap, so their
> hashed matching was discarded. Probed against the live `fbevents.js`: one key
> before, eight after. The conversion also no longer waits on the 2.5 s
> deferral, and a minted `<phone>@<store host>` provider address is no longer
> hashed into Meta's `em`.
>
> **Open decision (A-202):** the install repo added a deploy preflight after
> `wrangler deploy` uploaded a stale tree over a live release. AGENTS.md says
> this repository deploys nothing, yet `deploy`/`cf:deploy` exist here and
> `wrangler.jsonc` is the `adsbookcms-your-store` placeholder. Scripts out, or
> guard in — not decided here.
>
> Product audit (BUILD-LOG entry 93). `/api/meta-event` was the only public
> POST with no rate limit — an unauthenticated caller could write unpruned
> outbox rows, burn CAPI quota, and push fabricated funnel events into a
> merchant's pixel. Now 60/minute per IP. Admin authorization, SQL construction,
> the checkout price boundary, the payment webhook and the fee math were swept
> and found sound.
>
> The whole signal chain was then run rather than reasoned about: Pixel
> `Purchase` on `/thanks` carried `eid=INV-19001` byte-identical to the CAPI
> leg, `value=135000` (goods, not the 214000 invoice), and eight `ud[...]` keys.
> That run caught a hole in this session's own earlier fix — a minted
> `<phone>@<host>` address still reached the CAPI payload because minting used
> two different hosts. Fixed and re-verified.
>
> Validation audit (BUILD-LOG entry 94). `getStorefrontProduct` ran the
> *throwing* catalogue id inside a `.find` predicate, so one legacy product row
> answered 500 on the product page, the landing page, every form route,
> `/api/form-config` and `/api/v1/products/<slug>` — the whole storefront, not
> that row's page. Four sibling escapes fixed with it, and an allowlist scan now
> stops a sixth. Landing-page fields are bounded and must name a product the
> store carries; `maskSecretValue` no longer discloses most of a short secret.
>
> Entry 95: `npm run deploy` and `npm run cf:deploy` now refuse a target still
> carrying the product's placeholder Worker name, D1 name/id or R2 bucket —
> mechanising the check RELEASE §7 already required and admitted nothing
> enforced (A-202). Province gating, which decides where COD is offered, had no
> test at all; all 38 district-catalog provinces resolve today and the constant
> matches migration `0017`, both now asserted, because the district data is
> external and Papua's split already forced one catch-up.
>
> Forward backlog (BUILD-LOG entry 96, `TASKS.md` §Forward backlog): 22 items
> across QA, security, Cloudflare, Meta Ads and Google Ads, each grounded in
> the tree. Highest value is **A-227** — the Google Ads offline outbox has no
> health signal and no alert, which is why entry 89's head-of-line block was
> invisible. Five items are marked as needing an ADR that does not exist yet.
>
> **Not verified: no live Meta, Google Ads or Merchant Center call was made —
> the pixel id used was valid in shape only, so what is proven is what leaves
> the browser and what this app enqueues, not what Events Manager reports.
> Landing image upload was not exercised; it needs an R2 bucket the local run
> does not bind.**
>
> `main` was re-founded as AdsBookCMS and its history rewritten (ADR-012), so
> commit ranges older documents cite may not exist on this branch; the
> previous 61 commits are preserved on `backup/pre-history-rewrite`.

Current state of the system. Implemented behaviour lives here; history lives in `BUILD-LOG.md`; remaining work lives in `UNIMPLEMENTED_SPECS.md`; structure lives in `ARCHITECTURE.md`.

The previous version of this file described a different repository — it opened by declaring the project to be another merchant's preview deployment, listed that merchant's catalog as this store's, and cited a D1 database belonging to a different account. It has been rewritten from the tree rather than patched.

---

## 1. What this repository is

| Field | Value |
| --- | --- |
| Product | AdsBookCMS (single) |
| Repository role | **Product.** Deploys nothing; CI runs check, test and build only |
| Install model | 1 installer = 1 Worker = 1 store (ADR-001) |
| Version | `1.5.12` / `2026.10-landing-hero-h1` (`src/lib/version.ts`) |
| Schema | 66 migration files, `0000`-`0065` |
| Bindings | `OMS_DB` (D1), `SESSION` (KV, caches only since ADR-021), `ASSET_BUCKET` (R2), `AI`, `ASSETS` — names fixed across installs |
| `wrangler.jsonc` | template of placeholders; each install supplies its own resources |

### Known installs

**2026-08-27 incident.** Every install answered `500` on `/api/locations`
(kecamatan search) and on the `/hello` login POST. Cause: `KV put() limit
exceeded for the day` — the account-wide Free-plan KV write allowance, shared
by twenty-one namespaces, was exhausted; each keystroke in the kecamatan field
and each login was a KV write. Fixed in 1.3.2 by ADR-021 (sessions and counters
in D1, KV writes best-effort, no counter on the local district search). The
rollout was completed the same day.

**2026-08-27 rollout of 1.3.2 (product `189ec2f`).** All six installs deployed
from their own checkouts — carukesi, skincarebpom, taniniaga by merging
`product/main`; permatamall, zanobyshop, zvarashop by applying the product
diff (`wrangler.jsonc` and `RELEASE.md` untouched, dry-run confirmed each
Worker's own bindings). Each passed `check`, `test` (579–580; the product
carries 581) and `build` before `wrangler deploy`. Measured live afterwards on
every host: `/` 200; `/api/locations?level=district` 200 with 94 results;
provider-path search 200; wrong-password login **401** (was 500);
unauthenticated `/api/admin/health` 401; `/api/order-status` 404 (was 500);
sixth wrong password **429** — which proves `rate_limits` from migration
`0049` is live on each D1. Operators must log in once more; KV sessions were
not migrated.

**2026-08-27 rollout of 1.3.3 (product `1acbd7e`).** Same six installs, same
two update shapes; zanobyshop needed `git apply --3way` because it carries its
own payment-page palette across `src/`, and taniniaga's merge conflicted only
on a document stamp line. Each passed `check`, `test` (581–582) and `build`
before deploy. Measured live afterwards on every host: a JSON POST to
`/api/webhooks/autolaris` answers 200 — which proves `autolaris_callbacks`
from migration `0050` is live on each D1 (one probe row per store, body
`{"probe":"adsbook-audit-2026-08-27"}`); `/payment` ships the copy-link and
retry controls; kecamatan search 200; wrong-password login 401;
`/api/order-status` 404.

**2026-08-27 rollout of 1.3.5 (hotfix, product `679f577`).** Shipped within
the hour of the merchant reporting a blank admin order list; all six installs
deployed and pushed. `/admin/orders` answers 200 and redirects an
unauthenticated caller to `/hello` on every host — the signed-in render was
verified locally against a seeded store rather than in production, because
production admin credentials are behind the approval gate.

**2026-08-27 rollout of 1.4.0 (product `6130a2d`, stock stops gating a sale).**
All six installs (tests 590–591 in the installs). zanobyshop needed a manual
three-way merge again — it carries its own storefront palette on the line the
release reworded — and was then committed, gated, deployed and pushed by hand.
Measured live afterwards on every host: `/` and `/produk` 200, kecamatan search
200, wrong-password login 401, `/api/order-status` 404, JSON callback 200. No
migration: `product_variants.stock` is retained and inert.

**2026-08-27 rollout of 1.3.4 (product `1c071d8`, review hardening).** All
six installs again (tests 582–586 in the installs); the merge-type runner
initially redeployed stale code because it had not fetched `product` — caught
by the test count, fixed, rerun. Measured live afterwards on every host:
`/` 200, kecamatan search 200, wrong-password login 401, `/api/order-status`
404, JSON callback 200. Installs carry `1.3.4` in `src/lib/version.ts`.

Verified live 2026-08-25 after the Google server/offline release: every host
answers `200` on `/`, `401` on unauthenticated `/api/admin/health`, and has zero
page-level horizontal overflow. Every install applied migration `0048`
atomically on its first database-backed request; all six report 49 migration
claims and an empty `google_ads_conversion_outbox`.

All six run product `7b0a1ab`. The release retained each install's Worker,
domain, D1/KV/R2 bindings, provider configuration, and merchant assets. No
Google API credentials are configured, so reconciliation remains disabled and
no conversion or historical order was uploaded. Zanobyshop and Permatamall
GitHub Actions again failed before acquiring a runner because of the account
billing/spending-limit blocker; both were recovered through verified manual
Wrangler dry-run and deployment.

The 2026-08-24 rollout (BUILD-LOG same date, PRs #84–#93) carried ten fixes to
all six installs same-day, re-verified live after each deploy rather than
assumed from the diff: `/payment` and `/thanks` redesigned onto the
storefront's palette, an expired-payment state on `/thanks`, six colour-
contrast failures cleared, a checkout redirect that had been dropping
customers at the catalogue, the worker's icon set pruned to what templates
actually name (620KB → 19.6KB), storefront LCP images made preloadable
(homepage hero, its daily-rotation fallback, and the catalogue's first two
rows), one shared image-compression rule for both admin upload paths, and
`noindex` on five funnel/confirmation routes that were open to indexing.
Official PageSpeed Insights mobile scores, run against all six same day:
taniniaga 96, carukesi 95, permatamall 94, zanobyshop 92, skincarebpom 89,
zvara 85 — CLS 0.00 on every one.

**Repository visibility and CI.** All seven repositories are public as of
2026-08-23. That was not only a visibility change: the deploy workflows in
`zanobyshop` and `permatamall` had been failing in under four seconds with an
Actions **billing** error that stops the job before it starts — private
repositories on this account were blocked. Public repositories get free Actions
minutes, so both pipelines started working again and now deploy on push to
`main`. The other four carry only the product's `ci.yml`, which deliberately
deploys nothing, and are deployed by hand with `wrangler deploy`.

The **system surface is byte-identical across all six** — `components/admin`,
`components/ui`, `pages/admin`, `pages/api`, `styles/admin.css`, `db`,
`middleware.ts`, `worker.ts` and the non-visual half of `lib`. Storefront look
is deliberately per store: `zanobyshop` carries a navy accent, `zvarashop` an
orange one, and `zanobyshop` also owns its `landing.css`. `landing-safelist.html`
is generated per store from that store's own D1.

| Install | Repository | Adopts the product by | State (2026-10-15) |
| --- | --- | --- | --- |
| `agritani.shop` | `ongkipro/agritani-shop` | `git merge product/main` on `install/agritani-shop` | 1.7.2, schema 67 (2026-10-20); installed 2026-10-15 |
| `petanisejahtera.com` (aliases petanisawit.com, beranda.click) | `ongkipro/beranda-tani` | `git merge product/main` on `install/beranda-tani` | 1.7.2, schema 67 (2026-10-20) |
| `carukesi.com` | `ongkipro/carukesi` | `git merge product/main` on `install/carukesi` | 1.5.11 on `8ec7712` |
| `klikinaja.shop` (and `klikinaja.ongki.workers.dev`) | `ongkipro/klikinaja` | `git merge product/main` on `install/klikinaja` | 1.5.11 on `f9bc526` |
| `page.numaskin.id` | `ongkipro/numaskin-adbook` | `git merge product/main` on `main`, manual deploy | 1.7.2, schema 67 (2026-10-20) |
| `permatamall.shop` | `ongkipro/permatamall` | `git merge product/main` on `main`; GitHub Actions deploys on push | 1.5.11 on `17ddf59` |
| `page.revenleather.com` | `ongkipro/revenleather` | `git merge product/main` on `main` | 1.5.11 on `70c5ce2` |
| `skincarebpom.shop` | `ongkipro/skincarebpom` | `git merge product/main` on `install/skincarebpom` | 1.5.11 on `81b5f19` |
| `taniniaga.shop` | `ongkipro/taniniaga` | `git merge product/main` on `install/taniniaga` | 1.7.2, schema 67 (2026-10-20) |
| `zanobyshop.shop` | `ongkipro/zanobyshop` | `scripts/sync-from-product.sh`; GitHub Actions deploys on push | 1.7.2, schema 67, no cron slot (2026-10-20) |
| `zvara.shop` | `ongkipro/zvarashop` | `git merge product/main` on `install/zvarashop` | 1.7.3 on `c3b308b`, schema 79 (catalogue at `0067`–`0078`, 2026-10-21) |

Holding a catalogue is each install's own job; nothing is bundled here any more
(ADR-016). Older installs keep legacy `cmsads-*` names on their Cloudflare
resources.

As of the split on 2026-08-16, the fixes recorded below live in this repository. Whether and when an install adopts them is that install's own deploy decision.

---

## 2. Verification baseline

| Gate | Result |
| --- | --- |
| `npm test` | **1096 / 1096 passing** (2026-10-31, `fix/ui-actions-audit`; not released) |
| `npm run check` | 0 errors · 0 warnings · 0 hints |
| `npm run build` | Cloudflare server bundle complete; 78 bundled migrations, `0000`–`0077` (2026-10-31, `fix/ui-actions-audit`) |
| PageSpeed Insights, mobile, official API (2026-08-24) | taniniaga 96 · carukesi 95 · permatamall 94 · zanobyshop 92 · skincarebpom 89 · zvara 85 — CLS 0.00 on every store |
| Lighthouse accessibility, `/payment` & `/thanks` (2026-08-24) | 100, zero failed audits, on both pages on every install |
| Browser smoke | A fresh isolated install exposed all ten default couriers through `/api/admin/expeditions`. `/admin/orders/abandoned` rendered its shadcn Card/Badge/Button/Dialog composition at 390, 768, and 1280 CSS px with zero overflow, no stuck busy state, no failed request, and no console error. A populated lead opened the conversion Dialog, focused the invalid address, and returned focus after `Escape`. A separate isolated owner session on `/admin/balance` rendered pending and locked AutoLaris rows, blocked blank manual-confirmation submission with focused inline errors, and an already-confirmed payment redirected `/payment` to `/thanks` with zero console errors. No live provider request, deployment, or remote D1 mutation occurred. |
| Full-system screening | On 2026-08-22 every checkout path, the hybrid form decision, the payment gateway, and every admin surface and role gate were exercised against a running install (see `BUILD-LOG.md`). A real QRIS order reached AutoLaris and came back with a provider transaction id; every submit guard (honeypot, stale fare, bad phone, replayed token, COD to an excluded province, excluded-area address text) refused correctly; the order-status endpoint exposed no PII and refused a wrong token. One defect found and fixed: the public form-config endpoint served a stale COD-province policy for up to five minutes after an operator changed it. All rows created were removed and reserved stock restored. |
| Live provider read, SPX | On 2026-09-25 a read-only production `/order/estimate?courier=all` returned `spx` (Jakarta Selatan Rp13.700, Jayapura Rp34.000, COD covered) with an undocumented `unsupportedOriginSpx` flag; the single-courier estimate refused every SPX spelling. No order, pickup or D1 write. |
| Live provider read | On 2026-08-19 the repository's own clients were exercised against the real providers. Mengantar: `searchAddress("Cihapit")` resolved one area and `estimateRates` returned ten couriers with real prices (JNE Rp11.000, SiCepat Rp8.500, SAP Rp10.500). Read-only; no order, pickup, or D1 write. AutoLaris: `createPayment` on the provider's **published development key** returned a real virtual account for a Rp118.400 order, and `inquirePayment` read it back as `PENDING`. No production AutoLaris credential was used, no deployment occurred, and no remote D1 was touched. |

---

## 3. What is implemented

**Storefront** — SSR home that remains available when optional homepage content is unpublished, product listing with progressive load-more, product detail with variant selection and sticky mobile CTA, custom 404 with related products, hand-authored `sitemap.xml`, Google and Meta catalog feeds, JSON-LD (Organization, WebSite, Product, ItemList, Breadcrumb). The public component and CSS boundaries are isolated under `components/storefront/` and `styles/storefront.css`. The homepage hero, its no-configured-hero daily-rotation fallback, and the catalogue's first two card rows are preloadable/eager rather than lazy, and the worker's icon set is a checked-in ~30-icon subset instead of the full lucide set (2026-08-24, BUILD-LOG). `/thanks`, `/middle-form`, `/full-form`, `/hybrid-form`, and `/geoipform` carry `noindex` alongside `/payment`, so a funnel render mode of a product page cannot rank against the canonical `/produk/[slug]`.

**Landing pages** — D1-backed builder with ordered typed sections (`headline`, `paragraph`, `numbered_list`, `bullet_list`, `image`, `form`, and legacy `html` that only owner/admin may change; migration `0055`), up/down reorder, shortcode pills, 480px mobile canvas preview, rendered through the `/[slug]` catch-all with admin-gated `?preview=1`. Every landing page answers at `domain/<slug>` with no path prefix. One active landing page may take over its product's page: `/produk/<product-slug>` then renders it and is its canonical address while its own slug answers `308` there, so exactly one URL is live and neither sitemap advertises the redirecting one. Only owner and admin may claim or release a product page; `advertiser` builds landing pages but does not decide what the storefront serves. A partial unique index allows only one holder per product, and releasing or unpublishing the claim returns the product URL to the standard product template rather than 404ing it. Operator-authored HTML renders into `.lp-section`, whose rhythm, type contract, and overflow safety live in `styles/landing-pages/landing.css`. Native Astro landing pages are a second kind: the route file is the source of truth and `src/data/native-landing-pages.ts` records it, so the CMS lists, links, and can hand it a product page while refusing to edit or delete it. The register is reconciled into the same table on every list load, so a page deployed since the last load appears without a sync step and a removed entry takes its row — and any claim it held — with it. Registering also makes the slug unique across both kinds, closing the case where a route file silently shadowed a CMS page. The home page lists at most five landing pages and hands off to `/landing-page`, a read-only index shaped like `/produk` — ten initially, load-more in tens — whose links follow a product-page takeover rather than pointing at a slug that redirects.

**Checkout** — three form modes (hybrid, middle, full) plus a geo-resolved variant and a cross-origin embed. One canonical Indonesian mobile check (`isValidWa62`) shared by checkout, the browser forms, lead capture and admin edits — 0-form 8–13 digits / 62-form 9–14, with an operator allowlist covering every carrier, so a real 13-digit number is no longer refused. Province-based COD gating from trusted Cloudflare geo, district autocomplete over a 7,285-district index served entirely from the local catalogue (no provider call per keystroke), with a separate KV-cached `level=resolve` step (24h) that maps the picked district to Mengantar's real destination id only once a candidate is selected, live Mengantar rate quotes that never request the provider COD fee, so the store's own COD service fee cannot be billed twice, honeypot and rate-limit guards, `submit_token` idempotency, atomic order + items (stock is not read or written, ADR-023), one atomic order-number allocator, and scheduled abandoned-order retention. Qualified unsubmitted leads retain a per-tab set of successful normalized identity/product fingerprints: identical combinations are suppressed across blur and reload, changed combinations may capture, and failed capture or unavailable storage fails open. Submitted non-COD checkouts remain real orders with pending shipping; successfully-created unpaid VA/QRIS and bank transfer remain payment-pending, while an explicit AutoLaris creation failure may be payment-failed.

**Payments** — COD, manual bank transfer with seller bank accounts, and AutoLaris QRIS/VA with per-channel toggles enforced at listing and submit boundaries, fee-bearer policy (buyer or seller) for both payment and COD fees, and a dedicated instruction page with copy-to-clipboard, countdown, token-scoped CMS-status refresh, and automatic `/thanks` replacement after the server confirms payment. Since 1.3.2/1.3.3 a failed or expired instruction is regenerable from that page (`retry_payment`, 5 per 10 min), `expired` is derived from `expires_at` for buyers and written hourly by the scheduled sweeper for every operator reader, the admin order list flags a failed or expired instruction beside the payment badge, the page is reopenable elsewhere through a fragment link (`/payment#o=…&t=…`, copied from the page, never a query string), provider callbacks are recorded as evidence in `autolaris_callbacks`, and a manual paid confirmation enqueues the server Meta Purchase. `/payment` and `/thanks` render on the storefront's own palette rather than a separate one (2026-08-24); a QRIS payload renders as a scannable canvas QR on both pages, and `/thanks` reflects an `expired`/`failed` transaction by hiding the code and both pay links rather than continuing to present an instruction the provider no longer honours. Online checkout creates one AutoLaris payment through `POST /api/h2h/create_payment` — the gateway path, carrying buyer payment identity and the fee-policy amount only. No shipping data reaches AutoLaris; that is Mengantar's. Manual seller-bank transfers remain visible in analytics but are excluded from AutoLaris reconciliation. The hourly job asks `POST /api/h2h/advice` and marks a transaction paid only on `rc:"00"` with an allowlisted settlement word (ADR-025); an owner/admin can also verify the provider dashboard and re-enter the exact recorded total and provider reference. A manual seller-bank transfer is marked paid by the operator. Owner and admin can read one transaction's provider state on demand from the reconciliation queue; that read writes nothing, cannot mark a payment paid, and flags the case that matters — the provider reporting an unpaid transaction this store has already marked paid. Every accepted transition is atomic, idempotent, append-only audited, and blocked for released or incompatible orders. The legacy webhook is retired. Paid confirmation changes shipping eligibility only and never dispatches automatically.

**Orders and shipping** — one shared lifecycle validates every single/bulk status transition, marks an order void exactly once on cancellation or deletion, refuses to dispatch a void order, and refuses to delete an order that is paid or already with the courier. **Pesanan tertinggal** has a dedicated product-first lead workspace and is excluded from normal order lists, summaries, details, bulk actions, and shipping. CS can record follow-up and explicitly convert one ABN lead into one complete pending INV with a current server-side rate, under the same COD-province policy as checkout. Checkout, conversion, and payment confirmation only persist or change eligibility. Mengantar dispatch runs solely after an explicit authenticated single/bulk operator action under a single-flight lease; provider acceptance rechecks the claim and dispatch-critical snapshot so concurrent cancellation or buyer edits cannot be overwritten. Accepted provider identifiers and provider-supplied waybills persist, duplicates are suppressed, and bounded failures remain pending and retryable. The Shipping workspace exposes exactly **Semua Pengiriman**, **Perlu Dibuatkan Resi**, **Perlu Pickup**, and **Sampai Tujuan**, with responsive state-valid actions and explicit sequential provider polling by waybill. `/order/pay-unpaid` recovery remains provider-blocked.

**Admin** — 28 pages: dashboard analytics, orders and order detail, product CRUD, landing pages, content workbench with Workers AI drafting, shipping, expeditions, RTS/rate checker (tariff, ETA and COD availability per courier), payments, balance reconciliation ledger, ads configuration for Meta and Google, store/warehouse/CRM settings, operator access management, and developer API keys. The JSON/AI content workbench is off the main navigation (ADR-018); `/admin/content` itself stays reachable and unchanged — it is no longer gated behind the storefront's setup-required state, since the home page now always renders. Both admin image-upload paths (product photos, content/hero media) route through one shared client-side compression rule (`src/lib/client-image.ts`: 1280px max edge, WebP quality 0.8, reuse only under 100KB) rather than two that could disagree — forward-only, no backfill of what is already in R2 (2026-08-24). Warehouse settings create the required single-row origin on a fresh install and update it thereafter. Fresh installation also creates the neutral nine-courier policy (Ninja retired, `0056`); migration `0042` repairs only installed stores with no courier rows and never overwrites an existing policy. Navigation and route authorization share one deny-by-default role policy. Phones use role-aware bottom navigation and sheets, tablet starts with a 48 px rail, desktop uses a 256 px sidebar, and first-run sessions expose only password rotation and logout.

**Dashboard figures** — "Omset" is the value of orders still in play: cancelled and returned shipments and released payments are excluded by one predicate shared with the trend query, so the chart's bars always sum to the card above them. A separate collected figure counts paid orders net of shipping and COD fees, so a store with no paid orders no longer reports a seven-figure "pendapatan". Payment success is measured over online orders only (COD is paid on delivery and cannot prepay) and RTS over shipments that reached an outcome; every card states its base, and "Pesanan" headlines active orders with the dropped ones in the note. The default reporting period is this month. The trend chart's axis scales per tick so labels stay distinct, the all-time view fills empty days rather than skipping them, and a payment provider that has accepted requests but awaits its first manual confirmation reads healthy, not "no data".

**Reporting periods** — the dashboard, order list, and shipping workspace share one period control: a preset rail beside a custom two-month calendar grid (built without a date library), styled after Facebook Ads Manager, with the picked range shown as read-only date boxes and a Batal/Terapkan pair. On a phone it shows one month, navigated by arrows. A period the server cannot resolve is refused with a stated reason rather than silently answered as the 7-day default, which is what the order and shipping routes used to do with any unrecognised value. Each surface declares its own ceiling — 31 days on the dashboard, which charts every day in the period, against 180 on the lists — and the control states that ceiling and enforces it in the inputs. The order list's summary cards follow every active filter, and its status chips follow all of them except the status they select, so a one-day period no longer shows that day's rows beside an all-time total. The analytics range requires both ends, so no dated request escapes the ceiling through a half-open range.

**Operator notifications** — a new order, a missed-order lead, and a cleared payment each record exactly one notification, enforced by a unique index on `(type, order_id)` rather than by the caller. Recording is fail-open and can never affect the commerce write that triggered it. The admin topbar carries an unread badge and a panel, newest first, with read state per operator so one person clearing the badge does not blind the team; `advertiser` is refused the endpoint entirely. A browser notification is raised while an admin page is open, at most once per event per browser. Delivery while no admin page is open needs Web Push and is specified (`REQ-153`) but unbuilt.

**Headless API** — nine `/api/v1/*` routes authenticated by API key and independently origin-checked. Every operation has a minimum scope; origin denials occur before quota, minute denials do not spend daily quota, and D1 records the final handler status exactly once without request payloads. The order-status route requires the order number plus its public status token and returns no customer PII.

Google Ads API offline delivery is now implemented but remains disabled until an
install provides its own optional API/OAuth secrets, customer ID, UPLOAD_CLICKS
conversion action, and explicit start timestamp. Hourly maintenance reconciles
online paid and COD delivered orders into a D1 outbox, uploads only orders with
stored Google click identity, and retries transient failures. No install has
those credentials yet; no remote migration, historical backfill, or API upload
has occurred.

**Tracking** — Meta Pixel plus server-side CAPI through a durable outbox with retry and a shared, order-derived `event_id`. A valid Meta configuration now mints one 128-bit first-party `adsbook_meta_external_id`, retains it for 90 days, and SHA-256 hashes it independently on Pixel and CAPI; PageView through Purchase therefore keep one advertiser identity instead of changing `external_id` to phone only after checkout. `_fbp`/`_fbc` remain raw, phone/name/address matching remains normalized and hashed, and phone is only an upgrading-session fallback when the new cookie is absent. The native checkout deliberately remains email-free; CAPI accepts and hashes a real email from Headless callers or stored orders but never sends the synthetic address used only to satisfy an online payment provider. Google Tag and Ads conversion configuration retain region-scoped Consent Mode v2 and enhanced conversions (`gtag('set', 'user_data', ...)`, uppercase ISO country); click-id capture covers `gclid`/`gbraid`/`wbraid`/`fbclid`. **TikTok removed 2026-08-24** (BUILD-LOG same date, TRACKING_SPECS.md §8): no Pixel or Events API existed, so its stale click-id and traffic-source surfaces were deleted. Hosted and embedded checkout surfaces emit Purchase only after the order can be resolved and verified. Product ID remains the canonical advertising identity across API `content_id`, Meta `content_ids`, Google ecommerce `item_id`, and both catalog feeds.

The 2026-08-25 Google configuration hardening now treats the direct `AW-…` conversion ID and label as one atomic validated pair across D1, environment fallback, and storefront render. Invalid/partial environment values disable the direct tag instead of emitting a malformed `send_to`; GTM can still consume ecommerce/GA4 data, but must not own the same Google Ads conversion action as the direct tag. Account-side Enhanced Conversions enablement, customer-data terms, consent policy, Google receipt, deduplication, and campaign effect remain operator evidence—not a code claim.


---

## 4. Data state

21 tables. `stores` is a single row carrying provider keys, tracking ids, fee policy, payment toggles, CRM templates, independent embed and Headless origin policies, AI instructions, and COD province exclusions. `order_number_counters` owns collision-free numbering; Headless usage/audits and runtime storefront definitions have dedicated tables.

Catalog: **empty by default**. No dataset ships (ADR-016); an install starts with no products and the storefront renders an explicit setup state until the operator publishes home content and adds products.

Known data issues, all tracked:

- The local development D1 may hold a previously provisioned warehouse row with address, phone, and Mengantar identifiers. Remote state was not read and is explicitly unverified; any local or remote scrub is a separate destructive-data decision.
- No seed ships. `scripts/seed-catalog.sql`, `public/images/products/` and `db:reset:demo:local` were removed on 2026-08-17 (ADR-016); whether to reintroduce sample data, and in what form, is deferred rather than decided against. The earlier `src/db/seed.sql`, which held two previous merchants' catalogs plus genuine-looking provider ids, a real address and a real phone number, was deleted on 2026-08-16.
- Migration `0017` once aborted the chain on an empty database; that insert was removed 2026-08-16. All 52 migrations now apply from zero, and the Worker applies a valid missing suffix automatically before database-backed requests. Migration `0040` adds persisted provider status text, provider event time, and synchronization time to `orders`; migration `0041` adds persisted missed-order follow-up state; migration `0042` restores the neutral courier catalogue only for stores with an empty policy; later migrations add manual payment reconciliation, the retired wide catalog marker, notifications, landing-page product claims and native rows, a Google Ads outbox, D1-backed sessions/rate limits, captured AutoLaris callbacks, and typed landing sections.

---

## 5. Work completed on 2026-08-16

Content and identity cleanup, on branch `chore/adsbookcms-foundation`:

- Legal pages templated on `{{store}}` and resolved at render, replacing hardcoded references to a previous merchant on `/syarat-ketentuan`, `/disclaimer`, and `/kontak`. `/kontak` now renders the support WhatsApp number from D1 instead of a foreign one, and the foreign operational address was removed rather than replaced with an invented one.
- `/disclaimer` fixed — the page had an unterminated frontmatter block, so the route never compiled and returned 404 in production while remaining listed in `sitemap.xml`.
- Page metadata on `/tentang`, `/testimoni`, `/sitemap`, and `/kebijakan-cookie` switched from a third merchant's brand to `resolveTenantConfig(...).name`.
- Default home hero copy replaced with neutral text; the previous default described an agriculture and household catalog.
- Fallback merchant name in CRM templates and the fallback product name on `/thanks` neutralised.
- Deleted: five dead components carrying legacy campaign logic, the unreferenced `siteContact` block with a foreign email, WhatsApp, and address, and roughly 39 MB of another merchant's images and articles that were publicly fetchable on this domain (`public/` went from 67 MB to 28 MB).
- Documentation re-founded: `ARCHITECTURE.md`, `DECISIONS.md`, `RELEASE.md`, and `OBSERVABILITY.md` created; `README.md`, `INSTALLATION.md`, `AGENTS.md`, and this file rewritten; `CLOUDFLARE_MULTI_TENANT.md`, `AUTO_UPDATE_DEPLOY.md`, `design-tokens.md`, and the `doc/` preview site deleted as upstream-engine material.

System-wide security, correctness, documentation, navigation, and UX audit:

- Hardened admin bootstrap, JWT verification, KV-backed session validation, password rotation invalidation, exact role routing, and deny-by-default API/page access. **Correction (2026-08-17):** this said the built-in default password "fails
  closed unless a strong bootstrap secret is explicitly configured". It does not,
  and deliberately so — that behaviour shipped, made a fresh install unopenable,
  and was reverted (PRD.md REQ, `PRD-ADMIN-LOGIN.md` LOGIN-1/LOGIN-2). A new
  install opens with `admin` / `admin`, and a session on that credential reaches
  nothing but its own password change. Anyone believing this line either ships an
  install they cannot enter, or leaves a live default they think is disabled.
- Converted public order status to token-scoped `POST` JSON; completion routes keep identifiers in same-origin `sessionStorage`, strip query strings before subresources load, and send `Cache-Control: no-store`. Checkout, payment, thanks, Meta browser tracking, and CAPI now share the same order-derived event identity.
- Separated iframe embed origins from Headless API origins. Migration `0035` persists the Headless allowlist; Developer settings validates and saves it; all `/api/v1/*` routes still require an active API key.
- Closed inactive-product exposure, landing-preview cache, custom-HTML preview injection, legacy embed redirect, catalog identity, and public cache-control defects. Removed dead completion-query builders after the safe navigation boundary made them redundant.
- Centralised admin navigation contracts, aligned menu visibility with authorization, repaired nested `<main>` landmarks, and made public/admin skip links target the actual main content.
- Reconciled repository specifications, architecture, installation notes, storefront integration guidance, remaining-gap register, and migration `0034` behaviour with the executable tree.
- Published the authenticated OpenAPI 3.1 contract and framework-neutral server adapter for the complete Headless commerce journey. External tracking now preserves the allowlisted storefront origin instead of replacing it with the CMS origin, while the developer key remains server-side.
- The 2026-08-17 repository audit found open correctness and abuse-control defects. They are recorded in §6 and `UNIMPLEMENTED_SPECS.md`; the earlier statement that no exploitable finding remained is superseded.

---

## 6. Known issues

| Severity | Current fact |
| --- | --- |
| Release note | Automatic AutoLaris paid marking is **on**, gated on the provider: the hourly cron calls `POST /api/h2h/advice` for each pending transaction and marks it paid only on `rc: "00"`; `02` stays pending, anything else is unproven and moves nothing. Manual owner/admin reconciliation remains as the audited fallback. A settled response has still not been observed on this product — capturing one means paying a real virtual account — so the first live paid transition on any install should be checked against `payment_transactions.paid_at` and the operational-health card. |
| Release blocker | AutoLaris production access requires an IP allowlist of at most five addresses. Cloudflare Workers have no fixed egress address, so no install is AutoLaris-production-ready on current evidence. |
| Medium | Product-grain feeds still need a truthful standard-identifier policy and stable out-of-stock publication contract. |
| Medium | Theme colour, locale, and admin display name resolve from D1 but still lack complete admin editors. |
| Medium | External uptime checks and a cross-install operational view do not exist; per-install schema/CAPI alerting does. |
| Blocked | Mengantar tracking, pickup, insufficient-wallet recovery, and wallet balance still require canonical provider contracts or explicitly approved sandbox/live evidence. |
| Release evidence | Commit `09812c7` plus the A17 working tree has local test/check/build and isolated browser evidence, but no hosted CI result, production-D1 preflight, or install-specific provider smoke. |
| Data note | Local/remote D1 may still contain a previously provisioned warehouse address, phone, and provider ObjectIds; scrubbing it is a separate destructive/remote-data action |

---

## 7. Distance to the product goal

AdsBookCMS is intended to install like WordPress: point a domain at it, open the
site, fill in a form. That path now exists end to end — an empty database
redirects to `/install`, the wizard writes the store and the operator's own
credential, and the wizard locks itself afterwards. It has been exercised against
a real Worker on a real empty D1, not only in tests.

All ten structural gaps in `ARCHITECTURE.md` §10 are closed. Remaining audited
defects, documentation debt, integration deliverables, and provider-blocked work
are tracked only in `UNIMPLEMENTED_SPECS.md`.
