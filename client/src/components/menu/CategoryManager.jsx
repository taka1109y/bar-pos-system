import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

const inp = 'w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
const lbl = 'block text-xs font-medium text-gray-600 mb-1.5';

// ─── サブカテゴリ行 ───────────────────────────────────
function SubcategoryRow({ sub, drinkCount, itemCount, onEdit, onDelete }) {
  const isPriceFrozen = drinkCount <= 1;
  return (
    <div className="flex items-center gap-3 px-5 py-3 bg-white hover:bg-gray-50 group">
      <div className="w-4 text-gray-300 text-xs flex-shrink-0">└</div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-800">{sub.name}</span>
        <span className="text-xs text-gray-400 ml-2">({itemCount}件)</span>
        {isPriceFrozen && (
          <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-500 rounded border border-gray-200">
            価格固定
          </span>
        )}
      </div>
      <span className="text-[11px] text-gray-400 flex-shrink-0">順序: {sub.sort_order}</span>
      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(sub)}
          className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
        >
          編集
        </button>
        <button
          onClick={() => onDelete(sub)}
          className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
        >
          削除
        </button>
      </div>
    </div>
  );
}

// ─── インラインフォーム ───────────────────────────────
function InlineForm({ initialValues = {}, fields, onSave, onCancel, isLoading }) {
  const [form, setForm] = useState(initialValues);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
      className="flex flex-wrap items-end gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl"
    >
      {fields.map((f) =>
        f.type === 'select' ? (
          <div key={f.key} className={f.className || 'flex-1 min-w-32'}>
            <label className={lbl}>{f.label}</label>
            <select className={inp} value={form[f.key] ?? ''} onChange={(e) => set(f.key, Number(e.target.value))} required={f.required}>
              <option value="">選択...</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ) : (
          <div key={f.key} className={f.className || 'flex-1 min-w-32'}>
            <label className={lbl}>{f.label}</label>
            <input
              className={inp}
              type={f.type || 'text'}
              value={form[f.key] ?? ''}
              onChange={(e) => set(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
              placeholder={f.placeholder}
              required={f.required}
              min={f.min}
            />
          </div>
        )
      )}
      <div className="flex gap-2 flex-shrink-0">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium">
          キャンセル
        </button>
        <button type="submit" disabled={isLoading} className="px-4 py-2.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-bold disabled:opacity-50">
          保存
        </button>
      </div>
    </form>
  );
}

// ─── メインコンポーネント ─────────────────────────────
export default function CategoryManager() {
  const qc = useQueryClient();
  const [expandedCats,  setExpandedCats]  = useState(new Set());
  const [addingCat,     setAddingCat]     = useState(false);
  const [editingCat,    setEditingCat]    = useState(null);
  const [addingSubcat,  setAddingSubcat]  = useState(null);
  const [editingSubcat, setEditingSubcat] = useState(null);

  const { data: categories   = [] } = useQuery({ queryKey: ['categories'],    queryFn: api.getCategories });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });
  const { data: menuItems    = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['subcategories'] });
    qc.invalidateQueries({ queryKey: ['menu-all'] });
    qc.invalidateQueries({ queryKey: ['menu'] });
  };

  const createCatMutation    = useMutation({ mutationFn: api.createCategory,                                   onSuccess: () => { invalidate(); setAddingCat(false); } });
  const updateCatMutation    = useMutation({ mutationFn: ({ id, data }) => api.updateCategory(id, data),       onSuccess: () => { invalidate(); setEditingCat(null); } });
  const deleteCatMutation    = useMutation({ mutationFn: api.deleteCategory,                                   onSuccess: invalidate });
  const createSubcatMutation = useMutation({ mutationFn: api.createSubcategory,                                onSuccess: () => { invalidate(); setAddingSubcat(null); } });
  const updateSubcatMutation = useMutation({ mutationFn: ({ id, data }) => api.updateSubcategory(id, data),    onSuccess: () => { invalidate(); setEditingSubcat(null); } });
  const deleteSubcatMutation = useMutation({ mutationFn: api.deleteSubcategory,                                onSuccess: invalidate });

  const toggleExpand = (id) => {
    setExpandedCats((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const subcatsByCategory = subcategories.reduce((acc, s) => {
    if (!acc[s.category_id]) acc[s.category_id] = [];
    acc[s.category_id].push(s);
    return acc;
  }, {});

  const itemCountBySubcat  = menuItems.reduce((acc, item) => { if (item.subcategory_id) acc[item.subcategory_id] = (acc[item.subcategory_id] ?? 0) + 1; return acc; }, {});
  const drinkCountBySubcat = menuItems.reduce((acc, item) => { if (item.subcategory_id && item.is_drink && item.is_active) acc[item.subcategory_id] = (acc[item.subcategory_id] ?? 0) + 1; return acc; }, {});

  const catFields = [
    { key: 'name', label: 'カテゴリ名', required: true, placeholder: '例: ビール', className: 'flex-1 min-w-40' },
    { key: 'sort_order', label: '表示順序', type: 'number', min: 0, placeholder: '0', className: 'w-28' },
  ];

  const subcatFields = () => [
    { key: 'category_id', label: 'カテゴリ', type: 'select', required: true, className: 'w-40', options: categories.map((c) => ({ value: c.id, label: c.name })) },
    { key: 'name', label: 'サブカテゴリ名', required: true, placeholder: '例: 国産ビール', className: 'flex-1 min-w-40' },
    { key: 'sort_order', label: '表示順序', type: 'number', min: 0, placeholder: '0', className: 'w-28' },
  ];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h2 className="text-sm font-bold text-gray-700">カテゴリ / サブカテゴリ</h2>
          <p className="text-xs text-gray-400 mt-1">
            同じサブカテゴリ内で注文があった商品は価格上昇し、他の商品は価格下降します
          </p>
        </div>
        {!addingCat && (
          <button
            onClick={() => setAddingCat(true)}
            className="px-4 py-2.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-colors shadow-sm"
          >
            + カテゴリを追加
          </button>
        )}
      </div>

      {/* カテゴリ追加フォーム */}
      {addingCat && (
        <div className="mb-5">
          <InlineForm
            initialValues={{ sort_order: categories.length + 1 }}
            fields={catFields}
            onSave={(data) => createCatMutation.mutate(data)}
            onCancel={() => setAddingCat(false)}
            isLoading={createCatMutation.isPending}
          />
        </div>
      )}

      {/* カテゴリ一覧 */}
      <div className="space-y-4">
        {categories.map((cat) => {
          const subs       = subcatsByCategory[cat.id] ?? [];
          const isExpanded = expandedCats.has(cat.id);

          return (
            <div key={cat.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
              {/* カテゴリヘッダー */}
              {editingCat?.id === cat.id ? (
                <div className="p-4">
                  <InlineForm
                    initialValues={{ name: cat.name, sort_order: cat.sort_order }}
                    fields={catFields}
                    onSave={(data) => updateCatMutation.mutate({ id: cat.id, data })}
                    onCancel={() => setEditingCat(null)}
                    isLoading={updateCatMutation.isPending}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3.5 bg-gray-50 border-b border-gray-100">
                  <button onClick={() => toggleExpand(cat.id)} className="flex-1 flex items-center gap-2.5 text-left">
                    <span className={`text-xs text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-bold text-gray-800 text-sm">{cat.name}</span>
                    <span className="text-xs text-gray-400">({subs.length}件のサブカテゴリ)</span>
                  </button>
                  <span className="text-xs text-gray-400">順序: {cat.sort_order}</span>
                  <button
                    onClick={() => setEditingCat(cat)}
                    className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => { if (confirm(`「${cat.name}」を削除しますか？\n※商品が存在する場合は削除できません`)) deleteCatMutation.mutate(cat.id); }}
                    className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
                  >
                    削除
                  </button>
                </div>
              )}

              {/* サブカテゴリ一覧 */}
              {isExpanded && (
                <div className="divide-y divide-gray-100">
                  {subs.map((sub) =>
                    editingSubcat?.id === sub.id ? (
                      <div key={sub.id} className="p-4">
                        <InlineForm
                          initialValues={{ name: sub.name, sort_order: sub.sort_order, category_id: sub.category_id }}
                          fields={subcatFields()}
                          onSave={(data) => updateSubcatMutation.mutate({ id: sub.id, data })}
                          onCancel={() => setEditingSubcat(null)}
                          isLoading={updateSubcatMutation.isPending}
                        />
                      </div>
                    ) : (
                      <SubcategoryRow
                        key={sub.id}
                        sub={sub}
                        drinkCount={drinkCountBySubcat[sub.id] ?? 0}
                        itemCount={itemCountBySubcat[sub.id] ?? 0}
                        onEdit={setEditingSubcat}
                        onDelete={(s) => { if (confirm(`「${s.name}」を削除しますか？\n※この商品のサブカテゴリ設定がクリアされます`)) deleteSubcatMutation.mutate(s.id); }}
                      />
                    )
                  )}

                  {/* サブカテゴリ追加 */}
                  {addingSubcat === cat.id ? (
                    <div className="p-4">
                      <InlineForm
                        initialValues={{ category_id: cat.id, sort_order: subs.length + 1 }}
                        fields={subcatFields()}
                        onSave={(data) => createSubcatMutation.mutate(data)}
                        onCancel={() => setAddingSubcat(null)}
                        isLoading={createSubcatMutation.isPending}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingSubcat(cat.id)}
                      className="w-full px-5 py-3 text-left text-xs text-blue-500 hover:bg-blue-50 transition-colors font-medium flex items-center gap-2"
                    >
                      <span className="w-4 text-gray-300">└</span>
                      + サブカテゴリを追加
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 価格変動ロジック説明 */}
      <div className="mt-8 p-5 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-xs font-bold text-amber-800 mb-2">価格変動ロジック</p>
        <p className="text-xs text-amber-700 leading-relaxed">
          ドリンクが注文されると、<strong>そのドリンクの価格が即時上昇</strong>します。
          同じサブカテゴリ内の他のドリンクが多く注文されている場合は<strong>競合効果で価格が下降</strong>します。
          10件注文で最大価格、10件競合で最小価格に到達します。
          <br />
          <strong className="text-amber-800">「価格固定」バッジ</strong>が付いているサブカテゴリは、
          アクティブなドリンク商品が1件以下のため価格変動が無効です。
        </p>
      </div>
    </div>
  );
}
