import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Toolbar, Card, Alert, Badge, Button, Input, DataTable, Skeleton } from '../components/ui';
import { api } from '../api';
import { useToastStore } from '../store/useToastStore';

// 席数入力(/inputs/seats)。bardb の卓一覧に analyticsdb.seat_capacities(席数・稼働率分母)を
// 重ねて表示し、一括保存(PUT /api/v1/seat-capacities)する。
// 席数を空欄で保存すると未設定に戻る(席稼働・回転ページでは warning 表示になる)。

const TYPE_LABELS = { table: 'テーブル', counter: 'カウンター', immediate: '即会計' };

const MAX_SEATS = 1000;

export default function InputsSeatsPage() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [draft, setDraft] = useState({}); // table_id -> { seats: string, include: bool }

  const seatsQ = useQuery({ queryKey: ['v1', 'seat-capacities'], queryFn: api.getSeatCapacities });
  const rows = seatsQ.data?.rows || [];

  // 取得(保存後の再取得含む)のたびにサーバ値からドラフトを作り直す
  useEffect(() => {
    const next = {};
    for (const r of seatsQ.data?.rows || []) {
      next[r.table_id] = {
        seats: r.seats == null ? '' : String(r.seats),
        include: r.include_in_utilization ?? true,
      };
    }
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatsQ.dataUpdatedAt]);

  const seatsInvalid = (tableId) => {
    const s = String(draft[tableId]?.seats ?? '').trim();
    if (s === '') return false; // 空欄 = 未設定に戻す(有効)
    const n = Number(s);
    return !(Number.isInteger(n) && n >= 0 && n <= MAX_SEATS);
  };
  const hasInvalid = rows.some((r) => seatsInvalid(r.table_id));

  const saveM = useMutation({
    mutationFn: () => api.putSeatCapacities(rows.map((r) => {
      const d = draft[r.table_id] || {};
      const s = String(d.seats ?? '').trim();
      return {
        table_id: r.table_id,
        seats: s === '' ? null : Number(s),
        include_in_utilization: d.include ?? true,
      };
    })),
    onSuccess: () => {
      push('席数を保存しました', 'success');
      qc.invalidateQueries({ queryKey: ['v1', 'seat-capacities'] });
      qc.invalidateQueries({ queryKey: ['v1', 'seats'] }); // 席稼働・回転の再計算
    },
    onError: (e) => push(`保存に失敗しました: ${e.message}`, 'danger'),
  });

  const COLUMNS = [
    {
      key: 'table_name', header: '卓名',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-heading font-medium">{r.table_name}</span>
          {!r.is_active && <Badge size="sm">無効</Badge>}
        </span>
      ),
    },
    {
      key: 'table_type', header: '種別', width: 110,
      render: (r) => <Badge tone={r.table_type === 'immediate' ? 'warning' : 'neutral'}>{TYPE_LABELS[r.table_type] || r.table_type}</Badge>,
    },
    {
      key: 'seats', header: '席数', width: 120,
      render: (r) => (
        <Input
          size="sm"
          type="number"
          min={0}
          max={MAX_SEATS}
          className="w-24"
          value={draft[r.table_id]?.seats ?? ''}
          invalid={seatsInvalid(r.table_id)}
          placeholder="未設定"
          aria-label={`${r.table_name} の席数`}
          onChange={(e) => setDraft((d) => ({ ...d, [r.table_id]: { ...d[r.table_id], seats: e.target.value } }))}
        />
      ),
    },
    {
      key: 'include', header: '稼働率分母', align: 'center', width: 100,
      render: (r) => (
        <input
          type="checkbox"
          className="w-4 h-4 accent-primary-500 cursor-pointer align-middle"
          checked={draft[r.table_id]?.include ?? true}
          aria-label={`${r.table_name} を席稼働率の分母に含める`}
          onChange={(e) => setDraft((d) => ({ ...d, [r.table_id]: { ...d[r.table_id], include: e.target.checked } }))}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Toolbar title="席数" subtitle="卓ごとの席数と、席稼働率の分母に含めるかを設定する">
        <Button onClick={() => saveM.mutate()} disabled={hasInvalid || rows.length === 0} loading={saveM.isPending}>一括保存</Button>
      </Toolbar>

      {hasInvalid && <Alert tone="warning">席数は 0〜{MAX_SEATS} の整数か空欄(未設定)で入力してください。</Alert>}

      <Card title="卓別の席数" padded={false}>
        {seatsQ.isError ? (
          <div className="p-3">
            <Alert tone="danger" title="卓一覧を取得できません">{seatsQ.error?.message}</Alert>
          </div>
        ) : seatsQ.isLoading ? (
          <div className="p-3"><Skeleton height={240} /></div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.table_id}
            className="border-0 rounded-none"
            empty={<div className="py-10 text-center text-sm text-muted">卓がありません(POS 本体のテーブル管理で作成してください)。</div>}
          />
        )}
      </Card>

      <p className="text-2xs text-muted">
        席数が未設定の卓は「席稼働・回転」ページで稼働率を計算できず警告表示になります。空欄のまま保存すると未設定に戻ります。
        即会計テーブルは滞在・稼働の集計から除外されるため、通常は分母から外してください。
      </p>
    </div>
  );
}
