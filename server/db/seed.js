const { query } = require('./database');

async function seed() {
  const { rows } = await query('SELECT COUNT(*) as c FROM tables');
  if (parseInt(rows[0].c) > 0) {
    console.log('Database already seeded, skipping.');
    return;
  }

  // テーブル
  for (let i = 1; i <= 8; i++) {
    await query('INSERT INTO tables (name, capacity) VALUES ($1, $2)', [`テーブル ${i}`, 4]);
  }
  for (let i = 1; i <= 4; i++) {
    await query('INSERT INTO tables (name, capacity) VALUES ($1, $2)', [`カウンター ${i}`, 1]);
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

module.exports = { seed };
