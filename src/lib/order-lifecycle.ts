const PAYMENT_STATUSES = new Set([
  "unpaid",
  "pending",
  "paid",
  "settled",
  "success",
  "failed",
  "refunded",
  "cancelled",
]);

export const ADMIN_SHIPPING_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type AdminShippingStatus = (typeof ADMIN_SHIPPING_STATUSES)[number];

const PAID_PAYMENT_STATUSES = new Set(["paid", "settled", "success"]);
const RELEASING_PAYMENT_STATUSES = new Set(["cancelled", "refunded", "failed"]);
const RELEASING_SHIPPING_STATUSES = new Set(["cancelled", "returned"]);
const SHIPPED_LIKE_STATUSES = new Set(["shipped", "delivered", "returned"]);
/** An order in one of these states is void: released, and never dispatchable again. */
const STOCK_RELEASED_SQL =
  "(o.shipping_status IN ('cancelled', 'returned') OR o.payment_status IN ('cancelled', 'refunded', 'failed'))";

export type OrderLifecycleState = {
  id: number;
  payment_method: string;
  payment_status: string;
  shipping_status: string;
  courier_code: string | null;
  cnote_no: string | null;
  provider_order_id: string | null;
  stock_restored_at: string | null;
};

export type OrderLifecycleUpdate = {
  paymentStatus?: string;
  shippingStatus?: string;
};

export type ResolvedOrderLifecycleTransition = {
  paymentStatus: string;
  shippingStatus: string;
  releasesStock: boolean;
};

export type DeletedOrder = {
  id: number;
  order_number: string;
};

export class OrderLifecycleError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "OrderLifecycleError";
    this.status = status;
  }
}

export function releasesReservedStock(
  paymentStatus: string,
  shippingStatus: string,
) {
  return (
    RELEASING_SHIPPING_STATUSES.has(shippingStatus) ||
    RELEASING_PAYMENT_STATUSES.has(paymentStatus)
  );
}

/**
 * Whether an order is void: released once (`stock_restored_at`) or in a
 * releasing status now. A void order is never dispatched and never reported
 * to an ad platform as a Purchase, whatever its payment status says.
 */
export function isVoidOrder(order: {
  payment_status: string;
  shipping_status: string;
  stock_restored_at?: string | null;
}) {
  return (
    Boolean(order.stock_restored_at) ||
    releasesReservedStock(order.payment_status, order.shipping_status)
  );
}

/**
 * Canonical policy for manual admin lifecycle changes. Provider dispatch and
 * abandoned-order promotion own their state transitions separately because
 * they also create a shipment or reserve inventory.
 */
export function resolveAdminOrderTransition(
  current: OrderLifecycleState,
  update: OrderLifecycleUpdate,
): ResolvedOrderLifecycleTransition {
  const paymentStatus = update.paymentStatus ?? current.payment_status;
  const shippingStatus = update.shippingStatus ?? current.shipping_status;

  if (!PAYMENT_STATUSES.has(paymentStatus)) {
    throw new OrderLifecycleError("Status pembayaran tidak valid.", 400);
  }
  if (
    shippingStatus !== "abandoned" &&
    !ADMIN_SHIPPING_STATUSES.includes(shippingStatus as AdminShippingStatus)
  ) {
    throw new OrderLifecycleError("Status pengiriman tidak valid.", 400);
  }

  const paymentChanged = paymentStatus !== current.payment_status;
  const shippingChanged = shippingStatus !== current.shipping_status;
  if (!paymentChanged && !shippingChanged) {
    return {
      paymentStatus,
      shippingStatus,
      releasesStock: releasesReservedStock(paymentStatus, shippingStatus),
    };
  }

  // Only a provider-backed payment (QRIS/VA) must wait for AutoLaris. COD is
  // collected by the courier, and a manual transfer lands in the seller's own
  // account where the operator is the only one who can see it — refusing
  // `paid` there left those orders cancellable and nothing else, never shipped.
  if (
    paymentChanged &&
    PAID_PAYMENT_STATUSES.has(paymentStatus) &&
    current.payment_method !== "cod" &&
    current.payment_method !== "manual_transfer"
  ) {
    throw new OrderLifecycleError(
      "Pembayaran online hanya boleh ditandai paid oleh rekonsiliasi AutoLaris.",
    );
  }

  if (
    current.shipping_status === "abandoned" ||
    shippingStatus === "abandoned"
  ) {
    throw new OrderLifecycleError(
      "Pesanan tertinggal hanya dapat diaktifkan melalui checkout atau konversi CS.",
    );
  }

  const currentReleased = isVoidOrder(current);
  const nextReleased = releasesReservedStock(paymentStatus, shippingStatus);
  if (
    currentReleased &&
    shippingChanged &&
    !RELEASING_SHIPPING_STATUSES.has(shippingStatus)
  ) {
    throw new OrderLifecycleError(
      "Order yang sudah dibatalkan atau dikembalikan tidak dapat diaktifkan kembali. Buat order baru.",
    );
  }
  if (currentReleased && !nextReleased) {
    throw new OrderLifecycleError(
      "Order yang sudah dibatalkan atau dikembalikan tidak dapat diaktifkan kembali. Buat order baru.",
    );
  }

  if (shippingStatus === "pending" && current.shipping_status !== "pending") {
    throw new OrderLifecycleError(
      "Order yang sudah masuk pengiriman tidak dapat dikembalikan ke status menunggu.",
    );
  }

  if (
    current.shipping_status === "pending" &&
    !["pending", "cancelled"].includes(shippingStatus) &&
    !current.provider_order_id
  ) {
    throw new OrderLifecycleError(
      "Gunakan aksi Push/Arrange Shipping ke Mengantar sebelum mengubah status pengiriman.",
    );
  }

  if (
    SHIPPED_LIKE_STATUSES.has(shippingStatus) &&
    (!current.provider_order_id || !current.courier_code || !current.cnote_no)
  ) {
    throw new OrderLifecycleError(
      "Order yang sudah dikirim harus memiliki shipment, kurir, dan nomor resi dari Mengantar.",
      400,
    );
  }

  if (
    shippingStatus === "delivered" &&
    current.payment_method !== "cod" &&
    !PAID_PAYMENT_STATUSES.has(paymentStatus)
  ) {
    throw new OrderLifecycleError(
      "Order non-COD tidak boleh diselesaikan sebelum berstatus paid.",
    );
  }

  return { paymentStatus, shippingStatus, releasesStock: nextReleased };
}


function selectedOrdersCte(orderIds: readonly number[]) {
  return `WITH selected(order_id) AS (VALUES ${orderIds.map(() => "(?)").join(", ")})`;
}

/**
 * Marks an order released, exactly once.
 *
 * `stock_restored_at` is the marker's column name and predates ADR-023, when
 * releasing an order also returned its quantity to a counted shelf. Stock is
 * no longer counted, so nothing is returned — but the marker still carries its
 * other, load-bearing meaning: this order is void, it may not be released a
 * second time, and manual payment reconciliation must refuse it. The column
 * keeps its name because renaming it buys nothing and touches every reader.
 */
function buildOrderReleaseStatements(
  database: D1Database,
  orderIds: readonly number[],
  requireReleasedState: boolean,
) {
  const cte = selectedOrdersCte(orderIds);
  const releaseGuard = requireReleasedState
    ? ` AND ${STOCK_RELEASED_SQL}`
    : " AND o.shipping_status <> 'abandoned'";
  return [
    database
      .prepare(
        `${cte}
        UPDATE orders AS o
        SET stock_restored_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE o.id IN (SELECT order_id FROM selected)
          AND o.stock_restored_at IS NULL${releaseGuard}`,
      )
      .bind(...orderIds),
  ];
}

export async function applyOrderLifecycleMutation(
  database: D1Database,
  current: OrderLifecycleState,
  update: OrderLifecycleUpdate,
  orderMutation: D1PreparedStatement,
) {
  const transition = resolveAdminOrderTransition(current, update);
  const statements = [orderMutation];
  if (transition.releasesStock) {
    statements.push(
      ...buildOrderReleaseStatements(database, [current.id], true),
    );
  }
  const results = await database.batch(statements);
  return {
    updated: Boolean(results[0]?.meta?.changes),
    stockRestored:
      transition.releasesStock && Boolean(results[1]?.meta?.changes),
  };
}

export async function updateAdminOrderShippingStatuses(
  database: D1Database,
  rawOrderIds: readonly number[],
  shippingStatus: AdminShippingStatus,
): Promise<number> {
  const orderIds = Array.from(new Set(rawOrderIds)).filter(
    (orderId) => Number.isInteger(orderId) && orderId > 0,
  );
  if (orderIds.length === 0 || orderIds.length > 100) {
    throw new OrderLifecycleError(
      "Pilih 1 sampai 100 order untuk diperbarui.",
      400,
    );
  }

  const placeholders = orderIds.map(() => "?").join(", ");
  const loaded = await database
    .prepare(
      `SELECT id, payment_method, payment_status, shipping_status,
        courier_code, cnote_no, provider_order_id, stock_restored_at
      FROM orders
      WHERE id IN (${placeholders})`,
    )
    .bind(...orderIds)
    .all<OrderLifecycleState>();
  const orders = loaded.results || [];
  if (orders.length !== orderIds.length) {
    throw new OrderLifecycleError(
      "Satu atau lebih order tidak ditemukan.",
      404,
    );
  }

  const transitions = orders.map((order) =>
    resolveAdminOrderTransition(order, { shippingStatus }),
  );
  const cte = selectedOrdersCte(orderIds);
  const statements = [
    database
      .prepare(
        `${cte}
        UPDATE orders
        SET shipping_status = '${shippingStatus}'
        WHERE id IN (SELECT order_id FROM selected)`,
      )
      .bind(...orderIds),
  ];
  if (transitions.some((transition) => transition.releasesStock)) {
    statements.push(
      ...buildOrderReleaseStatements(database, orderIds, true),
    );
  }
  await database.batch(statements);
  // Every selected row was loaded and validated above, and the batch is all or
  // nothing, so that is the count. D1's `meta.changes` is not: it also counts
  // the 0075 `updated_at` trigger's own UPDATE, and reported 4 for 2 orders
  // (audit 2026-10-31 M1).
  return orders.length;
}

/**
 * Marks every still-open order released and deletes all order-owned rows in one
 * D1 batch transaction. D1 rolls the whole batch back if any statement fails.
 */
export async function deleteOrdersReleasingReservations(
  database: D1Database,
  rawOrderIds: readonly number[],
): Promise<DeletedOrder[]> {
  const orderIds = Array.from(new Set(rawOrderIds)).filter(
    (orderId) => Number.isInteger(orderId) && orderId > 0,
  );
  if (orderIds.length === 0 || orderIds.length > 100) {
    throw new OrderLifecycleError(
      "Pilih 1 sampai 100 order untuk dihapus.",
      400,
    );
  }

  const cte = selectedOrdersCte(orderIds);
  const auditedPayment = await database
    .prepare(
      `${cte}
      SELECT audit.payment_transaction_id
      FROM payment_reconciliation_audits audit
      INNER JOIN payment_transactions pt
        ON pt.id = audit.payment_transaction_id
      WHERE pt.order_id IN (SELECT order_id FROM selected)
      LIMIT 1`,
    )
    .bind(...orderIds)
    .first<{ payment_transaction_id: number }>();
  if (auditedPayment) {
    throw new OrderLifecycleError(
      "Order dengan pembayaran terverifikasi tidak dapat dihapus. Gunakan alur refund dan pertahankan catatan order.",
    );
  }
  // The audit row only exists for a *manual* reconciliation. An order the
  // hourly AutoLaris check marked paid, or one already handed to Mengantar,
  // carries money or a live shipment just the same and was deletable.
  const committed = await database
    .prepare(
      `${cte}
      SELECT o.order_number
      FROM orders o
      WHERE o.id IN (SELECT order_id FROM selected)
        AND (o.payment_status IN ('paid', 'settled', 'success') OR o.provider_order_id IS NOT NULL)
      LIMIT 1`,
    )
    .bind(...orderIds)
    .first<{ order_number: string }>();
  if (committed) {
    throw new OrderLifecycleError(
      `Order ${committed.order_number} sudah dibayar atau sudah dikirim ke kurir, sehingga tidak dapat dihapus. Batalkan atau refund dan pertahankan catatannya.`,
    );
  }
  const statements = [
    ...buildOrderReleaseStatements(database, orderIds, false),
    database
      .prepare(
        `${cte}
        DELETE FROM order_items
        WHERE order_id IN (SELECT order_id FROM selected)`,
      )
      .bind(...orderIds),
    database
      .prepare(
        `${cte}
        DELETE FROM payment_transactions
        WHERE order_id IN (SELECT order_id FROM selected)
          OR reference_id IN (
            SELECT o.order_number
            FROM orders o
            JOIN selected s ON s.order_id = o.id
          )`,
      )
      .bind(...orderIds),
    database
      .prepare(
        `${cte}
        DELETE FROM orders
        WHERE id IN (SELECT order_id FROM selected)
        RETURNING id, order_number`,
      )
      .bind(...orderIds),
  ];
  const results = await database.batch(statements);
  // The RETURNING delete is the last statement, whatever precedes it. A
  // hard-coded index here silently returned the wrong result the moment the
  // statement list changed length.
  return (results.at(-1)?.results || []) as DeletedOrder[];
}
