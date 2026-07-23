const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { TZ, todayJST } = require('../utils/time');
const { assertDateFormat } = require('../utils/validate');

// レシピ原価CTE（reports内で3回使用するため共通定数化）
const RECIPE_COST_CTE = `recipe_cost AS (
    SELECT r.menu_item_id,
      COALESCE(SUM(r.usage_quantity * i.cost_per_purchase_unit / NULLIF(i.purchase_quantity, 0)), 0) AS cost_per_unit
    FROM recipes r JOIN ingredients i ON r.ingredient_id = i.id
    GROUP BY r.menu_item_id
  )`;

// 集計対象の会計。取消し証跡(void)と取消し済み黒伝票は除外する。
// orders を `o` でエイリアスしているクエリでのみ使える
const PAID_FILTER = `o.status = 'paid'
  AND (o.receipt_type IS NULL OR o.receipt_type NOT IN ('void', 'black_cancelled'))`;

// 期間指定の会計日フィルタ（$1=start, $2=end, $3=TZ）
const RANGE_FILTER = `(o.closed_at AT TIME ZONE $3)::date BETWEEN $1 AND $2`;

// 指定期間の売上・原価合計を返す。前期間比の算出でも使う。
// 売上(orders)と原価(order_items)を JOIN して一度に集計すると
// total_amount が明細行数だけ重複加算されるため、必ず別サブクエリで集計する。
async function fetchRangeTotals(start, end) {
  const { rows } = await query(
    `WITH ${RECIPE_COST_CTE},
     revenue AS (
       SELECT COALESCE(SUM(o.total_amount), 0)::float AS total_revenue
       FROM orders o
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
     ),
     cost AS (
       SELECT COALESCE(SUM(oi.quantity * COALESCE(rc.cost_per_unit, 0)), 0)::float AS total_cost
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = oi.menu_item_id
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
     )
     SELECT revenue.total_revenue, cost.total_cost FROM revenue, cost`,
    [start, end, TZ]
  );
  const { total_revenue, total_cost } = rows[0];
  return { start, end, total_revenue, total_cost, gross_profit: total_revenue - total_cost };
}

// 増減率(%)。基準が0のときは比較不能として null を返す（Infinity を出さない）
function changePct(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// 百分率（小数第1位まで）。分母0は0を返す
function rate(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

// GET /api/reports/daily?date=YYYY-MM-DD[&since=ISO_TIMESTAMP]
router.get('/daily', async (req, res, next) => {
  try {
    const date  = req.query.date  || todayJST();
    // since: レジオープン時刻。指定された場合はそれ以降の会計のみ集計する
    const since = req.query.since || null;

    try { assertDateFormat(date, 'date'); } catch (e) { return res.status(e.status).json({ error: e.error }); }

    // since（レジオープン時刻）がある場合は暦日ではなく「オープン以降の全会計」で集計する。
    // これによりレジオープン〜クローズが0時をまたいでも1営業日としてまとまる。
    const baseWhere = since
      ? `status = 'paid'
         AND (receipt_type IS NULL OR receipt_type NOT IN ('void', 'black_cancelled'))
         AND closed_at >= $1`
      : `status = 'paid'
         AND (receipt_type IS NULL OR receipt_type NOT IN ('void', 'black_cancelled'))
         AND (closed_at AT TIME ZONE $2)::date = $1`;
    const params = since ? [since] : [date, TZ];

    const { rows: summary } = await query(
      `SELECT
         COUNT(*) AS order_count,
         COALESCE(SUM(total_amount), 0)::float        AS total_revenue,
         COALESCE(SUM(discount_amount), 0)::float     AS total_discount,
         COALESCE(SUM(gift_cert_amount), 0)::float    AS total_gift_cert,
         COALESCE(SUM(late_night_amount), 0)::float   AS total_late_night,
         COUNT(*) FILTER (WHERE cash_amount > 0)::int    AS cash_count,
         COUNT(*) FILTER (WHERE card_amount > 0)::int    AS card_count,
         COUNT(*) FILTER (WHERE emoney_amount > 0)::int  AS emoney_count,
         COALESCE(SUM(cash_amount), 0)::float   AS cash_revenue,
         COALESCE(SUM(card_amount), 0)::float   AS card_revenue,
         COALESCE(SUM(emoney_amount), 0)::float AS emoney_revenue,
         COALESCE(SUM(guest_count), 0)::int           AS guest_count,
         COALESCE(SUM(tax_amount), 0)::float           AS total_tax,
         COALESCE(SUM(charge_amount), 0)::float        AS total_charge,
         COUNT(*) FILTER (WHERE charge_amount > 0)::int          AS charge_count,
         COUNT(*) FILTER (WHERE discount_amount > 0)::int        AS discount_count,
         COUNT(*) FILTER (WHERE late_night_amount > 0)::int      AS late_night_count,
         COALESCE(SUM(gift_cert_amount) FILTER (WHERE gift_cert_no_change = true), 0)::float                       AS gift_no_change_amount,
         COUNT(*) FILTER (WHERE gift_cert_no_change = true AND gift_cert_amount > 0)::int                          AS gift_no_change_count,
         COALESCE(SUM(gift_cert_amount) FILTER (WHERE gift_cert_no_change = false AND gift_cert_amount > 0), 0)::float AS gift_change_amount,
         COUNT(*) FILTER (WHERE gift_cert_no_change = false AND gift_cert_amount > 0)::int                         AS gift_change_count
       FROM orders
       WHERE ${baseWhere}`,
      params
    );

    const { rows: items } = await query(
      `WITH ${RECIPE_COST_CTE}
       SELECT
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue,
         COALESCE(MAX(rc.cost_per_unit), 0)::float AS cost_per_unit,
         (SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0))::float AS total_cost,
         (SUM(oi.quantity * oi.unit_price) - SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0))::float AS gross_profit,
         CASE WHEN SUM(oi.quantity * oi.unit_price) > 0
           THEN ROUND((SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0) / SUM(oi.quantity * oi.unit_price) * 100)::numeric, 1)::float
           ELSE 0
         END AS cost_rate
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN menu_items m ON oi.menu_item_id = m.id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = m.id
       WHERE o.${baseWhere}
       GROUP BY oi.item_name
       ORDER BY revenue DESC`,
      params
    );

    // 税率別 課税対象額（割引を標準税率分から先に適用するロジックを再現）
    const { rows: taxRows } = await query(
      `SELECT
         COALESCE(SUM(GREATEST(0, std_items + chg + ln - disc)), 0)::float AS taxable_standard,
         COALESCE(SUM(GREATEST(0, red_items - GREATEST(0, disc - std_items - chg - ln))), 0)::float AS taxable_reduced
       FROM (
         SELECT
           COALESCE(o.discount_amount, 0)    AS disc,
           COALESCE(o.charge_amount, 0)      AS chg,
           COALESCE(o.late_night_amount, 0)  AS ln,
           COALESCE(SUM(oi.quantity * oi.unit_price)
             FILTER (WHERE COALESCE(m.tax_category, 'standard') <> 'reduced'), 0) AS std_items,
           COALESCE(SUM(oi.quantity * oi.unit_price)
             FILTER (WHERE m.tax_category = 'reduced'), 0) AS red_items
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN menu_items  m  ON oi.menu_item_id = m.id
         WHERE o.${baseWhere}
         GROUP BY o.id, o.discount_amount, o.charge_amount, o.late_night_amount
       ) AS breakdown`,
      params
    );

    const orderCount = parseInt(summary[0].order_count);
    const totalItemCount = items.reduce((sum, row) => sum + row.quantity_sold, 0);

    const voidWhere = since
      ? `status = 'paid' AND receipt_type = 'void'
         AND closed_at >= $1`
      : `status = 'paid' AND receipt_type = 'void'
         AND (closed_at AT TIME ZONE $2)::date = $1`;
    const { rows: cancelRows } = await query(
      `SELECT COUNT(*)::int AS cancel_count,
              COALESCE(SUM(total_amount), 0)::float AS cancel_amount
       FROM orders WHERE ${voidWhere}`,
      params
    );

    const redPaidWhere = since
      ? `status = 'paid' AND receipt_type = 'red'
         AND closed_at >= $1`
      : `status = 'paid' AND receipt_type = 'red'
         AND (closed_at AT TIME ZONE $2)::date = $1`;
    const { rows: correctionRows } = await query(
      `SELECT COUNT(*)::int AS correction_count,
              COALESCE(SUM(total_amount), 0)::float AS correction_amount
       FROM orders WHERE ${redPaidWhere}`,
      params
    );

    const s = summary[0];
    const guestCount = parseInt(s.guest_count);
    res.json({
      date,
      total_revenue:         s.total_revenue,
      order_count:           orderCount,
      avg_order_value:       orderCount > 0 ? Math.round(s.total_revenue / orderCount) : 0,
      guest_count:           guestCount,
      avg_per_guest:         guestCount > 0 ? Math.round(s.total_revenue / guestCount) : 0,
      total_tax:             s.total_tax,
      total_discount:        s.total_discount,
      discount_count:        s.discount_count,
      total_gift_cert:       s.total_gift_cert,
      total_late_night:      s.total_late_night,
      late_night_count:      s.late_night_count,
      total_charge:          s.total_charge,
      charge_count:          s.charge_count,
      gift_no_change_amount: s.gift_no_change_amount,
      gift_no_change_count:  s.gift_no_change_count,
      gift_change_amount:    s.gift_change_amount,
      gift_change_count:     s.gift_change_count,
      total_item_count:      totalItemCount,
      taxable_standard:      taxRows[0]?.taxable_standard ?? 0,
      taxable_reduced:       taxRows[0]?.taxable_reduced  ?? 0,
      cancel_count:          cancelRows[0].cancel_count,
      cancel_amount:         cancelRows[0].cancel_amount,
      correction_count:      correctionRows[0].correction_count,
      correction_amount:     correctionRows[0].correction_amount,
      payment_breakdown: [
        { method: 'cash',   label: '現金',       count: s.cash_count,   revenue: s.cash_revenue },
        { method: 'card',   label: 'カード',     count: s.card_count,   revenue: s.card_revenue },
        { method: 'emoney', label: '電子マネー', count: s.emoney_count, revenue: s.emoney_revenue },
      ],
      items,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/items?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/items', async (req, res, next) => {
  try {
    const today = todayJST();
    const start = req.query.start || today;
    const end = req.query.end || today;

    try {
      assertDateFormat(start, 'start');
      assertDateFormat(end, 'end');
    } catch (e) { return res.status(e.status).json({ error: e.error }); }

    const { rows: items } = await query(
      `SELECT
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
       GROUP BY oi.item_name
       ORDER BY revenue DESC`,
      [start, end, TZ]
    );

    res.json({ start, end, items });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/cost-analysis?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/cost-analysis', async (req, res, next) => {
  try {
    const today = todayJST();
    const start = req.query.start || today;
    const end   = req.query.end   || today;
    try {
      assertDateFormat(start, 'start');
      assertDateFormat(end,   'end');
    } catch (e) { return res.status(e.status).json({ error: e.error }); }

    const { rows: items } = await query(
      `WITH ${RECIPE_COST_CTE}
       SELECT
         m.id AS menu_item_id,
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue,
         COALESCE(MAX(rc.cost_per_unit), 0)::float AS cost_per_unit,
         (SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0))::float AS total_cost,
         (SUM(oi.quantity * oi.unit_price) - SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0))::float AS gross_profit,
         CASE WHEN SUM(oi.quantity * oi.unit_price) > 0
           THEN ROUND((SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0) / SUM(oi.quantity * oi.unit_price) * 100)::numeric, 1)::float
           ELSE 0
         END AS cost_rate
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN menu_items m ON oi.menu_item_id = m.id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = m.id
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
       GROUP BY m.id, oi.item_name
       ORDER BY revenue DESC`,
      [start, end, TZ]
    );

    const totalRevenue = items.reduce((sum, r) => sum + r.revenue,     0);
    const totalCost    = items.reduce((sum, r) => sum + r.total_cost,  0);
    res.json({
      start, end, items,
      summary: {
        total_revenue: totalRevenue,
        total_cost:    totalCost,
        gross_profit:  totalRevenue - totalCost,
        cost_rate:     totalRevenue > 0 ? Math.round(totalCost / totalRevenue * 1000) / 10 : 0,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/reports/profit-summary?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/profit-summary', async (req, res, next) => {
  try {
    const today = todayJST();
    const start = req.query.start || today;
    const end   = req.query.end   || today;
    try {
      assertDateFormat(start, 'start');
      assertDateFormat(end,   'end');
    } catch (e) { return res.status(e.status).json({ error: e.error }); }

    const { rows } = await query(
      `WITH ${RECIPE_COST_CTE},
       daily_revenue AS (
         SELECT
           (o.closed_at AT TIME ZONE $3)::date AS date,
           SUM(o.total_amount)::float AS revenue,
           COUNT(DISTINCT o.id)::int AS order_count
         FROM orders o
         WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
         GROUP BY (o.closed_at AT TIME ZONE $3)::date
       ),
       daily_cost AS (
         SELECT
           (o.closed_at AT TIME ZONE $3)::date AS date,
           SUM(oi.quantity * COALESCE(rc.cost_per_unit, 0))::float AS total_cost
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN menu_items m ON oi.menu_item_id = m.id
         LEFT JOIN recipe_cost rc ON rc.menu_item_id = m.id
         WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
         GROUP BY (o.closed_at AT TIME ZONE $3)::date
       )
       SELECT
         r.date::text,
         r.revenue,
         COALESCE(c.total_cost, 0)::float AS total_cost,
         (r.revenue - COALESCE(c.total_cost, 0))::float AS gross_profit,
         r.order_count,
         CASE WHEN r.revenue > 0
           THEN ROUND(((r.revenue - COALESCE(c.total_cost, 0)) / r.revenue * 100)::numeric, 1)::float
           ELSE 0
         END AS gross_profit_rate
       FROM daily_revenue r
       LEFT JOIN daily_cost c ON c.date = r.date
       ORDER BY r.date`,
      [start, end, TZ]
    );

    const totalRevenue = rows.reduce((sum, r) => sum + r.revenue,    0);
    const totalCost    = rows.reduce((sum, r) => sum + r.total_cost, 0);
    res.json({
      start, end, rows,
      summary: {
        total_revenue:     totalRevenue,
        total_cost:        totalCost,
        gross_profit:      totalRevenue - totalCost,
        gross_profit_rate: totalRevenue > 0 ? Math.round((totalRevenue - totalCost) / totalRevenue * 1000) / 10 : 0,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/reports/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD
// 売上管理ページ用の期間分析。粗利・時間帯別・カテゴリ別・前期間比をまとめて返す。
// レジクローズが依存する /daily とは別系統にして、閉店処理への影響を避けている。
router.get('/analytics', async (req, res, next) => {
  try {
    const today = todayJST();
    const start = req.query.start || today;
    const end   = req.query.end   || today;
    try {
      assertDateFormat(start, 'start');
      assertDateFormat(end,   'end');
    } catch (e) { return res.status(e.status).json({ error: e.error }); }
    if (start > end) {
      return res.status(400).json({ error: 'start は end 以前の日付を指定してください' });
    }

    // 比較期間の算出。単日でも期間でも同じ式で成立する
    //   前期間  = 同じ日数だけ手前にずらした期間（単日なら前日）
    //   前週    = 7日手前にずらした期間（単日なら前週同曜日）
    const { rows: [range] } = await query(
      `SELECT d.days,
              ($1::date - d.days)::text AS prev_start,
              ($2::date - d.days)::text AS prev_end,
              ($1::date - 7)::text      AS week_start,
              ($2::date - 7)::text      AS week_end
       FROM (SELECT ($2::date - $1::date + 1)::int AS days) d`,
      [start, end]
    );

    const [totals, prevPeriod, prevWeek] = await Promise.all([
      fetchRangeTotals(start, end),
      fetchRangeTotals(range.prev_start, range.prev_end),
      fetchRangeTotals(range.week_start, range.week_end),
    ]);

    // 会計単位の集計。滞在時間は即会計テーブルを除外する
    // （即会計は開店と同時に会計されるため滞在時間の概念がなく、平均を0分側に引っ張る）
    const { rows: [s] } = await query(
      `SELECT
         COUNT(*)::int                                  AS order_count,
         COALESCE(SUM(o.guest_count), 0)::int           AS guest_count,
         COALESCE(SUM(o.discount_amount), 0)::float     AS total_discount,
         COALESCE(SUM(o.gift_cert_amount), 0)::float    AS total_gift_cert,
         COALESCE(SUM(o.late_night_amount), 0)::float   AS total_late_night,
         COALESCE(SUM(o.charge_amount), 0)::float       AS total_charge,
         COALESCE(SUM(o.tax_amount), 0)::float          AS total_tax,
         COUNT(*) FILTER (WHERE o.cash_amount > 0)::int   AS cash_count,
         COUNT(*) FILTER (WHERE o.card_amount > 0)::int   AS card_count,
         COUNT(*) FILTER (WHERE o.emoney_amount > 0)::int AS emoney_count,
         COALESCE(SUM(o.cash_amount), 0)::float   AS cash_revenue,
         COALESCE(SUM(o.card_amount), 0)::float   AS card_revenue,
         COALESCE(SUM(o.emoney_amount), 0)::float AS emoney_revenue,
         COALESCE(
           AVG(EXTRACT(EPOCH FROM (o.closed_at - o.opened_at)) / 60)
             FILTER (WHERE o.closed_at > o.opened_at AND t.table_type <> 'immediate'),
           0
         )::float AS avg_stay_minutes
       FROM orders o
       JOIN tables t ON o.table_id = t.id
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}`,
      [start, end, TZ]
    );

    // 商品別。同名の別商品を混ぜないよう menu_item_id でも分ける
    const { rows: items } = await query(
      `WITH ${RECIPE_COST_CTE}
       SELECT
         m.id AS menu_item_id,
         oi.item_name AS name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue,
         COALESCE(MAX(rc.cost_per_unit), 0)::float AS cost_per_unit,
         (SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0))::float AS total_cost,
         (SUM(oi.quantity * oi.unit_price) - SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0))::float AS gross_profit,
         CASE WHEN SUM(oi.quantity * oi.unit_price) > 0
           THEN ROUND((SUM(oi.quantity) * COALESCE(MAX(rc.cost_per_unit), 0) / SUM(oi.quantity * oi.unit_price) * 100)::numeric, 1)::float
           ELSE 0
         END AS cost_rate
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN menu_items m ON oi.menu_item_id = m.id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = m.id
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
       GROUP BY m.id, oi.item_name
       ORDER BY revenue DESC`,
      [start, end, TZ]
    );

    // 時間帯別。期間の絞り込みは会計日、バケットは注文時刻。
    // こうすると時間帯別の売上合計が商品別の売上合計と一致する。
    const { rows: hourly } = await query(
      `SELECT
         EXTRACT(HOUR FROM (oi.created_at AT TIME ZONE $3))::int AS hour,
         SUM(oi.quantity * oi.unit_price)::float AS revenue,
         SUM(oi.quantity)::int AS quantity
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
       GROUP BY hour
       ORDER BY hour`,
      [start, end, TZ]
    );

    const { rows: categoryRows } = await query(
      `WITH ${RECIPE_COST_CTE}
       SELECT
         c.id AS category_id,
         c.name,
         SUM(oi.quantity)::int AS quantity_sold,
         SUM(oi.quantity * oi.unit_price)::float AS revenue,
         SUM(oi.quantity * COALESCE(rc.cost_per_unit, 0))::float AS total_cost
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN menu_items m ON oi.menu_item_id = m.id
       JOIN categories c ON m.category_id = c.id
       LEFT JOIN recipe_cost rc ON rc.menu_item_id = m.id
       WHERE ${PAID_FILTER} AND ${RANGE_FILTER}
       GROUP BY c.id, c.name
       ORDER BY revenue DESC`,
      [start, end, TZ]
    );

    // 商品売上のうち原価が設定済みの割合。
    // レシピ未登録の商品は原価0＝粗利100%として集計されるため、
    // これが100%未満なら粗利は実態より上振れしていると読む必要がある。
    const itemsRevenue  = items.reduce((sum, r) => sum + r.revenue, 0);
    const costedRevenue = items.reduce((sum, r) => sum + (r.cost_per_unit > 0 ? r.revenue : 0), 0);

    const categories = categoryRows.map(c => ({
      ...c,
      gross_profit:      c.revenue - c.total_cost,
      gross_profit_rate: rate(c.revenue - c.total_cost, c.revenue),
      share_pct:         rate(c.revenue, itemsRevenue),
    }));

    const orderCount = s.order_count;
    const guestCount = s.guest_count;

    res.json({
      start, end,
      days: range.days,
      is_single_day: start === end,
      summary: {
        total_revenue:     totals.total_revenue,
        total_cost:        totals.total_cost,
        gross_profit:      totals.gross_profit,
        gross_profit_rate: rate(totals.gross_profit, totals.total_revenue),
        cost_coverage_pct: rate(costedRevenue, itemsRevenue),
        order_count:       orderCount,
        guest_count:       guestCount,
        avg_order_value:   orderCount > 0 ? Math.round(totals.total_revenue / orderCount) : 0,
        avg_per_guest:     guestCount > 0 ? Math.round(totals.total_revenue / guestCount) : 0,
        avg_guests_per_order: orderCount > 0 ? Math.round((guestCount / orderCount) * 10) / 10 : 0,
        avg_stay_minutes:  Math.round(s.avg_stay_minutes),
        total_item_count:  items.reduce((sum, r) => sum + r.quantity_sold, 0),
        total_tax:         s.total_tax,
        total_discount:    s.total_discount,
        total_gift_cert:   s.total_gift_cert,
        total_late_night:  s.total_late_night,
        total_charge:      s.total_charge,
      },
      comparison: {
        prev_period: {
          ...prevPeriod,
          revenue_change_pct: changePct(totals.total_revenue, prevPeriod.total_revenue),
          profit_change_pct:  changePct(totals.gross_profit,  prevPeriod.gross_profit),
        },
        prev_week: {
          ...prevWeek,
          revenue_change_pct: changePct(totals.total_revenue, prevWeek.total_revenue),
          profit_change_pct:  changePct(totals.gross_profit,  prevWeek.gross_profit),
        },
      },
      hourly,
      categories,
      payment_breakdown: [
        { method: 'cash',   label: '現金',       count: s.cash_count,   revenue: s.cash_revenue },
        { method: 'card',   label: 'カード',     count: s.card_count,   revenue: s.card_revenue },
        { method: 'emoney', label: '電子マネー', count: s.emoney_count, revenue: s.emoney_revenue },
      ],
      items,
    });
  } catch (err) { next(err); }
});

module.exports = router;
