import { useToastStore } from '../store/useToastStore';

// スタッフ(POS)側トーストの表示先。POSPage に1つ置く。
const STYLES = {
  error:   'bg-red-600 text-white',
  success: 'bg-emerald-600 text-white',
  info:    'bg-slate-800 text-white',
};

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => remove(t.id)}
          className={`pointer-events-auto cursor-pointer max-w-sm px-4 py-3 rounded-lg shadow-md text-sm font-medium ${STYLES[t.type] ?? STYLES.info}`}
        >
          {t.type === 'error' ? '⚠ ' : t.type === 'success' ? '✓ ' : ''}{t.message}
        </div>
      ))}
    </div>
  );
}
