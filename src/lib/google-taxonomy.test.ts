import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { searchTaxonomy, suggestGoogleCategories, taxonomyLeaf, type TaxonomyRow } from "./google-taxonomy.ts";

const data = JSON.parse(readFileSync("public/data/google-product-taxonomy.json", "utf8")) as {
  version: string;
  categories: TaxonomyRow[];
};

test("the shipped taxonomy is Google's full list with ids", () => {
  assert.match(data.version, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(data.categories.length > 5000);
  // 2503 read from Google's file, not from memory.
  const soap = data.categories.find(([id]) => id === 2503);
  assert.ok(soap, "id 2503 is in the list");
  assert.equal(soap![1], "Health & Beauty > Personal Care > Cosmetics > Bath & Body > Bar Soap");
  assert.equal(new Set(data.categories.map(([id]) => id)).size, data.categories.length, "ids are unique");
});

test("an Indonesian query finds the English category, most specific first", () => {
  const [top] = searchTaxonomy(data.categories, "sabun");
  assert.match(top[1], /Soap/);
  const vinegar = searchTaxonomy(data.categories, "cuka");
  assert.ok(vinegar.some(([, path]) => /Vinegar/.test(path)));
  // More matched words rank first; one known word is still enough.
  const [apple] = searchTaxonomy(data.categories, "cuka apel");
  assert.match(apple[1], /Vinegar/);
  assert.ok(searchTaxonomy(data.categories, "pembersih panci").length > 0);
  // Word starts only: "lamps" is not "Clamps".
  assert.ok(searchTaxonomy(data.categories, "lampu").every(([, path]) => !/Clamps/.test(path.split(" > ").pop()!)));
});

test("an id finds exactly its row, and a leaf is the last segment", () => {
  assert.deepEqual(searchTaxonomy(data.categories, "2503").map(([id]) => id), [2503]);
  assert.deepEqual(searchTaxonomy(data.categories, "   "), []);
  assert.equal(taxonomyLeaf("Health & Beauty > Personal Care > Cosmetics"), "Cosmetics");
});

test("a product is offered categories from its own name, the engine's confident rule first", () => {
  const wallet = suggestGoogleCategories(data.categories, { title: "Dompet Kulit Pria", category: "Umum" });
  // 2668 is the keyword engine's wallet rule (ad-taxonomy.ts), read from its table.
  assert.equal(wallet[0][0], 2668);
  assert.ok(wallet.length > 1 && wallet.length <= 4);
  const vinegar = suggestGoogleCategories(data.categories, { title: "Cuka Sari Apel 100% Original" });
  assert.match(vinegar[0][1], /Vinegar/);
  assert.deepEqual(suggestGoogleCategories(data.categories, { title: "" }), []);
});
