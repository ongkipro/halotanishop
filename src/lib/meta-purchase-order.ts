/**
 * The one server-authoritative read behind every Meta Purchase.
 *
 * Both Purchase surfaces need the same three facts from D1 — the canonical
 * `order_number` that becomes the `event_id` on both legs, the customer
 * identity to match on, and `product_value`, the goods rather than the invoice.
 * They differ only in how the caller earned the right to ask.
 *
 * The read is exported as two named functions rather than one with an optional
 * token, deliberately. An optional token is a footgun: a later caller on a
 * public route that forgets to pass it silently gets an unauthenticated lookup,
 * and the name would not warn anybody. These names cannot be confused.
 */

export type MetaPurchaseOrder = {
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  province: string;
  city: string;
  postal_code: string | null;
  total_amount: number;
  shipping_status: string;
  /** `products.id` of every line, comma-joined by D1. The catalog identity. */
  product_ids: string | null;
  /** Attribution captured at checkout; both may be null on pre-0052 orders. */
  ad_click_ids: string | null;
  meta_request_context: string | null;
  /**
   * Variant price x quantity, summed from `order_items`. Excludes shipping,
   * the COD service fee and its VAT, and the payment channel's admin fee —
   * optimising on those would have the platform bidding on the courier's price
   * list as if it were margin.
   */
  product_value: number;
  payment_method: string;
  payment_status: string;
};

/**
 * Only a real submitted order may become a Purchase. COD is purchased at
 * submit; prepaid methods require a confirmed payment. An abandoned lead is
 * neither, even though its capture row historically carries COD-like defaults
 * — and before this check, a lead's own status token was enough to send Meta a
 * Purchase for a sale that never happened.
 */
export function isMetaPurchaseOrderEligible(
  order: Pick<MetaPurchaseOrder, "payment_method" | "payment_status" | "shipping_status">,
): boolean {
  if (order.shipping_status === "abandoned") return false;
  if (["failed", "cancelled", "returned"].includes(order.shipping_status)) return false;
  if (["failed", "refunded", "cancelled"].includes(order.payment_status)) return false;
  // Paid in any of the words the rest of the code accepts (audit 2026-10-31 tracking L-2).
  return order.payment_method === "cod" || ["paid", "settled", "success"].includes(order.payment_status);
}

/**
 * The order's own catalog identity, in the shape the feeds advertise: product
 * id, content_id and <g:id> are one value (`catalogProductId`). Anything that
 * does not fit that shape is dropped rather than sent — a content_id Meta
 * cannot match to the catalog is worse than none.
 */
export function parseMetaPurchaseContentIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const value of raw.split(",")) {
    const id = value.trim();
    if (/^[1-9]\d{4,15}$/.test(id) && Number.isSafeInteger(Number(id))) seen.add(id);
  }
  return [...seen];
}

/**
 * For a Purchase the order decides what was bought, not the caller. A browser
 * or an API client can send any content_ids it likes; the catalog attribution
 * that pays for the ad has to agree with the invoice. Non-Purchase events have
 * no order and keep what was submitted.
 */
export function resolveMetaPurchaseContentIds(
  order: Pick<MetaPurchaseOrder, "product_ids"> | null,
  submitted: string[] | undefined,
): string[] | undefined {
  if (!order) return submitted;
  const authoritative = parseMetaPurchaseContentIds(order.product_ids);
  return authoritative.length ? authoritative : undefined;
}

const PURCHASE_ORDER_SELECT = `
  SELECT
    o.order_number, o.customer_name, o.customer_phone, o.customer_email,
    o.province, o.city, o.postal_code, o.total_amount,
    o.payment_method, o.payment_status, o.shipping_status,
    o.ad_click_ids, o.meta_request_context,
    (
      SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)
      FROM order_items oi
      WHERE oi.order_id = o.id
    ) AS product_value,
    (
      SELECT GROUP_CONCAT(DISTINCT p.id)
      FROM order_items oi
      INNER JOIN product_variants pv ON pv.id = oi.variant_id
      INNER JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id = o.id
    ) AS product_ids
  FROM orders o
  WHERE (CAST(o.id AS TEXT) = ? OR o.order_number = ?)
`;

/**
 * For the first-party storefront route, which is reachable by anyone.
 *
 * The per-order `public_status_token` is what stops a stranger who guesses an
 * order number from minting a Purchase against it.
 */
export function findPurchaseOrderByStatusToken(
  database: D1Database,
  locator: string,
  statusToken: string,
): Promise<MetaPurchaseOrder | null> {
  return database
    .prepare(`${PURCHASE_ORDER_SELECT} AND o.public_status_token = ? LIMIT 1`)
    .bind(locator, locator, statusToken)
    .first<MetaPurchaseOrder>();
}

/**
 * For the headless route, where a developer API key with `tracking:write` has
 * already authenticated the caller and no browser holds a status token.
 *
 * The lookup still has to happen. Without it the route took the caller's word
 * for both the event id and the revenue, which is the one thing the rest of
 * this system refuses to do — an order that cannot be resolved emits no
 * Purchase at all rather than a mismatched one.
 */
export function findPurchaseOrderForApiKeyCaller(
  database: D1Database,
  locator: string,
): Promise<MetaPurchaseOrder | null> {
  return database
    .prepare(`${PURCHASE_ORDER_SELECT} LIMIT 1`)
    .bind(locator, locator)
    .first<MetaPurchaseOrder>();
}
