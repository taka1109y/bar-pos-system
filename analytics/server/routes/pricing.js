'use strict';
// /api/v1/pricing — 価格変動（Phase7 価格モデル）の効果分析 API（Phase 5）
// - bardb へは pos.query（WITH/SELECT/EXPLAIN ガード付き）のみ。期間フィルタ付きクエリの
//   プレースホルダ順は [start, end, TZ, B] を厳守する（追加は $5 以降。バッチ集計だけは
//   期間フィルタを使わないため独自の配列パラメータを使う＝各所にコメントを置く）
// - 共通クエリ（start/end/day_mode/boundary_hour）の解決は routes/sales.js の resolveContext を再利用する
// - 呼値（1段の値幅）と暴落の既定継続時間は lib/pricingDefs.js 経由で本番 server/services/pricingModel.js の
//   凍結パラメータをそのまま使う（分析側で定義を二重に持たない）
// - 値引き費用は本番 server/routes/reports.js の /discount-cost と**同一定義**を SQL で再現する。
//   一致は meta の verify チェック legacy_match_discount_cost（day_mode=calendar）が保証する
// - CSV 出力(routes/export.js)と検証(routes/meta.js)から再利用できるよう、fetch 群を末尾で追加 export する
//
// ■ 用語（CLAUDE.md「価格エンジン（Phase7）凍結パラメータ」より）
//   base          … menu_items.base_price（定価）。約定時のスナップは order_items.base_price_at_order
//   pricing_base  … 帯の中心 = round_to_unit(base × 1.10)。エンジンはこの上下 ±GRID_HALF_SPAN 段で動く
//   呼値 step     … max(¥10, floor(pricing_base × 2% / ¥10) × ¥10)。段数はこの値で割って数える
//   シーソー      … 注文された銘柄が +k 段上がり、その分を同カテゴリの他銘柄へ −1 段ずつ配分（段ゼロサム）
//   暴落          … crash_manual で crash_floor へ即時、既定 5 分後に crash_reset で元の格子位置へ戻す
//   寄り付き      … market_open。engine_enabled のドリンクを pricing_base（n=0）へ戻す
const express = require('express');
const pos = require('../db/pos');
const posDefs = require('../lib/posDefs');
const pricingDefs = require('../lib/pricingDefs');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');
const sales = require('./sales');

const router = express.Router();

const { PAID_FILTER, rate } = posDefs;

// パラメータ化 SQL 断片（$1=start, $2=end, $3=TZ, $4=B。sales.js / products.js と同じ式）
const RANGE_W = bd.rangeWhereParam('o.closed_at');     // 会計日基準（明細の集計はこれで絞る）
const DATE_B = bd.dateExprParam('o.closed_at');        // 営業日/暦日（B=0 で暦日）
const RANGE_EVENT = bd.rangeWhereParam('pe.event_time'); // 価格イベントは発生時刻基準

// 値引き費用（暴落原資）の定義。本番 server/routes/reports.js の /discount-cost から**一字一句そのまま**。
// 変えると legacy と数字が食い違い、verify の legacy_match_discount_cost が FAIL する
const COST_EXPR = 'GREATEST(0, COALESCE(oi.base_price_at_order, m.base_price) - oi.unit_price) * oi.quantity';
const NET_EXPR = '(oi.unit_price - COALESCE(oi.base_price_at_order, m.base_price)) * oi.quantity';
const DISCOUNTED = 'oi.unit_price < COALESCE(oi.base_price_at_order, m.base_price)';

const BAND_WIDTH_PCT = 5;   // バンドの刻み（5%）
const MAX_BANDS = 200;      // 0埋めの暴走防止（±500% 相当。実データで超えることはない）
const CRASH_GROUP_GAP_S = 60; // 同一操作とみなす price_events のグルーピング幅（±60秒）
const REF_WEEK_OFFSETS = [7, 14, 21, 28]; // 参照期間: 直近4週の同曜日・同時間帯
const MAX_CRASH_WINDOWS = 500; // 応答サイズと集計コストの上限

const BANDS_NOTE =
  'バンドは明細ごとの「約定単価 ÷ 定価 − 1」を5%刻みで集計したもの。定価は約定時スナップ(base_price_at_order)優先、'
  + '無ければ現行 base_price。share_pct は数量構成比、revenue_share_pct は売上構成比';
const CRASH_NOTE =
  '暴落区間は price_events の crash_manual 群（±60秒でグルーピング）で始まり、対応する crash_reset 群で終わる'
  + `（無い場合は開始 + ${pricingDefs.CRASH_MINUTES}分）。in_window は区間内に注文された明細すべて（暴落銘柄以外も含む）で、`
  + 'crashed_items_* は暴落した銘柄だけの内訳。reference は直近4週の同曜日・同時間帯（同じ長さ）の平均';
const SEESAW_NOTE =
  '段数は (price_after − price_before) を各銘柄の呼値で割った絶対値（四捨五入）。呼値は現行 base_price から算出するため、'
  + '期間中に定価を改定した銘柄はズレ得る。step_distribution は seesaw_win の分布'
  + '（seesaw_lose は段ゼロサム配分の設計上つねに1段）';

// meta に付与する共通情報（sales.js / products.js の metaExtra と同じ形）
function metaExtra(ctx, note, extra) {
  return { day_mode: ctx.dayMode, boundary_hour: ctx.boundaryHour, ...(note ? { note } : {}), ...(extra || {}) };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// バンドの表示ラベル。-20 → "-20%"、0 → "0%"、5 → "+5%"
function signedPct(n) {
  return n > 0 ? `+${n}%` : `${n}%`;
}

function bandLabel(minPct, maxPct) {
  return `${signedPct(minPct)}〜${signedPct(maxPct)}`;
}

// バンド番号 idx = FLOOR((約定単価/定価 − 1) × 100 ÷ 5)。定価0/NULL の明細は idx=NULL に落ちる（＝除外分）。
// ※ この式に渡す unit_price / base は **NUMERIC のまま**であること（下の BAND_SRC を参照）。
//    ::float(倍精度) にすると比率がちょうど 5% の倍数になる明細で丸め誤差が出て 1 バンド下にずれる。
//    例: 920 / 800 は本来ちょうど +15.0%（NUMERIC なら (920/800-1)*20 = 3.0 ちょうど）だが、
//    float では 2.9999999999999982 → FLOOR=2 となり「+15%〜+20%」が「+10%〜+15%」に落ちる。
//    価格が pricing_base ± step の格子に乗る設計上、境界ちょうどの明細は常に一定数出るため実害がある。
//    NUMERIC 除算は終端小数（5% の倍数は必ず終端小数）を厳密に表すのでバンド境界はずれない。
//    回帰テストは test/pricing.test.js（(920, 800) が +15%〜+20% に入ること）
const BAND_IDX_EXPR =
  `CASE WHEN base > 0 THEN FLOOR(((unit_price / base) - 1) * ${100 / BAND_WIDTH_PCT})::int END`;

// バンド集計の入力列。unit_price / base に ::float を付けないこと（上記の理由）。
// 金額の合計だけ SUM したあとに ::float へ寄せる（応答は従来どおり数値型）
const BAND_SRC = `SELECT oi.quantity::int AS quantity,
                oi.unit_price AS unit_price,
                COALESCE(oi.base_price_at_order, m.base_price) AS base
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN menu_items m ON m.id = oi.menu_item_id
         WHERE ${PAID_FILTER} AND ${RANGE_W}`;

const BANDS_SQL =
  `WITH src AS (
         ${BAND_SRC}
       )
       SELECT ${BAND_IDX_EXPR} AS idx,
              COALESCE(SUM(quantity), 0)::int AS quantity,
              COALESCE(SUM(quantity * unit_price), 0)::float AS revenue,
              COALESCE(SUM(quantity * base), 0)::float AS base_revenue,
              COUNT(*)::int AS line_count
       FROM src
       GROUP BY 1
       ORDER BY 1 NULLS LAST`;

// ---- fetch 群 ----

// 価格帯（定価比）別の販売数量・売上 + 値引き費用。
// bands は明細（order_items）ベース、discount は legacy /discount-cost と同一定義
async function fetchEffectData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  // 月次上限の判定に使う「end が属する月の月初〜end」（legacy /discount-cost と同じ切り方）
  const monthStart = `${end.slice(0, 7)}-01`;
  const monthParams = [monthStart, end, bd.TZ, B];

  const [bandQ, dailyQ, monthQ, capQ] = await Promise.all([
    pos.query(BANDS_SQL, params),
    pos.query(
      `SELECT ${DATE_B}::text AS date,
              COALESCE(SUM(${COST_EXPR}), 0)::float AS cost,
              COALESCE(SUM(${NET_EXPR}), 0)::float AS net,
              COUNT(*) FILTER (WHERE ${DISCOUNTED})::int AS count
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN menu_items m ON m.id = oi.menu_item_id
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1
       ORDER BY 1`,
      params
    ),
    pos.query(
      `SELECT COALESCE(SUM(${COST_EXPR}), 0)::float AS month_total
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN menu_items m ON m.id = oi.menu_item_id
       WHERE ${PAID_FILTER} AND ${RANGE_W}`,
      monthParams
    ),
    // 月次上限は bardb の system_settings（0 = 無効、行が無ければ null）
    pos.query(`SELECT value FROM system_settings WHERE key = 'monthly_discount_cap'`),
  ]);

  // ---- bands ----
  const rows = bandQ.rows;
  const excludedRow = rows.find((r) => r.idx === null) || null;
  const withIdx = rows.filter((r) => r.idx !== null);
  const totalQty = withIdx.reduce((a, r) => a + r.quantity, 0);
  const totalRevenue = withIdx.reduce((a, r) => a + r.revenue, 0);
  const totalBase = withIdx.reduce((a, r) => a + r.base_revenue, 0);

  let bands = [];
  if (withIdx.length > 0) {
    const map = new Map(withIdx.map((r) => [r.idx, r]));
    const minIdx = Math.min(...map.keys());
    const maxIdx = Math.max(...map.keys());
    // 観測された最小〜最大バンドを 0 埋めで連続させる（ヒストグラムとして読めるようにする）
    const from = maxIdx - minIdx + 1 > MAX_BANDS ? maxIdx - MAX_BANDS + 1 : minIdx;
    for (let i = from; i <= maxIdx; i++) {
      const r = map.get(i);
      const minPct = i * BAND_WIDTH_PCT;
      const maxPct = (i + 1) * BAND_WIDTH_PCT;
      bands.push({
        band_label: bandLabel(minPct, maxPct),
        band_min_pct: minPct,
        band_max_pct: maxPct,
        quantity: r ? r.quantity : 0,
        revenue: r ? r.revenue : 0,
        share_pct: rate(r ? r.quantity : 0, totalQty),
        revenue_share_pct: rate(r ? r.revenue : 0, totalRevenue),
      });
    }
  }

  // ---- discount（legacy と同一定義）----
  const total = dailyQ.rows.reduce((a, r) => a + r.cost, 0);
  const netDiff = dailyQ.rows.reduce((a, r) => a + r.net, 0);
  const monthTotal = monthQ.rows[0].month_total;
  const capRow = capQ.rows[0];
  const monthlyCap = capRow === undefined ? null : (parseInt(capRow.value, 10) || 0);
  const capUsagePct = monthlyCap && monthlyCap > 0 ? round1((monthTotal / monthlyCap) * 100) : null;

  return {
    bands,
    discount: {
      total,
      net_diff: netDiff,
      by_day: dailyQ.rows.map((r) => ({ date: r.date, amount: r.cost, net_diff: r.net, count: r.count })),
      monthly_cap: monthlyCap,
      cap_usage_pct: capUsagePct,
      month_start: monthStart,
      month_total: monthTotal,
      over_cap: monthlyCap != null && monthlyCap > 0 && monthTotal > monthlyCap,
    },
    summary: {
      quantity_total: totalQty,
      revenue_total: totalRevenue,
      // 金額加重の平均比率（Σ約定額 ÷ Σ定価額 − 1）。単純平均だと安い1杯が高額1杯と同じ重みになる
      avg_ratio_pct: totalBase > 0 ? round1((totalRevenue / totalBase - 1) * 100) : null,
      base_revenue_total: totalBase,
      excluded_lines: excludedRow ? excludedRow.line_count : 0,
      excluded_quantity: excludedRow ? excludedRow.quantity : 0,
    },
  };
}

// price_events の行を「時刻が近いものは同じ操作」とみなしてグルーピングする。
// 直前のイベントとの間隔が gapSeconds を超えたら新しい群にする（rows は event_time 昇順であること）
function groupByTime(rows, gapSeconds = CRASH_GROUP_GAP_S) {
  const groups = [];
  let cur = null;
  let prevMs = 0;
  for (const r of rows) {
    const ms = new Date(r.event_time).getTime();
    if (cur === null || ms - prevMs > gapSeconds * 1000) {
      cur = { started_at: r.event_time, ended_at: r.event_time, rows: [] };
      groups.push(cur);
    }
    cur.rows.push(r);
    cur.ended_at = r.event_time;
    prevMs = ms;
  }
  return groups;
}

// 暴落区間（crash_manual 群 → crash_reset 群）と、その区間の売れ行き・参照期間比を返す
async function fetchCrashWindowsData(start, end, B, dayMode, boundaryHour) {
  // crash_reset は区間の終わりなので end の翌日まで拾う（end 当日深夜に発動した暴落を取りこぼさない）
  const fetchEnd = bd.addDays(end, 1);
  const { rows: events } = await pos.query(
    `SELECT pe.menu_item_id, m.name,
            pe.price_before::float AS price_before,
            pe.price_after::float AS price_after,
            pe.event_type, pe.event_time
     FROM price_events pe
     JOIN menu_items m ON m.id = pe.menu_item_id
     WHERE pe.event_type IN ('crash_manual', 'crash_reset') AND ${RANGE_EVENT}
     ORDER BY pe.event_time, pe.menu_item_id`,
    [start, fetchEnd, bd.TZ, B]
  );

  const crashGroups = groupByTime(events.filter((e) => e.event_type === 'crash_manual'));
  const resetGroups = groupByTime(events.filter((e) => e.event_type === 'crash_reset'));

  // 区間の確定: 開始 = crash_manual 群の先頭、終了 = 次の crash_manual 群より前にある最初の crash_reset 群。
  // 対応する crash_reset が無い（記録漏れ・サーバ再起動など）ときは既定の継続時間で閉じる
  const windows = [];
  for (let i = 0; i < crashGroups.length; i++) {
    const g = crashGroups[i];
    const startMs = new Date(g.started_at).getTime();
    const nextStartMs = i + 1 < crashGroups.length ? new Date(crashGroups[i + 1].started_at).getTime() : Infinity;
    const reset = resetGroups.find((rg) => {
      const ms = new Date(rg.started_at).getTime();
      return ms >= startMs && ms < nextStartMs;
    });
    const endMs = reset
      ? new Date(reset.started_at).getTime()
      : startMs + pricingDefs.CRASH_MINUTES * 60 * 1000;
    // 区間の帰属営業日でリクエスト期間に絞る（fetchEnd で1日多く拾っているため）
    const businessDate = bd.dateOf(dayMode, new Date(startMs), boundaryHour);
    if (businessDate < start || businessDate > end) continue;
    windows.push({
      business_date: businessDate,
      started_at: new Date(startMs).toISOString(),
      ended_at: new Date(endMs).toISOString(),
      minutes: round1((endMs - startMs) / 60000),
      reset_recorded: Boolean(reset),
      rows: g.rows,
    });
    if (windows.length >= MAX_CRASH_WINDOWS) break;
  }

  if (windows.length === 0) {
    return { windows: [], reference_weeks: REF_WEEK_OFFSETS };
  }

  const wStarts = windows.map((w) => w.started_at);
  const wEnds = windows.map((w) => w.ended_at);
  // 暴落した銘柄の明細だけを取り出すための menu_item_id 配列（区間ごと）
  const wItemIds = windows.map((w) => [...new Set(w.rows.map((r) => r.menu_item_id))]);

  // 区間内・参照期間の集計は「期間フィルタ」ではなく区間の timestamptz 配列で引くため、
  // 例外的に [start, end, TZ, B] ではなく独自のパラメータ順を使う（$1=開始配列, $2=終了配列, …）
  const [inQ, crashedQ, refQ, openDaysQ] = await Promise.all([
    pos.query(
      `SELECT w.idx::int AS idx,
              COALESCE(SUM(x.quantity), 0)::int AS quantity,
              COALESCE(SUM(x.quantity * x.unit_price), 0)::float AS revenue,
              COUNT(DISTINCT x.order_id)::int AS orders
       FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS w(w_start, w_end, idx)
       LEFT JOIN LATERAL (
         SELECT oi.quantity::int AS quantity, oi.unit_price::float AS unit_price, o.id AS order_id
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE ${PAID_FILTER} AND oi.created_at >= w.w_start AND oi.created_at < w.w_end
       ) x ON TRUE
       GROUP BY w.idx
       ORDER BY w.idx`,
      [wStarts, wEnds]
    ),
    // 暴落した銘柄だけの内訳（区間ごとに menu_item_id の配列で絞る）
    pos.query(
      `SELECT w.idx::int AS idx,
              COALESCE(SUM(x.quantity), 0)::int AS quantity,
              COALESCE(SUM(x.quantity * x.unit_price), 0)::float AS revenue
       FROM unnest($1::timestamptz[], $2::timestamptz[], $3::text[]) WITH ORDINALITY AS w(w_start, w_end, ids, idx)
       LEFT JOIN LATERAL (
         SELECT oi.quantity::int AS quantity, oi.unit_price::float AS unit_price
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE ${PAID_FILTER}
           AND oi.created_at >= w.w_start AND oi.created_at < w.w_end
           AND oi.menu_item_id = ANY (string_to_array(w.ids, ',')::int[])
       ) x ON TRUE
       GROUP BY w.idx
       ORDER BY w.idx`,
      [wStarts, wEnds, wItemIds.map((ids) => ids.join(','))]
    ),
    pos.query(
      `SELECT w.idx::int AS idx, d.off::int AS off,
              COALESCE(SUM(x.quantity), 0)::int AS quantity,
              COALESCE(SUM(x.quantity * x.unit_price), 0)::float AS revenue,
              COUNT(DISTINCT x.order_id)::int AS orders
       FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS w(w_start, w_end, idx)
       CROSS JOIN unnest($3::int[]) AS d(off)
       LEFT JOIN LATERAL (
         SELECT oi.quantity::int AS quantity, oi.unit_price::float AS unit_price, o.id AS order_id
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE ${PAID_FILTER}
           AND oi.created_at >= w.w_start - make_interval(days => d.off)
           AND oi.created_at <  w.w_end   - make_interval(days => d.off)
       ) x ON TRUE
       GROUP BY w.idx, d.off
       ORDER BY w.idx, d.off`,
      [wStarts, wEnds, REF_WEEK_OFFSETS]
    ),
    // 参照週の「営業していた日」判定（会計が1件も無い日は平均の分母に入れない）
    pos.query(
      `SELECT ${DATE_B}::text AS date
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_W}
       GROUP BY 1`,
      [bd.addDays(start, -Math.max(...REF_WEEK_OFFSETS)), end, bd.TZ, B]
    ),
  ]);

  const inMap = new Map(inQ.rows.map((r) => [r.idx, r]));
  const crashedMap = new Map(crashedQ.rows.map((r) => [r.idx, r]));
  const refMap = new Map(refQ.rows.map((r) => [`${r.idx}:${r.off}`, r]));
  const openDays = new Set(openDaysQ.rows.map((r) => r.date));

  const out = windows.map((w, i) => {
    const idx = i + 1; // WITH ORDINALITY は 1 始まり
    const inW = inMap.get(idx) || { quantity: 0, revenue: 0, orders: 0 };
    const crashed = crashedMap.get(idx) || { quantity: 0, revenue: 0 };

    // 参照期間: 直近4週の同曜日・同時間帯。JST に夏時間は無いので 7 日引けば同じ壁時計時刻になる。
    // 「その日に会計が1件も無い週（＝休業日）」は平均の分母から外す
    const used = [];
    for (const off of REF_WEEK_OFFSETS) {
      const refDate = bd.dateOf(dayMode, new Date(new Date(w.started_at).getTime() - off * 86400000), boundaryHour);
      if (!openDays.has(refDate)) continue;
      used.push(refMap.get(`${idx}:${off}`) || { quantity: 0, revenue: 0, orders: 0 });
    }
    const reference = used.length === 0
      ? { quantity: null, revenue: null, orders: null, basis: 'none', weeks_used: 0 }
      : {
        quantity: round1(used.reduce((a, r) => a + r.quantity, 0) / used.length),
        revenue: round1(used.reduce((a, r) => a + r.revenue, 0) / used.length),
        orders: round1(used.reduce((a, r) => a + r.orders, 0) / used.length),
        basis: 'prev_4_weeks_same_dow_time',
        weeks_used: used.length,
      };

    return {
      business_date: w.business_date,
      started_at: w.started_at,
      ended_at: w.ended_at,
      minutes: w.minutes,
      reset_recorded: w.reset_recorded,
      item_count: new Set(w.rows.map((r) => r.menu_item_id)).size,
      items: w.rows.map((r) => ({
        menu_item_id: r.menu_item_id,
        name: r.name,
        price_before: r.price_before,
        crash_price: r.price_after,
        drop_amount: r.price_before == null ? null : Math.round(r.price_before - r.price_after),
        drop_pct: r.price_before > 0 ? round1((r.price_after / r.price_before - 1) * 100) : null,
      })),
      in_window: { quantity: inW.quantity, revenue: inW.revenue, orders: inW.orders },
      crashed_items_quantity: crashed.quantity,
      crashed_items_revenue: crashed.revenue,
      reference,
      uplift_pct: reference.quantity != null && reference.quantity > 0
        ? round1((inW.quantity / reference.quantity - 1) * 100)
        : null,
    };
  });

  return { windows: out, reference_weeks: REF_WEEK_OFFSETS };
}

// シーソー（勝者・犠牲）と寄り付きの実施記録
async function fetchSeesawData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const [evQ, moQ] = await Promise.all([
    // (銘柄, 遷移) 単位に畳んでから JS で段数へ変換する（段数は呼値＝銘柄ごとの定数に依存するため SQL では出せない）
    pos.query(
      `SELECT pe.event_type, pe.menu_item_id, m.name, m.base_price::float AS base_price,
              pe.price_before::float AS price_before, pe.price_after::float AS price_after,
              COUNT(*)::int AS cnt
       FROM price_events pe
       JOIN menu_items m ON m.id = pe.menu_item_id
       WHERE pe.event_type IN ('seesaw_win', 'seesaw_lose') AND ${RANGE_EVENT}
       GROUP BY 1, 2, 3, 4, 5, 6`,
      params
    ),
    pos.query(
      `SELECT pe.event_time
       FROM price_events pe
       WHERE pe.event_type = 'market_open' AND ${RANGE_EVENT}
       ORDER BY pe.event_time`,
      params
    ),
  ]);

  const side = () => ({ count: 0, byItem: new Map(), steps: new Map(), unknownSteps: 0 });
  const acc = { seesaw_win: side(), seesaw_lose: side() };

  for (const r of evQ.rows) {
    const a = acc[r.event_type];
    if (!a) continue;
    a.count += r.cnt;
    const steps = r.price_before == null ? null : pricingDefs.stepsOf(r.base_price, r.price_after - r.price_before);
    const it = a.byItem.get(r.menu_item_id)
      || { menu_item_id: r.menu_item_id, name: r.name, count: 0, total_steps: 0 };
    it.count += r.cnt;
    if (steps != null) it.total_steps += steps * r.cnt;
    a.byItem.set(r.menu_item_id, it);
    if (steps == null) a.unknownSteps += r.cnt;
    else a.steps.set(steps, (a.steps.get(steps) || 0) + r.cnt);
  }

  const toSide = (a) => ({
    count: a.count,
    items: [...a.byItem.values()].sort((x, y) => y.count - x.count || y.total_steps - x.total_steps || x.name.localeCompare(y.name)),
  });
  const toDist = (a) => [...a.steps.entries()].sort((x, y) => x[0] - y[0]).map(([steps, count]) => ({ steps, count }));

  return {
    win: toSide(acc.seesaw_win),
    lose: toSide(acc.seesaw_lose),
    step_distribution: toDist(acc.seesaw_win),
    step_distribution_lose: toDist(acc.seesaw_lose),
    // 呼値が定義できない銘柄（base=0 の時価商品）は段数に数えられない
    unknown_step_events: acc.seesaw_win.unknownSteps + acc.seesaw_lose.unknownSteps,
    market_open: groupByTime(moQ.rows).map((g) => ({
      occurred_at: new Date(g.started_at).toISOString(),
      changed_count: g.rows.length,
    })),
  };
}

// ---- エンドポイント ----

// GET /api/v1/pricing/effect?start&end&day_mode
router.get('/effect', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const data = await fetchEffectData(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta(
      { start: ctx.start, end: ctx.end, ...data },
      metaExtra(ctx, BANDS_NOTE, {
        band_width_pct: BAND_WIDTH_PCT,
        excluded_lines: data.summary.excluded_lines,
      })
    ));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pricing/crash-windows?start&end&day_mode
router.get('/crash-windows', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const data = await fetchCrashWindowsData(ctx.start, ctx.end, ctx.B, ctx.dayMode, ctx.boundaryHour);
    res.json(await withMeta(
      { start: ctx.start, end: ctx.end, ...data },
      metaExtra(ctx, CRASH_NOTE, { default_crash_minutes: pricingDefs.CRASH_MINUTES })
    ));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pricing/seesaw?start&end&day_mode
router.get('/seesaw', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const data = await fetchSeesawData(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, SEESAW_NOTE)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)と検証(routes/meta.js)から同一定義を再利用するための追加 export（既存挙動は不変）
module.exports.fetchEffectData = fetchEffectData;
module.exports.fetchCrashWindowsData = fetchCrashWindowsData;
module.exports.fetchSeesawData = fetchSeesawData;
// 回帰テスト（test/pricing.test.js）がバンド集計の SQL をそのまま検証するための export
module.exports.BAND_IDX_EXPR = BAND_IDX_EXPR;
module.exports.BAND_SRC = BAND_SRC;
module.exports.BANDS_SQL = BANDS_SQL;
module.exports.BAND_WIDTH_PCT = BAND_WIDTH_PCT;
