import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../lib/api";
import { getRuntimeEnv } from "../../../lib/env";
import { getPublicProductValidationError } from "../../../lib/catalog-data";
import {
  createCatalogProductId,
  deleteCatalogProduct,
  parseProductMutationPayload,
  parseProductStatusTogglePayload,
  updateProductActiveStatus,
  type ProductMutationPayload,
} from "../../../lib/product-mutation";

export const prerender = false;

const MAX_PRODUCTS = 200;

type DbProductRow = {
  id: number;
  store_id: number;
  title: string;
  slug: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  google_category_id: number | null;
  google_category_path: string | null;
  image_url: string | null;
  is_active: number | boolean | null;
  created_at: string;
};

type DbVariantRow = {
  id: number;
  product_id: number;
  sku: string;
  title: string;
  price: number;
  compare_price: number | null;
  weight_grams: number;
  stock: number | null;
};

async function loadProducts(
  database: D1Database,
  productId?: number,
  limit = 50,
) {
  const productResult = productId
    ? await database
        .prepare(
          `
        SELECT id, store_id, title, slug, category, brand, description, google_category_id, google_category_path, is_active, image_url, created_at
        FROM products
        WHERE id = ?
        LIMIT 1
      `,
        )
        .bind(productId)
        .all()
    : await database
        .prepare(
          `
        SELECT id, store_id, title, slug, category, brand, description, google_category_id, google_category_path, is_active, image_url, created_at
        FROM products
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
        )
        .bind(limit)
        .all();

  const products = (productResult.results ?? []) as DbProductRow[];
  if (products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const placeholders = productIds.map(() => "?").join(", ");
  const variantResult = await database
    .prepare(
      `
    SELECT id, product_id, sku, title, price, compare_price, weight_grams, stock
    FROM product_variants
    WHERE product_id IN (${placeholders})
    ORDER BY product_id ASC, id ASC
  `,
    )
    .bind(...productIds)
    .all();

  const variantsByProduct = new Map<number, DbVariantRow[]>();
  for (const row of (variantResult.results ?? []) as DbVariantRow[]) {
    const variants = variantsByProduct.get(row.product_id);
    if (variants) {
      variants.push(row);
    } else {
      variantsByProduct.set(row.product_id, [row]);
    }
  }

  return products.map((product) => ({
    id: product.id,
    title: product.title,
    slug: product.slug,
    category: product.category ?? "Umum",
    brand: product.brand ?? "",
    description: product.description ?? "",
    google_category_id: product.google_category_id ?? null,
    google_category_path: product.google_category_path ?? "",
    image_url: product.image_url,
    is_active: Boolean(product.is_active),
    created_at: product.created_at,
    variants: (variantsByProduct.get(product.id) ?? []).map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      price: variant.price,
      compare_price: variant.compare_price,
      weight_grams: variant.weight_grams,
      stock: variant.stock ?? 0,
    })),
  }));
}

async function generateProductId(database: D1Database) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = createCatalogProductId();
    const existing = await database
      .prepare("SELECT id FROM products WHERE id = ? LIMIT 1")
      .bind(candidate)
      .first();
    if (!existing) return candidate;
  }
  throw new Error("Gagal membuat ID produk unik.");
}

export const GET: APIRoute = async ({ locals, url }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database produk belum tersedia.", 503);
  }

  const requestedId = Number.parseInt(url.searchParams.get("id") || "", 10);
  const requestedLimit = Number.parseInt(
    url.searchParams.get("limit") || "",
    10,
  );
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PRODUCTS)
    : 50;

  try {
    const products = await loadProducts(
      database as D1Database,
      Number.isInteger(requestedId) ? requestedId : undefined,
      limit,
    );
    if (Number.isInteger(requestedId)) {
      if (products.length === 0)
        return jsonError("Produk tidak ditemukan.", 404);
      return jsonOk({ data: products[0] });
    }
    return jsonOk({ data: products });
  } catch (error) {
    console.error("admin-products-get", error);
    return jsonError("Gagal mengambil data produk.", 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database produk belum tersedia.", 503);
  }

  const parsed = parseProductMutationPayload(
    (await request.json().catch(() => null)) as ProductMutationPayload | null,
    false,
  );
  if ("error" in parsed) return jsonError(parsed.error, parsed.status ?? 400);
  try {
    const db = database as D1Database;
    const storeRow = (await db
      .prepare("SELECT id FROM stores ORDER BY id LIMIT 1")
      .first()) as { id: number } | null;
    if (!storeRow) return jsonError("Store belum tersedia.", 404);

    const slugConflict = (await db
      .prepare("SELECT id FROM products WHERE slug = ? LIMIT 1")
      .bind(parsed.value.slug)
      .first()) as { id: number } | null;
    if (slugConflict) {
      return jsonError("Slug produk sudah dipakai.", 409);
    }

    const skuPlaceholders = parsed.value.variants.map(() => "?").join(", ");
    const skuConflict = (await db
      .prepare(
        `
      SELECT sku FROM product_variants WHERE sku IN (${skuPlaceholders}) LIMIT 1
    `,
      )
      .bind(...parsed.value.variants.map((variant) => variant.sku))
      .first()) as { sku: string } | null;
    if (skuConflict) {
      return jsonError(`SKU ${skuConflict.sku} sudah dipakai.`, 409);
    }

    const productId = await generateProductId(db);
    const createdAt = new Date().toISOString();
    const statements = [
      db
        .prepare(
          `
        INSERT INTO products (
          id, store_id, title, slug, category, brand, description,
          google_category_id, google_category_path, is_active, image_url, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .bind(
          productId,
          storeRow.id,
          parsed.value.title,
          parsed.value.slug,
          parsed.value.category,
          parsed.value.brand ?? null,
          parsed.value.description ?? null,
          parsed.value.google_category_id ?? null,
          parsed.value.google_category_path ?? null,
          parsed.value.is_active ? 1 : 0,
          parsed.value.image_url,
          createdAt,
        ),
      ...parsed.value.variants.map((variant) =>
        db
          .prepare(
            `
        INSERT INTO product_variants (
          product_id, sku, title, price, compare_price, weight_grams, stock
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
          )
          .bind(
            productId,
            variant.sku,
            variant.title,
            variant.price,
            variant.compare_price,
            variant.weight_grams,
            variant.stock,
          ),
      ),
    ];

    await db.batch(statements);
    const products = await loadProducts(db, productId);
    return jsonOk(
      {
        message: "Produk berhasil disimpan",
        data: products[0],
      },
      201,
    );
  } catch (error) {
    console.error("admin-products-post", error);
    return jsonError("Gagal menyimpan produk.", 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database produk belum tersedia.", 503);
  }

  const rawBody = await request.json().catch(() => null);
  const statusToggle = parseProductStatusTogglePayload(rawBody);
  if (statusToggle) {
    if ("error" in statusToggle) return jsonError(statusToggle.error, 400);

    try {
      const db = database as D1Database;
      const currentProducts = await loadProducts(db, statusToggle.value.id);
      const currentProduct = currentProducts[0];
      if (!currentProduct) {
        return jsonError("Produk tidak ditemukan.", 404);
      }
      if (statusToggle.value.is_active) {
        const publicationError = getPublicProductValidationError(
          currentProduct,
          currentProduct.variants,
        );
        if (publicationError) return jsonError(publicationError, 400);
      }

      const wasUpdated = await updateProductActiveStatus(
        db,
        statusToggle.value,
      );
      if (!wasUpdated) {
        return jsonError("Produk tidak ditemukan.", 404);
      }

      const products = await loadProducts(db, statusToggle.value.id);
      return jsonOk({
        message: statusToggle.value.is_active
          ? "Produk berhasil diaktifkan."
          : "Produk dijadikan draft.",
        data: products[0],
      });
    } catch (error) {
      console.error("admin-products-status-patch", error);
      return jsonError("Gagal memperbarui status produk.", 500);
    }
  }

  const body = rawBody as ProductMutationPayload | null;
  const parsed = parseProductMutationPayload(body, true);
  if ("error" in parsed) return jsonError(parsed.error, parsed.status ?? 400);
  try {
    const db = database as D1Database;
    const currentProductRows = await loadProducts(db, parsed.value.id);
    const currentProduct = currentProductRows[0];
    if (!currentProduct) return jsonError("Produk tidak ditemukan.", 404);

    const slugConflict = (await db
      .prepare("SELECT id FROM products WHERE slug = ? AND id != ? LIMIT 1")
      .bind(parsed.value.slug, parsed.value.id)
      .first()) as { id: number } | null;
    if (slugConflict) {
      return jsonError("Slug produk sudah dipakai.", 409);
    }

    const currentVariantIds = new Set(
      currentProduct.variants.map((variant) => variant.id),
    );
    for (const variant of parsed.value.variants) {
      if (variant.id !== undefined && !currentVariantIds.has(variant.id)) {
        return jsonError(
          `Varian ${variant.id} tidak ditemukan pada produk ini.`,
          400,
        );
      }
    }

    const payloadVariantIds = new Set(
      parsed.value.variants.flatMap((variant) =>
        variant.id === undefined ? [] : [variant.id],
      ),
    );
    const removedVariantIds = currentProduct.variants
      .filter((variant) => !payloadVariantIds.has(variant.id))
      .map((variant) => variant.id);

    if (removedVariantIds.length > 0) {
      const removalPlaceholders = removedVariantIds.map(() => "?").join(", ");
      const referencedVariant = (await db
        .prepare(
          `
        SELECT variant_id
        FROM order_items
        WHERE variant_id IN (${removalPlaceholders})
        LIMIT 1
      `,
        )
        .bind(...removedVariantIds)
        .first()) as { variant_id: number } | null;
      if (referencedVariant) {
        return jsonError(
          `Varian ${referencedVariant.variant_id} sudah dipakai order dan tidak boleh dihapus.`,
          409,
        );
      }
    }

    const existingSkuRows = ((
      await db
        .prepare(
          `
      SELECT id, sku
      FROM product_variants
      WHERE sku IN (${parsed.value.variants.map(() => "?").join(", ")})
    `,
        )
        .bind(...parsed.value.variants.map((variant) => variant.sku))
        .all()
    ).results ?? []) as Array<{ id: number; sku: string }>;
    const payloadSkuOwner = new Map(
      parsed.value.variants.map((variant) => [variant.sku, variant.id]),
    );
    for (const row of existingSkuRows) {
      if (payloadSkuOwner.get(row.sku) !== row.id) {
        return jsonError(`SKU ${row.sku} sudah dipakai.`, 409);
      }
    }

    const statements = [
      db
        .prepare(
          `
        UPDATE products
        SET title = ?, slug = ?, category = ?, is_active = ?, image_url = ?,
            brand = CASE WHEN ? THEN ? ELSE brand END,
            description = CASE WHEN ? THEN ? ELSE description END,
            google_category_id = CASE WHEN ? THEN ? ELSE google_category_id END,
            google_category_path = CASE WHEN ? THEN ? ELSE google_category_path END
        WHERE id = ?
      `,
        )
        .bind(
          parsed.value.title,
          parsed.value.slug,
          parsed.value.category,
          parsed.value.is_active ? 1 : 0,
          parsed.value.image_url,
          parsed.value.brand !== undefined ? 1 : 0,
          parsed.value.brand ?? null,
          parsed.value.description !== undefined ? 1 : 0,
          parsed.value.description ?? null,
          parsed.value.google_category_id !== undefined ? 1 : 0,
          parsed.value.google_category_id ?? null,
          parsed.value.google_category_id !== undefined ? 1 : 0,
          parsed.value.google_category_path ?? null,
          parsed.value.id,
        ),
      ...parsed.value.variants.map((variant) => {
        if (variant.id !== undefined) {
          return db
            .prepare(
              `
            UPDATE product_variants
            SET sku = ?, title = ?, price = ?, compare_price = ?, weight_grams = COALESCE(?, weight_grams), stock = ?
            WHERE id = ? AND product_id = ?
          `,
            )
            .bind(
              variant.sku,
              variant.title,
              variant.price,
              variant.compare_price,
              variant.weight_grams,
              variant.stock,
              variant.id,
              parsed.value.id,
            );
        }

        return db
          .prepare(
            `
          INSERT INTO product_variants (
            product_id, sku, title, price, compare_price, weight_grams, stock
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .bind(
            parsed.value.id,
            variant.sku,
            variant.title,
            variant.price,
            variant.compare_price,
            variant.weight_grams,
            variant.stock,
          );
      }),
      ...removedVariantIds.map((variantId) =>
        db
          .prepare(
            "DELETE FROM product_variants WHERE id = ? AND product_id = ?",
          )
          .bind(variantId, parsed.value.id),
      ),
    ];

    await db.batch(statements);
    const products = await loadProducts(db, parsed.value.id);
    return jsonOk({
      message: "Produk berhasil diperbarui",
      data: products[0],
    });
  } catch (error) {
    console.error("admin-products-patch", error);
    return jsonError("Gagal memperbarui produk.", 500);
  }
};
export const PUT = PATCH;


export const DELETE: APIRoute = async ({ locals, url }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database produk belum tersedia.", 503);
  }

  const productId = Number.parseInt(url.searchParams.get("id") || "", 10);
  if (!Number.isInteger(productId) || productId <= 0) {
    return jsonError("ID produk tidak valid.", 400);
  }

  try {
    const result = await deleteCatalogProduct(
      database as D1Database,
      productId,
    );
    if (result.status === "not_found") {
      return jsonError("Produk tidak ditemukan.", 404);
    }
    if (result.status === "referenced") {
      return jsonError(
        "Produk sudah dipakai pada order dan tidak boleh dihapus. Nonaktifkan produk bila tidak lagi dijual.",
        409,
      );
    }
    return jsonOk({ message: "Produk berhasil dihapus." });
  } catch (error) {
    console.error("admin-products-delete", error);
    return jsonError("Gagal menghapus produk.", 500);
  }
};
