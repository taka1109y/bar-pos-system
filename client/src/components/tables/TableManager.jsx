import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 border border-gray-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
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

  const inp = 'w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors';
  const lbl = 'block text-xs font-medium text-gray-600 mb-1.5';

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
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2.5 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
          キャンセル
        </button>
        <button type="submit" disabled={isLoading} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50">
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

  const TableSection = ({ title, rows }) => (
    <div>
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-200">
        <h3 className="text-sm font-bold text-gray-700 tracking-wide">{title}</h3>
        <span className="text-xs text-gray-400">({rows.length}件)</span>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {rows.length === 0 ? (
          <p className="px-6 py-5 text-sm text-gray-400">登録なし</p>
        ) : (
          rows.map((table, idx) => (
            <div key={table.id} className={`flex items-center gap-4 px-6 py-5 ${idx !== 0 ? 'border-t border-gray-100' : ''}`}>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-900">{table.name}</span>
              </div>
              <span className={`text-xs px-3 py-1.5 rounded-full font-medium flex-shrink-0 ${statusCls(table.status)}`}>
                {statusLabel(table.status)}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { setEditTable(table); setError(''); }}
                  className="px-3.5 py-2 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
                >
                  編集
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
                  className="px-3.5 py-2 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
                >
                  削除
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
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
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
        <TableSection title="テーブル" rows={tableRows} />
        <TableSection title="カウンター" rows={counterRows} />
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
