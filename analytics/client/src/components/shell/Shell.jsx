import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useToastStore } from '../../store/useToastStore';
import { cn } from '../ui/cn';

// 画面右下のトースト表示(操作結果通知)。
const TOAST_TONES = {
  info:    'bg-primary-50 border-primary-200 text-primary-800',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  danger:  'bg-red-50 border-red-200 text-red-800',
};

function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn('toast-in flex items-start gap-2 p-3 rounded-lg border shadow-md text-sm', TOAST_TONES[t.tone] || TOAST_TONES.info)}>
          <div className="flex-1 min-w-0 break-words">{t.message}</div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="閉じる" className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md hover:bg-black/5 cursor-pointer">
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

// レイアウトルート: Sidebar + main(スクロール領域)。各ページは <Outlet /> に描画される。
export default function Shell() {
  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <Outlet />
        </div>
      </main>
      <ToastHost />
    </div>
  );
}
