// 複製元: client/src/components/ui/Segmented.jsx (本番 client を不変に保つため複製)
import { cn } from './cn';

// 排他トグル(通常⇄分割、釣り有り⇄無し 等)。options=[{value,label}]。
export default function Segmented({ options, value, onChange, size = 'md', className }) {
  const h = size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm';
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5', className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(o.value)}
            className={cn(
              'px-3 rounded-md font-medium cursor-pointer transition-colors', h,
              active ? 'bg-surface text-heading shadow-sm' : 'text-muted hover:text-heading'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
