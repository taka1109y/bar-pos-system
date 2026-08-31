// 複製元: client/src/components/ui/Toolbar.jsx (本番 client を不変に保つため複製)
import { cn } from './cn';

// 画面上部の操作帯。左にタイトル/サブ、右にアクション(children)。
export default function Toolbar({ title, subtitle, children, className }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 flex-wrap', className)}>
      <div className="min-w-0">
        {title && <h1 className="text-lg font-bold text-heading truncate">{title}</h1>}
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}
