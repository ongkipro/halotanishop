import type { APIRoute } from 'astro';
import { jsonError } from '../../../../lib/api.ts';
import { getRuntimeEnv } from '../../../../lib/env.ts';
import {
  buildOrderCsv,
  isOrderExportKind,
  ORDER_EXPORT_ROW_LIMIT,
  orderExportFilename,
  orderExportScope,
  orderExportSql,
  type OrderExportRow,
} from '../../../../lib/order-export.ts';

export const prerender = false;

/**
 * CSV of Pesanan, Pesanan tertinggal or Pengiriman (`?kind=`), under the same
 * query string as the screen's own list. Customer data: the route sits under
 * `/api/admin/orders`, so only the roles that may read the order list reach it.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!database) return jsonError('Database order belum tersedia.', 503);

  const kind = url.searchParams.get('kind') || 'orders';
  if (!isOrderExportKind(kind)) return jsonError('Jenis export tidak dikenal.', 400);
  const scope = orderExportScope(kind, url.searchParams);
  if (!scope.ok) return jsonError(scope.error, scope.status, scope.code ? { code: scope.code } : undefined);

  try {
    const result = await database
      .prepare(orderExportSql(scope.sql))
      .bind(...scope.params, ORDER_EXPORT_ROW_LIMIT + 1)
      .all<OrderExportRow>();
    const rows = result.results ?? [];
    const truncated = rows.length > ORDER_EXPORT_ROW_LIMIT;
    // A cut file ends on a whole order: the order straddling the limit is
    // left out entirely rather than exported with some of its items.
    const cut = truncated ? rows[ORDER_EXPORT_ROW_LIMIT].order_id : null;
    const kept = truncated ? rows.slice(0, ORDER_EXPORT_ROW_LIMIT).filter((row) => row.order_id !== cut) : rows;
    return new Response(buildOrderCsv(kind, kept), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${orderExportFilename(kind)}"`,
        'Cache-Control': 'no-store',
        ...(truncated ? { 'X-Export-Truncated': String(kept.length) } : {}),
      },
    });
  } catch (error) {
    console.error('admin-orders-export', kind, error);
    return jsonError('Export gagal dibuat.', 500);
  }
};
