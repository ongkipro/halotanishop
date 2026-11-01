import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { splitMigrationStatements } from "../../lib/schema-version.ts";
import {
  drainKelolaLeads,
  drainKelolaOrders,
  getKelolaConfig,
  kelolaLeadUrl,
  kelolaOrderPayload,
  kelolaOrderState,
  resendOrderToKelola,
  kelolaSyncStatus,
  maskKelolaWebhookUrl,
  normalizeKelolaWebhookUrl,
  pushOrderToKelola,
  readKelolaConfig,
  signKelolaBody,
  testKelolaConnection,
} from "./sync.ts";
import { kelolaPlugin } from "./index.ts";
import { PUT as updateKelola, GET as readKelola } from "../../pages/api/admin/plugins/kelola.ts";

const config = { url: "https://kelola.test/api/public/toko/order/twh_x", secret: "testsecret" };

test("signature matches Kelola's verifier (its Mengantar test vector)", async () => {
  const body = '{"cnote_no":"JNE1234567890","order_id":"ORD-000123","courier":"JNE","status_category":"DELIVERED"}';
  assert.equal(
    await signKelolaBody("testsecret", "1787548800000", body),
    "05826dec707ea7164801d952cb7eaf7ce9adc0c8aa0b93366480434164a1a111",
  );
});

test("config needs both URL and secret", () => {
  assert.equal(readKelolaConfig({ KELOLA_ORDER_WEBHOOK_URL: config.url }), null);
  assert.deepEqual(
    readKelolaConfig({ KELOLA_ORDER_WEBHOOK_URL: config.url, KELOLA_ORDER_WEBHOOK_SECRET: "s" }),
    { url: config.url, secret: "s", source: "server" },
  );
});

test("the dashboard pair wins over the env pair; env stays the fallback", async () => {
  const env = { KELOLA_ORDER_WEBHOOK_URL: "https://env.test/api/public/toko/order/twh_env", KELOLA_ORDER_WEBHOOK_SECRET: "envsecret" };
  assert.deepEqual(getKelolaConfig({}, env), { url: env.KELOLA_ORDER_WEBHOOK_URL, secret: "envsecret", source: "server" });
  assert.equal(getKelolaConfig({}, {}), null);
  assert.deepEqual(
    getKelolaConfig({ webhook_url: config.url, webhook_secret: "dbsecret" }, env),
    { url: config.url, secret: "dbsecret", source: "dashboard" },
  );
});

test("only an HTTPS Kelola order-webhook URL is accepted, and its token is masked", () => {
  assert.equal(normalizeKelolaWebhookUrl(" https://kelolatim.com/api/public/toko/order/twh_abcdef123456 "), "https://kelolatim.com/api/public/toko/order/twh_abcdef123456");
  for (const bad of [
    "http://kelolatim.com/api/public/toko/order/twh_x",
    "https://kelolatim.com/api/public/toko/order/",
    "https://kelolatim.com/api/public/toko/order/twh_x?debug=1",
    "https://kelolatim.com/somewhere/else",
    "not a url",
    42,
  ]) assert.equal(normalizeKelolaWebhookUrl(bad), null, String(bad));
  assert.equal(maskKelolaWebhookUrl("https://kelolatim.com/api/public/toko/order/twh_abcdef123456"), "https://kelolatim.com/api/public/toko/order/twh_…3456");
});

test("connection test signs an empty body and reads Kelola's answer", async () => {
  const answer = (status: number) => (async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(init.body, "{}");
    assert.equal(headers.get("x-signature"), await signKelolaBody(config.secret, headers.get("x-timestamp")!, "{}"));
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  assert.equal((await testKelolaConnection(config, answer(400))).ok, true);
  assert.match((await testKelolaConnection(config, answer(401))).message, /Secret tidak cocok/);
  assert.match((await testKelolaConnection(config, answer(404))).message, /tidak mengenal URL/);
  const down = (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch;
  assert.match((await testKelolaConnection(config, down)).message, /ECONNREFUSED/);
});

test("settings: the owner saves the pair, the secret never comes back, an admin cannot", async (context) => {
  const { sqlite, database } = migratedStore();
  const realFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = (async () => new Response("{}", { status: 400 })) as typeof fetch;
  const call = (role: string, body: unknown) => updateKelola({
    request: new Request("https://store.test/api/admin/plugins/kelola", { method: "PUT", body: JSON.stringify(body) }),
    locals: { admin: { username: "u", role, mustChangePassword: false }, runtimeEnv: { OMS_DB: database } },
  } as never);
  const secret = "kelola-secret-must-not-leak-0123456789";

  assert.equal((await call("admin", { action: "save", webhook_url: config.url, webhook_secret: secret })).status, 403);
  assert.equal((await call("owner", { action: "save", webhook_url: "http://x.test/a", webhook_secret: secret })).status, 400);
  assert.equal((await call("owner", { action: "save", webhook_url: "https://kelola.test/api/public/toko/order/twh_x" })).status, 400, "no secret yet");

  const saved = await call("owner", { action: "save", webhook_url: "https://kelola.test/api/public/toko/order/twh_abcdef123456", webhook_secret: secret });
  assert.equal(saved.status, 200);
  const text = await saved.text();
  assert.equal(text.includes(secret), false);
  assert.equal(JSON.parse(text).data.verified, true);
  assert.equal(JSON.parse(text).data.kelola.source, "dashboard");

  // A new URL with the secret left empty keeps the stored secret.
  assert.equal((await call("owner", { action: "save", webhook_url: "https://kelola.test/api/public/toko/order/twh_rotated99", webhook_secret: "" })).status, 200);
  assert.deepEqual(
    JSON.parse(String((sqlite.prepare("SELECT settings FROM plugins WHERE id = 'kelola'").get() as { settings: string }).settings)),
    { webhook_url: "https://kelola.test/api/public/toko/order/twh_rotated99", webhook_secret: secret },
  );

  const read = await readKelola({ locals: { runtimeEnv: { OMS_DB: database } } } as never);
  const readText = await read.text();
  assert.equal(readText.includes(secret), false);
  assert.equal(readText.includes("twh_rotated99"), false, "the token is masked");
  assert.equal(JSON.parse(readText).data.kelola.configured, true);

  assert.equal((await call("owner", { action: "save", webhook_url: null })).status, 200);
  assert.equal(sqlite.prepare("SELECT settings FROM plugins WHERE id = 'kelola'").get()?.settings, "{}");

  // The plugin turned off answers 409 and keeps its settings out of reach.
  sqlite.exec("UPDATE plugins SET enabled = 0 WHERE id = 'kelola'");
  assert.equal((await call("owner", { action: "save", webhook_url: config.url, webhook_secret: secret })).status, 409);
});

test("order detail state, and a resend that is not bound by the 24h window", async () => {
  const { sqlite, database } = migratedStore();
  const orderId = insertOrder(sqlite, "INV-20261001-0009", "2026-10-01T03:00:00.000Z");
  sqlite.prepare("INSERT INTO plugin_kelola_orders (order_id, attempts, last_error) VALUES (?, 2, 'HTTP 503: down')").run(orderId);
  assert.equal((await resendOrderToKelola(database, null, orderId)).ok, false, "not connected");

  assert.deepEqual(await kelolaOrderState(database, config, orderId), {
    configured: true, synced_at: null, attempts: 2, last_error: "HTTP 503: down", voided: false,
  });
  const realFetch = globalThis.fetch;
  let pushes = 0;
  try {
    globalThis.fetch = (async () => { pushes += 1; return new Response("{}", { status: 201 }); }) as typeof fetch;
    const sent = await resendOrderToKelola(database, config, orderId);
    assert.equal(sent.ok, true);
    assert.ok(sent.state.synced_at);
    assert.equal(sent.state.last_error, null);
    assert.equal((await resendOrderToKelola(database, config, orderId)).ok, true, "already in Kelola");
    assert.equal(pushes, 1, "not sent twice");

    const voided = insertOrder(sqlite, "INV-VOID", new Date().toISOString());
    sqlite.prepare("UPDATE orders SET stock_restored_at = ? WHERE id = ?").run(new Date().toISOString(), voided);
    assert.match(String((await resendOrderToKelola(database, config, voided)).error), /dibatalkan/);
    assert.equal(pushes, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("sync status counts the last day and names the latest failure", async () => {
  const { sqlite, database } = migratedStore();
  const now = new Date();
  const ok = insertOrder(sqlite, "INV-OK", now.toISOString());
  sqlite.prepare("INSERT INTO plugin_kelola_orders (order_id, synced_at) VALUES (?, ?)").run(ok, now.toISOString());
  const bad = insertOrder(sqlite, "INV-BAD", now.toISOString());
  sqlite.prepare("INSERT INTO plugin_kelola_orders (order_id, attempts, last_error) VALUES (?, 3, 'HTTP 409: Toko nonaktif')").run(bad);
  const old = insertOrder(sqlite, "INV-OLD", new Date(now.getTime() - 30 * 3_600_000).toISOString());
  sqlite.prepare("INSERT INTO plugin_kelola_orders (order_id, attempts, last_error) VALUES (?, 9, 'old')").run(old);
  const status = await kelolaSyncStatus(database, now);
  assert.deepEqual({ ...status, last_error: { ...status.last_error } }, {
    last_synced_at: now.toISOString(),
    synced_24h: 1,
    failing_24h: 1,
    unsynced_older: 1,
    last_error: { order_number: "INV-BAD", attempts: 3, message: "HTTP 409: Toko nonaktif" },
  });
});

test("payload: COD carries the collected total, transfer does not; date is the WIB day", () => {
  const order = {
    id: 1, order_number: "INV-1", created_at: "2026-10-17T18:30:00.000Z", customer_name: "Budi",
    customer_phone: "081234567890", address: "Jl. Melati 1", province: "Jawa Barat", city: "Bandung",
    district: "Coblong", postal_code: null, shipping_cost: 15000, discount_amount: null,
    total_amount: 121000, payment_method: "cod",
  };
  const items = [{ sku: "GEL-1", name: "Gel", quantity: 2, unit_price: 52500, weight_grams: 150 }];
  const cod = kelolaOrderPayload(order, items);
  assert.equal(cod.date, "2026-10-18");
  assert.equal(cod.payment, "cod");
  assert.equal(cod.codValue, 121000);
  assert.equal(cod.berat, 300);
  assert.deepEqual(cod.items, [{ sku: "GEL-1", name: "Gel", qty: 2, price: 52500 }]);
  const qris = kelolaOrderPayload({ ...order, payment_method: "qris" }, items);
  assert.equal(qris.payment, "transfer");
  assert.equal(qris.codValue, null);
});

test("push marks the order synced; a failure is recorded and retried by the drain", async () => {
  const { sqlite, database } = migratedStore();
  const orderId = insertOrder(sqlite, "INV-20261017-0001", new Date().toISOString());
  const calls: { headers: Headers; body: string }[] = [];
  let status = 503;
  const fetcher = (async (_url: string, init: RequestInit) => {
    calls.push({ headers: new Headers(init.headers), body: String(init.body) });
    return new Response(status === 201 ? '{"ok":true}' : "down", { status });
  }) as unknown as typeof fetch;

  assert.equal(await pushOrderToKelola(database, config, orderId, fetcher), false);
  let row = sqlite.prepare("SELECT synced_at, attempts, last_error FROM plugin_kelola_orders WHERE order_id = ?").get(orderId) as Record<string, unknown>;
  assert.equal(row.synced_at, null);
  assert.equal(row.attempts, 1);
  assert.match(String(row.last_error), /HTTP 503/);

  status = 201;
  assert.equal(await drainKelolaOrders(database, config, new Date(), fetcher), 1);
  row = sqlite.prepare("SELECT synced_at, last_error FROM plugin_kelola_orders WHERE order_id = ?").get(orderId) as Record<string, unknown>;
  assert.ok(row.synced_at);
  assert.equal(row.last_error, null);

  const sent = calls[1];
  assert.equal(
    sent.headers.get("x-signature"),
    await signKelolaBody(config.secret, sent.headers.get("x-timestamp")!, sent.body),
  );
  assert.equal(JSON.parse(sent.body).code, "INV-20261017-0001");

  // Synced orders are never sent again.
  assert.equal(await drainKelolaOrders(database, config, new Date(), fetcher), 0);
  assert.equal(calls.length, 2);
});

test("the Kelola payload carries the order's recorded weight, not the variant's current one", async () => {
  const { sqlite, database } = migratedStore();
  const orderId = insertOrder(sqlite, "INV-WEIGHT-1", new Date().toISOString());
  sqlite.prepare("UPDATE order_items SET weight_grams = 150 WHERE order_id = ?").run(orderId);
  sqlite.exec("UPDATE product_variants SET weight_grams = 900 WHERE id = 1");
  let body = "";
  const fetcher = (async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return new Response('{"ok":true}', { status: 201 });
  }) as unknown as typeof fetch;
  assert.equal(await pushOrderToKelola(database, config, orderId, fetcher), true);
  assert.equal(JSON.parse(body).berat, 300);
});

test("drain skips abandoned, voided and out-of-window orders", async () => {
  const { sqlite, database } = migratedStore();
  const now = new Date();
  const abandoned = insertOrder(sqlite, "ABD-1", now.toISOString());
  sqlite.prepare("UPDATE orders SET shipping_status = 'abandoned' WHERE id = ?").run(abandoned);
  const voided = insertOrder(sqlite, "INV-2", now.toISOString());
  sqlite.prepare("UPDATE orders SET stock_restored_at = ? WHERE id = ?").run(now.toISOString(), voided);
  insertOrder(sqlite, "INV-3", new Date(now.getTime() - 25 * 3_600_000).toISOString());
  let calls = 0;
  const fetcher = (async () => { calls += 1; return new Response("{}", { status: 201 }); }) as unknown as typeof fetch;
  assert.equal(await drainKelolaOrders(database, config, now, fetcher), 0);
  assert.equal(calls, 0);
});

test("backfill (no window) sends old orders that never had a plugin row, still never abandoned or voided ones", async () => {
  const { sqlite, database } = migratedStore();
  const now = new Date();
  const longAgo = new Date(now.getTime() - 15 * 24 * 3_600_000).toISOString();
  const old = insertOrder(sqlite, "INV-OLD", longAgo);
  const abandoned = insertOrder(sqlite, "ABD-OLD", longAgo);
  sqlite.prepare("UPDATE orders SET shipping_status = 'abandoned' WHERE id = ?").run(abandoned);
  const voided = insertOrder(sqlite, "INV-VOID", longAgo);
  sqlite.prepare("UPDATE orders SET stock_restored_at = ? WHERE id = ?").run(now.toISOString(), voided);
  const sent: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)).code);
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
  assert.equal(await drainKelolaOrders(database, config, now, fetcher), 0);
  assert.equal((await kelolaSyncStatus(database, now)).unsynced_older, 1);
  assert.equal(await drainKelolaOrders(database, config, null, fetcher), 1);
  assert.deepEqual(sent, ["INV-OLD"]);
  assert.equal((await kelolaSyncStatus(database, now)).unsynced_older, 0);
  assert.ok((sqlite.prepare("SELECT synced_at FROM plugin_kelola_orders WHERE order_id = ?").get(old) as { synced_at: string }).synced_at);
});

test("abandoned orders go to Kelola's lead webhook once, only after the grace period", async () => {
  const { sqlite, database } = migratedStore();
  const now = new Date();
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const lead = insertOrder(sqlite, "ABN-0007", ago(45));
  sqlite.prepare("UPDATE orders SET shipping_status = 'abandoned', source_page_path = '/gel' WHERE id = ?").run(lead);
  const fresh = insertOrder(sqlite, "ABN-0008", ago(5));
  sqlite.prepare("UPDATE orders SET shipping_status = 'abandoned' WHERE id = ?").run(fresh);
  insertOrder(sqlite, "INV-0009", ago(45));
  const calls: { url: string; headers: Headers; body: string }[] = [];
  let status = 503;
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;

  // A refused push leaves the lead for the next run.
  assert.equal(await drainKelolaLeads(database, config, now, fetcher), 0);
  status = 201;
  assert.equal(await drainKelolaLeads(database, config, now, fetcher), 1);
  assert.equal(calls.length, 2);
  const sent = calls[1];
  assert.equal(sent.url, "https://kelola.test/api/public/toko/lead/twh_x");
  assert.equal(sent.headers.get("x-signature"), await signKelolaBody(config.secret, sent.headers.get("x-timestamp")!, sent.body));
  assert.deepEqual(JSON.parse(sent.body), {
    code: "ABN-0007", customerName: "Budi", customerPhone: "081234567890", address: "Jl. Melati 1",
    kecamatan: "Coblong", kota: "Bandung", provinsi: "Jawa Barat", produk: "Gel Tenggorokan",
    nilai: 120000, halaman: "/gel",
  });
  // Never twice, and the lead marker leaves the order push untouched.
  assert.equal(await drainKelolaLeads(database, config, now, fetcher), 0);
  const row = sqlite.prepare("SELECT synced_at, lead_synced_at FROM plugin_kelola_orders WHERE order_id = ?").get(lead) as Record<string, unknown>;
  assert.ok(row.lead_synced_at);
  assert.equal(row.synced_at, null);
  assert.equal(kelolaLeadUrl("https://kelolatim.com/api/public/toko/order/twh_order"), "https://kelolatim.com/api/public/toko/lead/twh_order");
});

/** The full checked-in migration chain, so the test breaks if the columns drift. */
function migratedStore() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../../db/migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    for (const statement of splitMigrationStatements(readFileSync(new URL(name, dir), "utf8"))) {
      sqlite.exec(statement);
    }
  }
  // The Kelola plugin activated: its own table and an enabled row.
  for (const statement of kelolaPlugin.schema.flat()) sqlite.exec(statement);
  sqlite.exec(`INSERT INTO plugins (id, enabled, schema_version, updated_at) VALUES ('kelola', 1, ${kelolaPlugin.schema.length}, '2026-01-01')`);
  sqlite.exec(`INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Toko', 'toko', '2026-01-01')`);
  sqlite.exec(`INSERT INTO products (id, store_id, title, slug, created_at) VALUES (1, 1, 'Gel Tenggorokan', 'gel', '2026-01-01')`);
  sqlite.exec(`INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams) VALUES (1, 1, 'GEL-1', 'Gel Tenggorokan', 52500, 150)`);
  const database = {
    prepare: (sql: string) => {
      const bound: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => { bound.push(...values); return statement; },
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bound as never[]).changes) } }),
        first: async () => sqlite.prepare(sql).get(...bound as never[]) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...bound as never[]) }),
      };
      return statement;
    },
  } as unknown as D1Database;
  return { sqlite, database };
}

function insertOrder(sqlite: DatabaseSync, orderNumber: string, createdAt: string) {
  const { lastInsertRowid } = sqlite
    .prepare(
      `INSERT INTO orders (order_number, store_id, customer_name, customer_phone, address, province, city,
         district, total_amount, shipping_cost, payment_method, payment_status, shipping_status, created_at)
       VALUES (?, 1, 'Budi', '081234567890', 'Jl. Melati 1', 'Jawa Barat', 'Bandung', 'Coblong',
         120000, 15000, 'cod', 'unpaid', 'pending', ?)`,
    )
    .run(orderNumber, createdAt);
  sqlite.prepare("INSERT INTO order_items (order_id, variant_id, quantity, unit_price) VALUES (?, 1, 2, 52500)").run(lastInsertRowid);
  return Number(lastInsertRowid);
}
