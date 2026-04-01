import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

function MenuItemForm({ item, categories, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: item?.name || '',
    category_id: item?.category_id || categories[0]?.id || '',
    base_price: item?.base_price || '',
    min_price: item?.min_price || '',
    max_price: item?.max_price || '',
    is_drink: item?.is_drink ?? 1,
    is_active: item?.is_active ?? 1,
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      category_id: Number(form.category_id),
      base_price: Number(form.base_price),
      min_price: Number(form.min_price) || Number(form.base_price) * 0.7,
      max_price: Number(form.max_price) || Number(form.base_price) * 2.0,
      is_drink: Number(form.is_drink),
      is_active: Number(form.is_active),
    });
  };

  const inp = "w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500";
  const lbl = "block text-xs text-slate-400 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className={lbl}>商品名</label>
        <input className={inp} value={form.name} onChange={e => set('name', e.target.value)} required />
      </div>
      <div>
        <label className={lbl}>カテゴリ</label>
        <select className={inp} value={form.category_id} onChange={e => set('category_id', e.target.value)}>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={lbl}>基準価格</label>
          <input className={inp} type="number" value={form.base_price} onChange={e => set('base_price', e.target.value)} required min={0} />
        </div>
        <div>
          <label className={lbl}>下限価格</label>
          <input className={inp} type="number" value={form.min_price} onChange={e => set('min_price', e.target.value)} min={0} placeholder="自動" />
        </div>
        <div>
          <label className={lbl}>上限価格</label>
          <input className={inp} type="number" value={form.max_price} onChange={e => set('max_price', e.target.value)} min={0} placeholder="自動" />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={Boolean(form.is_drink)} onChange={e => set('is_drink', e.target.checked ? 1 : 0)} className="accent-blue-500" />
          ドリンク (価格変動対象)
        </label>
        {item && (
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={Boolean(form.is_active)} onChange={e => set('is_active', e.target.checked ? 1 : 0)} className="accent-blue-500" />
            有効
          </label>
        )}
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm">キャンセル</button>
        <button type="submit" className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold">保存</button>
      </div>
    </form>
  );
}

export default function MenuManager({ onClose }) {
  const queryClient = useQueryClient();
  const [editItem, setEditItem] = useState(null);
  const [adding, setAdding] = useState(false);

  const { data: items = [] } = useQuery({ queryKey: ['menu-all'], queryFn: api.getAllMenu });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories });

  const createMutation = useMutation({
    mutationFn: api.createMenuItem,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['menu-all'] }); setAdding(false); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateMenuItem(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['menu-all'] }); setEditItem(null); },
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteMenuItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu-all'] }),
  });

  // カテゴリ別にグループ化
  const grouped = categories.reduce((acc, cat) => {
    acc[cat.id] = { ...cat, items: items.filter(i => i.category_id === cat.id) };
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">メニュー管理</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          {Object.values(grouped).map((cat) => (
            <div key={cat.id}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{cat.name}</h3>
              <div className="space-y-1">
                {cat.items.map((item) => (
                  <div key={item.id}>
                    {editItem?.id === item.id ? (
                      <div className="bg-slate-700 rounded-lg p-3">
                        <MenuItemForm
                          item={item}
                          categories={categories}
                          onSave={(data) => updateMutation.mutate({ id: item.id, data })}
                          onCancel={() => setEditItem(null)}
                        />
                      </div>
                    ) : (
                      <div className={`flex items-center gap-3 px-3 py-2 rounded-lg ${item.is_active ? 'bg-slate-700/50' : 'bg-slate-700/20 opacity-50'}`}>
                        <span className="flex-1 text-sm text-white">{item.name}</span>
                        <span className="text-xs text-slate-400">¥{item.base_price.toLocaleString()}</span>
                        {item.is_drink ? <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded">ドリンク</span> : <span className="text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded">フード</span>}
                        <button onClick={() => setEditItem(item)} className="text-xs text-slate-400 hover:text-white px-2">編集</button>
                        <button onClick={() => deleteMutation.mutate(item.id)} className="text-xs text-red-400 hover:text-red-300 px-2">削除</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {adding && (
            <div className="bg-slate-700 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white mb-3">新規追加</h3>
              <MenuItemForm
                categories={categories}
                onSave={(data) => createMutation.mutate(data)}
                onCancel={() => setAdding(false)}
              />
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-700 mt-4">
          <button
            onClick={() => setAdding(true)}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors"
          >
            + メニューを追加
          </button>
        </div>
      </div>
    </div>
  );
}
