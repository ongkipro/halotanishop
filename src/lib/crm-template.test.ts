import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWaUrl,
  crmStoreContext,
  defaultCrmTemplates,
  parseCrmTemplates,
  renderCrmMessage,
} from "./crm-template.ts";

const context = {
  customerName: "Siti",
  customerPhone: "0812-3456-7890",
  address: "Jl. Melati 10",
  district: "Sukajadi",
  city: "Bandung",
  province: "Jawa Barat",
  postalCode: "40162",
  orderNumber: "INV-10001",
  productName: "Tas Luna",
  shippingCost: 18_500,
  totalAmount: 218_500,
  courierCode: "JNE REG",
  cnoteNo: "JNE123",
  productPrice: 200_000,
  sellerName: "Toko Siti",
  bankAccounts: "BCA 123456 a.n. Siti",
  epaymentLink: "https://pay.example/INV-10001",
  orderDetailsLink: "https://shop.example/orders/INV-10001",
};

test("renders customer, address, district, and shipping CRM variables", () => {
  const rendered = renderCrmMessage(
    "{{nama}}|{{wa}}|{{alamat_lengkap}}|{{kecamatan}}|{{ongkir}}|{{total}}",
    context,
  );
  assert.equal(
    rendered,
    "Siti|0812-3456-7890|Jl. Melati 10, Kec. Sukajadi, Bandung, Jawa Barat, 40162|Sukajadi|Rp 18.500|Rp 218.500",
  );
});

test("builds a WhatsApp URL from a formatted Indonesian phone number", () => {
  const url = new URL(buildWaUrl(context.customerPhone, "Halo Siti"));

  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/6281234567890");
  assert.equal(url.searchParams.get("text"), "Halo Siti");
});

test("parses stored CRM templates without leaking invalid values", () => {
  const parsed = parseCrmTemplates(JSON.stringify({
    welcome: "  Halo dari tenant  ",
    1: 42,
  }));

  assert.equal(parsed.welcome, "Halo dari tenant");
  assert.equal(parsed[1], defaultCrmTemplates[1]);
  assert.equal(parsed.redirect, defaultCrmTemplates.redirect);
  assert.deepEqual(parseCrmTemplates("{broken"), defaultCrmTemplates);
});

test("renders user-specified CRM variables {{name}}, {{product_name}}, {{product_price}}, {{shipping_cost_cod_cost}}, {{phone}}, {{address}}", () => {
  const rendered = renderCrmMessage(
    defaultCrmTemplates.welcome,
    context,
  );

  assert.match(rendered, /Hai Siti,/);
  assert.match(rendered, /Produk: Tas Luna/);
  assert.match(rendered, /Harga: Rp 200\.000/);
  assert.match(rendered, /Ongkir: Rp 18\.500/);
  assert.match(rendered, /Total: Rp 218\.500/);
  assert.match(rendered, /Nama: Siti/);
  assert.match(rendered, /No HP: 0812-3456-7890/);
  assert.match(rendered, /Alamat: Jl\. Melati 10/);
});

test("renders thanks page customer to admin WA redirect template correctly", () => {
  const rendered = renderCrmMessage(defaultCrmTemplates.redirect, {
    customerName: "Bapak Demo",
    productName: "Asahan Portable",
  });

  assert.equal(
    rendered,
    "Halo, saya sudah melakukan pemesanan Asahan Portable, atas nama Bapak Demo. Mohon segera diproses ya.",
  );
});

test("renders all 15 canonical CRM placeholders and preserves normalized emoji text", () => {
  const rendered = renderCrmMessage(
    [
      "{{name}}",
      "{{phone}}",
      "{{product_name}}",
      "{{product_price}}",
      "{{shipping_cost}}",
      "{{shipping_cost_cod_cost}}",
      "{{total_price}}",
      "{{address}}",
      "{{district}}",
      "{{city}}",
      "{{bank_accounts}}",
      "{{epayment_link}}",
      "{{seller_name}}",
      "{{receipt_number}}",
      "{{order_details_link}}",
      "📦 Cafe\u0301 😊",
    ].join("|"),
    context,
  );

  assert.equal(
    rendered,
    [
      "Siti",
      "0812-3456-7890",
      "Tas Luna",
      "Rp 200.000",
      "Rp 18.500",
      "Rp 218.500",
      "Rp 218.500",
      "Jl. Melati 10",
      "Sukajadi",
      "Bandung",
      "BCA 123456 a.n. Siti",
      "https://pay.example/INV-10001",
      "Toko Siti",
      "JNE123",
      "https://shop.example/orders/INV-10001",
      "📦 Café 😊",
    ].join("|"),
  );
  assert.equal(rendered, rendered.normalize("NFC"));
  assert.doesNotMatch(rendered, /\uFFFD/);

  assert.equal(
    renderCrmMessage(
      "{{bank_accounts}}|{{epayment_link}}|{{seller_name}}|{{receipt_number}}|{{order_details_link}}",
      {
        paymentDetails: "BCA 654321 a.n. Toko",
        paymentLink: "https://pay.example/fallback",
        storeName: "Toko Fallback",
        trackingNumber: "TRACK-2",
        detailUrl: "https://shop.example/orders/fallback",
      },
    ),
    "BCA 654321 a.n. Toko|https://pay.example/fallback|Toko Fallback|TRACK-2|https://shop.example/orders/fallback",
  );

  const waUrl = new URL(buildWaUrl(context.customerPhone, rendered));
  assert.equal(waUrl.searchParams.get("text"), rendered);
  assert.doesNotMatch(waUrl.searchParams.get("text") || "", /\uFFFD/);
});

test("templates name the variant, quantity and unit price, one line per item", () => {
  const ctx = {
    customerName: "Rina",
    productName: "Paket Glow Up",
    productPrice: 300000,
    shippingCost: 15000,
    totalAmount: 315000,
    items: [{ productName: "Paket Glow Up", variantName: "150ml", quantity: 2, unitPrice: 150000, comparePrice: 180000 }],
  };
  assert.equal(
    renderCrmMessage("{{product_variant}} | {{varian}} | {{jumlah}} | {{harga_satuan}} | {{product_price}} | {{compare_price}}", ctx),
    "Paket Glow Up - 150ml | 150ml | 2 | Rp 150.000 | Rp 300.000 | Rp 360.000",
  );
  assert.equal(renderCrmMessage("{{rincian_pesanan}}", ctx), "- Paket Glow Up - 150ml × 2 @ Rp 150.000 = Rp 300.000");
  const two = renderCrmMessage("{{rincian_pesanan}}|{{jumlah}}|{{varian}}", {
    ...ctx,
    items: [
      { productName: "Toner", variantName: "Toner", quantity: 1, unitPrice: 79000 },
      { productName: "Gel", variantName: "30ml", quantity: 2, unitPrice: 60000 },
    ],
  });
  assert.equal(two, "- Toner × 1 @ Rp 79.000 = Rp 79.000\n- Gel - 30ml × 2 @ Rp 60.000 = Rp 120.000|3|30ml");
  // The default order-detail message names the variant and the real quantity.
  const welcome = renderCrmMessage(defaultCrmTemplates.welcome, ctx);
  assert.match(welcome, /- Produk: Paket Glow Up - 150ml\n- Jumlah: 2\n- Harga: Rp 150\.000\n- Subtotal: Rp 300\.000/);
  assert.doesNotMatch(defaultCrmTemplates.welcome, /Jumlah: 1/);
});

test("the strike price is never invented", () => {
  const plain = { productName: "Gel", productPrice: 150000, items: [{ productName: "Gel", quantity: 1, unitPrice: 150000 }] };
  assert.equal(renderCrmMessage("{{compare_price}}", plain), "Rp 150.000");
  assert.equal(renderCrmMessage("{{compare_price}}", { productName: "Gel" }), "Rp 0");
  assert.equal(renderCrmMessage("{{compare_price}}", { ...plain, comparePrice: 200000 }), "Rp 200.000");
});

test("audit H1: the store context the orders API serves carries the store's templates, name and active accounts", () => {
  const crm = crmStoreContext(
    { name: " Toko Dummy ", crm_templates: JSON.stringify({ welcome: "AUDITMARK {{name}}" }) },
    [{ bank_code: "BCA", account_number: "123", account_holder: "Budi" }, { bank_code: "BRI", account_number: "456", account_holder: null }],
  );
  assert.equal(crm.templates.welcome, "AUDITMARK {{name}}");
  assert.equal(crm.templates["1"], defaultCrmTemplates["1"]);
  assert.equal(crm.seller_name, "Toko Dummy");
  assert.equal(crm.bank_accounts, "BCA 123 a.n. Budi, BRI 456");
  assert.deepEqual(crmStoreContext(null, []), { templates: defaultCrmTemplates, seller_name: "", bank_accounts: "" });
});
