'use strict';
/**
 * テスト用DBリセット＆シードスクリプト
 *
 * 【警告】全テーブルを TRUNCATE してからデータを再投入します。
 *         本番環境では絶対に実行しないこと。
 *
 * 実行方法:
 *   docker compose exec server npm run seed:test
 *
 * 注意: 実行後にサーバーを再起動すると seed() が走って上書きされます。
 *       テスト中はサーバーコンテナの再起動を避けてください。
 */

const { pool, query } = require('./database');

// ─────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────
const TAX_RATE          = 0.10;
const RED_TAX_RATE      = 0.08;
const CHARGE_PER_PERSON = 600;

function calcOrder(items, guestCount) {
  let std = 0, red = 0;
  for (const [price, qty, taxCat] of items) {
    if (taxCat === 'standard') std += price * qty;
    else red += price * qty;
  }
  const charge     = CHARGE_PER_PERSON * guestCount;
  const taxableStd = std + charge;
  const taxableRed = red;
  const taxAmt     = Math.round(taxableStd * TAX_RATE / (1 + TAX_RATE))
                   + Math.round(taxableRed  * RED_TAX_RATE / (1 + RED_TAX_RATE));
  return { total: taxableStd + taxableRed, taxAmt, charge };
}

// ─────────────────────────────────────────────────────────────────────────────
// メイン
// ─────────────────────────────────────────────────────────────────────────────
async function resetAndSeed() {

  // ── 1. 全テーブルをリセット ───────────────────────────────────────────────
  console.log('[seed:test] 全テーブルをリセット中...');
  await query(`
    TRUNCATE
      ingredient_stock_logs,
      ingredient_stock,
      recipes,
      price_history,
      pricing_events,
      order_items,
      orders,
      ingredients,
      menu_items,
      subcategories,
      categories,
      tables,
      system_settings
    RESTART IDENTITY CASCADE
  `);

  // ── 2. テーブル（席） ────────────────────────────────────────────────────
  console.log('[seed:test] マスターデータを投入中...');
  for (let i = 1; i <= 8; i++) {
    await query('INSERT INTO tables (name, table_type) VALUES ($1, $2)', [`テーブル ${i}`, 'table']);
  }
  for (let i = 1; i <= 4; i++) {
    await query('INSERT INTO tables (name, table_type) VALUES ($1, $2)', [`カウンター ${i}`, 'counter']);
  }
  await query("INSERT INTO tables (name, table_type) VALUES ('即会計', 'immediate')");

  // ── 3. カテゴリ ──────────────────────────────────────────────────────────
  // [name, sort_order, crash_pct, is_staff_only]
  const catRows = [
    ['生ビール',       1, 30, false],
    ['ハイボール',     2, 25, false],
    ['カクテル',       3, 20, false],
    ['ソフトドリンク',  4,  0, false],
    ['フード',         5,  0, false],
  ];
  for (const [name, sort_order, crash_pct, is_staff_only] of catRows) {
    await query(
      'INSERT INTO categories (name, sort_order, crash_pct, is_staff_only) VALUES ($1, $2, $3, $4)',
      [name, sort_order, crash_pct, is_staff_only]
    );
  }
  const { rows: cats } = await query('SELECT id, name FROM categories');
  const catMap = Object.fromEntries(cats.map(c => [c.name, c.id]));

  // ── 4. サブカテゴリ ──────────────────────────────────────────────────────
  // [cat_name, name, sort_order, crash_pct]
  const subcatRows = [
    ['生ビール',       '国産ビール',      1, 30],
    ['生ビール',       'プレミアムビール', 2, 20],
    ['ハイボール',     'ウイスキー系',    1, 25],
    ['ハイボール',     'サワー系',        2, 15],
    ['カクテル',       'フルーツ系',      1, 20],
    ['カクテル',       'ロングドリンク',  2, 15],
    ['ソフトドリンク',  '炭酸',           1,  0],
    ['ソフトドリンク',  'ノンカーボン',   2,  0],
    ['フード',         'スナック',        1,  0],
    ['フード',         'メイン',          2,  0],
  ];
  const subcatMap = {};
  for (const [cat_name, name, sort_order, crash_pct] of subcatRows) {
    const { rows } = await query(
      'INSERT INTO subcategories (category_id, name, sort_order, crash_pct) VALUES ($1, $2, $3, $4) RETURNING id',
      [catMap[cat_name], name, sort_order, crash_pct]
    );
    subcatMap[name] = rows[0].id;
  }

  // ── 5. メニュー商品 ──────────────────────────────────────────────────────
  // [cat, sub, name, base, min, max, step_up, step_down, is_drink, tax, crash_enabled]
  const menuRows = [
    ['生ビール',       '国産ビール',      'スーパードライ',         600, 400, 1200,  50, 25, true,  'standard', true],
    ['生ビール',       'プレミアムビール', 'プレモル',               700, 500, 1400,  50, 25, true,  'standard', true],
    ['生ビール',       '国産ビール',      'ハートランド',            650, 450, 1300,  50, 25, true,  'standard', false],
    ['ハイボール',     'ウイスキー系',    'ジャックコーク',          700, 500, 1400,  50, 25, true,  'standard', true],
    ['ハイボール',     'ウイスキー系',    '角ハイボール',            650, 450, 1300,  50, 25, true,  'standard', true],
    ['ハイボール',     'サワー系',        'レモンサワー',            600, 400, 1200,  50, 25, true,  'standard', false],
    ['ハイボール',     'サワー系',        'ジントニック',            750, 500, 1500,  50, 25, true,  'standard', false],
    ['カクテル',       'フルーツ系',      'カシスオレンジ',          700, 500, 1400,  75, 25, true,  'standard', false],
    ['カクテル',       'フルーツ系',      'モヒート',                800, 550, 1600,  75, 25, true,  'standard', false],
    ['カクテル',       'フルーツ系',      'マルガリータ',            850, 600, 1700,  75, 25, true,  'standard', false],
    ['カクテル',       'ロングドリンク',  'ロングアイランドティー',   900, 600, 1800, 100, 25, true,  'standard', false],
    ['ソフトドリンク',  '炭酸',           'コーラ',                  400, 300,  600,  25, 25, true,  'reduced',  false],
    ['ソフトドリンク',  'ノンカーボン',   'ウーロン茶',              350, 250,  550,  25, 25, true,  'reduced',  false],
    ['ソフトドリンク',  '炭酸',           'ジュース',                400, 300,  600,  25, 25, true,  'reduced',  false],
    ['フード',         'スナック',        'フライドポテト',          500, 500,  500,   0,  0, false, 'reduced',  false],
    ['フード',         'スナック',        'ナチョス',               700, 700,  700,   0,  0, false, 'reduced',  false],
    ['フード',         'メイン',          'ピザ（M）',             1200, 1200, 1200,  0,  0, false, 'reduced',  false],
    ['フード',         'メイン',          'チキンウィングス',        800, 800,  800,  0,  0, false, 'reduced',  false],
    ['フード',         'メイン',          'チーズバーガー',         1000, 1000, 1000,  0,  0, false, 'reduced',  false],
  ];

  // itemMap: name → { id, base, tax }
  const itemMap = {};
  for (const [cat, sub, name, base, min, max, step_up, step_down, is_drink, tax, crash] of menuRows) {
    const { rows } = await query(
      `INSERT INTO menu_items
         (category_id, subcategory_id, name, base_price, current_price, min_price, max_price,
          price_step_up, price_step_down, is_drink, is_active,
          tax_category, is_staff_only, crash_enabled, is_crashed)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, true, $10, false, $11, false)
       RETURNING id`,
      [catMap[cat], subcatMap[sub], name, base, min, max, step_up, step_down, is_drink, tax, crash]
    );
    itemMap[name] = { id: rows[0].id, base, tax };
  }

  // ── 6. システム設定 ──────────────────────────────────────────────────────
  const settings = [
    ['tax_rate',             '0.10'],
    ['reduced_tax_rate',     '0.08'],
    ['default_tax_category', 'standard'],
    ['late_night_rate',      '0.10'],
    ['late_night_start',     '22'],
    ['late_night_end',       '29'],
    ['charge_enabled',       'true'],
    ['charge_time_slots',    JSON.stringify([{ start: 18, end: 29, amount: CHARGE_PER_PERSON }])],
    ['register_open',        'false'],
    ['register_open_cash',   '0'],
  ];
  for (const [key, value] of settings) {
    await query(
      'INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
  }

  // ── 7. 材料マスター ──────────────────────────────────────────────────────
  // [name, purchase_unit, purchase_quantity(ml), quantity_unit, cost_per_purchase_unit(円)]
  const ingRows = [
    ['ウイスキー角 700ml', '本',  700, 'ml',   2200],
    ['炭酸水 500ml',      '本',  500, 'ml',    100],
    ['生ビール樽 5L',     '樽', 5000, 'ml',  12000],
    ['コーラシロップ 1L', '本', 1000, 'ml',    600],
  ];
  const ingMap = {};
  for (const [name, pu, pq, qu, cost] of ingRows) {
    const { rows } = await query(
      `INSERT INTO ingredients (name, purchase_unit, purchase_quantity, quantity_unit, cost_per_purchase_unit)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, pu, pq, qu, cost]
    );
    ingMap[name] = rows[0].id;
  }

  // ── 8. レシピ ────────────────────────────────────────────────────────────
  const recipeRows = [
    ['角ハイボール',   'ウイスキー角 700ml',  45],
    ['角ハイボール',   '炭酸水 500ml',       120],
    ['ジャックコーク', 'ウイスキー角 700ml',  45],
    ['ジャックコーク', 'コーラシロップ 1L',  120],
    ['スーパードライ', '生ビール樽 5L',      350],
    ['ハートランド',   '生ビール樽 5L',      350],
  ];
  for (const [item, ing, qty] of recipeRows) {
    await query(
      'INSERT INTO recipes (menu_item_id, ingredient_id, usage_quantity) VALUES ($1, $2, $3)',
      [itemMap[item].id, ingMap[ing], qty]
    );
  }

  // ── 9. 材料在庫 ──────────────────────────────────────────────────────────
  const stockRows = [
    ['ウイスキー角 700ml', 3500],  // 5本分
    ['炭酸水 500ml',      12000], // 24本分
    ['生ビール樽 5L',     15000], // 3樽分
    ['コーラシロップ 1L',  3000], // 3本分
  ];
  for (const [ing, qty] of stockRows) {
    await query(
      'INSERT INTO ingredient_stock (ingredient_id, quantity_current) VALUES ($1, $2)',
      [ingMap[ing], qty]
    );
  }

  // 原価を更新 (レシピから逆算)
  // 角ハイボール: 45/700×2200 + 120/500×100 ≈ 141 + 24 = 165
  // ジャックコーク: 45/700×2200 + 120/1000×600 ≈ 141 + 72 = 213
  // スーパードライ/ハートランド: 350/5000×12000 = 840
  await query("UPDATE menu_items SET cost_price = 165 WHERE name = '角ハイボール'");
  await query("UPDATE menu_items SET cost_price = 213 WHERE name = 'ジャックコーク'");
  await query("UPDATE menu_items SET cost_price = 840 WHERE name = 'スーパードライ'");
  await query("UPDATE menu_items SET cost_price = 840 WHERE name = 'ハートランド'");

  // ── 10. テスト用注文データ ──────────────────────────────────────────────
  console.log('[seed:test] テスト注文データを投入中...');

  const { rows: tableMeta } = await query('SELECT id, name FROM tables ORDER BY id');
  const tblMap = Object.fromEntries(tableMeta.map(t => [t.name, t.id]));

  // ── 注文1: テーブル1 — オープン中 (POS会計フローのテスト用) ──────────────
  {
    const guests = 2;
    const { total, charge } = calcOrder([
      [itemMap['スーパードライ'].base, 2, 'standard'],
      [itemMap['ナチョス'].base, 1, 'reduced'],
    ], guests);
    const { rows: [o] } = await query(
      `INSERT INTO orders
         (table_id, status, total_amount, guest_count, charge_per_person, charge_amount, tax_rate, receipt_type)
       VALUES ($1, 'open', $2, $3, $4, $5, $6, 'normal') RETURNING id`,
      [tblMap['テーブル 1'], total, guests, CHARGE_PER_PERSON, charge, TAX_RATE]
    );
    await query("UPDATE tables SET status = 'occupied' WHERE id = $1", [tblMap['テーブル 1']]);
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 2, $3, 'スーパードライ', 'pending')`,
      [o.id, itemMap['スーパードライ'].id, itemMap['スーパードライ'].base]
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 1, $3, 'ナチョス', 'pending')`,
      [o.id, itemMap['ナチョス'].id, itemMap['ナチョス'].base]
    );
  }

  // ── 注文2: テーブル2 — 今日の支払い済み (当日日計レポートテスト用) ────────
  {
    const guests = 2;
    const { total, taxAmt, charge } = calcOrder([
      [itemMap['角ハイボール'].base, 2, 'standard'],
      [itemMap['フライドポテト'].base, 1, 'reduced'],
    ], guests);
    const { rows: [o] } = await query(
      `INSERT INTO orders
         (table_id, status, total_amount, payment_method, guest_count,
          charge_per_person, charge_amount, tax_rate, tax_amount, closed_at, receipt_type)
       VALUES ($1, 'paid', $2, 'cash', $3, $4, $5, $6, $7, NOW(), 'normal') RETURNING id`,
      [tblMap['テーブル 2'], total, guests, CHARGE_PER_PERSON, charge, TAX_RATE, taxAmt]
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 2, $3, '角ハイボール', 'served')`,
      [o.id, itemMap['角ハイボール'].id, itemMap['角ハイボール'].base]
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 1, $3, 'フライドポテト', 'served')`,
      [o.id, itemMap['フライドポテト'].id, itemMap['フライドポテト'].base]
    );
  }

  // ── 注文3: テーブル3 — 昨日の支払い済み (日付フィルタテスト用) ────────────
  {
    const guests = 3;
    const { total, taxAmt, charge } = calcOrder([
      [itemMap['ジントニック'].base, 3, 'standard'],
      [itemMap['コーラ'].base, 3, 'reduced'],
    ], guests);
    const { rows: [o] } = await query(
      `INSERT INTO orders
         (table_id, status, total_amount, payment_method, guest_count,
          charge_per_person, charge_amount, tax_rate, tax_amount,
          opened_at, closed_at, receipt_type)
       VALUES ($1, 'paid', $2, 'card', $3, $4, $5, $6, $7,
               NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', 'normal') RETURNING id`,
      [tblMap['テーブル 3'], total, guests, CHARGE_PER_PERSON, charge, TAX_RATE, taxAmt]
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 3, $3, 'ジントニック', 'served')`,
      [o.id, itemMap['ジントニック'].id, itemMap['ジントニック'].base]
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 3, $3, 'コーラ', 'served')`,
      [o.id, itemMap['コーラ'].id, itemMap['コーラ'].base]
    );
  }

  // ── 注文4〜6: テーブル4 — void-and-reissueテストセット ──────────────────
  // 注文4: black_cancelled (取消し済み元伝票)
  // 注文5: void (取消し証跡)
  // 注文6: red (赤伝票、再処理待ち = status='open')
  {
    const guests = 1;
    const { total, taxAmt, charge } = calcOrder([
      [itemMap['スーパードライ'].base, 1, 'standard'],
    ], guests);

    // 元伝票 (black_cancelled)
    const { rows: [o4] } = await query(
      `INSERT INTO orders
         (table_id, status, total_amount, payment_method, guest_count,
          charge_per_person, charge_amount, tax_rate, tax_amount, closed_at, receipt_type)
       VALUES ($1, 'paid', $2, 'cash', $3, $4, $5, $6, $7, NOW(), 'black_cancelled') RETURNING id`,
      [tblMap['テーブル 4'], total, guests, CHARGE_PER_PERSON, charge, TAX_RATE, taxAmt]
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 1, $3, 'スーパードライ', 'served')`,
      [o4.id, itemMap['スーパードライ'].id, itemMap['スーパードライ'].base]
    );

    // 取消し証跡 (void)
    const { rows: [o5] } = await query(
      `INSERT INTO orders
         (table_id, status, total_amount, payment_method, guest_count,
          charge_per_person, charge_amount, tax_rate, tax_amount,
          closed_at, receipt_type, original_order_id)
       VALUES ($1, 'paid', $2, 'cash', $3, $4, $5, $6, $7, NOW(), 'void', $8) RETURNING id`,
      [tblMap['テーブル 4'], total, guests, CHARGE_PER_PERSON, charge, TAX_RATE, taxAmt, o4.id]
    );
    await query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name, status)
       VALUES ($1, $2, 1, $3, 'スーパードライ', 'served')`,
      [o5.id, itemMap['スーパードライ'].id, itemMap['スーパードライ'].base]
    );

    // 赤伝票 (red, status='open' = 再処理待ち)
    await query(
      `INSERT INTO orders
         (table_id, status, total_amount, guest_count,
          charge_per_person, charge_amount, receipt_type, original_order_id)
       VALUES ($1, 'open', 0, $2, $3, $4, 'red', $5)`,
      [tblMap['テーブル 4'], guests, CHARGE_PER_PERSON, charge, o4.id]
    );
    await query("UPDATE tables SET status = 'occupied' WHERE id = $1", [tblMap['テーブル 4']]);
  }

  // ── 完了サマリー ─────────────────────────────────────────────────────────
  console.log('\n[seed:test] 完了。投入データの概要:');
  console.log('  席      : テーブル 8台 / カウンター 4台 / 即会計 1台');
  console.log('  カテゴリ: 5件 / サブカテゴリ: 10件');
  console.log('  商品    : 19件 (ドリンク 14件 / フード 5件)');
  console.log('  材料    : 4種 / レシピ: 6件 / 在庫: 4種');
  console.log('  注文    : 6件');
  console.log('    テーブル1: open              (POS会計フローのテスト用)');
  console.log('    テーブル2: paid / 今日        (当日日計レポートのテスト用)');
  console.log('    テーブル3: paid / 昨日        (日付フィルタのテスト用)');
  console.log('    テーブル4: black_cancelled + void + red  (取消し再発行のテスト用)');
  console.log('  ※ register_open=false です。ブラウザの /start からレジをオープンしてください');
}

resetAndSeed()
  .then(() => pool.end())
  .catch(err => {
    console.error('[seed:test] エラー:', err.message);
    pool.end();
    process.exit(1);
  });
