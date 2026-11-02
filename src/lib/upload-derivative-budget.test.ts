import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync(new URL("../pages/api/admin/upload-r2.ts", import.meta.url), "utf8");
const form = readFileSync(new URL("../components/admin/ProductForm.tsx", import.meta.url), "utf8");

test("a card derivative neither checks nor spends the hourly upload budget", () => {
  const peeks = route.match(/checkRateLimit\(/g) ?? [];
  assert.equal(peeks.length, 2, "one peek and one spend");
  for (const match of route.matchAll(/checkRateLimit\(/g)) {
    const before = route.slice(Math.max(0, match.index! - 120), match.index);
    assert.match(before, /!derivativeOf/, "every budget call is skipped for a derivative");
  }
});

test("the product form reports a derivative that failed instead of swallowing it", () => {
  assert.match(form, /cardMissing/);
  assert.doesNotMatch(form, /deliberately ignored/);
});

test("the asset route does not pin a stand-in body for a year", () => {
  const assets = readFileSync(new URL("../pages/assets/[...key].ts", import.meta.url), "utf8");
  assert.match(assets, /standIn \? 'public, max-age=600'/);
  assert.equal((assets.match(/standIn = Boolean\(object\)/g) ?? []).length, 2, "both fallbacks mark the stand-in");
});

test("every admin image upload a card can show stores its -sm twin through one helper", () => {
  const editor = readFileSync(new URL("../components/admin/LandingPageEditor.tsx", import.meta.url), "utf8");
  for (const [name, source] of [["ProductForm", form], ["LandingPageEditor", editor]] as const) {
    assert.match(source, /uploadCardDerivative\(/, `${name} stores the card twin`);
  }
});

test("the landing editor reads the upload route's own shape", () => {
  const editor = readFileSync(new URL("../components/admin/LandingPageEditor.tsx", import.meta.url), "utf8");
  // upload-r2 answers `jsonOk({ url, fileName })`, i.e. `{ success, url, fileName }`.
  assert.match(route, /jsonOk\(\{\s*url:/);
  assert.doesNotMatch(editor, /payload\.data\.url/);
  assert.match(editor, /src: String\(payload\.url\)/);
});
