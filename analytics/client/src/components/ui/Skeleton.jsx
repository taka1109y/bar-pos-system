// 分析サイト固有: ローディング用の簡素なスケルトン(パルスするプレースホルダ)。
import { cn } from './cn';

export default function Skeleton({ height = 280, className, style }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="読み込み中"
      className={cn('animate-pulse rounded-lg bg-surface-sunken', className)}
      style={{ height, ...style }}
    />
  );
}
