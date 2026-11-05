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

test("the thanks page hides a QRIS/VA fee the seller bears, wherever it shows the fee", () => {
  const thanks = readFileSync(new URL("../pages/thanks.astro", import.meta.url), "utf8");
  assert.match(thanks, /const sellerBearsPaymentFee = pick\('payment_fee_bearer', 'buyer'\) === 'seller'/);
  const shown = thanks.split("document.getElementById('payment-admin-fee').textContent").length - 1;
  const hidden = thanks.split("document.getElementById('payment-admin-fee-row').hidden = sellerBearsPaymentFee").length - 1;
  assert.ok(shown > 0 && shown === hidden, "every place that fills the fee also hides it for the seller");
});
