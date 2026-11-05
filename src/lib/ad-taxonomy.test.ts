import assert from "node:assert/strict";
import test from "node:test";
import { getAdTaxonomy } from "./ad-taxonomy.ts";

// Every id/path pair here was checked against the official files named at the
// top of ad-taxonomy.ts. The previous assertions pinned ids that named other
// products (2547 is Placemats, 642 Bread Pans), so a green suite proved nothing.
test("fertilizer maps to Google 113 Fertilizers and Meta's fertilizers", () => {
  const result = getAdTaxonomy("Pertanian", "Pupuk Sawit Ganoderma", "Pupuk pelindung akar kelapa sawit");
  assert.equal(result.googleCategoryId, 113);
  assert.equal(result.googleCategoryName, "Home & Garden > Lawn & Garden > Gardening > Fertilizers");
  assert.equal(result.metaCategoryName, "patio & garden > plant care, soil & accessories > fertilizers");
  assert.equal(result.productType, "Pertanian > Pupuk & Nutrisi");
});

test("skincare maps to Google 567 Skin Care and Meta's skin care", () => {
  const result = getAdTaxonomy("Kecantikan", "Kojic Soap Soap Bar Glowing", "Sabun pemutih wajah dan badan");
  assert.equal(result.googleCategoryId, 567);
  assert.equal(result.googleCategoryName, "Health & Beauty > Personal Care > Cosmetics > Skin Care");
  assert.equal(result.metaCategoryName, "health & beauty > beauty > skin care");
  assert.equal(result.productType, "Kecantikan & Perawatan > Skincare");
});

test("herbal supplements map to Google 525 and send no Meta category", () => {
  const result = getAdTaxonomy("Kesehatan", "Madu Pinang Muda Stamina Pria", "Herbal alami penambah vitalitas");
  assert.equal(result.googleCategoryId, 525);
  assert.equal(result.googleCategoryName, "Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements");
  // Meta's taxonomy has no supplements category; a near miss would be wrong.
  assert.equal(result.metaCategoryName, undefined);
  assert.equal(result.productType, "Kesehatan > Suplemen Herbal");
});

test("kitchen tools map to Google 668 Kitchen Tools & Utensils", () => {
  const result = getAdTaxonomy("Perkakas", "Pengasah Pisau Portable", "Alat asahan pisau dapur serbaguna");
  assert.equal(result.googleCategoryId, 668);
  assert.equal(result.googleCategoryName, "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils");
  assert.equal(result.metaCategoryName, "home > home goods > kitchen & dining > kitchen tools & utensils");
  assert.equal(result.productType, "Perkakas & Rumah Tangga > Alat Dapur");
});

test("leather goods land in their own category, not the handbag parent", () => {
  // A leather-goods catalogue (Reven Leather) filed 66 products as women's
  // handbags, four card holders as Skin Care and every belt as nothing.
  const cases: Array<[string, string, number | undefined, string | undefined]> = [
    ["Dompet & Wallet", "Reven Apollo Long Wallet", 2668, "travel & luggage > handbags & wallets > wallets"],
    ["Aksesoris Kulit", "Reven Saka Card Holder", 2668, "travel & luggage > handbags & wallets > wallets"],
    ["Aksesoris Kulit", "Reven Arca ID Card Holder", 6170, undefined],
    ["Ikat Pinggang / Belt", "Reven Torino Reversible Leather Belt", 169, "clothing & accessories > clothing accessories"],
    ["Sling Bag", "Reven Yunus Sling Bag", 106, "travel & luggage > handbags & wallets > crossbody bags"],
    ["Waist Bag", "Reven Hazar Waist Bag", 104, "travel & luggage > handbags & wallets > belt bags & waist packs"],
    ["Backpack / Tas Ransel", "Reven Osiris Backpack", 100, "travel & luggage > backpacks"],
    ["Handbag & Clutch", "Reven Dewa Exclusive Handbag", 3032, "travel & luggage > handbags & wallets"],
    ["Totebag", "Reven Arcen Multi-Pocket Totebag", 3032, "travel & luggage > handbags & wallets > totes"],
    ["Laptop Sleeve", "Reven Amba Sleeve L", undefined, "travel & luggage > briefcases & laptop bags"],
    ["Aksesoris Kulit", "Reven Premium Leather Balm Care", 628, "home > cleaning supplies > shoe care"],
    ["Aksesoris Kulit", "Reven Pentador Phone Bag", 6551, "travel & luggage > handbags & wallets"],
  ];
  for (const [category, title, googleId, metaPath] of cases) {
    const result = getAdTaxonomy(category, title, "100% kulit sapi asli, garansi 1 tahun");
    assert.equal(result.googleCategoryId, googleId, title);
    assert.equal(result.metaCategoryName, metaPath, title);
  }
});

test("'kulit' alone no longer reads as skin care", () => {
  const result = getAdTaxonomy("Aksesoris Kulit", "Gantungan Kunci Kulit", "Kulit sapi asli");
  assert.equal(result.googleCategoryId, undefined);
  assert.equal(result.productType, "Umum > Aksesoris Kulit");
});

test("an unclassifiable product is submitted with no category at all", () => {
  // The fallback used to be the handbag parent (6551), justified by a bundled handbag
  // catalogue that no longer exists — an install starts empty and sells whatever
  // its merchant sells. Asserting a category the product cannot know is grounds
  // for a Merchant Center misrepresentation suspension; both platforms treat the
  // field as optional and Google auto-classifies what is omitted.
  const result = getAdTaxonomy("Custom Category", "Unclassified Item", "");
  assert.equal(result.googleCategoryId, undefined);
  assert.equal(result.googleCategoryName, undefined);
  assert.equal(result.metaCategoryName, undefined);
  // productType is free text on the merchant's own axis, so it stays useful.
  assert.equal(result.productType, "Umum > Custom Category");
});

test("a description full of foreign keywords cannot outvote the product name", () => {
  // Unweighted keyword counting shipped this handbag as fertilizer: the description
  // hits buah + daun + tanaman, the title only tas + selempang.
  const result = getAdTaxonomy(
    "Tas Wanita",
    "Tas Selempang Kulit Sintetis",
    "Kulit sintetis, cocok untuk buah tangan; ringan seperti daun kering dan awet dipakai di antara tanaman hias",
  );
  assert.equal(result.googleCategoryId, 106);
  // Proves the bag rule won on merit rather than the request falling through
  // to the default, which would have produced "Umum > Tas Wanita".
  assert.equal(result.productType, "Tas & Dompet > Sling Bag");
});

test("a skincare product is not reclassified as soap by its own usage notes", () => {
  const result = getAdTaxonomy(
    "Kecantikan",
    "Serum Wajah Glowing",
    "Aman untuk kulit sensitif; pakai setelah mandi dengan sabun cleanser atau body wash, bukan soap batangan",
  );
  assert.equal(result.googleCategoryId, 567);
  assert.equal(result.productType, "Kecantikan & Perawatan > Skincare");
});

test("keywords match whole words, not substrings inside other words", () => {
  // "kertas" contains "tas", "bagus" contains "bag" — two phantom handbag hits that
  // used to tie with, and therefore beat, the two real electronics hits.
  const result = getAdTaxonomy(
    "Elektronik",
    "Kabel Data",
    "Sebuah kabel bagus, dibungkus kertas daur ulang, panjang 1 meter",
  );
  assert.equal(result.googleCategoryId, 222);
  assert.equal(result.productType, "Elektronik & Gadget");
});

test("an ambiguous product emits no category rather than guessing", () => {
  // "sabun" (soap) and "serum" (skin care) score identically and nothing else
  // separates them. A coin flip in a Merchant Center feed is the worst option.
  const result = getAdTaxonomy("Perawatan", "Sabun Serum", "");
  assert.equal(result.googleCategoryId, undefined);
  assert.equal(result.productType, "Umum > Perawatan");
});

test("a plant product titled only Kojien is not filed under Skin Care (taniniaga, 2026-11-03)", () => {
  // Its title alone used to win the skincare rule; with a plant-nutrient
  // description it now earns no category rather than a wrong one.
  const plant = getAdTaxonomy("Umum", "Kojien", "Nutrisi pelindung sel tanaman bio-silika untuk padi dan jagung");
  assert.notEqual(plant.googleCategoryId, 567);
  assert.notEqual(plant.productType, "Kecantikan & Perawatan > Skincare");
  // A genuine kojic-acid skincare product still maps to Skin Care.
  assert.equal(getAdTaxonomy("Kecantikan", "Kojic Acid Soap Pemutih", "sabun wajah").googleCategoryId, 567);
});
