import assert from "node:assert/strict";
import test from "node:test";
import { matchesShippingQueue } from "./shipping-queue.ts";

const baseShipment = {
  shippingStatus: "processing",
  cnoteNo: null,
  providerOrderId: "provider-order-1",
  pickupScheduleId: null,
};

test("shipping queues classify unpaid provider drafts as needing a waybill", () => {
  assert.equal(matchesShippingQueue(baseShipment, "needs_waybill"), true);
  assert.equal(matchesShippingQueue(baseShipment, "needs_pickup"), false);
});

test("shipping queues classify processing waybills without a schedule as needing pickup", () => {
  const shipment = { ...baseShipment, cnoteNo: "CM123" };
  assert.equal(matchesShippingQueue(shipment, "needs_waybill"), false);
  assert.equal(matchesShippingQueue(shipment, "needs_pickup"), true);

  assert.equal(
    matchesShippingQueue({ ...shipment, pickupScheduleId: 9 }, "needs_pickup"),
    false,
  );
});

test("shipping queues exclude in-transit shipments from pickup work", () => {
  const shipment = {
    ...baseShipment,
    shippingStatus: "shipped",
    cnoteNo: "CM123",
  };
  assert.equal(matchesShippingQueue(shipment, "needs_pickup"), false);
});

test("shipping queues exclude completed shipments from waybill work", () => {
  const shipment = { ...baseShipment, shippingStatus: "delivered" };
  assert.equal(matchesShippingQueue(shipment, "needs_waybill"), false);
});

test("shipping queues reserve delivered for completed shipments", () => {
  const shipment = { ...baseShipment, shippingStatus: "delivered" };
  assert.equal(matchesShippingQueue(shipment, "delivered"), true);
  assert.equal(matchesShippingQueue(shipment, "all"), true);
});

test("audit M5: a drop-off shipment never needs a pickup; one dispatched before the column still may", () => {
  const waybilled = { shippingStatus: "processing", cnoteNo: "JNE1", providerOrderId: "P1", pickupScheduleId: null };
  assert.equal(matchesShippingQueue({ ...waybilled, handover: "drop_off" }, "needs_pickup"), false);
  assert.equal(matchesShippingQueue({ ...waybilled, handover: "pickup" }, "needs_pickup"), true);
  assert.equal(matchesShippingQueue({ ...waybilled, handover: null }, "needs_pickup"), true);
});

test("a drop-off parcel with a waybill waits in its own queue, never under pickup", () => {
  const dropOff = { shippingStatus: "processing", cnoteNo: "RESI-9", providerOrderId: "MG-9", pickupScheduleId: null, handover: "drop_off" };
  assert.equal(matchesShippingQueue(dropOff, "needs_drop_off"), true);
  assert.equal(matchesShippingQueue(dropOff, "needs_pickup"), false);
  assert.equal(matchesShippingQueue({ ...dropOff, cnoteNo: null }, "needs_drop_off"), false, "no waybill yet");
  assert.equal(matchesShippingQueue({ ...dropOff, shippingStatus: "shipped" }, "needs_drop_off"), false, "already handed over");
  assert.equal(matchesShippingQueue({ ...dropOff, handover: "pickup" }, "needs_drop_off"), false);
});
