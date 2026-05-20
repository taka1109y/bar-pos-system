import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1';

function CostBadge({ costPrice, basePrice }) {
  if (!costPrice || !basePrice) return <span className="text-xs text-slate-400">未設定</span>;
  const rate = Math.round((costPrice / basePrice) * 100);
  const color = rate < 30 ? 'bg-emerald-50 text-emerald-700' : rate < 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
      原価率 {rate}%
    </span>
  );
}

export default function RecipePage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [editIngredients, setEditIngredients] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [addIngId, setAddIngId] = useState('');
  const [addQty, setAddQty] = useState('');
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
    setAddIngId('');
    setAddQty('');
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

  const addIngredient = () => {
    if (!addIngId || !addQty || Number(addQty) <= 0) return;
    const ing = ingredients.find(i => i.id === Number(addIngId));
    if (!ing || editIngredients.find(i => i.ingredient_id === ing.id)) return;
    setEditIngredients(prev => [
      ...prev,
      { ingredient_id: ing.id, ingredient_name: ing.name, usage_quantity: Number(addQty), quantity_unit: ing.quantity_unit, cost_contribution: null },
    ]);
    setAddIngId('');
    setAddQty('');
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

  return (
    <div className="flex h-full min-h-0">
      {/* 左ペイン: 商品一覧 */}
      <div className="w-72 flex-shrink-0 border-r border-slate-200 flex flex-col bg-white">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">商品一覧</h2>
          <p className="text-xs text-slate-500 mt-0.5">商品を選択してレシピを編集</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {recipesLoading ? (
            <div className="p-4 text-sm text-slate-400">読み込み中...</div>
          ) : recipes.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">商品がありません</div>
          ) : (
            (() => {
              const grouped = recipes.reduce((acc, r) => {
                const cat = r.category_name;
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(r);
                return acc;
              }, {});
              return Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div className="px-4 py-1.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    {cat}
                  </div>
                  {items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className={`w-full text-left px-4 py-2.5 border-b border-slate-100 transition-colors ${selectedId === item.id ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className="text-sm font-medium truncate ${selectedId === item.id ? 'text-primary-700' : 'text-slate-900'}">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500">¥{item.base_price.toLocaleString()}</span>
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
          <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
            左から商品を選択してください
          </div>
        ) : !detail ? (
          <div className="text-sm text-slate-400 p-4">読み込み中...</div>
        ) : (
          <div className="max-w-2xl">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{detail.menu_item_name}</h2>
                {selectedItem && (
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-sm text-slate-500">販売価格 ¥{selectedItem.base_price.toLocaleString()}</span>
                    {detail.total_cost > 0 && (
                      <>
                        <span className="text-sm text-amber-600">原価 ¥{Math.round(detail.total_cost).toLocaleString()}</span>
                        <CostBadge costPrice={detail.total_cost} basePrice={selectedItem.base_price} />
                      </>
                    )}
                  </div>
                )}
              </div>
              {editIngredients === null && (
                <button
                  onClick={startEdit}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  編集
                </button>
              )}
            </div>

            {/* 表示モード */}
            {editIngredients === null ? (
              <>
                {detail.ingredients.length === 0 ? (
                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
                    レシピ未登録。「編集」から材料を追加してください。
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200 bg-gray-50">
                          <th scope="col" className="text-left py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">材料</th>
                          <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">使用量</th>
                          <th scope="col" className="text-right py-2.5 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">1杯あたり原価</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.ingredients.map((ing, idx) => (
                          <tr key={ing.ingredient_id} className={idx < detail.ingredients.length - 1 ? 'border-b border-slate-100' : ''}>
                            <td className="py-3 px-4 text-sm font-medium text-slate-900">{ing.ingredient_name}</td>
                            <td className="py-3 px-4 text-sm text-slate-600 text-right">{ing.usage_quantity} {ing.quantity_unit}</td>
                            <td className="py-3 px-4 text-sm text-amber-600 text-right">
                              ¥{ing.cost_contribution != null ? Math.round(ing.cost_contribution).toLocaleString() : '-'}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-amber-50 border-t border-amber-100">
                          <td colSpan={2} className="py-2.5 px-4 text-sm font-semibold text-amber-800">合計原価</td>
                          <td className="py-2.5 px-4 text-sm font-bold text-amber-700 text-right">
                            ¥{Math.round(detail.total_cost).toLocaleString()}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {detail.recipe_notes && (
                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                    <p className="text-xs font-semibold text-slate-500 mb-1.5">作り方メモ</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{detail.recipe_notes}</p>
                  </div>
                )}
              </>
            ) : (
              /* 編集モード */
              <div className="space-y-5">
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 bg-gray-50">
                    <p className="text-xs font-semibold text-slate-600">材料リスト</p>
                  </div>
                  {editIngredients.length === 0 ? (
                    <div className="p-4 text-sm text-slate-400 text-center">材料が登録されていません</div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th scope="col" className="text-left py-2 px-4 text-xs font-medium text-slate-500">材料</th>
                          <th scope="col" className="text-center py-2 px-4 text-xs font-medium text-slate-500">使用量</th>
                          <th scope="col" className="text-right py-2 px-4 text-xs font-medium text-slate-500">原価</th>
                          <th scope="col" className="py-2 px-2 w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {editIngredients.map((ei, idx) => {
                          const ing = ingredients.find(i => i.id === ei.ingredient_id);
                          const cost = ing && ing.purchase_quantity
                            ? (Number(ei.usage_quantity) * ing.cost_per_purchase_unit / ing.purchase_quantity) : 0;
                          return (
                            <tr key={ei.ingredient_id} className={idx < editIngredients.length - 1 ? 'border-b border-slate-100' : ''}>
                              <td className="py-2 px-4 text-sm text-slate-900">{ei.ingredient_name}</td>
                              <td className="py-2 px-4">
                                <div className="flex items-center gap-1 justify-center">
                                  <input
                                    type="number" min="0" step="any"
                                    value={ei.usage_quantity}
                                    onChange={(e) => updateQty(ei.ingredient_id, e.target.value)}
                                    className="w-20 border border-slate-300 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary-500"
                                  />
                                  <span className="text-xs text-slate-500">{ei.quantity_unit}</span>
                                </div>
                              </td>
                              <td className="py-2 px-4 text-sm text-amber-600 text-right">¥{Math.round(cost).toLocaleString()}</td>
                              <td className="py-2 px-2">
                                <button onClick={() => removeIngredient(ei.ingredient_id)} className="w-6 h-6 inline-flex items-center justify-center text-slate-400 hover:text-red-500 rounded" aria-label="削除">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
                    <p className="text-xs font-medium text-slate-500 mb-2">材料を追加</p>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <select value={addIngId} onChange={(e) => setAddIngId(e.target.value)} className={`${inp} text-sm`}>
                          <option value="">材料を選択...</option>
                          {ingredients
                            .filter(i => !editIngredients.find(ei => ei.ingredient_id === i.id))
                            .map(i => <option key={i.id} value={i.id}>{i.name}（{i.quantity_unit}）</option>)}
                        </select>
                      </div>
                      <div className="w-24">
                        <input type="number" min="0" step="any" placeholder="量" value={addQty} onChange={(e) => setAddQty(e.target.value)} className={`${inp} text-sm`} />
                      </div>
                      <button onClick={addIngredient} disabled={!addIngId || !addQty} className="h-9 px-3 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        追加
                      </button>
                    </div>
                  </div>
                </div>

                {editIngredients.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-amber-800">推定合計原価</span>
                    <span className="text-base font-bold text-amber-700">
                      ¥{Math.round(calcCost(editIngredients)).toLocaleString()}
                      {selectedItem && selectedItem.base_price > 0 && (
                        <span className="text-sm font-normal ml-2 text-amber-600">
                          （原価率 {Math.round(calcCost(editIngredients) / selectedItem.base_price * 100)}%）
                        </span>
                      )}
                    </span>
                  </div>
                )}

                <div>
                  <label className={lbl}>作り方メモ（任意）</label>
                  <textarea rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="例: グラスに氷を入れ、ウイスキーを注ぎ、炭酸水で割る" className={`${inp} resize-none`} />
                </div>

                {saveError && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{saveError}</div>}

                <div className="flex items-center gap-3 justify-end">
                  <button onClick={cancelEdit} className="h-9 px-4 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50 transition-colors">キャンセル</button>
                  <button onClick={handleSave} disabled={saving} className="h-9 px-4 text-sm font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
