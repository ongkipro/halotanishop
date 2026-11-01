import { getAdTaxonomy } from "./ad-taxonomy.ts";

export type CatalogProductVariant = {
  id: number | string;
  label: string;
  price: number;
  comparePrice?: number;
  sku?: string;
};

export type CatalogProduct = {
  productId: number | string;
  catalogId?: number | string;
  slug: string;
  productName: string;
  category?: string;
  /** The product's own brand. Falls back to the store name when absent. */
  brand?: string;
  headline?: string;
  description?: string;
  /** `products.description` as the merchant wrote it; preferred for the feed. */
  catalogDescription?: string;
  googleCategoryId?: number;
  googleCategoryPath?: string;
  seoDescription?: string;
  heroImage: string;
  variants: CatalogProductVariant[];
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The catalog identity scheme, and the one rule that governs everything here:
 * the `id` a feed publishes must be **exactly** the string the Pixel and CAPI
 * send as `content_ids`, or Advantage+ and Dynamic Product Ads have nothing to
 * match and catalog retargeting is silently dead.
 *
 * It was dead. The feed published `10001`, derived by adding 10000 to the row
 * id; the admin screen showed the operator that same `10001`; and the Pixel
 * sent the raw row id, `1`. Three values for one product.
 *
 * AdsBookCMS uses one catalog item per product. The immutable D1 Product ID is
 * generated as a five-digit number, so product_id, content_id and feed <g:id>
 * are the same value. Variants remain checkout choices and do not create
 * separate catalog identities.
 *
 * - **Stable forever.** Google: "Once you've assigned an ID to a product, don't
 *   change it", and never reuse it, even for a deleted product. That rules out
 *   SKU as the basis, despite both platforms recommending it — `sku` here is
 *   nullable and merchant-editable, so it is exactly the thing that changes.
 *   Product IDs are allocated once and never edited.
 * - **Unambiguous in transit.** Decimal, no leading zero, minimum five digits.
 *   Legacy short IDs fail closed instead of being padded into a value that is
 *   no longer the real Product ID.
 */

/** Canonical ads identity: the immutable numeric D1 Product ID. */
export function catalogProductId(productId: number | string): string {
  const value = String(productId).trim();
  if (!/^[1-9]\d{4,15}$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new RangeError("Product ID katalog harus berupa angka minimal 5 digit.");
  }
  return value;
}

/**
 * The catalogue id, or null when this row cannot have one.
 *
 * `catalogProductId` fails closed on purpose — an ads payload must never carry
 * a padded or guessed identity. A *display* path has no such duty, and one
 * short id (an import, a hand-inserted row, a legacy migration) throwing
 * inside a React render blanks the entire admin product page. Screens read
 * through this; ads keep reading the strict function.
 */
export function catalogProductIdOrNull(productId: number | string): string | null {
  try {
    return catalogProductId(productId);
  } catch {
    return null;
  }
}

/**
 * The content id for a page where no variant has been chosen yet — a product
 * detail page or a landing page. The feed is product-level and priced at the
 * cheapest variant, the same "from" price the storefront shows.
 *
 * Returns `undefined` rather than a guess when the product has no variants.
 * A `content_ids` that matches nothing in the catalog is worse than none: it
 * reports a match rate that is real to Meta and meaningless to the merchant.
 */
export function defaultCatalogContentId(product: {
  productId: number | string;
  variants?: readonly { id: number | string }[];
}): string | undefined {
  const first = product.variants?.[0];
  if (!first) return undefined;
  // Same answer for the same reason when the row predates the five-digit
  // scheme: send no catalog id rather than a guessed one. Throwing here took
  // the whole product page down with a 500 instead, which is a worse trade —
  // the page still sells, it simply cannot be retargeted.
  return catalogProductIdOrNull(product.productId) ?? undefined;
}

/**
 * Meta's catalog accepts only JPEG or PNG for `image_link` ("Images must be in
 * JPEG or PNG format", Marketing API catalog reference), and every admin
 * upload is stored as WebP. A feed therefore names the `.jpg` sibling of an
 * uploaded WebP; the asset route serves that sibling when it exists and the
 * WebP otherwise, so a store with no JPEG copies is served exactly what it was
 * before. Google accepts either.
 */
const UPLOADED_WEBP = /^(\/assets\/uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+)\.webp$/i;

export function feedImagePath(path: string): string {
  return path.replace(UPLOADED_WEBP, "$1.jpg");
}

/**
 * The two feeds, which are one feed.
 *
 * Google and Meta differ in exactly three places — the channel title, whether
 * `fb_product_category` is emitted, and whether GTIN-substitute identity is —
 * and everything else was copied. That copy was not free: the fix that stops a
 * legacy row taking a whole catalog down had to be written twice, in step, or
 * one platform would still have been serving a 500 stub. A flavor makes the
 * three differences the only thing either caller states.
 */
type CatalogFeedFlavor = {
  /** Google caps title at 150 and description at 5000; Meta at 200 and 9999.
   *  Over the cap the item is disapproved, not truncated. */
  titleMax: number;
  descriptionMax: number;
  /** Appended to the store name in `<channel><title>`. */
  channelSuffix: string;
  /** Category elements, in the order this platform expects them. */
  categoryXml: (taxonomy: ReturnType<typeof getAdTaxonomy>) => string;
  /** Product-identity elements. Google wants them; Meta infers. */
  identityXml: (variant: CatalogProductVariant) => string;
};

function buildCatalogXml(
  products: CatalogProduct[],
  siteOrigin: string,
  title: string | undefined,
  description: string | undefined,
  flavor: CatalogFeedFlavor,
): string {
  const origin = siteOrigin.replace(/\/$/, "");
  const siteTitle = title || "AdsBookCMS Merchant Store";
  const siteDescription = description || "Solusi Produk Berkualitas";

  let itemsXml = "";

  for (const product of products) {
    if (!product.variants || product.variants.length === 0) continue;

    // A category the merchant chose from Google's taxonomy is sent exactly;
    // the keyword engine is only the fallback for a product without one. Meta
    // takes `google_product_category` or `fb_product_category`, not both, so a
    // chosen id also drops the engine's Meta guess.
    const guessed = getAdTaxonomy(product.category, product.productName, product.description || product.headline);
    const taxonomy = product.googleCategoryId
      ? {
          ...guessed,
          googleCategoryId: product.googleCategoryId,
          metaCategoryName: undefined,
          productType: product.googleCategoryPath || guessed.productType,
        }
      : guessed;
    const productLink = `${origin}/produk/${product.slug}`;
    const heroImage = feedImagePath(product.heroImage);
    const imageLink = heroImage.startsWith("http") ? heroImage : `${origin}${heroImage}`;

    // The cheapest variant: the "from" price the product page and every card
    // already show. `variants[0]` was whichever was entered first, so a product
    // whose large size came first was listed at a price its page never showed
    // — a price mismatch Merchant Center disapproves.
    const variant = product.variants.reduce((low, candidate) => (candidate.price < low.price ? candidate : low));
    // One row that predates the five-digit scheme must not take the catalog
    // down. The strict identity rule still governs what gets published — an
    // unpublishable row is left out — but the feed is an aggregate, and
    // throwing here returned the 500 stub for every other product too, which
    // Merchant Center and Meta Commerce read as the whole catalog failing.
    const itemId = catalogProductIdOrNull(product.productId);
    if (!itemId) continue;
    const titleText = product.productName;
    const hasSale = typeof variant.comparePrice === "number" && variant.comparePrice > variant.price;
    const basePriceFormatted = `${hasSale ? variant.comparePrice : variant.price} IDR`;
    const salePriceXml = hasSale
      ? `\n      <g:sale_price>${escapeXml(`${variant.price} IDR`)}</g:sale_price>`
      : "";
    // The merchant's own description first: it is product facts. The SEO
    // description is a 155-character page summary, and a generated one.
    const itemDescription =
      product.catalogDescription || product.description || product.seoDescription || product.headline || siteDescription;

    itemsXml += `
    <item>
      <g:id>${escapeXml(itemId)}</g:id>
      <g:title>${escapeXml(clampFeedText(titleText, flavor.titleMax))}</g:title>
      <g:description>${escapeXml(clampFeedText(itemDescription, flavor.descriptionMax))}</g:description>
      <g:link>${escapeXml(productLink)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:availability>in_stock</g:availability>
      <g:price>${escapeXml(basePriceFormatted)}</g:price>${salePriceXml}
${flavor.categoryXml(taxonomy)}
      <g:product_type>${escapeXml(taxonomy.productType)}</g:product_type>
      <g:brand>${escapeXml(product.brand?.trim() || siteTitle)}</g:brand>
      <g:condition>new</g:condition>${flavor.identityXml(variant)}
    </item>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(siteTitle)} - ${flavor.channelSuffix}</title>
    <link>${escapeXml(origin)}</link>
    <description>${escapeXml(siteDescription)}</description>${itemsXml}
  </channel>
</rss>`;
}

// Omitted when no taxonomy rule was confident. Both platforms treat the
// category as optional; a wrong one can cause feed disapproval.
const googleCategoryXml = (taxonomy: ReturnType<typeof getAdTaxonomy>) =>
  taxonomy.googleCategoryId
    ? `\n      <g:google_product_category>${taxonomy.googleCategoryId}</g:google_product_category>`
    : "";

/**
 * Platform field limits, and why they are enforced here.
 *
 * Google Merchant Center caps `title` at 150 characters and `description` at
 * 5000; Meta's catalog caps them at 200 and 9999. Exceeding a cap does not
 * truncate the field — it **disapproves the item**, silently, one product at a
 * time, and nothing in this system would show it.
 *
 * `product-mutation.ts` accepts a title of up to 160 characters, so a title of
 * 151-160 saved cleanly, rendered correctly on the storefront, and vanished
 * from Google's approved set. The clamp is here rather than at the admin
 * boundary on purpose: the merchant's own record is not Google's to constrain,
 * and shortening it there would lose data the storefront legitimately shows. A
 * platform's limit belongs where that platform reads, and a shortened title is
 * listed where an over-length one is not listed at all.
 */
export function clampFeedText(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // `lastIndexOf` answers -1 when there is no space at all, and -1 clears any
  // negative threshold — which would silently drop the final character of every
  // unbroken value.
  const useBoundary = lastSpace > 0 && lastSpace > max - 20;
  return (useBoundary ? cut.slice(0, lastSpace) : cut).trimEnd();
}

export function generateGoogleCatalogXml(
  products: CatalogProduct[],
  siteOrigin: string,
  title?: string,
  description?: string,
): string {
  return buildCatalogXml(products, siteOrigin, title, description, {
    channelSuffix: "Google Merchant Catalog",
    titleMax: 150,
    descriptionMax: 5000,
    categoryXml: googleCategoryXml,
    // `identifier_exists: no` alone, and no `g:mpn`.
    //
    // The two together contradict each other: `identifier_exists: no` declares
    // the product carries no manufacturer identifier, while `g:mpn` supplies
    // one. Google reads that pairing as inconsistent, and the `g:mpn` was never
    // truthful anyway — an MPN is assigned by a manufacturer, and `sku` here is
    // nullable, merchant-editable and changes whenever an operator edits it.
    //
    // The previous comment argued the MPN kept Merchant Center from rejecting
    // an item for a missing global identifier. That is exactly the job
    // `identifier_exists: no` already does; the MPN was redundant as well as
    // contradictory, and this schema has no column for a real one.
    identityXml: () => `\n      <g:identifier_exists>no</g:identifier_exists>`,
  });
}

export function generateMetaCatalogXml(
  products: CatalogProduct[],
  siteOrigin: string,
  title?: string,
  description?: string,
): string {
  return buildCatalogXml(products, siteOrigin, title, description, {
    channelSuffix: "Meta Commerce Catalog",
    titleMax: 200,
    descriptionMax: 9999,
    // Meta's own category when the keyword engine guessed one, and Google's id.
    // A merchant-chosen Google id clears the Meta guess upstream: Meta's help
    // centre asks for one of the two fields, not both.
    categoryXml: (taxonomy) =>
      (taxonomy.metaCategoryName
        ? `\n      <g:fb_product_category>${escapeXml(taxonomy.metaCategoryName)}</g:fb_product_category>`
        : "") + googleCategoryXml(taxonomy),
    identityXml: () => "",
  });
}
