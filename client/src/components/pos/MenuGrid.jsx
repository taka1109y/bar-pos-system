import { useState, useEffect } from 'react';
import usePriceStore from '../../store/usePriceStore';
import Sparkline from './Sparkline';
import { yen } from '../../utils/format';
import { priceDisplay, centerPctLabel, PRICE_LEGEND } from '../../utils/priceTone';

// 暴落の残り時間(M:SS)を1秒毎に返す。endsAt が無効/過去なら null。
function useCrashRemain(endsAt) {
  const [now, setNow] = useState(() => Date.now());
  const end = endsAt ? new Date(endsAt).getTime() : 0;
  const active = end > now;
  useEffect(() => {
    if (!end) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [end]);
  if (!active) return null;
  const s = Math.max(0, Math.floor((end - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const CATEGORY_STYLES = {
  'ドリンク': { emoji: '🍺', gradient: 'linear-gradient(135deg,#7b4f0d,#c88820)', glow: 'rgba(200,136,32,0.3)' },
  'フード':   { emoji: '🍔', gradient: 'linear-gradient(135deg,#0d2e0d,#2e7d32)', glow: 'rgba(46,125,50,0.3)' },
};
const SUBCATEGORY_STYLES = {
  'ビール':        { emoji: '🍺', gradient: 'linear-gradient(135deg,#7b4f0d,#c88820)' },
  'カクテル':      { emoji: '🍹', gradient: 'linear-gradient(135deg,#5a0a3a,#c0286a)' },
  'ウイスキー':    { emoji: '🥃', gradient: 'linear-gradient(135deg,#3a1a06,#8b4513)' },
  'ソフトドリンク':{ emoji: '🥤', gradient: 'linear-gradient(135deg,#003d3a,#00a896)' },
  'サラダ':        { emoji: '🥗', gradient: 'linear-gradient(135deg,#0d2e0d,#2e7d32)' },
  'おつまみ':      { emoji: '🍢', gradient: 'linear-gradient(135deg,#3a1f00,#bf6000)' },
  '揚げ物':        { emoji: '🍟', gradient: 'linear-gradient(135deg,#3d2800,#e09000)' },
  'パスタ':        { emoji: '🍝', gradient: 'linear-gradient(135deg,#2e1a0e,#9b5e2a)' },
  'デザート':      { emoji: '🍨', gradient: 'linear-gradient(135deg,#2d0a3a,#8b2fc9)' },
};
const DEFAULT_STYLE = { emoji: '🍽️', gradient: 'linear-gradient(135deg,#1a1a2e,#3a3a5c)', glow: 'rgba(229,34,51,0.3)' };

function getCategoryStyle(name)    { return CATEGORY_STYLES[name]    ?? DEFAULT_STYLE; }
function getSubcategoryStyle(name) { return SUBCATEGORY_STYLES[name] ?? DEFAULT_STYLE; }

// ───────────────────────────────────────────
// 縦型カテゴリサイドバー（顧客画面用・named export）
// ───────────────────────────────────────────
export function CategorySidebar({
  categories, subcategories,
  activeCategory, setActiveCategory,
  activeSubcategory, setActiveSubcategory,
}) {
  const activeCat = activeCategory || categories[0]?.id;

  const handleSelectCategory = (catId) => {
    setActiveCategory(catId);
    setActiveSubcategory(null);
  };

  return (
    <div
      className="flex flex-col flex-shrink-0 overflow-y-auto scrollbar-dark"
      style={{ width: 160, background: '#0d0d14', borderRight: '1px solid #252532' }}
    >
      <div
        className="px-3 pt-4 pb-1 flex-shrink-0"
        style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: '2px', color: '#3a3a50' }}
      >
        CATEGORY
      </div>

      {categories.map((cat) => {
        const style    = getCategoryStyle(cat.name);
        const isActive = activeCat === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => handleSelectCategory(cat.id)}
            className="flex items-center justify-center text-center"
            style={{
              margin: '3px 8px', padding: '14px 8px', borderRadius: 12,
              background: isActive ? style.gradient : 'transparent',
              boxShadow: isActive ? `0 0 18px ${style.glow}` : 'none',
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            <span style={{ fontFamily: "'Noto Sans JP', sans-serif", fontSize: 14, fontWeight: 700, color: isActive ? '#fff' : '#7a7a90' }}>
              {cat.name}
            </span>
          </button>
        );
      })}

    </div>
  );
}

// ───────────────────────────────────────────
// 顧客画面用カード（iPad対応サイズ）
// ───────────────────────────────────────────
function CustomerMenuItem({ item, onAdd, categories, subcategories, crashRemain }) {
  const livePrice = usePriceStore((s) => s.prices[item.id]);
  const price     = livePrice?.current_price ?? item.current_price;
  const flash     = livePrice?.flash;
  // 色/▲▼は「寄り付き価格(中心)比」。定価比は使わない。暴落中は 'crash' で上書き。
  const disp      = priceDisplay(livePrice ?? item);
  const isUp      = disp.tone === 'up';
  const isDown    = disp.tone === 'down';
  const crashed   = disp.tone === 'crash';
  const see       = disp.seesaw; // {event, delta} | null

  const subcat   = subcategories.find((s) => s.id === item.subcategory_id);
  const cat      = categories.find((c) => c.id === item.category_id);
  const subStyle = subcat ? getSubcategoryStyle(subcat.name) : null;
  const catStyle = cat    ? getCategoryStyle(cat.name)       : null;
  const style    = subStyle ?? catStyle ?? DEFAULT_STYLE;

  const imgSrc = item.image_url
    ? (item.image_url.startsWith('http') ? item.image_url : `/uploads/${item.image_url}`)
    : null;

  // seesaw 発生中は数秒 点滅(勝者=緑/犠牲=赤)。それ以外は通常フラッシュ。
  const seeClass = see ? (see.event === 'seesaw_win' ? 'seesaw-win' : 'seesaw-lose') : '';
  const flashClass = seeClass || (flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : '');

  return (
    <div
      className={`flex flex-col overflow-hidden ${flashClass}`}
      style={{
        background: '#1e1e28',
        border: crashed ? '1px solid #ff4466' : '1px solid #252532',
        borderRadius: 12,
      }}
    >
      {/* 画像エリア */}
      <div
        className="relative flex-shrink-0 flex items-center justify-center overflow-hidden"
        style={{ height: 130, background: style.gradient }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.15) 1px,transparent 1px)',
            backgroundSize: '12px 12px',
          }}
        />
        {imgSrc && (
          <img
            src={imgSrc} alt={item.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </div>

      {/* テキストエリア */}
      <div className="flex flex-col flex-1 p-3 pb-0">
        <p
          className="line-clamp-2 leading-snug mb-2"
          style={{ fontFamily: "'Noto Sans JP', sans-serif", fontSize: 16, fontWeight: 700, color: '#f0f0f5' }}
        >
          {item.name}
        </p>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 700, color: '#ffc531', letterSpacing: '0.5px' }}>
            ¥{yen(price)}
          </span>
          {crashed ? (
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: '#e52233', padding: '1px 8px', borderRadius: 6, letterSpacing: '1px' }}>
              CRASH{crashRemain ? ` ${crashRemain}` : ''}
            </span>
          ) : see ? (
            <span style={{ fontSize: 14, fontWeight: 800, color: see.event === 'seesaw_win' ? '#00e5a0' : '#ff4466' }}>
              {see.event === 'seesaw_win' ? '▲' : '▼'}{see.delta}段
            </span>
          ) : (isUp || isDown) ? (
            <span style={{ fontSize: 14, fontWeight: 700, color: isUp ? '#00e5a0' : '#ff4466' }}>
              {centerPctLabel(disp.tone, disp.centerPct)}
            </span>
          ) : null}
        </div>
        <Sparkline itemId={item.id} basePrice={item.base_price} isUp={isUp} isDown={isDown} darkBg={true} />
      </div>

      {/* 注文ボタン */}
      <button
        onClick={() => onAdd(item)}
        className="w-full flex-shrink-0 mt-2 active:scale-[0.97]"
        style={{
          background: 'linear-gradient(90deg,#e52233,#9a1020)',
          border: 'none', padding: '11px 0', borderRadius: '0 0 11px 11px',
          cursor: 'pointer', fontFamily: "'Noto Sans JP', sans-serif",
          fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '2px', transition: 'all 0.12s',
        }}
      >
        注　文
      </button>
    </div>
  );
}

// ───────────────────────────────────────────
// スタッフ画面用カード（従来デザイン維持）
// ───────────────────────────────────────────
function StaffMenuItem({ item, onAdd, crashRemain }) {
  const livePrice = usePriceStore((s) => s.prices[item.id]);
  const price     = livePrice?.current_price ?? item.current_price;
  const flash     = livePrice?.flash;
  // 色/▲▼は「寄り付き価格(中心)比」。暴落は 'crash' で上書き。
  const disp    = priceDisplay(livePrice ?? item);
  const isUp    = disp.tone === 'up';
  const isDown  = disp.tone === 'down';
  const crashed = disp.tone === 'crash';
  const see     = disp.seesaw;
  const seeClass = see ? (see.event === 'seesaw_win' ? 'seesaw-win' : 'seesaw-lose') : '';
  const flashClass = seeClass || (flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : '');

  return (
    <button
      onClick={() => onAdd(item)}
      className={`flex flex-col justify-between bg-surface hover:bg-primary-50 active:scale-95 rounded-xl border ${crashed ? 'border-red-400' : 'border-line'} hover:border-primary-300 hover:shadow-sm transition-all text-left w-full overflow-hidden p-3.5 ${flashClass}`}
    >
      {item.price_editable && (
        <span className="inline-flex self-start items-center px-1.5 py-0.5 mb-1.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">時価</span>
      )}
      <span className="text-sm font-semibold text-body leading-snug mb-3 line-clamp-2">{item.name}</span>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-base font-black text-primary-600">¥{yen(price)}</span>
        {crashed ? (
          <span className="text-xs font-extrabold text-white bg-red-600 px-1.5 py-0.5 rounded tracking-wide">CRASH{crashRemain ? ` ${crashRemain}` : ''}</span>
        ) : see ? (
          <span className={`text-xs font-extrabold ${see.event === 'seesaw_win' ? 'text-emerald-600' : 'text-red-500'}`}>
            {see.event === 'seesaw_win' ? '▲' : '▼'}{see.delta}段
          </span>
        ) : (isUp || isDown) ? (
          <span className={`text-xs font-bold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
            {centerPctLabel(disp.tone, disp.centerPct)}
          </span>
        ) : (
          <span className="text-xs font-bold text-faint">—</span>
        )}
      </div>
    </button>
  );
}

// ───────────────────────────────────────────
// メインエクスポート
// ───────────────────────────────────────────
export default function MenuGrid({
  menuItems, categories, subcategories = [], onAddItem,
  showImage = false,
  crashEndsAt = null,
  activeCategory: externalActiveCategory,
  activeSubcategory: externalActiveSubcategory,
}) {
  const [internalActiveCategory,    setInternalActiveCategory]    = useState(null);
  const [internalActiveSubcategory, setInternalActiveSubcategory] = useState(null);
  const crashRemain = useCrashRemain(crashEndsAt); // 暴落中カードの残り時間(M:SS)

  const activeCat = showImage
    ? (externalActiveCategory    ?? categories[0]?.id)
    : (internalActiveCategory    ?? categories[0]?.id);
  const activeSub = showImage ? externalActiveSubcategory : internalActiveSubcategory;

  const subcatsForCat = subcategories.filter((s) => s.category_id === activeCat);
  const filteredItems = menuItems.filter((item) => {
    if (item.category_id !== activeCat) return false;
    if (activeSub === null || activeSub === undefined) return true;
    return item.subcategory_id === activeSub;
  });

  return (
    <div className="flex flex-col gap-3">
      {!showImage && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { setInternalActiveCategory(cat.id); setInternalActiveSubcategory(null); }}
                className={`px-5 py-3 rounded-full text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                  activeCat === cat.id ? 'bg-primary-500 text-white' : 'text-muted hover:bg-surface-sunken hover:text-body border border-line'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
          {subcatsForCat.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setInternalActiveSubcategory(null)}
                className={`px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                  activeSub === null ? 'bg-primary-100 text-primary-700' : 'text-faint hover:bg-surface-sunken'
                }`}
              >
                すべて
              </button>
              {subcatsForCat.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setInternalActiveSubcategory(sub.id)}
                  className={`px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                    activeSub === sub.id ? 'bg-primary-100 text-primary-700' : 'text-faint hover:bg-surface-sunken'
                  }`}
                >
                  {sub.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div
        className={`grid gap-3 ${showImage ? 'grid-cols-3' : 'grid-cols-2'}`}
        style={showImage ? { marginBottom: 32 } : undefined}
      >
        {filteredItems.map((item) =>
          showImage ? (
            <CustomerMenuItem key={item.id} item={item} onAdd={onAddItem} categories={categories} subcategories={subcategories} crashRemain={crashRemain} />
          ) : (
            <StaffMenuItem key={item.id} item={item} onAdd={onAddItem} crashRemain={crashRemain} />
          )
        )}
      </div>

      {/* 凡例(常設): ▲▼ の基準を明示 */}
      <p className={showImage ? 'text-xs text-center' : 'text-xs'} style={showImage ? { color: '#8a8a99' } : undefined}>
        <span className={showImage ? '' : 'text-faint'}>{PRICE_LEGEND}</span>
      </p>
    </div>
  );
}
