import {
  AUTOLARIS_PAID_CODE,
  AutoLarisClient,
  type AutoLarisCheckoutChannel,
  type AutoLarisPayment,
} from "./autolaris-client.ts";
import {
  calculateAutoLarisRequestAmount,
  calculatePaymentAdminFee,
  normalizePaymentFeeBearer,
  type PaymentFeeBearer,
} from "./payment-fee-policy.ts";
import { getProviderConfig } from "./provider-config.ts";
import { getEnvValue, getRuntimeEnv } from "./env.ts";
import { buildPaymentNotification, recordNotification } from "./notifications.ts";

export type AutoLarisPaymentRecord = {
  id: number;
  orderId: number;
  orderNumber: string;
  publicToken: string;
  channelCode: AutoLarisCheckoutChannel;
  feeBearer: PaymentFeeBearer;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  amount: number;
  adminFee: number;
  totalAmount: number;
  virtualAccount?: string;
  qrPayload?: string;
  paymentCode?: string;
  providerPaymentUrl?: string;
  expiresAt?: string;
  failedReason?: string;
};

type PaymentOrderRow = {
  id: number;
  order_number: string;
  store_id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  address: string;
  province: string;
  city: string;
  district: string;
  postal_code: string | null;
  total_amount: number;
  payment_method: string;
  payment_fee_bearer: string | null;
  store_name: string;
  warehouse_name: string | null;
  warehouse_contact_name: string | null;
  warehouse_contact_phone: string | null;
  warehouse_address: string | null;
  warehouse_city: string | null;
  warehouse_province: string | null;
};

type PaymentOrderItemRow = {
  quantity: number;
  unit_price: number;
  weight_grams: number;
  product_title: string;
  variant_title: string;
};

type PaymentTransactionRow = {
  id: number;
  order_id: number;
  order_number: string;
  public_token: string;
  channel_code: AutoLarisCheckoutChannel;
  fee_bearer: string;
  status: AutoLarisPaymentRecord["status"];
  amount: number;
  admin_fee: number;
  total_amount: number;
  virtual_account: string | null;
  qr_payload: string | null;
  payment_code: string | null;
  provider_payment_url: string | null;
  expires_at: string | null;
  failed_reason: string | null;
};

const cleanOptional = (value: string | null) => value?.trim() || undefined;

/** Statuses a buyer may ask to have regenerated; anything else is live or final. */
export const RETRYABLE_PAYMENT_STATUSES: ReadonlySet<string> = new Set(["failed", "expired"]);

/**
 * Expiry is decided at read time for the buyer-facing readers, and written by
 * the hourly sweeper (`expirePendingPaymentTransactions`) for every SQL
 * filter and count that reads `status` directly. Nothing used to write
 * `'expired'` — the provider closes a VA or QR on its own clock and never
 * tells us — so a pending row past `expires_at` was rendered as a live
 * instruction, the countdown reached 00:00:00, and the page kept polling it
 * forever.
 */
export function effectivePaymentStatus(
  status: string,
  expiresAt: string | null | undefined,
  now = Date.now(),
): string {
  if (status !== "pending" || !expiresAt) return status;
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry <= now ? "expired" : status;
}

/**
 * AutoLaris rejects any `reff_id` that is not digits, so the store's own
 * `INV-10001` cannot be sent verbatim. The numeric part is the store-wide
 * order sequence, which is already unique and never reused, and it keeps the
 * provider reference readable against the order number during reconciliation.
 */
export function autoLarisReferenceId(orderNumber: string) {
  const digits = orderNumber.replace(/\D/g, "");
  if (!digits) {
    throw new Error("Nomor order tidak dapat dijadikan referensi AutoLaris.");
  }
  return digits.slice(0, 30);
}

/**
 * A buyer email is mandatory at the provider. COD checkouts do not collect one,
 * so an order converted to an online payment later still needs a deliverable-
 * looking address that belongs to this store rather than to a stranger.
 */
/**
 * The domain a minted buyer email uses. A dotless host — `localhost` in
 * `npm run dev:local` — is not an email domain AutoLaris accepts, so it gets
 * the reserved `.invalid` suffix (RFC 2606): still recognisably this store's,
 * still never deliverable.
 */
function mintedEmailDomain(siteUrl: string) {
  const host = new URL(siteUrl).hostname.toLowerCase();
  return host.includes(".") ? host : `${host}.invalid`;
}

export function buyerEmail(
  storedEmail: string | null,
  customerPhone: string,
  siteUrl: string,
) {
  const stored = storedEmail?.trim();
  if (stored) return stored;
  return `${customerPhone.replace(/\D/g, "")}@${mintedEmailDomain(siteUrl)}`;
}

/**
 * True when `orders.customer_email` holds an address this system minted rather
 * than one a buyer gave.
 *
 * The provider requires an email and a COD checkout collects none, so two
 * places synthesise `<phone digits>@<store host>`: `buyerEmail` above, and
 * `submit-order.ts` when a non-COD order is created. Nobody owns that address
 * and no message will ever be delivered to it.
 *
 * It matters because Meta scores Event Match Quality on the keys it is given.
 * Hashing a fabricated `em` does not merely fail to match — it spends a match
 * key on a value no Meta user carries, which reads as a real signal that never
 * resolves. Both CAPI legs read this column straight into `em`.
 *
 * The test is deliberately two-part. An all-digits local part alone is not
 * enough: numeric Gmail addresses are ordinary in Indonesia, and dropping one
 * would throw away a genuine match key. No buyer, however, has an address at
 * the merchant's own storefront host.
 */
export function isSyntheticBuyerEmail(
  email: string | null | undefined,
  ...siteUrls: (string | null | undefined)[]
): boolean {
  const value = email?.trim().toLowerCase();
  if (!value) return false;
  const [localPart, domain] = value.split("@");
  if (!localPart || !domain || !/^\d+$/.test(localPart)) return false;
  // Every host this store answers on, not just one. `buyerEmail` mints against
  // the configured `siteUrl`, but `submit-order.ts` used to mint against the
  // *request* host — a store reachable on a workers.dev address, a preview
  // deployment, or any second domain therefore produced addresses the
  // single-host check did not recognise, and they went to Meta as real match
  // keys. Found by watching a live `/thanks` enqueue its payload, not by
  // reading the code. Minting is unified now; this stays for the rows already
  // written on the other host.
  for (const siteUrl of siteUrls) {
    if (!siteUrl) continue;
    try {
      if (domain === new URL(siteUrl).hostname.toLowerCase()) return true;
      if (domain === mintedEmailDomain(siteUrl)) return true;
    } catch {
      // An unparseable configured URL simply matches nothing.
    }
  }
  return false;
}

/** The email worth handing to Meta, or nothing when the stored one is minted. */
export function matchableCustomerEmail(
  email: string | null | undefined,
  ...siteUrls: (string | null | undefined)[]
): string | undefined {
  const value = email?.trim();
  if (!value || isSyntheticBuyerEmail(value, ...siteUrls)) return undefined;
  return value;
}

function mapPaymentRecord(row: PaymentTransactionRow): AutoLarisPaymentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    publicToken: row.public_token,
    channelCode: row.channel_code,
    feeBearer: normalizePaymentFeeBearer(row.fee_bearer),
    status: effectivePaymentStatus(row.status, row.expires_at) as AutoLarisPaymentRecord["status"],
    amount: Number(row.amount),
    adminFee: Number(row.admin_fee),
    totalAmount: Number(row.total_amount),
    virtualAccount: cleanOptional(row.virtual_account),
    qrPayload: cleanOptional(row.qr_payload),
    paymentCode: cleanOptional(row.payment_code),
    providerPaymentUrl: cleanOptional(row.provider_payment_url),
    expiresAt: cleanOptional(row.expires_at),
    failedReason: cleanOptional(row.failed_reason),
  };
}

/**
 * Keeps an instruction's provider identity before its row is rewritten
 * (audit 2026-10-31 H-1). The row is reused for a new instruction, but money
 * can still arrive on the old one, so the old `trx_id` must stay matchable by
 * the hourly Advice run and by manual confirmation. A row without a provider id
 * never reached AutoLaris and is not kept.
 */
export function supersedePaymentTransactionStatement(database: D1Database, transactionId: number, supersededAt: string) {
  return database
    .prepare(
      `INSERT INTO payment_transaction_attempts (
        payment_transaction_id, order_id, provider_transaction_id, reference_id, channel_code,
        amount, admin_fee, total_amount, expires_at, superseded_at
      )
      SELECT id, order_id, provider_transaction_id, reference_id, channel_code,
        amount, admin_fee, total_amount, expires_at, ?
      FROM payment_transactions
      WHERE id = ? AND provider_transaction_id IS NOT NULL AND trim(provider_transaction_id) <> ''
      ON CONFLICT(provider_transaction_id) DO NOTHING`,
    )
    .bind(supersededAt, transactionId);
}

/** A superseded instruction as stored, for settling it after the fact. */
export type PaymentTransactionAttempt = {
  id: number;
  payment_transaction_id: number;
  provider_transaction_id: string;
  reference_id: string;
  channel_code: string;
  amount: number;
  admin_fee: number;
  total_amount: number;
  expires_at: string | null;
};

/**
 * Puts a superseded instruction that turned out to be paid back on its
 * transaction row, the current instruction going to the attempts table in
 * its place (the same batch runs `supersedePaymentTransactionStatement`
 * first). After this the row says what the buyer actually paid, so every
 * existing settle statement, guarded on `provider_transaction_id`, applies.
 * `status` becomes `expired`: the instruction is past its window; settling
 * moves it to `paid`. Close the batch with `markPaymentAttemptSettledStatement`.
 */
export function adoptPaymentAttemptStatements(database: D1Database, attempt: PaymentTransactionAttempt, now: string) {
  return [
    supersedePaymentTransactionStatement(database, attempt.payment_transaction_id, now),
    database
      .prepare(
        `UPDATE payment_transactions SET
          provider_transaction_id = ?, reference_id = ?, channel_code = ?, amount = ?,
          admin_fee = ?, total_amount = ?, expires_at = ?, status = 'expired',
          virtual_account = NULL, qr_payload = NULL, payment_code = NULL,
          provider_payment_url = NULL, failed_reason = NULL, updated_at = ?
        WHERE id = ? AND status <> 'paid'`,
      )
      .bind(
        attempt.provider_transaction_id,
        attempt.reference_id,
        attempt.channel_code,
        attempt.amount,
        attempt.admin_fee,
        attempt.total_amount,
        attempt.expires_at,
        now,
        attempt.payment_transaction_id,
      ),
  ];
}

/**
 * Marks a superseded instruction settled, last in the batch that adopted it,
 * and only once its row is `paid` under that instruction's own provider id.
 * Run unconditionally, a settle that matched nothing (the order changed
 * mid-run) would hide the attempt from every later recheck while no money had
 * been recorded for it.
 */
export function markPaymentAttemptSettledStatement(database: D1Database, attemptId: number, now: string) {
  return database
    .prepare(
      `UPDATE payment_transaction_attempts SET settled_at = ?
      WHERE id = ? AND settled_at IS NULL
        AND EXISTS (
          SELECT 1 FROM payment_transactions pt
          WHERE pt.id = payment_transaction_attempts.payment_transaction_id
            AND pt.provider_transaction_id = payment_transaction_attempts.provider_transaction_id
            AND pt.status = 'paid'
        )`,
    )
    .bind(now, attemptId);
}

/** Hourly: a pending instruction past its expiry becomes `expired` for every reader. */
export async function expirePendingPaymentTransactions(database: D1Database, now = new Date()) {
  const iso = now.toISOString();
  const result = await database
    .prepare(
      `UPDATE payment_transactions
          SET status = 'expired', updated_at = ?
        WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .bind(iso, iso)
    .run();
  return result.meta.changes;
}

/**
 * The provider reference for one attempt. The first attempt is the bare order
 * sequence, readable against the order number; a retry appends a six-digit
 * clock suffix so the provider never sees a reference it may already hold
 * from the expired attempt. Digits only, at most 30, as the provider demands.
 */
export function autoLarisAttemptReferenceId(orderNumber: string, retry: boolean, now = Date.now()) {
  const base = autoLarisReferenceId(orderNumber);
  if (!retry) return base;
  return `${base}${String(Math.floor(now / 1000) % 1_000_000).padStart(6, "0")}`.slice(0, 30);
}

export async function loadPaymentRecord(database: D1Database, orderId: number) {
  const row = await database
    .prepare(
      `SELECT
        pt.id, pt.order_id, o.order_number, pt.public_token, pt.channel_code,
        pt.fee_bearer, pt.status, pt.amount, pt.admin_fee, pt.total_amount,
        pt.virtual_account, pt.qr_payload, pt.payment_code,
        pt.provider_payment_url, pt.expires_at, pt.failed_reason
      FROM payment_transactions pt
      INNER JOIN orders o ON o.id = pt.order_id
      WHERE pt.order_id = ?
      ORDER BY pt.id DESC
      LIMIT 1`,
    )
    .bind(orderId)
    .first<PaymentTransactionRow>();
  return row ? mapPaymentRecord(row) : undefined;
}

/**
 * Records a `failed` transaction row for an order whose payment could not even
 * be attempted (A-170).
 *
 * `createAutoLarisPaymentForOrder` writes its own `failed` row for a provider
 * error, but a D1 fault before that INSERT left the order with no
 * `payment_transactions` row at all — and with no row there is no channel in
 * the public status, so `/payment` never offered the retry and the buyer had
 * no route to an instruction. This gives that path the same handle.
 *
 * Best effort by contract: the order is already committed and must not fail
 * over its own error record. The unique index on `order_id` makes a losing
 * race a silent no-op.
 */
export async function recordFailedPaymentAttempt(
  database: D1Database,
  order: { id: number; orderNumber: string; totalAmount: number },
  channelCode: AutoLarisCheckoutChannel,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await database
      .prepare(
        `INSERT OR IGNORE INTO payment_transactions (
          order_id, provider, reference_id, public_token, channel_code,
          status, amount, admin_fee, total_amount, failed_reason,
          created_at, updated_at
        ) VALUES (?, 'autolaris', ?, ?, ?, 'failed', ?, 0, ?, ?, ?, ?)`,
      )
      .bind(
        order.id,
        autoLarisAttemptReferenceId(order.orderNumber, false),
        crypto.randomUUID(),
        channelCode,
        order.totalAmount,
        order.totalAmount,
        reason.slice(0, 500),
        now,
        now,
      )
      .run();
  } catch (error) {
    console.error("payment-attempt-record-failed", error);
  }
}

/** Retention for provider callback evidence. Long enough to classify a shape, not a log store. */
const CALLBACK_RETENTION_DAYS = 30;

/** Hourly: provider callback evidence older than the retention window is dropped. */
export async function purgeExpiredAutoLarisCallbacks(database: D1Database, now = new Date()) {
  const result = await database
    .prepare(
      `DELETE FROM autolaris_callbacks
        WHERE unixepoch(received_at) < unixepoch(?, '-${CALLBACK_RETENTION_DAYS} days')`,
    )
    .bind(now.toISOString())
    .run();
  return result.meta.changes;
}

type PendingAutoLarisInquiryRow = {
  transaction_id: number;
  order_id: number;
  order_number: string;
  customer_name: string;
  provider_transaction_id: string;
  total_amount: number;
};

export type AutoLarisScheduledReconciliation = {
  checked: number;
  pending: number;
  unproven: number;
  failed: number;
  paidOrderIds: number[];
  /**
   * Reads that carried the provider's success code but a settlement word the
   * allowlist does not recognise. This is not a failure — it is the evidence
   * `UNIMPLEMENTED_SPECS.md` has been waiting for, and it used to be counted as
   * `unproven` beside genuine failures and discarded. Each entry carries the
   * exact word so the allowlist can be revised from observation instead of
   * from a guess.
   */
  unrecognisedPaidStatuses: string[];
};

/**
 * Hourly provider reconciliation through Advice. Only an explicit paid shape
 * moves D1; pending, unknown, and failed reads are observable no-ops. The
 * guarded D1 batch makes concurrent cron executions idempotent.
 */
/**
 * How long after its expiry an instruction is still asked about. A QRIS or VA
 * can be paid in the last minute and settle at the provider after this side
 * has already marked it expired, so a recent expiry is worth one more look;
 * an old one is not — no money arrives on an instruction dead for days.
 */
export const AUTOLARIS_EXPIRED_RECHECK_HOURS = 24;

/**
 * The instructions the hourly Advice run asks about: every one still pending,
 * plus the ones that expired within the recheck window, newest first.
 *
 * It used to take the 25 oldest pending-or-expired rows with no age bound. An
 * instruction nobody paid stays eligible forever, so on a store with 96 of them
 * the window sat on the same August rows every hour and nothing created after
 * 11 September was ever asked about — a QRIS paid after the buyer closed the
 * payment page would never have settled, and its Purchase never reached Meta.
 * Binds: the recheck cutoff (ISO), then the limit.
 */
export const PENDING_AUTOLARIS_INQUIRY_SQL = `SELECT pt.id AS transaction_id, pt.order_id, o.order_number,
        o.customer_name, pt.provider_transaction_id, pt.total_amount
      FROM payment_transactions pt
      INNER JOIN orders o ON o.id = pt.order_id
      WHERE pt.provider = 'autolaris'
        AND (pt.status = 'pending' OR (pt.status = 'expired' AND pt.expires_at >= ?))
        AND o.payment_status IN ('pending', 'unpaid')
        AND o.shipping_status = 'pending'
        AND o.stock_restored_at IS NULL
        AND pt.provider_transaction_id IS NOT NULL
        AND trim(pt.provider_transaction_id) <> ''
      ORDER BY (pt.status = 'pending') DESC, pt.created_at DESC, pt.id DESC
      LIMIT ?`;

/**
 * Superseded instructions (H-1) still inside the recheck window, on orders
 * still waiting for money. Binds: the recheck cutoff (ISO), then the limit.
 */
export const SUPERSEDED_AUTOLARIS_INQUIRY_SQL = `SELECT a.id AS attempt_id, a.payment_transaction_id AS transaction_id,
        pt.order_id, o.order_number, o.customer_name, a.provider_transaction_id, a.total_amount,
        a.reference_id, a.channel_code, a.amount, a.admin_fee, a.expires_at
      FROM payment_transaction_attempts a
      INNER JOIN payment_transactions pt ON pt.id = a.payment_transaction_id
      INNER JOIN orders o ON o.id = pt.order_id
      WHERE a.settled_at IS NULL AND a.expires_at >= ?
        AND pt.provider = 'autolaris' AND pt.status <> 'paid'
        AND o.payment_status IN ('pending', 'unpaid')
        AND o.shipping_status = 'pending'
        AND o.stock_restored_at IS NULL
      ORDER BY a.expires_at DESC, a.id DESC
      LIMIT ?`;

export async function reconcileAutoLarisPaymentStatuses(
  database: D1Database,
  locals: App.Locals,
  now = new Date(),
  limit = 25,
): Promise<AutoLarisScheduledReconciliation> {
  const result: AutoLarisScheduledReconciliation = {
    checked: 0,
    pending: 0,
    unproven: 0,
    failed: 0,
    paidOrderIds: [],
    unrecognisedPaidStatuses: [],
  };
  const config = (await getProviderConfig(database, locals)).autolaris;
  if (!config.apiKey) return result;

  const rows = await database
    .prepare(PENDING_AUTOLARIS_INQUIRY_SQL)
    .bind(
      new Date(now.getTime() - AUTOLARIS_EXPIRED_RECHECK_HOURS * 3_600_000).toISOString(),
      Math.max(1, Math.min(100, Math.trunc(limit))),
    )
    .all<PendingAutoLarisInquiryRow>();
  const cutoff = new Date(now.getTime() - AUTOLARIS_EXPIRED_RECHECK_HOURS * 3_600_000).toISOString();
  const superseded = await database
    .prepare(SUPERSEDED_AUTOLARIS_INQUIRY_SQL)
    .bind(cutoff, Math.max(1, Math.min(100, Math.trunc(limit))))
    .all<PendingAutoLarisInquiryRow & Omit<PaymentTransactionAttempt, "id" | "payment_transaction_id"> & { attempt_id: number }>();
  const client = new AutoLarisClient(config.apiKey, config.baseUrl);
  const paidAt = now.toISOString();

  const queue: Array<PendingAutoLarisInquiryRow & { attempt?: PaymentTransactionAttempt }> = [
    ...(rows.results || []),
    ...(superseded.results || []).map((row) => ({
      ...row,
      attempt: {
        id: row.attempt_id,
        payment_transaction_id: row.transaction_id,
        provider_transaction_id: row.provider_transaction_id,
        reference_id: row.reference_id,
        channel_code: row.channel_code,
        amount: row.amount,
        admin_fee: row.admin_fee,
        total_amount: row.total_amount,
        expires_at: row.expires_at,
      },
    })),
  ];

  for (const row of queue) {
    try {
      const inquiry = await client.inquirePayment(row.provider_transaction_id);
      result.checked += 1;
      if (inquiry.settlement === "pending") {
        result.pending += 1;
        continue;
      }
      if (inquiry.settlement !== "paid") {
        result.unproven += 1;
        // The provider's success code with a word the allowlist does not know.
        // Never settle on it — a guess must not move money — but never discard
        // it either: no settled response has ever been observed, so this read is
        // exactly the capture that closes SCR1, and it was being thrown away.
        if (inquiry.code === AUTOLARIS_PAID_CODE) {
          const observed = inquiry.status || "(kosong)";
          if (!result.unrecognisedPaidStatuses.includes(observed)) {
            result.unrecognisedPaidStatuses.push(observed);
          }
          console.warn("autolaris-paid-code-unknown-status", {
            orderNumber: row.order_number,
            code: inquiry.code,
            status: observed,
          });
        }
        continue;
      }

      // A paid superseded instruction first goes back on its row (H-1); the
      // settle statements below then match it by its own provider id.
      const adopt = row.attempt ? adoptPaymentAttemptStatements(database, row.attempt, paidAt) : [];
      const settled = await database.batch([
        ...adopt,
        database
          .prepare(
            `UPDATE payment_transactions
            SET status = 'paid', paid_at = COALESCE(paid_at, ?),
              failed_reason = NULL, updated_at = ?
            WHERE id = ? AND provider = 'autolaris'
              AND provider_transaction_id = ?
              AND status IN ('pending', 'expired')
              AND EXISTS (
                SELECT 1 FROM orders o
                WHERE o.id = payment_transactions.order_id
                  AND o.payment_status IN ('pending', 'unpaid')
                  AND o.shipping_status = 'pending'
                  AND o.stock_restored_at IS NULL
              )`,
          )
          .bind(
            paidAt,
            paidAt,
            row.transaction_id,
            row.provider_transaction_id,
          ),
        database
          .prepare(
            `UPDATE orders
            SET payment_status = 'paid'
            WHERE id = ? AND payment_status IN ('pending', 'unpaid')
              AND shipping_status = 'pending' AND stock_restored_at IS NULL
              AND EXISTS (
                SELECT 1 FROM payment_transactions pt
                WHERE pt.id = ? AND pt.order_id = orders.id
                  AND pt.provider = 'autolaris' AND pt.status = 'paid'
              )`,
          )
          .bind(row.order_id, row.transaction_id),
        ...(row.attempt ? [markPaymentAttemptSettledStatement(database, row.attempt.id, paidAt)] : []),
      ]);
      if (Number(settled[adopt.length]?.meta?.changes || 0) < 1) continue;

      result.paidOrderIds.push(row.order_id);
      await recordNotification(database, {
        type: "payment",
        orderId: row.order_id,
        orderNumber: row.order_number,
        ...buildPaymentNotification({
          orderNumber: row.order_number,
          customerName: row.customer_name,
          totalAmount: row.total_amount,
        }),
      });
    } catch (error) {
      result.failed += 1;
      console.error("autolaris-advice-failed", {
        transactionId: row.transaction_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export async function createAutoLarisPaymentForOrder(
  database: D1Database,
  locals: App.Locals,
  input: {
    orderId: number;
    channelCode: AutoLarisCheckoutChannel;
  },
): Promise<AutoLarisPaymentRecord> {
  // One order holds one transaction row (unique index). A live or final row
  // is returned as is; a failed or expired one is reused for a fresh provider
  // request rather than left as a dead end — before this, one provider hiccup
  // at checkout left the buyer with no instructions and no way to get any.
  const existing = await loadPaymentRecord(database, input.orderId);
  if (existing && !RETRYABLE_PAYMENT_STATUSES.has(existing.status)) return existing;

  const order = await database
    .prepare(
      `SELECT o.id, o.order_number, o.store_id, o.customer_name,
        o.customer_phone, o.customer_email, o.address, o.province, o.city,
        o.district, o.postal_code, o.total_amount, o.payment_method,
        s.payment_fee_bearer, s.name AS store_name,
        w.name AS warehouse_name, w.contact_name AS warehouse_contact_name,
        w.contact_phone AS warehouse_contact_phone,
        w.address AS warehouse_address, w.city AS warehouse_city,
        w.province AS warehouse_province
      FROM orders o
      INNER JOIN stores s ON s.id = o.store_id
      LEFT JOIN warehouses w ON w.id = o.warehouse_id
        AND w.store_id = o.store_id
      WHERE o.id = ?
      LIMIT 1`,
    )
    .bind(input.orderId)
    .first<PaymentOrderRow>();
  if (!order) throw new Error("Order pembayaran tidak ditemukan.");
  if (!["bank_transfer", "qris"].includes(order.payment_method)) {
    throw new Error("Metode pembayaran order tidak menggunakan AutoLaris.");
  }
  const itemsResult = await database
    .prepare(
      `SELECT oi.quantity, oi.unit_price, pv.weight_grams,
        p.title AS product_title, pv.title AS variant_title
      FROM order_items oi
      INNER JOIN product_variants pv ON pv.id = oi.variant_id
      INNER JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id = ? AND p.store_id = ?
      ORDER BY oi.id`,
    )
    .bind(order.id, order.store_id)
    .all<PaymentOrderItemRow>();
  const items = itemsResult.results || [];
  const siteUrl = locals.tenant?.siteUrl || "https://example.com";
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const createdAt = now.toISOString();
  const publicToken = crypto.randomUUID();
  const feeBearer = normalizePaymentFeeBearer(order.payment_fee_bearer);
  const referenceId = autoLarisAttemptReferenceId(order.order_number, Boolean(existing));
  const requestAmount = calculateAutoLarisRequestAmount(
    input.channelCode,
    order.total_amount,
    feeBearer,
  );
  const expectedAdminFee = calculatePaymentAdminFee(
    input.channelCode,
    requestAmount,
  );
  const expectedBilledTotal = requestAmount + expectedAdminFee;

  if (existing) {
    // The old instruction is kept before the row is rewritten (H-1), and the
    // rewrite only happens while the row is still failed or expired: two
    // simultaneous retries used to each create a provider instruction, and
    // only the last id survived.
    const reused = await database.batch([
      supersedePaymentTransactionStatement(database, existing.id, createdAt),
      database
        .prepare(
          `UPDATE payment_transactions SET
            reference_id = ?, channel_code = ?, fee_bearer = ?, status = 'pending', amount = ?,
            admin_fee = ?, total_amount = ?, provider_transaction_id = NULL,
            virtual_account = NULL, qr_payload = NULL, payment_code = NULL,
            provider_payment_url = NULL, failed_reason = NULL, expires_at = ?,
            updated_at = ?
          WHERE id = ?
            AND (status IN ('failed', 'expired')
              OR (status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?))`,
        )
        .bind(
          referenceId,
          input.channelCode,
          feeBearer,
          requestAmount,
          expectedAdminFee,
          expectedBilledTotal,
          expiresAt.toISOString(),
          createdAt,
          existing.id,
          createdAt,
        ),
    ]);
    if (!Number(reused[1]?.meta?.changes || 0)) {
      throw new Error("Instruksi pembayaran baru sedang dibuat. Muat ulang halaman sebentar lagi.");
    }
  } else {
    try {
      await database
        .prepare(
          `INSERT INTO payment_transactions (
            order_id, provider, reference_id, public_token, channel_code, fee_bearer,
            status, amount, admin_fee, total_amount, expires_at, created_at,
            updated_at
          ) VALUES (?, 'autolaris', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          order.id,
          // What the provider is told, so reconciliation can match either side.
          referenceId,
          publicToken,
          input.channelCode,
          feeBearer,
          requestAmount,
          expectedAdminFee,
          expectedBilledTotal,
          expiresAt.toISOString(),
          createdAt,
          createdAt,
        )
        .run();
    } catch (error) {
      // Two submits raced on the same order: the unique index kept one row.
      // Hand back that row instead of failing the order over the loser.
      const raced = await loadPaymentRecord(database, order.id);
      if (raced) return raced;
      throw error;
    }
  }

  const transaction = await loadPaymentRecord(database, order.id);
  if (!transaction) throw new Error("Catatan pembayaran gagal dibuat.");

  const config = (await getProviderConfig(database, locals)).autolaris;
  if (!config.apiKey) {
    await database
      .prepare(
        `UPDATE payment_transactions
        SET status = 'failed', failed_reason = ?, updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        "AutoLaris belum dikonfigurasi.",
        new Date().toISOString(),
        transaction.id,
      )
      .run();
    const failed = await loadPaymentRecord(database, order.id);
    if (!failed) throw new Error("Catatan pembayaran gagal dimuat ulang.");
    return failed;
  }

  try {
    const env = getRuntimeEnv(locals);
    const customerEmail = buyerEmail(
      order.customer_email,
      order.customer_phone,
      siteUrl,
    );
    const payment: AutoLarisPayment = await new AutoLarisClient(
      config.apiKey,
      config.baseUrl,
    ).createOrder({
      reffId: referenceId,
      channelCode: input.channelCode,
      courirId: 1,
      origin: getEnvValue("AUTOLARIS_ORDER_ORIGIN_ID", env),
      destination: getEnvValue("AUTOLARIS_ORDER_DESTINATION_ID", env),
      weight: Math.max(
        1,
        items.reduce(
          (total, item) =>
            total + Number(item.weight_grams) * Number(item.quantity),
          0,
        ),
      ),
      length: 1,
      width: 1,
      height: 1,
      shipperName:
        order.warehouse_contact_name || order.warehouse_name || order.store_name,
      shipperPhone: order.warehouse_contact_phone || order.customer_phone,
      shipperEmail:
        getEnvValue("AUTOLARIS_SHIPPER_EMAIL", env) || customerEmail,
      shipperAddress: [
        order.warehouse_address,
        order.warehouse_city,
        order.warehouse_province,
      ]
        .filter(Boolean)
        .join(", "),
      receiverName: order.customer_name,
      receiverPhone: order.customer_phone,
      receiverEmail: customerEmail,
      receiverAddress: [
        order.address,
        order.district,
        order.city,
        order.province,
        order.postal_code,
      ]
        .filter(Boolean)
        .join(", "),
      callbackUrl: "",
      grandTotal: order.total_amount,
      codValue: 0,
      remark: order.order_number,
      orderDetails: items.map((item) => ({
        name: [item.product_title, item.variant_title]
          .filter(Boolean)
          .join(" - "),
        qty: Number(item.quantity),
        unitPrice: Number(item.unit_price),
      })),
    });

    if (payment.total !== expectedBilledTotal) {
      // The provider's figure is what the buyer will actually be charged, so
      // it is stored as is — but it is no longer the total shown at checkout,
      // and the fee table in `payment-fee-policy.ts` is what needs updating.
      console.error("autolaris-fee-mismatch", {
        orderNumber: order.order_number,
        channelCode: input.channelCode,
        expected: expectedBilledTotal,
        provider: payment.total,
      });
    }

    await database
      .prepare(
        `UPDATE payment_transactions SET
          provider_transaction_id = ?, status = 'pending', amount = ?,
          admin_fee = ?, total_amount = ?, virtual_account = ?, qr_payload = ?,
          payment_code = ?, provider_payment_url = ?, expires_at = ?, failed_reason = NULL,
          updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        payment.transactionId,
        payment.amount,
        payment.admin,
        payment.total,
        payment.virtualAccount || null,
        payment.qr || null,
        payment.paymentCode || null,
        payment.url || null,
        payment.expiresAt || expiresAt.toISOString(),
        new Date().toISOString(),
        transaction.id,
      )
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await database
      .prepare(
        `UPDATE payment_transactions
        SET status = 'failed', failed_reason = ?, updated_at = ?
        WHERE id = ?`,
      )
      .bind(message.slice(0, 500), new Date().toISOString(), transaction.id)
      .run();
  }

  const updated = await loadPaymentRecord(database, order.id);
  if (!updated) throw new Error("Catatan pembayaran gagal dimuat ulang.");
  return updated;
}
