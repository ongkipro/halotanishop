import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { mkdtempSync, statSync as statPath } from "node:fs";
import { tmpdir } from "node:os";
import { credentialsPath, runAdsbookCli } from "./adsbook-cli.ts";
import { hashApiKeySecret } from "./developer-api-keys.ts";
import { validateHeadlessRequest } from "./headless-api.ts";
import { OPS_OPERATIONS } from "./ops-api.ts";
import { applyOrderLifecycleMutation, updateAdminOrderShippingStatuses } from "./order-lifecycle.ts";
import { switchCodOrderPayment } from "./payment-switch.ts";
import { splitMigrationStatements } from "./schema-version.ts";

// Routes import their siblings without an extension, as Astro allows.
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[a-z0-9]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
const { GET: listRoute } = await import("../pages/api/ops/v1/orders/index.ts");
const { GET: detailRoute } = await import("../pages/api/ops/v1/orders/[number].ts");
const { GET: openApiRoute } = await import("../pages/api/ops/v1/openapi.json.ts");
const developerRoute = await import("../pages/api/admin/settings/developer.ts");
const { GET: adminOrderRoute } = await import("../pages/api/admin/orders/[id].ts");
resolver.deregister();

function store() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort())
    for (const sql of splitMigrationStatements(readFileSync(new URL(name, dir), "utf8"))) sqlite.exec(sql);
  sqlite.exec(`INSERT INTO stores (id,name,slug,created_at) VALUES (1,'Toko','toko','2026-01-01');
    INSERT INTO products (id,store_id,title,slug,created_at) VALUES (1,1,'Pupuk','pupuk','2026-01-01');
    INSERT INTO product_variants (id,product_id,title,sku,price) VALUES (1,1,'1 L','PUP-1',50000);
    INSERT INTO seller_bank_accounts (id,store_id,bank_code,account_holder,account_number,is_active,created_at,updated_at)
      VALUES (1,1,'BCA','Toko','1234567890',1,'2026-01-01','2026-01-01');`);
  const database = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async first() {
          return (sqlite.prepare(sql).get(...(values as never[])) as unknown) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...(values as never[])) };
        },
        async run() {
          const info = sqlite.prepare(sql).run(...(values as never[]));
          return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return statement;
    },
    // D1 runs a batch as one transaction.
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  const locals = { runtimeEnv: { OMS_DB: database } } as unknown as App.Locals;
  let orderSeq = 0;
  const addOrder = (fields: Record<string, unknown> = {}) => {
    orderSeq += 1;
    const row = {
      store_id: 1,
      order_number: `INV-${10000 + orderSeq}`,
      customer_name: "Budi Santoso",
      customer_phone: "081234567890",
      customer_email: "budi@example.test",
      address: "Jl. Mawar 7",
      postal_code: "55281",
      district: "Depok",
      city: "Sleman",
      province: "DI Yogyakarta",
      total_amount: 120_000,
      shipping_cost: 20_000,
      payment_method: "cod",
      payment_status: "unpaid",
      shipping_status: "pending",
      created_at: `2026-10-01T00:00:${String(orderSeq % 60).padStart(2, "0")}.000Z`,
      ...fields,
    };
    const columns = Object.keys(row);
    const info = sqlite
      .prepare(`INSERT INTO orders (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...(Object.values(row) as never[]));
    const id = Number(info.lastInsertRowid);
    sqlite.prepare("INSERT INTO order_items (order_id,variant_id,quantity,unit_price,weight_grams) VALUES (?,1,2,50000,1000)").run(id);
    return id;
  };
  const addKey = async (secret: string, scopes: string | null, revoked = false) => {
    sqlite
      .prepare(
        `INSERT INTO developer_api_keys (name,key_hash,key_preview,created_by,created_at,scopes,rate_limit_per_minute,daily_quota,revoked_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      // A key issued before scopes were stored has an empty list.
      .run(secret, await hashApiKeySecret(secret), "x", "owner", "2026-01-01", scopes ?? "", 600, 100_000, revoked ? "2026-01-02" : null);
  };
  const audit = () =>
    sqlite.prepare("SELECT operation, outcome, status_code FROM headless_api_audit_events ORDER BY id").all() as {
      operation: string;
      outcome: string;
      status_code: number;
    }[];
  return { sqlite, database, locals, addOrder, addKey, audit };
}

async function call(
  route: typeof listRoute,
  locals: App.Locals,
  path: string,
  secret?: string,
  params: Record<string, string> = {},
) {
  const url = new URL(`https://toko.test${path}`);
  const request = new Request(url, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
  const response = await route({ request, url, locals, params } as unknown as Parameters<typeof listRoute>[0]);
  return { response, body: (await response.json()) as Record<string, any> };
}

test("REQ-251/REQ-263: absent, revoked and storefront keys are refused; an ops key never reaches the storefront", async () => {
  const { locals, addKey, audit } = store();
  await addKey("legacy-null-scope", null);
  await addKey("storefront-all", "storefront:read,catalog:read,shipping:read,checkout:write,orders:read,tracking:write");
  await addKey("ops-revoked", "ops:orders:read", true);
  await addKey("ops-only", "ops:orders:read,ops:orders:read_pii");

  assert.equal((await call(listRoute, locals, "/api/ops/v1/orders")).response.status, 401);
  assert.equal((await call(listRoute, locals, "/api/ops/v1/orders", "not-a-key")).response.status, 401);
  assert.equal((await call(listRoute, locals, "/api/ops/v1/orders", "ops-revoked")).response.status, 401);
  assert.equal(audit().length, 0, "no key identified, nothing to audit against");

  for (const secret of ["legacy-null-scope", "storefront-all"]) {
    const { response, body } = await call(listRoute, locals, "/api/ops/v1/orders", secret);
    assert.equal(response.status, 403, secret);
    assert.equal(body.error.code, "API_SCOPE_FORBIDDEN");
  }
  assert.deepEqual(audit().map((row) => [row.operation, row.outcome, row.status_code]), [
    ["ops.ordersList", "scope_denied", 403],
    ["ops.ordersList", "scope_denied", 403],
  ]);

  // The legacy key still has its storefront access; the ops key has none.
  const storefront = (secret: string) =>
    validateHeadlessRequest(
      new Request("https://toko.test/api/v1/products", { headers: { "x-app-key": secret } }),
      locals,
      { operation: "catalogList" },
    );
  assert.equal((await storefront("legacy-null-scope")).allowed, true);
  assert.equal((await storefront("ops-only")).allowed, false);

  const ok = await call(listRoute, locals, "/api/ops/v1/orders", "ops-only");
  assert.equal(ok.response.status, 200);
  assert.equal(ok.response.headers.get("cache-control"), "no-store");
  for (const [name] of ok.response.headers) assert.doesNotMatch(name, /^access-control-/i);
  const refused = await call(listRoute, locals, "/api/ops/v1/orders", "storefront-all");
  for (const [name] of refused.response.headers) assert.doesNotMatch(name, /^access-control-/i);
  assert.deepEqual(audit().slice(-2).map((row) => ({ ...row })), [
    { operation: "ops.ordersList", outcome: "allowed", status_code: 200 },
    { operation: "ops.ordersList", outcome: "scope_denied", status_code: 403 },
  ]);
});

test("REQ-253/REQ-256: without read_pii the buyer and click ids are absent; UTM and attribution stay", async () => {
  const { locals, addOrder, addKey } = store();
  await addKey("read", "ops:orders:read");
  await addKey("pii", "ops:orders:read,ops:orders:read_pii");
  addOrder({
    source_page_path: "/promo-okt",
    ad_click_ids: JSON.stringify({ gclid: "G-123", utm_source: "google", utm_medium: "cpc", utm_campaign: "promo-okt" }),
  });

  const plain = (await call(detailRoute, locals, "/api/ops/v1/orders/INV-10001", "read", { number: "inv-10001" })).body.data;
  assert.equal(plain.customer, undefined);
  assert.equal(plain.attribution.click_ids, undefined);
  assert.equal(plain.attribution.utm.campaign, "promo-okt");
  assert.equal(plain.attribution.source_slug, "promo-okt");
  assert.equal(plain.attribution.traffic_source, "google");
  assert.deepEqual(plain.destination, { district: "Depok", city: "Sleman", province: "DI Yogyakarta" });
  const serialized = JSON.stringify(plain);
  for (const secret of ["Budi", "081234567890", "budi@example.test", "Mawar", "55281", "G-123"]) {
    assert.doesNotMatch(serialized, new RegExp(secret), secret);
  }

  const full = (await call(detailRoute, locals, "/api/ops/v1/orders/INV-10001", "pii", { number: "INV-10001" })).body.data;
  assert.deepEqual(full.customer, {
    name: "Budi Santoso",
    phone: "081234567890",
    email: "budi@example.test",
    address: "Jl. Mawar 7",
    postal_code: "55281",
  });
  assert.deepEqual(full.attribution.click_ids, { gclid: "G-123" });
  assert.deepEqual(full.items, [
    { product: "Pupuk", product_slug: "pupuk", variant: "1 L", sku: "PUP-1", quantity: 2, unit_price: 50_000, weight_grams: 1000 },
  ]);
  assert.deepEqual(full.amounts, { items: 100_000, discount: 0, shipping: 20_000, cod_fee: 0, total: 120_000 });

  const missing = await call(detailRoute, locals, "/api/ops/v1/orders/INV-99999", "read", { number: "INV-99999" });
  assert.equal(missing.response.status, 404);
});

test("REQ-254: 250 orders page once each, newest first; filters and bad input refuse", async () => {
  const { sqlite, locals, addOrder, addKey } = store();
  await addKey("read", "ops:orders:read");
  for (let index = 0; index < 250; index += 1) addOrder();
  addOrder({ shipping_status: "abandoned" });
  const seen: number[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const { body } = await call(listRoute, locals, `/api/ops/v1/orders?limit=100${cursor ? `&cursor=${cursor}` : ""}`, "read");
    seen.push(...body.data.map((order: { id: number }) => order.id));
    cursor = body.next_cursor;
    pages += 1;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(seen.length, 250, "the abandoned lead is not an order");
  assert.equal(new Set(seen).size, 250);
  // Newest first by creation, ties broken by id: the fixture repeats each second.
  const created = (id: number) => (sqlite.prepare("SELECT created_at FROM orders WHERE id = ?").get(id) as { created_at: string }).created_at;
  const sortKey = (id: number) => `${created(id)}#${String(id).padStart(6, "0")}`;
  assert.deepEqual(seen, [...seen].sort((a, b) => sortKey(b).localeCompare(sortKey(a))));

  const leads = (await call(listRoute, locals, "/api/ops/v1/orders?kind=lead", "read")).body.data;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].kind, "lead");
  for (const query of ["limit=101", "limit=0", "kind=x", "status=DROP%20TABLE", "date_filter=nope", "cursor=xyz", "updated_since=yesterday"]) {
    assert.equal((await call(listRoute, locals, `/api/ops/v1/orders?${query}`, "read")).response.status, 400, query);
  }
});

test("REQ-254: updated_since syncs what changed, once, in change order, over the index", async () => {
  const { sqlite, locals, addOrder, addKey } = store();
  await addKey("read", "ops:orders:read");
  const first = addOrder();
  const second = addOrder();
  addOrder();
  const stamp = (id: number) => (sqlite.prepare("SELECT updated_at FROM orders WHERE id = ?").get(id) as { updated_at: string }).updated_at;
  assert.ok(Date.parse(stamp(first)), "an insert is stamped");

  sqlite.exec(`UPDATE orders SET updated_at = '2020-01-01T00:00:00.000Z'`);
  // Any later write advances it, whichever path makes it.
  sqlite.prepare("UPDATE orders SET shipping_status = 'processing' WHERE id = ?").run(second);
  assert.ok(stamp(second) > "2025-01-01", "an update is stamped now");
  sqlite.prepare("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ?").run("2099-06-01T00:00:00.000Z", first);
  assert.equal(stamp(first), "2099-06-01T00:00:00.000Z", "a writer that sets it keeps its value");

  const { body } = await call(listRoute, locals, `/api/ops/v1/orders?updated_since=2021-01-01T00:00:00Z&limit=1`, "read");
  const synced = [body.data[0].id];
  let cursor = body.next_cursor;
  while (cursor) {
    const next = (await call(listRoute, locals, `/api/ops/v1/orders?updated_since=2021-01-01T00:00:00Z&limit=1&cursor=${cursor}`, "read")).body;
    synced.push(...next.data.map((order: { id: number }) => order.id));
    cursor = next.next_cursor;
  }
  // A sync cursor does not page the browse order, nor the reverse.
  assert.equal((await call(listRoute, locals, `/api/ops/v1/orders?cursor=${body.next_cursor}`, "read")).response.status, 400);
  // Only the two that changed after the 2020 baseline, the live stamp (now) first.
  assert.deepEqual(synced, [second, first]);

  const plan = sqlite
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM orders o WHERE o.updated_at > ? ORDER BY o.updated_at ASC, o.id ASC LIMIT 10")
    .all("2029-01-01") as { detail: string }[];
  assert.match(plan.map((row) => row.detail).join(" "), /orders_updated_at_id/);
});

test("REQ-264: the contract is served to an ops key, refused to a storefront key, never cross-origin", async () => {
  const { locals, addKey, audit } = store();
  await addKey("read", "ops:orders:read");
  await addKey("storefront-all", "storefront:read,catalog:read,orders:read");
  const { response, body } = await call(openApiRoute, locals, "/api/ops/v1/openapi.json", "read");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/vnd.oai.openapi+json;version=3.1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const [name] of response.headers) assert.doesNotMatch(name, /^access-control-/i);
  assert.equal(body.openapi, "3.1.0");
  assert.equal((await call(openApiRoute, locals, "/api/ops/v1/openapi.json", "storefront-all")).response.status, 403);
  assert.deepEqual(audit().map((row) => [row.operation, row.status_code]), [
    ["ops.openApiRead", 200],
    ["ops.openApiRead", 403],
  ]);
});

test("every route under /api/ops/v1 is in the operations table", () => {
  const root = "src/pages/api/ops/v1";
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) files.push(full);
    }
  };
  walk(root);
  const registered = new Set<string>(Object.values(OPS_OPERATIONS).map((operation) => operation.path));
  for (const file of files) {
    const path = `/${file.replace(/^src\/pages\//, "").replace(/\.ts$/, "").replace(/\/index$/, "")}`
      .replace(/\[([^\]]+)\]/g, "{$1}");
    assert.ok(registered.has(path), `${file} → ${path} is not in OPS_OPERATIONS`);
  }
});

test("REQ-265: only the owner issues, changes or revokes a key with an ops scope", async () => {
  const { locals, sqlite, addKey } = store();
  await addKey("ops-key", "ops:orders:read");
  await addKey("store-key", "catalog:read");
  const as = (role: string, method: "POST" | "PATCH" | "DELETE", body: unknown) =>
    developerRoute[method]({
      request: new Request("https://toko.test/api/admin/settings/developer", { method, body: JSON.stringify(body) }),
      locals: { ...locals, admin: { username: role, role } },
    } as never) as Promise<Response>;
  assert.equal((await as("admin", "POST", { name: "Agen", scopes: ["ops:orders:read"] })).status, 403);
  assert.equal((await as("admin", "POST", { name: "Toko", scopes: ["catalog:read"] })).status, 201);
  assert.equal((await as("admin", "PATCH", { id: 1, scopes: ["catalog:read"] })).status, 403, "cannot strip an ops key");
  assert.equal((await as("admin", "PATCH", { id: 2, scopes: ["ops:orders:read"] })).status, 403, "cannot grant ops");
  assert.equal((await as("admin", "DELETE", { id: 1 })).status, 403);
  assert.equal((await as("owner", "POST", { name: "Agen", scopes: ["ops:orders:read", "ops:orders:read_pii"] })).status, 201);
  assert.equal((await as("owner", "DELETE", { id: 1 })).status, 200);
  const created = sqlite.prepare("SELECT scopes FROM developer_api_keys WHERE name = 'Agen'").get() as { scopes: string };
  assert.equal(created.scopes, "ops:orders:read,ops:orders:read_pii");
});

test("REQ-252: a key is created or changed only with an explicit scope list", async () => {
  const { locals, addKey } = store();
  await addKey("ops-key", "ops:orders:read");
  const owner = (method: "POST" | "PATCH", body: unknown) =>
    developerRoute[method]({
      request: new Request("https://toko.test/api/admin/settings/developer", { method, body: JSON.stringify(body) }),
      locals: { ...locals, admin: { username: "owner", role: "owner" } },
    } as never) as Promise<Response>;
  assert.equal((await owner("POST", { name: "Tanpa scope" })).status, 400);
  assert.equal((await owner("POST", { name: "Kosong", scopes: [] })).status, 400);
  // Omitting the list must not reset an ops key to the storefront defaults.
  assert.equal((await owner("PATCH", { id: 1, rate_limit_per_minute: 60 })).status, 400);
  assert.equal((await owner("PATCH", { id: 1, scopes: ["ops:orders:read"], rate_limit_per_minute: 60 })).status, 200);
});

test("REQ-254: updated_at advances through the lifecycle, the bulk status change, the payment switch and an admin edit", async () => {
  const { sqlite, database, locals, addOrder } = store();
  const id = addOrder({ courier_code: "jne", courier_service: "REG", destination_area_id: "123", public_status_token: "tok" });
  const stamp = () => (sqlite.prepare("SELECT updated_at FROM orders WHERE id = ?").get(id) as { updated_at: string }).updated_at;
  const reset = () => sqlite.prepare("UPDATE orders SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
  const state = () =>
    sqlite
      .prepare("SELECT id, payment_method, payment_status, shipping_status, courier_code, cnote_no, provider_order_id, stock_restored_at FROM orders WHERE id = ?")
      .get(id) as never;

  // The admin PATCH: an edit of the buyer's details, its own UPDATE.
  reset();
  await database.prepare("UPDATE orders SET customer_name = ? WHERE id = ?").bind("Budi S.", id).run();
  assert.ok(stamp() > "2025", "admin edit");

  // The admin PATCH with a status change goes through the lifecycle.
  reset();
  const mutation = database.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").bind("paid", id);
  assert.equal((await applyOrderLifecycleMutation(database, state(), { paymentStatus: "paid" }, mutation)).updated, true);
  assert.ok(stamp() > "2025", "order-lifecycle");
  sqlite.prepare("UPDATE orders SET payment_status = 'unpaid' WHERE id = ?").run(id);

  reset();
  await switchCodOrderPayment(database, locals, id, { payment_method: "manual_transfer", seller_bank_account_id: 1 } as never, "cs");
  assert.equal((sqlite.prepare("SELECT payment_method FROM orders WHERE id = ?").get(id) as { payment_method: string }).payment_method, "manual_transfer");
  assert.ok(stamp() > "2025", "payment-switch");

  reset();
  assert.equal(await updateAdminOrderShippingStatuses(database, [id], "cancelled"), 1);
  assert.ok(stamp() > "2025", "bulk status");
});

test("REQ-255: the detail's amounts and items equal the admin order; an unknown number is 404 and audited", async () => {
  const { sqlite, locals, addOrder, addKey, audit } = store();
  await addKey("read", "ops:orders:read");
  addOrder({
    total_amount: 113_663,
    discount_amount: 10_000,
    cod_service_fee: 3_300,
    cod_service_fee_vat: 363,
    receiver_performance_checked_at: "2026-10-01T00:00:00.000Z",
  });
  const ops = (await call(detailRoute, locals, "/api/ops/v1/orders/INV-10001", "read", { number: "INV-10001" })).body.data;
  const adminResponse = await adminOrderRoute({ params: { id: "INV-10001" }, locals } as never);
  assert.equal(adminResponse.status, 200);
  const admin = ((await adminResponse.json()) as { data: Record<string, any> }).data;
  const adminItems = admin.items.reduce((sum: number, item: any) => sum + item.quantity * item.unit_price, 0);
  assert.deepEqual(ops.amounts, {
    items: adminItems,
    discount: admin.discount_amount,
    shipping: admin.shipping_cost,
    cod_fee: admin.cod_service_fee + admin.cod_service_fee_vat,
    total: admin.total_amount,
  });
  assert.equal(ops.amounts.items - ops.amounts.discount + ops.amounts.shipping + ops.amounts.cod_fee, ops.amounts.total);
  assert.deepEqual(
    ops.items.map((item: any) => [item.sku, item.quantity, item.unit_price, item.weight_grams]),
    admin.items.map((item: any) => [item.variant_sku, item.quantity, item.unit_price, item.weight_grams]),
  );

  const before = audit().length;
  const missing = await call(detailRoute, locals, "/api/ops/v1/orders/INV-99999", "read", { number: "INV-99999" });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "ORDER_NOT_FOUND");
  assert.deepEqual({ ...audit()[before] }, { operation: "ops.orderDetail", outcome: "allowed", status_code: 404 });
  sqlite.close();
});

test("REQ-254: a period is the Jakarta day of creation, as in the admin", async () => {
  const { locals, addOrder, addKey } = store();
  await addKey("read", "ops:orders:read");
  const late = addOrder({ created_at: "2026-10-01T16:59:59.000Z" }); // 23:59 WIB, 1 Oct
  const next = addOrder({ created_at: "2026-10-01T17:00:00.000Z" }); // 00:00 WIB, 2 Oct
  const day = async (date: string) =>
    (await call(listRoute, locals, `/api/ops/v1/orders?date_filter=custom&date_start=${date}&date_end=${date}`, "read")).body.data.map(
      (order: { id: number }) => order.id,
    );
  assert.deepEqual(await day("2026-10-01"), [late]);
  assert.deepEqual(await day("2026-10-02"), [next]);
});

/** The CLI over the real route handlers: `fetch` dispatches to them in-process. */
function cli(locals: App.Locals) {
  const home = mkdtempSync(join(tmpdir(), "adsbook-cli-"));
  const fetchRoutes = (async (input: string | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const detail = url.pathname.match(/^\/api\/ops\/v1\/orders\/([^/]+)$/);
    const route =
      url.pathname === "/api/ops/v1/orders" ? listRoute
      : url.pathname === "/api/ops/v1/openapi.json" ? openApiRoute
      : detail ? detailRoute
      : null;
    if (!route) return new Response("{}", { status: 404 });
    const params = detail ? { number: decodeURIComponent(detail[1]) } : {};
    return route({ request, url, locals, params } as unknown as Parameters<typeof listRoute>[0]);
  }) as typeof fetch;
  const run = async (argv: string[], secret = "") => {
    let stdout = "";
    let stderr = "";
    const code = await runAdsbookCli({
      argv,
      home,
      fetch: fetchRoutes,
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      readSecret: async () => secret,
    });
    return { code, stdout, stderr };
  };
  return { home, run };
}

test("REQ-260: the CLI logs in, lists and shows orders equal to the API, and never prints the key", async () => {
  const { locals, addKey, addOrder } = store();
  const secret = "adsbook_live_cli-secret-value";
  await addKey(secret, "ops:orders:read");
  addOrder({ shipping_status: "pending" });
  addOrder({ shipping_status: "pending" });
  addOrder({ shipping_status: "delivered" });
  const { home, run } = cli(locals);
  const outputs: string[] = [];
  const record = <T extends { stdout: string; stderr: string }>(result: T) => {
    outputs.push(result.stdout, result.stderr);
    return result;
  };

  assert.equal(record(await run(["orders", "list"])).code, 1, "no login yet");
  assert.equal(record(await run(["login", "--url", "http://toko.test"], secret)).code, 1, "plain http refused");
  const wrong = record(await run(["login", "--url", "https://toko.test"], "not-a-key"));
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /401/);
  assert.throws(() => statPath(credentialsPath(home)), "a refused key is not stored");

  const login = record(await run(["login", "--url", "toko.test/admin"], `${secret}\n`));
  assert.equal(login.code, 0, login.stderr);
  assert.equal(statPath(credentialsPath(home)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(credentialsPath(home), "utf8")).url, "https://toko.test");

  const list = record(await run(["orders", "list", "--json", "--status", "pending"]));
  assert.equal(list.code, 0, list.stderr);
  const api = await call(listRoute, locals, "/api/ops/v1/orders?status=pending", secret);
  assert.deepEqual(JSON.parse(list.stdout), api.body.data);
  assert.equal(JSON.parse(list.stdout).length, 2);

  const paged = record(await run(["orders", "list", "--limit", "1"]));
  assert.match(paged.stdout, /^NOMOR/);
  assert.match(paged.stdout, /2026-10-01 07:00 WIB/, "times read in the store's day, not UTC");
  assert.match(paged.stderr, /--cursor \S+/);

  const number = api.body.data[0].number as string;
  const show = record(await run(["orders", "show", number.toLowerCase(), "--json"]));
  const detail = await call(detailRoute, locals, `/api/ops/v1/orders/${number}`, secret, { number });
  assert.deepEqual(JSON.parse(show.stdout), detail.body.data);
  assert.match(record(await run(["orders", "show", number])).stdout, /Total\s+120\.000/);
  const missing = record(await run(["orders", "show", "INV-99999"]));
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /404 \[ORDER_NOT_FOUND\]/);
  assert.equal(record(await run(["orders", "list", "--limit", "500"])).code, 1);

  for (const text of outputs) assert.ok(!text.includes(secret), "the key reached stdout or stderr");

  assert.equal((await run(["logout"])).code, 0);
  assert.throws(() => statPath(credentialsPath(home)));
});
