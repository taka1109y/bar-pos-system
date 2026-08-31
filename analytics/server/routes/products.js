'use strict';
// /api/v1/products — 商品分析 API（Phase 2）
// - bardb へは pos.query（WITH/SELECT/EXPLAIN ガード付き）のみ。プレースホルダ順は [start, end, TZ, B] を厳守
//   （追加パラメータは $5 以降に付ける）
// - 共通クエリ（start/end/day_mode/boundary_hour/granularity）の解決は routes/sales.js の
//   resolveContext を再利用する（sales.js の挙動は変えない）
// - 商品集計は order_items(明細)ベース。集計対象は posDefs.PAID_FILTER、原価は RECIPE_COST_CTE
// - ABC しきい値は analyticsdb の store_settings.abc_a_pct / abc_b_pct を読む
// - CSV 出力(routes/export.js)から再利用できるよう、fetch 群・パーサ群を末尾で追加 export する
const express = require('express');
const pos = require('../db/pos');
const ana = require('../db/ana');
const posDefs = require('../lib/posDefs');
const bd = require('../lib/businessDay');
const { withMeta } = require('../lib/withMeta');
const sales = require('./sales');

const router = express.Router();

const { RECIPE_COST_CTE, PAID_FILTER, rate } = posDefs;

// パラメータ化 SQL 断片（$1=start, $2=end, $3=TZ, $4=B。sales.js と同じ式）
const RANGE_W = bd.rangeWhereParam('o.closed_at'); // sargable な期間フィルタ（会計日基準）
const DATE_B = bd.dateExprParam('o.closed_at');    // 営業日/暦日（B=0 で暦日）

const BASIS_KEYS = ['revenue', 'quantity', 'gross_profit'];
const BASIS_SET = new Set(BASIS_KEYS);
const MIX_BYS = ['category', 'subcategory', 'drink_food', 'tax_category', 'staff_only'];
const MIX_BY_SET = new Set(MIX_BYS);
const TREND_MAX_ITEMS = 10;

// メニューエンジニアリング4象限の日本語ラベル（CSV でも使う）
const CLS_LABELS = { star: 'スター', plowhorse: '主力(薄利)', puzzle: '隠れた逸品', dog: '見直し候補' };

const PRODUCT_ITEM_NOTE = '商品集計は order_items(明細)ベースで、チャージ・深夜料金・会計単位の値引きを含みません';
const ENGINEERING_COST_NOTE =
  '原価未設定(has_cost=false)の商品は cost_per_unit=0 として計算されるため、1杯粗利が実態より過大に出ます';
const AFFINITY_NOTE = '併売は会計内の DISTINCT 商品集合から算出（数量は見ません）。lift>1 で「一緒に頼まれやすい」';

function badRequest(error) {
  return { status: 400, error };
}

// meta に付与する共通情報（sales.js の metaExtra と同じ形）
function metaExtra(ctx, note) {
  return { day_mode: ctx.dayMode, boundary_hour: ctx.boundaryHour, ...(note ? { note } : {}) };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// ---- クエリパーサ群（CSV 側でも同じ検証を使う）----

function parseBasis(v) {
  if (v === undefined) return 'revenue';
  if (!BASIS_SET.has(v)) throw badRequest(`basis は ${BASIS_KEYS.join(' / ')} のいずれかを指定してください`);
  return v;
}

function parseBoolFlag(v, name) {
  if (v === undefined) return false;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw badRequest(`${name} は true / false を指定してください`);
}

function parsePositiveInt(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${name} は正の整数を指定してください`);
  return n;
}

function parseIntInRange(v, min, max, def, name) {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${name} は ${min}〜${max} の整数を指定してください`);
  }
  return n;
}

// ranking / abc 共通のオプション（basis / include_unsold / category_id / subcategory_id）
function rankingOptionsFromQuery(q) {
  return {
    basis: parseBasis(q.basis),
    includeUnsold: parseBoolFlag(q.include_unsold, 'include_unsold'),
    categoryId: q.category_id !== undefined ? parsePositiveInt(q.category_id, 'category_id') : null,
    subcategoryId: q.subcategory_id !== undefined ? parsePositiveInt(q.subcategory_id, 'subcategory_id') : null,
  };
}

function mixByFromQuery(q) {
  const by = q.by !== undefined ? String(q.by) : 'category';
  if (!MIX_BY_SET.has(by)) throw badRequest(`by は ${MIX_BYS.join(' / ')} のいずれかを指定してください`);
  return by;
}

function affinityOptionsFromQuery(q) {
  return {
    minPair: parseIntInRange(q.min_pair, 1, 1000, 2, 'min_pair'),
    limit: parseIntInRange(q.limit, 1, 1000, 100, 'limit'),
    menuItemId: q.menu_item_id !== undefined ? parsePositiveInt(q.menu_item_id, 'menu_item_id') : null,
  };
}

// menu_item_ids=1,2,3 …… 1〜10件必須（重複は除去・指定順維持）
function trendIdsFromQuery(q) {
  if (q.menu_item_ids === undefined || String(q.menu_item_ids).trim() === '') {
    throw badRequest('menu_item_ids をカンマ区切りで 1〜10 件指定してください');
  }
  const out = [];
  for (const part of String(q.menu_item_ids).split(',')) {
    const s = part.trim();
    if (s === '') continue;
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0) {
      throw badRequest(`menu_item_ids に正の整数でない値が含まれています: ${s}`);
    }
    if (!out.includes(n)) out.push(n);
  }
  if (out.length < 1 || out.length > TREND_MAX_ITEMS) {
    throw badRequest(`menu_item_ids は 1〜${TREND_MAX_ITEMS} 件で指定してください（指定: ${out.length}件）`);
  }
  return out;
}

// ---- fetch 群（SQL は [start, end, TZ, B] ＋追加パラメータで実行する）----

// ABC しきい値（analyticsdb の store_settings）
async function loadAbcThresholds() {
  const { rows: [r] } = await ana.query('SELECT abc_a_pct, abc_b_pct FROM store_settings WHERE id = 1');
  if (!r) throw new Error('store_settings が初期化されていません');
  return { a_pct: r.abc_a_pct, b_pct: r.abc_b_pct };
}

function basisValueFn(basis) {
  switch (basis) {
    case 'quantity': return (it) => it.quantity;
    case 'gross_profit': return (it) => it.gross_profit;
    default: return (it) => it.revenue;
  }
}

// 商品ランキング＋ABC 分析の元データ。
// - 集計は GROUP BY oi.menu_item_id → menu_items へ結合（name は m.name。同一商品の時価リネームも1行に集約）
// - includeUnsold=true は menu_items 全件（is_active 問わず）への LEFT JOIN で quantity=0 行も返す
// - share/cum_share/abc_rank は basis の値が正の販売済み商品のみ降順に累積計算。
//   値0以下・未販売は share_pct=0 / cum_share_pct=null / abc_rank='C'
// - last_sold_at は期間内の MAX(oi.created_at の暦日) 文字列 or null（契約どおり営業日補正はしない）
async function fetchRankingData(start, end, B, opts = {}) {
  const basis = opts.basis || 'revenue';
  const includeUnsold = opts.includeUnsold === true;
  const params = [start, end, bd.TZ, B];
  const filters = [];
  if (opts.categoryId != null) {
    params.push(opts.categoryId);
    filters.push(`m.category_id = $${params.length}`);
  }
  if (opts.subcategoryId != null) {
    params.push(opts.subcategoryId);
    filters.push(`m.subcategory_id = $${params.length}`);
  }
  const menuFilter = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
  const soldJoin = includeUnsold ? 'LEFT JOIN sold s ON s.menu_item_id = m.id' : 'JOIN sold s ON s.menu_item_id = m.id';

  const [thresholds, { rows }] = await Promise.all([
    loadAbcThresholds(),
    pos.query(
      `WITH ${RECIPE_COST_CTE},
       sold AS (
         SELECT oi.menu_item_id,
                SUM(oi.quantity)::int AS quantity,
                SUM(oi.quantity * oi.unit_price)::float AS revenue,
                MAX((oi.created_at AT TIME ZONE $3))::date::text AS last_sold_at
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE ${PAID_FILTER} AND ${RANGE_W}
         GROUP BY oi.menu_item_id
       )
       SELECT m.id AS menu_item_id, m.name,
              m.category_id, c.name AS category,
              m.subcategory_id, sc.name AS subcategory,
              m.is_drink, m.tax_category, m.is_staff_only, m.price_editable, m.is_active,
              COALESCE(s.quantity, 0)::int AS quantity,
              COALESCE(s.revenue, 0)::float AS revenue,
              COALESCE(rc.cost_per_unit, 0)::float AS cost_per_unit,
              s.last_sold_at
       FROM menu_items m
       ${soldJoin}
       LEFT JOIN categories c ON c.id = m.category_id
       LEFT JOIN subcategories sc ON sc.id = m.subcategory_id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = m.id
       WHERE TRUE${menuFilter}`,
      params
    ),
  ]);

  const items = rows.map((r) => {
    const totalCost = r.quantity * r.cost_per_unit;
    const grossProfit = r.revenue - totalCost;
    return {
      menu_item_id: r.menu_item_id,
      name: r.name,
      category_id: r.category_id,
      category: r.category,
      subcategory_id: r.subcategory_id,
      subcategory: r.subcategory,
      is_drink: r.is_drink,
      tax_category: r.tax_category,
      is_staff_only: r.is_staff_only,
      price_editable: r.price_editable,
      is_active: r.is_active,
      quantity: r.quantity,
      revenue: r.revenue,
      avg_unit_price: r.quantity > 0 ? round1(r.revenue / r.quantity) : null,
      cost_per_unit: r.cost_per_unit,
      total_cost: totalCost,
      gross_profit: grossProfit,
      cost_rate: rate(totalCost, r.revenue),
      share_pct: 0,
      cum_share_pct: null,
      abc_rank: 'C',
      last_sold_at: r.last_sold_at || null,
    };
  });

  // basis の値で降順（同値は売上→id）。未販売・値0以下は末尾に落ちる
  const valueOf = basisValueFn(basis);
  items.sort((a, b) => valueOf(b) - valueOf(a) || b.revenue - a.revenue || a.menu_item_id - b.menu_item_id);

  // 構成比・累積構成比・ABC ランク（正の値のみで累積）
  const totalValue = items.reduce((acc, it) => acc + (valueOf(it) > 0 ? valueOf(it) : 0), 0);
  let cum = 0;
  for (const it of items) {
    const v = valueOf(it);
    if (totalValue > 0 && v > 0) {
      cum += v;
      it.share_pct = rate(v, totalValue);
      it.cum_share_pct = rate(cum, totalValue);
      it.abc_rank = it.cum_share_pct <= thresholds.a_pct ? 'A'
        : it.cum_share_pct <= thresholds.b_pct ? 'B' : 'C';
    }
  }
  return { basis, thresholds, items, total_value: totalValue };
}

// ranking の items から A/B/C クラス別サマリを作る
function buildAbcClasses(items, basis, totalValue) {
  const valueOf = basisValueFn(basis);
  return ['A', 'B', 'C'].map((rank) => {
    const members = items.filter((it) => it.abc_rank === rank);
    const value = members.reduce((acc, it) => acc + valueOf(it), 0);
    return { rank, item_count: members.length, value, share_pct: rate(value, totalValue) };
  });
}

// メニューミックス（by 別の構成）。share_pct は売上構成比
async function fetchMixRows(start, end, B, by) {
  let keyExpr;
  let nameExpr;
  let extraJoin = '';
  switch (by) {
    case 'category':
      keyExpr = 'm.category_id';
      nameExpr = `COALESCE(c.name, '(未分類)')`;
      extraJoin = 'LEFT JOIN categories c ON c.id = m.category_id';
      break;
    case 'subcategory':
      keyExpr = 'm.subcategory_id';
      nameExpr = `COALESCE(sc.name, '(未分類)')`;
      extraJoin = 'LEFT JOIN subcategories sc ON sc.id = m.subcategory_id';
      break;
    case 'drink_food':
      keyExpr = `CASE WHEN m.is_drink THEN 'drink' ELSE 'food' END`;
      nameExpr = `CASE WHEN m.is_drink THEN 'ドリンク' ELSE 'フード' END`;
      break;
    case 'tax_category':
      keyExpr = `COALESCE(m.tax_category, 'standard')`;
      nameExpr = `CASE WHEN m.tax_category = 'reduced' THEN '軽減税率' ELSE '標準税率' END`;
      break;
    case 'staff_only':
      keyExpr = `CASE WHEN m.is_staff_only THEN 'staff' ELSE 'normal' END`;
      nameExpr = `CASE WHEN m.is_staff_only THEN '裏メニュー' ELSE '通常' END`;
      break;
    default:
      throw badRequest(`by は ${MIX_BYS.join(' / ')} のいずれかを指定してください`);
  }
  const params = [start, end, bd.TZ, B];
  const { rows } = await pos.query(
    `WITH ${RECIPE_COST_CTE}
     SELECT ${keyExpr} AS key, ${nameExpr} AS name,
            SUM(oi.quantity)::int AS quantity,
            SUM(oi.quantity * oi.unit_price)::float AS revenue,
            SUM(oi.quantity * COALESCE(rc.cost_per_unit, 0))::float AS total_cost
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN menu_items m ON m.id = oi.menu_item_id
     ${extraJoin}
     LEFT JOIN recipe_cost rc ON rc.menu_item_id = oi.menu_item_id
     WHERE ${PAID_FILTER} AND ${RANGE_W}
     GROUP BY 1, 2
     ORDER BY revenue DESC`,
    params
  );
  const totalRevenue = rows.reduce((acc, r) => acc + r.revenue, 0);
  return rows.map((r) => {
    const grossProfit = r.revenue - r.total_cost;
    return {
      key: r.key,
      name: r.name,
      quantity: r.quantity,
      revenue: r.revenue,
      total_cost: r.total_cost,
      gross_profit: grossProfit,
      gross_profit_rate: rate(grossProfit, r.revenue),
      share_pct: rate(r.revenue, totalRevenue),
    };
  });
}

// 商品別推移（系列=商品、行は granularity バケットで0埋め）。
// バケットは sales/trend と同じ会計日（o.closed_at の営業日/暦日）基準
// ＝ 期間合計が ranking と一致する（明細の注文時刻ではなく会計に紐づける）
async function fetchProductTrendSeries(start, end, B, granularity, gopts, ids) {
  const bucket = bd.bucketExpr(granularity, DATE_B, gopts);
  const [namesQ, rowsQ] = await Promise.all([
    pos.query('SELECT id, name FROM menu_items WHERE id = ANY($1::int[])', [ids]),
    pos.query(
      `SELECT oi.menu_item_id,
              ${bucket}::text AS period_start,
              SUM(oi.quantity)::int AS quantity,
              SUM(oi.quantity * oi.unit_price)::float AS revenue
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE ${PAID_FILTER} AND ${RANGE_W} AND oi.menu_item_id = ANY($5::int[])
       GROUP BY 1, 2`,
      [start, end, bd.TZ, B, ids]
    ),
  ]);
  const nameMap = new Map(namesQ.rows.map((r) => [r.id, r.name]));
  const missing = ids.filter((id) => !nameMap.has(id));
  if (missing.length > 0) {
    throw badRequest(`存在しない menu_item_id が含まれています: ${missing.join(', ')}`);
  }
  const cellMap = new Map(rowsQ.rows.map((r) => [`${r.menu_item_id}:${r.period_start}`, r]));
  const buckets = bd.enumerateBuckets(granularity, start, end, gopts);
  return ids.map((id) => ({
    menu_item_id: id,
    name: nameMap.get(id),
    rows: buckets.map((p) => {
      const c = cellMap.get(`${id}:${p}`);
      const quantity = c ? c.quantity : 0;
      const revenue = c ? c.revenue : 0;
      return {
        period_start: p,
        label: bd.label(granularity, p),
        quantity,
        revenue,
        avg_unit_price: quantity > 0 ? round1(revenue / quantity) : null,
      };
    }),
  }));
}

// 併売分析。対象=PAID_FILTER の会計、会計内の DISTINCT menu_item_id 集合からペア(a_id<b_id)を数える。
// support_pct = pair/total_orders、confidence_ab = pair/ordersWithA、lift = pair*total/(ordersWithA*ordersWithB)
async function fetchAffinityData(start, end, B, opts = {}) {
  const minPair = opts.minPair != null ? opts.minPair : 2;
  const limit = opts.limit != null ? opts.limit : 100;
  const baseParams = [start, end, bd.TZ, B];
  const pairParams = [...baseParams, minPair];
  let pairFilter = '';
  if (opts.menuItemId != null) {
    pairParams.push(opts.menuItemId);
    pairFilter = ` AND (p.a_id = $${pairParams.length} OR p.b_id = $${pairParams.length})`;
  }
  const [totalQ, pairsQ] = await Promise.all([
    pos.query(
      `SELECT COUNT(*)::int AS total_orders FROM orders o WHERE ${PAID_FILTER} AND ${RANGE_W}`,
      baseParams
    ),
    pos.query(
      `WITH basket AS (
         SELECT DISTINCT o.id AS order_id, oi.menu_item_id
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE ${PAID_FILTER} AND ${RANGE_W}
       ),
       item_orders AS (
         SELECT menu_item_id, COUNT(*)::int AS order_cnt
         FROM basket
         GROUP BY 1
       ),
       pairs AS (
         SELECT a.menu_item_id AS a_id, b.menu_item_id AS b_id, COUNT(*)::int AS pair_orders
         FROM basket a
         JOIN basket b ON b.order_id = a.order_id AND a.menu_item_id < b.menu_item_id
         GROUP BY 1, 2
         HAVING COUNT(*) >= $5::int
       )
       SELECT p.a_id, ma.name AS a_name, p.b_id, mb.name AS b_name, p.pair_orders,
              ia.order_cnt AS orders_a, ib.order_cnt AS orders_b
       FROM pairs p
       JOIN menu_items ma ON ma.id = p.a_id
       JOIN menu_items mb ON mb.id = p.b_id
       JOIN item_orders ia ON ia.menu_item_id = p.a_id
       JOIN item_orders ib ON ib.menu_item_id = p.b_id
       WHERE TRUE${pairFilter}`,
      pairParams
    ),
  ]);
  const total = totalQ.rows[0].total_orders;
  const pairs = pairsQ.rows.map((r) => ({
    a_id: r.a_id,
    a_name: r.a_name,
    b_id: r.b_id,
    b_name: r.b_name,
    pair_orders: r.pair_orders,
    support_pct: rate(r.pair_orders, total),
    confidence_ab: rate(r.pair_orders, r.orders_a),
    confidence_ba: rate(r.pair_orders, r.orders_b),
    lift: total > 0 && r.orders_a > 0 && r.orders_b > 0
      ? round2((r.pair_orders * total) / (r.orders_a * r.orders_b))
      : null,
  }));
  pairs.sort((x, y) =>
    ((y.lift ?? -1) - (x.lift ?? -1))
    || (y.pair_orders - x.pair_orders)
    || (x.a_id - y.a_id)
    || (x.b_id - y.b_id));
  return { total_orders: total, pairs: pairs.slice(0, limit) };
}

// メニューエンジニアリング（4象限）。対象=当期間に1個以上売れた商品。
// しきい値は両軸とも販売商品の単純平均（平均以上=↑）。star=人気↑利益↑ / plowhorse=人気↑利益↓ /
// puzzle=人気↓利益↑ / dog=両↓
async function fetchEngineeringData(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const { rows } = await pos.query(
    `WITH ${RECIPE_COST_CTE}
     SELECT m.id AS menu_item_id, m.name, c.name AS category,
            SUM(oi.quantity)::int AS quantity,
            SUM(oi.quantity * oi.unit_price)::float AS revenue,
            COALESCE(MAX(rc.cost_per_unit), 0)::float AS cost_per_unit
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN menu_items m ON m.id = oi.menu_item_id
     LEFT JOIN categories c ON c.id = m.category_id
     LEFT JOIN recipe_cost rc ON rc.menu_item_id = m.id
     WHERE ${PAID_FILTER} AND ${RANGE_W}
     GROUP BY m.id, m.name, c.name
     ORDER BY quantity DESC, revenue DESC`,
    params
  );
  const totalQty = rows.reduce((acc, r) => acc + r.quantity, 0);
  const items = rows.map((r) => {
    const avgUnitPrice = r.quantity > 0 ? r.revenue / r.quantity : 0;
    return {
      menu_item_id: r.menu_item_id,
      name: r.name,
      category: r.category,
      quantity: r.quantity,
      qty_share_pct: rate(r.quantity, totalQty),
      avg_unit_price: round1(avgUnitPrice),
      cost_per_unit: r.cost_per_unit,
      unit_gross_profit: round1(avgUnitPrice - r.cost_per_unit),
      has_cost: r.cost_per_unit > 0,
      cls: 'dog',
    };
  });
  const n = items.length;
  const avgQtySharePct = n > 0 ? round1(items.reduce((acc, it) => acc + it.qty_share_pct, 0) / n) : 0;
  const avgUnitGrossProfit = n > 0 ? round1(items.reduce((acc, it) => acc + it.unit_gross_profit, 0) / n) : 0;
  for (const it of items) {
    const popular = it.qty_share_pct >= avgQtySharePct;
    const profitable = it.unit_gross_profit >= avgUnitGrossProfit;
    it.cls = popular ? (profitable ? 'star' : 'plowhorse') : (profitable ? 'puzzle' : 'dog');
  }
  return {
    thresholds: { avg_qty_share_pct: avgQtySharePct, avg_unit_gross_profit: avgUnitGrossProfit },
    items,
  };
}

// オプション（selected_option）別の販売実績。売上降順
async function fetchOptionsRows(start, end, B) {
  const params = [start, end, bd.TZ, B];
  const { rows } = await pos.query(
    `SELECT m.id AS menu_item_id, m.name, oi.selected_option,
            SUM(oi.quantity)::int AS quantity,
            SUM(oi.quantity * oi.unit_price)::float AS revenue
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE ${PAID_FILTER} AND ${RANGE_W} AND oi.selected_option IS NOT NULL
     GROUP BY m.id, m.name, oi.selected_option
     ORDER BY revenue DESC, quantity DESC, m.id`,
    params
  );
  return rows;
}

// ---- エンドポイント ----

// GET /api/v1/products/ranking?basis=&include_unsold=&category_id=&subcategory_id=
router.get('/ranking', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const opts = rankingOptionsFromQuery(req.query);
    const data = await fetchRankingData(ctx.start, ctx.end, ctx.B, opts);
    res.json(await withMeta({
      start: ctx.start,
      end: ctx.end,
      basis: data.basis,
      thresholds: data.thresholds,
      items: data.items,
    }, metaExtra(ctx, PRODUCT_ITEM_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/abc?basis=
router.get('/abc', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const basis = parseBasis(req.query.basis);
    const data = await fetchRankingData(ctx.start, ctx.end, ctx.B, { basis });
    res.json(await withMeta({
      start: ctx.start,
      end: ctx.end,
      basis,
      classes: buildAbcClasses(data.items, basis, data.total_value),
      total_value: data.total_value,
    }, metaExtra(ctx, PRODUCT_ITEM_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/mix?by=category|subcategory|drink_food|tax_category|staff_only
router.get('/mix', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const by = mixByFromQuery(req.query);
    const rows = await fetchMixRows(ctx.start, ctx.end, ctx.B, by);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, by, rows }, metaExtra(ctx, PRODUCT_ITEM_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/trend?granularity=&menu_item_ids=1,2,3
router.get('/trend', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const ids = trendIdsFromQuery(req.query);
    const series = await fetchProductTrendSeries(ctx.start, ctx.end, ctx.B, ctx.granularity, ctx.gopts, ids);
    res.json(await withMeta({
      start: ctx.start,
      end: ctx.end,
      granularity: ctx.granularity,
      series,
    }, metaExtra(ctx, PRODUCT_ITEM_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/affinity?min_pair=&limit=&menu_item_id=
router.get('/affinity', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const opts = affinityOptionsFromQuery(req.query);
    const data = await fetchAffinityData(ctx.start, ctx.end, ctx.B, opts);
    res.json(await withMeta({
      start: ctx.start,
      end: ctx.end,
      min_pair: opts.minPair,
      limit: opts.limit,
      ...data,
    }, metaExtra(ctx, AFFINITY_NOTE)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/engineering
router.get('/engineering', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const data = await fetchEngineeringData(ctx.start, ctx.end, ctx.B);
    const hasMissingCost = data.items.some((it) => !it.has_cost);
    const note = hasMissingCost ? `${PRODUCT_ITEM_NOTE}。${ENGINEERING_COST_NOTE}` : PRODUCT_ITEM_NOTE;
    res.json(await withMeta({ start: ctx.start, end: ctx.end, ...data }, metaExtra(ctx, note)));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/options
router.get('/options', async (req, res, next) => {
  try {
    const ctx = await sales.resolveContext(req.query);
    const rows = await fetchOptionsRows(ctx.start, ctx.end, ctx.B);
    res.json(await withMeta({ start: ctx.start, end: ctx.end, rows }, metaExtra(ctx, PRODUCT_ITEM_NOTE)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// CSV 出力(routes/export.js)から同一定義を再利用するための追加 export（sales.js と同じ流儀）
module.exports.rankingOptionsFromQuery = rankingOptionsFromQuery;
module.exports.mixByFromQuery = mixByFromQuery;
module.exports.affinityOptionsFromQuery = affinityOptionsFromQuery;
module.exports.trendIdsFromQuery = trendIdsFromQuery;
module.exports.parseBasis = parseBasis;
module.exports.fetchRankingData = fetchRankingData;
module.exports.buildAbcClasses = buildAbcClasses;
module.exports.fetchMixRows = fetchMixRows;
module.exports.fetchProductTrendSeries = fetchProductTrendSeries;
module.exports.fetchAffinityData = fetchAffinityData;
module.exports.fetchEngineeringData = fetchEngineeringData;
module.exports.fetchOptionsRows = fetchOptionsRows;
module.exports.CLS_LABELS = CLS_LABELS;
