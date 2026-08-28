import { create } from 'zustand';

// シーソー段数バッジ(▲k)を「連続注文で累積」させるための銘柄別タイマー。
// 同一銘柄に新イベントが来るたびリセット(延長)し、無イベントが SEESAW_HOLD_MS 続いたら消す。
// store 外(モジュールスコープ)で管理し、古いタイマーがハイライトを早期に消さないようにする。
const seesawTimers = {};
const SEESAW_HOLD_MS = 3200;

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
        // シーソー(seesaw_win/lose)の段数バッジ: 同方向イベントが連続したら delta を累積(合成)。
        // 方向が反転したら置き換え。通常更新(event なし)は既存の seesaw を保つ。
        let seesaw = prev?.seesaw ?? null;
        if (item.event) {
          const d = Number(item.delta) || 0;
          seesaw = (seesaw && seesaw.event === item.event)
            ? { event: item.event, delta: (Number(seesaw.delta) || 0) + d }
            : { event: item.event, delta: d };
        }
        // prices:updated も価格関連フィールドのみのため、既存エントリにマージする
        updated[item.id] = {
          ...prev,
          ...item,
          previous_price: prev?.current_price ?? item.current_price,
          flash: item.direction,
          seesaw,
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

    // シーソーのハイライト(段数バッジ)は、銘柄ごとに無イベントが SEESAW_HOLD_MS 続いたら消す。
    // 新イベントのたびタイマーをリセット(延長)＝累積表示中に古いタイマーで早期に消えないようにする。
    for (const it of items) {
      if (!it.event) continue;
      const id = it.id;
      if (seesawTimers[id]) clearTimeout(seesawTimers[id]);
      seesawTimers[id] = setTimeout(() => {
        delete seesawTimers[id];
        set((state) => {
          if (!state.prices[id]) return {};
          return { prices: { ...state.prices, [id]: { ...state.prices[id], seesaw: null } } };
        });
      }, SEESAW_HOLD_MS);
    }
  },

  getPriceById: (id) => get().prices[id],
  getAllPrices: () => get().order.map((id) => get().prices[id]).filter(Boolean),
}));

export default usePriceStore;
