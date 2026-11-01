import { z } from "zod";
import type { Product } from "../data/products";
import type { CatalogProductRow } from "./catalog-data.ts";

const shortText = z.string().trim().min(1).max(160);
const bodyText = z.string().trim().min(1).max(1_200);
const asset = z.string().trim().min(1).max(500);
const textList = z.array(shortText).min(1).max(12);
// Rendered as `<a href>` on the storefront, whose origin is also the admin's.
// Any role that can publish content could otherwise store `javascript:…` and
// run it in whoever clicks — an owner included. Same-site paths, in-page
// anchors and web URLs only.
const link = asset.refine((value) => /^(?:https?:\/\/|\/(?![/\\])|#)/i.test(value), {
  message: "Link harus berupa path (/...), anchor (#...), atau URL http(s).",
});

const sectionHeadingSchema = z
  .object({
    // Accepted so stored content still parses; compact v2 renders no eyebrow
    // and the AI shape no longer asks for one.
    eyebrow: shortText,
    title: shortText,
    description: bodyText,
  })
  .strict();

export const homeContentSchema = z
  .object({
    hero: z
      .object({
        title: shortText,
        description: bodyText,
        ratingLabel: shortText,
      })
      .strict(),
    catalog: sectionHeadingSchema,
    solutionsHeading: sectionHeadingSchema,
    proofsHeading: sectionHeadingSchema,
    heroHighlights: z
      .array(z.object({ label: shortText, icon: shortText }).strict())
      .min(1)
      .max(8),
    heroSlides: z
      .array(
        z
          .object({
            image: asset,
            alt: shortText,
            badge: shortText,
            text: bodyText,
          })
          .strict(),
      )
      // Optional on purpose. An operator who has not made hero art gets the
      // catalogue instead - CompactMarketHome borrows product photos and
      // rotates them daily. Requiring a slide here made that fallback
      // unreachable for any store whose content was published at all.
      .min(0)
      .max(10),
    solutions: z
      .array(
        z
          .object({
            title: shortText,
            excerpt: bodyText,
            image: asset,
            href: link.optional(),
            crop: shortText.optional(),
          })
          .strict(),
      )
      // A store with no landing pages is a valid store. This used to demand one,
      // which is why a fresh install could not hold valid home content at all and
      // had to be walked through a setup screen first.
      .min(0)
      .max(12),
    proofs: z
      .array(
        z
          .object({
            name: shortText,
            location: shortText,
            story: bodyText,
            image: asset,
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

const reviewSchema = z
  .object({
    name: shortText,
    location: shortText,
    avatar: asset,
    verified: z.boolean(),
    date: shortText,
    comment: bodyText,
    rating: z.number().int().min(1).max(5),
  })
  .strict();

export const productContentSchema = z
  .object({
    contentName: shortText,
    headline: shortText,
    subheadline: bodyText,
    seoTitle: shortText,
    seoDescription: z.string().trim().min(1).max(320),
    image: asset,
    heroImage: asset,
    tag: shortText,
    relatedCategories: textList,
    relatedTags: z.array(shortText).max(20).optional(),
    description: bodyText,
    benefits: textList,
    keyPoints: textList,
    idealFor: textList,
    offerText: shortText,
    ctaText: shortText,
    ratingValue: z.number().min(0).max(5).optional(),
    reviewCount: z.number().int().min(0).optional(),
    soldCount: z.number().int().min(0).optional(),
    reviews: z.array(reviewSchema).max(30),
  })
  .strict();

export type HomeContent = z.infer<typeof homeContentSchema>;
export type ProductContent = z.infer<typeof productContentSchema>;
export type ContentKey =
  | { key: "home"; type: "home" }
  | { key: `product:${string}`; type: "product"; productId: string };

export function parseContentKey(value: unknown): ContentKey {
  if (value === "home") return { key: "home", type: "home" };
  if (typeof value !== "string" || !/^product:[1-9]\d{0,9}$/.test(value)) {
    throw new Error("Content key must be home or product:<D1ProductId>.");
  }
  return {
    key: value as `product:${string}`,
    type: "product",
    productId: value.slice("product:".length),
  };
}

function containsMarkup(value: unknown): boolean {
  if (typeof value === "string") return /<\/?[a-z][^>]*>/i.test(value);
  if (Array.isArray(value)) return value.some(containsMarkup);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsMarkup);
  }
  return false;
}

export function validateContent(
  keyValue: unknown,
  value: unknown,
): HomeContent | ProductContent {
  const key = parseContentKey(keyValue);
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 65_536)
    throw new Error("Content JSON exceeds 64 KiB.");
  if (containsMarkup(value))
    throw new Error("Raw HTML is not allowed in storefront content.");
  return key.type === "home"
    ? homeContentSchema.parse(value)
    : productContentSchema.parse(value);
}

/**
 * A validation failure in operator words: which fields, not the schema's
 * issue array, which the content screen used to print verbatim as JSON
 * (audit 2026-10-31 M6). Null when the error is not a validation failure.
 */
export function contentValidationMessage(error: unknown): string | null {
  if (!(error instanceof z.ZodError)) return null;
  const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "konten"))];
  const shown = fields.slice(0, 5).join(", ");
  return `Konten belum lengkap atau tidak valid: ${shown}${fields.length > 5 ? `, +${fields.length - 5} lainnya` : ""}.`;
}

export function parsePublishedContent(
  keyValue: string,
  json: string | null | undefined,
) {
  if (!json) return null;
  try {
    return validateContent(keyValue, JSON.parse(json));
  } catch (error) {
    console.error("storefront-content-invalid", keyValue, error);
    return null;
  }
}

export type PublishedHomeContentRead =
  | { state: "published"; content: HomeContent }
  | { state: "unpublished" }
  | { state: "unavailable" };

export async function loadPublishedHomeContent(
  database: D1Database,
): Promise<PublishedHomeContentRead> {
  try {
    const row = await database
      .prepare(
        "SELECT published_json FROM storefront_content WHERE content_key = 'home' LIMIT 1",
      )
      .first<{ published_json: string | null }>();
    if (!row?.published_json) return { state: "unpublished" };
    try {
      return {
        state: "published",
        content: validateContent(
          "home",
          JSON.parse(row.published_json),
        ) as HomeContent,
      };
    } catch (error) {
      console.error("storefront-home-content-invalid", error);
      return { state: "unavailable" };
    }
  } catch (error) {
    console.error("storefront-home-content-load", error);
    return { state: "unavailable" };
  }
}

export async function loadPublishedProductContent(database: D1Database) {
  const records = new Map<string, ProductContent>();
  try {
    const rows = await database
      .prepare(
        "SELECT content_key, published_json FROM storefront_content WHERE content_type = 'product' AND published_json IS NOT NULL",
      )
      .all<{ content_key: string; published_json: string }>();
    for (const row of rows.results ?? []) {
      const key = parseContentKey(row.content_key);
      if (key.type !== "product") continue;
      const content = parsePublishedContent(
        row.content_key,
        row.published_json,
      );
      if (content) records.set(key.productId, content as ProductContent);
    }
  } catch (error) {
    console.error("storefront-product-content-load", error);
  }
  return records;
}

export function mergeRuntimeProductContent(
  productRows: CatalogProductRow[],
  runtime: Map<string, ProductContent>,
): Product[] {
  return productRows.flatMap((row) => {
    const productId = String(row.id);
    const content = runtime.get(productId);
    if (!content) return [];
    return [
      {
        ...content,
        price: 0,
        comparePrice: 0,
        variants: [],
        slug: row.slug,
        productId,
        productName: row.title,
        category: row.category || "Umum",
      },
    ];
  });
}
