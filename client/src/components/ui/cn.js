// クラス名を条件付きで結合する軽量ヘルパー(falsy を除外)。外部依存なし。
// 例: cn('base', active && 'is-active', className)
export function cn(...args) {
  return args.flat(Infinity).filter(Boolean).join(' ');
}
