const BASE = '/api';
const TIMEOUT_MS = 12_000;

function networkError(message) {
  const err = new Error(message);
  err.isNetwork = true;
  return err;
}

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
    throw networkError(e.name === 'AbortError' ? '通信がタイムアウトしました' : '通信に失敗しました');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export const api = {
  // Tables
  getTables: ({ includeArchived = false } = {}) => req(`/tables${includeArchived ? '?include_archived=true' : ''}`),
  getImmediateTable: () => req('/tables/immediate'),
  createTable: (data) => req('/tables', { method: 'POST', body: JSON.stringify(data) }),
  updateTable: (id, data) => req(`/tables/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTable: (id) => req(`/tables/${id}`, { method: 'DELETE' }),

  // Menu
  getMenu: () => req('/menu'),
  getStaffMenu: () => req('/menu?staff=true'),
  getAllMenu: () => req('/menu/all'),
  getCategories:      () => req('/menu/categories'),
  getStaffCategories: () => req('/menu/categories?staff=true'),
  createMenuItem: (data) => req('/menu', { method: 'POST', body: JSON.stringify(data) }),
  updateMenuItem: (id, data) => req(`/menu/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMenuItem: (id) => req(`/menu/${id}`, { method: 'DELETE' }),
  reorderMenuItems: (items) => req('/menu/reorder', { method: 'POST', body: JSON.stringify({ items }) }),
  createCategory: (data) => req('/menu/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id, data) => req(`/menu/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCategory: (id) => req(`/menu/categories/${id}`, { method: 'DELETE' }),

  // Subcategories
  getSubcategories: () => req('/menu/subcategories'),
  createSubcategory: (data) => req('/menu/subcategories', { method: 'POST', body: JSON.stringify(data) }),
  updateSubcategory: (id, data) => req(`/menu/subcategories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSubcategory: (id) => req(`/menu/subcategories/${id}`, { method: 'DELETE' }),

  // Orders
  getOpenOrders: () => req('/orders/open'),
  getOrderByTable: (tableId) => req(`/orders/table/${tableId}`),
  createOrder: (tableId, guestCount = 1) => req('/orders', { method: 'POST', body: JSON.stringify({ table_id: tableId, guest_count: guestCount }) }),
  addOrderItem: (orderId, data) => req(`/orders/${orderId}/items`, { method: 'POST', body: JSON.stringify(data) }),
  updateOrderItem: (orderId, itemId, data) => req(`/orders/${orderId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteOrderItem: (orderId, itemId) => req(`/orders/${orderId}/items/${itemId}`, { method: 'DELETE' }),
  updateGuestCount: (orderId, guestCount) => req(`/orders/${orderId}/guest-count`, { method: 'PATCH', body: JSON.stringify({ guest_count: guestCount }) }),
  updateOrderTable: (orderId, tableId) => req(`/orders/${orderId}/table`, { method: 'PATCH', body: JSON.stringify({ table_id: tableId }) }),

  // Payments
  pay: (orderId, paymentMethod = 'cash', discountAmount = 0, memo = null, giftCertAmount = 0, giftCertNoChange = false) =>
    req(`/payments/${orderId}`, {
      method: 'POST',
      body: JSON.stringify({
        payment_method:    paymentMethod,
        discount_amount:   discountAmount,
        memo:              memo || null,
        gift_cert_amount:  giftCertAmount,
        gift_cert_no_change: giftCertNoChange,
      }),
    }),

  // System
  getSystemSettings: () => req('/system/settings'),
  updateSystemSettings: (data) => req('/system/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  // Prices
  getPrices: () => req('/prices'),
  getPriceHistory: (id, limit = 20) => req(`/prices/${id}/history?limit=${limit}`),

  // Reports
  getDailyReport: (date, since) => req(`/reports/daily?date=${date}${since ? '&since=' + encodeURIComponent(since) : ''}`),
  getCostAnalysis: (start, end) => req(`/reports/cost-analysis?start=${start}&end=${end}`),
  getProfitSummary: (start, end) => req(`/reports/profit-summary?start=${start}&end=${end}`),
  getAnalytics: (start, end) => req(`/reports/analytics?start=${start}&end=${end}`),
  getReceipts: (date) => req(`/receipts?date=${date}`),
  getOrder: (orderId) => req(`/orders/${orderId}`),
  voidAndReissue: (orderId) => req(`/receipts/${orderId}/void-and-reissue`, { method: 'POST' }),

  // Settings
  getPricingSettings: () => req('/settings/pricing'),
  updatePricingSettings: (data) => req('/settings/pricing', { method: 'PATCH', body: JSON.stringify(data) }),
  resetPricingSettings: () => req('/settings/pricing/reset', { method: 'POST' }),

  // Crash
  triggerCrash: (data) => req('/menu/crash', { method: 'POST', body: JSON.stringify(data) }),
  resetCrash:   ()     => req('/menu/crash/reset', { method: 'POST' }),

  // Kitchen
  getKitchenOrders: () => req('/kitchen/orders'),
  serveKitchenItem: (itemId) => req(`/kitchen/items/${itemId}/serve`, { method: 'PATCH' }),
  getKitchenHistory: (date, since) => req(`/kitchen/history?date=${date}${since ? '&since=' + encodeURIComponent(since) : ''}`),

  // ログ検索
  getLogs: ({ from, to, receipt_type = 'all', payment_method = 'all', limit = 50, offset = 0 } = {}) => {
    const p = new URLSearchParams({ limit, offset });
    if (from)                                  p.set('from', from);
    if (to)                                    p.set('to', to);
    if (receipt_type   && receipt_type   !== 'all') p.set('receipt_type',   receipt_type);
    if (payment_method && payment_method !== 'all') p.set('payment_method', payment_method);
    return req(`/logs?${p}`);
  },

  // メンテナンス
  archiveOldData: (beforeDays = 90) =>
    req('/maintenance/archive', { method: 'POST', body: JSON.stringify({ before_days: beforeDays }) }),

  // 材料マスター
  getIngredients: () => req('/ingredients'),
  createIngredient: (data) => req('/ingredients', { method: 'POST', body: JSON.stringify(data) }),
  updateIngredient: (id, data) => req(`/ingredients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteIngredient: (id) => req(`/ingredients/${id}`, { method: 'DELETE' }),

  // レシピ
  getRecipes: () => req('/recipes'),
  getRecipeByMenu: (menuItemId) => req(`/recipes/menu/${menuItemId}`),
  saveRecipe: (menuItemId, data) => req(`/recipes/menu/${menuItemId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // 材料在庫管理
  getInventory: () => req('/inventory'),
  initInventory: (ingredientId, data) => req(`/inventory/${ingredientId}/init`, { method: 'POST', body: JSON.stringify(data) }),
  adjustInventory: (adjustments) => req('/inventory/adjust', { method: 'POST', body: JSON.stringify({ adjustments }) }),
  addPurchase: (data) => req('/inventory/purchase', { method: 'POST', body: JSON.stringify(data) }),
  getInventoryLogs: ({ ingredient_id, from, to, reason, limit } = {}) => {
    const p = new URLSearchParams();
    if (ingredient_id) p.set('ingredient_id', ingredient_id);
    if (from)          p.set('from', from);
    if (to)            p.set('to', to);
    if (reason)        p.set('reason', reason);
    if (limit)         p.set('limit', limit);
    return req(`/inventory/logs${p.toString() ? '?' + p : ''}`);
  },

  // 画像アップロード（FormData を受け取り multipart/form-data で送信）
  // headers: {} で Content-Type を fetch に自動設定させ、multipart boundary を正しく処理する
  uploadMenuImage: (formData) =>
    req('/uploads/menu-images', { method: 'POST', body: formData, headers: {} }),
};
