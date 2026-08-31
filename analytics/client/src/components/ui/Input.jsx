// 複製元: client/src/components/ui/Input.jsx (本番 client を不変に保つため複製)
import { forwardRef } from 'react';
import { cn } from './cn';

// 単一行入力。既存の const inp(9箇所コピペ)の統合先。
// prefix/suffix で ¥ / % アドオン、invalid でエラー枠。
const SIZES = { sm: 'h-8 text-xs', md: 'h-9 text-sm', lg: 'h-10 text-sm' };

const Input = forwardRef(function Input({ size = 'md', invalid = false, prefix, suffix, className, ...rest }, ref) {
  // 横パディングは base に含めない(px-3 と pl-*/pr-* は Tailwind の出力順で px が後勝ちし、
  // prefix/suffix 時にテキストがアドオンへ重なるため)。各分岐で pl-*/pr-* を明示指定する。
  const base = cn(
    'w-full rounded-lg bg-surface border text-body placeholder:text-faint',
    'focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500',
    invalid ? 'border-danger' : 'border-line-strong',
    SIZES[size] || SIZES.md
  );
  if (prefix || suffix) {
    return (
      <div className={cn('relative flex items-center', className)}>
        {prefix && <span className="absolute left-3 text-muted text-sm pointer-events-none">{prefix}</span>}
        <input ref={ref} className={cn(base, prefix ? 'pl-8' : 'pl-3', suffix ? 'pr-8' : 'pr-3')} {...rest} />
        {suffix && <span className="absolute right-3 text-muted text-sm pointer-events-none">{suffix}</span>}
      </div>
    );
  }
  return <input ref={ref} className={cn(base, 'px-3', className)} {...rest} />;
});

export default Input;
