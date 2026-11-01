import assert from "node:assert/strict";
import test from "node:test";
import type { Product } from "../data/products.ts";
import { buildLlmsTxt } from "./llms-txt.ts";

const product = (overrides: Partial<Product>): Product =>
  ({
    slug: "sabun-cair",
    productId: "14321",
    productName: "Sabun Cair",
    seoDescription: "Sabun cair, kategori Rumah.",
    price: 120000,
    category: "Rumah",
    variants: [
      { id: "2", label: "1 L", price: 120000 },
      { id: "3", label: "250 ml", price: 97500 },
    ],
    ...overrides,
  }) as Product;

test("llms.txt maps this store's own catalogue, from its lowest price", () => {
  const text = buildLlmsTxt(
    { name: "Toko Contoh", siteUrl: "https://toko.example/", description: "Perlengkapan rumah." },
    [product({ brand: "Bersih", catalogDescription: "Sabun cair 1 liter,\n aroma lemon." })],
  );
  assert.match(text, /^# Toko Contoh\n\n> Perlengkapan rumah\.\n/);
  assert.match(
    text,
    /- \[Sabun Cair\]\(https:\/\/toko\.example\/produk\/sabun-cair\): mulai Rp97\.500, merek Bersih, kategori Rumah, pilihan 1 L \/ 250 ml\. Sabun cair 1 liter, aroma lemon\./,
  );
  assert.match(text, /\(https:\/\/toko\.example\/feed\/google-catalog\.xml\)/);
  assert.match(text, /\(https:\/\/toko\.example\/sitemap\.xml\)/);
});

test("llms.txt publishes no admin, API or order-status surface", () => {
  const text = buildLlmsTxt({ name: "Toko", siteUrl: "https://toko.example" }, [product({})]);
  assert.doesNotMatch(text, /\/admin|\/api\/|\/hello|status_token|order-status/);
  assert.match(text, /> Toko online Toko\./);
  // No merchant description: no generated sentence repeating the facts.
  assert.match(text, /sabun-cair\): mulai Rp97\.500, kategori Rumah, pilihan 1 L \/ 250 ml\.\n/);
});
