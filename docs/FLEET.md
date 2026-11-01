# AdsBookCMS install fleet

> Verified against disk: 2026-11-01 @ `0dd1dc3` (versions, sync, distance, deploy time and schema read with `npm run fleet:status` over the local clones that evening; "Version" is the working tree, so "in tree" means merged locally, not necessarily pushed or deployed)

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
| 1 | zvara.shop | `ongkipro/zvarashop` | `install/zvarashop` | **1.8.5** | 0 | 93/93 | 2026-11-01 |
| 2 | permatamall.shop | `ongkipro/permatamall` | `main` | **1.8.4** | 11 | 80/80 | 2026-11-01 |
| 3 | agritani.shop | `ongkipro/agritani-shop` | `install/agritani-shop` | **1.8.4** | 11 | 80/80 | 2026-11-01 |
| 4 | taniniaga.shop | `ongkipro/taniniaga` | `install/taniniaga` | **1.8.4** | 11 | 80/80 | 2026-11-01 |
| 5 | halotani.shop | `ongkipro/halotanishop` | `install/halotanishop` | 1.8.5 in tree, +8 unpushed | 4 | 80/80 | 2026-11-01 |
| 6 | baven.shop | `ongkipro/bavenshop` | `install/bavenshop` | 1.8.5 in tree, +8 unpushed | 4 | 80/80 | 2026-11-01 |
| 7 | page.numaskin.id | `ongkipro/numaskin-adbook` | `main` | **1.8.4** | 11 | 80/80 | 2026-11-01 |
| 8 | page.revenleather.com | `ongkipro/revenleather` | `main` | **1.8.5** | 4 | 80/80 | 2026-11-01 |
| 9 | petanisejahtera.com (+ petanisawit.com, beranda.click) | `ongkipro/beranda-tani` | `install/beranda-tani` | 1.8.5 in tree, 318 uncommitted files | 139 | 67/80 | 2026-10-24 |
| 10 | klikinaja.shop | `ongkipro/klikinaja` | `install/klikinaja` | 1.8.5 in tree, +181 unpushed | 4 | 62/80 | 2026-10-18 |
| 11 | skincarebpom.shop | `ongkipro/skincarebpom` | `install/skincarebpom` | 1.5.11 | — (no local clone) | — | — |
| 12 | cekat.shop | `ongkipro/cekat-shop` | `main` (local clone) | 1.8.5 in tree, +24 unpushed | 4 | 79/80 | 2026-10-31 |

All twelve repositories and the product (`ongkipro/adsbookcms`) are
**public** since 2026-11-01, after a full-history scan found no secret or
customer data (test fixtures and base64 inside payment SVGs only). Never commit
a real token, `.dev.vars`, `.env` or customer export to any of them.

### Unfinished rollouts of 1.8.5 (2026-11-01 evening)

A rollout of 1.8.5 was interrupted mid-way. Shipped and verified: **zvarashop**
(also carries `PUBLIC_DEFAULT_BRAND` and the early `_fbp`, Worker version
`11b08a82`) and **revenleather** (`4861ef6`, Worker version `4882c044`). Merged
into the working tree but **not pushed, and not proven deployed** (the "Last
deploy" column is the clone's own record, which can predate the merge):

| Install | State found | Before shipping |
| --- | --- | --- |
| bavenshop, halotanishop | 1.8.5 in tree, 8 commits ahead of origin (halotanishop also has 1 dirty file) | `npm test`, `npm run check`, push, `npm run deploy` |
| cekat-shop | 1.8.5 in tree, 24 commits ahead of origin; schema 79/80 | same; read why 79/80 first |
| klikinaja | 1.8.5 in tree, **181 commits ahead of origin**, schema 62/80, last deploy 2026-10-18 | find out what the 181 commits are before pushing; 18 migrations pending |
| beranda-tani | 1.8.5 in tree with **318 uncommitted files**, 139 behind product, schema 67/80, last deploy 2026-10-24 | looks like a merge in progress: inspect `git status` and `MERGE_HEAD` before touching it |
| permatamall, agritani-shop, taniniaga, numaskin-adbook | still 1.8.4, 11 behind product | merge `product/main`, then ship |

The installs that are 4 behind product on 1.8.5 are missing only the 2026-11-01
evening work: `PUBLIC_DEFAULT_BRAND` (PR #131) and the early `_fbp` (PR #132,
`TRACKING_SPECS.md` §16.1b), plus docs.

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
  `routes`. Not yet checked after the 1.8.5 deploy: the warehouse count for
  migration 0072 (more than one warehouse changes quoting by province), why
  `/sitemap.xml` answers 172 bytes (probably `PUBLIC_SITE_NOINDEX`), and why its
  GitHub Actions runs fail within 3 seconds.
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
