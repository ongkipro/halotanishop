import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { splitMigrationStatements } from './schema-version.ts';
import { canAccessAdminRoute } from './auth.ts';
import { GET, PUT } from '../pages/api/admin/orders/[id]/follow-up.ts';
import { readOrderFollowUpsFor } from './order-follow-up.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../db/migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort())
    for (const sql of splitMigrationStatements(readFileSync(new URL(name, dir), 'utf8'))) sqlite.exec(sql);
  sqlite.exec(`INSERT INTO stores (id,name,slug,created_at) VALUES (1,'Test','test','2026-01-01');
    INSERT INTO orders (id,store_id,order_number,customer_name,customer_phone,address,province,city,district,total_amount,payment_method,shipping_status,created_at)
    VALUES (1,1,'TEST-1','Test','080000000000','Test','P','C','D',100,'cod','pending','2026-01-01'),
           (2,1,'TEST-2','Test','080000000000','Test','P','C','D',100,'cod','abandoned','2026-01-01');`);
  const db = { prepare(sql: string) {
    let values: any[] = [];
    const q = { bind(...v: any[]) { values = v; return q; }, async first() { return sqlite.prepare(sql).get(...values) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
    return q;
  } };
  const call = (method: 'GET' | 'PUT', role = 'owner', body?: unknown, id = '1', username = 'operator-a') => (method === 'GET' ? GET : PUT)({
    params: { id }, locals: { admin: role === 'anonymous' ? undefined : { role, username }, runtimeEnv: { OMS_DB: db } },
    request: new Request(`https://store.test/api/admin/orders/${id}/follow-up`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  } as never);
  return { sqlite, db, call };
}
const input = { step: 'welcome', completed: true, note: 'Customer contacted', revision: 0 };

test('follow-up persists explicit operator evidence across reads, CAS rejects stale writes and correction requires a reason', async t => {
  const { sqlite, call } = fixture(); t.after(() => sqlite.close());
  assert.deepEqual((await (await call('GET')).json()).data, []);
  const saved = await call('PUT', 'customer_service', { ...input, updated_by: 'forged' });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  const first = (await saved.json()).data;
  assert.equal(first.updated_by, 'operator-a'); assert.equal(first.revision, 1); assert.equal(first.completed, 1);
  assert.ok(Date.parse(first.updated_at));
  assert.deepEqual((await (await call('GET')).json()).data, [first]);
  assert.equal((await call('PUT', 'admin', input, '1', 'operator-b')).status, 409);
  assert.equal((await call('PUT', 'owner', { ...input, revision: 1, completed: false, note: '' })).status, 400);
  const correction = await call('PUT', 'admin', { ...input, revision: 1, completed: false, note: 'Wrong stage' }, '1', 'operator-b');
  const changed = (await correction.json()).data;
  assert.equal(changed.completed, 0); assert.equal(changed.revision, 2); assert.equal(changed.updated_by, 'operator-b');
  assert.equal((await call('PUT', 'owner', { ...input, revision: 99 })).status, 409);
  assert.equal((await call('PUT', 'owner', { ...input, step: '1', revision: 7 })).status, 409);
  const order = sqlite.prepare('SELECT shipping_status,payment_status FROM orders WHERE id=1').get() as any;
  assert.equal(order.shipping_status, 'pending'); assert.equal(order.payment_status, 'unpaid');
});

test('follow-up rejects unauthorized actors, malformed payloads, missing orders and abandoned leads', async t => {
  const { sqlite, call } = fixture(); t.after(() => sqlite.close());
  for (const method of ['GET','PUT'] as const) {
    assert.equal((await call(method,'anonymous',method === 'PUT' ? input : undefined)).status,401);
    assert.equal((await call(method,'advertiser',method === 'PUT' ? input : undefined)).status,403);
    for (const role of ['owner','admin','customer_service'] as const) assert.equal(canAccessAdminRoute(role, '/api/admin/orders/1/follow-up'),true);
    assert.equal(canAccessAdminRoute('advertiser','/api/admin/orders/1/follow-up'),false);
  }
  for (const body of [null, [], {}, { ...input, step:'bogus' }, { ...input, note:'x'.repeat(1001) }, { ...input, revision:-1 }, { ...input, completed:'true' }])
    assert.equal((await call('PUT','owner',body)).status,400);
  for (const id of ['2','999']) assert.equal((await call('PUT','owner',input,id)).status,404);
  assert.equal((await call('GET','owner',undefined,'not-an-id')).status,400);
  assert.equal((sqlite.prepare('SELECT count(*) n FROM order_follow_ups').get() as any).n,0);
});

test('an order that becomes a lead mid-save answers 404, not a stale-revision 409', async t => {
  const { sqlite, db } = fixture(); t.after(() => sqlite.close());
  let reads = 0;
  const racing = { prepare(sql: string) {
    if (sql.startsWith('SELECT id FROM orders') && ++reads === 1) queueMicrotask(() => sqlite.exec("UPDATE orders SET shipping_status='abandoned' WHERE id=1"));
    return db.prepare(sql);
  } };
  const result = await PUT({ params: { id: '1' }, locals: { admin: { role: 'owner', username: 'test' }, runtimeEnv: { OMS_DB: racing } },
    request: new Request('https://store.test/', { method: 'PUT', body: JSON.stringify(input) }) } as never);
  assert.equal(result.status, 404);
});

test('follow-up read/write failures return errors rather than false completion', async () => {
  for (const method of ['GET','PUT'] as const) {
    const result = await (method === 'GET' ? GET : PUT)({ params:{id:'1'},locals:{admin:{role:'owner',username:'test'},runtimeEnv:{OMS_DB:{prepare(){throw new Error('db down');}}}},request:new Request('https://store.test/',{method,...(method==='PUT'?{body:JSON.stringify(input)}:{})}) } as never);
    assert.equal(result.status,500);
  }
});

test('the order list reads a whole page of follow-up records in one statement, keyed by order', async t => {
  const { sqlite, db, call } = fixture(); t.after(() => sqlite.close());
  sqlite.exec(`INSERT INTO orders (id,store_id,order_number,customer_name,customer_phone,address,province,city,district,total_amount,payment_method,shipping_status,created_at)
    VALUES (3,1,'TEST-3','Test','080000000000','Test','P','C','D',100,'cod','pending','2026-01-01')`);
  assert.equal((await call('PUT', 'owner', input)).status, 200);
  assert.equal((await call('PUT', 'owner', { ...input, step: '2' })).status, 200);
  assert.equal((await call('PUT', 'owner', input, '3')).status, 200);
  let statements = 0;
  const counting = { prepare: (sql: string) => { statements++; return db.prepare(sql); } } as unknown as D1Database;
  const byOrder = await readOrderFollowUpsFor(counting, [1, 3, 99, 1]);
  assert.equal(statements, 1);
  assert.deepEqual(byOrder.get(1)?.map(row => row.step), ['2', 'welcome']);
  assert.deepEqual(byOrder.get(3)?.map(row => [row.step, row.completed, row.updated_by]), [['welcome', 1, 'operator-a']]);
  assert.equal(byOrder.has(99), false, 'an order with no record is absent, not an empty claim');
  assert.equal((await readOrderFollowUpsFor(counting, [])).size, 0);
  assert.equal(statements, 1, 'no ids, no read');
});
