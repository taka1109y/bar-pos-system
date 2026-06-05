import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1';

const REASON_LABELS = { order: '販売', adjustment: '棚卸し調整', purchase: '仕入れ' };
const REASON_COLORS = {
  order:      'bg-blue-50 text-blue-700',
  adjustment: 'bg-amber-50 text-amber-700',
  purchase:   'bg-emerald-50 text-emerald-700',
};

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="px-5 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function IngredientModal({ item, onClose }) {
  const queryClient = useQueryClient();
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: item?.name || '',
    purchase_unit: item?.purchase_unit || '本',
    purchase_quantity: item?.purchase_quantity ?? 700,
    quantity_unit: item?.quantity_unit || 'ml',
    cost_per_purchase_unit: item?.cost_per_purchase_unit ?? 0,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (data) => isEdit ? api.updateIngredient(item.ingredient_id, data) : api.createIngredient(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const handleSave = () => {
    if (!form.name.trim()) return setError('材料名を入力してください');
    if (Number(form.purchase_quantity) <= 0) return setError('容量は0より大きい値を入力してください');
    setError('');
    mutation.mutate(form);
  };

  return (
    <ModalShell title={isEdit ? '材料を編集' : '材料を追加'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={lbl}>材料名 *</label>
          <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="例: ウイスキー角" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>仕入れ単位</label>
            <input type="text" value={form.purchase_unit} onChange={(e) => setForm(f => ({ ...f, purchase_unit: e.target.value }))} className={inp} placeholder="本、缶、袋" />
          </div>
          <div>
            <label className={lbl}>1単位あたりの容量</label>
            <input type="number" min="0.001" step="any" value={form.purchase_quantity} onChange={(e) => setForm(f => ({ ...f, purchase_quantity: e.target.value }))} className={inp} placeholder="700" />
          </div>
        </div>
        <div>
          <label className={lbl}>レシピ使用単位</label>
          <input type="text" value={form.quantity_unit} onChange={(e) => setForm(f => ({ ...f, quantity_unit: e.target.value }))} className={inp} placeholder="ml、g、個" />
          <p className="text-xs text-slate-400 mt-1">レシピで「何ml使うか」を記録する単位</p>
        </div>
        <div>
          <label className={lbl}>1単位あたりの仕入れ値（円）</label>
          <input type="number" min="0" step="1" value={form.cost_per_purchase_unit} onChange={(e) => setForm(f => ({ ...f, cost_per_purchase_unit: e.target.value }))} className={inp} placeholder="1500" />
          {Number(form.purchase_quantity) > 0 && Number(form.cost_per_purchase_unit) > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              1{form.quantity_unit}あたり ¥{(Number(form.cost_per_purchase_unit) / Number(form.purchase_quantity)).toFixed(2)}
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 h-10 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50 transition-colors">キャンセル</button>
          <button onClick={handleSave} disabled={mutation.isPending} className="flex-1 h-10 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {mutation.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function InitModal({ ingredient, onClose }) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(ingredient.quantity_current ?? 0);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.initInventory(ingredient.ingredient_id, { quantity: qty }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventory'] }); onClose(); },
    onError: (e) => setError(e.message),
  });

  return (
    <ModalShell title="在庫初期設定" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-sm font-medium text-slate-900">{ingredient.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{ingredient.purchase_unit} / {ingredient.quantity_unit}単位で管理</p>
        </div>
        <div>
          <label className={lbl}>現在の在庫量（{ingredient.quantity_unit}）</label>
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inp} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-10 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50 transition-colors">キャンセル</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 h-10 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {mutation.isPending ? '保存中...' : '設定'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function PurchaseModal({ ingredients, onClose }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const stockedIngredients = ingredients.filter(i => i.quantity_current != null);

  const mutation = useMutation({
    mutationFn: () => api.addPurchase({ ingredient_id: Number(selectedId), quantity: Number(qty), note: note || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-logs'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const handleSave = () => {
    if (!selectedId) return setError('材料を選択してください');
    if (!qty || Number(qty) <= 0) return setError('数量を入力してください');
    setError('');
    mutation.mutate();
  };

  const selected = stockedIngredients.find(i => i.ingredient_id === Number(selectedId));

  return (
    <ModalShell title="仕入れ入力" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={lbl}>材料 *</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={inp}>
            <option value="">選択してください</option>
            {stockedIngredients.map(i => (
              <option key={i.ingredient_id} value={i.ingredient_id}>{i.name}（現在: {i.quantity_current ?? 0}{i.quantity_unit}）</option>
            ))}
          </select>
          {stockedIngredients.length === 0 && <p className="text-xs text-amber-600 mt-1">在庫設定済みの材料がありません。先に「材料在庫」タブで初期設定してください。</p>}
        </div>
        <div>
          <label className={lbl}>入庫数量（{selected?.quantity_unit || '単位'}）*</label>
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inp} placeholder="例: 700（ml）または 1（本）" />
          {selected && qty && Number(qty) > 0 && (
            <p className="text-xs text-emerald-600 mt-1">入庫後: {(Number(selected.quantity_current) + Number(qty)).toFixed(1)}{selected.quantity_unit}</p>
          )}
        </div>
        <div>
          <label className={lbl}>メモ（任意）</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inp} placeholder="例: 〇〇酒店から仕入れ" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-10 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50 transition-colors">キャンセル</button>
          <button onClick={handleSave} disabled={mutation.isPending} className="flex-1 h-10 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {mutation.isPending ? '処理中...' : '仕入れ入力'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('stock');
  const [adjustInputs, setAdjustInputs] = useState({});
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [initTarget, setInitTarget] = useState(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [ingredientModal, setIngredientModal] = useState(null);

  const { data: inventory = [], isLoading: invLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: api.getInventory,
    refetchInterval: 30_000,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['inventory-logs'],
    queryFn: () => api.getInventoryLogs({ limit: 200 }),
    enabled: tab === 'logs',
  });

  const managed   = inventory.filter(i => i.quantity_current != null);
  const unmanaged = inventory.filter(i => i.quantity_current == null);

  const adjustMutation = useMutation({
    mutationFn: (adjustments) => api.adjustInventory(adjustments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-logs'] });
      setAdjustInputs({});
      setAdjusting(false);
      setAdjustError('');
    },
    onError: (e) => { setAdjustError(e.message); setAdjusting(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteIngredient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['ingredients'] });
    },
  });

  const handleAdjust = () => {
    const adjustments = Object.entries(adjustInputs)
      .filter(([, v]) => v !== '' && v != null)
      .map(([ingredient_id, actual_quantity]) => ({
        ingredient_id: Number(ingredient_id),
        actual_quantity: Number(actual_quantity),
      }));
    if (adjustments.length === 0) return setAdjustError('実在庫を入力してください');
    setAdjusting(true);
    setAdjustError('');
    adjustMutation.mutate(adjustments);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">在庫管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">材料の在庫状況と仕入れ記録</p>
        </div>
        <button
          onClick={() => setPurchaseOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          仕入れ入力
        </button>
      </div>

      <div className="flex border-b border-slate-200 mb-6 gap-4">
        {[['stock', '材料在庫'], ['master', '材料マスター'], ['logs', '異動ログ']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === id ? 'border-primary-500 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <div className="space-y-6">
          {invLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">読み込み中...</div>
          ) : (
            <>
              {managed.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-700">在庫設定済み ({managed.length}件)</h2>
                    <p className="text-xs text-slate-400">「実在庫」欄に実際の数量を入力して棚卸しを実施</p>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200 bg-gray-50">
                          <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">材料</th>
                          <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">理論在庫</th>
                          <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">実在庫入力</th>
                          <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">最終更新</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managed.map((item, idx) => (
                          <tr key={item.ingredient_id} className={`hover:bg-gray-50 ${idx < managed.length - 1 ? 'border-b border-slate-100' : ''}`}>
                            <td className="py-3 px-4">
                              <p className="text-sm font-medium text-slate-900">{item.name}</p>
                              <p className="text-xs text-slate-400">{item.purchase_unit} / {item.quantity_unit}単位</p>
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-700 text-right font-mono">
                              {item.quantity_current?.toFixed(1)} <span className="text-xs text-slate-400">{item.quantity_unit}</span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1 justify-end">
                                <input
                                  type="number" min="0" step="any" placeholder="実在庫"
                                  value={adjustInputs[item.ingredient_id] ?? ''}
                                  onChange={(e) => setAdjustInputs(prev => ({ ...prev, [item.ingredient_id]: e.target.value }))}
                                  className="w-24 border border-slate-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500"
                                />
                                <span className="text-xs text-slate-400">{item.quantity_unit}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-400 text-right">
                              {item.last_updated ? new Date(item.last_updated).toLocaleDateString('ja-JP') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    {adjustError && <p className="text-sm text-red-600">{adjustError}</p>}
                    <div className="ml-auto">
                      <button
                        onClick={handleAdjust}
                        disabled={adjusting || Object.keys(adjustInputs).filter(k => adjustInputs[k] !== '').length === 0}
                        className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        棚卸し実施
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {unmanaged.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">在庫未設定 ({unmanaged.length}件)</h2>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200 bg-gray-50">
                          <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">材料</th>
                          <th scope="col" className="py-2.5 px-4" />
                        </tr>
                      </thead>
                      <tbody>
                        {unmanaged.map((item, idx) => (
                          <tr key={item.ingredient_id} className={idx < unmanaged.length - 1 ? 'border-b border-slate-100' : ''}>
                            <td className="py-3 px-4">
                              <p className="text-sm text-slate-900">{item.name}</p>
                              <p className="text-xs text-slate-400">{item.quantity_unit}単位 / 仕入れ値 ¥{item.cost_per_purchase_unit}/{item.purchase_unit}</p>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button onClick={() => setInitTarget(item)} className="h-7 px-3 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
                                在庫設定
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {managed.length === 0 && unmanaged.length === 0 && (
                <div className="text-center py-16 text-slate-400">
                  <p className="text-sm">材料が登録されていません</p>
                  <p className="text-xs mt-1">「材料マスター」タブから材料を追加してください</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'master' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">{inventory.length}件</p>
            <button
              onClick={() => setIngredientModal({})}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              材料を追加
            </button>
          </div>
          {invLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">読み込み中...</div>
          ) : inventory.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">材料が登録されていません</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-gray-50">
                    <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">材料名</th>
                    <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">仕入れ単位</th>
                    <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">容量</th>
                    <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">仕入れ値</th>
                    <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">単位原価</th>
                    <th scope="col" className="py-2.5 px-4 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item, idx) => {
                    const unitCost = item.purchase_quantity > 0
                      ? (item.cost_per_purchase_unit / item.purchase_quantity).toFixed(2) : '-';
                    return (
                      <tr key={item.ingredient_id} className={`hover:bg-gray-50 ${idx < inventory.length - 1 ? 'border-b border-slate-100' : ''}`}>
                        <td className="py-3 px-4 text-sm font-medium text-slate-900">{item.name}</td>
                        <td className="py-3 px-4 text-sm text-slate-600 text-right">{item.purchase_unit}</td>
                        <td className="py-3 px-4 text-sm text-slate-600 text-right">{item.purchase_quantity}{item.quantity_unit}</td>
                        <td className="py-3 px-4 text-sm text-slate-600 text-right">¥{item.cost_per_purchase_unit?.toLocaleString()}</td>
                        <td className="py-3 px-4 text-sm text-amber-600 text-right">¥{unitCost}/{item.quantity_unit}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setIngredientModal(item)} className="w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors" aria-label="編集">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button
                              onClick={() => { if (window.confirm(`「${item.name}」を削除しますか？`)) deleteMutation.mutate(item.ingredient_id); }}
                              className="w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors" aria-label="削除"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div>
          {logsLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">読み込み中...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">異動ログがありません</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-gray-50">
                    <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">日時</th>
                    <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">材料</th>
                    <th scope="col" className="text-center py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">種別</th>
                    <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">変動</th>
                    <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">在庫後</th>
                    <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, idx) => (
                    <tr key={log.id} className={`hover:bg-gray-50 ${idx < logs.length - 1 ? 'border-b border-slate-100' : ''}`}>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {new Date(log.log_date).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-900">{log.ingredient_name}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${REASON_COLORS[log.reason] || 'bg-slate-100 text-slate-600'}`}>
                          {REASON_LABELS[log.reason] || log.reason}
                        </span>
                      </td>
                      <td className={`py-3 px-4 text-sm text-right font-mono ${log.quantity_change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {log.quantity_change >= 0 ? '+' : ''}{log.quantity_change?.toFixed(1)} {log.quantity_unit}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-700 text-right font-mono">
                        {log.quantity_after?.toFixed(1)} {log.quantity_unit}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-400">{log.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {initTarget && <InitModal ingredient={initTarget} onClose={() => setInitTarget(null)} />}
      {purchaseOpen && <PurchaseModal ingredients={inventory} onClose={() => setPurchaseOpen(false)} />}
      {ingredientModal !== null && (
        <IngredientModal
          item={ingredientModal.ingredient_id ? ingredientModal : null}
          onClose={() => setIngredientModal(null)}
        />
      )}
    </div>
  );
}
