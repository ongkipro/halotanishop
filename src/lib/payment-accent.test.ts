import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// ADR-019: a store re-brands by overriding the --sf-accent tokens, never a call
// site. The payment page is where the buyer pays, so it follows the same tokens.
const source = readFileSync(new URL("../pages/payment.astro", import.meta.url), "utf8");

test("the payment page loads the token layer and carries its root", () => {
  assert.match(source, /import '\.\.\/styles\/form-hybrid\.css'/);
  assert.match(source, /<main data-hybrid-form-root/);
});

test("primary controls take the accent token, not a hard-coded ink", () => {
  assert.doesNotMatch(source, /(?:bg|border)-\[#(?:121212|000000)\]/);
  assert.match(source, /bg-\[var\(--sf-accent\)\]/);
  assert.match(source, /hover:bg-\[var\(--sf-accent-strong\)\]/);
});
