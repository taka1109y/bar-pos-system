'use strict';
// node --test test/  で実行
const test = require('node:test');
const assert = require('node:assert/strict');
const bd = require('../lib/businessDay');

test('dateExpr: business/calendar の SQL 式', () => {
  assert.equal(bd.dateExpr('calendar', 'o.closed_at', { tz: 'Asia/Tokyo' }), "(o.closed_at AT TIME ZONE 'Asia/Tokyo')::date");
  assert.equal(bd.dateExpr('business', 'o.closed_at', { tz: 'Asia/Tokyo', boundary: 9 }),
    "((o.closed_at AT TIME ZONE 'Asia/Tokyo') - INTERVAL '9 hours')::date");
  // boundary=0 の営業日は暦日と同じ
  assert.equal(bd.dateExpr('business', 'o.closed_at', { tz: 'Asia/Tokyo', boundary: 0 }), "(o.closed_at AT TIME ZONE 'Asia/Tokyo')::date");
  assert.throws(() => bd.dateExpr('weekly', 'o.closed_at'));
  assert.throws(() => bd.dateExpr('business', 'o.closed_at', { boundary: 13 }));
});

test('rangeWhere: プレースホルダ番号を差し替えられる', () => {
  assert.equal(bd.rangeWhere('business', 'o.closed_at', { tz: 'Asia/Tokyo', boundary: 9, startParam: '$2', endParam: '$3' }),
    "((o.closed_at AT TIME ZONE 'Asia/Tokyo') - INTERVAL '9 hours')::date BETWEEN $2::date AND $3::date");
});

test('hour32Expr', () => {
  assert.equal(bd.hour32Expr('o.closed_at', { tz: 'Asia/Tokyo', boundary: 9 }),
    "(EXTRACT(HOUR FROM (o.closed_at AT TIME ZONE 'Asia/Tokyo'))::int + CASE WHEN EXTRACT(HOUR FROM (o.closed_at AT TIME ZONE 'Asia/Tokyo'))::int < 9 THEN 24 ELSE 0 END)");
  assert.equal(bd.hour32Expr('o.closed_at', { tz: 'Asia/Tokyo', boundary: 0 }),
    "EXTRACT(HOUR FROM (o.closed_at AT TIME ZONE 'Asia/Tokyo'))::int");
});

test('businessDateOf / todayBusiness: 境界前は前日扱い', () => {
  const tz = 'Asia/Tokyo';
  const at0300 = new Date('2026-08-30T03:00:00+09:00'); // 深夜3時
  const at0900 = new Date('2026-08-30T09:00:00+09:00'); // 境界ちょうど
  const at2330 = new Date('2026-08-30T23:30:00+09:00');
  assert.equal(bd.businessDateOf(at0300, 9, tz), '2026-08-29');
  assert.equal(bd.businessDateOf(at0900, 9, tz), '2026-08-30');
  assert.equal(bd.businessDateOf(at2330, 9, tz), '2026-08-30');
  assert.equal(bd.businessDateOf(at0300, 0, tz), '2026-08-30');
  assert.equal(bd.calendarDateOf(at0300, tz), '2026-08-30');
  assert.equal(bd.todayBusiness(9, at0300, tz), '2026-08-29');
  assert.equal(bd.todayCalendar(at0300, tz), '2026-08-30');
  // 月またぎ
  assert.equal(bd.businessDateOf(new Date('2026-09-01T02:00:00+09:00'), 9, tz), '2026-08-31');
});

test('hour32Of', () => {
  const tz = 'Asia/Tokyo';
  assert.equal(bd.hour32Of(new Date('2026-08-30T03:00:00+09:00'), 9, tz), 27);
  assert.equal(bd.hour32Of(new Date('2026-08-30T00:10:00+09:00'), 9, tz), 24);
  assert.equal(bd.hour32Of(new Date('2026-08-30T17:00:00+09:00'), 9, tz), 17);
  assert.equal(bd.hour32Of(new Date('2026-08-30T03:00:00+09:00'), 0, tz), 3);
});

test('dateOf: モード切替', () => {
  const at = new Date('2026-08-30T03:00:00+09:00');
  assert.equal(bd.dateOf('business', at, 9, 'Asia/Tokyo'), '2026-08-29');
  assert.equal(bd.dateOf('calendar', at, 9, 'Asia/Tokyo'), '2026-08-30');
});
