import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function TableForm({ table, onSave, onCancel, isLoading }) {
  const [form, setForm] = useState({
    name:       table?.name || '',
    table_type: table?.table_type || 'table',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ name: form.name.trim(), table_type: form.table_type }); }} className="space-y-4">
      <div>
        <label className={lbl}>テーブル名</label>
        <input
          className={inp}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="例: テーブル1、カウンターA"
          required
        />
      </div>
      <div>
        <label className={lbl}>種別</label>
        <div className="flex gap-3">
          {[{ value: 'table', label: 'テーブル' }, { value: 'counter', label: 'カウンター' }].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => set('table_type', value)}
              className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                form.table_type === value
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2.5 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors">
          キャンセル
        </button>
        <button type="submit" disabled={isLoading} className="flex-1 py-2.5 bg-primary-500 hover:bg-primary-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50">
          保存
        </button>
      </div>
    </form>
  );
}

export default function TableManager() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editTable, setEditTable] = useState(null);
  const [error, setError] = useState('');

  const { data: tables = [] } = useQuery({ queryKey: ['tables'], queryFn: api.getTables });

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
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });

  const tableRows   = tables.filter((t) => t.table_type === 'table');
  const counterRows = tables.filter((t) => t.table_type === 'counter');

  const statusLabel = (s) => s === 'occupied' ? '使用中' : s === 'closing' ? '会計中' : '空席';
  const statusCls   = (s) => s === 'occupied' ? 'bg-amber-100 text-amber-700' : s === 'closing' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700';

  const TableSection = ({ title, rows, typeLabel, typeCls }) => (
    <div>
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 tracking-wide">{title}</h3>
        <span className="text-xs text-slate-400">({rows.length}件)</span>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-6 py-5 text-sm text-slate-400">登録なし</p>
        ) : (
          rows.map((table, idx) => (
            <div key={table.id} className={`flex items-center gap-4 px-6 py-5 border-b border-slate-50 hover:bg-slate-50 transition-colors ${idx === rows.length - 1 ? 'border-b-0' : ''}`}>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-slate-900">{table.name}</span>
              </div>
              <span className={`${typeCls} text-xs font-semibold px-2.5 py-0.5 rounded-full flex-shrink-0`}>
                {typeLabel}
              </span>
              <span className={`text-xs px-3 py-1.5 rounded-full font-medium flex-shrink-0 ${statusCls(table.status)}`}>
                {statusLabel(table.status)}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { setEditTable(table); setError(''); }}
                  className="w-7 h-7 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 cursor-pointer"
                  title="編集"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button
                  onClick={() => {
                    if (table.status !== 'available') {
                      setError(`「${table.name}」は使用中のため削除できません`);
                      return;
                    }
                    if (confirm(`「${table.name}」を削除しますか？`)) {
                      deleteMutation.mutate(table.id);
                    }
                  }}
                  className="w-7 h-7 flex items-center justify-center border border-red-200 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 cursor-pointer"
                  title="削除"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/>
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-end mb-6">
        <button
          onClick={() => { setAddOpen(true); setError(''); }}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-semibold bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer"
        >
          + テーブル / カウンターを追加
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="space-y-7">
        <TableSection
          title="テーブル"
          rows={tableRows}
          typeLabel="テーブル"
          typeCls="bg-primary-50 text-primary-600"
        />
        <TableSection
          title="カウンター"
          rows={counterRows}
          typeLabel="カウンター"
          typeCls="bg-emerald-50 text-emerald-700"
        />
      </div>

      {/* 追加モーダル */}
      {addOpen && (
        <ModalShell title="テーブル / カウンターを追加" onClose={() => setAddOpen(false)}>
          <TableForm
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setAddOpen(false)}
            isLoading={createMutation.isPending}
          />
        </ModalShell>
      )}

      {/* 編集モーダル */}
      {editTable && (
        <ModalShell title={`「${editTable.name}」を編集`} onClose={() => setEditTable(null)}>
          <TableForm
            table={editTable}
            onSave={(data) => updateMutation.mutate({ id: editTable.id, data })}
            onCancel={() => setEditTable(null)}
            isLoading={updateMutation.isPending}
          />
        </ModalShell>
      )}
    </div>
  );
}
