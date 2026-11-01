import type { Product } from "../data/products";
import { formatIdr } from "./format-idr.ts";

export interface CatalogProductRow {
  id: number;
  title: string;
  slug: string;
  category?: string | null;
  brand?: string | null;
  description?: string | null;
  google_category_id?: number | null;
  google_category_path?: string | null;
  image_url?: string | null;
  is_active?: number | null;
  created_at?: string | null;
}

export interface CatalogVariantRow {
  id: number;
  product_id: number;
  sku?: string | null;
  title: string;
  price: number;
  compare_price?: number | null;
  stock?: number | null;
}

type PublicationProduct = {
  title?: string | null;
  slug?: string | null;
  image_url?: string | null;
};

type PublicationVariant = {
  title?: string | null;
  price?: number | null;
  stock?: number | null;
};

export function getPublicProductValidationError(
  product: PublicationProduct,
  variants: readonly PublicationVariant[],
): string | null {
  if (!product.title?.trim()) {
    return "Produk aktif wajib memiliki judul.";
  }
  if (!product.slug?.trim()) {
    return "Produk aktif wajib memiliki slug.";
  }
  if (!product.image_url?.trim()) {
    return "Produk aktif wajib memiliki gambar.";
  }
  if (
    !variants.some(
      (variant) =>
        Boolean(variant.title?.trim()) &&
        Number.isSafeInteger(variant.price) &&
        Number(variant.price) > 0,
    )
  ) {
    return "Produk aktif wajib memiliki minimal 1 varian valid dan tersedia.";
  }
  return null;
}

/**
 * A variant is sellable when it has a title and a price. Stock is deliberately
 * not consulted (ADR-023): a zero on the counter used to remove the variant
 * from the storefront entirely, which is how a live product became unbuyable
 * without anyone changing it.
 */
export function mergeStorefrontCatalog(
  productRows: CatalogProductRow[],
  variantRows: CatalogVariantRow[],
  runtimePresentations: Product[] = [],
): Product[] {
  const variantsByProduct = new Map<number, CatalogVariantRow[]>();
  for (const variant of variantRows) {
    if (!Number.isSafeInteger(variant.product_id) || variant.product_id <= 0) {
      continue;
    }
    const existing = variantsByProduct.get(variant.product_id) ?? [];
    existing.push(variant);
    variantsByProduct.set(variant.product_id, existing);
  }

  const presentationsByProductId = new Map<string, Product>();
  for (const presentation of runtimePresentations) {
    presentationsByProductId.set(String(presentation.productId), presentation);
  }

  const catalog: Product[] = [];
  for (const product of productRows) {
    if (
      !product.is_active ||
      !Number.isSafeInteger(product.id) ||
      product.id <= 0
    ) {
      continue;
    }

    const availableVariants = (variantsByProduct.get(product.id) ?? []).filter(
      (variant) =>
        Number.isSafeInteger(variant.id) &&
        variant.id > 0 &&
        Boolean(variant.title?.trim()) &&
        Number.isSafeInteger(variant.price) &&
        variant.price > 0,
    );
    const publicationError = getPublicProductValidationError(
      product,
      availableVariants,
    );
    if (publicationError) continue;

    const productId = String(product.id);
    const productName = product.title.trim();
    const slug = product.slug.trim();
    const image = product.image_url!.trim();
    const categoryLabel = product.category?.trim() || "Produk";
    const brand = product.brand?.trim();
    const ownDescription = product.description?.trim() || "";
    const presentation = presentationsByProductId.get(productId);
    // With no published content the product still describes itself — from its
    // own fields only (AGENTS.md §3): brand, category and variant names. The
    // old sentence described the page ("detail mengikuti data katalog toko"),
    // which told a buyer, Google and Meta nothing about the product.
    const variantNames = availableVariants.map((variant) => variant.title.trim());
    const variantSummary =
      variantNames.length > 1
        ? `Tersedia ${variantNames.length} pilihan: ${variantNames.slice(0, 6).join(", ")}${variantNames.length > 6 ? ", dan lainnya" : ""}.`
        : `Varian: ${variantNames[0]}.`;
    const generatedDescription = `${productName}${brand ? ` dari ${brand}` : ""}, kategori ${categoryLabel}. ${variantSummary}`;
    const details = {
      subheadline: `Pilih varian ${productName} berdasarkan opsi dan harga yang tersedia.`,
      description: ownDescription || generatedDescription,
      benefits: [],
      keyPoints: [],
      idealFor: [],
    };

    const variants = availableVariants.map((variant) => {
      const comparePrice =
        Number.isSafeInteger(variant.compare_price) &&
        Number(variant.compare_price) > variant.price
          ? Number(variant.compare_price)
          : undefined;
      return {
        catalogId: variant.id,
        ...(variant.sku?.trim() ? { sku: variant.sku.trim() } : {}),
        id: String(variant.id),
        label: variant.title.trim(),
        price: variant.price,
        ...(comparePrice ? { comparePrice } : {}),
      };
    });
    // The product's own price is its "from" price, the cheapest variant — the
    // figure the product page already shows. It used to be whichever variant
    // D1 returned first, so a product whose larger size was entered first
    // listed that size's price on every card while its page said less.
    const fromVariant = variants.reduce((low, variant) =>
      variant.price < low.price ? variant : low,
    );

    catalog.push({
        catalogId: product.id,
        productId,
        slug,
        productName,
        contentName: presentation?.contentName || productName,
        headline: presentation?.headline || productName,
        subheadline: presentation?.subheadline || details.subheadline,
        seoTitle: presentation?.seoTitle || productName,
        seoDescription:
          presentation?.seoDescription ||
          clampSentence(ownDescription, 155) ||
          clampSentence(`${generatedDescription} Mulai ${formatIdr(fromVariant.price)}.`, 155),
        price: fromVariant.price,
        ...(fromVariant.comparePrice
          ? { comparePrice: fromVariant.comparePrice }
          : {}),
        image,
        heroImage: image,
        images: [image],
        tag: presentation?.tag || categoryLabel,
        category: categoryLabel,
        // `products.brand` (0051) is the manufacturer's name. Dropping it here
        // is how the feeds kept reporting the store as every product's brand.
        ...(brand ? { brand } : {}),
        relatedCategories:
          presentation?.relatedCategories?.length
            ? presentation.relatedCategories
            : [categoryLabel],
        ...(presentation?.relatedTags
          ? { relatedTags: presentation.relatedTags }
          : {}),
        description: presentation?.description || details.description,
        // The product's own description, kept apart from `description` (which
        // may be landing copy) so the feeds can prefer the merchant's facts.
        ...(ownDescription ? { catalogDescription: ownDescription } : {}),
        ...(Number.isSafeInteger(product.google_category_id) && Number(product.google_category_id) > 0
          ? {
              googleCategoryId: Number(product.google_category_id),
              googleCategoryPath: product.google_category_path?.trim() || "",
            }
          : {}),
        benefits: presentation?.benefits || details.benefits,
        keyPoints: presentation?.keyPoints || details.keyPoints,
        idealFor: presentation?.idealFor || details.idealFor,
        offerText:
          presentation?.offerText || "Harga mengikuti varian terpilih.",
        ctaText: presentation?.ctaText || "Lanjutkan Pesanan",
        ...(presentation?.ratingValue !== undefined
          ? { ratingValue: presentation.ratingValue }
          : {}),
        ...(presentation?.reviewCount !== undefined
          ? { reviewCount: presentation.reviewCount }
          : {}),
        ...(presentation?.soldCount !== undefined
          ? { soldCount: presentation.soldCount }
          : {}),
        reviews: presentation?.reviews || [],
        variants,
    });
  }
  return catalog;
}
/** Cut at a word boundary under `max` characters, with an ellipsis when cut. */
function clampSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,.;:]+$/, "")}…`;
}
