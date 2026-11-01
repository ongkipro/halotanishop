import { LEAD_FOLLOW_UP_STATUSES } from "./abandoned-lead.ts";
import { ADMIN_CUSTOM_DATE_FILTER, isAdminDateFilter, parseAdminDateSelection } from "./admin-date-filter.ts";
import { ADMIN_SHIPPING_STATUSES } from "./order-lifecycle.ts";
import { sourceSlugPredicate } from "./source-slug.ts";

/**
 * The filters behind the three order screens — Pesanan, Pesanan tertinggal
 * and Pengiriman — read once from the query string. Each list route and the
 * CSV export (`/api/admin/orders/export`) build their WHERE from here, so an
 * export always holds exactly the rows the screen shows.
 */

/**
 * The status the order list shows, filters and counts by. A pending order
 * voided through its payment (`payment_status = cancelled` sets
 * `stock_restored_at` but leaves shipping `pending`) is cancelled, not
 * waiting: it read "Menunggu konfirmasi" and counted under Menunggu (audit
 * 2026-10-31 M2). Unqualified column names: use it over `orders` alone.
 */
export const LIST_SHIPPING_STATUS_SQL =
  "(CASE WHEN shipping_status = 'pending' AND stock_restored_at IS NOT NULL THEN 'cancelled' ELSE shipping_status END)";

/**
 * An online order the buyer has not paid yet. COD is left out on purpose: it
 * is paid on delivery, so its `unpaid` is the normal state, not a follow-up.
 * Online checkouts are written `pending` (submit and payment switch) and older
 * rows may read `unpaid`; the "Belum dibayar" filter and card used to match
 * only `unpaid`, which caught every COD order and none of the QRIS/VA ones
 * actually waiting for money (review 2026-11-01). Unqualified columns.
 */
/**
 * The order's latest payment instruction has lapsed. Expiry is recorded on
 * `payment_transactions` only (`expirePendingPaymentTransactions`), never on
 * `orders.payment_status`, and a pending one past `expires_at` is just as
 * dead; the order list reads its "Kedaluwarsa" badge the same way. Correlated
 * on an unaliased `orders`.
 */
export const PAYMENT_EXPIRED_SQL = `EXISTS (
  SELECT 1 FROM payment_transactions pt
  WHERE pt.id = (SELECT MAX(latest.id) FROM payment_transactions latest WHERE latest.order_id = orders.id)
    AND (pt.status = 'expired'
      OR (pt.status = 'pending' AND pt.expires_at IS NOT NULL AND pt.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
)`;

export const AWAITING_PAYMENT_SQL = `(payment_method <> 'cod' AND payment_status IN ('unpaid', 'pending', 'awaiting_payment') AND stock_restored_at IS NULL AND NOT ${PAYMENT_EXPIRED_SQL})`;

export const ORDER_LIST_SHIPPING_FILTERS = ["all", ...ADMIN_SHIPPING_STATUSES] as const;
export const ORDER_LIST_PAYMENT_FILTERS = ["all", "unpaid", "paid", "settled", "success", "failed", "refunded", "expired"] as const;
export const LEAD_FOLLOW_UP_FILTERS = ["all", ...LEAD_FOLLOW_UP_STATUSES] as const;

export type ListFilterError = { ok: false; status: number; error: string; code?: string };

const includes = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

/** The created-at period, as an Asia/Jakarta date range, or nothing for "all". */
function periodPredicate(searchParams: URLSearchParams, column: string):
  | { ok: true; sql: string | null; params: string[] }
  | ListFilterError {
  const dateFilter = String(searchParams.get("date_filter") || "all").trim().toLowerCase();
  if (dateFilter !== ADMIN_CUSTOM_DATE_FILTER && !isAdminDateFilter(dateFilter)) {
    return { ok: false, status: 400, error: "Filter periode order tidak valid." };
  }
  if (dateFilter === "all") return { ok: true, sql: null, params: [] };
  // Refuses an unresolvable period rather than answering for a different
  // one — passing the raw string straight in used to make anything
  // unrecognised, `custom` included, silently become the 7-day default.
  const { resolution } = parseAdminDateSelection(searchParams);
  if (!resolution.ok) return { ok: false, status: 422, error: resolution.reason, code: "DATE_RANGE_INVALID" };
  return { ok: true, sql: `date(${column}, '+7 hours') BETWEEN ? AND ?`, params: [resolution.start, resolution.end] };
}

/**
 * Pesanan (`/admin/orders`). Unqualified columns, over `orders` alone.
 * `statusPart`/`statusParam` locate the shipping-status predicate so the
 * status chips can count without it; one search term pushes four params for
 * a single clause, so the two indices differ.
 */
export function orderListFilter(searchParams: URLSearchParams):
  | { ok: true; parts: string[]; params: unknown[]; statusPart: number; statusParam: number }
  | ListFilterError {
  const search = String(searchParams.get("search") || "").trim().slice(0, 120);
  const shippingStatus = String(searchParams.get("shipping_status") || "all").trim().toLowerCase();
  const paymentStatus = String(searchParams.get("payment_status") || "all").trim().toLowerCase();
  const sourceFilter = String(searchParams.get("source") || "all").trim().toLowerCase();
  if (!includes(ORDER_LIST_SHIPPING_FILTERS, shippingStatus)) {
    return { ok: false, status: 400, error: "Filter status pengiriman tidak valid." };
  }
  if (!includes(ORDER_LIST_PAYMENT_FILTERS, paymentStatus)) {
    return { ok: false, status: 400, error: "Filter status pembayaran tidak valid." };
  }
  const period = periodPredicate(searchParams, "created_at");
  if (!period.ok) return period;

  const parts: string[] = ["shipping_status <> 'abandoned'"];
  const params: unknown[] = [];
  if (search) {
    const term = `%${search}%`;
    parts.push("(customer_name LIKE ? OR customer_phone LIKE ? OR order_number LIKE ? OR cnote_no LIKE ?)");
    params.push(term, term, term, term);
  }
  const statusPart = shippingStatus !== "all" ? parts.length : -1;
  const statusParam = shippingStatus !== "all" ? params.length : -1;
  if (shippingStatus !== "all") {
    parts.push(`${LIST_SHIPPING_STATUS_SQL} = ?`);
    params.push(shippingStatus);
  }
  if (paymentStatus === "unpaid") {
    parts.push(AWAITING_PAYMENT_SQL);
  } else if (paymentStatus === "expired") {
    // Nothing writes `payment_status = 'expired'`; the filter matched no row.
    parts.push(`(payment_status = 'expired' OR (payment_status NOT IN ('paid', 'settled', 'success') AND ${PAYMENT_EXPIRED_SQL}))`);
  } else if (paymentStatus !== "all") {
    parts.push("payment_status = ?");
    params.push(paymentStatus);
  }
  if (period.sql) {
    parts.push(period.sql);
    params.push(...period.params);
  }
  // The landing page the order came from (PRD A36). A read filter only.
  const sourceSlug = sourceSlugPredicate(searchParams.get("source_slug"));
  if (sourceSlug) {
    parts.push(sourceSlug.sql);
    params.push(...sourceSlug.params);
  }
  if (sourceFilter === "meta") {
    parts.push("(ad_click_ids LIKE '%fbclid%' OR ad_click_ids LIKE '%_fbc%' OR ad_click_ids LIKE '%meta%' OR ad_click_ids LIKE '%facebook%' OR ad_click_ids LIKE '%instagram%')");
  } else if (sourceFilter === "google") {
    parts.push("(ad_click_ids LIKE '%gclid%' OR ad_click_ids LIKE '%gbraid%' OR ad_click_ids LIKE '%wbraid%' OR ad_click_ids LIKE '%google%')");
  } else if (sourceFilter === "organic") {
    // `%ttclid%` stays excluded even though TikTok is no longer a filterable
    // source: an order captured with one before that removal has a real ad
    // click id on it, and must not read as organic just because its own
    // category went away.
    parts.push("(ad_click_ids IS NULL OR ad_click_ids = '' OR ad_click_ids = '{}' OR (ad_click_ids NOT LIKE '%fbclid%' AND ad_click_ids NOT LIKE '%gclid%' AND ad_click_ids NOT LIKE '%ttclid%' AND ad_click_ids NOT LIKE '%gbraid%' AND ad_click_ids NOT LIKE '%wbraid%'))");
  }
  return { ok: true, parts, params, statusPart, statusParam };
}

/**
 * Pesanan tertinggal (`/admin/orders/abandoned`). Qualified columns: `o` is
 * `orders` and `p` is `products`, joined through the lead's items so the
 * search can match a product title.
 */
export function abandonedListFilter(searchParams: URLSearchParams):
  | { ok: true; conditions: string[]; params: unknown[] }
  | ListFilterError {
  const search = searchParams.get("search")?.trim().slice(0, 120) || "";
  const followUpStatus = searchParams.get("follow_up_status")?.trim().toLowerCase() || "all";
  if (!includes(LEAD_FOLLOW_UP_FILTERS, followUpStatus)) {
    return { ok: false, status: 400, error: "Filter follow-up tidak valid." };
  }
  const conditions = ["o.shipping_status = 'abandoned'"];
  const params: unknown[] = [];
  if (search) {
    const term = `%${search}%`;
    conditions.push("(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.order_number LIKE ? OR p.title LIKE ?)");
    params.push(term, term, term, term);
  }
  if (followUpStatus !== "all") {
    conditions.push("o.lead_follow_up_status = ?");
    params.push(followUpStatus);
  }
  // The page the lead was captured on (PRD A36). A read filter only.
  const sourceSlug = sourceSlugPredicate(searchParams.get("source_slug"), "o.source_slug");
  if (sourceSlug) {
    conditions.push(sourceSlug.sql);
    params.push(...sourceSlug.params);
  }
  return { ok: true, conditions, params };
}

/**
 * Pengiriman (`/admin/shipping`): orders handed to Mengantar, by period.
 * Qualified columns, `o` is `orders`.
 */
export function shippingListFilter(searchParams: URLSearchParams):
  | { ok: true; conditions: string[]; params: unknown[] }
  | ListFilterError {
  const period = periodPredicate(searchParams, "o.created_at");
  if (!period.ok) return period;
  const conditions = ["o.shipping_status IN ('processing', 'shipped', 'delivered', 'returned')", "o.provider_order_id IS NOT NULL"];
  if (period.sql) conditions.push(period.sql);
  return { ok: true, conditions, params: [...period.params] };
}
