import assert from "node:assert/strict";
import test from "node:test";
import {
  canDispatchOrderToMengantar,
  getMengantarDispatchEligibility,
} from "./payment-dispatch-policy.ts";

const completeOrder = {
  paymentMethod: "cod",
  paymentStatus: "unpaid",
  shippingStatus: "pending",
  providerOrderId: null,
  providerDispatchError: null,
  destinationAreaId: "destination-1",
  courierCode: "JNE",
  pickupAddressId: "pickup-1",
};

test("only pending orders can be explicitly dispatched", () => {
  assert.equal(canDispatchOrderToMengantar("cod", "unpaid", "pending"), true);
  // A voided COD order is released, never dispatchable again.
  for (const voided of ["cancelled", "refunded", "failed"]) {
    assert.equal(canDispatchOrderToMengantar("cod", voided, "pending"), false, voided);
  }
  assert.equal(
    canDispatchOrderToMengantar("bank_transfer", "paid", "pending"),
    true,
  );
  assert.equal(canDispatchOrderToMengantar("cod", "unpaid", "processing"), false);
  assert.equal(
    getMengantarDispatchEligibility(completeOrder).eligible,
    true,
  );
});

test("unpaid online and incomplete pending orders are not dispatchable", () => {
  assert.deepEqual(
    getMengantarDispatchEligibility({
      ...completeOrder,
      paymentMethod: "qris",
      paymentStatus: "pending",
    }),
    { eligible: false, reason: "Pembayaran online belum lunas." },
  );
  assert.deepEqual(
    getMengantarDispatchEligibility({
      ...completeOrder,
      destinationAreaId: null,
      providerDispatchError: "Provider timeout",
    }),
    { eligible: false, reason: "Kecamatan tujuan belum dipilih." },
  );
});

test("provider-created orders cannot be dispatched again", () => {
  assert.deepEqual(
    getMengantarDispatchEligibility({
      ...completeOrder,
      shippingStatus: "processing",
      providerOrderId: "mengantar-unpaid-draft-1",
      providerDispatchError: "MENGANTAR_WALLET_UNPAID",
    }),
    { eligible: false, reason: "Shipment Mengantar sudah dibuat." },
  );
});

test("failed dispatch remains pending and retryable", () => {
  const failedOrder = {
    ...completeOrder,
    providerDispatchError: "Mengantar timeout",
  };
  assert.equal(getMengantarDispatchEligibility(failedOrder).eligible, true);
  assert.equal(failedOrder.shippingStatus, "pending");
});

test("an abandoned dispatch claim becomes retryable after its lease expires", () => {
  const activeClaim = getMengantarDispatchEligibility({
    ...completeOrder,
    providerDispatchError: "DISPATCHING",
    providerDispatchClaimedAt: new Date().toISOString(),
  });
  const staleClaim = getMengantarDispatchEligibility({
    ...completeOrder,
    providerDispatchError: "DISPATCHING",
    providerDispatchClaimedAt: "2020-01-01T00:00:00.000Z",
  });

  assert.deepEqual(activeClaim, {
    eligible: false,
    reason: "Order sedang diproses oleh Mengantar.",
  });
  assert.equal(staleClaim.eligible, true);
});

test("an operator reads dispatch markers as words, and an accepted shipment is never offered a second push", async () => {
  const { acceptedShipmentId, providerDispatchErrorText } = await import("./payment-dispatch-policy.ts");
  assert.equal(providerDispatchErrorText(null), null);
  assert.equal(providerDispatchErrorText("DISPATCHING"), "Sedang dikirim ke Mengantar.");
  assert.match(String(providerDispatchErrorText("DISPATCH_UNKNOWN: fetch failed")), /belum pasti/);
  assert.equal(providerDispatchErrorText("Alamat tidak valid"), "Alamat tidak valid");
  assert.equal(acceptedShipmentId("DISPATCH_UNKNOWN: Mengantar menerima MG-77: D1_ERROR"), "MG-77");
  assert.match(String(providerDispatchErrorText("DISPATCH_UNKNOWN: Mengantar menerima MG-77: D1_ERROR")), /MG-77.*Jangan push ulang/);
  assert.equal(acceptedShipmentId("DISPATCH_UNKNOWN: Mengantar timeout: upstream"), null, "a provider message is not an accepted id");
  assert.equal(acceptedShipmentId("Mengantar menerima MG-77: x"), null, "only an unknown-outcome marker carries one");
});
