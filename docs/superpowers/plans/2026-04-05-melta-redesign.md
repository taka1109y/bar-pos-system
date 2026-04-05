# melta UI Full Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all visual styling across the bar-pos-system frontend with the melta UI design system (primary blue #2b70ef, Inter font, melta component classes), with zero functional changes.

**Architecture:** Pure CSS/Tailwind class swap across 13 files. Staff pages (POSPage, KitchenPage) → melta light theme. Customer/board pages (BoardPage, TablePage) → dark theme maintained. POSPage gains a new collapsible sidebar (useState, no API changes).

**Tech Stack:** React, Tailwind CSS (CDN via vite), existing component structure unchanged.

---

## Common Substitution Patterns

All tasks below apply these substitutions unless noted otherwise. Know them — they apply everywhere.

**Color replacements (Tailwind classes):**
```
indigo-50   → primary-50     (#f0f5ff)
indigo-100  → primary-100
indigo-200  → primary-200
indigo-300  → primary-300
indigo-400  → primary-400
indigo-500  → primary-500    (#2b70ef)
indigo-600  → primary-600
indigo-700  → primary-700
gray-100    → slate-100
gray-200    → slate-200
gray-300    → slate-300
gray-400    → slate-400
gray-500    → slate-500
gray-600    → slate-600
gray-700    → slate-700
gray-800    → slate-800
gray-900    → slate-900
```

**Modal container:** `rounded-2xl shadow-2xl border border-gray-100` → `rounded-xl shadow-xl border border-slate-200`

**Modal close button:** Replace `✕` text with SVG:
```jsx
<button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
</button>
```

**Form input class (`inp` constant):**
```
bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm
focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500
caret-primary-500 transition-colors w-full
```

**Form label class (`lbl` constant):**
```
block text-xs font-semibold text-slate-500 mb-1.5
```

**Select wrapper pattern (replaces bare `<select className={inp}>`):**
```jsx
<div className="relative">
  <select className={`${inp} appearance-none pr-8`} ...>
    ...
  </select>
  <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
</div>
```

**CTA button (M):**
```
inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold
bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer
```

**Sub button:**
```
inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium
bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-gray-50 cursor-pointer
```

**Delete button:**
```
inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-bold
bg-red-500 text-white rounded-lg hover:bg-red-600 cursor-pointer
```

---

## Task 1: Create feature branch

**Files:** none

- [ ] **Step 1: Create and checkout branch**
```bash
git checkout -b feature/melta-redesign
```
Expected: `Switched to a new branch 'feature/melta-redesign'`

---

## Task 2: POSPage — Sidebar redesign with collapsible

**Files:**
- Modify: `client/src/pages/POSPage.jsx`

This is the most complex task. The sidebar gains `collapsed` state. Emoji icons are replaced with Lucide-style SVG paths inline.

- [ ] **Step 1: Add collapsed state and SVG icon definitions**

Inside `export default function POSPage()`, add after the existing `useState` calls:
```jsx
const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
```

- [ ] **Step 2: Replace the NAV_ITEMS array**

Replace the entire `NAV_ITEMS` array with SVG-bearing objects:
```jsx
const NAV_ITEMS = [
  {
    id: 'pos', label: 'レジ画面', desc: 'テーブル選択・注文',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  },
  {
    id: 'tables', label: 'テーブル管理', desc: 'テーブル・カウンター',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
  },
  {
    id: 'menu', label: '商品管理', desc: 'メニュー・価格設定',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>,
  },
  {
    id: 'categories', label: 'カテゴリ管理', desc: 'カテゴリ・サブカテゴリ',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  },
  {
    id: 'pricing', label: '価格エンジン', desc: 'パラメータ設定',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>,
  },
  {
    id: 'reports', label: '売上管理', desc: '日次レポート・分析',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  },
  {
    id: 'receipts', label: '伝票情報', desc: '会計済み伝票の閲覧',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  },
  {
    id: 'system', label: 'システム管理', desc: '消費税・システム設定',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
];
```

- [ ] **Step 3: Replace the entire return JSX**

Replace `return (` through the closing `);` with:
```jsx
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ─── サイドバー ─── */}
      <aside
        style={{ width: sidebarCollapsed ? '56px' : '224px', transition: 'width 0.2s ease' }}
        className="bg-white border-r border-slate-200 flex flex-col flex-shrink-0 overflow-hidden"
      >
        {/* ブランドヘッダー */}
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center gap-2 px-0 py-3 border-b border-slate-100 flex-shrink-0">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/></svg>
            </div>
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="サイドバーを展開"
              className="w-7 h-7 flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-primary-500 cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-slate-100 flex-shrink-0">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-slate-900 text-sm leading-tight">Sports Bar</p>
              <p className="text-[11px] text-slate-400 font-medium">POS 管理画面</p>
            </div>
            <button
              onClick={() => setSidebarCollapsed(true)}
              title="サイドバーを折りたたむ"
              className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-md bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer flex-shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
        )}

        {/* ナビゲーション */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSetView(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full text-left rounded-lg transition-all flex items-center gap-2.5 ${
                  sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'
                } ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className={`flex-shrink-0 w-4 h-4 ${isActive ? 'text-primary-600' : ''}`}>
                  {item.icon}
                </span>
                {!sidebarCollapsed && (
                  <div className="min-w-0">
                    <span className={`text-sm block font-semibold truncate ${isActive ? 'text-primary-700' : ''}`}>
                      {item.label}
                    </span>
                    <span className={`text-[10px] block truncate ${isActive ? 'text-primary-400' : 'text-slate-400'}`}>
                      {item.desc}
                    </span>
                  </div>
                )}
              </button>
            );
          })}

          <div className={`pt-2 mt-1 border-t border-slate-100 space-y-0.5`}>
            {[
              {
                href: '/board',
                label: '価格ボード',
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
              },
              {
                href: '/kitchen',
                label: 'キッチン',
                icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
              },
            ].map(({ href, label, icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={sidebarCollapsed ? label : undefined}
                className={`flex items-center gap-2.5 w-full rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors ${
                  sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'
                }`}
              >
                <span className="flex-shrink-0 w-4 h-4">{icon}</span>
                {!sidebarCollapsed && (
                  <span className="text-sm font-semibold block flex-1">{label}</span>
                )}
                {!sidebarCollapsed && <span className="text-[10px] text-slate-300">↗</span>}
              </a>
            ))}
          </div>
        </nav>

        {/* ステータス */}
        <div className="p-2.5 border-t border-slate-100 flex-shrink-0">
          <div className="px-3 py-2.5 bg-slate-50 rounded-lg border border-slate-100">
            {!sidebarCollapsed && (
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">テーブル稼働</p>
            )}
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-800">{occupiedCount}</span>
              {!sidebarCollapsed && <span className="text-sm text-slate-400 font-medium">/ {tables.length} 席</span>}
            </div>
          </div>
        </div>
      </aside>

      {/* ─── メインコンテンツ ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* コンテンツヘッダー */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-primary-500 w-[18px] h-[18px] flex-shrink-0">{currentNav?.icon}</span>
            <div>
              <h1 className="font-bold text-slate-900 text-base">{currentNav?.label}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{currentNav?.desc}</p>
            </div>
          </div>
        </header>

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
```

- [ ] **Step 4: Verify visually**

```bash
cd /Users/takaadm/Desktop/bar-pos-system && npm run dev
```
Open http://localhost:5173. Confirm:
- Sidebar shows icon+label by default (224px)
- `←` collapses to 56px icon-only
- `→` re-expands
- Active item is primary blue
- No emoji visible anywhere in sidebar

- [ ] **Step 5: Commit**
```bash
git add client/src/pages/POSPage.jsx
git commit -m "feat: redesign POSPage sidebar with melta theme and collapsible toggle"
```

---

## Task 3: TableGrid — melta card redesign

**Files:**
- Modify: `client/src/components/pos/TableGrid.jsx`

- [ ] **Step 1: Replace grid container class**

```
// Old
className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-6"

// New
className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-6"
```
(unchanged — keep as is)

- [ ] **Step 2: Replace button card classes**

Replace the `className` on the `<button>` card element:
```jsx
// Old (multi-line className with isOccupied/isSelected logic)

// New
className={`
  relative rounded-xl text-left transition-all duration-150 overflow-hidden
  ${isOccupied
    ? 'bg-white border-[1.5px] border-primary-200 shadow-sm'
    : 'bg-white border border-slate-200 shadow-sm'
  }
  ${isSelected
    ? 'ring-2 ring-offset-2 ring-primary-400'
    : 'hover:shadow-md hover:-translate-y-0.5'
  }
`}
```

- [ ] **Step 3: Replace type badge classes**

```jsx
// Old
className={`px-3 py-1.5 border-b text-xs font-bold tracking-wide ${
  isOccupied
    ? isCounter
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
    : 'bg-slate-50 border-slate-100 text-slate-400'
}`}

// New
className={`px-3 py-1.5 border-b text-[10px] font-bold tracking-wider uppercase ${
  isOccupied
    ? 'bg-primary-50 border-primary-100 text-primary-600'
    : 'bg-slate-50 border-slate-100 text-slate-400'
}`}
```

- [ ] **Step 4: Replace price and elapsed classes**

```jsx
// Old price class
className={`text-base font-black ${isCounter ? 'text-amber-600' : 'text-indigo-600'}`}

// New price class
className="text-base font-black text-primary-600"
```

Replace the elapsed time row with clock SVG:
```jsx
// Old
<p className="text-xs text-slate-400 flex items-center gap-1">
  <span>⏱</span>
  {order ? elapsed(order.opened_at, now) : '00:00'}
</p>

// New
<p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  {order ? elapsed(order.opened_at, now) : '00:00'}
</p>
```

- [ ] **Step 5: Remove the occupied indicator dot** (was bottom-right colored dot)

Delete these lines entirely:
```jsx
{isOccupied && (
  <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
    isCounter ? 'bg-amber-400' : 'bg-indigo-400'
  }`} />
)}
```

- [ ] **Step 6: Verify + commit**
```bash
# Server should already be running from Task 2
# Open http://localhost:5173 → レジ画面 → confirm cards look correct
git add client/src/components/pos/TableGrid.jsx
git commit -m "feat: redesign TableGrid cards with melta theme"
```

---

## Task 4: OrderPanel — melta redesign

**Files:**
- Modify: `client/src/components/pos/OrderPanel.jsx`

- [ ] **Step 1: Replace ConfirmModal classes**

Apply common modal substitutions to `ConfirmModal`:
```jsx
// container: rounded-2xl → rounded-xl, border-slate-100 → border-slate-200
<div className="bg-white rounded-xl p-6 w-80 shadow-xl pop-in border border-slate-200">

// Cancel button
className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition-colors"

// Confirm button: keep existing confirmClass prop (caller passes it)
```

- [ ] **Step 2: Replace indigo references in action handlers**

In `handleAddItem` and `handleQtyIncrease`:
```jsx
confirmClass: 'bg-primary-500 hover:bg-primary-700',
```

In `handleQtyDecrease` (non-delete case):
```jsx
confirmClass: isDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-500 hover:bg-primary-700',
```

- [ ] **Step 3: Replace header close button**

```jsx
// Old
className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors text-lg leading-none"
>
  ✕

// New
className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
```

- [ ] **Step 4: Replace order item row classes**

```jsx
// Old
className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3"

// New (unchanged — already matches melta)
className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3"
```

- [ ] **Step 5: Replace quantity + button and item price color**

Line ~207: `+` button on order items:
```jsx
// Old
className="w-7 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-base font-bold flex items-center justify-center transition-colors"

// New
className="w-7 h-7 rounded-lg bg-primary-500 hover:bg-primary-700 text-white text-base font-bold flex items-center justify-center transition-colors"
```

Line ~212: item total price:
```jsx
// Old
className="text-sm font-bold text-indigo-700 w-16 text-right flex-shrink-0"

// New
className="text-sm font-bold text-primary-600 w-16 text-right flex-shrink-0"
```

Line ~241: 注文を開始する button:
```jsx
// Old
className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors shadow-sm"

// New
className="w-full py-3.5 bg-primary-500 hover:bg-primary-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors shadow-sm"
```

Note: 会計する button uses `bg-emerald-600` — keep unchanged (green = positive payment completion).

- [ ] **Step 6: Commit**
```bash
git add client/src/components/pos/OrderPanel.jsx
git commit -m "feat: redesign OrderPanel with melta theme"
```

---

## Task 5: MenuGrid — melta redesign

**Files:**
- Modify: `client/src/components/pos/MenuGrid.jsx`

- [ ] **Step 1: Replace MenuItem card button classes**

```jsx
// Old
className={`flex flex-col justify-between p-3.5 bg-white hover:bg-indigo-50 active:scale-95 rounded-xl border-2 border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all text-left w-full ${...}`}

// New
className={`flex flex-col justify-between p-3.5 bg-white hover:bg-primary-50 active:scale-95 rounded-xl border border-slate-200 hover:border-primary-300 hover:shadow-sm transition-all text-left w-full ${
  flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''
}`}
```

- [ ] **Step 2: Replace price color**

```jsx
// Old
className="text-base font-black text-indigo-700"

// New
className="text-base font-black text-primary-600"
```

- [ ] **Step 3: Replace category tab active state**

Find the category filter tabs (buttons mapping over `categories`). Apply:
```jsx
// Active tab
className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-primary-500 text-white"

// Inactive tab
className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
```

- [ ] **Step 4: Replace subcategory chip active state**

```jsx
// Active chip
className="px-2.5 py-1 rounded-full text-xs font-semibold bg-primary-100 text-primary-700"

// Inactive chip
className="px-2.5 py-1 rounded-full text-xs font-medium text-slate-400 hover:bg-slate-100"
```

- [ ] **Step 5: Commit**
```bash
git add client/src/components/pos/MenuGrid.jsx
git commit -m "feat: redesign MenuGrid with melta theme"
```

---

## Task 6: PaymentModal — melta redesign

**Files:**
- Modify: `client/src/components/pos/PaymentModal.jsx`

- [ ] **Step 1: Replace payment method icon emoji**

```jsx
// Old
const PAYMENT_METHODS = [
  { id: 'cash',   label: '現金',       icon: '💴' },
  { id: 'card',   label: 'カード',     icon: '💳' },
  { id: 'emoney', label: '電子マネー', icon: '📱' },
];

// New — remove icons field, use text only (or keep emoji only on this component since it's payment-specific UX)
// Decision: keep emoji here for payment method recognition — these are UX affordances, not nav icons
```
Leave `PAYMENT_METHODS` emoji unchanged — payment method icons aid recognition.

- [ ] **Step 2: Replace numpad button classes**

```jsx
// Old action buttons
'bg-gray-200 hover:bg-gray-300 text-gray-600'

// New
'bg-slate-100 hover:bg-slate-200 text-slate-600'

// Old number buttons
'bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-900 shadow-sm'

// New
'bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-900 shadow-sm'
```

- [ ] **Step 3: Apply common modal substitutions throughout the file**

Apply Common Substitution Patterns (top of this plan):
- `gray-*` → `slate-*`
- `indigo-*` → `primary-*`
- `rounded-2xl` → `rounded-xl`
- Close button ✕ → SVG icon

- [ ] **Step 4: Commit**
```bash
git add client/src/components/pos/PaymentModal.jsx
git commit -m "feat: redesign PaymentModal with melta theme"
```

---

## Task 7: MenuManager — melta redesign

**Files:**
- Modify: `client/src/components/menu/MenuManager.jsx`

- [ ] **Step 1: Replace ModalShell**

```jsx
function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className={`bg-white rounded-xl shadow-xl w-full mx-4 border border-slate-200 max-h-[90vh] flex flex-col ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
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
```

- [ ] **Step 2: Replace `inp` and `lbl` constants**

```jsx
const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';
```

- [ ] **Step 3: Wrap all `<select>` elements in the Select wrapper pattern**

For every `<select className={inp}>` in MenuItemForm, wrap in:
```jsx
<div className="relative">
  <select className={`${inp} appearance-none pr-8`} ...>...</select>
  <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
</div>
```

- [ ] **Step 4: Replace toggle buttons (is_drink, is_active)**

```jsx
// Old active state
'border-indigo-500 bg-indigo-50 text-indigo-700'

// New active state
'border-primary-500 bg-primary-50 text-primary-700'

// Inactive state (no change needed: 'border-gray-200 bg-white text-gray-600' → 'border-slate-200 bg-white text-slate-600')
'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
```

- [ ] **Step 5: Apply common substitutions to list view and action buttons**

In the menu item list (table layout):
- Table outer: `bg-white rounded-xl border border-slate-200 overflow-hidden`
- Header row: `bg-gray-50 border-b border-slate-200`
- Header cells: `text-xs font-semibold text-slate-500 uppercase tracking-wider py-2.5 px-4`
- Data rows: `border-b border-slate-50 hover:bg-gray-50 transition-colors`

Add/Edit button:
```jsx
className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-semibold bg-primary-500 text-white rounded-lg hover:bg-primary-700 cursor-pointer"
```

- [ ] **Step 6: Commit**
```bash
git add client/src/components/menu/MenuManager.jsx
git commit -m "feat: redesign MenuManager with melta theme"
```

---

## Task 8: CategoryManager — melta redesign

**Files:**
- Modify: `client/src/components/menu/CategoryManager.jsx`

- [ ] **Step 1: Replace `inp` and `lbl` constants at module scope**

```jsx
const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';
```

- [ ] **Step 2: Replace ModalShell** (identical to Task 7 Step 1)

```jsx
function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wrap select elements in FormFields**

In `FormFields`, for `f.type === 'select'` branch, wrap `<select>` in the Select wrapper pattern from Common Substitutions.

- [ ] **Step 4: Apply common substitutions throughout**

- `indigo-*` → `primary-*`
- `gray-*` → `slate-*`
- List/table styling: same as Task 7 Step 5

- [ ] **Step 5: Commit**
```bash
git add client/src/components/menu/CategoryManager.jsx
git commit -m "feat: redesign CategoryManager with melta theme"
```

---

## Task 9: TableManager — melta redesign

**Files:**
- Modify: `client/src/components/tables/TableManager.jsx`

- [ ] **Step 1: Replace ModalShell** (same as Task 8 Step 2)

- [ ] **Step 2: Replace `inp` and `lbl` constants**

```jsx
const inp = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500 transition-colors';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';
```

- [ ] **Step 3: Replace toggle buttons (table_type)**

```jsx
// Active
'border-primary-500 bg-primary-50 text-primary-700'

// Inactive
'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
```

- [ ] **Step 4: Apply common substitutions**

- List/table: same melta table pattern
- Type badge: テーブル → `bg-primary-50 text-primary-600`, カウンター → `bg-emerald-50 text-emerald-700`
- Edit icon button: `w-7 h-7 border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50`
- Delete icon button: `w-7 h-7 border border-red-200 rounded-lg bg-red-50 text-red-400 hover:bg-red-100`

- [ ] **Step 5: Commit**
```bash
git add client/src/components/tables/TableManager.jsx
git commit -m "feat: redesign TableManager with melta theme"
```

---

## Task 10: PricingSettings + SystemSettingsPage — melta redesign

**Files:**
- Modify: `client/src/components/menu/PricingSettings.jsx`
- Modify: `client/src/pages/SystemSettingsPage.jsx`

- [ ] **Step 1: PricingSettings — apply common substitutions**

- `indigo-*` → `primary-*`
- `gray-*` → `slate-*`
- Input classes: use `inp` constant from Common Substitutions
- Save button: CTA (M) pattern
- Section card: `bg-white rounded-xl border border-slate-200 p-6`
- Success alert (saved): `flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg`

- [ ] **Step 2: SystemSettingsPage — apply common substitutions**

Same pattern. Also:
- CrashModal: apply ModalShell redesign (rounded-xl, SVG ×, slate colors)
- Filter chips for category/subcategory selection: `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm border cursor-pointer` + aria-selected active state `border-primary-500 bg-primary-50 text-primary-700`

- [ ] **Step 3: Commit**
```bash
git add client/src/components/menu/PricingSettings.jsx client/src/pages/SystemSettingsPage.jsx
git commit -m "feat: redesign PricingSettings and SystemSettingsPage with melta theme"
```

---

## Task 11: ReportsPage + ReceiptsPage — melta redesign

**Files:**
- Modify: `client/src/pages/ReportsPage.jsx`
- Modify: `client/src/pages/ReceiptsPage.jsx`

- [ ] **Step 1: ReportsPage — replace StatCard**

```jsx
function StatCard({ label, value }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
      <p className="text-2xl font-black text-slate-900 leading-none">{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: ReportsPage — apply common substitutions**

- `gray-*` → `slate-*`
- `indigo-*` → `primary-*`
- Date input: use `inp` constant
- Bar chart bars (top items revenue bars): `bg-primary-400` for the fill bar

- [ ] **Step 3: ReceiptsPage — apply common substitutions**

- `gray-*` → `slate-*`, `indigo-*` → `primary-*`
- Date input: use `inp` constant
- Receipt card expand: `bg-white border border-slate-200 rounded-xl`
- Expanded row details: `bg-slate-50 border-t border-slate-100`

- [ ] **Step 4: Commit**
```bash
git add client/src/pages/ReportsPage.jsx client/src/pages/ReceiptsPage.jsx
git commit -m "feat: redesign ReportsPage and ReceiptsPage with melta theme"
```

---

## Task 12: KitchenPage — melta redesign

**Files:**
- Modify: `client/src/pages/KitchenPage.jsx`

- [ ] **Step 1: Replace CancelConfirmModal**

```jsx
function CancelConfirmModal({ item, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 fade-in">
      <div className="bg-white border border-slate-200 rounded-xl p-6 w-80 shadow-xl pop-in">
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
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
          >
            戻る
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-lg transition-colors"
          >
            キャンセルする
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace header**

```jsx
<header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
  <div className="flex items-center gap-3">
    <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
        <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
      </svg>
    </div>
    <div>
      <h1 className="font-bold text-slate-900 text-base leading-tight">キッチン</h1>
      <p className="text-xs text-slate-400 mt-0.5">オープン注文 リアルタイム表示</p>
    </div>
  </div>
  <div className="flex items-center gap-3">
    <span className={`text-sm font-semibold px-3 py-1.5 rounded-full ${
      rows.length === 0
        ? 'bg-slate-100 text-slate-400'
        : 'bg-amber-100 text-amber-800'
    }`}>
      {rows.length} 件対応中
    </span>
    <button
      onClick={refetch}
      className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors font-medium"
    >
      更新
    </button>
  </div>
</header>
```

- [ ] **Step 3: Replace main wrapper background**

```jsx
// Old
<div className="min-h-screen bg-slate-50 text-slate-900">

// New
<div className="min-h-screen bg-gray-50 text-slate-900">
```

- [ ] **Step 4: Replace table header row**

```jsx
<div className="grid grid-cols-[120px_140px_1fr_64px_100px_100px] gap-0 bg-gray-50 border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
```

- [ ] **Step 5: Replace serve button (emerald → primary)**

```jsx
// Old
className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"

// New
className="px-3 py-1.5 bg-primary-500 hover:bg-primary-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
```

- [ ] **Step 6: Replace cancel button**

```jsx
// Old
className="px-3 py-1.5 bg-slate-100 hover:bg-red-100 hover:text-red-700 disabled:opacity-40 text-slate-500 text-xs font-bold rounded-lg transition-colors"

// New
className="px-3 py-1.5 bg-slate-100 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 text-slate-500 text-xs font-semibold rounded-lg transition-colors"
```

- [ ] **Step 7: Keep urgent row unchanged**

The red highlight row (`bg-red-50 border-l-4 border-red-500`) is intentional — do NOT change it.

- [ ] **Step 8: Commit**
```bash
git add client/src/pages/KitchenPage.jsx
git commit -m "feat: redesign KitchenPage with melta light theme"
```

---

## Task 13: BoardPage + PriceRow — font and typography adjustment

**Files:**
- Modify: `client/src/pages/BoardPage.jsx`
- Modify: `client/src/components/board/PriceRow.jsx`

Dark theme is maintained. Only fix typography consistency.

- [ ] **Step 1: BoardPage — no color changes needed**

The current dark theme (slate-950, amber-300, green-400, red-400) is already approved as-is. Only verify Inter font loads — the `vite`/Tailwind config already includes it via `index.html` or `tailwind.config.js`. No file changes required unless font stack is missing.

Check `client/index.html` for font import:
```bash
grep -n "Inter" client/index.html client/tailwind.config.js 2>/dev/null || echo "not found"
```

- [ ] **Step 2: If Inter is missing from index.html, add it**

If the grep above returns "not found", add to `client/index.html` `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
```

- [ ] **Step 3: PriceRow — no changes needed**

PriceRow already uses correct dark theme classes. No changes.

- [ ] **Step 4: Commit (only if index.html was changed)**
```bash
git add client/index.html
git commit -m "feat: add Inter font import for melta typography"
```

---

## Task 14: TablePage + TickerBar — primary color adjustments

**Files:**
- Modify: `client/src/pages/TablePage.jsx`
- Modify: `client/src/components/layout/TickerBar.jsx`

Dark theme is maintained. Only swap indigo references.

- [ ] **Step 1: TablePage — replace ConfirmModal button**

```jsx
// Old
className="w-full py-4 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 active:scale-[0.98] text-slate-900 font-black text-lg rounded-2xl transition-all shadow-xl shadow-amber-500/25 mb-3"

// Keep amber — this is a customer-facing CTA, amber is intentional UX
// No change needed
```

No indigo references exist in TablePage — verify:
```bash
grep -n "indigo" client/src/pages/TablePage.jsx
```
If nothing found, no changes needed.

- [ ] **Step 2: TickerBar — no changes needed**

TickerBar uses `slate-950/slate-800` dark theme and amber/green/red for prices — all intentional for the dark customer display. No changes.

- [ ] **Step 3: Commit if any changes were made**
```bash
git add client/src/pages/TablePage.jsx client/src/components/layout/TickerBar.jsx
git commit -m "feat: apply melta primary color adjustments to TablePage"
```

---

## Task 15: Final verification and merge to main

**Files:** none (git operations only)

- [ ] **Step 1: Run dev server and do full visual check**

```bash
npm run dev
```

Check each route:
- http://localhost:5173 — POSPage: sidebar expand/collapse works, all views load
- http://localhost:5173/board — BoardPage: dark theme intact
- http://localhost:5173/kitchen — KitchenPage: light theme, primary blue buttons
- http://localhost:5173/table/1 — TablePage: dark theme intact

- [ ] **Step 2: Check for remaining indigo references in light-theme files**

```bash
grep -rn "indigo" client/src/pages/POSPage.jsx client/src/pages/KitchenPage.jsx client/src/pages/ReportsPage.jsx client/src/pages/ReceiptsPage.jsx client/src/pages/SystemSettingsPage.jsx client/src/components/pos/ client/src/components/menu/ client/src/components/tables/
```
Expected: no results. If any found, fix and commit.

- [ ] **Step 3: Check for remaining emoji in nav/UI (non-payment)**

```bash
grep -rn "🏠\|🪑\|📋\|🏷\|⚙️\|📊\|🧾\|🔧\|📺\|🍳\|🍺" client/src/pages/POSPage.jsx
```
Expected: no results.

- [ ] **Step 4: Merge to main**

```bash
git checkout main
git merge feature/melta-redesign --no-ff -m "feat: apply melta UI full redesign

- Staff pages (POSPage, KitchenPage) converted to melta light theme
- primary-500 blue (#2b70ef) replaces all indigo accents
- POSPage sidebar: collapsible toggle (224px ↔ 56px), Lucide SVG icons
- All modals: rounded-xl, SVG × close button, melta form inputs
- Customer/board pages (BoardPage, TablePage) dark theme unchanged

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 5: Verify merge**

```bash
git log --oneline -5
```
Expected: merge commit at top, followed by task commits.
