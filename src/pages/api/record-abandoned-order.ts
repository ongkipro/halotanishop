import type { APIRoute } from 'astro';
import { getRuntimeEnv } from '../../lib/env.ts';
import { json, jsonError, jsonOk } from '../../lib/api.ts';
import { recordAbandonedOrder } from '../../lib/order-persistence.ts';
import {
  checkRateLimit,
  getClientIp,
  rateLimitHeaders,
} from '../../lib/rate-limit.ts';
import { sourcePathFromReferer } from '../../lib/source-slug.ts';
import { isValidWa62, normalizePhone } from '../../lib/validation.ts';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = getRuntimeEnv(locals);

  const body = await request.json().catch(() => null) as {
    customer_name?: string;
    customer_phone?: string;
    product_id?: number | string;
    variant_id?: number | string;
    product_title?: string;
    address?: string;
    province?: string;
    total_amount?: number;
    website?: unknown;
    honeypot?: unknown;
  } | null;

  if (!body) {
    return jsonError('Payload tidak valid.', 400);
  }

  if (String(body.website || body.honeypot || '').trim()) {

    // Answered exactly like a generic invalid payload. Naming the control

    // that caught it tells a bot which field to leave empty next time, which

    // is the one thing a honeypot must never do. The hit stays countable

    // server-side, where the attacker cannot read it.

    console.warn('checkout-honeypot-triggered', { path: 'record-abandoned-order' });
    return jsonError('Payload tidak valid.', 400, {
      code: 'VALIDATION_ERROR',
    });
  }

  const clientIp = getClientIp(request.headers);
  const rateLimit = await checkRateLimit(
    runtime?.OMS_DB as D1Database | undefined,
    `record-abandoned-order:${clientIp}`,
    10,
    60_000,
  );
  if (!rateLimit.allowed) {
    return json(
      {
        success: false,
        error: 'Terlalu banyak percobaan. Coba lagi sebentar.',
        code: 'RATE_LIMITED',
      },
      429,
      rateLimitHeaders(rateLimit.remaining, rateLimit.resetAt),
    );
  }

  const database = runtime?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database order belum tersedia.', 503);
  }

  const customerName = String(body.customer_name || '').trim();
  const customerPhone = normalizePhone(String(body.customer_phone || ''));

  if (customerName.length < 3) {
    return jsonError('Nama pelanggan minimal 3 karakter.', 400);
  }
  if (!isValidWa62(customerPhone)) {
    return jsonError('Nomor WhatsApp tidak valid.', 400);
  }

  const numericTotalAmount = Number(body.total_amount);
  const variantId = Number(body.variant_id);
  try {
    const recorded = await recordAbandonedOrder(database as D1Database, {
      customerName,
      customerPhone,
      address: String(body.address || ''),
      province: String(body.province || ''),
      totalAmount: Number.isFinite(numericTotalAmount)
        ? numericTotalAmount
        : undefined,
      variantId:
        Number.isInteger(variantId) && variantId > 0 ? variantId : undefined,
      // The form's same-origin fetch carries the page in Referer (PRD A36),
      // so the three form scripts stay as they are.
      sourcePagePath: sourcePathFromReferer(
        request.headers.get('referer'),
        new URL(request.url),
      ),
    });
    // Deliberately no notification. An abandoned capture is a lead to work
    // through in `/admin/orders/abandoned`, not an event worth interrupting an
    // operator for — and it is the one type that arrives in volume, so ringing
    // for it buried the notifications that do matter: a new order, and a
    // payment landing.
    return jsonOk({
      success: true,
      action: recorded.action,
      order_number: recorded.orderNumber,
    });
  } catch (error) {
    console.error('record-abandoned-order error:', error);
    if (
      error instanceof Error &&
      error.message === 'Store belum dikonfigurasi.'
    ) {
      return jsonError(error.message, 503);
    }
    return jsonError('Gagal mencatat pesanan tertinggal.', 500);
  }
};
