# AdsBookCMS install fleet

> Verified against disk: 2026-11-02 @ `eb0ced6` (versions, sync, distance, deploy time and schema read with `npm run fleet:status` and live `/hello` on 2026-11-02 after the 1.8.6 rollout; "Version" is the working tree)

Every store that runs AdsBookCMS: one install = one repository = one Worker
= one store (`AGENTS.md`). This file is the registry of which installs exist,
where they live and what state each is in. `STATUS.md` owns the product's
running state and links here; `RELEASE.md` §7 owns how an install is updated.

Refresh it after every rollout:
`npm run fleet:status -- ~/Projects/<install> …` gives version, sync,
distance behind the product, last deploy and schema for each local clone.

## Installs

| # | Store (domain) | Repository | Branch | Version | Behind product | Schema (applied/expected) | Last deploy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | zvara.shop | `ongkipro/zvarashop` | `install/zvarashop` | **1.8.6** | 0 | 93/93 | 2026-11-02 |
| 2 | permatamall.shop | `ongkipro/permatamall` | `main` | **1.8.6** | 0 | 80/80 | 2026-11-01 |
| 3 | agritani.shop | `ongkipro/agritani-shop` | `install/agritani-shop` | **1.8.6** | 0 | 80/80 | 2026-11-01 |
| 4 | taniniaga.shop | `ongkipro/taniniaga` | `install/taniniaga` | **1.8.6** | 0 | 80/80 | 2026-11-01 |
| 5 | halotani.shop | `ongkipro/halotanishop` | `install/halotanishop` | **1.8.6** | 0 | 80/80 | 2026-11-01 |
| 6 | baven.shop | `ongkipro/bavenshop` | `install/bavenshop` | **1.8.6** | 0 | 80/80 | 2026-11-01 |
| 7 | page.numaskin.id | `ongkipro/numaskin-adbook` | `main` | **1.8.6** | 0 | 80/80 | 2026-11-02 |
| 8 | page.revenleather.com | `ongkipro/revenleather` | `main` | **1.8.6** | 0 | 80/80 | 2026-11-02 |
| 9 | petanisejahtera.com (+ petanisawit.com, beranda.click) | `ongkipro/beranda-tani` | `install/beranda-tani` | **1.8.6** | 0 | 80/80 | 2026-11-02 |
| 10 | klikinaja.shop | `ongkipro/klikinaja` | `install/klikinaja` | **1.8.6** | 0 | 80/80 | 2026-11-02 |
| 11 | skincarebpom.shop | `ongkipro/skincarebpom` | `install/skincarebpom` | 1.8.5 in tree, 371 uncommitted files | 201 | 62/80 | 2026-10-18 |
| 12 | cekat.shop | `ongkipro/cekat-shop` | `main` (local clone) | **1.8.6** | 0 | 80/80 | 2026-11-01 |

All twelve repositories and the product (`ongkipro/adsbookcms`) are
**public** since 2026-11-01, after a full-history scan found no secret or
customer data (test fixtures and base64 inside payment SVGs only). Never commit
a real token, `.dev.vars`, `.env` or customer export to any of them.

### Rollout of 1.8.6 (2026-11-02)

Every install with a local clone runs 1.8.6 (live `/hello` and `fleet:status`
agree) except **skincarebpom**, which has no local clone and stays on 1.5.11.

- zvarashop (`3ee1ee1`, Worker `4d86c8e0`), numaskin-adbook (`be853139`),
  klikinaja (`eac65816`, schema 62 → 80, only additive migrations),
  revenleather (`07b357f`, `b720e725`) and beranda-tani (`d5f974b`, `c5ac4920`,
  schema 67 → 80) were shipped on 2026-11-02; the other six were deployed on
  2026-11-01. Each deploy went through `npm run deploy`, no `ALLOW_*` override.
- **revenleather** keeps its engraving ("grafir") flow: the diff against the
  pre-merge head is empty for all 20 files under `src` that mention grafir, and the two conflicting
  catalogue files kept the install's version. The live product page still
  renders `grafir_text`. An order carrying an engraving was not placed.
- **beranda-tani**: the "318 uncommitted files" were an unfinished merge of
  1.8.5, not lost work. It was closed (generated route-map and lucide subset
  regenerated), then 1.8.6 merged; `ProductsSection.astro` and
  `produk/index.astro` keep the Petani Sejahtera theme, which has no search or
  load-more by design. A D1 export was taken before the deploy (kept outside
  the repository; it holds customer data). The alias domains petanisawit.com
  and beranda.click answer 301.
- klikinaja has no products and no orders (read-only count on 2026-11-02) and
  no Meta Pixel; cekat.shop likewise shows an empty catalogue and no Pixel.
  Both were so before the rollout.
- Placement: all eleven D1 databases run in APAC (`wrangler d1 info`). Ten
  Workers already used Smart Placement (ADR-030); klikinaja gained it on
  2026-11-02 (Worker `f237a992`). Cloudflare offers no Indonesia region, so
  Singapore is the closest the fleet can be.

## Infrastructure

| Install | Worker | Routes in `wrangler.jsonc` | D1 | R2 | How it ships |
| --- | --- | --- | --- | --- | --- |
| zvarashop | `zvarashop` | zvara.shop, www | `zvarashop-d1` | `zvarashop-assets` | `npm run deploy` by hand |
| permatamall | `cmsads-permatamall` | permatamall.shop, www | `cmsads-permatamall-d1` | `cmsads-permatamall-assets` | `npm run deploy` by hand |
| agritani-shop | `agritani-shop` | agritani.shop, www | `agritani-shop-d1` | `agritani-shop-assets` | `npm run deploy` by hand |
| taniniaga | `taniniaga` | taniniaga.shop, www | `taniniaga-d1` | `taniniaga-assets` | `npm run deploy` by hand |
| halotanishop | `halotanishop` | halotani.shop, www | `halotanishop-d1` | `halotanishop-assets` | `npm run deploy` by hand |
| bavenshop | `bavenshop` | baven.shop, www | `bavenshop-d1` | `bavenshop-assets` | `npm run deploy` by hand |
| numaskin-adbook | `numaskin-adbook` | none (domain attached in the dashboard) | `numaskin-adbook-d1` | `numaskin-adbook-assets` | `npm run deploy` by hand |
| revenleather | `revenleather` | page.revenleather.com | `revenleather-d1` | `revenleather-assets` | `npm run deploy` by hand |
| beranda-tani | `beranda-tani` | petanisejahtera.com (main), petanisawit.com, beranda.click (+ www) | `beranda-tani-d1` | `beranda-tani-assets` | `npm run deploy` by hand |
| klikinaja | `klikinaja` | none (domain attached in the dashboard; also `klikinaja.ongki.workers.dev`) | `klikinaja-d1` | `klikinaja-assets` | `npm run deploy` by hand |
| skincarebpom | `skincarebpom` | skincarebpom.shop, www | `skincarebpom-d1` | `skincarebpom-assets` | `npm run deploy` by hand |
| cekat-shop | `cekat-shop` | cekat.shop, www | `cekat-shop-d1` | `cekat-shop-assets` | `npm run deploy` by hand |

Each install also has a KV namespace for caches (binding `SESSION`). Resource
ids live in the install's own `wrangler.jsonc`, never in this repository's
template.

## Tracking (audited 2026-11-01)

Browser check per `TRACKING_SPECS.md` §16.1a: a product page with `fbclid` and
`utm_*`, every beacon aborted.

| Install | Meta Pixel | Google Ads tag | CAPI Graph API | PageView / ViewContent with `eid` | Click ids + UTM kept |
| --- | --- | --- | --- | --- | --- |
| zvarashop | `5111…` | `AW-18486474319` | v26.0 | yes | yes |
| permatamall | `5111…` | — | v26.0 | yes | yes |
| agritani-shop | `1640…` | — | v26.0 | yes | yes |
| taniniaga | `1640…` | — | v26.0 | yes | yes |
| halotanishop | `1640…` | — | v26.0 | yes | yes |
| bavenshop | `5111…` | `AW-18486474319` | v26.0 | yes | yes |
| numaskin-adbook | `1186…` | — | v26.0 | yes | yes |

The installs on older releases (revenleather, beranda-tani, klikinaja,
skincarebpom, cekat-shop) also pin v26.0. Graph API v26.0 is Meta's newest
(changelog checked 2026-11-01); v20.0 expired 2026-09-24.

## Cron

Every install registers the product's hourly housekeeping trigger
`7 * * * *` (`src/worker.ts` `scheduled`: CAPI retry, payment expiry, receiver
scoring, purges). skincarebpom had it commented out from 2026-08-22, when the
account's five-trigger ceiling gave the slot to zanobyshop; it was restored
2026-11-01 (`3247a23`, registered with `wrangler triggers deploy`, no code
redeploy) once eleven installs were already registering one each — the
account no longer stops at five. A new install keeps the trigger; never
comment it out to make room.

## Merge rules that differ per install

Everything else merges `product/main` as is; regenerate `docs/ROUTE-MAP.md`,
`docs/route-map.xml` (`npm run route-map`) and
`src/components/storefront/shared/lucide-subset.json`
(`node scripts/generate-lucide-subset.mjs`) on every merge.

- **zvarashop** — its own catalogue migrations occupy `0067`–`0079`, so product
  `0067`–`0079` are `0080`–`0092` there and `schemaVersion` is 93. A new product
  migration is renumbered on merge.
- **zvarashop** also sets `PUBLIC_DEFAULT_BRAND` to `Zvara` in `wrangler.jsonc`
  (39 of its 70 products have no brand of their own; the feeds and product
  JSON-LD report `Zvara` for them instead of the store name `Zvara Shop`). A
  merge of the product template must not reset it. Open data item: product
  `99840` (Theravol Natural Oil) has no `google_product_category`; set it in the
  admin.
- **zvarashop** keeps `src/data/card-derivatives.ts` filled (64 landing images)
  and the `hero-product-sm.webp` twins beside them; both are install-owned (see
  `docs/UPDATE-PATH-OWNERSHIP.md`). After adding or replacing a landing image run
  `npm run card-images`, commit the twins and the list. Measured 2026-11-01 on the
  home page: 10 cards 52 KB to 29 KB each, page weight 1 183 to 1 014 KiB, no 404,
  and the grid grows from 10 to 70 products by scrolling alone. Not measurable
  from this workstation: the Lighthouse score itself (two runs of identical code
  gave 81 and 61 because the root document's time followed the colo). Still
  heavy: the main image of the "Tas Slempang" product (the old 1254 px upload,
  132 KB; the home hero was re-encoded to 56 KB under a new R2 key, BUILD-LOG
  entry 231), the three preloaded Inter weights, and about 430 KB of Pixel and gtag.
- **permatamall** — the reference store. Its footer keeps a "Meta Ads &
  Privasi" → `/meta-ads` link (Meta App Basic Settings needs it).
- **taniniaga** — favicons and `public/images/logo.svg` are its own.
- **numaskin-adbook** — the storefront is install-owned: keep its own
  `SiteHeader`, `SiteFooter`, `templates/CompactMarketHome`, `home/*`
  (including `LandingPagesSection`), `PageIntro`, `Breadcrumb`,
  `ProductListItem`, `SiteBrand`, `ProductImageGallery`, `index`, `produk/*`;
  port data and SEO changes by hand. Other sessions push landing pages to its
  `main` often — fast-forward before deploying.
- **revenleather** — the brand's Indonesian ads/COD funnel; the main shop is
  Shopify. `PUBLIC_SITE_NOINDEX=true`, `PUBLIC_SITE_BRAND_MARK` for its mark.
  Install-owned and protected on every merge: the **grafir** (engraving)
  feature (`FormMiddleContent`, `FormHybridContent`, `GeoIpResolvedForm`,
  `form-middle.ts`, `form-hybrid.ts`, `approved-grafir`, the `customer_note`
  flow through `OrdersTable`/`OrderDetail`/admin API/`payment`/`thanks`, the
  `ps:thanks-note-updated` sync), its own hero/header/footer/brand
  components, `EDGE_CACHE_SECONDS=600`, `/testimoni` removed, the WhatsApp
  contact fallback. Take core's version of everything else. Taken from 1.8.5:
  the "Mulai" price label. Deliberately not taken (clash with its dark header
  and look): SiteBrand logo upload, the watermark/credit footer, the
  "Halaman" link. Local `dev:local` loops on 301 because `routes` makes the
  Worker see `page.revenleather.com`; run it from a temporary config without
  `routes`. Checked 2026-11-01: one warehouse (so
  migration 0072 changes nothing), 80/80 migrations applied, the empty
  `/sitemap.xml` and Lighthouse's SEO 69 are `PUBLIC_SITE_NOINDEX=true` working as
  designed (do not "fix"), and its CI is green (the 3-second failures were runs
  of 2026-10-30 that predate the merge). Its feed has 79 items, all branded
  `Reven Leather`; five laptop bags and sleeves carry no
  `google_product_category` on purpose (Google's taxonomy has no laptop-bag
  category; `ad-taxonomy.ts` omits rather than assert a wrong one). Lighthouse
  mobile on the home page, before the `_fbp` change: performance 67,
  accessibility 100, best practices 75; FCP 1.9 s, LCP 2.2 s, CLS 0, **TBT
  2 130 ms**, which is the Meta Pixel (270 KB) and `gtag` (170 KB) running
  inside the load window, not the store's own code. Left alone on purpose:
  recompressing `reven-grafir-sample.webp` (78 KB, lazy) saves about 23 KB at
  visible cost, and loading the pixels only on interaction would trade the
  lab score for losing every visitor who bounces.
- **beranda-tani** — breadcrumb and footer are install-themed (Petani
  Sejahtera); expect conflicts there.

## Not part of the fleet

- `ongkipro/agritani` (agritani.com) — a separate site, not an AdsBookCMS
  install; private.
- **zanobyshop** (zanobyshop.shop) — decommissioned 2026-11-01. Deleted: Worker
  `cmsads-zanobyshop`, D1 `cmsads-zanobyshop-d1`, KV, repository
  `ongkipro/zanobyshop` and the local clone. The R2 bucket
  `cmsads-zanobyshop-assets` carries an expire-all lifecycle rule; delete the
  empty bucket from 2026-11-02. Backup (repo bundle, D1 export) is kept outside
  this repository.
- **carukesi** (carukesi.com) — decommissioned. Verified gone 2026-11-01: no
  repository, no local clone, Worker answers "does not exist", no D1, KV or
  R2. Do not re-check it.
