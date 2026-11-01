import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../lib/api.ts';
import { getRuntimeEnv } from '../../../lib/env.ts';
import { ORDER_ROW, RELEASED_ORDER } from '../../../lib/order-metrics.ts';

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
    const row = await (database as D1Database).prepare(`
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
        COALESCE(SUM(CASE WHEN payment_method NOT IN ('cod', 'manual_transfer', 'bank_transfer', 'qris') THEN 1 ELSE 0 END), 0) AS unknown_payment_orders
      FROM orders
      ${dateFilter}
    `).bind(...params).first() as AnalyticsRow | null;

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

    const groupBy = interval === 'hour' ? "STRFTIME('%Y-%m-%d %H:00:00', created_at, '+7 hours')" : "DATE(created_at, '+7 hours')";
    const trendsResult = await (database as D1Database).prepare(`
      SELECT 
        ${groupBy} as date,
        COALESCE(SUM(CASE WHEN ${RELEASED_ORDER} THEN 0 ELSE total_amount END), 0) as revenue,
        COUNT(*) as orders
      FROM orders
      ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY date ASC
    `).bind(...params).all<TrendRow>();

    const trends = [];
    if (startParam && endParam) {
      if (interval === 'hour') {
        // Generate 24 hours for the start date
        const baseDate = startParam; // YYYY-MM-DD
        for (let i = 0; i < 24; i++) {
          const hourStr = String(i).padStart(2, '0');
          const dateStr = `${baseDate} ${hourStr}:00:00`;
          const match = trendsResult.results?.find(r => r.date === dateStr);
          trends.push({
            date: dateStr,
            revenue: Number(match?.revenue ?? 0),
            orders: Number(match?.orders ?? 0)
          });
        }
      } else {
        // Generate complete date sequence for the range to avoid gaps
        const start = new Date(startParam);
        const end = new Date(endParam);
        
        const diffTime = end.getTime() - start.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        for (let i = diffDays; i >= 0; i--) {
          const d = new Date(end);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          const match = trendsResult.results?.find(r => r.date === dateStr);
          trends.push({
            date: dateStr,
            revenue: Number(match?.revenue ?? 0),
            orders: Number(match?.orders ?? 0)
          });
        }
      }
    } else {
      // All time. The grouped results only contain days that have orders, so
      // pushing them as-is drew a bar chart that silently skipped every empty
      // day between them — two bars for a fortnight. Fill the span between
      // the first and last order with zeros so the axis is continuous.
      const rows = trendsResult.results ?? [];
      const first = rows[0]?.date;
      const last = rows[rows.length - 1]?.date;
      if (first && last) {
        const byDate = new Map(rows.map((r) => [r.date, r]));
        const cursor = new Date(`${first}T00:00:00.000Z`);
        const stop = new Date(`${last}T00:00:00.000Z`);
        while (cursor.getTime() <= stop.getTime()) {
          const key = cursor.toISOString().slice(0, 10);
          const match = byDate.get(key);
          trends.push({
            date: key,
            revenue: Number(match?.revenue ?? 0),
            orders: Number(match?.orders ?? 0),
          });
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
      // Keep the original branch as a no-op guard for rows outside the span.
      ([] as typeof rows).forEach(r => {
        trends.push({
          date: r.date,
          revenue: Number(r.revenue ?? 0),
          orders: Number(r.orders ?? 0)
        });
      });
    }

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
