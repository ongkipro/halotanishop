import type { APIRoute } from 'astro';
import { effectivePaymentStatus } from '../../../../lib/autolaris-payment.ts';
import { jsonError, jsonOk } from '../../../../lib/api';
import { getRuntimeEnv } from '../../../../lib/env';
import { selectQuotedRate } from '../../../../lib/courier-rules';
import { normalizePhoneNumber } from '../../../../lib/order-schema';
import { isValidWa62 } from '../../../../lib/validation';
import { getMengantarDispatchEligibility } from '../../../../lib/payment-dispatch-policy';
import { calculateCodCustomerTotal, calculateCodFeeBreakdown } from '../../../../lib/payment-fee-policy';
import { dispatchOrderToMengantar } from '../../../../lib/mengantar-dispatch';
import { buildPaymentNotification, recordNotification } from '../../../../lib/notifications';
import { enqueuePurchaseForPaidOrder, manualTransferBecamePaid } from '../../../../lib/paid-order-purchase.ts';
import {
  getReceiverPerformance,
  isRecentReceiverRefusal,
  readStoredReceiverPerformance,
  recordReceiverScoreUnavailable,
  scheduleReceiverPerformanceRefresh,
} from '../../../../lib/rts-scoring';
import { MengantarNotWhitelistedError } from '../../../../lib/mengantar-client';
import type { ReceiverPerformance } from '../../../../lib/receiver-performance';
import {
  applyOrderLifecycleMutation,
  deleteOrdersReleasingReservations,
  OrderLifecycleError,
} from '../../../../lib/order-lifecycle';
import {
  resolveEligibleShippingRates,
  ShippingQuoteError,
} from '../../../../lib/shipping-quote';
import { pluginContext } from '../../../../plugins/registry';
import { getKelolaConfig, kelolaOrderState, resendOrderToKelola } from '../../../../plugins/kelola/sync';

/** The Kelola config when the plugin is active, else `undefined` (plugin off). */
async function activeKelolaConfig(db: D1Database, locals: App.Locals) {
  const context = await pluginContext(db, getRuntimeEnv(locals), 'kelola');
  return context ? getKelolaConfig(context.settings, context.env) : undefined;
}

export const prerender = false;

const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'settled', 'success', 'failed', 'refunded', 'cancelled'] as const;
const SHIPPING_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'] as const;
const PAID_STATUSES = new Set(['paid', 'settled', 'success']);

type OrderUpdatePayload = {
  action?: 'dispatch-order' | 'refresh-scoring' | 'push-kelola';
  payment_status?: string;
  shipping_status?: string;
  cnote_no?: string;
  courier_code?: string;
  courier_service?: string;
  courier_service_id?: number;
  customer_name?: string;
  customer_phone?: string;
  address?: string;
  district?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  destination_area_id?: string;
};

type OrderRow = {
  id: number;
  order_number: string;
  warehouse_id: number | null;
  pickup_schedule_id: number | null;
  customer_name: string;
  customer_phone: string;
  address: string;
  province: string;
  city: string;
  district: string;
  postal_code: string | null;
  destination_area_id: string | null;
  total_amount: number;
  shipping_cost: number;
  discount_amount: number | null;
  cod_service_fee: number;
  cod_service_fee_vat: number;
  cod_fee_bearer: string;
  payment_method: string;
  payment_status: string;
  shipping_status: string;
  confirmed_at: string | null;
  courier_code: string | null;
  courier_service: string | null;
  cnote_no: string | null;
  provider_order_id: string | null;
  provider_dispatch_error: string | null;
  provider_dispatch_claimed_at: string | null;
  receiver_delivery_rate: number | null;
  receiver_risk_label: string | null;
  receiver_performance_json: string | null;
  receiver_performance_checked_at: string | null;
  stock_restored_at: string | null;
  ad_click_ids: string | null;
  source_page_path: string | null;
  created_at: string;
  warehouse_name: string | null;
  pickup_address_id: string | null;
  pickup_scheduled_at: string | null;
  pickup_status: string | null;
};

type OrderItemRow = {
  id: number;
  variant_id: number;
  quantity: number;
  unit_price: number;
  variant_title: string;
  variant_sku: string;
  variant_compare_price: number | null;
  product_id: number;
  product_title: string;
};

type PaymentTransactionRow = {
  provider_transaction_id: string | null;
  reference_id: string;
  channel_code: string;
  status: string;
  amount: number;
  admin_fee: number;
  total_amount: number;
  expires_at: string | null;
  paid_at: string | null;
  failed_reason: string | null;
};

async function loadOrder(database: D1Database, rawOrderKey: string) {
  let orderKey = rawOrderKey.trim();
  try {
    orderKey = decodeURIComponent(orderKey).trim();
  } catch {}
  const isNumericOnly = /^\d+$/.test(orderKey);
  const numericId = isNumericOnly ? parseInt(orderKey, 10) : null;
  const uppercaseKey = orderKey.toUpperCase();
  const computedIdFromInvoice = uppercaseKey.startsWith("INV-") || uppercaseKey.startsWith("ABN-")
    ? parseInt(orderKey.slice(4), 10) - 10000
    : null;
  const targetId =
    numericId ??
    (computedIdFromInvoice && computedIdFromInvoice > 0
      ? computedIdFromInvoice
      : null);
  return (await database
    .prepare(
      `
    SELECT
      o.id,
      o.order_number,
      o.warehouse_id,
      o.pickup_schedule_id,
      o.customer_name,
      o.customer_phone,
      o.address,
      o.province,
      o.city,
      o.district,
      o.postal_code,
      o.destination_area_id,
      o.total_amount,
      o.shipping_cost,
      o.discount_amount,
      o.cod_service_fee,
      o.cod_service_fee_vat,
      o.cod_fee_bearer,
      o.payment_method,
      o.payment_status,
      o.shipping_status,
      o.confirmed_at,
      o.courier_code,
      o.courier_service,
      o.cnote_no,
      o.provider_order_id,
      o.provider_dispatch_error,
      o.provider_dispatch_claimed_at,
      o.receiver_rts_score AS receiver_delivery_rate,
      o.rts_risk_label AS receiver_risk_label,
      o.receiver_performance_json,
      o.receiver_performance_checked_at,
      o.ad_click_ids,
      o.source_page_path,
      o.stock_restored_at,
      o.created_at,
      w.name AS warehouse_name,
      w.pickup_address_id,
      ps.scheduled_at AS pickup_scheduled_at,
      ps.status AS pickup_status
    FROM orders o
    LEFT JOIN warehouses w ON w.id = o.warehouse_id
    LEFT JOIN pickup_schedules ps ON ps.id = o.pickup_schedule_id
    WHERE o.shipping_status <> 'abandoned'
      AND (
        o.order_number = ?
        OR LOWER(o.order_number) = LOWER(?)
        OR o.public_status_token = ?
        OR CAST(o.id AS TEXT) = ?
        OR (? IS NOT NULL AND o.id = ?)
      )
    ORDER BY o.id DESC
    LIMIT 1
  `,
    )
    .bind(orderKey, orderKey, orderKey, orderKey, targetId, targetId ?? -1)
    .first()) as OrderRow | null;
}

export const GET: APIRoute = async ({ params, locals }) => {
  const orderKey = String(params.id || '').trim();
  if (!orderKey) return jsonError('ID order wajib diisi.', 400);

  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database order belum tersedia.', 503);
  }

  try {
    const db = database as D1Database;
    const order = await loadOrder(db, orderKey);
    if (!order) return jsonError('Order tidak ditemukan.', 404);

    const itemsResult = await db.prepare(`
      SELECT
        oi.id,
        oi.variant_id,
        oi.quantity,
        oi.unit_price,
        pv.title AS variant_title,
        pv.sku AS variant_sku,
        pv.compare_price AS variant_compare_price,
        p.id AS product_id,
        p.title AS product_title
      FROM order_items oi
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.id ASC
    `).bind(order.id).all();

    const payment = await db.prepare(`
      SELECT provider_transaction_id, reference_id, channel_code, status,
        amount, admin_fee, total_amount, expires_at, paid_at, failed_reason
      FROM payment_transactions
      WHERE order_id = ?
      LIMIT 1
    `).bind(order.id).first<PaymentTransactionRow>();

    const dispatch = getMengantarDispatchEligibility({
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      shippingStatus: order.shipping_status,
      providerOrderId: order.provider_order_id,
      providerDispatchError: order.provider_dispatch_error,
      providerDispatchClaimedAt: order.provider_dispatch_claimed_at,
      destinationAreaId: order.destination_area_id,
      courierCode: order.courier_code,
      pickupAddressId:
        order.pickup_address_id ||
        String(getRuntimeEnv(locals)?.MENGANTAR_PICKUP_ADDRESS_ID || '').trim(),
    });

    if (
      !order.receiver_performance_checked_at &&
      order.customer_phone &&
      !isRecentReceiverRefusal(
        readStoredReceiverPerformance(order.receiver_performance_json).receiver_performance_refused_at,
      )
    ) {
      scheduleReceiverPerformanceRefresh(db, order.order_number, order.customer_phone, locals);
    }

    return jsonOk({
      data: {
        id: order.id,
        order_number: order.order_number,
        warehouse_id: order.warehouse_id,
        warehouse_name: order.warehouse_name,
        pickup_schedule_id: order.pickup_schedule_id,
        pickup_scheduled_at: order.pickup_scheduled_at,
        pickup_status: order.pickup_status,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        address: order.address,
        province: order.province,
        city: order.city,
        district: order.district,
        postal_code: order.postal_code,
        destination_area_id: order.destination_area_id,
        total_amount: order.total_amount,
        shipping_cost: order.shipping_cost,
        discount_amount: order.discount_amount ?? 0,
        cod_service_fee: order.cod_service_fee,
        cod_service_fee_vat: order.cod_service_fee_vat,
        cod_fee_bearer: order.cod_fee_bearer === 'seller' ? 'seller' : 'buyer',
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        shipping_status: order.shipping_status,
        confirmed_at: order.confirmed_at,
        courier_code: order.courier_code,
        courier_service: order.courier_service,
        cnote_no: order.cnote_no,
        provider_order_id: order.provider_order_id,
        provider_dispatch_error: order.provider_dispatch_error,
        dispatchEligible: dispatch.eligible,
        dispatchReason: dispatch.reason,
        receiver_delivery_rate: order.receiver_delivery_rate,
        receiver_risk_label: order.receiver_risk_label,
        ...readStoredReceiverPerformance(order.receiver_performance_json),
        receiver_performance_checked_at: order.receiver_performance_checked_at,
        ad_click_ids: order.ad_click_ids,
        source_page_path: order.source_page_path,
        created_at: order.created_at,
        // Absent unless the Kelola plugin is active; OrderDetail then shows no panel.
        kelola: await activeKelolaConfig(db, locals).then((config) =>
          config === undefined ? null : kelolaOrderState(db, config, order.id)),
        payment: payment ? {
          reference_id: payment.reference_id,
          channel_code: payment.channel_code,
          status: effectivePaymentStatus(payment.status, payment.expires_at),
          amount: payment.amount,
          admin_fee: payment.admin_fee,
          total_amount: payment.total_amount,
          expires_at: payment.expires_at,
          paid_at: payment.paid_at,
          failed_reason: payment.failed_reason,
        } : null,
        items: ((itemsResult.results ?? []) as OrderItemRow[]).map((item) => ({
          id: item.id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          variant_title: item.variant_title,
          variant_sku: item.variant_sku,
          variant_compare_price: item.variant_compare_price,
          product_id: item.product_id,
          product_title: item.product_title,
        })),
      },
    });
  } catch (error) {
    console.error('admin-order-detail-get', error);
    return jsonError('Gagal mengambil data order.', 500);
  }
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const orderKey = String(params.id || '').trim();
  if (!orderKey) return jsonError('ID order wajib diisi.', 400);

  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database order belum tersedia.', 503);
  }

  const body = (await request.json().catch(() => null)) as OrderUpdatePayload | null;
  if (!body) return jsonError('Payload tidak valid.', 400);

  try {
    const db = database as D1Database;
    const current = await loadOrder(db, orderKey);
    if (!current) return jsonError('Order tidak ditemukan.', 404);

    const action = body.action;
    if (action === 'push-kelola') {
      const config = await activeKelolaConfig(db, locals);
      if (config === undefined) return jsonError('Plugin Kelola CRM belum aktif.', 409);
      const result = await resendOrderToKelola(db, config, current.id);
      return result.ok
        ? jsonOk({ message: `Order ${current.order_number} sudah ada di Kelola.`, data: { kelola: result.state } })
        : jsonError(result.error ?? 'Gagal mengirim order ke Kelola.', 502, { data: { kelola: result.state } });
    }
    if (action === 'refresh-scoring') {
      const phone = (typeof body.customer_phone === 'string' ? normalizePhoneNumber(body.customer_phone).slice(0, 40) : undefined) ?? current.customer_phone;
      let performance: ReceiverPerformance;
      try {
        performance = await getReceiverPerformance(db, phone, locals);
      } catch (error) {
        if (!(error instanceof MengantarNotWhitelistedError)) throw error;
        await recordReceiverScoreUnavailable(db, String(current.id));
        return jsonError(error.message, 502);
      }
      await db
        .prepare(
          `UPDATE orders
           SET receiver_rts_score = ?,
               rts_risk_label = ?,
               receiver_performance_json = ?,
               receiver_performance_checked_at = ?
           WHERE id = ?`,
        )
        .bind(
          performance.deliveryRate == null ? null : Math.round(performance.deliveryRate),
          performance.riskLevel,
          JSON.stringify(performance),
          performance.checkedAt,
          current.id,
        )
        .run();
      const updated = await loadOrder(db, String(current.id));
      if (!updated) return jsonError('Order tidak ditemukan.', 404);
      const updatedDispatch = getMengantarDispatchEligibility({
        paymentMethod: updated.payment_method,
        paymentStatus: updated.payment_status,
        shippingStatus: updated.shipping_status,
        providerOrderId: updated.provider_order_id,
        providerDispatchError: updated.provider_dispatch_error,
        providerDispatchClaimedAt: updated.provider_dispatch_claimed_at,
        destinationAreaId: updated.destination_area_id,
        courierCode: updated.courier_code,
        pickupAddressId:
          updated.pickup_address_id ||
          String(getRuntimeEnv(locals)?.MENGANTAR_PICKUP_ADDRESS_ID || '').trim(),
      });
      return jsonOk({
        message: `Risiko RTS penerima ${phone} berhasil diperbarui dari Mengantar (${performance.riskLevel}).`,
        data: {
          id: updated.id,
          order_number: updated.order_number,
          customer_name: updated.customer_name,
          customer_phone: updated.customer_phone,
          receiver_delivery_rate: updated.receiver_delivery_rate,
          receiver_risk_label: updated.receiver_risk_label,
          ...readStoredReceiverPerformance(updated.receiver_performance_json),
          receiver_performance_checked_at: updated.receiver_performance_checked_at,
          dispatchEligible: updatedDispatch.eligible,
          dispatchReason: updatedDispatch.reason,
        },
      });
    }

    const nextPaymentStatus = typeof body.payment_status === 'string' ? body.payment_status.trim().toLowerCase() : undefined;
    const nextShippingStatus = typeof body.shipping_status === 'string' ? body.shipping_status.trim().toLowerCase() : undefined;
    const nextCourierCode = typeof body.courier_code === 'string' ? body.courier_code.trim().slice(0, 50) : undefined;
    const nextCourierService = typeof body.courier_service === 'string' ? body.courier_service.trim().slice(0, 120) : undefined;
    const nextCnoteNo = typeof body.cnote_no === 'string' ? body.cnote_no.trim().slice(0, 120) : undefined;
    const nextCustomerName = typeof body.customer_name === 'string' ? body.customer_name.trim().slice(0, 100) : undefined;
    const nextCustomerPhone = typeof body.customer_phone === 'string' ? normalizePhoneNumber(body.customer_phone).slice(0, 40) : undefined;
    const nextAddress = typeof body.address === 'string' ? body.address.trim().slice(0, 500) : undefined;
    const nextDistrict = typeof body.district === 'string' ? body.district.trim().slice(0, 120) : undefined;
    const nextCity = typeof body.city === 'string' ? body.city.trim().slice(0, 120) : undefined;
    const nextProvince = typeof body.province === 'string' ? body.province.trim().slice(0, 120) : undefined;
    const nextPostalCode = typeof body.postal_code === 'string' ? body.postal_code.trim().slice(0, 10) : undefined;
    const nextDestinationAreaId = typeof body.destination_area_id === 'string' ? body.destination_area_id.trim().slice(0, 120) : undefined;
    const nextCourierServiceId = Number(body.courier_service_id);
    const hasCustomerChanges = [
      nextCustomerName,
      nextCustomerPhone,
      nextAddress,
      nextDistrict,
      nextCity,
      nextProvince,
      nextPostalCode,
      nextDestinationAreaId,
    ].some((value) => value !== undefined);
    const destinationChanged =
      nextDestinationAreaId !== undefined &&
      (nextDestinationAreaId || null) !== current.destination_area_id;
    const hasShippingSelection =
      destinationChanged ||
      nextCourierCode !== undefined ||
      (body.courier_service_id !== undefined &&
        !isNaN(Number(body.courier_service_id)) &&
        Number(body.courier_service_id) > 0);

    if (
      !action &&
      nextPaymentStatus === undefined &&
      nextShippingStatus === undefined &&
      nextCourierCode === undefined &&
      nextCourierService === undefined &&
      nextCnoteNo === undefined &&
      !hasCustomerChanges
    ) {
      return jsonError('Tidak ada perubahan yang dikirim.', 400);
    }
    if (nextPaymentStatus !== undefined && !PAYMENT_STATUSES.includes(nextPaymentStatus as (typeof PAYMENT_STATUSES)[number])) {
      return jsonError('Status pembayaran tidak valid.', 400);
    }
    if (nextShippingStatus !== undefined && !SHIPPING_STATUSES.includes(nextShippingStatus as (typeof SHIPPING_STATUSES)[number])) {
      return jsonError('Status pengiriman tidak valid.', 400);
    }
    if (current.provider_order_id && (hasCustomerChanges || hasShippingSelection)) {
      return jsonError('Data tujuan tidak dapat diubah setelah shipment Mengantar dibuat.', 409);
    }
    if (nextCnoteNo !== undefined && (nextCnoteNo || null) !== current.cnote_no) {
      return jsonError('Nomor resi hanya dapat diisi dari respons Mengantar.', 409);
    }
    if (nextCustomerName !== undefined && nextCustomerName.length < 2) {
      return jsonError('Nama minimal 2 karakter.', 422);
    }
    // Value is already normalized to 62-form above; the one canonical check
    // covers operator prefix and the real 0-form 8-13 / 62-form 9-14 length.
    if (nextCustomerPhone !== undefined && !isValidWa62(nextCustomerPhone)) {
      return jsonError('Nomor HP tidak valid (contoh: 081234567890).', 422);
    }
    if (nextAddress !== undefined && nextAddress.length < 10) {
      return jsonError('Alamat lengkap minimal 10 karakter.', 422);
    }
    for (const [label, value] of [
      ['Kecamatan', nextDistrict],
      ['Kota/kabupaten', nextCity],
      ['Provinsi', nextProvince],
    ] as const) {
      if (value !== undefined && value.length < 2) {
        return jsonError(`${label} harus diisi.`, 422);
      }
    }
    if (nextPostalCode !== undefined && nextPostalCode && !/^\d{5}$/.test(nextPostalCode)) {
      return jsonError('Kode pos harus 5 digit.', 422);
    }

    const assignments: string[] = [];
    const values: Array<string | number | null> = [];
    const addAssignment = (column: string, value: string | number | null) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (nextCustomerName !== undefined) addAssignment('customer_name', nextCustomerName);
    if (nextCustomerPhone !== undefined) addAssignment('customer_phone', nextCustomerPhone);
    const customerPhoneChanged =
      nextCustomerPhone !== undefined && nextCustomerPhone !== current.customer_phone;
    if (customerPhoneChanged) {
      addAssignment('receiver_rts_score', null);
      addAssignment('rts_risk_label', null);
      addAssignment('receiver_performance_json', null);
      addAssignment('receiver_performance_checked_at', null);
    }
    if (nextAddress !== undefined) addAssignment('address', nextAddress);
    if (nextDistrict !== undefined) addAssignment('district', nextDistrict);
    if (nextCity !== undefined) addAssignment('city', nextCity);
    if (nextProvince !== undefined) addAssignment('province', nextProvince);
    if (nextPostalCode !== undefined) addAssignment('postal_code', nextPostalCode || null);
    if (nextDestinationAreaId !== undefined) addAssignment('destination_area_id', nextDestinationAreaId || null);
    let resolvedCourierCode = nextCourierCode !== undefined ? nextCourierCode || null : current.courier_code;
    let resolvedCourierService = nextCourierService !== undefined ? nextCourierService || null : current.courier_service;
    let resolvedDestinationAreaId = nextDestinationAreaId !== undefined ? nextDestinationAreaId || null : current.destination_area_id;
    let resolvedWarehouseId = current.warehouse_id;
    let resolvedShippingCost = current.shipping_cost;
    let resolvedTotalAmount = current.total_amount;

    // A kecamatan/kota/provinsi text correction that does not also carry a
    // freshly resolved destination_area_id would otherwise leave the stored
    // id pointing at the OLD address — the shipment would route there while
    // every label shows the corrected text. Invalidate it so dispatch is
    // forced back through resolveEligibleShippingRates, the same way editing
    // the district field on checkout clears the picked location instead of
    // keeping a stale id under changed text.
    const addressTextChanged =
      (nextDistrict !== undefined && nextDistrict !== current.district) ||
      (nextCity !== undefined && nextCity !== current.city) ||
      (nextProvince !== undefined && nextProvince !== current.province);
    if (addressTextChanged && !hasShippingSelection && nextDestinationAreaId === undefined) {
      resolvedDestinationAreaId = null;
      addAssignment('destination_area_id', null);
    }

    if (hasShippingSelection) {
      if (current.payment_method !== 'cod') {
        return jsonError('Kurir order pembayaran online tidak dapat diubah setelah invoice dibuat.', 409);
      }
      if (current.shipping_status !== 'pending') {
        return jsonError('Kurir hanya dapat diubah sebelum shipment Mengantar dibuat.', 409);
      }
      if (
        !resolvedDestinationAreaId ||
        !resolvedCourierCode ||
        !Number.isInteger(nextCourierServiceId) ||
        nextCourierServiceId < 1
      ) {
        return jsonError('Kecamatan, kurir, dan layanan pengiriman wajib dipilih.', 422);
      }
      const item = await db.prepare(`
        SELECT variant_id, quantity
        FROM order_items
        WHERE order_id = ?
        ORDER BY id
        LIMIT 1
      `).bind(current.id).first<{ variant_id: number; quantity: number }>();
      if (!item) return jsonError('Item order tidak ditemukan.', 409);
      const quote = await resolveEligibleShippingRates(db, locals, {
        destinationId: resolvedDestinationAreaId,
        paymentMethod: current.payment_method,
        variantKey: String(item.variant_id),
        quantity: Number(item.quantity),
      });
      const selectedRate = selectQuotedRate(
        quote.rates,
        resolvedCourierCode,
        nextCourierServiceId,
      );
      if (!selectedRate) {
        return jsonError('Pilihan kurir sudah tidak tersedia. Muat ulang ongkir.', 409);
      }
      const totals = await db.prepare(`
        SELECT COALESCE(SUM(quantity * unit_price), 0) AS item_total
        FROM order_items
        WHERE order_id = ?
      `).bind(current.id).first<{ item_total: number }>();
      resolvedCourierCode = selectedRate.courier_code;
      resolvedCourierService = selectedRate.courier_service;
      resolvedWarehouseId = quote.warehouse?.id || null;
      // `calculateCodFeeBreakdown` below is the COD fee; adding the provider's
      // `cod_fee` to shipping as well charged it twice (see shipping-quote.ts).
      resolvedShippingCost = Number(selectedRate.price);
      const orderAmount = Math.max(
        0,
        Number(totals?.item_total || 0) -
          Number(current.discount_amount || 0) +
          resolvedShippingCost,
      );
      const codFee = calculateCodFeeBreakdown(orderAmount);
      resolvedTotalAmount = calculateCodCustomerTotal(
        orderAmount,
        current.cod_fee_bearer === 'seller' ? 'seller' : 'buyer',
      );
      addAssignment('destination_area_id', resolvedDestinationAreaId);
      addAssignment('courier_code', resolvedCourierCode);
      addAssignment('courier_service', resolvedCourierService);
      addAssignment('warehouse_id', resolvedWarehouseId);
      addAssignment('shipping_cost', resolvedShippingCost);
      addAssignment('cod_service_fee', codFee.serviceFee);
      addAssignment('cod_service_fee_vat', codFee.vat);
      addAssignment('total_amount', resolvedTotalAmount);
    } else {
      if (nextCourierCode !== undefined) addAssignment('courier_code', resolvedCourierCode);
      if (nextCourierService !== undefined) addAssignment('courier_service', resolvedCourierService);
      if (nextDestinationAreaId !== undefined) addAssignment('destination_area_id', resolvedDestinationAreaId);
    }

    const resolvedPaymentStatus = nextPaymentStatus ?? current.payment_status;
    const resolvedShippingStatus = nextShippingStatus ?? current.shipping_status;

    if (action === 'dispatch-order') {
      const resolvedCustomerName = nextCustomerName ?? current.customer_name;
      const resolvedCustomerPhone = nextCustomerPhone ?? current.customer_phone;
      const resolvedAddress = nextAddress ?? current.address;
      const resolvedDistrict = nextDistrict ?? current.district;
      const resolvedCity = nextCity ?? current.city;
      const resolvedProvince = nextProvince ?? current.province;
      if (current.provider_order_id) {
        return jsonError('Shipment Mengantar untuk order ini sudah dibuat.', 409);
      }
      if (current.shipping_status !== 'pending') {
        return jsonError('Hanya order menunggu yang dapat disiapkan untuk dispatch.', 409);
      }
      if (current.payment_method !== 'cod' && !PAID_STATUSES.has(resolvedPaymentStatus)) {
        return jsonError('Pembayaran online belum lunas.', 409);
      }
      if (
        resolvedCustomerName.length < 2 ||
        !isValidWa62(resolvedCustomerPhone) ||
        resolvedAddress.length < 10 ||
        resolvedDistrict.length < 2 ||
        resolvedCity.length < 2 ||
        resolvedProvince.length < 2 ||
        !resolvedDestinationAreaId ||
        !resolvedCourierCode ||
        !resolvedCourierService ||
        !resolvedWarehouseId
      ) {
        return jsonError('Lengkapi data pembeli, alamat, kecamatan, dan ekspedisi sebelum push.', 422);
      }
      // The order stays pending until Mengantar accepts the shipment.
    } else {
      if (nextPaymentStatus !== undefined) addAssignment('payment_status', resolvedPaymentStatus);
      if (nextShippingStatus !== undefined) addAssignment('shipping_status', resolvedShippingStatus);
    }


    if (assignments.length === 0 && action !== 'dispatch-order') {
      return jsonError('Tidak ada perubahan yang dikirim.', 400);
    }

    let metaPurchase: Awaited<ReturnType<typeof enqueuePurchaseForPaidOrder>> | null = null;
    if (assignments.length > 0) {
      const destinationEditGuard =
        hasCustomerChanges || hasShippingSelection
          ? `
        AND provider_order_id IS NULL
        AND provider_dispatch_claimed_at IS NULL
        AND shipping_status = 'pending'`
          : '';
      const mutation = db.prepare(`
        UPDATE orders
        SET ${assignments.join(', ')}
        WHERE id = ?
        ${destinationEditGuard}
      `).bind(...values, current.id);
      const hasLifecycleChange =
        action !== 'dispatch-order' &&
        (nextPaymentStatus !== undefined || nextShippingStatus !== undefined);
      const updated = hasLifecycleChange
        ? (
            await applyOrderLifecycleMutation(
              db,
              current,
              {
                paymentStatus: nextPaymentStatus,
                shippingStatus: nextShippingStatus,
              },
              mutation,
            )
          ).updated
        : Boolean((await mutation.run()).meta?.changes);
      if (!updated) {
        return destinationEditGuard
          ? jsonError(
              'Data tujuan tidak dapat diubah karena order sedang atau sudah diproses ke Mengantar.',
              409,
            )
          : jsonError('Order tidak ditemukan.', 404);
      }
      if (customerPhoneChanged && nextCustomerPhone) {
        scheduleReceiverPerformanceRefresh(
          db,
          current.order_number,
          nextCustomerPhone,
          locals,
        );
      }
      // An operator marking payment received is the other path that can reach
      // paid. The unique constraint keeps this and the AutoLaris reconciliation
      // path from both notifying for the same order (REQ-148).
      if (
        PAID_STATUSES.has(resolvedPaymentStatus) &&
        !PAID_STATUSES.has(current.payment_status)
      ) {
        await recordNotification(db, {
          type: 'payment',
          orderId: current.id,
          orderNumber: current.order_number,
          ...buildPaymentNotification({
            orderNumber: current.order_number,
            customerName: nextCustomerName ?? current.customer_name,
            totalAmount: resolvedTotalAmount,
          }),
        });
      }
      // A manual transfer is confirmed here and nowhere else, so this is its
      // Purchase. Best effort, like the AutoLaris path: the payment is already
      // durable, and the outbox keys on the order number, so a repeat is a no-op.
      if (manualTransferBecamePaid(current.payment_method, current.payment_status, resolvedPaymentStatus)) {
        try {
          metaPurchase = await enqueuePurchaseForPaidOrder(db, locals, current.id);
        } catch (error) {
          console.error('paid-order-purchase-failed', error);
        }
      }
    }

    let dispatchOutcome: Awaited<ReturnType<typeof dispatchOrderToMengantar>> | undefined;
    if (action === 'dispatch-order') {
      dispatchOutcome = await dispatchOrderToMengantar(db, locals, current.id);
      if (!['dispatched', 'unpaid', 'already_dispatched'].includes(dispatchOutcome.status)) {
        return jsonError(
          dispatchOutcome.error || 'Mengantar belum menerima shipment.',
          dispatchOutcome.status === 'failed' ? 502 : 409,
          { data: dispatchOutcome },
        );
      }
    }

    const updated = await loadOrder(db, String(current.id));
    if (!updated) throw new Error('Updated order could not be reloaded');
    return jsonOk({
      message: action === 'dispatch-order'
        ? dispatchOutcome?.status === 'unpaid'
          ? `Draft shipment ${updated.order_number} diterima Mengantar dan menunggu top up wallet`
          : `Shipment ${updated.order_number} berhasil dibuat di Mengantar`
        : `Order ${updated.order_number} berhasil diperbarui${
            metaPurchase?.status === 'queued'
              ? ' · Purchase dikirim ke Meta'
              : metaPurchase?.status === 'deduplicated'
                ? ' · Purchase sudah tercatat sebelumnya'
                : ''
          }`,
      data: {
        id: updated.id,
        order_number: updated.order_number,
        customer_name: updated.customer_name,
        customer_phone: updated.customer_phone,
        address: updated.address,
        district: updated.district,
        city: updated.city,
        province: updated.province,
        postal_code: updated.postal_code,
        destination_area_id: updated.destination_area_id,
        warehouse_id: updated.warehouse_id,
        warehouse_name: updated.warehouse_name,
        total_amount: updated.total_amount,
        shipping_cost: updated.shipping_cost,
        discount_amount: updated.discount_amount,
        cod_service_fee: updated.cod_service_fee,
        cod_service_fee_vat: updated.cod_service_fee_vat,
        cod_fee_bearer: updated.cod_fee_bearer,
        payment_status: updated.payment_status,
        shipping_status: updated.shipping_status,
        confirmed_at: updated.confirmed_at,
        courier_code: updated.courier_code,
        courier_service: updated.courier_service,
        cnote_no: updated.cnote_no,
        provider_order_id: updated.provider_order_id,
        provider_dispatch_error: updated.provider_dispatch_error,
        receiver_delivery_rate: updated.receiver_delivery_rate,
        receiver_risk_label: updated.receiver_risk_label,
        ...readStoredReceiverPerformance(updated.receiver_performance_json),
        receiver_performance_checked_at: updated.receiver_performance_checked_at,
        meta_purchase: metaPurchase,
      },
    });
  } catch (error) {
    if (error instanceof OrderLifecycleError) {
      return jsonError(error.message, error.status);
    }
    if (error instanceof ShippingQuoteError) {
      return jsonError(error.message, error.status);
    }
    console.error('admin-order-detail-patch', error);
    return jsonError('Gagal memperbarui order.', 500);
  }
};
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.admin) return jsonError('Unauthorized', 401);
  const orderKey = params.id?.trim();
  if (!orderKey) return jsonError('Order ID missing', 400);

  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== 'object') {
    return jsonError('Database order belum tersedia.', 503);
  }

  try {
    const db = database as D1Database;
    const order = await loadOrder(db, orderKey);
    if (!order) return jsonError('Order tidak ditemukan', 404);

    const deleted = await deleteOrdersReleasingReservations(db, [order.id]);
    if (deleted.length === 0) {
      return jsonError('Order tidak ditemukan', 404);
    }

    return jsonOk({ success: true, message: `Pesanan ${order.order_number} berhasil dihapus`, deleted_id: order.id });
  } catch (error) {
    if (error instanceof OrderLifecycleError) {
      return jsonError(error.message, error.status);
    }
    console.error('DELETE admin/orders/[id] error:', error);
    return jsonError('Gagal menghapus pesanan.', 500);
  }
};
