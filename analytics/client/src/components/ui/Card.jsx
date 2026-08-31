// 複製元: client/src/components/ui/Card.jsx (本番 client を不変に保つため複製)
import { cn } from './cn';

// 業務用カード。dense で padding を1段圧縮。title/actions でヘッダ帯を出せる。
// padded=false で内側パディングを外し、DataTable 等を密着させる。
export default function Card({ title, actions, dense = false, padded = true, className, children, ...rest }) {
  return (
    <div className={cn('bg-surface border border-line rounded-xl shadow-sm', className)} {...rest}>
      {(title || actions) && (
        <div className={cn('flex items-center justify-between gap-3 border-b border-line', dense ? 'px-3 py-2' : 'px-4 py-3')}>
          {title && <h2 className="text-sm font-semibold text-heading truncate">{title}</h2>}
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {padded ? <div className={dense ? 'p-3' : 'p-4'}>{children}</div> : children}
    </div>
  );
}
