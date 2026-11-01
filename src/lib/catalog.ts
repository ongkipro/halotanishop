import { type Product } from "../data/products.ts";
import { getRuntimeEnv } from "./env.ts";
import {
  mergeStorefrontCatalog,
  type CatalogProductRow,
  type CatalogVariantRow,
} from "./catalog-data.ts";
import {
  loadPublishedProductContent,
  mergeRuntimeProductContent,
} from "./storefront-content.ts";
import { catalogProductIdOrNull } from "./catalog-feed.ts";

async function loadCatalogRows(database: D1Database) {
  const [products, variants] = await database.batch([
    database.prepare(`
      SELECT id, title, slug, category, brand, description, google_category_id, google_category_path, image_url, is_active, created_at
      FROM products
      ORDER BY created_at DESC, id DESC
    `),
    database.prepare(`
      SELECT id, product_id, sku, title, price, compare_price, stock
      FROM product_variants
      ORDER BY product_id ASC, id ASC
    `),
  ]);

  return {
    products: (products.results ?? []) as CatalogProductRow[],
    variants: (variants.results ?? []) as CatalogVariantRow[],
  };
}

async function loadLocalDevCatalogRows() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const { globSync } = await import("fs");
    const files = globSync(".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite");
    const dbPath = files.find((f) => !f.endsWith("-shm") && !f.endsWith("-wal") && !f.includes("metadata"));
    if (!dbPath) return { products: [], variants: [] };
    const db = new DatabaseSync(dbPath);
    const products = db.prepare(`
      SELECT id, title, slug, category, brand, description, google_category_id, google_category_path, image_url, is_active, created_at
      FROM products
      ORDER BY created_at DESC, id DESC
    `).all() as unknown as CatalogProductRow[];
    const variants = db.prepare(`
      SELECT id, product_id, sku, title, price, compare_price, stock
      FROM product_variants
      ORDER BY product_id ASC, id ASC
    `).all() as unknown as CatalogVariantRow[];
    return { products, variants };
  } catch {
    return { products: [], variants: [] };
  }
}

// One catalog read per request. A product page read it twice (the page and its
// order form), and every D1 round trip is a Pacific crossing when Cloudflare
// serves an Indonesian visitor, or PageSpeed, from a US colo: measured 3.7-6 s
// to the first byte on page.revenleather.com. Keyed on `locals`, so it never
// outlives the request and an admin edit is seen by the next one.
const catalogByRequest = new WeakMap<object, Promise<Product[]>>();

export function getStorefrontProducts(locals?: App.Locals): Promise<Product[]> {
  if (!locals) return loadStorefrontProducts(locals);
  let pending = catalogByRequest.get(locals);
  if (!pending) {
    pending = loadStorefrontProducts(locals);
    catalogByRequest.set(locals, pending);
  }
  return pending;
}

async function loadStorefrontProducts(
  locals?: App.Locals,
): Promise<Product[]> {
  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;

  try {
    // In parallel, not in one batch: the content read fails soft on its own.
    const [rows, runtimeContent] = database && typeof database === "object"
      ? await Promise.all([loadCatalogRows(database), loadPublishedProductContent(database)])
      : [await loadLocalDevCatalogRows(), new Map()];

    const presentations = mergeRuntimeProductContent(
      rows.products,
      runtimeContent,
    );
    return mergeStorefrontCatalog(rows.products, rows.variants, presentations);
  } catch (error) {
    console.error("storefront-catalog-load", error);
    return [];
  }
}

/**
 * Resolve one storefront product by slug, Product ID, or catalogue id.
 *
 * The catalogue id is read through `catalogProductIdOrNull`, and that is not a
 * style preference. The strict `catalogProductId` throws on a row that predates
 * the five-digit scheme, and this predicate runs against **every** product
 * until one matches — so a single legacy row sorted ahead of the match threw
 * before the match was ever reached. Nothing here catches it, so it surfaced as
 * a 500 on the product page, the landing page, every form page, `/api/form-config`
 * and `/api/v1/products/<slug>`. One bad row took the whole storefront down,
 * not the row's own page.
 *
 * Failing closed is right for an ads payload, which is why the strict function
 * exists and keeps its callers. It is wrong for a lookup: a row that cannot
 * carry a catalogue identity simply never matches on one.
 */
export async function getStorefrontProduct(locals: App.Locals, key: string) {
  const products = await getStorefrontProducts(locals);

  return products.find(
    (product) =>
      product.slug === key ||
      product.productId === key ||
      String(product.catalogId) === key ||
      // `/api/v1/products` hands a caller the numeric Product ID as its
      // `content_id`. Accepting it back is the difference between a documented
      // list/detail round trip and a 404 on the value the API just returned.
      catalogProductIdOrNull(product.productId) === key,
  );
}
