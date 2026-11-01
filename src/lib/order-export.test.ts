import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderCsv,
  csvField,
  jakartaDateTime,
  ORDER_EXPORT_COLUMNS,
  orderExportFilename,
  orderExportScope,
  type OrderExportRow,
} from "./order-export.ts";

const row = (overrides: Partial<OrderExportRow> = {}): OrderExportRow => ({
  order_id: 1, order_number: "INV-1", created_at: "2026-10-31T17:30:00.000Z",
  customer_name: "Budi", customer_phone: "6281234567890", customer_email: null,
  address: "Jl. Mawar 1, RT 2", district: "Coblong", city: "Bandung", province: "Jawa Barat", postal_code: "40132",
  product_title: "Pupuk", variant_title: "1 kg", sku: "PPK-1", quantity: 2, unit_price: 50000,
  shipping_cost: 12000, discount_amount: 0, cod_service_fee: 3000, total_amount: 115000,
  payment_method: "cod", payment_status: "unpaid", shipping_status: "pending",
  courier_code: "JNE", courier_service: "REG", cnote_no: null, provider_status_text: null,
  warehouse_name: null, pickup_scheduled_at: null, ad_click_ids: null, source_page_path: "/promo",
  lead_follow_up_status: "new", lead_follow_up_note: null, lead_followed_up_by: null, item_index: 1,
  ...overrides,
});

test("csvField quotes what needs it and defuses spreadsheet formulas", () => {
  assert.equal(csvField("Budi"), "Budi");
  assert.equal(csvField("Jl. Mawar, No. 1"), '"Jl. Mawar, No. 1"');
  assert.equal(csvField('Toko "Maju"'), '"Toko ""Maju"""');
  assert.equal(csvField("baris\nbaru"), '"baris\nbaru"');
  // A buyer-typed name a spreadsheet would execute (OWASP CSV injection).
  assert.equal(csvField('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvField("+6281"), "'+6281");
  assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvField(-5000), "-5000");
  assert.equal(csvField(null), "");
  assert.equal(csvField(Number.NaN), "");
});

test("one column per field, BOM and CRLF, money on an order's first item row only", () => {
  const csv = buildOrderCsv("orders", [row(), row({ item_index: 2, product_title: "Bibit", unit_price: 15000, quantity: 1 })]);
  assert.ok(csv.startsWith("﻿"));
  const [header, first, second] = csv.slice(1).trimEnd().split("\r\n");
  const columns = header.split(",");
  for (const name of ["Nama", "WhatsApp", "Alamat lengkap", "Kecamatan", "Kota/Kabupaten", "Provinsi", "Produk", "Varian", "Harga satuan"]) {
    assert.ok(columns.includes(name), `${name} is its own column`);
  }
  const cell = (line: string, name: string) => {
    const values = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((value) => value.replace(/,$/, ""));
    return values[columns.indexOf(name)];
  };
  assert.equal(cell(first, "Alamat lengkap"), '"Jl. Mawar 1, RT 2"');
  assert.equal(cell(first, "Kecamatan"), "Coblong");
  assert.equal(cell(first, "Subtotal produk"), "100000");
  assert.equal(cell(first, "Total order"), "115000");
  assert.equal(cell(first, "Tanggal (WIB)"), "2026-11-01 00:30");
  assert.equal(cell(first, "Metode pembayaran"), "COD");
  assert.equal(cell(second, "Produk"), "Bibit");
  assert.equal(cell(second, "Nama"), "Budi");
  assert.equal(cell(second, "Total order"), "");
  assert.equal(cell(second, "Ongkir"), "");
});

test("each export has its own columns; the lead export reads the follow-up words", () => {
  const headers = (kind: keyof typeof ORDER_EXPORT_COLUMNS) => ORDER_EXPORT_COLUMNS[kind].map((column) => column.header);
  assert.ok(headers("abandoned").includes("Status follow-up"));
  assert.ok(!headers("abandoned").includes("Resi"));
  assert.ok(headers("shipping").includes("Resi") && headers("shipping").includes("Status kurir"));
  const lead = buildOrderCsv("abandoned", [row({ lead_follow_up_status: "qualified" })]);
  assert.ok(lead.includes("Berminat"));
});

test("dates read in Asia/Jakarta; the file is named by the Jakarta day", () => {
  assert.equal(jakartaDateTime("2026-10-31T23:59:00.000Z"), "2026-11-01 06:59");
  assert.equal(jakartaDateTime("bukan tanggal"), "bukan tanggal");
  assert.equal(orderExportFilename("abandoned", new Date("2026-10-31T20:00:00.000Z")), "pesanan-tertinggal-2026-11-01.csv");
});

test("an invalid filter is refused, never exported as everything", () => {
  const bad = orderExportScope("orders", new URLSearchParams("shipping_status=hilang"));
  assert.equal(bad.ok, false);
  const period = orderExportScope("shipping", new URLSearchParams("date_filter=kemarin-lusa"));
  assert.equal(period.ok, false);
  const lead = orderExportScope("abandoned", new URLSearchParams("follow_up_status=entah"));
  assert.equal(lead.ok, false);
});

test("a minted payment email is not exported as the buyer's", () => {
  const minted = buildOrderCsv("orders", [row({ customer_email: "6281234567890@toko.shop" })]);
  assert.ok(!minted.includes("@toko.shop"));
  const typed = buildOrderCsv("orders", [row({ customer_email: "budi@mail.com" })]);
  assert.ok(typed.includes("budi@mail.com"));
});
