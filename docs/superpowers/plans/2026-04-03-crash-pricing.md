# 株価暴落機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** カテゴリ・サブカテゴリ単位で暴落許可商品の価格を一括暴落・解除できる機能をサーバーとクライアントに追加する。

**Architecture:** menu_items/categories/subcategories に暴落関連カラムを追加し、menu.js に暴落エンドポイントを追加。SystemSettingsPage に CrashModal を実装し、Socket.io 経由でリアルタイムに全クライアントへ価格変更をブロードキャストする。

**Tech Stack:** Node.js/Express, PostgreSQL (raw SQL via pg), React + TanStack Query v5, Zustand, Socket.io, Tailwind CSS

---

## File Map

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `server/db/schema.sql` | Modify | categories/subcategories に crash_pct、menu_items に crash_enabled/is_crashed を追加 |
| `server/routes/menu.js` | Modify | ITEM_SELECT に新フィールド追加、PATCH の更新対象追加、POST /crash・POST /crash/reset エンドポイント追加 |
| `client/src/api.js` | Modify | triggerCrash・resetCrash を追加 |
| `client/src/components/menu/CategoryManager.jsx` | Modify | catFields・subcatFields に crash_pct を追加、編集フォーム初期値に crash_pct を追加 |
| `client/src/components/menu/MenuManager.jsx` | Modify | MenuItemForm に crash_enabled チェックボックスを追加 |
| `client/src/pages/SystemSettingsPage.jsx` | Modify | CrashModal コンポーネントと CrashSection を追加 |

---

## Task 1: DBスキーマにカラムを追加する

**Files:**
- Modify: `server/db/schema.sql`

- [ ] **Step 1: schema.sql に ALTER TABLE を追記する**

`server/db/schema.sql` のマイグレーションブロック末尾（`CREATE INDEX` の直前）に以下を追加：

```sql
-- 株価暴落機能
ALTER TABLE categories   ADD COLUMN IF NOT EXISTS crash_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS crash_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE menu_items   ADD COLUMN IF NOT EXISTS crash_enabled  BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE menu_items   ADD COLUMN IF NOT EXISTS is_crashed     BOOLEAN       NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Docker 経由でマイグレーションを適用する**

```bash
docker compose exec postgres psql -U bar -d bardb -c "
ALTER TABLE categories    ADD COLUMN IF NOT EXISTS crash_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS crash_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE menu_items    ADD COLUMN IF NOT EXISTS crash_enabled  BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE menu_items    ADD COLUMN IF NOT EXISTS is_crashed     BOOLEAN       NOT NULL DEFAULT FALSE;
"
```

期待出力: `ALTER TABLE` が 4 行

- [ ] **Step 3: カラムが追加されたことを確認する**

```bash
docker compose exec postgres psql -U bar -d bardb -c "\d menu_items" | grep crash
```

期待出力:
```
 crash_enabled | boolean              | not null default false
 is_crashed    | boolean              | not null default false
```

- [ ] **Step 4: コミット**

```bash
git add server/db/schema.sql
git commit -m "feat: add crash pricing columns to DB schema"
```

---

## Task 2: サーバー — menu.js の既存ルートに新フィールドを追加する

**Files:**
- Modify: `server/routes/menu.js`

- [ ] **Step 1: ファイル冒頭に broadcast の import を追加する**

`server/routes/menu.js` の 3 行目（`const { query } = require('../db/database');` の直後）に追加：

```js
const { broadcast } = require('../services/socketService');
```

- [ ] **Step 2: ITEM_SELECT に crash_enabled・is_crashed を追加する**

`ITEM_SELECT` 定数（現在 6 行目〜16 行目）を以下に置き換える：

```js
const ITEM_SELECT = `
  SELECT m.id, m.category_id, m.subcategory_id, m.name,
    m.base_price::float, m.current_price::float,
    m.min_price::float, m.max_price::float,
    m.price_step_up::float, m.price_step_down::float,
    m.is_drink, m.is_active, m.crash_enabled, m.is_crashed,
    c.name  AS category_name,  c.sort_order,
    sc.name AS subcategory_name, sc.sort_order AS subcategory_sort_order
  FROM menu_items m
  JOIN categories c ON m.category_id = c.id
  LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
`;
```

- [ ] **Step 3: PATCH /api/menu/:id に crash_enabled・is_crashed を追加する**

`PATCH /:id` ハンドラ内の分解代入（現在 `const { name, base_price, ... } = req.body;`）を以下に置き換える：

```js
const { name, base_price, min_price, max_price, price_step_up, price_step_down,
        is_drink, is_active, subcategory_id, crash_enabled, is_crashed } = req.body;
```

その直下の条件ブロック群末尾（`if (subcategory_id !== undefined)` の後）に追加：

```js
if (crash_enabled !== undefined) { updates.push(`crash_enabled = $${idx++}`); values.push(crash_enabled); }
if (is_crashed !== undefined)    { updates.push(`is_crashed = $${idx++}`);    values.push(is_crashed); }
```

- [ ] **Step 4: PATCH /api/menu/categories/:id に crash_pct を追加する**

`PATCH /categories/:id` ハンドラ内の分解代入を以下に置き換える：

```js
const { name, sort_order, crash_pct } = req.body;
```

その直下の条件ブロック群末尾（`if (sort_order !== undefined)` の後）に追加：

```js
if (crash_pct !== undefined) { updates.push(`crash_pct = $${idx++}`); values.push(crash_pct); }
```

- [ ] **Step 5: PATCH /api/menu/subcategories/:id に crash_pct を追加する**

`PATCH /subcategories/:id` ハンドラ内の分解代入を以下に置き換える：

```js
const { name, sort_order, category_id, crash_pct } = req.body;
```

その直下の条件ブロック群末尾（`if (category_id !== undefined)` の後）に追加：

```js
if (crash_pct !== undefined) { updates.push(`crash_pct = $${idx++}`); values.push(crash_pct); }
```

- [ ] **Step 6: サーバーを再起動して動作確認する**

```bash
docker compose restart server
```

```bash
curl -s http://localhost/api/menu/all | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  const items = JSON.parse(d);
  console.log(items[0]?.crash_enabled, items[0]?.is_crashed);
"
```

期待出力: `false false`

```bash
curl -s http://localhost/api/menu/categories | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  const cats = JSON.parse(d);
  console.log(cats[0]?.crash_pct);
"
```

期待出力: `0`

- [ ] **Step 7: コミット**

```bash
git add server/routes/menu.js
git commit -m "feat: expose crash fields in menu routes"
```

---

## Task 3: サーバー — 暴落・解除エンドポイントを追加する

**Files:**
- Modify: `server/routes/menu.js`

- [ ] **Step 1: POST /crash エンドポイントを追加する**

`server/routes/menu.js` の `// DELETE /:id` ルートの直前（`// PATCH /:id` より前）に以下を追加する：

```js
// POST /api/menu/crash
router.post('/crash', async (req, res, next) => {
  try {
    const { category_ids = [], subcategory_ids = [] } = req.body;
    if (category_ids.length === 0 && subcategory_ids.length === 0) {
      return res.status(400).json({ error: 'category_ids or subcategory_ids required' });
    }

    const { rows: targets } = await query(`
      SELECT m.id,
        m.min_price::float,
        COALESCE(
          CASE WHEN m.subcategory_id = ANY($2::int[]) THEN sc.crash_pct::float ELSE NULL END,
          CASE WHEN m.category_id    = ANY($1::int[]) THEN c.crash_pct::float  ELSE NULL END
        ) AS effective_pct
      FROM menu_items m
      JOIN categories c ON m.category_id = c.id
      LEFT JOIN subcategories sc ON m.subcategory_id = sc.id
      WHERE m.crash_enabled = TRUE
        AND m.is_active = TRUE
        AND (m.category_id = ANY($1::int[]) OR m.subcategory_id = ANY($2::int[]))
    `, [category_ids, subcategory_ids]);

    let updated = 0;
    for (const item of targets) {
      const pct = item.effective_pct ?? 0;
      const crashPrice = Math.round(item.min_price * (1 - pct / 100) / 25) * 25;
      await query(
        'UPDATE menu_items SET current_price = $1, is_crashed = TRUE WHERE id = $2',
        [crashPrice, item.id]
      );
      await query(
        'INSERT INTO price_history (menu_item_id, price) VALUES ($1, $2)',
        [item.id, crashPrice]
      );
      updated++;
    }

    const { rows: allPrices } = await query(`
      SELECT id, name, base_price::float, current_price::float,
        ROUND((current_price - base_price) * 100.0 / base_price, 1)::float AS pct_change
      FROM menu_items WHERE is_drink = TRUE AND is_active = TRUE
    `);
    const items = allPrices.map((r) => ({
      ...r,
      direction: r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : 'flat',
    }));
    broadcast('prices:updated', { items, timestamp: Date.now() });

    res.json({ updated });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: POST /crash/reset エンドポイントを追加する**

`POST /crash` の直後に追加する：

```js
// POST /api/menu/crash/reset
router.post('/crash/reset', async (req, res, next) => {
  try {
    const { rows } = await query(`
      UPDATE menu_items
      SET current_price = base_price, is_crashed = FALSE
      WHERE is_crashed = TRUE AND is_active = TRUE
      RETURNING id
    `);

    if (rows.length > 0) {
      const { rows: allPrices } = await query(`
        SELECT id, name, base_price::float, current_price::float,
          ROUND((current_price - base_price) * 100.0 / base_price, 1)::float AS pct_change
        FROM menu_items WHERE is_drink = TRUE AND is_active = TRUE
      `);
      const items = allPrices.map((r) => ({
        ...r,
        direction: r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : 'flat',
      }));
      broadcast('prices:updated', { items, timestamp: Date.now() });
    }

    res.json({ updated: rows.length });
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: サーバーを再起動してエンドポイントを確認する**

```bash
docker compose restart server
```

まず crash_enabled の商品を 1 つ用意して確認する（id=1 の商品を例に）：
```bash
curl -s -X PATCH http://localhost/api/menu/1 \
  -H "Content-Type: application/json" \
  -d '{"crash_enabled": true}' | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  console.log(JSON.parse(d).crash_enabled);
"
```
期待出力: `true`

- [ ] **Step 4: POST /crash を curl でテストする**

カテゴリ ID 1 を指定（実際のIDに合わせる）：
```bash
curl -s -X POST http://localhost/api/menu/crash \
  -H "Content-Type: application/json" \
  -d '{"category_ids":[1],"subcategory_ids":[]}' | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  console.log(JSON.parse(d));
"
```
期待出力: `{ updated: N }` （N は crash_enabled=true の対象商品数）

- [ ] **Step 5: POST /crash/reset を curl でテストする**

```bash
curl -s -X POST http://localhost/api/menu/crash/reset \
  -H "Content-Type: application/json" | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  console.log(JSON.parse(d));
"
```
期待出力: `{ updated: N }`

```bash
curl -s http://localhost/api/menu/all | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  const items = JSON.parse(d);
  console.log(items.filter(i => i.is_crashed));
"
```
期待出力: `[]`（is_crashed が全て false に戻っている）

- [ ] **Step 6: コミット**

```bash
git add server/routes/menu.js
git commit -m "feat: add POST /menu/crash and /menu/crash/reset endpoints"
```

---

## Task 4: クライアント — api.js に新メソッドを追加する

**Files:**
- Modify: `client/src/api.js`

- [ ] **Step 1: api.js に triggerCrash・resetCrash を追加する**

`client/src/api.js` の `// Kitchen` セクションの直前に追加する：

```js
  // Crash
  triggerCrash: (data) => req('/menu/crash', { method: 'POST', body: JSON.stringify(data) }),
  resetCrash:   ()     => req('/menu/crash/reset', { method: 'POST' }),
```

- [ ] **Step 2: コミット**

```bash
git add client/src/api.js
git commit -m "feat: add triggerCrash and resetCrash to api.js"
```

---

## Task 5: クライアント — CategoryManager に crash_pct フィールドを追加する

**Files:**
- Modify: `client/src/components/menu/CategoryManager.jsx`

- [ ] **Step 1: catFields に crash_pct を追加する**

`catFields` 配列（現在 2 要素）を以下に置き換える：

```js
const catFields = [
  { key: 'name',       label: 'カテゴリ名',    required: true, placeholder: '例: ビール' },
  { key: 'sort_order', label: '表示順序',       type: 'number', min: 0, placeholder: '0' },
  { key: 'crash_pct',  label: '暴落割引率（%）', type: 'number', min: 0, max: 100, placeholder: '0' },
];
```

- [ ] **Step 2: カテゴリ編集ボタンの onClick に crash_pct を追加する**

カテゴリヘッダー内の編集ボタン（`setCatForm({ name: cat.name, sort_order: cat.sort_order })`）を以下に置き換える：

```js
setCatForm({ name: cat.name, sort_order: cat.sort_order, crash_pct: cat.crash_pct ?? 0 })
```

- [ ] **Step 3: subcatFields 関数に crash_pct を追加する**

`subcatFields` 関数（現在 3 要素）を以下に置き換える：

```js
const subcatFields = (catId) => [
  { key: 'category_id', label: 'カテゴリ', type: 'select', required: true, options: categories.map((c) => ({ value: c.id, label: c.name })) },
  { key: 'name',        label: 'サブカテゴリ名',  required: true, placeholder: '例: 国産ビール' },
  { key: 'sort_order',  label: '表示順序',         type: 'number', min: 0, placeholder: '0' },
  { key: 'crash_pct',   label: '暴落割引率（%）',  type: 'number', min: 0, max: 100, placeholder: '0' },
];
```

- [ ] **Step 4: サブカテゴリ編集ボタンの onClick に crash_pct を追加する**

`SubcategoryRow` の `onEdit` 呼び出し（`setSubcatForm({ name: s.name, sort_order: s.sort_order, category_id: s.category_id })`）を以下に置き換える：

```js
setSubcatForm({ name: s.name, sort_order: s.sort_order, category_id: s.category_id, crash_pct: s.crash_pct ?? 0 })
```

- [ ] **Step 5: ブラウザで CategoryManager を開いて確認する**

- カテゴリの「編集」を開くと「暴落割引率（%）」フィールドが表示されること
- サブカテゴリの「編集」を開いても同様に表示されること
- 例: ビールカテゴリに 30 を入力して保存し、`curl -s http://localhost/api/menu/categories` で crash_pct が返ることを確認

```bash
curl -s http://localhost/api/menu/categories | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  JSON.parse(d).forEach(c => console.log(c.name, c.crash_pct));
"
```

- [ ] **Step 6: コミット**

```bash
git add client/src/components/menu/CategoryManager.jsx
git commit -m "feat: add crash_pct field to CategoryManager forms"
```

---

## Task 6: クライアント — MenuManager に crash_enabled チェックボックスを追加する

**Files:**
- Modify: `client/src/components/menu/MenuManager.jsx`

- [ ] **Step 1: MenuItemForm の初期フォーム状態に crash_enabled を追加する**

`MenuItemForm` 内の `useState` 初期値（`form` の初期化ブロック）に `crash_enabled` を追加する：

```js
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
});
```

- [ ] **Step 2: handleSubmit に crash_enabled を追加する**

`handleSubmit` 内の `onSave({...})` 呼び出しに `crash_enabled` を追加する：

```js
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
});
```

- [ ] **Step 3: is_drink ブロック内に crash_enabled チェックボックスを追加する**

`{Boolean(form.is_drink) && (` で始まる indigo-50 ブロック内（`price_step_up`/`price_step_down` グリッドの後）に以下を追加する：

```jsx
{Boolean(form.is_drink) && (
  <div className="grid grid-cols-2 gap-3 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
    <div>
      <label className={lbl}>1注文あたり上昇額 (¥)</label>
      <input className={inp} type="number" value={form.price_step_up} onChange={(e) => set('price_step_up', e.target.value)} placeholder="50" min={1} step={1} />
    </div>
    <div>
      <label className={lbl}>1競合注文あたり降下額 (¥)</label>
      <input className={inp} type="number" value={form.price_step_down} onChange={(e) => set('price_step_down', e.target.value)} placeholder="25" min={1} step={1} />
    </div>
    <div className="col-span-2 pt-1 border-t border-indigo-100">
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
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
```

- [ ] **Step 4: ブラウザで MenuManager を開いて確認する**

- ドリンク商品の「編集」を開くと indigo ブロック内に「暴落許可」チェックボックスが表示される
- チェックして保存後、`curl -s http://localhost/api/menu/all` で crash_enabled が true になることを確認

```bash
curl -s http://localhost/api/menu/all | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  JSON.parse(d).filter(i => i.crash_enabled).forEach(i => console.log(i.name, i.crash_enabled));
"
```

- [ ] **Step 5: コミット**

```bash
git add client/src/components/menu/MenuManager.jsx
git commit -m "feat: add crash_enabled checkbox to MenuManager item form"
```

---

## Task 7: クライアント — SystemSettingsPage に暴落セクションを追加する

**Files:**
- Modify: `client/src/pages/SystemSettingsPage.jsx`

- [ ] **Step 1: import に useMutation と新 API を確認する（既に import 済み）**

`SystemSettingsPage.jsx` の import 行に `useMutation` が含まれていることを確認する（既存）。`api` も import 済み。

- [ ] **Step 2: ファイル冒頭の既存 import の直後に CrashModal コンポーネントを追加する**

`function Section` の定義の直前に以下を追加する：

```jsx
function CrashModal({ categories, subcategories, menuItems, onClose, onExecute, isPending }) {
  const [selectedCatIds,    setSelectedCatIds]    = useState(new Set());
  const [selectedSubcatIds, setSelectedSubcatIds] = useState(new Set());

  const subcatsByCategory = subcategories.reduce((acc, s) => {
    if (!acc[s.category_id]) acc[s.category_id] = [];
    acc[s.category_id].push(s);
    return acc;
  }, {});

  const toggleCategory = (catId) => {
    const subs = subcatsByCategory[catId] ?? [];
    const isSelected = selectedCatIds.has(catId);
    setSelectedCatIds((prev) => {
      const next = new Set(prev);
      isSelected ? next.delete(catId) : next.add(catId);
      return next;
    });
    setSelectedSubcatIds((prev) => {
      const next = new Set(prev);
      subs.forEach((s) => isSelected ? next.delete(s.id) : next.add(s.id));
      return next;
    });
  };

  const toggleSubcategory = (subId) => {
    setSelectedSubcatIds((prev) => {
      const next = new Set(prev);
      next.has(subId) ? next.delete(subId) : next.add(subId);
      return next;
    });
  };

  const eligibleCount = menuItems.filter((item) =>
    item.crash_enabled &&
    item.is_active &&
    (selectedCatIds.has(item.category_id) || selectedSubcatIds.has(item.subcategory_id))
  ).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 border border-gray-100 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900">暴落対象を選択</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-1">
          {categories.map((cat) => {
            const subs = subcatsByCategory[cat.id] ?? [];
            return (
              <div key={cat.id}>
                <label className="flex items-center gap-3 py-2 cursor-pointer hover:bg-gray-50 rounded-lg px-2">
                  <input
                    type="checkbox"
                    checked={selectedCatIds.has(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    className="w-4 h-4 accent-red-600 rounded"
                  />
                  <span className="text-sm font-semibold text-gray-800 flex-1">{cat.name}</span>
                  {cat.crash_pct > 0 && (
                    <span className="text-xs text-red-500 font-bold">▼{cat.crash_pct}%</span>
                  )}
                </label>
                {subs.map((sub) => (
                  <label key={sub.id} className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-gray-50 rounded-lg pl-8 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedSubcatIds.has(sub.id)}
                      onChange={() => toggleSubcategory(sub.id)}
                      className="w-4 h-4 accent-red-600 rounded"
                    />
                    <span className="text-sm text-gray-700 flex-1">{sub.name}</span>
                    {sub.crash_pct > 0 && (
                      <span className="text-xs text-red-500 font-bold">▼{sub.crash_pct}%</span>
                    )}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0 space-y-3">
          <p className="text-sm text-gray-600">
            対象商品: <span className="font-bold text-red-600">{eligibleCount} 商品</span>が暴落します
          </p>
          <div className="flex gap-2.5">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={() => onExecute({
                category_ids:    Array.from(selectedCatIds),
                subcategory_ids: Array.from(selectedSubcatIds),
              })}
              disabled={isPending || eligibleCount === 0}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50"
            >
              {isPending ? '実行中...' : '暴落を実行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: SystemSettingsPage コンポーネントに categories・subcategories・menuItems のクエリを追加する**

`export default function SystemSettingsPage()` 内の既存クエリ（`useQuery` の `settings`）の直後に追加する：

```js
const { data: categories    = [] } = useQuery({ queryKey: ['categories'],    queryFn: api.getCategories });
const { data: subcategories = [] } = useQuery({ queryKey: ['subcategories'], queryFn: api.getSubcategories });
const { data: menuItems     = [] } = useQuery({ queryKey: ['menu-all'],      queryFn: api.getAllMenu });
```

- [ ] **Step 4: 暴落 state と mutation を追加する**

既存の `useState` 群（`[savedTax, setSavedTax]` など）の直後に追加する：

```js
const [crashModalOpen, setCrashModalOpen] = useState(false);
const [crashMsg,       setCrashMsg]       = useState('');
const [resetMsg,       setResetMsg]       = useState('');

const crashMutation = useMutation({
  mutationFn: api.triggerCrash,
  onSuccess: (data) => {
    setCrashModalOpen(false);
    setCrashMsg(`暴落を実行しました（${data.updated}商品）`);
    setTimeout(() => setCrashMsg(''), 3000);
  },
});

const resetMutation = useMutation({
  mutationFn: api.resetCrash,
  onSuccess: (data) => {
    setResetMsg(`暴落を解除しました（${data.updated}商品）`);
    setTimeout(() => setResetMsg(''), 3000);
  },
});

const handleCrashReset = () => {
  if (confirm('暴落中の商品を基準価格に戻しますか？')) {
    resetMutation.mutate();
  }
};
```

- [ ] **Step 5: JSX に暴落 Section を追加する**

`return` 内の既存 `</>` 閉じタグの直前（深夜料金 Section の後）に以下を追加する：

```jsx
{/* ── 株価暴落 ── */}
<Section title="株価暴落" desc="選択したカテゴリ・サブカテゴリ内の暴落許可商品を一括で暴落価格に変更します。">
  <div className="flex gap-3">
    <button
      onClick={() => setCrashModalOpen(true)}
      className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
    >
      暴落を実行
    </button>
    <button
      onClick={handleCrashReset}
      disabled={resetMutation.isPending}
      className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
    >
      暴落解除
    </button>
  </div>
  {crashMsg && <p className="mt-2 text-sm text-red-600 font-medium">{crashMsg}</p>}
  {resetMsg && <p className="mt-2 text-sm text-emerald-600 font-medium">{resetMsg}</p>}
  {crashModalOpen && (
    <CrashModal
      categories={categories}
      subcategories={subcategories}
      menuItems={menuItems}
      onClose={() => setCrashModalOpen(false)}
      onExecute={(data) => crashMutation.mutate(data)}
      isPending={crashMutation.isPending}
    />
  )}
</Section>
```

- [ ] **Step 6: ブラウザで動作確認する**

1. `/` → 「システム管理」を開く
2. 「株価暴落」セクションが下部に表示されること
3. 「暴落を実行」をクリック → モーダルが開き、カテゴリ・サブカテゴリが crash_pct 付きで一覧表示されること
4. チェックを入れると「対象商品: N 商品」がリアルタイムに更新されること
5. 「暴落を実行」ボタンを押すと API が呼ばれ、「暴落を実行しました（N商品）」が表示されること
6. `/board` を別タブで開いた状態で暴落を実行し、価格がリアルタイムに下落することを確認
7. 「暴落解除」ボタンを押すと is_crashed=true の商品のみ base_price に戻ること

```bash
# 暴落後に is_crashed の状態を確認
curl -s http://localhost/api/menu/all | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  JSON.parse(d).filter(i => i.is_crashed).forEach(i => console.log(i.name, i.current_price, i.base_price));
"
```

- [ ] **Step 7: コミット**

```bash
git add client/src/pages/SystemSettingsPage.jsx
git commit -m "feat: add crash pricing section and modal to SystemSettingsPage"
```

---

## 最終確認チェックリスト

- [ ] カテゴリ・サブカテゴリに crash_pct が設定できる
- [ ] 商品に crash_enabled が設定できる
- [ ] 暴落モーダルでカテゴリにチェックするとサブカテゴリも全選択される
- [ ] 「対象商品: N 商品」がチェック状態に応じてリアルタイムに変わる
- [ ] 暴落実行後 /board でリアルタイムに価格が下落する
- [ ] crash_enabled=false の商品は暴落しない
- [ ] 暴落解除は is_crashed=true の商品のみを base_price に戻す
- [ ] crash_enabled=false の商品は暴落解除の影響を受けない
