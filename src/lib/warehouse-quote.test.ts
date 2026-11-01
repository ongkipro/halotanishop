import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolveTrustedHeadlessShipping } from "./headless-checkout.ts";
import { resolveEligibleShippingRates } from "./shipping-quote.ts";

// Routes import their siblings without an extension, as Astro allows.
const extensionResolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[a-z0-9]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
const { GET: shippingRatesRoute } = await import("../pages/api/shipping-rates.ts");
extensionResolver.deregister();

/**
 * REQ-242: a store with one warehouse quotes exactly as it did before A42.
 *
 * The expected values below were recorded by running this file against the
 * tree *before* the multi-warehouse change (first-warehouse read, no
 * migration), and the same file passes after it with the migration applied.
 * Nothing here may be edited to make a later change pass: a one-warehouse
 * store whose quote, route answer or Mengantar request differs is the bug.
 */

type SqlValue = null | number | string;

const MIGRATIONS_DIR = new URL("../db/migrations/", import.meta.url);
// Found by suffix, never by number: integration renumbers migrations.
const multiWarehouseMigration = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_multi_warehouse.sql"),
);

class Statement {
  readonly sqlite: DatabaseSync;
  readonly sql: string;
  readonly values: SqlValue[];
  constructor(sqlite: DatabaseSync, sql: string, values: SqlValue[] = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: SqlValue[]) {
    return new Statement(this.sqlite, this.sql, values);
  }
  async first<T>() {
    return (this.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values) as T[], meta: {} };
  }
  async run() {
    const info = this.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
}

/** The pre-A42 warehouses shape (0000 + 0001 + 0002), one row, then the A42 migration if it exists. */
export function createOneWarehouseStore() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE stores (
      id INTEGER PRIMARY KEY, name TEXT,
      mengantar_api_key TEXT, mengantar_base_url TEXT,
      autolaris_api_key TEXT, autolaris_base_url TEXT
    );
    INSERT INTO stores VALUES (1, 'Toko', 'qa-key', 'https://mengantar.example.test', NULL, NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT, is_active INTEGER);
    INSERT INTO products VALUES (1, 'Sepatu', 1);
    CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER, title TEXT, price INTEGER, weight_grams INTEGER);
    INSERT INTO product_variants VALUES (7, 1, 'Hitam 42', 150000, 1250);
    CREATE TABLE courier_rules (id INTEGER PRIMARY KEY, courier_code TEXT, is_enabled INTEGER, is_cod_enabled INTEGER);
    INSERT INTO courier_rules VALUES (1, 'SiCepat', 1, 1), (2, 'JNE', 1, 0);
    CREATE TABLE warehouses (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      store_id integer NOT NULL,
      name text NOT NULL,
      origin_area_id text NOT NULL,
      pickup_address_id text NOT NULL,
      address text NOT NULL,
      city text NOT NULL,
      province text NOT NULL,
      contact_name text,
      contact_phone text,
      origin_label text
    );
    INSERT INTO warehouses (store_id, name, origin_area_id, pickup_address_id, address, city, province)
    VALUES (1, 'Gudang Bandung', 'area-bandung', 'pickup-bandung', 'Jl. Asia Afrika 1', 'Kota Bandung', 'Jawa Barat');
  `);
  if (multiWarehouseMigration) {
    sqlite.exec(
      readFileSync(new URL(multiWarehouseMigration, MIGRATIONS_DIR), "utf8").replace(
        /--> statement-breakpoint/g,
        "",
      ),
    );
  }
  const database = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
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
  return { sqlite, database };
}

/** A Mengantar stand-in whose price depends on the origin, so a wrong warehouse shows. */
export function stubMengantar(context: { after: (fn: () => void) => void }, failDestination = "") {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url.replace(/\/api\/public\/[^/]+/, "/api/public/<key>"));
    if (url.includes("/address/search")) {
      return Response.json({
        success: true,
        data: [
          { _id: "area-sby-1", CITY_NAME: "Kota Surabaya" },
          { _id: "area-sby-2", CITY_NAME: "Kota Surabaya" },
        ],
      });
    }
    const parsed = new URL(url);
    const destination = parsed.searchParams.get("destination_id") || "";
    if (failDestination && destination === failDestination) throw new TypeError("network down");
    const origin = parsed.searchParams.get("origin_id") || "";
    const base = origin.length * 1_000;
    return Response.json({
      success: true,
      data: {
        SiCepat: { price: base + 500, estimate_delivery: "2-3" },
        JNE: { price: base + 1_500, estimate_delivery: "1-2", unsupported_cod: true },
      },
    });
  };
  return requests;
}

const locals = { runtimeEnv: {} } as unknown as App.Locals;

test("one warehouse: a COD quote with a city is unchanged (REQ-242)", async (context) => {
  const requests = stubMengantar(context);
  const { database } = createOneWarehouseStore();
  const quote = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-sby-0",
    destinationCity: "Kota Surabaya",
    paymentMethod: "cod",
    variantKey: "7",
    quantity: 2,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(quote)), {
    originId: "area-bandung",
    rates: [
      {
        courier_code: "SiCepat",
        courier_service: "SiCepat",
        price: 12_500,
        estimated_days: "2-3",
        unsupported: false,
        unsupported_cod: false,
        cod_fee: 0,
      },
    ],
    warehouse: { id: 1, origin_area_id: "area-bandung", pickup_address_id: "pickup-bandung" },
    variant: { productTitle: "Sepatu", variantTitle: "Hitam 42", unitPrice: 150_000, unitWeightKg: 1.25 },
  });
  assert.deepEqual(requests, [
    "https://mengantar.example.test/api/public/<key>/order/estimate?origin_id=area-bandung&destination_id=area-sby-0&courier=all&weight=2.5",
  ]);
});

test("one warehouse: a prepaid quote without a city is unchanged (REQ-242)", async (context) => {
  const requests = stubMengantar(context);
  const { database } = createOneWarehouseStore();
  const quote = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-aceh-0",
    paymentMethod: "manual_transfer",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(quote)), {
    originId: "area-bandung",
    rates: [
      {
        courier_code: "SiCepat",
        courier_service: "SiCepat",
        price: 12_500,
        estimated_days: "2-3",
        unsupported: false,
        unsupported_cod: false,
        cod_fee: 0,
      },
      {
        courier_code: "JNE",
        courier_service: "JNE",
        price: 13_500,
        estimated_days: "1-2",
        unsupported: false,
        unsupported_cod: true,
        cod_fee: 0,
      },
    ],
    warehouse: { id: 1, origin_area_id: "area-bandung", pickup_address_id: "pickup-bandung" },
  });
  assert.deepEqual(requests, [
    "https://mengantar.example.test/api/public/<key>/order/estimate?origin_id=area-bandung&destination_id=area-aceh-0&courier=all&weight=1",
  ]);
});

test("one warehouse: the COD city-average fallback is unchanged (REQ-242)", async (context) => {
  const requests = stubMengantar(context, "area-sby-0");
  const { database } = createOneWarehouseStore();
  const quote = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-sby-0",
    destinationCity: "Kota Surabaya",
    paymentMethod: "cod",
    variantKey: "7",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(quote)), {
    originId: "area-bandung",
    warehouse: { id: 1, origin_area_id: "area-bandung", pickup_address_id: "pickup-bandung" },
    variant: { productTitle: "Sepatu", variantTitle: "Hitam 42", unitPrice: 150_000, unitWeightKg: 1.25 },
    fallbackUsed: true,
    rates: [
      {
        courier_code: "ICO",
        courier_service: "CITY_AVERAGE",
        price: 13_000,
        estimated_days: "Dikonfirmasi admin",
        unsupported: false,
        unsupported_cod: false,
        cod_fee: 0,
        is_fallback: true,
      },
    ],
  });
  assert.deepEqual(requests, [
    "https://mengantar.example.test/api/public/<key>/order/estimate?origin_id=area-bandung&destination_id=area-sby-0&courier=all&weight=1.25",
    "https://mengantar.example.test/api/public/<key>/address/search?keyword=Kota+Surabaya",
    "https://mengantar.example.test/api/public/<key>/order/estimate?origin_id=area-bandung&destination_id=area-sby-1&courier=all&weight=1.25",
    "https://mengantar.example.test/api/public/<key>/order/estimate?origin_id=area-bandung&destination_id=area-sby-2&courier=all&weight=1.25",
  ]);
});

test("one warehouse: the storefront rate route answers byte-identically (REQ-242)", async (context) => {
  stubMengantar(context);
  const { database } = createOneWarehouseStore();
  const url = new URL(
    "https://toko.test/api/shipping-rates?location_id=area-sby-0&variant_unique_id=7&payment_method=cod&city=Kota+Surabaya",
  );
  const response = await shippingRatesRoute({
    request: new Request(url),
    url,
    locals: { runtimeEnv: { OMS_DB: database } },
  } as unknown as Parameters<typeof shippingRatesRoute>[0]);
  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    '{"success":true,"rates":[{"courier_code":"SiCepat","courier_service":"SiCepat","price":12500,"estimated_days":"2-3","unsupported":false,"unsupported_cod":false,"cod_fee":0}],"items":[{"courier_service_id":1,"courier_code":"SiCepat","courier_service":"SiCepat","name":"SiCepat","shipment_provider_code":"SiCepat","shipping_cost":12500,"estimated_days":"2-3","unsupported":false,"unsupported_cod":false,"cod_fee":0}],"origin_id":"area-bandung","fallback_used":false}',
  );
});

// ---------------------------------------------------------------------------
// Several warehouses (A-407, A-408). Added after the golden tests above were
// recorded; those stay byte-identical.

const { POST: submitOrderRoute } = await (async () => {
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
  try {
    return await import("../pages/api/submit-order.ts");
  } finally {
    resolver.deregister();
  }
})();

/** Bandung (primary, Jawa Barat) plus Surabaya (Jawa Timur, also serving Bali). */
function createTwoWarehouseStore() {
  const store = createOneWarehouseStore();
  store.sqlite.exec(`
    ALTER TABLE stores ADD cod_disabled_province_codes TEXT;
    INSERT INTO warehouses (store_id, name, origin_area_id, pickup_address_id, address, city, province, served_provinces)
    VALUES (1, 'Gudang Surabaya', 'area-surabaya', 'pickup-surabaya', 'Jl. Tunjungan 1', 'Kota Surabaya', 'Jawa Timur', '["JI","BA"]');
  `);
  return store;
}

const estimateOrigins = (requests: string[]) =>
  requests
    .filter((url) => url.includes("/order/estimate"))
    .map((url) => new URL(url).searchParams.get("origin_id"));

test("two warehouses: a Jawa Timur buyer is quoted from Surabaya with one rate call (A-407)", async (context) => {
  const requests = stubMengantar(context);
  const { database } = createTwoWarehouseStore();
  const quote = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-sby-0",
    destinationCity: "Kota Surabaya",
    paymentMethod: "cod",
    variantKey: "7",
  });
  assert.deepEqual(quote.warehouse, { id: 2, origin_area_id: "area-surabaya", pickup_address_id: "pickup-surabaya" });
  assert.equal(quote.originId, "area-surabaya");
  assert.deepEqual(estimateOrigins(requests), ["area-surabaya"]);
  assert.equal(requests.length, 1);
});

test("two warehouses: an added province, an island match and the primary fallback (A-407)", async (context) => {
  const requests = stubMengantar(context);
  const { database } = createTwoWarehouseStore();
  const quoteFor = (city: string) =>
    resolveEligibleShippingRates(database, locals, {
      destinationId: "area-x",
      destinationCity: city,
      paymentMethod: "manual_transfer",
    });
  assert.equal((await quoteFor("Kabupaten Badung")).warehouse?.id, 2, "Bali is served by Surabaya");
  assert.equal((await quoteFor("Kota Semarang")).warehouse?.id, 1, "Jawa Tengah: covered by neither, same island, tie to primary");
  assert.equal((await quoteFor("Kota Banda Aceh")).warehouse?.id, 1, "Aceh: no coverage, no island, primary");
  assert.equal((await quoteFor("Kota Banjar")).warehouse?.id, 1, "an ambiguous city is quoted from the primary");
  assert.equal(
    (await resolveEligibleShippingRates(database, locals, { destinationId: "area-x", paymentMethod: "cod" })).warehouse?.id,
    1,
    "no city at all: primary",
  );
  // One rate call per quote, never one per warehouse.
  assert.equal(requests.length, 5);
});

test("two warehouses: a not-ready or inactive warehouse is never chosen (REQ-238)", async (context) => {
  stubMengantar(context);
  const { database, sqlite } = createTwoWarehouseStore();
  const quote = () =>
    resolveEligibleShippingRates(database, locals, {
      destinationId: "area-sby-0",
      destinationCity: "Kota Surabaya",
      paymentMethod: "cod",
    });
  sqlite.exec("UPDATE warehouses SET pickup_address_id = '' WHERE id = 2");
  assert.equal((await quote()).warehouse?.id, 1);
  sqlite.exec("UPDATE warehouses SET pickup_address_id = 'pickup-surabaya', is_active = 0 WHERE id = 2");
  assert.equal((await quote()).warehouse?.id, 1);
});

test("an admin re-quote keeps the order's own warehouse (REQ-241)", async (context) => {
  const requests = stubMengantar(context);
  const { database, sqlite } = createTwoWarehouseStore();
  const quote = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-aceh-0",
    paymentMethod: "cod",
    warehouseId: 2,
  });
  assert.equal(quote.warehouse?.id, 2);
  assert.deepEqual(estimateOrigins(requests), ["area-surabaya"]);
  // A middle-form order without a warehouse is chosen by its province.
  assert.equal(
    (await resolveEligibleShippingRates(database, locals, { destinationId: "area-x", paymentMethod: "cod", destinationProvince: "Jawa Timur" })).warehouse?.id,
    2,
  );
  // Once the warehouse is made inactive it is never quoted from again: the
  // re-quote is chosen by the order's province, as the admin save passes it.
  sqlite.exec("UPDATE warehouses SET is_active = 0 WHERE id = 2");
  assert.equal(
    (await resolveEligibleShippingRates(database, locals, { destinationId: "area-aceh-0", paymentMethod: "cod", warehouseId: 2, destinationProvince: "Jawa Timur" })).warehouse?.id,
    1,
  );
});

test("an explicit warehouse_id never quotes from an inactive or not-ready warehouse", async (context) => {
  stubMengantar(context);
  const { database, sqlite } = createTwoWarehouseStore();
  const origin = async () =>
    (await rateRoute(database, "destination_id=area-aceh-0&payment_method=cod&warehouse_id=2")).origin_id;
  assert.equal(await origin(), "area-surabaya");
  sqlite.exec("UPDATE warehouses SET is_active = 0 WHERE id = 2");
  assert.equal(await origin(), "area-bandung", "inactive: falls through to the normal choice");
  sqlite.exec("UPDATE warehouses SET is_active = 1, pickup_address_id = '' WHERE id = 2");
  assert.equal(await origin(), "area-bandung", "not ready: falls through to the normal choice");
  // The primary stays quotable whatever its readiness, as before A42 (REQ-242).
  sqlite.exec("UPDATE warehouses SET pickup_address_id = '' WHERE id = 1");
  assert.equal(
    (await rateRoute(database, "destination_id=area-aceh-0&payment_method=cod&warehouse_id=1")).origin_id,
    "area-bandung",
  );
});

async function rateRoute(database: D1Database, query: string) {
  const url = new URL(`https://toko.test/api/shipping-rates?${query}`);
  const response = await shippingRatesRoute({
    request: new Request(url),
    url,
    locals: { runtimeEnv: { OMS_DB: database } },
  } as unknown as Parameters<typeof shippingRatesRoute>[0]);
  return (await response.json()) as { origin_id: string; items: { courier_service_id: number; courier_code: string; shipping_cost: number }[] };
}

test("the admin preview quotes from the order's warehouse or province (REQ-241)", async (context) => {
  stubMengantar(context);
  const { database } = createTwoWarehouseStore();
  assert.equal((await rateRoute(database, "destination_id=area-aceh-0&payment_method=cod&warehouse_id=2")).origin_id, "area-surabaya");
  assert.equal((await rateRoute(database, "destination_id=area-aceh-0&payment_method=cod&province=Jawa+Timur")).origin_id, "area-surabaya");
  assert.equal((await rateRoute(database, "destination_id=area-aceh-0&payment_method=cod")).origin_id, "area-bandung");
});

async function submit(database: D1Database, shippingCost: number) {
  const response = await submitOrderRoute({
    request: new Request("https://toko.test/api/submit-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        submit_token: "sb_warehouse_test_0001",
        customer_name: "Pembeli Surabaya",
        customer_phone: "081234567890",
        address: "Jl. Pemuda Nomor 10",
        district: "Genteng",
        province: "Jawa Timur",
        city: "Kota Surabaya",
        location_id: "area-sby-0",
        payment_method: "cod",
        variant_id: "7",
        quantity: 1,
        shipment_provider_code: "SiCepat",
        courier_service_id: 1,
        shipping_cost: shippingCost,
      }),
    }),
    locals: { runtimeEnv: { OMS_DB: database }, tenant: { siteUrl: "https://toko.test" } },
  } as unknown as Parameters<typeof submitOrderRoute>[0]);
  return { status: response.status, body: (await response.json()) as { code?: string } };
}

test("submit re-verifies the rate from the warehouse the form was quoted from (REQ-240)", async (context) => {
  const requests = stubMengantar(context);
  const { database } = createTwoWarehouseStore();
  // What the storefront form does: quote with location_id and city…
  const shown = await rateRoute(database, "location_id=area-sby-0&variant_unique_id=7&payment_method=cod&city=Kota+Surabaya");
  assert.equal(shown.origin_id, "area-surabaya");
  const price = shown.items.find((item) => item.courier_code === "SiCepat")?.shipping_cost;
  assert.ok(price);
  requests.length = 0;

  // …then submit the same location and city with that price. The quote check
  // passes (the order then fails to persist only because this fixture has no
  // order tables); a different warehouse would have priced it differently.
  const originalError = console.error;
  console.error = () => {};
  context.after(() => {
    console.error = originalError;
  });
  const accepted = await submit(database, price);
  assert.notEqual(accepted.body.code, "SHIPPING_QUOTE_CHANGED");
  assert.equal(accepted.body.code, "ORDER_PERSIST_FAILED");
  assert.deepEqual(estimateOrigins(requests), ["area-surabaya"]);

  // Control: the primary's price for the same buyer is refused.
  const bandungPrice = (await rateRoute(database, "location_id=area-sby-0&variant_unique_id=7&payment_method=cod")).items[0].shipping_cost;
  assert.notEqual(bandungPrice, price);
  const refused = await submit(database, bandungPrice);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "SHIPPING_QUOTE_CHANGED");
});

/** Surabaya's rate call fails (`"error"`) or answers with no rate at all (`"empty"`). */
function breakSurabaya(context: { after: (fn: () => void) => void }, mode: "error" | "empty", alsoBandung = false) {
  const requests = stubMengantar(context);
  const stubbed = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const broken = url.includes("origin_id=area-surabaya") || (alsoBandung && url.includes("origin_id=area-bandung"));
    if (broken && url.includes("/order/estimate")) {
      requests.push(url.replace(/\/api\/public\/[^/]+/, "/api/public/<key>"));
      if (mode === "error") throw new TypeError("network down");
      return Response.json({ success: true, data: {} });
    }
    return stubbed(input, init);
  };
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args);
  context.after(() => {
    console.warn = originalWarn;
  });
  return { requests, warnings };
}

for (const mode of ["error", "empty"] as const) {
  test(`a branch warehouse whose rate call is ${mode === "error" ? "failing" : "empty"} hands the quote to the primary`, async (context) => {
    const { requests, warnings } = breakSurabaya(context, mode);
    const { database } = createTwoWarehouseStore();
    for (const paymentMethod of ["cod", "manual_transfer"]) {
      requests.length = 0;
      const quote = await resolveEligibleShippingRates(database, locals, {
        destinationId: "area-sby-0",
        destinationCity: "Kota Surabaya",
        paymentMethod,
        variantKey: "7",
      });
      assert.deepEqual(quote.warehouse, { id: 1, origin_area_id: "area-bandung", pickup_address_id: "pickup-bandung" });
      assert.equal(quote.originId, "area-bandung");
      assert.equal(quote.primaryFallbackFrom, 2);
      assert.equal(quote.fallbackUsed, undefined, "real primary rates, not the city average");
      assert.equal(quote.rates[0]?.price, 12 * 1_000 + 500);
      assert.deepEqual(estimateOrigins(requests), ["area-surabaya", "area-bandung"]);
    }
    assert.deepEqual(warnings[0], [
      "shipping-quote-primary-fallback",
      { warehouse_id: 2, primary_id: 1, reason: mode === "error" ? "error" : "no_rates" },
    ]);
  });
}

test("a named warehouse (admin re-quote, its preview) that fails is never swapped for the primary (REQ-241)", async (context) => {
  const { requests, warnings } = breakSurabaya(context, "error");
  const { database } = createTwoWarehouseStore();
  await assert.rejects(
    resolveEligibleShippingRates(database, locals, {
      destinationId: "area-aceh-0",
      paymentMethod: "cod",
      warehouseId: 2,
    }),
    /network down/,
  );
  assert.deepEqual(estimateOrigins(requests), ["area-surabaya"]);
  assert.equal(warnings.length, 0);
});

test("a failing branch whose primary has no rate either surfaces the branch's error", async (context) => {
  breakSurabaya(context, "error");
  const { database } = createTwoWarehouseStore();
  const stubbed = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input).includes("origin_id=area-bandung") ? Response.json({ success: true, data: {} }) : stubbed(input, init);
  await assert.rejects(
    resolveEligibleShippingRates(database, locals, {
      destinationId: "area-sby-0",
      destinationCity: "Kota Surabaya",
      paymentMethod: "manual_transfer",
    }),
    /network down/,
  );
});

test("when the primary fails too, prepaid fails loudly and COD takes the primary's city average", async (context) => {
  const { requests } = breakSurabaya(context, "error", true);
  const { database } = createTwoWarehouseStore();
  await assert.rejects(
    resolveEligibleShippingRates(database, locals, {
      destinationId: "area-sby-0",
      destinationCity: "Kota Surabaya",
      paymentMethod: "manual_transfer",
    }),
    /network down/,
  );
  requests.length = 0;
  const quote = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-sby-0",
    destinationCity: "Kota Surabaya",
    paymentMethod: "cod",
  });
  assert.equal(quote.warehouse?.id, 1);
  assert.equal(quote.primaryFallbackFrom, 2);
  // Rate calls: Surabaya, Bandung, then the city samples, all from Bandung.
  assert.deepEqual(estimateOrigins(requests), ["area-surabaya", "area-bandung", "area-bandung", "area-bandung"]);
});

test("a primary chosen by the quote is not retried when it fails", async (context) => {
  const { requests, warnings } = breakSurabaya(context, "error");
  const { database, sqlite } = createTwoWarehouseStore();
  sqlite.exec("UPDATE warehouses SET is_primary = 0 WHERE id = 1; UPDATE warehouses SET is_primary = 1 WHERE id = 2;");
  await assert.rejects(
    resolveEligibleShippingRates(database, locals, { destinationId: "area-aceh-0", paymentMethod: "manual_transfer" }),
    /network down/,
  );
  assert.deepEqual(estimateOrigins(requests), ["area-surabaya"]);
  assert.equal(warnings.length, 0);
});

test("the form quoted from the primary after a branch failure submits at that price", async (context) => {
  const { requests } = breakSurabaya(context, "error");
  const { database } = createTwoWarehouseStore();
  const shown = await rateRoute(database, "location_id=area-sby-0&variant_unique_id=7&payment_method=cod&city=Kota+Surabaya");
  assert.equal(shown.origin_id, "area-bandung");
  const price = shown.items.find((item) => item.courier_code === "SiCepat")?.shipping_cost;
  assert.ok(price);
  requests.length = 0;
  const originalError = console.error;
  console.error = () => {};
  context.after(() => {
    console.error = originalError;
  });
  const accepted = await submit(database, price);
  assert.notEqual(accepted.body.code, "SHIPPING_QUOTE_CHANGED");
  assert.equal(accepted.body.code, "ORDER_PERSIST_FAILED");
});

const headlessOrder = {
  customer_name: "Pembeli Surabaya",
  customer_phone: "081234567890",
  customer_email: "",
  address: "Jl. Pemuda Nomor 10",
  district: "Genteng",
  province: "Jawa Timur",
  postal_code: "",
  payment_method: "cod" as const,
  variant_id: "7",
  quantity: 1,
  submit_token: "sb_headless_test_0001",
};

test("headless checkout charges the warehouse its rate call was quoted from", async (context) => {
  stubMengantar(context);
  const { database, sqlite } = createTwoWarehouseStore();
  const resolver = (input: Parameters<typeof resolveEligibleShippingRates>[2]) =>
    resolveEligibleShippingRates(database, locals, input);
  const checkout = (extra: Record<string, unknown>) =>
    resolveTrustedHeadlessShipping(
      { destination_id: "area-sby-0", courier_code: "SiCepat", courier_service_id: 1, city: "Kota Surabaya", ...extra },
      headlessOrder,
      resolver,
    );
  // A client that quotes without `city` (every client before A42) is shown the
  // primary's price; checkout must charge that, even though it sends a city
  // that maps to the Surabaya warehouse.
  const shownWithoutCity = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-sby-0",
    paymentMethod: "cod",
    variantKey: "7",
  });
  assert.equal(shownWithoutCity.warehouse?.id, 1);
  // With that city and no warehouse_id, checkout cannot tell which price the
  // rate call showed (with `city` it was Surabaya's), so it refuses rather than
  // guess (audit finding 23). Without a city only the primary was quotable.
  await assert.rejects(checkout({}), (error: unknown) =>
    error instanceof Error && Reflect.get(error, "code") === "SHIPPING_QUOTE_CHANGED" && Reflect.get(error, "status") === 409,
  );
  const legacy = await checkout({ city: undefined });
  assert.equal(legacy.warehouseId, 1);
  assert.equal(legacy.shippingCost, shownWithoutCity.rates[0].price);

  // A client that quoted with `city` echoes the returned warehouse_id.
  const shownWithCity = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-sby-0",
    paymentMethod: "cod",
    variantKey: "7",
    destinationProvince: "JI",
  });
  assert.equal(shownWithCity.warehouse?.id, 2);
  const echoed = await checkout({ warehouse_id: 2 });
  assert.equal(echoed.warehouseId, 2);
  assert.equal(echoed.shippingCost, shownWithCity.rates[0].price);
  assert.notEqual(echoed.shippingCost, legacy.shippingCost);

  // The quoted warehouse went inactive between quote and checkout: refuse, never re-price silently.
  sqlite.exec("UPDATE warehouses SET is_active = 0 WHERE id = 2");
  await assert.rejects(checkout({ warehouse_id: 2 }), (error: unknown) =>
    error instanceof Error && Reflect.get(error, "code") === "SHIPPING_QUOTE_CHANGED" && Reflect.get(error, "status") === 409,
  );
});

test("headless checkout on a one-warehouse store with a city makes one rate call and charges as before A42", async (context) => {
  const requests = stubMengantar(context);
  const { database } = createOneWarehouseStore();
  const before = await resolveEligibleShippingRates(database, locals, {
    destinationId: "area-sby-0",
    paymentMethod: "cod",
    variantKey: "7",
  });
  requests.length = 0;
  const charged = await resolveTrustedHeadlessShipping(
    { destination_id: "area-sby-0", courier_code: "SiCepat", courier_service_id: 1, city: "Kota Surabaya" },
    headlessOrder,
    (input) => resolveEligibleShippingRates(database, locals, input),
  );
  assert.equal(estimateOrigins(requests).length, 1);
  assert.equal(charged.shippingCost, before.rates[0].price);
  assert.equal(charged.warehouseId, before.warehouse?.id);
});

test("headless checkout on a store with no warehouse rows (env origin) makes one rate call", async (context) => {
  const requests = stubMengantar(context);
  const { sqlite, database } = createOneWarehouseStore();
  sqlite.exec("DELETE FROM warehouses");
  const envLocals = { runtimeEnv: { MENGANTAR_ORIGIN_AREA_ID: "area-bandung" } } as unknown as App.Locals;
  const charged = await resolveTrustedHeadlessShipping(
    { destination_id: "area-sby-0", courier_code: "SiCepat", courier_service_id: 1, city: "Kota Surabaya" },
    headlessOrder,
    (input) => resolveEligibleShippingRates(database, envLocals, input),
  );
  assert.equal(estimateOrigins(requests).length, 1);
  assert.ok(charged.shippingCost > 0);
});

test("headless checkout fails closed when the city warehouse's quote fails", async (context) => {
  stubMengantar(context);
  const stubbed = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("origin_id=area-surabaya")) throw new TypeError("network down");
    return stubbed(input, init);
  };
  const { database } = createTwoWarehouseStore();
  await assert.rejects(
    resolveTrustedHeadlessShipping(
      { destination_id: "area-sby-0", courier_code: "SiCepat", courier_service_id: 1, city: "Kota Surabaya" },
      headlessOrder,
      (input) => resolveEligibleShippingRates(database, locals, input),
    ),
    /network down/,
  );
});
