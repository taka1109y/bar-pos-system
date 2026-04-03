import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

const inp = 'w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';
const lbl = 'block text-xs font-medium text-gray-600 mb-1.5';

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

function FormFields({ form, setForm, fields }) {
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4">
      {fields.map((f) =>
        f.type === 'select' ? (
          <div key={f.key}>
            <label className={lbl}>{f.label}</label>
            <select className={inp} value={form[f.key] ?? ''} onChange={(e) => set(f.key, Number(e.target.value))} required={f.required}>
              <option value="">選択...</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ) : (
          <div key={f.key}>
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
    </div>
  );
}

// ─── サブカテゴリ行 ───────────────────────────────────
function SubcategoryRow({ sub, drinkCount, itemCount, onEdit, onDelete }) {
  const isPriceFrozen = drinkCount <= 1;
  return (
    <div className="flex items-center gap-3 px-6 py-4 bg-white hover:bg-gray-50 group">
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
      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(sub)} className="px-3.5 py-2 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium">
          編集
        </button>
        <button onClick={() => onDelete(sub)} className="px-3.5 py-2 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium">
          削除
        </button>
      </div>
    </div>
  );
}

// ─── メインコンポーネント ─────────────────────────────
export default function CategoryManager() {
  const qc = useQueryClient();
  const [expandedCats,  setExpandedCats]  = useState(new Set());
  const [addOpen,       setAddOpen]       = useState(false);
  const [editingCat,    setEditingCat]    = useState(null);
  const [addingSubcat,  setAddingSubcat]  = useState(null); // category id
  const [editingSubcat, setEditingSubcat] = useState(null);

  // フォーム状態
  const [catForm,    setCatForm]    = useState({});
  const [subcatForm, setSubcatForm] = useState({});

  const { data: categories   = [] } = useQuery({ queryKey: ['categories'],    queryFn: api.getCategories });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });
  const { data: menuItems    = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['subcategories'] });
    qc.invalidateQueries({ queryKey: ['menu-all'] });
    qc.invalidateQueries({ queryKey: ['menu'] });
  };

  const createCatMutation    = useMutation({ mutationFn: api.createCategory,                                onSuccess: () => { invalidate(); setAddOpen(false); setCatForm({}); } });
  const updateCatMutation    = useMutation({ mutationFn: ({ id, data }) => api.updateCategory(id, data),   onSuccess: () => { invalidate(); setEditingCat(null); } });
  const deleteCatMutation    = useMutation({ mutationFn: api.deleteCategory,                               onSuccess: invalidate });
  const createSubcatMutation = useMutation({ mutationFn: api.createSubcategory,                            onSuccess: () => { invalidate(); setAddingSubcat(null); setSubcatForm({}); } });
  const updateSubcatMutation = useMutation({ mutationFn: ({ id, data }) => api.updateSubcategory(id, data), onSuccess: () => { invalidate(); setEditingSubcat(null); } });
  const deleteSubcatMutation = useMutation({ mutationFn: api.deleteSubcategory,                            onSuccess: invalidate });

  const toggleExpand = (id) => {
    setExpandedCats((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const subcatsByCategory  = subcategories.reduce((acc, s) => { if (!acc[s.category_id]) acc[s.category_id] = []; acc[s.category_id].push(s); return acc; }, {});
  const itemCountBySubcat  = menuItems.reduce((acc, item) => { if (item.subcategory_id) acc[item.subcategory_id] = (acc[item.subcategory_id] ?? 0) + 1; return acc; }, {});
  const drinkCountBySubcat = menuItems.reduce((acc, item) => { if (item.subcategory_id && item.is_drink && item.is_active) acc[item.subcategory_id] = (acc[item.subcategory_id] ?? 0) + 1; return acc; }, {});

  const catFields = [
    { key: 'name',       label: 'カテゴリ名',    required: true, placeholder: '例: ビール' },
    { key: 'sort_order', label: '表示順序',       type: 'number', min: 0, placeholder: '0' },
    { key: 'crash_pct',  label: '暴落割引率（%）', type: 'number', min: 0, max: 100, placeholder: '0' },
  ];

  const subcatFields = (catId) => [
    { key: 'category_id', label: 'カテゴリ', type: 'select', required: true, options: categories.map((c) => ({ value: c.id, label: c.name })) },
    { key: 'name',        label: 'サブカテゴリ名',  required: true, placeholder: '例: 国産ビール' },
    { key: 'sort_order',  label: '表示順序',         type: 'number', min: 0, placeholder: '0' },
    { key: 'crash_pct',   label: '暴落割引率（%）',  type: 'number', min: 0, max: 100, placeholder: '0' },
  ];

  const formButtons = (onCancel, onSubmit, isLoading) => (
    <div className="flex gap-2.5 mt-5">
      <button type="button" onClick={onCancel} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
        キャンセル
      </button>
      <button type="button" onClick={onSubmit} disabled={isLoading} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50">
        保存
      </button>
    </div>
  );

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-end mb-6">
        <button
          onClick={() => { setAddOpen(true); setCatForm({}); }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
        >
          + カテゴリを追加
        </button>
      </div>

      <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <p className="text-xs text-gray-500 leading-relaxed">
          同じサブカテゴリ内で注文があった商品は価格上昇し、他の商品は価格下降します
        </p>
      </div>

      {/* カテゴリ一覧 */}
      <div className="space-y-6">
        {categories.map((cat) => {
          const subs       = subcatsByCategory[cat.id] ?? [];
          const isExpanded = expandedCats.has(cat.id);

          return (
            <div key={cat.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
              {/* カテゴリヘッダー */}
              <div className="flex items-center gap-3 px-6 py-4 bg-gray-50 border-b border-gray-100">
                <button onClick={() => toggleExpand(cat.id)} className="flex-1 flex items-center gap-3 text-left">
                  <span className={`text-xs text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-bold text-gray-800 text-sm">{cat.name}</span>
                  <span className="text-xs text-gray-400">({subs.length}件のサブカテゴリ)</span>
                </button>
                <span className="text-xs text-gray-400">順序: {cat.sort_order}</span>
                <button
                  onClick={() => { setEditingCat(cat); setCatForm({ name: cat.name, sort_order: cat.sort_order, crash_pct: cat.crash_pct ?? 0 }); }}
                  className="px-3.5 py-2 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
                >
                  編集
                </button>
                <button
                  onClick={() => { if (confirm(`「${cat.name}」を削除しますか？\n※商品が存在する場合は削除できません`)) deleteCatMutation.mutate(cat.id); }}
                  className="px-3.5 py-2 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
                >
                  削除
                </button>
              </div>

              {/* サブカテゴリ一覧 */}
              {isExpanded && (
                <div className="divide-y divide-gray-100">
                  {subs.map((sub) => (
                    <SubcategoryRow
                      key={sub.id}
                      sub={sub}
                      drinkCount={drinkCountBySubcat[sub.id] ?? 0}
                      itemCount={itemCountBySubcat[sub.id] ?? 0}
                      onEdit={(s) => { setEditingSubcat(s); setSubcatForm({ name: s.name, sort_order: s.sort_order, category_id: s.category_id, crash_pct: s.crash_pct ?? 0 }); }}
                      onDelete={(s) => { if (confirm(`「${s.name}」を削除しますか？\n※この商品のサブカテゴリ設定がクリアされます`)) deleteSubcatMutation.mutate(s.id); }}
                    />
                  ))}
                  <button
                    onClick={() => { setAddingSubcat(cat.id); setSubcatForm({ category_id: cat.id, sort_order: subs.length + 1 }); }}
                    className="w-full px-6 py-4 text-left text-xs text-indigo-500 hover:bg-indigo-50 transition-colors font-medium flex items-center gap-2"
                  >
                    <span className="w-4 text-gray-300">└</span>
                    + サブカテゴリを追加
                  </button>
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
          <br />
          <strong className="text-amber-800">「価格固定」バッジ</strong>が付いているサブカテゴリは、
          アクティブなドリンク商品が1件以下のため価格変動が無効です。
        </p>
      </div>

      {/* カテゴリ追加モーダル */}
      {addOpen && (
        <ModalShell title="カテゴリを追加" onClose={() => { setAddOpen(false); setCatForm({}); }}>
          <FormFields form={catForm} setForm={setCatForm} fields={catFields} />
          {formButtons(
            () => { setAddOpen(false); setCatForm({}); },
            () => { if (catForm.name) createCatMutation.mutate({ sort_order: categories.length + 1, ...catForm }); },
            createCatMutation.isPending
          )}
        </ModalShell>
      )}

      {/* カテゴリ編集モーダル */}
      {editingCat && (
        <ModalShell title={`「${editingCat.name}」を編集`} onClose={() => setEditingCat(null)}>
          <FormFields form={catForm} setForm={setCatForm} fields={catFields} />
          {formButtons(
            () => setEditingCat(null),
            () => { if (catForm.name) updateCatMutation.mutate({ id: editingCat.id, data: catForm }); },
            updateCatMutation.isPending
          )}
        </ModalShell>
      )}

      {/* サブカテゴリ追加モーダル */}
      {addingSubcat !== null && (
        <ModalShell title="サブカテゴリを追加" onClose={() => { setAddingSubcat(null); setSubcatForm({}); }}>
          <FormFields form={subcatForm} setForm={setSubcatForm} fields={subcatFields(addingSubcat)} />
          {formButtons(
            () => { setAddingSubcat(null); setSubcatForm({}); },
            () => { if (subcatForm.name && subcatForm.category_id) createSubcatMutation.mutate(subcatForm); },
            createSubcatMutation.isPending
          )}
        </ModalShell>
      )}

      {/* サブカテゴリ編集モーダル */}
      {editingSubcat && (
        <ModalShell title={`「${editingSubcat.name}」を編集`} onClose={() => setEditingSubcat(null)}>
          <FormFields form={subcatForm} setForm={setSubcatForm} fields={subcatFields()} />
          {formButtons(
            () => setEditingSubcat(null),
            () => { if (subcatForm.name) updateSubcatMutation.mutate({ id: editingSubcat.id, data: subcatForm }); },
            updateSubcatMutation.isPending
          )}
        </ModalShell>
      )}
    </div>
  );
}
