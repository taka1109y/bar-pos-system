// CSV エクスポートボタン。fetch ではなく <a href> でサーバの
// GET /api/v1/export/csv (BOM付き・Content-Disposition: attachment) へ直接飛ばす。
import { api } from '../api';
import { cn } from './ui/cn';

export default function ExportCsvButton({ report, params, className, children }) {
  return (
    <a
      href={api.exportCsvUrl(report, params)}
      download
      className={cn(
        'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-sm font-medium select-none cursor-pointer',
        'bg-surface text-heading border border-line-strong hover:bg-surface-hover transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
      {children || 'CSV'}
    </a>
  );
}
