import { cn } from './cn';

// 横並びフィルタ(melta の横並びフォーム idiom)。各要素は Field で包み高さを揃える。
export default function FilterBar({ children, className }) {
  return <div className={cn('flex flex-wrap items-end gap-3', className)}>{children}</div>;
}
