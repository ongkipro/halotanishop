# AGENTS.md — Working Agreement for AdsBookCMS

> Verified against disk: 2026-10-31 @ `7a8f26e` + fix/stack-review-2026-10-31 working tree (baseline 1104)

This file is the contract for any AI coding agent or contributor working in this repository. Read it before the first edit.

**The product is AdsBookCMS (single):** a direct-response commerce CMS installed onto Cloudflare Workers, where **1 installer = 1 Worker = 1 store**. `permatamall.shop` is the reference instance, not the product name.

---

## 1. First principles

1. **The code wins.** When documentation and the tree disagree, the tree is right and the document is a bug to be fixed. This repository was forked from an upstream engine and its documentation described that other repository for months; assume nothing you have not verified.
2. **Never claim something works without running it.** `npm test`, `npm run check`, `npm run build`. For anything browser-visible, open the page — an unterminated `.astro` frontmatter block once produced a live 404 while every static check stayed green.
3. **State what you did not do.** Skipped verification, deferred scope, and unproven assumptions get named explicitly.
4. **This repository deploys nothing.** It is the product; CI runs check, test and build only. A live store deploys from its own install repository, against its own resources. Never add a deploy step or Cloudflare credentials here.

---

## 2. Document ownership

Exactly one document owns each subject. Do not restate another document's truth; link to it.

| Document | Owns |
| --- | --- |
| `README.md` | Repository entry point and orientation. Owns nothing else — it links |
| `AGENTS.md` | Working rules for anyone editing this repository, including this table |
| `ARCHITECTURE.md` | System structure, data layer, config resolution, gap register §10 |
| `DECISIONS.md` | Architecture decisions (ADR). Append-only |
| `RELEASE.md` | Deploy, migrations, versioning, rollback, approval boundary |
| `OBSERVABILITY.md` | Logging, failure visibility, what to enable |
| `INSTALLATION.md` | Standing up a new install |
| `STATUS.md` | Current state of the running system |
| `UNIMPLEMENTED_SPECS.md` | Remaining work and external blockers |
| `PRD.md` | Product requirements |
| `TASKS.md` | Execution log |
| `BUILD-LOG.md` | Chronological history. Append-only |
| `DESIGN-SYSTEM.md` | Visual contract |
| `STOREFRONT_INTEGRATION.md` | Headless `/api/v1/*` contract |
| `docs/OPS-API.md` | Operations `/api/ops/v1/*` contract: scopes, operations, errors. The OpenAPI document it names is generated from `src/lib/ops-openapi.ts` |
| `MENGANTAR_INTEGRATION_SPEC.md` | Courier provider boundary |
| `TRACKING_SPECS.md` | Ad signal contract |
| `PRD-ADMIN-LOGIN.md` | Admin login, first-run access, session |
| `docs/GOOGLE_ADS_SETUP.md` | Google Ads / Merchant Center setup |
| `docs/LANDING-PAGES.md` | Building a landing page, CMS or native Astro |
| `docs/ROUTE-MAP.md` / `docs/route-map.xml` | **Generated, never edited.** The route and module dictionary: URL → file → verbs → auth → roles → libs → tables → tests, and each `src/lib` module's exports, tables, test and callers. `npm run route-map` writes it; `src/lib/route-map.test.ts` fails when it and the filesystem disagree. The first thing to open for an audit, and the thing ARCHITECTURE.md §3 defers to for counts |
| `docs/UPDATE-PATH-OWNERSHIP.md` | Which paths an install update copies and which it never touches (ADR-020). `RELEASE.md` §7 owns the procedure that uses it |
| `PLAN.md` | The ADR-020 install-update plan. Historical; `RELEASE.md` §7 owns the live procedure |
| `design-tokens.md` | Neutral colour/type/spacing values. Subordinate to `DESIGN-SYSTEM.md`, which wins on conflict |
| `docs/NATIVE_LANDING_PAGE_SPEC.md` | Implementation standard for a native Astro landing page. Subordinate to `docs/LANDING-PAGES.md` |
| `docs/AUDIT-<date>.md` | Point-in-time audit report. Findings only; every fix is owned by the document or issue it names. Never a source of truth, never maintained after its date |

Every document carries a `> Verified against disk: <date> @ <sha>` line, this one
included. If you change what a document describes, update that line or the
document is lying about its own freshness. A rewritten history orphans every SHA
those headers cite, so re-stamp them all when `main` is re-founded — sixteen
documents were left pointing at commits reachable only from
`backup/pre-history-rewrite`.

**This table is the only copy.** `README.md` links to it rather than repeating
it; the two drifted apart the last time both carried a list, which is the exact
failure mode this section exists to prevent.

---

## 3. Invariants — do not break these

**Commerce**
- Checkout never dispatches to a courier. Orders land as `pending`; an operator releases them explicitly from `/admin/orders`.
- Paid status changes dispatch *eligibility*, never dispatch itself.
- Price, stock, weight, and identity come from D1. Browser state is never pricing authority.
- **Stock never gates a sale (ADR-023).** It is not read at checkout, at CS conversion, or when deciding what the storefront publishes, and nothing decrements or restores it. Do not reintroduce a stock check; the tests assert its absence.
- Exactly-once order release is enforced through the shared order lifecycle. All single/bulk status changes and deletions must use `src/lib/order-lifecycle.ts`; never write order status or delete order rows around it. `orders.stock_restored_at` is that marker — it predates ADR-023 and now means only "this order is void".
- Anonymous storefront HTML may be served from a two-minute edge cache (ADR-029, `src/lib/edge-cache.ts`). A page whose HTML differs per visitor must not be cacheable: set `Cache-Control: no-store`, set a cookie, or add its path to the denylist. Never write a per-visitor value (an event id, a token, a geo result) into server-rendered HTML.
- Optional integrations are first-party plugins under `src/plugins/<id>/` (ADR-028; Kelola is the first). The core reaches them only through `src/plugins/registry.ts` (`scheduleOrderCreated`, `runPluginCron`). A plugin's tables (`plugin_<id>_*`) are created by its own schema steps on activation, never by `src/db/migrations`. Until a store activates a plugin, it has no row, table, menu, or hook call for it. An install never deletes plugin code to opt out (ADR-027).

**Config**
- Binding names are fixed: `OMS_DB`, `SESSION`, `ASSET_BUCKET`, `AI`, `ASSETS`.
- Provider credentials are D1-first, env-fallback. Never echo a stored credential back through a browser API.
- The admin session key is read only through `resolveAuthSecret` (`src/lib/auth-secret.ts`): an `AUTH_SECRET` env secret of 32+ characters wins, otherwise the Worker's own key from `install_secrets` (ADR-026). Never read `install_secrets` anywhere else, and never return it.
- `wrangler.jsonc` here is a deployable template for the Deploy to Cloudflare button: all-zero ids, no `routes`, `INSTALL_TOKEN` the only required secret. Do not add a real id, a domain, or a second required secret — each one breaks the one-click install.
- Meta CAPI tokens are server-only. Browser and server Purchase share one per-order `event_id`.
- **One `fbq('init')` per pixel id, and `MetaPixelBase` owns it.** fbevents honours advanced matching exactly once per pixel id and discards every later call in silence — not an error, not a warning. Three files once init'd behind the pixel's bootstrap, so the browser Purchase reached Meta matched on one key while the server leg matched on eight. A page with better matching supplies it through `window.__PS_META_INIT__` and declares `__PS_META_AWAIT_MATCHING__` ahead of the pixel; nothing else calls `fbq('init')`. Tests assert this at both source and runtime (TRACKING_SPECS §4a), including that the bootstrap still exposes `__PS_META_INIT__` and `__PS_LOAD_META_PIXEL__` — their callers use `?.`, so a bootstrap without them drops matching in silence. Every browser `track` goes through `window.__PS_META_TRACK__`, which holds it until that init is issued; fbevents discards a track replayed ahead of the init.
- **The catalogue identity fails closed for an ads payload and degrades everywhere else.** `catalogProductId` throws on a row that predates the five-digit scheme, which is right for one payload and wrong wherever the throw outlives the row — a feed, a list, a `.find` predicate, a React render. Those read `catalogProductIdOrNull`. An allowlist test in `catalog-identity.test.ts` refuses a new strict call site.
- Every Headless route is registered in `HEADLESS_OPERATIONS` with one minimum scope. API-key usage quotas and write audit events are D1-backed and part of the request boundary, not UI-only policy.

**Content**
- Product presentation does **not** fail closed, and that is deliberate: an active product with no published content still renders, described from its own title, category and variants. What must never happen is copy belonging to a different product or a different merchant reaching it — that is the invariant, not omission.
- No merchant's content, brand, contact details, or media may ship for a different merchant. This has gone wrong before and reached production.

**Data**
- `src/db/migrations/` is the only description of the schema. There is no `schema.ts` and no generator.
- Migrations are hand-authored.
- Never edit an applied migration in place. Corrections are new forward migrations. The single documented exception is `0017`, which had to be edited because it aborted the chain on a fresh database — read its header before considering another.
- The Worker applies the checked-in migration chain on the first database-backed request after a deploy. Claim rows in `d1_migrations` and their schema statements run in one D1 batch; do not split that atomic boundary.

---

## 4. Verification

```bash
npm test          # node --test over src/lib/*.test.ts
npm run check     # astro check && tsc --noEmit
npm run build     # astro build
npm run route-map # after adding, moving or deleting a page or a lib module
```

`npm test` includes the route-map drift check: add a page under `src/pages/`
or a module under `src/lib/` without regenerating and the suite fails naming
what changed. That is deliberate — a map you must remember to update is a map
that lies, and the previous prose map in ARCHITECTURE.md §3 did.

A React island is only partly covered. A component that throws during SSR
answers `200` with an **empty body** — a blank white page that every static
check calls healthy; 1.3.4 shipped a one-line island change to every install and
left the admin order list blank for a day. `src/lib/admin-islands-render.test.ts`
now bundles and server-renders the seven admin islands that carry data
(`OrdersTable`, `OrderDetail`, `PaymentReconciliationQueue`, `ProductForm`,
`LandingPageEditor`, `RateCheckTools`, `OperationalStatus`); any other island, and every client-side script, is still
proven only by opening the page. Put branch logic in `src/lib/` where the runner
can reach it.

On a fresh clone, run `npm run check` rather than bare `npx tsc --noEmit`. `astro check` generates `.astro/types.d.ts` first; without it `tsc` reports phantom errors such as `Property 'env' does not exist on type 'ImportMeta'`.

Current verified working-tree baseline: **1104 passing** (0 skipped, 2026-10-31, `fix/stack-review-2026-10-31` on `7a8f26e`), 0 type errors, `astro check` 0 errors / 0 warnings / 0 hints (548 files). A change that reduces this baseline is not done.

New non-trivial logic — a branch, a parser, a money or auth path — leaves one runnable check behind. Trivial one-liners do not need a test.

`src/lib/auth.ts` is covered by `src/lib/auth.test.ts` (15 tests, mutation-verified). That suite asserts security *properties* — a tampered signature is rejected, a rotated credential closes the session, a role never reaches a route it should not. Keep it that way: a test that merely asserts a valid token is valid buys nothing.

---

## 5. Approval gates

Ask before: `wrangler deploy` or any `--remote` D1 command — both act on a real install and neither belongs to this repository; creating or deleting Cloudflare resources; anything that mutates provider state at Mengantar or AutoLaris; reading or printing secrets; deleting data; pushing to a branch that an install deploys from.

Pushing to `main` **here** deploys nothing (ADR-012), so it is ordinary work — but adding a deploy step or Cloudflare credentials to this repository is not, and must never be done.

Local work — tests, typecheck, build, local D1, reading code — needs no approval.

A permitted command is not an approved one. The tooling here runs with broad permissions; the boundary is behavioural.

---

## 6. Code discipline

Smallest change that is correct. Reuse what exists before adding; the codebase already has 116 non-test lib modules and duplicating one is the most common failure mode.

Before adding a dependency, check whether the platform already provides it. Two headless UI libraries already ship side by side (`radix-ui` and `@base-ui/react`) — do not add a third.

Admin UI follows the control contract in DESIGN-SYSTEM.md §7.1: shadcn
primitives own every control's height, radius and colour (never pass them per
call), filter rows are `FilterBar`/`FilterField`, search is `SearchInput`, page
width belongs to AdminShell alone. `admin-controls.test.ts` and
`admin-page-width.test.ts` fail the suite when a screen drifts from it — fix
the screen, not the test.

Fix root causes, not symptoms. Grep every caller before editing a shared function: one guard in the shared path is a smaller diff than one guard per call site, and patching only the path in front of you leaves siblings broken.

Deliberate corner-cuts get a `// lazy:` comment naming the ceiling and the upgrade path.

---

## 7. Things that are wrong on purpose right now

Do not "fix" these silently or treat them as bugs to be surprised by — they are known, tracked, and have decisions attached:

- Missing published home content is composed from the store's **own** name, catalogue and public landing pages (ADR-025 amending ADR-007). Never restore compiled copy or anything written for another merchant.
- Storefront template definitions live in `storefront_templates`. Built-in `compact-market` is seeded only as an editable D1 definition (`wide-catalog` was removed by `0044`); adding a definition must not require a rebuild.
- The admin session cookie is `adsbook_session`, declared once as `SESSION_COOKIE_NAME` in `src/lib/auth.ts`. Never write the literal string; a writer and reader that disagree is a silent lockout.
- The `SESSION` KV binding holds **caches only** (ADR-021). Admin sessions live in `admin_sessions` and rate-limit windows in `rate_limits`, both D1. A KV write on any request path must be wrapped so that its failure is logged and nothing else — the account-wide Free-plan write allowance ran out once and took every install's login and checkout search down with it.
- The click cookie is `adsbook_click_ids`. The former `zanoby_click_ids` is still **read** as a fallback so an upgrading install does not lose 90 days of in-flight attribution. Never write the legacy name; it ages out on its own.
- Newly issued developer API keys carry `adsbook_live_`. Keys issued as `cmsads_live_` still validate — the stored value is a SHA-256 digest, so the prefix never took part in matching, and rewriting it would have broken them. The legacy prefix survives only in `maskApiKeySecret` so an old key still renders a coherent preview.

---

## 8. Language

Repository artifacts — documentation, code comments, commit messages — are written in **English**. User-facing product copy is Indonesian. Do not translate quoted UI strings or third-party interface labels.
