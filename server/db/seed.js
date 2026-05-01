const { query } = require('./database');

async function seed() {
  const { rows } = await query('SELECT COUNT(*) as c FROM tables');
  if (parseInt(rows[0].c) > 0) {
    console.log('Database already seeded, skipping.');
    return;
  }

  // テーブル
  for (let i = 1; i <= 8; i++) {
    await query('INSERT INTO tables (name) VALUES ($1)', [`テーブル ${i}`]);
  }
  for (let i = 1; i <= 4; i++) {
    await query('INSERT INTO tables (name, table_type) VALUES ($1, $2)', [`カウンター ${i}`, 'counter']);
  }

  // カテゴリ
  const catData = [
    ['生ビール', 1],
    ['ハイボール', 2],
    ['カクテル', 3],
    ['ソフトドリンク', 4],
    ['フード', 5],
  ];
  for (const [name, sort_order] of catData) {
    await query('INSERT INTO categories (name, sort_order) VALUES ($1, $2)', [name, sort_order]);
  }

  const { rows: cats } = await query('SELECT id, name FROM categories');
  const catMap = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  // ドリンクメニュー
  const drinks = [
    [catMap['生ビール'], 'スーパードライ', 600, 400, 1200, true],
    [catMap['生ビール'], 'プレモル', 700, 500, 1400, true],
    [catMap['生ビール'], 'ハートランド', 650, 450, 1300, true],
    [catMap['ハイボール'], 'ジャックコーク', 700, 500, 1400, true],
    [catMap['ハイボール'], '角ハイボール', 650, 450, 1300, true],
    [catMap['ハイボール'], 'レモンサワー', 600, 400, 1200, true],
    [catMap['ハイボール'], 'ジントニック', 750, 500, 1500, true],
    [catMap['カクテル'], 'カシスオレンジ', 700, 500, 1400, true],
    [catMap['カクテル'], 'モヒート', 800, 550, 1600, true],
    [catMap['カクテル'], 'マルガリータ', 850, 600, 1700, true],
    [catMap['カクテル'], 'ロングアイランドティー', 900, 600, 1800, true],
    [catMap['ソフトドリンク'], 'コーラ', 400, 300, 600, true],
    [catMap['ソフトドリンク'], 'ウーロン茶', 350, 250, 550, true],
    [catMap['ソフトドリンク'], 'ジュース', 400, 300, 600, true],
  ];

  for (const [cat_id, name, base, min, max, is_drink] of drinks) {
    await query(
      `INSERT INTO menu_items (category_id, name, base_price, current_price, min_price, max_price, is_drink, is_active)
       VALUES ($1, $2, $3, $3, $4, $5, $6, true)`,
      [cat_id, name, base, min, max, is_drink]
    );
  }

  // フードメニュー
  const foods = [
    [catMap['フード'], 'フライドポテト', 500],
    [catMap['フード'], 'ナチョス', 700],
    [catMap['フード'], 'ピザ（M）', 1200],
    [catMap['フード'], 'チキンウィングス', 800],
    [catMap['フード'], 'チーズバーガー', 1000],
  ];

  for (const [cat_id, name, price] of foods) {
    await query(
      `INSERT INTO menu_items (category_id, name, base_price, current_price, min_price, max_price, is_drink, is_active)
       VALUES ($1, $2, $3, $3, $3, $3, false, true)`,
      [cat_id, name, price]
    );
  }

  console.log('Database seeded successfully.');
}

// サブカテゴリのシード (既存DBでも冪等に実行)
async function seedSubcategories() {
  const { rows } = await query('SELECT COUNT(*) as c FROM subcategories');
  if (parseInt(rows[0].c) > 0) {
    console.log('Subcategories already seeded, skipping.');
    return;
  }

  const { rows: cats } = await query('SELECT id, name FROM categories');
  const catMap = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  if (Object.keys(catMap).length === 0) {
    console.log('No categories found, skipping subcategory seed.');
    return;
  }

  const subcatData = [
    [catMap['生ビール'],    '国産ビール',     1],
    [catMap['生ビール'],    'プレミアムビール', 2],
    [catMap['ハイボール'],  'ウイスキー系',    1],
    [catMap['ハイボール'],  'サワー系',        2],
    [catMap['カクテル'],    'フルーツ系',      1],
    [catMap['カクテル'],    'ロングドリンク',  2],
    [catMap['ソフトドリンク'], '炭酸',         1],
    [catMap['ソフトドリンク'], 'ノンカーボン', 2],
    [catMap['フード'],      'スナック',        1],
    [catMap['フード'],      'メイン',          2],
  ];

  const subcatMap = {};
  for (const [category_id, name, sort_order] of subcatData) {
    if (!category_id) continue;
    const { rows } = await query(
      'INSERT INTO subcategories (category_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, name',
      [category_id, name, sort_order]
    );
    subcatMap[name] = rows[0].id;
  }

  // 既存の商品にサブカテゴリを割り当て
  const itemAssignments = [
    ['スーパードライ',        subcatMap['国産ビール']],
    ['ハートランド',          subcatMap['国産ビール']],
    ['プレモル',              subcatMap['プレミアムビール']],
    ['ジャックコーク',        subcatMap['ウイスキー系']],
    ['角ハイボール',          subcatMap['ウイスキー系']],
    ['レモンサワー',          subcatMap['サワー系']],
    ['ジントニック',          subcatMap['サワー系']],
    ['カシスオレンジ',        subcatMap['フルーツ系']],
    ['モヒート',              subcatMap['フルーツ系']],
    ['マルガリータ',          subcatMap['フルーツ系']],
    ['ロングアイランドティー', subcatMap['ロングドリンク']],
    ['コーラ',                subcatMap['炭酸']],
    ['ジュース',              subcatMap['炭酸']],
    ['ウーロン茶',            subcatMap['ノンカーボン']],
    ['フライドポテト',        subcatMap['スナック']],
    ['ナチョス',              subcatMap['スナック']],
    ['ピザ（M）',             subcatMap['メイン']],
    ['チキンウィングス',      subcatMap['メイン']],
    ['チーズバーガー',        subcatMap['メイン']],
  ];

  for (const [itemName, subcatId] of itemAssignments) {
    if (!subcatId) continue;
    await query('UPDATE menu_items SET subcategory_id = $1 WHERE name = $2', [subcatId, itemName]);
  }

  console.log('Subcategories seeded successfully.');
}

async function ensureImmediateTable() {
  const { rows } = await query(
    `SELECT id FROM tables WHERE table_type = 'immediate' LIMIT 1`
  );
  if (!rows[0]) {
    await query(
      `INSERT INTO tables (name, table_type, status) VALUES ('即会計', 'immediate', 'available')`
    );
    console.log('Immediate checkout table created.');
  }
}

module.exports = { seed, seedSubcategories, ensureImmediateTable };
