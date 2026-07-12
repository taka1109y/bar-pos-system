import { useState, useRef, useMemo } from 'react';
import { yen, num } from '../../utils/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
    price_editable:  item?.price_editable ?? false,
    question_text:    item?.question_text || '',
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
      price_editable:  Boolean(form.price_editable),
      question_text:    qText || null,
      question_choices: qText ? qChoices : null,
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
          <p className="text-base font-bold text-amber-700">¥{yen(Math.round(item.cost_price))}</p>
          {item.base_price > 0 && (
            <p className="text-xs text-amber-600 mt-0.5">
              原価率 {Math.round(item.cost_price / item.base_price * 100)}%
              ／粗利 ¥{yen(Math.round(item.base_price - item.cost_price))}
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
        <label className="flex items-center gap-2 cursor-pointer mt-3">
          <input
            type="checkbox"
            checked={Boolean(form.price_editable)}
            onChange={(e) => set('price_editable', e.target.checked)}
            className="w-4 h-4 accent-amber-600 rounded"
          />
          <span className="text-sm text-slate-700">価格変更可（時価）：注文時に価格・商品名を編集</span>
        </label>
        {form.price_editable && (
          <p className="text-xs text-amber-600 mt-1 ml-6">スタッフ注文画面でタップ時に価格・商品名の入力画面が表示されます</p>
        )}
      </div>
      <div className="border-t border-slate-100 pt-3">
        <label className={lbl}>追加質問（任意）</label>
        <input
          className={inp}
          value={form.question_text}
          onChange={(e) => set('question_text', e.target.value)}
          placeholder="例: ソースの種類をお選びください（空欄なら質問なし）"
          maxLength={200}
        />
        {form.question_text.trim() && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-slate-500">選択肢（2つ以上）・追加料金は0円可</p>
            {form.question_choices.map((choice, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={inp}
                  value={choice.label}
                  onChange={(e) => {
                    const next = [...form.question_choices];
                    next[i] = { ...next[i], label: e.target.value };
                    set('question_choices', next);
                  }}
                  maxLength={50}
                  placeholder={`選択肢 ${i + 1}`}
                />
                <div className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden flex-shrink-0 focus-within:ring-2 focus-within:ring-primary-500/50 focus-within:border-primary-500" style={{ width: 110 }}>
                  <span className="pl-2 pr-1 text-slate-400 text-sm">+¥</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    value={choice.priceDelta}
                    onChange={(e) => {
                      const next = [...form.question_choices];
                      next[i] = { ...next[i], priceDelta: e.target.value };
                      set('question_choices', next);
                    }}
                    placeholder="0"
                    className="flex-1 w-0 bg-transparent px-1 py-2 text-slate-900 text-sm focus:outline-none caret-primary-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => set('question_choices', form.question_choices.filter((_, idx) => idx !== i))}
                  className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-lg"
                  title="削除"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set('question_choices', [...form.question_choices, { label: '', priceDelta: 0 }])}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              ＋ 選択肢を追加
            </button>
            {questionError && <p className="text-xs text-red-600">{questionError}</p>}
          </div>
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

// ─── 並び替え可能な商品行 ─────────────────────────────
function SortableMenuItemRow({ item, idx, dragDisabled, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: dragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 px-6 py-5 ${item.is_active ? '' : 'opacity-40'} ${idx !== 0 ? 'border-t border-slate-50' : ''}`}
    >
      {!dragDisabled && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
          aria-label="ドラッグして並び替え"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
            <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
          </svg>
        </button>
      )}
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
          ¥{yen(item.base_price)}
          {item.cost_price > 0 && (
            <span className="ml-2 text-amber-500">
              原価¥{yen(item.cost_price)} ({Math.round(item.cost_price / item.base_price * 100)}%)
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
      {item.price_editable && (
        <span className="text-xs px-2.5 py-1.5 rounded-full bg-amber-50 text-amber-700 font-medium flex-shrink-0">
          時価
        </span>
      )}
      {item.question_text && (
        <span className="text-xs px-2.5 py-1.5 rounded-full bg-primary-50 text-primary-700 font-medium flex-shrink-0">
          質問あり
        </span>
      )}
      {!item.is_active && (
        <span className="text-xs px-3 py-1.5 rounded-full bg-slate-100 text-slate-400 flex-shrink-0">
          無効
        </span>
      )}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onEdit}
          className="w-9 h-9 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 cursor-pointer"
          title="編集"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button
          onClick={onDelete}
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
  // listItemsはドロップが発生したグループの商品配列（DndContextごとに固定）。
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
            {displayGroupedByCat.reduce((n, c) => n + c.subGroups.reduce((m, sg) => m + sg.items.length, 0), 0)} 件
            ・検索中は並び替えできません
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
      {search.trim() && displayGroupedByCat.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400 text-sm">「{search}」に一致する商品がありません</p>
        </div>
      )}
      <div className="space-y-10">
        {displayGroupedByCat.map((catGroup) => (
          <div key={catGroup.category.id}>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-700 tracking-wide">{catGroup.category.name}</h3>
              <span className="text-xs text-slate-400">
                ({catGroup.subGroups.reduce((n, sg) => n + sg.items.length, 0)}件)
              </span>
            </div>
            <div className="space-y-5">
              {catGroup.subGroups.map((sg) => (
                <div key={sg.id}>
                  {sg.label && (
                    <p className="text-xs font-semibold text-slate-500 mb-2 ml-1">{sg.label}</p>
                  )}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    {sg.items.length === 0 ? (
                      <p className="px-6 py-5 text-sm text-slate-400">商品がありません</p>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) => handleDragEnd(event, sg.items)}
                      >
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
