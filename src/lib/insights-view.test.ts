import assert from 'node:assert/strict';
import test from 'node:test';
import { insightsInitialQuery, insightsOrderLink, insightsPeriodLink, sortInsightRows, withInsightsPeriod } from './insights-view.ts';

test('report navigation keeps only the shared period, not screen-specific filters', () => {
  const query = 'date_filter=custom&date_start=2026-09-01&date_end=2026-09-30&province=Jawa&product_id=1';
  assert.equal(insightsPeriodLink('/admin/analytics/times', query), '/admin/analytics/times?date_filter=custom&date_start=2026-09-01&date_end=2026-09-30');
  assert.equal(insightsInitialQuery(''), 'date_filter=this_month');
  assert.equal(insightsInitialQuery('date_filter=all'), 'date_filter=all', 'invalid bookmarked ranges must not silently change');
});

test('the period carries between Analitik screens and nowhere else', () => {
  const query = 'date_filter=7d&source=promo';
  assert.equal(withInsightsPeriod('/admin/analytics', '/admin/analytics/times', query), '/admin/analytics?date_filter=7d');
  assert.equal(withInsightsPeriod('/admin/analytics/landing', '/admin/analytics', query), '/admin/analytics/landing?date_filter=7d');
  assert.equal(withInsightsPeriod('/admin/orders', '/admin/analytics', query), '/admin/orders', 'leaving the menu keeps the link as written');
  assert.equal(withInsightsPeriod('/admin/analytics', '/admin/dashboard', query), '/admin/analytics', 'only an Analitik page has a period to carry');
  assert.equal(withInsightsPeriod('/admin/analyticsx', '/admin/analytics', query), '/admin/analyticsx');
});

test('source drill-down keeps the period and encodes missing or hostile source names', () => {
  const missing = new URL(insightsOrderLink(null, 'date_filter=90d'), 'https://local.test');
  assert.equal(missing.searchParams.get('source_slug'), '__none__');
  assert.equal(missing.searchParams.get('date_filter'), '90d');
  const hostile = new URL(insightsOrderLink('x&status=paid', ''), 'https://local.test');
  assert.equal(hostile.searchParams.get('source_slug'), 'x&status=paid');
  assert.equal(hostile.searchParams.has('status'), false);
  assert.equal(hostile.searchParams.get('date_filter'), 'this_month', 'the report default is named, not left to the list default');
});

test('ranking sort is numeric, reversible and leaves source data unchanged', () => {
  const rows = [{ label: 'A', revenue: 9 }, { label: 'B', revenue: 100 }];
  assert.deepEqual(sortInsightRows(rows, 'revenue').map((row) => row.label), ['B', 'A']);
  assert.deepEqual(sortInsightRows(rows, 'revenue', false).map((row) => row.label), ['A', 'B']);
  assert.equal(rows[0].label, 'A');
});
