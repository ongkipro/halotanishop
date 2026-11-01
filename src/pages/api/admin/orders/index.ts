import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../../lib/api.ts';
import { CRM_BANK_ACCOUNTS_SQL, CRM_STORE_SQL, crmStoreContext, formatBankAccount } from '../../../../lib/crm-template.ts';
import { buyerLinkOrigin, buyerOrderLinks } from '../../../../lib/payment-switch.ts';
import { getRuntimeEnv } from '../../../../lib/env.ts';
import { shippingStatusLabel } from '../../../../lib/shipping-status.ts';
import { readOrderFollowUpsFor, type OrderFollowUp } from '../../../../lib/order-follow-up.ts';
import { dispatchOrderToMengantar } from '../../../../lib/mengantar-dispatch.ts';
import { parseMengantarPickupChoice } from '../../../../lib/mengantar-order.ts';
import {
  runMengantarOrderQueue,
  summarizeMengantarDispatchResults,
} from '../../../../lib/mengantar-order.ts';
import { getMengantarDispatchEligibility } from '../../../../lib/payment-dispatch-policy.ts';
import {
  ADMIN_SHIPPING_STATUSES,
  deleteOrdersReleasingReservations,
  OrderLifecycleError,
  updateAdminOrderShippingStatuses,
} from '../../../../lib/order-lifecycle.ts';
import type { AdminShippingStatus } from '../../../../lib/order-lifecycle.ts';
import { isRecentReceiverRefusal, scheduleReceiverPerformanceRefresh } from '../../../../lib/rts-scoring.ts';
import {
  ADMIN_CUSTOM_DATE_FILTER,
  isAdminDateFilter,
  parseAdminDateSelection,
} from '../../../../lib/admin-date-filter.ts';
import {
  sourceFacetStatement,
  sourceFilterOptions,
  sourceLabelsFromRows,
  sourceLabelsStatement,
  sourceSlugPredicate,
} from '../../../../lib/source-slug.ts';

/** The order lines the CRM templates list (`{{rincian_pesanan}}`). */
function parseItemsJson(raw: string | null) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.map((item) => ({
          product: typeof item?.product === "string" ? item.product : null,
          variant: typeof item?.variant === "string" ? item.variant : null,
          quantity: Number(item?.quantity) || 1,
          unit_price: Number(item?.unit_price) || 0,
          compare_price: Number(item?.compare_price) || null,
        }))
      : [];
  } catch {
    return [];
  }
}

export const prerender = false;

const BULK_SHIPPING_STATUSES = ADMIN_SHIPPING_STATUSES;
const SHIPPING_STATUSES = ['all', ...BULK_SHIPPING_STATUSES] as const;
const PAYMENT_STATUSES = ['all', 'unpaid', 'paid', 'settled', 'success', 'failed', 'refunded', 'expired'] as const;

type OrderRow = {
  id: number;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  district: string;
  city: string;
  province: string;
  product_name: string | null;
  variant_name: string | null;
  product_price: number;
  items_json: string | null;
  total_amount: number;
  shipping_cost: number;
  payment_method: string;
  payment_status: string;
  payment_instruction_status?: string | null;
  shipping_status: string;
  courier_code: string | null;
  cnote_no: string | null;
  seller_name: string | null;
  seller_bank_name: string | null;
  seller_account_holder: string | null;
  seller_account_number: string | null;
  public_status_token: string | null;
  stock_restored_at: string | null;
  destination_area_id: string | null;
  provider_order_id: string | null;
  provider_dispatch_error: string | null;
  provider_dispatch_claimed_at: string | null;
  pickup_address_id: string | null;
  receiver_delivery_rate: number | null;
  receiver_risk_label: string | null;
  receiver_refused_at: string | null;
  ad_click_ids: string | null;
  source_page_path: string | null;
  source_slug: string | null;
  created_at: string;
};

type OrderSummaryRow = {
  total_orders: number | string;
  unpaid_count: number | string;
  high_risk_count: number | string;
  total_value: number | string;
};

type OrderStatusCountRow = {
  shipping_status: string;
  count: number | string;
};

type OrderMutation = {
  action?: 'dispatch-orders';
  orderIds?: Array<number | string>;
  order_ids?: string[];
  status?: string;
  /** `dispatch-orders`: drop-off or a scheduled pickup for the batch (PRD A46). */
  pickup?: unknown;
};

export type BulkStatusUpdate = {
  orderIds: number[];
  status: AdminShippingStatus;
};

export function parseBulkStatusUpdate(body: unknown): BulkStatusUpdate {
  if (!body || typeof body !== 'object') {
    throw new Error('Payload order tidak valid.');
  }
  const payload = body as Record<string, unknown>;
  const status = String(payload.status || '').trim().toLowerCase();
  if (
    !BULK_SHIPPING_STATUSES.includes(
      status as BulkStatusUpdate['status'],
    )
  ) {
    throw new Error('Status pengiriman tidak valid.');
  }
  if (!Array.isArray(payload.order_ids)) {
    throw new Error('Daftar ID order wajib diisi.');
  }
  if (
    payload.order_ids.some(
      (orderId) => typeof orderId !== 'string' || !/^\d+$/.test(orderId),
    )
  ) {
    throw new Error('ID order harus berupa string angka.');
  }
  const orderIds = Array.from(
    new Set((payload.order_ids as string[]).map(Number)),
  ).filter((orderId) => Number.isInteger(orderId) && orderId > 0);
  if (orderIds.length === 0 || orderIds.length > 100) {
    throw new Error('Pilih 1 sampai 100 order untuk diperbarui.');
  }
  return { orderIds, status: status as BulkStatusUpdate['status'] };
}


/**
 * The status the list shows, filters and counts by. A pending order voided
 * through its payment (`payment_status = cancelled` sets `stock_restored_at`
 * but leaves shipping `pending`) is cancelled, not waiting: it read
 * "Menunggu konfirmasi" and counted under Menunggu (audit 2026-10-31 M2).
 */
const LIST_SHIPPING_STATUS_SQL =
  "(CASE WHEN shipping_status = 'pending' AND stock_restored_at IS NOT NULL THEN 'cancelled' ELSE shipping_status END)";

/**
 * Set by `/admin/orders` when it server-renders the first rows through this
 * route: the island's own fetch follows within a second, and scoring the same
 * unscored orders twice is a second provider call each. Forging it only
 * skips one refresh.
 */
export const ORDER_LIST_PREFETCH_HEADER = 'X-Order-List-Prefetch';

export const GET: APIRoute = async ({ url, locals, request }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database order belum tersedia.', 503);
  }

  const search = String(url.searchParams.get('search') || '').trim().slice(0, 120);
  const shippingStatus = String(url.searchParams.get('shipping_status') || 'all').trim().toLowerCase();
  const paymentStatus = String(url.searchParams.get('payment_status') || 'all').trim().toLowerCase();
  const dateFilter = String(url.searchParams.get('date_filter') || 'all').trim().toLowerCase();
  const sourceFilter = String(url.searchParams.get('source') || 'all').trim().toLowerCase();
  const page = Math.max(Number.parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1), 100);
  if (!SHIPPING_STATUSES.includes(shippingStatus as (typeof SHIPPING_STATUSES)[number])) {
    return jsonError('Filter status pengiriman tidak valid.', 400);
  }
  if (!PAYMENT_STATUSES.includes(paymentStatus as (typeof PAYMENT_STATUSES)[number])) {
    return jsonError('Filter status pembayaran tidak valid.', 400);
  }
  if (dateFilter !== ADMIN_CUSTOM_DATE_FILTER && !isAdminDateFilter(dateFilter)) {
    return jsonError('Filter periode order tidak valid.', 400);
  }

  try {
    let whereClause = '';
    const whereParts: string[] = ["shipping_status <> 'abandoned'"];
    const params: unknown[] = [];

    if (search) {
      const term = `%${search}%`;
      whereParts.push('(customer_name LIKE ? OR customer_phone LIKE ? OR order_number LIKE ? OR cnote_no LIKE ?)');
      params.push(term, term, term, term);
    }

    // Recorded separately: the summary reads every filter, but the status
    // chips must not filter by the status they let you pick, or selecting one
    // would zero the others and break the control.
    // The two indices differ: one search term pushes four params for a single
    // clause, so the clause position is not the param position.
    const shippingStatusIndex = shippingStatus !== 'all' ? whereParts.length : -1;
    const statusParamIndex = shippingStatus !== 'all' ? params.length : -1;
    if (shippingStatus !== 'all') {
      whereParts.push(`${LIST_SHIPPING_STATUS_SQL} = ?`);
      params.push(shippingStatus);
    }
    if (paymentStatus !== 'all') {
      whereParts.push('payment_status = ?');
      params.push(paymentStatus);
    }
    if (dateFilter !== 'all') {
      // Refuses an unresolvable period rather than answering for a different
      // one — passing the raw string straight in used to make anything
      // unrecognised, `custom` included, silently become the 7-day default.
      const { resolution } = parseAdminDateSelection(url.searchParams);
      if (!resolution.ok) {
        return jsonError(resolution.reason, 422, { code: 'DATE_RANGE_INVALID' });
      }
      whereParts.push("date(created_at, '+7 hours') BETWEEN ? AND ?");
      params.push(resolution.start, resolution.end);
    }
    // The landing page the order came from (PRD A36). A read filter only.
    const sourceSlug = sourceSlugPredicate(url.searchParams.get('source_slug'));
    if (sourceSlug) {
      whereParts.push(sourceSlug.sql);
      params.push(...sourceSlug.params);
    }
    if (sourceFilter === 'meta') {
      whereParts.push("(ad_click_ids LIKE '%fbclid%' OR ad_click_ids LIKE '%_fbc%' OR ad_click_ids LIKE '%meta%' OR ad_click_ids LIKE '%facebook%' OR ad_click_ids LIKE '%instagram%')");
    } else if (sourceFilter === 'google') {
      whereParts.push("(ad_click_ids LIKE '%gclid%' OR ad_click_ids LIKE '%gbraid%' OR ad_click_ids LIKE '%wbraid%' OR ad_click_ids LIKE '%google%')");
    } else if (sourceFilter === 'organic') {
      // `%ttclid%` stays excluded even though TikTok is no longer a filterable
      // source (removed below): an order captured one before that removal has
      // a real ad click id on it, and must not read as organic just because
      // its own category went away.
      whereParts.push("(ad_click_ids IS NULL OR ad_click_ids = '' OR ad_click_ids = '{}' OR (ad_click_ids NOT LIKE '%fbclid%' AND ad_click_ids NOT LIKE '%gclid%' AND ad_click_ids NOT LIKE '%ttclid%' AND ad_click_ids NOT LIKE '%gbraid%' AND ad_click_ids NOT LIKE '%wbraid%'))");
    }

    whereClause = ` WHERE ${whereParts.join(' AND ')}`;
    // Same filters minus the status predicate, for the chips.
    const chipParts = whereParts.filter((_, index) => index !== shippingStatusIndex);
    const chipParams = params.filter((_, index) => index !== statusParamIndex);
    const chipWhereClause = ` WHERE ${chipParts.join(' AND ')}`;
    const offset = (page - 1) * limit;
    const db = database as D1Database;

    const countStmt = db
      .prepare(`SELECT COUNT(*) AS total_items FROM orders${whereClause}`)
      .bind(...params);
    const ordersStmt = db.prepare(`
        SELECT
          id,
          order_number,
          customer_name,
          customer_phone,
          address,
          district,
          city,
          province,
          (
            SELECT GROUP_CONCAT(COALESCE(products.title, product_variants.title, ''), ', ')
            FROM order_items
            LEFT JOIN product_variants ON product_variants.id = order_items.variant_id
            LEFT JOIN products ON products.id = product_variants.product_id
            WHERE order_items.order_id = orders.id
          ) AS product_name,
          (
            SELECT GROUP_CONCAT(product_variants.title, ', ')
            FROM order_items
            LEFT JOIN product_variants ON product_variants.id = order_items.variant_id
            WHERE order_items.order_id = orders.id
          ) AS variant_name,
          (
            SELECT COALESCE(SUM(order_items.quantity * order_items.unit_price), 0)
            FROM order_items
            WHERE order_items.order_id = orders.id
          ) AS product_price,
          (
            SELECT json_group_array(json_object(
              'product', products.title, 'variant', product_variants.title,
              'quantity', order_items.quantity, 'unit_price', order_items.unit_price,
              'compare_price', product_variants.compare_price))
            FROM order_items
            LEFT JOIN product_variants ON product_variants.id = order_items.variant_id
            LEFT JOIN products ON products.id = product_variants.product_id
            WHERE order_items.order_id = orders.id
          ) AS items_json,
          total_amount,
          shipping_cost,
          payment_method,
          payment_status,
          ${LIST_SHIPPING_STATUS_SQL} AS shipping_status,
          courier_code,
          cnote_no,
          (
            SELECT name
            FROM stores
            WHERE stores.id = orders.store_id
          ) AS seller_name,
          seller_bank_name,
          seller_account_holder,
          seller_account_number,
          public_status_token,
          stock_restored_at,
          (
            SELECT CASE
              WHEN pt.status = 'pending' AND pt.expires_at IS NOT NULL AND pt.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'expired'
              ELSE pt.status END
            FROM payment_transactions pt
            WHERE pt.order_id = orders.id
            ORDER BY pt.id DESC
            LIMIT 1
          ) AS payment_instruction_status,
          destination_area_id,
          provider_order_id,
          provider_dispatch_error,
          provider_dispatch_claimed_at,
          (
            SELECT pickup_address_id
            FROM warehouses
            WHERE warehouses.id = orders.warehouse_id
          ) AS pickup_address_id,
          receiver_rts_score AS receiver_delivery_rate,
          rts_risk_label AS receiver_risk_label,
          CASE WHEN json_valid(receiver_performance_json)
            THEN json_extract(receiver_performance_json, '$.at') END AS receiver_refused_at,
          ad_click_ids,
          source_page_path,
          source_slug,
          created_at
        FROM orders
        ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset);
    const withSourceOptions = url.searchParams.get('source_options') === '1';
    const [countResult, rowResult, summaryResult, crmResult, bankResult, statusCountResult, labelResult, facetResult] = await db.batch([
      countStmt,
      ordersStmt,
      // Scoped to the active filters. These cards used to answer for the whole
      // store no matter what was selected, so a one-day range showed the day's
      // rows in the table beside an all-time total in the card — an operator
      // reconciling a day's takings read the wrong number.
      db.prepare(`
        SELECT
          COUNT(*) AS total_orders,
          SUM(CASE WHEN payment_status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_count,
          SUM(CASE WHEN UPPER(COALESCE(rts_risk_label, '')) LIKE '%HIGH%' THEN 1 ELSE 0 END) AS high_risk_count,
          COALESCE(SUM(total_amount), 0) AS total_value
        FROM orders${whereClause}
      `).bind(...params),
      db.prepare(CRM_STORE_SQL),
      db.prepare(CRM_BANK_ACCOUNTS_SQL),
      db.prepare(`
        SELECT ${LIST_SHIPPING_STATUS_SQL} AS shipping_status, COUNT(*) AS count
        FROM orders${chipWhereClause}
        GROUP BY 1
      `).bind(...chipParams),
      // Names for the source chip, bounded by the catalogue.
      sourceLabelsStatement(db),
      // The source filter's menu, asked for once per list load.
      withSourceOptions
        ? sourceFacetStatement(db, 'orders')
        : db.prepare('SELECT NULL AS slug, 0 AS count WHERE 0'),
    ]);
    const facets = (facetResult?.results ?? []) as Array<{ slug: string; count: number }>;
    const sourceLabels = sourceLabelsFromRows(
      [
        ...((rowResult.results ?? []) as OrderRow[]).map((row) => row.source_slug),
        ...facets.map((row) => row.slug),
      ],
      (labelResult?.results ?? []) as Parameters<typeof sourceLabelsFromRows>[1],
    );

    const totalItems = Number((countResult.results?.[0] as { total_items?: number | string } | undefined)?.total_items ?? 0);
    const totalPages = totalItems > 0 ? Math.ceil(totalItems / limit) : 0;
    const summary = (summaryResult.results?.[0] ?? {}) as Partial<OrderSummaryRow>;
    const crm = crmStoreContext(
      crmResult.results?.[0] as Parameters<typeof crmStoreContext>[0],
      (bankResult.results ?? []) as Parameters<typeof crmStoreContext>[1],
    );
    const statusCounts = Object.fromEntries(
      ((statusCountResult.results ?? []) as OrderStatusCountRow[]).map((row) => [
        row.shipping_status,
        Number(row.count) || 0,
      ]),
    );
    const fallbackPickupAddressId = String(
      getRuntimeEnv(locals)?.MENGANTAR_PICKUP_ADDRESS_ID || '',
    ).trim();

    const rows = (rowResult.results ?? []) as OrderRow[];
    const prefetch = request?.headers.get(ORDER_LIST_PREFETCH_HEADER) === '1';
    for (const row of prefetch ? [] : rows.slice(0, 10)) {
      if (row.receiver_risk_label === null && row.customer_phone && !isRecentReceiverRefusal(row.receiver_refused_at)) {
        scheduleReceiverPerformanceRefresh(db, row.order_number, row.customer_phone, locals);
      }
    }

    // The chips' state for the whole page in one read (REQ-249). A failed
    // read leaves it out, and each panel then reads its own order.
    let followUps: Map<number, OrderFollowUp[]> | null = null;
    try {
      followUps = await readOrderFollowUpsFor(db, rows.map((row) => Number(row.id)));
    } catch (error) {
      console.error('admin-orders-follow-up-read-failed', error instanceof Error ? error.name : 'unknown');
    }

    return jsonOk({
      data: rows.map((row) => {
        const dispatch = getMengantarDispatchEligibility({
          paymentMethod: row.payment_method,
          paymentStatus: row.payment_status,
          shippingStatus: row.shipping_status,
          providerOrderId: row.provider_order_id,
          providerDispatchError: row.provider_dispatch_error,
          providerDispatchClaimedAt: row.provider_dispatch_claimed_at,
          destinationAreaId: row.destination_area_id,
          courierCode: row.courier_code,
          pickupAddressId: row.pickup_address_id || fallbackPickupAddressId,
        });
        return {
          id: row.id,
          order_number: row.order_number,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          address: row.address,
          district: row.district,
          city: row.city,
          province: row.province,
          product_name: row.product_name,
          variant_name: row.variant_name,
          product_price: row.product_price,
          items: parseItemsJson(row.items_json),
          total_amount: row.total_amount,
          shipping_cost: row.shipping_cost,
          payment_method: row.payment_method,
          payment_status: row.payment_status,
          payment_instruction_status: row.payment_instruction_status || null,
          shipping_status: row.shipping_status,
          courier_code: row.courier_code,
          cnote_no: row.cnote_no,
          seller_name: row.seller_name,
          // The account this order was told to pay, else the store's active ones.
          bank_accounts:
            formatBankAccount(row.seller_bank_name, row.seller_account_number, row.seller_account_holder) ||
            crm.bank_accounts,
          ...buyerOrderLinks(buyerLinkOrigin(locals.tenant?.siteUrl, url.origin), row),
          dispatch_eligible: dispatch.eligible,
          dispatch_reason: dispatch.reason,
          provider_dispatch_error: row.provider_dispatch_error,
          receiver_delivery_rate: row.receiver_delivery_rate,
          receiver_risk_label: row.receiver_risk_label,
          ad_click_ids: row.ad_click_ids,
          source_page_path: row.source_page_path,
          source_slug: row.source_slug,
          source_label: row.source_slug ? sourceLabels.get(row.source_slug)?.label ?? row.source_slug : null,
          created_at: row.created_at,
          follow_ups: followUps ? followUps.get(Number(row.id)) ?? [] : null,
        };
      }),
      ...(withSourceOptions ? { source_options: sourceFilterOptions(facets, sourceLabels) } : {}),
      crm_templates: crm.templates,
      pagination: {
        page,
        limit,
        total_items: totalItems,
        total_pages: totalPages,
      },
      summary: {
        total_orders: Number(summary.total_orders ?? 0),
        unpaid_count: Number(summary.unpaid_count ?? 0),
        high_risk_count: Number(summary.high_risk_count ?? 0),
        total_value: Number(summary.total_value ?? 0),
      },
      status_counts: {
        // The "Semua" chip means "what you would see if you cleared the status
        // filter", so it follows the chip scope — not the summary, which is
        // now filtered by the selected status and would make this read 1 while
        // the chip beside it reads 12.
        all: Object.values(statusCounts).reduce(
          (total, count) => total + Number(count || 0),
          0,
        ),
        pending: statusCounts.pending || 0,
        processing: statusCounts.processing || 0,
        shipped: statusCounts.shipped || 0,
        delivered: statusCounts.delivered || 0,
        cancelled: statusCounts.cancelled || 0,
      },
    });
  } catch (error) {
    console.error('admin-orders-get', error);
    return jsonError('Gagal mengambil data orders.', 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database order belum tersedia.', 503);
  }
  const body = (await request.json().catch(() => null)) as OrderMutation | null;
  if (!body) {
    return jsonError('Payload order tidak valid.', 400);
  }

  if (Array.isArray(body.order_ids) || typeof body.status === 'string') {
    let update: BulkStatusUpdate;
    try {
      update = parseBulkStatusUpdate(body);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : 'Payload order tidak valid.',
        400,
      );
    }

    try {
      const updatedCount = await updateAdminOrderShippingStatuses(
        database as D1Database,
        update.orderIds,
        update.status,
      );
      return jsonOk({
        message: `${updatedCount} order berhasil diubah ke ${shippingStatusLabel(update.status)}.`,
        data: {
          updated_count: updatedCount,
          order_ids: update.orderIds.map(String),
          status: update.status,
        },
      });
    } catch (error) {
      if (error instanceof OrderLifecycleError) {
        return jsonError(error.message, error.status);
      }
      console.error('admin-orders-bulk-status', error);
      return jsonError('Gagal memperbarui status order.', 500);
    }
  }

  if (body.action !== 'dispatch-orders') {
    return jsonError('Aksi order tidak valid.', 400);
  }
  const orderIds = Array.from(
    new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(Number)),
  ).filter((orderId) => Number.isInteger(orderId) && orderId > 0);
  if (orderIds.length === 0 || orderIds.length > 50) {
    return jsonError('Pilih 1 sampai 50 order untuk dikirim ke Mengantar.', 400);
  }
  const pickupChoice = parseMengantarPickupChoice(body.pickup);
  if (!pickupChoice.ok) return jsonError(pickupChoice.reason, 400);

  const db = database as D1Database;
  // One slot per pickup address for the whole batch (PRD A46).
  const pickup = { choice: pickupChoice.choice, timeIds: new Map<string, string>() };
  const results = await runMengantarOrderQueue(
    orderIds,
    (orderId) => dispatchOrderToMengantar(db, locals, orderId, pickup),
  );
  const dispatchSummary = summarizeMengantarDispatchResults(results);
  return jsonOk({
    message: `${dispatchSummary.created} order berhasil dibuat di Mengantar; ${dispatchSummary.unpaid} draft menunggu top up; ${dispatchSummary.failed} gagal; ${dispatchSummary.skipped} belum diproses.`,
    data: { results, summary: dispatchSummary },
  });
};
export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.admin) return jsonError('Unauthorized', 401);
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database order belum tersedia.', 503);
  }
  try {
    const body = (await request.json().catch(() => null)) as { ids?: (number | string)[] } | null;
    const ids = Array.from(
      new Set((body?.ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    );

    if (ids.length === 0) {
      return jsonError('Tidak ada ID order valid yang dipilih untuk dihapus.', 400);
    }

    const db = database as D1Database;
    const deleted = await deleteOrdersReleasingReservations(db, ids);

    return jsonOk({
      success: true,
      deleted_count: deleted.length,
      deleted_ids: deleted.map((order) => order.id),
    });
  } catch (error) {
    if (error instanceof OrderLifecycleError) {
      return jsonError(error.message, error.status);
    }
    console.error('DELETE admin/orders error:', error);
    return jsonError('Gagal menghapus pesanan.', 500);
  }
};
