# Building a landing page

> Verified against disk: 2026-10-30 @ `5ef5f76` + docs/a45-ops-api working tree

There are two kinds of landing page in this CMS and they are not
interchangeable. Pick the right one before writing anything.

| | CMS landing page | Native Astro landing page |
| --- | --- | --- |
| Author | an operator, in `/admin/landing-pages` | a developer or an AI terminal, in the repo |
| Lives in | D1, table `landing_pages` | `src/pages/<slug>.astro`, registered in `src/data/native-landing-pages.ts` |
| Served by | the `[slug].astro` catch-all | its own route |
| Changes need | nothing — saved and live | a build and a deploy |
| In the CMS | fully editable | listed, linkable, claimable — never editable |
| Use it when | the operator owns the copy and wants to iterate | the page needs layout or logic the builder cannot express |

## The URL contract

**Every landing page answers at `domain.com/<slug>`. There is no prefix** — no
`/landing`, no `/pages`, no `/lp`. That is the address an ad points at and the
address that gets shared.

Astro resolves a static route before a dynamic one, so a native page at
`src/pages/promo-lebaran.astro` answers `/promo-lebaran` and the
`[slug].astro` catch-all never sees it. The catch-all then owns every remaining
single-segment path: it resolves a CMS landing page, then a product redirect,
then falls through to 404.

**The collision this creates is real, and now refused rather than silent.**
If a static route and a CMS landing page claim the same slug, the static file
wins and the CMS page becomes unreachable. So the CMS refuses every slug
`isReservedLandingSlug` (`src/lib/landing-pages.ts`) names: the product's own
top-level routes (`RESERVED_LANDING_SLUGS`), every entry in the native register,
and `installRouteSlugs` — an install's other route files, such as a legacy slug
that 301s to a renamed page. All three live where their owner edits:
the product list in the product, the other two in
`src/data/native-landing-pages.ts`, which an install already owns.
`landing-pages.test.ts` fails when a top-level page is covered by none of them.
Registering a native page reserves its slug with no second edit; before adding
one, check `/admin/landing-pages` for an existing CMS page with that slug,
which the new file would shadow.

### The one exception: a landing page that *is* the product page

A landing page can take over its product's page (A21). When it does:

- `/produk/<product-slug>` renders the landing page, and that is its canonical
  address;
- its own `/<landing-slug>` answers `301` to the product URL (cached five minutes, so releasing
  the claim takes effect) — query string
  kept, so an ad's `fbclid`/`gclid` and UTM tags survive — so exactly one
  URL is live and the two never compete as duplicate content;
- unpublishing it, or releasing the claim, hands `/produk/<product-slug>` back
  to the normal product template — the product never 404s because a landing
  page went away.

Only one landing page may hold a given product's page; the database enforces it
with a partial unique index rather than trusting the admin to remember. Set it
from the landing page list: **⋯ → Jadikan halaman produk**.

The hand-off is a rewrite carrying an `x-adsbook-product-page` header. Do not
reintroduce a check on `Astro.url` there: a rewrite does not carry the original
path, so the landing route sees its own slug either way, and reading the URL
sent the two routes into an endless redirect loop.

---

## Native Astro landing page — the flow

### 1. Decide the slug and the product

A landing page sells one product. Get its slug from `/admin/products` or from
`/produk`. Everything downstream — the form, the tracking payload, the catalog
identity — keys off that product.

### 2. Create the route

`src/pages/<slug>.astro` — at the root of `pages/`, so it answers
`domain.com/<slug>`. It must:

- render through `BaseLayout` so it inherits the header, footer, the 480 px
  column, tracking and the SEO chrome;
- resolve the product server-side and 404 through the shared page rather than a
  bare response:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import MetaLandingTracker from '../components/storefront/tracking/MetaLandingTracker.astro';
import GeoIpResolvedForm from '../components/storefront/forms/GeoIpResolvedForm.astro';
import { getStorefrontProduct } from '../lib/catalog';
import { defaultCatalogContentId } from '../lib/catalog-feed';
import { nativeLandingCanonicalPath } from '../lib/landing-pages';
import '../styles/landing-pages/landing.css';

export const prerender = false;

const SLUG = 'ganti-slug-halaman';
const product = await getStorefrontProduct(Astro.locals, 'ganti-slug-produk');
if (!product) return Astro.rewrite('/404');
const canonical = `${Astro.locals.tenant.siteUrl}${await nativeLandingCanonicalPath(Astro.locals, SLUG)}`;
---

<BaseLayout
  title={`${product.productName} - ${Astro.locals.tenant.name}`}
  description={product.seoDescription}
  image={product.heroImage}
  canonical={canonical}
  hideHeader={false}
>
  <MetaLandingTracker
    slug={SLUG}
    contentId={defaultCatalogContentId(product)}
    contentName={product.contentName}
    price={product.price}
  />

  <!-- sections here -->

  <GeoIpResolvedForm mode="hybrid" productSlug={product.slug} />
</BaseLayout>
```

`mode="hybrid"` is deliberate: the form decides between the short and the full
variant from the visitor's province, and an excluded province is forced to the
full form with COD disabled. Do not hard-code `middle` or `full` on a landing
page unless the offer genuinely requires it.

### 3. Put sections in components, not in the route

Static sections go in `src/components/storefront/landing-pages/` as `.astro`
files. Add a hydrated island only for real interaction — **there is no React on
the public surface** and a landing page is not the place to reintroduce it. A
gallery is `scroll-snap`; a countdown is a `<script>` tag.

### 4. Styles

- Reuse what exists first: the tokens in `src/styles/foundation.css`, the
  public rules in `storefront.css`, and the cva variants in `lib/ui-variants.ts`.
- `src/styles/landing-pages/landing.css` is the shared landing surface: the
  `.lp-section` rhythm, the type contract inside the column, and safe defaults
  for whatever an operator pastes (images, tables, blockquotes). Import it and
  build on it.
- Route-specific CSS goes in `src/styles/landing-pages/<slug>.css` and is
  imported **only** by that route. Never add landing rules to `foundation.css`
  (it ships to the admin too) or to `admin.css`.
- The column is 480 px and `BaseLayout` already owns it. Do not set another
  `max-width` on the page; style what goes *inside* the column.
- The type ramp is 10 · 11 · 12 · 13 · 14 · 15 · 16 · 18 · 20 · 24 · 28 px.
  Do not invent an intermediate size; the checkout stylesheet had fifteen and
  they were collapsed to seven for exactly this reason.
- **Weights are 400, 600 and 700 only.** Those are the three Inter faces that
  ship. `font-medium` renders identically to `font-normal`, and
  `font-extrabold` and `font-black` render identically to `font-bold` —
  measured, not assumed. Writing them is a lie in the source.
- One accent: `#C5A880`. One ink: `#111111`. One neutral family, warm
  (`#F8F7F4` surfaces on a `#f8f7f4` canvas, white reading column).

### 5. Evidence, assets, and conversion claims

- Put route-owned imagery under `public/images/landing/<slug>/`. Use only
  merchant-approved product, demonstration, or customer evidence; optimize it
  through the existing `src/lib/client-image.ts` policy. Do not add an image
  package or a one-off conversion script.
- A page may structure a clear progression from product context through benefits,
  use, proof, and checkout, but its section count and visual treatment are not a
  product contract. Reuse the design system rather than importing a rigid
  campaign-specific visual recipe.
- Copy may name a buyer problem and explain a verified product benefit. Do not
  manufacture testimonials, review avatars, before/after evidence, stock
  scarcity, guarantees, certifications, or outcome claims. Absent evidence is
  omitted, not generated.
- The checkout handoff remains canonical:
  `<GeoIpResolvedForm mode="hybrid" productSlug={product.slug} />`. Never pass
  a hard-coded product ID, price, variant, or a made-up form context.
  Never render `FormHybridContent` (the full form) or `FormMiddleContent`
  yourself: only `GeoIpResolvedForm` applies the province rule, and
  `form-mode.test.ts` fails on a page that bypasses it.
  Served as a product page, the landing is reached through a rewrite from
  `/produk/<slug>`; that rebuilt request carries the visitor's Cloudflare
  location as `x-cf-*` headers (`geoHeadersFromCf`), or the rule would see no
  province and show everyone the full form.

### 6. Verify before calling it done

```bash
npm run check     # astro check + tsc
npm test
npm run build
```

Then open it. A green build is not evidence a page renders — an unterminated
frontmatter block once shipped a live 404 while every static check passed.
Check at 390 CSS px:

- no horizontal scroll;
- the form reaches a shipping quote for a real district;
- zero console errors;
- the page is in `sitemap.xml` if it should be indexed, and carries a canonical.

---

## CMS landing page

`/admin/landing-pages` composes ordered `headline`, `paragraph`,
`numbered_list`, `bullet_list`, `image`, legacy `html`, and `form` sections.
The bounded text/list/image section cards preview inside the 480 px mobile
canvas; its numbered section navigator focuses a selected card in long pages,
while up/down buttons retain keyboard and touch-safe ordering. The header's
**Live Preview** opens the authenticated draft preview after a page has a slug.
Images are browser-converted to WebP before the existing authenticated R2 upload
path. Source images and encoded WebP files are each limited to 2 MiB. A browser
that cannot encode WebP from a canvas gets a clear error instead of a 415.

Legacy `html` sections render unescaped on the store's origin, which is also the
admin's. Only `owner` and `admin` may add or change one (`403` otherwise); an
`advertiser` can still edit the typed sections of a page that carries HTML an
owner already wrote (`changesHtmlSections`). Moving a page that has taken over
its product's page to a different product releases the takeover instead of
carrying it to the new product.

An `html` section's images are deferred at render (`deferOffscreenImages`):
every `<img>` gets `loading="lazy" decoding="async"` except the first image of
the page's first section (the likely LCP), a tag that already sets `loading`,
and a tag with `onerror`/`onload` — content runs script through a hidden
`<img onerror>`, which a lazy hidden image would never fire. Give a hero image a
`width` and `height` yourself; nothing infers them.

`?preview=1` renders an inactive page for an authenticated admin and sends
`Cache-Control: no-store`.

Reach for a native route only when the builder genuinely cannot express the
layout. A page an operator can edit without a deploy is worth more than a page
that is slightly prettier.

---

## Registering a native page in the CMS

Add an entry to `src/data/native-landing-pages.ts` and deploy. The CMS records
it on the next landing-page list load, or within the hour from the scheduled
re-sync — no sync step, no admin action. The re-sync writes only a row that
changed, because `updated_at` is the sitemap's `lastmod`.

```ts
export const nativeLandingPages: NativeLandingPage[] = [
  {
    slug: 'promo-lebaran',        // must equal the route filename
    title: 'Promo Lebaran',       // shown in the CMS list
    productSlug: 'pupuk-organik', // the product this page sells
    description: 'Landing khusus kampanye Lebaran.',
    // image: '/images/landing/promo-lebaran/hero.webp', // list thumbnail
    // isActive: false,           // registered, not yet linked
  },
];
```

**List thumbnails.** The admin list and `/landing-page` show each page with
a picture chosen by `landingThumbnail` (`src/lib/landing-pages.ts`): a CMS
page's first `image` section, then the first `<img>` of a legacy HTML
section, then a native page's register `image` (a site path or an https URL,
checked by `validateNativeLandingPages`), and otherwise the photo of the
product the page sells — so no listed page is a blank tile.

**The file owns the page; the database owns only the operational state.** The
manifest decides that the page exists and what it says. `landing_pages` holds
one mirrored row per entry so the CMS can list it, link to it, and let an
operator hand it a product page — nothing more.

What follows from that:

- **The CMS cannot edit or delete a native page.** Both are refused with `409`
  and a message saying to change the file and redeploy. Deleting the row would
  only make it reappear on the next reconcile.
- **Removing the entry removes the row, and any product page it held.** A
  register entry without a file is a listing that 404s, so the reconcile drops
  it — and `/produk/<slug>` returns to the normal product template rather than
  pointing at nothing. Delete the entry and the file together. Because a
  checkout missing entries added elsewhere would do the same thing by
  accident, `npm run deploy` refuses when production lists a native page that
  the register does not. `ALLOW_NATIVE_LANDING_REMOVAL=1` allows the removal
  when it is intended (RELEASE.md, preflight).
- **An entry naming a product this store does not carry is skipped**, not
  inserted against an empty product, which would make the takeover unresolvable
  later.
- **The build refuses a register that misrepresents the site.** A duplicate
  slug, a slug that cannot match a filename, or a missing title, product, or
  description each fail `validateNativeLandingPages`.
- **Registering closes the shadowing hazard.** `landing_pages.slug` is UNIQUE,
  so once a native page is recorded an operator can no longer create a CMS page
  on the same slug and have Astro silently resolve it to the file instead.

### A native page as the product page

Same action as a CMS page — **⋯ → Jadikan halaman produk** — and the same
rules: `/produk/<product-slug>` renders it, its own slug answers `301` there,
and neither sitemap advertises the redirecting address. Only owner and admin
may set it.

The redirect for a native page lives in `src/middleware.ts`, not in the
catch-all: a native route is a real file and never reaches `[slug].astro`. The
middleware rules a request out in memory against the compiled register before
it touches the database, and skips the check when the request carries
`x-adsbook-product-page` — that header is how `/produk/<slug>` hands off, and
redirecting a hand-off is what put the two routes in a loop the first time A21
was built.

**Your canonical must come from `nativeLandingCanonicalPath`**, not from your
slug. A route cannot know on its own whether an operator has handed it a
product page, and declaring its own slug in that state points search engines at
a URL that bounces back to the page they are already on:

```astro
import { nativeLandingCanonicalPath } from '../lib/landing-pages';
const canonical = `${Astro.locals.tenant.siteUrl}${await nativeLandingCanonicalPath(Astro.locals, SLUG)}`;
```

---

## Start from the sample

`src/pages/contoh-landing.astro` is a complete working native landing page, with
its own `src/styles/landing-pages/contoh-landing.css`. It answers at
`/contoh-landing` on any install, because it binds to the store's **first
active product** rather than a hard-coded slug — this repository is cloned into
every store, so a named product would resolve on one and 404 on the rest.

Copy it, then make it yours:

1. `cp src/pages/contoh-landing.astro src/pages/<slug>.astro` and the stylesheet
   beside it.
2. Replace the `getStorefrontProducts` lookup with
   `getStorefrontProduct(Astro.locals, 'your-product-slug')`.
3. Rewrite the sections and the copy.
4. Register it in `src/data/native-landing-pages.ts` so the CMS records it.
5. **Delete `contoh-landing.astro`** before the store goes live, or it stays a
   public URL. It ships `noindex`, so a forgotten copy is at least never
   indexed as a real offer.

It deliberately shows the conditional pattern: benefit, key-point and review
sections render only when the product actually has that content, so a sparse
product produces a shorter page instead of empty headings.

## Writing one with an AI — the short version

Give this file to the assistant. The parts it will get wrong unprompted:

1. **Slug at the root.** `src/pages/<slug>.astro`, no prefix directory. Check
   `/admin/landing-pages` first so it does not shadow an operator's page, then
   add the entry to `src/data/native-landing-pages.ts` — a route without an
   entry answers on its URL but is invisible to the operator.
2. **The form follows the product, not the page.**
   `<GeoIpResolvedForm mode="hybrid" productSlug={product.slug} />` — the
   product is resolved server-side and everything downstream keys off it.
   Never hard-code prices, variants, or a product id in the markup.
3. **480 px, and `BaseLayout` already owns it.** Style inside the column.
4. **No React on the public surface.** A gallery is `scroll-snap`; a countdown
   is a `<script>` tag.
5. **Three weights, one ramp, one accent.** Anything else is invented.
6. **Canonical from `nativeLandingCanonicalPath`**, never from the slug.
7. **Verify by opening it at 390 px**, not by a green build. `npm run check`,
   `npm test`, `npm run build`, then look at the page and the console.
