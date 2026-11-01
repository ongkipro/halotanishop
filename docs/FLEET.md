# AdsBookCMS install fleet

> Verified against disk: 2026-11-01 @ `fbcb8ba` (1.8.4 deployed to seven installs; carukesi and zanobyshop decommissioned; versions read from each install's `src/lib/version.ts` and `npm run fleet:status`, infrastructure from each `wrangler.jsonc`, visibility from GitHub)

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
| 1 | zvara.shop | `ongkipro/zvarashop` | `install/zvarashop` | **1.8.4** | 0 | 93/93 | 2026-11-01 |
| 2 | permatamall.shop | `ongkipro/permatamall` | `main` | **1.8.4** | 0 | 80/80 | 2026-11-01 |
| 3 | agritani.shop | `ongkipro/agritani-shop` | `install/agritani-shop` | **1.8.4** | 0 | 80/80 | 2026-11-01 |
| 4 | taniniaga.shop | `ongkipro/taniniaga` | `install/taniniaga` | **1.8.4** | 0 | 80/80 | 2026-11-01 |
| 5 | halotani.shop | `ongkipro/halotanishop` | `install/halotanishop` | **1.8.4** | 0 | 80/80 | 2026-11-01 |
| 6 | baven.shop | `ongkipro/bavenshop` | `install/bavenshop` | **1.8.4** | 0 | 80/80 | 2026-11-01 |
| 7 | page.numaskin.id | `ongkipro/numaskin-adbook` | `main` | **1.8.4** | 0 | 80/80 | 2026-11-01 |
| 8 | page.revenleather.com | `ongkipro/revenleather` | `main` | 1.7.13 | 129 | 67/67 | 2026-10-30 |
| 9 | petanisejahtera.com (+ petanisawit.com, beranda.click) | `ongkipro/beranda-tani` | `install/beranda-tani` | 1.7.13 | 128 | 67/67 | 2026-10-24 |
| 10 | klikinaja.shop | `ongkipro/klikinaja` | `install/klikinaja` | 1.5.11 | 172 | 62/62 | 2026-10-18 |
| 11 | skincarebpom.shop | `ongkipro/skincarebpom` | `install/skincarebpom` | 1.5.11 | — (no local clone) | — | — |
| 12 | cekat.shop | `ongkipro/cekat-shop` | `main` | 1.8.0 | — (no local clone) | — | — |

All twelve repositories and the product (`ongkipro/adsbookcms`) are
**public** since 2026-11-01, after a full-history scan found no secret or
customer data (test fixtures and base64 inside payment SVGs only). Never commit
a real token, `.dev.vars`, `.env` or customer export to any of them.

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

## Merge rules that differ per install

Everything else merges `product/main` as is; regenerate `docs/ROUTE-MAP.md`,
`docs/route-map.xml` (`npm run route-map`) and
`src/components/storefront/shared/lucide-subset.json`
(`node scripts/generate-lucide-subset.mjs`) on every merge.

- **zvarashop** — its own catalogue migrations occupy `0067`–`0079`, so product
  `0067`–`0079` are `0080`–`0092` there and `schemaVersion` is 93. A new product
  migration is renumbered on merge.
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
