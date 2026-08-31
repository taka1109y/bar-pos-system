'use strict';
// POS 本体（server/routes/reports.js）と同一の集計定義を参照する
// reports.js 末尾で追加 export された定数・関数を取り込み、未定義なら起動時に throw する。
// ここ経由の fetchRangeTotals は server/db/database.js の Pool（DATABASE_URL=bar_ro）で動く。
const path = require('path');

const REPORTS_PATH = path.resolve(__dirname, '..', '..', '..', 'server', 'routes', 'reports.js');
const reports = require(REPORTS_PATH);

const REQUIRED = ['RECIPE_COST_CTE', 'PAID_FILTER', 'RANGE_FILTER', 'fetchRangeTotals', 'changePct', 'rate'];
const missing = REQUIRED.filter((k) => reports[k] === undefined);
if (missing.length > 0) {
  throw new Error(
    `server/routes/reports.js の export 追加が必要です（未定義: ${missing.join(', ')}）。` +
    `reports.js 末尾の "module.exports = router;" の後ろに module.exports.<name> = <name>; を追記してください`
  );
}

module.exports = {
  RECIPE_COST_CTE: reports.RECIPE_COST_CTE,
  PAID_FILTER: reports.PAID_FILTER,
  RANGE_FILTER: reports.RANGE_FILTER,
  fetchRangeTotals: reports.fetchRangeTotals,
  changePct: reports.changePct,
  rate: reports.rate,
};
