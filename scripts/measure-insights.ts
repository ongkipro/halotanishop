// A-348: synthetic data only, ephemeral local D1; never opens an install config.
// Run: node --experimental-strip-types scripts/measure-insights.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { getPlatformProxy } from 'wrangler';
import { splitMigrationStatements } from '../src/lib/schema-version.ts';
import { landingStatements, trendStatements, productStatements, locationStatements, timeStatements, utmStatements } from '../src/lib/insights.ts';
import { GET as dashboard } from '../src/pages/api/admin/analytics.ts';
import { GET as landingRoute } from '../src/pages/api/admin/insights/landing.ts';
import { GET as trendRoute } from '../src/pages/api/admin/insights/trend.ts';
import { GET as productsRoute } from '../src/pages/api/admin/insights/products.ts';
import { GET as locationsRoute } from '../src/pages/api/admin/insights/locations.ts';
import { GET as timesRoute } from '../src/pages/api/admin/insights/times.ts';
import { GET as utmRoute } from '../src/pages/api/admin/insights/utm.ts';
import type { InsightsPeriod } from '../src/lib/insights-period.ts';

const dir = mkdtempSync(join(tmpdir(), 'adsbook-insights-'));
const configPath = join(dir, 'wrangler.json');
writeFileSync(configPath, JSON.stringify({
  name: 'adsbook-insights-measurement', compatibility_date: '2026-10-01',
  d1_databases: [{ binding: 'OMS_DB', database_name: 'synthetic-insights', database_id: '00000000-0000-0000-0000-000000000000' }],
}));
const platform = await getPlatformProxy<{ OMS_DB: D1Database }>({
  configPath, envFiles: [], persist: false, remoteBindings: false,
});
const db = platform.env.OMS_DB;
type Query = { sql: string; params: (string | number | null)[] };
const queries: Query[] = [];
// Capture the actual production builders, not SQL copied into the benchmark.
function capture(sql: string, params: Query['params'] = []) {
  const query = { sql, params };
  return {
    ...query,
    bind: (...values: Query['params']) => capture(sql, values),
    async first() { queries.push(query); return db.prepare(sql).bind(...params).first(); },
    async all() { queries.push(query); return db.prepare(sql).bind(...params).all(); },
  };
}
const recorder = { prepare: capture } as unknown as D1Database;
const period: InsightsPeriod = { start: '2026-08-01', end: '2026-10-29', days: 90 };

async function seed() {
  const migrations = new URL('../src/db/migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
    const statements = splitMigrationStatements(readFileSync(new URL(name, migrations), 'utf8'));
    if (statements.length) await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  await db.batch([
    db.prepare("INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Synthetic store', 'synthetic', '2026-08-01')"),
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<30)
      INSERT INTO products (id, store_id, title, slug, created_at)
      SELECT 10000+x, 1, 'Product '||x, 'product-'||x, '2026-08-01' FROM n`),
    db.prepare(`INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams)
      SELECT id, id, 'SKU-'||id, 'Standard', 100000, 500 FROM products`),
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<40)
      INSERT INTO landing_pages (id, slug, title, product_id, is_active, created_at, updated_at, source)
      SELECT 'lp-'||x, 'source-'||x, 'Source '||x, CAST(10001+(x%30) AS TEXT), 1, '2026-08-01', '2026-08-01', 'cms' FROM n`),
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000)
      INSERT INTO orders (id, order_number, store_id, customer_name, customer_phone, address,
        province, city, district, total_amount, payment_method, payment_status, shipping_status,
        created_at, source_page_path, ad_click_ids)
      SELECT x, 'SYN-'||x, 1, 'Synthetic Buyer', '0000000000', 'Synthetic address',
        CASE x%3 WHEN 0 THEN 'Jawa Timur' WHEN 1 THEN 'Jawa Barat' ELSE 'Jawa Tengah' END,
        'City '||(x%300), 'Synthetic district', 100000, 'cod',
        CASE (x/997)%7 WHEN 0 THEN 'cancelled' WHEN 1 THEN 'refunded' WHEN 2 THEN 'failed' WHEN 3 THEN 'paid' ELSE 'unpaid' END,
        CASE (x/90)%10 WHEN 0 THEN 'abandoned' WHEN 1 THEN 'returned' WHEN 2 THEN 'cancelled' WHEN 3 THEN 'pending' ELSE 'delivered' END,
        strftime('%Y-%m-%dT%H:%M:%fZ', '2026-07-31T17:00:00Z', '+'||(x%90)||' days', '+'||(x%24)||' hours'),
        '/source-'||(1+((x/7)%40)), CASE (x/13)%3 WHEN 0 THEN '{"fbclid":"synthetic","utm_source":"facebook","utm_medium":"paid_social","utm_campaign":"Promo-'||(x%5)||' ","utm_content":"ad-'||(x%7)||'"}' WHEN 1 THEN '{"gclid":"synthetic"}' ELSE NULL END
      FROM n`),
    db.prepare(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price, weight_grams)
      SELECT id, 10001+((id/11)%30), 1, 100000, 500 FROM orders`),
    db.prepare(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price, weight_grams)
      SELECT id, 10001+((id/17)%30), 2, 100000, 500 FROM orders WHERE id%4=0`),
    db.prepare(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price, weight_grams)
      SELECT id, 10001+((id/19)%30), 1, 100000, 500 FROM orders WHERE id%10=0`),
    db.prepare(`UPDATE orders SET total_amount =
      (SELECT SUM(quantity * unit_price) FROM order_items WHERE order_id = orders.id)`),
  ]);
  const counts = await db.prepare(`SELECT COUNT(*) AS orders, COUNT(DISTINCT source_slug) AS sources,
    COUNT(DISTINCT city) AS cities FROM orders`).first();
  assert.deepEqual(counts, { orders: 20000, sources: 40, cities: 300 });
  return counts;
}

async function measure(name: string, statements: Query[], ceiling?: number) {
  const plans = await Promise.all(statements.map(async ({ sql, params }) => {
    const result = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>();
    return result.results.map((row) => row.detail);
  }));
  if (ceiling !== undefined) {
    for (const plan of plans) {
      assert.ok(!plan.some((line) => /SCAN (orders|o)\b/.test(line)), `${name}: unbounded orders scan`);
      if (plan.some((line) => /\b(orders|o)\b/.test(line))) {
        assert.ok(plan.some((line) => /SEARCH (orders|o) USING .*created_at>\? AND created_at<\?/.test(line)), `${name}: missing indexed date bounds`);
      }
      assert.ok(!plan.some((line) => /SCAN (order_items|oi)\b/.test(line)), `${name}: unbounded items scan`);
    }
  }
  const started = performance.now();
  const results = await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)));
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const rowsRead = results.reduce((sum, result) => {
    assert.equal(typeof result.meta.rows_read, 'number', 'D1 must supply real rows_read');
    return sum + result.meta.rows_read;
  }, 0);
  if (ceiling !== undefined) assert.ok(rowsRead <= ceiling, `${name}: ${rowsRead} > ${ceiling}`);
  return { name, rowsRead, elapsedMs, ceiling: ceiling ?? null, plans };
}

try {
  const counts = await seed();
  // Independent arithmetic over the deterministic seed, not a copy of report SQL.
  const expected = { leads: 0, orders: 0, revenue: 0, units: 0 };
  for (let id = 1; id <= 20000; id++) {
    const shipping = Math.floor(id / 90) % 10;
    if (shipping === 0) { expected.leads++; continue; }
    expected.orders++;
    if (shipping === 1 || shipping === 2 || Math.floor(id / 997) % 7 < 3) continue;
    const units = 1 + (id % 4 === 0 ? 2 : 0) + (id % 10 === 0 ? 1 : 0);
    expected.units += units;
    expected.revenue += units * 100000;
  }
  const routeResults: Record<string, any> = {};
  for (const [name, route] of Object.entries({ landing: landingRoute, trend: trendRoute, products: productsRoute, locations: locationsRoute, times: timesRoute, utm: utmRoute })) {
    const response = await route({
      locals: { runtimeEnv: { OMS_DB: db } },
      url: new URL(`http://localhost/api/admin/insights/${name}?date_filter=custom&date_start=${period.start}&date_end=${period.end}`),
    } as unknown as Parameters<typeof landingRoute>[0]);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.doesNotMatch(text, /Synthetic Buyer|Synthetic address|0000000000|SYN-|customer_name|customer_phone/);
    routeResults[name] = JSON.parse(text).data;
  }
  assert.deepEqual(routeResults.trend.total, { leads: expected.leads, orders: expected.orders, revenue: expected.revenue });
  assert.equal(routeResults.landing.totals.revenue, expected.revenue);
  assert.equal(routeResults.landing.totals.orders, expected.orders);
  assert.equal(routeResults.landing.totals.leads, expected.leads);
  assert.deepEqual(routeResults.products.totals, { units: expected.units, revenue: expected.revenue });
  assert.deepEqual(routeResults.locations.totals, { orders: expected.orders, revenue: expected.revenue });
  assert.equal(routeResults.times.total, expected.orders);
  assert.deepEqual(routeResults.utm.totals, { leads: expected.leads, orders: expected.orders, revenue: expected.revenue });
  assert.equal(routeResults.utm.rows.length, 6, 'five normalised campaigns plus (tanpa UTM)');
  const response = await dashboard({
    locals: { runtimeEnv: { OMS_DB: recorder } },
    url: new URL('http://localhost/api/admin/analytics?startDate=2026-10-01&endDate=2026-10-29'),
  } as unknown as Parameters<typeof dashboard>[0]);
  assert.equal(response.status, 200);
  const baseline = await measure('existing-dashboard-29d', queries);
  const screens = [
    ['landing-90d', landingStatements(recorder, period)],
    ['trend-90d', trendStatements(recorder, period)],
    ['trend-source-90d', trendStatements(recorder, period, { source: 'source-2' })],
    ['trend-product-90d', trendStatements(recorder, period, { productId: 10001 })],
    ['products-90d', productStatements(recorder, period)],
    ['locations-90d', locationStatements(recorder, period)],
    ['times-90d', timeStatements(recorder, period)],
    ['utm-90d', utmStatements(recorder, period)],
    ['landing-1d', landingStatements(recorder, { start: '2026-10-29', end: '2026-10-29', days: 1 })],
  ] as unknown as Array<[string, Query[]]>;
  // Regression budgets for this exact 20k-order/27k-line fixture, not fleet SLAs.
  const ceilings: Record<string, number> = {
    'landing-90d': 90000, 'trend-90d': 60000, 'trend-source-90d': 2000,
    'trend-product-90d': 110000, 'products-90d': 190000,
    'locations-90d': 60000, 'times-90d': 45000, 'utm-90d': 90000, 'landing-1d': 2000,
  };
  const before = [];
  for (const [name, statements] of screens) before.push(await measure(name, statements, ceilings[name]));
  // Disposable experiment only: never ship an index solely on an assumed plan.
  await db.prepare(`CREATE INDEX benchmark_covering_orders ON orders
    (created_at, shipping_status, payment_status, total_amount, source_slug, ad_click_ids,
     lead_follow_up_status, province, city)`).run();
  const covering = [];
  for (const [name, statements] of screens) covering.push(await measure(name, statements));
  await db.prepare('DROP INDEX benchmark_covering_orders').run();
  console.log(JSON.stringify({
    environment: 'ephemeral local workerd D1; synthetic data; no remote bindings',
    counts, products: 30, orderItems: 27000, period, expected, routeSmoke: 'six routes passed against local D1', baseline, before, covering,
  }, null, 2));
} finally {
  await platform.dispose();
}
