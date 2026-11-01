/**
 * The order as the operations API returns it (PRD A45, REQ-253, REQ-255,
 * REQ-256). One serializer for the list and the detail, so a field cannot be
 * private in one and public in the other.
 *
 * PII — buyer name, phone, email, street address, postal code and every ad
 * click id — is returned only to a key holding `ops:orders:read_pii`; without
 * it the field is absent, not null, so a consumer cannot mistake "hidden" for
 * "empty". City, district and province stay: they are what a campaign or
 * shipping report groups by.
 */
import { ADMIN_CUSTOM_DATE_FILTER, isAdminDateFilter, parseAdminDateSelection } from "./admin-date-filter.ts";
import { AD_CLICK_KEYS, parseClickIds } from "./click-ids.ts";
import { periodClause } from "./insights-period.ts";
import { sourceSlugPredicate } from "./source-slug.ts";
import { parseTrafficSource } from "./traffic-source.ts";

/** The `orders` columns the serializer reads, for `SELECT ${OPS_ORDER_COLUMNS} FROM orders o`. */
export const OPS_ORDER_COLUMNS = `o.id, o.order_number, o.created_at, o.updated_at, o.confirmed_at,
  o.customer_name, o.customer_phone, o.customer_email, o.address, o.postal_code,
  o.district, o.city, o.province,
  o.total_amount, o.shipping_cost, COALESCE(o.discount_amount, 0) AS discount_amount,
  COALESCE(o.cod_service_fee, 0) AS cod_service_fee, COALESCE(o.cod_service_fee_vat, 0) AS cod_service_fee_vat,
  o.payment_method, o.payment_status, o.shipping_status, o.stock_restored_at,
  o.courier_code, o.courier_service, o.cnote_no, o.provider_order_id,
  o.provider_status_text, o.provider_status_at, o.warehouse_id,
  o.payment_switched_from, o.payment_switched_at, o.payment_switched_by,
  o.source_slug, o.ad_click_ids,
  (SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_total`;

export type OpsOrderRow = {
  id: number;
  order_number: string;
  created_at: string;
  updated_at: string | null;
  confirmed_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  address: string | null;
  postal_code: string | null;
  district: string | null;
  city: string | null;
  province: string | null;
  total_amount: number;
  shipping_cost: number;
  discount_amount: number;
  cod_service_fee: number;
  cod_service_fee_vat: number;
  payment_method: string;
  payment_status: string;
  shipping_status: string;
  stock_restored_at: string | null;
  courier_code: string | null;
  courier_service: string | null;
  cnote_no: string | null;
  provider_order_id: string | null;
  provider_status_text: string | null;
  provider_status_at: string | null;
  warehouse_id: number | null;
  payment_switched_from: string | null;
  payment_switched_at: string | null;
  payment_switched_by: string | null;
  source_slug: string | null;
  ad_click_ids: string | null;
  item_total: number;
};

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;

export function serializeOpsOrder(row: OpsOrderRow, options: { pii: boolean }) {
  const clickIds = parseClickIds(row.ad_click_ids);
  const utm = Object.fromEntries(UTM_KEYS.map((key) => [key, clickIds[`utm_${key}`] ?? null]));
  const order: Record<string, unknown> = {
    id: row.id,
    number: row.order_number,
    kind: row.shipping_status === "abandoned" ? "lead" : "order",
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    confirmed_at: row.confirmed_at,
    void: Boolean(row.stock_restored_at),
    status: { shipping: row.shipping_status, payment: row.payment_status },
    payment: {
      method: row.payment_method,
      status: row.payment_status,
      switched_from: row.payment_switched_from,
      switched_at: row.payment_switched_at,
    },
    amounts: {
      items: Number(row.item_total),
      discount: Number(row.discount_amount),
      shipping: Number(row.shipping_cost),
      cod_fee: Number(row.cod_service_fee) + Number(row.cod_service_fee_vat),
      total: Number(row.total_amount),
    },
    shipping: {
      courier: row.courier_code,
      service: row.courier_service,
      resi: row.cnote_no,
      provider_order_id: row.provider_order_id,
      provider_status: row.provider_status_text,
      provider_status_at: row.provider_status_at,
      warehouse_id: row.warehouse_id,
    },
    destination: { district: row.district, city: row.city, province: row.province },
    attribution: {
      source_slug: row.source_slug,
      traffic_source: parseTrafficSource(row.ad_click_ids).type,
      utm,
    },
  };
  if (options.pii) {
    order.customer = {
      name: row.customer_name,
      phone: row.customer_phone,
      email: row.customer_email,
      address: row.address,
      postal_code: row.postal_code,
    };
    (order.attribution as Record<string, unknown>).click_ids = Object.fromEntries(
      AD_CLICK_KEYS.flatMap((key) => (clickIds[key] ? [[key, clickIds[key]]] : [])),
    );
    (order.payment as Record<string, unknown>).switched_by = row.payment_switched_by;
  }
  return order;
}

export const OPS_ORDERS_PAGE_MAX = 100;

export class OpsQueryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** `t` is the sort timestamp (`created_at` browsing, `updated_at` syncing), `i` the id. */
type Cursor = { t: string; i: number };

function encodeCursor(cursor: Cursor & { s: number }) {
  return btoa(JSON.stringify(cursor)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeCursor(value: string, sync: boolean): Cursor & { s: number } {
  try {
    const parsed = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
    if (Number.isSafeInteger(parsed?.i) && typeof parsed?.t === "string" && parsed.s === Number(sync)) return parsed;
  } catch {
    // fall through
  }
  throw new OpsQueryError("Cursor tidak valid untuk query ini.", 400, "CURSOR_INVALID");
}

/** Lower-cased and trimmed, the form the UTM report groups by (REQ-261). */
export function normalizeUtmValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * One page of orders (REQ-254). Two orders:
 * - without `updated_since`, newest first by `(created_at, id)` — browsing;
 * - with it, oldest change first by `(updated_at, id)` — incremental sync: a
 *   client stores the last `updated_at` it saw and asks again from there.
 * Each walks an index in its own order, so a page reads about as many rows as
 * it returns whatever the period (`scripts/measure-ops-orders.ts`); ordering by
 * id inside a period sorted every row of the period instead. The cursor is
 * opaque and bound to the mode it was issued for.
 */
export async function listOpsOrders(
  database: D1Database,
  params: URLSearchParams,
  options: { pii: boolean },
) {
  const where: string[] = [];
  const binds: unknown[] = [];
  const kind = (params.get("kind") || "order").trim();
  if (kind === "order") where.push("o.shipping_status <> 'abandoned'");
  else if (kind === "lead") where.push("o.shipping_status = 'abandoned'");
  else if (kind !== "all") throw new OpsQueryError("kind harus order, lead atau all.", 400, "FILTER_INVALID");

  for (const [param, column] of [
    ["status", "o.shipping_status"],
    ["payment_method", "o.payment_method"],
    ["payment_status", "o.payment_status"],
  ] as const) {
    const value = params.get(param)?.trim();
    if (!value) continue;
    if (!/^[a-z_]{1,32}$/.test(value)) throw new OpsQueryError(`${param} tidak valid.`, 400, "FILTER_INVALID");
    where.push(`${column} = ?`);
    binds.push(value);
  }

  const dateFilter = (params.get("date_filter") || "all").trim().toLowerCase();
  if (dateFilter !== "all") {
    if (dateFilter !== ADMIN_CUSTOM_DATE_FILTER && !isAdminDateFilter(dateFilter)) {
      throw new OpsQueryError("date_filter tidak valid.", 400, "FILTER_INVALID");
    }
    const { resolution } = parseAdminDateSelection(params);
    if (!resolution.ok) throw new OpsQueryError(resolution.reason, 422, "DATE_RANGE_INVALID");
    // The admin's own period rule (the Jakarta day of creation), bounded so
    // `idx_orders_created_at` serves the range, as the Analitik menu reads it.
    if (resolution.start && resolution.end) {
      const period = periodClause({ start: resolution.start, end: resolution.end, days: 0 }, "o.");
      where.push(period.sql);
      binds.push(...period.params);
    }
  }

  const source = sourceSlugPredicate(params.get("source_slug"), "o.source_slug");
  if (source) {
    where.push(source.sql);
    binds.push(...source.params);
  }

  const campaign = normalizeUtmValue(params.get("utm_campaign"));
  if (campaign) {
    where.push(
      "json_valid(o.ad_click_ids) AND lower(trim(json_extract(o.ad_click_ids, '$.utm_campaign'))) = ?",
    );
    binds.push(campaign.slice(0, 200));
  }

  const limitParam = params.get("limit");
  const limit = limitParam === null ? 50 : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > OPS_ORDERS_PAGE_MAX) {
    throw new OpsQueryError(`limit harus 1–${OPS_ORDERS_PAGE_MAX}.`, 400, "LIMIT_INVALID");
  }

  const updatedSince = params.get("updated_since")?.trim();
  const sync = Boolean(updatedSince);
  if (updatedSince) {
    if (!Number.isFinite(Date.parse(updatedSince))) {
      throw new OpsQueryError("updated_since harus waktu ISO-8601.", 400, "FILTER_INVALID");
    }
    where.push("o.updated_at > ?");
    binds.push(new Date(updatedSince).toISOString());
  }
  const cursorParam = params.get("cursor");
  if (cursorParam) {
    const cursor = decodeCursor(cursorParam, sync);
    // The bare range first, so the index bounds the read; the OR breaks ties.
    if (sync) {
      where.push("o.updated_at >= ? AND (o.updated_at > ? OR o.id > ?)");
    } else {
      where.push("o.created_at <= ? AND (o.created_at < ? OR o.id < ?)");
    }
    binds.push(cursor.t, cursor.t, cursor.i);
  }

  // `updated_at` is never null after 0075 (backfilled, then stamped by
  // trigger), and read bare so `orders_updated_at_id` serves the range.
  const order = sync ? "o.updated_at ASC, o.id ASC" : "o.created_at DESC, o.id DESC";
  const result = await database
    .prepare(
      `SELECT ${OPS_ORDER_COLUMNS} FROM orders o
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${order} LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<OpsOrderRow>();
  const rows = result.results ?? [];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    orders: page.map((row) => serializeOpsOrder(row, options)),
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ t: sync ? (last.updated_at ?? last.created_at) : last.created_at, i: last.id, s: Number(sync) })
        : null,
  };
}

/** One order by its number (REQ-255), with items and the latest payment instruction. */
export async function readOpsOrder(database: D1Database, number: string, options: { pii: boolean }) {
  const key = number.trim().toUpperCase().slice(0, 40);
  const row = await database
    .prepare(`SELECT ${OPS_ORDER_COLUMNS} FROM orders o WHERE o.order_number = ? LIMIT 1`)
    .bind(key)
    .first<OpsOrderRow>();
  if (!row) return null;
  const [items, payment] = await Promise.all([
    database
      .prepare(
        `SELECT p.title AS product, p.slug AS product_slug, pv.title AS variant, pv.sku,
           oi.quantity, oi.unit_price, oi.weight_grams
         FROM order_items oi
         LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         LEFT JOIN products p ON p.id = pv.product_id
         WHERE oi.order_id = ? ORDER BY oi.id`,
      )
      .bind(row.id)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT channel_code, amount, admin_fee, total_amount, virtual_account, expires_at, paid_at,
           CASE WHEN status = 'pending' AND expires_at IS NOT NULL
             AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'expired' ELSE status END AS status
         FROM payment_transactions WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .bind(row.id)
      .first<Record<string, unknown>>(),
  ]);
  const order = serializeOpsOrder(row, options);
  order.items = (items.results ?? []).map((item) => ({
    product: item.product ?? null,
    product_slug: item.product_slug ?? null,
    variant: item.variant ?? null,
    sku: item.sku ?? null,
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    weight_grams: item.weight_grams === null ? null : Number(item.weight_grams),
  }));
  if (payment) {
    const { virtual_account, ...instruction } = payment;
    (order.payment as Record<string, unknown>).instruction = options.pii
      ? { ...instruction, virtual_account }
      : instruction;
  }
  return order;
}
