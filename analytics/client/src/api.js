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

  // ── CSV エクスポート(fetch ではなくブラウザのダウンロードに任せる。BOM付き・attachment) ──
  exportCsvUrl: (report, params) => `${BASE}/v1/export/csv${qs({ report, ...params })}`,

  // ── legacy(本番 reports をそのまま流用。集計は暦日・JST) ──
  getLegacyAnalytics:     (start, end) => req(`/legacy/reports/analytics${qs({ start, end })}`),
  getLegacyProfitSummary: (start, end) => req(`/legacy/reports/profit-summary${qs({ start, end })}`),
};

export default api;
