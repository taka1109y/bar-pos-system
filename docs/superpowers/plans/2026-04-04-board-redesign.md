# Board Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BoardPageのUIをカードグリッドから金融ボード風テーブル行一覧に変更し、同日高値・底値をAPIで提供する。

**Architecture:** サーバー側で `price_history` から当日の MAX/MIN を計算して `/api/prices` レスポンスと `prices:updated` ソケットイベントに追加。フロントエンドはカードグリッドを廃止してテーブルレイアウトに変更し、各行コンポーネント `PriceRow.jsx` で7列を表示する。

**Tech Stack:** Node.js/Express, PostgreSQL (raw SQL), React, Tailwind CSS, Socket.io, Zustand

---

## File Map

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `server/routes/prices.js` | Modify | `GET /api/prices` に `day_high`/`day_low` サブクエリを追加 |
| `server/services/pricingEngine.js` | Modify | `prices:updated` broadcast items に `day_high`/`day_low` を追加 |
| `client/src/components/board/PriceRow.jsx` | Create | 1商品1行の新コンポーネント（PriceCard 置き換え） |
| `client/src/pages/BoardPage.jsx` | Modify | カードグリッド → テーブルレイアウトに変更 |
| `client/src/components/board/PriceCard.jsx` | Delete | PriceRow に置き換えのため削除 |
| `client/src/components/board/Sparkline.jsx` | Delete | 不使用のため削除 |

---

### Task 1: `/api/prices` に day_high / day_low を追加

**Files:**
- Modify: `server/routes/prices.js`

- [ ] **Step 1: `server/routes/prices.js` を以下の内容に書き換える**

```js
const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';

// GET /api/prices
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        m.id, m.name,
        m.base_price::float,
        m.current_price::float,
        ROUND((m.current_price - m.base_price) * 100.0 / m.base_price, 1)::float AS pct_change,
        COALESCE(dh.day_high, m.current_price)::float AS day_high,
        COALESCE(dh.day_low,  m.current_price)::float AS day_low
      FROM menu_items m
      LEFT JOIN (
        SELECT menu_item_id,
          MAX(price)::float AS day_high,
          MIN(price)::float AS day_low
        FROM price_history
        WHERE (recorded_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date
        GROUP BY menu_item_id
      ) dh ON dh.menu_item_id = m.id
      WHERE m.is_drink = TRUE AND m.is_active = TRUE
      ORDER BY m.id
    `, [TZ]);

    const withDirection = rows.map((item) => ({
      ...item,
      direction: item.pct_change > 0 ? 'up' : item.pct_change < 0 ? 'down' : 'flat',
    }));

    res.json(withDirection);
  } catch (err) {
    next(err);
  }
});

// GET /api/prices/:id/history?limit=30
router.get('/:id/history', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const { rows } = await query(
      `SELECT price::float, recorded_at
       FROM price_history
       WHERE menu_item_id = $1
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(rows.reverse());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 2: curl で動作確認する**

```bash
curl -s http://localhost:3001/api/prices | jq '.[0]'
```

期待するレスポンス（`day_high` と `day_low` が含まれること）:

```json
{
  "id": 1,
  "name": "生ビール",
  "base_price": 500,
  "current_price": 500,
  "pct_change": 0,
  "direction": "flat",
  "day_high": 500,
  "day_low": 500
}
```

- [ ] **Step 3: commit**

```bash
git add server/routes/prices.js
git commit -m "feat: add day_high/day_low to GET /api/prices"
```

---

### Task 2: `prices:updated` ソケットイベントに day_high / day_low を追加

**Files:**
- Modify: `server/services/pricingEngine.js`

- [ ] **Step 1: `runTick()` 内の `if (updates.length > 0)` ブロックを書き換える**

`pricingEngine.js` の125〜128行目付近、現在の:

```js
  if (updates.length > 0) {
    broadcast('prices:updated', { items: updates, timestamp: Date.now() });
    console.log(`[PricingEngine] ${updates.length} item(s) price updated`);
  }
```

を以下に差し替える:

```js
  if (updates.length > 0) {
    const TZ = process.env.TZ_REPORT || 'Asia/Tokyo';
    const updatedIds = updates.map((u) => u.id);
    const { rows: dayStats } = await query(
      `SELECT menu_item_id,
         MAX(price)::float AS day_high,
         MIN(price)::float AS day_low
       FROM price_history
       WHERE menu_item_id = ANY($1)
         AND (recorded_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
       GROUP BY menu_item_id`,
      [updatedIds, TZ]
    );
    const dayStatsMap = Object.fromEntries(dayStats.map((r) => [r.menu_item_id, r]));

    const updatesWithStats = updates.map((u) => ({
      ...u,
      day_high: dayStatsMap[u.id]?.day_high ?? u.current_price,
      day_low:  dayStatsMap[u.id]?.day_low  ?? u.current_price,
    }));

    broadcast('prices:updated', { items: updatesWithStats, timestamp: Date.now() });
    console.log(`[PricingEngine] ${updates.length} item(s) price updated`);
  }
```

- [ ] **Step 2: サーバーを再起動してエラーがないことを確認**

```bash
# Dockerの場合
docker compose logs -f server
# ローカルの場合
cd server && npm run dev
```

ログに `[PricingEngine] Starting...` が出て、エラーが出ないことを確認する。

- [ ] **Step 3: commit**

```bash
git add server/services/pricingEngine.js
git commit -m "feat: add day_high/day_low to prices:updated socket event"
```

---

### Task 3: `PriceRow.jsx` を新規作成

**Files:**
- Create: `client/src/components/board/PriceRow.jsx`

- [ ] **Step 1: `client/src/components/board/PriceRow.jsx` を作成する**

```jsx
export default function PriceRow({ item }) {
  const isUp   = item.pct_change > 0;
  const isDown = item.pct_change < 0;

  const rowBg      = isUp ? 'bg-green-950/70' : isDown ? 'bg-red-950/70' : 'bg-slate-800/60';
  const changeColor = isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-500';

  const amtChange  = item.current_price - item.base_price;
  // 上昇時は符号なし、下降時のみ「-」を付ける
  const amtDisplay = amtChange < 0
    ? `-${Math.abs(amtChange).toLocaleString()}`
    : `${amtChange.toLocaleString()}`;

  const pctDisplay = item.pct_change < 0
    ? `-${Math.abs(item.pct_change).toFixed(1)}%`
    : `${Math.abs(item.pct_change).toFixed(1)}%`;

  return (
    <tr className={`${rowBg} border-b border-slate-700/50 transition-colors duration-700`}>
      <td className="px-4 py-3 text-slate-400 font-semibold">{item.name}</td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        ¥{item.base_price.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-amber-300 font-bold text-right tabular-nums">
        ¥{item.current_price.toLocaleString()}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {amtDisplay}
      </td>
      <td className={`px-4 py-3 font-bold text-right tabular-nums ${changeColor}`}>
        {pctDisplay}
      </td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        ¥{(item.day_high ?? item.current_price).toLocaleString()}
      </td>
      <td className="px-4 py-3 text-slate-400 text-right tabular-nums">
        ¥{(item.day_low ?? item.current_price).toLocaleString()}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: commit**

```bash
git add client/src/components/board/PriceRow.jsx
git commit -m "feat: add PriceRow component for board table layout"
```

---

### Task 4: `BoardPage.jsx` をテーブルレイアウトに変更し、不要ファイルを削除

**Files:**
- Modify: `client/src/pages/BoardPage.jsx`
- Delete: `client/src/components/board/PriceCard.jsx`
- Delete: `client/src/components/board/Sparkline.jsx`

- [ ] **Step 1: `client/src/pages/BoardPage.jsx` を以下の内容に書き換える**

```jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import socket from '../socket';
import usePriceStore from '../store/usePriceStore';
import PriceRow from '../components/board/PriceRow';

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
    <div className="min-h-screen bg-slate-950 text-white p-8">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-8">
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

      {/* 価格テーブル */}
      {prices.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-slate-600 text-xl">
          接続中...
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-slate-700/50">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-900 text-xs text-slate-500 uppercase tracking-widest border-b border-slate-700">
                <th className="px-4 py-3 text-left">商品名</th>
                <th className="px-4 py-3 text-right">基準値</th>
                <th className="px-4 py-3 text-right">現在値</th>
                <th className="px-4 py-3 text-right">変動幅(円)</th>
                <th className="px-4 py-3 text-right">変動幅(%)</th>
                <th className="px-4 py-3 text-right">同日高値</th>
                <th className="px-4 py-3 text-right">同日底値</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((item) => (
                <PriceRow key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* フッター */}
      <div className="mt-8 text-center text-slate-700 text-sm tracking-wider">
        価格は需要に応じてリアルタイムで変動します
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 不要ファイルを削除する**

```bash
rm client/src/components/board/PriceCard.jsx
rm client/src/components/board/Sparkline.jsx
```

- [ ] **Step 3: ブラウザで `/board` を開いて確認する**

確認ポイント:
- テーブルヘッダーが「商品名 / 基準値 / 現在値 / 変動幅(円) / 変動幅(%) / 同日高値 / 同日底値」の7列で表示される
- 各行の背景色が上昇=緑系 / 下降=赤系 / 変動なし=グレーになっている
- 現在値が黄色（`text-amber-300`）で表示される
- 変動幅（金額・%）が上昇=緑 / 下降=赤で表示される
- 上昇時に `+` 記号が付かない（`75` / `15.0%`）
- 下降時に `-` 記号が付く（`-75` / `-15.0%`）
- 同日高値・底値が商品名と同じグレーで表示される

- [ ] **Step 4: commit**

```bash
git add client/src/pages/BoardPage.jsx
git add -u client/src/components/board/
git commit -m "feat: replace board card grid with financial-style table layout"
```

---

### Task 5: Docker でビルドして本番確認（オプション）

**Files:** なし（ビルド確認のみ）

- [ ] **Step 1: クライアントを Docker リビルドする**

```bash
docker compose up -d --build --no-deps client
```

- [ ] **Step 2: `http://localhost/board` でブラウザ確認する**

Task 4 Step 3 と同じ確認ポイントを本番ビルドで検証する。
