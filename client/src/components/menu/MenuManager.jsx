import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

// ─── フォームコンポーネント ───────────────────────────
function MenuItemForm({ item, categories, subcategories, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: item?.name || '',
    category_id: item?.category_id || categories[0]?.id || '',
    subcategory_id: item?.subcategory_id || '',
    base_price: item?.base_price || '',
    min_price: item?.min_price || '',
    max_price: item?.max_price || '',
    is_drink: item?.is_drink ?? 1,
    is_active: item?.is_active ?? 1,
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // カテゴリ変更時はサブカテゴリをリセット
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
      category_id: Number(form.category_id),
      subcategory_id: form.subcategory_id ? Number(form.subcategory_id) : null,
      base_price: Number(form.base_price),
      min_price: Number(form.min_price) || Number(form.base_price) * 0.7,
      max_price: Number(form.max_price) || Number(form.base_price) * 2.0,
      is_drink: Number(form.is_drink),
      is_active: Number(form.is_active),
    });
  };

  const inp =
    'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors';
  const lbl = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lbl}>カテゴリ</label>
          <select
            className={inp}
            value={form.category_id}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>サブカテゴリ</label>
          <select
            className={inp}
            value={form.subcategory_id}
            onChange={(e) => set('subcategory_id', e.target.value)}
          >
            <option value="">なし（価格競合なし）</option>
            {filteredSubcats.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={lbl}>基準価格</label>
          <input
            className={inp}
            type="number"
            value={form.base_price}
            onChange={(e) => set('base_price', e.target.value)}
            placeholder="500"
            required
            min={0}
          />
        </div>
        <div>
          <label className={lbl}>下限価格</label>
          <input
            className={inp}
            type="number"
            value={form.min_price}
            onChange={(e) => set('min_price', e.target.value)}
            placeholder="自動"
            min={0}
          />
        </div>
        <div>
          <label className={lbl}>上限価格</label>
          <input
            className={inp}
            type="number"
            value={form.max_price}
            onChange={(e) => set('max_price', e.target.value)}
            placeholder="自動"
            min={0}
          />
        </div>
      </div>
      <div className="flex gap-5">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(form.is_drink)}
            onChange={(e) => set('is_drink', e.target.checked ? 1 : 0)}
            className="w-4 h-4 accent-blue-600 rounded"
          />
          ドリンク（価格変動対象）
        </label>
        {item && (
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(form.is_active)}
              onChange={(e) => set('is_active', e.target.checked ? 1 : 0)}
              className="w-4 h-4 accent-blue-600 rounded"
            />
            有効
          </label>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
        >
          キャンセル
        </button>
        <button
          type="submit"
          className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
        >
          保存
        </button>
      </div>
    </form>
  );
}

// ─── メインコンポーネント ────────────────────────────
// inline=true のとき: サイドバー管理画面内にページとして表示
// inline=false (デフォルト): モーダルとして表示
export default function MenuManager({ onClose, inline = false }) {
  const queryClient = useQueryClient();
  const [editItem, setEditItem] = useState(null);
  const [adding, setAdding] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ['menu-all'],
    queryFn: api.getAllMenu,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
  });
  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories'],
    queryFn: api.getSubcategories,
  });

  const createMutation = useMutation({
    mutationFn: api.createMenuItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-all'] });
      setAdding(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateMenuItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-all'] });
      setEditItem(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteMenuItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu-all'] }),
  });

  const grouped = categories.reduce((acc, cat) => {
    acc[cat.id] = { ...cat, items: items.filter((i) => i.category_id === cat.id) };
    return acc;
  }, {});

  const content = (
    <div className={inline ? 'p-6 max-w-3xl mx-auto' : 'flex-1 overflow-y-auto'}>
      {/* 追加フォーム */}
      {adding && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-bold text-blue-800 mb-3">新規商品を追加</h3>
          <MenuItemForm
            categories={categories}
            subcategories={subcategories}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {/* カテゴリ別商品一覧 */}
      <div className="space-y-6">
        {Object.values(grouped).map((cat) => (
          <div key={cat.id}>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                {cat.name}
              </h3>
              <span className="text-xs text-gray-400">({cat.items.length}件)</span>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {cat.items.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400">商品がありません</p>
              ) : (
                cat.items.map((item) => (
                  <div key={item.id}>
                    {editItem?.id === item.id ? (
                      <div className="p-4 bg-gray-50">
                        <MenuItemForm
                          item={item}
                          categories={categories}
                          subcategories={subcategories}
                          onSave={(data) => updateMutation.mutate({ id: item.id, data })}
                          onCancel={() => setEditItem(null)}
                        />
                      </div>
                    ) : (
                      <div
                        className={`flex items-center gap-3 px-4 py-3 ${
                          item.is_active ? '' : 'opacity-40'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 block truncate">
                            {item.name}
                          </span>
                          <span className="text-xs text-gray-400">
                            ¥{item.base_price.toLocaleString()}
                            {item.subcategory_name && (
                              <span className="ml-1.5 text-indigo-400">{item.subcategory_name}</span>
                            )}
                          </span>
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                            item.is_drink
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {item.is_drink ? 'ドリンク' : 'フード'}
                        </span>
                        {!item.is_active && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 flex-shrink-0">
                            無効
                          </span>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => setEditItem(item)}
                            className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`「${item.name}」を削除しますか？`)) {
                                deleteMutation.mutate(item.id);
                              }
                            }}
                            className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 追加ボタン (インライン下部) */}
      {inline && !adding && (
        <div className="mt-6">
          <button
            onClick={() => setAdding(true)}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors shadow-sm"
          >
            + 商品を追加する
          </button>
        </div>
      )}
    </div>
  );

  // インラインモード（サイドバーナビから表示）
  if (inline) {
    return content;
  }

  // モーダルモード（後方互換）
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] flex flex-col border border-gray-100 pop-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">メニュー管理</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>
        {content}
        <div className="pt-4 border-t border-gray-100 mt-4">
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors shadow-sm"
            >
              + 商品を追加する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
