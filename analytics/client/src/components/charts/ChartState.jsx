// チャート/表の取得状態を出し分ける薄いラッパ。
//   isError   → danger Alert(fetch 失敗はモック無しでエラー表示する方針)
//   isLoading → Skeleton
//   isEmpty   → EmptyState(bool か (data)=>bool)
//   それ以外  → children
import { Alert, EmptyState, Skeleton } from '../ui';

export default function ChartState({ query, height = 280, emptyTitle = '期間内にデータがありません', isEmpty = false, children }) {
  if (query.isError) {
    return <Alert tone="danger" title="データを取得できません">{query.error?.message}</Alert>;
  }
  if (query.isLoading) return <Skeleton height={height} />;
  const empty = typeof isEmpty === 'function' ? isEmpty(query.data) : isEmpty;
  if (empty) {
    return <EmptyState title={emptyTitle} description="期間を変更するか、「同期・検証」でデータの取込状況を確認してください。" />;
  }
  return children;
}
