# Installing AdsBookCMS

> Verified against disk: 2026-10-07 @ `515e81b` + autolaris-readiness/landing-thumbnail working tree; the store's-own-mark item re-verified 2026-10-31 @ `1b10ce1` + feat/storefront-shopify-color

This document describes how an install is actually stood up today, and where that process is still rougher than the product intends to be. It contains no commands that do not exist. Where a step is manual because the tooling has not been built yet, it says so and points at the gap.

**An install is one Worker, one store.** Two stores mean running this procedure twice against two separate sets of Cloudflare resources.

---

## 0. One click (recommended)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ongkipro/adsbookcms)

The Deploy to Cloudflare button does §2–§8 below for you (ADR-026):

| Step | Who does it |
| --- | --- |
| Copy the repository into your GitHub account | Cloudflare |
| Create D1, KV, R2; write their ids into your copy's `wrangler.jsonc` | Cloudflare |
| Ask for `INSTALL_TOKEN` (the only prompt, from `.dev.vars.example`) | You type a long random value |
| `npm run build`, then `npm run deploy` (preflight in Workers Builds mode) | Cloudflare Workers Builds |
| Apply the migration chain, generate the session key | The Worker, on its first request |
| Store name, admin account | You, in `/install` on the `*.workers.dev` address |
| Product, warehouse, Mengantar key, optional payments and domain | You, from the dashboard's **Siapkan toko** list |

Afterwards every push to your copy's `main` builds and deploys it, which is
how you take a product update: bring the product's commits into your copy
(`RELEASE.md` §7), push, and Workers Builds ships it. Your `wrangler.jsonc` is
yours; `.gitattributes` keeps a merge from overwriting it.

**Not yet observed end to end.** Everything the button runs was verified
locally (build, `wrangler deploy --dry-run`, a fresh local D1 through
`/install`, login and the checklist). The button itself has not been pressed
against a real account from this repository; the first one to press it should
record the result in `BUILD-LOG.md`.

The rest of this document is the terminal path — the same install done by
hand, and what each step is underneath.

---

## 1. What an install consists of

| Component | Created by | Notes |
| --- | --- | --- |
| Worker | `wrangler deploy` | name must be globally unique in the account |
| D1 database | `wrangler d1 create` | binding `OMS_DB` |
| KV namespace | `wrangler kv namespace create` | binding `SESSION` — caches and alert state only. On the Workers Free plan KV allows 1,000 writes/day **per account**, shared by every Worker on it; since 1.3.2 running out degrades caches rather than login or checkout (ADR-021) |
| R2 bucket | `wrangler r2 bucket create` | binding `ASSET_BUCKET` |
| Workers AI | binding only | no resource to create |
| Custom domain | Cloudflare dashboard (Workers → Settings → Domains & Routes) | apex and `www`. The template declares no `routes`, so Wrangler leaves dashboard-managed ones alone on every deploy |

Binding **names** are fixed across every install — `OMS_DB`, `SESSION`, `ASSET_BUCKET`, `AI`, `ASSETS`. Only the underlying resource names and ids differ. Do not rename bindings per install; the application resolves them by name.

---

## 2. Prerequisites

- Node 22+ and npm 10+
- A Cloudflare account with Workers, D1, R2, and Workers AI available
- Wrangler authenticated to **that** account — confirm with `npx wrangler whoami` before creating anything
- A domain on that Cloudflare account

A repository copy grants no access to another account's resources. The ids committed in `wrangler.jsonc` are all-zero placeholders and must be replaced with resources owned by the target install.

---

## 3. Local bootstrap

```bash
npm ci
npm run check
npm test
```

If these do not pass on a clean checkout, stop — the problem is the checkout, not the install.

To try the whole store before creating anything on Cloudflare, run
`npm run dev:local` (README, *Quick start*): the same Worker on this machine,
with local D1/KV/R2 and stand-ins for Mengantar and AutoLaris.

---

## 4. Create Cloudflare resources

```bash
npx wrangler d1 create <store>-d1
npx wrangler kv namespace create SESSION
npx wrangler r2 bucket create <store>-assets
```

Each command prints an id. Put them into `wrangler.jsonc`, replacing the reference values:

```jsonc
{
  "name": "<worker-name>",
  "d1_databases":  [{ "binding": "OMS_DB",       "database_name": "<store>-d1", "database_id": "…", "migrations_dir": "src/db/migrations" }],
  "kv_namespaces": [{ "binding": "SESSION",      "id": "…" }],
  "r2_buckets":    [{ "binding": "ASSET_BUCKET", "bucket_name": "<store>-assets" }],
  "ai":            { "binding": "AI" }
}
```

The template keeps `"workers_dev": true` so a new store has an address to open
`/install` at; that address answers `X-Robots-Tag: noindex`. Once the store's
domain is live an install may set it to `false` in its own config. A domain can
be declared under `routes` instead of in the dashboard, but then every deploy
replaces whatever the dashboard holds.

---

## 5. Store identity — set by the installer, not by the build

**You do not configure identity here.** A migrated database with no `stores` row
redirects every route to `/install`, and the wizard writes the store name,
address, tagline, support number, template and the operator's own credential in
one transaction (§9). Identity is read from that row per request, so renaming the
store in `/admin` takes effect on the next request with no rebuild.

> This section used to be the configuration procedure, and it said identity was
> compiled into the bundle. That was true before migration `0036`; following it
> now means rebuilding to change a value the admin screen already edits — and it
> never mentioned `/install` at all, which is the screen a fresh install actually
> opens on.

The `PUBLIC_SITE_*` vars remain as the **fallback** for a store that has not set
a field — which, before the wizard runs, is every field. They still reach the
bundle through `import.meta.env` at build time, so a change to them needs a
rebuild. Keep them accurate, because they are what an uninstalled Worker shows:

| Variable | Effect |
| --- | --- |
| `PUBLIC_SITE_NAME` | every `<title>`, header, footer, JSON-LD publisher, OG site name |
| `PUBLIC_SITE_URL` | canonical origin — must be `https:`, no path, no query, or it silently falls back |
| `PUBLIC_ALIAS_HOSTS` | optional, comma separated older domains (`www.` implied). Each one 301s to `PUBLIC_SITE_URL` with path and query kept, and every `http:` request goes to `https:`. `/api/*` is never redirected (`src/lib/host-redirect.ts`). Read at runtime, so a deploy without a rebuild applies it. Attach each host as a custom domain too. `stores.site_url` must match the new canonical origin. |
| `PUBLIC_SITE_DESCRIPTION` | default meta description |
| `PUBLIC_SITE_LOGO` | storefront and admin logo path |
| `PUBLIC_SITE_BRAND_MARK` | optional header mark beside the store name, root-relative or `https:` (anything else is ignored). Unset keeps the letter monogram |
| `PUBLIC_SITE_NOINDEX` | `true` keeps the whole store out of search (`X-Robots-Tag` and robots meta `noindex, nofollow` on every page). For a funnel domain that sells the same products as the brand's main shop; paid ads still run on noindexed pages. Unset keeps the store indexed |
| `PUBLIC_SITE_TAGLINE` | brand line, also used to compose the default title |
| `PUBLIC_SITE_THEME_COLOR` | must match `#rrggbb` or it falls back |
| `PUBLIC_SITE_LOCALE` | `id-ID` style; drives `lang` and OG locale |
| `PUBLIC_STOREFRONT_TEMPLATE` | `compact-market` (the only built-in; `wide-catalog` was removed by `0044`) — a malformed value logs `tenant-malformed-storefront-template` and falls back to `compact-market` |
| `PUBLIC_ADMIN_NAME` | admin shell display name |
| `PUBLIC_COD_DISABLED_PROVINCES` | comma-separated province names excluded from COD |
| `PUBLIC_EMBED_ALLOWED_ORIGINS` | fallback embed allowlist until one is saved in the database |
| `PUBLIC_HEADLESS_ALLOWED_ORIGINS` | optional Headless API fallback until its separate allowlist is saved in the database |

Keep `wrangler.jsonc` `vars` and `.env` in agreement. Both feed the build, precedence between them is undetermined, and a few keys (`PUBLIC_COD_DISABLED_PROVINCES`, `PUBLIC_EMBED_ALLOWED_ORIGINS`, `PUBLIC_HEADLESS_ALLOWED_ORIGINS`) are additionally read at runtime through `getRuntimeEnv()`, where only the Worker's own vars apply.

`slug` is derived from the store name by the installer and stored on the row;
`"adsbook"` is the fallback. It is used only for diagnostics. (The former
`PUBLIC_TENANT_SLUG` override was removed per ADR-002; an install that still
sets it can drop the var.)

---

## 6. Secrets

Set as Worker secrets, never in `wrangler.jsonc`. Only `INSTALL_TOKEN` is
required — `wrangler deploy` refuses a Worker without it (`secrets.required`):

```bash
npx wrangler secret put INSTALL_TOKEN
# optional:
npx wrangler secret put AUTH_SECRET            # 32+ chars; otherwise generated into D1 (ADR-026)
npx wrangler secret put BOOTSTRAP_ADMIN_PASSWORD
```

The Kelola CRM push is off until a webhook URL and secret from Kelola are saved under `/admin/profile` (or set as `KELOLA_ORDER_WEBHOOK_URL` / `KELOLA_ORDER_WEBHOOK_SECRET`; the saved pair wins). It sends each new order to Kelola as a sale and each order still abandoned after 30 minutes as a follow-up lead.

Provider credentials — `MENGANTAR_API_KEY`, `AUTOLARIS_API_KEY`, `META_CAPI_ACCESS_TOKEN`, and their base URLs — can be set either as secrets or, preferably, saved later from `/admin/profile` and `/admin/ads`. The database value wins over the deployed secret, and `/admin` reports which source is active.

`INSTALL_TOKEN` is the one-time capability requested by the fresh-install wizard;
use a unique random value of at least 16 characters. It is never stored in D1.
`/api/install` allows 10 token attempts per client IP per 15 minutes, spent up
front by every attempt (so a parallel burst cannot slip past a stale count); a
correct token closes the installer, so it has nothing left to protect.

For local development the same keys go in `.dev.vars`, which is never committed.

---

## 7. Verify the schema path

The Worker bundles all 67 checked-in migrations (`0000`–`0066`) and applies a valid missing suffix
automatically before serving a database-backed request. No terminal migration step
is required for first run. Invalid, unknown, or ahead migration history returns a
labelled 503 instead of running the application against an indeterminate schema.

An operator may still preflight the same chain explicitly:

```bash
npm run db:migrate:local
npm run db:migrate:remote    # live D1; separate approval required
```

Migration `0007` contains a legacy bootstrap credential for databases provisioned
outside the wizard. The first-run installer replaces it atomically with the
operator's chosen credential. Migration `0034` removes the inherited foreign
sample row when safe; no catalog dataset ships.

---

## 8. Deploy

```bash
npm run build
npm run deploy
```

Then attach the custom domain and confirm:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/produk
```

Pushing to `main` in **this** repository deploys nothing — CI runs check, test and build, and there are no Cloudflare credentials here (ADR-012). Deployment belongs to an install repository. See `RELEASE.md` §1.

---

## 9. First run

1. Open the domain. The first database-backed request applies the bundled
   migration chain. With no store row, every normal route redirects to **`/install`**.
2. Fill the form once: store name, address (`https:`), optional tagline and
   support WhatsApp, the admin username and password **you choose**, and the
   storefront template. Submitting writes the store and your credential in a
   single transaction, and the wizard refuses to run again.
   - Without an `AUTH_SECRET` secret the Worker generates a 256-bit session key
     into `install_secrets` on first use. The installer still refuses before
     writing anything if no key can be had at all (a database it cannot write),
     because an install nobody can log into is worse than one not yet made.
3. You land on `/hello`. Sign in with the credential you just chose; nothing is
   left to rotate.
   - `admin` / `admin` remains the fallback only for an install whose credential
     was never claimed by a wizard. A session on it reaches nothing but its own
     password change. `BOOTSTRAP_ADMIN_PASSWORD` (16 characters or more)
     replaces it entirely.
4. Configure, in order:
   - `/admin/settings/store` — store name and support WhatsApp (the support number feeds the public `/kontak` page)
   - `/admin/settings/warehouse` — pickup origin and Mengantar origin ids; shipping quotes fail without this
   - `/admin/profile` — provider API keys and base URLs
   - `/admin/expeditions` — which couriers and which COD services are offered; a fresh install offers JNE and J&T, with the other couriers listed but off for the operator to switch on here
   - `/admin/ads/meta` and `/admin/ads/google` — pixel, CAPI token, GTM, conversion ids
   - `/admin/settings/crm` — WhatsApp follow-up templates
   - `/admin/products` — the real catalog

The storefront does not wait for home content. With no published home row it
renders a neutral automatic catalogue of the store's own active products, so an
install is usable the moment products exist. The JSON/AI content workbench is
off the main navigation (ADR-018), but `/admin/content` itself stays reachable
and unchanged; the bounded banner, slider, and supporting-copy editor that
replaces it is **A-134** in `TASKS.md`.

---

## 10. Running more than one store

One store is one install: its own repository, Worker, D1, KV, R2, domain and
credentials (ADR-001, ADR-012). A second store is a second install created the
same way as the first — never a second `env.<store>` block, a second
`--config` file in this repository, or a `--name` override against one config.
Those put another merchant's bindings one flag away from the wrong database,
which is how another merchant's content once reached a live storefront.

Bringing an install forward to a new product release is `RELEASE.md` §7 (merge
when the install shares the product's history, manual copy of product-owned
paths when it does not — ADR-020 and `docs/UPDATE-PATH-OWNERSHIP.md`).

---

## 11. What is still manual

With the button (§0), nothing that needs a terminal. What remains is what no
installer can do for the operator:

- **A Cloudflare and a GitHub account**, and pressing the button while signed
  in to both.
- **Choosing `INSTALL_TOKEN`.** It is the one guard between a freshly deployed
  Worker on a public `workers.dev` address and the first stranger to reach
  `/install`; the installer compares it in constant time, refuses anything
  shorter than 16 characters, and allows 10 attempts per address per 15 minutes.
- **Provider accounts.** A Mengantar API key and warehouse ids for shipping, and
  optionally AutoLaris or a bank account for non-COD payment — entered in
  `/admin`, listed by the dashboard's setup checklist.
- **A domain**, attached in the Cloudflare dashboard when the store is ready.
- **The store's own mark.** The logo is set in `/admin` (Settings → Store), but
  the browser-tab and home-screen icons are files: replace `public/favicon.ico`,
  `public/favicon.png`, `public/favicon-192.png` and `public/images/logo.svg` in
  the install repo, or every tab shows the AdsBookCMS product icon (a flat blue
  tile with an open book and an up-right arrow).
- **An alert webhook** (`OPS_ALERT_WEBHOOK_URL`, OBSERVABILITY.md §5), or a
  stalled conversion queue reaches no one.

How a second store is created and kept current is settled by ADR-020 (§10);
A-50 and A-52 are closed on it.
