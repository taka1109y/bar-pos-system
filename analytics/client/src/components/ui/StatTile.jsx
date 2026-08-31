// 複製元: client/src/components/ui/StatTile.jsx (本番 client を不変に保つため複製)
import { cn } from './cn';

// KPIタイル。label(小・muted) + value(大・heading) + 任意の delta / sub。
// deltaTone: 'up'(緑) | 'down'(赤) | 'neutral'。
export default function StatTile({ label, value, sub, delta, deltaTone = 'neutral', icon, dense = false, className }) {
  const toneCls = { up: 'text-success', down: 'text-danger', neutral: 'text-muted' }[deltaTone] || 'text-muted';
  return (
    <div className={cn('bg-surface border border-line rounded-xl shadow-sm', dense ? 'p-3' : 'p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted truncate">{label}</span>
        {icon && <span className="text-faint shrink-0">{icon}</span>}
      </div>
      <div className={cn('mt-1 font-bold text-heading tabular-nums', dense ? 'text-lg' : 'text-2xl')}>{value}</div>
      {(sub || delta != null) && (
        <div className="mt-0.5 flex items-center gap-2 text-xs">
          {delta != null && <span className={cn('font-medium', toneCls)}>{delta}</span>}
          {sub && <span className="text-muted truncate">{sub}</span>}
        </div>
      )}
    </div>
  );
}
