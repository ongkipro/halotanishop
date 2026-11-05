import assert from "node:assert/strict";
import test from "node:test";

import { getStoreSupportWhatsapp } from "./public-store.ts";

function locals(database: unknown) {
  return { runtimeEnv: { OMS_DB: database } } as unknown as App.Locals;
}

test("getStoreSupportWhatsapp strips non-digit formatting from the stored number", async () => {
  const database = {
    prepare: () => ({
      async first() {
        return { support_whatsapp: "+62 812-3456-7890" };
      },
    }),
  };
  const result = await getStoreSupportWhatsapp(locals(database));
  assert.equal(result, "6281234567890");
});

test("getStoreSupportWhatsapp returns empty when no store row exists yet", async () => {
  const database = {
    prepare: () => ({
      async first() {
        return null;
      },
    }),
  };
  assert.equal(await getStoreSupportWhatsapp(locals(database)), "");
});

test("getStoreSupportWhatsapp returns empty when the OMS_DB binding is missing", async () => {
  assert.equal(await getStoreSupportWhatsapp(locals(undefined)), "");
});

test("getStoreSupportWhatsapp returns empty rather than throwing when the query itself fails", async () => {
  const database = {
    prepare: () => ({
      async first() {
        throw new Error("d1 unavailable");
      },
    }),
  };
  assert.equal(await getStoreSupportWhatsapp(locals(database)), "");
});

test("a number saved as 08… comes back in the international form wa.me needs", async () => {
  const database = {
    prepare: () => ({ first: async () => ({ support_whatsapp: "0812-3456-7890" }) }),
  } as unknown as D1Database;
  assert.equal(await getStoreSupportWhatsapp(locals(database)), "6281234567890");
});

test("the public payment summary names only what the checkout offers (revenleather, 2026-11-02)", async () => {
  const { joinIndonesian, summarizePaymentMethods } = await import("./public-store.ts");
  const rows = [
    { payment_method: "cod", name: "COD (Bayar di Tempat)", is_active: true },
    { payment_method: "qris", name: "QRIS", is_active: true },
    { payment_method: "bank_transfer", name: "Virtual Account BCA", is_active: true },
    { payment_method: "bank_transfer", name: "Virtual Account Mandiri", is_active: true },
    { payment_method: "bank_transfer", name: "Virtual Account BSI", is_active: false },
    { payment_method: "manual_transfer", name: "Transfer Bank BCA", is_active: false },
    { payment_method: "manual_transfer", name: "Transfer Bank MANDIRI", is_active: true },
  ];
  assert.deepEqual(summarizePaymentMethods(rows), [
    "COD (bayar di tempat)",
    "QRIS",
    "Virtual Account BCA, Mandiri",
    "transfer bank Mandiri",
  ]);
  assert.deepEqual(summarizePaymentMethods(rows.map((row) => ({ ...row, is_active: row.payment_method === "cod" }))), ["COD (bayar di tempat)"]);
  assert.equal(joinIndonesian(["JNE"]), "JNE");
  assert.equal(joinIndonesian(["JNE", "SPX"]), "JNE dan SPX");
  assert.equal(joinIndonesian(["JNE", "J&T", "SPX"]), "JNE, J&T, dan SPX");
});
