import { cn } from './cn';

// 全周ボーダーのAlert(melta規約: border-l-4 のカラーバー禁止)。
// icon はアイコン要素、title は見出し、children は本文。
const TONES = {
  info:    'bg-primary-50 border-primary-200 text-primary-800',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  danger:  'bg-red-50 border-red-200 text-red-800',
};

export default function Alert({ tone = 'info', title, icon, className, children }) {
  return (
    <div className={cn('flex items-start gap-2.5 p-3 rounded-lg border text-sm', TONES[tone] || TONES.info, className)} role="alert">
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}
