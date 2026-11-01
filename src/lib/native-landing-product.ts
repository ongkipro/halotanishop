/**
 * Product JSON-LD for a native Astro landing page.
 *
 * A native page is a hand-written route file per install, so none of them
 * built a Product block (audit 2026-11-02: zvara.shop and taniniaga.shop sent
 * Google only Organization and WebSite from the pages that sell). BaseLayout
 * calls this for any request whose path is a registered native slug, so the
 * pages stay untouched and a new one gets the block with its register entry.
 */
import type { NativeLandingPage } from "../data/native-landing-pages.ts";
import type { ProductJsonLdInput } from "./json-ld.ts";
import { activeNativeLandingPages } from "./native-landing-pages.ts";

type ProductLike = {
  productName: string;
  description?: string;
  seoDescription?: string;
  heroImage: string;
  productId: string;
  category?: string;
  brand?: string;
  variants: readonly { price: number; label: string; sku?: string }[];
};

/** The register entry whose public path is `pathname`, or undefined. */
export function nativeLandingEntryForPath(
  pathname: string,
  entries?: readonly NativeLandingPage[],
): NativeLandingPage | undefined {
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  if (!slug || slug.includes("/")) return undefined;
  return activeNativeLandingPages(entries).find((entry) => entry.slug === slug);
}

export function nativeLandingProductJsonLd(product: ProductLike, url: string): ProductJsonLdInput {
  return {
    name: product.productName,
    description: product.description || product.seoDescription || product.productName,
    image: product.heroImage,
    url,
    sku: product.productId,
    ...(product.category ? { category: product.category } : {}),
    ...(product.brand ? { brand: product.brand } : {}),
    offers: product.variants.map((variant) => ({
      price: variant.price,
      availability: "InStock",
      name: variant.label,
      ...(variant.sku ? { sku: variant.sku } : {}),
    })),
  };
}
