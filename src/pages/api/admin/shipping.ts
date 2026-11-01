import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../lib/api";
import { getRuntimeEnv } from "../../../lib/env";
import { matchesShippingQueue } from "../../../lib/shipping-queue";
import {
  mapMengantarStatusEvidence,
  MengantarClient,
  selectProviderShippingAdvance,
} from "../../../lib/mengantar-client";
import { pickMengantarTimeId, resolveMengantarPickupSlot } from "../../../lib/mengantar-order";
import { getMengantarDispatchEligibility } from "../../../lib/payment-dispatch-policy";
import { getProviderConfig } from "../../../lib/provider-config";
import {
  ADMIN_SHIPPING_STATUSES,
  applyOrderLifecycleMutation,
  OrderLifecycleError,
} from "../../../lib/order-lifecycle";
import type { AdminShippingStatus } from "../../../lib/order-lifecycle";
import {
  ADMIN_CUSTOM_DATE_FILTER,
  isAdminDateFilter,
  parseAdminDateSelection,
} from "../../../lib/admin-date-filter";

export const prerender = false;


type ShippingMutation =
  | { action: "update-status"; orderId?: number; status?: string }
  | { action: "sync-provider"; orderIds?: number[] }
  | {
      action: "schedule-pickup";
      warehouseId?: number;
      scheduledAt?: string;
      orderIds?: number[];
      notes?: string;
    };

type ShippingOrderRow = {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  city: string;
  province: string;
  totalAmount: number;
  shippingCost: number;
  paymentMethod: string;
  paymentStatus: string;
  shippingStatus: string;
  courierCode: string | null;
  courierService: string | null;
  cnoteNo: string | null;
  providerOrderId: string | null;
  providerDispatchError: string | null;
  providerStatusText: string | null;
  providerStatusAt: string | null;
  providerSyncedAt: string | null;
  destinationAreaId: string | null;
  pickupAddressId: string | null;
  receiverDeliveryRate: number | null;
  receiverRiskLabel: string | null;
  pickupScheduleId: number | null;
  handover: string | null;
  createdAt: string;
  warehouseName: string;
  pickupScheduledAt: string | null;
  pickupStatus: string | null;
};

type OrderStatusCheckRow = {
  id: number;
  payment_method: string;
  payment_status: string;
  shipping_status: string;
  courier_code: string | null;
  cnote_no: string | null;
  provider_order_id: string | null;
  stock_restored_at: string | null;
};

type ProviderSyncOrderRow = OrderStatusCheckRow & {
  order_number: string;
};

type ProviderSyncResult = {
  orderId: number;
  orderNumber: string;
  localStatus: string;
  providerStatus: string | null;
  error: string | null;
};

export const GET: APIRoute = async ({ locals, url }) => {
  const dateFilter = String(url.searchParams.get("date_filter") || "all")
    .trim()
    .toLowerCase();
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database pengiriman belum tersedia.", 503);
  }
  if (dateFilter !== ADMIN_CUSTOM_DATE_FILTER && !isAdminDateFilter(dateFilter)) {
    return jsonError("Filter periode order tidak valid.", 400);
  }

  const shipmentLimit = Math.min(
    Math.max(
      Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200,
      1,
    ),
    500,
  );

  try {
    const db = database as D1Database;
    let dateClause = " WHERE o.shipping_status IN ('processing', 'shipped', 'delivered', 'returned') AND o.provider_order_id IS NOT NULL ";
    const dateParams: string[] = [];
    if (dateFilter !== "all") {
      // Refuses an unresolvable period instead of answering for a different
      // one; see the same note in the order list route.
      const { resolution } = parseAdminDateSelection(url.searchParams);
      if (!resolution.ok) {
        return jsonError(resolution.reason, 422, { code: "DATE_RANGE_INVALID" });
      }
      dateClause += " AND date(o.created_at, '+7 hours') BETWEEN ? AND ? ";
      dateParams.push(resolution.start, resolution.end);
    }

    const [shipmentResult, pickupResult, warehouseResult] = await db.batch([
      db
        .prepare(
          `
        SELECT
          o.id,
          o.order_number AS orderNumber,
          o.customer_name AS customerName,
          o.customer_phone AS customerPhone,
          o.city,
          o.province,
          o.total_amount AS totalAmount,
          o.shipping_cost AS shippingCost,
          o.payment_method AS paymentMethod,
          o.payment_status AS paymentStatus,
          o.shipping_status AS shippingStatus,
          o.courier_code AS courierCode,
          o.courier_service AS courierService,
          o.cnote_no AS cnoteNo,
          o.provider_order_id AS providerOrderId,
          o.provider_dispatch_error AS providerDispatchError,
          o.provider_status_text AS providerStatusText,
          o.provider_status_at AS providerStatusAt,
          o.provider_synced_at AS providerSyncedAt,
          o.destination_area_id AS destinationAreaId,
          o.receiver_rts_score AS receiverDeliveryRate,
          o.rts_risk_label AS receiverRiskLabel,
          o.pickup_schedule_id AS pickupScheduleId,
          o.mengantar_handover AS handover,
          o.created_at AS createdAt,
          w.name AS warehouseName,
          ps.scheduled_at AS pickupScheduledAt,
          w.pickup_address_id AS pickupAddressId,
          ps.status AS pickupStatus
        FROM orders o
        LEFT JOIN pickup_schedules ps ON o.pickup_schedule_id = ps.id
        LEFT JOIN warehouses w ON o.warehouse_id = w.id
        ${dateClause}
        ORDER BY o.id DESC
        LIMIT ?
      `,
        )
        .bind(...dateParams, shipmentLimit),
      db.prepare(`
        SELECT
          ps.id,
          ps.scheduled_at AS scheduledAt,
          ps.status,
          ps.shipment_count AS shipmentCount,
          ps.provider_reference AS providerReference,
          ps.notes,
          w.name AS warehouseName
        FROM pickup_schedules ps
        JOIN warehouses w ON w.id = ps.warehouse_id
        ORDER BY ps.id DESC
        LIMIT 50
      `),
      db.prepare("SELECT id, name FROM warehouses ORDER BY id ASC LIMIT 10"),
    ]);

    const shipments = ((shipmentResult.results ?? []) as ShippingOrderRow[]).map(
      (shipment) => {
        const dispatch = getMengantarDispatchEligibility({
          paymentMethod: shipment.paymentMethod,
          paymentStatus: shipment.paymentStatus,
          shippingStatus: shipment.shippingStatus,
          providerOrderId: shipment.providerOrderId,
          providerDispatchError: shipment.providerDispatchError,
          destinationAreaId: shipment.destinationAreaId,
          courierCode: shipment.courierCode,
          pickupAddressId: shipment.pickupAddressId,
        });
        return {
          ...shipment,
          dispatchEligible: dispatch.eligible,
          dispatchReason: dispatch.reason,
        };
      },
    );
    const pickups = pickupResult.results ?? [];
    const warehouses = warehouseResult.results ?? [];

    const readyPickupIds = shipments
      .filter((shipment) => matchesShippingQueue(shipment, "needs_pickup"))
      .map((shipment) => shipment.id);
    const dispatchableIds = shipments
      .filter((shipment) => shipment.dispatchEligible)
      .map((shipment) => shipment.id);

    return jsonOk({
      data: { shipments, pickups, warehouses, readyPickupIds, dispatchableIds },
    });
  } catch (error) {
    console.error("admin-shipping-get", error);
    return jsonError("Gagal memuat operasi pengiriman.", 500);
  }
};

export const PATCH: APIRoute = async ({ locals, request }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database pengiriman belum tersedia.", 503);
  }

  const body = (await request
    .json()
    .catch(() => null)) as ShippingMutation | null;
  if (!body) {
    return jsonError("Payload tidak valid.", 400);
  }

  try {
    const db = database as D1Database;

    if (body.action === "sync-provider") {
      let requestedIds: number[] | null = null;
      if (body.orderIds !== undefined) {
        if (
          !Array.isArray(body.orderIds) ||
          body.orderIds.some(
            (orderId) =>
              typeof orderId !== "number" ||
              !Number.isInteger(orderId) ||
              orderId <= 0,
          )
        ) {
          return jsonError("ID pengiriman tidak valid.", 400);
        }
        requestedIds = Array.from(new Set(body.orderIds));
        if (requestedIds.length === 0 || requestedIds.length > 50) {
          return jsonError(
            "Pilih 1 sampai 50 pengiriman untuk disinkronkan.",
            400,
          );
        }
      }

      const selected = requestedIds
        ? await db
            .prepare(
              `SELECT id, order_number, payment_method, payment_status,
                shipping_status, courier_code, cnote_no, provider_order_id,
                stock_restored_at
              FROM orders
              WHERE id IN (${requestedIds.map(() => "?").join(", ")})
              ORDER BY id ASC`,
            )
            .bind(...requestedIds)
            .all<ProviderSyncOrderRow>()
        : await db
            .prepare(
              `SELECT id, order_number, payment_method, payment_status,
                shipping_status, courier_code, cnote_no, provider_order_id,
                stock_restored_at
              FROM orders
              WHERE provider_order_id IS NOT NULL
                AND cnote_no IS NOT NULL
                AND shipping_status IN ('processing', 'shipped')
              ORDER BY id ASC
              LIMIT 50`,
            )
            .all<ProviderSyncOrderRow>();
      const rows = selected.results ?? [];
      const rowsById = new Map(rows.map((row) => [Number(row.id), row]));
      const queue = requestedIds
        ? requestedIds.map((orderId) => ({
            orderId,
            row: rowsById.get(orderId) || null,
          }))
        : rows.map((row) => ({ orderId: Number(row.id), row }));
      const syncedAt = new Date().toISOString();
      const results: ProviderSyncResult[] = [];
      let synced = 0;
      let updated = 0;
      let unchanged = 0;
      let failed = 0;

      if (queue.length === 0) {
        return jsonOk({
          data: {
            synced,
            updated,
            unchanged,
            failed,
            syncedAt,
            results,
          },
        });
      }

      const needsProvider = queue.some(
        ({ row }) => Boolean(row?.provider_order_id && row.cnote_no),
      );
      let client: MengantarClient | null = null;
      if (needsProvider) {
        const provider = (await getProviderConfig(db, locals)).mengantar;
        if (!provider.apiKey) {
          return jsonError("Mengantar belum dikonfigurasi.", 409);
        }
        client = new MengantarClient(provider.apiKey, provider.baseUrl);
      }

      for (const item of queue) {
        const row = item.row;
        if (!row) {
          failed += 1;
          results.push({
            orderId: item.orderId,
            orderNumber: "",
            localStatus: "",
            providerStatus: null,
            error: "Order tidak ditemukan.",
          });
          continue;
        }
        if (!row.provider_order_id) {
          failed += 1;
          results.push({
            orderId: row.id,
            orderNumber: row.order_number,
            localStatus: row.shipping_status,
            providerStatus: null,
            error: "Shipment Mengantar belum dibuat.",
          });
          continue;
        }
        if (!row.cnote_no) {
          failed += 1;
          results.push({
            orderId: row.id,
            orderNumber: row.order_number,
            localStatus: row.shipping_status,
            providerStatus: null,
            error: "Nomor resi Mengantar belum tersedia.",
          });
          continue;
        }

        let providerStatus: string | null = null;
        let localStatus = row.shipping_status;
        try {
          const tracking = await client!.getOrderByTrackingId(row.cnote_no);
          const evidence = mapMengantarStatusEvidence(tracking);
          providerStatus = evidence.description;
          const observation = await db
            .prepare(
              `UPDATE orders
              SET provider_status_text = ?, provider_status_at = ?,
                provider_synced_at = ?
              WHERE id = ?`,
            )
            .bind(
              evidence.description,
              evidence.occurredAt,
              syncedAt,
              row.id,
            )
            .run();
          if (!observation.meta?.changes) {
            throw new Error("Observasi status provider gagal disimpan.");
          }
          synced += 1;

          const nextStatus = selectProviderShippingAdvance(
            row.shipping_status,
            evidence.shippingStatus,
          );
          if (!nextStatus) {
            unchanged += 1;
          } else {
            const transition = await applyOrderLifecycleMutation(
              db,
              row,
              { shippingStatus: nextStatus },
              db
                .prepare(
                  `UPDATE orders
                  SET shipping_status = ?
                  WHERE id = ? AND shipping_status = ?`,
                )
                .bind(nextStatus, row.id, row.shipping_status),
            );
            if (transition.updated) {
              updated += 1;
              localStatus = nextStatus;
            } else {
              const current = await db
                .prepare(
                  "SELECT shipping_status FROM orders WHERE id = ? LIMIT 1",
                )
                .bind(row.id)
                .first<{ shipping_status: string }>();
              localStatus = current?.shipping_status || row.shipping_status;
              unchanged += 1;
            }
          }

          results.push({
            orderId: row.id,
            orderNumber: row.order_number,
            localStatus,
            providerStatus,
            error: null,
          });
        } catch (error) {
          failed += 1;
          results.push({
            orderId: row.id,
            orderNumber: row.order_number,
            localStatus,
            providerStatus,
            error:
              error instanceof Error
                ? error.message
                : "Gagal menyinkronkan status Mengantar.",
          });
        }
      }

      return jsonOk({
        data: {
          synced,
          updated,
          unchanged,
          failed,
          syncedAt,
          results,
        },
      });
    }

    if (body.action === "update-status") {
      const orderId = Number(body.orderId);
      const nextStatus =
        typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
      if (
        !Number.isInteger(orderId) ||
        !ADMIN_SHIPPING_STATUSES.includes(nextStatus as AdminShippingStatus)
      ) {
        return jsonError("Status atau order tidak valid.", 400);
      }

      const current = (await db
        .prepare(
          `
        SELECT id, payment_method, payment_status, shipping_status, courier_code,
          cnote_no, provider_order_id, stock_restored_at
        FROM orders
        WHERE id = ?
        LIMIT 1
      `,
        )
        .bind(orderId)
        .first()) as OrderStatusCheckRow | null;
      if (!current) {
        return jsonError("Order tidak ditemukan.", 404);
      }
      if (!current.provider_order_id) {
        return jsonError(
          "Shipment Mengantar belum dibuat untuk order ini.",
          409,
        );
      }

      const result = await applyOrderLifecycleMutation(
        db,
        current,
        { shippingStatus: nextStatus },
        // Bound to the status the transition was validated against, so a
        // provider sync landing in between cannot be silently overwritten.
        db
          .prepare(
            "UPDATE orders SET shipping_status = ? WHERE id = ? AND shipping_status = ?",
          )
          .bind(nextStatus, orderId, current.shipping_status),
      );
      if (!result.updated) {
        return jsonError(
          "Status order berubah saat diproses. Muat ulang lalu coba lagi.",
          409,
        );
      }
      return jsonOk({ message: "Status pengiriman diperbarui." });
    }

    return jsonError("Aksi PATCH tidak dikenal.", 400);
  } catch (error) {
    if (error instanceof OrderLifecycleError) {
      return jsonError(error.message, error.status);
    }
    console.error("shipping-update", error);
    return jsonError("Gagal memperbarui data pengiriman.", 500);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  if (!database || typeof database !== "object") {
    return jsonError("Database pengiriman belum tersedia.", 503);
  }

  const body = (await request
    .json()
    .catch(() => null)) as ShippingMutation | null;
  if (!body) {
    return jsonError("Aksi pengiriman tidak valid.", 400);
  }
  if (body.action !== "schedule-pickup") {
    return jsonError("Aksi pickup tidak valid.", 400);
  }

  const warehouseId = Number(body.warehouseId);
  const orderIds = Array.from(
    new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(Number)),
  ).filter((orderId) => Number.isInteger(orderId) && orderId > 0);
  let pickupSlot;
  try {
    pickupSlot = resolveMengantarPickupSlot(body.scheduledAt || "");
  } catch {
    return jsonError("Jadwal pickup tidak valid.", 400);
  }
  const minimumPickupTime = Date.now() + 90 * 60 * 1000;

  if (
    !Number.isInteger(warehouseId) ||
    new Date(pickupSlot.scheduledAt).getTime() < minimumPickupTime
  ) {
    return jsonError(
      "Jam pickup 09.00–18.00 WIB, minimal 90 menit dari sekarang.",
      400,
    );
  }
  if (orderIds.length === 0 || orderIds.length > 100) {
    return jsonError("Pilih 1 sampai 100 pengiriman siap pickup.", 400);
  }

  try {
    const db = database as D1Database;
    const warehouse = await db
      .prepare(
        `
      SELECT id, pickup_address_id
      FROM warehouses
      WHERE id = ?
      LIMIT 1
    `,
      )
      .bind(warehouseId)
      .first<{ id: number; pickup_address_id: string | null }>();
    if (!warehouse?.pickup_address_id) {
      return jsonError("Pickup address gudang belum dikonfigurasi.", 409);
    }

    const placeholders = orderIds.map(() => "?").join(", ");
    const eligibleResult = await db
      .prepare(
        `
      SELECT id
      FROM orders
      WHERE warehouse_id = ?
        AND id IN (${placeholders})
        AND shipping_status = 'processing'
        AND cnote_no IS NOT NULL
        AND pickup_schedule_id IS NULL
        AND mengantar_handover IS NOT 'drop_off'
    `,
      )
      .bind(warehouseId, ...orderIds)
      .all();
    const eligibleIds = (eligibleResult.results ?? []).map((row) =>
      Number((row as { id: number }).id),
    );
    if (eligibleIds.length !== orderIds.length) {
      return jsonError(
        "Sebagian order bukan milik gudang terpilih, sudah dijadwalkan, dikirim lewat drop-off, atau belum memiliki resi.",
        409,
      );
    }

    const provider = (await getProviderConfig(db, locals)).mengantar;
    if (!provider.apiKey) {
      return jsonError(
        "Mengantar belum dikonfigurasi; jadwal lokal tidak dibuat.",
        409,
      );
    }
    let providerReference = "";
    try {
      const providerSchedule = await new MengantarClient(
        provider.apiKey,
        provider.baseUrl,
      ).schedulePickupTime({
        addressId: warehouse.pickup_address_id,
        date: pickupSlot.date,
        time: pickupSlot.time,
      });
      providerReference = pickMengantarTimeId(providerSchedule.data, pickupSlot);
      if (!providerReference) {
        return jsonError(
          "Mengantar tidak mengembalikan referensi jadwal; D1 tidak diubah.",
          502,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Sinkronisasi jadwal Mengantar gagal.";
      return jsonError(
        `${message} D1 tidak diubah.`,
        message.includes("timeout") ? 504 : 502,
      );
    }

    const pickupId = Date.now();
    const reference = providerReference;
    const now = new Date().toISOString();
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    const eligiblePlaceholders = eligibleIds.map(() => "?").join(", ");

    await db.batch([
      db
        .prepare(
          `
        INSERT INTO pickup_schedules (
          id, warehouse_id, scheduled_at, status, shipment_count, provider_reference, notes, created_at
        ) VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?)
      `,
        )
        .bind(
          pickupId,
          warehouseId,
          pickupSlot.scheduledAt,
          eligibleIds.length,
          reference,
          notes || null,
          now,
        ),
      db
        .prepare(
          `
        UPDATE orders
        SET pickup_schedule_id = ?
        WHERE id IN (${eligiblePlaceholders})
      `,
        )
        .bind(pickupId, ...eligibleIds),
    ]);

    return jsonOk(
      {
        message: `${eligibleIds.length} pengiriman berhasil dijadwalkan pickup.`,
        data: { pickupId, reference },
      },
      201,
    );
  } catch (error) {
    console.error("shipping-pickup", error);
    return jsonError("Gagal menyimpan jadwal pickup.", 500);
  }
};
