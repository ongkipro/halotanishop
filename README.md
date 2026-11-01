# AdsBookCMS

> Verified against disk: 2026-11-02 @ `f53486c` (test count only; the rest retains its recorded evidence and links to the owning documents)

A self-contained direct-response commerce CMS that installs onto Cloudflare Workers. One install runs one store: storefront, landing-page builder, checkout with COD and online payment, order management, courier dispatch, ad-signal tracking, and an admin dashboard — in a single Worker with its own database.

**Install model: 1 installer = 1 Worker = 1 store.** Isolation comes from the deployment boundary, not from tenant routing inside the application (`DECISIONS.md` ADR-001).

**This repository is the product. It deploys nothing itself.** An install lives in its own repository, with its own Worker, D1, KV, R2 and domain, and deploys from there. `wrangler.jsonc` here is a deployable template with all-zero resource ids, and there are no Cloudflare credentials in this repository by design (ADR-012, ADR-026).

## Install in one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ongkipro/adsbookcms)

Like a WordPress installer, with Cloudflare doing the hosting part:

1. **Deploy.** The button copies this repository into your own GitHub account,
   creates the store's D1 database, KV namespace and R2 bucket in your own
   Cloudflare account, builds, and deploys. It asks for exactly one value,
   `INSTALL_TOKEN` — type a long random string of your own (16+ characters).
2. **Install.** Open the Worker's `*.workers.dev` address. Every page redirects
   to `/install`; enter the token, store name and your admin password. The
   database schema applies itself on that first request, and the session
   signing key is generated for you.
3. **Set up.** The admin dashboard lists what is left — first product,
   warehouse address, Mengantar key — and ticks each step off as you do it.
   Add your own domain in Cloudflare (Workers → Settings → Domains & Routes)
   whenever you are ready; the `workers.dev` copy is `noindex`.

The terminal path, and what each step does underneath: `INSTALLATION.md`.

The first install built on this code is `permatamall.shop`, in the separate `ongkipro/permatamall` repository. Its Cloudflare resources still carry `cmsads-*` names inherited from the upstream engine; those are legacy and deliberately not renamed, because renaming a Worker creates a new one and drops its custom domain, and D1 and R2 names cannot be changed in place.

---

## What an install looks like

Point a Worker with an empty, migrated D1 at a domain and open it. Every route redirects to `/install`, which asks once for the store name, address, optional tagline and support number, the admin username and password **you choose**, and a storefront template. Submitting writes the store row and your credential in a single transaction, then the wizard refuses to run again.

`INSTALL_TOKEN` is the only secret a store must have. `AUTH_SECRET` is optional: without it the Worker generates its own session key into D1 on first use (ADR-026); set one (32+ characters) only if you want to manage the key yourself. Migrations need no terminal step either — the Worker applies the bundled chain before the first database-backed request.

`admin` / `admin` remains a fallback only for an install whose credential was never claimed by a wizard, and a session on it can reach nothing but its own password change (`PRD-ADMIN-LOGIN.md`).

Full procedure, including creating the Cloudflare resources: `INSTALLATION.md`.

---

## Quick start (local)

```bash
npm ci
npm run dev:local             # build + provider stand-ins + wrangler dev --local
```

Open <http://localhost:8787>: it redirects to `/install`; the token is
`dev-local-install-token`. Everything a live store does works here with no
account anywhere — D1, KV and R2 are local (`.wrangler/dev-local-state`), and
Mengantar and AutoLaris are answered by `scripts/dev-providers.ts` on port
8788 with deterministic fake rates, waybills and QRIS/VA instructions. So the
whole path runs: install → product → warehouse → checkout (COD, QRIS, VA) →
payment → dispatch.

| Need | Command |
| --- | --- |
| Start over with an empty store | `npm run dev:local -- --reset` |
| Fill a running store with dummy data | `npm run dev:seed` — installs if needed, logs in as `admin` / `dev-local-password-123`, adds a warehouse, four products plus one draft, and a dozen orders placed through the real checkout (COD, QRIS, VA), then settles one payment, dispatches two and cancels one. Run it again for another batch. `--images=<dir>` uses `<dir>/<slug>.webp` as a product's photo — keep that folder outside the repository |
| Skip the build when only data changed | `npm run dev:local -- --no-build` |
| Open it from another device on your Tailscale network | `npm run dev:local -- --ip=$(tailscale ip -4)` (listens on that address only) |
| Pick up a code change | stop it and run `npm run dev:local` again — a `npm run build` underneath a running server swaps `dist/` out from under it and static files answer 404 until restart |
| Run the hourly job now (payment reconciliation, outbox drains, alerts) | `curl 'http://localhost:8787/cdn-cgi/handler/scheduled?cron=7+*+*+*+*'` |
| Mark a QRIS/VA payment paid, then run the hourly job | find the id with `curl http://127.0.0.1:8788/__dev/autolaris/payments`, then `curl -X POST 'http://127.0.0.1:8788/__dev/autolaris/pay?transaction_id=<id>'` |
| Read the local database | `npx wrangler d1 execute OMS_DB --local --persist-to .wrangler/dev-local-state --command "SELECT …"` |

The one thing that is not local: the `AI` binding (Workers AI) always calls
Cloudflare, so the content workbench's AI draft needs `wrangler login` and may
be billed. Nothing else in the store uses it.

`npm run dev` (Astro dev server) is faster for pure UI work and also runs with
local bindings, but without the provider stand-ins and the scheduled handler.

**No dataset ships.** An install starts genuinely empty and says so: the storefront renders "Katalog sedang disiapkan", `/kontak` reports that no support number is configured, and the catalog feeds emit valid empty XML. Add products from `/admin` and they appear. Whether to offer optional sample data later is deferred (ADR-016).

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Astro 7, full SSR (`output: 'server'`) |
| Islands | React 19 |
| Runtime | Cloudflare Workers (`nodejs_compat`) |
| Database | Cloudflare D1, accessed with raw prepared statements |
| Sessions / counters | Cloudflare D1 (`admin_sessions`, `rate_limits`); KV holds caches and alert state only (ADR-021) |
| Media | Cloudflare R2 |
| AI | Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) for admin content drafting |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Package manager | npm (`package-lock.json` is authoritative) |

Requires Node 22+ and npm 10+.

---

## Commands

Every command below exists in `package.json`.

```bash
npm run dev            # astro dev on :4321 — no Worker bindings
npm run cf:dev         # wrangler dev --local

npm test               # node --test over src/lib/*.test.ts  (1165 tests)
npm run route-map      # regenerate docs/ROUTE-MAP.md + route-map.xml from src/pages
npm run check          # astro check && tsc --noEmit
npm run build          # astro build

npm run db:migrate:local     # optional local preflight; runtime also upgrades

# The two below act on live infrastructure and belong to an install, not to this
# repository. Run from an install's checkout, against its own wrangler.jsonc.
npm run db:migrate:remote    # optional explicit preflight — approval required
npm run deploy               # wrangler deploy — deploys that install
```

There is no migration generator. Drizzle was removed entirely (ADR-005) — `db:generate` is not a script and drizzle-kit is not a dependency. Write migrations by hand, forward only; never edit one that has been applied.

A green build is not proof the storefront works. For any browser-visible change, open the page — an unterminated `.astro` frontmatter block once returned 404 on a live route while every static check stayed green.

---

## Deploying

**Pushing to `main` here deploys nothing.** `.github/workflows/ci.yml` runs check → test → build only.

Deploying is an install's job. On its first database-backed request, the new Worker validates and atomically applies the bundled missing migration suffix before serving traffic. An operator may still apply migrations explicitly before deploy as a separately approved preflight. Full detail: `RELEASE.md`.

---

## Repository layout

```
src/
  pages/           storefront, admin, /api/*, /api/v1/*, feeds, media
  components/      admin/  storefront/ (forms, home, seo, shared, tracking, templates)  ui/
  lib/             business logic and colocated tests
  db/              59 hand-authored migrations — the only schema description
  layouts/         BaseLayout, AdminLayout, EmbedLayout
  styles/           foundation.css (shared) + one entry per surface:
                    admin.css, storefront.css, form-hybrid.css (checkout)
  data/             reference data (Indonesian districts) + legal page templates
  middleware.ts     identity resolution, install gate, session, role policy, embed CSP
scripts/            maintenance scripts (route-map, preflight-deploy, safelists)
public/             static assets served by the Cloudflare adapter
docs/ROUTE-MAP.md   generated dictionary: URL → file → libs → tables → tests
docs/route-map.xml  the same, for tools and grep — never edited by hand
```

---

## Configuration

Identity resolves **row first, environment second, product default last**, on every request:

- **D1 `stores` row** — store name, canonical URL, description, tagline, logo, theme colour, locale, storefront template, and the provider half: API keys, tracking IDs, fee policy, payment toggles, CRM templates, support contact. Edited from `/admin`, effective on the next request with no rebuild.
- **Worker runtime env** — secrets and a few public vars, read through `getRuntimeEnv()`. A deploy, no rebuild.
- **Build-time bundle** — the `PUBLIC_SITE_*` vars reach `import.meta.env` from `wrangler.jsonc` `vars` and `.env`, frozen by `astro build`. They are the fallback for a store that has not set a field, which before the wizard runs is every field, so keep them accurate — but they are no longer where a running store's identity lives.

Provider credentials follow a **D1-first, env-fallback** rule, and `provider-config.ts` reports which source won.

---

## Integrating

- **Headless API** — `/api/v1/*`, key-authenticated, documented in `STOREFRONT_INTEGRATION.md`.
- **Embeddable checkout** — `/embed/form`, origin-restricted through a stored allowlist.
- **Ad signals** — Meta Pixel + CAPI with `event_id` deduplication, Google Ads with Enhanced Conversions and Consent Mode v2. `TRACKING_SPECS.md` is the contract.
- **Catalog feeds** — `/feed/google-catalog.xml` and `/feed/meta-catalog.xml`. Each product publishes one item. Its numeric Product ID is also the API `content_id`, Meta `content_ids`, Google ecommerce `item_id`, and feed `<g:id>`, byte for byte (ADR-017).

---

## Documentation

`AGENTS.md` §2 owns the ownership table — which document is authoritative for which subject. It is not repeated here; when both files carried a copy, they drifted.

Every document carries the date and commit it was verified against (ADR-010). **If a document and the code disagree, the code is right and the document is the bug.**

The one document that cannot drift is the one that is not written: `docs/ROUTE-MAP.md` and `docs/route-map.xml` are generated by `npm run route-map` from `src/pages/` and `src/lib/`, and `src/lib/route-map.test.ts` fails the suite the moment the committed map and the filesystem disagree. Start an audit there — every route with its file, HTTP verbs, auth boundary, admitted roles, the `src/lib` modules it imports, the D1 tables that surface touches and the tests that would catch a regression; then the same book from the module side.

---

## Status

All ten structural gaps in `ARCHITECTURE.md` §10 are closed. Remaining audited defects and blocked provider work live in `UNIMPLEMENTED_SPECS.md`; current executable state is in `STATUS.md`.

Current state is `STATUS.md`; the active backlog is Phase A in `TASKS.md`; history is `BUILD-LOG.md`.
