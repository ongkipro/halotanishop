import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { startDevProviders } from "../../scripts/dev-providers.ts";
import { MengantarClient } from "./mengantar-client.ts";
import { AutoLarisClient } from "./autolaris-client.ts";
import { parseMengantarDispatchResponse, pickMengantarTimeId } from "./mengantar-order.ts";

/**
 * The local stand-ins are only useful while the product's own clients can read
 * them. This drives the real clients against the dev server, so a change to a
 * parser that the fake no longer satisfies fails here, not in a browser.
 */
test("the dev providers satisfy the real Mengantar and AutoLaris clients", async (context) => {
  const server = await startDevProviders(0);
  context.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const mengantar = new MengantarClient("dev", base);
  const areas = await mengantar.searchAddress("coblong bandung");
  assert.ok(areas.length > 0 && areas[0].CITY_NAME, "a real district resolves");
  const origin = (await mengantar.searchAddress("gambir jakarta"))[0]._id;

  const rates = await mengantar.estimateRates({ originId: origin, destinationId: areas[0]._id, weight: 1 });
  assert.ok(rates.some((rate) => rate.courier_code === "JNE" && rate.price > 0));
  assert.equal(rates.find((rate) => rate.courier_code === "Paxel")?.unsupported_cod, true);
  assert.ok(rates.every((rate) => rate.cod_fee === 0), "no COD_AMOUNT, no provider COD fee");

  const pickupId = await mengantar.ensurePickupAddress({
    pickupName: "Gudang Uji",
    pickupPic: "Admin",
    pickupPicPhone: "6281200000000",
    pickupAddress: "Jl. Uji 1",
    pickupAutofill: "",
  });
  assert.match(pickupId, /^dev-pickup-/);

  const dispatched = parseMengantarDispatchResponse(
    await mengantar.createShipment({ courier: "JNE", pickup: { type: "dropOff", address_id: pickupId }, orders: [] }),
  );

  // PRD A46: a slot is booked as one object, listed back as an array, and a
  // scheduled pickup needs that slot's id.
  const slot = { date: "11-02-2026", time: "13:00" };
  const timeId = pickMengantarTimeId((await mengantar.schedulePickupTime({ addressId: pickupId, ...slot })).data, slot);
  assert.match(timeId, /^dev-time-/);
  assert.equal(pickMengantarTimeId((await mengantar.getPickupTimes(pickupId)).data, slot), timeId);
  await assert.rejects(mengantar.schedulePickupTime({ addressId: pickupId, date: "11-02-2026", time: "9:00 - 18:00" }));
  const pickedUp = parseMengantarDispatchResponse(
    await mengantar.createShipment({ courier: "JNE", pickup: { type: "scheduledPickup", volume: "volumeMotor", address_id: pickupId, time_id: timeId }, orders: [] }),
  );
  assert.ok(pickedUp.providerOrderId);
  await assert.rejects(
    mengantar.createShipment({ courier: "JNE", pickup: { type: "scheduledPickup", volume: "volumeMotor", address_id: pickupId, time_id: "unknown" }, orders: [] }),
  );
  assert.ok(dispatched.providerOrderId && dispatched.cnoteNo);
  assert.equal((await mengantar.getOrderByTrackingId(String(dispatched.cnoteNo))).cnote_no, dispatched.cnoteNo);

  const autolaris = new AutoLarisClient("dev", base);
  assert.equal((await autolaris.verifyCredentials()).verified, true);
  const payment = await autolaris.createOrder({
    reffId: "10001",
    channelCode: "QRIS",
    origin: "1",
    destination: "2",
    shipperName: "Toko",
    shipperPhone: "6281200000000",
    shipperEmail: "toko@example.test",
    shipperAddress: "Jl. Uji 1",
    receiverName: "Pembeli",
    receiverPhone: "6281200000001",
    receiverEmail: "pembeli@example.test",
    receiverAddress: "Jl. Uji 2",
    grandTotal: 150000,
    orderDetails: [{ name: "Produk", qty: 1, unitPrice: 150000 }],
  });
  assert.ok(payment.qr && payment.expiresAt);
  // The simulator charges the store's own fee table: QRIS 0.7%, VA BCA Rp6.500.
  assert.equal(payment.total, 150000 + 1050);
  const va = await autolaris.createOrder({
    reffId: "10002", channelCode: "VABCA", origin: "1", destination: "2",
    shipperName: "Toko", shipperPhone: "6281200000000", shipperEmail: "toko@example.test", shipperAddress: "Jl. Uji 1",
    receiverName: "Pembeli", receiverPhone: "6281200000001", receiverEmail: "pembeli@example.test", receiverAddress: "Jl. Uji 2",
    grandTotal: 150000, orderDetails: [{ name: "Produk", qty: 1, unitPrice: 150000 }],
  });
  assert.equal(va.total, 150000 + 6500);
  assert.equal((await autolaris.inquirePayment(payment.transactionId)).settlement, "pending");

  await fetch(`${base}/__dev/autolaris/pay?transaction_id=${payment.transactionId}`, { method: "POST" });
  assert.equal((await autolaris.inquirePayment(payment.transactionId)).settlement, "paid");
});

test("the receiver-history stand-in parses into every risk band the checker shows", async () => {
  const { parseReceiverPerformance } = await import("./receiver-performance.ts");
  const server = await startDevProviders(0);
  try {
    const { port } = server.address() as AddressInfo;
    const client = new MengantarClient("dev", `http://127.0.0.1:${port}`);
    const levels = new Set<string>();
    for (const phone of ["6281200000001", "6281200000005", "6281200000009", "6281200000000"]) {
      levels.add(parseReceiverPerformance(await client.getReceiverPerformance(phone), phone).riskLevel);
    }
    assert.deepEqual([...levels].sort(), ["HIGH", "LOW", "MEDIUM", "UNKNOWN"]);
  } finally {
    server.close();
  }
});
