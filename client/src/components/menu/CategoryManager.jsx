import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Button, Modal, Field, Input, Select, Alert, Badge } from '../ui';

const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
);
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
);

// スタッフ専用チェックボックス(共通の小部品が無いためローカル)
function StaffOnlyCheck({ checked, onChange }) {
  return (
    <div className="border-t border-line pt-3 mt-1">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded accent-amber-600" />
        <span className="text-sm text-body">スタッフ専用（お客様画面に表示しない）</span>
      </label>
      {checked && <p className="text-xs text-warning mt-1 ml-6">POS画面にのみ表示されます</p>}
    </div>
  );
}

// ─── サブカテゴリ行(hover隠しを廃止し操作を常時表示=タッチ対応) ───
function SubcategoryRow({ sub, drinkCount, itemCount, onEdit, onDelete }) {
  const isPriceFrozen = drinkCount <= 1;
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-surface hover:bg-surface-hover">
      <div className="w-4 text-faint text-xs flex-shrink-0">└</div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-heading">{sub.name}</span>
        <span className="text-xs text-muted ml-2">({itemCount}件)</span>
        {isPriceFrozen && <Badge tone="neutral" size="sm" className="ml-2">価格固定</Badge>}
      </div>
      <span className="text-2xs text-faint flex-shrink-0">順序: {sub.sort_order}</span>
      <div className="flex gap-1.5 flex-shrink-0">
        <Button variant="secondary" size="sm" iconOnly aria-label={`${sub.name} を編集`} title="編集" onClick={() => onEdit(sub)}><IconEdit /></Button>
        <Button variant="secondary" size="sm" iconOnly aria-label={`${sub.name} を削除`} title="削除" className="text-danger border-red-200 hover:bg-red-50" onClick={() => onDelete(sub)}><IconTrash /></Button>
      </div>
    </div>
  );
}

// ─── カテゴリ管理(商品管理ビューの「カテゴリ」タブ本体。ページ枠は親が供給) ───
export default function CategoryManager() {
  const qc = useQueryClient();
  const [expandedCats,  setExpandedCats]  = useState(new Set());
  const [addOpen,       setAddOpen]       = useState(false);
  const [editingCat,    setEditingCat]    = useState(null);
  const [addingSubcat,  setAddingSubcat]  = useState(null); // category id
  const [editingSubcat, setEditingSubcat] = useState(null);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Alert tone="info" className="flex-1">
          同じサブカテゴリ内で注文があった商品は価格上昇し、他の商品は価格下降します。
          <strong className="text-primary-800">「価格固定」</strong>はアクティブなドリンクが1件以下＝価格変動が無効なサブカテゴリです。
        </Alert>
        <Button className="flex-shrink-0" onClick={() => { setAddOpen(true); setCatForm({}); }}>＋ カテゴリを追加</Button>
      </div>

      {/* カテゴリ一覧(アコーディオン) */}
      <div className="space-y-3">
        {categories.map((cat) => {
          const subs       = subcatsByCategory[cat.id] ?? [];
          const isExpanded = expandedCats.has(cat.id);
          return (
            <div key={cat.id} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
              {/* カテゴリヘッダー */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-sunken border-b border-line">
                <button onClick={() => toggleExpand(cat.id)} className="flex-1 flex items-center gap-3 text-left cursor-pointer" aria-expanded={isExpanded}>
                  <span className={`text-xs text-faint transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-bold text-heading text-sm">{cat.name}</span>
                  <span className="text-xs text-muted">({subs.length}件のサブカテゴリ)</span>
                </button>
                <span className="text-xs text-faint">順序: {cat.sort_order}</span>
                {cat.is_staff_only && <Badge tone="warning" size="sm">スタッフ専用</Badge>}
                <Button variant="secondary" size="sm" iconOnly aria-label={`${cat.name} を編集`} title="編集"
                  onClick={() => { setEditingCat(cat); setCatForm({ name: cat.name, sort_order: cat.sort_order, is_staff_only: cat.is_staff_only ?? false }); }}><IconEdit /></Button>
                <Button variant="secondary" size="sm" iconOnly aria-label={`${cat.name} を削除`} title="削除" className="text-danger border-red-200 hover:bg-red-50"
                  onClick={() => { if (confirm(`「${cat.name}」を削除しますか？\n※商品が存在する場合は削除できません`)) deleteCatMutation.mutate(cat.id); }}><IconTrash /></Button>
              </div>

              {/* サブカテゴリ一覧 */}
              {isExpanded && (
                <div className="divide-y divide-line">
                  {subs.map((sub) => (
                    <SubcategoryRow
                      key={sub.id}
                      sub={sub}
                      drinkCount={drinkCountBySubcat[sub.id] ?? 0}
                      itemCount={itemCountBySubcat[sub.id] ?? 0}
                      onEdit={(s) => { setEditingSubcat(s); setSubcatForm({ name: s.name, sort_order: s.sort_order, category_id: s.category_id }); }}
                      onDelete={(s) => { if (confirm(`「${s.name}」を削除しますか？\n※この商品のサブカテゴリ設定がクリアされます`)) deleteSubcatMutation.mutate(s.id); }}
                    />
                  ))}
                  <button
                    onClick={() => { setAddingSubcat(cat.id); setSubcatForm({ category_id: cat.id, sort_order: subs.length + 1 }); }}
                    className="w-full px-4 py-2 text-left text-xs text-primary-600 hover:bg-primary-50 transition-colors font-medium flex items-center gap-2 cursor-pointer"
                  >
                    <span className="w-4 text-faint">└</span> ＋ サブカテゴリを追加
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* カテゴリ追加/編集モーダル */}
      {(addOpen || editingCat) && (
        <Modal title={editingCat ? `「${editingCat.name}」を編集` : 'カテゴリを追加'} size="sm"
          onClose={() => { setAddOpen(false); setEditingCat(null); setCatForm({}); }}>
          <div className="space-y-3">
            <Field label="カテゴリ名" required><Input value={catForm.name ?? ''} onChange={(e) => setCatForm((f) => ({ ...f, name: e.target.value }))} placeholder="例: ビール" /></Field>
            <Field label="表示順序"><Input type="number" min={0} value={catForm.sort_order ?? ''} onChange={(e) => setCatForm((f) => ({ ...f, sort_order: Number(e.target.value) }))} placeholder="0" /></Field>
            <StaffOnlyCheck checked={catForm.is_staff_only} onChange={(v) => setCatForm((f) => ({ ...f, is_staff_only: v }))} />
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="secondary" onClick={() => { setAddOpen(false); setEditingCat(null); setCatForm({}); }}>キャンセル</Button>
            {editingCat ? (
              <Button loading={updateCatMutation.isPending} onClick={() => { if (catForm.name) updateCatMutation.mutate({ id: editingCat.id, data: catForm }); }}>保存</Button>
            ) : (
              <Button loading={createCatMutation.isPending} onClick={() => { if (catForm.name) createCatMutation.mutate({ sort_order: categories.length + 1, ...catForm }); }}>保存</Button>
            )}
          </div>
        </Modal>
      )}

      {/* サブカテゴリ追加/編集モーダル */}
      {(addingSubcat !== null || editingSubcat) && (
        <Modal title={editingSubcat ? `「${editingSubcat.name}」を編集` : 'サブカテゴリを追加'} size="sm"
          onClose={() => { setAddingSubcat(null); setEditingSubcat(null); setSubcatForm({}); }}>
          <div className="space-y-3">
            <Field label="カテゴリ" required>
              <Select value={subcatForm.category_id ?? ''} onChange={(e) => setSubcatForm((f) => ({ ...f, category_id: Number(e.target.value) }))}>
                <option value="">選択...</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="サブカテゴリ名" required><Input value={subcatForm.name ?? ''} onChange={(e) => setSubcatForm((f) => ({ ...f, name: e.target.value }))} placeholder="例: 国産ビール" /></Field>
            <Field label="表示順序"><Input type="number" min={0} value={subcatForm.sort_order ?? ''} onChange={(e) => setSubcatForm((f) => ({ ...f, sort_order: Number(e.target.value) }))} placeholder="0" /></Field>
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="secondary" onClick={() => { setAddingSubcat(null); setEditingSubcat(null); setSubcatForm({}); }}>キャンセル</Button>
            {editingSubcat ? (
              <Button loading={updateSubcatMutation.isPending} onClick={() => { if (subcatForm.name) updateSubcatMutation.mutate({ id: editingSubcat.id, data: subcatForm }); }}>保存</Button>
            ) : (
              <Button loading={createSubcatMutation.isPending} onClick={() => { if (subcatForm.name && subcatForm.category_id) createSubcatMutation.mutate(subcatForm); }}>保存</Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
