import { LEAD_FOLLOW_UP_LABELS, type LeadFollowUpStatus } from "./abandoned-lead.ts";
import { abandonedListFilter, LIST_SHIPPING_STATUS_SQL, orderListFilter, shippingListFilter, type ListFilterError } from "./order-list-filter.ts";
import { paymentChannelLabel, paymentStatusLabel } from "./payment-display.ts";
import { shippingStatusLabel } from "./shipping-status.ts";
import { parseTrafficSource } from "./traffic-source.ts";

/**
 * CSV export of the three order screens: Pesanan, Pesanan tertinggal and
 * Pengiriman (`GET /api/admin/orders/export?kind=…`). The rows are the ones the
 * screen shows under the same filters (`order-list-filter.ts`), one row per
 * ordered item, every field in a column of its own.
 *
 * An order with several items repeats who and where on each item row, and
 * carries its money (ongkir, diskon, biaya COD, total) on its first item row
 * only, so summing a column never counts an order twice.
 */

export const ORDER_EXPORT_KINDS = ["orders", "abandoned", "shipping"] as const;
export type OrderExportKind = (typeof ORDER_EXPORT_KINDS)[number];

export const isOrderExportKind = (value: unknown): value is OrderExportKind =>
  typeof value === "string" && (ORDER_EXPORT_KINDS as readonly string[]).includes(value);

// lazy: one response, no paging. D1 answers a few MB per query; 10 000 item
// rows covers months of a store's orders. Past it the response says so in
// `X-Export-Truncated` and the operator narrows the period. Upgrade path: a
// streamed export paged by order id.
export const ORDER_EXPORT_ROW_LIMIT = 10_000;

export type OrderExportRow = {
  order_id: number;
  order_number: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  address: string | null;
  district: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  shipping_cost: number | null;
  discount_amount: number | null;
  cod_service_fee: number | null;
  total_amount: number | null;
  payment_method: string | null;
  payment_status: string | null;
  shipping_status: string | null;
  courier_code: string | null;
  courier_service: string | null;
  cnote_no: string | null;
  provider_status_text: string | null;
  warehouse_name: string | null;
  pickup_scheduled_at: string | null;
  ad_click_ids: string | null;
  source_page_path: string | null;
  lead_follow_up_status: string | null;
  lead_follow_up_note: string | null;
  lead_followed_up_by: string | null;
  /** 1 for an order's first item row; its money columns are filled only there. */
  item_index: number;
};

type Cell = string | number | null | undefined;
type Column = { header: string; value: (row: OrderExportRow) => Cell };

const JAKARTA_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `2026-11-01 14:05`, Asia/Jakarta; a value that is not a date stays as stored. */
export function jakartaDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : JAKARTA_TIME.format(date);
}

const firstItem = (row: OrderExportRow, value: Cell): Cell => (row.item_index === 1 ? value : "");
const subtotal = (row: OrderExportRow) =>
  row.unit_price == null ? "" : row.unit_price * (row.quantity ?? 1);

/**
 * The email the buyer gave. An online payment needs one at AutoLaris, so a
 * COD checkout converted later is minted `<phone digits>@<store host>`
 * (`autolaris-payment.ts` buyerEmail) and stored; that is not the buyer's.
 */
function buyerTypedEmail(row: OrderExportRow) {
  const email = row.customer_email?.trim() || "";
  const digits = (row.customer_phone || "").replace(/\D/g, "");
  return digits && email.startsWith(`${digits}@`) ? "" : email;
}

const COLUMN = {
  invoice: { header: "Invoice", value: (row) => row.order_number },
  date: { header: "Tanggal (WIB)", value: (row) => jakartaDateTime(row.created_at) },
  name: { header: "Nama", value: (row) => row.customer_name },
  whatsapp: { header: "WhatsApp", value: (row) => row.customer_phone },
  email: { header: "Email", value: buyerTypedEmail },
  address: { header: "Alamat lengkap", value: (row) => row.address },
  district: { header: "Kecamatan", value: (row) => row.district },
  city: { header: "Kota/Kabupaten", value: (row) => row.city },
  province: { header: "Provinsi", value: (row) => row.province },
  postalCode: { header: "Kode pos", value: (row) => row.postal_code },
  product: { header: "Produk", value: (row) => row.product_title },
  variant: { header: "Varian", value: (row) => row.variant_title },
  sku: { header: "SKU", value: (row) => row.sku },
  quantity: { header: "Jumlah", value: (row) => row.quantity },
  unitPrice: { header: "Harga satuan", value: (row) => row.unit_price },
  subtotal: { header: "Subtotal produk", value: subtotal },
  shippingCost: { header: "Ongkir", value: (row) => firstItem(row, row.shipping_cost ?? 0) },
  discount: { header: "Diskon", value: (row) => firstItem(row, row.discount_amount ?? 0) },
  codFee: { header: "Biaya COD", value: (row) => firstItem(row, row.cod_service_fee ?? 0) },
  total: { header: "Total order", value: (row) => firstItem(row, row.total_amount) },
  paymentMethod: { header: "Metode pembayaran", value: (row) => paymentChannelLabel(row.payment_method) },
  paymentStatus: { header: "Status pembayaran", value: (row) => paymentStatusLabel(row.payment_status) },
  shippingStatus: { header: "Status pesanan", value: (row) => shippingStatusLabel(row.shipping_status) },
  courier: { header: "Kurir", value: (row) => row.courier_code },
  service: { header: "Layanan", value: (row) => row.courier_service },
  awb: { header: "Resi", value: (row) => row.cnote_no },
  courierStatus: { header: "Status kurir", value: (row) => row.provider_status_text },
  warehouse: { header: "Gudang", value: (row) => row.warehouse_name },
  pickup: { header: "Jadwal pickup (WIB)", value: (row) => jakartaDateTime(row.pickup_scheduled_at) },
  traffic: { header: "Sumber traffic", value: (row) => parseTrafficSource(row.ad_click_ids).label },
  sourcePage: { header: "Halaman sumber", value: (row) => row.source_page_path },
  followUp: {
    header: "Status follow-up",
    value: (row) => LEAD_FOLLOW_UP_LABELS[row.lead_follow_up_status as LeadFollowUpStatus] ?? row.lead_follow_up_status,
  },
  followUpNote: { header: "Catatan follow-up", value: (row) => row.lead_follow_up_note },
  followUpBy: { header: "Di-follow-up oleh", value: (row) => row.lead_followed_up_by },
} satisfies Record<string, Column>;

const C = COLUMN;
export const ORDER_EXPORT_COLUMNS: Record<OrderExportKind, readonly Column[]> = {
  orders: [
    C.invoice, C.date, C.name, C.whatsapp, C.email, C.address, C.district, C.city, C.province, C.postalCode,
    C.product, C.variant, C.sku, C.quantity, C.unitPrice, C.subtotal, C.shippingCost, C.discount, C.codFee, C.total,
    C.paymentMethod, C.paymentStatus, C.shippingStatus, C.courier, C.service, C.awb, C.traffic, C.sourcePage,
  ],
  // A lead is a checkout that stopped short: often no address yet, no
  // payment, no courier. What there is to follow up on.
  abandoned: [
    C.date, C.name, C.whatsapp, C.address, C.district, C.city, C.province,
    C.product, C.variant, C.quantity, C.unitPrice, C.subtotal, C.total,
    C.followUp, C.followUpNote, C.followUpBy, C.traffic, C.sourcePage, { ...C.invoice, header: "Ref" },
  ],
  shipping: [
    C.invoice, C.date, C.name, C.whatsapp, C.address, C.district, C.city, C.province, C.postalCode,
    C.product, C.variant, C.quantity, C.unitPrice, C.subtotal, C.shippingCost, C.codFee, C.total,
    C.paymentMethod, C.shippingStatus, C.courier, C.service, C.awb, C.courierStatus, C.warehouse, C.pickup,
  ],
};

/**
 * One RFC 4180 field. Text a spreadsheet would run as a formula — a buyer
 * can type `=HYPERLINK(…)` as their name — is prefixed with `'` (OWASP CSV
 * injection). Numbers are written as numbers.
 */
export function csvField(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The file: a UTF-8 byte order mark so Excel reads the Indonesian text as
 * UTF-8, a header row, CRLF line ends.
 */
export function buildOrderCsv(kind: OrderExportKind, rows: readonly OrderExportRow[]): string {
  const columns = ORDER_EXPORT_COLUMNS[kind];
  const lines = [columns.map((column) => csvField(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvField(column.value(row))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const FILE_LABEL: Record<OrderExportKind, string> = {
  orders: "pesanan",
  abandoned: "pesanan-tertinggal",
  shipping: "pengiriman",
};

/** `pesanan-2026-11-01.csv`, dated in Asia/Jakarta. */
export function orderExportFilename(kind: OrderExportKind, now = new Date()) {
  return `${FILE_LABEL[kind]}-${jakartaDateTime(now.toISOString()).slice(0, 10)}.csv`;
}

/**
 * The ids the screen would list, as a subquery over `orders`. Each list
 * qualifies its columns its own way (the order list leaves them bare), so each
 * runs in its own scope here and the export query joins nothing into it.
 */
export function orderExportScope(kind: OrderExportKind, searchParams: URLSearchParams):
  | { ok: true; sql: string; params: unknown[] }
  | ListFilterError {
  if (kind === "orders") {
    const filter = orderListFilter(searchParams);
    if (!filter.ok) return filter;
    return { ok: true, sql: `SELECT id FROM orders WHERE ${filter.parts.join(" AND ")}`, params: filter.params };
  }
  if (kind === "abandoned") {
    const filter = abandonedListFilter(searchParams);
    if (!filter.ok) return filter;
    return {
      ok: true,
      sql: `SELECT o.id FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
        WHERE ${filter.conditions.join(" AND ")}`,
      params: filter.params,
    };
  }
  const filter = shippingListFilter(searchParams);
  if (!filter.ok) return filter;
  return { ok: true, sql: `SELECT o.id FROM orders o WHERE ${filter.conditions.join(" AND ")}`, params: filter.params };
}

/** One row per item; an order without items still gets one row. Newest first. */
export function orderExportSql(scopeSql: string) {
  return `
    SELECT
      o.id AS order_id, o.order_number, o.created_at,
      o.customer_name, o.customer_phone, o.customer_email,
      o.address, o.district, o.city, o.province, o.postal_code,
      p.title AS product_title, pv.title AS variant_title, pv.sku,
      oi.quantity, oi.unit_price,
      o.shipping_cost, o.discount_amount, o.cod_service_fee, o.total_amount,
      o.payment_method, o.payment_status,
      (SELECT ${LIST_SHIPPING_STATUS_SQL} FROM orders s WHERE s.id = o.id) AS shipping_status,
      o.courier_code, o.courier_service, o.cnote_no, o.provider_status_text,
      w.name AS warehouse_name, ps.scheduled_at AS pickup_scheduled_at,
      o.ad_click_ids, o.source_page_path,
      o.lead_follow_up_status, o.lead_follow_up_note, o.lead_followed_up_by,
      ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY oi.id) AS item_index
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
    LEFT JOIN warehouses w ON w.id = o.warehouse_id
    LEFT JOIN pickup_schedules ps ON ps.id = o.pickup_schedule_id
    WHERE o.id IN (${scopeSql})
    ORDER BY o.id DESC, oi.id
    LIMIT ?
  `;
}
