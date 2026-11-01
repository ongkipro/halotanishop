import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMengantarOrderPayload,
  parseMengantarDispatchResponse,
  resolveAcceptedMengantarShipment,
  resolveMengantarPickupSlot,
  availablePickupHours,
  defaultPickupSlot,
  parseMengantarPickupChoice,
  pickupDayOptions,
  pickMengantarTimeId,
  runMengantarOrderQueue,
  summarizeMengantarDispatchResults,
} from "./mengantar-order.ts";

test("builds canonical Mengantar order payload for COD", () => {
  const payload = buildMengantarOrderPayload({
    orderNumber: "INV-20260810-AAAA",
    courierCode: "JNE",
    pickupAddressId: "pickup_123",
    destinationAreaId: "dest_456",
    customerName: " Customer One ",
    customerPhone: "0812-3456-7890",
    customerAddress: "Jl. Merdeka 10",
    productTitle: "Pupuk Alphas",
    variantTitle: "1 Liter",
    unitWeightKg: 1.2,
    quantity: 2,
    paymentMethod: "cod",
    goodsAmount: 300000,
    collectedAmount: 320000,
  });

  assert.equal(payload.courier, "JNE");
  assert.equal(payload.pickup.type, "dropOff");
  assert.equal(payload.pickup.address_id, "pickup_123");
  assert.equal(payload.orders.length, 1);

  const first = payload.orders[0] as Record<string, unknown>;
  assert.equal(first.customerName, "Customer One");
  assert.equal(first.customerPhone, "081234567890");
  assert.equal(first.customerAddressDataId, "dest_456");
  assert.equal(first.parcelContent, "Pupuk Alphas - 1 Liter");
  assert.equal(first.weight, 2.4);
  assert.equal(first.quantity, 2);
  assert.equal(first.COD, 320000);
  assert.equal(first.goodsValue, undefined);
});

test("parses successful Mengantar dispatch response", () => {
  const parsed = parseMengantarDispatchResponse({
    success: true,
    batch_id: "batch_99",
    data: [
      {
        _id: "mgt_ord_1",
        ORDER_ID: "MGT123456",
        cnote_no: "1100099988",
        isPaid: true,
      },
    ],
  });

  assert.equal(parsed.providerOrderId, "mgt_ord_1");
  assert.equal(parsed.providerOrderCode, "MGT123456");
  assert.equal(parsed.providerBatchId, "batch_99");
  assert.equal(parsed.cnoteNo, "1100099988");
  assert.equal(parsed.isPaid, true);
});

test("rejects an unaccepted Mengantar response even when it contains an ID", () => {
  assert.throws(
    () => parseMengantarDispatchResponse({
      success: false,
      data: [{ _id: "rejected-provider-id" }],
    }),
    /tidak mengonfirmasi penerimaan order/,
  );
});

test("preserves Mengantar unpaid shipment drafts without a tracking number", () => {
  const parsed = parseMengantarDispatchResponse({
    success: true,
    batch_id: "batch_unpaid",
    data: [
      {
        _id: "mgt_unpaid_1",
        ORDER_ID: "MGT-UNPAID-1",
        cnote_no: null,
        isPaid: false,
      },
    ],
  });

  assert.equal(parsed.providerOrderId, "mgt_unpaid_1");
  assert.equal(parsed.cnoteNo, null);
  assert.equal(parsed.isPaid, false);
});
test("accepted paid and unpaid provider orders transition into Shipping", () => {
  const acceptedAt = "2026-08-11T10:00:00.000Z";
  const paid = resolveAcceptedMengantarShipment(
    "bank_transfer",
    {
      providerOrderId: "mgt_paid_1",
      providerOrderCode: "MGT-PAID-1",
      providerBatchId: "batch-paid",
      cnoteNo: "WAYBILL-PAID-1",
      isPaid: true,
    },
    acceptedAt,
  );
  const draft = resolveAcceptedMengantarShipment(
    "bank_transfer",
    {
      providerOrderId: "mgt_draft_1",
      providerOrderCode: "MGT-DRAFT-1",
      providerBatchId: "batch-draft",
      cnoteNo: null,
      isPaid: false,
    },
    acceptedAt,
  );

  assert.deepEqual(paid, {
    outcome: "dispatched",
    shippingStatus: "processing",
    providerOrderId: "mgt_paid_1",
    providerBatchId: "batch-paid",
    cnoteNo: "WAYBILL-PAID-1",
    providerDispatchError: null,
    providerDispatchedAt: acceptedAt,
  });
  assert.deepEqual(draft, {
    outcome: "unpaid",
    shippingStatus: "processing",
    providerOrderId: "mgt_draft_1",
    providerBatchId: "batch-draft",
    cnoteNo: null,
    providerDispatchError: "MENGANTAR_WALLET_UNPAID",
    providerDispatchedAt: null,
  });
});

test("a pickup instant becomes its one-hour Jakarta provider slot", () => {
  // 03:00Z is 10:00 WIB: the slot is "10:00", not a day range.
  assert.deepEqual(resolveMengantarPickupSlot("2026-08-11T03:00:00.000Z"), {
    date: "08-11-2026",
    time: "10:00",
    scheduledAt: "2026-08-11T03:00:00.000Z",
  });
  assert.equal(resolveMengantarPickupSlot("2026-08-11T11:00:00.000Z").time, "18:00");
  assert.throws(() => resolveMengantarPickupSlot("2026-08-11T12:00:00.000Z"), /09.00–18.00/, "19:00 WIB has no slot");
  assert.throws(() => resolveMengantarPickupSlot("2026-08-11"), /09.00–18.00/, "a bare date is 07:00 WIB");
  assert.throws(
    () => resolveMengantarPickupSlot("not-a-date"),
    /Jadwal pickup tidak valid/,
  );
});

test("PRD A46: the push choice is drop-off by default; a pickup needs a real date, a provider hour, a vehicle, 90 minutes", () => {
  const now = Date.parse("2026-11-02T03:00:00.000Z"); // 10:00 WIB
  assert.deepEqual(parseMengantarPickupChoice(undefined, now), { ok: true, choice: { type: "dropOff" } });
  assert.deepEqual(parseMengantarPickupChoice({ type: "dropOff", hour: 99 }, now), { ok: true, choice: { type: "dropOff" } });
  assert.deepEqual(parseMengantarPickupChoice({ type: "scheduledPickup", date: "2026-11-02", hour: 12 }, now), {
    ok: true,
    choice: { type: "scheduledPickup", date: "2026-11-02", hour: 12, volume: "volumeMotor" },
  });
  const refused = (value: unknown) => {
    const result = parseMengantarPickupChoice(value, now);
    return result.ok ? "" : result.reason;
  };
  assert.match(refused({ type: "pickup" }), /drop-off atau pickup/);
  assert.match(refused({ type: "scheduledPickup", date: "2026-02-30", hour: 12 }), /Tanggal/);
  assert.match(refused({ type: "scheduledPickup", date: "02-11-2026", hour: 12 }), /Tanggal/);
  assert.match(refused({ type: "scheduledPickup", date: "2026-11-02", hour: 19 }), /09.00–18.00/);
  assert.match(refused({ type: "scheduledPickup", date: "2026-11-02", hour: 12, volume: "volumeBus" }), /Kendaraan/);
  assert.equal(parseMengantarPickupChoice({ type: "scheduledPickup", date: "2026-11-02", hour: 12, volume: "volumeTruck" }, now).ok, true);
  assert.match(refused({ type: "scheduledPickup", date: "2026-11-02", hour: 11 }), /90 menit/, "11:00 is only 60 minutes away");
});

test("bookable hours start 90 minutes out, and the default rolls to tomorrow when today is spent", () => {
  const morning = Date.parse("2026-11-02T03:00:00.000Z"); // 10:00 WIB
  assert.deepEqual(availablePickupHours("2026-11-02", morning), [12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(defaultPickupSlot(morning), { date: "2026-11-02", hour: 12 });
  const evening = Date.parse("2026-11-02T10:00:00.000Z"); // 17:00 WIB
  assert.deepEqual(availablePickupHours("2026-11-02", evening), []);
  assert.deepEqual(defaultPickupSlot(evening), { date: "2026-11-03", hour: 9 });
});

test("a /time answer yields its slot id whether one object or an array", () => {
  const slot = { date: "11-02-2026", time: "13:00" };
  assert.equal(pickMengantarTimeId({ _id: "one", date: "11-02-2026", time: "13:00" }, slot), "one");
  assert.equal(pickMengantarTimeId([{ _id: "a", date: "11-02-2026", time: "9:00" }, { _id: "b", ...slot }], slot), "b");
  assert.equal(pickMengantarTimeId([{ _id: "a", date: "11-02-2026", time: "9:00" }, { _id: "c", date: "x", time: "y" }], slot), "", "several, none matching: no guess");
  assert.equal(pickMengantarTimeId(null, slot), "");
});

test("runs Mengantar order requests sequentially", async () => {
  let active = 0;
  let peak = 0;
  const order = [] as number[];
  const firstDispatch = Promise.withResolvers<void>();

  const pending = runMengantarOrderQueue([11, 22, 33], async (orderId) => {
    active += 1;
    peak = Math.max(peak, active);
    order.push(orderId);
    if (orderId === 11) await firstDispatch.promise;
    active -= 1;
    return { status: "dispatched", providerOrderId: `provider-${orderId}` };
  });
  await Promise.resolve();
  assert.equal(active, 1);
  assert.deepEqual(order, [11]);
  firstDispatch.resolve();
  const results = await pending;

  assert.equal(peak, 1);
  assert.deepEqual(order, [11, 22, 33]);
  assert.deepEqual(
    results.map(({ orderId, providerOrderId }) => ({ orderId, providerOrderId })),
    [
      { orderId: 11, providerOrderId: "provider-11" },
      { orderId: 22, providerOrderId: "provider-22" },
      { orderId: 33, providerOrderId: "provider-33" },
    ],
  );
});
test("continues a batch after one dispatch rejects", async () => {
  const results = await runMengantarOrderQueue([11, 22, 33], async (orderId) => {
    if (orderId === 22) throw new Error("Provider timeout");
    return { status: "dispatched", providerOrderId: `provider-${orderId}` };
  });

  assert.deepEqual(
    results.map(({ orderId, status, error }) => ({ orderId, status, error })),
    [
      { orderId: 11, status: "dispatched", error: undefined },
      { orderId: 22, status: "failed", error: "Provider timeout" },
      { orderId: 33, status: "dispatched", error: undefined },
    ],
  );
});


test("summarizes batch partial success without hiding per-order failures", () => {
  const results = [
    { orderId: 11, status: "dispatched" },
    { orderId: 22, status: "unpaid" },
    { orderId: 33, status: "failed", error: "Provider timeout" },
    { orderId: 44, status: "waiting_for_payment" },
    { orderId: 55, status: "already_dispatched" },
  ];
  assert.deepEqual(summarizeMengantarDispatchResults(results), {
    accepted: 2,
    created: 1,
    unpaid: 1,
    failed: 1,
    skipped: 2,
  });
  assert.deepEqual(results[2], {
    orderId: 33,
    status: "failed",
    error: "Provider timeout",
  });
});

test("the pickup date dropdown offers seven bookable days from the earliest one", () => {
  const morning = Date.parse("2026-10-31T03:00:00.000Z"); // Sat 10:00 WIB
  const days = pickupDayOptions(morning);
  assert.equal(days.length, 7);
  assert.equal(days[0].value, "2026-10-31");
  assert.equal(days[0].label, "Hari ini, 31 Okt");
  assert.equal(days[1].label, "Besok, 1 Nov");
  assert.equal(days[2].label, "Sen, 2 Nov");
  assert.equal(days[6].value, "2026-11-06");
  // After 16:30 WIB today has no slot left, so the list starts tomorrow.
  const evening = Date.parse("2026-10-31T10:00:00.000Z");
  assert.equal(pickupDayOptions(evening)[0].value, "2026-11-01");
  assert.equal(pickupDayOptions(evening)[0].label, "Besok, 1 Nov");
});

test("a provider slot matches whichever way Mengantar spells the hour, and an unusable date has no hours", async () => {
  const { availablePickupHours, pickMengantarTimeId, sameMengantarSlot } = await import("./mengantar-order.ts");
  const slot = { date: "11-02-2026", time: "9:00" };
  assert.equal(sameMengantarSlot({ date: "11-02-2026", time: "09:00" }, slot), true);
  assert.equal(sameMengantarSlot({ date: "11-02-2026", time: "9:00" }, slot), true);
  assert.equal(sameMengantarSlot({ date: "11-02-2026", time: "10:00" }, slot), false);
  assert.equal(sameMengantarSlot({ date: "11-03-2026", time: "9:00" }, slot), false);
  assert.equal(sameMengantarSlot({ date: "11-02-2026" }, slot), false);
  assert.equal(pickMengantarTimeId([{ _id: "a", date: "11-02-2026", time: "10:00" }, { _id: "b", date: "11-02-2026", time: "09:00" }], slot), "b");
  assert.deepEqual(availablePickupHours(""), []);
  assert.deepEqual(availablePickupHours("2026-13-45"), []);
  assert.ok(availablePickupHours("2026-11-02", Date.parse("2026-11-01T00:00:00+07:00")).length > 0);
});
