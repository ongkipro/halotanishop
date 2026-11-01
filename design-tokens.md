---
name: adsbookcms-storefront
description: Neutral ink on white, soft radius, one 480px column (compact-market v2, 2026-10-31)
theme: { default: light, dark: out-of-scope,
         white-temperature: neutral,
         why: "The public surface is black and white so a landing page or a
               custom product page can introduce its own colour without
               fighting a house accent." }
colors:
  ink:            "#111111"   # primary text, solid buttons, inverse surfaces
  ink-secondary:  "#555555"   # body copy, 7.4:1 on white
  ink-muted:      "#767676"   # captions, 4.6:1 on white - the floor
  canvas:         "#F3F3F3"   # page behind the column, soft surfaces, section bands
  surface:        "#FFFFFF"   # the 480px reading column, cards
  raised:         "#F3F3F3"   # media wells, search well, notes, review cards
  border:         "#EDEDED"   # the only hairline: sticky header and buy bar
  outline:        "#E5E5E5"   # pill controls at rest
  accent:         "#121212"   # the buy action (ink, Shopify theme), = --sf-accent
  sale:           "#334FB4"   # discount pill only; #D92D20 is checkout errors
  on-ink:         "#FFFFFF"   # text on ink
  focus:          "#2563EB"   # focus ring only - see accessibility notes
typography: { display: "Inter 700", body: "Inter 400", emphasis: "Inter 600" }
spacing: { base: 4px }
radius: { md: 6px, xl: 12px, 2xl: 16px, full: 9999px }   # DESIGN-SYSTEM §3
shadows: { buy-bar: "0 -8px 24px rgba(17,17,17,0.08)" }   # the only one
motion: { duration-base: 200ms, easing: ease-out }
---

> Verified against disk: 2026-10-31 @ `1b10ce1` + feat/storefront-shopify-color (frontmatter values; subordinate to DESIGN-SYSTEM.md)

## Rationale

The storefront was warm neutrals plus a gold accent. That reads as a brand, and
this is not a brand — it is a CMS that installs for any merchant, and the store
that renders it has its own. A monochrome public surface stays out of the way:
a landing page can bring one colour and own it completely, and a custom product
page can do the same without arguing with a house gold that appears in twelve
badge backgrounds.

Neutral rather than warm or cool on purpose. A temperature is a brand decision,
and this palette is deliberately declining to make one on the merchant's behalf.
Three neutral steps carry the hierarchy — canvas behind the column, white
surface, and a light well for media — so depth comes from the neutrals rather
than from shadows sprinkled on flat white.

Square corners and hairlines were the v1 rule and read as rigid on a phone.
Since 2026-10-31 shape is a soft radius and separation is surface and
whitespace, not lines; DESIGN-SYSTEM.md §3 owns the rule and its reasons.

## Accessibility notes

- `ink-muted` `#767676` is 4.6:1 on `#FFFFFF` — the floor for body copy. Do not
  lighten it. `#999999`, which the tree used, is 2.8:1 and fails.
- The focus ring stays blue. It is the one colour left, and it is deliberate:
  monochrome cannot express focus against a monochrome page, and a 3:1
  non-text contrast minimum applies to focus indicators.
- Ink on white is 18.1:1; `ink-secondary` on white is 7.4:1.
- Nothing conveys state by colour alone — sold out, selected and error all
  carry a text or weight change as well.
