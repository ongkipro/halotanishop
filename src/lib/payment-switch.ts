/**
 * An operator moving a COD order to a prepaid method from the admin order page,
 * when the buyer asks to pay first (transfer or VA) instead of on delivery.
 *
 * One direction only: COD → manual transfer, or COD → an AutoLaris VA/QRIS
 * channel the store has live. Prepaid never goes back to COD here — that would
 * re-open the COD province rule, the COD courier filter and a live VA to void.
 *
 * The order must still be untouched by fulfilment: pending, unpaid, not void,
 * not dispatched or being dispatched, and carrying a real courier and
 * destination. A middle-form order before the operator completes the address,
 * or one on the city-average `ICO` placeholder rate, has no price a prepaid
 * buyer could be billed (see shipping-quote.ts): the operator completes the
 * address and courier first, then switches.
 *
 * Money: the prepaid total is items − discount + shipping, the same base the
 * COD fee was computed on, with the COD fee dropped. The courier price is the
 * same for COD and prepaid (the COD amount is never sent to the rate quote),
 * so shipping carries over unchanged. A VA admin fee, when the buyer bears
 * it, is added by the payment transaction exactly as at checkout.
 *
 * What was already said about the sale stays said. The Meta Purchase a COD
 * order sent from /thanks keeps its event_id (the order number), so the paid
 * Purchase that follows a switch is deduplicated against it. A Kelola push
 * that already happened keeps saying COD — Kelola answers a resend of the same
 * order code as a duplicate and has no update route — so the order records
 * `payment_switched_from/_at/_by` and the admin order page tells the operator
 * to correct it in Kelola by hand. An order Kelola has not accepted yet is pushed
 * later with the new method, because the push reads the order as it stands.
 */
import {
  AUTOLARIS_CHANNEL_OPTIONS,
  autoLarisChannelLockReason,
  isAutoLarisCheckoutChannel,
  resolveDisabledAutoLarisChannels,
  type AutoLarisCheckoutChannel,
} from "./autolaris-client.ts";
import { createAutoLarisPaymentForOrder, recordFailedPaymentAttempt } from "./autolaris-payment.ts";
import { getEnvValue, getRuntimeEnv } from "./env.ts";
import { paymentBrandLabel } from "./payment-brand.ts";
import { autoLarisOrderRailGap, getProviderConfig } from "./provider-config.ts";

export type PaymentSwitchTarget =
  | { payment_method: "manual_transfer"; seller_bank_account_id: number }
  | { payment_method: "bank_transfer" | "qris"; payment_channel: AutoLarisCheckoutChannel };

/** The order columns that decide whether a switch is still possible. */
export type PaymentSwitchOrder = {
  payment_method: string | null;
  payment_status: string | null;
  shipping_status: string | null;
  stock_restored_at: string | null;
  provider_order_id: string | null;
  provider_dispatch_error: string | null;
  courier_code: string | null;
  destination_area_id: string | null;
  district: string | null;
};

export class PaymentSwitchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** The prepaid total: the base the COD fee was computed on, without the fee. */
export function prepaidTotal(itemTotal: number, discount: number, shipping: number) {
  return Math.max(0, itemTotal - discount + shipping);
}

/** Why this order can no longer leave COD, or null when it can. */
export function paymentSwitchBlockReason(order: PaymentSwitchOrder): string | null {
  if (order.payment_method !== "cod") return "Pesanan ini sudah memakai pembayaran non-COD.";
  if (order.shipping_status !== "pending" || order.stock_restored_at) return "Pesanan sudah diproses atau dibatalkan.";
  if (order.payment_status !== "unpaid") return "Status pembayaran pesanan sudah berubah.";
  if (order.provider_order_id || order.provider_dispatch_error === "DISPATCHING") {
    return "Pesanan sedang atau sudah dikirim ke kurir.";
  }
  const courier = (order.courier_code || "").trim().toUpperCase();
  if (!courier || courier === "ICO" || !order.destination_area_id || !(order.district || "").trim()) {
    return "Alamat, kecamatan atau kurir belum final. Lengkapi lewat Edit pembeli & alamat, lalu ganti pembayaran.";
  }
  return null;
}

/**
 * What the admin order page shows about switching: for a COD order, whether
 * it can still move to transfer/VA and the total it would then carry; for an
 * unpaid prepaid order, the buyer's own /payment page to send them (the
 * fragment locator never reaches a server or a referrer).
 */
type BuyerOrderLocator = {
  id: number;
  public_status_token: string | null;
  payment_method: string | null;
  payment_status: string | null;
  stock_restored_at: string | null;
};

/** The buyer's /payment page for an unpaid prepaid order, or null. */
function buyerPaymentPath(order: BuyerOrderLocator) {
  const paid = ["paid", "settled", "success"].includes(String(order.payment_status));
  return order.payment_method !== "cod" && !paid && !order.stock_restored_at && order.public_status_token
    ? `/payment#o=${order.id}&t=${encodeURIComponent(order.public_status_token)}`
    : null;
}

/**
 * The origin a link sent to a buyer starts with: the store's configured site,
 * never the host an operator happens to have the admin open on (a
 * `*.workers.dev` preview, a Tailscale IP, localhost). The request origin is
 * only the fallback for an install that has not set its site URL yet, whose
 * tenant still carries the `https://example.com` placeholder.
 */
export function buyerLinkOrigin(siteUrl: string | undefined, requestOrigin: string) {
  return siteUrl && siteUrl !== "https://example.com" ? siteUrl : requestOrigin;
}

/**
 * The buyer's own pages as absolute links a WhatsApp message can carry: the
 * order on /thanks and, while it is payable, /payment. Never an /admin path
 * (audit 2026-10-31 H2) — the buyer cannot open one.
 */
export function buyerOrderLinks(origin: string, order: BuyerOrderLocator) {
  const payment = buyerPaymentPath(order);
  return {
    order_details_link: order.public_status_token
      ? `${origin}/thanks#o=${order.id}&t=${encodeURIComponent(order.public_status_token)}`
      : null,
    epayment_link: payment ? `${origin}${payment}` : null,
  };
}

export function adminPaymentSwitchView(
  order: PaymentSwitchOrder & {
    id: number;
    public_status_token: string | null;
    discount_amount: number | null;
    shipping_cost: number | null;
  },
  itemTotal: number,
) {
  const reason = paymentSwitchBlockReason(order);
  return {
    payment_switch:
      order.payment_method === "cod"
        ? {
            available: reason === null,
            reason,
            total_amount: prepaidTotal(itemTotal, Number(order.discount_amount || 0), Number(order.shipping_cost || 0)),
          }
        : null,
    payment_link: buyerPaymentPath(order),
  };
}

/** Parse the request body; null when it names no valid prepaid target. */
export function parsePaymentSwitchTarget(value: unknown): PaymentSwitchTarget | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.payment_method === "manual_transfer") {
    const id = Number(input.seller_bank_account_id);
    return Number.isInteger(id) && id > 0 ? { payment_method: "manual_transfer", seller_bank_account_id: id } : null;
  }
  const channel = String(input.payment_channel || "").trim().toUpperCase();
  const option = AUTOLARIS_CHANNEL_OPTIONS.find((candidate) => candidate.code === channel);
  if (!option || !isAutoLarisCheckoutChannel(channel) || input.payment_method !== option.paymentMethod) return null;
  return { payment_method: option.paymentMethod, payment_channel: channel };
}

/** The same readiness /api/payment-methods reports for one channel; null = usable. */
async function autoLarisChannelUnavailable(
  database: D1Database,
  locals: App.Locals,
  channel: AutoLarisCheckoutChannel,
): Promise<string | null> {
  const lock = autoLarisChannelLockReason(channel);
  if (lock) return lock;
  const [provider, store, warehouse] = await Promise.all([
    getProviderConfig(database, locals).then((config) => config.autolaris),
    database
      .prepare("SELECT is_autolaris_enabled, disabled_autolaris_channels FROM stores ORDER BY id LIMIT 1")
      .first<{ is_autolaris_enabled: number | null; disabled_autolaris_channels: string | null }>(),
    database.prepare("SELECT address FROM warehouses ORDER BY id LIMIT 1").first<{ address: string | null }>(),
  ]);
  if (store?.is_autolaris_enabled === 0) return "AutoLaris dinonaktifkan oleh toko.";
  const env = getRuntimeEnv(locals);
  const gap = autoLarisOrderRailGap({
    apiKey: provider.apiKey,
    originId: getEnvValue("AUTOLARIS_ORDER_ORIGIN_ID", env),
    destinationId: getEnvValue("AUTOLARIS_ORDER_DESTINATION_ID", env),
    warehouseAddress: warehouse?.address,
  });
  if (gap) return gap;
  return resolveDisabledAutoLarisChannels(store?.disabled_autolaris_channels).includes(channel)
    ? "Channel dinonaktifkan oleh toko."
    : null;
}

/**
 * Move one COD order to a prepaid method. Throws PaymentSwitchError with the
 * operator-facing reason when the order or the target refuses; an AutoLaris
 * failure after the switch is not thrown — the order is prepaid by then and
 * keeps a failed transaction row the buyer can regenerate from /payment,
 * exactly as a checkout whose first provider call failed.
 */
export async function switchCodOrderPayment(
  database: D1Database,
  locals: App.Locals,
  orderId: number,
  target: PaymentSwitchTarget,
  switchedBy: string,
  now = new Date(),
): Promise<void> {
  const order = await database
    .prepare(
      `SELECT o.id, o.order_number, o.store_id, o.payment_method, o.payment_status, o.shipping_status,
              o.stock_restored_at, o.provider_order_id, o.provider_dispatch_error, o.courier_code,
              o.destination_area_id, o.district, o.total_amount, o.shipping_cost,
              COALESCE(o.discount_amount, 0) AS discount_amount,
              (SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_total
       FROM orders o WHERE o.id = ?`,
    )
    .bind(orderId)
    .first<PaymentSwitchOrder & {
      id: number;
      order_number: string;
      store_id: number;
      total_amount: number;
      shipping_cost: number;
      discount_amount: number;
      item_total: number;
    }>();
  if (!order) throw new PaymentSwitchError("Order tidak ditemukan.", 404);
  const blocked = paymentSwitchBlockReason(order);
  if (blocked) throw new PaymentSwitchError(blocked, 409);

  let bank: { id: number; bank_code: string; account_holder: string; account_number: string } | null = null;
  if (target.payment_method === "manual_transfer") {
    bank = await database
      .prepare(
        `SELECT id, bank_code, account_holder, account_number FROM seller_bank_accounts
         WHERE id = ? AND store_id = ? AND is_active = 1 LIMIT 1`,
      )
      .bind(target.seller_bank_account_id, order.store_id)
      .first<{ id: number; bank_code: string; account_holder: string; account_number: string }>();
    if (!bank) throw new PaymentSwitchError("Rekening transfer tidak tersedia.", 422);
  } else {
    const unavailable = await autoLarisChannelUnavailable(database, locals, target.payment_channel);
    if (unavailable) throw new PaymentSwitchError(unavailable, 422);
  }

  const totalAmount = prepaidTotal(
    Number(order.item_total),
    Number(order.discount_amount),
    Number(order.shipping_cost),
  );
  // Every precondition is repeated in the WHERE, and the total is compared as
  // read: a dispatch claim, an admin edit or a second tab landing between the
  // read and this write leaves the order as it was.
  const result = await database
    .prepare(
      `UPDATE orders SET
         payment_method = ?, payment_status = 'pending', total_amount = ?,
         cod_service_fee = 0, cod_service_fee_vat = 0,
         seller_bank_account_id = ?, seller_bank_code = ?, seller_bank_name = ?,
         seller_account_holder = ?, seller_account_number = ?,
         payment_switched_from = 'cod', payment_switched_at = ?, payment_switched_by = ?,
         -- A resubmitted COD checkout must not be handed this order back as COD.
         checkout_fingerprint = NULL
       WHERE id = ? AND payment_method = 'cod' AND payment_status = 'unpaid'
         AND shipping_status = 'pending' AND stock_restored_at IS NULL
         AND provider_order_id IS NULL AND COALESCE(provider_dispatch_error, '') <> 'DISPATCHING'
         AND total_amount = ?`,
    )
    .bind(
      target.payment_method,
      totalAmount,
      bank?.id ?? null,
      bank?.bank_code ?? null,
      bank ? paymentBrandLabel(bank.bank_code) : null,
      bank?.account_holder ?? null,
      bank?.account_number ?? null,
      now.toISOString(),
      switchedBy.slice(0, 120),
      order.id,
      order.total_amount,
    )
    .run();
  if (!result.meta?.changes) throw new PaymentSwitchError("Pesanan baru saja berubah. Muat ulang halaman.", 409);

  if (target.payment_method === "manual_transfer") return;
  try {
    await createAutoLarisPaymentForOrder(database, locals, { orderId: order.id, channelCode: target.payment_channel });
  } catch (error) {
    console.error("payment-switch-autolaris-error", error);
    await recordFailedPaymentAttempt(
      database,
      { id: order.id, orderNumber: order.order_number, totalAmount },
      target.payment_channel,
      error instanceof Error ? error.message : String(error),
    );
  }
}
