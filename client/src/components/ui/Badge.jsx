import { cn } from './cn';

// ステータス/種別バッジ。tone で意味色、dot で先頭ドット。
const TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/10',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/10',
  danger:  'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10',
  info:    'bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-600/10',
};
const DOT = { neutral: 'bg-slate-400', success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-red-500', info: 'bg-primary-500' };

export default function Badge({ tone = 'neutral', size = 'md', dot = false, className, children }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap',
      size === 'sm' ? 'px-1.5 py-0.5 text-2xs' : 'px-2 py-0.5 text-xs',
      TONES[tone] || TONES.neutral, className
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', DOT[tone] || DOT.neutral)} />}
      {children}
    </span>
  );
}
