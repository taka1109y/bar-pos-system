// 複製元: client/src/components/ui/FilterBar.jsx (本番 client を不変に保つため複製)
import { cn } from './cn';

// 横並びフィルタ(melta の横並びフォーム idiom)。各要素は Field で包み高さを揃える。
// rest は Card と同じくルート <div> へそのまま渡す(印刷時に隠すための data-print-hide 等)。
export default function FilterBar({ children, className, ...rest }) {
  return <div className={cn('flex flex-wrap items-end gap-3', className)} {...rest}>{children}</div>;
}
