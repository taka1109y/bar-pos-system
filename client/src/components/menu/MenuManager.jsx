import { useState, useRef, useMemo } from 'react';
import { yen } from '../../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Modal, Field, Input, Select, Segmented, Badge } from '../ui';

// 保存済みファイル名 → 表示用 URL に変換
function toImageSrc(filename) {
  if (!filename) return null;
  return filename.startsWith('http') ? filename : `/uploads/${filename}`;
}

const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
);
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
);

// ─── フォームコンポーネント(ロジック不変・体裁のみ ui 化) ───
function MenuItemForm({ item, categories, subcategories, onSave, onCancel, isLoading }) {
  const [form, setForm] = useState({
    name:            item?.name || '',
    category_id:     item?.category_id || categories[0]?.id || '',
    subcategory_id:  item?.subcategory_id || '',
    base_price:      item?.base_price || '',
    engine_enabled:  item?.engine_enabled ?? true,
    crash_eligible:  item?.crash_eligible ?? true,
    is_drink:        item?.is_drink ?? 1,
    is_active:       item?.is_active ?? 1,
    image_url:       item?.image_url || '',  // DBに保存されているファイル名
    tax_category:    item?.tax_category || 'standard',
    is_staff_only:   item?.is_staff_only ?? false,
    price_editable:  item?.price_editable ?? false,
    question_text:    item?.question_text || '',
    question_allow_multiple: item?.question_allow_multiple || false,
    question_allow_quantity: item?.question_allow_quantity || false,
    question_choices: (item?.question_choices || []).map((c) =>
      typeof c === 'string' ? { label: c, priceDelta: 0 } : { label: c.label ?? '', priceDelta: c.priceDelta ?? 0 }
    ),
  });
  const [questionError, setQuestionError] = useState('');

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
    setQuestionError('');

    const qText = form.question_text.trim();
    let qChoices = [];
    if (qText) {
      const seen = new Set();
      for (const c of form.question_choices) {
        const label = c.label.trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        const priceDelta = Number(c.priceDelta);
        qChoices.push({ label, priceDelta: Number.isFinite(priceDelta) ? Math.round(priceDelta) : 0 });
      }
    }
    if (qText && qChoices.length < 2) {
      setQuestionError('選択肢を2つ以上入力してください');
      return;
    }

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
      engine_enabled:  Boolean(form.engine_enabled),
      crash_eligible:  Boolean(form.crash_eligible),
      is_drink:        Number(form.is_drink),
      is_active:       Number(form.is_active),
      image_url:       imageFilename || null,
      tax_category:    form.tax_category,
      is_staff_only:   Boolean(form.is_staff_only),
      price_editable:  Boolean(form.price_editable),
      question_text:    qText || null,
      question_choices: qText ? qChoices : null,
      question_allow_multiple: qText ? Boolean(form.question_allow_multiple) : false,
      question_allow_quantity: qText ? Boolean(form.question_allow_quantity) : false,
    });
  };

  const isBusy = isLoading || uploading;

  // 価格フラグのバッジ(5状態)
  const selCat = categories.find((c) => String(c.id) === String(form.category_id));
  const isNonAlc = (selCat?.name || item?.category_name || '').includes('ノンアル');
  const eng = Boolean(form.engine_enabled), crash = Boolean(form.crash_eligible);
  const flagBadge = isNonAlc
    ? { tone: 'neutral', label: '定価（ノンアル）' }
    : eng && crash ? { tone: 'success', label: '変動＋暴落' }
    : eng && !crash ? { tone: 'info', label: '変動のみ' }
    : !eng && crash ? { tone: 'warning', label: '定価＋暴落（目玉枠）' }
    : { tone: 'neutral', label: '定価固定' };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="商品名" required>
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例: スーパードライ" required />
      </Field>

      {/* 画像アップロード */}
      <Field label="商品画像（任意・5MB以下）">
        {previewSrc ? (
          <div className="flex items-start gap-3">
            <img src={previewSrc} alt="プレビュー" className="h-24 w-24 object-cover rounded-lg border border-line flex-shrink-0"
              onError={(e) => { e.currentTarget.style.opacity = '0.3'; }} />
            <div className="flex flex-col gap-2">
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>画像を変更</Button>
              <Button type="button" variant="secondary" className="text-danger border-red-200 hover:bg-red-50" onClick={handleRemoveImage}>画像を削除</Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="w-full h-24 border-2 border-dashed border-line-strong rounded-lg flex flex-col items-center justify-center gap-1.5 text-muted hover:border-primary-400 hover:text-primary-500 transition-colors cursor-pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            <span className="text-xs font-medium">クリックして画像を選択</span>
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        {uploadError && <p className="text-xs text-danger mt-1.5">{uploadError}</p>}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="カテゴリ">
          <Select value={form.category_id} onChange={(e) => handleCategoryChange(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="サブカテゴリ">
          <Select value={form.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)}>
            <option value="">なし（価格競合なし）</option>
            {filteredSubcats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <Field label="基準価格">
          <Input type="number" prefix="¥" value={form.base_price} onChange={(e) => set('base_price', e.target.value)} placeholder="500" required min={0} />
        </Field>
      </div>

      {/* 下限/上限/呼値(段幅)は基準価格から自動計算（読み取り表示） */}
      {item && item.is_drink && item.max_price > item.min_price ? (
        <div className="bg-surface-sunken border border-line rounded-lg p-3 grid grid-cols-4 gap-2 text-center">
          <div><p className="text-2xs text-muted">下限</p><p className="text-sm font-bold text-heading">¥{yen(Math.round(item.min_price))}</p></div>
          <div><p className="text-2xs text-muted">上限</p><p className="text-sm font-bold text-heading">¥{yen(Math.round(item.max_price))}</p></div>
          <div><p className="text-2xs text-muted">呼値(段幅)</p><p className="text-sm font-bold text-heading">¥{yen(Math.round(item.price_step_up))}</p></div>
          <div><p className="text-2xs text-muted">現在</p><p className="text-sm font-bold text-primary-600">¥{yen(Math.round(item.current_price))}</p></div>
        </div>
      ) : (
        <p className="text-xs text-muted">下限・上限・呼値(段幅)は基準価格から自動計算されます（呼値ラダー）。自動変動の有無は下の「価格変動させる」で切り替えます。</p>
      )}

      {item && item.cost_price > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-700 mb-1">原価（レシピから自動計算）</p>
          <p className="text-base font-bold text-amber-700">¥{yen(Math.round(item.cost_price))}</p>
          {item.base_price > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">原価率 {Math.round(item.cost_price / item.base_price * 100)}% ／粗利 ¥{yen(Math.round(item.base_price - item.cost_price))}</p>
          )}
          <p className="text-xs text-amber-500 mt-1">レシピ管理で材料を設定すると更新されます</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="種別">
          <Segmented className="w-full [&>button]:flex-1" value={form.is_drink} onChange={(v) => set('is_drink', v)}
            options={[{ value: 1, label: 'ドリンク' }, { value: 0, label: 'フード' }]} />
        </Field>
        <Field label="税率区分">
          <Segmented className="w-full [&>button]:flex-1" value={form.tax_category} onChange={(v) => set('tax_category', v)}
            options={[{ value: 'standard', label: '標準 (10%)' }, { value: 'reduced', label: '軽減 (8%)' }]} />
        </Field>
        {item && (
          <Field label="状態">
            <Segmented className="w-full [&>button]:flex-1" value={form.is_active} onChange={(v) => set('is_active', v)}
              options={[{ value: 1, label: '有効' }, { value: 0, label: '無効' }]} />
          </Field>
        )}
      </div>

      {Boolean(form.is_drink) && (
        <div className="grid grid-cols-1 gap-3 bg-primary-50 border border-primary-100 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-heading">価格フラグ</span>
            <Badge tone={flagBadge.tone}>{flagBadge.label}</Badge>
          </div>
          <label className="flex items-center gap-2 text-sm text-body cursor-pointer">
            <input type="checkbox" checked={eng} onChange={(e) => set('engine_enabled', e.target.checked)} className="w-4 h-4 accent-primary-500 rounded" />
            価格変動させる（エンジンで自動変動。OFF＝定価固定）
          </label>
          <label className="flex items-center gap-2 text-sm text-body cursor-pointer">
            <input type="checkbox" checked={crash} onChange={(e) => set('crash_eligible', e.target.checked)} className="w-4 h-4 accent-red-600 rounded" />
            暴落対象（暴落発動の対象にする）
          </label>
        </div>
      )}

      <div className="border-t border-line pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={Boolean(form.is_staff_only)} onChange={(e) => set('is_staff_only', e.target.checked)} className="w-4 h-4 accent-amber-600 rounded" />
          <span className="text-sm text-body">従業員専用（お客様注文画面に表示しない）</span>
        </label>
        {form.is_staff_only && <p className="text-xs text-warning mt-1 ml-6">この商品はPOS画面にのみ表示されます</p>}
        <label className="flex items-center gap-2 cursor-pointer mt-3">
          <input type="checkbox" checked={Boolean(form.price_editable)} onChange={(e) => set('price_editable', e.target.checked)} className="w-4 h-4 accent-amber-600 rounded" />
          <span className="text-sm text-body">価格変更可（時価）：注文時に価格・商品名を編集</span>
        </label>
        {form.price_editable && <p className="text-xs text-warning mt-1 ml-6">スタッフ注文画面でタップ時に価格・商品名の入力画面が表示されます</p>}
      </div>

      <div className="border-t border-line pt-3">
        <Field label="追加質問（任意）">
          <Input value={form.question_text} onChange={(e) => set('question_text', e.target.value)}
            placeholder="例: ソースの種類をお選びください（空欄なら質問なし）" maxLength={200} />
        </Field>
        {form.question_text.trim() && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted">選択肢（2つ以上）・追加料金は0円可</p>
            {form.question_choices.map((choice, i) => (
              <div key={i} className="flex gap-2">
                <Input value={choice.label} maxLength={50} placeholder={`選択肢 ${i + 1}`}
                  onChange={(e) => { const next = [...form.question_choices]; next[i] = { ...next[i], label: e.target.value }; set('question_choices', next); }} />
                <Input type="number" inputMode="numeric" step={1} prefix="+¥" className="flex-shrink-0 w-28" value={choice.priceDelta} placeholder="0"
                  onChange={(e) => { const next = [...form.question_choices]; next[i] = { ...next[i], priceDelta: e.target.value }; set('question_choices', next); }} />
                <Button type="button" variant="ghost" size="md" iconOnly aria-label={`選択肢 ${i + 1} を削除`} title="削除" className="text-danger flex-shrink-0"
                  onClick={() => set('question_choices', form.question_choices.filter((_, idx) => idx !== i))}>×</Button>
              </div>
            ))}
            <button type="button" onClick={() => set('question_choices', [...form.question_choices, { label: '', priceDelta: 0 }])}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium cursor-pointer">＋ 選択肢を追加</button>
            <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
              <input type="checkbox" checked={form.question_allow_multiple} onChange={(e) => set('question_allow_multiple', e.target.checked)} className="w-4 h-4 accent-primary-500" />
              <span className="text-sm text-body">複数選択を許可（選んだ分を1明細にまとめ、追加料金を合算）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.question_allow_quantity} onChange={(e) => set('question_allow_quantity', e.target.checked)} className="w-4 h-4 accent-primary-500" />
              <span className="text-sm text-body">数量指定を許可（同じ選択肢を複数個・A×2 など。ONのとき複数選択より優先）</span>
            </label>
            {questionError && <p className="text-xs text-danger">{questionError}</p>}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isBusy}>キャンセル</Button>
        <Button type="submit" loading={isBusy}>{uploading ? 'アップロード中...' : isLoading ? '保存中...' : '保存'}</Button>
      </div>
    </form>
  );
}

// ─── 並び替え可能な商品行(dnd-kit維持・体裁のみ ui 化) ───
function SortableMenuItemRow({ item, idx, dragDisabled, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: dragDisabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-3 px-4 py-2 ${item.is_active ? '' : 'opacity-40'} ${idx !== 0 ? 'border-t border-line' : ''}`}>
      {!dragDisabled && (
        <button type="button" {...attributes} {...listeners}
          className="w-6 h-6 flex items-center justify-center text-faint hover:text-muted cursor-grab active:cursor-grabbing flex-shrink-0 touch-none" aria-label="ドラッグして並び替え">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
        </button>
      )}
      {toImageSrc(item.image_url) ? (
        <img src={toImageSrc(item.image_url)} alt={item.name} className="w-10 h-10 object-cover rounded-lg border border-line flex-shrink-0"
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : (
        <div className="w-10 h-10 bg-surface-sunken rounded-lg flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold text-heading block truncate">{item.name}</span>
        <span className="text-xs text-muted mt-0.5 block">
          ¥{yen(item.base_price)}
          {item.cost_price > 0 && <span className="ml-2 text-amber-500">原価¥{yen(item.cost_price)} ({Math.round(item.cost_price / item.base_price * 100)}%)</span>}
          {item.subcategory_name && <span className="ml-2 text-primary-500">{item.subcategory_name}</span>}
        </span>
      </div>
      <Badge tone={item.is_drink ? 'info' : 'neutral'}>{item.is_drink ? 'ドリンク' : 'フード'}</Badge>
      <Badge tone={item.tax_category === 'reduced' ? 'success' : 'neutral'}>{item.tax_category === 'reduced' ? '軽減8%' : '標準10%'}</Badge>
      {item.is_staff_only && <Badge tone="neutral">従業員専用</Badge>}
      {item.price_editable && <Badge tone="warning">時価</Badge>}
      {item.question_text && <Badge tone="info">質問あり</Badge>}
      {!item.is_active && <Badge tone="neutral">無効</Badge>}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button variant="secondary" size="sm" iconOnly aria-label={`${item.name} を編集`} title="編集" onClick={onEdit}><IconEdit /></Button>
        <Button variant="secondary" size="sm" iconOnly aria-label={`${item.name} を削除`} title="削除" className="text-danger border-red-200 hover:bg-red-50" onClick={onDelete}><IconTrash /></Button>
      </div>
    </div>
  );
}

// ─── 商品タブ本体(商品管理ビュー。ページ枠は親が供給) ───
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // カテゴリ→サブカテゴリ（+ サブカテゴリなしバケット）の階層グルーピング。
  // 実際の注文画面（MenuGrid.jsx）が category_id → subcategory_id の順でフィルタする構造と揃える。
  const groupedByCat = useMemo(() => categories.map((cat) => {
    const catItems   = items.filter((i) => i.category_id === cat.id);
    const catSubcats = subcategories.filter((s) => s.category_id === cat.id);

    let subGroups;
    if (catSubcats.length === 0) {
      subGroups = [{ id: `cat-${cat.id}-all`, label: null, items: catItems }];
    } else {
      subGroups = catSubcats.map((sub) => ({
        id: `sub-${sub.id}`,
        label: sub.name,
        items: catItems.filter((i) => i.subcategory_id === sub.id),
      }));
      const noSubItems = catItems.filter((i) => i.subcategory_id == null);
      if (noSubItems.length > 0) {
        subGroups.push({ id: `cat-${cat.id}-nosub`, label: 'サブカテゴリなし', items: noSubItems });
      }
    }

    return { category: cat, subGroups };
  }), [categories, subcategories, items]);

  const displayGroupedByCat = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groupedByCat;
    return groupedByCat
      .map((catGroup) => ({
        ...catGroup,
        subGroups: catGroup.subGroups
          .map((sg) => ({ ...sg, items: sg.items.filter((item) => item.name.toLowerCase().includes(q)) }))
          .filter((sg) => sg.items.length > 0),
      }))
      .filter((catGroup) => catGroup.subGroups.length > 0);
  }, [groupedByCat, search]);

  const dragDisabled = Boolean(search.trim());

  // ドラッグ&ドロップの並び替え。楽観的更新: 対象グループの商品を ['menu-all'] キャッシュ内の
  // 元の位置にドラッグ後の順で差し込み直す（サーバーの複合ORDER BYはクライアントで再現しない）。
  const reorderMutation = useMutation({
    mutationFn: (payload) => api.reorderMenuItems(payload.items),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['menu-all'] });
      const previous = queryClient.getQueryData(['menu-all']);
      queryClient.setQueryData(['menu-all'], (old) => {
        if (!old) return old;
        const idSet = new Set(payload.orderedIds);
        const sortOrderById = new Map(payload.items.map((it) => [it.id, it.sort_order]));
        const firstPos = old.findIndex((item) => idSet.has(item.id));
        const reorderedGroup = payload.orderedIds.map((id) => old.find((item) => item.id === id));
        const rest = old.filter((item) => !idSet.has(item.id));
        const result = [...rest];
        result.splice(firstPos, 0, ...reorderedGroup);
        return result.map((item) => (idSet.has(item.id) ? { ...item, sort_order: sortOrderById.get(item.id) } : item));
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['menu-all'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['menu-all'] }),
  });

  // 1つのSortableContext（同一サブカテゴリグループ）内でのドロップのみ扱う。
  const handleDragEnd = (event, listItems) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = listItems.findIndex((i) => i.id === active.id);
    const newIndex = listItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(listItems, oldIndex, newIndex);
    reorderMutation.mutate({
      items: reordered.map((item, idx) => ({ id: item.id, sort_order: idx })),
      orderedIds: reordered.map((item) => item.id),
    });
  };

  const searchIcon = (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-full max-w-xs">
          <Input type="search" placeholder="商品名で検索..." prefix={searchIcon} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {search.trim() && (
          <span className="text-xs text-muted flex-shrink-0">
            {displayGroupedByCat.reduce((n, c) => n + c.subGroups.reduce((m, sg) => m + sg.items.length, 0), 0)} 件・検索中は並び替えできません
          </span>
        )}
        <div className="ml-auto flex-shrink-0">
          <Button onClick={() => setAddOpen(true)}>＋ 商品を追加</Button>
        </div>
      </div>

      {/* カテゴリ別商品一覧 */}
      {search.trim() && displayGroupedByCat.length === 0 && (
        <div className="bg-surface rounded-xl border border-line p-12 text-center">
          <p className="text-muted text-sm">「{search}」に一致する商品がありません</p>
        </div>
      )}
      <div className="space-y-6">
        {displayGroupedByCat.map((catGroup) => (
          <div key={catGroup.category.id}>
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-line">
              <h3 className="text-sm font-bold text-heading tracking-wide">{catGroup.category.name}</h3>
              <span className="text-xs text-muted">({catGroup.subGroups.reduce((n, sg) => n + sg.items.length, 0)}件)</span>
            </div>
            <div className="space-y-4">
              {catGroup.subGroups.map((sg) => (
                <div key={sg.id}>
                  {sg.label && <p className="text-xs font-semibold text-muted mb-1.5 ml-1">{sg.label}</p>}
                  <div className="bg-surface rounded-xl border border-line overflow-hidden">
                    {sg.items.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted">商品がありません</p>
                    ) : (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(event, sg.items)}>
                        <SortableContext items={sg.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                          {sg.items.map((item, idx) => (
                            <SortableMenuItemRow
                              key={item.id}
                              item={item}
                              idx={idx}
                              dragDisabled={dragDisabled}
                              onEdit={() => setEditItem(item)}
                              onDelete={() => { if (confirm(`「${item.name}」を削除しますか？`)) deleteMutation.mutate(item.id); }}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 追加モーダル */}
      {addOpen && categories.length > 0 && (
        <Modal title="商品を追加" size="lg" onClose={() => setAddOpen(false)}>
          <MenuItemForm
            categories={categories}
            subcategories={subcategories}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setAddOpen(false)}
            isLoading={createMutation.isPending}
          />
        </Modal>
      )}

      {/* 編集モーダル */}
      {editItem && (
        <Modal title={`「${editItem.name}」を編集`} size="lg" onClose={() => setEditItem(null)}>
          <MenuItemForm
            item={editItem}
            categories={categories}
            subcategories={subcategories}
            onSave={(data) => updateMutation.mutate({ id: editItem.id, data })}
            onCancel={() => setEditItem(null)}
            isLoading={updateMutation.isPending}
          />
        </Modal>
      )}
    </div>
  );
}
