/** One order line, as the CRM message lists it. */
export type CrmOrderItem = {
  productName?: string | null;
  variantName?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  /** The variant's own strike price; never invented when absent. */
  comparePrice?: number | null;
};

export type CrmOrderContext = {
  customerName?: string;
  customerPhone?: string;
  address?: string;
  district?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  orderNumber?: string;
  productName?: string;
  /** Variant titles, used when `items` is not available. */
  variantName?: string;
  /** The order lines; `{{varian}}`, `{{jumlah}}` and `{{rincian_pesanan}}` read these. */
  items?: CrmOrderItem[];
  productPrice?: number;
  comparePrice?: number;
  shippingCost?: number;
  totalAmount?: number;
  courierCode?: string;
  cnoteNo?: string;
  sellerName?: string;
  bankAccounts?: string;
  epaymentLink?: string;
  orderDetailsLink?: string;
  paymentDetails?: string;
  paymentLink?: string;
  storeName?: string;
  trackingNumber?: string;
  detailUrl?: string;
};

export const defaultCrmTemplates: Record<string, string> = {
  welcome:
    'Hai {{name}}, terima kasih telah memesan {{product_variant}} di toko kami! Berikut detail pesanan kamu:\n\n- Produk: {{product_variant}}\n- Jumlah: {{jumlah}}\n- Harga: {{harga_satuan}}\n- Subtotal: {{product_price}}\n- Ongkir: {{shipping_cost}}\n- Total: {{total_price}}\n- Dikirim ke:\n  Nama: {{name}}\n  No HP: {{phone}}\n  Alamat: {{address}}\n\nApakah bisa melengkapi alamatnya ya kak?',
  1:
    'Halo Kak {{name}}, terima kasih sebelumnya sudah tertarik dengan {{product_variant}} dengan harga {{product_price}}. Aku mau pastikan, apakah ada kendala atau hal yang masih ingin Kakak pastikan sebelum lanjut pemesanan ya kak? Aku dengan senang hati bisa bantu jelaskan supaya Kakak bisa lebih yakin.',
  2:
    'Hai {{name}}, kami perhatikan pesanan kamu untuk {{product_variant}} (Harga: {{product_price}}) belum diselesaikan. Berikut ringkasan pesanan kamu:\n\n- Produk: {{product_variant}}\n- Jumlah: {{jumlah}}\n- Harga: {{product_price}}\n- Total: {{total_price}}\n- Alamat: {{address}}, {{district}}, {{city}}\n\nSilakan lanjutkan pembayaran ke: {{bank_accounts}}\nAtau klik link berikut untuk pembayaran: {{epayment_link}}\n\nKalau ada yang bingung, tinggal tanya ya! {{seller_name}}',
  3:
    'Hai {{name}}, pesanan kamu untuk {{product_variant}} (Harga: {{product_price}}) masih belum kami terima pembayarannya. Stok terbatas, jadi pastikan kamu menyelesaikan pembayaran segera agar pesananmu bisa kami proses.\n\nPembayaran bisa ke: {{bank_accounts}}\nAtau pakai link ini: {{epayment_link}}\n\nDitunggu ya! {{seller_name}}',
  4:
    'Hai {{name}}, kami ingin mengingatkan kembali bahwa pesanan kamu untuk {{product_variant}} (Harga: {{product_price}}) masih belum diselesaikan. Kalau masih berminat, bisa langsung lanjut pembayaran di: {{epayment_link}}\nAtau transfer ke: {{bank_accounts}}\n\nKami siap bantu kalau ada kendala, {{seller_name}}',
  5:
    'Hai {{name}}, ini adalah pengingat terakhir untuk pesanan kamu atas {{product_variant}} (Harga: {{product_price}}). Kalau masih ingin lanjut, bisa selesaikan pembayaran via: {{epayment_link}}\nAtau transfer ke: {{bank_accounts}}\n\nKalau belum bisa, tidak masalah. Terima kasih banyak sudah mampir! {{seller_name}}',
  6:
    'Hai {{name}}, kami belum menerima pembayaran untuk pesanan kamu atas {{product_variant}} (Harga: {{product_price}}). Kalau kamu membutuhkan bantuan atau ada pertanyaan, tinggal hubungi kami ya. Terima kasih sudah tertarik dengan produk kami! {{seller_name}}',
  7:
    'Hai {{name}}, pembayaran kamu untuk {{product_variant}} sebesar {{total_price}} telah kami terima. Pesanan kamu sedang kami proses dan akan segera dikirim ke:\n{{address}}, {{district}}, {{city}}\n\nAkan kami update lagi kalau sudah dikirim ya, {{seller_name}}',
  8:
    'Hai {{name}}, pesanan kamu atas {{product_variant}} sudah berhasil kami kirim!\n\nCek resinya di sini: {{receipt_number}}\nDetail pesanan: {{order_details_link}}\n\nSemoga kamu suka ya, sampai ketemu di pesanan selanjutnya, {{seller_name}}',
  9:
    'Halo {{name}}, kami lagi ada promo khusus untuk {{product_variant}}, dari harga {{compare_price}} jadi cuma {{product_price}} saja! Stok terbatas ya, pesan sekarang sebelum kehabisan.',
  redirect:
    'Halo, saya sudah melakukan pemesanan {{product_variant}}, atas nama {{name}}. Mohon segera diproses ya.',
};

export const CRM_TEMPLATE_KEYS = [
  'welcome',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'redirect',
] as const;

export function parseCrmTemplates(value: string | null) {
  if (!value) return { ...defaultCrmTemplates };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      CRM_TEMPLATE_KEYS.map((key) => [
        key,
        typeof parsed[key] === 'string'
          ? parsed[key].trim().slice(0, 1200) || defaultCrmTemplates[key]
          : defaultCrmTemplates[key],
      ]),
    );
  } catch {
    return { ...defaultCrmTemplates };
  }
}

/** One account as a CRM message names it: "BCA 123 a.n. Budi". */
export function formatBankAccount(bank?: string | null, number?: string | null, holder?: string | null) {
  return [bank, number, holder ? `a.n. ${holder}` : ''].filter(Boolean).join(' ');
}

/** The store row and its active bank accounts, read beside an order (list or detail). */
export const CRM_STORE_SQL = 'SELECT name, crm_templates FROM stores ORDER BY id LIMIT 1';
export const CRM_BANK_ACCOUNTS_SQL =
  'SELECT bank_code, account_number, account_holder FROM seller_bank_accounts WHERE is_active = 1 ORDER BY id';

/**
 * What every follow-up message needs from the store, served by the orders
 * API itself so a role that may read orders but not settings (customer
 * service) sends the store's own templates, name and accounts — audit
 * 2026-10-31 H1 found it sending the built-in defaults and "Toko Kami".
 */
export function crmStoreContext(
  store: { name?: string | null; crm_templates?: string | null } | null | undefined,
  accounts: Array<{ bank_code?: string | null; account_number?: string | null; account_holder?: string | null }>,
) {
  return {
    templates: parseCrmTemplates(store?.crm_templates ?? null),
    seller_name: String(store?.name || '').trim(),
    bank_accounts: accounts
      .map((account) => formatBankAccount(account.bank_code, account.account_number, account.account_holder))
      .filter(Boolean)
      .join(', '),
  };
}

const normalizeUtf8 = (value: string): string => value.normalize('NFC');

export function renderCrmMessage(template: string, ctx: CrmOrderContext): string {
  const fullAddress = [
    ctx.address,
    ctx.district ? `Kec. ${ctx.district}` : '',
    ctx.city,
    ctx.province,
    ctx.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  const fmtPrice = (val?: number) =>
    val != null && val > 0 ? `Rp ${Math.round(val).toLocaleString('id-ID')}` : 'Rp 0';

  const seller = ctx.sellerName || ctx.storeName || 'Toko Kami';

  const rawProductPrice =
    ctx.productPrice && ctx.productPrice > 0
      ? ctx.productPrice
      : (ctx.totalAmount != null && ctx.totalAmount > 0
          ? Math.max(0, ctx.totalAmount - (ctx.shippingCost || 0))
          : 0);
  const productPriceStr = fmtPrice(rawProductPrice);

  const rawTotalAmount =
    ctx.totalAmount && ctx.totalAmount > 0
      ? ctx.totalAmount
      : (rawProductPrice > 0 ? rawProductPrice + (ctx.shippingCost || 0) : 0);
  const totalStr = fmtPrice(rawTotalAmount);

  const shippingStr = fmtPrice(ctx.shippingCost ?? 0);
  // The strike price is a claim to the buyer, so it is the variant's real
  // compare price or nothing. It used to fall back to price × 1.3 (or a fixed
  // Rp 180.000), which the UpSelling template then sent as a discount that
  // never existed. With no real one it reads as the price itself.
  const items = (ctx.items ?? []).filter((item) => item.productName || item.variantName);
  const realCompare = ctx.comparePrice && ctx.comparePrice > 0
    ? ctx.comparePrice
    : items.length === 1 && items[0].comparePrice && items[0].comparePrice > (items[0].unitPrice ?? 0)
      ? items[0].comparePrice * (items[0].quantity || 1)
      : 0;
  const comparePriceStr = realCompare > rawProductPrice ? fmtPrice(realCompare) : productPriceStr;

  // A variant title equal to its product's adds nothing ("Gel - Gel").
  const variantOf = (item: CrmOrderItem) => {
    const variant = String(item.variantName ?? '').trim();
    return variant && variant !== String(item.productName ?? '').trim() ? variant : '';
  };
  const lineName = (item: CrmOrderItem) =>
    [String(item.productName ?? '').trim(), variantOf(item)].filter(Boolean).join(' - ') || 'Produk';
  const variantStr = items.length
    ? items.map(variantOf).filter(Boolean).join(', ') || '-'
    : String(ctx.variantName ?? '').trim() || '-';
  const productVariantStr = items.length
    ? items.map(lineName).join(', ')
    : [ctx.productName, ctx.variantName].filter((part) => part && String(part).trim()).join(' - ') || ctx.productName || 'Produk';
  const quantity = items.length ? items.reduce((sum, item) => sum + (item.quantity || 1), 0) : 1;
  const unitPriceStr = items.length === 1 && items[0].unitPrice
    ? fmtPrice(items[0].unitPrice)
    : items.length > 1
      ? items.map((item) => fmtPrice(item.unitPrice ?? 0)).join(', ')
      : productPriceStr;
  // One line per item, so a two-size bundle or two products read the way the
  // buyer chose them: "- Paket Glow Up - 150ml × 2 @ Rp 150.000 = Rp 300.000".
  const itemLines = items.length
    ? items
        .map((item) => {
          const qty = item.quantity || 1;
          const unit = item.unitPrice ?? 0;
          return `- ${lineName(item)} × ${qty} @ ${fmtPrice(unit)} = ${fmtPrice(unit * qty)}`;
        })
        .join('\n')
    : `- ${productVariantStr} × 1 = ${productPriceStr}`;

  const replacements: Record<string, string> = {
    name: ctx.customerName || 'Pelanggan',
    nama: ctx.customerName || 'Pelanggan',
    customer_name: ctx.customerName || 'Pelanggan',
    customername: ctx.customerName || 'Pelanggan',

    product_name: ctx.productName || 'Produk',
    productname: ctx.productName || 'Produk',
    produk: ctx.productName || 'Produk',
    nama_produk: ctx.productName || 'Produk',
    item_name: ctx.productName || 'Produk',

    variant_name: variantStr,
    variantname: variantStr,
    variant: variantStr,
    varian: variantStr,
    product_variant: productVariantStr,
    produk_varian: productVariantStr,

    quantity: String(quantity),
    qty: String(quantity),
    jumlah: String(quantity),
    unit_price: unitPriceStr,
    harga_satuan: unitPriceStr,

    items: itemLines,
    order_items: itemLines,
    rincian_pesanan: itemLines,
    rincian: itemLines,

    product_price: productPriceStr,
    productprice: productPriceStr,
    harga_produk: productPriceStr,
    hargaproduk: productPriceStr,
    harga: productPriceStr,
    price: productPriceStr,

    compare_price: comparePriceStr,
    compareprice: comparePriceStr,
    harga_coret: comparePriceStr,
    harga_lama: comparePriceStr,

    shipping_cost: shippingStr,
    shippingcost: shippingStr,
    ongkir: shippingStr,
    biaya_ongkir: shippingStr,
    shipping_cost_cod_cost: totalStr,

    total_price: totalStr,
    totalprice: totalStr,
    total_amount: totalStr,
    totalamount: totalStr,
    total: totalStr,
    total_bayar: totalStr,
    total_tagihan: totalStr,

    phone: ctx.customerPhone || '',
    customer_phone: ctx.customerPhone || '',
    hp: ctx.customerPhone || '',
    wa: ctx.customerPhone || '',
    no_hp: ctx.customerPhone || '',

    address: ctx.address || fullAddress || '',
    alamat: ctx.address || fullAddress || '',
    alamat_lengkap: fullAddress || ctx.address || '',

    district: ctx.district || '',
    kecamatan: ctx.district || '',
    city: ctx.city || '',
    kota: ctx.city || '',
    province: ctx.province || '',
    provinsi: ctx.province || '',
    postal_code: ctx.postalCode || '',
    kode_pos: ctx.postalCode || '',

    seller_name: seller,
    sellername: seller,
    toko: seller,
    nama_toko: seller,
    store_name: seller,

    bank_accounts:
      ctx.bankAccounts ||
      ctx.paymentDetails ||
      'Detail pembayaran / rekening bank',
    bank_account:
      ctx.bankAccounts ||
      ctx.paymentDetails ||
      'Detail pembayaran / rekening bank',
    rekening:
      ctx.bankAccounts ||
      ctx.paymentDetails ||
      'Detail pembayaran / rekening bank',

    epayment_link:
      ctx.epaymentLink || ctx.paymentLink || 'Link pembayaran belum tersedia',
    payment_link:
      ctx.epaymentLink || ctx.paymentLink || 'Link pembayaran belum tersedia',
    link_pembayaran:
      ctx.epaymentLink || ctx.paymentLink || 'Link pembayaran belum tersedia',

    order_details_link:
      ctx.orderDetailsLink || ctx.detailUrl || 'Link detail belum tersedia',
    link_detail:
      ctx.orderDetailsLink || ctx.detailUrl || 'Link detail belum tersedia',

    receipt_number: ctx.cnoteNo || ctx.trackingNumber || '-',
    resi: ctx.cnoteNo || ctx.trackingNumber || '-',
    no_resi: ctx.cnoteNo || ctx.trackingNumber || '-',

    courier: ctx.courierCode || '-',
    kurir: ctx.courierCode || '-',

    inv: ctx.orderNumber || '',
    invoice: ctx.orderNumber || '',
    order_number: ctx.orderNumber || '',
    no_invoice: ctx.orderNumber || '',
    no_order: ctx.orderNumber || '',
  };

  const normalizedReplacements = Object.fromEntries(
    Object.entries(replacements).map(([key, value]) => [
      key,
      normalizeUtf8(value),
    ]),
  );

  return normalizeUtf8(template)
    .replace(/{{\s*([^{}\s]+)\s*}}/g, (token, rawKey: string) => {
      const key = rawKey
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[.-]/g, '_')
        .toLowerCase()
        .trim();
      return normalizedReplacements[key] ?? token;
    })
    .normalize('NFC');
}

export function buildWaUrl(phone: string, text: string): string {
  const cleanPhone = (phone || '')
    .replace(/\D/g, '')
    .replace(/^0/, '62');
  const cleanText = text
    .normalize('NFC')
    .replace(/[\uFE0E\uFE0F](?![\uFE0E\uFE0F])/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(cleanText)}`;
}
