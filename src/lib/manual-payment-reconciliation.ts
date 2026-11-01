import { AutoLarisClient } from "./autolaris-client.ts";
import {
  adoptPaymentAttemptStatements,
  markPaymentAttemptSettledStatement,
  type PaymentTransactionAttempt,
} from "./autolaris-payment.ts";
import type { AdminRole } from "./auth.ts";
import {
  buildPaymentNotification,
  recordNotification,
} from "./notifications.ts";
import { getProviderConfig } from "./provider-config.ts";

const ONLINE_METHODS_SQL = "('bank_transfer', 'qris')";
const CONFIRMATION_ROLES = new Set<AdminRole>(["owner", "admin"]);

export class ManualPaymentReconciliationError extends Error {
  readonly code:
    | "FORBIDDEN"
    | "ACTOR_NOT_FOUND"
    | "PAYMENT_NOT_FOUND"
    | "PAYMENT_CONFLICT"
    | "PAYMENT_MISMATCH"
    | "VALIDATION_ERROR"
    | "DATABASE_ERROR";

  constructor(
    code:
      | "FORBIDDEN"
      | "ACTOR_NOT_FOUND"
      | "PAYMENT_NOT_FOUND"
      | "PAYMENT_CONFLICT"
      | "PAYMENT_MISMATCH"
      | "VALIDATION_ERROR"
      | "DATABASE_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ManualPaymentReconciliationError";
    this.code = code;
  }
}

type ActorRow = {
  actor_admin_id: number;
  actor_username: string;
  actor_role: AdminRole;
  store_id: number;
};

type PaymentRow = {
  transaction_id: number;
  order_id: number;
  order_number: string;
  customer_name: string;
  payment_method: string;
  order_payment_status: string;
  shipping_status: string;
  stock_restored_at: string | null;
  provider: string;
  provider_transaction_id: string | null;
  reference_id: string;
  status: string;
  amount: number;
  admin_fee: number;
  total_amount: number;
  audit_id: number | null;
  confirmed_by: string | null;
  confirmed_role: string | null;
  confirmed_at: string | null;
  confirmation_note: string | null;
};

export type ManualConfirmationInput = {
  transactionId: number;
  verifiedAmount: number;
  providerReference: string;
  note: string;
};

async function resolveActor(
  database: D1Database,
  admin: { username: string; role: AdminRole } | undefined,
): Promise<ActorRow> {
  if (!admin || !CONFIRMATION_ROLES.has(admin.role)) {
    throw new ManualPaymentReconciliationError(
      "FORBIDDEN",
      "Hanya owner atau admin yang dapat mengonfirmasi pembayaran.",
    );
  }
  const actor = await database
    .prepare(
      `SELECT
        ac.id AS actor_admin_id,
        ac.username AS actor_username,
        ac.role AS actor_role,
        s.id AS store_id
      FROM admin_credentials ac
      CROSS JOIN (SELECT id FROM stores ORDER BY id LIMIT 1) s
      WHERE ac.username = ? AND ac.role = ?
        AND ac.role IN ('owner', 'admin')
      LIMIT 1`,
    )
    .bind(admin.username, admin.role)
    .first<ActorRow>();
  if (!actor) {
    throw new ManualPaymentReconciliationError(
      "ACTOR_NOT_FOUND",
      "Sesi operator tidak lagi cocok dengan data admin.",
    );
  }
  return actor;
}

const PAYMENT_SELECT = `SELECT
  pt.id AS transaction_id,
  pt.order_id,
  o.order_number,
  o.customer_name,
  o.payment_method,
  o.payment_status AS order_payment_status,
  o.shipping_status,
  o.stock_restored_at,
  pt.provider,
  pt.provider_transaction_id,
  pt.reference_id,
  pt.status,
  pt.amount,
  pt.admin_fee,
  pt.total_amount,
  audit.id AS audit_id,
  audit.actor_username AS confirmed_by,
  audit.actor_role AS confirmed_role,
  audit.confirmed_at,
  audit.note AS confirmation_note
FROM payment_transactions pt
INNER JOIN orders o ON o.id = pt.order_id
LEFT JOIN payment_reconciliation_audits audit
  ON audit.payment_transaction_id = pt.id
WHERE pt.id = ?
  AND o.store_id = ?
  AND pt.provider = 'autolaris'
  AND o.payment_method IN ${ONLINE_METHODS_SQL}
LIMIT 1`;

export async function confirmManualAutoLarisPayment(
  database: D1Database,
  admin: { username: string; role: AdminRole } | undefined,
  input: ManualConfirmationInput,
  now = new Date().toISOString(),
) {
  if (input.note.trim().length < 5 || input.note.trim().length > 500) {
    throw new ManualPaymentReconciliationError(
      "VALIDATION_ERROR",
      "Catatan verifikasi wajib diisi minimal 5 karakter.",
    );
  }
  const actor = await resolveActor(database, admin);
  const payment = await database
    .prepare(PAYMENT_SELECT)
    .bind(input.transactionId, actor.store_id)
    .first<PaymentRow>();
  if (!payment) {
    throw new ManualPaymentReconciliationError(
      "PAYMENT_NOT_FOUND",
      "Transaksi AutoLaris tidak ditemukan.",
    );
  }
  // The reference may be an instruction the buyer paid after it was replaced
  // (audit 2026-10-31 H-1): it is kept in payment_transaction_attempts, and
  // put back on the row in the same batch as the confirmation.
  const matchesCurrent =
    Boolean(payment.provider_transaction_id) &&
    payment.provider_transaction_id === input.providerReference &&
    payment.total_amount === input.verifiedAmount;
  const attempt = matchesCurrent
    ? null
    : await database
        .prepare(
          `SELECT id, payment_transaction_id, provider_transaction_id, reference_id, channel_code,
            amount, admin_fee, total_amount, expires_at
          FROM payment_transaction_attempts
          WHERE payment_transaction_id = ? AND provider_transaction_id = ? AND total_amount = ?
            AND settled_at IS NULL
          LIMIT 1`,
        )
        .bind(input.transactionId, input.providerReference, input.verifiedAmount)
        .first<PaymentTransactionAttempt>();
  if (!matchesCurrent && !attempt) {
    throw new ManualPaymentReconciliationError(
      "PAYMENT_MISMATCH",
      "Nominal atau referensi provider tidak cocok dengan catatan pembayaran.",
    );
  }

  const alreadyConfirmed =
    payment.status === "paid" &&
    payment.order_payment_status === "paid" &&
    payment.audit_id !== null;
  if (alreadyConfirmed) {
    return { transaction: payment, transitioned: false };
  }
  if (
    // A matched superseded instruction replaces the row, status included.
    (!attempt && !["pending", "expired"].includes(payment.status)) ||
    !["pending", "unpaid"].includes(payment.order_payment_status) ||
    payment.shipping_status !== "pending" ||
    payment.stock_restored_at !== null ||
    payment.audit_id !== null
  ) {
    throw new ManualPaymentReconciliationError(
      "PAYMENT_CONFLICT",
      "Status pembayaran sudah berubah dan tidak dapat dikonfirmasi.",
    );
  }

  let results: D1Result[];
  const adopt = attempt ? adoptPaymentAttemptStatements(database, attempt, now) : [];
  const transactionSettleIndex = adopt.length + 1;
  try {
    results = await database.batch([
      ...adopt,
      database
        .prepare(
          `INSERT INTO payment_reconciliation_audits (
            store_id, payment_transaction_id, order_id,
            actor_admin_id, actor_username, actor_role,
            provider, provider_transaction_id, reference_id,
            previous_transaction_status, previous_order_payment_status,
            recorded_amount, recorded_admin_fee, recorded_total_amount,
            note, confirmed_at
          )
          SELECT
            o.store_id, pt.id, o.id,
            ?, ?, ?,
            'autolaris', pt.provider_transaction_id, pt.reference_id,
            -- An adopted row reads 'expired' by now; record what it was before.
            COALESCE(?, pt.status), o.payment_status,
            pt.amount, pt.admin_fee, pt.total_amount, ?, ?
          FROM payment_transactions pt
          INNER JOIN orders o ON o.id = pt.order_id
          WHERE pt.id = ? AND o.store_id = ?
            AND pt.provider = 'autolaris'
            AND o.payment_method IN ${ONLINE_METHODS_SQL}
            AND pt.status IN ('pending', 'expired')
            AND o.payment_status IN ('pending', 'unpaid')
            AND o.shipping_status = 'pending'
            AND o.stock_restored_at IS NULL
            AND pt.provider_transaction_id = ?
            AND pt.total_amount = ?
            AND NOT EXISTS (
              SELECT 1 FROM payment_reconciliation_audits existing
              WHERE existing.payment_transaction_id = pt.id
            )`,
        )
        .bind(
          actor.actor_admin_id,
          actor.actor_username,
          actor.actor_role,
          attempt ? payment.status : null,
          input.note,
          now,
          input.transactionId,
          actor.store_id,
          input.providerReference,
          input.verifiedAmount,
        ),
      database
        .prepare(
          `UPDATE payment_transactions
          SET status = 'paid', paid_at = COALESCE(paid_at, ?),
            failed_reason = NULL, updated_at = ?
          WHERE id = ? AND status IN ('pending', 'expired')
            AND EXISTS (
              SELECT 1 FROM payment_reconciliation_audits audit
              WHERE audit.payment_transaction_id = payment_transactions.id
            )`,
        )
        .bind(now, now, input.transactionId),
      database
        .prepare(
          `UPDATE orders
          SET payment_status = 'paid'
          WHERE id = ? AND store_id = ? AND payment_status IN ('pending', 'unpaid')
            AND EXISTS (
              SELECT 1
              FROM payment_transactions pt
              INNER JOIN payment_reconciliation_audits audit
                ON audit.payment_transaction_id = pt.id
              WHERE pt.id = ? AND pt.order_id = orders.id
                AND pt.provider = 'autolaris' AND pt.status = 'paid'
            )`,
        )
        .bind(payment.order_id, actor.store_id, input.transactionId),
      ...(attempt ? [markPaymentAttemptSettledStatement(database, attempt.id, now)] : []),
    ]);
  } catch {
    throw new ManualPaymentReconciliationError(
      "DATABASE_ERROR",
      "Konfirmasi pembayaran tidak dapat disimpan.",
    );
  }
  const confirmed = await database
    .prepare(PAYMENT_SELECT)
    .bind(input.transactionId, actor.store_id)
    .first<PaymentRow>();
  if (
    !confirmed ||
    confirmed.status !== "paid" ||
    confirmed.order_payment_status !== "paid" ||
    confirmed.audit_id === null
  ) {
    throw new ManualPaymentReconciliationError(
      "PAYMENT_CONFLICT",
      "Pembayaran berubah saat dikonfirmasi. Muat ulang antrean.",
    );
  }
  await recordNotification(database, {
    type: "payment",
    orderId: confirmed.order_id,
    orderNumber: confirmed.order_number,
    ...buildPaymentNotification({
      orderNumber: confirmed.order_number,
      customerName: confirmed.customer_name,
      totalAmount: confirmed.total_amount,
    }),
  });
  return {
    transaction: confirmed,
    // The payment_transactions settle: after the adopt pair and the audit insert.
    transitioned: Number(results[transactionSettleIndex]?.meta?.changes || 0) > 0,
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function listManualAutoLarisPayments(
  database: D1Database,
  admin: { username: string; role: AdminRole } | undefined,
  input: {
    page: number;
    pageSize: number;
    search: string;
    status: "pending" | "paid";
  },
) {
  const actor = await resolveActor(database, admin);
  const search = escapeLike(input.search);
  const offset = (input.page - 1) * input.pageSize;
  const filter = `
    FROM payment_transactions pt
    INNER JOIN orders o ON o.id = pt.order_id
    LEFT JOIN payment_reconciliation_audits audit
      ON audit.payment_transaction_id = pt.id
    WHERE o.store_id = ? AND pt.provider = 'autolaris'
      AND o.payment_method IN ${ONLINE_METHODS_SQL}
      AND ((? = 'pending' AND pt.status IN ('pending', 'expired'))
        OR (? = 'paid' AND pt.status = 'paid'))
      AND (? = '' OR o.order_number LIKE '%' || ? || '%' ESCAPE '\\'
        OR o.customer_name LIKE '%' || ? || '%' ESCAPE '\\'
        OR pt.provider_transaction_id LIKE '%' || ? || '%' ESCAPE '\\'
        OR pt.reference_id LIKE '%' || ? || '%' ESCAPE '\\')`;
  const args = [
    actor.store_id,
    input.status,
    input.status,
    search,
    search,
    search,
    search,
    search,
  ];

  const [rows, count, summary] = await Promise.all([
    database
      .prepare(
        `SELECT
          pt.id AS transaction_id, o.order_number, o.customer_name,
          o.customer_phone,
          pt.channel_code, pt.total_amount, pt.provider_transaction_id,
          pt.reference_id, pt.created_at, pt.expires_at, pt.status,
          o.payment_status, o.shipping_status, o.stock_restored_at,
          CASE WHEN pt.provider_transaction_id IS NOT NULL
            AND trim(pt.provider_transaction_id) <> ''
            AND pt.status IN ('pending', 'expired')
            AND o.payment_status IN ('pending', 'unpaid')
            AND o.shipping_status = 'pending'
            AND o.stock_restored_at IS NULL
            THEN 1 ELSE 0 END AS confirmation_eligible,
          CASE
            WHEN pt.provider_transaction_id IS NULL OR trim(pt.provider_transaction_id) = ''
              THEN 'provider_reference_missing'
            WHEN o.stock_restored_at IS NOT NULL THEN 'stock_restored'
            WHEN o.shipping_status <> 'pending' THEN 'shipping_not_pending'
            WHEN o.payment_status NOT IN ('pending', 'unpaid') THEN 'order_payment_status_locked'
            WHEN pt.status NOT IN ('pending', 'expired') THEN 'transaction_status_locked'
            ELSE NULL
          END AS confirmation_block_reason,
          audit.actor_username AS confirmed_by,
          audit.actor_role AS confirmed_role,
          audit.confirmed_at,
          audit.note AS confirmation_note
        ${filter}
        ORDER BY pt.created_at DESC, pt.id DESC
        LIMIT ? OFFSET ?`,
      )
      .bind(...args, input.pageSize, offset)
      .all(),
    database
      .prepare(`SELECT COUNT(*) AS total ${filter}`)
      .bind(...args)
      .first<{ total: number }>(),
    database
      .prepare(
        `SELECT
          SUM(CASE WHEN pt.status IN ('pending', 'expired') THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN pt.status IN ('pending', 'expired') THEN pt.total_amount ELSE 0 END) AS pending_total,
          SUM(CASE WHEN pt.status IN ('pending', 'expired') AND pt.expires_at IS NOT NULL
            AND pt.expires_at < ? THEN 1 ELSE 0 END) AS overdue_count,
          SUM(CASE WHEN pt.status = 'expired' THEN 1 ELSE 0 END) AS expired_count,
          SUM(CASE WHEN pt.status IN ('pending', 'expired')
            AND pt.provider_transaction_id IS NOT NULL AND trim(pt.provider_transaction_id) <> ''
            AND o.payment_status IN ('pending', 'unpaid')
            AND o.shipping_status = 'pending' AND o.stock_restored_at IS NULL
            THEN 1 ELSE 0 END) AS actionable_count,
          SUM(CASE WHEN pt.status IN ('pending', 'expired') AND NOT (
            pt.provider_transaction_id IS NOT NULL AND trim(pt.provider_transaction_id) <> ''
            AND o.payment_status IN ('pending', 'unpaid')
            AND o.shipping_status = 'pending' AND o.stock_restored_at IS NULL
          ) THEN 1 ELSE 0 END) AS blocked_count,
          SUM(CASE WHEN pt.status = 'paid' AND audit.id IS NOT NULL THEN 1 ELSE 0 END)
            AS manually_confirmed_count
        FROM payment_transactions pt
        INNER JOIN orders o ON o.id = pt.order_id
        LEFT JOIN payment_reconciliation_audits audit
          ON audit.payment_transaction_id = pt.id
        WHERE o.store_id = ? AND pt.provider = 'autolaris'
          AND o.payment_method IN ${ONLINE_METHODS_SQL}`,
      )
      .bind(new Date().toISOString(), actor.store_id)
      .first<{
        pending_count: number | null;
        pending_total: number | null;
        overdue_count: number | null;
        expired_count: number | null;
        actionable_count: number | null;
        blocked_count: number | null;
        manually_confirmed_count: number | null;
      }>(),
  ]);
  const total = Number(count?.total || 0);
  return {
    transactions: (rows.results ?? []).map((row) => {
      const transaction = row as Record<string, unknown>;
      return {
        ...transaction,
        confirmation_eligible: Boolean(transaction.confirmation_eligible),
      };
    }),
    summary: {
      pending_count: Number(summary?.pending_count || 0),
      pending_total: Number(summary?.pending_total || 0),
      overdue_count: Number(summary?.overdue_count || 0),
      expired_count: Number(summary?.expired_count || 0),
      actionable_count: Number(summary?.actionable_count || 0),
      blocked_count: Number(summary?.blocked_count || 0),
      manually_confirmed_count: Number(summary?.manually_confirmed_count || 0),
    },
    pagination: {
      page: input.page,
      page_size: input.pageSize,
      total,
      total_pages: Math.ceil(total / input.pageSize),
    },
  };
}

export type AutoLarisPaymentInquiryResult = {
  transactionId: number;
  orderNumber: string;
  localStatus: string;
  provider: {
    code: string;
    status: string;
    settlement: "pending" | "paid" | "unproven";
    awb?: string;
  };
  /**
   * The provider says the money has not arrived while this store says it has.
   * That combination can only come from a mistaken manual confirmation, so it
   * is surfaced rather than reconciled away.
   */
  contradictsLocalPaid: boolean;
  checkedAt: string;
};

/**
 * Reads one AutoLaris transaction's state straight from the provider.
 *
 * Deliberately read-only at this operator boundary: it writes nothing to D1.
 * The hourly scheduled reconciliation owns automatic paid transitions through
 * the same Advice adapter.
 */
export async function inquireAutoLarisPaymentStatus(
  database: D1Database,
  locals: App.Locals,
  admin: { username: string; role: AdminRole } | undefined,
  transactionId: number,
): Promise<AutoLarisPaymentInquiryResult> {
  await resolveActor(database, admin);

  const row = await database
    .prepare(
      `SELECT pt.id, pt.provider, pt.provider_transaction_id, pt.status,
        o.order_number
      FROM payment_transactions pt
      INNER JOIN orders o ON o.id = pt.order_id
      WHERE pt.id = ?
      LIMIT 1`,
    )
    .bind(transactionId)
    .first<{
      id: number;
      provider: string;
      provider_transaction_id: string | null;
      status: string;
      order_number: string;
    }>();
  if (!row) {
    throw new ManualPaymentReconciliationError(
      "PAYMENT_NOT_FOUND",
      "Transaksi pembayaran tidak ditemukan.",
    );
  }
  if (row.provider !== "autolaris") {
    throw new ManualPaymentReconciliationError(
      "VALIDATION_ERROR",
      "Hanya transaksi AutoLaris yang dapat dicek ke provider.",
    );
  }
  const providerTransactionId = row.provider_transaction_id?.trim() || "";
  if (!providerTransactionId) {
    throw new ManualPaymentReconciliationError(
      "VALIDATION_ERROR",
      "Transaksi ini belum pernah diterima AutoLaris, jadi tidak ada yang bisa dicek.",
    );
  }

  const config = (await getProviderConfig(database, locals)).autolaris;
  if (!config.apiKey) {
    throw new ManualPaymentReconciliationError(
      "VALIDATION_ERROR",
      "API Key AutoLaris belum dikonfigurasi.",
    );
  }

  const inquiry = await new AutoLarisClient(
    config.apiKey,
    config.baseUrl,
  ).inquirePayment(providerTransactionId);

  return {
    transactionId: row.id,
    orderNumber: row.order_number,
    localStatus: row.status,
    provider: {
      code: inquiry.code,
      status: inquiry.status,
      settlement: inquiry.settlement,
      awb: inquiry.awb,
    },
    contradictsLocalPaid:
      row.status === "paid" && inquiry.settlement === "pending",
    checkedAt: new Date().toISOString(),
  };
}
