'use strict';
// /api/v1/export — CSV 出力（BOM 付き UTF-8・日本語ヘッダ・attachment）
// 集計は routes/sales.js の fetch 群を再利用する（API とCSVで数字が食い違わないようにする）
const express = require('express');
const bd = require('../lib/businessDay');
const sales = require('./sales');
const { sendCsv } = require('../lib/csv');

const router = express.Router();

const REPORTS = ['trend', 'dow', 'hourly', 'heatmap', 'payments', 'tax', 'adjustments', 'calendar'];
const METRICS = new Set(['revenue', 'quantity', 'orders', 'guests']);
const METRIC_LABELS = { revenue: '売上', quantity: '数量', orders: '会計件数', guests: '客数' };
const WEATHER_LABELS = { sunny: '晴れ', cloudy: '曇り', rain: '雨', heavy_rain: '大雨', snow: '雪' };

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
      default:
        throw { status: 400, error: `未対応の report です: ${report}` };
    }
    sendCsv(res, `${report}_${ctx.start}_${ctx.end}.csv`, headers, rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
