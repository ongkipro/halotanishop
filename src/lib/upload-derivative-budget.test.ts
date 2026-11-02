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
