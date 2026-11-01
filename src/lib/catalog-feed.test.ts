import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogProductId,
  defaultCatalogContentId,
  generateGoogleCatalogXml,
  generateMetaCatalogXml,
  type CatalogProduct,
  clampFeedText,
  feedImagePath,
} from "./catalog-feed.ts";

test("catalog identity is the numeric Product ID with a five-digit minimum", () => {
  assert.equal(catalogProductId(10000), "10000");
  assert.equal(catalogProductId("434683"), "434683");
  for (const invalid of [9999, "010000", "p10000", "product-slug", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => catalogProductId(invalid), /minimal 5 digit/i);
  }
});

test("a page with a sellable variant points at its Product ID, or at nothing", () => {
  assert.equal(
    defaultCatalogContentId({ productId: 10007, variants: [{ id: 21 }, { id: 22 }] }),
    "10007",
  );
  // No variants means no catalog item. Sending an id that matches nothing is
  // worse than sending none: Meta reports it as a match the merchant cannot act on.
  assert.equal(defaultCatalogContentId({ productId: 7, variants: [] }), undefined);
  assert.equal(defaultCatalogContentId({ productId: 7 }), undefined);
});

test("Google feed emits one product-grain item with g:id matching Product ID", () => {
  const mockProducts: CatalogProduct[] = [
    {
      productId: 14001,
      slug: "bibit-sirsak",
      productName: "Bibit Sirsak Juara",
      category: "Pertanian",
      heroImage: "/images/hero.jpg",
      variants: [
        { id: 10, label: "Paket 1 Batang", price: 85000, sku: "variant_NO8meDAONBXBZr4lawMCaFOp" },
        { id: 11, label: "Paket 2 Batang", price: 150000 },
      ],
    },
  ];

  const xml = generateGoogleCatalogXml(mockProducts, "https://toko-uji.example");
  assert.deepEqual([...xml.matchAll(/<g:id>([^<]+)<\/g:id>/g)].map((match) => match[1]), ["14001"]);
  assert.ok(!xml.includes("<g:item_group_id>"));
  assert.ok(!xml.includes("<g:size>"));
  assert.ok(xml.includes("<g:link>https://toko-uji.example/produk/bibit-sirsak</g:link>"));
  assert.ok(xml.includes("<g:price>85000 IDR</g:price>"));
});

test("generateGoogleCatalogXml emits g:sale_price when comparePrice is greater than price", () => {
  const mockProducts: CatalogProduct[] = [
    {
      productId: 16001,
      slug: "zivia-tote-bag",
      productName: "ZIVIA Tote Bag",
      category: "Tote Bag",
      heroImage: "/images/zivia.jpg",
      variants: [
        { id: 1, label: "Black", price: 128500, comparePrice: 300000 },
      ],
    },
  ];

  const xml = generateGoogleCatalogXml(mockProducts, "https://toko-uji.example");
  assert.ok(xml.includes("<g:price>300000 IDR</g:price>"));
  assert.ok(xml.includes("<g:sale_price>128500 IDR</g:sale_price>"));
  assert.ok(xml.includes("<g:google_product_category>3032</g:google_product_category>"));
});

test("generateMetaCatalogXml emits valid fb_product_category and matching content_id g:id", () => {
  const mockProducts: CatalogProduct[] = [
    {
      productId: 15005,
      slug: "pompa-air",
      productName: "Pompa Air Portable",
      category: "Alat Rumah Tangga",
      heroImage: "https://r2.example.com/pompa.jpg",
      variants: [{ id: 1, label: "Standard", price: 120000, sku: "variant_ABC123" }],
    },
  ];

  const xml = generateMetaCatalogXml(mockProducts, "https://toko-uji.example");
  assert.ok(xml.includes("<g:id>15005</g:id>"));
  assert.ok(!xml.includes("<g:item_group_id>"));
  assert.ok(xml.includes("<g:fb_product_category>"));
  assert.ok(xml.includes("<g:image_link>https://r2.example.com/pompa.jpg</g:image_link>"));
});

test("a feed omits the ad category it cannot determine", () => {
  // Both platforms treat the category as optional and Google auto-classifies
  // what is missing. Asserting a wrong one is grounds for a Merchant Center
  // misrepresentation suspension — which is what shipping every unclassified
  // product as a handbag would have been, once the bundled handbag catalogue
  // that justified that default was removed.
  const unclassifiable: CatalogProduct[] = [
    {
      productId: 10003,
      slug: "barang-baru",
      productName: "Barang Baru",
      category: "Kategori Sendiri",
      heroImage: "/images/produk-contoh.webp",
      variants: [{ id: 9, label: "Standar", price: 50000 }],
    },
  ];

  const google = generateGoogleCatalogXml(unclassifiable, "https://toko-uji.example");
  const meta = generateMetaCatalogXml(unclassifiable, "https://toko-uji.example");

  assert.ok(!google.includes("<g:google_product_category>"));
  assert.ok(!meta.includes("<g:google_product_category>"));
  assert.ok(!meta.includes("<g:fb_product_category>"));
  // The merchant's own free-text axis is still worth sending.
  assert.ok(google.includes("<g:product_type>Umum &gt; Kategori Sendiri</g:product_type>"));
  // And a product the rules *can* place still carries its category.
  const known = generateGoogleCatalogXml(
    [{ ...unclassifiable[0], category: "Tas Wanita", productName: "Tas Selempang Kulit" }],
    "https://toko-uji.example",
  );
  assert.ok(known.includes("<g:google_product_category>"));
});

// Google caps title at 150 and description at 5000; Meta at 200 and 9999.
// Over the cap an item is disapproved, not truncated — silently, one product at
// a time. `product-mutation.ts` accepts a 160-character title, so a title of
// 151-160 saved cleanly and vanished from Google's approved set.

test("a title Google would reject is trimmed rather than disapproved", () => {
  const longTitle = "Senter LED Mini Super Terang Tahan Air ".repeat(6).trim();
  assert.ok(longTitle.length > 150, "fixture must exceed Google's cap");
  const product: CatalogProduct = {
    productId: 14005,
    slug: "judul-panjang",
    productName: longTitle,
    heroImage: "/images/hero.jpg",
    variants: [{ id: 1, label: "Satuan", price: 89000 }],
  };
  const googleTitle = /<g:title>([^<]*)<\/g:title>/.exec(
    generateGoogleCatalogXml([product], "https://toko-uji.example"),
  )?.[1] ?? "";
  assert.ok(googleTitle.length <= 150, `Google title was ${googleTitle.length}`);
  assert.ok(googleTitle.length > 0, "the item must still be listed");

  const metaTitle = /<g:title>([^<]*)<\/g:title>/.exec(
    generateMetaCatalogXml([product], "https://toko-uji.example"),
  )?.[1] ?? "";
  assert.ok(metaTitle.length <= 200, `Meta title was ${metaTitle.length}`);
  assert.ok(metaTitle.length >= googleTitle.length, "Meta allows at least as much as Google");
});

test("clampFeedText trims on a word boundary when one is close", () => {
  assert.equal(clampFeedText("satu dua tiga empat", 100), "satu dua tiga empat");
  assert.equal(clampFeedText("satu dua tiga empat", 12), "satu dua");
  // No nearby space: a hard cut, and never one character short of it.
  assert.equal(clampFeedText("a".repeat(40), 10), "a".repeat(10));
});

// `identifier_exists: no` and `g:mpn` together contradict each other: the first
// declares the product carries no manufacturer identifier, the second supplies
// one. The `g:mpn` was never truthful either — an MPN is assigned by a
// manufacturer, and `sku` is nullable, merchant-editable and changes whenever
// an operator edits it.

test("the Google feed declares no identifier and never invents one", () => {
  const product: CatalogProduct = {
    productId: 14009,
    slug: "tanpa-mpn",
    productName: "Produk Tanpa MPN",
    heroImage: "/images/hero.jpg",
    variants: [{ id: 1, label: "Satuan", price: 89000, sku: "SKU-YANG-DIEDIT-PEDAGANG" }],
  };
  const xml = generateGoogleCatalogXml([product], "https://toko-uji.example");
  assert.ok(xml.includes("<g:identifier_exists>no</g:identifier_exists>"));
  assert.ok(!xml.includes("<g:mpn>"), "a merchant SKU is not a manufacturer part number");
  assert.ok(!xml.includes("<g:gtin>"));
  assert.ok(
    !xml.includes("SKU-YANG-DIEDIT-PEDAGANG"),
    "the merchant-editable sku must not reach the feed at all",
  );
});

test("the Meta feed carries no identifier claim either", () => {
  const product: CatalogProduct = {
    productId: 14010,
    slug: "meta-tanpa-mpn",
    productName: "Produk Meta",
    heroImage: "/images/hero.jpg",
    variants: [{ id: 1, label: "Satuan", price: 89000, sku: "SKU-LAIN" }],
  };
  const xml = generateMetaCatalogXml([product], "https://toko-uji.example");
  assert.ok(!xml.includes("<g:mpn>"));
  assert.ok(!xml.includes("SKU-LAIN"));
});

test("feeds link the JPEG sibling of an uploaded WebP, since Meta takes JPEG or PNG only", () => {
  const upload = "/assets/uploads/2026-10-08/bd4cac38-d36e-4285-9811-532ebecdb3de.webp";
  assert.equal(feedImagePath(upload), upload.replace(/\.webp$/, ".jpg"));
  // Anything that is not an asset-route upload is left as the merchant set it.
  for (const other of ["/images/produk-contoh.webp", "https://r2.example.com/pompa.webp", "/assets/uploads/2026-10-08/x.png"]) {
    assert.equal(feedImagePath(other), other);
  }
  const product: CatalogProduct = {
    productId: 10004,
    slug: "dompet",
    productName: "Dompet Kulit",
    heroImage: upload,
    variants: [{ id: 1, label: "Hitam", price: 200000 }],
  };
  const jpg = `<g:image_link>https://toko-uji.example${upload.replace(/\.webp$/, ".jpg")}</g:image_link>`;
  assert.ok(generateMetaCatalogXml([product], "https://toko-uji.example").includes(jpg));
  assert.ok(generateGoogleCatalogXml([product], "https://toko-uji.example").includes(jpg));
});
