import { useQuery } from '@tanstack/react-query';
import { Badge, Alert } from './ui';
import { api } from '../api';
import { fmtDateTime } from '../utils/datetime';
import { cn } from './ui/cn';

// sync-status / verify/latest の応答からバナー表示用の値を取り出す。
// サーバ側のキー名は Phase 0 契約で固定されていないため、想定される複数形に対応する。
export function pickSyncInfo(d) {
  if (!d) return null;
  const latest = d.latest ?? d.snapshot ?? d.last_import ?? d.import ?? d.latest_import ?? null;
  const current = d.current ?? d.bardb ?? d.live ?? d.db ?? null;
  const metaSnap = d.meta?.snapshot ?? null;
  return {
    imported_at: latest?.imported_at ?? metaSnap?.imported_at ?? null,
    dump_file: latest?.dump_file ?? null,
    orders_count: latest?.orders_count ?? metaSnap?.orders_count ?? null,
    order_items_count: latest?.order_items_count ?? null,
    max_closed_at: latest?.max_closed_at ?? current?.max_closed_at ?? null,
    current_orders: current?.orders_count ?? current?.orders ?? null,
    current_order_items: current?.order_items_count ?? current?.order_items ?? null,
    current_max_closed_at: current?.max_closed_at ?? null,
    drift: Boolean(d.drift),
    boundary_hour: d.meta?.boundary_hour ?? null,
    tz: d.meta?.tz ?? null,
  };
}

export function pickVerifyInfo(d) {
  if (!d) return null;
  const run = d.run ?? d.latest ?? d;
  const checks = Array.isArray(run.checks) ? run.checks : Array.isArray(d.checks) ? d.checks : [];
  const ok = typeof run.ok === 'boolean' ? run.ok : checks.length > 0 ? checks.every((c) => c.ok) : null;
  return { ok, checks, run_at: run.run_at ?? d.run_at ?? null };
}

export function useSyncStatus() {
  return useQuery({ queryKey: ['meta', 'sync-status'], queryFn: api.getSyncStatus });
}
export function useVerifyLatest() {
  return useQuery({ queryKey: ['meta', 'verify-latest'], queryFn: api.getVerifyLatest });
}

// データ基準バナー: 「いつのスナップショットを見ているか」「営業日境界」「検証結果」を常に見せる。
// drift(取込記録と現在件数の不一致) または 検証 FAIL のときは warning Alert に切り替える。
export default function DataBanner({ className }) {
  const syncQ = useSyncStatus();
  const verifyQ = useVerifyLatest();
  const sync = pickSyncInfo(syncQ.data);
  const verify = pickVerifyInfo(verifyQ.data);

  const verifyTone = verify?.ok === true ? 'success' : verify?.ok === false ? 'danger' : 'neutral';
  const verifyLabel = verify?.ok === true ? 'PASS' : verify?.ok === false ? 'FAIL' : '未実行';

  const items = [
    <span key="base">
      <span className="text-muted">データ基準:</span>{' '}
      <span className="font-medium text-heading">{fmtDateTime(sync?.imported_at)}</span> 取込
      {' / '}orders <span className="font-medium text-heading tabular-nums">{sync?.orders_count ?? '—'}</span> 件
      {' / '}最終会計 <span className="font-medium text-heading">{fmtDateTime(sync?.max_closed_at)}</span>
    </span>,
    <span key="boundary">
      <span className="text-muted">営業日境界</span>{' '}
      <span className="font-medium text-heading tabular-nums">{sync?.boundary_hour ?? '—'}:00</span>
    </span>,
    <span key="verify" className="inline-flex items-center gap-1.5">
      <span className="text-muted">検証:</span>
      <Badge tone={verifyTone} dot>{verifyLabel}</Badge>
      {verify?.run_at && <span className="text-muted">({fmtDateTime(verify.run_at)})</span>}
    </span>,
  ];

  const problems = [];
  if (sync?.drift) problems.push(`取込記録と現在のデータ件数が一致しません(記録 ${sync.orders_count ?? '—'} 件 / 現在 ${sync.current_orders ?? '—'} 件)。「同期・検証」から取込を記録し直してください。`);
  if (verify?.ok === false) problems.push('最新の検証で失敗した項目があります。「同期・検証」で内容を確認してください。');
  if (syncQ.isError) problems.push(`同期状態を取得できません: ${syncQ.error?.message || ''}`);
  if (verifyQ.isError) problems.push(`検証結果を取得できません: ${verifyQ.error?.message || ''}`);

  if (problems.length > 0) {
    return (
      <Alert tone="warning" title="データの状態を確認してください" className={className}>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-1">{items}</div>
        <ul className="list-disc pl-4 space-y-0.5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </Alert>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg bg-surface border border-line text-xs text-body', className)}>
      {items}
    </div>
  );
}
