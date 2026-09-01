'use strict';
// /api/v1/export — CSV 出力（BOM 付き UTF-8・日本語ヘッダ・attachment）
// 集計は routes/sales.js の fetch 群を再利用する（API とCSVで数字が食い違わないようにする）
const express = require('express');
const bd = require('../lib/businessDay');
const sales = require('./sales');
const products = require('./products'); // Phase 2: 商品分析レポート
const seats = require('./seats');     // Phase 3: 客席分析レポート
const tags = require('./tags');       // Phase 3: タグ・天候別比較レポート
const days = require('./days');       // Phase 3: 営業日ノートレポート
const targets = require('./targets'); // Phase 3: 目標進捗レポート
const inputs = require('./inputs');   // Phase 3: レジ精算レポート
const expenses = require('./expenses'); // Phase 4: 経費レポート
const staff = require('./staff');       // Phase 4: シフトレポート
const pl = require('./pl');             // Phase 4: 月次P&L・損益分岐点レポート
const labor = require('./labor');       // Phase 4: 人時生産性レポート
const pricing = require('./pricing');   // Phase 5: 価格変動効果レポート
const { sendCsv } = require('../lib/csv');

const router = express.Router();

const REPORTS = ['trend', 'dow', 'hourly', 'heatmap', 'payments', 'tax', 'adjustments', 'calendar',
  // Phase 2: 商品分析レポート（routes/products.js の fetch 群を再利用）
  // ※ 'trend' は売上トレンド(sales)なので、商品推移は 'product_trend' として別レポートにする
  'ranking', 'abc', 'mix', 'affinity', 'engineering', 'options', 'product_trend',
  // Phase 3: 客席・タグ・目標・入力系レポート（seats/tags/days/targets/inputs の fetch 群を再利用）
  // business_days / targets_progress / register_closings は calendar と同じく month=YYYY-MM 指定
  'seats_utilization', 'stay_distribution', 'tags_compare',
  'business_days', 'targets_progress', 'register_closings',
  // Phase 4: 経費・シフト・P&L・損益分岐点・人時生産性レポート（expenses/staff/pl/labor の fetch 群を再利用）
  // expenses / shifts は month=YYYY-MM か start&end、pl_breakeven は month、
  // pl_statement / labor_productivity は start&end（+granularity）
  'expenses', 'shifts', 'pl_statement', 'pl_breakeven', 'labor_productivity',
  // Phase 5: 価格変動効果レポート（pricing の fetch 群を再利用。クエリは start&end&day_mode）
  'pricing_bands', 'crash_windows', 'seesaw'];
const METRICS = new Set(['revenue', 'quantity', 'orders', 'guests']);
const METRIC_LABELS = { revenue: '売上', quantity: '数量', orders: '会計件数', guests: '客数' };
const WEATHER_LABELS = { sunny: '晴れ', cloudy: '曇り', rain: '雨', heavy_rain: '大雨', snow: '雪' };
const TABLE_TYPE_LABELS = { table: 'テーブル', counter: 'カウンター', immediate: '即会計' };
const COST_TYPE_LABELS = { fixed: '固定', variable: '変動' };
const ALLOC_LABELS = { date: '発生日', month_even: '月按分' };

// GET /api/v1/export/csv?report=trend|dow|hourly|heatmap|payments|tax|adjustments|calendar&…
// そのほかのクエリは各 /api/v1/sales/* と同じ（start/end/day_mode/boundary_hour/granularity、heatmap は metric、calendar は month）
router.get('/csv', async (req, res, next) => {
  try {
    const report = String(req.query.report || '');
    if (!REPORTS.includes(report)) {
      throw { status: 400, error: `report は ${REPORTS.join(' / ')} のいずれかを指定してください` };
    }

    // calendar のみ month=YYYY-MM 指定（他は start/end）
    if (report === 'calendar') {
      const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
      const month = req.query.month !== undefined
        ? String(req.query.month)
        : bd.dateOf(dayMode, new Date(), boundaryHour).slice(0, 7);
      const data = await sales.fetchCalendarDays(month, B);
      const rows = data.days.map((d) => [
        d.date, d.revenue, d.order_count, d.guest_count,
        d.is_open === null ? '' : (d.is_open ? '営業' : '休業'),
        d.weather ? (WEATHER_LABELS[d.weather] || d.weather) : '',
        d.tags.map((t) => t.name).join('・'),
      ]);
      return sendCsv(res, `calendar_${data.start}_${data.end}.csv`,
        ['日付', '売上', '会計件数', '客数', '営業', '天候', 'タグ'], rows);
    }

    // ---- Phase 3: 月指定レポート（month=YYYY-MM。calendar と同じ流儀）----
    if (report === 'business_days' || report === 'targets_progress' || report === 'register_closings') {
      const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
      const today = bd.dateOf(dayMode, new Date(), boundaryHour);
      const month = req.query.month !== undefined ? String(req.query.month) : today.slice(0, 7);
      if (report === 'business_days') {
        const data = await days.fetchMonthDays(month, B);
        const dayRows = data.days.map((d) => [
          d.business_date,
          d.is_open === null ? '' : (d.is_open ? '営業' : '休業'),
          d.weather ? (WEATHER_LABELS[d.weather] || d.weather) : '',
          d.temperature_c ?? '',
          d.tags.map((t) => t.name).join('・'),
          d.note ?? '',
          d.revenue, d.order_count, d.guest_count,
        ]);
        return sendCsv(res, `business_days_${data.start}_${data.end}.csv`,
          ['営業日', '営業', '天候', '気温(℃)', 'タグ', 'メモ', '売上', '会計件数', '客数'], dayRows);
      }
      if (report === 'targets_progress') {
        const data = await targets.fetchProgressData(month, B, today);
        const progressRows = data.rows.map((r) => [
          r.label, r.target ?? '', r.actual, r.achievement_pct ?? '',
          r.elapsed_days, r.month_days, r.forecast ?? '', r.required_per_remaining_day ?? '',
        ]);
        return sendCsv(res, `targets_progress_${month}.csv`,
          ['指標', '目標', '実績', '達成率(%)', '経過日数', '月日数', '着地予測', '残り日割'], progressRows);
      }
      // register_closings
      const closingRows = (await inputs.fetchClosingRows(month, B)).map((r) => [
        r.business_date, r.cash_sales, r.open_cash ?? '', r.system_cash ?? '',
        r.counted_cash ?? '', r.cash_diff ?? '', r.memo ?? '',
      ]);
      return sendCsv(res, `register_closings_${month}.csv`,
        ['営業日', '現金売上', '開始現金', '理論現金(開始+現金売上)', '実査現金', '過不足', 'メモ'], closingRows);
    }

    // ---- Phase 4: 経費・シフト（month=YYYY-MM か start&end。API と同じ resolveMonthOrRange）----
    if (report === 'expenses' || report === 'shifts') {
      const { start, end } = expenses.resolveMonthOrRange(req.query);
      if (report === 'expenses') {
        const categoryId = req.query.category_id !== undefined ? Number(req.query.category_id) : null;
        if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
          throw { status: 400, error: 'category_id は正の整数を指定してください' };
        }
        const data = await expenses.fetchExpenseRows(start, end, { categoryId });
        const expRows = data.rows.map((r) => [
          r.expense_date, r.category_code, r.category_name,
          COST_TYPE_LABELS[r.cost_type] || r.cost_type || '',
          r.pnl_line ?? '', r.amount,
          r.tax_included ? '税込' : '税抜',
          ALLOC_LABELS[r.alloc_method] || r.alloc_method,
          r.vendor ?? '', r.memo ?? '',
        ]);
        expRows.push(['合計', '', '', '', '', data.total_amount, '', '', '', '']);
        return sendCsv(res, `expenses_${start}_${end}.csv`,
          ['日付', '科目コード', '科目', '固定/変動', 'PL行', '金額', '税', '按分', '取引先', 'メモ'], expRows);
      }
      // shifts
      const shiftRows = (await staff.fetchShiftRows(start, end)).map((r) => [
        r.business_date, r.staff_name,
        new Date(r.start_at).toISOString(), new Date(r.end_at).toISOString(),
        r.break_minutes, r.work_minutes, r.hourly_wage_snapshot, r.labor_cost, r.memo ?? '',
      ]);
      return sendCsv(res, `shifts_${start}_${end}.csv`,
        ['営業日', 'スタッフ', '開始', '終了', '休憩(分)', '実働(分)', '時給', '人件費', 'メモ'], shiftRows);
    }

    // ---- Phase 4: 損益分岐点（month=YYYY-MM。calendar と同じ流儀）----
    if (report === 'pl_breakeven') {
      const { dayMode, boundaryHour, B } = await sales.resolveModeBoundary(req.query);
      const today = bd.dateOf(dayMode, new Date(), boundaryHour);
      const month = req.query.month !== undefined ? String(req.query.month) : today.slice(0, 7);
      const d = await pl.fetchBreakevenData(month, B, today);
      const bepRows = [
        ['固定費', d.fixed_costs],
        ['変動費率', d.variable_cost_rate ?? ''],
        ['損益分岐点売上', d.bep_revenue ?? ''],
        ['実績売上', d.actual_revenue],
        ['達成率(%)', d.attainment_pct ?? ''],
        ['安全余裕率(%)', d.safety_margin_pct ?? ''],
        ['営業日数', d.open_days],
        ['残営業日(概算)', d.remaining_open_days_est ?? ''],
        ['残りの必要日商', d.required_per_remaining_day ?? ''],
        ['人件費を固定費扱い', d.labor_is_fixed_for_bep ? 'する' : 'しない'],
        ['内訳: 固定費(経費)', d.detail.fixed_detail.expenses_fixed],
        ['内訳: 固定費(人件費)', d.detail.fixed_detail.labor_total],
        ['内訳: 変動費(原価・レシピ)', d.detail.variable_detail.cogs_recipe],
        ['内訳: 変動費(経費)', d.detail.variable_detail.expenses_variable],
        ['内訳: 変動費(人件費)', d.detail.variable_detail.labor_total],
        ['内訳: 除外した仕入', d.detail.variable_detail.excluded_purchase],
      ];
      return sendCsv(res, `pl_breakeven_${month}.csv`, ['項目', '値'], bepRows);
    }

    // ---- Phase 4: 月次P&L（granularity は month/fiscal_year・既定 month）----
    if (report === 'pl_statement') {
      const ctxPl = await sales.resolveContext({ ...req.query, granularity: pl.parsePlGranularity(req.query.granularity) });
      const data = await pl.fetchStatementData(ctxPl.start, ctxPl.end, ctxPl.B, ctxPl.granularity, ctxPl.gopts);
      const plRow = (r) => [
        r.period_start ?? '', r.label, r.revenue, r.cogs_recipe, r.gross_profit, r.gross_profit_rate,
        r.labor_shift, r.labor_other, r.labor_total, r.labor_cost_rate,
        r.expenses_by_line.rent, r.expenses_by_line.utilities, r.expenses_by_line.supplies,
        r.expenses_by_line.marketing, r.expenses_by_line.fees, r.expenses_by_line.other,
        r.expenses_total_excl_purchase_labor, r.operating_profit, r.operating_margin_pct,
        r.fl_cost, r.fl_ratio_pct, r.purchase_actual, r.alt_purchase_based_profit,
      ];
      return sendCsv(res, `pl_statement_${ctxPl.start}_${ctxPl.end}.csv`,
        ['期間開始', 'ラベル', '売上', '原価(レシピ)', '粗利', '粗利率(%)',
          '人件費(シフト)', '人件費(経費)', '人件費計', '人件費率(%)',
          '家賃', '水道光熱', '消耗品', '販促', '手数料', 'その他',
          '経費計(仕入・人件費除く)', '営業利益', '営業利益率(%)',
          'FLコスト', 'FL比率(%)', '実仕入', '参考:実仕入ベース利益'],
        [...data.rows.map(plRow), plRow(data.totals)]);
    }

    // ---- Phase 4: 人時生産性（クエリは /api/v1/labor/productivity と同じ）----
    if (report === 'labor_productivity') {
      const ctxLb = await sales.resolveContext(req.query);
      const data = await labor.fetchProductivityData(ctxLb.start, ctxLb.end, ctxLb.B, ctxLb.granularity, ctxLb.gopts);
      const lbRows = data.by_period.map((r) => [
        r.period_start, r.label, r.labor_hours, r.labor_cost, r.revenue,
        r.sales_per_labor_hour ?? '', r.labor_cost_rate,
      ]);
      const s = data.summary;
      lbRows.push(['', '合計', s.labor_hours, s.labor_cost, s.revenue, s.sales_per_labor_hour ?? '', s.labor_cost_rate]);
      return sendCsv(res, `labor_productivity_${ctxLb.start}_${ctxLb.end}.csv`,
        ['期間開始', 'ラベル', '労働時間(h)', '人件費', '売上', '人時売上', '人件費率(%)'], lbRows);
    }

    // ---- Phase 5: 価格変動効果（クエリは各 /api/v1/pricing/* と同じ start&end&day_mode）----
    if (report === 'pricing_bands' || report === 'crash_windows' || report === 'seesaw') {
      const ctxPr = await sales.resolveContext(req.query);
      if (report === 'pricing_bands') {
        const d = await pricing.fetchEffectData(ctxPr.start, ctxPr.end, ctxPr.B);
        const bandRows = d.bands.map((b) => [
          b.band_label, b.band_min_pct, b.band_max_pct, b.quantity, b.revenue, b.share_pct, b.revenue_share_pct,
        ]);
        bandRows.push(['合計', '', '', d.summary.quantity_total, d.summary.revenue_total, '', '']);
        bandRows.push(['平均比率(定価比・金額加重)', '', '', '', '', d.summary.avg_ratio_pct ?? '', '']);
        bandRows.push(['除外(定価0の時価商品など)', '', '', d.summary.excluded_quantity, '', '', '']);
        bandRows.push(['値引き費用(暴落原資)', '', '', '', d.discount.total, '', '']);
        bandRows.push(['純差分(値上がり相殺後)', '', '', '', d.discount.net_diff, '', '']);
        return sendCsv(res, `pricing_bands_${ctxPr.start}_${ctxPr.end}.csv`,
          ['価格帯(定価比)', '下限(%)', '上限(%)', '数量', '売上', '数量構成比(%)', '売上構成比(%)'], bandRows);
      }
      if (report === 'crash_windows') {
        const d = await pricing.fetchCrashWindowsData(ctxPr.start, ctxPr.end, ctxPr.B, ctxPr.dayMode, ctxPr.boundaryHour);
        const winRows = d.windows.map((w) => [
          w.business_date, w.started_at, w.ended_at, w.minutes, w.item_count,
          w.items.map((it) => it.name).join('・'),
          w.in_window.quantity, w.in_window.revenue, w.in_window.orders,
          w.crashed_items_quantity, w.crashed_items_revenue,
          w.reference.quantity ?? '', w.reference.revenue ?? '', w.reference.orders ?? '',
          w.reference.basis, w.reference.weeks_used, w.uplift_pct ?? '',
        ]);
        return sendCsv(res, `crash_windows_${ctxPr.start}_${ctxPr.end}.csv`,
          ['営業日', '開始', '終了', '継続(分)', '銘柄数', '暴落銘柄',
            '区間内数量', '区間内売上', '区間内会計数', '暴落銘柄の数量', '暴落銘柄の売上',
            '参照数量', '参照売上', '参照会計数', '参照基準', '参照週数', '増減率(%)'], winRows);
      }
      // seesaw（勝ち/負けの銘柄別 + 段数分布 + 寄り付き実施記録を1ファイルにまとめる）
      const d = await pricing.fetchSeesawData(ctxPr.start, ctxPr.end, ctxPr.B);
      const avgSteps = (r) => (r.count > 0 ? Math.round((r.total_steps / r.count) * 100) / 100 : '');
      const seesawRows = [
        ...d.win.items.map((r) => ['勝ち(上昇)', r.menu_item_id, r.name, r.count, r.total_steps, avgSteps(r)]),
        ...d.lose.items.map((r) => ['負け(下降)', r.menu_item_id, r.name, r.count, r.total_steps, avgSteps(r)]),
        ...d.step_distribution.map((r) => ['段数分布(勝ち)', '', `${r.steps}段`, r.count, '', '']),
        ...d.step_distribution_lose.map((r) => ['段数分布(負け)', '', `${r.steps}段`, r.count, '', '']),
        ...d.market_open.map((r) => ['寄り付き(価格リセット)', '', r.occurred_at, r.changed_count, '', '']),
      ];
      return sendCsv(res, `seesaw_${ctxPr.start}_${ctxPr.end}.csv`,
        ['区分', '商品ID', '商品名 / 内容', '回数', '合計段数', '平均段数'], seesawRows);
    }

    const ctx = await sales.resolveContext(req.query);
    let headers;
    let rows;
    switch (report) {
      case 'trend': {
        const data = await sales.fetchTrendRows(ctx.start, ctx.end, ctx.B, ctx.granularity, ctx.gopts);
        headers = ['期間開始', 'ラベル', '売上', '原価', '粗利', '粗利率(%)', '会計件数', '客数', '商品点数', '客単価'];
        rows = data.map((r) => [r.period_start, r.label, r.revenue, r.total_cost, r.gross_profit,
          r.gross_profit_rate, r.order_count, r.guest_count, r.item_count, r.avg_per_guest]);
        break;
      }
      case 'dow': {
        const data = await sales.fetchDowRows(ctx.start, ctx.end, ctx.B);
        headers = ['曜日', '営業日数', '売上', '1営業日平均売上', '会計件数', '客数', '客単価', '販売数量'];
        rows = data.map((r) => [r.label, r.open_days, r.revenue, r.avg_revenue_per_open_day,
          r.order_count, r.guest_count, r.avg_per_guest, r.quantity]);
        break;
      }
      case 'hourly': {
        const data = await sales.fetchHourlyRows(ctx.start, ctx.end, ctx.B);
        headers = ['時間帯', '売上', '販売数量'];
        rows = data.map((r) => [r.label, r.revenue, r.quantity]);
        break;
      }
      case 'heatmap': {
        const metric = req.query.metric !== undefined ? String(req.query.metric) : 'revenue';
        if (!METRICS.has(metric)) {
          throw { status: 400, error: 'metric は revenue / quantity / orders / guests のいずれかを指定してください' };
        }
        const data = await sales.fetchHeatmapData(ctx.start, ctx.end, ctx.B, metric);
        headers = ['曜日', '時間帯', METRIC_LABELS[metric]];
        rows = data.cells.map((c) => [bd.DOW_LABELS[c.dow], bd.hour32Label(c.hour32), c.value]);
        break;
      }
      case 'payments': {
        const d = await sales.fetchPaymentsData(ctx.start, ctx.end, ctx.B);
        headers = ['項目', '件数', '金額'];
        rows = [
          ...d.methods.map((m) => [m.label, m.count, m.amount]),
          ['分割会計', d.split_count, ''],
          ['金券(釣り銭なし)', d.gift.no_change_count, d.gift.no_change_amount],
          ['金券(釣り銭あり)', d.gift.change_count, d.gift.change_amount],
          ['チャージ', d.charge.count, d.charge.amount],
          ['深夜料金', d.late_night.count, d.late_night.amount],
        ];
        break;
      }
      case 'tax': {
        const d = await sales.fetchTaxData(ctx.start, ctx.end, ctx.B);
        headers = ['日付', '標準税率課税対象額', '軽減税率課税対象額'];
        rows = [
          ...d.by_day.map((r) => [r.date, r.taxable_standard, r.taxable_reduced]),
          ['合計', d.taxable_standard, d.taxable_reduced],
        ];
        break;
      }
      case 'adjustments': {
        const d = await sales.fetchAdjustmentsData(ctx.start, ctx.end, ctx.B);
        headers = ['日付', '割引額', '取消額(void)', '赤伝票額'];
        rows = [
          ...d.by_day.map((r) => [r.date, r.discount_amount, r.void_amount, r.red_amount]),
          ['合計', d.discount.amount, d.void.amount, d.red.amount],
        ];
        break;
      }
      // ---- Phase 2: 商品分析レポート（クエリは各 /api/v1/products/* と同じ）----
      case 'ranking': {
        const opts = products.rankingOptionsFromQuery(req.query);
        const data = await products.fetchRankingData(ctx.start, ctx.end, ctx.B, opts);
        headers = ['商品ID', '商品名', 'カテゴリ', 'サブカテゴリ', '数量', '売上', '平均単価',
          '原価(1杯)', '原価計', '粗利', '原価率(%)', '構成比(%)', '累積構成比(%)', 'ABCランク', '最終販売日'];
        rows = data.items.map((r) => [r.menu_item_id, r.name, r.category ?? '', r.subcategory ?? '',
          r.quantity, r.revenue, r.avg_unit_price ?? '', r.cost_per_unit, r.total_cost, r.gross_profit,
          r.cost_rate, r.share_pct, r.cum_share_pct ?? '', r.abc_rank, r.last_sold_at ?? '']);
        break;
      }
      case 'abc': {
        const basis = products.parseBasis(req.query.basis);
        const data = await products.fetchRankingData(ctx.start, ctx.end, ctx.B, { basis });
        const classes = products.buildAbcClasses(data.items, basis, data.total_value);
        headers = ['ランク', '商品数', '金額', '構成比(%)'];
        rows = [
          ...classes.map((c) => [c.rank, c.item_count, c.value, c.share_pct]),
          ['合計', classes.reduce((a, c) => a + c.item_count, 0), classes.reduce((a, c) => a + c.value, 0), ''],
        ];
        break;
      }
      case 'mix': {
        const by = products.mixByFromQuery(req.query);
        const data = await products.fetchMixRows(ctx.start, ctx.end, ctx.B, by);
        headers = ['名称', '数量', '売上', '原価', '粗利', '粗利率(%)', '構成比(%)'];
        rows = data.map((r) => [r.name, r.quantity, r.revenue, r.total_cost, r.gross_profit,
          r.gross_profit_rate, r.share_pct]);
        break;
      }
      case 'affinity': {
        const opts = products.affinityOptionsFromQuery(req.query);
        const data = await products.fetchAffinityData(ctx.start, ctx.end, ctx.B, opts);
        headers = ['商品A', '商品B', '同時購入会計数', '支持度(%)', '確信度A→B(%)', '確信度B→A(%)', 'リフト値'];
        rows = data.pairs.map((p) => [p.a_name, p.b_name, p.pair_orders, p.support_pct,
          p.confidence_ab, p.confidence_ba, p.lift ?? '']);
        break;
      }
      case 'engineering': {
        const data = await products.fetchEngineeringData(ctx.start, ctx.end, ctx.B);
        headers = ['商品名', 'カテゴリ', '数量', '数量構成比(%)', '平均単価', '原価(1杯)', '1杯粗利', '原価設定', '分類'];
        rows = data.items.map((r) => [r.name, r.category ?? '', r.quantity, r.qty_share_pct,
          r.avg_unit_price, r.cost_per_unit, r.unit_gross_profit, r.has_cost ? '設定済' : '未設定',
          products.CLS_LABELS[r.cls] || r.cls]);
        break;
      }
      case 'options': {
        const data = await products.fetchOptionsRows(ctx.start, ctx.end, ctx.B);
        headers = ['商品名', '選択オプション', '数量', '売上'];
        rows = data.map((r) => [r.name, r.selected_option, r.quantity, r.revenue]);
        break;
      }
      case 'product_trend': {
        // 商品推移（/api/v1/products/trend と同じクエリ。menu_item_ids 必須・縦持ちで出力）
        const ids = products.trendIdsFromQuery(req.query);
        const series = await products.fetchProductTrendSeries(ctx.start, ctx.end, ctx.B, ctx.granularity, ctx.gopts, ids);
        headers = ['商品ID', '商品名', '期間開始', 'ラベル', '数量', '売上', '平均単価'];
        rows = series.flatMap((s) => s.rows.map((r) => [
          s.menu_item_id, s.name, r.period_start, r.label, r.quantity, r.revenue, r.avg_unit_price ?? '',
        ]));
        break;
      }
      // ---- Phase 3: 客席・タグレポート（クエリは各 /api/v1/seats/*・/api/v1/tags/compare と同じ）----
      case 'seats_utilization': {
        const data = await seats.fetchUtilizationData(ctx.start, ctx.end, ctx.B);
        headers = ['卓ID', '卓名', '種別', '席数', '組数', '客数', '売上', '平均滞在(分)', '回転(1営業日)', '席稼働率(%)'];
        rows = data.rows.map((r) => [
          r.table_id, r.table_name, TABLE_TYPE_LABELS[r.table_type] || r.table_type,
          r.seats ?? '', r.order_count, r.guest_count, r.revenue,
          r.avg_stay_minutes ?? '', r.turnover_per_open_day ?? '', r.seat_utilization_pct ?? '',
        ]);
        break;
      }
      case 'stay_distribution': {
        const binMinutes = seats.parseBinMinutes(req.query);
        const data = await seats.fetchStayDistribution(ctx.start, ctx.end, ctx.B, binMinutes);
        headers = ['滞在時間(分・以上)', '滞在時間(分・未満)', '組数'];
        rows = data.buckets.map((b) => [b.min_minutes, b.max_minutes ?? '', b.count]);
        break;
      }
      case 'tags_compare': {
        const tagCode = req.query.tag !== undefined && req.query.tag !== '' ? String(req.query.tag) : null;
        const data = await tags.fetchCompareData(ctx.start, ctx.end, ctx.B, tagCode);
        headers = ['区分', '名称', '営業日数', '平均売上', '平均会計件数', '平均客数', '客単価'];
        const groupRow = (kind, name, g) => [kind, name, g.days, g.avg_revenue, g.avg_order_count, g.avg_guest_count, g.avg_per_guest];
        if (tagCode) {
          rows = data.groups.map((g) => groupRow('タグ', g.label, g));
        } else {
          rows = [
            ...data.by_tag.map((t) => groupRow('タグ', t.name, t)),
            ...data.by_weather.map((w) => groupRow('天候', w.label, w)),
            groupRow('全体', '全営業日平均', data.baseline),
          ];
        }
        break;
      }
      default:
        throw { status: 400, error: `未対応の report です: ${report}` };
    }
    sendCsv(res, `${report}_${ctx.start}_${ctx.end}.csv`, headers, rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
