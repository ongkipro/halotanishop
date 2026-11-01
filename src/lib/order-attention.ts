import { AWAITING_PAYMENT_SQL, LIST_SHIPPING_STATUS_SQL, shippingListFilter } from "./order-list-filter.ts";
import { leadRowSql, orderRowSql } from "./order-metrics.ts";
import { getMengantarDispatchEligibility, MENGANTAR_DISPATCH_CLAIM_TTL_MS } from "./payment-dispatch-policy.ts";
import { matchesShippingQueue } from "./shipping-queue.ts";

/**
 * "Perlu tindakan" on the dashboard: what is waiting on an operator right now,
 * each with a count and the list it opens. Every count is read with the rule
 * of the screen it links to, so a number and the rows behind it cannot
 * disagree:
 *
 * - confirm, ready_push, push_problem — the order list's status (the same
 *   void-aware CASE) and `getMengantarDispatchEligibility`, the gate the push
 *   route itself applies;
 * - awaiting_payment — `AWAITING_PAYMENT_SQL`, the order list's "Belum
 *   dibayar" filter;
 * - leads_new — the lead list's follow-up status `new`;
 * - needs_waybill / needs_pickup / needs_drop_off — `matchesShippingQueue`
 *   over the rows `/admin/shipping` lists (`shippingListFilter`).
 *
 * Not dated: these are open work, whenever it came in.
 */

export type AttentionKey =
  | "confirm"
  | "ready_push"
  | "push_problem"
  | "awaiting_payment"
  | "leads_new"
  | "needs_waybill"
  | "needs_pickup"
  | "needs_drop_off";

/**
 * `stale`: how many of `count` have waited longer than `STALE_AFTER_MS`
 * (created that long ago) — the ones most at risk of being cancelled or
 * forgotten. Absent where age is not the point (a parcel waits on a courier).
 */
export type AttentionItem = { key: AttentionKey; label: string; hint: string; count: number; stale?: number; href: string; tone: "info" | "warn" | "bad" };

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// lazy: the open orders are read whole and judged in JS, so the Mengantar gate
// is the one function the push route runs. A store with more than this many
// orders waiting at once is past what one dashboard read should hold; the
// count then says "N+" (`capped`). Upgrade path: a SQL mirror of the gate
// with a test that pins it to the function.
export const ATTENTION_ROW_LIMIT = 2000;

type PendingRow = {
  created_at: string;
  payment_method: string | null;
  payment_status: string | null;
  list_status: string;
  provider_order_id: string | null;
  provider_dispatch_error: string | null;
  provider_dispatch_claimed_at: string | null;
  destination_area_id: string | null;
  courier_code: string | null;
  pickup_address_id: string | null;
};

type ShipmentRow = {
  shipping_status: string;
  cnote_no: string | null;
  provider_order_id: string | null;
  pickup_schedule_id: number | null;
  mengantar_handover: string | null;
};

/**
 * `fallbackPickupAddressId` is the env `MENGANTAR_PICKUP_ADDRESS_ID`, the same
 * fallback the order list and the push route use for an order whose warehouse
 * has no pickup address of its own.
 */
export async function readOrderAttention(
  database: D1Database,
  options: { fallbackPickupAddressId?: string; now?: number } = {},
) {
  const now = options.now ?? Date.now();
  const fallbackPickupAddressId = (options.fallbackPickupAddressId || "").trim();
  const shipping = shippingListFilter(new URLSearchParams());
  if (!shipping.ok) throw new Error(shipping.error);
  const [pending, shipments, counts] = (await database.batch([
    database
      .prepare(
        `SELECT o.created_at, o.payment_method, o.payment_status,
           (SELECT ${LIST_SHIPPING_STATUS_SQL} FROM orders s WHERE s.id = o.id) AS list_status,
           o.provider_order_id, o.provider_dispatch_error, o.provider_dispatch_claimed_at,
           o.destination_area_id, o.courier_code, w.pickup_address_id
         FROM orders o
         LEFT JOIN warehouses w ON w.id = o.warehouse_id
         WHERE ${orderRowSql("o.")} AND o.shipping_status = 'pending' AND o.stock_restored_at IS NULL
         ORDER BY o.id DESC
         LIMIT ?`,
      )
      .bind(ATTENTION_ROW_LIMIT + 1),
    database
      .prepare(
        `SELECT o.shipping_status, o.cnote_no, o.provider_order_id, o.pickup_schedule_id, o.mengantar_handover
         FROM orders o
         WHERE ${shipping.conditions.join(" AND ")} AND o.shipping_status = 'processing'
         LIMIT ?`,
      )
      .bind(...shipping.params, ATTENTION_ROW_LIMIT + 1),
    database.prepare(
      `SELECT
         SUM(CASE WHEN ${orderRowSql()} AND ${AWAITING_PAYMENT_SQL} THEN 1 ELSE 0 END) AS awaiting_payment,
         SUM(CASE WHEN ${orderRowSql()} AND ${AWAITING_PAYMENT_SQL} AND created_at < ?1 THEN 1 ELSE 0 END) AS awaiting_payment_stale,
         SUM(CASE WHEN ${leadRowSql()} AND lead_follow_up_status = 'new' THEN 1 ELSE 0 END) AS leads_new,
         SUM(CASE WHEN ${leadRowSql()} AND lead_follow_up_status = 'new' AND created_at < ?1 THEN 1 ELSE 0 END) AS leads_new_stale
       FROM orders`,
    ).bind(new Date(now - STALE_AFTER_MS).toISOString()),
  ])) as [D1Result<PendingRow>, D1Result<ShipmentRow>, D1Result<{ awaiting_payment: number | null; awaiting_payment_stale: number | null; leads_new: number | null; leads_new_stale: number | null }>];

  const pendingRows = (pending.results ?? []).slice(0, ATTENTION_ROW_LIMIT);
  const shipmentRows = (shipments.results ?? []).slice(0, ATTENTION_ROW_LIMIT);
  const capped = (pending.results?.length ?? 0) > ATTENTION_ROW_LIMIT || (shipments.results?.length ?? 0) > ATTENTION_ROW_LIMIT;

  let confirm = 0;
  let confirmStale = 0;
  const staleBefore = now - STALE_AFTER_MS;
  let readyPush = 0;
  let pushProblem = 0;
  for (const row of pendingRows) {
    if (row.list_status !== "pending") continue;
    confirm += 1;
    if (Date.parse(row.created_at) < staleBefore) confirmStale += 1;
    const error = row.provider_dispatch_error;
    const claimedAt = Date.parse(row.provider_dispatch_claimed_at || "");
    const inFlight = error === "DISPATCHING" && Number.isFinite(claimedAt) && now - claimedAt < MENGANTAR_DISPATCH_CLAIM_TTL_MS;
    // A refusal from Mengantar or an unknown outcome waits on a person; a
    // claim still within its two minutes is a push in progress, not a problem.
    if (error && !inFlight) pushProblem += 1;
    const eligibility = getMengantarDispatchEligibility({
      paymentMethod: row.payment_method || "",
      paymentStatus: row.payment_status || "",
      shippingStatus: "pending",
      providerOrderId: row.provider_order_id,
      providerDispatchError: row.provider_dispatch_error,
      providerDispatchClaimedAt: row.provider_dispatch_claimed_at,
      destinationAreaId: row.destination_area_id,
      courierCode: row.courier_code,
      pickupAddressId: row.pickup_address_id || fallbackPickupAddressId,
    });
    if (eligibility.eligible) readyPush += 1;
  }

  const queueCount = (queue: "needs_waybill" | "needs_pickup" | "needs_drop_off") =>
    shipmentRows.filter((row) =>
      matchesShippingQueue(
        {
          shippingStatus: row.shipping_status,
          cnoteNo: row.cnote_no,
          providerOrderId: row.provider_order_id,
          pickupScheduleId: row.pickup_schedule_id,
          handover: row.mengantar_handover,
        },
        queue,
      ),
    ).length;

  const totals = counts.results?.[0] ?? { awaiting_payment: 0, awaiting_payment_stale: 0, leads_new: 0, leads_new_stale: 0 };
  const items: AttentionItem[] = [
    { key: "confirm", label: "Menunggu konfirmasi", hint: "Order baru, cek alamat dan risiko lalu konfirmasi", count: confirm, stale: confirmStale, href: "/admin/orders?status=pending", tone: "info" },
    { key: "ready_push", label: "Siap push ke Mengantar", hint: "Lolos syarat push Mengantar; push dari daftar Menunggu", count: readyPush, href: "/admin/orders?status=pending", tone: "info" },
    { key: "push_problem", label: "Push Mengantar bermasalah", hint: "Ditolak atau hasil belum pasti. Yang ditolak tetap bisa dipush ulang setelah dibetulkan", count: pushProblem, href: "/admin/orders?status=pending", tone: "bad" },
    { key: "awaiting_payment", label: "Menunggu pembayaran online", hint: "QRIS, VA, atau transfer yang belum dibayar pembeli", count: Number(totals.awaiting_payment) || 0, stale: Number(totals.awaiting_payment_stale) || 0, href: "/admin/orders?payment_status=unpaid", tone: "warn" },
    { key: "leads_new", label: "Lead belum dihubungi", hint: "Pesanan tertinggal yang belum di-follow up", count: Number(totals.leads_new) || 0, stale: Number(totals.leads_new_stale) || 0, href: "/admin/orders/abandoned?follow_up_status=new", tone: "warn" },
    { key: "needs_waybill", label: "Perlu dibuatkan resi", hint: "Sudah di Mengantar, resi belum terbit", count: queueCount("needs_waybill"), href: "/admin/shipping?queue=needs_waybill", tone: "warn" },
    { key: "needs_pickup", label: "Perlu jadwal pickup", hint: "Berresi, belum dijadwalkan pickup kurir", count: queueCount("needs_pickup"), href: "/admin/shipping?queue=needs_pickup", tone: "warn" },
    { key: "needs_drop_off", label: "Perlu drop-off", hint: "Berresi, antar ke counter kurir", count: queueCount("needs_drop_off"), href: "/admin/shipping?queue=needs_drop_off", tone: "warn" },
  ];
  return { items, capped };
}
