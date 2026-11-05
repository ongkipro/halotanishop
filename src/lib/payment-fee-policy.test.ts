import assert from "node:assert/strict";
import test from "node:test";
import {
  autoLarisGrandTotal,
  buyerPaymentAdminFee,
  paymentFeeIsSellers,
  recordedAutoLarisBill,
  calculateCodFeeBreakdown,
  COD_EFFECTIVE_RATE_LABEL,
  calculateCodCustomerTotal,
  calculatePaymentAdminFee,
  normalizePaymentFeeBearer,
} from "./payment-fee-policy.ts";

test("payment fee schedule distinguishes BCA, other VA, and QRIS", () => {
  assert.equal(calculatePaymentAdminFee("VABCA", 150_000), 6_500);
  assert.equal(calculatePaymentAdminFee("VAMANDIRI", 150_000), 3_000);
  assert.equal(calculatePaymentAdminFee("QRIS", 150_000), 1_050);
});

test("COD fee is 3% of product plus shipping and VAT is 11% of that fee", () => {
  assert.deepEqual(calculateCodFeeBreakdown(100_000), {
    baseAmount: 100_000,
    serviceFee: 3_000,
    vat: 330,
    totalFee: 3_330,
  });
  assert.deepEqual(calculateCodFeeBreakdown(158_500), {
    baseAmount: 158_500,
    serviceFee: 4_755,
    vat: 524,
    totalFee: 5_279,
  });
});

test("COD fee normalizes invalid and fractional revenue before charging", () => {
  assert.deepEqual(calculateCodFeeBreakdown(-1), {
    baseAmount: 0,
    serviceFee: 0,
    vat: 0,
    totalFee: 0,
  });
  assert.equal(calculateCodFeeBreakdown(100_000.4).baseAmount, 100_000);
});

test("COD bearer changes only the customer total", () => {
  assert.equal(calculateCodCustomerTotal(158_500, "buyer"), 163_779);
  assert.equal(calculateCodCustomerTotal(158_500, "seller"), 158_500);
});

test("buyer bearer asks AutoLaris for the order total plus the fee (PAY-2)", () => {
  // AutoLaris bills exactly grand_total, so the store adds the fee itself.
  assert.equal(autoLarisGrandTotal("VABRI", 170_000, "buyer"), 173_000);
  assert.equal(autoLarisGrandTotal("VABCA", 170_000, "buyer"), 176_500);
  // revenleather INV-10357's order total: the bill now grosses up so the store
  // still receives Rp858.600 after AutoLaris takes 0.7% of the bill.
  assert.equal(autoLarisGrandTotal("QRIS", 858_600, "buyer"), 864_653);
});

test("a buyer-borne fee leaves the store the whole order total (Paduka, 2026-11-02)", () => {
  for (const total of [1, 100, 63_000, 118_400, 229_430, 287_500, 858_600, 4_999_999]) {
    const bill = total + buyerPaymentAdminFee("QRIS", total)!;
    // AutoLaris deducts ceil(0.7%) of what it bills (229.430 gave 1.607).
    assert.equal(bill - Math.ceil(bill * 0.007) >= total, true, `store short on ${total}`);
    assert.equal(bill - 1 - Math.ceil((bill - 1) * 0.007) < total, true, `buyer overcharged on ${total}`);
  }
  assert.equal(buyerPaymentAdminFee("VABCA", 63_000), 6_500);
  assert.equal(buyerPaymentAdminFee("VABRI", 63_000), 3_000);
  assert.equal(buyerPaymentAdminFee("MANUAL_1", 63_000), null);
});

test("seller bearer asks for the order total; the fee comes out of the store's share", () => {
  assert.equal(autoLarisGrandTotal("VABCA", 170_000, "seller"), 170_000);
  assert.equal(autoLarisGrandTotal("QRIS", 287_500, "seller"), 287_500);
  // zvara INV-11432 as AutoLaris answered it: amount 287500, admin 2013, total 287500.
  const recorded = recordedAutoLarisBill(287_500, "seller", { amount: 287_500, admin: 2_013, total: 287_500 });
  assert.deepEqual(recorded, { amount: 287_500, admin: 2_013, total: 287_500 });
  assert.equal(paymentFeeIsSellers({ fee_bearer: "seller", amount: recorded.amount, admin_fee: recorded.admin, total_amount: recorded.total }), true);
});

test("a buyer bill records the order value, the buyer's fee and the billed total", () => {
  // AutoLaris answers amount = total = grand_total and its own admin (0.7% of it).
  const recorded = recordedAutoLarisBill(858_600, "buyer", { amount: 864_653, admin: 6_053, total: 864_653 });
  assert.deepEqual(recorded, { amount: 858_600, admin: 6_053, total: 864_653 });
  assert.equal(paymentFeeIsSellers({ fee_bearer: "buyer", amount: recorded.amount, admin_fee: recorded.admin, total_amount: recorded.total }), false);
  // A buyer row billed before this fix (total equals amount) was the seller's.
  assert.equal(paymentFeeIsSellers({ fee_bearer: "buyer", amount: 858_600, admin_fee: 6_011, total_amount: 858_600 }), true);
});

test("invalid persisted fee bearer fails closed to buyer", () => {
  assert.equal(normalizePaymentFeeBearer("seller"), "seller");
  assert.equal(normalizePaymentFeeBearer("merchant"), "buyer");
  assert.equal(normalizePaymentFeeBearer(null), "buyer");
});

test("the COD rate reads as one figure, derived from the two it combines", () => {
  // 3% service fee + 11% VAT on that fee = 3,33% of price + shipping.
  assert.equal(COD_EFFECTIVE_RATE_LABEL, "3,33%");
  // On a round base the two rounded-up parts land exactly on the figure…
  assert.equal(calculateCodFeeBreakdown(100_000).totalFee, 3_330);
  // …and never more than two rupiah above it anywhere else.
  for (const base of [1, 999, 12_345, 79_000 + 19_681, 250_001]) {
    const flat = base * 0.0333;
    const { totalFee } = calculateCodFeeBreakdown(base);
    assert.ok(totalFee >= flat && totalFee - flat <= 2, `${base}: ${totalFee} vs ${flat}`);
  }
});
