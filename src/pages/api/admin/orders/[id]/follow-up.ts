import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../../../lib/api.ts';
import { getRuntimeEnv } from '../../../../../lib/env.ts';
import { parseOrderFollowUp, readOrderFollowUps, saveOrderFollowUp } from '../../../../../lib/order-follow-up.ts';
import { orderRowSql } from '../../../../../lib/order-metrics.ts';

export const prerender = false;

const handle: APIRoute = async ({ params, request, locals }) => {
  const admin = locals.admin;
  if (!admin) return jsonError('Sesi berakhir.', 401);
  if (!['owner', 'admin', 'customer_service'].includes(admin.role)) return jsonError('Akses ditolak.', 403);
  if (!admin.username) return jsonError('Identitas operator tidak tersedia.', 403);
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return jsonError('ID order tidak valid.', 400);
  const db = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!db) return jsonError('Database belum tersedia.', 503);
  const orderExists = async () => !!(await db.prepare(`SELECT id FROM orders WHERE id = ? AND ${orderRowSql()}`).bind(id).first());
  try {
    if (!(await orderExists())) return jsonError('Order tidak ditemukan.', 404);
    if (request.method === 'GET') return jsonOk({ data: await readOrderFollowUps(db, id) });
    const input = parseOrderFollowUp(await request.json().catch(() => null));
    if (!input) return jsonError('Tahap, status, atau revisi tidak valid. Catatan maksimal 1.000 karakter; koreksi wajib diberi alasan.', 400);
    const row = await saveOrderFollowUp(db, id, input, admin.username);
    // The upsert also refuses a vanished order; say so instead of blaming a race.
    if (!row && !(await orderExists())) return jsonError('Order tidak ditemukan.', 404);
    if (!row) return jsonError('Catatan berubah oleh operator lain. Muat ulang sebelum menyimpan kembali.', 409);
    return jsonOk({ data: row });
  } catch (error) {
    console.error('admin-order-follow-up-failed', { orderId: id, error: error instanceof Error ? error.name : 'unknown' });
    return jsonError('Catatan follow-up belum dapat disimpan atau dimuat.', 500);
  }
};
export const GET = handle;
export const PUT = handle;
