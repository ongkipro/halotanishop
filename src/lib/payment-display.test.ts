import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWhatsappDisplay,
  groupAccountNumber,
  orderStatusLabel,
  paymentChannelLabel,
  paymentStatusLabel,
} from "./payment-display.ts";

test("a VA or account number is grouped by four for reading, never altered", () => {
  assert.equal(groupAccountNumber("88084409110437"), "8808 4409 1104 37");
  assert.equal(groupAccountNumber("8730123456"), "8730 1234 56");
  assert.equal(groupAccountNumber("8730-1234 56"), "8730 1234 56");
  // An alphanumeric payment code is shown exactly as issued.
  assert.equal(groupAccountNumber("ALFA-12AB"), "ALFA-12AB");
  assert.equal(groupAccountNumber("12345"), "12345");
  assert.equal(groupAccountNumber(""), "");
});

test("a channel code reads as the buyer's words", () => {
  assert.equal(paymentChannelLabel("VABCA"), "Virtual Account BCA");
  assert.equal(paymentChannelLabel("vabri"), "Virtual Account BRI");
  assert.equal(paymentChannelLabel("BCA", { manualTransfer: true }), "Transfer Bank BCA");
  assert.equal(paymentChannelLabel("CIMB"), "Transfer Bank CIMB Niaga");
  assert.match(paymentChannelLabel("QRIS"), /^QRIS/);
  // Unknown codes are not dressed up as a bank.
  assert.equal(paymentChannelLabel("VAXYZ"), "VAXYZ");
  assert.equal(paymentChannelLabel(""), "");
});

test("a WhatsApp number is shown the way Indonesians write it", () => {
  assert.equal(formatWhatsappDisplay("6281234567890"), "+62 812-3456-7890");
  assert.equal(formatWhatsappDisplay("081234567890"), "+62 812-3456-7890");
  assert.equal(formatWhatsappDisplay("not a phone"), "not a phone");
});

test("raw statuses never reach the buyer", () => {
  assert.equal(paymentStatusLabel("pending"), "Menunggu pembayaran");
  assert.equal(paymentStatusLabel("PAID"), "Lunas");
  assert.equal(paymentStatusLabel("expired"), "Kedaluwarsa");
  assert.equal(orderStatusLabel("pending"), "Menunggu diproses toko");
  assert.equal(orderStatusLabel("shipped"), "Dalam pengiriman");
  assert.equal(orderStatusLabel("on_hold"), "on hold");
});
