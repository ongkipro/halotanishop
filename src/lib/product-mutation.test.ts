import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteCatalogProduct,
  parseProductMutationPayload,
} from "./product-mutation.ts";

type MockStatement = {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => MockStatement;
  first: () => Promise<unknown>;
};

function createDatabase(options: { exists: boolean; referenceCount: number }) {
  const batches: MockStatement[][] = [];
  const database = {
    prepare(sql: string) {
      const statement: MockStatement = {
        sql,
        args: [],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        async first() {
          if (sql.includes("SELECT id FROM products")) {
            return options.exists ? { id: statement.args[0] } : null;
          }
          return null;
        },
      };
      return statement;
    },
    async batch(statements: MockStatement[]) {
      batches.push(statements);
      return statements.map((_, index) => ({
        success: true,
        results: [],
        meta: {
          changes:
            index === 1 && options.referenceCount === 0 ? 1 : 0,
        },
      }));
    },
  } as unknown as D1Database;
  return { database, batches };
}

test("no product id is exempt from deletion", async () => {
  // 10001 used to be an un-deletable "canonical sample". It is an ordinary
  // product now: the same delete path and the same order-reference guard apply.
  const { database, batches } = createDatabase({
    exists: true,
    referenceCount: 0,
  });

  assert.deepEqual(await deleteCatalogProduct(database, 10001), {
    status: "deleted",
  });
  assert.equal(batches.length, 1);
});

test("product deletion rejects products referenced by orders", async () => {
  const { database, batches } = createDatabase({
    exists: true,
    referenceCount: 2,
  });

  assert.deepEqual(await deleteCatalogProduct(database, 10002), {
    status: "referenced",
  });
  assert.equal(batches.length, 1);
  assert.match(batches[0][0].sql, /NOT EXISTS/);
  assert.match(batches[0][1].sql, /NOT EXISTS/);
});

test("product deletion removes variants before an unreferenced product", async () => {
  const { database, batches } = createDatabase({
    exists: true,
    referenceCount: 0,
  });

  assert.deepEqual(await deleteCatalogProduct(database, 10002), {
    status: "deleted",
  });
  assert.equal(batches.length, 1);
  assert.match(batches[0][0].sql, /DELETE FROM product_variants/);
  assert.match(batches[0][1].sql, /DELETE FROM products/);
  assert.match(batches[0][2].sql, /DELETE FROM storefront_content/);
  assert.deepEqual(batches[0].map((statement) => statement.args), [
    [10002, 10002],
    [10002, 10002],
    ["product:10002", 10002],
  ]);
});

test("product deletion reports a missing product without writes", async () => {
  const { database, batches } = createDatabase({
    exists: false,
    referenceCount: 0,
  });

  assert.deepEqual(await deleteCatalogProduct(database, 10002), {
    status: "not_found",
  });
  assert.equal(batches.length, 0);
});

function validMutationPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Produk Merchant",
    slug: "produk-merchant",
    image_url: "/assets/uploads/produk-merchant.webp",
    is_active: true,
    variants: [
      {
        sku: "MERCHANT-1",
        title: "1 Liter",
        price: 125000,
        weight_grams: 1000,
        stock: 12,
      },
    ],
    ...overrides,
  };
}

test("active product validation accepts complete merchant-owned data", () => {
  const parsed = parseProductMutationPayload(validMutationPayload(), false);
  assert.ok("value" in parsed);
  if ("value" in parsed) {
    assert.equal(parsed.value.title, "Produk Merchant");
    assert.equal(parsed.value.slug, "produk-merchant");
    assert.equal(
      parsed.value.image_url,
      "/assets/uploads/produk-merchant.webp",
    );
    assert.equal(parsed.value.variants[0].stock, 12);
  }
});

test("active product validation rejects a missing image", () => {
  assert.deepEqual(
    parseProductMutationPayload(
      validMutationPayload({ image_url: "" }),
      false,
    ),
    { error: "Produk aktif wajib memiliki gambar." },
  );
});

test("a variant is accepted whatever its stock figure says", () => {
  // Stock stopped gating a sale in ADR-023, so it can no longer refuse a save.
  for (const stock of [0, -5, undefined]) {
    const parsed = parseProductMutationPayload(
      validMutationPayload({
        variants: [
          {
            sku: "MERCHANT-1",
            title: "1 Liter",
            price: 125000,
            weight_grams: 1000,
            ...(stock === undefined ? {} : { stock }),
          },
        ],
      }),
      false,
    );
    assert.ok(!("error" in parsed), `stock ${String(stock)} must be accepted`);
    assert.equal(parsed.value.variants[0].stock, 0);
  }
});

test("product validation never synthesizes a missing slug", () => {
  assert.deepEqual(
    parseProductMutationPayload(validMutationPayload({ slug: "" }), false),
    { error: "Judul dan slug produk wajib diisi." },
  );
});

// A41: a missing weight is never invented as 1000 g.
function variantWithWeight(weight: unknown, id?: number) {
  return validMutationPayload({
    ...(id === undefined ? {} : { id: 10001 }),
    variants: [
      {
        ...(id === undefined ? {} : { id }),
        sku: "MERCHANT-1",
        title: "1 Liter",
        price: 125000,
        ...(weight === undefined ? {} : { weight_grams: weight }),
      },
    ],
  });
}

test("a new variant without a weight is refused with a 422", () => {
  for (const weight of [undefined, null, "", "  "]) {
    assert.deepEqual(parseProductMutationPayload(variantWithWeight(weight), false), {
      error: "Berat varian MERCHANT-1 wajib diisi (gram).",
      status: 422,
    });
  }
  // A new variant added to an existing product is held to the same rule.
  const added = parseProductMutationPayload(
    { ...variantWithWeight(undefined), id: 10001 },
    true,
  );
  assert.deepEqual(added, {
    error: "Berat varian MERCHANT-1 wajib diisi (gram).",
    status: 422,
  });
});

test("a new variant saves the weight it states", () => {
  const parsed = parseProductMutationPayload(variantWithWeight(250), false);
  assert.ok("value" in parsed);
  assert.equal(parsed.value.variants[0].weight_grams, 250);
  const fromString = parseProductMutationPayload(variantWithWeight("250"), false);
  assert.ok("value" in fromString);
  assert.equal(fromString.value.variants[0].weight_grams, 250);
});

test("an existing variant saved without a weight keeps its stored one", async () => {
  const parsed = parseProductMutationPayload(variantWithWeight(undefined, 20001), true);
  assert.ok("value" in parsed);
  assert.equal(parsed.value.variants[0].weight_grams, null);

  // The route's own UPDATE turns that null into "keep", not 1000.
  const { readFileSync } = await import("node:fs");
  const { DatabaseSync } = await import("node:sqlite");
  const route = readFileSync(
    new URL("../pages/api/admin/products.ts", import.meta.url),
    "utf8",
  );
  const update = route.match(/UPDATE product_variants[\s\S]*?WHERE id = \? AND product_id = \?/)?.[0];
  assert.ok(update, "the variant UPDATE is where the route keeps it");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE product_variants (
    id INTEGER PRIMARY KEY, product_id INTEGER, sku TEXT, title TEXT, price INTEGER,
    compare_price INTEGER, weight_grams INTEGER NOT NULL DEFAULT 1000, stock INTEGER
  );
  INSERT INTO product_variants VALUES (20001, 10001, 'MERCHANT-1', '1 Liter', 125000, NULL, 750, 0);`);
  const variant = parsed.value.variants[0];
  sqlite.prepare(update).run(variant.sku, variant.title, variant.price, variant.compare_price, variant.weight_grams, variant.stock, 20001, 10001);
  const stored = sqlite.prepare("SELECT weight_grams FROM product_variants WHERE id = 20001").get() as { weight_grams: number };
  assert.equal(stored.weight_grams, 750);
});

test("zero, negative, fractional and non-numeric weights are refused", () => {
  for (const weight of [0, -5, 2.5, "abc"]) {
    assert.deepEqual(parseProductMutationPayload(variantWithWeight(weight), false), {
      error: "Berat varian MERCHANT-1 harus integer positif.",
    }, `weight ${String(weight)}`);
  }
});

test("a variant over Mengantar's regular 50 kg limit is refused", () => {
  assert.ok("value" in parseProductMutationPayload(variantWithWeight(50_000), false));
  assert.deepEqual(parseProductMutationPayload(variantWithWeight(50_001), false), {
    error: "Berat varian MERCHANT-1 maksimal 50.000 gram (batas layanan reguler Mengantar).",
  });
});

test("brand and description are capped at the feed limits, and an update without them keeps the stored values", () => {
  const variants = [{ sku: "SKU-1", title: "250 ml", price: 10000, weight_grams: 300, stock: 0 }];
  const created = parseProductMutationPayload(
    { title: "Sabun", slug: "sabun", brand: "x".repeat(90), description: "a\r\n\r\n\r\n\r\nb", variants, is_active: false },
    false,
  );
  assert.ok("value" in created);
  assert.equal(created.value.brand?.length, 70);
  assert.equal(created.value.description, "a\n\nb");
  const cleared = parseProductMutationPayload({ id: 1, title: "Sabun", slug: "sabun", brand: "  ", description: "", variants, is_active: false }, true);
  assert.ok("value" in cleared);
  assert.equal(cleared.value.brand, null);
  assert.equal(cleared.value.description, null);
  const untouched = parseProductMutationPayload({ id: 1, title: "Sabun", slug: "sabun", variants, is_active: false }, true);
  assert.ok("value" in untouched);
  assert.equal("brand" in untouched.value, false);
  assert.equal("description" in untouched.value, false);
});

test("a Google category is an id with its path, null clears it, and absent keeps it", () => {
  const variants = [{ sku: "SKU-1", title: "250 ml", price: 10000, weight_grams: 300, stock: 0 }];
  const base = { id: 1, title: "Sabun", slug: "sabun", variants, is_active: false };
  const set = parseProductMutationPayload({ ...base, google_category_id: "2503", google_category_path: "Health & Beauty > Personal Care > Cosmetics > Bath & Body > Bar Soap" }, true);
  assert.ok("value" in set);
  assert.equal(set.value.google_category_id, 2503);
  assert.match(set.value.google_category_path ?? "", /Bar Soap$/);
  const cleared = parseProductMutationPayload({ ...base, google_category_id: null }, true);
  assert.ok("value" in cleared);
  assert.equal(cleared.value.google_category_id, null);
  assert.equal(cleared.value.google_category_path, null);
  const kept = parseProductMutationPayload(base, true);
  assert.ok("value" in kept);
  assert.equal("google_category_id" in kept.value, false);
  for (const bad of [{ google_category_id: "abc", google_category_path: "x" }, { google_category_id: 2503, google_category_path: "" }, { google_category_id: -1, google_category_path: "x" }]) {
    assert.ok("error" in parseProductMutationPayload({ ...base, ...bad }, true));
  }
});
