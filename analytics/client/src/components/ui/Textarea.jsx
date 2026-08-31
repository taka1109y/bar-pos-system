// 複製元: client/src/components/ui/Textarea.jsx (本番 client を不変に保つため複製)
import { forwardRef } from 'react';
import { cn } from './cn';

// 複数行入力。invalid でエラー枠。
const Textarea = forwardRef(function Textarea({ invalid = false, className, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-lg bg-surface border px-3 py-2 text-sm text-body placeholder:text-faint',
        'focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500',
        invalid ? 'border-danger' : 'border-line-strong',
        className
      )}
      {...rest}
    />
  );
});

export default Textarea;
