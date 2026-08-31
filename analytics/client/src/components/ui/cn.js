// 複製元: client/src/components/ui/cn.js (本番 client を不変に保つため複製)
// クラス名を条件付きで結合する軽量ヘルパー(falsy を除外)。外部依存なし。
// 例: cn('base', active && 'is-active', className)
export function cn(...args) {
  return args.flat(Infinity).filter(Boolean).join(' ');
}
