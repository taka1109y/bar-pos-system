import { cn } from './cn';

// 空状態。アイコン(円)+ 見出し + 説明 + 任意のアクション。
export default function EmptyState({ icon, title, description, action, className }) {
  return (
    <div className={cn('text-center py-12 px-4', className)}>
      {icon && (
        <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-surface-sunken flex items-center justify-center text-faint">
          {icon}
        </div>
      )}
      {title && <h3 className="text-sm font-semibold text-heading">{title}</h3>}
      {description && <p className="mt-1 text-sm text-muted max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
