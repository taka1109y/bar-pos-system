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
  getAllMenu: () => req('/menu/all'),
  getCategories: () => req('/menu/categories'),
  createMenuItem: (data) => req('/menu', { method: 'POST', body: JSON.stringify(data) }),
  updateMenuItem: (id, data) => req(`/menu/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMenuItem: (id) => req(`/menu/${id}`, { method: 'DELETE' }),
  createCategory: (data) => req('/menu/categories', { method: 'POST', body: JSON.stringify(data) }),

  // Orders
  getOrderByTable: (tableId) => req(`/orders/table/${tableId}`),
  createOrder: (tableId) => req('/orders', { method: 'POST', body: JSON.stringify({ table_id: tableId }) }),
  addOrderItem: (orderId, data) => req(`/orders/${orderId}/items`, { method: 'POST', body: JSON.stringify(data) }),
  updateOrderItem: (orderId, itemId, data) => req(`/orders/${orderId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteOrderItem: (orderId, itemId) => req(`/orders/${orderId}/items/${itemId}`, { method: 'DELETE' }),

  // Payments
  pay: (orderId) => req(`/payments/${orderId}`, { method: 'POST' }),

  // Prices
  getPrices: () => req('/prices'),
  getPriceHistory: (id, limit = 20) => req(`/prices/${id}/history?limit=${limit}`),

  // Reports
  getDailyReport: (date) => req(`/reports/daily?date=${date}`),
  getHourlyReport: (date) => req(`/reports/hourly?date=${date}`),
};
