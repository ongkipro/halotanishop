import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../../lib/api.ts';
import { getRuntimeEnv } from '../../../../lib/env.ts';
import { readOrderAttention } from '../../../../lib/order-attention.ts';

export const prerender = false;

/**
 * The dashboard's "Perlu tindakan" panel (`order-attention.ts`). Under
 * `/api/admin/orders`, so only the roles that work the order list read it.
 */
export const GET: APIRoute = async ({ locals }) => {
  const env = getRuntimeEnv(locals);
  const database = env?.OMS_DB as D1Database | undefined;
  if (!database) return jsonError('Database order belum tersedia.', 503);
  try {
    const data = await readOrderAttention(database, {
      fallbackPickupAddressId: String(env?.MENGANTAR_PICKUP_ADDRESS_ID || ''),
    });
    return jsonOk({ data }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    console.error('admin-orders-attention', error);
    return jsonError('Daftar tindakan gagal dimuat.', 500);
  }
};
