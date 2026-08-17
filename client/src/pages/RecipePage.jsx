import { useState } from 'react';
import { yen } from '../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Field, Input, Textarea, Badge, Alert, cn } from '../components/ui';

function CostBadge({ costPrice, basePrice }) {
  if (!costPrice || !basePrice) return <span className="text-xs text-faint">未設定</span>;
  const rate = Math.round((costPrice / basePrice) * 100);
  const tone = rate < 30 ? 'success' : rate < 50 ? 'warning' : 'danger';
  return <Badge tone={tone} size="sm">原価率 {rate}%</Badge>;
}

// ─── 材料ピッカー（検索＋カテゴリ絞り込み。タップで追加→上の材料表で使用量入力） ───
function IngredientPicker({ available, categories, onAdd }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(null); // null=全て / number=category_id / 'none'=未分類

  const presentIds = new Set(available.filter(i => i.category_id != null).map(i => i.category_id));
  const chipCats = categories.filter(c => presentIds.has(c.id));
  const hasUncat = available.some(i => i.category_id == null);

  const query = q.trim().toLowerCase();
  const list = available.filter(i => {
    if (query && !i.name.toLowerCase().includes(query)) return false;
    if (cat === 'none') return i.category_id == null;
    if (cat !== null) return i.category_id === cat;
    return true;
  });

  const chip = (active, label, onClick) => (
    <button type="button" onClick={onClick}
      className={cn('px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap',
        active ? 'bg-primary-500 text-white border-primary-500' : 'bg-surface text-body border-line hover:bg-surface-hover')}>
      {label}
    </button>
  );

  return (
    <div className="px-4 py-3 border-t border-line bg-surface-sunken">
      <p className="text-xs font-medium text-muted mb-2">材料を追加</p>
      <Input type="search" size="sm" placeholder="材料を検索..." value={q} onChange={(e) => setQ(e.target.value)}
        prefix={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>} />
      {(chipCats.length > 0 || hasUncat) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {chip(cat === null, '全て', () => setCat(null))}
          {chipCats.map(c => chip(cat === c.id, c.name, () => setCat(c.id)))}
          {hasUncat && chip(cat === 'none', '未分類', () => setCat('none'))}
        </div>
      )}
      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface divide-y divide-line">
        {list.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted">該当する材料がありません</div>
        ) : list.map(i => (
          <div key={i.id} className="flex items-center gap-2 px-3 py-2">
            <div className="flex-1 min-w-0">
              <span className="text-sm text-heading">{i.name}</span>
              <span className="text-xs text-muted ml-1">（{i.quantity_unit}）</span>
              {i.category_name && <span className="text-2xs text-faint ml-1.5">{i.category_name}</span>}
            </div>
            <Button variant="secondary" size="sm" onClick={() => onAdd(i)}>＋ 追加</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RecipePage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [editIngredients, setEditIngredients] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const { data: recipes = [], isLoading: recipesLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: api.getRecipes,
  });

  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: api.getIngredients,
  });

  const { data: ingCategories = [] } = useQuery({
    queryKey: ['ingredient-categories'],
    queryFn: api.getIngredientCategories,
  });

  const { data: detail } = useQuery({
    queryKey: ['recipe-detail', selectedId],
    queryFn: () => api.getRecipeByMenu(selectedId),
    enabled: !!selectedId,
  });

  const saveMutation = useMutation({
    mutationFn: ({ menuItemId, data }) => api.saveRecipe(menuItemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['recipe-detail', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['menu'] });
      setEditIngredients(null);
      setSaving(false);
    },
    onError: (e) => { setSaveError(e.message); setSaving(false); },
  });

  const handleSelect = (item) => {
    setSelectedId(item.id);
    setEditIngredients(null);
    setSaveError('');
  };

  const startEdit = () => {
    if (!detail) return;
    setEditIngredients(detail.ingredients.map(i => ({ ...i })));
    setEditNotes(detail.recipe_notes || '');
  };

  const cancelEdit = () => { setEditIngredients(null); setSaveError(''); };

  const removeIngredient = (ingredientId) => {
    setEditIngredients(prev => prev.filter(i => i.ingredient_id !== ingredientId));
  };

  const updateQty = (ingredientId, qty) => {
    setEditIngredients(prev => prev.map(i =>
      i.ingredient_id === ingredientId ? { ...i, usage_quantity: qty } : i
    ));
  };

  const addIngredient = (ing) => {
    if (!ing || editIngredients.find(i => i.ingredient_id === ing.id)) return;
    // 追加時は使用量を空にして、上の材料表のインライン入力で数量を入れてもらう
    setEditIngredients(prev => [
      ...prev,
      { ingredient_id: ing.id, ingredient_name: ing.name, usage_quantity: '', quantity_unit: ing.quantity_unit, cost_contribution: null },
    ]);
  };

  const handleSave = () => {
    if (!selectedId || !editIngredients) return;
    setSaving(true);
    setSaveError('');
    saveMutation.mutate({
      menuItemId: selectedId,
      data: {
        recipe_notes: editNotes || null,
        ingredients: editIngredients
          .filter(i => Number(i.usage_quantity) > 0)
          .map(i => ({ ingredient_id: i.ingredient_id, usage_quantity: Number(i.usage_quantity) })),
      },
    });
  };

  const calcCost = (editIngList) =>
    editIngList.reduce((sum, ei) => {
      const ing = ingredients.find(i => i.id === ei.ingredient_id);
      if (!ing || !ing.purchase_quantity) return sum;
      return sum + (Number(ei.usage_quantity) * ing.cost_per_purchase_unit / ing.purchase_quantity);
    }, 0);

  const selectedItem = recipes.find(r => r.id === selectedId);
  const pq = productSearch.trim().toLowerCase();
  const filteredRecipes = pq ? recipes.filter(r => r.name.toLowerCase().includes(pq)) : recipes;

  return (
    <div className="ui-pad flex h-full min-h-0">
      {/* 左ペイン: 商品一覧 */}
      <div className="w-72 flex-shrink-0 border-r border-line flex flex-col bg-surface">
        <div className="px-4 py-3 border-b border-line space-y-2">
          <div>
            <h2 className="text-sm font-bold text-heading">商品一覧</h2>
            <p className="text-xs text-muted mt-0.5">商品を選択してレシピを編集</p>
          </div>
          <Input type="search" size="sm" placeholder="商品名で検索..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
            prefix={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {recipesLoading ? (
            <div className="p-4 text-sm text-muted">読み込み中...</div>
          ) : recipes.length === 0 ? (
            <div className="p-4 text-sm text-muted">商品がありません</div>
          ) : filteredRecipes.length === 0 ? (
            <div className="p-4 text-sm text-muted">該当する商品がありません</div>
          ) : (
            (() => {
              const grouped = filteredRecipes.reduce((acc, r) => {
                const cat = r.category_name;
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(r);
                return acc;
              }, {});
              return Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div className="px-4 py-1.5 bg-surface-sunken text-2xs font-semibold text-muted uppercase tracking-wider border-b border-line">
                    {cat}
                  </div>
                  {items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className={cn('w-full text-left px-4 py-2.5 border-b border-line transition-colors cursor-pointer', selectedId === item.id ? 'bg-primary-50' : 'hover:bg-surface-hover')}
                    >
                      <div className={cn('text-sm font-medium truncate', selectedId === item.id ? 'text-primary-700' : 'text-heading')}>
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted">¥{yen(item.base_price)}</span>
                        <CostBadge costPrice={item.cost_price} basePrice={item.base_price} />
                      </div>
                    </button>
                  ))}
                </div>
              ));
            })()
          )}
        </div>
      </div>

      {/* 右ペイン: レシピ詳細 */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedId ? (
          <div className="flex items-center justify-center h-64 text-muted text-sm">左から商品を選択してください</div>
        ) : !detail ? (
          <div className="text-sm text-muted p-4">読み込み中...</div>
        ) : (
          <div className="max-w-2xl">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-xl font-bold text-heading">{detail.menu_item_name}</h2>
                {selectedItem && (
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-muted">販売価格 ¥{yen(selectedItem.base_price)}</span>
                    {detail.total_cost > 0 && (
                      <>
                        <span className="text-sm text-amber-600">原価 ¥{yen(Math.round(detail.total_cost))}</span>
                        <CostBadge costPrice={detail.total_cost} basePrice={selectedItem.base_price} />
                      </>
                    )}
                  </div>
                )}
              </div>
              {editIngredients === null && (
                <Button size="sm" onClick={startEdit}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  編集
                </Button>
              )}
            </div>

            {/* 表示モード */}
            {editIngredients === null ? (
              <>
                {detail.ingredients.length === 0 ? (
                  <div className="bg-surface-sunken rounded-xl border border-line p-8 text-center text-muted text-sm">
                    レシピ未登録。「編集」から材料を追加してください。
                  </div>
                ) : (
                  <div className="bg-surface rounded-xl border border-line overflow-x-auto mb-4">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-line bg-surface-sunken">
                          <th scope="col" className="text-left py-2 px-4 text-2xs font-semibold text-muted uppercase tracking-wider">材料</th>
                          <th scope="col" className="text-right py-2 px-4 text-2xs font-semibold text-muted uppercase tracking-wider">使用量</th>
                          <th scope="col" className="text-right py-2 px-4 text-2xs font-semibold text-muted uppercase tracking-wider">1杯あたり原価</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.ingredients.map((ing, idx) => (
                          <tr key={ing.ingredient_id} className={idx < detail.ingredients.length - 1 ? 'border-b border-line' : ''}>
                            <td className="py-2.5 px-4 text-sm font-medium text-heading">{ing.ingredient_name}</td>
                            <td className="py-2.5 px-4 text-sm text-body text-right">{ing.usage_quantity} {ing.quantity_unit}</td>
                            <td className="py-2.5 px-4 text-sm text-amber-600 text-right">¥{ing.cost_contribution != null ? yen(Math.round(ing.cost_contribution)) : '-'}</td>
                          </tr>
                        ))}
                        <tr className="bg-amber-50 border-t border-amber-100">
                          <td colSpan={2} className="py-2.5 px-4 text-sm font-semibold text-amber-800">合計原価</td>
                          <td className="py-2.5 px-4 text-sm font-bold text-amber-700 text-right">¥{yen(Math.round(detail.total_cost))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {detail.recipe_notes && (
                  <div className="bg-surface-sunken rounded-xl border border-line p-4">
                    <p className="text-xs font-semibold text-muted mb-1.5">作り方メモ</p>
                    <p className="text-sm text-body whitespace-pre-wrap">{detail.recipe_notes}</p>
                  </div>
                )}
              </>
            ) : (
              /* 編集モード */
              <div className="space-y-5">
                <div className="bg-surface rounded-xl border border-line overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-line bg-surface-sunken">
                    <p className="text-xs font-semibold text-muted">材料リスト</p>
                  </div>
                  {editIngredients.length === 0 ? (
                    <div className="p-4 text-sm text-muted text-center">材料が登録されていません</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-line">
                            <th scope="col" className="text-left py-2 px-4 text-2xs font-medium text-muted">材料</th>
                            <th scope="col" className="text-center py-2 px-4 text-2xs font-medium text-muted">使用量</th>
                            <th scope="col" className="text-right py-2 px-4 text-2xs font-medium text-muted">原価</th>
                            <th scope="col" className="py-2 px-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {editIngredients.map((ei, idx) => {
                            const ing = ingredients.find(i => i.id === ei.ingredient_id);
                            const cost = ing && ing.purchase_quantity
                              ? (Number(ei.usage_quantity) * ing.cost_per_purchase_unit / ing.purchase_quantity) : 0;
                            return (
                              <tr key={ei.ingredient_id} className={idx < editIngredients.length - 1 ? 'border-b border-line' : ''}>
                                <td className="py-2 px-4 text-sm text-heading">{ei.ingredient_name}</td>
                                <td className="py-2 px-4">
                                  <div className="flex items-center gap-1 justify-center">
                                    <Input size="sm" type="number" min="0" step="any" className="w-20 text-center" value={ei.usage_quantity} onChange={(e) => updateQty(ei.ingredient_id, e.target.value)} />
                                    <span className="text-xs text-muted">{ei.quantity_unit}</span>
                                  </div>
                                </td>
                                <td className="py-2 px-4 text-sm text-amber-600 text-right">¥{yen(Math.round(cost))}</td>
                                <td className="py-2 px-2">
                                  <button onClick={() => removeIngredient(ei.ingredient_id)} className="w-6 h-6 inline-flex items-center justify-center text-muted hover:text-danger rounded cursor-pointer" aria-label="削除">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <IngredientPicker
                    available={ingredients.filter(i => !editIngredients.find(ei => ei.ingredient_id === i.id))}
                    categories={ingCategories}
                    onAdd={addIngredient}
                  />
                </div>

                {editIngredients.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-amber-800">推定合計原価</span>
                    <span className="text-base font-bold text-amber-700">
                      ¥{yen(Math.round(calcCost(editIngredients)))}
                      {selectedItem && selectedItem.base_price > 0 && (
                        <span className="text-sm font-normal ml-2 text-amber-600">（原価率 {Math.round(calcCost(editIngredients) / selectedItem.base_price * 100)}%）</span>
                      )}
                    </span>
                  </div>
                )}

                <Field label="作り方メモ（任意）">
                  <Textarea rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="例: グラスに氷を入れ、ウイスキーを注ぎ、炭酸水で割る" className="resize-none" />
                </Field>

                {saveError && <Alert tone="danger">{saveError}</Alert>}

                <div className="flex items-center gap-2 justify-end">
                  <Button variant="secondary" onClick={cancelEdit}>キャンセル</Button>
                  <Button loading={saving} onClick={handleSave}>保存</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
