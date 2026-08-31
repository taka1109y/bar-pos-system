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

  // ── legacy(本番 reports をそのまま流用。集計は暦日・JST) ──
  getLegacyAnalytics:     (start, end) => req(`/legacy/reports/analytics${qs({ start, end })}`),
  getLegacyProfitSummary: (start, end) => req(`/legacy/reports/profit-summary${qs({ start, end })}`),
};

export default api;
