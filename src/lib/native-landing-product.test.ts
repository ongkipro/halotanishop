import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeLandingEntryForPath, nativeLandingProductJsonLd } from "./native-landing-product.ts";

const entries = [
  { slug: "perisai-kebal-jamur", title: "Kojien", productSlug: "kojien", description: "x" },
  { slug: "draft", title: "Draft", productSlug: "kojien", description: "x", isActive: false },
];

test("only an active registered top-level slug resolves to a native page", () => {
  assert.equal(nativeLandingEntryForPath("/perisai-kebal-jamur", entries)?.productSlug, "kojien");
  assert.equal(nativeLandingEntryForPath("/perisai-kebal-jamur/", entries)?.slug, "perisai-kebal-jamur");
  assert.equal(nativeLandingEntryForPath("/draft", entries), undefined);
  assert.equal(nativeLandingEntryForPath("/produk/kojien", entries), undefined);
  assert.equal(nativeLandingEntryForPath("/", entries), undefined);
  assert.equal(nativeLandingEntryForPath("/cms-landing", entries), undefined);
});

test("the product block carries the live price, availability and identity", () => {
  const input = nativeLandingProductJsonLd(
    {
      productName: "Kojien",
      description: "Nutrisi tanaman",
      heroImage: "https://x.test/a.webp",
      productId: "10042",
      category: "Nutrisi",
      variants: [
        { price: 130000, label: "500ml", sku: "K-500" },
        { price: 230000, label: "1L" },
      ],
    },
    "https://x.test/produk/kojien",
  );
  assert.equal(input.url, "https://x.test/produk/kojien");
  assert.equal(input.sku, "10042");
  assert.equal(input.brand, undefined);
  assert.deepEqual(input.offers.map((o) => [o.price, o.availability, o.sku]), [
    [130000, "InStock", "K-500"],
    [230000, "InStock", undefined],
  ]);
});
