import { useState } from 'react';
import { yen, num } from '../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Modal, Field, Input, Select, DataTable, Badge, Tabs, Toolbar, Alert, StatTile } from '../components/ui';

const REASON = {
  order:      { label: '販売',       tone: 'info' },
  adjustment: { label: '棚卸し調整', tone: 'warning' },
  purchase:   { label: '仕入れ',     tone: 'success' },
};

const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
);
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
);

// ─── 材料マスター 追加/編集モーダル ───
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
    <Modal title={isEdit ? '材料を編集' : '材料を追加'} size="sm" onClose={onClose}>
      <div className="space-y-3">
        <Field label="材料名" required><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例: ウイスキー角" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="仕入れ単位"><Input value={form.purchase_unit} onChange={(e) => setForm(f => ({ ...f, purchase_unit: e.target.value }))} placeholder="本、缶、袋" /></Field>
          <Field label="1単位あたりの容量"><Input type="number" min="0.001" step="any" value={form.purchase_quantity} onChange={(e) => setForm(f => ({ ...f, purchase_quantity: e.target.value }))} placeholder="700" /></Field>
        </div>
        <Field label="レシピ使用単位" hint="レシピで「何ml使うか」を記録する単位"><Input value={form.quantity_unit} onChange={(e) => setForm(f => ({ ...f, quantity_unit: e.target.value }))} placeholder="ml、g、個" /></Field>
        <Field label="1単位あたりの仕入れ値（円）">
          <Input type="number" min="0" step="1" prefix="¥" value={form.cost_per_purchase_unit} onChange={(e) => setForm(f => ({ ...f, cost_per_purchase_unit: e.target.value }))} placeholder="1500" />
          {Number(form.purchase_quantity) > 0 && Number(form.cost_per_purchase_unit) > 0 && (
            <p className="text-xs text-amber-600 mt-1">1{form.quantity_unit}あたり ¥{num((Number(form.cost_per_purchase_unit) / Number(form.purchase_quantity)), 2)}</p>
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button loading={mutation.isPending} onClick={handleSave}>保存</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── 在庫初期設定モーダル ───
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
    <Modal title="在庫初期設定" size="sm" onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-surface-sunken rounded-lg p-3">
          <p className="text-sm font-medium text-heading">{ingredient.name}</p>
          <p className="text-xs text-muted mt-0.5">{ingredient.purchase_unit} / {ingredient.quantity_unit}単位で管理</p>
        </div>
        <Field label={`現在の在庫量（${ingredient.quantity_unit}）`}><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>設定</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── 仕入れ入力モーダル ───
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
    <Modal title="仕入れ入力" size="sm" onClose={onClose}>
      <div className="space-y-3">
        <Field label="材料" required>
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">選択してください</option>
            {stockedIngredients.map(i => <option key={i.ingredient_id} value={i.ingredient_id}>{i.name}（現在: {i.quantity_current ?? 0}{i.quantity_unit}）</option>)}
          </Select>
          {stockedIngredients.length === 0 && <p className="text-xs text-amber-600 mt-1">在庫設定済みの材料がありません。先に「材料在庫」タブで初期設定してください。</p>}
        </Field>
        <Field label={`入庫数量（${selected?.quantity_unit || '単位'}）`} required>
          <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="例: 700（ml）または 1（本）" />
          {selected && qty && Number(qty) > 0 && <p className="text-xs text-emerald-600 mt-1">入庫後: {num((Number(selected.quantity_current) + Number(qty)), 1)}{selected.quantity_unit}</p>}
        </Field>
        <Field label="メモ（任意）"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 〇〇酒店から仕入れ" /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button variant="success" loading={mutation.isPending} onClick={handleSave}>仕入れ入力</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── 在庫評価タブ(原価分析から移設。['inventory'] 同源) ───
function StockValuationTab({ inventory, isLoading }) {
  const rows = (inventory ?? [])
    .filter(r => r.quantity_current != null)
    .map(r => ({
      ...r,
      unit_cost: r.purchase_quantity > 0 ? r.cost_per_purchase_unit / r.purchase_quantity : 0,
      valuation: r.quantity_current > 0 && r.purchase_quantity > 0 ? r.quantity_current * r.cost_per_purchase_unit / r.purchase_quantity : 0,
    }))
    .sort((a, b) => b.valuation - a.valuation);
  const totalValuation = rows.reduce((sum, r) => sum + r.valuation, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatTile label="在庫評価額合計" value={`¥${yen(Math.round(totalValuation))}`} />
        <StatTile label="管理材料数" value={`${rows.length} 種`} />
        <Alert tone="warning" title="計算式">現在在庫量 × (仕入れ値 ÷ 仕入れ容量)</Alert>
      </div>
      <DataTable
        rowKey={(r) => r.ingredient_id}
        empty={<div className="py-12 text-center text-sm text-muted">{isLoading ? '読み込み中...' : '在庫設定済みの材料がありません'}</div>}
        columns={[
          { key: 'name', header: '材料名', render: (r) => <span className="font-medium text-heading">{r.name}</span> },
          { key: 'stock', header: '現在在庫', align: 'right', render: (r) => `${yen(r.quantity_current)}${r.quantity_unit}` },
          { key: 'unit', header: '単価(/単位)', align: 'right', render: (r) => `¥${num(r.unit_cost, 4)}/${r.quantity_unit}` },
          { key: 'val', header: '評価額', align: 'right', render: (r) => <span className="font-semibold text-heading">¥{yen(Math.round(r.valuation))}</span> },
          { key: 'conv', header: '仕入れ換算', align: 'right', render: (r) => `${r.purchase_quantity > 0 ? num((r.quantity_current / r.purchase_quantity), 2) : '—'}${r.purchase_unit}` },
        ]}
        rows={rows}
      />
    </div>
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
      .map(([ingredient_id, actual_quantity]) => ({ ingredient_id: Number(ingredient_id), actual_quantity: Number(actual_quantity) }));
    if (adjustments.length === 0) return setAdjustError('実在庫を入力してください');
    setAdjusting(true);
    setAdjustError('');
    adjustMutation.mutate(adjustments);
  };

  const hasAdjustInput = Object.keys(adjustInputs).filter(k => adjustInputs[k] !== '').length > 0;

  return (
    <div className="ui-pad p-4 md:p-6 space-y-4">
      <Toolbar title="在庫管理" subtitle="材料の在庫状況と仕入れ記録">
        <Button variant="success" onClick={() => setPurchaseOpen(true)}>＋ 仕入れ入力</Button>
      </Toolbar>

      <Tabs
        activeId={tab}
        onChange={setTab}
        tabs={[{ id: 'stock', label: '材料在庫' }, { id: 'master', label: '材料マスター' }, { id: 'logs', label: '異動ログ' }, { id: 'valuation', label: '在庫評価' }]}
      />

      {tab === 'stock' && (
        <div className="space-y-5">
          {invLoading ? (
            <div className="text-sm text-muted py-8 text-center">読み込み中...</div>
          ) : (
            <>
              {managed.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-heading">在庫設定済み ({managed.length}件)</h2>
                    <p className="text-xs text-muted">「実在庫」欄に実際の数量を入力して棚卸しを実施</p>
                  </div>
                  <DataTable
                    rowKey={(i) => i.ingredient_id}
                    columns={[
                      { key: 'name', header: '材料', render: (i) => (<div><p className="text-sm font-medium text-heading">{i.name}</p><p className="text-2xs text-muted">{i.purchase_unit} / {i.quantity_unit}単位</p></div>) },
                      { key: 'theory', header: '理論在庫', align: 'right', render: (i) => <span className="font-mono">{i.quantity_current?.toFixed(1)} <span className="text-2xs text-muted">{i.quantity_unit}</span></span> },
                      { key: 'input', header: '実在庫入力', align: 'right', render: (i) => (
                        <div className="flex items-center gap-1 justify-end">
                          <Input size="sm" type="number" min="0" step="any" placeholder="実在庫" className="w-24 text-right"
                            value={adjustInputs[i.ingredient_id] ?? ''}
                            onChange={(e) => setAdjustInputs(prev => ({ ...prev, [i.ingredient_id]: e.target.value }))} />
                          <span className="text-2xs text-muted">{i.quantity_unit}</span>
                        </div>
                      ) },
                      { key: 'updated', header: '最終更新', align: 'right', render: (i) => <span className="text-2xs text-muted">{i.last_updated ? new Date(i.last_updated).toLocaleDateString('ja-JP') : '-'}</span> },
                    ]}
                    rows={managed}
                  />
                  <div className="flex items-center justify-between">
                    {adjustError && <p className="text-sm text-danger">{adjustError}</p>}
                    <div className="ml-auto">
                      <button onClick={handleAdjust} disabled={adjusting || !hasAdjustInput}
                        className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                        棚卸し実施
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {unmanaged.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-heading">在庫未設定 ({unmanaged.length}件)</h2>
                  <DataTable
                    rowKey={(i) => i.ingredient_id}
                    columns={[
                      { key: 'name', header: '材料', render: (i) => (<div><p className="text-sm text-heading">{i.name}</p><p className="text-2xs text-muted">{i.quantity_unit}単位 / 仕入れ値 ¥{i.cost_per_purchase_unit}/{i.purchase_unit}</p></div>) },
                      { key: 'act', header: '', align: 'right', width: 100, render: (i) => <Button variant="secondary" size="sm" onClick={() => setInitTarget(i)}>在庫設定</Button> },
                    ]}
                    rows={unmanaged}
                  />
                </div>
              )}

              {managed.length === 0 && unmanaged.length === 0 && (
                <div className="text-center py-16 text-muted">
                  <p className="text-sm">材料が登録されていません</p>
                  <p className="text-xs mt-1">「材料マスター」タブから材料を追加してください</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'master' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">{inventory.length}件</p>
            <Button size="sm" onClick={() => setIngredientModal({})}>＋ 材料を追加</Button>
          </div>
          {invLoading ? (
            <div className="text-sm text-muted py-8 text-center">読み込み中...</div>
          ) : (
            <DataTable
              rowKey={(i) => i.ingredient_id}
              empty={<div className="py-12 text-center text-sm text-muted">材料が登録されていません</div>}
              columns={[
                { key: 'name', header: '材料名', render: (i) => <span className="font-medium text-heading">{i.name}</span> },
                { key: 'pu', header: '仕入れ単位', align: 'right', render: (i) => i.purchase_unit },
                { key: 'cap', header: '容量', align: 'right', render: (i) => `${i.purchase_quantity}${i.quantity_unit}` },
                { key: 'cost', header: '仕入れ値', align: 'right', render: (i) => `¥${yen(i.cost_per_purchase_unit)}` },
                { key: 'unit', header: '単位原価', align: 'right', render: (i) => <span className="text-amber-600">¥{i.purchase_quantity > 0 ? num((i.cost_per_purchase_unit / i.purchase_quantity), 2) : '-'}/{i.quantity_unit}</span> },
                { key: 'act', header: '', align: 'right', width: 90, render: (i) => (
                  <div className="flex items-center justify-end gap-1.5">
                    <Button variant="secondary" size="sm" iconOnly aria-label={`${i.name} を編集`} title="編集" onClick={() => setIngredientModal(i)}><IconEdit /></Button>
                    <Button variant="secondary" size="sm" iconOnly aria-label={`${i.name} を削除`} title="削除" className="text-danger border-red-200 hover:bg-red-50"
                      onClick={() => { if (window.confirm(`「${i.name}」を削除しますか？`)) deleteMutation.mutate(i.ingredient_id); }}><IconTrash /></Button>
                  </div>
                ) },
              ]}
              rows={inventory}
            />
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div>
          {logsLoading ? (
            <div className="text-sm text-muted py-8 text-center">読み込み中...</div>
          ) : (
            <DataTable
              rowKey={(l) => l.id}
              empty={<div className="py-12 text-center text-sm text-muted">異動ログがありません</div>}
              columns={[
                { key: 'date', header: '日時', render: (l) => <span className="text-2xs text-muted">{new Date(l.log_date).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> },
                { key: 'name', header: '材料', render: (l) => l.ingredient_name },
                { key: 'reason', header: '種別', align: 'center', render: (l) => { const r = REASON[l.reason] || { label: l.reason, tone: 'neutral' }; return <Badge tone={r.tone}>{r.label}</Badge>; } },
                { key: 'change', header: '変動', align: 'right', render: (l) => <span className={`font-mono ${l.quantity_change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{l.quantity_change >= 0 ? '+' : ''}{l.quantity_change?.toFixed(1)} {l.quantity_unit}</span> },
                { key: 'after', header: '在庫後', align: 'right', render: (l) => <span className="font-mono">{l.quantity_after?.toFixed(1)} {l.quantity_unit}</span> },
                { key: 'note', header: 'メモ', render: (l) => <span className="text-2xs text-muted">{l.note || '-'}</span> },
              ]}
              rows={logs}
            />
          )}
        </div>
      )}

      {tab === 'valuation' && <StockValuationTab inventory={inventory} isLoading={invLoading} />}

      {initTarget && <InitModal ingredient={initTarget} onClose={() => setInitTarget(null)} />}
      {purchaseOpen && <PurchaseModal ingredients={inventory} onClose={() => setPurchaseOpen(false)} />}
      {ingredientModal !== null && (
        <IngredientModal item={ingredientModal.ingredient_id ? ingredientModal : null} onClose={() => setIngredientModal(null)} />
      )}
    </div>
  );
}
