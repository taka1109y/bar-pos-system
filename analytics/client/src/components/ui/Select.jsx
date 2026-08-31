// 複製元: client/src/components/ui/Select.jsx (本番 client を不変に保つため複製)
import { forwardRef } from 'react';
import { cn } from './cn';

// ネイティブ矢印を隠し SVG chevron を重ねる(melta規約: ネイティブ矢印禁止)。
// options=[{value,label}] か children(<option>群)を受ける。
const SIZES = { sm: 'h-8 text-xs', md: 'h-9 text-sm', lg: 'h-10 text-sm' };

const Select = forwardRef(function Select({ size = 'md', invalid = false, options, className, children, ...rest }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className={cn(
          'w-full appearance-none rounded-lg bg-surface border pl-3 pr-9 text-body cursor-pointer',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500',
          invalid ? 'border-danger' : 'border-line-strong',
          SIZES[size] || SIZES.md
        )}
        {...rest}
      >
        {options ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : children}
      </select>
      <svg viewBox="0 0 20 20" className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export default Select;
