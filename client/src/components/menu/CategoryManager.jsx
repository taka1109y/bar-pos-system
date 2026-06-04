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
            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
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

function FormFields({ form, setForm, fields }) {
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4">
      {fields.map((f) =>
        f.type === 'select' ? (
          <div key={f.key}>
            <label className={lbl}>{f.label}</label>
            <div className="relative">
              <select className={`${inp} appearance-none pr-8`} value={form[f.key] ?? ''} onChange={(e) => set(f.key, Number(e.target.value))} required={f.required}>
                <option value="">選択...</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
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
              max={f.max}
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
    <div className="flex items-center gap-3 px-6 py-4 bg-white hover:bg-slate-50 group">
      <div className="w-4 text-slate-300 text-xs flex-shrink-0">└</div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-slate-800">{sub.name}</span>
        <span className="text-xs text-slate-400 ml-2">({itemCount}件)</span>
        {isPriceFrozen && (
          <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-500 rounded border border-slate-200">
            価格固定
          </span>
        )}
      </div>
      <span className="text-[11px] text-slate-400 flex-shrink-0">順序: {sub.sort_order}</span>
      <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(sub)} className="w-9 h-9 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 cursor-pointer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button onClick={() => onDelete(sub)} className="w-9 h-9 flex items-center justify-center border border-red-200 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 cursor-pointer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
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

  const { data: categories   = [] } = useQuery({ queryKey: ['categories-staff'], queryFn: api.getStaffCategories });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });
  const { data: menuItems    = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories-staff'] });
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
    <div className="flex gap-3 mt-5">
      <button type="button" onClick={onCancel} className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors">
        キャンセル
      </button>
      <button type="button" onClick={onSubmit} disabled={isLoading} className="flex-1 py-4 bg-primary-500 hover:bg-primary-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50">
        保存
      </button>
    </div>
  );

  return (
    <div className="px-8 py-12 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">カテゴリ管理</h1>
        <p className="text-base text-body leading-relaxed mt-2">カテゴリとサブカテゴリの管理</p>
      </div>
      <div className="flex items-center justify-end mb-6">
        <button
          onClick={() => { setAddOpen(true); setCatForm({}); }}
          className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer"
        >
          + カテゴリを追加
        </button>
      </div>

      <div className="mb-5 p-4 bg-gray-50 border border-slate-200 rounded-xl">
        <p className="text-xs text-slate-500 leading-relaxed">
          同じサブカテゴリ内で注文があった商品は価格上昇し、他の商品は価格下降します
        </p>
      </div>

      {/* カテゴリ一覧 */}
      <div className="space-y-6">
        {categories.map((cat) => {
          const subs       = subcatsByCategory[cat.id] ?? [];
          const isExpanded = expandedCats.has(cat.id);

          return (
            <div key={cat.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
              {/* カテゴリヘッダー */}
              <div className="flex items-center gap-3 px-6 py-4 bg-gray-50 border-b border-slate-200">
                <button onClick={() => toggleExpand(cat.id)} className="flex-1 flex items-center gap-3 text-left">
                  <span className={`text-xs text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-bold text-slate-800 text-sm">{cat.name}</span>
                  <span className="text-xs text-slate-400">({subs.length}件のサブカテゴリ)</span>
                </button>
                <span className="text-xs text-slate-400">順序: {cat.sort_order}</span>
                <button
                  onClick={() => { setEditingCat(cat); setCatForm({ name: cat.name, sort_order: cat.sort_order, crash_pct: cat.crash_pct ?? 0, is_staff_only: cat.is_staff_only ?? false }); }}
                  className="w-9 h-9 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 cursor-pointer"
                  title="編集"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                {cat.is_staff_only && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded border border-amber-200 flex-shrink-0">
                    スタッフ専用
                  </span>
                )}
                <button
                  onClick={() => { if (confirm(`「${cat.name}」を削除しますか？\n※商品が存在する場合は削除できません`)) deleteCatMutation.mutate(cat.id); }}
                  className="w-9 h-9 flex items-center justify-center border border-red-200 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 cursor-pointer"
                  title="削除"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/>
                  </svg>
                </button>
              </div>

              {/* サブカテゴリ一覧 */}
              {isExpanded && (
                <div className="divide-y divide-slate-100">
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
                    className="w-full px-6 py-4 text-left text-xs text-primary-500 hover:bg-primary-50 transition-colors font-medium flex items-center gap-2"
                  >
                    <span className="w-4 text-slate-300">└</span>
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
          <div className="border-t border-slate-100 pt-4 mt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(catForm.is_staff_only)}
                onChange={(e) => setCatForm((f) => ({ ...f, is_staff_only: e.target.checked }))}
                className="w-4 h-4 rounded accent-amber-600"
              />
              <span className="text-sm text-slate-700">スタッフ専用（お客様画面に表示しない）</span>
            </label>
            {catForm.is_staff_only && (
              <p className="text-xs text-amber-600 mt-1 ml-6">POS画面にのみ表示されます</p>
            )}
          </div>
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
          <div className="border-t border-slate-100 pt-4 mt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(catForm.is_staff_only)}
                onChange={(e) => setCatForm((f) => ({ ...f, is_staff_only: e.target.checked }))}
                className="w-4 h-4 rounded accent-amber-600"
              />
              <span className="text-sm text-slate-700">スタッフ専用（お客様画面に表示しない）</span>
            </label>
            {catForm.is_staff_only && (
              <p className="text-xs text-amber-600 mt-1 ml-6">POS画面にのみ表示されます</p>
            )}
          </div>
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
