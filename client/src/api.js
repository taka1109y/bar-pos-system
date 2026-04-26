const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  // Tables
  getTables: () => req('/tables'),
  createTable: (data) => req('/tables', { method: 'POST', body: JSON.stringify(data) }),
  updateTable: (id, data) => req(`/tables/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTable: (id) => req(`/tables/${id}`, { method: 'DELETE' }),

  // Menu
  getMenu: () => req('/menu'),
  getStaffMenu: () => req('/menu?staff=true'),
  getAllMenu: () => req('/menu/all'),
  getCategories: () => req('/menu/categories'),
  createMenuItem: (data) => req('/menu', { method: 'POST', body: JSON.stringify(data) }),
  updateMenuItem: (id, data) => req(`/menu/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMenuItem: (id) => req(`/menu/${id}`, { method: 'DELETE' }),
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

  // 画像アップロード（FormData を受け取り multipart/form-data で送信）
  uploadMenuImage: (formData) =>
    fetch('/api/uploads/menu-images', { method: 'POST', body: formData })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || res.statusText);
        }
        return res.json();
      }),
};
