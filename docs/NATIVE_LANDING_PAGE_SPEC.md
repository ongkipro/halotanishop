# Native Direct-Response Landing Page Standard

> Verified against disk: 2026-11-02 @ `40d80e4` (1.8.8: native landing product JSON-LD section rewritten)

This document is the portable implementation standard for a native Astro
product landing page. `docs/LANDING-PAGES.md` remains the canonical owner of
CMS/native route, registry, product-page takeover, and canonical-URL behavior.
Where the two conflict, `docs/LANDING-PAGES.md` wins.

## 1. Scope and boundary

Use a native page only when the CMS builder cannot express the required layout
or behavior. It sells one active D1 product, answers at `/<slug>`, and must
never become a second commerce system.

- Route: `src/pages/<slug>.astro`.
- Registry: `src/data/native-landing-pages.ts`; the slug, file, title,
  description, and `productSlug` must agree.
- Product facts, price, availability, variants, and catalog identity come from
  D1 through the existing storefront resolver. Do not hard-code them.
- Checkout stays delegated to
  `<GeoIpResolvedForm mode="hybrid" productSlug={product.slug} />`.
- Tracking stays delegated to `BaseLayout`, `MetaLandingTracker`, and the
  existing form/event paths. Never embed a Pixel ID, CAPI token, or provider
  credential in a page.

## 2. Funnel composition

A direct-response page should make one offer legible in this sequence. Sections
may be omitted when their evidence or purpose is absent; there is no mandatory
section count.

1. Product context and the buyer problem.
2. Verified benefit and how the product addresses it.
3. Usage, compatibility, or decision information.
4. Evidence-backed proof, if evidence exists.
5. Product/variant selection and the canonical checkout form.
6. Repeated access to the same checkout intent when the page is long.

Use a single light theme, the installed storefront tokens, and the existing
480px BaseLayout column. DR/COD funnel defaults: low visual variance, minimal
motion, medium information density. CSS and semantic Astro markup come before
any client JavaScript. A sticky CTA may repeat the checkout action but must hide
while the hero or form is visible, use the same wording, and retain keyboard
accessibility.

## 3. Evidence and claims

Every customer-facing claim must have a source in merchant-approved product
facts, demonstration material, policy, or real customer evidence.

Never fabricate or AI-generate:

- testimonials, buyer names, avatars, review counts, ratings, or proof photos;
- stock scarcity, countdown urgency, guarantees, certifications, safety claims,
  before/after results, or quantified outcomes;
- product prices, variants, availability, shipping promises, or provider states.

When proof is absent, omit the proof section. Do not replace it with synthetic
content. Use Indonesian for customer-facing copy; keep the repository document,
code, and comments in English. Avoid Malaysian vocabulary in Indonesian pages.

## 4. Asset contract

- Route-owned assets live in `public/images/landing/<slug>/`.
- Use only merchant-approved assets with meaningful alt text. Decorative images
  use empty alt text.
- Run assets through the existing `src/lib/client-image.ts` policy. Do not add
  Sharp, an image CDN SDK, or a one-off conversion script for a single page.
- Preload only the actual above-the-fold LCP image. Below-the-fold images are
  lazy-loaded and carry explicit dimensions or aspect ratio to prevent CLS.
- Keep overlays readable, CTA contrast at AA, form controls at least 16px on
  mobile, tap targets at least 44px, and every interactive control visibly
  focusable.

## 5. SEO, accessibility, and privacy

Use `BaseLayout` for title, description, canonical, Open Graph metadata,
headers, footer, tracking, and the public layout contract. Derive canonical URL
through `nativeLandingCanonicalPath` when a page may become its product page.
Do not index a campaign or confirmation route that has no standalone search
value. Never put PII, click IDs, order IDs, status tokens, or internal product
state in a canonical URL, asset path, or public copy.

## 6. Implementation checklist

Before release, prove all of the following:

- The native slug does not shadow an active CMS landing page.
- The product exists and is active in the target install.
- The registry validates and the page resolves a canonical D1 product.
- Price, variant, stock, and content IDs are not duplicated in markup.
- Form mode follows province policy through `GeoIpResolvedForm`.
- The page has no fabricated social proof or unsupported conversion claim.
- At 390px and desktop width, there is no page-level horizontal overflow.
- Keyboard focus, labels, errors, CTA behavior, and form handoff remain usable.
- `npm test`, `npm run check`, and `npm run build` pass; then open the
  actual page and inspect console/network errors.

## 7. Release discipline

A native page changes application code: release it through the install's normal
product adoption and deploy path. Keep `wrangler.jsonc`, secrets, merchant
assets, D1 identity, and provider configuration install-owned. No landing-page
release authorizes a remote migration, provider call, or production deployment
without the applicable approval.

## Product structured data

`BaseLayout` emits the page's `Product` JSON-LD for you: when the request path is an active slug in `src/data/native-landing-pages.ts`, it reads that entry's `productSlug` from the catalogue and builds the block (`src/lib/native-landing-product.ts`: name, description, image, SKU, one offer per variant with price and `InStock`). A page that passes its own `product` prop to `BaseLayout` keeps it; never add a second `<script type="application/ld+json">` Product block by hand. Registering the page is therefore also what gives it structured data. Before 1.8.8 the native pages on zvara.shop and taniniaga.shop sent only `Organization` and `WebSite` (audit 2026-11-02).
