import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveMetaEventId } from "./meta-capi.ts";
import { META_EXTERNAL_ID_COOKIE } from "./click-ids.ts";
import { sha256Hex } from "./meta-identity.ts";

// Meta only deduplicates a browser Pixel event against a server CAPI event when
// both carry the same event_id. The server leg is authoritative and keys Purchase
// on the order number (`resolveMetaEventId`), so the browser leg on /thanks must
// quote that same order number instead of minting one of its own.

const TRACKER_SOURCE = readFileSync(
  new URL("../components/storefront/tracking/MetaThanksTracker.astro", import.meta.url),
  "utf8",
);

const INLINE_SCRIPT = (() => {
  const match = TRACKER_SOURCE.match(/<script\b[^>]*\bis:inline\b[^>]*>([\s\S]*)<\/script>/);
  assert.ok(match, "MetaThanksTracker must keep its inline tracking script");
  return match[1];
})();

type OrderStatus = Record<string, unknown>;

type TrackerRun = {
  pixelEventIds: string[];
  postedPayloads: Record<string, unknown>[];
  pixelInitCalls: Record<string, unknown>[];
  /** Any `fbq('init')` the tracker issues itself — which it must never do. */
  strayFbqInits: Record<string, unknown>[];
  pixelLoadPulled: number;
};

function storageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

/**
 * Executes the real inline tracker script from MetaThanksTracker.astro against a
 * stubbed browser, with /api/order-status answering `orderStatus`.
 */
async function runTracker(
  orderStatus: OrderStatus,
  thanksStateOverrides: Record<string, unknown> = {},
  documentCookie = "",
): Promise<TrackerRun> {
  const run: TrackerRun = {
    pixelEventIds: [],
    postedPayloads: [],
    pixelInitCalls: [],
    strayFbqInits: [],
    pixelLoadPulled: 0,
  };
  const thanksState = {
    order_id: "INV-10042",
    order_pk: "42",
    status_token: "status-token-42",
    payment_method: "cod",
    event_id: "lead_asahan_1754400000000_ab12cd",
    name: "Siti Rahayu",
    phone: "081234567890",
    product_id: "434683",
    product_name: "Asahan Portable",
    product_price: 150_000,
    quantity: 1,
    ...thanksStateOverrides,
  };

  const sessionStorage = storageStub();
  sessionStorage.setItem("thanks_state", JSON.stringify(thanksState));

  const fetchStub = (input: string, init?: { body?: string }) => {
    if (input.startsWith("/api/order-status")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(orderStatus),
      });
    }
    if (input.startsWith("/api/meta-event")) {
      run.postedPayloads.push(JSON.parse(String(init?.body || "{}")));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    throw new Error(`unexpected request: ${input}`);
  };

  const windowStub: Record<string, unknown> = {
    __META_PIXEL_ID__: "1234567890",
    // What `MetaPixelBase` exposes. fbevents honours advanced matching once per
    // pixel id, so the tracker must hand its keys to the single init the pixel
    // owns rather than issuing one of its own.
    __PS_META_INIT__: (advancedMatching?: Record<string, unknown>) => {
      run.pixelInitCalls.push(advancedMatching ?? {});
      return true;
    },
    __PS_LOAD_META_PIXEL__: () => {
      run.pixelLoadPulled += 1;
    },
    // The other half of the contract: no tracker calls `fbq('track')` itself.
    // The real hook waits for the init to be issued; here it already is.
    __PS_META_TRACK__: (eventName: string, data?: unknown, options?: { eventID?: string }) => {
      (windowStub.fbq as (...args: unknown[]) => unknown)("track", eventName, data, options);
    },
    location: {
      search: "",
      href: "https://permatamall.shop/thanks",
    },
    fbq: (
      action: string,
      _eventName: unknown,
      arg3?: unknown,
      options?: { eventID?: string },
    ) => {
      if (action === "track") run.pixelEventIds.push(String(options?.eventID || ""));
      if (action === "init" && arg3 && typeof arg3 === "object") {
        run.strayFbqInits.push(arg3 as Record<string, unknown>);
      }
    },
  };

  const tracker = new Function(
    "tenantName",
    "metaExternalIdCookie",
    "window",
    "document",
    "navigator",
    "sessionStorage",
    "localStorage",
    "fetch",
    INLINE_SCRIPT,
  );

  tracker(
    "Permatamall",
    META_EXTERNAL_ID_COOKIE,
    windowStub,
    { cookie: documentCookie },
    { userAgent: "node-test" },
    sessionStorage,
    storageStub(),
    fetchStub,
  );

  // The script fires asynchronously (status fetch + SHA-256 hashing); wait
  // for both legs, still bounded, since neither is guaranteed to land first.
  for (
    let i = 0;
    i < 40 && (run.postedPayloads.length === 0 || run.pixelEventIds.length === 0);
    i += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return run;
}

test("browser and server Purchase legs derive the same event_id for one order", async () => {
  const run = await runTracker({
    success: true,
    order_number: "INV-10042",
    payment_status: "unpaid",
    payment_method: "cod",
    is_paid: false,
    total_amount: 189_000,
  });

  const serverEventId = resolveMetaEventId("Purchase", "browser-generated-event-id", "INV-10042");

  assert.equal(run.postedPayloads.length, 1, "the browser must post exactly one Purchase to CAPI");
  assert.equal(run.pixelEventIds.length, 1, "the browser Pixel must fire exactly one Purchase");
  assert.equal(serverEventId, "INV-10042");
  assert.equal(run.pixelEventIds[0], serverEventId);
  assert.equal(run.postedPayloads[0].event_id, serverEventId);
  // The route re-resolves the order from these, and substitutes its order_number
  // as the event_id - the same string the Pixel just used.
  assert.equal(run.postedPayloads[0].order_number, "INV-10042");
  assert.equal(run.postedPayloads[0].status_token, "status-token-42");
});

test("the browser Pixel's Purchase advanced-matching object hashes city, state, zip and country, not just phone and name", async () => {
  // The CAPI leg (postedPayloads[0].user_data, asserted below) has always
  // carried the buyer's address on Purchase. The browser Pixel's own
  // `fbq('init', pixelId, {...})` call used to stop at ph/fn/ln — a full
  // match key server-side, a partial one client-side, for the same order.
  //
  // And then, for a while, it carried all eight and Meta still saw one. See
  // the `strayFbqInits` assertion below: fbevents honours advanced matching
  // exactly once per pixel id and discards later calls in silence, so a second
  // `fbq('init')` from here hashed eight keys into nothing.
  const run = await runTracker(
    {
      success: true,
      order_number: "INV-10042",
      payment_status: "unpaid",
      payment_method: "cod",
      is_paid: false,
      total_amount: 189_000,
    },
    {
      city: "Jakarta Selatan",
      province: "DKI Jakarta",
      postal_code: "12430",
    },
  );

  assert.equal(
    run.strayFbqInits.length,
    0,
    "the tracker must never call fbq('init') itself — fbevents would discard it",
  );
  assert.equal(
    run.pixelInitCalls.length,
    1,
    "matching goes to MetaPixelBase's single init, exactly once",
  );
  assert.equal(run.pixelLoadPulled, 1, "a conversion must not wait on the deferral timer");
  const advancedMatching = run.pixelInitCalls[0];
  assert.equal(
    advancedMatching.client_user_agent,
    undefined,
    "client_user_agent is a CAPI field, not a Pixel advanced-matching key",
  );
  for (const key of ["ph", "fn", "ln", "ct", "st", "zp", "country", "external_id"]) {
    assert.match(
      String(advancedMatching[key] ?? ""),
      /^[a-f0-9]{64}$/,
      `advanced matching's ${key} must be a SHA-256 hex hash`,
    );
  }
  assert.equal(advancedMatching.ph, advancedMatching.external_id);

  // The CAPI leg on the same Purchase must describe the same address, not a
  // different or narrower one.
  const capiUserData = run.postedPayloads[0].user_data as Record<string, unknown>;
  assert.equal(capiUserData.city, "Jakarta Selatan");
  assert.equal(capiUserData.province, "DKI Jakarta");
  assert.equal(capiUserData.postal_code, "12430");
  assert.equal(capiUserData.country, "id");
});

test("Purchase keeps one stable first-party external_id across Pixel and CAPI", async () => {
  const externalId = "0123456789abcdef0123456789abcdef";
  const run = await runTracker(
    {
      success: true,
      order_number: "INV-10042",
      payment_status: "unpaid",
      payment_method: "cod",
      is_paid: false,
      total_amount: 189_000,
    },
    {},
    `${META_EXTERNAL_ID_COOKIE}=${externalId}`,
  );

  assert.equal(run.pixelInitCalls[0].external_id, await sha256Hex(externalId));
  const capiUserData = run.postedPayloads[0].user_data as Record<string, unknown>;
  assert.equal(capiUserData.external_id, externalId);
  assert.notEqual(run.pixelInitCalls[0].external_id, capiUserData.external_id);
});

test("a Purchase without a resolvable order number emits nothing at all", async () => {
  const run = await runTracker({
    success: true,
    order_number: "",
    payment_status: "unpaid",
    payment_method: "cod",
    is_paid: false,
    total_amount: 189_000,
  });

  assert.equal(run.pixelEventIds.length, 0, "no order number means no Pixel Purchase");
  assert.equal(run.postedPayloads.length, 0, "no order number means no CAPI Purchase");
});

test("no checkout form mints a random Purchase event_id any more", () => {
  for (const script of ["../scripts/form-hybrid.ts", "../scripts/form-middle.ts"]) {
    const source = readFileSync(new URL(script, import.meta.url), "utf8");
    assert.ok(
      !/createId\(`purchase_/.test(source),
      `${script} must not mint a Purchase event_id the server will never see`,
    );
    assert.ok(
      !/purchase_event_id/.test(source),
      `${script} must not carry a browser-minted purchase_event_id into thanks state`,
    );
  }
});

test("embed parent surfaces never emit Purchase before verified thanks", () => {
  const widgetSource = readFileSync(
    new URL("../../public/adsbook-form-widget.js", import.meta.url),
    "utf8",
  );

  const navigationSource = readFileSync(
    new URL("./checkout-navigation.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(widgetSource, /["']Purchase["']/);
  assert.doesNotMatch(widgetSource, /adsbook:order-complete/);
  assert.doesNotMatch(navigationSource, /adsbook:order-complete/);
});

// Audit 2026-10-31 tracking H-1: opened in a fresh tab, the thanks state holds
// only the order key and token (no method, no order number), and the tracker
// used to default to COD — firing a Purchase for unpaid and cancelled orders.
test("a fresh tab decides Purchase from the order's own method and state, not from storage", async () => {
  const freshTab = { payment_method: undefined, order_id: undefined };
  const status = { success: true, order_number: "INV-10042", total_amount: 189_000, product_value: 150_000 };

  const unpaidQris = await runTracker({ ...status, payment_method: "qris", payment_status: "pending", status: "pending", is_paid: false }, freshTab);
  assert.equal(unpaidQris.pixelEventIds.length, 0, "an unpaid QRIS order is no sale");
  assert.equal(unpaidQris.postedPayloads.length, 0);

  const cancelledCod = await runTracker({ ...status, payment_method: "cod", payment_status: "unpaid", status: "cancelled", is_paid: false }, freshTab);
  assert.equal(cancelledCod.pixelEventIds.length, 0, "a cancelled COD order is no sale");

  const refunded = await runTracker({ ...status, payment_method: "qris", payment_status: "refunded", status: "pending", is_paid: false }, freshTab);
  assert.equal(refunded.pixelEventIds.length, 0, "a refunded order is no sale");

  const liveCod = await runTracker({ ...status, payment_method: "cod", payment_status: "unpaid", status: "pending", is_paid: false }, freshTab);
  assert.deepEqual(liveCod.pixelEventIds, ["INV-10042"], "a live COD order still fires once, keyed by the server's order number");

  const paidQris = await runTracker({ ...status, payment_method: "qris", payment_status: "paid", status: "pending", is_paid: true }, freshTab);
  assert.deepEqual(paidQris.pixelEventIds, ["INV-10042"]);
});
