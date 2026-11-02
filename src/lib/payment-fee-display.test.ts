import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../pages/payment.astro", import.meta.url), "utf8");

test("the payment page never presents a fee the provider did not bill", () => {
  // AutoLaris answers amount, admin and total; total is what the QR or VA asks for.
  assert.match(page, /\(adminFee > 0 && numeric\(payment\.total_amount\) === amount\)/);
  const declared = page.indexOf("const adminFee = numeric(payment.admin_fee);");
  const used = page.indexOf("const sellerBearsFee =");
  assert.ok(declared > 0 && declared < used, "the fee is read before the bearer is decided");
});
