import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

// 保存済みファイル名 → 表示用 URL に変換
function toImageSrc(filename) {
  if (!filename) return null;
  return filename.startsWith('http') ? filename : `/uploads/${filename}`;
}

const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className={`bg-white rounded-xl shadow-xl w-full mx-4 border border-slate-200 max-h-[90vh] flex flex-col ${wide ? 'max-w-lg' : 'max-w-md'}`}>
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
    crash_enabled:   item?.crash_enabled ?? false,
    is_drink:        item?.is_drink ?? 1,
    is_active:       item?.is_active ?? 1,
    image_url:       item?.image_url || '',  // DBに保存されているファイル名
    tax_category:    item?.tax_category || 'standard',
    is_staff_only:   item?.is_staff_only ?? false,
  });

  // 新たに選択した画像ファイルとプレビューURL
  const [pendingFile, setPendingFile]       = useState(null);
  const [previewSrc,  setPreviewSrc]        = useState(toImageSrc(item?.image_url));
  const [uploadError, setUploadError]       = useState('');
  const [uploading,   setUploading]         = useState(false);
  const fileInputRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleCategoryChange = (catId) => {
    set('category_id', catId);
    set('subcategory_id', '');
  };

  const filteredSubcats = subcategories.filter(
    (s) => String(s.category_id) === String(form.category_id)
  );

  // ファイル選択時: プレビューのみ更新し、アップロードは保存時に行う
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setPendingFile(file);
    setPreviewSrc(URL.createObjectURL(file));
  };

  // 画像を削除（DB上の画像名をクリア）
  const handleRemoveImage = () => {
    setPendingFile(null);
    setPreviewSrc(null);
    set('image_url', '');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setUploadError('');

    let imageFilename = form.image_url;

    // 新しいファイルが選択されている場合はアップロード
    if (pendingFile) {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('image', pendingFile);
        const result = await api.uploadMenuImage(fd);
        imageFilename = result.filename;
      } catch (err) {
        setUploadError(err.message || '画像のアップロードに失敗しました');
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    onSave({
      ...form,
      category_id:     Number(form.category_id),
      subcategory_id:  form.subcategory_id ? Number(form.subcategory_id) : null,
      base_price:      Number(form.base_price),
      min_price:       Number(form.min_price) || Number(form.base_price) * 0.7,
      max_price:       Number(form.max_price) || Number(form.base_price) * 2.0,
      price_step_up:   Number(form.price_step_up),
      price_step_down: Number(form.price_step_down),
      crash_enabled:   Boolean(form.crash_enabled),
      is_drink:        Number(form.is_drink),
      is_active:       Number(form.is_active),
      image_url:       imageFilename || null,
      tax_category:    form.tax_category,
      is_staff_only:   Boolean(form.is_staff_only),
    });
  };

  const isBusy = isLoading || uploading;

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

      {/* 画像アップロード */}
      <div>
        <label className={lbl}>商品画像（任意・5MB以下）</label>
        {previewSrc ? (
          <div className="flex items-start gap-3">
            <img
              src={previewSrc}
              alt="プレビュー"
              className="h-24 w-24 object-cover rounded-lg border border-slate-200 flex-shrink-0"
              onError={(e) => { e.currentTarget.style.opacity = '0.3'; }}
            />
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-11 px-4 text-sm font-medium bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                画像を変更
              </button>
              <button
                type="button"
                onClick={handleRemoveImage}
                className="h-11 px-4 text-sm font-medium bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 cursor-pointer"
              >
                画像を削除
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-24 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:border-primary-400 hover:text-primary-500 transition-colors cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span className="text-xs font-medium">クリックして画像を選択</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {uploadError && (
          <p className="text-xs text-red-600 mt-1.5">{uploadError}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>カテゴリ</label>
          <div className="relative">
            <select className={`${inp} appearance-none pr-8`} value={form.category_id} onChange={(e) => handleCategoryChange(e.target.value)}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        <div>
          <label className={lbl}>サブカテゴリ</label>
          <div className="relative">
            <select className={`${inp} appearance-none pr-8`} value={form.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)}>
              <option value="">なし（価格競合なし）</option>
              {filteredSubcats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
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
      {item && item.cost_price > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-700 mb-1">原価（レシピから自動計算）</p>
          <p className="text-base font-bold text-amber-700">¥{Math.round(item.cost_price).toLocaleString()}</p>
          {item.base_price > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">
              原価率 {Math.round(item.cost_price / item.base_price * 100)}%
              ／粗利 ¥{Math.round(item.base_price - item.cost_price).toLocaleString()}
            </p>
          )}
          <p className="text-xs text-amber-500 mt-1">レシピ管理で材料を設定すると更新されます</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>種別</label>
          <div className="flex gap-3">
            {[{ value: 1, label: 'ドリンク' }, { value: 0, label: 'フード' }].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => set('is_drink', value)}
                className={`flex-1 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                  form.is_drink === value
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={lbl}>税率区分</label>
          <div className="flex gap-3">
            {[{ value: 'standard', label: '標準 (10%)' }, { value: 'reduced', label: '軽減 (8%)' }].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => set('tax_category', value)}
                className={`flex-1 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                  form.tax_category === value
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {item && (
          <div>
            <label className={lbl}>状態</label>
            <div className="flex gap-3">
              {[{ value: 1, label: '有効' }, { value: 0, label: '無効' }].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('is_active', value)}
                  className={`flex-1 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                    form.is_active === value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {Boolean(form.is_drink) && (
        <div className="grid grid-cols-2 gap-3 bg-primary-50 border border-primary-100 rounded-lg p-3">
          <div>
            <label className={lbl}>1注文あたり上昇額 (¥)</label>
            <input className={inp} type="number" value={form.price_step_up} onChange={(e) => set('price_step_up', e.target.value)} placeholder="50" min={1} step={1} />
          </div>
          <div>
            <label className={lbl}>1競合注文あたり降下額 (¥)</label>
            <input className={inp} type="number" value={form.price_step_down} onChange={(e) => set('price_step_down', e.target.value)} placeholder="25" min={1} step={1} />
          </div>
          <div className="col-span-2 pt-1 border-t border-primary-100">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(form.crash_enabled)}
                onChange={(e) => set('crash_enabled', e.target.checked)}
                className="w-4 h-4 accent-red-600 rounded"
              />
              暴落許可（株価暴落の対象にする）
            </label>
          </div>
        </div>
      )}
      <div className="border-t border-slate-100 pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(form.is_staff_only)}
            onChange={(e) => set('is_staff_only', e.target.checked)}
            className="w-4 h-4 accent-amber-600 rounded"
          />
          <span className="text-sm text-slate-700">従業員専用（お客様注文画面に表示しない）</span>
        </label>
        {form.is_staff_only && (
          <p className="text-xs text-amber-600 mt-1 ml-6">この商品はPOS画面にのみ表示されます</p>
        )}
      </div>
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onCancel} disabled={isBusy} className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          キャンセル
        </button>
        <button type="submit" disabled={isBusy} className="flex-1 py-4 bg-primary-500 hover:bg-primary-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50">
          {uploading ? 'アップロード中...' : isLoading ? '保存中...' : '保存'}
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
  const [search, setSearch] = useState('');

  const { data: items         = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });
  const { data: categories    = [] } = useQuery({ queryKey: ['categories-staff'], queryFn: api.getStaffCategories });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['menu-all'] });

  const createMutation = useMutation({ mutationFn: api.createMenuItem, onSuccess: () => { invalidate(); setAddOpen(false); } });
  const updateMutation = useMutation({ mutationFn: ({ id, data }) => api.updateMenuItem(id, data), onSuccess: () => { invalidate(); setEditItem(null); } });
  const deleteMutation = useMutation({ mutationFn: api.deleteMenuItem, onSuccess: invalidate });

  const grouped = categories.reduce((acc, cat) => {
    acc[cat.id] = { ...cat, items: items.filter((i) => i.category_id === cat.id) };
    return acc;
  }, {});

  const displayGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    const result = {};
    Object.values(grouped).forEach((cat) => {
      const matched = cat.items.filter((item) => item.name.toLowerCase().includes(q));
      if (matched.length > 0) result[cat.id] = { ...cat, items: matched };
    });
    return result;
  }, [grouped, search]);

  return (
    <div className="px-8 py-12 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">商品管理</h1>
        <p className="text-base text-body leading-relaxed mt-2">メニュー商品の追加・編集・削除</p>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            placeholder="商品名で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors"
          />
        </div>
        {search.trim() && (
          <span className="text-xs text-slate-400 flex-shrink-0">
            {Object.values(displayGrouped).reduce((n, c) => n + c.items.length, 0)} 件
          </span>
        )}
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer flex-shrink-0"
        >
          + 商品を追加
        </button>
      </div>

      {/* カテゴリ別商品一覧 */}
      {search.trim() && Object.values(displayGrouped).length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400 text-sm">「{search}」に一致する商品がありません</p>
        </div>
      )}
      <div className="space-y-10">
        {Object.values(displayGrouped).map((cat) => (
          <div key={cat.id}>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-700 tracking-wide">{cat.name}</h3>
              <span className="text-xs text-slate-400">({cat.items.length}件)</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {cat.items.length === 0 ? (
                <p className="px-6 py-5 text-sm text-slate-400">商品がありません</p>
              ) : (
                cat.items.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 px-6 py-5 ${item.is_active ? '' : 'opacity-40'} ${idx !== 0 ? 'border-t border-slate-50' : ''}`}
                  >
                    {toImageSrc(item.image_url) ? (
                      <img
                        src={toImageSrc(item.image_url)}
                        alt={item.name}
                        className="w-10 h-10 object-cover rounded-lg border border-slate-100 flex-shrink-0"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-10 h-10 bg-slate-100 rounded-lg flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-slate-900 block truncate">{item.name}</span>
                      <span className="text-xs text-slate-400 mt-1 block">
                        ¥{item.base_price.toLocaleString()}
                        {item.cost_price > 0 && (
                          <span className="ml-2 text-amber-500">
                            原価¥{item.cost_price.toLocaleString()} ({Math.round(item.cost_price / item.base_price * 100)}%)
                          </span>
                        )}
                        {item.subcategory_name && (
                          <span className="ml-2 text-primary-400">{item.subcategory_name}</span>
                        )}
                      </span>
                    </div>
                    <span className={`text-xs px-3 py-1.5 rounded-full font-medium flex-shrink-0 ${
                      item.is_drink ? 'bg-primary-50 text-primary-600' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {item.is_drink ? 'ドリンク' : 'フード'}
                    </span>
                    <span className={`text-xs px-2.5 py-1.5 rounded-full font-medium flex-shrink-0 ${
                      item.tax_category === 'reduced'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-slate-50 text-slate-500'
                    }`}>
                      {item.tax_category === 'reduced' ? '軽減8%' : '標準10%'}
                    </span>
                    {item.is_staff_only && (
                      <span className="text-xs px-2.5 py-1.5 rounded-full bg-slate-100 text-slate-700 font-medium flex-shrink-0">
                        従業員専用
                      </span>
                    )}
                    {!item.is_active && (
                      <span className="text-xs px-3 py-1.5 rounded-full bg-slate-100 text-slate-400 flex-shrink-0">
                        無効
                      </span>
                    )}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        onClick={() => setEditItem(item)}
                        className="w-9 h-9 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 cursor-pointer"
                        title="編集"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => { if (confirm(`「${item.name}」を削除しますか？`)) deleteMutation.mutate(item.id); }}
                        className="w-9 h-9 flex items-center justify-center border border-red-200 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 cursor-pointer"
                        title="削除"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/>
                        </svg>
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
