# AdsBookCMS — Design System

> Verified against disk: 2026-10-31 @ `4aacb40` + `feat/storefront-breadcrumb` working tree (storefront §1.1 Shopify-theme palette, §3 PDP order, login panel §1.3; §2, §7.4 as rewritten for compact-market v2)
>
> **The public palette is neutral plus one overridable accent (ADR-019, as
> amended 2026-08-23).** Colour tokens below that describe the retired gold
> accent are historical; `design-tokens.md` at the repository root is the
> current source for the neutrals, and the nine `--sf-*` custom properties in
> `src/styles/form-hybrid.css` are the re-brand contract in full — four accent
> tokens including the focus ring, plus the field, its border, its empty state,
> the alternate surface and the separator hairline. An install overrides those
> declarations; it does not fork the stylesheet.

This document describes the presentation layer **as it ships**, extracted from the code rather than from intent. Concrete values carry a file reference, and a line number where that line number is stable. Section 1.4 dropped its line numbers after they drifted through a refactor and left the document wrong about its own subject. Anything that could not be verified against the tree was left out — see `DECISIONS.md` ADR-010.

Scope note from `ARCHITECTURE.md`: the **admin shell is a canonical product surface** (every install gets the same operator UI), while **storefront presentation varies per install** via `PUBLIC_STOREFRONT_TEMPLATE`. The two therefore have separate, deliberately unrelated palettes. Do not unify them.

---

## 1. Colour

Storefront colour is mostly hex literals written inline as Tailwind arbitrary
values (`bg-[#111111]`) and as raw CSS in component `<style>` blocks. The **one**
exception is the accent, which since #58 lives as custom properties at the top of
`src/styles/form-hybrid.css` — now **nine**: `--sf-accent`, `--sf-accent-strong`,
`--sf-accent-soft`, `--sf-accent-ring`, `--sf-field`, `--sf-field-empty`,
`--sf-field-border`, `--sf-surface-alt`, `--sf-line`. Note that
`--sf-accent-ring` is an `rgba()`, not a hex: a store script matching hex
literals will skip it and leave the focus ring the product's colour. ADR-019 as
amended makes those the re-brand surface, so a new accent colour belongs there
and never at a call site. The shadcn/admin layer uses its own, separate custom
properties.

### 1.1 Storefront palette (`compact-market`)

Neutral ink on white, ink as the interactive accent, one sale colour: the
Shopify theme (Dawn) palette, read from the Dawn demo store's home and product
page on 2026-10-31 (ink `rgb(18,18,18)`, ink at 75% for body copy, `#F3F3F3`
secondary surface, solid ink "Buy it now", blue "Sale" badge). Set 2026-10-31,
replacing the v2 blue accent.

| Hex | Role |
| --- | --- |
| `#111111` | Primary ink — text, selected chip fill, monogram tile |
| `#555555` | Secondary text |
| `#767676` | Tertiary text, struck-through compare price |
| `#F3F3F3` | Soft surface — tagline line, search well, info notes, review cards, footer, the canvas outside the column on wide screens, section separators (`border-t-8`) |
| `#E5E5E5` | Outline of pill controls at rest (chips, search, secondary buttons) |
| `#EDEDED` | The hairline above the sticky buy bar |
| `#E5E5E5` faded | The rule under the header: a 1px `linear-gradient` from transparent to `#E5E5E5` at 20%/80% and back, so it fades out at both edges |
| `#121212` / `#333333` | Accent — primary buy action (sticky bar "Pesan sekarang", checkout submit, thanks/payment actions), selected variant border; same value as `--sf-accent` / `--sf-accent-strong`. A store re-brands through those tokens (ADR-019) |
| `#F3F3F3` (`--sf-accent-soft`) | A filled field and the selected variant card; an empty field is white (`--sf-field-empty`) |
| `#334FB4` | Discount pill only (`-25%`, `rounded-full` like Dawn's badge), white text, 7.2:1 |
| `#D92D20` | Checkout errors only (`form-hybrid.css`), never a sale |
| `#15803D` | Benefit check and "Pembeli terverifikasi", both data-backed |

White is the column ground. The compare price is the only struck text; the
discount pill is the only blue, and it renders only when a compare price exists.

Named in `src/lib/ui-variants.ts`:

- `buttonVariants` primary — `bg-[#111111] text-white hover:bg-[#333333]`
- `badgeVariants` green — `bg-[#F5F5F5] text-[#111111] ring-1 ring-[#E5E5E5]`
- `secondary`, `dark`, `ghost` and the `listItemVariants` values are
  Tailwind **slate**, not the storefront
  neutrals. See §8.

`#8A704F`, listed here as the muted-gold eyebrow colour, has **zero**
occurrences under `src/`.

### 1.2 `wide-catalog` is retired

The second template was retired under ADR-018 and repointed at
`compact-market`. `wide-catalog` and `WideCatalogHome.astro` have **no**
references left in `src/` outside tests, and
`src/components/storefront/templates/` holds one file,
`CompactMarketHome.astro`.

This section previously documented a `zinc`/`emerald` palette on a `#FBFBFB`
canvas, and §3 still cited `WideCatalogHome.astro` line numbers as a live
exception to the square-shape rule. Neither exists.

A retired *built-in* is not a closed template system: operator-created template
definitions live in D1 and need no rebuild.

### 1.3 Admin palette (canonical product surface)

Admin colour **is** tokenised. `.admin-shell` redefines the shadcn variables in oklch:

- Token block — `src/styles/admin.css`
- Accent is a single JS constant: `export const ADMIN_ACCENT = "#2563eb"`, injected as `--admin-accent` inline on `<body>` and consumed by `src/styles/admin.css` for primary, focus, and input states.
- Shell background and table chrome are scoped in `src/styles/admin.css`, matched by `bg-[#f6f7f9]` on the body class (`src/layouts/AdminLayout.astro`).
- Admin login is a plain colour stage owned by the product. Its only image is the runtime store/product identity mark inside the form card; it carries no decorative or merchant-specific background imagery (LOGIN-18).

Login (`/hello`): one viewport, never scrolled, on phone and desktop. The
form column holds everything an operator needs on any screen: the wordmark as the `h1` (28px icon, "Ads" in `#2563EB` and "Book" in ink at
18px bold, then "CMS" as a 12px tag tracked 0.18em after a hairline; one
accessible name "AdsBookCMS")
(owner: nothing else above the form), the form (brand-blue focus and button), and a pinned footer
with the version; centred on a phone. On a phone the owner's poster
(`public/images/login-bg-mobile.webp`, 941x1672, 149 KB, a CSS background
inside the phone query so a desktop never downloads it) fills the screen and
the form sits at the bottom in a clear glass card: a 62%→48% white gradient,
`blur(28px) saturate(1.7)`, a light border with a top highlight, 1.75rem
radius, so the poster shows through and its title stays in view. Labels are
slate-900, measured against #8C8C8C (the darkest the blurred poster makes the
card); fields stay 92% white so typed text never sits on the image. The desktop brand column
(`bg-slate-950`, a dot grid fading to the edges) holds only the joke tip jar,
centred (owner decision 2026-10-31): the QRIS code alone
(`public/images/qris-dukung-adsbookcms.svg`, rebuilt as vector modules from
the print, payload identical, checked to decode from the rendered page), a pulsing "scan me" corner frame outside the
code, signal waves leaving the card (three rings, 4.2s, scale 1 to 1.55, behind the
opaque card so the code is never covered), "CMS GRATIS. / Server GRATIS." with a
brand-blue highlighter drawn under each GRATIS in turn on a 7s cycle, "Kopi
developernya yang belum. Boleh dong ditraktir? Hehehe.", the quote "Satu kopi,
satu bug minggat." (by ongki.pro), and the merchant's name. The QR stays the focal point: everything that moves moves out
from it or sits below it. Not a plea: no
"seikhlasnya", no "dukung". The image is lazy, so a phone never fetches it;
motion stops under `prefers-reduced-motion` (`admin.css`).

Product icon, flat (2026-10-31, replacing the gradient squircle): an open book
in solid white — the store's order book, with a gap at the spine so it reads as
a book down to 16px — whose right page carries an up-right arrow cut out in the
tile colour, an ad turning into a sale. One flat `#2563EB` rounded square
(`rx` 232/1024), no gradient, no sheen. `public/images/adsbook-icon.svg` is the
login tile and sidebar card. The same artwork is the shipped default of the
merchant-replaceable tab icons: `images/logo.svg`, `favicon.ico` (16+32),
`favicon.png` (32) and `favicon-192.png` (full-bleed square; iOS applies its
own mask). Static, not animated: only Firefox animates a favicon and an
apple-touch icon must be PNG.

### 1.4 Base shadcn tokens

The `:root` oklch scale and its `.dark` overrides live in `src/styles/admin.css`,
which is the only entry that imports shadcn. `--primary: oklch(0.546 0.245 262.881)`
is a blue matching `ADMIN_ACCENT`. The admin radius is **one thin value,
`--radius: 0.375rem`**, declared on both `:root` and `.admin-shell` in
`admin.css`: shadcn popups (Select, Combobox, DropdownMenu) portal to `<body>`,
outside `.admin-shell`, so two different values made every menu rounder than
the control that opened it. The scale derives from it — `rounded-lg` 6px,
`rounded-xl` ≈8px — and admin cards use `rounded-xl`; no admin file writes
`rounded-2xl`/`rounded-3xl` or a fixed pixel radius for a card.

The radius scale itself is **shared**, declared in `src/styles/foundation.css`.
It reached every surface through shadcn's theme block until the three-way split;
leaving it behind in `admin.css` silently reshaped every rounded corner on the
storefront, because `rounded-md` fell back to Tailwind's `0.375rem`. `admin.css`
overrides `--radius` for the admin surface only (above); the storefront never
loads `admin.css` and keeps `foundation.css`'s `0.625rem`. Giving the
storefront its own radius is a design decision, not something to arrive at by
moving a file.

The base variable set — `--bg-canvas: #fafafa`, `--text-main: #0f172a`,
`--focus-ring: #2563eb` — is also in `foundation.css`. `--focus-ring` is live;
`--bg-canvas` sets `body`, but every storefront template paints over it.

Line numbers are deliberately absent here. This section cited them, they drifted
with the split, and the document was wrong about its own subject.

---

## 2. Typography

### 2.1 Families and imported weights

| Family | Weights imported | Import site | Applied where |
| --- | --- | --- | --- |
| Inter | 400, 600, 700 | `src/styles/foundation.css` | shared `body` and admin shell |

Font faces are owned by `foundation.css`, which all three surface entries import.
They were in `BaseLayout` once, so the 26 admin routes asked for a family whose
faces were declared nowhere they could see and rendered in `system-ui`; the
foundation exists so that cannot recur. Plus Jakarta Sans is no longer imported;
`EmbedLayout` intentionally inherits Inter.

No display face is loaded. Cinzel set the wordmark and the review initials
until 2026-10-31; a luxury serif in capitals did not suit a default every kind
of merchant ships with, and it cost a font request on every public page. The
import and the `@fontsource/cinzel` dependency are gone.

`AdminLayout.astro` imports no font files at all; admin inherits Inter from `foundation.css`.

### 2.2 Stack

```css
'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif
```
`src/layouts/BaseLayout.astro` and the `body` rule in `src/styles/foundation.css`. The admin variant adds `"Segoe UI"` and enables `font-feature-settings: "cv02","cv03","cv04","cv11"` in `src/styles/admin.css`.

### 2.3 Storefront type treatment

Sentence case, Inter throughout, sizes a buyer reads without zooming. The v1
voice — 9–10px uppercase labels tracked 0.12–0.2em — is retired: it made
category and variant counts unreadable on a phone ("RUMAH TANGG… 2 VARIAN")
and gave every store the same boutique accent.

- Wordmark: `text-[15px] font-bold uppercase tracking-[0.08em]`, the tenant's own name, one line — `SiteBrand.astro`. Shown only while the store has no uploaded logo (`tenant.logo` is `DEFAULT_TENANT_LOGO`); an uploaded logo replaces it, 32px tall, at most 168px wide, sized inline. No monogram tile.
- Announcement line: "Official Store" with a solid blue (`#1D6FEB`) badge-check, `text-xs font-semibold` on `#F3F3F3`, above the header — `SiteHeader.astro`. The tagline is no longer drawn there.
- Page `h1`: `text-2xl font-bold tracking-[-0.02em]` — `PageIntro.astro`; PDP `h1` `text-xl`
- Section heading: `text-xl font-bold tracking-[-0.02em]` (home), `text-base font-bold` (PDP sections)
- Card title: `text-sm leading-5`, at most two lines (`line-clamp-2`), the price directly under it (`mt-0.5`), no reserved height: a one-line title's price sits higher than its neighbour's, as in the Shopify theme, while the card frames still align (grid stretch, `h-full flex-col`)
- Card price: `text-[15px] font-bold`; "Mulai" in `text-xs` only when variants differ in price
- PDP price: `text-[26px] font-bold`
- Meta and helper text: `text-xs` / `text-[13px]`, never below 12px
- Breadcrumb: `text-[13px]`, one line, never truncated. A long trail scrolls sideways (scrollbar hidden) and opens scrolled to its end, so the current page (`font-semibold`, `aria-current="page"`) reads whole; the left edge fades only while part of the trail is out of view. Chevron (`m9 18 6-6-6-6`, `#B3B3B3`) separates; a `/` home crumb is a house icon whose label stays its accessible name. `<ol>` of `<li>`
- No eyebrow above a heading. `PageIntro` still accepts `badge` and does not draw it.

Mobile input font-size is force-set to `1rem` to stop iOS zoom — `src/styles/foundation.css` (all viewports ≤639px, shared because every surface has inputs) and again for admin at ≤1023px (`src/layouts/AdminLayout.astro:66-73`).

---

## 3. Shape language and the compact-market v2 direction

### Direction — compact-market storefront (2026-10-31)

Surface/job: the default storefront every install ships. A buyer arriving
from a Meta or Google ad on a phone must see what the store sells, find the
product, read its full price, and reach the COD order form without friction —
for any kind of merchant.

Why it changed: the v1 contract (square `rounded-none`, hairline borders
everywhere, uppercase micro-labels, Cinzel wordmark) read as rigid and
boutique. Three stacked bars (an unverified "Official Store" seal, a dark
tagline strip, the wordmark) took ~100px before any product. The hero was a
full-width square with no way to swipe on a phone. Cards truncated their
category. The PDP listed the variants twice (a read-only list, then the radio
cards in the form) and filled space with generic attributes ("Fokus Produk",
"Ketersediaan: seluruh varian tersedia").

Sections (in order):
- Home: "Official Store" line (blue badge-check) → header (text wordmark, or the uploaded logo; a package icon to `/produk`), not sticky, closed by a rule that fades at both ends → swipeable hero card →
  catalogue (heading, search, category chips, 2-column grid) → landing pages →
  footer.
- `/produk`: breadcrumb → title with product count → grid.
- PDP: breadcrumb → photo → offer (name, rating/sold if real, price with
  "Mulai" when variants differ, compare price, short copy, "N pilihan: …",
  no inline buy button and no shipping-cost note — the form is the action and
  shows the cost) → "Tentang produk" (only content that exists) → reviews (only
  if real) → order form. The sticky buy bar (name, price, "Pesan sekarang") is
  the one jump to the form, shown between the photo and the form.

Shape rules:
- One soft radius vocabulary: `rounded-xl` for images and cards,
  `rounded-2xl` for grouped surfaces (hero, review cards, empty states, the
  landing-page list), `rounded-full` for chips, search, and buttons,
  and the discount pill (Dawn's badge).
- Separation is whitespace and surface, not lines. Between PDP sections a
  `border-t-8 border-[#F3F3F3]` band; the only hairlines are the faded rule under the
  header and above the sticky bar.
- No shadow except the sticky buy bar's upward drop.
- The column stays 480px on every screen (`BaseLayout`); wider than `sm` it
  sits on the `#F3F3F3` canvas with a 1px `#EDEDED` edge.
- The checkout form (`form-hybrid.css`, §4) keeps its own geometry; this
  direction does not restyle it.

Claims: no rating, sold count, or "verified buyer" mark appears unless the
store's data carries it. The "Official Store" line is the exception by owner
decision (2026-10-31): it states that the store's own site is its official
store, which every install is by definition; it is not a platform
verification.

Interaction: the hero is a native `scroll-snap` track (swipe, dots jump to a
slide, never autoplays). Images are `draggable=false`; a vertical touch swipe
that starts on the hero scrolls the page (checked with CDP touch events,
2026-10-31). Category chips and search filter the same card list
client-side, with an empty state.

## 4. Form controls (checkout)

> **Colour in this section is tokenised, and the hexes below are historical.**
> `form-hybrid.css` contains **zero** occurrences of `#C5A880` or `#F8F7F4`:
> every state — the valid field, the checked variant, the district hover, the
> total box, the submit button — resolves through `var(--sf-*)`. That is what
> makes ADR-019's re-brand surface real rather than aspirational: an install
> overrides nine declarations and every control below follows. Where a line
> here still quotes a boutique hex, read it as the value that shipped before
> the tokenisation, not as what the file says today. The geometry, spacing and
> line references were re-checked and remain accurate.

### 4.1 Input geometry — `form-hybrid.css:270-288`

```
width: 100%
min-height: 2.9rem
padding: 0.96rem 0.75rem 0.2rem     /* top-heavy: reserves room for the floated label */
border: 1px solid #d8ddd6
border-radius: 0.5rem
background: #f7f8f7
color: #0f172a
font-size: 1rem
font-weight: 500
line-height: 1.35
box-shadow: none
```

Textarea overrides — `min-height: 4.4rem`, `padding-top: 1.25rem`, `padding-bottom: 0.38rem`, `resize: vertical` (`:289-294`).

Shipped values: `border-color: #E5E5E5; background: #ffffff; color: #111111` (`form-hybrid.css`).

### 4.2 Floating label

The float is pure CSS, driven by `:placeholder-shown`. Placeholders are made transparent so the label can occupy the field (`form-hybrid.css:295-298`).

**Resting** — `form-hybrid.css:299-316`:
```
position: absolute; left: 0.75rem; top: 1rem
color: #667085
font-size: 0.78rem; font-weight: 500; line-height: 1
transform-origin: left top; pointer-events: none
```
Textarea resting top is `0.85rem` (`:317-320`).

**Floated** (`:focus` or `:not(:placeholder-shown)`) — `form-hybrid.css:321-333`:
```
top: 0.3rem
color: #245e28
font-size: 0.62rem; font-weight: 700
```
The focused label is `#111111` (`form-hybrid.css`).

**Invalid label** — `color: #b42318` (`form-hybrid.css:347-350`).

### 4.3 Field states

| State | Rule | Reference |
| --- | --- | --- |
| Focus | `border-color: #111111; background: #ffffff` | `form-hybrid.css` |
| Focus | `border-color: #111111 !important; box-shadow: 0 0 0 2px rgba(197,168,128,.3)` | `form-hybrid.css` |
| Valid `.field-valid` | `border-color: #8bc58f; background: #ffffff !important; box-shadow: none` | `form-hybrid.css:396-403` |
| Valid | `border-color: var(--sf-accent); background: var(--sf-accent-soft)` | `form-hybrid.css` |
| Invalid `.field-invalid` | `border-color: #dc2626 !important; background: #fffafa !important; box-shadow: 0 0 0 2px rgba(220,38,38,.08)` | `form-hybrid.css:388-395` |
| Error message `.field-feedback` | `0.72rem / 600`, `color: #d92d20`, `!` glyph in a `#fee4e2` circle, `fieldFeedbackIn` 0.18s | `form-hybrid.css:358-384` |

### 4.4 Variant cards

Two variants exist and they are not the same shape.

`.variant-copy` — `form-hybrid.css:133-140`:
```
display: flex; gap: 0.65rem
padding: 0.65rem 0.85rem
border: 1px solid #e6eae2
background: #fff
/* no border-radius */
```

`.simple-variant-copy` — `form-hybrid.css:141-147`:
```
padding: 0.72rem 0.85rem
border: 1px solid #dfe5dc
border-radius: 0.7rem
background: #f6f7f5
box-shadow: none
```

Group gap: `.variant-group` is `0.2rem` (`:117-122`); `.simple-variant-group` is `0.5rem` (`:123-125`).

Radio dot `.variant-radio`: `1.1rem` square, `border: 2px solid #cbd5e1`, `margin-top: 0.12rem` (`:148-155`).

Checked state resolves through `var(--sf-accent)` / `var(--sf-accent-soft)`, and the radio fills with a radial gradient in the same ink. There is no longer a second declaration competing with it.

Typography: `.variant-label` `0.82rem / 800 / #0f172a` (`:224-230`); `.variant-price` `0.95rem / 800 / #111111` (`:237-242`); `.variant-compare` `0.72rem / #94a3b8` line-through (`:243-247`).

### 4.5 District autocomplete

`.district-list` — `form-hybrid.css:509-522`: `margin-top: 0.35rem`, `max-height: 16rem`, `overflow-y: auto`, `border: 1px solid #cbd5e1`, `border-radius: 0.6rem`, `box-shadow: 0 10px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.04)`, entrance animation `districtDropdownIn` 0.15s (`:499-508`, `:523-525`).

`.district-item` — `:533-553`: `padding: 0.55rem 0.85rem`, `border-left: 3px solid transparent`, `border-bottom: 1px solid #f1f5f9`. Hover/focus resolves through the tokens: `background: var(--sf-accent-soft); border-left-color: var(--sf-accent)` (`:577-578`). Item type: `strong` `0.82rem / 700 / #0f172a` (`:568-577`), `small` `0.68rem / 500 / #64748b` (`:578-586`).

Picked-address card `.shipping-address-summary` — `:442-448`: `padding: 0.75rem`, `border: 1px solid #c7ddc4`, `border-radius: 0.65rem`, `background: #f7fbf5`.

### 4.6 Summary and total

`.summary-card` — `form-hybrid.css:818-826`: `border: 1px solid #dfe5dc`, `border-radius: 0.75rem`, `background: #fff`, `box-shadow: 0 1px 2px rgba(15,23,42,.04)`, `overflow: hidden`.

Rows — `:827-848`: `padding: 0.62rem 0.85rem`, `border-bottom: 1px solid #f1f5f9`; label `0.78rem / 600 / #64748b`, value `0.82rem / 700 / #0f172a` right-aligned.

`.total-box` — `:894-898`: `padding: 0.85rem`, `border-top: 1px solid #E5E5E5`, `background: var(--sf-surface-alt)`, flex space-between. The green tints it carried (`#d7e7d8` on `#f3f8f2`) were never overridden by the deleted layer, so they shipped on all seven checkout routes until 2026-08-16.

### 4.7 Submit button

Layer 1 `.submit-main` — `form-hybrid.css`: full width, `min-height: 2.75rem`, square, `background: #111111`. States `ready` / `disabled` (`#e5e5e5` fill, `#555` text) / `loading` are driven by `data-state`. There is no orange anywhere in the build: `f97316` and `ea580c` appear zero times under `dist/`.

The submit button is `background: #111111 !important; color: #ffffff !important` (`:949-950`), with `border-color: var(--sf-accent-strong)` and the same token as its background on hover (`:1007-1008`). It carries its own `:focus-visible` indicator — that used to live only in the deleted override, so `/hybrid-form` had no keyboard focus ring at all.

---

## 5. Layout widths

The storefront ships two compiled templates, enumerated in `src/lib/tenant-contract.ts`. The active template resolves at request time from the store row with environment/default fallback. An unknown value logs and degrades to `compact-market`; it does not throw.

**The width branch happens in three places, and all three must agree:**

2. `src/layouts/BaseLayout.astro:184-189` — the shell:
   - `compact` → `max-w-[480px] shadow-[0_0_40px_rgba(15,23,42,0.08)]`
   - `wide` → `max-w-none`
   Both sit inside `flex min-h-screen w-full justify-center` (`:182`) on a `bg-white` panel (`:185`).
3. `src/components/storefront/shared/Breadcrumb.astro` sets no width of its own: it fills the column it sits in (`px-4`), so it can no longer diverge from the page's `contentWidth`.

Inner content repeats `max-w-[480px]` independently rather than inheriting the shell — `CompactMarketHome.astro:45`, `SiteHeader.astro:17`, `SiteFooter.astro:14`, `produk/index.astro:30`, `PageIntro.astro:23`, `form-hybrid.css`, `EmbedLayout.astro:26`.


`EmbedLayout` is fixed at 480px with no template branch (`src/layouts/EmbedLayout.astro:26`).

`AdminLayout` is not width-constrained: `flex h-dvh overflow-hidden` on the body (`src/layouts/AdminLayout.astro:39`), with layout owned by `AdminShell` and the shadcn sidebar.

**Admin page width is one contract, owned by `AdminShell`:** the content box is
`mx-auto w-full max-w-[1560px]`, the same box as the top bar. Pages and islands
do not set their own centred `max-w-*`; before this rule five page widths gave
five different content edges at 1920px. Measured 2026-09-26: all 25 admin
pages share one left and right edge at 1280, 1440 and 1920px.
`src/lib/admin-page-width.test.ts` refuses a centred page-level `max-w-5xl`/
`6xl`/`7xl` coming back; inner blocks may still limit a paragraph or preview.

### 5.1 Admin navigation motion contract

Admin navigation is intentionally static. Desktop renders direct workspace links
and a compact, always-visible child list below the active workspace. The parent
remains a link to its overview; there is no accordion, disclosure state,
auto-scroll, width toggle, or clickable resize rail. Tablet hides the contextual
child list in its icon rail, while child destinations remain available from
their parent overview and global search. The phone all-menu sheet renders every
role-allowed child. Viewport width alone chooses the navigation mode: phone
bottom navigation, tablet icon rail, or full desktop sidebar
(`src/components/admin/AdminShell.tsx`, `src/components/admin/AppSidebar.tsx`).

The admin-scoped rule in `src/styles/admin.css` disables animation and
transition on the sidebar, tooltip, bottom navigation, and Sheet navigation
surfaces. This does not disable action feedback: loaders may still spin while a
real request is pending, and loading/error/empty states remain visible. GSAP is
not installed; `tw-animate-css` remains shared UI infrastructure rather than an
admin navigation dependency.

### 5.2 Admin dashboard hierarchy

The dashboard follows overview-first order: schema mismatch notice, universal
business analytics, then owner/admin operational health. Analytics owns the
period control, four KPIs, revenue trend, and payment mix. Diagnostics never
push the primary business overview below the fold before it.

Sidebar and mobile-menu labels use regular weight; only the current location is
medium. Dashboard headings and numeric values are semibold, while labels are
medium or regular. KPI values use tabular numerals and do not truncate. At phone
and tablet widths KPIs remain a 2×2 grid; from `lg` they form one row, and the
trend/payment split begins at `xl`. Dashboard links are rendered only when the
same route policy grants access to their destination.

---

## 6. Tailwind v4 setup

Tailwind is configured CSS-first. **There is no `tailwind.config.*` file** — `components.json:7` sets `"config": ""`.

### 6.1 Three surfaces, one foundation

The CMS admin, the public storefront and checkout are three separate style
surfaces. They share exactly one file.

| Entry | Imported by | Owns |
| --- | --- | --- |
| `src/styles/foundation.css` | the three entries below | Tailwind, the type ramp, base tokens, radius scale, reduced-motion, scrollbar, mobile input sizing |
| `src/styles/admin.css` | `AdminLayout`, `/hello` | shadcn, tw-animate, `.admin-shell`, `.btn-*`, `.admin-input-flat` |
| `src/styles/storefront.css` | `BaseLayout`, `EmbedLayout` | public-only rules |
| `src/styles/form-hybrid.css` | the checkout routes, directly | the entire checkout layer, standalone — no Tailwind, no `@apply` |

This replaced a `global.css` that carried Tailwind, shadcn and tw-animate
together and was imported by both the admin and the storefront entries. The
split was therefore nominal: measured on a local build, `/` inlined 176 KB of
CSS against `/admin/login`'s 184 KB, and the public CSS contained 69 occurrences
of `sidebar`, 16 shadcn `[data-slot=` selectors and the chart tokens. It is now
67.6 KB for `/`, 84.7 KB for `/full-form` and 158.4 KB for `/admin/login`.

**Each entry declares what it is built from.** `foundation.css` imports Tailwind
with `source(none)`, so nothing is discovered automatically, and every surface
lists its own `@source` roots. A utility a storefront page never writes is never
generated into the storefront bundle.

The consequence to remember: **class names written outside a template still have
to be declared.** `src/lib/ui-variants.ts` holds the cva variants both surfaces
render with, and leaving `../lib` out of the scan roots silently dropped `py-7`
from the product page. Both entries scan `../lib` for that reason.

### 6.2 Wiring

- Vite plugin — `astro.config.mjs` (`@tailwindcss/vite`).
- Import chain at the top of `foundation.css`:
  ```css
  @import "tailwindcss" source(none);
  @import "@fontsource/inter/400.css";
  @import "@fontsource/inter/600.css";
  @import "@fontsource/inter/700.css";
  @custom-variant dark (&:is(.dark *));
  ```
- `tw-animate-css` and `shadcn/tailwind.css` are imported by `admin.css` alone.
  No public file imports a shadcn component; a census found `.btn-primary` at 6
  admin references and 0 public, `.btn-blue` 8/0, `.btn-secondary` 11/0,
  `.admin-input-flat` 11/0.
- Token bridge — `@theme inline { … }` in `admin.css` maps every shadcn variable
  to a Tailwind colour utility. The **radius** half of that bridge is in
  `foundation.css` because all three surfaces share it (§1.4).
- Values live in `:root` and `.dark` inside `admin.css`, in **oklch**, per
  Tailwind v4 / shadcn convention.

shadcn config (`components.json`): style `base-nova` (`:3`), `rsc: false` (`:4`), `tsx: true` (`:5`), `baseColor: neutral` (`:9`), `cssVariables: true` (`:10`), no prefix (`:11`), `iconLibrary: lucide` (`:13`), aliases `@/components`, `@/lib/utils`, `@/components/ui` (`:15-21`).

**`shadcn` is a runtime `dependency`, not a devDependency** (`package.json:47`). That is required, not a mistake: `admin.css` does `@import "shadcn/tailwind.css"`, so the package must resolve during `astro build`, not only during CLI scaffolding. `tw-animate-css` is in `dependencies` (`package.json:51`) for the same reason.

`cn()` is `twMerge(clsx(...))` — `src/lib/cn.ts:1-6`. `src/lib/utils.ts:1` is a one-line re-export so the shadcn `@/lib/utils` alias resolves; both names are live in the tree.

Class-variance-authority variants for storefront primitives live in `src/lib/ui-variants.ts` (button, badge, list-item, meta-text, text tone, plus two bare class constants at `:90-91`).

---

## 7. Component inventory

### 7.1 `src/components/ui/` — shadcn primitives

The directory holds the shadcn primitives used by admin React islands (`input-group.tsx`, `popover.tsx` and `combobox.tsx` came back with A-295). Treat it as shared admin infrastructure; extend an existing primitive before introducing another component system.

**Admin control contract (A-307).** The primitive owns a form control's
geometry; a caller never does.

| Control | Height (desktop) | Owner |
| --- | --- | --- |
| `Input`, `SelectTrigger`, `InputGroup`, `Combobox` input, `Button` default and `lg` | 40px (`h-10`) | `ui/*.tsx` |
| `NativeSelect.astro`, `.admin-input-flat`, `.btn-primary` / `.btn-blue` / `.btn-secondary` (static Astro pages) | 40px | the static twins of the above, in `admin.css` |
| `size="sm"` buttons: chips, quick picks, row actions, section adders | 28px | a compact tier inside a panel — never a page or card header action |
| Table row actions (`icon-sm`, row menus) | 32–36px | deliberately compact, inside a row |
| Below 768px | 48px for inputs and triggers, 44px buttons | `admin.css` touch floor |

- Callers pass layout only: width, `flex-1`, `font-mono`, a textarea's
  `min-h-*`, `rounded-l-none` on an input joined to an addon. Never height,
  radius, background, border colour, shadow or type size, and never `size="sm"`
  on a `SelectTrigger` or `size="xl"` on an admin `Button`.
- A page or card header action (save, edit, delete, refresh, preview) is the
  default `Button` size. A link that acts as a button is `buttonVariants()`
  or `.btn-*`, never hand-built from `min-h-11 rounded-xl text-xs` (one
  wrapped at 768px). `buttonVariants()` returns a tailwind-merged string,
  so an Astro page or an `<a>` using it directly keeps the variant's border
  (the unmerged base `border-transparent` used to win and drew outline
  buttons borderless). Guards: `admin-controls.test.ts` refuses geometry on
  `<Button>` and on any `.btn-*` class string.
- A destructive action confirms through `useConfirm`
  (`components/admin/useConfirm.tsx`), a shadcn Dialog naming the
  consequence and the action — never `window.confirm`, which a guard refuses.
- A filter toolbar is `FilterBar` + `FilterField` (one label style, a width from
  `size`, wraps instead of overlapping) from `components/admin/filter-bar.tsx`.
- Search is `SearchInput` from the same file — an `InputGroup` with the icon as
  an addon and a clear button — never an icon absolutely positioned over an
  `<Input>`.
- Choose by role, not taste:
  - **a toolbar filter** (status, source, category, role, date) is
    `FilterSelect` — a DropdownMenu with a radio group sharing
    `FILTER_TRIGGER_CLASS` with the date filter, so every filter trigger is
    the same control (leading icon, label, chevron) and renders its own label;
  - **a form field** whose value is submitted and validated is `Select` with an
    `items` map always set (so the server render reads the label, never the
    raw value) — it keeps `aria-invalid`, form reset and keyboard typeahead.
- Object-valued comboboxes set `itemToStringValue` to the id: the hidden form
  input otherwise carries the whole object as JSON.
- Courier marks live in `public/images/couriers/` (WebP ≤ 5 KB each, SVGs
  checked for script, event handlers, external references and
  `foreignObject`); a courier without one shows its initials.
- Kecamatan search is `DistrictCombobox`; inside a modal dialog its popup
  portals into the dialog.
- The one declared exception is a dark code editor, marked `data-code-editor`.
- Lists of a few settings or methods are rows in one card (`divide-y`), not a
  card per item inside a card.
- Every panel has the same 1px frame: `admin.css` gives shadcn `Card` (which
  draws none in base-nova) the border the hand-built sections already had.
- Page gutter is 16px below `md`, 24px from `md`, 32px from `xl` (AdminShell).
- A small, uniform set with two switches each (couriers) is a grid of one-line
  cards: mark and name on the left, switches on the right, coverage shown only
  when restricted.

`src/lib/admin-controls.test.ts` enforces all of this and reads JSX tags to
their real end (a `>` inside `onChange={(e) => …}` does not close the tag).

**Admin type anatomy (A-310).** Inter; the admin loads 400/500/600
(`admin.css` adds the 500 face `foundation.css` does not ship — without it every
`font-medium` primitive rendered at 400). Five sizes, three weights, a 12px floor:

| Role | Desktop | Phone (<768px) | Class |
| --- | --- | --- | --- |
| Page title (`AdminPageHeader`, order id) | 24/600 | 20/600 | `text-xl md:text-2xl font-semibold tracking-tight` |
| KPI value | 24/600 | 24/600 | `text-2xl font-semibold` (tabular for money) |
| Card / section title, top bar title | 16/600 | 16/600 | `text-base font-semibold` |
| Body, table cell, sidebar and submenu item, menu item, button, input | 14/400 (UI 500) | 14; inputs 16 | `text-sm` — phone inputs 16px so iOS never zooms |
| Label, helper, meta, badge, table head, sidebar section, bottom nav | 12/400–600 | 12 | `text-xs` — table head and section labels uppercase, `tracking-wider` |

- Weights: 400 reading text, 500 interactive (buttons, nav, active item,
  labels), 600 titles and emphasis. `font-bold`, `font-extrabold` and
  `font-black` are not used in admin; they rendered as the same 700 face
  anyway.
- Nothing below 12px (`text-[9–11px]` measured on ~250 phone labels before
  this). A code editor may use 13px mono.
- `admin-controls.test.ts` enforces the floor, the weight ceiling and the
  absence of `text-3xl`+ across `components/admin`, `pages/admin` and
  `AdminLayout`.

**Phone layout.** A fixed-size `FilterField` is half the row below `sm`, so a
four-filter toolbar is two rows; KPI tiles are two-up and drop their
explanatory sentence; a settings row keeps its icon beside the text and puts
actions under it. A store without its own logo shows its initial
(`StoreMark`) — the product mark is a 4:1 wordmark, illegible in a square.
A table wider than the page pins its row actions (`sticky right-0`).

### 7.2 `src/components/storefront/shared/`

Ten Astro components: `Breadcrumb.astro`, `Icon.astro`, `LegalPage.astro`,
`PageIntro.astro`, `ProductListItem.astro`, `RatingStars.astro`,
`SiteBrand.astro`, `SiteFooter.astro`, `SiteHeader.astro`,
`SocialProofToast.astro`. The directory also holds `lucide-subset.json`, the
icon payload `Icon.astro` reads.

### 7.3 Other storefront directories

- `home/` — `HeroSection.astro`, `LandingPagesSection.astro`,
  `ProductsSection.astro`. `ProofsSection.astro` was deleted; this section
  listed it, §2.1 cited a line inside it, and §3 sourced its shadow rule from
  it.
- `templates/` — `CompactMarketHome.astro` only (§1.2).
- `forms/`, `seo/`, `landing-pages/`, `tracking/`, `shared/` — the remaining
  directories. `TRACKING_SPECS.md` owns the tracking contract; nothing about it
  is a design decision.

**There is no React on the public surface.** The product gallery was the only
island and is now scriptless Astro (§7.4).

### 7.4 PDP gallery

`ProductImageGallery.astro` is 65 lines and renders one plain `<img>` per photo,
stacked. No scroll container, no thumbnails, no arrows, no counter, **no
script**.

- Wrapper `w-full`, one `relative w-full bg-[#F3F3F3]` frame per photo
- Image `block aspect-square w-full object-cover`, `draggable={false}`
- First photo `loading="eager"`, `decoding="sync"`, `fetchpriority="high"` — it
  is the page's LCP element; the rest are lazy and async
- One red `rounded-md` discount pill over the first frame, only when a compare
  price exists; the category badge is gone (the breadcrumb names it)

This section previously described a scroll-snap carousel with a `w-14` vertical
thumb rail, `aspect-[3/4]` frames and a `#C5A880` active border. None of those
values exists in the file. The carousel was deleted rather than fixed: a
horizontal scroll container claims the touch gesture before `touch-action` is
consulted, so a finger resting on the photo — most of the target on a phone —
could not scroll the page. The component's own header comment records that
reasoning.

---

## 8. Known inconsistencies

Current observations, not a second backlog. Any item selected for implementation must first receive its own requirement/task in the canonical ledgers.

**8.1 Two headless UI libraries ship side by side.** `radix-ui` and `@base-ui/react` are both runtime dependencies and current admin primitives import both. The former zero-import `popover.tsx` was removed; choosing whether to converge libraries requires a measured bundle/behaviour migration, not a speculative rewrite.

**8.2 Two parallel colour systems remain, not three.** The storefront neutrals
(§1.1) and Tailwind **slate**, the latter in `src/lib/ui-variants.ts` —
`secondary`, `dark`, `ghost` and the `listItemVariants` values — and in `src/pages/thanks.astro` and `src/pages/payment.astro`. Those
two are customer-facing pages that adopted the v1 square shape rule but never the
storefront palette; they have not been moved to the v2 direction (§3) yet.

The emerald system this entry used to describe has left the public surface
entirely: `emerald-*` now appears **zero** times in `payment.astro` and
`thanks.astro`, and survives only on admin screens (`admin/check.astro`,
`admin/ads/google.astro`, `admin/ads/meta.astro`,
`admin/settings/developer.astro`), where it is operator chrome rather than
storefront design.

**8.3 The literal `#047857` appears nowhere under `src/`** — 0 occurrences. Emerald reaches the page only through Tailwind utility classes, so any doc quoting that hex as the brand colour is describing a value the build never emits.

**8.4 — RESOLVED 2026-08-16.** The two checkouts diverged: `GeoIpResolvedForm.astro`'s `[data-canonical-order-form]` overrides were the boutique palette, while `/hybrid-form` bypassed that wrapper and rendered raw `form-hybrid.css` — green float labels, green focus ring, orange gradient submit. Resolved by deleting the override layer and folding the boutique palette into `form-hybrid.css` itself: `data-canonical-order-form` now appears in the build only as a DOM attribute, in zero CSS rules, and the seven checkout routes resolve to one palette.

**8.5 — RESOLVED 2026-08-16.** The checkout is styled by override, not by token. Layer 2 is 110 lines of `:global()` selectors re-stating layer 1 with `!important` in seven places. Any edit to `form-hybrid.css` colour must be checked against `GeoIpResolvedForm.astro` or it silently has no effect.

**8.6 — RESOLVED 2026-08-16.** `form-hybrid.css` is imported six times. Globally at `global.css:4` — which already puts it on every page including admin — plus redundantly at `full-form.astro:8`, `geoipform.astro:8`, `middle-form.astro:8`, `hybrid-form.astro:14`, `embed/form.astro:7`. The five page-level imports are no-ops; the global import means 22KB of checkout CSS ships with the admin dashboard.

**8.7 — RESOLVED.** Plus Jakarta Sans was loaded and never used. The imports were removed; `EmbedLayout` now intentionally inherits Inter from `foundation.css`, through `storefront.css`.

**8.8 — RESOLVED 2026-08-20.** Inter ships 400/600/700 and the public surface
wrote five weights. Measured in the browser rather than reasoned about: at 32 px
the string renders 323.02 px at both 400 and 500, and 327.33 px at 700, 800 and
900 — so `font-medium` was `font-normal` and `font-extrabold`/`font-black` were
`font-bold`. 72 occurrences were rewritten to what they actually render as, and
full-page screenshots of the home and catalogue pages are pixel-identical before
and after. The public ramp is 400 / 600 / 700 and nothing else.

**8.9 Breadcrumb re-derives the width branch.** `Breadcrumb.astro:20` reads `Astro.locals.tenant.storefrontTemplate` directly instead of accepting the `contentWidth` its host layout already resolved (`BaseLayout.astro:51`). A page overriding `contentWidth` gets a breadcrumb of the other width.

**8.10 — RESOLVED.** The resolved `themeColor` default is `#111111`, the storefront ebony, and it is emitted as `<meta name="theme-color">`. This entry previously reported a `#0F172A` default at a line number and under a symbol name that no longer exist; it was a defect report for a bug that had already been fixed.

**8.11 — RESOLVED 2026-08-18.** `.admin-shell` and the admin login stage are isolated in `src/styles/admin.css`, loaded only by `AdminLayout` and `/hello`; storefront requests receive `storefront.css` instead. Checkout remains route-owned in `form-hybrid.css`.

**8.12 — RESOLVED.** `wide-catalog` was retired under ADR-018 rather than
reconciled, which settles the entry: two unrelated designs became one. See
§1.2.

---

## 9. Verification

The commands CI runs, in order (`ARCHITECTURE.md` §9):

```bash
npm test          # node --test over src/lib/*.test.ts
npm run check     # astro check && tsc --noEmit
npm run build     # astro build
```

There is no screenshot-diff suite. `mobile-layout-guard.test.ts` prevents a known class of clipped implicit-grid regressions, but browser-visible work still requires a real browser check of interaction, focus, console, and horizontal overflow. Moving gate counts belong in `STATUS.md` / `BUILD-LOG.md`, not this design reference.
