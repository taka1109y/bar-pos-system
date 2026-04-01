import { create } from 'zustand';

const usePriceStore = create((set, get) => ({
  prices: {}, // { [itemId]: { id, name, current_price, base_price, pct_change, direction, previous_price } }

  initPrices: (items) => {
    const prices = {};
    for (const item of items) {
      prices[item.id] = {
        ...item,
        previous_price: item.current_price,
        flash: null,
      };
    }
    set({ prices });
  },

  updatePrices: (items) => {
    set((state) => {
      const updated = { ...state.prices };
      for (const item of items) {
        const prev = updated[item.id];
        updated[item.id] = {
          ...item,
          previous_price: prev?.current_price ?? item.current_price,
          flash: item.direction,
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
  },

  getPriceById: (id) => get().prices[id],
  getAllPrices: () => Object.values(get().prices),
}));

export default usePriceStore;
