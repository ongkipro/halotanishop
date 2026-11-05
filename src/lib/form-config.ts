import type { Product, ProductVariant } from "../data/products";
import type { FormMode } from "./form-mode.ts";

/**
 * The cheapest variant, the first among equals: the "from" price the cards,
 * the Product JSON-LD and both catalog feeds lead with. A form that opened on
 * another variant showed Merchant Center a price its item never had.
 */
export function cheapestVariant<T extends { price: number }>(variants: readonly T[]): T | undefined {
  return variants.reduce<T | undefined>((low, variant) => (!low || variant.price < low.price ? variant : low), undefined);
}

const FORM_PATHS: Record<FormMode, string> = {
  middle: "/middle-form",
  full: "/full-form",
  hybrid: "/hybrid-form",
};

export function parseFormMode(value: unknown): FormMode | null {
  if (value === "middle" || value === "full" || value === "hybrid") {
    return value;
  }
  return null;
}

export function resolveFormVariant(
  product: Product,
  key?: string,
): ProductVariant | undefined {
  if (!key) return cheapestVariant(product.variants);

  const normalized = key.trim();
  return product.variants.find((variant) => variant.id === normalized);
}

export function buildFormUrl(
  mode: FormMode,
  product: Pick<Product, "productId">,
  variant?: Pick<ProductVariant, "id">,
) {
  const params = new URLSearchParams({ product_id: product.productId });
  if (variant) params.set("variant_id", variant.id);
  return `${FORM_PATHS[mode]}?${params.toString()}`;
}

export function buildEmbedFormUrl(
  mode: FormMode,
  product: Pick<Product, "productId">,
  variant?: Pick<ProductVariant, "id">,
) {
  const params = new URLSearchParams({
    mode,
    product_id: product.productId,
  });
  if (variant) params.set("variant_id", variant.id);
  return `/embed/form?${params.toString()}`;
}

export function buildFormUrls(
  product: Pick<Product, "productId">,
  variant?: Pick<ProductVariant, "id">,
) {
  return {
    middle: buildFormUrl("middle", product, variant),
    full: buildFormUrl("full", product, variant),
    hybrid: buildFormUrl("hybrid", product, variant),
  };
}

export function buildEmbedFormUrls(
  product: Pick<Product, "productId">,
  variant?: Pick<ProductVariant, "id">,
) {
  return {
    middle: buildEmbedFormUrl("middle", product, variant),
    full: buildEmbedFormUrl("full", product, variant),
    hybrid: buildEmbedFormUrl("hybrid", product, variant),
  };
}
