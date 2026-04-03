# UI リデザイン実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全Web画面のUI/UXをモダンにブラッシュアップする（機能・ロジック変更なし）

**Architecture:** 管理系画面（POS・Kitchen）はホワイト×インディゴのLight Adminテーマ、お客様向け（TablePage・BoardPage）はスレートブラック×アンバーゴールドのDark Barテーマで統一する。TablePageはiPad横置き2ペインレイアウトに全面変更する。

**Tech Stack:** React, Tailwind CSS v4, TanStack Query v5, Socket.io-client

---

## カラー対応表（Light Admin）

既存クラスを以下のとおり置き換える（管理画面系のみ）：

| 旧 | 新 |
|---|---|
| `bg-blue-600` | `bg-indigo-600` |
| `bg-blue-700` | `bg-indigo-700` |
| `bg-blue-50` | `bg-indigo-50` |
| `text-blue-600` | `text-indigo-600` |
| `text-blue-700` | `text-indigo-700` |
| `text-blue-400` | `text-indigo-400` |
| `border-blue-500` | `border-indigo-500` |
| `border-blue-500` | `border-indigo-500` |
| `ring-blue-500` | `ring-indigo-500` |
| `focus:ring-blue-500` | `focus:ring-indigo-500` |
| `focus:border-blue-500` | `focus:border-indigo-500` |
| `hover:bg-blue-700` | `hover:bg-indigo-700` |
| `hover:border-blue-400` | `hover:border-indigo-400` |
| `hover:text-blue-600` | `hover:text-indigo-600` |

---

## 変更ファイル一覧

| ファイル | 変更種別 |
|---------|---------|
| `client/src/pages/POSPage.jsx` | サイドバー構造変更＋カラー |
| `client/src/pages/TablePage.jsx` | 全面構造変更（2ペイン横置き） |
| `client/src/pages/BoardPage.jsx` | カード拡大・ヘッダー強化 |
| `client/src/pages/KitchenPage.jsx` | Light Admin テーマ変更 |
| `client/src/pages/ReportsPage.jsx` | blue→indigo 置換 |
| `client/src/pages/ReceiptsPage.jsx` | blue→indigo 置換 |
| `client/src/pages/SystemSettingsPage.jsx` | blue→indigo 置換 |
| `client/src/components/pos/TableGrid.jsx` | カードデザイン刷新 |
| `client/src/components/pos/OrderPanel.jsx` | パネルデザイン刷新 |
| `client/src/components/pos/MenuGrid.jsx` | タブ・カード刷新 |
| `client/src/components/pos/PaymentModal.jsx` | blue→indigo 置換 |
| `client/src/components/board/PriceCard.jsx` | 大型モニター向け拡大 |
| `client/src/components/layout/TickerBar.jsx` | アンバー色調整 |
| `client/src/components/menu/MenuManager.jsx` | blue→indigo 置換 |
| `client/src/components/menu/CategoryManager.jsx` | blue→indigo 置換 |
| `client/src/components/menu/PricingSettings.jsx` | blue→indigo 置換 |
| `client/src/components/tables/TableManager.jsx` | blue→indigo 置換 |

---

## Task 1: POSPage — サイドバー＆ヘッダー刷新

**Files:**
- Modify: `client/src/pages/POSPage.jsx`

- [ ] **Step 1: POSPage.jsx を以下のとおり書き換える**

```jsx
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import TableGrid from '../components/pos/TableGrid';
import OrderPanel from '../components/pos/OrderPanel';
import MenuManager from '../components/menu/MenuManager';
import CategoryManager from '../components/menu/CategoryManager';
import PricingSettings from '../components/menu/PricingSettings';
import ReportsPage from './ReportsPage';
import TableManager from '../components/tables/TableManager';
import ReceiptsPage from './ReceiptsPage';
import SystemSettingsPage from './SystemSettingsPage';

const NAV_ITEMS = [
  { id: 'pos',        label: 'レジ画面',    desc: 'テーブル選択・注文',     icon: '🏠' },
  { id: 'tables',     label: 'テーブル管理', desc: 'テーブル・カウンター',    icon: '🪑' },
  { id: 'menu',       label: '商品管理',    desc: 'メニュー・価格設定',      icon: '📋' },
  { id: 'categories', label: 'カテゴリ管理', desc: 'カテゴリ・サブカテゴリ',  icon: '🏷️' },
  { id: 'pricing',    label: '価格エンジン', desc: 'パラメータ設定',         icon: '⚙️' },
  { id: 'reports',    label: '売上管理',    desc: '日次レポート・分析',      icon: '📊' },
  { id: 'receipts',   label: '伝票情報',    desc: '会計済み伝票の閲覧',     icon: '🧾' },
  { id: 'system',     label: 'システム管理', desc: '消費税・システム設定',    icon: '🔧' },
];

export default function POSPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState('pos');
  const [selectedTable, setSelectedTable] = useState(null);
  const { initPrices, updatePrices } = usePriceStore();

  const { data: tables = [] } = useQuery({
    queryKey: ['tables'],
    queryFn: api.getTables,
    refetchInterval: 30_000,
  });

  const { data: openOrders = [] } = useQuery({
    queryKey: ['orders-open'],
    queryFn: api.getOpenOrders,
    refetchInterval: 30_000,
  });

  const { data: menuItems = [] } = useQuery({
    queryKey: ['menu'],
    queryFn: api.getMenu,
    staleTime: 60_000,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
    staleTime: 60_000,
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories'],
    queryFn: api.getSubcategories,
    staleTime: 60_000,
  });

  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  useEffect(() => {
    socket.on('prices:updated', ({ items }) => updatePrices(items));
    socket.on('prices:sync',    ({ items }) => initPrices(items));

    socket.on('table:status_changed', ({ tableId, status }) => {
      queryClient.setQueryData(['tables'], (old) =>
        old?.map((t) => (t.id === tableId ? { ...t, status } : t)) ?? old
      );
      queryClient.invalidateQueries({ queryKey: ['orders-open'] });
    });

    socket.on('order:updated', () => {
      queryClient.invalidateQueries({ queryKey: ['orders-open'] });
    });

    return () => {
      socket.off('prices:updated');
      socket.off('prices:sync');
      socket.off('table:status_changed');
      socket.off('order:updated');
    };
  }, []);

  const handleSelectTable = (table) => {
    setSelectedTable((prev) => (prev?.id === table.id ? null : table));
  };

  const handleSetView = (nextView) => {
    if (view === 'menu' || view === 'categories') {
      queryClient.invalidateQueries({ queryKey: ['menu'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['subcategories'] });
    }
    if (view === 'tables') {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    }
    setView(nextView);
    if (nextView !== 'pos') setSelectedTable(null);
  };

  const currentTable = selectedTable
    ? tables.find((t) => t.id === selectedTable.id) ?? selectedTable
    : null;

  const occupiedCount = openOrders.length;
  const currentNav = NAV_ITEMS.find((n) => n.id === view);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ─── サイドバー ─── */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        {/* ブランドヘッダー */}
        <div className="px-4 py-4 bg-gradient-to-b from-indigo-600 to-indigo-700 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-lg">🍺</div>
            <div>
              <p className="font-black text-white text-sm leading-tight tracking-wide">Sports Bar</p>
              <p className="text-[11px] text-indigo-200 font-medium">POS 管理画面</p>
            </div>
          </div>
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSetView(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-3 ${
                view === item.id
                  ? 'bg-indigo-50 text-indigo-700 border-l-2 border-indigo-600 pl-2.5'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              <div className="min-w-0">
                <span className={`text-sm block font-semibold truncate ${view === item.id ? 'text-indigo-700' : ''}`}>
                  {item.label}
                </span>
                <span className={`text-[10px] block truncate ${view === item.id ? 'text-indigo-400' : 'text-slate-400'}`}>
                  {item.desc}
                </span>
              </div>
            </button>
          ))}

          <div className="pt-2 mt-1 border-t border-slate-100 space-y-0.5">
            <a
              href="/board"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <span className="text-base flex-shrink-0">📺</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">価格ボード</span>
              </div>
              <span className="text-[10px] text-slate-300">↗</span>
            </a>
            <a
              href="/kitchen"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <span className="text-base flex-shrink-0">🍳</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">キッチン</span>
              </div>
              <span className="text-[10px] text-slate-300">↗</span>
            </a>
          </div>
        </nav>

        {/* ステータス */}
        <div className="p-3 border-t border-slate-100 flex-shrink-0">
          <div className="px-3 py-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">テーブル稼働</p>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-800">{occupiedCount}</span>
              <span className="text-sm text-slate-400 font-medium">/ {tables.length} 席</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── メインコンテンツ ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* コンテンツヘッダー */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">{currentNav?.icon}</span>
            <div>
              <h1 className="font-bold text-slate-900 text-base">{currentNav?.label}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{currentNav?.desc}</p>
            </div>
          </div>
        </header>

        {/* ─── レジ画面 ─── */}
        {view === 'pos' && (
          <div className="flex flex-1 overflow-hidden">
            <div className={`${currentTable ? 'hidden sm:block sm:flex-1' : 'flex-1'} overflow-y-auto`}>
              <TableGrid
                tables={tables}
                openOrders={openOrders}
                selectedTableId={currentTable?.id}
                onSelectTable={handleSelectTable}
              />
            </div>
            {currentTable && (
              <div className="w-full sm:w-80 md:w-96 flex-shrink-0 border-l border-slate-200">
                <OrderPanel
                  table={currentTable}
                  menuItems={menuItems}
                  categories={categories}
                  subcategories={subcategories}
                  onClose={() => setSelectedTable(null)}
                />
              </div>
            )}
          </div>
        )}

        {view === 'tables'     && <div className="flex-1 overflow-y-auto"><TableManager /></div>}
        {view === 'menu'       && <div className="flex-1 overflow-y-auto"><MenuManager /></div>}
        {view === 'categories' && <div className="flex-1 overflow-y-auto"><CategoryManager /></div>}
        {view === 'pricing'    && <div className="flex-1 overflow-y-auto"><PricingSettings /></div>}
        {view === 'reports'    && <div className="flex-1 overflow-y-auto"><ReportsPage inline /></div>}
        {view === 'receipts'   && <div className="flex-1 overflow-y-auto"><ReceiptsPage /></div>}
        {view === 'system'     && <div className="flex-1 overflow-y-auto"><SystemSettingsPage /></div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ブラウザで http://localhost:5173 を開き確認する**
  - サイドバーにインディゴグラデーションヘッダーが表示される
  - ナビゲーションアイテムにアイコンが付いている
  - アクティブ項目が `bg-indigo-50 border-l-2 border-indigo-600` で強調される
  - ステータスエリアに稼働数が表示される

- [ ] **Step 3: コミット**

```bash
git add client/src/pages/POSPage.jsx
git commit -m "ui: redesign POSPage sidebar with indigo theme and icons"
```

---

## Task 2: TableGrid — カードデザイン刷新

**Files:**
- Modify: `client/src/components/pos/TableGrid.jsx`

- [ ] **Step 1: TableGrid.jsx を以下のとおり書き換える**

```jsx
import { useState, useEffect } from 'react';

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function elapsed(openedAt, now) {
  const ms = now - new Date(openedAt).getTime();
  const totalMin = Math.floor(ms / 60_000);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function TableGrid({ tables, openOrders = [], selectedTableId, onSelectTable }) {
  const now = useNow();

  const orderByTable = openOrders.reduce((acc, o) => { acc[o.table_id] = o; return acc; }, {});

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        テーブルがありません
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-6">
      {tables.map((table) => {
        const isCounter  = table.table_type === 'counter';
        const order      = orderByTable[table.id];
        const isOccupied = !!order;
        const isSelected = selectedTableId === table.id;

        return (
          <button
            key={table.id}
            onClick={() => onSelectTable(table)}
            className={`
              relative rounded-xl text-left transition-all duration-150 overflow-hidden border-2 bg-white
              ${isOccupied
                ? isCounter
                  ? 'border-amber-300 shadow-md shadow-amber-100'
                  : 'border-indigo-300 shadow-md shadow-indigo-100'
                : 'border-slate-200 shadow-sm'
              }
              ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-2' : 'hover:shadow-lg hover:-translate-y-0.5'}
            `}
          >
            {/* 種別バッジ */}
            <div className={`px-3 py-1.5 border-b text-xs font-bold tracking-wide ${
              isOccupied
                ? isCounter
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-slate-50 border-slate-100 text-slate-400'
            }`}>
              {isCounter ? 'カウンター' : 'テーブル'}
            </div>

            {/* コンテンツ */}
            <div className="px-4 py-3">
              <p className={`font-bold text-sm ${isOccupied ? 'text-slate-900' : 'text-slate-500'}`}>
                {table.name}
              </p>

              <div className={`mt-2 space-y-0.5 ${order ? '' : 'invisible'}`}>
                <p className={`text-base font-black ${isCounter ? 'text-amber-600' : 'text-indigo-600'}`}>
                  {order ? `¥${Math.floor(order.total_amount).toLocaleString()}` : '¥0'}
                </p>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  <span>⏱</span>
                  {order ? elapsed(order.opened_at, now) : '00:00'}
                </p>
              </div>
            </div>

            {/* 在席インジケーター */}
            {isOccupied && (
              <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                isCounter ? 'bg-amber-400' : 'bg-indigo-400'
              }`} />
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: ブラウザで確認する**
  - 空席カード: `border-slate-200`、タイプバッジが `text-slate-400`
  - 在席テーブル: `border-indigo-300`、金額が `text-indigo-600`
  - 在席カウンター: `border-amber-300`、金額が `text-amber-600`
  - 右上に在席インジケーター（点）が表示される

- [ ] **Step 3: コミット**

```bash
git add client/src/components/pos/TableGrid.jsx
git commit -m "ui: redesign TableGrid cards with indigo/amber theme"
```

---

## Task 3: MenuGrid — カテゴリタブ＆商品カード刷新

**Files:**
- Modify: `client/src/components/pos/MenuGrid.jsx`

- [ ] **Step 1: MenuGrid.jsx を以下のとおり書き換える**

```jsx
import { useState } from 'react';
import usePriceStore from '../../store/usePriceStore';

function MenuItem({ item, onAdd }) {
  const livePrice = usePriceStore((s) => s.prices[item.id]);
  const price     = livePrice?.current_price ?? item.current_price;
  const pctChange = livePrice?.pct_change ?? 0;
  const flash     = livePrice?.flash;
  const isUp   = pctChange > 0;
  const isDown = pctChange < 0;

  return (
    <button
      onClick={() => onAdd(item)}
      className={`flex flex-col justify-between p-3.5 bg-white hover:bg-indigo-50 active:scale-95 rounded-xl border-2 border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all text-left w-full ${
        flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''
      }`}
    >
      <span className="text-sm font-semibold text-slate-700 leading-snug mb-3 line-clamp-2">
        {item.name}
      </span>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-black text-indigo-700">¥{price.toLocaleString()}</span>
          {item.is_drink && (
            <span className={`text-xs font-bold ${isUp ? 'text-emerald-600' : isDown ? 'text-red-500' : 'text-slate-400'}`}>
              {isUp ? '▲' : isDown ? '▼' : '—'}{pctChange !== 0 ? `${Math.abs(pctChange).toFixed(1)}%` : ''}
            </span>
          )}
        </div>
        {item.is_drink && (
          <div className="mt-2 w-full h-1 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                isUp ? 'bg-emerald-500' : isDown ? 'bg-red-400' : 'bg-slate-300'
              }`}
              style={{ width: `${Math.min(100, 50 + pctChange * 5)}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

export default function MenuGrid({ menuItems, categories, subcategories = [], onAddItem }) {
  const [activeCategory,    setActiveCategory]    = useState(null);
  const [activeSubcategory, setActiveSubcategory] = useState(null);

  const activeCat = activeCategory || categories[0]?.id;
  const subcatsForCat = subcategories.filter((s) => s.category_id === activeCat);

  const handleSelectCategory = (catId) => {
    setActiveCategory(catId);
    setActiveSubcategory(null);
  };

  const filteredItems = menuItems.filter((item) => {
    if (item.category_id !== activeCat) return false;
    if (activeSubcategory === null) return true;
    return item.subcategory_id === activeSubcategory;
  });

  return (
    <div className="flex flex-col gap-3">
      {/* カテゴリタブ */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleSelectCategory(cat.id)}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
              activeCat === cat.id
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                : 'bg-white text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-indigo-300'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* サブカテゴリタブ */}
      {subcatsForCat.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setActiveSubcategory(null)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
              activeSubcategory === null
                ? 'bg-slate-700 text-white'
                : 'bg-white text-slate-400 hover:text-slate-700 border border-slate-200'
            }`}
          >
            すべて
          </button>
          {subcatsForCat.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setActiveSubcategory(sub.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                activeSubcategory === sub.id
                  ? 'bg-slate-700 text-white'
                  : 'bg-white text-slate-400 hover:text-slate-700 border border-slate-200'
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* メニューグリッド */}
      <div className="grid grid-cols-2 gap-3">
        {filteredItems.map((item) => (
          <MenuItem key={item.id} item={item} onAdd={onAddItem} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ブラウザで確認する**
  - カテゴリタブのアクティブ色が `bg-indigo-600`
  - 商品カードホバーで `bg-indigo-50 border-indigo-300`
  - 価格が `text-indigo-700`

- [ ] **Step 3: コミット**

```bash
git add client/src/components/pos/MenuGrid.jsx
git commit -m "ui: redesign MenuGrid tabs and item cards with indigo theme"
```

---

## Task 4: OrderPanel — パネルデザイン刷新

**Files:**
- Modify: `client/src/components/pos/OrderPanel.jsx`

- [ ] **Step 1: OrderPanel.jsx の JSX 部分（return 内）を書き換える。ロジック（ハンドラ・クエリ・ミューテーション）は変更しない。**

`ConfirmModal` コンポーネントを以下に置き換える：

```jsx
function ConfirmModal({ title, description, confirmLabel, confirmClass, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl pop-in border border-slate-100">
        <h3 className="text-sm font-bold text-slate-900 mb-2">{title}</h3>
        {description && <p className="text-xs text-slate-500 leading-relaxed">{description}</p>}
        <div className="flex gap-2.5 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-xl transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 text-white text-sm font-bold rounded-xl transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`OrderPanel` の return 内を以下に置き換える：

```jsx
  return (
    <div className="flex flex-col h-full bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <div>
          <h2 className="font-bold text-slate-900">{table.name}</h2>
          <span className="text-xs text-slate-400 mt-0.5 block">{table.capacity}席</span>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {/* スクロールエリア */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* メニューグリッド */}
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
            メニューから追加
          </p>
          <MenuGrid
            menuItems={menuItems}
            categories={categories}
            subcategories={subcategories}
            onAddItem={handleAddItem}
          />
        </div>

        {/* 注文明細 */}
        {order?.items?.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              注文明細
            </p>
            <div className="space-y-2">
              {order.items.map((item) => {
                const sameNameItems = order.items.filter((i) => i.item_name === item.item_name);
                const hasPriceVariants = sameNameItems.length > 1;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-slate-800 font-medium block truncate">
                        {item.item_name}
                      </span>
                      {hasPriceVariants && (
                        <span className="text-[11px] text-slate-400 mt-0.5 block">
                          注文時 ¥{item.unit_price.toLocaleString()}
                        </span>
                      )}
                    </div>
                    {!hasPriceVariants && (
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        ¥{item.unit_price.toLocaleString()}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleQtyDecrease(item)}
                        className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-base font-bold flex items-center justify-center transition-colors"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-sm font-bold text-slate-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleQtyIncrease(item)}
                        className="w-7 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-base font-bold flex items-center justify-center transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm font-bold text-indigo-700 w-16 text-right flex-shrink-0">
                      ¥{(item.quantity * item.unit_price).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="px-5 py-5 border-t border-slate-200 bg-slate-50 space-y-3 flex-shrink-0">
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-500 font-medium">合計金額</span>
          <span className="text-2xl font-black text-slate-900">¥{total.toLocaleString()}</span>
        </div>

        {order ? (
          <button
            onClick={() => setShowPayment(true)}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black rounded-xl transition-colors shadow-sm text-base"
          >
            会計する
          </button>
        ) : !isLoading ? (
          <button
            onClick={() => openOrderMutation.mutate()}
            disabled={openOrderMutation.isPending}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors shadow-sm"
          >
            {openOrderMutation.isPending ? '開始中...' : '注文を開始する'}
          </button>
        ) : null}
      </div>

      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          description={pendingAction.description}
          confirmLabel={pendingAction.label}
          confirmClass={pendingAction.confirmClass}
          onConfirm={handleConfirm}
          onClose={() => setPendingAction(null)}
        />
      )}

      {showPayment && order && (
        <PaymentModal
          order={order}
          table={table}
          onClose={() => setShowPayment(false)}
          onPaid={() => {
            setShowPayment(false);
            onClose();
          }}
        />
      )}
    </div>
  );
```

また `handleAddItem`・`handleQtyDecrease` 内の `confirmClass` を更新する：
```jsx
// handleAddItem
confirmClass: 'bg-indigo-600 hover:bg-indigo-700',

// handleQtyIncrease
confirmClass: 'bg-indigo-600 hover:bg-indigo-700',

// handleQtyDecrease (削除以外)
confirmClass: isDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700',
```

- [ ] **Step 2: ブラウザで確認する**
  - 注文明細の `+` ボタンが `bg-indigo-600`
  - 小計が `text-indigo-700`
  - 「注文を開始する」ボタンが `bg-indigo-600`
  - 「会計する」ボタンが `bg-emerald-600`

- [ ] **Step 3: コミット**

```bash
git add client/src/components/pos/OrderPanel.jsx
git commit -m "ui: redesign OrderPanel with indigo theme"
```

---

## Task 5: PaymentModal — blue→indigo 置換

**Files:**
- Modify: `client/src/components/pos/PaymentModal.jsx`

- [ ] **Step 1: PaymentModal.jsx 内の blue 系クラスを indigo に一括置換する**

以下を検索して置換する（Task 0 のカラー対応表を参照）：

```
bg-blue-600       → bg-indigo-600
bg-blue-700       → bg-indigo-700  (※ hover:bg-blue-700 も同様)
bg-blue-50        → bg-indigo-50
border-blue-500   → border-indigo-500
text-blue-600     → text-indigo-600
text-blue-700     → text-blue-700 → text-indigo-700
```

具体的な変更箇所：
1. 割引トグルボタン `bg-blue-600 text-white` → `bg-indigo-600 text-white`
2. 割引入力の `focus-within:ring-blue-400` → `focus-within:ring-indigo-400`
3. 支払い方法ボタン選択時 `border-blue-500 bg-blue-50 text-blue-700` → `border-indigo-500 bg-indigo-50 text-indigo-700`
4. クイック金額ボタン選択時 `bg-blue-600 border-blue-600 text-white` → `bg-indigo-600 border-indigo-600 text-white`
5. クイック金額ボタン hover `hover:border-blue-400 hover:text-blue-600` → `hover:border-indigo-400 hover:text-indigo-600`

- [ ] **Step 2: ブラウザで会計モーダルを開き確認する**
  - 支払い方法の選択ボタンがインディゴ色になっている
  - 割引トグルがインディゴ

- [ ] **Step 3: コミット**

```bash
git add client/src/components/pos/PaymentModal.jsx
git commit -m "ui: update PaymentModal blue→indigo color scheme"
```

---

## Task 6: 管理系コンポーネント — blue→indigo 一括置換

**Files:**
- Modify: `client/src/components/menu/MenuManager.jsx`
- Modify: `client/src/components/menu/CategoryManager.jsx`
- Modify: `client/src/components/menu/PricingSettings.jsx`
- Modify: `client/src/components/tables/TableManager.jsx`

- [ ] **Step 1: 4ファイルで blue 系クラスを indigo に置換する**

各ファイルで以下を実施（カラー対応表どおり）：

**MenuManager.jsx・CategoryManager.jsx・TableManager.jsx**
- `const inp = '...focus:ring-blue-500 focus:border-blue-500...'` → `focus:ring-indigo-500 focus:border-indigo-500`
- `border-blue-500 bg-blue-50 text-blue-700` → `border-indigo-500 bg-indigo-50 text-indigo-700`（種別トグルボタン）
- `bg-blue-600 hover:bg-blue-700 text-white` → `bg-indigo-600 hover:bg-indigo-700 text-white`（保存ボタン）
- `text-blue-600 hover:text-blue-700` → `text-indigo-600 hover:text-indigo-700`（編集リンク等）

**PricingSettings.jsx**
- 保存ボタン `bg-blue-600` → `bg-indigo-600`
- `focus:ring-blue-500` → `focus:ring-indigo-500`

- [ ] **Step 2: ブラウザで各管理画面を開き確認する**
  - フォームのフォーカスリングがインディゴ
  - 保存ボタンがインディゴ
  - 種別トグルの選択色がインディゴ

- [ ] **Step 3: コミット**

```bash
git add client/src/components/menu/MenuManager.jsx \
        client/src/components/menu/CategoryManager.jsx \
        client/src/components/menu/PricingSettings.jsx \
        client/src/components/tables/TableManager.jsx
git commit -m "ui: update management components blue→indigo color scheme"
```

---

## Task 7: 管理系ページ — blue→indigo 一括置換

**Files:**
- Modify: `client/src/pages/ReportsPage.jsx`
- Modify: `client/src/pages/ReceiptsPage.jsx`
- Modify: `client/src/pages/SystemSettingsPage.jsx`

- [ ] **Step 1: 3ファイルで blue 系クラスを indigo に置換する**

**ReportsPage.jsx**
- `bg-blue-500` (バーグラフ) → `bg-indigo-500`
- `focus:ring-blue-500` → `focus:ring-indigo-500`
- `focus:border-blue-500` → `focus:border-indigo-500`

**ReceiptsPage.jsx**
- `focus:ring-blue-500` → `focus:ring-indigo-500`

**SystemSettingsPage.jsx**
- `bg-blue-600 hover:bg-blue-700` (保存ボタン) → `bg-indigo-600 hover:bg-indigo-700`
- `bg-emerald-500` (保存済み) — 変更不要
- `focus:ring-blue-500` → `focus:ring-indigo-500`

- [ ] **Step 2: ブラウザで各ページを確認する**
  - 売上ランキングのバーグラフがインディゴ
  - 日付入力フォーカス時リングがインディゴ
  - システム管理の保存ボタンがインディゴ

- [ ] **Step 3: コミット**

```bash
git add client/src/pages/ReportsPage.jsx \
        client/src/pages/ReceiptsPage.jsx \
        client/src/pages/SystemSettingsPage.jsx
git commit -m "ui: update report/receipt/settings pages blue→indigo"
```

---

## Task 8: KitchenPage — Light Admin テーマ変更

**Files:**
- Modify: `client/src/pages/KitchenPage.jsx`

- [ ] **Step 1: KitchenPage.jsx を以下のとおり書き換える**

```jsx
import { useEffect, useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';

function elapsed(openedAt) {
  const diff = Math.floor((Date.now() - new Date(openedAt).getTime()) / 1000);
  if (diff < 60) return `${diff}秒`;
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}分${s}秒`;
}

function CancelConfirmModal({ item, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-80 shadow-2xl pop-in">
        <h3 className="text-base font-bold text-slate-900 mb-2">注文をキャンセルしますか？</h3>
        <p className="text-sm text-slate-500 mb-1">
          <span className="text-slate-900 font-semibold">{item.tableName}</span>
        </p>
        <p className="text-sm text-slate-700 mb-5">
          {item.itemName} × {item.quantity}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
          >
            戻る
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-colors"
          >
            キャンセルする
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KitchenPage() {
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['kitchenOrders'],
    queryFn: api.getKitchenOrders,
    refetchInterval: 30_000,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] });
  }, [queryClient]);

  useEffect(() => {
    socket.on('order:updated',         refetch);
    socket.on('table:status_changed',  refetch);
    socket.on('kitchen:item_served',   refetch);
    return () => {
      socket.off('order:updated',        refetch);
      socket.off('table:status_changed', refetch);
      socket.off('kitchen:item_served',  refetch);
    };
  }, [refetch]);

  const serveMutation = useMutation({
    mutationFn: (itemId) => api.serveKitchenItem(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] }),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ orderId, itemId }) => api.deleteOrderItem(orderId, itemId),
    onSuccess: () => {
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['kitchenOrders'] });
    },
  });

  const now = Date.now();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center text-xl">🍳</div>
          <div>
            <h1 className="font-black text-slate-900 text-xl leading-tight">キッチン</h1>
            <p className="text-xs text-slate-400">オープン注文 リアルタイム表示</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-sm font-semibold px-3 py-1.5 rounded-full ${
            rows.length === 0
              ? 'bg-slate-100 text-slate-400'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {rows.length} 件対応中
          </span>
          <button
            onClick={refetch}
            className="text-xs text-slate-400 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors font-medium"
          >
            更新
          </button>
        </div>
      </header>

      <main className="p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
            読み込み中...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-3xl">✓</div>
            <p className="text-lg font-semibold text-slate-600">すべての注文が完了しています</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
            {/* テーブルヘッダー */}
            <div className="grid grid-cols-[120px_140px_1fr_64px_100px_100px] gap-0 bg-slate-50 border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <span>受注時刻</span>
              <span>テーブル</span>
              <span>商品名</span>
              <span className="text-center">数量</span>
              <span className="text-center">提供完了</span>
              <span className="text-center">キャンセル</span>
            </div>

            {/* 行リスト */}
            <div className="divide-y divide-slate-100">
              {rows.map((row) => {
                const diffSec = Math.floor((now - new Date(row.openedAt).getTime()) / 1000);
                const isOld = diffSec > 600;
                const isServePending  = serveMutation.isPending  && serveMutation.variables  === row.itemId;
                const isCancelPending = cancelMutation.isPending && cancelMutation.variables?.itemId === row.itemId;

                return (
                  <div
                    key={row.itemId}
                    className={`grid grid-cols-[120px_140px_1fr_64px_100px_100px] gap-0 px-4 py-4 items-center transition-colors ${
                      isOld ? 'bg-red-50 border-l-4 border-red-500' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    {/* 受注時刻 */}
                    <div>
                      <p className="text-sm text-slate-700 font-mono font-semibold">
                        {new Date(row.openedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${isOld ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                        {elapsed(row.openedAt)}経過
                      </p>
                    </div>

                    {/* テーブル */}
                    <div>
                      <span className="text-sm font-bold text-slate-900">{row.tableName}</span>
                    </div>

                    {/* 商品名 */}
                    <div>
                      <span className="text-sm text-slate-700 font-medium">{row.itemName}</span>
                    </div>

                    {/* 数量 */}
                    <div className="text-center">
                      <span className="text-base font-black text-slate-900">× {row.quantity}</span>
                    </div>

                    {/* 提供完了ボタン */}
                    <div className="flex justify-center">
                      <button
                        onClick={() => serveMutation.mutate(row.itemId)}
                        disabled={isServePending || isCancelPending}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        {isServePending ? '...' : '提供完了'}
                      </button>
                    </div>

                    {/* キャンセルボタン */}
                    <div className="flex justify-center">
                      <button
                        onClick={() => setCancelTarget(row)}
                        disabled={isServePending || isCancelPending}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-red-100 hover:text-red-700 disabled:opacity-40 text-slate-500 text-xs font-bold rounded-lg transition-colors"
                      >
                        {isCancelPending ? '...' : 'キャンセル'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {cancelTarget && (
        <CancelConfirmModal
          item={cancelTarget}
          onConfirm={() =>
            cancelMutation.mutate({ orderId: cancelTarget.orderId, itemId: cancelTarget.itemId })
          }
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: ブラウザで /kitchen を開き確認する**
  - 白背景に変わっている
  - ヘッダーに白背景＋シャドウ
  - 警告行が `bg-red-50 border-l-4 border-red-500`（左ボーダーハイライト）
  - 提供完了ボタンが emerald、キャンセルボタンが slate

- [ ] **Step 3: コミット**

```bash
git add client/src/pages/KitchenPage.jsx
git commit -m "ui: redesign KitchenPage with Light Admin theme"
```

---

## Task 9: TickerBar — Dark Bar スタイル確認・調整

**Files:**
- Modify: `client/src/components/layout/TickerBar.jsx`

- [ ] **Step 1: TickerBar.jsx を以下のとおり書き換える**

```jsx
import usePriceStore from '../../store/usePriceStore';

function TickerItem({ item }) {
  const isUp = item.pct_change > 0;
  const isDown = item.pct_change < 0;
  const arrow = isUp ? '▲' : isDown ? '▼' : '─';
  const colorClass = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';
  const flashClass = item.flash === 'up' ? 'flash-up' : item.flash === 'down' ? 'flash-down' : '';

  return (
    <span className={`inline-flex items-center gap-1.5 px-5 ${flashClass}`}>
      <span className="text-amber-300 font-semibold">{item.name}</span>
      <span className={`font-black text-amber-400`}>¥{item.current_price.toLocaleString()}</span>
      <span className={`text-xs font-bold ${colorClass}`}>
        {arrow}{Math.abs(item.pct_change).toFixed(1)}%
      </span>
      <span className="text-slate-700 ml-1">·</span>
    </span>
  );
}

export default function TickerBar() {
  const pricesMap = usePriceStore((s) => s.prices);
  const prices = Object.values(pricesMap);

  if (prices.length === 0) return null;

  const tickerItems = [...prices, ...prices];

  return (
    <div className="bg-slate-950 border-b border-slate-800 py-2.5 overflow-hidden">
      <div className="flex ticker-animate whitespace-nowrap">
        {tickerItems.map((item, i) => (
          <TickerItem key={`${item.id}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ブラウザで /table/1 を開き確認する**
  - ティッカーが `bg-slate-950`（より深い黒）
  - 商品名が `text-amber-300`、価格が `text-amber-400`

- [ ] **Step 3: コミット**

```bash
git add client/src/components/layout/TickerBar.jsx
git commit -m "ui: update TickerBar to amber gold Dark Bar style"
```

---

## Task 10: TablePage — iPad横置き2ペインレイアウト全面変更

**Files:**
- Modify: `client/src/pages/TablePage.jsx`

- [ ] **Step 1: TablePage.jsx を以下のとおり全面書き換える**

```jsx
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import TickerBar from '../components/layout/TickerBar';
import MenuGrid from '../components/pos/MenuGrid';

// ───────────────────────────────────────────
// 注文確認ボトムシート
// ───────────────────────────────────────────
function ConfirmModal({ item, livePrice, onConfirm, onCancel }) {
  const price = livePrice?.current_price ?? item.current_price;
  const pctChange = livePrice?.pct_change ?? 0;
  const isUp = pctChange > 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 fade-in" onClick={onCancel} />
      <div className="fixed bottom-0 left-0 right-0 z-50 slide-up">
        <div className="bg-slate-800 rounded-t-3xl px-6 pt-5 pb-12 max-w-lg mx-auto border-t border-slate-700/60">
          <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-6" />
          <div className="mb-8">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
              注文しますか？
            </p>
            <h3 className="text-2xl font-black text-white mb-4">{item.name}</h3>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-black text-amber-400">
                ¥{price.toLocaleString()}
              </span>
              {item.is_drink && pctChange !== 0 && (
                <span className={`text-sm font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                  {isUp ? '▲' : '▼'}{Math.abs(pctChange).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => onConfirm(1)}
            className="w-full py-4 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 active:scale-[0.98] text-slate-900 font-black text-lg rounded-2xl transition-all shadow-xl shadow-amber-500/25 mb-3"
          >
            注文する
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 text-slate-400 hover:text-slate-300 text-sm font-medium transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────
// メインページ
// ───────────────────────────────────────────
export default function TablePage() {
  const { tableId } = useParams();
  const tableIdNum = Number(tableId);
  const queryClient = useQueryClient();
  const { initPrices, updatePrices, prices } = usePriceStore();
  const [confirmItem, setConfirmItem] = useState(null);

  const orderKey = ['order', tableIdNum];

  const { data: tables = [] } = useQuery({ queryKey: ['tables'], queryFn: api.getTables });
  const table = tables.find((t) => t.id === tableIdNum);

  const { data: menuItems = [] } = useQuery({ queryKey: ['menu'], queryFn: api.getMenu, staleTime: 60_000 });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories, staleTime: 60_000 });
  const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories, staleTime: 60_000 });
  const { data: order } = useQuery({ queryKey: orderKey, queryFn: () => api.getOrderByTable(tableIdNum), enabled: !!tableIdNum });

  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  useEffect(() => {
    socket.emit('client:subscribe_table', { tableId: tableIdNum });

    const handlePricesUpdated = ({ items }) => updatePrices(items);
    const handlePricesSync    = ({ items }) => initPrices(items);
    const handleReconnect     = () => api.getPrices().then(initPrices).catch(console.error);
    const handleOrderUpdated  = (data) => {
      if (data.tableId === tableIdNum) {
        queryClient.setQueryData(orderKey, (old) => ({
          ...(old ?? {}),
          id: data.orderId,
          table_id: tableIdNum,
          items: data.items,
          total_amount: data.total,
        }));
      }
    };

    socket.on('prices:updated', handlePricesUpdated);
    socket.on('prices:sync',    handlePricesSync);
    socket.on('connect',        handleReconnect);
    socket.on('order:updated',  handleOrderUpdated);

    return () => {
      socket.emit('client:unsubscribe_table', { tableId: tableIdNum });
      socket.off('prices:updated', handlePricesUpdated);
      socket.off('prices:sync',    handlePricesSync);
      socket.off('connect',        handleReconnect);
      socket.off('order:updated',  handleOrderUpdated);
    };
  }, [tableIdNum]);

  const openOrderMutation = useMutation({
    mutationFn: () => api.createOrder(tableIdNum),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKey }),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ orderId, menu_item_id, quantity }) =>
      api.addOrderItem(orderId, { menu_item_id, quantity }),
    onMutate: async ({ menu_item_id, quantity, price, name }) => {
      await queryClient.cancelQueries({ queryKey: orderKey });
      const previous = queryClient.getQueryData(orderKey);
      queryClient.setQueryData(orderKey, (old) => {
        if (!old) return old;
        const existing = old.items?.find((i) => i.menu_item_id === menu_item_id);
        const newItems = existing
          ? old.items.map((i) => i.menu_item_id === menu_item_id ? { ...i, quantity: i.quantity + quantity } : i)
          : [...(old.items ?? []), { id: `temp-${Date.now()}`, menu_item_id, item_name: name, unit_price: price, quantity }];
        return { ...old, items: newItems };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(orderKey, context.previous);
    },
  });

  const handleTapItem = (menuItem) => setConfirmItem(menuItem);

  const handleConfirmAdd = async (qty) => {
    const item = confirmItem;
    setConfirmItem(null);
    const livePrice = prices[item.id];
    const price = livePrice?.current_price ?? item.current_price;
    let currentOrder = order;
    if (!currentOrder) currentOrder = await openOrderMutation.mutateAsync();
    addItemMutation.mutate({ orderId: currentOrder.id, menu_item_id: item.id, quantity: qty, price, name: item.name });
  };

  const total     = order?.items?.reduce((s, i) => s + i.quantity * i.unit_price, 0) ?? 0;
  const itemCount = order?.items?.reduce((s, i) => s + i.quantity, 0) ?? 0;

  return (
    <div className="flex flex-col h-screen bg-slate-900 overflow-hidden">
      <TickerBar />

      {/* ─── 横置き2ペインレイアウト ─── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ─── 左ペイン: メニュー ─── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-700">
          {/* ヘッダー */}
          <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 flex-shrink-0">
            <div>
              <h1 className="font-black text-white text-xl leading-tight">
                {table?.name ?? `テーブル ${tableId}`}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">ご自由にご注文ください</p>
            </div>
          </header>

          {/* メニュースクロールエリア */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <MenuGrid
              menuItems={menuItems}
              categories={categories}
              subcategories={subcategories}
              onAddItem={handleTapItem}
            />
          </div>
        </div>

        {/* ─── 右ペイン: 注文サマリー ─── */}
        <div className="w-80 flex flex-col bg-slate-950 flex-shrink-0">
          {/* ペインヘッダー */}
          <div className="px-5 py-4 border-b border-slate-800 flex-shrink-0">
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">注文内容</p>
          </div>

          {/* 注文アイテムリスト */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!order?.items?.length ? (
              <div className="flex flex-col items-center justify-center h-32 text-slate-600 text-sm gap-2">
                <span className="text-2xl">🍺</span>
                <p>まだ注文がありません</p>
              </div>
            ) : (
              order.items.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50"
                >
                  <p className="text-sm font-semibold text-slate-100 mb-2">{item.item_name}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center justify-center text-slate-400 font-bold text-sm cursor-default">
                        {item.quantity}
                      </div>
                    </div>
                    <span className="text-sm font-black text-amber-400">
                      ¥{(item.quantity * item.unit_price).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* フッター合計 */}
          <div className="flex-shrink-0 border-t border-slate-800">
            {itemCount > 0 ? (
              <div className="bg-amber-500 px-5 py-4">
                <p className="text-xs text-amber-800 font-semibold">
                  合計 <span className="font-black">{itemCount}点</span>
                </p>
                <p className="text-2xl font-black text-slate-900 mt-0.5">
                  ¥{total.toLocaleString()}
                </p>
              </div>
            ) : (
              <div className="px-5 py-4 bg-slate-900">
                <p className="text-xs text-slate-600 font-medium">メニューから選んでください</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 注文確認モーダル */}
      {confirmItem && (
        <ConfirmModal
          item={confirmItem}
          livePrice={prices[confirmItem.id]}
          onConfirm={handleConfirmAdd}
          onCancel={() => setConfirmItem(null)}
        />
      )}
    </div>
  );
}
```

MenuGrid の商品カードをTablePage の Dark Bar テーマに合わせるため、TablePage から呼ぶ `MenuGrid` が POS管理画面でも使われることに注意。MenuGrid 自体は Light Admin テーマ（Task 3 実装済み）のまま使う。TablePage の背景が暗いため、MenuGrid のカード（白背景）がコントラストとして映える設計になっている。

- [ ] **Step 2: ブラウザで /table/1 を iPad 横置きサイズ（1024×768以上）でアクセスして確認する**
  - 左右2ペインが表示される
  - 左ペイン: ダーク背景にメニューグリッド（白カード）
  - 右ペイン: `bg-slate-950`、注文リスト + アンバーフッター
  - 商品タップでボトムシートが出現する

- [ ] **Step 3: コミット**

```bash
git add client/src/pages/TablePage.jsx
git commit -m "ui: redesign TablePage as iPad landscape 2-pane Dark Bar layout"
```

---

## Task 11: BoardPage — 大型モニター最適化

**Files:**
- Modify: `client/src/pages/BoardPage.jsx`
- Modify: `client/src/components/board/PriceCard.jsx`

- [ ] **Step 1: PriceCard.jsx を以下のとおり書き換える**

```jsx
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import Sparkline from './Sparkline';

export default function PriceCard({ item }) {
  const [localHistory, setLocalHistory] = useState([]);
  const isUp = item.pct_change > 0;
  const isDown = item.pct_change < 0;

  const color    = isUp ? '#4ade80' : isDown ? '#f87171' : '#94a3b8';
  const bgColor  = isUp
    ? 'bg-green-950/70 border-green-700/60'
    : isDown
    ? 'bg-red-950/70 border-red-700/60'
    : 'bg-slate-800/80 border-slate-700';
  const priceColor = isUp ? 'text-green-300' : isDown ? 'text-red-300' : 'text-amber-300';
  const arrow    = isUp ? '▲' : isDown ? '▼' : '─';
  const arrowColor = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';

  const { data: history } = useQuery({
    queryKey: ['price-history', item.id],
    queryFn: () => api.getPriceHistory(item.id, 20),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (history) setLocalHistory(history);
  }, [history]);

  useEffect(() => {
    setLocalHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last?.price === item.current_price) return prev;
      return [...prev, { price: item.current_price, recorded_at: new Date().toISOString() }].slice(-20);
    });
  }, [item.current_price]);

  return (
    <div className={`rounded-2xl border-2 p-6 flex flex-col gap-4 ${bgColor} transition-colors duration-1000`}>
      <div className="text-slate-400 text-sm font-semibold truncate leading-snug tracking-wide">
        {item.name}
      </div>
      <div className={`text-5xl font-black tracking-tight leading-none ${priceColor}`}>
        ¥{item.current_price.toLocaleString()}
      </div>
      <div className={`flex items-center gap-2 text-lg font-black ${arrowColor}`}>
        <span>{arrow}</span>
        <span>{Math.abs(item.pct_change).toFixed(1)}%</span>
        <span className="text-xs text-slate-600 font-normal ml-1">
          基準 ¥{item.base_price.toLocaleString()}
        </span>
      </div>
      <Sparkline data={localHistory} color={color} />
    </div>
  );
}
```

- [ ] **Step 2: BoardPage.jsx を以下のとおり書き換える**

```jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import PriceCard from '../components/board/PriceCard';

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-amber-400 text-2xl font-bold tracking-widest">
      {time.toLocaleTimeString('ja-JP')}
    </span>
  );
}

export default function BoardPage() {
  const { initPrices, updatePrices, getAllPrices } = usePriceStore();
  const prices = getAllPrices();

  useEffect(() => {
    api.getPrices().then(initPrices).catch(console.error);
  }, []);

  useEffect(() => {
    const handle = ({ items }) => updatePrices(items);
    socket.on('prices:updated', handle);
    return () => socket.off('prices:updated', handle);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-10">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-amber-500/20 rounded-2xl flex items-center justify-center text-4xl">
            🍺
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-widest leading-tight text-white">
              SPORTS BAR
            </h1>
            <p className="text-slate-500 text-sm mt-1 tracking-[0.4em] font-semibold uppercase">
              Live Drink Prices
            </p>
          </div>
        </div>
        <div className="text-right">
          <Clock />
          <p className="text-slate-600 text-xs mt-1 tracking-wider">30秒ごとに更新</p>
        </div>
      </div>

      {/* 価格グリッド */}
      {prices.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-slate-600 text-xl">
          接続中...
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {prices.map((item) => (
            <PriceCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* フッター */}
      <div className="mt-12 text-center text-slate-700 text-sm tracking-wider">
        価格は需要に応じてリアルタイムで変動します
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ブラウザで /board を開き確認する**
  - 価格が `text-5xl` で大きく表示される
  - ヘッダーに「SPORTS BAR」が `text-4xl tracking-widest`
  - 時計が `text-amber-400`

- [ ] **Step 4: コミット**

```bash
git add client/src/pages/BoardPage.jsx client/src/components/board/PriceCard.jsx
git commit -m "ui: redesign BoardPage and PriceCard for large monitor display"
```

---

## 完了チェックリスト

実装後、以下を手動で確認する：

- [ ] `http://localhost:5173/` (POSPage): サイドバーにインディゴグラデーション、アイコン付きナビ
- [ ] POSPage テーブルグリッド: 在席テーブルが indigo、在席カウンターが amber
- [ ] POSPage 注文パネル: `+` ボタンが indigo、会計ボタンが emerald
- [ ] POSPage 会計モーダル: 支払い方法選択が indigo
- [ ] POSPage 管理画面各ページ: 保存ボタン・フォームフォーカスが indigo
- [ ] `http://localhost:5173/table/1` (TablePage): 左右2ペイン横置き、右がアンバーフッター
- [ ] TablePage ティッカー: `bg-slate-950`、商品名 amber-300
- [ ] `http://localhost:5173/board` (BoardPage): 価格 `text-5xl`、時計 amber
- [ ] `http://localhost:5173/kitchen` (KitchenPage): 白背景、警告行に左赤ボーダー
