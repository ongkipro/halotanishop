# Google Ads Conversion Signal & Merchant Center Setup Guide

> Verified against disk: 2026-10-31 @ `83534ef` + feat/payment-copy-ux working tree

> **Product:** AdsBookCMS (single) — one installer, one Worker, one store.
> **Repository role:** product. Examples below name `permatamall.shop`, the first install, which lives in its own repository (`ongkipro/permatamall`); substitute your own install's domain.
> **Engine stack:** Astro SSR + Cloudflare Workers + Google Tag (`gtag.js`) + GTM + Enhanced Conversions + Consent Mode v2 + Merchant Center XML feed.

Deeper technical contract: [`../TRACKING_SPECS.md`](../TRACKING_SPECS.md). System architecture and gap register: [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Decisions: [`../DECISIONS.md`](../DECISIONS.md).

**Convention used below:** text in **bold** that you must literally find in the Google Ads or Merchant Center interface is marked as a *UI label* and left exactly as Google renders it. Everything else is English instructional prose.

---

## 1. Signal Architecture Overview

The conversion signal path, in order:

$$\text{Ad click (gclid, gbraid, wbraid)} \longrightarrow \text{Consent Mode v2 + Conversion Linker} \longrightarrow \text{Enhanced Conversions} \longrightarrow \text{Google Ads / Merchant Center feed}$$

```text
┌──────────────────────┐    ┌──────────────────────┐    ┌────────────────────────────┐
│  Landing Page Click  │───>│  Click-ID Storage    │───>│  Consent Mode v2 Matrix    │
│ (gclid/gbraid/wbraid)│    │ (adsbook_click_ids)  │    │ (32 EEA/UK/CH: denied      │
│                      │    │  90-day cookie       │    │  everywhere else: granted) │
└──────────────────────┘    └──────────────────────┘    └────────────────────────────┘
                                                                       │
                                                                       ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌────────────────────────────┐
│ Merchant Center Feed │    │ Enhanced Conversions │    │  Conversion Deduplication  │
│ /feed/google-catalog │    │ (SHA-256 phone/name) │    │ (transaction_id: INV-N)    │
└──────────────────────┘    └──────────────────────┘    └────────────────────────────┘
```

---

## 2. Step-by-Step Setup

### Step 1 — Create the purchase conversion action

1. Open Google Ads (`https://ads.google.com`).
2. Go to *UI label* **Goals** → **Conversions** → **Summary**.
3. Click *UI label* **+ New conversion action**, then select *UI label* **Website**.
4. Enter your store domain (for the reference instance, `https://permatamall.shop`) and click *UI label* **Scan**.
5. Scroll to *UI label* **Add a conversion action manually** and configure:
   - **Goal category** — select *UI label* **Purchase**.
   - **Conversion name** — use a name that identifies your own store and the surface, for example `<Your Store> Purchase - Website`. Do not copy a name from another merchant's account; it becomes the reporting label you will read for the life of the account.
   - **Value** — select *UI label* **Use different values for each conversion**. Set a default value matching a typical order and default currency `IDR`.
   - **Count** — select *UI label* **Every**. Every purchase is counted, which is the correct setting for ecommerce transactions.
   - **Click-through conversion window** — `30 days`.
   - **Attribution model** — `Data-driven`. This is Google's own recommended default.
6. Click *UI label* **Done**, then *UI label* **Save and continue**.
7. Record the **conversion ID** (format `AW-123456789`) and **conversion label** (format `AbCd_EFGHIJKlm`).
8. Enter both in the store admin under Ads & Tracking → Google. They are stored in D1 and take effect on the next request without a rebuild. The Google tag renders **only when both are present**; either one alone renders nothing.

### Step 2 — Enable Enhanced Conversions for Web

1. On the conversion action detail page, expand *UI label* **Enhanced conversions**.
2. Check *UI label* **Turn on enhanced conversions**.
3. Choose the implementation owner for this conversion action. **Use the
   Google tag unless a reason below rules it out**:
   - **Google tag (recommended)** — enter the conversion ID and label in Ads &
     Tracking → Google. AdsBookCMS emits the direct `gtag('event', 'conversion', …)`.
   - **Google Tag Manager** — configure the conversion tag in GTM from the
     `purchase` dataLayer event, and leave the direct conversion ID/label empty.
     GTM may still run GA4 alongside the direct Google tag, but the same Google
     Ads conversion action must never fire through both paths.
4. The storefront sends real available first-party data client-side before the
   verified Purchase event:
   - `sha256_phone_number` — the phone normalized to E.164 **including the leading `+`** (for example `+6281234567890`), then SHA-256 hashed. Note that the Meta leg hashes the same number **without** the `+`; the two hashes are deliberately different and must not be shared.
   - `sha256_first_name` — first whitespace-delimited token of the name, trimmed, SHA-256 hashed.
   - `sha256_last_name` — remaining name tokens joined by a space, trimmed, SHA-256 hashed.
   - Email is **not** currently included in the browser Enhanced Conversions payload; a synthetic payment-provider email must never be substituted.
5. Confirm the Google-tag enhanced-conversion method and customer-data terms are enabled in the Google Ads account. A correctly shaped browser payload is otherwise not processed.
6. Click *UI label* **Save**.

### Step 3 — Configure the GTM container (optional)

If using Google Tag Manager (`GTM-XXXXXXX`), configure it in the store admin under Ads & Tracking → Google. GTM is validated and loaded independently of the direct Google Ads conversion pair.

Choose one conversion owner. The direct Google tag is the default because the
store already does what a GTM conversion tag would have to rebuild:

- the conversion fires only after `/api/order-status` confirms the order (COD
  persisted, prepaid paid), never for an abandoned lead;
- `transaction_id` is the order number, and a thanks-page reload never fires a
  second conversion;
- Enhanced Conversions `user_data` is set ahead of the conversion. The store's
  dataLayer events carry no customer data (TRACKING_SPECS §14), so a GTM-owned
  conversion has **no** enhanced-conversion match keys;
- Consent Mode v2 defaults and the forced library load on the thanks page.

Pick GTM as the owner only when the account requires every tag in one container.

- **Direct Google Tag configured (recommended):** use GTM for GA4, audiences
  and other platforms only. Do **not** add a Google Tag or a Google Ads
  Conversion Tracking tag for the same `AW-` ID — the store already loads it,
  and a second copy double-counts the conversion. Do not add a Meta Pixel tag
  either; the store owns Pixel and CAPI.
- **GTM conversion owner:** leave the direct Google Ads conversion ID and label
  empty, then configure the following GTM tags.

In the GTM workspace (GTM conversion owner only):

- **Tag 1 — Conversion Linker**
  - Tag type: *UI label* **Conversion Linker**
  - Trigger: *UI label* **All Pages**
- **Tag 2 — Google Tag**
  - Tag type: *UI label* **Google Tag**
  - Tag ID: your `AW-` conversion ID
  - Trigger: *UI label* **Initialization - All Pages**
- **Tag 3 — Google Ads Conversion Tracking**
  - Conversion ID: your `AW-` ID, or a variable such as `{{Google Ads ID}}`
  - Conversion label: your label, or a variable such as `{{Google Ads Label}}`
  - Value: Data Layer Variable `ecommerce.value`
  - Currency code: Data Layer Variable `ecommerce.currency` (always `IDR`)
  - Transaction ID: Data Layer Variable `ecommerce.transaction_id`
  - Trigger: custom event `purchase`

The storefront pushes `page_view`, `view_item`, `add_to_cart`,
`begin_checkout`, and `purchase` to `window.dataLayer`. Every event except
`page_view` carries the GA4 ecommerce object: `ecommerce.value`,
`ecommerce.currency`, `ecommerce.transaction_id` (on `purchase`) and one item
with the catalogue `item_id`, `item_variant`, a unit `price` and `quantity`
(TRACKING_SPECS owns the shape). `page_view` carries no `ecommerce` object, so
a GA4 tag must not map it as an ecommerce event. `meta_event_id` is the same id
the Meta legs deduplicate on. For GA4, trigger the Google tag on
*Initialization - All Pages* and one GA4 event tag per custom event with
*UI label* **Send Ecommerce data** from the Data Layer.

### Step 4 — Submit the Merchant Center catalog feed

1. Open Google Merchant Center (`https://merchants.google.com`).
2. Go to *UI label* **Products** → **Feeds**, then click *UI label* **+ Primary feed**.
3. Target country: **Indonesia**. Language: **Indonesian**.
4. Select *UI label* **Scheduled fetch**.
5. Name the feed after your own store.
6. Feed URL: `https://<your-domain>/feed/google-catalog.xml` (served by `src/pages/feed/google-catalog.xml.ts`). A Meta catalog feed is served in parallel at `/feed/meta-catalog.xml`.
7. Fetch frequency: **Daily**.

#### What each item carries, and where it comes from

| Attribute | Source |
| --- | --- |
| `g:id` | Product ID (`catalogProductIdOrNull`; a row before the five-digit scheme is left out, not guessed) |
| `g:price` / `g:sale_price` | The **cheapest** variant: `compare_price` as `price` and the variant price as `sale_price` when it is higher, otherwise the variant price alone. The same "from" price the product page and the cards show, so Merchant Center finds no price mismatch |
| `g:description` | **Deskripsi produk** from the admin product form, then landing copy, then a sentence built from the product's own name, brand, category and variant names |
| `g:brand` | **Merek** from the admin product form; the store name when empty |
| `g:google_product_category` | **Kategori Google** picked in the admin product form from Google's own taxonomy, sent as its id. With none, the taxonomy engine below guesses |
| `g:product_type` | The chosen Google category's path; otherwise the engine's `Umum > <category>` style path |
| `fb_product_category` (Meta feed) | Only the engine's guess, and only for a product without a chosen Google category: Meta asks for one of the two category fields, not both |

Fill **Kategori Google**, **Merek** and **Deskripsi produk** for every product before
submitting the feed: without them every item reads "Umum", carries the store's
name as its brand, and describes itself from its title.

#### Shipping and returns are account settings

The feed emits no `g:shipping` and no return policy: rates depend on the buyer's
district and the courier, which the feed cannot state per item. Set them in
Merchant Center under *UI label* **Settings → Shipping and returns** before
free listings or Shopping ads go live; an account without them gets item
warnings for missing shipping.

#### The taxonomy list

`public/data/google-product-taxonomy.json` is Google's
`taxonomy-with-ids.en-US.txt`, converted by `scripts/generate-google-taxonomy.mjs`
(version recorded in the file; 5,595 categories at 2021-09-21). Google
publishes it with ids in US English only; the admin picker accepts Indonesian
shop words through an alias list in `src/lib/google-taxonomy.ts`, and an id
typed directly. It is a static asset rather than a D1 table: identical for every
install, and seeding it would cost every install thousands of writes. Rerun the
script when Google releases a new version.

#### Automatic taxonomy engine (fallback)

`src/lib/ad-taxonomy.ts` derives the Google Product Category (GPC) id and path, the Meta product category path, and an internal product-type path from the product's category, title, and description — no manual mapping by the merchant.

Matching is confidence-gated and deterministic. Keywords match whole words. A hit in category/title is weighted three times above a description hit; description contribution is capped; a rule must reach `MIN_SCORE` and be the sole top scorer. A tie or under-confidence emits no category rather than guessing. The generic bag rule (`6551`) is a fallback: it is scored only when no specific rule matches, so "waist bag" is not tied by its own "bag".

**`TAXONOMY_RULES` is the table.** It is not repeated here, because the previous copy carried ids that named other products: skin care was `2547` (Placemats), herbal supplements `642` (Bread Pans), gardening `2849` (a laundry combo unit), and `2863` and `1630` do not exist. `/admin/ads/google` renders the live table from the same constant. Every id and path is copied from the official files:

- Google: `https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt` (version 2021-09-21);
- Meta: `https://www.facebook.com/products/categories/en_US.txt` — Meta's own taxonomy, sent as `fb_product_category`. It used to receive Google's paths, which Meta does not recognise.

A side with no faithful match is omitted (laptop bags have no Google category; supplements and badge holders have no Meta one). Both fields are optional and the platforms classify what is missing.

When nothing matches confidently, the feed omits both category fields and the product type becomes `Umum > <category>`.

#### Known gap — the rule set is compiled in

Rules cover leather goods and bags (wallets, card and ID holders, belts, sling, waist, backpack, tote, laptop, leather care), agriculture, skincare, soap, supplements, clothing, kitchen tools and electronics. A merchant outside those still gets no category, and cannot tell the engine what they sell. Before submitting a feed to Merchant Center, audit the id emitted for each live SKU. The durable fix — a store-configurable rule set — is not implemented.

### Step 5 — Verify live signals

1. Install the *UI label* **Google Tag Assistant Companion** browser extension.
2. Open the storefront in Tag Assistant debug mode.
3. Confirm **both** Consent Mode default calls appear, in this order: the region-scoped `denied` default, then the unscoped `granted` default (see §3).
4. Perform a test purchase.
5. Verify the `conversion` event payload. Note the `transaction_id` format — `INV-` plus the order sequence, never `ORD-`:

   ```json
   {
     "send_to": "AW-123456789/AbCd_EFGHIJKlm",
     "value": 249000,
     "currency": "IDR",
     "transaction_id": "INV-10042",
     "user_data": {
       "sha256_phone_number": "<sha256 of +62… including the plus>",
       "sha256_first_name": "<sha256 of first name>",
       "sha256_last_name": "<sha256 of last name>"
     }
   }
   ```

6. Reload `/thanks` and confirm no second conversion fires.

---

## 3. Core Contract & Consent Rules

| Parameter | Value / behavior |
| --- | --- |
| **Consent default — 32 listed regions** | `ad_storage: denied`, `ad_user_data: denied`, `ad_personalization: denied`, `analytics_storage: denied`, with `wait_for_update: 500` |
| **Consent default — everywhere else** | `ad_storage: granted`, `ad_user_data: granted`, `ad_personalization: granted`, `analytics_storage: granted` |
| **Deduplication key** | `transaction_id`, set to the backend order number (`INV-<n>` from `order_number_counters`). Prevents count spikes from a reloaded thank-you page. Omitted entirely when no order number exists, because an empty string would make every order collide instead of dedupe. |
| **Click-ID storage** | `gclid`, `gbraid`, `wbraid` captured in middleware from the landing URL into the `adsbook_click_ids` first-party cookie (legacy `zanoby_click_ids` is read only), `Max-Age` 90 days, `SameSite=None; Secure` on HTTPS. Persisted to `orders.ad_click_ids` at checkout. |
| **Conversion value** | Item price × quantity, in IDR. COD qualifies on persisted order success; prepaid qualifies only after authenticated `is_paid: true` reconciliation. |

### The Consent Mode region list

`src/components/storefront/tracking/GoogleAdsBase.astro` issues the region-scoped `denied` default **first**, then the unscoped `granted` default. Google applies the most specific matching rule, so visitors in the listed regions are denied and everyone else is granted.

The list holds **32** ISO codes — the 27 EU member states plus Iceland, Liechtenstein, and Norway (completing the EEA), plus the United Kingdom and Switzerland:

`AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IS, IE, IT, LV, LI, LT, LU, MT, NL, NO, PL, PT, RO, SK, SI, ES, SE, GB, CH`

The rationale recorded in the source: the consent requirement is EEA/UK law, this storefront sells to Indonesia and ships no consent management platform, and a global `denied` default would destroy the store's own conversion signal to satisfy a rule that does not govern its traffic.

**Two consequences you must accept before advertising into those regions.** No consent management platform exists in this repository, so nothing ever calls `gtag('consent', 'update', …)`; the 500 ms `wait_for_update` window expires unanswered and visitors from the 32 listed regions stay denied for the entire session. If the store ever targets the EEA or UK, install a real CMP and wire the `update` call first — otherwise that traffic cannot be measured at all. The region list is compiled into the component and is not configurable per store.

### Click-ID cookie naming and the legacy read fallback

The cookie is `adsbook_click_ids`, defined as `CLICK_ID_COOKIE` in `src/lib/click-ids.ts`. It was renamed from `zanoby_click_ids` — a brand carried over from an earlier deployment — on 2026-08-16.

The rename shipped **with** a read fallback rather than as a find-and-replace, because a bare rename would have silently dropped attribution mid-funnel for every visitor who clicked an ad in the previous 90 days:

- `readClickIdCookie()` matches `adsbook_click_ids` first and falls back to `zanoby_click_ids` only when the current cookie is absent;
- nothing writes the legacy name, so it expires naturally and the fallback can be deleted once 90 days have passed since deploy;
- the `sessionStorage` key in `src/lib/checkout-navigation.ts` needed no fallback — its writer and reader ship in the same page load and cannot straddle a deploy.

The embed `postMessage` prefix moved from `cmsads:` to `adsbook:` in the same change. That one **is** breaking for already-published embeds; see `TRACKING_SPECS.md` §8.

---

## 4. Verification Commands

```bash
npm test
npm run check
npm run build
```

A green build proves neither Google acceptance, Merchant Center feed health, attribution, nor campaign performance. Record observed browser evidence and any live-platform results separately, in `STATUS.md` and `BUILD-LOG.md`.
