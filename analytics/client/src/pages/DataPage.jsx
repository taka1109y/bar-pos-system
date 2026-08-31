import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Badge, Button, DataTable, Alert, Input, Field } from '../components/ui';
import DataBanner, { pickSyncInfo, pickVerifyInfo, useSyncStatus, useVerifyLatest } from '../components/DataBanner';
import { api } from '../api';
import { fmtDateTime } from '../utils/datetime';
import { useToastStore } from '../store/useToastStore';

// 値 → Badge の tone/表示。boolean は OK/NG、'on'/'off' も真偽扱い、それ以外は文字列表示。
function toBadge(key, v) {
  if (typeof v === 'boolean') {
    // can_insert は false が正常(書込不可が期待値)
    const good = key === 'can_insert' ? !v : v;
    return { tone: good ? 'success' : 'danger', text: v ? 'true' : 'false' };
  }
  if (v === 'on' || v === 'off') return { tone: v === 'on' ? 'success' : 'danger', text: v };
  if (v == null) return { tone: 'neutral', text: '—' };
  if (typeof v === 'object') return { tone: 'neutral', text: JSON.stringify(v) };
  return { tone: 'neutral', text: String(v) };
}

// health 応答(形は固定していない)を「セクション → key: value バッジ」に平坦化して表示する。
function HealthBadges({ data }) {
  if (!data || typeof data !== 'object') return null;
  const scalars = [];
  const sections = [];
  Object.entries(data).forEach(([k, v]) => {
    if (k === 'meta') return;
    if (v && typeof v === 'object' && !Array.isArray(v)) sections.push([k, v]);
    else scalars.push([k, v]);
  });
  const renderRow = (entries) => (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => {
        const b = toBadge(k, v);
        return (
          <Badge key={k} tone={b.tone} className="font-mono">
            <span className="opacity-70">{k}:</span> {b.text}
          </Badge>
        );
      })}
    </div>
  );
  return (
    <div className="space-y-3">
      {scalars.length > 0 && renderRow(scalars)}
      {sections.map(([name, obj]) => (
        <div key={name}>
          <div className="text-2xs font-semibold uppercase tracking-wide text-muted mb-1">{name}</div>
          {renderRow(Object.entries(obj))}
        </div>
      ))}
    </div>
  );
}

const DetailCell = ({ detail }) => {
  if (detail == null) return <span className="text-faint">—</span>;
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return <code className="text-2xs break-all whitespace-pre-wrap">{text}</code>;
};

const CHECK_COLUMNS = [
  { key: 'check_name', header: 'チェック', width: 180, render: (r) => <span className="font-mono text-heading">{r.check_name}</span> },
  { key: 'ok', header: '結果', width: 80, align: 'center', render: (r) => <Badge tone={r.ok ? 'success' : 'danger'} dot>{r.ok ? 'PASS' : 'FAIL'}</Badge> },
  { key: 'detail', header: '詳細', render: (r) => <DetailCell detail={r.detail} /> },
];

export default function DataPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [dumpFile, setDumpFile] = useState('');

  const healthQ = useQuery({ queryKey: ['meta', 'health'], queryFn: api.getHealth });
  const syncQ = useSyncStatus();
  const verifyQ = useVerifyLatest();
  const sync = pickSyncInfo(syncQ.data);
  const verify = pickVerifyInfo(verifyQ.data);

  const invalidateMeta = () => qc.invalidateQueries({ queryKey: ['meta'] });

  const verifyM = useMutation({
    mutationFn: api.postVerify,
    onSuccess: (d) => {
      const ok = d?.ok ?? (Array.isArray(d?.checks) && d.checks.every((c) => c.ok));
      push(ok ? '検証を実行しました: すべて PASS' : '検証を実行しました: FAIL があります', ok ? 'success' : 'warning');
      invalidateMeta();
    },
    onError: (e) => push(`検証に失敗しました: ${e.message}`, 'danger'),
  });

  const syncM = useMutation({
    mutationFn: () => api.postSync(dumpFile.trim()),
    onSuccess: () => {
      push('取込を記録しました', 'success');
      setDumpFile('');
      invalidateMeta();
    },
    onError: (e) => push(`取込の記録に失敗しました: ${e.message}`, 'danger'),
  });

  const healthOk = healthQ.data?.ok;

  return (
    <div className="space-y-5">
      <Toolbar title="同期・検証" subtitle="分析サーバの接続状態・スナップショット取込・整合性チェック">
        <Button variant="secondary" onClick={() => { healthQ.refetch(); invalidateMeta(); }} loading={healthQ.isFetching}>再読込</Button>
        <Button onClick={() => verifyM.mutate()} loading={verifyM.isPending}>検証を実行</Button>
      </Toolbar>

      <DataBanner />

      <Card
        title="接続状態(health)"
        dense
        actions={healthQ.isLoading ? <Badge>取得中</Badge> : healthQ.isError ? <Badge tone="danger" dot>NG</Badge>
          : typeof healthOk === 'boolean' ? <Badge tone={healthOk ? 'success' : 'danger'} dot>{healthOk ? 'OK' : 'NG'}</Badge> : null}
      >
        {healthQ.isError ? (
          <Alert tone="danger" title="health を取得できません">{healthQ.error?.message}</Alert>
        ) : (
          <HealthBadges data={healthQ.data} />
        )}
      </Card>

      <Card title="スナップショット取込(sync-status)" dense>
        {syncQ.isError ? (
          <Alert tone="danger" title="同期状態を取得できません">{syncQ.error?.message}</Alert>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <dl className="text-sm grid grid-cols-[9rem_1fr] gap-y-1">
              <dt className="text-muted">最終取込</dt><dd className="text-heading">{fmtDateTime(sync?.imported_at)}</dd>
              <dt className="text-muted">ダンプファイル</dt><dd className="text-heading font-mono text-xs break-all">{sync?.dump_file || '—'}</dd>
              <dt className="text-muted">記録 orders</dt><dd className="text-heading tabular-nums">{sync?.orders_count ?? '—'} 件</dd>
              <dt className="text-muted">記録 order_items</dt><dd className="text-heading tabular-nums">{sync?.order_items_count ?? '—'} 件</dd>
              <dt className="text-muted">現在 orders</dt><dd className="text-heading tabular-nums">{sync?.current_orders ?? '—'} 件</dd>
              <dt className="text-muted">現在 order_items</dt><dd className="text-heading tabular-nums">{sync?.current_order_items ?? '—'} 件</dd>
              <dt className="text-muted">最終会計</dt><dd className="text-heading">{fmtDateTime(sync?.current_max_closed_at ?? sync?.max_closed_at)}</dd>
              <dt className="text-muted">整合</dt>
              <dd>{sync ? <Badge tone={sync.drift ? 'warning' : 'success'} dot>{sync.drift ? 'drift(件数不一致)' : '一致'}</Badge> : '—'}</dd>
            </dl>
            <div className="space-y-2">
              <Field label="ダンプファイル名(任意)" htmlFor="dump-file" hint="ana.sh refresh は自動で記録します。手動復元したときはここから記録してください。">
                <Input id="dump-file" value={dumpFile} onChange={(e) => setDumpFile(e.target.value)} placeholder="例: bardb_20260830.dump" />
              </Field>
              <Button variant="secondary" onClick={() => syncM.mutate()} loading={syncM.isPending}>取込を記録</Button>
            </div>
          </div>
        )}
      </Card>

      <Card
        title="検証結果(verify/latest)"
        dense
        actions={verify?.run_at ? <span className="text-xs text-muted">実行: {fmtDateTime(verify.run_at)}</span> : null}
      >
        {verifyQ.isError ? (
          <Alert tone="danger" title="検証結果を取得できません">{verifyQ.error?.message}</Alert>
        ) : (
          <DataTable
            columns={CHECK_COLUMNS}
            rows={verify?.checks || []}
            rowKey={(r, i) => r.check_name || i}
            empty={<div className="py-10 text-center text-sm text-muted">検証は未実行です。「検証を実行」を押してください。</div>}
          />
        )}
      </Card>
    </div>
  );
}
