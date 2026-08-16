import { cn } from './cn';

// underline タブ。SystemSettings 等の画面内タブに使用。iPad横で溢れないよう overflow-x-auto。
// tabs=[{ id, label, badge? }]
export default function Tabs({ tabs, activeId, onChange, className }) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-line overflow-x-auto', className)} role="tablist">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(t.id)}
            className={cn(
              'shrink-0 px-3 h-9 inline-flex items-center gap-1.5 text-sm border-b-2 -mb-px cursor-pointer transition-colors',
              active
                ? 'border-primary-500 text-primary-600 font-semibold'
                : 'border-transparent text-muted hover:text-heading hover:border-line-strong'
            )}
          >
            {t.label}
            {t.badge != null && (
              <span className="text-2xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
