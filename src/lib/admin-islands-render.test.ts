import assert from "node:assert/strict";
import test, { after } from "node:test";
import path from "node:path";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";

/**
 * A-172: `npm test` globs `src/lib/*.test.ts`, so no admin React island was
 * ever executed by the suite — a throw during render returned a blank 200
 * that `check`, `test` and `build` all called healthy (A-171, then A-208's
 * `ProductForm` case). Each island named here carries money or state, is
 * bundled with esbuild the same way Astro's own Vite pipeline resolves JSX
 * and the `@/*` alias, and is rendered through `react-dom/server` — the
 * cheapest version of a smoke check, no browser required.
 *
 * CJS, not ESM: esbuild's ESM+node output leaves a `require("react")` inside
 * some transitively bundled dependency, which throws "Dynamic require of
 * react is not supported" at import time. CJS output lets Node's own
 * `require` resolve the externalized `react`/`react-dom` normally.
 */

const require = createRequire(import.meta.url);
// Inside node_modules so the bundle's `require("react")` resolves, and one
// directory per process: a shared one let a concurrent `npm test` in the same
// checkout overwrite a bundle mid-require or `rm` it in its `after`, which
// surfaced as "SyntaxError: Invalid or unexpected token" in a random island.
const TMP_DIR = path.join(
  process.cwd(),
  "node_modules",
  ".admin-islands-render-test",
  `${process.pid}-${Date.now()}`,
);

async function renderIsland(
  fileName: string,
  exportName: string,
  props: Record<string, unknown>,
) {
  const entry = path.resolve("src/components/admin", fileName);
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    jsxImportSource: "react",
    write: false,
    external: ["react", "react-dom", "react-dom/*"],
    alias: { "@": path.resolve("src") },
    logLevel: "silent",
  });

  const outFile = path.join(TMP_DIR, `${fileName}.cjs`);
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.writeFile(outFile, result.outputFiles[0].text);
  delete require.cache[outFile];
  const mod = require(outFile);
  const Component = exportName === "default" ? mod.default : mod[exportName];
  if (typeof Component !== "function") {
    throw new Error(`${fileName}: export "${exportName}" is not a component`);
  }
  return renderToString(React.createElement(Component, props));
}

after(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

test("OrdersTable renders its loading skeleton without initial data", async () => {
  const html = await renderIsland("OrdersTable.tsx", "OrdersTable", {});
  assert.match(html, /aria-busy="true"/);
});

test("OrdersTable renders a real order row without throwing", async () => {
  // `initialOrders` takes the already-mapped `OrderItem` shape (camelCase),
  // the same one `mapOrder` produces from a raw DB row — not the raw row
  // itself. `paymentInstructionStatus` is deliberately omitted here: it is
  // optional precisely because the server-rendered first paint
  // (`src/pages/admin/orders/index.astro`) doesn't supply it (see the type's
  // own comment), so a fixture that always included it would miss that case.
  const order = {
    id: "1",
    orderNumber: "ORD-TEST-1",
    customerName: "Budi Santoso",
    customerPhone: "081234567890",
    address: "Jl. Test No. 1",
    productName: "Produk Uji",
    variantName: "Default",
    productPrice: 100_000,
    shippingCost: 15_000,
    district: "Kec. Test",
    city: "Jakarta",
    province: "DKI Jakarta",
    totalAmount: 115_000,
    paymentMethod: "cod",
    paymentStatus: "unpaid",
    shippingStatus: "pending",
    courierCode: "jne",
    cnoteNo: "",
    sellerName: "",
    bankAccounts: "",
    epaymentLink: "",
    receiverDeliveryRate: -1,
    receiverRiskLabel: "UNKNOWN",
    createdAt: new Date().toISOString(),
    dispatchEligible: false,
    dispatchReason: "",
    providerDispatchError: null,
    providerOrderId: null,
  };
  const html = await renderIsland("OrdersTable.tsx", "OrdersTable", {
    initialOrders: [order],
  });
  assert.match(html, /Budi Santoso/);
  assert.match(html, /ORD-TEST-1/);
});

test("OrderDetail renders for a given invoice without throwing", async () => {
  const html = await renderIsland("OrderDetail.tsx", "OrderDetail", {
    invoice: "INV-TEST-1",
  });
  assert.ok(html.length > 0);
});

test("PaymentReconciliationQueue renders without throwing", async () => {
  const html = await renderIsland(
    "PaymentReconciliationQueue.tsx",
    "default",
    {},
  );
  assert.ok(html.length > 0);
});

test("ProductForm renders in create mode without throwing", async () => {
  const html = await renderIsland("ProductForm.tsx", "ProductForm", {});
  assert.ok(html.length > 0);
});

test("ProductForm starts a new variant with an empty weight and states its use", async () => {
  const html = await renderIsland("ProductForm.tsx", "ProductForm", {});
  assert.match(html, /Dipakai untuk ongkir Mengantar/);
  const weightInput = html.match(/<input[^>]*placeholder="Contoh: 250"[^>]*>/)?.[0] ?? "";
  assert.match(weightInput, /value=""/);
  assert.match(weightInput, /required/);
});

test("LandingPageEditor renders in create mode without throwing", async () => {
  const html = await renderIsland("LandingPageEditor.tsx", "default", {});
  assert.ok(html.length > 0);
});

test("RateCheckTools renders with the warehouse as the default origin", async () => {
  const html = await renderIsland("RateCheckTools.tsx", "default", {
    defaultOrigin: { id: "area-1", label: "Menteng, Jakarta Pusat" },
    warehouseName: "Gudang Uji",
  });
  assert.match(html, /value="Menteng, Jakarta Pusat"/);
  assert.match(html, /Default: Gudang Uji/);
});

test("RateCheckTools renders without a warehouse", async () => {
  const html = await renderIsland("RateCheckTools.tsx", "default", { defaultOrigin: null, warehouseName: "" });
  assert.match(html, /Cek tarif kurir/);
});

// A36 / A-346: `?source_slug=` once initialised the filter from
// `window.location`, so the server painted "Semua halaman" and the client
// hydrated the slug — React error #418 on every filtered link from Analitik.
// The filters now start from the `initialQuery` prop the Astro page passes,
// which the server and the client both see.
test("OrdersTable starts its filters from initialQuery on the server", async () => {
  const html = await renderIsland("OrdersTable.tsx", "OrdersTable", {
    initialOrders: [],
    initialQuery: "?source_slug=promo-kaos&search=Budi",
  });
  assert.match(html, /promo-kaos/);
  assert.doesNotMatch(html, /Semua halaman/);
  assert.match(html, /value="Budi"/);
});

// AbandonedOrders paints a skeleton until its first fetch, so its filters are
// not in the server HTML; the source check below keeps it off `window`.

test("order and lead lists never read window.location to initialise state", async () => {
  for (const file of ["OrdersTable.tsx", "AbandonedOrders.tsx"]) {
    const source = await fs.readFile(path.resolve("src/components/admin", file), "utf8");
    assert.doesNotMatch(source, /useState\([^;]*window\.location/s, file);
  }
});

// OperationalStatus renders a stored JSON snapshot, which an older or newer
// build may have written: a signal state or icon tone this build does not know
// must degrade, not throw (an SSR throw is a blank 200 on /admin/status).
function statusSignal(id: string, state: string) {
  return { id, state, reason: "x", lastAt: null, ageMinutes: null, metrics: {} };
}

function statusSnapshot(signals: unknown[]) {
  const takenAt = new Date(Date.UTC(2026, 9, 29, 7, 0)).toISOString();
  return {
    overall: "healthy",
    degradedCount: 0,
    health: { checkedAt: takenAt, overall: "healthy", signals },
    setupRequiredLeft: 0,
    takenAt,
    schedulerRanAt: takenAt,
  };
}

const STATUS_NOW = Date.UTC(2026, 9, 29, 7, 30);

test("OperationalStatus renders a healthy snapshot and the setup checklist", async () => {
  const html = await renderIsland("OperationalStatus.tsx", "default", {
    snapshot: statusSnapshot([statusSignal("capi-outbox", "healthy"), statusSignal("scheduler", "degraded")]),
    icon: { tone: "healthy", count: 0, label: "Status operasional sehat", stale: false, takenAt: null },
    setupSteps: [{ id: "product", label: "Tambah produk", hint: "h", href: "/admin/products", required: true, done: true }],
    now: STATUS_NOW,
  });
  assert.match(html, /Semua sinyal sehat/);
  assert.match(html, /Setup toko/);
  assert.match(html, /Bermasalah/);
});

test("OperationalStatus degrades an unknown signal state and icon tone instead of throwing", async () => {
  const html = await renderIsland("OperationalStatus.tsx", "default", {
    snapshot: statusSnapshot([
      statusSignal("capi-outbox", "paused"),
      { id: "meta-capi", state: "healthy", reason: "x", lastAt: null, ageMinutes: null },
      null,
    ]),
    icon: { tone: "maintenance", count: 0, label: "?", stale: false, takenAt: null },
    setupSteps: null,
    now: STATUS_NOW,
  });
  assert.match(html, /Belum ada data/);
});

test("OperationalStatus names a failing snapshot write apart from a stopped scheduler", async () => {
  const props = (staleReason: string) => ({
    snapshot: statusSnapshot([statusSignal("capi-outbox", "healthy")]),
    icon: { tone: "problem", count: 1, label: "1 masalah operasional", stale: true, staleReason, takenAt: null },
    setupSteps: null,
    now: STATUS_NOW,
  });
  assert.match(await renderIsland("OperationalStatus.tsx", "default", props("snapshot")), /Status tidak diperbarui/);
  assert.match(await renderIsland("OperationalStatus.tsx", "default", props("scheduler")), /Pemeliharaan berhenti/);
});

for (const report of ['landing', 'products', 'locations', 'times', 'trend', 'utm']) {
  test(`InsightsReport ${report} renders loading and empty data safely`, async () => {
    const props = { report, initialQuery: '?date_filter=this_month' };
    assert.match(await renderIsland('InsightsReport.tsx', 'InsightsReport', props), /aria-busy="true"/);
    const empty = {
      landing: { rows: [], totals: {} }, products: { rows: [], totals: { units: 0, revenue: 0 } },
      locations: { provinces: [], province: null, unmatched_provinces: [], incomplete_address: { orders: 0, revenue: 0, delivered: 0, returned: 0, return_share: 0 } },
      times: { total: 0, max: 0, cells: Array.from({ length: 7 }, () => Array(24).fill(0)) },
      trend: { series: [], total: { orders: 0, leads: 0, revenue: 0 }, previous: { start: '2026-09-01', end: '2026-09-30', orders: 0, leads: 0, revenue: 0 } },
      utm: { rows: [], totals: { leads: 0, orders: 0, revenue: 0 }, tagged_share: 0 },
    };
    const html = await renderIsland('InsightsReport.tsx', 'InsightsReport', { ...props, initialData: empty[report as keyof typeof empty] });
    assert.match(html, /Asia\/Jakarta/);
    assert.match(html, /(?:Belum ada data|Tidak ada pesanan)/);
  });
}

test('InsightsReport renders populated source, variant, location, and heatmap data', async () => {
  const landing = await renderIsland('InsightsReport.tsx', 'InsightsReport', {
    report: 'landing', mayReadOrders: true,
    initialData: { rows: [{ slug: null, label: '(tidak tercatat)', leads: 2, orders: 1, revenue: 100, delivered_revenue: 100, average_order_value: 100, closing_rate: 33.33, delivered_share: 100, return_share: 0, channels: {}, follow_up: { new: 2, contacted: 0, qualified: 0, converted: 0, not_interested: 0 } }] },
  });
  assert.match(landing, /source_slug=__none__/);
  assert.match(landing, /33,33%/, 'closing reads as a figure');
  assert.match(landing, /Belum dihubungi 2/, 'the lead follow-up split rides on the Lead cell');
  const products = await renderIsland('InsightsReport.tsx', 'InsightsReport', { report: 'products', initialData: { totals: { units: 1, revenue: 100 }, rows: [{ product_id: null, label: 'Produk lama', units: 1, revenue: 100, return_share: 30, variants: [{ variant_id: null, label: 'Varian lama', units: 1, revenue: 100 }] }] } });
  assert.match(products, /Varian lama/);
  const jatim = { key: 'JI', label: 'Jawa Timur', orders: 1, revenue: 100, return_share: 30 };
  const locations = await renderIsland('InsightsReport.tsx', 'InsightsReport', { report: 'locations', initialData: { provinces: [jatim], province: null, unmatched_provinces: [], incomplete_address: { orders: 2, revenue: 50, delivered: 0, returned: 0, return_share: 0 } } });
  assert.match(locations, /Perlu perhatian/);
  assert.match(locations, /Alamat belum dilengkapi/);
  const districts = await renderIsland('InsightsReport.tsx', 'InsightsReport', { report: 'locations', initialData: { provinces: [jatim], unmatched_provinces: [], incomplete_address: { orders: 0, revenue: 0, delivered: 0, returned: 0, return_share: 0 },
    province: { key: 'JI', label: 'Jawa Timur', cities: [{ key: 'surabaya', label: 'Surabaya', orders: 1, revenue: 100, return_share: 0 }],
      city: { key: 'surabaya', label: 'Surabaya', districts: [{ key: 'wonokromo', label: 'Wonokromo', orders: 1, revenue: 100, return_share: 0 }] } } } });
  assert.match(districts, /Wonokromo/);
  assert.match(districts, /Kecamatan/);
  const times = await renderIsland('InsightsReport.tsx', 'InsightsReport', { report: 'times', initialData: { total: 168, max: 1, cells: Array.from({ length: 7 }, () => Array(24).fill(1)) } });
  assert.match(times.replace(/<!--.*?-->/g, ''), /23:00/);
});
