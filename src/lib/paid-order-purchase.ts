/**
 * Server-side Meta Purchase for an order that became paid after the buyer had
 * left (A-166).
 *
 * The browser Purchase fires from `/thanks`, and a buyer whose VA is confirmed
 * by an operator hours later never revisits it. This enqueues the same event
 * from the order row alone — `event_id` is the order number on both legs, and
 * the outbox's unique index on it means a Purchase already sent by `/thanks`
 * (or already queued) is a no-op here. It is deliberately best-effort: a
 * failure to enqueue must never undo a payment confirmation.
 */
import { catalogProductId } from "./catalog-feed.ts";
import { deliverCapiEvent, drainCapiOutbox, enqueueCapiEvent } from "./capi-outbox.ts";
import { getStoreAdsConfig } from "./store-ads.ts";
import { toE164Digits } from "./meta-capi.ts";
import { parseMetaOrderContext } from "./meta-order-context.ts";
import { parseClickIds } from "./click-ids.ts";
import { matchableCustomerEmail } from "./autolaris-payment.ts";

type PaidOrderRow = {
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  province: string;
  city: string;
  postal_code: string | null;
  payment_status: string;
  ad_click_ids: string | null;
  meta_request_context: string | null;
  product_value: number;
};

type OrderProductRow = { product_id: number; title: string };

export type PaidOrderPurchaseResult =
  | { status: "queued"; delivered: boolean }
  | { status: "deduplicated" }
  | { status: "skipped"; reason: string };

const PAID_STATUSES = new Set(["paid", "settled", "success"]);

/**
 * Whether an operator's payment edit is the moment a manual transfer becomes a
 * Purchase. The buyer paid into the seller's own account, often after a
 * WhatsApp chat, so `/thanks` never saw it paid and only the operator can.
 * COD stays out on purpose: its Purchase is the persisted order, sent from
 * `/thanks`, and courier remittance must not report it a second time.
 */
export function manualTransferBecamePaid(
  paymentMethod: string,
  previousStatus: string,
  nextStatus: string,
): boolean {
  return (
    paymentMethod === "manual_transfer" &&
    PAID_STATUSES.has(nextStatus) &&
    !PAID_STATUSES.has(previousStatus)
  );
}

export async function enqueuePurchaseForPaidOrder(
  database: D1Database,
  locals: App.Locals,
  orderId: number,
): Promise<PaidOrderPurchaseResult> {
  const ads = await getStoreAdsConfig(locals);
  if (!ads.metaPixelId || !ads.metaCapiToken) {
    return { status: "skipped", reason: "meta-not-configured" };
  }
  const order = await database
    .prepare(
      `SELECT o.order_number, o.customer_name, o.customer_phone, o.customer_email,
              o.province, o.city, o.postal_code, o.payment_status,
              o.ad_click_ids, o.meta_request_context,
              (SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)
                 FROM order_items oi WHERE oi.order_id = o.id) AS product_value
         FROM orders o
        WHERE o.id = ?
        LIMIT 1`,
    )
    .bind(orderId)
    .first<PaidOrderRow>();
  if (!order) return { status: "skipped", reason: "order-not-found" };
  if (!PAID_STATUSES.has(String(order.payment_status).toLowerCase())) {
    return { status: "skipped", reason: "order-not-paid" };
  }
  const products = await database
    .prepare(
      `SELECT DISTINCT p.id AS product_id, p.title
         FROM order_items oi
         INNER JOIN product_variants pv ON pv.id = oi.variant_id
         INNER JOIN products p ON p.id = pv.product_id
        WHERE oi.order_id = ?`,
    )
    .bind(orderId)
    .all<OrderProductRow>();
  const rows = products.results ?? [];
  const contentIds: string[] = [];
  for (const row of rows) {
    try {
      contentIds.push(catalogProductId(row.product_id));
    } catch {
      // A product whose id cannot form a catalogue id simply carries no content_id.
    }
  }

  const siteUrl = locals.tenant?.siteUrl || "https://example.com";
  // This Purchase is sent from a cron or an admin confirmation, long after the
  // buyer's browser is gone. Without the identity captured at checkout the
  // event reaches Meta with a phone and a name and nothing else, and event
  // match quality is what decides whether the conversion is attributed at all.
  const requestContext = parseMetaOrderContext(order.meta_request_context);
  const legacyClickIds = parseClickIds(order.ad_click_ids);
  const queued = await enqueueCapiEvent(database, {
    eventName: "Purchase",
    eventId: order.order_number,
    eventSourceUrl: new URL("/thanks", siteUrl).toString(),
    userData: {
      phone: order.customer_phone,
      name: order.customer_name,
      // See `/api/meta-event`: a minted provider address is not a match key.
      email: matchableCustomerEmail(order.customer_email, siteUrl),
      city: order.city,
      province: order.province,
      postalCode: order.postal_code || undefined,
      // Meta treats a missing country as a missing match key, not as a default.
      country: "id",
      externalId: requestContext.externalId || toE164Digits(order.customer_phone),
      // The order's own copy wins; `ad_click_ids` is the pre-0052 fallback for
      // orders placed before the context column existed.
      fbp: requestContext.fbp || legacyClickIds._fbp,
      fbc: requestContext.fbc || legacyClickIds._fbc,
      clientIp: requestContext.clientIp,
      userAgent: requestContext.userAgent,
    },
    customData: {
      contentName: rows[0]?.title,
      contentIds: contentIds.length ? contentIds : undefined,
      value: Number(order.product_value ?? 0),
      currency: "IDR",
      orderNumber: order.order_number,
    },
  });
  if (!queued) return { status: "deduplicated" };

  const delivered = await deliverCapiEvent(
    database,
    "Purchase",
    order.order_number,
    ads.metaPixelId,
    ads.metaCapiToken,
  );
  const drain = drainCapiOutbox(database, ads.metaPixelId, ads.metaCapiToken).catch((error) =>
    console.error("capi-outbox-drain", error),
  );
  if (locals.cfContext) locals.cfContext.waitUntil(drain);
  else void drain;
  return { status: "queued", delivered };
}
