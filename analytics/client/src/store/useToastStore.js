// 画面右下の簡易トースト(検証実行・取込記録などの操作結果通知)。zustand の最小ストア。
import { create } from 'zustand';

let seq = 0;

export const useToastStore = create((set) => ({
  toasts: [],
  push: (message, tone = 'info', ttlMs = 4000) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    if (ttlMs > 0) {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttlMs);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
