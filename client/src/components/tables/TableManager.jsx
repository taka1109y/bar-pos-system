import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Button, Modal, Field, Input, Segmented, Alert, Badge, DataTable, Toolbar } from '../ui';

// アイコン(小)
const IconEdit = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
);
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
);

function TableForm({ table, onSave, onCancel, isLoading }) {
  const [form, setForm] = useState({
    name:       table?.name || '',
    table_type: table?.table_type || 'table',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ name: form.name.trim(), table_type: form.table_type }); }} className="space-y-4">
      <Field label="テーブル名" required htmlFor="tbl-name">
        <Input
          id="tbl-name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="例: テーブル1、カウンターA"
          required
        />
      </Field>
      <Field label="種別">
        <Segmented
          className="w-full [&>button]:flex-1"
          value={form.table_type}
          onChange={(v) => set('table_type', v)}
          options={[{ value: 'table', label: 'テーブル' }, { value: 'counter', label: 'カウンター' }]}
        />
      </Field>
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>キャンセル</Button>
        <Button type="submit" loading={isLoading}>保存</Button>
      </div>
    </form>
  );
}

// テーブル状態 → バッジ表現
const STATUS = {
  available: { tone: 'success', label: '空席' },
  occupied:  { tone: 'warning', label: '使用中' },
  closing:   { tone: 'danger',  label: '会計中' },
};

// テーブル/カウンター一覧(モジュールレベル: render 内でコンポーネントを再生成しない)
function TableSection({ title, rows, typeLabel, typeTone, onEdit, onDelete }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-heading tracking-wide">{title}</h3>
        <span className="text-xs text-muted">({rows.length}件)</span>
      </div>
      <DataTable
        rowKey={(t) => t.id}
        empty={<div className="py-6 text-center text-sm text-muted">登録なし</div>}
        columns={[
          { key: 'name', header: '名前', render: (t) => <span className="font-semibold text-heading">{t.name}</span> },
          { key: 'type', header: '種別', width: 120, render: () => <Badge tone={typeTone}>{typeLabel}</Badge> },
          { key: 'status', header: '状態', width: 110, render: (t) => {
            const s = STATUS[t.status] || STATUS.available;
            return <Badge tone={s.tone} dot>{s.label}</Badge>;
          } },
          { key: 'actions', header: '操作', align: 'right', width: 110, render: (t) => (
            <div className="flex items-center gap-1.5 justify-end">
              <Button variant="secondary" size="sm" iconOnly aria-label={`${t.name} を編集`} title="編集" onClick={() => onEdit(t)}>
                <IconEdit />
              </Button>
              <Button variant="secondary" size="sm" iconOnly aria-label={`${t.name} を削除`} title="削除"
                className="text-danger border-red-200 hover:bg-red-50" onClick={() => onDelete(t)}>
                <IconTrash />
              </Button>
            </div>
          ) },
        ]}
        rows={rows}
      />
    </div>
  );
}

export default function TableManager() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editTable, setEditTable] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);

  // 管理画面ではアーカイブ済み（is_active=false）も取得して「アーカイブ済み」セクションに表示する
  const { data: tables = [] } = useQuery({
    queryKey: ['tables', 'manage'],
    queryFn: () => api.getTables({ includeArchived: true }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tables'] });

  const createMutation = useMutation({
    mutationFn: api.createTable,
    onSuccess: () => { invalidate(); setAddOpen(false); setError(''); },
    onError: (e) => setError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateTable(id, data),
    onSuccess: () => { invalidate(); setEditTable(null); setError(''); },
    onError: (e) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteTable,
    onSuccess: (res) => {
      invalidate();
      setError('');
      setNotice(res?.archived
        ? 'テーブルを非表示にしました（売上履歴があるため記録は保持されます）'
        : 'テーブルを削除しました');
    },
    onError: (e) => setError(e.message),
  });

  // アーカイブ済みテーブルを復元する（is_active=true に戻す）
  const restoreMutation = useMutation({
    mutationFn: (id) => api.updateTable(id, { is_active: true }),
    onSuccess: () => { invalidate(); setError(''); setNotice('テーブルを復元しました'); },
    onError: (e) => setError(e.message),
  });

  const activeTables   = tables.filter((t) => t.is_active !== false);
  const archivedTables = tables.filter((t) => t.is_active === false);
  const tableRows   = activeTables.filter((t) => t.table_type === 'table');
  const counterRows = activeTables.filter((t) => t.table_type === 'counter');

  const handleDelete = (table) => {
    if (table.status !== 'available') {
      setError(`「${table.name}」は使用中のため削除できません`);
      return;
    }
    if (confirm(`「${table.name}」を削除しますか？`)) {
      deleteMutation.mutate(table.id);
    }
  };

  const onEdit = (t) => { setEditTable(t); setError(''); };

  return (
    <div className="ui-pad p-4 md:p-6 space-y-4">
      <Toolbar title="テーブル管理" subtitle="テーブル・カウンターの追加・編集・削除">
        <Button onClick={() => { setAddOpen(true); setError(''); }}>
          ＋ テーブル / カウンターを追加
        </Button>
      </Toolbar>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && (
        <Alert tone="success">
          <div className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="閉じる" className="text-emerald-600 hover:text-emerald-800 flex-shrink-0 cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </Alert>
      )}

      <div className="space-y-5">
        <TableSection title="テーブル" rows={tableRows} typeLabel="テーブル" typeTone="info" onEdit={onEdit} onDelete={handleDelete} />
        <TableSection title="カウンター" rows={counterRows} typeLabel="カウンター" typeTone="success" onEdit={onEdit} onDelete={handleDelete} />

        {/* アーカイブ済み（非表示）テーブル。売上履歴があり物理削除できなかったものが入る */}
        {archivedTables.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setArchivedOpen((v) => !v)}
              className="w-full flex items-center justify-between py-1 text-left cursor-pointer"
              aria-expanded={archivedOpen}
            >
              <span className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-muted tracking-wide">アーカイブ済み（非表示）</h3>
                <span className="text-xs text-faint">({archivedTables.length}件)</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   className={`text-faint transition-transform ${archivedOpen ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {archivedOpen && (
              <DataTable
                rowKey={(t) => t.id}
                columns={[
                  { key: 'name', header: '名前', render: (t) => <span className="font-semibold text-muted">{t.name}</span> },
                  { key: 'type', header: '種別', width: 120, render: (t) => <Badge tone="neutral">{t.table_type === 'counter' ? 'カウンター' : 'テーブル'}</Badge> },
                  { key: 'restore', header: '操作', align: 'right', width: 120, render: (t) => (
                    <Button variant="secondary" size="sm" loading={restoreMutation.isPending} onClick={() => restoreMutation.mutate(t.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                      復元
                    </Button>
                  ) },
                ]}
                rows={archivedTables}
              />
            )}
          </div>
        )}
      </div>

      {/* 追加モーダル */}
      {addOpen && (
        <Modal title="テーブル / カウンターを追加" onClose={() => setAddOpen(false)} size="sm">
          <TableForm
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setAddOpen(false)}
            isLoading={createMutation.isPending}
          />
        </Modal>
      )}

      {/* 編集モーダル */}
      {editTable && (
        <Modal title={`「${editTable.name}」を編集`} onClose={() => setEditTable(null)} size="sm">
          <TableForm
            table={editTable}
            onSave={(data) => updateMutation.mutate({ id: editTable.id, data })}
            onCancel={() => setEditTable(null)}
            isLoading={updateMutation.isPending}
          />
        </Modal>
      )}
    </div>
  );
}
