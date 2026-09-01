'use strict';
// /api/v1/pricing の bands（価格帯別の販売数量・売上）の回帰テスト
// node --test test/  で実行。DB を使うケースは DATABASE_URL が無い環境では skip する
//
// 背景: バンド番号は FLOOR((約定単価/定価 − 1) × 20) で決まる。ここに倍精度浮動小数を持ち込むと、
// 比率がちょうど 5% の倍数になる明細（例: 920 / 800 = +15.0%）が 1 バンド下にずれる。
// 価格が pricing_base ± step の格子に乗る設計上そういう明細は常に一定数あるため、
// 「NUMERIC のまま割る」ことを型と実 DB の両面で固定する。
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../routes/pricing');

test('BAND_SRC: 比率計算に使う列を float にキャストしない（バンド境界ずれの回帰ガード）', () => {
  // src は unit_price / base を NUMERIC のまま渡す（::float を付けた瞬間に境界がずれる）
  assert.match(pricing.BAND_SRC, /oi\.unit_price AS unit_price/);
  assert.doesNotMatch(pricing.BAND_SRC, /unit_price::float/);
  assert.doesNotMatch(pricing.BAND_SRC, /base_price\)::float/);
  // 除算そのものにも float を持ち込まない
  assert.doesNotMatch(pricing.BAND_IDX_EXPR, /::float/);
  // 金額の合計は SUM したあとに float へ寄せる（応答の数値型は従来どおり）
  assert.match(pricing.BANDS_SQL, /SUM\(quantity \* unit_price\), 0\)::float/);
  assert.equal(pricing.BAND_WIDTH_PCT, 5);
});

test(
  'BAND_IDX_EXPR: 比率がちょうど 5% の倍数の明細も正しいバンドに入る（実 DB で評価）',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL 未設定のため skip' },
  async () => {
    const pos = require('../db/pos');
    // 実データと同じ numeric(10,2) で評価する。SELECT のみで bardb には何も書かない
    const { rows } = await pos.query(
      `WITH src AS (
         SELECT * FROM (VALUES
           (920::numeric(10,2), 800::numeric(10,2),  3),  -- ちょうど +15.0% → 「+15%〜+20%」（float だと 2 に落ちる）
           (960::numeric(10,2), 800::numeric(10,2),  4),  -- ちょうど +20.0% → 「+20%〜+25%」
           (800::numeric(10,2), 800::numeric(10,2),  0),  -- 定価どおり     → 「0%〜+5%」
           (700::numeric(10,2), 800::numeric(10,2), -3),  -- −12.5%         → 「-15%〜-10%」
           (600::numeric(10,2), 800::numeric(10,2), -5),  -- ちょうど −25.0% → 「-25%〜-20%」
           (250::numeric(10,2), 200::numeric(10,2),  5),  -- ちょうど +25.0% → 「+25%〜+30%」
           (500::numeric(10,2),   0::numeric(10,2), NULL) -- 定価0（時価）  → 除外（idx=NULL）
         ) v(unit_price, base, expected)
       )
       SELECT unit_price::float AS unit_price, base::float AS base,
              expected, ${pricing.BAND_IDX_EXPR} AS idx
       FROM src`
    );
    for (const r of rows) {
      assert.equal(r.idx, r.expected, `unit_price=${r.unit_price} / base=${r.base} のバンド番号`);
    }
    await pos.end();
  }
);
