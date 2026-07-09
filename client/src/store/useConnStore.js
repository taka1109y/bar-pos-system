import { create } from 'zustand';

// Socket 接続状態。切断中は顧客/ボード画面で控えめな「再接続中」バナーを表示する。
export const useConnStore = create((set) => ({
  connected: true,
  setConnected: (connected) => set({ connected }),
}));
