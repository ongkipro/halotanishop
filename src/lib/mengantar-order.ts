export type MengantarOrderPayloadInput = {
  orderNumber: string;
  courierCode: string;
  pickupAddressId: string;
  destinationAreaId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  productTitle: string;
  variantTitle: string;
  unitWeightKg: number;
  quantity: number;
  paymentMethod: "cod" | "bank_transfer" | "qris";
  goodsAmount: number;
  collectedAmount: number;
  /** Drop-off unless a scheduled pickup with its provider slot and vehicle. */
  pickup?: MengantarPickupPayload;
};

/**
 * How the parcel leaves the warehouse (Mengantar docs, `POST /order`
 * `pickup`): `dropOff` (taken to a courier counter) or `scheduledPickup`,
 * which needs the slot's `time_id` from `/time` and a vehicle `volume`.
 * PRD A46. The server-side spelling of `scheduledPickup` is still marked
 * [verifikasi] in the Mengantar documentation repository.
 */
export type MengantarPickupPayload =
  | { type: "dropOff" }
  | { type: "scheduledPickup"; timeId: string; volume: MengantarPickupVolume };

export const MENGANTAR_PICKUP_VOLUMES = ["volumeMotor", "volumeMobil", "volumeTruck"] as const;
export type MengantarPickupVolume = (typeof MENGANTAR_PICKUP_VOLUMES)[number];
/** Provider slots: one hour each, 9:00 to 18:00 WIB (`POST /time` `time`). */
export const MENGANTAR_PICKUP_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const;
/** A slot must start at least this long from now; the provider refuses sooner. */
export const MENGANTAR_PICKUP_LEAD_MS = 90 * 60 * 1000;

export type MengantarPickupChoice =
  | { type: "dropOff" }
  | { type: "scheduledPickup"; date: string; hour: number; volume: MengantarPickupVolume };

/** One provider slot: `date` mm-dd-yyyy and `time` "13:00", from a Jakarta date and hour. */
export function mengantarPickupSlot(date: string, hour: number) {
  const [year, month, day] = date.split("-");
  return {
    date: `${month}-${day}-${year}`,
    time: `${hour}:00`,
    scheduledAt: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`).toISOString(),
  };
}

/** The Jakarta calendar date of an instant, `YYYY-MM-DD`. */
export function jakartaDate(instant: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** The provider hours still bookable on a Jakarta date (start ≥ now + 90 minutes). */
export function availablePickupHours(date: string, now = Date.now()) {
  // An empty or malformed date has no hours; building a slot from it throws.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+07:00`))) return [];
  return MENGANTAR_PICKUP_HOURS.filter(
    (hour) => new Date(mengantarPickupSlot(date, hour).scheduledAt).getTime() >= now + MENGANTAR_PICKUP_LEAD_MS,
  );
}

/** The earliest bookable slot: today if an hour is left, else tomorrow 9:00. */
export function defaultPickupSlot(now = Date.now()) {
  const today = jakartaDate(now);
  const hours = availablePickupHours(today, now);
  if (hours.length) return { date: today, hour: hours[0] as number };
  return { date: jakartaDate(now + 24 * 60 * 60 * 1000), hour: MENGANTAR_PICKUP_HOURS[0] as number };
}

/**
 * The pickup dates offered in the dropdown: from the earliest bookable day,
 * `count` days, labelled "Hari ini, 31 Okt" / "Besok, 1 Nov" / "Sen, 2 Nov" (short
 * enough for a half-width dropdown on a phone).
 */
export function pickupDayOptions(now = Date.now(), count = 7) {
  const first = defaultPickupSlot(now).date;
  const today = jakartaDate(now);
  const tomorrow = jakartaDate(now + 24 * 60 * 60 * 1000);
  const label = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short" });
  const dayMonth = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" });
  return Array.from({ length: count }, (_, index) => {
    const instant = new Date(`${first}T12:00:00+07:00`).getTime() + index * 24 * 60 * 60 * 1000;
    const value = jakartaDate(instant);
    return {
      value,
      label: value === today ? `Hari ini, ${dayMonth.format(instant)}` : value === tomorrow ? `Besok, ${dayMonth.format(instant)}` : label.format(instant),
    };
  });
}

/**
 * The operator's choice from the push dialog. Absent means drop-off, the
 * behaviour before this choice existed. A pickup needs a real Jakarta date,
 * a provider hour, a vehicle, and a start at least 90 minutes away.
 */
export function parseMengantarPickupChoice(
  value: unknown,
  now = Date.now(),
): { ok: true; choice: MengantarPickupChoice } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, choice: { type: "dropOff" } };
  const input = value as Record<string, unknown>;
  if (input.type === "dropOff") return { ok: true, choice: { type: "dropOff" } };
  if (input.type !== "scheduledPickup") return { ok: false, reason: "Pilih drop-off atau pickup." };
  const date = String(input.date || "");
  const hour = Number(input.hour);
  const volume = String(input.volume || "volumeMotor");
  const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00+07:00`).getTime())
    && new Date(`${date}T12:00:00+07:00`).toISOString().slice(0, 10) === date;
  if (!real) return { ok: false, reason: "Tanggal pickup tidak valid." };
  if (!(MENGANTAR_PICKUP_HOURS as readonly number[]).includes(hour)) {
    return { ok: false, reason: "Jam pickup harus 09.00–18.00 WIB." };
  }
  if (!(MENGANTAR_PICKUP_VOLUMES as readonly string[]).includes(volume)) {
    return { ok: false, reason: "Kendaraan pickup tidak valid." };
  }
  if (new Date(mengantarPickupSlot(date, hour).scheduledAt).getTime() < now + MENGANTAR_PICKUP_LEAD_MS) {
    return { ok: false, reason: "Jadwal pickup minimal 90 menit dari sekarang." };
  }
  return { ok: true, choice: { type: "scheduledPickup", date, hour, volume: volume as MengantarPickupVolume } };
}

/**
 * The `_id` of a `/time` answer: `POST /time` returns one slot object in
 * `data`, `GET /time` an array (Mengantar docs). Either shape is read; a
 * matching slot wins, else the only one.
 */
/**
 * Whether a provider pickup row is this slot. The hour is compared as a
 * number: the spelling Mengantar answers with ("9:00" or "09:00") is not
 * verified, and a strict string match that never hits books a fresh slot on
 * every push.
 */
export function sameMengantarSlot(row: { date?: unknown; time?: unknown }, slot: { date: string; time: string }) {
  const clock = (value: unknown) => {
    const match = /^\s*(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
    return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
  };
  return String(row.date ?? "") === slot.date && clock(row.time) === clock(slot.time);
}

export function pickMengantarTimeId(data: unknown, slot: { date: string; time: string }) {
  const rows = (Array.isArray(data) ? data : data && typeof data === "object" ? [data] : []) as Array<Record<string, unknown>>;
  const match = rows.find((row) => sameMengantarSlot(row, slot));
  const chosen = match ?? (rows.length === 1 ? rows[0] : undefined);
  return String(chosen?._id || "").trim();
}

export type MengantarDispatchResult = {
  providerOrderId: string;
  providerOrderCode: string;
  providerBatchId: string;
  cnoteNo: string | null;
  isPaid: boolean;
};
export type AcceptedMengantarShipment = {
  outcome: "dispatched" | "unpaid";
  shippingStatus: "processing";
  providerOrderId: string;
  providerBatchId: string | null;
  cnoteNo: string | null;
  providerDispatchError: string | null;
  providerDispatchedAt: string | null;
};

export function resolveAcceptedMengantarShipment(
  paymentMethod: MengantarOrderPayloadInput["paymentMethod"],
  result: MengantarDispatchResult,
  acceptedAt: string,
): AcceptedMengantarShipment {
  const unpaid =
    paymentMethod !== "cod" && (!result.isPaid || !result.cnoteNo);
  return {
    outcome: unpaid ? "unpaid" : "dispatched",
    shippingStatus: "processing",
    providerOrderId: result.providerOrderId,
    providerBatchId: result.providerBatchId || null,
    cnoteNo: result.cnoteNo,
    providerDispatchError: unpaid ? "MENGANTAR_WALLET_UNPAID" : null,
    providerDispatchedAt: unpaid ? null : acceptedAt,
  };
}

export type MengantarQueueOutcome = {
  status: string;
  providerOrderId?: string;
  cnoteNo?: string;
  error?: string;
};

export async function runMengantarOrderQueue(
  orderIds: number[],
  processOrder: (orderId: number) => Promise<MengantarQueueOutcome>,
) {
  const results: Array<MengantarQueueOutcome & { orderId: number }> = [];
  for (const orderId of orderIds) {
    try {
      results.push({ orderId, ...(await processOrder(orderId)) });
    } catch (error) {
      results.push({
        orderId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
export function summarizeMengantarDispatchResults(
  results: Array<{ status: string }>,
) {
  let created = 0;
  let unpaid = 0;
  let failed = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === "dispatched") {
      created += 1;
    } else if (result.status === "unpaid") {
      unpaid += 1;
    } else if (result.status === "failed") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }
  return { accepted: created + unpaid, created, unpaid, failed, skipped };
}

/**
 * The provider slot for an instant the shipping page sends: its Jakarta date
 * and hour. Slots are single hours 9:00–18:00 (Mengantar docs); the
 * "9:00 - 18:00" range this used to send was never a provider value.
 */
export function resolveMengantarPickupSlot(value: string | Date) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Jadwal pickup tidak valid.");
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  if (!parts.year || !parts.month || !parts.day || !(MENGANTAR_PICKUP_HOURS as readonly number[]).includes(hour)) {
    throw new Error("Jam pickup harus 09.00–18.00 WIB.");
  }
  return mengantarPickupSlot(`${parts.year}-${parts.month}-${parts.day}`, hour);
}

const cleanText = (value: string, max: number) => value.trim().slice(0, max);

export function buildMengantarOrderPayload(input: MengantarOrderPayloadInput) {
  const order: Record<string, unknown> = {
    assignee: "",
    customerAddress: cleanText(input.customerAddress, 500),
    customerName: cleanText(input.customerName, 100),
    customerAddressDataId: cleanText(input.destinationAreaId, 120),
    customerPhone: input.customerPhone.replace(/\D/g, ""),
    parcelContent: cleanText(
      [input.productTitle, input.variantTitle].filter(Boolean).join(" - "),
      150,
    ),
    destinationMark: cleanText(input.orderNumber, 80),
    deliveryInstruction: cleanText(`AdsBookCMS ${input.orderNumber}`, 150),
    dontIncludeSubdistrict: false,
    weight: Number((input.unitWeightKg * input.quantity).toFixed(3)),
    quantity: input.quantity,
  };

  if (input.paymentMethod === "cod") {
    order.COD = input.collectedAmount;
  } else {
    order.goodsValue = input.goodsAmount;
  }

  return {
    courier: input.courierCode,
    pickup:
      input.pickup?.type === "scheduledPickup"
        ? {
            type: "scheduledPickup",
            volume: input.pickup.volume,
            address_id: input.pickupAddressId,
            time_id: input.pickup.timeId,
          }
        : { type: "dropOff", address_id: input.pickupAddressId },
    orders: [order],
  };
}

export function parseMengantarDispatchResponse(
  payload: Record<string, unknown>,
) {
  if (payload.success !== true) {
    throw new Error("Mengantar tidak mengonfirmasi penerimaan order.");
  }
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const first = rows[0];
  if (!first || typeof first !== "object") {
    throw new Error("Mengantar tidak mengembalikan identitas order.");
  }
  const row = first as Record<string, unknown>;
  const providerOrderId = String(row._id || "").trim();
  const providerOrderCode = String(row.ORDER_ID || "").trim();
  if (!providerOrderId && !providerOrderCode) {
    throw new Error("Mengantar tidak mengembalikan ID order.");
  }

  return {
    providerOrderId: providerOrderId || providerOrderCode,
    providerOrderCode,
    providerBatchId: String(payload.batch_id || row.batch_id || "").trim(),
    cnoteNo: String(row.cnote_no || "").trim() || null,
    isPaid: row.isPaid === true,
  } satisfies MengantarDispatchResult;
}
