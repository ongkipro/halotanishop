# Release and Deployment — AdsBookCMS

> Verified against disk: 2026-10-09 @ `8213409` + deploy-builds-first working tree

This document is the single owner of how a change reaches production. It replaces the previous `VERSION.md` runbook and the deleted `AUTO_UPDATE_DEPLOY.md`, which between them described three mutually exclusive release models, none of which matched the one workflow that exists.

---

## 1. The one release path

```
this repo:   push to main → .github/workflows/ci.yml → npm ci → npm run check → npm test → npm run build → stop
an install:  push to main → its own deploy workflow → …same gates… → npx wrangler deploy → live traffic
```

**In this repository, pushing to `main` deploys nothing.** CI runs check, test and build only; there are no Cloudflare credentials here and no deploy target.

Releasing means an install pulls this code into its own repository and deploys from there, against its own Worker, D1, KV, R2 and domain. In an install repository that carries the deploy workflow, **pushing to `main` does reach live traffic with no staging and no approval step**, so a merge there carries the same weight as running a deploy by hand.

The workflow triggers on push to `main`, on pull requests, and on manual
dispatch. It declares **no GitHub environment and no secrets** — those three
lines are the whole trigger block in `ci.yml`.

> The previous version of this section described a `CLOUDFLARE_API_TOKEN` GitHub
> environment and two Cloudflare secrets as if they existed here. They never
> did: that text belonged to the deleted `deploy.yml` and survived six lines
> below the sentence saying it had been removed. Keeping Cloudflare credentials
> out of this repository is the entire point of ADR-012, so a line implying they
> are already present is the most expensive kind of wrong — someone reconciling
> the document against reality would have *added* them.

### Manual deploy

`npm run deploy` runs the deploy preflight, then `astro build`, then
`wrangler deploy` to whatever Worker `wrangler.jsonc` names. Bare
`npx wrangler deploy` skips both: it uploads whatever `dist/` already holds,
so after a merge it ships the *previous* build while every check passes. On
2026-10-09 that put two installs live on yesterday's bundle; the live
`_astro/*.js` hash matching a stale local `dist/` was the tell. Use the npm
script. In **this** repository that file is the one-click
template (all-zero ids, which the deploy preflight refuses), so there is no
production Worker to reach; the command belongs in an install, run against that
install's own resources.

`npx wrangler triggers deploy` changes only the cron schedule, but it reads the
**built** config (`dist/server/wrangler.json`), not `wrangler.jsonc`. Run
`npm run build` after editing `triggers.crons`, or the command reports
"Deployed triggers" while re-applying the schedule of the previous build.
Workers Free allows five cron triggers per account, shared by every install on
it; the hourly cron carries AutoLaris expiry, outbox drains and the alert
evaluation, so an install without one has none of those.

---

## 2. Gates before merging to `main`

Run in this order — it is the order CI runs them, so a failure here is a failure there:

```bash
npm test          # node --test over src/lib/*.test.ts
npm run check     # astro check && tsc --noEmit
npm run build     # astro build
```

Current verified working-tree baseline: **754 tests passing**, `tsc` clean, `astro check` 0 errors / 0 warnings / 0 hints, and the Cloudflare server build complete (2026-09-25, uncommitted audit working tree on `6e30950`). AGENTS.md §4 carries the same number and is the one to keep current.

### Current production-readiness assessment

The 2026-09-25 working tree on `6e30950` is a **release candidate**,
not an unconditional full-production release. The local automated and browser gates are green, but the following
release evidence is still missing:

- a hosted CI run for the exact commit;
- an approved production-D1 migration preflight or an explicitly accepted
  first-request runtime migration;
- read-only or approved sandbox/live smoke evidence for the active Mengantar
  account's tracking, pickup, and insufficient-wallet responses;
- a settled AutoLaris payment observed end to end on a live install.

COD and manual seller-bank transfer can be considered for a controlled canary
after install-specific configuration, backup/rollback preparation, and provider
smoke checks. AutoLaris QRIS/VA no longer depends on the retired webhook path:
since 1.4.x the hourly cron calls the provider's Advice endpoint for every
pending transaction — and each that expired in the last 24 hours, newest first,
up to 25 a run (`PENDING_AUTOLARIS_INQUIRY_SQL`) — and marks one paid **only** when the response carries
`rc: "00"`; `02` stays pending and every other code is unproven and moves
nothing. The owner/admin manual reconciliation from `/admin/payments` remains
as the audited fallback, and both paths write `paid_at`. Automatic marking is
therefore enabled by construction, gated on the provider's own paid code —
what remains unobserved is a real settled response, which only a paid virtual
account produces.

A green build is not proof the storefront works. For any browser-visible change, open the affected page before merging. Neither `tsc` nor `astro check` catches a route that fails to compose — an unterminated `.astro` frontmatter block silently produced a 404 on `/disclaimer` while every static check stayed green.

---

## 3. Database migrations

The Worker bundle contains the exact SQL from `src/db/migrations/`. Before a
database-backed request reaches route code, middleware validates `d1_migrations`
against that chain and atomically applies a valid missing suffix. Each migration's
statements and claim row execute in one D1 batch, so concurrent first requests
cannot claim success around a partial schema.

Operators may still apply the same chain explicitly as a preflight:

```bash
npm run db:migrate:local
npm run db:migrate:remote   # production D1 — approval required
```

Rules:

- **Never edit an applied migration in place.** Corrections ship as a new forward migration.
- **Write migrations by hand.** There is no generator; Drizzle was retired (ADR-005).
- **Keep every migration backward-compatible with the previous Worker bundle.** A Worker rollback cannot roll schema back.
- `src/db/migrations/` is the only migration directory.
- Invalid, unknown, or ahead history fails closed with `SCHEMA_UPGRADE_*`; never bypass the gate.

Migration-specific notes:

- **`0049` (1.3.2, ADR-021)** moves admin sessions and rate-limit counters from
  KV into D1. Sessions are not migrated: every operator logs in once more after
  the first deploy that carries it. Nothing else changes for the buyer.
- **`0050` (1.3.3, ADR-022)** adds `autolaris_callbacks`. Additive; no data
  moves. The provider's `callback_url` starts answering 200 instead of 410.
- **`0051`–`0055`** (ADR-024 renumbering): product catalogue fields
  (`brand`/`description`), the Meta order-context snapshot, checkout
  fingerprint deduplication, the per-operator notification floor, and typed
  landing sections (a table rebuild inside one migration). All additive for
  data; `0055` replaces `landing_sections` in place.
- **`0056`** disables the `Ninja` courier rule (Mengantar retired it from its
  public API on 2026-09-01). The row is disabled, not deleted, so an operator's
  COD flag and exclusions survive.
- **`0057`** re-keys `capi_event_outbox` uniqueness from `event_id` to
  `(event_name, event_id)`, matching how Meta itself deduplicates. It closes a
  path where a funnel event posted with an order number's `event_id` made the
  real Purchase dedupe away. Drops one index and creates one; no data moves.
- **`0058`** adds `install_secrets`, where a Worker with no `AUTH_SECRET`
  secret keeps the session key it generates for itself (ADR-026). Additive;
  an install that sets `AUTH_SECRET` never writes a row.
- **`0059`** adds an `SPX` courier rule to every store that already has a
  courier policy (Mengantar quotes it as `spx`). Additive.
- **`0060`** adds `stores.thanks_whatsapp_redirect`, the switch for handing a
  COD buyer from `/thanks` to WhatsApp support. Default `0`: no behaviour
  changes until an operator turns it on.
- **`0061`** deletes the `Ninja` courier rule `0056` disabled. Only
  `courier_rules` rows; no install had an order with Ninja, and one that did
  would keep its `courier_code`.
- **`0062`–`0065`** (1.5.12): `orders.source_page_path` (the landing page an
  order came from), the Kelola push state on `orders` (`kelola_synced_at`,
  `kelola_attempts`, `kelola_last_error`, `kelola_lead_synced_at`) and the
  `stores.kelola_webhook_*` pair. All additive; the push stays off until an
  operator saves a webhook pair. `0066` (1.6.0) supersedes these columns.
- **`0066`** (1.6.0, ADR-028) creates `plugins`, carries a saved Kelola pair
  into an active `kelola` plugin row, and **drops** the six `kelola_*` columns
  from `orders` and `stores`. That is destructive by design; on 2026-10-20 those
  columns were empty on every store. Kelola's own table
  (`plugin_kelola_orders`) is created on activation, not by the chain.

---

## 4. Version registry

Two registries, currently in step:

| Source | Field | Value |
| --- | --- | --- |
| `src/lib/version.ts` | `version` | `1.7.13` |
| `src/lib/version.ts` | `releaseTag` | `2026.10-plugins` |
| `src/lib/version.ts` | `schemaVersion` | `67` |
| `package.json` | `version` | `1.7.13` |

`src/lib/version.ts` is what the admin sidebar renders and is the value users
see. Keep it and `package.json` in step when bumping.

`schemaVersion` counts migration files, and the tree holds 67 (`0000`–`0066`).
`1.5.0` (2026-10-11) is the first release that carries `0056`–`0061`;
`1.5.12` carries `0062`–`0065`; `1.6.0` carries `0066`.
`schema-version.test.ts` fails CI on drift; middleware enforces the same chain at
runtime; `operational-health.ts` and the dashboard expose applied version.

> This section previously declared the two drifted (`34` against `36`) and said
> `schemaVersion` was "read by nothing in `src/`". Both were false, and acting on
> them meant editing a correct constant until the test guarding it went red.

### Bumping a release

1. Update `src/lib/version.ts` (`version`, `releaseTag`, `lastUpdated`, and `schemaVersion` if migrations were added).
2. Record the change in `BUILD-LOG.md` as a new entry.
3. Update `STATUS.md` if the system state changed.
4. Merge to `main`. In this repository that ships nothing; an install picks the change up through §7.

---

## 5. Rollback

There is no automated rollback. Options, in order of preference:

1. **Revert the commit and merge** — goes through the same gates, and an install redeploys the previous behaviour when it next follows §7.
2. **Cloudflare dashboard rollback** to a previous Worker version — immediate, but the repository no longer matches production until you also revert in git.

**Migrations do not roll back.** A schema change that must be undone requires a new forward migration written for that purpose. Plan destructive schema changes accordingly.

---

## 6. What deploying does not do

- It does not require a separate migration command; runtime applies a valid missing suffix on the first database-backed request. An explicit preflight is still a separate approved production action.
- It does not seed or modify catalog data beyond forward migration logic.
- It does not rotate secrets. Worker secrets are set out of band and are never in `wrangler.jsonc`.
- It does not touch provider state at Mengantar or AutoLaris.

---

## 7. Updating an install from the product

This repository is the product; a store is a separate repository that shares history with it (ADR-012). Bringing a product change into a live store is therefore a merge followed by a deploy, performed **from the install's checkout**, never from here.

### Two shapes an install can take

**A. A local clone, no repository of its own.** The lightest form, and usually the right one. Clone this repository, point it at the store's resources, deploy. Cloudflare never asks where the code came from, so the store needs no GitHub repository at all — updates are `git pull` from this one.

```bash
git clone git@github.com:ongkipro/adsbookcms.git toko-b
cd toko-b
# edit wrangler.jsonc with this store's Worker name, D1/KV/R2 ids, and domains
npm ci && npm run build && npx wrangler deploy
```

**⚠ The hazard specific to this shape:** `origin` is the product. If the install's real `wrangler.jsonc` is committed and pushed, the store's live Worker name, database id, bucket and domains land in the product repository — and the next clone of the product inherits somebody's live infrastructure as its default. Prevent it in the clone:

```bash
git remote set-url --push origin DISABLED    # pulls still work; pushes fail loudly
```

Keep the store's configuration as an uncommitted local change, or commit it only on a branch that is never pushed.

**B. Its own repository.** Warranted when a store needs its own history, its own CI, or collaborators who must not see the product. `origin` is then the store, and this repository is added as a second remote named `product`.

Both shapes use the same update procedure below; only the remote name differs.

### One-time setup, per install clone

```bash
# shape B only — in shape A the product is already `origin`
git remote add product git@github.com:ongkipro/adsbookcms.git

git config merge.keepours.name "keep the install's own copy"
git config merge.keepours.driver true
git check-attr merge -- wrangler.jsonc     # expect: merge: keepours
```

The merge driver is what stops the product's placeholder `wrangler.jsonc` from replacing the install's real one. Git cannot ship a driver inside a repository, so this configuration lives in each clone and must be repeated on every machine. If it is missing, those files conflict instead — noisy, but safe.

### Where every install stands

```bash
npm run fleet:status -- ~/Projects/toko-a ~/Projects/toko-b   # add --offline for git only
```

Read-only: per install checkout it prints the `CMS_VERSION`, HEAD, sync with
its own `origin`, uncommitted files, commits behind `product/main`, the last
Worker deployment and applied/expected D1 migrations. The product keeps no list
of installs (ADR-012), so the checkouts are passed in.

### The procedure, in this order

```bash
git fetch product                       # or `git fetch origin` in shape A
git merge product/main                  # resolve conflicts; keep the install's config
npm ci                                  # only if the lockfile moved
npm run check && npm test               # gates, before touching anything live
npm run build                           # identity is runtime-owned; this is code only
npx wrangler deploy
# optional before deploy, when the operator wants explicit schema preflight:
npm run db:migrate:remote               # separate production approval
```

### Why the order is safe

**Runtime owns schema readiness.** A newly deployed Worker validates and applies
the bundled missing suffix before route code sees D1. Explicit migration remains
useful as a pre-deploy failure check, but it is not a hidden prerequisite for a
working install.

**Identity is not in the build.** It was, and gap G1 tracked that; the `stores`
row now owns it (migration `0036`, `readStoreIdentity`), resolved per request in
middleware. The `PUBLIC_SITE_*` vars in `wrangler.jsonc` are a fallback for a
store that has none, so a build carrying the product's placeholders no longer
produces a bundle stuck calling itself "Your Store" — but keep them accurate
anyway, because they are what an install shows before the wizard runs.

**Confirm the target before deploying.** `npx wrangler deploy --dry-run` prints the resolved Worker name, bindings and routes. If it prints a database or KV id of all zeros, the merge overwrote the install's configuration — stop and restore it. (Since ADR-026 the template's *names* — `adsbookcms`, `adsbookcms-d1` — are real defaults a one-click install may keep, so only the ids are a signal.)

**Both checks are mechanical.** `npm run deploy` and `npm run cf:deploy`
run `preflight:deploy` first (npm's `pre*` hook), and it refuses four times over:

- **the config** — when the Worker name, a D1 database name or id, or an R2
  bucket name is still the product's placeholder. Not overridable; in **this**
  repository it always fails, which is correct: §1 says there is no production
  Worker to reach here.
- **the tree** — when HEAD is behind its upstream (after a fetch, so the count
  is real), when tracked files carry uncommitted changes, when HEAD is detached
  or the branch tracks no remote. `wrangler deploy` uploads the working tree,
  not the branch, and that has reverted production twice: a verified fix
  silently undone 36 minutes later by a clone that had not pulled it, and a
  live landing page removed by a stale clone. Nothing failed either time.
  `ALLOW_STALE_DEPLOY=1` overrides this half only, and prints in full what it
  is overriding.
- **the D1 ledger** — when production `d1_migrations` holds a migration this
  tree does not have (read with `wrangler d1 execute --remote`). The new
  Worker would answer 503 on every database route: zvarashop on 2026-10-15,
  whose `0069`–`0073` were applied and deployed from another device and never
  pushed. Not overridable. A fresh database (no ledger table) passes; a ledger
  that cannot be read is reported and not compared.
- **native landing pages** — when production `landing_pages` holds a
  `source = 'native'` row whose slug this tree's register
  (`src/data/native-landing-pages.ts`) does not list. The hourly reconcile
  deletes such rows, and any product page they claim, within the hour:
  zvarashop on 2026-10-16 carried 55. `ALLOW_NATIVE_LANDING_REMOVAL=1`
  overrides it, for a removal that is intended.

It adds no deploy step and holds no credentials. It cannot cover a bare
`npx wrangler deploy` — wrangler has no pre-deploy hook — so `npm run deploy`
is the deploy command, and reaching for wrangler directly is choosing to skip
this. Logic and decisions: `src/lib/deploy-preflight.ts`.

### What this procedure does not solve

The rest is still manual. The preflight proves the tree is the branch, not that the branch is current with the product: drift between the product and its installs is the accepted cost of ADR-012, and closing it properly is task **A-51**; making the product an installable, versioned artifact is **A-52**.

---

## 8. Approval boundary

`main` is **not** production here (§1), but everything downstream of it is.
These require explicit approval before they happen:

- merging or pushing to `main` **in an install repository**, where it deploys;
- `npx wrangler deploy` / `npm run deploy`;
- `npm run db:migrate:remote` or any `--remote` D1 command;
- creating or deleting Cloudflare resources (D1, KV, R2, custom domains);
- any operation that mutates provider state at Mengantar or AutoLaris.

Read-only local work — tests, typecheck, build, local D1 — needs no approval.
