# Path-ownership manifest — copy-paste install updates

> Verified against disk: 2026-09-26 @ `fc4015f` + alert-webhook working tree

Authority: `DECISIONS.md` ADR-020, `PLAN.md`, `TASKS.md` A-153.

Each store is a copy of AdsBookCMS in its **own repo**, deployed independently.
To update a store, copy the **product-owned** paths of a tested release into its
repo and **never touch** the install-owned ones. This list is the contract.
Derived from the real repo layout (`wrangler.jsonc`, `.gitignore`); it is a
checklist, not an automated engine.

## Product-owned — copy on every update

All application code and its build/test/doc surface. Overwrite these wholesale
from the release:

- `src/**` — all source, scripts, styles, and `src/db/migrations/**` (the sole
  ordered schema source; the install applies only the missing suffix).
- `src/plugins/**`: first-party plugins such as Kelola. Every install carries
  their code. A plugin is installed on a store only when the store activates it
  at Pengaturan → Plugin, which writes D1 rows and plugin tables, not files. An
  install that does not use a plugin keeps its files as they are and does not
  delete them (ADR-027, ADR-028).
- `public/**` **except** merchant brand assets (see install-owned) — shared
  static files, and the favicons until a store replaces them.
- `package.json`, `package-lock.json` — product dependencies and scripts.
- `astro.config.mjs`, `tsconfig.json`, `components.json` — product build config.
- Product docs: `ARCHITECTURE.md`, `PRD.md`, `DECISIONS.md`, `TASKS.md`,
  `PLAN.md`, `UNIMPLEMENTED_SPECS.md`, `OBSERVABILITY.md`, `INSTALLATION.md`,
  `STATUS.md`, `BUILD-LOG.md`, `DESIGN-SYSTEM.md`, `docs/**` (except this file's
  install-specific notes, if any).

## Install-owned — NEVER overwrite

These carry the store's Cloudflare identity, secrets, brand, and history. A
copy-paste update must leave them byte-identical:

- **`wrangler.jsonc`** — holds the store's real Cloudflare resources and
  identity: `name`, `kv_namespaces[].id`, `d1_databases[].database_name` +
  `database_id`, `r2_buckets[].bucket_name`, `routes[]` (custom domain), and
  every `vars.PUBLIC_*` (site name/url/tagline/logo/theme/locale/template/COD
  provinces). Overwriting it points the store at another store's D1 or domain.
  See "Merge by hand" for the product-structural parts.
- **Secrets** — `.env`, `.env.*` (keep `.env.example` as product), `.dev.vars`,
  `.dev.vars.*`. Gitignored, so a tracked-file copy won't carry them, but never
  copy them across stores.
- **`.wrangler/`**, `node_modules/`, `.astro/`, `dist/`, `tmp/` — local
  Cloudflare state and build artifacts. Gitignored; never copied.
- **Merchant brand assets** the store replaced — `public/images/logo.svg`
  (admin and login tab icon),
  `public/images/payment/**` marks, and the favicons `public/favicon.ico`,
  `public/favicon.png` (32 px) and `public/favicon-192.png` (apple-touch; keep
  it full-bleed, the OS rounds it). The product ships neutral defaults; a store
  that swapped them keeps its own, and in a merge-type install a product change
  to one of them is a conflict the store's copy wins.
- **`RELEASE.md`** — once in a store's repo it is that install's adoption and
  deployment log, not the product release log. Do not overwrite it with the
  product's.

## Merge by hand — product-structural fields inside `wrangler.jsonc`

`wrangler.jsonc` is a product template *and* install-owned once filled. When a
release changes its structure, review and apply only these by hand, preserving
every id/name/domain/var above:

- binding **names** (`OMS_DB`, `SESSION`, `ASSET_BUCKET`, `AI`, `ASSETS`) — the
  app resolves bindings by name; they are fixed across installs.
- `main`, `compatibility_date`, `compatibility_flags`.
- `triggers.crons`, `observability`, `workers_dev`.
- `secrets.required` — the list of secret names a deployed Worker must define
  (a new required secret is a product change every install must provision).

## Update procedure (recap of `PLAN.md` §4)

1. Product `main` passes `npm test` / `check` / `build`; that commit is the release.
2. In the store's repo, branch `chore/adsbookcms-<version>`.
3. Copy the product-owned paths from the release; leave install-owned untouched;
   hand-merge the `wrangler.jsonc` structural fields if the release changed them.
4. Apply the missing migration suffix to the store's own D1
   (`npm run db:migrate:local` to verify).
5. `npm test` / `check` / `build` + fresh local D1 migration.
6. Review, deploy, and record the adopted product ref in the store's `RELEASE.md`.

An unknown/unclassified changed path stops the update until it is classified
here — never blind-copy a path this manifest does not name.
