import assert from "node:assert/strict";
import test from "node:test";
import type { Product } from "../data/products.ts";
import { mergeStorefrontCatalog } from "./catalog-data.ts";
import { generateGoogleCatalogXml } from "./catalog-feed.ts";

function runtimePresentation(productId: string): Product {
  return {
    slug: "presentation-slug",
    productId,
    productName: "Presentation Name",
    contentName: "Merchant presentation",
    headline: "Merchant-authored headline",
    subheadline: "Merchant-authored subheadline",
    seoTitle: "Merchant SEO title",
    seoDescription: "Merchant SEO description",
    price: 1,
    image: "/images/adsbook-icon.svg",
    heroImage: "/images/adsbook-icon.svg",
    images: ["/images/adsbook-icon.svg"],
    tag: "Merchant tag",
    category: "Presentation category",
    relatedCategories: ["Merchant category"],
    description: "Merchant-authored description",
    benefits: ["Merchant benefit"],
    keyPoints: ["Merchant key point"],
    idealFor: ["Merchant audience"],
    offerText: "Merchant offer",
    ctaText: "Merchant CTA",
    reviews: [],
    variants: [],
  };
}

const completeProductRow = {
  id: 50001,
  title: "Pupuk Organik Super",
  slug: "pupuk-organik-super",
  category: "Pupuk",
  image_url: "/assets/uploads/pupuk.webp",
  is_active: 1,
};

const completeVariantRows = [
  {
    id: 60001,
    product_id: 50001,
    sku: "PUPUK-1L",
    title: "1 Liter",
    price: 120000,
    compare_price: 150000,
    stock: 50,
  },
  {
    id: 60002,
    product_id: 50001,
    sku: "PUPUK-2L",
    title: "2 Liter",
    price: 200000,
    compare_price: null,
    stock: 0,
  },
];

test("empty D1 product rows always produce an empty public catalog", () => {
  assert.deepEqual(
    mergeStorefrontCatalog([], [], [runtimePresentation("50001")]),
    [],
  );
});

test("D1 rows are the sole source of public identity, image, price, and variants", () => {
  const products = mergeStorefrontCatalog(
    [completeProductRow],
    completeVariantRows,
    [
      runtimePresentation("50001"),
      runtimePresentation("99999"),
    ],
  );

  assert.equal(products.length, 1);
  assert.equal(products[0].productId, "50001");
  assert.equal(products[0].productName, "Pupuk Organik Super");
  assert.equal(products[0].slug, "pupuk-organik-super");
  assert.equal(products[0].category, "Pupuk");
  assert.equal(products[0].image, "/assets/uploads/pupuk.webp");
  assert.equal(products[0].heroImage, "/assets/uploads/pupuk.webp");
  assert.deepEqual(products[0].images, ["/assets/uploads/pupuk.webp"]);
  assert.equal(products[0].headline, "Merchant-authored headline");
  assert.equal(products[0].price, 120000);
  // Both variants publish. The second carries `stock: 0`, which used to
  // remove it from the storefront — the merchant sells on demand and a
  // counter must not decide what is on sale (ADR-023).
  assert.deepEqual(products[0].variants, [
    {
      catalogId: 60001,
      sku: "PUPUK-1L",
      id: "60001",
      label: "1 Liter",
      price: 120000,
      comparePrice: 150000,
    },
    {
      catalogId: 60002,
      sku: "PUPUK-2L",
      id: "60002",
      label: "2 Liter",
      price: 200000,
    },
  ]);
  assert.ok(!products.some((product) => product.productId === "99999"));
});

test("active products fail closed without complete merchant data", () => {
  const invalidProducts = [
    { ...completeProductRow, is_active: 0 },
    { ...completeProductRow, title: " " },
    { ...completeProductRow, slug: " " },
    { ...completeProductRow, image_url: null },
  ];

  for (const product of invalidProducts) {
    assert.deepEqual(
      mergeStorefrontCatalog([product], completeVariantRows),
      [],
    );
  }

  for (const variant of [
    { ...completeVariantRows[0], title: " " },
    { ...completeVariantRows[0], price: 0 },
  ]) {
    assert.deepEqual(
      mergeStorefrontCatalog([completeProductRow], [variant]),
      [],
    );
  }
});

test("a variant publishes whatever its stock figure says", () => {
  // The regression this locks: a merchant who never restocks the counter, or
  // whose counter reached zero through past sales, kept a live product that
  // silently vanished from the storefront and could not be bought.
  for (const stock of [0, null, -3, undefined]) {
    const [product] = mergeStorefrontCatalog(
      [completeProductRow],
      [{ ...completeVariantRows[0], stock } as (typeof completeVariantRows)[0]],
    );
    assert.equal(product?.variants.length, 1, `stock ${String(stock)} must stay sellable`);
    assert.equal(product?.variants[0].catalogId, 60001);
  }
});

test("missing D1 product image is never replaced with an AdsBookCMS asset", () => {
  const products = mergeStorefrontCatalog(
    [{ ...completeProductRow, image_url: null }],
    completeVariantRows,
    [runtimePresentation("50001")],
  );

  assert.deepEqual(products, []);
  assert.doesNotMatch(JSON.stringify(products), /adsbook-(mark\.webp|icon\.svg)/);
});

test("a product's own brand reaches the feed; a product without one falls back to the store", () => {
  const branded = mergeStorefrontCatalog(
    [{ ...completeProductRow, brand: "  AUSSIE  " }],
    completeVariantRows,
    [runtimePresentation("50001")],
  );
  assert.equal(branded[0].brand, "AUSSIE");
  const xml = generateGoogleCatalogXml(branded, "https://toko.test", "Toko Contoh");
  assert.match(xml, /<g:brand>AUSSIE<\/g:brand>/);
  assert.doesNotMatch(xml, /<g:brand>Toko Contoh<\/g:brand>/);

  for (const brand of [null, "", "   "]) {
    const unbranded = mergeStorefrontCatalog(
      [{ ...completeProductRow, brand }],
      completeVariantRows,
    );
    assert.equal("brand" in unbranded[0], false, JSON.stringify(brand));
    assert.match(
      generateGoogleCatalogXml(unbranded, "https://toko.test", "Toko Contoh"),
      /<g:brand>Toko Contoh<\/g:brand>/,
    );
  }
});

test("a product's price is its cheapest variant, whatever order D1 returns them in", () => {
  const [product] = mergeStorefrontCatalog(
    [completeProductRow],
    [...completeVariantRows].reverse(),
  );
  // The 2 L variant now comes first; the product still lists from the 1 L.
  assert.equal(product.variants[0].price, 200000);
  assert.equal(product.price, 120000);
  assert.equal(product.comparePrice, 150000);
});

test("the feed and the product page agree on price, and the merchant's own description leads", () => {
  const [product] = mergeStorefrontCatalog(
    [{ id: 14321, title: "Sabun Cair", slug: "sabun-cair", category: "Rumah", brand: "Bersih", description: "Sabun cair 1 liter, aroma lemon.", image_url: "/images/a.jpg", is_active: 1 }],
    [
      // The large size was entered first; the cheaper one is the "from" price.
      { id: 2, product_id: 14321, title: "1 L", price: 120000, compare_price: 150000 },
      { id: 3, product_id: 14321, title: "250 ml", price: 97500, compare_price: 110000 },
    ],
  );
  assert.equal(product.price, 97500);
  const xml = generateGoogleCatalogXml([product], "https://toko.example", "Toko Contoh");
  assert.match(xml, /<g:price>110000 IDR<\/g:price>/);
  assert.match(xml, /<g:sale_price>97500 IDR<\/g:sale_price>/);
  assert.doesNotMatch(xml, /120000 IDR/);
  assert.match(xml, /<g:description>Sabun cair 1 liter, aroma lemon\.<\/g:description>/);
  assert.match(xml, /<g:brand>Bersih<\/g:brand>/);
  assert.equal(product.seoDescription, "Sabun cair 1 liter, aroma lemon.");
});

test("a product with no description describes itself from its own fields, never the page", () => {
  const [product] = mergeStorefrontCatalog(
    [{ id: 14322, title: "Lampu Taman", slug: "lampu-taman", category: "Outdoor", image_url: "/images/b.jpg", is_active: 1 }],
    [
      { id: 4, product_id: 14322, title: "Putih", price: 45000 },
      { id: 5, product_id: 14322, title: "Kuning", price: 47000 },
    ],
  );
  assert.equal(product.description, "Lampu Taman, kategori Outdoor. Tersedia 2 pilihan: Putih, Kuning.");
  assert.match(product.seoDescription, /^Lampu Taman, kategori Outdoor\. .*Mulai Rp45\.000\.$/);
  assert.ok(product.seoDescription.length <= 155);
  assert.doesNotMatch(product.description, /katalog toko/);
});

test("a chosen Google category is sent exactly, and Meta gets it instead of a guess", async () => {
  const { generateMetaCatalogXml } = await import("./catalog-feed.ts");
  const [product] = mergeStorefrontCatalog(
    [{ id: 14323, title: "Dompet Kulit", slug: "dompet-kulit", category: "Dompet", google_category_id: 2503, google_category_path: "Health & Beauty > Personal Care > Cosmetics > Bath & Body > Bar Soap", image_url: "/images/c.jpg", is_active: 1 }],
    [{ id: 6, product_id: 14323, title: "Coklat", price: 150000 }],
  );
  const google = generateGoogleCatalogXml([product], "https://toko.example", "Toko");
  assert.match(google, /<g:google_product_category>2503<\/g:google_product_category>/);
  assert.match(google, /<g:product_type>Health &amp; Beauty &gt; Personal Care &gt; Cosmetics &gt; Bath &amp; Body &gt; Bar Soap<\/g:product_type>/);
  const meta = generateMetaCatalogXml([product], "https://toko.example", "Toko");
  assert.match(meta, /<g:google_product_category>2503<\/g:google_product_category>/);
  // "Dompet" alone would make the keyword engine guess a Meta wallet category.
  assert.doesNotMatch(meta, /fb_product_category/);
});
