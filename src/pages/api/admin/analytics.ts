import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../lib/api.ts';
import { getRuntimeEnv } from '../../../lib/env.ts';
import { LEAD_ROW, ORDER_ROW, RELEASED_ORDER } from '../../../lib/order-metrics.ts';
import { compareCutoff, compareRange, defaultCompareMode, isCompareMode } from '../../../lib/dashboard-compare.ts';

export const prerender = false;

type AnalyticsRow = {
  total_orders: number | string | null;
  total_revenue: number | string | null;
  collected_revenue: number | string | null;
  live_orders: number | string | null;
  online_orders: number | string | null;
  delivered_orders: number | string | null;
  returned_orders: number | string | null;
  paid_orders: number | string | null;
  cod_orders: number | string | null;
  manual_transfer_orders: number | string | null;
  virtual_account_orders: number | string | null;
  qris_orders: number | string | null;
  unknown_payment_orders: number | string | null;
  handed_over_orders: number | string | null;
  cod_revenue: number | string | null;
};

type TrendRow = {
  date: string;
  revenue: number | string | null;
  orders: number | string | null;
};
const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

export const GET: APIRoute = async ({ locals, url }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database analytics belum tersedia.', 503);
  }

  const startParam = url.searchParams.get('startDate');
  const endParam = url.searchParams.get('endDate');
  if (
    (startParam && !isIsoDate(startParam)) ||
    (endParam && !isIsoDate(endParam))
  ) {
    return jsonError('Rentang tanggal tidak valid.', 400);
  }
  // A half-open range escaped the cap: `?startDate=1970-01-01` alone fell
  // through to an unbounded `>= ?` scan. Requiring both ends keeps every dated
  // request inside the 31-day ceiling; omitting both is still the "all time"
  // request the dashboard's own preset makes.
  if (Boolean(startParam) !== Boolean(endParam)) {
    return jsonError('Tanggal mulai dan akhir harus diisi bersama.', 400);
  }
  if (startParam && endParam) {
    const startTime = Date.parse(`${startParam}T00:00:00.000Z`);
    const endTime = Date.parse(`${endParam}T00:00:00.000Z`);
    if (endTime < startTime || (endTime - startTime) / 86_400_000 > 30) {
      return jsonError('Rentang tanggal maksimal 31 hari.', 400);
    }
  }
  const interval =
    url.searchParams.get('interval') === 'hour' &&
    Boolean(startParam) &&
    startParam === endParam
      ? 'hour'
      : 'day';

  const conditions = [ORDER_ROW];
  const params: string[] = [];

  if (startParam && endParam) {
    conditions.push("date(created_at, '+7 hours') BETWEEN ? AND ?");
    params.push(startParam, endParam);
  }
  const dateFilter = `WHERE ${conditions.join(' AND ')}`;
  // RELEASED_ORDER (src/lib/order-metrics.ts) is used by the summary AND the
  // trends query, and by the Analitik menu, so a card, the chart beneath it
  // and a ranking cannot drift apart.

  try {
    const summarySql = `
      SELECT
        COUNT(*) AS total_orders,
        -- Order value of orders still in play. A cancelled order, a returned
        -- one, or a failed online payment is not revenue in any sense an
        -- operator means, and summing it under "Omset" reported Rp 1.67M on a
        -- store with zero paid orders. RELEASED_ORDER is shared with the trends
        -- query below so the chart can never disagree with this card again.
        COALESCE(SUM(CASE WHEN ${RELEASED_ORDER} THEN 0 ELSE total_amount END), 0) AS total_revenue,
        -- Money the merchant actually keeps: paid orders only, net of shipping
        -- and the COD service fee, both of which pass through to the courier.
        -- total_amount alone would have labelled courier money "diterima".
        COALESCE(SUM(CASE
          WHEN payment_status IN ('paid', 'settled', 'success')
          THEN total_amount
            - COALESCE(shipping_cost, 0)
            - COALESCE(cod_service_fee, 0)
            - COALESCE(cod_service_fee_vat, 0)
          ELSE 0 END), 0) AS collected_revenue,
        COALESCE(SUM(CASE WHEN ${RELEASED_ORDER} THEN 0 ELSE 1 END), 0) AS live_orders,
        -- COD is paid on delivery, so it can never count as a successful
        -- prepayment; measuring payment success over all orders made a
        -- COD-heavy store read as a failing gateway forever.
        COALESCE(SUM(CASE WHEN payment_method <> 'cod' THEN 1 ELSE 0 END), 0) AS online_orders,
        COALESCE(SUM(CASE WHEN shipping_status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_orders,
        COALESCE(SUM(CASE WHEN shipping_status = 'returned' THEN 1 ELSE 0 END), 0) AS returned_orders,
        COALESCE(SUM(CASE WHEN payment_status IN ('paid', 'settled', 'success') THEN 1 ELSE 0 END), 0) AS paid_orders,
        COALESCE(SUM(CASE WHEN payment_method = 'cod' THEN 1 ELSE 0 END), 0) AS cod_orders,
        COALESCE(SUM(CASE WHEN payment_method = 'manual_transfer' THEN 1 ELSE 0 END), 0) AS manual_transfer_orders,
        COALESCE(SUM(CASE WHEN payment_method = 'bank_transfer' THEN 1 ELSE 0 END), 0) AS virtual_account_orders,
        COALESCE(SUM(CASE WHEN payment_method = 'qris' THEN 1 ELSE 0 END), 0) AS qris_orders,
        COALESCE(SUM(CASE WHEN payment_method NOT IN ('cod', 'manual_transfer', 'bank_transfer', 'qris') THEN 1 ELSE 0 END), 0) AS unknown_payment_orders,
        -- Handed to Mengantar: the shipment exists there (provider order id),
        -- whatever happened to it since. The funnel's middle step.
        COALESCE(SUM(CASE WHEN provider_order_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS handed_over_orders,
        -- Live revenue that is COD: its money arrives only when the parcel does.
        COALESCE(SUM(CASE WHEN payment_method = 'cod' AND NOT (${RELEASED_ORDER}) THEN total_amount ELSE 0 END), 0) AS cod_revenue
      FROM orders
      ${dateFilter}
    `;
    const row = await (database as D1Database).prepare(summarySql).bind(...params).first() as AnalyticsRow | null;

    const totalOrders = Number(row?.total_orders ?? 0);
    const totalRevenue = Number(row?.total_revenue ?? 0);
    const collectedRevenue = Number(row?.collected_revenue ?? 0);
    const liveOrders = Number(row?.live_orders ?? 0);
    const onlineOrders = Number(row?.online_orders ?? 0);
    const deliveredOrders = Number(row?.delivered_orders ?? 0);
    const returnedOrders = Number(row?.returned_orders ?? 0);
    const paidOrders = Number(row?.paid_orders ?? 0);
    const codOrders = Number(row?.cod_orders ?? 0);
    const manualTransferOrders = Number(row?.manual_transfer_orders ?? 0);
    const virtualAccountOrders = Number(row?.virtual_account_orders ?? 0);
    const qrisOrders = Number(row?.qris_orders ?? 0);
    const unknownPaymentOrders = Number(row?.unknown_payment_orders ?? 0);
    const ratio = (value: number) => (totalOrders > 0 ? Number(((value / totalOrders) * 100).toFixed(2)) : 0);
    const pct = (value: number, base: number) => (base > 0 ? Number(((value / base) * 100).toFixed(2)) : 0);
    // Returns only make sense against shipments that reached an outcome. An
    // order never dispatched cannot be returned, so counting it in the base
    // reported 0% RTS on any store that had not shipped yet.
    const rtsBase = deliveredOrders + returnedOrders;

    // The funnel's first step: leads still unconverted, created in the period.
    // A lead that checked out became an order and is counted there instead.
    const leadConditions = [LEAD_ROW, ...conditions.slice(1)];
    const leadRow = await (database as D1Database)
      .prepare(`SELECT COUNT(*) AS leads FROM orders WHERE ${leadConditions.join(' AND ')}`)
      .bind(...params)
      .first<{ leads: number | string | null }>();
    const leads = Number(leadRow?.leads ?? 0);

    // The comparison period (`dashboard-compare.ts`): last week's same
    // weekday for a day, last month's same dates for a month, else the equal
    // period just before. A period running to today is compared only up to
    // the same moment of its own day. Only for a dated request.
    const requestedCompare = url.searchParams.get('compare');
    const compareMode = isCompareMode(requestedCompare)
      ? requestedCompare
      : defaultCompareMode(url.searchParams.get('preset') || '');
    let previous: Record<string, unknown> | null = null;
    let previousRange: { start: string; end: string; cutoff: string | null } | null = null;
    if (startParam && endParam) {
      const range = compareRange(startParam, endParam, compareMode);
      const cutoff = compareCutoff(startParam, endParam, range.start, range.end);
      previousRange = { ...range, cutoff };
      const previousSql = cutoff
        ? summarySql.replace(dateFilter, `${dateFilter} AND created_at < ?`)
        : summarySql;
      const before = await (database as D1Database)
        .prepare(previousSql)
        .bind(...(cutoff ? [range.start, range.end, cutoff] : [range.start, range.end]))
        .first() as AnalyticsRow | null;
      const beforeLeads = await (database as D1Database)
        .prepare(`SELECT COUNT(*) AS leads FROM orders WHERE ${leadConditions.join(' AND ')}${cutoff ? ' AND created_at < ?' : ''}`)
        .bind(...(cutoff ? [range.start, range.end, cutoff] : [range.start, range.end]))
        .first<{ leads: number | string | null }>();
      const beforeOnline = Number(before?.online_orders ?? 0);
      const beforeDelivered = Number(before?.delivered_orders ?? 0);
      const beforeReturned = Number(before?.returned_orders ?? 0);
      const beforeLive = Number(before?.live_orders ?? 0);
      const beforeRevenue = Number(before?.total_revenue ?? 0);
      const beforeOrders = Number(before?.total_orders ?? 0);
      const beforeLeadCount = Number(beforeLeads?.leads ?? 0);
      previous = {
        mode: compareMode,
        start_date: range.start,
        end_date: range.end,
        partial: Boolean(cutoff),
        total_revenue: beforeRevenue,
        live_orders: beforeLive,
        average_order_value: beforeLive > 0 ? Math.round(beforeRevenue / beforeLive) : 0,
        lead_conversion_rate: pct(beforeOrders, beforeOrders + beforeLeadCount),
        lead_base: beforeOrders + beforeLeadCount,
        conversion_rate: pct(Number(before?.paid_orders ?? 0), beforeOnline),
        online_orders: beforeOnline,
        rts_rate: pct(beforeReturned, beforeDelivered + beforeReturned),
        rts_base: beforeDelivered + beforeReturned,
      };
    }

    const groupBy = interval === 'hour' ? "STRFTIME('%Y-%m-%d %H:00:00', created_at, '+7 hours')" : "DATE(created_at, '+7 hours')";
    const trendSql = `
      SELECT
        ${groupBy} as date,
        COALESCE(SUM(CASE WHEN ${RELEASED_ORDER} THEN 0 ELSE total_amount END), 0) as revenue,
        COUNT(*) as orders
      FROM orders
      ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY date ASC
    `;
    const trendsResult = await (database as D1Database).prepare(trendSql).bind(...params).all<TrendRow>();
    const trends = buildTrends(trendsResult.results ?? [], startParam, endParam, interval);

    // The comparison's own buckets, whole (not cut at the moment), lined up
    // with the current ones by position: hour h against hour h, day i
    // against day i. The chart draws it as a dashed overlay.
    let previousTrends: Array<{ date: string; revenue: number; orders: number }> = [];
    if (previousRange) {
      const rows = await (database as D1Database)
        .prepare(trendSql)
        .bind(previousRange.start, previousRange.end)
        .all<TrendRow>();
      previousTrends = buildTrends(rows.results ?? [], previousRange.start, previousRange.end, interval);
    }
    if (previous) previous.trends = previousTrends;

    return jsonOk({
      data: {
        total_revenue: totalRevenue,
        collected_revenue: collectedRevenue,
        total_orders: totalOrders,
        live_orders: liveOrders,
        online_orders: onlineOrders,
        conversion_rate: pct(paidOrders, onlineOrders),
        rts_rate: pct(returnedOrders, rtsBase),
        rts_base: rtsBase,
        average_order_value: liveOrders > 0 ? Math.round(totalRevenue / liveOrders) : 0,
        lead_conversion_rate: pct(totalOrders, totalOrders + leads),
        lead_base: totalOrders + leads,
        cod_revenue: Number(row?.cod_revenue ?? 0),
        prepaid_revenue: totalRevenue - Number(row?.cod_revenue ?? 0),
        funnel: {
          leads,
          orders: totalOrders,
          handed_over: Number(row?.handed_over_orders ?? 0),
          delivered: deliveredOrders,
          returned: returnedOrders,
        },
        previous,
        cod_percentage: ratio(codOrders),
        transfer_percentage: ratio(virtualAccountOrders),
        qris_percentage: ratio(qrisOrders),
        payment_methods: {
          total: totalOrders,
          cod: { count: codOrders, percentage: ratio(codOrders) },
          manual_transfer: {
            count: manualTransferOrders,
            percentage: ratio(manualTransferOrders),
          },
          virtual_account: {
            count: virtualAccountOrders,
            percentage: ratio(virtualAccountOrders),
          },
          qris: { count: qrisOrders, percentage: ratio(qrisOrders) },
          unknown_count: unknownPaymentOrders,
        },
        period: {
          start_date: startParam || null,
          end_date: endParam || null,
          timezone: 'Asia/Jakarta',
          basis: 'order_created_at',
          interval,
        },
        trends
      },
      message: totalOrders > 0 ? 'Analytics dihitung dari data order D1 saat ini.' : 'Belum ada order untuk dihitung.',
    });
  } catch (error) {
    console.error('admin-analytics-get', error);
    return jsonError('Gagal mengambil data analytics.', 500);
  }
};

/**
 * Every bucket of the period, zero where nothing sold: 24 hours for a single
 * day, every day otherwise, or for "all time" the span between the first and
 * last order. An axis that skipped empty days drew two bars for a fortnight.
 */
function buildTrends(
  rows: TrendRow[],
  start: string | null,
  end: string | null,
  interval: 'hour' | 'day',
) {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const bucket = (date: string) => {
    const match = byDate.get(date);
    return { date, revenue: Number(match?.revenue ?? 0), orders: Number(match?.orders ?? 0) };
  };
  const out: Array<{ date: string; revenue: number; orders: number }> = [];
  if (start && end && interval === 'hour') {
    for (let hour = 0; hour < 24; hour += 1) out.push(bucket(`${start} ${String(hour).padStart(2, '0')}:00:00`));
    return out;
  }
  const first = start ?? rows[0]?.date;
  const last = end ?? rows[rows.length - 1]?.date;
  if (!first || !last) return out;
  const cursor = new Date(`${first}T00:00:00.000Z`);
  const stop = new Date(`${last}T00:00:00.000Z`);
  while (cursor.getTime() <= stop.getTime()) {
    out.push(bucket(cursor.toISOString().slice(0, 10)));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
