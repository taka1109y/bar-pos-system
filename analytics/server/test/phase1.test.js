'use strict';
// Phase 1 追加分（businessDay の粒度バケット・日付演算・period の比較期間）のユニットテスト
// node --test test/  で実行
const test = require('node:test');
const assert = require('node:assert/strict');
const bd = require('../lib/businessDay');
const period = require('../lib/period');

test('rangeWhereParam: sargable な期間フィルタ（[start,end,TZ,B] の $1..$4）', () => {
  assert.equal(
    bd.rangeWhereParam('o.closed_at'),
    "(o.closed_at >= ($1::date::timestamp + make_interval(hours => $4::int)) AT TIME ZONE $3" +
    " AND o.closed_at < (($2::date + 1)::timestamp + make_interval(hours => $4::int)) AT TIME ZONE $3)"
  );
});

test('dateExprParam / hour32ExprParam', () => {
  assert.equal(bd.dateExprParam('o.closed_at'),
    "((o.closed_at AT TIME ZONE $3) - make_interval(hours => $4::int))::date");
  assert.ok(bd.hour32ExprParam('oi.created_at').includes('CASE WHEN'));
});

test('effectiveBoundary: calendar は常に 0', () => {
  assert.equal(bd.effectiveBoundary('calendar', 9), 0);
  assert.equal(bd.effectiveBoundary('business', 9), 9);
  assert.throws(() => bd.effectiveBoundary('weekly', 9));
});

test('bucketExpr: 粒度ごとの SQL 式', () => {
  const d = 'D';
  assert.equal(bd.bucketExpr('day', d), 'D');
  assert.equal(bd.bucketExpr('week', d, { weekStartDow: 1 }),
    '(D - ((EXTRACT(DOW FROM D)::int - 1 + 7) % 7))');
  assert.equal(bd.bucketExpr('month', d), "date_trunc('month', D)::date");
  assert.equal(bd.bucketExpr('fiscal_year', d, { fiscalYearStartMonth: 1 }), "date_trunc('year', D)::date");
  assert.equal(bd.bucketExpr('fiscal_year', d, { fiscalYearStartMonth: 4 }),
    "(date_trunc('year', D - make_interval(months => 3)) + make_interval(months => 3))::date");
  assert.throws(() => bd.bucketExpr('hourly', d));
});

test('addDays / diffDays / dowOf / addYears', () => {
  assert.equal(bd.addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(bd.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(bd.diffDays('2026-08-01', '2026-08-31'), 30);
  assert.equal(bd.dowOf('2026-08-30'), 0); // 日曜
  assert.equal(bd.addYears('2026-08-30', -1), '2025-08-30');
  assert.equal(bd.addYears('2024-02-29', -1), '2023-02-28'); // 存在しない日は月末へ丸め
});

test('assertYmd: 不正は {status:400}', () => {
  assert.equal(bd.assertYmd('2026-08-30', 'start'), '2026-08-30');
  assert.throws(() => bd.assertYmd('2026-02-30', 'start'), (e) => e.status === 400);
  assert.throws(() => bd.assertYmd('2026/08/30', 'start'), (e) => e.status === 400);
  assert.throws(() => bd.assertYmd(undefined, 'a_start'), (e) => e.status === 400);
});

test('bucketStartOf / nextBucketStart', () => {
  // 2026-08-30 は日曜。週起点=月曜なら 8/24 が週初日
  assert.equal(bd.bucketStartOf('week', '2026-08-30', { weekStartDow: 1 }), '2026-08-24');
  assert.equal(bd.bucketStartOf('week', '2026-08-30', { weekStartDow: 0 }), '2026-08-30');
  assert.equal(bd.bucketStartOf('month', '2026-08-30'), '2026-08-01');
  assert.equal(bd.bucketStartOf('fiscal_year', '2026-03-31', { fiscalYearStartMonth: 4 }), '2025-04-01');
  assert.equal(bd.bucketStartOf('fiscal_year', '2026-04-01', { fiscalYearStartMonth: 4 }), '2026-04-01');
  assert.equal(bd.nextBucketStart('month', '2026-12-01'), '2027-01-01');
  assert.equal(bd.nextBucketStart('fiscal_year', '2026-04-01'), '2027-04-01');
});

test('enumerateBuckets: 0埋め用の全バケット', () => {
  assert.deepEqual(bd.enumerateBuckets('day', '2026-08-30', '2026-09-01'),
    ['2026-08-30', '2026-08-31', '2026-09-01']);
  assert.deepEqual(bd.enumerateBuckets('week', '2026-08-30', '2026-09-08', { weekStartDow: 1 }),
    ['2026-08-24', '2026-08-31', '2026-09-07']);
  assert.deepEqual(bd.enumerateBuckets('month', '2026-11-15', '2027-01-02'),
    ['2026-11-01', '2026-12-01', '2027-01-01']);
  assert.throws(() => bd.enumerateBuckets('day', '2000-01-01', '2030-01-01', {}, 100), (e) => e.status === 400);
});

test('label: 表示ラベル', () => {
  assert.equal(bd.label('day', '2026-08-30'), '8/30(日)');
  assert.equal(bd.label('week', '2026-08-25'), '8/25週');
  assert.equal(bd.label('month', '2026-08-01'), '2026-08');
  assert.equal(bd.label('fiscal_year', '2026-04-01'), '2026年度');
  assert.equal(bd.hour32Label(21), '21時');
  assert.equal(bd.hour32Label(26), '26時(翌2時)');
});

test('period.comparisonRange', () => {
  // 8/1〜8/31（31日間）
  assert.deepEqual(period.comparisonRange('prev_period', '2026-08-01', '2026-08-31'),
    { start: '2026-07-01', end: '2026-07-31' });
  assert.deepEqual(period.comparisonRange('prev_week', '2026-08-30', '2026-08-30'),
    { start: '2026-08-23', end: '2026-08-23' });
  assert.deepEqual(period.comparisonRange('prev_year', '2026-08-30', '2026-08-30'),
    { start: '2025-08-30', end: '2025-08-30' });
  assert.deepEqual(period.comparisonRange('prev_year_dow', '2026-08-30', '2026-08-30'),
    { start: '2025-08-31', end: '2025-08-31' });
  // 前年同曜日: 364日前は同じ曜日
  assert.equal(bd.dowOf('2025-08-31'), bd.dowOf('2026-08-30'));
});

test('period.parseCompare', () => {
  assert.deepEqual(period.parseCompare(undefined), []);
  assert.deepEqual(period.parseCompare('prev_period'), ['prev_period']);
  assert.deepEqual(period.parseCompare('prev_period, prev_week,prev_period'), ['prev_period', 'prev_week']);
  assert.throws(() => period.parseCompare('prev_month'), (e) => e.status === 400);
});
