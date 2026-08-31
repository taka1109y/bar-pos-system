'use strict';
// 比較期間の計算（Phase 1 契約）
//   prev_period   … 同じ日数だけ手前の期間（単日なら前日）
//   prev_week     … 7日手前（単日なら前週同曜日）
//   prev_year     … 1年前の同日付（2/29 など存在しない日は月末へ丸め）
//   prev_year_dow … 364日手前（前年同曜日）
const bd = require('./businessDay');

const COMPARE_KEYS = ['prev_period', 'prev_week', 'prev_year', 'prev_year_dow'];
const COMPARE_SET = new Set(COMPARE_KEYS);

function invalidCompare(key) {
  return { status: 400, error: `compare は ${COMPARE_KEYS.join(' / ')} のいずれかをカンマ区切りで指定してください: ${key}` };
}

// 比較キーと基準期間 [start, end] から比較期間 {start, end} を返す
function comparisonRange(key, start, end) {
  const days = bd.diffDays(start, end) + 1;
  switch (key) {
    case 'prev_period':
      return { start: bd.addDays(start, -days), end: bd.addDays(end, -days) };
    case 'prev_week':
      return { start: bd.addDays(start, -7), end: bd.addDays(end, -7) };
    case 'prev_year':
      return { start: bd.addYears(start, -1), end: bd.addYears(end, -1) };
    case 'prev_year_dow':
      return { start: bd.addDays(start, -364), end: bd.addDays(end, -364) };
    default:
      throw invalidCompare(key);
  }
}

// "prev_period,prev_week" 形式のクエリ値を検証付きで配列にする（重複除去・指定順維持）
function parseCompare(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const keys = String(raw).split(',').map((s) => s.trim()).filter((s) => s !== '');
  const out = [];
  for (const k of keys) {
    if (!COMPARE_SET.has(k)) throw invalidCompare(k);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

module.exports = { COMPARE_KEYS, comparisonRange, parseCompare };
