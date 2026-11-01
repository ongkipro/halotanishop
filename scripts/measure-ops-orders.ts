// A-426: rows read by GET /api/ops/v1/orders. Synthetic data only, ephemeral
// local D1; never opens an install config, never reaches a remote database.
// Run: node --experimental-strip-types scripts/measure-ops-orders.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { hashApiKeySecret } from '../src/lib/developer-api-keys.ts';
import { splitMigrationStatements } from '../src/lib/schema-version.ts';

// The route imports its siblings without an extension, as Astro allows.
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z0-9]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
const { GET: listRoute } = await import('../src/pages/api/ops/v1/orders/index.ts');
resolver.deregister();

const dir = mkdtempSync(join(tmpdir(), 'adsbook-ops-'));
const configPath = join(dir, 'wrangler.json');
writeFileSync(configPath, JSON.stringify({
  name: 'adsbook-ops-measurement', compatibility_date: '2026-10-01',
  d1_databases: [{ binding: 'OMS_DB', database_name: 'synthetic-ops', database_id: '00000000-0000-0000-0000-000000000000' }],
}));
const platform = await getPlatformProxy<{ OMS_DB: D1Database }>({
  configPath, envFiles: [], persist: false, remoteBindings: false,
});
const db = platform.env.OMS_DB;

// The route's own statements, run against real D1; only the order read is a list.
type Read = { sql: string; rowsRead: number };
let reads: Read[] = [];
const recorder = {
  prepare(sql: string) {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => ({
      ...statement,
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      first: (column?: string) => statement.first(column as never),
      run: () => statement.run(),
      all: async () => {
        const result = await statement.all();
        reads.push({ sql, rowsRead: result.meta.rows_read });
        return result;
      },
    }) as D1PreparedStatement;
    return wrap(db.prepare(sql));
  },
  batch: (statements: D1PreparedStatement[]) => db.batch(statements),
} as unknown as D1Database;
const locals = { runtimeEnv: { OMS_DB: recorder } } as unknown as App.Locals;
const SECRET = 'synthetic-ops-key';

async function seed() {
  const migrations = new URL('../src/db/migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
    const statements = splitMigrationStatements(readFileSync(new URL(name, migrations), 'utf8'));
    if (statements.length) await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  await db.batch([
    db.prepare("INSERT INTO stores (id, name, slug, created_at) VALUES (1, 'Synthetic store', 'synthetic', '2026-08-01')"),
    db.prepare(`INSERT INTO developer_api_keys (name, key_hash, key_preview, created_by, created_at, scopes, rate_limit_per_minute, daily_quota)
      VALUES ('measure', ?, 'x', 'owner', '2026-08-01', 'ops:orders:read', 600, 100000)`).bind(await hashApiKeySecret(SECRET)),
    // 20,000 orders over 90 days, 40 sources, a quarter tagged with one of 8 campaigns.
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000)
      INSERT INTO orders (id, order_number, store_id, customer_name, customer_phone, address,
        province, city, district, total_amount, payment_method, payment_status, shipping_status,
        created_at, source_page_path, ad_click_ids)
      SELECT x, 'SYN-'||x, 1, 'Synthetic Buyer', '0000000000', 'Synthetic address',
        'Jawa Timur', 'City '||(x%300), 'Synthetic district', 100000, 'cod',
        CASE (x/997)%7 WHEN 3 THEN 'paid' ELSE 'unpaid' END,
        CASE (x/90)%10 WHEN 0 THEN 'abandoned' WHEN 3 THEN 'pending' ELSE 'delivered' END,
        strftime('%Y-%m-%dT%H:%M:%fZ', '2026-07-31T17:00:00Z', '+'||((x*90)/20000)||' days', '+'||(x%24)||' hours'),
        '/source-'||(1+((x/7)%40)),
        CASE WHEN x%4=0 THEN '{"gclid":"synthetic","utm_source":"google","utm_campaign":"camp-'||(x%8)||'"}' ELSE NULL END
      FROM n`),
    db.prepare(`INSERT INTO products (id, store_id, title, slug, created_at) VALUES (1, 1, 'Product', 'product', '2026-08-01')`),
    db.prepare(`INSERT INTO product_variants (id, product_id, sku, title, price, weight_grams) VALUES (1, 1, 'SKU-1', 'Standard', 100000, 500)`),
    // 27,000 lines, as the A-348 fixture: the per-order item total reads them.
    db.prepare(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price, weight_grams) SELECT id, 1, 1, 100000, 500 FROM orders`),
    db.prepare(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price, weight_grams) SELECT id, 1, 2, 100000, 500 FROM orders WHERE id%4=0`),
    db.prepare(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price, weight_grams) SELECT id, 1, 1, 100000, 500 FROM orders WHERE id%10=0`),
  ]);
  // Spread the sync stamps over the period: a sync client asks from "yesterday".
  await db.prepare(`UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+1 hours')`).run();
  const counts = await db.prepare('SELECT COUNT(*) AS orders, COUNT(DISTINCT source_slug) AS sources FROM orders').first();
  assert.deepEqual(counts, { orders: 20000, sources: 40 });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM order_items').first('n')), 27000);
  return counts;
}

async function page(name: string, query: string, ceiling: number) {
  reads = [];
  const url = new URL(`http://localhost/api/ops/v1/orders?${query}`);
  const request = new Request(url, { headers: { authorization: `Bearer ${SECRET}` } });
  const response = await listRoute({ request, url, locals, params: {} } as unknown as Parameters<typeof listRoute>[0]);
  assert.equal(response.status, 200, name);
  const body = JSON.parse(await response.text()) as { data: unknown[]; next_cursor: string | null };
  assert.equal(reads.length, 1, `${name}: one list read`);
  const [{ sql, rowsRead }] = reads;
  const params = [...new URL(url).searchParams];
  const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${sql.replace(/LIMIT \?\s*$/, 'LIMIT 101')}`)
    .bind(...planBinds(sql)).all<{ detail: string }>()).results.map((row) => row.detail);
  assert.ok(!plan.some((line) => /TEMP B-TREE/.test(line)), `${name}: sorts instead of walking an index`);
  assert.ok(!plan.some((line) => /SCAN (o|oi)$/.test(line)), `${name}: unindexed scan`);
  assert.ok(rowsRead <= ceiling, `${name}: ${rowsRead} > ${ceiling}`);
  return { name, query, returned: body.data.length, rowsRead, ceiling, plan, params: params.length };
}

// EXPLAIN needs a value per placeholder; any value of the right kind gives the plan.
function planBinds(sql: string) {
  return Array.from(sql.replace(/LIMIT \?\s*$/, '').matchAll(/\?/g), () => '2026-10-01');
}

try {
  const counts = await seed();
  const firstPage = await (async () => {
    const url = new URL('http://localhost/api/ops/v1/orders?limit=100');
    const response = await listRoute({ request: new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }), url, locals, params: {} } as never);
    return (JSON.parse(await response.text()) as { next_cursor: string }).next_cursor;
  })();
  // Regression budgets for this exact 20k-order fixture, not fleet SLAs.
  const results = [
    await page('newest-100', 'limit=100', 800),
    await page('second-page-100', `limit=100&cursor=${firstPage}`, 800),
    await page('period-90d-100', 'limit=100&date_filter=custom&date_start=2026-08-01&date_end=2026-10-29', 800),
    await page('period-oldest-day-100', 'limit=100&date_filter=custom&date_start=2026-08-01&date_end=2026-08-01', 1000),
    await page('campaign-90d-100', 'limit=100&date_filter=custom&date_start=2026-08-01&date_end=2026-10-29&utm_campaign=camp-4', 2500),
    await page('source-100', 'limit=100&source_slug=source-2', 2000),
    await page('status-pending-100', 'limit=100&status=pending', 2000),
    await page('sync-since-1d-100', 'limit=100&updated_since=2026-10-28T00:00:00Z', 800),
    await page('sync-since-90d-100', 'limit=100&updated_since=2026-08-01T00:00:00Z', 800),
  ];
  console.log(JSON.stringify({
    environment: 'ephemeral local workerd D1; synthetic data; no remote bindings',
    counts, results,
  }, null, 2));
} finally {
  await platform.dispose();
}
