# Architecture Decision Record — AdsBookCMS

> Verified against disk: 2026-10-30 @ `cbcadbf` + fix/warehouse-primary-fallback working tree

Append-only. One decision per entry. A decision is recorded here only when it constrains future work; implementation detail belongs in `ARCHITECTURE.md`, remaining work in `UNIMPLEMENTED_SPECS.md`.

Status values: **Accepted** · **Superseded by ADR-nnn** · **Proposed** (decided in principle, not yet implemented).

---

## ADR-001 — One install per Worker

**Date:** 2026-08-16 · **Status:** Accepted

**Context.** The codebase was forked from a multi-tenant engine whose documentation described request-time tenant selection, a tenant registry, and a fleet deployment model. None of that machinery exists in this repository, and the data layer assumes a single logical merchant (`SELECT ... FROM stores ORDER BY id LIMIT 1`).

**Decision.** AdsBookCMS is a **single-install product**: one installer run produces one Worker, one D1, one KV namespace, one R2 bucket, one domain, one store. Isolation is a property of the deployment boundary.

**Consequences.** No `store_id` scoping work is required. Two stores mean two installs and two upgrade cycles. A fleet-management surface, if ever needed, is a separate product that drives installs from outside — not a mode inside this Worker.

**Rejected alternative.** Shared Worker with `Host`-based routing. Cloudflare does not permit selecting a D1 binding from request input, so this collapses into either one shared database (blast radius: every store) or Workers for Platforms (cost and operational weight far beyond the product).

---

## ADR-002 — The platform is the isolation boundary, so no tenant abstraction in code

**Date:** 2026-08-16 · **Status:** Accepted

**Decision.** Do not reintroduce tenant slugs, content packs, tenant registries, or per-tenant branches in application code. Inert remnants (`CONTENT_PACK_IDS`, `PUBLIC_TENANT_SLUG`, `CMSADS_TENANT_CONFIG`) are to be removed, not revived.

**Consequences.** Any behavioural difference between installs must be expressed as data in D1 or as configuration, never as a code branch keyed on identity.

---

## ADR-003 — Store identity must resolve at runtime, not at build time

**Date:** 2026-08-16 · **Status:** Accepted — implemented 2026-08-16 (migration `0036`, gap G1)

**Context.** Identity resolved from `import.meta.env`, which Astro freezes into the bundle at build time. Site name, URL, logo, tagline, theme colour, locale, and template therefore required a rebuild to change, and `stores.name` in D1 was a second, divergent value that did not affect storefront branding.

**Decision.** Identity is D1-owned. `readStoreIdentity` reads the `stores` row and `resolveTenantConfig` layers row → environment → product default; environment values now serve a store that has not set a field, which before the wizard runs is every field.

**Consequences.** Resolution happens once per request in `src/middleware.ts` and is handed to consumers as `Astro.locals.tenant`, so the 125 call sites stay synchronous — a per-consumer async read would have made every one of them an opportunity to forget an `await` for a value that cannot change mid-request. This was the precondition for ADR-004.

---

## ADR-004 — Installation is a first-run wizard, not a terminal procedure

**Date:** 2026-08-16 · **Status:** Accepted — implemented 2026-08-16 (`/install`, gap G2)

**Context.** Onboarding currently requires an operator with Wrangler credentials, a `.env` file, and a manual seed. The product target is WordPress-like: point a domain at the Worker, open it, fill in a form.

**Decision.** A first-run `/install` route detects an uninitialised database, collects store identity, admin credentials, and locale/currency, writes them to D1, and marks the install complete. Once complete the route refuses to run again.

**Consequences.** Depends on ADR-003. Requires a neutral, deletable sample dataset (ADR-006) and a fail-closed empty state (ADR-007), because a fresh install has no content by definition.

**Correction, 2026-08-17.** The implemented wizard collects store name, HTTPS site URL, optional tagline/support WhatsApp, admin username/password, and storefront template. It does not render locale or currency controls: locale currently enters the install plan as `id-ID`, while currency is not an installer field. The Decision sentence above records the original intent and must not be read as current UI evidence.

**Correction, 2026-08-17.** A new Worker no longer requires a terminal migration
step before the wizard. The first database-backed request applies the bundled
checked-in migration chain and then evaluates install state. Invalid, unknown, or
ahead migration history returns a labelled 503 rather than partially installing.

---

## ADR-005 — Raw SQL is the data layer; Drizzle is removed entirely

**Date:** 2026-08-16 · **Status:** Accepted

**Context.** All 45 data-touching modules use `D1Database.prepare()`. `getDb()` has zero importers. The Drizzle journal has diverged from the migration directory, so `drizzle-kit generate` would emit a destructive diff.

**Decision.** Raw prepared statements remain the data access pattern. `schema.ts` is not a source of truth; migrations are. New migrations are written by hand.

**Resolved 2026-08-16 — removed, not repaired.** `schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, the whole `migrations/meta/` directory, both dependencies and the `db:generate` script are gone.

Repair was rejected on evidence. drizzle-kit's SQLite snapshots cannot represent the `product_variants_stock_nonnegative` trigger — the invariant `AGENTS.md` names as enforced by the database rather than the application — so the first generated migration that rebuilt that table would have silently dropped it. A repaired generator emitting correct-looking SQL that destroys a data-integrity guarantee is strictly worse than a broken one that fails loudly. The schema also holds a DESC-ordered index, a CHECK constraint, and five data migrations, none of which the generator can emit, so hand-authored SQL would have remained mandatory either way.

The audit that settled it also found the declared index layer was **fiction**: of 8 indexes in `schema.ts`, 6 existed in no migration at all — they lived only in a snapshot file — while 10 real indexes were undeclared. A reader would have assumed indexes that do not exist. That is the trap this decision removes.

---

## ADR-006 — Sample data must be neutral, ours, and deletable

**Date:** 2026-08-16 · **Status:** Accepted, implemented 2026-08-16 · **Amended by ADR-011**

**Context.** Migration `0017` seeds a product belonging to a previous merchant, and `product-mutation.ts` blocks deleting it through the admin API. Three sources disagree on what the "canonical sample" even is.

**Decision (as implemented).** The bundled demo catalog *is* the sample data (ADR-011) — it is ours, it is editable, and it is deletable. The separate "canonical immutable sample product" concept was therefore **removed**, not repointed: four sources disagreed on its identity, and an un-deletable row contradicts a CMS whose promise is that the merchant owns their catalog.

**Consequences.** Migration `0034` removes the foreign row from databases that already applied `0017`, guarded on identity (slug and title must still match what `0017` wrote, so an edited row survives) and on order references (nothing is removed while an `order_items` row points at one of its variants). Every statement is a guarded `DELETE`, so the migration is idempotent. `isCanonicalSampleProductId` and its five call sites are gone.

---

## ADR-007 — A fresh install fails closed, never inherits copy

**Date:** 2026-08-16 · **Status:** Accepted — implemented 2026-08-17 (G5)

**Context.** An active product without published presentation remains visible from its own catalog facts; that is the catalog contract, not a fallback. Home content is different: generated shell copy could make an unconfigured install look complete and previously allowed compiled merchant content to reach the wrong store.

**Decision.** Missing published home content renders an explicit setup state. Compiled or generated copy is never a fallback for merchant-facing home content. `getTenantHomeContent` returns `setup-required`, which both the built-in home and Headless storefront descriptor preserve.

---

## ADR-008 — `main` is the release branch and deploying is automatic

**Date:** 2026-08-16 · **Status:** Superseded by ADR-012 for this repository; still true inside an install repository

**Context.** *(Recorded before the split; see ADR-012.)* Four documents claimed that pushing to `main` does not deploy. At the time, `.github/workflows/deploy.yml` ran `npx wrangler deploy` on every push to `main`.

**Decision.** Keep the behaviour, document it honestly, and treat `main` as production. Feature work happens on branches; merging is the release action and requires the same approval as a deploy.

**Consequences.** No staging environment exists. Introducing one is a separate decision, not an assumed safety net.

---

## ADR-009 — npm is the package manager

**Date:** 2026-08-16 · **Status:** Accepted

**Decision.** `package-lock.json` + `npm ci` are authoritative, matching CI. This is a single-package repository. `pnpm-lock.yaml` and the `pnpm-workspace.yaml` stub were deleted on 2026-08-16; neither file exists.

---

## ADR-010 — Documentation is verified against disk or it is deleted

**Date:** 2026-08-16 · **Status:** Accepted

**Context.** An audit found ~100 references to npm scripts that do not exist, four documents inverting the deploy contract, and one instructing agents to remove an HTTP header that a passing test asserts. The docs were inherited wholesale from the upstream engine and never reconciled.

**Decision.** Every document in this repository states only what can be verified against the current tree, and carries the date it was verified. A document describing another repository's machinery is deleted, not annotated. Aspirational work belongs in the gap register (`ARCHITECTURE.md` §10) or `UNIMPLEMENTED_SPECS.md`, never in the present tense.

---

## ADR-011 — "Permata Mall" is the bundled demo dataset, not a merchant

**Date:** 2026-08-16 · **Status:** Superseded by ADR-016 on the bundling question; its ours-versus-theirs distinction still holds

**Context.** The repository ships a complete storefront — 22 women's handbag products, 110 variants, product photography, and the `permatamall.shop` deployment. Earlier cleanup work treated this as live merchant data to be protected, which made every content decision unnecessarily cautious.

**Decision.** Permata Mall is the **demo dataset** that AdsBookCMS installs with. It exists so a fresh install has something real to look at, and it is replaced through the CMS when a merchant onboards. It is neither production data to be preserved at all costs nor foreign content to be purged.

**Consequences.**
- ~~`scripts/seed-catalog.sql` and `public/images/products/` are product assets and stay.~~ Removed 2026-08-17; see ADR-016.
- Breaking changes to this install — invalidating its sessions, rotating its cookie names, resetting its attribution — are acceptable when they improve the product.
- Content belonging to *other* merchants is still removed. The distinction is ours-versus-theirs, not demo-versus-real.
- Product identity in code defaults to AdsBookCMS, never to the demo store. An unconfigured install must describe itself, not inherit the bundle it was built from.

---

---

## ADR-012 — Product and install live in separate repositories

**Date:** 2026-08-16 · **Status:** Accepted

**Context.** The CMS and its first store shared one repository. That is how the codebase reached the state this repository spent a day repairing: engine documentation describing another repository, three former merchants' content served from a live storefront, and an un-deletable sample product from a store nobody here operates. A fork per store cannot be kept in sync, so every fix has to be redone in every copy.

**Decision.** `ongkipro/adsbookcms` is the **product**. It deploys nothing, holds no Cloudflare credentials, and ships `wrangler.jsonc` as a template of placeholders. Each store is a separate repository with its own Worker, D1, KV, R2 and domain, and deploys from there.

**Consequences.**
- An install does **not** need a repository of its own. Cloudflare has no relationship to git, so the lightest install is a local clone of this repository pointed at the store's own resources, updated by `git pull`. A separate store repository is warranted only when the store needs its own history, CI, or collaborators. Both shapes are documented in `RELEASE.md` §7.
- The deploy workflow was removed from this repository and replaced with CI that runs check, test and build. Adding a deploy step or Cloudflare secrets here would let product work overwrite a live store — that is the specific hazard this decision exists to prevent.
- Per-store differences are configuration and data, never code. A store that needs a code change needs it in the product.
- Carrying a fix into a store is a deliberate act by that store, gated by its own approval and deploy.
- This is a fork model, and its known cost is drift between product and installs. It was chosen over one shared repository so the product can be developed freely without every change touching live traffic. Keeping installs current is therefore an explicit, recurring task, not something the structure does for you.

**Note on history.** The repository was split carrying the full history from
before it, which included former merchants' names and their deleted product
photography in git objects — 64 such blobs. `main` was re-founded on an orphan
root on 2026-08-16: 3 commits, no foreign blobs, `.git` from 133MB to 26MB. The
previous 61 commits are preserved locally on `backup/pre-history-rewrite` and are
not published. Anything citing a commit older than the new root refers to that
branch, not to `main`.

---

---

## ADR-013 — Path decisions come from the URL the framework routed on

**Date:** 2026-08-17 · **Status:** Accepted

**Context.** `src/middleware.ts` classified every request — private or public,
admin or storefront, installer or not — from `new URL(context.request.url)`.
Astro routes on a normalized pathname instead: it percent-decodes in a loop and
collapses duplicate slashes, exposing the result as `context.url` while leaving
`context.request` at the raw bytes the client sent.

The two strings differ for any request an attacker chooses to make them differ
for. Measured on the built Worker under `wrangler dev`, with no cookie:
`/api/admin/settings` returned 401 while `//api/admin/settings` returned 200 with
the store's provider settings, and `PUT //api/admin/settings` from a foreign
origin returned 200 and rewrote the courier API key. The session check, the role
check, the CSRF origin check and the password-rotation gate were all inside the
block that was skipped.

**Decision.** Every path decision in middleware reads `context.url`. Nothing
derives a pathname from `context.request`. `src/lib/middleware-path-source.test.ts`
fails if that changes, and `auth.test.ts` drives the real handler with the shapes
that got through.

**Consequences.** A test harness that constructs a context must supply `url`
itself; supplying only `request` is what let this pass CI. The harness now
reproduces Astro's normalization rather than skipping it.

---

## ADR-014 — A rate-limit ceiling may not be reachable by someone who only knows a username

**Date:** 2026-08-17 · **Status:** Accepted

**Context.** Admin login counted failures in three buckets: the pair
`username|ip` at 5, the address at 20, and the identifier at 50. The identifier
bucket was documented as a backstop against a distributed attempt, with the
lockout it implies accepted as "a wait of at most one window".

That accounting was right and the conclusion was wrong. Ten addresses spending
their pair allowance is exactly 50, so sixty requests — knowing only the
username, guessing no passwords — denied the real operator, with the correct
password, from an address that had never failed. Repeatable at four requests a
minute, indefinitely. A single host with an IPv6 /64 has 2⁶⁴ addresses.

**Decision.** The identifier bucket still counts everywhere but denies only an
address that has itself failed for that account inside the window. An attacker
cannot place a failure on an address they do not control, so the operator keeps a
way in; a distributed attempt still hits its ceiling on every address it uses.

**Consequences.** A distributed attacker with unlimited fresh addresses is
bounded by the pair bucket alone, at 5 per address per window against 100k-round
PBKDF2. That is the accepted trade, and it is the right way round: availability
of the merchant's own admin over a marginal gain against an attacker who already
has to bring new infrastructure per attempt.

Separately and still open: `checkRateLimit` is a non-atomic KV get-then-put, so N
simultaneous guesses read the same count and spend one slot between them. It
damps sequential guessing, not parallel. Making it exact needs a Durable Object —
task **A-71**.

---

## ADR-015 — Catalog identity is `p{product}-v{variant}`, derived from keys that never change

**Date:** 2026-08-17 · **Status:** Superseded by ADR-017

**Context.** One rule governs catalog advertising: the `id` a feed publishes must
be exactly the string the Pixel and CAPI send as `content_ids`. Meta states it
directly — "for dynamic ads, this ID must exactly match the content ID for the
same item in your Meta Pixel."

It did not match. The feed published `10001` (row id plus 10000), the admin
screen showed the operator that same `10001`, and the Pixel sent the raw row id,
`1`. Three values for one product, and nothing anywhere reported a problem:
Advantage+ and Dynamic Product Ads simply retargeted nobody while the merchant
paid for the traffic. Two further defects rode along — the first variant of a
multi-variant product was published without its `item_group_id`, so the group had
one member and the orphan's id collided with the group id; and the group was
submitted with no variant attribute at all, which Google requires and which is a
common reason for outright feed disapproval.

**Decision.** The catalog is variant-level. The item id is
`p{product_id}-v{variant_id}`; the group every variant shares is
`p{product_id}`; the group is never published as an item.

Both derive from the D1 AUTOINCREMENT keys, **not** from SKU — despite both
platforms recommending SKU. Google's rule is that an id, once assigned, is never
changed and never reused, and `product_variants.sku` here is nullable and
merchant-editable, so it is precisely the value that moves. The primary keys
never change and are never handed out twice.

The prefix is not decoration. Neither specification imposes a minimum length or
digits-only — Google allows 1–50 characters of alphanumerics, dashes and
underscores, Meta allows 100 — but a bare `1` is fragile exactly where feeds
travel: spreadsheet and CSV coercion, leading zeros dropped, collisions when two
sources merge. Three characters remove all of that and make the id self-
describing, so `p1-v12` says what it is where `12` does not. Padding to a fixed
width, which is what the previous scheme attempted, buys none of it.

**Consequences.** `content_id` in `/api/v1/products*` and `/api/form-config`
changes value — the field names are unchanged, so this is a value break rather
than a shape break, and it is documented in `STOREFRONT_INTEGRATION.md`. A client
following the old contract was already failing to match the catalog.

Ids must never change again. Any install that has already submitted a feed would
need its catalog re-created, which is why this landed before the product had live
installs and must not be revisited casually.

`src/lib/catalog-identity.test.ts` checks the two halves against each other —
what the feed publishes against what each surface sends — rather than each
against a fixture, because a fixture is how three different values passed CI.

Deferred: `product_variants` records one free-text label and nothing that says
which axis it varies, so every label ships as `g:size` whether it is a size, a
colour or a pack count. Google treats size as free text, so this is imprecise
rather than invalid. A `variant_axis` column is the upgrade.

---

## ADR-016 — A fresh install ships empty

**Date:** 2026-08-17 · **Status:** Accepted

**Context.** ADR-011 kept a bundled demo catalogue — 22 products, 110 variants
and 8.9MB of photography — so a fresh install had "something real to look at".
That was a reasonable answer while this repository was still one store becoming a
product. It reads differently now that an install is a wizard away: the first
thing an operator meets is somebody else's inventory, in a category they may not
sell, which they must find and delete before their own catalogue makes sense.

The empty states turned out to be already built and already honest. Measured on a
migrated, installed, product-free database: `/produk` renders "Katalog sedang
disiapkan — produk akan muncul setelah konten dan varian diterbitkan",
`/kontak` renders "Kontak Belum Tersedia", the catalog feeds emit valid empty
XML, the sitemap resolves, and every route returns 200. Nothing was broken by
having nothing.

**Decision.** No dataset ships. `scripts/seed-catalog.sql`,
`public/images/products/` and the `db:reset:demo:local` script are removed. An
install starts genuinely empty, and the storefront says so.

Whether to reintroduce sample data — and if so, whether as a seed, an optional
one-click demo from the admin, or a downloadable pack — is **deferred**, not
decided against. This ADR records that the bundled-by-default answer was wrong,
not that the question is closed.

**Consequences.**
- `public/images` went from 21MB to 232KB across this and the orphan-asset
  cleanup. What remains is the product's own mark, the favicon, and the payment
  method logos.
- The home page gained the empty state its siblings already had. The product
  grid, the search box and the "0 of 0" counter are hidden when there is nothing
  to count, so a visitor sees an explanation rather than a broken-looking page.
- **The ad taxonomy lost its justification and had to change.** Its default was
  Google category `6551`, Handbags, reasoned in the code as "at least a category
  this catalog sells". With no catalogue that premise is false, and keeping the
  default would have submitted every unclassified product in every store to
  Merchant Center as a handbag — the exact misrepresentation the same comment
  warns about. `getAdTaxonomy` now returns no category when no rule is
  confident, and the feeds omit `google_product_category` and
  `fb_product_category` rather than assert one. Both fields are optional and
  Google auto-classifies what is missing.
- Gap **G5** narrows to the home *shell*: `buildDefaultHomeContent` still
  composes headings from the store's identity rather than rendering an operator
  setup state. That is A-12b and stays open. The harm G5 originally described —
  a fresh install inheriting another merchant's marketing copy — is gone.
- Anything relying on the demo catalogue for grounding is now unfounded, and
  `docs/GOOGLE_ADS_SETUP.md`'s taxonomy reasoning was rewritten accordingly.

---

## ADR-017 — Product ID is the single advertising catalog identity

**Date:** 2026-08-18 · **Status:** Accepted

**Context.** ADR-015 made feeds variant-grained, but the rest of the funnel did
not consistently carry that identity. Hosted forms and confirmation could send
the bare product row while browser ViewContent sent `p{product}-v{variant}`.
This made otherwise valid Meta and Google events impossible to match reliably.
The operator also needs the ID shown in Admin, the public API `content_id`, and
the XML feed `<g:id>` to describe the same business object without translation.

**Decision.** The immutable numeric Product ID is the one catalog identity.
New products are allocated a decimal ID from 10000 through 99999. A canonical
ID must contain at least five digits, have no leading zero, and fit within a
JavaScript safe integer. Product ID, API `content_id`, Meta `content_ids`, Google
ecommerce `item_id`, and both feeds' `<g:id>` are byte-identical.

Each active product produces exactly one feed item. The first sellable variant
supplies its price and optional SKU to that item. Other variants remain checkout
choices addressed by their raw `variant_id` and may be reported separately as
`item_variant`; they do not create another advertising identity. Feeds omit
`item_group_id` because they no longer publish variant-grained items.

**Consequences.** Existing external catalogs created from ADR-015 identifiers
must be refreshed or recreated when this change is deployed; queued historical
events are not rewritten. Legacy database rows with Product IDs below 10000
fail closed and require an explicit catalog remap rather than silent padding,
because padding would break the promise that external identity equals Product
ID. Variant selectors and embed URLs must always use `variant.id`, never the
shared `content_id`.

---

## ADR-018 — The storefront ships one layout

**Date:** 2026-08-20 · **Status:** Accepted

**Context.** Two storefront templates shipped: `compact-market`, a 480 px column,
and `wide-catalog`, an unconstrained shell. `wide` was not merely one built-in —
it was a value in the composition schema, so any runtime definition in
`storefront_templates` could declare it. That put the width branch in three
places (`BaseLayout`, `Breadcrumb`, `PageIntro`) and they drifted: two product
pages force `compact`, so on a `wide-catalog` store they rendered a 480 px shell
around a `max-w-6xl` breadcrumb until it was repaired.

All three live installs render compact. None selected the wide template.

**Decision.** The public storefront is compact only. `wide-catalog` and the
`wide` layout value are removed: `WideCatalogHome.astro` is deleted, the
composition schema takes `z.literal("compact")`, and the template pickers in the
install wizard and store settings offer one option.

**Consequences.**
- The width contract added for the drift is deleted with it. One width needs no
  resolver, no class map and no `contentWidth` prop — that abstraction existed
  only to keep two answers in step.
- Migration `0044` moves any store still pointing at `wide-catalog` to
  `compact-market` and deletes runtime definitions declaring `layout: "wide"`.
  Without it such a store would fail validation on the next request and take its
  home page to the unavailable state. It is idempotent and matches nothing on a
  store that was already compact.
- A second layout can return, but as a deliberate design with its own renderer
  rather than a branch inherited from the engine this repository forked.
- The cost was named before it was accepted: this removes a shipped capability
  and the data migration is one way. It was taken as an explicit product
  decision, not inferred from the fact that no install happened to use it.

---

## ADR-019 — The public surface carries one overridable accent

**Date:** 2026-08-20 · **Amended:** 2026-08-23 · **Status:** Accepted

> **Amendment, 2026-08-23.** This ADR was titled *The public surface is
> monochrome* and forbade a house accent outright. #58 introduced one anyway,
> the code and this decision disagreed, and the audit that caught it
> (`docs/AUDIT-2026-08-23.md` §6) put the question back here rather than
> reverting. Amended in favour of the code, for a reason the original text
> could not have anticipated: **how** the accent is expressed turns out to
> matter more than whether it exists.
>
> The gold this ADR removed was 48 hardcoded usages, so re-branding meant
> patching every call site. #58's accent is five custom properties in
> `src/styles/form-hybrid.css`, so re-branding means overriding five
> declarations. That is the shape a product which installs for any merchant
> actually needs — the original decision reached for absence because tokens
> were not on the table.
>
> The accessibility half of the original case does not carry over and was
> re-measured before amending: `#2c6ecb` is **5.00:1 on white** and 5.00:1
> under white, `#1f5199` is 7.79:1, `#1a1a1a` on `#eef4fc` is 15.73:1.
> `#c9cccf` at 1.61:1 is a field border and correct as one. Nothing here
> repeats `#C5A880`'s failure.
>
> **Amended decision.** One accent, expressed as overridable tokens, defaulting
> to a neutral blue, **never hardcoded at a call site.** The token set is the
> re-brand contract and is listed below; adding a sixth without listing it is
> the defect this amendment exists to prevent.
>
> | Token | Default | Role |
> | --- | --- | --- |
> | `--sf-accent` | `#2c6ecb` | primary action fill, active state |
> | `--sf-accent-strong` | `#1f5199` | hover, pressed |
> | `--sf-accent-soft` | `#eef4fc` | selected row fill, quiet emphasis |
> | `--sf-accent-ring` | `rgba(44, 110, 203, 0.28)` | focus ring — derive it from the accent, never leave it behind |
> | `--sf-field` | `#ffffff` | input background |
> | `--sf-field-border` | `#c9cccf` | field hairline — border only, never text |
> | `--sf-surface-alt` | `#f6f8fb` | wells and inset panels |
> | `--sf-line` | `#e3e3e3` | separator hairline — 1.28:1, decorative only |
>
> An install re-brands by redeclaring these eight. It does not fork the
> stylesheet, and a sync does not have to diff the product's CSS to discover
> what moved — which is exactly what `zanobyshop` had to do, at a cost of seven
> mappings in its own palette script, before this table existed.
>
> **This table said five for one day**, and the three it omitted are the
> instructive part. `--sf-accent-ring` is an `rgba()` rather than a hex, so a
> store palette script that matched on hex literals skipped it silently and
> shipped an orange button wearing a blue focus ring — `zvarashop`, 2026-08-23.
> `--sf-field` and `--sf-line` were omitted because they read as neutrals, but
> a store that inverts its field background has to know they are here. The rule
> the omission proves: **the table is the contract, so a token that is not in
> it is a token an install cannot re-brand.**
>
> Text on `--sf-accent-soft` must clear 4.5:1 against it, not merely against
> white. That surface is a fill with copy on it, and a store that missed it
> shipped a struck-through price at 4.41:1.
>
> Everything below is the original decision and stands except where the
> amendment above replaces it.

**Context.** The storefront shipped a warm neutral palette with a gold accent,
`#C5A880`, across 48 usages. That reads as a brand — and this repository is not
a brand. It is a CMS that installs for any merchant, and the merchant has their
own. A house accent in twelve badge backgrounds is something every landing page
and every custom product page then has to argue with.

Measured while removing it: `#C5A880` is **2.26:1 on white**. It was failing
WCAG AA as text the whole time it was used as text, in ten places.

**Decision.** *(Superseded on the accent question by the amendment above; the
neutral ladder, shape and shadow rules stand.)* Ink on white, Dawn-clean.
`#111111` ink, three neutral steps
(`#FAFAFA` canvas, `#FFFFFF` column, `#F5F5F5` wells), `#E5E5E5` hairlines used
sparingly, square corners, no decorative shadows. Product images are 1:1.
Tokens live in `design-tokens.md` at the repository root.

**Consequences.**
- A landing page or a custom product page can introduce one colour and own it
  completely. That is the point of the change, not a side effect.
- The focus ring stays blue. It is the one colour left and it is deliberate:
  monochrome cannot express focus against a monochrome page, and a focus
  indicator needs 3:1.
- `#999999`, used for footer text, was 2.85:1 and is now `#767676` at 4.54:1 —
  the floor for body copy.
- Card frames and small shadows are gone from the public surface. Borders
  separate; they do not wrap a photo that already has edges.
- The admin keeps its own palette. `admin.css` owns shadcn and is untouched.
- The focus ring consequence below is now the general rule rather than an
  exception: monochrome could not express state against a monochrome page, and
  the amendment simply names the colour that was always going to be needed.

---

## ADR-020 — Isolated installs are updated by manual copy, not a fleet engine

**Date:** 2026-08-23 · **Revised:** 2026-08-23 · **Status:** Accepted. Security gate (A-151) done; fleet-automation engine withdrawn as YAGNI.

**Context.** ADR-001 and ADR-012 established the correct runtime boundary: one
store owns one repository, Worker, D1, KV namespace, R2 bucket, domain, and
credential set. That isolation is valuable, but the update mechanism is not
uniform. Some installations merge a `product` remote, one uses a sync script,
and installation-owned decisions in `wrangler.jsonc` survive only when the
incoming diff happens not to touch them. The 2026-08-23 audit also found local
product worktrees at different revisions, proving that folder names alone do
not identify product truth.

Returning to a shared multi-tenant Worker would remove per-install rollout at
the cost of reintroducing tenant routing and isolation into every query, cache,
session, object key, provider credential, migration, domain, and failure path.
That cost and blast radius are disproportionate to the actual problem, which is
manual and inconsistent source distribution.

**Decision.** Keep the single-install architecture and distribute product
updates by **manual copy** of product-owned paths into each installation's own
repository. This is the lightest mechanism that preserves isolation and stays
maximal on Cloudflare: each install is one Worker + one D1 with zero
tenant-routing overhead, and an update is a plain source copy an operator can
read and reason about.

The only supporting artifact is a **path-ownership manifest** — a documented
list classifying every synchronized path as product-owned (copied on update:
`src/`, tests, `package.json`/lockfile, `src/db/migrations/`) or install-owned
(never overwritten: `wrangler` config, Cloudflare / D1 / KV / R2 identifiers,
secrets and `.dev.vars`, custom domain, merchant assets, and each install's
`RELEASE.md`). To update an install an operator copies the product-owned diff of
a tested release ref onto a branch in that install's repo, applies the missing
ordered migration suffix to that install's own D1, validates
(`npm test` / `check` / `build` / `db:migrate:local`), reviews, and deploys —
each install independently, no database or customer data ever copied between
installs.

**No fleet updater engine, target registry, canary runner, or automated
rollout is built.** At the current scale — a handful of hand-deployed installs
where copy-paste updates are acceptable — that automation is YAGNI and would
reintroduce exactly the coordination weight this architecture exists to avoid.
Returning to a shared multi-tenant Worker is likewise rejected: its per-query
tenant routing, isolation, and blast radius are disproportionate to a
distribution problem. Both are revisited only if the number of installs makes
manual copy genuinely unmanageable.

**Consequences.** Updates stay a manual, per-install operator action, which is
acceptable at this scale and keeps the product free of any coordination runtime
or hosted control plane. A broken install cannot touch another store's runtime
or database. The path-ownership manifest becomes the one thing that must be
correct: overwrite an install-owned path and a store's identity is clobbered;
miss a product-owned path and the update is incomplete — so it is maintained as
a reviewed list and copy-paste follows it exactly.

The security release gate (A-151) is implemented: the raw-text JSON script
breakout is closed in both storefront form config scripts with a shared
`jsonForScript` helper (`src/lib/json-script.ts`) and a `</script>`-payload
regression test. The fleet-automation tasks (A-152, A-154 through A-158) are
withdrawn under this decision; A-153 is reduced to producing and maintaining
the path-ownership manifest, and A-159 (local worktree hygiene) remains an
optional cleanup. Open work is owned only by `TASKS.md`.

## ADR-021 — KV is a cache; sessions and rate-limit counters live in D1

**Date:** 2026-08-27 · **Status:** Accepted. Migration `0049`; A-71 closed.

**Context.** On 2026-08-27 every live install answered `500` to every
kecamatan search and every admin login at once. Workers Logs on each of them
carried one line: `Error: KV put() limit exceeded for the day.` Workers KV on
the Free plan allows 1,000 writes per day **for the whole Cloudflare account**,
and the account hosts twenty-one KV namespaces across every product this
operator runs. The store of record for two things that must work — the admin
session created at login, and the rate-limit window spent on each public
request — was a write to that shared pool. The checkout form debounces the
kecamatan search at 100 ms and each keystroke spent one write on a counter
guarding a pure in-memory catalogue scan, so a single shopper typing an address
could burn a meaningful fraction of the fleet's daily allowance.

The KV counter also had a known ceiling of its own (A-71): `get` then `put` is
not atomic, so a parallel credential-stuffing run spent one slot for N guesses.

**Decision.**

1. **D1 is the store of record for admin sessions and rate-limit windows.**
   Migration `0049` adds `admin_sessions` and `rate_limits`. A login inserts a
   session row; middleware validates a request with one D1 round trip that
   joins the row to its `admin_credentials` revision (`src/lib/admin-session.ts`).
   A rate-limit spend is one statement — `INSERT … ON CONFLICT DO UPDATE …
   RETURNING count` — which is exact under concurrency and closes A-71
   (`src/lib/rate-limit.ts`). D1's Free-plan allowance is 100,000 row writes
   per day, a hundred times KV's, and the scheduled maintenance purges expired
   windows hourly.
2. **KV holds only caches and alert transition state**, and every KV write is
   best-effort: a failure is logged under a stable label and never fails the
   request. What remains in KV: the Mengantar location lookup cache, the
   COD-province policy cache behind `/api/form-config`, and the operational
   alert dedup state.
3. **No counter on a request that costs nothing.** The local district search
   (`/api/locations?level=district`) is not rate-limited at all; the provider
   paths still are.

**Consequences.** Every install picks the schema up on its first request after
deploy. Sessions that lived in KV are not migrated, so every operator logs in
once more after the upgrade. The `SESSION` binding stays required and keeps
its name (INSTALLATION.md); the Free-plan write ceiling still applies to the
caches it holds, but running out of it now degrades to a cache miss instead of
an outage. Whether the account moves to Workers Paid is an operational decision
outside this repository; the code no longer depends on the answer.

**Rejected.** *Cloudflare's rate-limiting binding* — no KV cost, but one
binding per distinct limit, a 10 s or 60 s window only (the login brake is
15 minutes), and a `wrangler.jsonc` change on every install. *A Durable
Object* for exact counting — a new resource class per install for something a
single D1 upsert does. *Keeping sessions in KV with a fallback* — a store of
record with a fallback is two stores of record.

## ADR-022 — Provider callbacks are evidence, never transitions

**Date:** 2026-08-27 · **Status:** Accepted. Migration `0050`; A-164.

**Context.** AutoLaris requires a non-empty `callback_url` on every
`create_payment`, and this product handed it a URL that answered `410` — a
tombstone left when the earlier webhook was retired because the provider has no
accepted callback contract and its settled/expired/failed shapes have never been
observed (UNIMPLEMENTED_SPECS §AutoLaris). Observing one by paying a real VA
was ruled out. Meanwhile every callback the provider did send was dropped, so
the evidence that would settle the question was being thrown away on arrival.

**Decision.** `/api/webhooks/autolaris` records every delivery verbatim in
`autolaris_callbacks` (received time, address, content type, body, and the
`reff_id`/`trx_id` it can lift for indexing) and answers `200`. It is
rate-limited per address and never reads or writes `orders` or
`payment_transactions`. Manual owner/admin reconciliation remains the only path
to `paid`. When a settled callback is on file, classifying its shape and wiring
it into `inquirePayment` is a separate, evidence-backed decision.

**Consequences.** A forged callback can fill a table, not mark an order paid.
Operators read the table with `wrangler d1 execute` for now; an admin view is
not built until there is something to show. Astro's default `checkOrigin` CSRF
guard is kept: a `application/json` callback is accepted (measured 200), while a
form-encoded or `text/plain` POST from another origin is refused with 403
before route code runs (measured). AutoLaris speaks JSON on every documented
endpoint; if the table stays empty after real payments, the provider posting
forms is the first thing to rule out, and the fix is a deliberate
`security.checkOrigin` decision, not a silent one.

## ADR-023 — Stock is bookkeeping, not a gate

**Date:** 2026-08-27 · **Status:** Accepted. No migration; the column is retained and inert.

**Context.** This product is a direct-response storefront: one merchant, a
handful of SKUs, goods ordered or produced against demand rather than picked
from a counted shelf. The schema nevertheless carried a full reservation
system — `product_variants.stock` was checked before an order was accepted,
decremented inside the checkout batch, restored on cancellation, guarded by a
`stock_restored_at` exactly-once marker and by a `RAISE(ABORT,
'INSUFFICIENT_STOCK')` trigger.

Every part of that machinery could refuse a sale, and one part refused it
silently: `mergeStorefrontCatalog` required `stock > 0` for a variant to be
**published at all**, so a variant whose counter reached zero — or was never
set, since `NULL` failed the same predicate — disappeared from the storefront
entirely. A live product stopped being buyable with nobody having changed it,
and no error anywhere said so. The counter was never maintained against real
warehouse movement, so what it enforced was not availability; it was the
residue of past orders.

**Decision.** Stock stops being a constraint anywhere in the product.

- Checkout (`persistOrder`) and CS lead conversion (`convertAbandonedLead`) no
  longer read it, no longer guard on it, and no longer decrement it.
- Releasing an order (cancel, return, delete) no longer adds anything back.
  `stock_restored_at` keeps its name and its **other** meaning — this order is
  void, may not be released twice, and manual payment reconciliation must
  refuse it — which is the part that was actually load-bearing.
- The storefront and the admin publish a variant on title and price alone.
- Saving a product accepts any figure, negative or absent, and stores zero.

The column stays. It is a number an operator may keep for their own reference,
and removing it would mean a migration, a rewrite of six admin readers, and the
loss of the data — for nothing. `product_variants_stock_nonnegative`
(migration 0003) also stays: it guards a value nothing writes any more, which
costs nothing.

**Consequences.** A variant is buyable whenever it is active and priced.
Overselling is possible by construction — that is the merchant's stated model,
not an oversight: fulfilment capacity lives outside this system. The three
tests that asserted the old contract now assert its inverse, so a future change
that reintroduces a stock gate fails the suite rather than silently removing a
product from sale. Should a store ever need real stock control, this ADR is the
thing to revisit, and the counter it needs is still there.

**Rejected.** *Keeping the decrement as bookkeeping* — a figure that drifts
negative through sales while the admin form validates it as non-negative is two
rules disagreeing about one column. *Setting every counter to `NULL` to mean
"unlimited"* — the codebase already read `NULL` as unlimited in the write paths
but as **unpublished** in the read path, which is the bug in the first place;
making the representation carry the meaning would have left that trap in place
for whoever typed a number next.

---

## ADR-024 — The product owns migration numbers; an install that authors one renumbers around it

**Status.** Accepted, 2026-09-05.

**Context.** `zvarashop` and `permatamall` each authored migrations against
their own live databases while the product moved on. Three different `0051`
files now exist, and two of them are already applied in production D1:

| | 0051 | 0052 | 0053 | 0054 |
| --- | --- | --- | --- | --- |
| product | `typed_landing_sections` | — | — | — |
| zvarashop | `product_catalog_fields` | `meta_order_context` | `checkout_order_deduplication` | `notification_floor` |
| permatamall | `product_brand` | `product_description` | `checkout_order_deduplication` | `meta_order_context` |

`assertKnownHistory` compares the applied ledger to the bundled chain **by
index and name** (`src/lib/schema-version.ts`). So the next `git merge
product/main` in either store ships a bundle whose slot 51 disagrees with the
row already claimed there, and the store answers `SCHEMA_UPGRADE_HISTORY_UNKNOWN`
— a fail-closed 503 on every database-backed request. Not a degraded store: a
dark one.

The schemas themselves had already converged. Verified against live D1 rather
than assumed: `products` and `orders` are column-for-column identical in both
stores (`brand`, `description`, `meta_request_context`, `checkout_fingerprint`,
`checkout_dedupe_expires_at`), and only `zvarashop` carries
`admin_credentials.notification_floor_id`. Two stores solved the same problems
and wrote the same DDL under different file names. Nothing needs to be
reconciled but the ledger.

**Decision.** Migration numbers belong to the product. The canonical chain
adopts the four install-authored migrations at the numbers `zvarashop` already
holds, and moves the product's own `0051_typed_landing_sections.sql` to `0055`:

```
0051_product_catalog_fields.sql
0052_meta_order_context.sql
0053_checkout_order_deduplication.sql
0054_notification_floor.sql
0055_typed_landing_sections.sql
```

This renames an applied migration, which RELEASE.md §3 otherwise forbids. The
prohibition exists to stop a schema change being edited under a database that
already ran it; here the SQL is untouched and only its position moves, and the
alternative — leaving three chains to collide — is the outcome the rule is
meant to prevent.

The numbering was chosen by counting who has to be repaired, not by seniority:

| Store | Ledger before | Repair needed |
| --- | --- | --- |
| zvarashop | 55 rows, `0000`–`0054` | **none** — already an exact prefix |
| carukesi, skincarebpom, taniniaga | 51 rows, `0000`–`0050` | **none** — prefix; applies `0051`–`0055` |
| permatamall | 55 rows, order differs | ledger rewrite |
| beranda-tani | 52 rows, holds `0051_typed_landing_sections` | ledger rewrite (no orders yet) |

Adopting `permatamall`'s ordering instead would have moved the repair onto
`zvarashop`; keeping the product's `0051` in place would have required
repairing both live stores. This ordering leaves exactly one store with orders
needing surgery.

**Consequences.** `schemaVersion` becomes 56. Two ledgers must be rewritten
before their next merge, each against a backup, in one batch, and never by
blanking `d1_migrations` — a half-applied repair would leave the gate seeing an
empty history and attempting the whole chain against a populated database.
`permatamall`'s two rows for `brand` and `description` collapse into the single
`product_catalog_fields` row that produced the same two columns.

**Rehearsed, not theorised.** `beranda-tani` went first, chosen because it had
no orders and no products. Deploying the merged bundle against its old ledger
returned **503 on `/`** — the gate refusing an indeterminate schema, which is
precisely the failure the two live stores were headed for. Deleting the single
stale row let the chain re-derive itself: 56 rows, `0051`–`0055` applied in
canonical order, `200` on the request after.

The store was unavailable for **under 40 seconds**, deploy to recovery, and
almost all of it was the human between the two steps — the `DELETE` changed one
row and the site answered on the next request. So `permatamall`'s window is a
scheduling problem, not a technical one: stage the repair SQL, deploy, run it.

**Rejected.** *Comparing the ledger by content hash instead of name* — it would
have made all three chains valid without touching a live database, and it is
the more permissive rule this gate exists to refuse: a forked schema is exactly
what index-and-name equality is there to catch. *Leaving each install its own
numbering* — the collision is then permanent, and every future merge is a
manual reconciliation. *Squashing the install migrations into one* — the four
land in different releases and one of them (`notification_floor`) exists in
only one store.

## ADR-025 — Two amendments recorded after the 2026-09-25 audit

**Date:** 2026-09-25 · **Status:** Accepted. Records decisions the code already
carries; nothing here changes behaviour.

**ADR-007, amended by `7d2462d` (2026-08-21).** A fresh install no longer shows
a setup card. `getTenantHomeContent` composes a default home from the store's
**own** identity, catalogue and public landing pages when nothing is published.
What ADR-007 protects still holds: no *compiled* or *other-merchant* copy ever
renders. The default copy names only this store and makes no product-specific
claim; it is composed at request time from `stores` and the catalogue.

**ADR-022, amended by `c7faf38`.** Callbacks remain evidence only. But manual
reconciliation is no longer the *only* path to `paid`: the hourly job asks
AutoLaris' Advice endpoint (`reconcileAutoLarisPaymentStatuses`) and marks a
transaction paid only when the response carries `rc:"00"` **and** a settlement
word on the allowlist in `autolaris-client.ts`. That is a pull the product
initiates against the provider's own answer, not a pushed callback, so ADR-022's
threat model (a forged callback marking an order paid) is unchanged.

## ADR-026 — One-click install: the Deploy button, one required secret, a self-generated session key

**Date:** 2026-09-25 · **Status:** Accepted, not yet observed against a real
account. Migration `0058`.

**Context.** The owner asked for an install that stands on its own like
WordPress's: upload, open the address, answer a few questions, done. Everything
after the Cloudflare resources existed was already there — runtime migrations,
the `/install` wizard, identity in D1, provider keys from `/admin`
(INSTALLATION §11). What remained was a terminal: create D1, KV and R2, paste
their ids, set six required secrets (two of them a random string the operator
had to invent), attach a domain before the first deploy would succeed.

**Decision.**

1. The README carries a **Deploy to Cloudflare** button. Cloudflare copies the
   public repository into the operator's own GitHub account, provisions the
   bindings `wrangler.jsonc` declares, writes their ids into that copy, and
   builds and deploys it with Workers Builds (Cloudflare's documented flow).
   The product repository still holds no credentials and runs no deploy: the
   button deploys the operator's copy into the operator's account (ADR-012
   stands).
2. `wrangler.jsonc` becomes a **deployable template**: real default names
   (`adsbookcms`, `adsbookcms-d1`, `adsbookcms-assets`), all-zero ids for the
   button to replace, no `routes` (a domain is attached in the dashboard, which
   Wrangler then leaves alone), and `workers_dev: true` so a new store has an
   address to open `/install` at. That address answers `X-Robots-Tag: noindex`.
3. **One required secret, `INSTALL_TOKEN`** — the guard on a public, unclaimed
   `/install`. It is the only prompt (`.dev.vars.example`, deliberately empty
   so no published value can become a shared key).
4. **`AUTH_SECRET` becomes optional.** Without it the Worker generates 256
   random bits once into `install_secrets` (`resolveAuthSecret`), the way
   WordPress writes its own salts. An env secret of 32+ characters still wins,
   so every existing install keeps its sessions.
5. The deploy preflight refuses **ids**, not names: an all-zero or missing D1/KV
   id is what a merge from the product looks like inside an install, and a
   missing id would make Wrangler provision a fresh, empty database. Under
   Workers Builds (`WORKERS_CI=1`) the stale-clone git checks stand down — the
   build is the pushed commit by construction.
6. After `/install`, the dashboard shows **Siapkan toko**: first product,
   warehouse, Mengantar key (required), non-COD payment and own domain
   (optional), each derived live from D1.

**Consequences.** A key in D1 is readable by anything that can read D1; so is
every order and credential it protects, so this widens nothing. Rotating it is
setting `AUTH_SECRET` (every operator signs in once more). Installs created the
old way are unaffected: their own `wrangler.jsonc` is theirs
(`.gitattributes`), and they already set `AUTH_SECRET`.

**Unverified.** Whether the button writes the provisioned ids into the copy
before running the deploy command, and whether its setup page honours
`.dev.vars.example` over the tracked `.env.example`, are Cloudflare behaviour
not yet observed from this repository. Both failure modes are loud (a refused
or failed first deploy), not silent.

**Rejected.** *Omitting the ids and relying on Wrangler's automatic
provisioning* — the button documentation asks for default ids, and in an
install the same omission would silently point a live store at a new empty
database. *Generating `INSTALL_TOKEN` too* — nothing but the operator can hold
a secret that exists before the operator does.

## ADR-027 — Optional integrations ship dormant; enabling one is install data, never install code

**Date:** 2026-10-20 · **Status:** Amended by ADR-028 the same day. Points 1, 2,
4, 5 and 6 stand. Point 3 is replaced: a plugin's schema is no longer part of
the core chain. First instance: Kelola CRM push (1.5.12, migrations
`0062`–`0065`).

**Context.** The owner wants Kelola to stay optional. Most installs will never
pair it, and a product update must not change how those stores behave. Removing
the module from the installs that do not use it would make those installs differ
from the product in code, and every later `git merge product/main` would then
conflict on those files (ADR-012, ADR-020).

**Decision.** An optional integration (Kelola, and any later one of the same
kind) is part of the product, and every install carries it. It stays inert
until the install configures it:

1. **Off until paired.** The integration acts only when its configuration
   exists. For Kelola that is the `stores.kelola_webhook_*` pair saved at
   `/admin/profile`, or the `KELOLA_ORDER_WEBHOOK_URL` / `_SECRET` env pair. No
   release ships a default value, and no migration ships one, that turns it on.
2. **Dormant means zero effect.** With no configuration, the integration
   sends no outbound request, writes no rows, changes no buyer-facing page, and
   adds no checkout step. The only cost allowed is one configuration read inside
   the existing cron or post-order hook (`getKelolaConfig` returns `null`).
3. **Schema is additive and nullable.** The migrations land on every install,
   because the chain is one chain (ADR-024). They add only nullable columns, or
   columns with a default, so an install that does not use the integration
   holds unused columns and nothing else.
4. **Configuration is install data.** The URL and secret live in that install's
   D1 or Worker secrets, not in product-owned files. An update never copies one
   store's configuration into another.
5. **Turning it off is configuration, too.** To turn the integration off, an
   operator uses the dashboard's disconnect control, not a code deletion. An
   install must not delete or edit the module's files to "uninstall" it; that is
   the divergence this ADR exists to prevent.
6. **Checks.** `kelola-order-sync.test.ts` covers the dormant path ("config
   needs both URL and secret"; dashboard pair over env). A new optional
   integration lands with the same kind of test before release.

**Consequences.** Rolling a release out to the fleet never requires a decision
about the optional integration on each store. A store that wants Kelola pairs it
in the admin, with no deploy. The cost is unused columns and a few kilobytes of
dormant code on stores that never pair it. That cost is accepted, because
avoiding it would bring back per-install code forks.

## ADR-028 — First-party plugins: in the product, installed per store on activation

**Date:** 2026-10-20 · **Status:** Accepted. 1.6.0, migration `0066`. Amends
ADR-027.

**Context.** The owner put it this way: Kelola CRM is a plugin. It should not
be installed on every store, only on a store that adopts it, and it still
follows the AdsBookCMS standard. ADR-027 kept the code out of the way, but its
columns were still created on every store's `orders` and `stores`.
`PRD.md` lists "customer-authored code or a plugin runtime" as a non-goal,
and that stays true. What this ADR describes is first-party plugins, compiled
in, and not uploaded by anyone.

**Decision.**

1. **Location.** A plugin lives in `src/plugins/<id>/`, with `index.ts` as its
   manifest and its own tests beside it. The manifest gives the id, name,
   description, settings page, ordered schema steps, uninstall statements and
   hooks. `src/plugins/registry.ts` lists the plugins compiled into the
   product. The folder is product-owned (UPDATE-PATH-OWNERSHIP), so every
   install carries it and an update never conflicts on it.
2. **Installed means activated.** A store "installs" a plugin by activating it
   at **Pengaturan → Plugin** (`/admin/settings/plugins`, owner only).
   Activation writes its `plugins` row and runs the plugin's own schema steps.
   The steps are idempotent `CREATE … IF NOT EXISTS`, and their tables are
   prefixed `plugin_<id>_`. A store that never activates a plugin has no row,
   no table, no menu entry and no hook calls for it.
3. **The core calls plugins through two hooks only.** `scheduleOrderCreated`
   runs after checkout, in `waitUntil`, and never delays the buyer.
   `runPluginCron` runs in the hourly cron. Each plugin's failure is isolated
   and logged; it never fails the order or the cron. With no active plugin, the
   cost is one `SELECT` on `plugins`.
4. **Schema.** The core chain (ADR-024) carries only the `plugins` table. A
   plugin's own schema version lives in `plugins.schema_version`, and an
   update that adds a step is applied the next time the plugin runs.
   Deactivating keeps its tables and settings. **Hapus data** (uninstall) drops
   them and deletes the row, after a `useConfirm` dialog.
5. **Settings** live in `plugins.settings` (JSON, this store's D1). Secrets in
   there are never returned to the browser, the same as provider keys.
6. **Admin surfaces** appear only while the plugin is active: its settings
   page redirects to the list otherwise, and its order-detail panel and
   actions answer as absent or 409.

**Migration `0066`.** It creates `plugins`. It turns a Kelola pair already
saved on `stores` into an active `kelola` plugin row, so no store loses a
connection. It then drops the six `kelola_*` columns that `0063`–`0065` added
to `orders` and `stores`. On 2026-10-20 no store had paired Kelola, so the
dropped columns held no data. Push history, had there been any, would not
carry over; that is accepted.

**Consequences.** Kelola is the first plugin and the template for the next
one. A new optional integration is built as a plugin by default, not as core
columns behind a flag. The cost is a small registry, and a plugin cannot add
storefront routes without a core change. That is deliberate: the storefront
stays one product.

## ADR-029 — A two-minute edge cache for anonymous storefront HTML

**Date:** 2026-10-20 · **Status:** Accepted. 1.7.0, `src/lib/edge-cache.ts`.

**Context.** Every public page is server-rendered. Each request paid the store
lookup, the page's D1 reads and the render, 0.5 to 2 seconds before the first
byte on a mobile network. On beranda-tani that was the largest term in Lighthouse's
LCP (TTFB 1.2 s of a 4.6 s home page) and it varied by a factor of four between
identical requests. The HTML of the home page, the product list and a landing
page is the same for every visitor.

**Decision.**

1. The middleware keeps a copy of a rendered page in the Workers Cache API for
   120 seconds (`EDGE_CACHE_SECONDS`) and serves it to the next anonymous
   visitor, before the store lookup.
2. **Eligible:** `GET` of `/`, `/produk`, and single-segment slugs (landing and
   legal pages). **Not eligible:** product pages (the server picks the checkout
   form from the visitor's geo-IP), the geo and test form pages, `/thanks`,
   `/payment`, `/hello`, `/install`, `/api`, `/admin`, `/embed`, uploads, and any
   request with an admin session cookie, an `Authorization` header or
   `?preview=1`.
3. **Stored only** a 200 `text/html` answer with no `Set-Cookie` and no
   `no-store` or `private`.
4. **The key** drops ad parameters (`CLICK_ID_KEYS`, `ttclid`, `msclkid`,
   `gad_*`, `utm_id`), so ad traffic shares one entry. Every other parameter
   stays in the key.
5. **What a hit still does:** security headers and the ad click id cookie, both
   computed from the request, never from the cached HTML. Nothing visitor
   specific may be written into HTML that this cache can store; the Pixel
   `event_id` is made in the browser for that reason.
6. **Freshness.** An admin edit shows within two minutes. Prices are not read
   from the cache for money: checkout validates them again.
7. **Observable:** `X-Edge-Cache: HIT` or `MISS`; absent where the cache is
   not consulted.

**Consequences.** A page that must differ per visitor and is rendered from a
single-segment path must set `Cache-Control: no-store` or `private`, or set a
cookie: the way `/[slug]` already does for a preview. Adding a page to the
denylist in `edge-cache.ts` is the other option. Misses cost what they did
before, and a store with very little traffic sees fewer hits.

**Amendment, 2026-10-21 (1.7.3): uploads get their own, longer entry.** Uploaded
images (`/assets/uploads/…`) are served from R2 by the Worker, which the CDN
does not cache, so each one paid the middleware and an R2 read: 1.1-1.2 s to the
first byte for zvara.shop's home hero on every request, the largest part of
that page's 4.7 s LCP. They stay out of the HTML cache above, and get a
separate one in the same file: the key is the path alone (the route ignores the
query), only a `200` is stored, the edge copy lives `UPLOAD_EDGE_CACHE_SECONDS`
(a day), and a hit is answered at the top of the middleware, before the schema
check, the store lookup and R2. A day rather than the browser's year bounds how
long a deleted image is still served from the edge. Upload keys are random and
never rewritten, so a URL never needs fresher bytes than the ones stored.

**Amendment, 2026-10-21 (1.7.4): product and landing pages are cached per
province, and a hit skips the schema check.** The only visitor-dependent value in
the SSR HTML of `/produk/<slug>` and single-segment landing pages (`/<slug>`) is
 the two-letter Indonesian province code (`resolveProvinceCode(request)`), which
picks the `middle` or `full` checkout form and prefills the province name in
`GeoIpResolvedForm`. `edgeCachePath` now admits `/produk/<slug>`, and
`edgeCacheRequest` appends `__prov=<CODE>` (resolved from `request.cf` or its
fallback headers, never from the URL query string) for every path other than `/`
and `/produk`. When `/produk/<slug>` rewrites to a claimed native landing page,
the inner rewrite still carries `x-adsbook-product-page` and skips the cache,
while the outer `/produk/<slug>` request caches the final 200 HTML under the
product's province key. In `src/middleware.ts`, canonical host redirects and
`readEdgeCache` now run above `ensureSchemaReady(identityDb)`, so an edge cache
hit never pays a D1 `d1_migrations` read on a cold isolate.

## ADR-030 — Run beside D1, and budget the D1 round trips a page makes

**Date:** 2026-10-23 · **Status:** Accepted. 1.7.11, `wrangler.jsonc`
`placement`, `src/lib/catalog.ts`.

**Context.** A PageSpeed pass over page.revenleather.com found product pages at
3.7-6 s to the first byte while the rest of the store sat near 0.5 s. CPU was
80-220 ms per request (`wrangler tail`); the rest was waiting. The `cf-ray`
suffix showed why: Cloudflare served part of the Indonesian traffic from SEA
and SJC, and PageSpeed Insights always runs from the US. From there every
sequential D1 read crosses the Pacific to the APAC primary, and the
per-colo edge cache (ADR-029) is cold. The same uncached page from SIN took
0.4-0.7 s. A product page made nine sequential D1 reads, two of them the whole
catalogue twice (once for the page, once for its order form).

**Decision.**

1. The template turns on Smart Placement (`"placement": { "mode": "smart" }`),
   so Cloudflare runs the fetch handler beside D1 when that is faster. Static
   assets still serve from the nearest colo. It is install-owned config, so
   each install opts in in its own `wrangler.jsonc`.
2. The catalogue is read once per request (`getStorefrontProducts` memoised on
   `locals`), and its two queries run in parallel. A product page went from
   nine sequential round trips to six.
3. **Budget for a storefront page:** independent D1 reads run in
   `Promise.all` or one `batch`; nothing loads the same data twice in one
   request; a new sequential read on a public page needs a reason in its
   comment.

**How to check a page (the procedure behind these numbers).**

- `curl -sD - -o /dev/null <url>`: read `X-Edge-Cache` and the `cf-ray` colo.
  A slow `MISS` from a US colo is distance, not code.
- `npx wrangler tail --format json`: `wallTime` far above `cpuTime` means the
  request waited on I/O.
- Count D1 statements locally with `npm run dev:local` and a temporary
  counting proxy on `OMS_DB`; never commit it.
- Lighthouse mobile (`npx lighthouse <url> --form-factor=mobile`) for every
  template: home, `/produk`, one legal page, product pages with and without a
  landing claim, a landing page. Test a product page with a fresh URL, since a
  repeat run reads the edge cache.

**Not changed.** Google and Meta tags account for most of the 450-860 ms
Total Blocking Time on every page. That is the cost of the ad signal this
product exists for. They are not delayed past first interaction, because a
PageView lost to a fast bounce is worth more than the score.

**Consequences.** Smart Placement needs up to 15 minutes of traffic from
several locations before it decides, and it can decline (`cf-placement`
response header). A store whose traffic all comes from one colo gains nothing
and loses nothing.

---

## ADR-031 — The fleet's account runs on Workers Paid; Workers Cache stays off

**Date:** 2026-10-29 · **Status:** Accepted by Paduka 2026-10-29. The plan change
itself is a dashboard action outside this repository; confirm it there.

**Context.** Since 2026-09-01 D1 fails every query on a Workers Free account once
the account passes 5M rows read or 100k rows written in a day, until 00:00 UTC
([D1 changelog](https://developers.cloudflare.com/changelog/product/d1/)). The
allowance is per account, and every install in the fleet shares one account. A
30-day read of all 14 databases (`STATUS.md`, 2026-10-29) averaged 13.5M rows
read and 83k rows written a day: 2.7× and 0.83× the Free allowance. Free also
caps CPU at 10 ms per request and per cron run
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/));
ADR-030 measured 80–220 ms. The same research found that a Workers Cache hit
does not run the Worker ([Workers Cache](https://developers.cloudflare.com/workers/cache/)),
while ADR-029 relies on the middleware running on every cached page view to
write the click-id cookie.

**Decision.**

1. The account that hosts the fleet runs on **Workers Paid**. No install's
   checkout may depend on staying under a Free allowance that the fleet already
   exceeds on reads.
2. Reads are still reduced at their source (TASKS A40, A-381 to A-387), because
   on Paid they are billed past 25B a month, and because a scan that grows with
   `orders` grows with every store's success.
3. **Workers Cache is not adopted.** ADR-029's `caches.default` stays until a
   later ADR first moves click-id capture out of the middleware under the
   tracking contract.

**Consequences.** A $5-a-month minimum for the account. The five-cron cap that
left zanobyshop without a schedule (`STATUS.md`) lifts to 250, so it can be
given its hourly cron again. A40's write discipline still applies: Paid removes
the cliff, not the cost.

**Rejected alternative.** Staying on Free and cutting reads under 5M a day. The
largest single store already reads 6.5M a day, so no amount of query work in
one install fixes an account-wide allowance.

---

## ADR-032 — A quote ships from the warehouse that covers the buyer's province

**Date:** 2026-10-29 · **Status:** Proposed (PRD A42, A-411). Not deployed to any
install; the Exception tasks A-407/A-408 that touch the quote path have no
recorded approval in `TASKS.md` yet.

**Context.** A store may keep up to ten warehouses (REQ-237), each registered at
Mengantar with an origin area and a pickup address. Until A42 every quote,
order and dispatch used the lowest-id `warehouses` row. The rate route and every
submit route receive the buyer's destination area id and city, not coordinates;
the bundled district index (`src/data/indonesia-districts.ts`) maps a city to
its province, and only one city name (`banjar`: Kota Banjar, Jawa Barat, and
Kabupaten Banjar, Kalimantan Selatan) maps to two.

**Decision.**

1. `chooseWarehouse` (`src/lib/warehouse-choice.ts`) picks, among **active and
   ready** warehouses (origin and pickup address both set): (1) one whose served
   provinces include the buyer's province — the list defaults to the
   warehouse's own province and the operator can add more; (2) else one in the
   buyer's island group (a static map of the 38 province codes); (3) else the
   primary. Ties go to the primary, then the lowest id. Exactly one warehouse is
   primary (a partial unique index), and it cannot be made inactive.
2. The buyer's province is derived on the server from the city
   (`provinceCodeForCity`). An unknown or ambiguous city quotes from the
   primary, identically on the rate call and on submit, so no form change is
   needed.
3. The quote makes exactly one Mengantar rate call, from the chosen warehouse's
   origin. The order stores that warehouse's id; dispatch and the pickup
   schedule read `orders.warehouse_id`.
4. An explicit warehouse (`warehouseId`: the admin re-quote of an existing
   order, `/api/shipping-rates?warehouse_id=`, the headless checkout's echoed
   `warehouse_id`) is honoured only while it is active and ready, or the
   primary. Otherwise the warehouse is chosen as if none had been given.
5. Headless: `/api/v1/geo/shipping-rates` chooses by its optional `city` and
   returns `warehouse_id`; `/api/v1/checkout` re-quotes from the `warehouse_id`
   the client echoes, or from the primary when it sends none, and answers 409
   `SHIPPING_QUOTE_CHANGED` when that warehouse is no longer quotable. The
   checkout's `city` does not choose a warehouse: a client that quoted without
   one was shown the primary's price.

**Consequences.** A store with one warehouse quotes, orders and dispatches
byte-identically (REQ-242, `warehouse-quote.test.ts`). An install that already
holds **more than one** `warehouses` row changes behaviour on the deploy that
carries the migration: rows other than the lowest id start receiving buyers in
their own province (RELEASE.md §3). An order whose warehouse is later made
inactive still dispatches from it, but an admin courier change re-chooses by
the order's province.

**Rejected alternatives.**

- *GPS distance.* No coordinates exist in the data, and IP geolocation is too
  coarse; the form already carries the buyer's real district.
- *Cheapest of all warehouses.* Most accurate to "ongkir from the nearest", but
  N Mengantar calls per quote, slower forms and N times the rate limit.
  Revisit as a per-store mode once A-330/A43 measure the rate call.

**Amendment 2026-10-30 (REQ-270, A-444).** Point 3 gains a fallback: when the
chosen warehouse is not the primary and its rate call fails or returns no
usable rate, the quote is re-made once from the primary, and that is the
warehouse the order stores. *Why:* Paduka wants the main warehouse to be the
default a failing branch rotates to, rather than a buyer being refused while
the primary could ship. *Consequence:* at most two Mengantar rate calls on that
path, one on every other; a rate call and a submit on different sides of an
outage price differently and submit answers `SHIPPING_QUOTE_CHANGED`, as it
already did for any price change. Point 4 is unchanged: a named warehouse
(the admin re-quote and its preview) is never swapped, since the admin save
compares no price with its preview. Point 5 is unchanged: headless checkout
opts out (`noPrimaryFallback`) because it compares no submitted price.
