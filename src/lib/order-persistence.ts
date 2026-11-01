import {
  calculateCodCustomerTotal,
  calculateCodFeeBreakdown,
  normalizePaymentFeeBearer,
  type PaymentFeeBearer,
} from "./payment-fee-policy.ts";
import { paymentBrandLabel } from "./payment-brand.ts";
import { buildOrderNotification, recordNotification } from "./notifications.ts";
import { isValidWa62, normalizePhone } from "./validation.ts";

export type PersistOrderInput = {
  submitToken: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  address: string;
  province: string;
  city: string;
  district: string;
  postalCode?: string;
  variantKey: string;
  quantity: number;
  shippingCost: number;
  paymentMethod: "cod" | "bank_transfer" | "qris" | "manual_transfer";
  sellerBankAccountId?: number;
  warehouseId?: number;
  destinationAreaId?: string;
  courierCode?: string;
  courierService?: string;
  adClickIds?: string;
  metaRequestContext?: string;
  sourcePagePath?: string;
};

export type PersistedOrder = {
  id: number;
  orderNumber: string;
  publicStatusToken: string;
  totalAmount: number;
  unitPrice: number;
  codServiceFee: number;
  codServiceFeeVat: number;
  codFeeBearer: PaymentFeeBearer;
  sellerBankAccountId?: number;
  sellerBankCode?: string;
  sellerBankName?: string;
  sellerAccountHolder?: string;
  sellerAccountNumber?: string;
  created: boolean;
};

export class DuplicateSubmissionError extends Error {}
export class OrderInputError extends Error {}

export const CHECKOUT_DEDUPE_WINDOW_MS = 2 * 60 * 60 * 1000;

type CanonicalOrderRow = {
  id: number;
  order_number: string;
  public_status_token: string;
  total_amount: number;
  unit_price: number;
  cod_service_fee: number;
  cod_service_fee_vat: number;
  cod_fee_bearer: string;
  seller_bank_account_id: number | null;
  seller_bank_code: string | null;
  seller_bank_name: string | null;
  seller_account_holder: string | null;
  seller_account_number: string | null;
};

function normalizeFingerprintText(value: string | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function createCheckoutFingerprint(input: {
  storeId: number;
  variantId: number;
  order: PersistOrderInput;
  totalAmount: number;
}) {
  const order = input.order;
  const payload = JSON.stringify([
    input.storeId,
    input.variantId,
    order.quantity,
    normalizeFingerprintText(order.customerName),
    normalizePhone(order.customerPhone),
    normalizeFingerprintText(order.address),
    normalizeFingerprintText(order.province),
    normalizeFingerprintText(order.city),
    normalizeFingerprintText(order.district),
    normalizeFingerprintText(order.postalCode),
    order.paymentMethod,
    order.sellerBankAccountId || 0,
    order.warehouseId || 0,
    normalizeFingerprintText(order.destinationAreaId),
    normalizeFingerprintText(order.courierCode),
    normalizeFingerprintText(order.courierService),
    order.shippingCost,
    input.totalAmount,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function persistedOrderFromRow(
  row: CanonicalOrderRow,
  created: boolean,
): PersistedOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    publicStatusToken: row.public_status_token,
    totalAmount: Number(row.total_amount),
    unitPrice: Number(row.unit_price),
    codServiceFee: Number(row.cod_service_fee),
    codServiceFeeVat: Number(row.cod_service_fee_vat),
    codFeeBearer: normalizePaymentFeeBearer(row.cod_fee_bearer),
    sellerBankAccountId: row.seller_bank_account_id || undefined,
    sellerBankCode: row.seller_bank_code || undefined,
    sellerBankName: row.seller_bank_name || undefined,
    sellerAccountHolder: row.seller_account_holder || undefined,
    sellerAccountNumber: row.seller_account_number || undefined,
    created,
  };
}

async function findCanonicalOrder(
  database: D1Database,
  fingerprint: string,
  submitToken: string,
  now: string,
) {
  return database
    .prepare(
      `SELECT o.id, o.order_number, o.public_status_token, o.total_amount,
              oi.unit_price, o.cod_service_fee, o.cod_service_fee_vat,
              o.cod_fee_bearer, o.seller_bank_account_id, o.seller_bank_code,
              o.seller_bank_name, o.seller_account_holder, o.seller_account_number
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.id
       WHERE (
           (o.checkout_fingerprint = ? AND o.checkout_dedupe_expires_at > ?)
           OR o.submit_token = ?
         )
         AND o.shipping_status IN ('pending', 'processing', 'shipped')
         AND o.payment_status NOT IN ('failed', 'refunded', 'cancelled')
       ORDER BY o.id DESC, oi.id ASC
       LIMIT 1`,
    )
    .bind(fingerprint, now, submitToken)
    .first<CanonicalOrderRow>();
}

export type OrderNumberPrefix = "INV" | "ABN";

/**
 * Advances the one store-wide order sequence in a single D1 statement.
 *
 * Completed and abandoned orders deliberately share a sequence. An abandoned
 * number can therefore be promoted by changing only its prefix without ever
 * colliding with a completed order allocated in the meantime.
 */
export async function allocateOrderNumber(
  database: D1Database,
  prefix: OrderNumberPrefix,
): Promise<string> {
  const row = await database
    .prepare(
      `UPDATE order_number_counters
       SET last_value = last_value + 1,
           updated_at = ?
       WHERE counter_name = 'orders'
       RETURNING last_value`,
    )
    .bind(new Date().toISOString())
    .first<{ last_value: number }>();
  const value = Number(row?.last_value);
  if (!Number.isInteger(value) || value <= 10000) {
    throw new Error("Nomor order gagal dialokasikan.");
  }
  return `${prefix}-${value}`;
}

function completedNumberFromAbandoned(orderNumber: string): string {
  if (!/^ABN-\d{5,}$/.test(orderNumber)) {
    throw new Error("Nomor pesanan tertinggal tidak valid.");
  }
  return `INV-${orderNumber.slice(4)}`;
}

export const ABANDONED_RETENTION_DAYS = 7;

export async function purgeExpiredAbandonedOrders(
  database: D1Database,
  now = new Date(),
): Promise<number> {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Waktu retensi tidak valid.");
  }
  const cutoff = now.toISOString();
  const eligibleOrderIds = `SELECT id
    FROM orders
    WHERE shipping_status = 'abandoned'
      AND payment_status = 'unpaid'
      AND unixepoch(created_at) < unixepoch(?, '-${ABANDONED_RETENTION_DAYS} days')`;
  const results = await database.batch([
    database
      .prepare(
        `DELETE FROM payment_transactions
         WHERE order_id IN (${eligibleOrderIds})`,
      )
      .bind(cutoff),
    database
      .prepare(
        `DELETE FROM order_items
         WHERE order_id IN (${eligibleOrderIds})`,
      )
      .bind(cutoff),
    database
      .prepare(
        `DELETE FROM orders
         WHERE id IN (${eligibleOrderIds})`,
      )
      .bind(cutoff),
  ]);
  return Number(results[2]?.meta?.changes ?? 0);
}

export type RecordAbandonedOrderInput = {
  customerName: string;
  customerPhone: string;
  address?: string;
  province?: string;
  totalAmount?: number;
  variantId?: number;
  /** The page the lead was captured on (PRD A36), already clipped. */
  sourcePagePath?: string | null;
};

export type RecordedAbandonedOrder = {
  id: number;
  orderNumber: string;
  customerPhone: string;
  action: "created" | "updated";
};

export async function recordAbandonedOrder(
  database: D1Database,
  input: RecordAbandonedOrderInput,
): Promise<RecordedAbandonedOrder> {
  const customerName = input.customerName.trim();
  const customerPhone = normalizePhone(input.customerPhone);
  if (customerName.length < 3) {
    throw new OrderInputError("Nama pelanggan minimal 3 karakter.");
  }
  if (!isValidWa62(customerPhone)) {
    throw new OrderInputError("Nomor WhatsApp tidak valid.");
  }
  const address = input.address?.trim() || "";
  const province = input.province?.trim() || "";
  const selectedVariant = input.variantId && input.variantId > 0
    ? await database
        .prepare(
          `SELECT pv.id, pv.price
           FROM product_variants pv
           INNER JOIN products p ON p.id = pv.product_id
           WHERE pv.id = ? AND p.is_active = 1
           LIMIT 1`,
        )
        .bind(input.variantId)
        .first<{ id: number; price: number }>()
    : null;
  const totalAmount = selectedVariant
    ? Math.max(0, Math.round(Number(selectedVariant.price) || 0))
    : 0;
  const createdAt = new Date().toISOString();
  const existing = await database
    .prepare(
      `SELECT id, order_number
       FROM orders
       WHERE customer_phone = ?
         AND shipping_status = 'abandoned'
         AND unixepoch(created_at) >= unixepoch('now', '-2 hours')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(customerPhone)
    .first<{ id: number; order_number: string }>();

  if (existing) {
    const statements = [database
      .prepare(
        `UPDATE orders
         SET customer_name = ?,
             address = COALESCE(NULLIF(?, ''), address),
             province = COALESCE(NULLIF(?, ''), province),
             total_amount = ?,
             payment_status = 'unpaid',
             shipping_status = 'abandoned',
             created_at = ?,
             source_page_path = COALESCE(source_page_path, ?)
         WHERE id = ? AND shipping_status = 'abandoned'`,
      )
      .bind(
        customerName,
        address,
        province,
        totalAmount,
        createdAt,
        input.sourcePagePath || null,
        existing.id,
      )
    ];
    if (selectedVariant) {
      statements.push(
        database
          .prepare("DELETE FROM order_items WHERE order_id = ?")
          .bind(existing.id),
        database
          .prepare(
            `INSERT INTO order_items (order_id, variant_id, quantity, unit_price)
             VALUES (?, ?, 1, ?)`,
          )
          .bind(existing.id, selectedVariant.id, totalAmount),
      );
    }
    await database.batch(statements);
    return {
      id: existing.id,
      orderNumber: existing.order_number,
      customerPhone,
      action: "updated",
    };
  }

  const store = await database
    .prepare("SELECT id FROM stores ORDER BY id LIMIT 1")
    .first<{ id: number }>();
  if (!store) throw new Error("Store belum dikonfigurasi.");

  const orderNumber = await allocateOrderNumber(database, "ABN");
  const statements = [
    database
      .prepare(
        `INSERT INTO orders (
          order_number, store_id, customer_name, customer_phone,
          address, province, city, district,
          payment_method, payment_status, shipping_status,
          total_amount, shipping_cost, discount_amount, cod_service_fee,
          cod_service_fee_vat, cod_fee_bearer, created_at, source_page_path
        )
        SELECT
          ?, ?, ?, ?,
          ?, ?, '', '',
          'cod', 'unpaid', 'abandoned',
          ?, 0, 0, 0,
          0, 'buyer', ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM orders
          WHERE customer_phone = ?
            AND shipping_status = 'abandoned'
            AND unixepoch(created_at) >= unixepoch('now', '-2 hours')
        )`,
      )
      .bind(
        orderNumber,
        store.id,
        customerName,
        customerPhone,
        address,
        province || "ID-JK",
        totalAmount,
        createdAt,
        input.sourcePagePath || null,
        customerPhone,
      ),
  ];
  if (selectedVariant) {
    statements.push(
      database
        .prepare(
          `INSERT INTO order_items (order_id, variant_id, quantity, unit_price)
           SELECT o.id, pv.id, 1, ?
           FROM orders o
           INNER JOIN product_variants pv ON pv.id = ?
           WHERE o.order_number = ?`,
        )
        .bind(totalAmount, selectedVariant.id, orderNumber),
    );
  }
  statements.push(
    database
      .prepare(
        `SELECT id, order_number
         FROM orders
         WHERE customer_phone = ?
           AND shipping_status = 'abandoned'
           AND unixepoch(created_at) >= unixepoch('now', '-2 hours')
         ORDER BY id DESC
         LIMIT 1`,
      )
      .bind(customerPhone),
  );
  const results = await database.batch(statements);
  const row = results.at(-1)?.results?.[0] as
    | { id?: number; order_number?: string }
    | undefined;
  if (!row?.id || !row.order_number) {
    throw new Error("Pesanan tertinggal gagal disimpan.");
  }
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerPhone,
    action: "created",
  };
}


/**
 * The variant an order key names: its numeric id, or its SKU for a caller
 * that only knows the SKU. An id always wins. A merchant can type any SKU, and
 * one store gave a product the SKUs "1" and "2" — the ids of another product's
 * variants — so `id = ? OR sku = ?` matched both and every order for the
 * first product was saved as the second, at the second's price. The SKU is
 * consulted only when no variant has that id at all, so an inactive product's
 * id cannot fall through to a different product's SKU either.
 */
export async function findOrderVariant(database: D1Database, variantKey: string) {
  return database
    .prepare(
      `
      SELECT pv.id, pv.price
      FROM product_variants pv
      INNER JOIN products p ON p.id = pv.product_id
      WHERE p.is_active = 1
        AND (
          CAST(pv.id AS TEXT) = ?
          OR (
            pv.sku = ?
            AND NOT EXISTS (SELECT 1 FROM product_variants byId WHERE CAST(byId.id AS TEXT) = ?)
          )
        )
      ORDER BY pv.id
      LIMIT 1
    `,
    )
    .bind(variantKey, variantKey, variantKey)
    .first<{ id: number; price: number }>();
}

export async function persistOrder(
  database: D1Database,
  input: PersistOrderInput,
): Promise<PersistedOrder> {
  const variant = await findOrderVariant(database, input.variantKey);
  if (!variant) throw new OrderInputError("Varian produk tidak ditemukan.");
  // No stock gate. This store sells on demand rather than from a counted
  // shelf, so an order is never refused for a stock figure and the figure is
  // never spent (ADR-023). Price, weight and identity still come from D1.

  const store = await database
    .prepare("SELECT id, cod_fee_bearer FROM stores ORDER BY id LIMIT 1")
    .first<{ id: number; cod_fee_bearer: string | null }>();
  if (!store) throw new Error("Store belum dikonfigurasi.");
  const sellerBankAccount =
    input.paymentMethod === "manual_transfer"
      ? await database
          .prepare(
            `SELECT id, bank_code, account_holder, account_number
             FROM seller_bank_accounts
             WHERE id = ? AND store_id = ? AND is_active = 1
             LIMIT 1`,
          )
          .bind(input.sellerBankAccountId || 0, store.id)
          .first<{
            id: number;
            bank_code: string;
            account_holder: string;
            account_number: string;
          }>()
      : null;
  if (input.paymentMethod === "manual_transfer" && !sellerBankAccount) {
    throw new OrderInputError("Rekening transfer tidak tersedia.");
  }

  const unitPrice = Number(variant.price);
  const orderAmount = unitPrice * input.quantity + input.shippingCost;
  const codFeeBearer = normalizePaymentFeeBearer(store.cod_fee_bearer);
  const codFee =
    input.paymentMethod === "cod"
      ? calculateCodFeeBreakdown(orderAmount)
      : calculateCodFeeBreakdown(0);
  const totalAmount =
    input.paymentMethod === "cod"
      ? calculateCodCustomerTotal(orderAmount, codFeeBearer)
      : orderAmount;
  const createdAt = new Date().toISOString();
  const paymentStatus =
    input.paymentMethod === "cod" ? "unpaid" : "pending";
  const checkoutFingerprint = await createCheckoutFingerprint({
    storeId: store.id,
    variantId: variant.id,
    order: input,
    totalAmount,
  });
  const dedupeExpiresAt = new Date(
    new Date(createdAt).getTime() + CHECKOUT_DEDUPE_WINDOW_MS,
  ).toISOString();
  const existingOrder = await findCanonicalOrder(
    database,
    checkoutFingerprint,
    input.submitToken,
    createdAt,
  );
  if (existingOrder) return persistedOrderFromRow(existingOrder, false);

  const abandonedOrder = await database
    .prepare(
      `SELECT id, order_number, public_status_token
       FROM orders
       WHERE customer_phone = ?
         AND shipping_status = 'abandoned'
         AND unixepoch(created_at) >= unixepoch('now', '-2 hours')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(input.customerPhone)
    .first<{
      id: number;
      order_number: string;
      public_status_token: string | null;
    }>();
  const orderNumber = abandonedOrder
    ? completedNumberFromAbandoned(abandonedOrder.order_number)
    : (await allocateOrderNumber(database, "INV"));
  const publicStatusToken =
    abandonedOrder?.public_status_token || crypto.randomUUID();

  try {
    const orderStatement = abandonedOrder
      ? database
          .prepare(
            `UPDATE orders
             SET order_number = ?,
                 submit_token = ?,
                 public_status_token = ?,
                 customer_name = ?,
                 customer_phone = ?,
                 customer_email = ?,
                 address = ?,
                 province = ?,
                 city = ?,
                 district = ?,
                 postal_code = ?,
                 warehouse_id = ?,
                 total_amount = ?,
                 shipping_cost = ?,
                 discount_amount = 0,
                 cod_service_fee = ?,
                 cod_service_fee_vat = ?,
                 cod_fee_bearer = ?,
                 payment_method = ?,
                 payment_status = ?,
                 shipping_status = 'pending',
                 destination_area_id = ?,
                 courier_code = ?,
                 courier_service = ?,
                 ad_click_ids = COALESCE(?, ad_click_ids),
                 meta_request_context = COALESCE(?, meta_request_context),
                 source_page_path = COALESCE(?, source_page_path),
                 seller_bank_account_id = ?,
                 seller_bank_code = ?,
                 seller_bank_name = ?,
                 seller_account_holder = ?,
                 seller_account_number = ?,
                 checkout_fingerprint = ?,
                 checkout_dedupe_expires_at = ?
             WHERE id = ?
               AND customer_phone = ?
               AND shipping_status = 'abandoned'
               AND checkout_fingerprint IS NULL
               AND unixepoch(created_at) >= unixepoch('now', '-2 hours')`,
          )
          .bind(
            orderNumber,
            input.submitToken,
            publicStatusToken,
            input.customerName,
            input.customerPhone,
            input.customerEmail || null,
            input.address,
            input.province,
            input.city,
            input.district,
            input.postalCode || null,
            input.warehouseId || null,
            totalAmount,
            input.shippingCost,
            codFee.serviceFee,
            codFee.vat,
            codFeeBearer,
            input.paymentMethod,
            paymentStatus,
            input.destinationAreaId || null,
            input.courierCode || null,
            input.courierService || null,
            input.adClickIds || null,
            input.metaRequestContext || null,
            input.sourcePagePath || null,
            sellerBankAccount?.id || null,
            sellerBankAccount?.bank_code || null,
            sellerBankAccount
              ? paymentBrandLabel(sellerBankAccount.bank_code)
              : null,
            sellerBankAccount?.account_holder || null,
            sellerBankAccount?.account_number || null,
            checkoutFingerprint,
            dedupeExpiresAt,
            abandonedOrder.id,
            input.customerPhone,
          )
      : database
          .prepare(
            `INSERT OR IGNORE INTO orders (
              order_number, submit_token, public_status_token, store_id, warehouse_id,
              customer_name, customer_phone, customer_email, address, province, city, district, postal_code,
              total_amount, shipping_cost, cod_service_fee, cod_service_fee_vat,
              cod_fee_bearer, payment_method, payment_status, shipping_status,
              destination_area_id, courier_code, courier_service, ad_click_ids,
              meta_request_context, source_page_path,
              seller_bank_account_id, seller_bank_code, seller_bank_name,
              seller_account_holder, seller_account_number, created_at,
              checkout_fingerprint, checkout_dedupe_expires_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )`,
          )
          .bind(
            orderNumber,
            input.submitToken,
            publicStatusToken,
            store.id,
            input.warehouseId || null,
            input.customerName,
            input.customerPhone,
            input.customerEmail || null,
            input.address,
            input.province,
            input.city,
            input.district,
            input.postalCode || null,
            totalAmount,
            input.shippingCost,
            codFee.serviceFee,
            codFee.vat,
            codFeeBearer,
            input.paymentMethod,
            paymentStatus,
            input.destinationAreaId || null,
            input.courierCode || null,
            input.courierService || null,
            input.adClickIds || null,
            input.metaRequestContext || null,
            input.sourcePagePath || null,
            sellerBankAccount?.id || null,
            sellerBankAccount?.bank_code || null,
            sellerBankAccount
              ? paymentBrandLabel(sellerBankAccount.bank_code)
              : null,
            sellerBankAccount?.account_holder || null,
            sellerBankAccount?.account_number || null,
            createdAt,
            checkoutFingerprint,
            dedupeExpiresAt,
          );

    const identityPredicate = abandonedOrder
      ? "id = ? AND submit_token = ?"
      : "order_number = ? AND submit_token = ?";
    const identityBindings: [number | string, string] = [
      abandonedOrder?.id || orderNumber,
      input.submitToken,
    ];
    const statements = [
      database
        .prepare(
          `UPDATE orders
           SET checkout_fingerprint = NULL,
               checkout_dedupe_expires_at = NULL
           WHERE checkout_fingerprint = ?
             AND (
               checkout_dedupe_expires_at <= ?
               OR shipping_status NOT IN ('pending', 'processing', 'shipped')
               OR payment_status IN ('failed', 'refunded', 'cancelled')
             )`,
        )
        .bind(checkoutFingerprint, createdAt),
      orderStatement,
    ];
    if (abandonedOrder) {
      statements.push(
        database
          .prepare(
            `DELETE FROM order_items
             WHERE order_id IN (
               SELECT id FROM orders WHERE ${identityPredicate}
             )`,
          )
          .bind(...identityBindings),
      );
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO order_items (order_id, variant_id, quantity, unit_price, weight_grams)
           SELECT id, ?, ?, ?, (SELECT weight_grams FROM product_variants WHERE id = ?)
           FROM orders
           WHERE ${identityPredicate}`,
        )
        .bind(
          variant.id,
          input.quantity,
          unitPrice,
          variant.id,
          ...identityBindings,
        ),
      database
        .prepare(
          `SELECT o.id, o.order_number, o.public_status_token, o.total_amount,
                  oi.unit_price, o.cod_service_fee, o.cod_service_fee_vat,
                  o.cod_fee_bearer, o.seller_bank_account_id, o.seller_bank_code,
                  o.seller_bank_name, o.seller_account_holder, o.seller_account_number
           FROM orders o
           INNER JOIN order_items oi ON oi.order_id = o.id
           WHERE (
               (o.checkout_fingerprint = ? AND o.checkout_dedupe_expires_at > ?)
               OR o.submit_token = ?
             )
             AND o.shipping_status IN ('pending', 'processing', 'shipped')
             AND o.payment_status NOT IN ('failed', 'refunded', 'cancelled')
           ORDER BY o.id DESC, oi.id ASC
           LIMIT 1`,
        )
        .bind(checkoutFingerprint, createdAt, input.submitToken),
    );
    const results = await database.batch(statements);
    const row = results.at(-1)?.results?.[0] as CanonicalOrderRow | undefined;
    const created = Number(results[1]?.meta?.changes || 0) > 0;
    if (!row?.id) {
      if (!created) {
        throw new DuplicateSubmissionError(
          "Permintaan duplikat terdeteksi. Pesanan sudah diproses.",
        );
      }
      throw new Error("Order gagal disimpan.");
    }
    // Recorded here rather than in each of the three checkout routes that call
    // this, so a new entry point cannot forget it. Fail-open by contract: the
    // order is already committed and a buyer must never see a checkout fail
    // because an operator convenience could not be stored (REQ-149).
    if (created) {
      await recordNotification(database, {
        type: "order",
        orderId: row.id,
        orderNumber: row.order_number,
        ...buildOrderNotification({
          orderNumber: row.order_number,
          customerName: input.customerName,
          totalAmount: Number(row.total_amount),
          district: input.district,
          city: input.city,
        }),
      });
    }
    return persistedOrderFromRow(row, created);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("orders.submit_token") ||
      message.includes("orders_submit_token_unique")
    ) {
      throw new DuplicateSubmissionError(
        "Permintaan duplikat terdeteksi. Pesanan sudah diproses.",
      );
    }
    // The `product_variants_stock_nonnegative` trigger (migration 0003) is
    // still in the schema and still correct, but checkout no longer writes to
    // `stock` at all (ADR-023), so it can no longer fire from here. The branch
    // that translated it into a buyer-facing message is gone with it.
    throw error;
  }
}
