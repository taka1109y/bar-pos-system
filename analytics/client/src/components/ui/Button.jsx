// 複製元: client/src/components/ui/Button.jsx (本番 client を不変に保つため複製)
import { forwardRef } from 'react';
import { cn } from './cn';

// 業務用・高密度ボタン。size は melta を1段圧縮した dense 基準(S=h-8 / M=h-9 / L=h-10)。
// 会計・破壊操作で44pxタップ領域が要る場面は size="lg" か className で min-h-11 を付与する。
// iconOnly の場合は呼び出し側で aria-label を必ず渡すこと。
const VARIANTS = {
  primary:   'bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 border border-transparent',
  secondary: 'bg-surface text-heading border border-line-strong hover:bg-surface-hover',
  ghost:     'bg-transparent text-body hover:bg-surface-hover border border-transparent',
  danger:    'bg-danger text-white hover:brightness-95 border border-transparent',
  success:   'bg-success text-white hover:brightness-95 border border-transparent',
};
const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-10 px-5 text-sm gap-2',
};
const ICON_SIZES = { sm: 'w-8 h-8', md: 'w-9 h-9', lg: 'w-10 h-10' };

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', iconOnly = false, loading = false, disabled = false, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium select-none',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
        'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        VARIANTS[variant] || VARIANTS.primary,
        iconOnly ? cn(ICON_SIZES[size] || ICON_SIZES.md, 'p-0') : (SIZES[size] || SIZES.md),
        className
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export default Button;
