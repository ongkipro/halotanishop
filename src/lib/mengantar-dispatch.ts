import { getRuntimeEnv } from "./env.ts";
import {
  MengantarClient,
  MengantarOutcomeUnknownError,
  MengantarPosCodIneligibleError,
} from "./mengantar-client.ts";
import {
  buildMengantarOrderPayload,
  mengantarPickupSlot,
  parseMengantarDispatchResponse,
  pickMengantarTimeId,
  resolveAcceptedMengantarShipment,
  type MengantarPickupChoice,
  type MengantarPickupPayload,
  sameMengantarSlot,
} from "./mengantar-order.ts";
import { getProviderConfig } from "./provider-config.ts";
import {
  acceptedShipmentId,
  ACCEPTED_MARKER,
  canDispatchOrderToMengantar,
  DISPATCH_UNKNOWN_PREFIX,
  isDispatchOutcomeUnknown,
  MENGANTAR_DISPATCH_CLAIM_TTL_MS,
} from "./payment-dispatch-policy.ts";

export type MengantarDispatchOutcome = {
  status:
    | "dispatched"
    | "already_dispatched"
    | "in_progress"
    | "waiting_for_confirmation"
    | "waiting_for_payment"
    | "unpaid"
    | "outcome_unknown"
    | "failed";
  providerOrderId?: string;
  cnoteNo?: string;
  error?: string;
};

type DispatchOrderRow = {
  id: number;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  destination_area_id: string | null;
  courier_code: string | null;
  payment_method: "cod" | "bank_transfer" | "qris";
  payment_status: string;
  shipping_status: string;
  total_amount: number;
  provider_order_id: string | null;
  cnote_no: string | null;
  provider_dispatch_error: string | null;
  pickup_address_id: string | null;
  warehouse_id: number | null;
};

/**
 * How a push leaves the warehouse (PRD A46). One per request: a bulk push
 * shares `timeIds`, so each pickup address asks Mengantar for its slot once.
 */
export type MengantarDispatchPickup = {
  choice: MengantarPickupChoice;
  timeIds: Map<string, string>;
};

/**
 * The provider `time_id` for a scheduled pickup at one address: an existing
 * slot for that date and hour (`GET /time`), else a new one (`POST /time`).
 */
async function resolvePickupTimeId(
  client: MengantarClient,
  addressId: string,
  choice: Extract<MengantarPickupChoice, { type: "scheduledPickup" }>,
  timeIds: Map<string, string>,
) {
  const cached = timeIds.get(addressId);
  if (cached) return cached;
  const slot = mengantarPickupSlot(choice.date, choice.hour);
  let timeId = "";
  try {
    const existing = await client.getPickupTimes(addressId);
    const rows = Array.isArray(existing.data) ? existing.data : [];
    timeId = String(rows.find((row) => sameMengantarSlot(row, slot))?._id || "").trim();
  } catch (error) {
    // A failed listing is not a refusal; creating the slot still decides.
    console.error("mengantar-pickup-time-list", error instanceof Error ? error.message : "unknown");
  }
  if (!timeId) {
    const created = await client.schedulePickupTime({ addressId, date: slot.date, time: slot.time });
    timeId = pickMengantarTimeId(created.data, slot);
  }
  if (!timeId) throw new Error("Mengantar tidak mengembalikan jadwal pickup; order tidak dikirim.");
  timeIds.set(addressId, timeId);
  return timeId;
}

/**
 * The local schedule row a picked-up order belongs to, one per warehouse and
 * provider slot, so the shipping page no longer lists it as needing pickup.
 */
async function linkPickupSchedule(
  database: D1Database,
  orderId: number,
  warehouseId: number,
  timeId: string,
  choice: Extract<MengantarPickupChoice, { type: "scheduledPickup" }>,
) {
  const scheduledAt = mengantarPickupSlot(choice.date, choice.hour).scheduledAt;
  await database
    .prepare(
      `INSERT INTO pickup_schedules (warehouse_id, scheduled_at, status, shipment_count, provider_reference, notes, created_at)
      SELECT ?, ?, 'scheduled', 0, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM pickup_schedules WHERE warehouse_id = ? AND provider_reference = ?)`,
    )
    .bind(warehouseId, scheduledAt, timeId, choice.volume === "volumeTruck" ? "Truk" : choice.volume === "volumeMobil" ? "Mobil" : "Motor", new Date().toISOString(), warehouseId, timeId)
    .run();
  await database.batch([
    database
      .prepare(
        `UPDATE orders SET pickup_schedule_id =
          (SELECT id FROM pickup_schedules WHERE warehouse_id = ? AND provider_reference = ? ORDER BY id LIMIT 1)
        WHERE id = ? AND pickup_schedule_id IS NULL`,
      )
      .bind(warehouseId, timeId, orderId),
    database
      .prepare(
        `UPDATE pickup_schedules SET shipment_count =
          (SELECT COUNT(*) FROM orders WHERE pickup_schedule_id = pickup_schedules.id)
        WHERE warehouse_id = ? AND provider_reference = ?`,
      )
      .bind(warehouseId, timeId),
  ]);
}

type DispatchItemRow = {
  quantity: number;
  unit_price: number;
  unit_weight_kg: number;
  variant_title: string;
  product_title: string;
};

const DISPATCH_LEASE_MS = 20_000;
const DISPATCH_WAIT_MS = 30_000;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function acquireMengantarLease(database: D1Database) {
  const token = crypto.randomUUID();
  const deadline = Date.now() + DISPATCH_WAIT_MS;
  let delay = 100;
  while (true) {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + DISPATCH_LEASE_MS).toISOString();
    await database
      .prepare(
        `INSERT OR IGNORE INTO provider_dispatch_locks (
          provider, lease_token, lease_expires_at, updated_at
        ) VALUES ('mengantar', NULL, NULL, ?)`,
      )
      .bind(nowIso)
      .run();
    const claim = await database
      .prepare(
        `UPDATE provider_dispatch_locks
        SET lease_token = ?, lease_expires_at = ?, updated_at = ?
        WHERE provider = 'mengantar'
          AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      )
      .bind(token, expiresAt, nowIso, nowIso)
      .run();
    if (claim.meta?.changes) return token;
    if (Date.now() >= deadline) {
      throw new Error(
        "Antrean Mengantar sedang penuh. Coba ulangi pembuatan resi.",
      );
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 1_000);
  }
}

async function releaseMengantarLease(database: D1Database, token: string) {
  await database
    .prepare(
      `UPDATE provider_dispatch_locks
      SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE provider = 'mengantar' AND lease_token = ?`,
    )
    .bind(new Date().toISOString(), token)
    .run();
}

const UNKNOWN_OUTCOME_MESSAGE =
  "Hasil push ke Mengantar belum pasti (koneksi terputus atau respons tidak terbaca). Cek di dashboard Mengantar sebelum push ulang.";

/**
 * A push whose outcome is unknown (audit 2026-10-31 M-1): Mengantar may have
 * created the shipment. The order is marked and kept out of every push, single
 * or bulk, until an operator checks Mengantar and releases it, instead of
 * reading as a plain failure that the next click would push a second time.
 */
async function recordDispatchUnknown(database: D1Database, orderId: number, detail: string) {
  await database
    .prepare(
      `UPDATE orders
      SET provider_dispatch_error = ?, provider_dispatch_claimed_at = NULL,
        shipping_status = 'pending'
      WHERE id = ? AND provider_order_id IS NULL
        AND shipping_status = 'pending'`,
    )
    .bind(`${DISPATCH_UNKNOWN_PREFIX} ${detail}`.slice(0, 500), orderId)
    .run();
}

/**
 * The operator has checked Mengantar and found no shipment for this order:
 * it may be pushed again. Only a still-unknown, still-unshipped order changes.
 */
export async function releaseUnknownMengantarDispatch(database: D1Database, orderId: number) {
  const result = await database
    .prepare(
      `UPDATE orders SET provider_dispatch_error = NULL
      WHERE id = ? AND provider_order_id IS NULL
        AND provider_dispatch_error LIKE ?
        AND provider_dispatch_error NOT LIKE ?`,
    )
    // A shipment Mengantar accepted is never released: it is linked instead.
    .bind(orderId, `${DISPATCH_UNKNOWN_PREFIX}%`, `${DISPATCH_UNKNOWN_PREFIX} ${ACCEPTED_MARKER}%`)
    .run();
  return Number(result.meta?.changes || 0) > 0;
}

/**
 * Links a shipment Mengantar accepted but this store failed to record (its id
 * is in the unknown-outcome marker) to its order, as the dispatch itself
 * would have: the order moves to `processing` when it is still a pending,
 * live, payable order, and the waybill follows from the next provider sync.
 * Returns the linked id, or null when there was nothing to link.
 */
export async function linkAcceptedMengantarShipment(database: D1Database, orderId: number) {
  const current = await database
    .prepare("SELECT provider_dispatch_error FROM orders WHERE id = ? AND provider_order_id IS NULL")
    .bind(orderId)
    .first<{ provider_dispatch_error: string | null }>();
  const providerOrderId = acceptedShipmentId(current?.provider_dispatch_error);
  if (!providerOrderId) return null;
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE orders SET
        provider_order_id = ?, provider_dispatch_error = NULL, provider_dispatch_claimed_at = NULL,
        provider_dispatched_at = COALESCE(provider_dispatched_at, ?),
        confirmed_at = COALESCE(confirmed_at, ?),
        shipping_status = CASE
          WHEN shipping_status = 'pending' AND stock_restored_at IS NULL
            AND payment_status NOT IN ('cancelled', 'refunded', 'failed')
          THEN 'processing' ELSE shipping_status END
      WHERE id = ? AND provider_order_id IS NULL AND provider_dispatch_error = ?`,
    )
    .bind(providerOrderId, now, now, orderId, current?.provider_dispatch_error ?? "")
    .run();
  return Number(result.meta?.changes || 0) > 0 ? providerOrderId : null;
}

async function recordDispatchError(
  database: D1Database,
  orderId: number,
  error: string,
) {
  await database
    .prepare(
      `UPDATE orders
      SET provider_dispatch_error = ?, provider_dispatch_claimed_at = NULL,
        shipping_status = 'pending'
      WHERE id = ? AND provider_order_id IS NULL
        AND shipping_status = 'pending'`,
    )
    .bind(error.slice(0, 500), orderId)
    .run();
}

// Mengantar will refuse every COD `pos` order until the account's delivered
// rate recovers, so stop offering it at checkout instead of taking orders that
// cannot ship. The operator re-enables it from the expedition settings.
async function disablePosCod(database: D1Database) {
  try {
    await database
      .prepare(
        `UPDATE courier_rules SET is_cod_enabled = 0
        WHERE lower(courier_code) = 'pos' AND is_cod_enabled = 1`,
      )
      .run();
  } catch (error) {
    console.error("mengantar-dispatch-disable-pos-cod", error);
  }
}

export async function dispatchOrderToMengantar(
  database: D1Database,
  locals: App.Locals,
  orderId: number,
  pickup: MengantarDispatchPickup = { choice: { type: "dropOff" }, timeIds: new Map() },
): Promise<MengantarDispatchOutcome> {
  const order = await database
    .prepare(
      `SELECT
        o.id, o.order_number, o.customer_name, o.customer_phone, o.address,
        o.destination_area_id, o.courier_code, o.payment_method, o.payment_status,
        o.shipping_status, o.total_amount, o.provider_order_id, o.cnote_no,
        o.provider_dispatch_error, w.pickup_address_id, o.warehouse_id
      FROM orders o
      LEFT JOIN warehouses w ON w.id = o.warehouse_id
      WHERE o.id = ?
      LIMIT 1`,
    )
    .bind(orderId)
    .first<DispatchOrderRow>();
  if (!order) return { status: "failed", error: "Order tidak ditemukan." };
  if (order.provider_order_id) {
    const unpaid = order.payment_method !== "cod" && !order.cnote_no;
    return {
      status: unpaid ? "unpaid" : "already_dispatched",
      providerOrderId: order.provider_order_id,
      cnoteNo: order.cnote_no || undefined,
      error: unpaid
        ? "Shipment Mengantar sudah dibuat tetapi masih menunggu nomor resi."
        : undefined,
    };
  }
  if (isDispatchOutcomeUnknown(order.provider_dispatch_error)) {
    return { status: "outcome_unknown", error: UNKNOWN_OUTCOME_MESSAGE };
  }
  if (order.shipping_status !== "pending") {
    return {
      status: "waiting_for_confirmation",
      error: "Hanya order menunggu yang dapat dipush ke Mengantar.",
    };
  }
  if (
    !canDispatchOrderToMengantar(
      order.payment_method,
      order.payment_status,
      order.shipping_status,
    )
  ) {
    return {
      status: "waiting_for_payment",
      error: "Pembayaran online belum lunas.",
    };
  }

  const item = await database
    .prepare(
      `SELECT
        oi.quantity, oi.unit_price,
        MAX(0.001, CAST(COALESCE(oi.weight_grams, pv.weight_grams) AS REAL) / 1000) AS unit_weight_kg,
        pv.title AS variant_title, p.title AS product_title
      FROM order_items oi
      INNER JOIN product_variants pv ON pv.id = oi.variant_id
      INNER JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.id
      LIMIT 1`,
    )
    .bind(order.id)
    .first<DispatchItemRow>();
  if (!item) {
    const error = "Item order untuk dispatch Mengantar tidak ditemukan.";
    await recordDispatchError(database, order.id, error);
    return { status: "failed", error };
  }

  const pickupAddressId = String(
    order.pickup_address_id ||
      getRuntimeEnv(locals)?.MENGANTAR_PICKUP_ADDRESS_ID ||
      "",
  ).trim();
  const destinationAreaId = order.destination_area_id?.trim() || "";
  const courierCode = order.courier_code?.trim() || "";
  const config = (await getProviderConfig(database, locals)).mengantar;
  if (
    !config.apiKey ||
    !pickupAddressId ||
    !destinationAreaId ||
    !courierCode
  ) {
    const error =
      "Kredensial Mengantar, pickup gudang, tujuan, atau kurir belum lengkap.";
    await recordDispatchError(database, order.id, error);
    return { status: "failed", error };
  }

  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(
    Date.now() - MENGANTAR_DISPATCH_CLAIM_TTL_MS,
  ).toISOString();
  const claim = await database
    .prepare(
      `UPDATE orders
      SET provider_dispatch_error = 'DISPATCHING', provider_dispatch_claimed_at = ?
      WHERE id = ? AND provider_order_id IS NULL
        AND (payment_method = 'cod' OR payment_status IN ('paid', 'settled', 'success'))
        AND stock_restored_at IS NULL
        AND payment_status NOT IN ('cancelled', 'refunded', 'failed')
        AND shipping_status = 'pending'
        AND COALESCE(provider_dispatch_error, '') NOT LIKE ?
        AND (
          COALESCE(provider_dispatch_error, '') <> 'DISPATCHING'
          OR provider_dispatch_claimed_at IS NULL
          OR provider_dispatch_claimed_at <= ?
        )`,
    )
    .bind(claimedAt, order.id, `${DISPATCH_UNKNOWN_PREFIX}%`, staleBefore)
    .run();
  if (!claim.meta?.changes) {
    const current = await database
      .prepare(
        "SELECT provider_order_id, cnote_no FROM orders WHERE id = ? LIMIT 1",
      )
      .bind(order.id)
      .first<{ provider_order_id: string | null; cnote_no: string | null }>();
    return current?.provider_order_id
      ? {
          status:
            order.payment_method !== "cod" && !current.cnote_no
              ? "unpaid"
              : "already_dispatched",
          providerOrderId: current.provider_order_id,
          cnoteNo: current.cnote_no || undefined,
          error:
            order.payment_method !== "cod" && !current.cnote_no
              ? "Shipment Mengantar sudah dibuat tetapi masih menunggu nomor resi."
              : undefined,
        }
      : {
          status: "in_progress",
          error: "Order sedang diproses oleh Mengantar.",
        };
  }

  let leaseToken = "";
  let pickupPayload: MengantarPickupPayload = { type: "dropOff" };
  // From the moment POST /order leaves, a shipment may exist at Mengantar.
  let shipmentRequested = false;
  // Once its answer is read, the shipment certainly exists: a local failure
  // after that point must never let the order be pushed a second time.
  let shipmentAccepted = "";
  try {
    leaseToken = await acquireMengantarLease(database);
    const client = new MengantarClient(config.apiKey, config.baseUrl);
    if (pickup.choice.type === "scheduledPickup") {
      pickupPayload = {
        type: "scheduledPickup",
        volume: pickup.choice.volume,
        timeId: await resolvePickupTimeId(client, pickupAddressId, pickup.choice, pickup.timeIds),
      };
    }
    const payload = buildMengantarOrderPayload({
      orderNumber: order.order_number,
      courierCode,
      pickupAddressId,
      destinationAreaId,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      customerAddress: order.address,
      productTitle: item.product_title,
      variantTitle: item.variant_title,
      unitWeightKg: Number(item.unit_weight_kg),
      quantity: Number(item.quantity),
      paymentMethod: order.payment_method,
      goodsAmount: Number(item.unit_price) * Number(item.quantity),
      collectedAmount: Number(order.total_amount),
      pickup: pickupPayload,
    });
    shipmentRequested = true;
    const response = await client.createShipment(payload);
    let dispatched;
    try {
      dispatched = parseMengantarDispatchResponse(response);
    } catch (error) {
      // A success response without a readable shipment id: it may well exist.
      throw new MengantarOutcomeUnknownError(error instanceof Error ? error.message : String(error));
    }
    shipmentAccepted = dispatched.providerOrderId;
    const acceptedAt = new Date().toISOString();
    const accepted = resolveAcceptedMengantarShipment(
      order.payment_method,
      dispatched,
      acceptedAt,
    );
    const persistence = await database
      .prepare(
        `UPDATE orders SET
          provider_order_id = ?, provider_batch_id = ?, cnote_no = ?,
          provider_dispatch_error = ?, provider_dispatch_claimed_at = NULL,
          provider_dispatched_at = ?, shipping_status = ?,
          confirmed_at = COALESCE(confirmed_at, ?), mengantar_handover = ?
        WHERE id = ? AND provider_order_id IS NULL
          AND provider_dispatch_claimed_at = ?
          AND shipping_status = 'pending'
          AND (payment_method = 'cod' OR payment_status IN ('paid', 'settled', 'success'))
        AND stock_restored_at IS NULL
        AND payment_status NOT IN ('cancelled', 'refunded', 'failed')
          AND payment_method = ? AND payment_status = ?
          AND customer_name = ? AND customer_phone = ? AND address = ?
          AND destination_area_id = ? AND courier_code = ?
          AND total_amount = ?`,
      )
      .bind(
        accepted.providerOrderId,
        accepted.providerBatchId,
        accepted.cnoteNo,
        accepted.providerDispatchError,
        accepted.providerDispatchedAt,
        accepted.shippingStatus,
        acceptedAt,
        pickupPayload.type === "scheduledPickup" ? "pickup" : "drop_off",
        order.id,
        claimedAt,
        order.payment_method,
        order.payment_status,
        order.customer_name,
        order.customer_phone,
        order.address,
        destinationAreaId,
        courierCode,
        order.total_amount,
      )
      .run();
    if (!persistence.meta?.changes) {
      const conflictMessage =
        "Mengantar menerima shipment, tetapi order berubah saat dispatch. Periksa shipment provider sebelum tindakan berikutnya.";
      const conflict = await database
        .prepare(
          `UPDATE orders SET
            provider_order_id = ?, provider_batch_id = ?, cnote_no = ?,
            provider_dispatch_error = ?, provider_dispatch_claimed_at = NULL,
            provider_dispatched_at = ?
          WHERE id = ? AND provider_order_id IS NULL
            AND provider_dispatch_claimed_at = ?`,
        )
        .bind(
          accepted.providerOrderId,
          accepted.providerBatchId,
          accepted.cnoteNo,
          conflictMessage,
          accepted.providerDispatchedAt,
          order.id,
          claimedAt,
        )
        .run();
      if (conflict.meta?.changes) {
        return {
          status: "failed",
          providerOrderId: accepted.providerOrderId,
          cnoteNo: accepted.cnoteNo || undefined,
          error: conflictMessage,
        };
      }

      const current = await database
        .prepare(
          `SELECT provider_order_id, cnote_no
          FROM orders
          WHERE id = ?
          LIMIT 1`,
        )
        .bind(order.id)
        .first<{ provider_order_id: string | null; cnote_no: string | null }>();
      if (current?.provider_order_id) {
        return {
          status:
            order.payment_method !== "cod" && !current.cnote_no
              ? "unpaid"
              : "already_dispatched",
          providerOrderId: current.provider_order_id,
          cnoteNo: current.cnote_no || undefined,
        };
      }
      throw new Error(`${conflictMessage} (${accepted.providerOrderId})`);
    }
    if (pickupPayload.type === "scheduledPickup" && pickup.choice.type === "scheduledPickup" && order.warehouse_id) {
      // The shipment is the provider's now; a failed local link only leaves
      // it listed as needing pickup on the shipping page.
      try {
        await linkPickupSchedule(database, order.id, order.warehouse_id, pickupPayload.timeId, pickup.choice);
      } catch (error) {
        console.error("mengantar-pickup-link", error instanceof Error ? error.message : "unknown");
      }
    }
    return {
      status: accepted.outcome,
      providerOrderId: accepted.providerOrderId,
      cnoteNo: accepted.cnoteNo || undefined,
      error:
        accepted.outcome === "unpaid"
          ? "Saldo wallet Mengantar tidak cukup; top up diperlukan sebelum resi tersedia."
          : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shipmentAccepted || (shipmentRequested && error instanceof MengantarOutcomeUnknownError)) {
      await recordDispatchUnknown(
        database,
        order.id,
        shipmentAccepted ? `${ACCEPTED_MARKER} ${shipmentAccepted}: ${message}` : message,
      );
      return { status: "outcome_unknown", error: UNKNOWN_OUTCOME_MESSAGE };
    }
    if (error instanceof MengantarPosCodIneligibleError) {
      await disablePosCod(database);
    }
    await recordDispatchError(database, order.id, message);
    return { status: "failed", error: message };
  } finally {
    if (leaseToken) {
      try {
        await releaseMengantarLease(database, leaseToken);
      } catch (error) {
        console.error("mengantar-dispatch-lease-release", error);
      }
    }
  }
}
