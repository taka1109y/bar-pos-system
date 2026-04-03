import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className={`bg-white rounded-2xl shadow-2xl w-full mx-4 border border-gray-100 max-h-[90vh] flex flex-col ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ─── フォームコンポーネント ───────────────────────────
function MenuItemForm({ item, categories, subcategories, onSave, onCancel, isLoading }) {
  const [form, setForm] = useState({
    name:            item?.name || '',
    category_id:     item?.category_id || categories[0]?.id || '',
    subcategory_id:  item?.subcategory_id || '',
    base_price:      item?.base_price || '',
    min_price:       item?.min_price || '',
    max_price:       item?.max_price || '',
    price_step_up:   item?.price_step_up ?? 50,
    price_step_down: item?.price_step_down ?? 25,
    is_drink:        item?.is_drink ?? 1,
    is_active:       item?.is_active ?? 1,
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleCategoryChange = (catId) => {
    set('category_id', catId);
    set('subcategory_id', '');
  };

  const filteredSubcats = subcategories.filter(
    (s) => String(s.category_id) === String(form.category_id)
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      category_id:     Number(form.category_id),
      subcategory_id:  form.subcategory_id ? Number(form.subcategory_id) : null,
      base_price:      Number(form.base_price),
      min_price:       Number(form.min_price) || Number(form.base_price) * 0.7,
      max_price:       Number(form.max_price) || Number(form.base_price) * 2.0,
      price_step_up:   Number(form.price_step_up),
      price_step_down: Number(form.price_step_down),
      is_drink:        Number(form.is_drink),
      is_active:       Number(form.is_active),
    });
  };

  const inp = 'w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors';
  const lbl = 'block text-xs font-medium text-gray-600 mb-1.5';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={lbl}>商品名</label>
        <input
          className={inp}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="例: スーパードライ"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>カテゴリ</label>
          <select className={inp} value={form.category_id} onChange={(e) => handleCategoryChange(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>サブカテゴリ</label>
          <select className={inp} value={form.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)}>
            <option value="">なし（価格競合なし）</option>
            {filteredSubcats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={lbl}>基準価格</label>
          <input className={inp} type="number" value={form.base_price} onChange={(e) => set('base_price', e.target.value)} placeholder="500" required min={0} />
        </div>
        <div>
          <label className={lbl}>下限価格</label>
          <input className={inp} type="number" value={form.min_price} onChange={(e) => set('min_price', e.target.value)} placeholder="自動" min={0} />
        </div>
        <div>
          <label className={lbl}>上限価格</label>
          <input className={inp} type="number" value={form.max_price} onChange={(e) => set('max_price', e.target.value)} placeholder="自動" min={0} />
        </div>
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={Boolean(form.is_drink)} onChange={(e) => set('is_drink', e.target.checked ? 1 : 0)} className="w-4 h-4 accent-indigo-600 rounded" />
          ドリンク（価格変動対象）
        </label>
        {item && (
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => set('is_active', e.target.checked ? 1 : 0)} className="w-4 h-4 accent-indigo-600 rounded" />
            有効
          </label>
        )}
      </div>
      {Boolean(form.is_drink) && (
        <div className="grid grid-cols-2 gap-3 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
          <div>
            <label className={lbl}>1注文あたり上昇額 (¥)</label>
            <input className={inp} type="number" value={form.price_step_up} onChange={(e) => set('price_step_up', e.target.value)} placeholder="50" min={1} step={1} />
          </div>
          <div>
            <label className={lbl}>1競合注文あたり降下額 (¥)</label>
            <input className={inp} type="number" value={form.price_step_down} onChange={(e) => set('price_step_down', e.target.value)} placeholder="25" min={1} step={1} />
          </div>
        </div>
      )}
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

// ─── メインコンポーネント ────────────────────────────
export default function MenuManager() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const { data: items         = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });
  const { data: categories    = [] } = useQuery({ queryKey: ['categories'],    queryFn: api.getCategories });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['menu-all'] });

  const createMutation = useMutation({ mutationFn: api.createMenuItem, onSuccess: () => { invalidate(); setAddOpen(false); } });
  const updateMutation = useMutation({ mutationFn: ({ id, data }) => api.updateMenuItem(id, data), onSuccess: () => { invalidate(); setEditItem(null); } });
  const deleteMutation = useMutation({ mutationFn: api.deleteMenuItem, onSuccess: invalidate });

  const grouped = categories.reduce((acc, cat) => {
    acc[cat.id] = { ...cat, items: items.filter((i) => i.category_id === cat.id) };
    return acc;
  }, {});

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-end mb-6">
        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
        >
          + 商品を追加
        </button>
      </div>

      {/* カテゴリ別商品一覧 */}
      <div className="space-y-10">
        {Object.values(grouped).map((cat) => (
          <div key={cat.id}>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-700 tracking-wide">{cat.name}</h3>
              <span className="text-xs text-gray-400">({cat.items.length}件)</span>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              {cat.items.length === 0 ? (
                <p className="px-6 py-5 text-sm text-gray-400">商品がありません</p>
              ) : (
                cat.items.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 px-6 py-5 ${item.is_active ? '' : 'opacity-40'} ${idx !== 0 ? 'border-t border-gray-100' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-gray-900 block truncate">{item.name}</span>
                      <span className="text-xs text-gray-400 mt-1 block">
                        ¥{item.base_price.toLocaleString()}
                        {item.subcategory_name && (
                          <span className="ml-2 text-indigo-400">{item.subcategory_name}</span>
                        )}
                      </span>
                    </div>
                    <span className={`text-xs px-3 py-1.5 rounded-full font-medium flex-shrink-0 ${
                      item.is_drink ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.is_drink ? 'ドリンク' : 'フード'}
                    </span>
                    {!item.is_active && (
                      <span className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-400 flex-shrink-0">
                        無効
                      </span>
                    )}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setEditItem(item)}
                        className="px-3.5 py-2 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => { if (confirm(`「${item.name}」を削除しますか？`)) deleteMutation.mutate(item.id); }}
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
        ))}
      </div>

      {/* 追加モーダル */}
      {addOpen && categories.length > 0 && (
        <ModalShell title="商品を追加" onClose={() => setAddOpen(false)} wide>
          <MenuItemForm
            categories={categories}
            subcategories={subcategories}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setAddOpen(false)}
            isLoading={createMutation.isPending}
          />
        </ModalShell>
      )}

      {/* 編集モーダル */}
      {editItem && (
        <ModalShell title={`「${editItem.name}」を編集`} onClose={() => setEditItem(null)} wide>
          <MenuItemForm
            item={editItem}
            categories={categories}
            subcategories={subcategories}
            onSave={(data) => updateMutation.mutate({ id: editItem.id, data })}
            onCancel={() => setEditItem(null)}
            isLoading={updateMutation.isPending}
          />
        </ModalShell>
      )}
    </div>
  );
}
