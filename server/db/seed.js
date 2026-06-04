'use strict';
const { query } = require('./database');
const logger = require('../utils/logger');

async function seed() {
  const { rows } = await query('SELECT COUNT(*) as c FROM tables');
  if (parseInt(rows[0].c) > 0) {
    logger.info('Database already seeded, skipping');
    return;
  }

  // テーブル
  for (let i = 1; i <= 8; i++) {
    await query('INSERT INTO tables (name, table_type) VALUES ($1, $2)', [`テーブル ${i}`, 'table']);
  }
  for (let i = 1; i <= 4; i++) {
    await query('INSERT INTO tables (name, table_type) VALUES ($1, $2)', [`カウンター ${i}`, 'counter']);
  }

  // カテゴリ [name, sort_order, crash_pct, is_staff_only]
  const catData = [
    ['生ビール',       1, 30, false],
    ['ハイボール',     2, 25, false],
    ['カクテル',       3, 20, false],
    ['ソフトドリンク',  4,  0, false],
    ['フード',         5,  0, false],
  ];
  for (const [name, sort_order, crash_pct, is_staff_only] of catData) {
    await query(
      'INSERT INTO categories (name, sort_order, crash_pct, is_staff_only) VALUES ($1, $2, $3, $4)',
      [name, sort_order, crash_pct, is_staff_only]
    );
  }

  const { rows: cats } = await query('SELECT id, name FROM categories');
  const catMap = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  // アルコールドリンク (tax_category='standard')
  // [cat, name, base, min, max, step_up, step_down, crash_enabled]
  const drinks = [
    [catMap['生ビール'],   'スーパードライ',         600, 400, 1200,  50, 25, true],
    [catMap['生ビール'],   'プレモル',               700, 500, 1400,  50, 25, true],
    [catMap['生ビール'],   'ハートランド',            650, 450, 1300,  50, 25, false],
    [catMap['ハイボール'], 'ジャックコーク',          700, 500, 1400,  50, 25, true],
    [catMap['ハイボール'], '角ハイボール',            650, 450, 1300,  50, 25, true],
    [catMap['ハイボール'], 'レモンサワー',            600, 400, 1200,  50, 25, false],
    [catMap['ハイボール'], 'ジントニック',            750, 500, 1500,  50, 25, false],
    [catMap['カクテル'],   'カシスオレンジ',          700, 500, 1400,  75, 25, false],
    [catMap['カクテル'],   'モヒート',                800, 550, 1600,  75, 25, false],
    [catMap['カクテル'],   'マルガリータ',            850, 600, 1700,  75, 25, false],
    [catMap['カクテル'],   'ロングアイランドティー',   900, 600, 1800, 100, 25, false],
  ];
  for (const [cat_id, name, base, min, max, step_up, step_down, crash_enabled] of drinks) {
    await query(
      `INSERT INTO menu_items
         (category_id, name, base_price, current_price, min_price, max_price,
          price_step_up, price_step_down, is_drink, is_active,
          tax_category, is_staff_only, crash_enabled, is_crashed)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, true, true, 'standard', false, $8, false)`,
      [cat_id, name, base, min, max, step_up, step_down, crash_enabled]
    );
  }

  // ソフトドリンク (tax_category='reduced')
  const softDrinks = [
    [catMap['ソフトドリンク'], 'コーラ',     400, 300, 600],
    [catMap['ソフトドリンク'], 'ウーロン茶', 350, 250, 550],
    [catMap['ソフトドリンク'], 'ジュース',   400, 300, 600],
  ];
  for (const [cat_id, name, base, min, max] of softDrinks) {
    await query(
      `INSERT INTO menu_items
         (category_id, name, base_price, current_price, min_price, max_price,
          is_drink, is_active, tax_category, is_staff_only, crash_enabled, is_crashed)
       VALUES ($1, $2, $3, $3, $4, $5, true, true, 'reduced', false, false, false)`,
      [cat_id, name, base, min, max]
    );
  }

  // フード (tax_category='reduced', 固定価格)
  const foods = [
    [catMap['フード'], 'フライドポテト',   500],
    [catMap['フード'], 'ナチョス',         700],
    [catMap['フード'], 'ピザ（M）',       1200],
    [catMap['フード'], 'チキンウィングス', 800],
    [catMap['フード'], 'チーズバーガー',  1000],
  ];
  for (const [cat_id, name, price] of foods) {
    await query(
      `INSERT INTO menu_items
         (category_id, name, base_price, current_price, min_price, max_price,
          price_step_up, price_step_down, is_drink, is_active,
          tax_category, is_staff_only, crash_enabled, is_crashed)
       VALUES ($1, $2, $3, $3, $3, $3, 0, 0, false, true, 'reduced', false, false, false)`,
      [cat_id, name, price]
    );
  }

  logger.info('Database seeded successfully');
}

async function seedSubcategories() {
  const { rows } = await query('SELECT COUNT(*) as c FROM subcategories');
  if (parseInt(rows[0].c) > 0) {
    logger.info('Subcategories already seeded, skipping');
    return;
  }

  const { rows: cats } = await query('SELECT id, name FROM categories');
  const catMap = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  if (Object.keys(catMap).length === 0) {
    logger.info('No categories found, skipping subcategory seed');
    return;
  }

  // [cat, name, sort_order, crash_pct]
  const subcatData = [
    [catMap['生ビール'],       '国産ビール',      1, 30],
    [catMap['生ビール'],       'プレミアムビール', 2, 20],
    [catMap['ハイボール'],     'ウイスキー系',    1, 25],
    [catMap['ハイボール'],     'サワー系',        2, 15],
    [catMap['カクテル'],       'フルーツ系',      1, 20],
    [catMap['カクテル'],       'ロングドリンク',  2, 15],
    [catMap['ソフトドリンク'],  '炭酸',           1,  0],
    [catMap['ソフトドリンク'],  'ノンカーボン',   2,  0],
    [catMap['フード'],         'スナック',        1,  0],
    [catMap['フード'],         'メイン',          2,  0],
  ];

  const subcatMap = {};
  for (const [category_id, name, sort_order, crash_pct] of subcatData) {
    if (!category_id) continue;
    const { rows } = await query(
      'INSERT INTO subcategories (category_id, name, sort_order, crash_pct) VALUES ($1, $2, $3, $4) RETURNING id, name',
      [category_id, name, sort_order, crash_pct]
    );
    subcatMap[name] = rows[0].id;
  }

  // 商品にサブカテゴリを割り当て
  const itemAssignments = [
    ['スーパードライ',         subcatMap['国産ビール']],
    ['ハートランド',           subcatMap['国産ビール']],
    ['プレモル',               subcatMap['プレミアムビール']],
    ['ジャックコーク',         subcatMap['ウイスキー系']],
    ['角ハイボール',           subcatMap['ウイスキー系']],
    ['レモンサワー',           subcatMap['サワー系']],
    ['ジントニック',           subcatMap['サワー系']],
    ['カシスオレンジ',         subcatMap['フルーツ系']],
    ['モヒート',               subcatMap['フルーツ系']],
    ['マルガリータ',           subcatMap['フルーツ系']],
    ['ロングアイランドティー', subcatMap['ロングドリンク']],
    ['コーラ',                 subcatMap['炭酸']],
    ['ジュース',               subcatMap['炭酸']],
    ['ウーロン茶',             subcatMap['ノンカーボン']],
    ['フライドポテト',         subcatMap['スナック']],
    ['ナチョス',               subcatMap['スナック']],
    ['ピザ（M）',              subcatMap['メイン']],
    ['チキンウィングス',       subcatMap['メイン']],
    ['チーズバーガー',         subcatMap['メイン']],
  ];

  for (const [itemName, subcatId] of itemAssignments) {
    if (!subcatId) continue;
    await query('UPDATE menu_items SET subcategory_id = $1 WHERE name = $2', [subcatId, itemName]);
  }

  logger.info('Subcategories seeded successfully');
}

async function ensureImmediateTable() {
  const { rows } = await query(
    `SELECT id FROM tables WHERE table_type = 'immediate' LIMIT 1`
  );
  if (!rows[0]) {
    await query(
      `INSERT INTO tables (name, table_type, status) VALUES ('即会計', 'immediate', 'available')`
    );
    logger.info('Immediate checkout table created');
  }
}

module.exports = { seed, seedSubcategories, ensureImmediateTable };
