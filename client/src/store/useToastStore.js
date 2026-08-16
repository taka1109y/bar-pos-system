import { create } from 'zustand';

// スタッフ(POS)側の共通トースト。mutation の onError 等から
// useToastStore.getState().error(msg) で呼べる(コンポーネント外からも可)。
let _id = 0;
export const useToastStore = create((set, get) => ({
  toasts: [],
  push: (message, type = 'info', ttl = 4000) => {
    const id = ++_id;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => get().remove(id), ttl);
    return id;
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  error:   (message) => get().push(message, 'error', 5000),
  success: (message) => get().push(message, 'success', 3000),
}));
