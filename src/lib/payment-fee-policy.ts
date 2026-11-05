import type { AutoLarisCheckoutChannel } from "./autolaris-client.ts";

export type PaymentFeeBearer = "buyer" | "seller";

/**
 * The store's **own** COD service price, not a mirror of the courier's.
 *
 * Mengantar returns its own `codFee` on every quote that asks for it, and the
 * two disagree: measured against the live account on 2026-08-19, Rp50.000,
 * Rp100.000, Rp199.000, Rp333.333 and Rp1.000.000 each came back exactly one
 * rupiah below the figure below. That is not a rounding bug to be chased, and
 * this policy is deliberately not reconciled against the provider quote —
 * settled as a pricing decision (gap COD1).
 *
 * The consequence to keep in mind: because this is a price rather than a
 * reflection, a Mengantar rate change does **not** move it. Changing what the
 * buyer is billed for COD means editing these two rates, deliberately.
 *
 * Each component rounds up independently — the service fee first, then VAT on
 * the rounded fee — which is where the one-rupiah spread comes from and is
 * itself part of the stated price.
 */
export const COD_SERVICE_FEE_RATE = 0.03;
export const COD_SERVICE_FEE_VAT_RATE = 0.11;

/**
 * The two rates as the one figure a buyer or operator reads: 3% × 1.11 =
 * "3,33%" of price + shipping, VAT included. Derived from the rates so the
 * copy moves with them. It describes the price; the charge itself is still
 * computed in two rounded-up parts, which is why a bill can sit a rupiah or
 * two above a flat 3,33%.
 */
export const COD_EFFECTIVE_RATE_LABEL = `${(COD_SERVICE_FEE_RATE * (1 + COD_SERVICE_FEE_VAT_RATE) * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

export type CodFeeBreakdown = {
  baseAmount: number;
  serviceFee: number;
  vat: number;
  totalFee: number;
};

export function calculateCodFeeBreakdown(amount: number): CodFeeBreakdown {
  const baseAmount = Math.max(0, Math.round(amount));
  const serviceFee = Math.ceil(baseAmount * COD_SERVICE_FEE_RATE);
  const vat = Math.ceil(serviceFee * COD_SERVICE_FEE_VAT_RATE);
  return {
    baseAmount,
    serviceFee,
    vat,
    totalFee: serviceFee + vat,
  };
}

export function calculateCodCustomerTotal(
  amount: number,
  bearer: PaymentFeeBearer,
) {
  const fee = calculateCodFeeBreakdown(amount);
  return fee.baseAmount + (bearer === "buyer" ? fee.totalFee : 0);
}

type PaymentFeeRule =
  | { kind: "fixed"; amount: number }
  | { kind: "percentage"; rate: number };

const PAYMENT_FEE_RULES: Record<AutoLarisCheckoutChannel, PaymentFeeRule> = {
  QRIS: { kind: "percentage", rate: 0.007 },
  VABCA: { kind: "fixed", amount: 6_500 },
  VAMANDIRI: { kind: "fixed", amount: 3_000 },
  VABNI: { kind: "fixed", amount: 3_000 },
  VABRI: { kind: "fixed", amount: 3_000 },
  VAPERMATA: { kind: "fixed", amount: 3_000 },
  VABSI: { kind: "fixed", amount: 3_000 },
  VACIMB: { kind: "fixed", amount: 3_000 },
  VADANAMON: { kind: "fixed", amount: 3_000 },
};

export function normalizePaymentFeeBearer(value: unknown): PaymentFeeBearer {
  return value === "seller" ? "seller" : "buyer";
}

export function calculatePaymentAdminFee(
  channel: AutoLarisCheckoutChannel,
  amount: number,
) {
  const normalizedAmount = Math.max(0, Math.round(amount));
  const rule = PAYMENT_FEE_RULES[channel];
  return rule.kind === "fixed"
    ? rule.amount
    : Math.ceil(normalizedAmount * rule.rate);
}

/**
 * The fee a buyer pays on top of the order total so that the store still
 * receives the whole order total once AutoLaris deducts its own fee from the
 * bill (Paduka, 2026-11-02). A fixed VA fee is the fee itself; QRIS grosses up:
 * the smallest bill X with X - ceil(0.7% of X) >= the order total. Null for a
 * code with no AutoLaris fee rule, so a caller can fall back.
 */
export function buyerPaymentAdminFee(channel: string, orderTotal: number) {
  const rule = (PAYMENT_FEE_RULES as Record<string, PaymentFeeRule | undefined>)[channel];
  if (!rule) return null;
  const total = Math.max(0, Math.round(orderTotal));
  if (rule.kind === "fixed") return rule.amount;
  let bill = Math.ceil(total / (1 - rule.rate));
  while (bill - 1 - Math.ceil((bill - 1) * rule.rate) >= total) bill -= 1;
  while (bill - Math.ceil(bill * rule.rate) < total) bill += 1;
  return bill - total;
}

/**
 * What `/api/h2h/submit` is asked to bill. AutoLaris bills the buyer exactly
 * `grand_total` and deducts its admin fee from it (every live transaction since
 * October: provider total = grand_total, PAY-2), so the store chooses who pays
 * here: `seller` sends the order total and receives it minus the fee; `buyer`
 * sends the order total plus `buyerPaymentAdminFee`, the total checkout showed,
 * and the store receives the whole order total.
 */
export function autoLarisGrandTotal(
  channel: AutoLarisCheckoutChannel,
  orderTotal: number,
  bearer: PaymentFeeBearer,
) {
  const total = Math.max(1, Math.round(orderTotal));
  return bearer === "buyer" ? total + (buyerPaymentAdminFee(channel, total) ?? 0) : total;
}

/**
 * The provider's answer as the store records it: `amount` is the order value,
 * `admin_fee` is the fee, `total_amount` is what the QR or VA asks for. On
 * `buyer` the fee is what the buyer pays on top (total minus the order value);
 * on `seller` it is the provider's deduction, so the store receives
 * `total - admin_fee`.
 */
export function recordedAutoLarisBill(
  orderTotal: number,
  bearer: PaymentFeeBearer,
  provider: { amount: number; admin: number; total: number },
) {
  const value = Math.max(1, Math.round(orderTotal));
  return bearer === "buyer"
    ? { amount: value, admin: Math.max(0, provider.total - value), total: provider.total }
    : { amount: provider.amount, admin: provider.admin, total: provider.total };
}

/**
 * Whether a recorded payment's fee came out of the store's revenue. A row that
 * says `buyer` but whose bill did not grow (total equals amount) was billed
 * before the store added the fee itself (PR #164's rule), so it is the seller's.
 */
export function paymentFeeIsSellers(row: {
  fee_bearer?: string | null;
  amount: number;
  admin_fee: number;
  total_amount: number;
}) {
  return row.fee_bearer === "seller" || (row.admin_fee > 0 && row.total_amount === row.amount);
}

export function paymentFeeDescription(channel: AutoLarisCheckoutChannel) {
  const rule = PAYMENT_FEE_RULES[channel];
  return rule.kind === "fixed"
    ? `Biaya admin Rp${new Intl.NumberFormat("id-ID").format(rule.amount)}`
    : "Biaya admin 0,7% dari nilai transaksi";
}
