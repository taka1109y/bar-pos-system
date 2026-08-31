// 複製元: client/src/components/ui/Modal.jsx (本番 client を不変に保つため複製)
import { useEffect } from 'react';
import { cn } from './cn';

// 中央モーダル。既存の ModalShell(4ファイル重複)の統合先。
// Esc で閉じる・背景クリックで閉じる(closeOnBackdrop)。既存 keyframe modal-slide-up を流用。
const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' };

export default function Modal({ title, onClose, size = 'md', footer, dense = false, closeOnBackdrop = true, className, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onMouseDown={closeOnBackdrop ? (e) => { if (e.target === e.currentTarget) onClose?.(); } : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn('ui-pad w-full bg-surface rounded-xl shadow-xl border border-line flex flex-col max-h-[92vh] modal-slide-up', SIZES[size] || SIZES.md, className)}
      >
        {(title || onClose) && (
          <div className={cn('flex items-center justify-between gap-3 border-b border-line shrink-0', dense ? 'px-3 py-2' : 'px-4 py-3')}>
            <h2 className="text-base font-semibold text-heading truncate">{title}</h2>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="閉じる"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-heading cursor-pointer shrink-0">
                <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className={cn('overflow-y-auto', dense ? 'p-3' : 'p-4')}>{children}</div>
        {footer && (
          <div className={cn('flex items-center justify-end gap-2 border-t border-line shrink-0', dense ? 'px-3 py-2' : 'px-4 py-3')}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
