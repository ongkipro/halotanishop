import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { splitMigrationStatements } from './schema-version.ts';
import {
  adminPaymentSwitchView,
  buyerOrderLinks,
  parsePaymentSwitchTarget,
  paymentSwitchBlockReason,
  PaymentSwitchError,
  switchCodOrderPayment,
} from './payment-switch.ts';
import { loadPublicOrderStatus } from './order-status.ts';

// items 2 × 50.000 − 10.000 discount + 20.000 shipping = 110.000 prepaid;
// the COD total carries the buyer-borne 3% fee + 11% VAT on top.
const COD_TOTAL = 110_000 + 3_300 + 363;

function fixture(env: Record<string, string> = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../db/migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort())
    for (const sql of splitMigrationStatements(readFileSync(new URL(name, dir), 'utf8'))) sqlite.exec(sql);
  sqlite.exec(`INSERT INTO stores (id,name,slug,created_at,cod_fee_bearer) VALUES (1,'Test','test','2026-01-01','buyer');
    INSERT INTO warehouses (id,store_id,name,origin_area_id,pickup_address_id,address,city,province) VALUES (1,1,'Gudang','1','1','Jl. Gudang 1','Sleman','DI Yogyakarta');
    INSERT INTO products (id,store_id,title,slug,created_at) VALUES (1,1,'Produk','produk','2026-01-01');
    INSERT INTO product_variants (id,product_id,title,sku,price) VALUES (1,1,'Varian','SKU-1',50000);
    INSERT INTO seller_bank_accounts (id,store_id,bank_code,account_holder,account_number,is_active,created_at,updated_at)
      VALUES (1,1,'BCA','Toko Test','1234567890',1,'2026-01-01','2026-01-01'),
             (2,1,'BNI','Toko Lama','999',0,'2026-01-01','2026-01-01');
    INSERT INTO orders (id,store_id,order_number,public_status_token,customer_name,customer_phone,address,province,city,district,
      total_amount,shipping_cost,discount_amount,cod_service_fee,cod_service_fee_vat,cod_fee_bearer,payment_method,payment_status,
      shipping_status,courier_code,courier_service,destination_area_id,checkout_fingerprint,created_at)
    VALUES (1,1,'INV-1','tok-1','Budi','081200000000','Jl. A','DI Yogyakarta','Sleman','Depok',${COD_TOTAL},20000,10000,3300,363,'buyer',
      'cod','unpaid','pending','jne','REG','123','fp-1','2026-01-01');
    INSERT INTO order_items (order_id,variant_id,quantity,unit_price) VALUES (1,1,2,50000);`);
  const db = { prepare(sql: string) {
    let values: any[] = [];
    const q = {
      bind(...v: any[]) { values = v; return q; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { const r = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
    return q;
  } } as unknown as D1Database;
  const locals = { runtimeEnv: { OMS_DB: db, ...env } } as unknown as App.Locals;
  const order = () => sqlite.prepare('SELECT * FROM orders WHERE id = 1').get() as Record<string, any>;
  const view = () => adminPaymentSwitchView(order() as never, 100_000);
  // The operator's switch; a refusal comes back as its HTTP status.
  const switchTo = async (body: unknown) => {
    const target = parsePaymentSwitchTarget(body);
    if (!target) return 400;
    try {
      await switchCodOrderPayment(db, locals, 1, target, 'cs-ani');
      return 200;
    } catch (error) {
      if (error instanceof PaymentSwitchError) return error.status;
      throw error;
    }
  };
  return { sqlite, db, order, view, switchTo };
}

test('an operator moves a COD order to manual transfer without the COD fee, recorded with their name', async t => {
  const { sqlite, db, order, view, switchTo } = fixture(); t.after(() => sqlite.close());
  assert.deepEqual(view(), { payment_switch: { available: true, reason: null, total_amount: 110_000 }, payment_link: null });

  assert.equal(await switchTo({ payment_method: 'manual_transfer', seller_bank_account_id: 1 }), 200);
  const row = order();
  assert.equal(row.payment_method, 'manual_transfer');
  assert.equal(row.payment_status, 'pending');
  assert.equal(row.total_amount, 110_000);
  assert.equal(row.cod_service_fee, 0); assert.equal(row.cod_service_fee_vat, 0);
  assert.equal(row.seller_bank_code, 'BCA');
  assert.equal(row.payment_switched_from, 'cod');
  assert.equal(row.payment_switched_by, 'cs-ani');
  assert.ok(Date.parse(row.payment_switched_at));
  assert.equal(row.shipping_status, 'pending');
  // A resubmitted COD checkout must not be handed this order back as COD.
  assert.equal(row.checkout_fingerprint, null);
  assert.deepEqual(view(), { payment_switch: null, payment_link: '/payment#o=1&t=tok-1' });

  // The link opens the buyer's payment page on the account the operator chose.
  const status = await loadPublicOrderStatus(db, '1', 'tok-1');
  assert.equal(status?.payment?.virtual_account, '1234567890');
  assert.equal(status?.total_amount, 110_000);

  // One way only: a second switch finds a prepaid order and refuses.
  assert.equal(await switchTo({ payment_method: 'manual_transfer', seller_bank_account_id: 1 }), 409);
});

test('the switch refuses an inactive account, an unconfigured AutoLaris channel and a malformed target, leaving the order COD', async t => {
  const { sqlite, order, switchTo } = fixture(); t.after(() => sqlite.close());
  assert.equal(await switchTo({ payment_method: 'manual_transfer', seller_bank_account_id: 2 }), 422);
  assert.equal(await switchTo({ payment_method: 'bank_transfer', payment_channel: 'VABCA' }), 422);
  assert.equal(await switchTo({ payment_method: 'qris', payment_channel: 'VABCA' }), 400);
  assert.equal(await switchTo({ payment_method: 'cod' }), 400);
  const row = order();
  assert.equal(row.payment_method, 'cod'); assert.equal(row.total_amount, COD_TOTAL); assert.equal(row.payment_switched_at, null);
});

test('a VA switch whose provider call fails leaves a prepaid order with a failed instruction the buyer can regenerate', async t => {
  const { sqlite, db, order, view, switchTo } = fixture({
    AUTOLARIS_API_KEY: 'test-key', AUTOLARIS_ORDER_ORIGIN_ID: '1', AUTOLARIS_ORDER_DESTINATION_ID: '2',
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('provider down'); }) as typeof fetch;
  t.after(() => { globalThis.fetch = realFetch; sqlite.close(); });
  assert.equal(await switchTo({ payment_method: 'bank_transfer', payment_channel: 'VABCA' }), 200);
  assert.equal(order().payment_method, 'bank_transfer');
  assert.equal(order().total_amount, 110_000);
  const status = await loadPublicOrderStatus(db, '1', 'tok-1');
  assert.equal(status?.payment?.channel_code, 'VABCA');
  assert.equal(status?.payment?.status, 'failed');
  assert.ok(view().payment_link);
});

test('an order fulfilment has touched, or one without a final address and courier, cannot leave COD', () => {
  const live = {
    payment_method: 'cod', payment_status: 'unpaid', shipping_status: 'pending', stock_restored_at: null,
    provider_order_id: null, provider_dispatch_error: null, courier_code: 'jne', destination_area_id: '123', district: 'Depok',
  };
  assert.equal(paymentSwitchBlockReason(live), null);
  for (const change of [
    { payment_method: 'manual_transfer' }, { payment_status: 'paid' }, { shipping_status: 'processing' },
    { stock_restored_at: '2026-01-02' }, { provider_order_id: 'M-1' }, { provider_dispatch_error: 'DISPATCHING' },
    { courier_code: 'ICO' }, { courier_code: null }, { destination_area_id: null }, { district: ' ' },
  ]) assert.notEqual(paymentSwitchBlockReason({ ...live, ...change }), null, JSON.stringify(change));
  assert.equal(parsePaymentSwitchTarget({ payment_method: 'qris', payment_channel: 'qris' })?.payment_method, 'qris');
  assert.equal(parsePaymentSwitchTarget({ payment_method: 'manual_transfer', seller_bank_account_id: '0' }), null);
  // A paid or void prepaid order has nothing left to pay: no link.
  const prepaid = { ...live, id: 1, public_status_token: 't', discount_amount: 0, shipping_cost: 0, payment_method: 'qris', payment_status: 'pending' };
  assert.ok(adminPaymentSwitchView(prepaid, 0).payment_link);
  assert.equal(adminPaymentSwitchView({ ...prepaid, payment_status: 'paid' }, 0).payment_link, null);
  assert.equal(adminPaymentSwitchView({ ...prepaid, stock_restored_at: 'x' }, 0).payment_link, null);
});

test('a write racing the switch leaves the order as the other writer left it', async t => {
  const { sqlite, order, switchTo } = fixture(); t.after(() => sqlite.close());
  // A dispatch claim lands between the switch's read and its write: the
  // guarded UPDATE must find nothing to change.
  const realPrepare = DatabaseSync.prototype.prepare;
  let claimed = false;
  DatabaseSync.prototype.prepare = function (this: DatabaseSync, sql: string) {
    if (!claimed && sql.includes("payment_switched_from = 'cod'")) {
      claimed = true;
      realPrepare.call(this, "UPDATE orders SET provider_dispatch_error = 'DISPATCHING' WHERE id = 1").run();
    }
    return realPrepare.call(this, sql);
  } as typeof realPrepare;
  t.after(() => { DatabaseSync.prototype.prepare = realPrepare; });
  assert.equal(await switchTo({ payment_method: 'manual_transfer', seller_bank_account_id: 1 }), 409);
  assert.equal(order().payment_method, 'cod');
});

test('an admin re-quote cannot write its COD total over an order switched while the quote ran', () => {
  // The admin route is not importable by the node runner (extensionless
  // imports), so the guard is pinned at the source: the write that carries a
  // re-quoted COD total must still find the method and total it read.
  const route = readFileSync(new URL('../pages/api/admin/orders/[id].ts', import.meta.url), 'utf8');
  assert.match(route, /const quoteGuard = hasShippingSelection \? `\s*AND payment_method = \? AND total_amount = \?` : '';/);
  assert.match(route, /\.\.\.\(hasShippingSelection \? \[current\.payment_method, current\.total_amount\] : \[\]\)/);
});

test("audit H2: follow-up links are the buyer's own pages, never an admin path", () => {
  const order = { id: 5, public_status_token: "tok/5", payment_method: "bank_transfer", payment_status: "unpaid", stock_restored_at: null };
  assert.deepEqual(buyerOrderLinks("https://toko.test", order), {
    order_details_link: "https://toko.test/thanks#o=5&t=tok%2F5",
    epayment_link: "https://toko.test/payment#o=5&t=tok%2F5",
  });
  assert.equal(buyerOrderLinks("https://toko.test", { ...order, payment_method: "cod" }).epayment_link, null, "COD has nothing to pay online");
  assert.equal(buyerOrderLinks("https://toko.test", { ...order, payment_status: "paid" }).epayment_link, null);
  assert.equal(buyerOrderLinks("https://toko.test", { ...order, stock_restored_at: "2026-10-31" }).epayment_link, null, "a void order is not payable");
  assert.deepEqual(buyerOrderLinks("https://toko.test", { ...order, public_status_token: null }), { order_details_link: null, epayment_link: null });
});
