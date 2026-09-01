// 分析サーバ(analytics-server)への API クライアント。
// すべて '/api' 配下へ fetch する(dev は vite proxy → 127.0.0.1:3101、本番は nginx → analytics-server:3101)。
//   /api/v1/...      … 分析サイト固有 API(応答には meta:{definitions_version, tz, boundary_hour, snapshot} が付く)
//   /api/legacy/...  … 本番 server/routes の reports/logs をそのまま read-only で流用したもの
const BASE = '/api';
const TIMEOUT_MS = 30_000;

async function req(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? '通信がタイムアウトしました' : '通信に失敗しました');
    err.isNetwork = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || body.message || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // ── meta(健全性・同期・検証) ─────────────────────────────
  getHealth:       () => req('/v1/meta/health'),
  getSyncStatus:   () => req('/v1/meta/sync-status'),
  postSync:        (dump_file) => req('/v1/meta/sync', { method: 'POST', body: JSON.stringify({ dump_file: dump_file || null }) }),
  postVerify:      () => req('/v1/meta/verify', { method: 'POST', body: '{}' }),
  getVerifyLatest: () => req('/v1/meta/verify/latest'),

  // ── settings(store_settings) ────────────────────────────
  getSettings:   () => req('/v1/settings'),
  patchSettings: (data) => req('/v1/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  // ── v1 sales(Phase 1: 営業日/暦日対応の期間集計) ─────────
  // 共通クエリ: start, end(YYYY-MM-DD), day_mode=business|calendar,
  //             granularity=day|week|month|fiscal_year, compare=prev_period|prev_week|prev_year|prev_year_dow
  getSalesSummary:     (params) => req(`/v1/sales/summary${qs(params)}`),
  getSalesTrend:       (params) => req(`/v1/sales/trend${qs(params)}`),
  getSalesDow:         (params) => req(`/v1/sales/dow${qs(params)}`),
  getSalesHourly:      (params) => req(`/v1/sales/hourly${qs(params)}`),
  getSalesHeatmap:     (params) => req(`/v1/sales/heatmap${qs(params)}`),   // + metric=revenue|quantity|orders|guests
  getSalesCalendar:    (params) => req(`/v1/sales/calendar${qs(params)}`),  // month=YYYY-MM
  getSalesPayments:    (params) => req(`/v1/sales/payments${qs(params)}`),
  getSalesTax:         (params) => req(`/v1/sales/tax${qs(params)}`),
  getSalesAdjustments: (params) => req(`/v1/sales/adjustments${qs(params)}`),
  getSalesCompare:     (params) => req(`/v1/sales/compare${qs(params)}`),   // a_start,a_end,b_start,b_end,day_mode

  // ── v1 products(Phase 2: 商品分析。共通クエリは sales と同じ start/end/day_mode/boundary_hour) ──
  // 集計は order_items(明細)ベース。原価はレシピ原価(RECIPE_COST_CTE)
  getProductsRanking:     (params) => req(`/v1/products/ranking${qs(params)}`),     // + basis=revenue|quantity|gross_profit, include_unsold, category_id, subcategory_id
  getProductsAbc:         (params) => req(`/v1/products/abc${qs(params)}`),         // + basis
  getProductsMix:         (params) => req(`/v1/products/mix${qs(params)}`),         // + by=category|subcategory|drink_food|tax_category|staff_only
  getProductsTrend:       (params) => req(`/v1/products/trend${qs(params)}`),       // + granularity, menu_item_ids=カンマ区切り(1〜10件必須)
  getProductsAffinity:    (params) => req(`/v1/products/affinity${qs(params)}`),    // + min_pair, limit, menu_item_id(任意)
  getProductsEngineering: (params) => req(`/v1/products/engineering${qs(params)}`),
  getProductsOptions:     (params) => req(`/v1/products/options${qs(params)}`),

  // ── v1 seats(Phase 3: 客席分析。共通クエリは sales と同じ start/end/day_mode) ──
  // 稼働・平均滞在は即会計テーブル除外&closed>opened(既存定義)。seats は analyticsdb.seat_capacities
  getSeatsUtilization: (params) => req(`/v1/seats/utilization${qs(params)}`),
  getSeatsTimeline:    (params) => req(`/v1/seats/timeline${qs(params)}`),          // date=YYYY-MM-DD(営業日)
  getSeatsStay:        (params) => req(`/v1/seats/stay-distribution${qs(params)}`), // + bin_minutes(5..120)
  getSeatsGuests:      (params) => req(`/v1/seats/guests${qs(params)}`),

  // ── v1 tags(Phase 3: タグ CRUD + タグ・天候別比較) ──
  getTags:        () => req('/v1/tags'),
  createTag:      (data) => req('/v1/tags', { method: 'POST', body: JSON.stringify(data) }),
  updateTag:      (id, data) => req(`/v1/tags/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTag:      (id) => req(`/v1/tags/${id}`, { method: 'DELETE' }),                // 使用日数>0 は 409
  getTagsCompare: (params) => req(`/v1/tags/compare${qs(params)}`),                   // tag=code で with/without 比較

  // ── v1 business-days(Phase 3: 営業日ノート) ──
  getBusinessDays: (month) => req(`/v1/business-days${qs({ month })}`),               // month=YYYY-MM
  putBusinessDay:  (date, data) => req(`/v1/business-days/${date}`, { method: 'PUT', body: JSON.stringify(data) }),

  // ── v1 targets(Phase 3: 目標) ──
  getTargets:         (params) => req(`/v1/targets${qs(params)}`),                    // year=会計年度, metric(省略=全部)
  putTarget:          (data) => req('/v1/targets', { method: 'PUT', body: JSON.stringify(data) }),
  deleteTarget:       (params) => req(`/v1/targets${qs(params)}`, { method: 'DELETE' }),
  getTargetsProgress: (params) => req(`/v1/targets/progress${qs(params)}`),           // month=YYYY-MM, day_mode

  // ── v1 席数・レジ精算(Phase 3: 入力系) ──
  getSeatCapacities:  () => req('/v1/seat-capacities'),
  putSeatCapacities:  (rows) => req('/v1/seat-capacities', { method: 'PUT', body: JSON.stringify({ rows }) }),
  getRegisterClosings: (month) => req(`/v1/register-closings${qs({ month })}`),       // month=YYYY-MM
  putRegisterClosing:  (date, data) => req(`/v1/register-closings/${date}`, { method: 'PUT', body: JSON.stringify(data) }),

  // ── v1 経費(Phase 4: 入力Ⅱ。書き込み先はすべて analyticsdb) ──
  getExpenseCategories:      () => req('/v1/expense-categories'),
  createExpenseCategory:     (data) => req('/v1/expense-categories', { method: 'POST', body: JSON.stringify(data) }),
  updateExpenseCategory:     (id, data) => req(`/v1/expense-categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteExpenseCategory:     (id) => req(`/v1/expense-categories/${id}`, { method: 'DELETE' }),         // 経費紐付きありは 409
  getExpenses:               (params) => req(`/v1/expenses${qs(params)}`),                              // month=YYYY-MM か start&end(+category_id, limit<=500, offset)
  createExpense:             (data) => req('/v1/expenses', { method: 'POST', body: JSON.stringify(data) }),
  updateExpense:             (id, data) => req(`/v1/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteExpense:             (id) => req(`/v1/expenses/${id}`, { method: 'DELETE' }),
  importExpensesCsv:         (csv) => req('/v1/expenses/import-csv', { method: 'POST', body: JSON.stringify({ csv }) }), // 全行検証・全件成功時のみ一括INSERT
  getRecurringExpenses:      () => req('/v1/recurring-expenses'),
  createRecurringExpense:    (data) => req('/v1/recurring-expenses', { method: 'POST', body: JSON.stringify(data) }),
  updateRecurringExpense:    (id, data) => req(`/v1/recurring-expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRecurringExpense:    (id) => req(`/v1/recurring-expenses/${id}`, { method: 'DELETE' }),
  generateRecurringExpenses: (month) => req('/v1/recurring-expenses/generate', { method: 'POST', body: JSON.stringify({ month }) }), // 冪等。{ inserted, skipped }

  // ── v1 スタッフ・シフト(Phase 4: 人件費入力) ──
  getStaff:       () => req('/v1/staff'),
  createStaff:    (data) => req('/v1/staff', { method: 'POST', body: JSON.stringify(data) }),
  updateStaff:    (id, data) => req(`/v1/staff/${id}`, { method: 'PATCH', body: JSON.stringify(data) }), // 時給変更は staff_wage_history に営業日基準で記録される
  deleteStaff:    (id) => req(`/v1/staff/${id}`, { method: 'DELETE' }),                                  // シフト紐付きありは 409(is_active=false を促す)
  getShifts:      (params) => req(`/v1/shifts${qs(params)}`),                                            // month=YYYY-MM か start&end
  createShift:    (data) => req('/v1/shifts', { method: 'POST', body: JSON.stringify(data) }),           // 重複(staff_id, start_at)は 409
  updateShift:    (id, data) => req(`/v1/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteShift:    (id) => req(`/v1/shifts/${id}`, { method: 'DELETE' }),
  copyShiftsWeek: (from_week_start, to_week_start) => req('/v1/shifts/copy-week', { method: 'POST', body: JSON.stringify({ from_week_start, to_week_start }) }), // 既存(staff_id,start_at)はskip

  // ── v1 損益(Phase 4: 月次P&L・損益分岐点・人時生産性) ──
  getPlStatement:       (params) => req(`/v1/pl/statement${qs(params)}`),       // start&end&day_mode&granularity=month|fiscal_year
  getPlBreakeven:       (params) => req(`/v1/pl/breakeven${qs(params)}`),       // month=YYYY-MM&day_mode
  getLaborProductivity: (params) => req(`/v1/labor/productivity${qs(params)}`), // start&end&day_mode&granularity

  // ── CSV エクスポート(fetch ではなくブラウザのダウンロードに任せる。BOM付き・attachment) ──
  exportCsvUrl: (report, params) => `${BASE}/v1/export/csv${qs({ report, ...params })}`,

  // ── legacy(本番 reports をそのまま流用。集計は暦日・JST) ──
  getLegacyAnalytics:     (start, end) => req(`/legacy/reports/analytics${qs({ start, end })}`),
  getLegacyProfitSummary: (start, end) => req(`/legacy/reports/profit-summary${qs({ start, end })}`),
};

export default api;
