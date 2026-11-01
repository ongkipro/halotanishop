import assert from "node:assert/strict";
import test from "node:test";

import { buildItemListJsonLd, buildProductJsonLd, buildStorefrontJsonLd } from "./json-ld.ts";

const baseInput = {
  siteUrl: "https://shop.example/",
  organization: {
    name: "Merchant Example",
    logo: "/logo.webp",
  },
  product: {
    name: "Produk Contoh",
    description: "Deskripsi produk dari merchant.",
    image: "/produk/contoh.webp",
    url: "/produk/contoh",
  },
};

test("product offers omit unstored return, shipping, and validity claims", () => {
  const schema = buildProductJsonLd({
    ...baseInput,
    product: {
      ...baseInput.product,
      offers: [
        {
          price: 125_000,
          availability: "InStock",
        },
      ],
    },
  });
  const offer = schema.offers as Record<string, unknown>;

  assert.equal(Object.hasOwn(offer, "priceValidUntil"), false);
  assert.equal(Object.hasOwn(offer, "hasMerchantReturnPolicy"), false);
  assert.equal(Object.hasOwn(offer, "shippingDetails"), false);
});

test("product offers preserve an explicitly provided validity date", () => {
  const schema = buildProductJsonLd({
    ...baseInput,
    product: {
      ...baseInput.product,
      offers: [
        {
          price: 125_000,
          priceValidUntil: "2026-12-31",
          availability: "InStock",
        },
      ],
    },
  });
  const offer = schema.offers as Record<string, unknown>;

  assert.equal(offer.priceValidUntil, "2026-12-31");
  assert.equal(Object.hasOwn(offer, "hasMerchantReturnPolicy"), false);
  assert.equal(Object.hasOwn(offer, "shippingDetails"), false);
});

test("no homepage-as-logo, no dead SearchAction, and a list item is only a pointer", () => {
  const graph = buildStorefrontJsonLd({
    siteUrl: "https://toko.example",
    organization: { name: "Toko", logo: "" },
    website: { name: "Toko" },
  })["@graph"] as Record<string, unknown>[];
  assert.equal("logo" in graph[0], false);
  assert.equal("potentialAction" in graph[1], false);
  const list = buildItemListJsonLd({
    siteUrl: "https://toko.example",
    name: "Produk",
    items: [{ name: "A", url: "/produk/a", image: "/a.jpg", price: 1000 }],
  });
  assert.deepEqual(list.itemListElement[0], {
    "@type": "ListItem",
    position: 1,
    name: "A",
    url: "https://toko.example/produk/a",
  });
});

test("one Offer per variant, the product's own brand, and reviews only when there are some", () => {
  const schema = buildProductJsonLd({
    siteUrl: "https://toko.example",
    organization: { name: "Toko" },
    product: {
      name: "Sabun",
      description: "Sabun cair.",
      image: "/a.jpg",
      url: "/produk/sabun",
      brand: "Bersih",
      offers: [
        { price: 97500, availability: "InStock", name: "250 ml" },
        { price: 120000, availability: "InStock", name: "1 L" },
      ],
      reviews: [{ name: "Rina", rating: 5, comment: "Wangi." }],
    },
  }) as Record<string, any>;
  assert.equal(schema.brand.name, "Bersih");
  assert.equal(schema.offers.length, 2);
  assert.equal(schema.offers[0]["@type"], "Offer");
  assert.equal(schema.review[0].reviewRating.ratingValue, 5);
});
