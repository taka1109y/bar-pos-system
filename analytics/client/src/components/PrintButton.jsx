// 印刷ボタン。window.print() を呼ぶだけの薄いボタンで、見た目は ExportCsvButton と揃える。
// 印刷レイアウトは index.css の @media print が担当する
// （サイドバー・PeriodBar・操作ボタンを隠し、面を白にし、カード単位で改ページしない）。
// このボタン自身も <button> なので印刷結果には出ない（@media print の button 非表示ルール）。
import { cn } from './ui/cn';

export default function PrintButton({ className, children }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-sm font-medium select-none cursor-pointer',
        'bg-surface text-heading border border-line-strong hover:bg-surface-hover transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9V3h12v6" />
        <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
        <rect x="6" y="14" width="12" height="7" rx="1" />
      </svg>
      {children || '印刷'}
    </button>
  );
}
