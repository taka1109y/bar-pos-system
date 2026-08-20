import { create } from 'zustand';

const usePriceStore = create((set, get) => ({
  prices: {}, // { [itemId]: { id, name, current_price, base_price, pct_change, direction, previous_price } }
  order: [],  // サーバーから届いた順番のitem ID配列（Object.values()は整数キーを昇順で列挙してしまうため別管理）

  initPrices: (items) => {
    if (!Array.isArray(items)) return;
    set((state) => {
      const prices = {};
      for (const item of items) {
        // prices:sync は category_id/category_name 等の一部フィールドを含まないため、
        // 既存エントリにマージして(全置換せず)過去に取得済みの情報を保持する
        const prev = state.prices[item.id];
        prices[item.id] = {
          ...prev,
          ...item,
          previous_price: item.current_price,
          flash: null,
        };
      }
      return { prices, order: items.map((item) => item.id) };
    });
  },

  updatePrices: (items) => {
    if (!Array.isArray(items)) return;
    set((state) => {
      const updated = { ...state.prices };
      for (const item of items) {
        const prev = updated[item.id];
        // prices:updated も価格関連フィールドのみのため、既存エントリにマージする
        updated[item.id] = {
          ...prev,
          ...item,
          previous_price: prev?.current_price ?? item.current_price,
          flash: item.direction,
          // シーソー(seesaw_win/lose)の発生銘柄は数秒ハイライト用に {event, delta} を保持。
          // 通常更新では既存の seesaw を保つ(進行中ハイライトを別更新で消さない)。
          seesaw: item.event ? { event: item.event, delta: item.delta } : (prev?.seesaw ?? null),
        };
      }
      return { prices: updated };
    });

    // フラッシュアニメーションをリセット
    setTimeout(() => {
      set((state) => {
        const updated = { ...state.prices };
        for (const item of items) {
          if (updated[item.id]) {
            updated[item.id] = { ...updated[item.id], flash: null };
          }
        }
        return { prices: updated };
      });
    }, 1100);

    // シーソーのハイライト(勝者=緑点滅+▲段/犠牲=赤点滅+▼段)は数秒維持してから消す
    const seesawIds = items.filter((it) => it.event).map((it) => it.id);
    if (seesawIds.length) {
      setTimeout(() => {
        set((state) => {
          const updated = { ...state.prices };
          for (const id of seesawIds) {
            if (updated[id]) updated[id] = { ...updated[id], seesaw: null };
          }
          return { prices: updated };
        });
      }, 3200);
    }
  },

  getPriceById: (id) => get().prices[id],
  getAllPrices: () => get().order.map((id) => get().prices[id]).filter(Boolean),
}));

export default usePriceStore;
