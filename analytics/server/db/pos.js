'use strict';
// POS 本体DB(bardb) への読み取り専用アクセス
// - 接続は DATABASE_URL（bar_ro ロール想定）
// - 接続確立ごとに default_transaction_read_only = on（セッション開始オプションで適用）
// - query() は WITH/SELECT/EXPLAIN 以外の SQL を拒否する（多重防御）
const { Pool } = require('pg');
const logger = require('../lib/logger');

const READ_ONLY_SQL = /^\s*(WITH|SELECT|EXPLAIN)\b/i;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  // 接続確立時（startup packet）に SET default_transaction_read_only = on 相当を適用する。
  // pool.on('connect') 内で client.query('SET ...') を発行する方式は、直後に流れる利用者クエリと
  // 同一クライアント上で並走して pg の DeprecationWarning（pg@9 で削除予定）が出るため、
  // 同じ効果をセッション開始オプションで実現している（bar_ro ロール側の ALTER ROLE SET と二重防御）。
  options: '-c default_transaction_read_only=on',
});

pool.on('error', (err) => {
  logger.error('pos: アイドル接続でエラー', logger.errInfo(err));
});

function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || !READ_ONLY_SQL.test(sql)) {
    const err = new Error('pos.query: bardb へは WITH / SELECT / EXPLAIN で始まる SQL のみ実行できます');
    err.code = 'POS_READ_ONLY_GUARD';
    err.status = 500;
    throw err;
  }
}

async function query(sql, params) {
  assertReadOnlySql(sql);
  return pool.query(sql, params);
}

// 起動時セルフチェック: 期待ロールで接続し、read-only かつ INSERT 権限が無いことを確認する
async function selfCheck() {
  const expectedUser = process.env.BARDB_EXPECT_USER || 'bar_ro';
  const { rows: [r] } = await pool.query(
    `SELECT current_user::text                                    AS "user",
            current_setting('default_transaction_read_only')     AS ro,
            has_table_privilege('orders', 'INSERT')              AS can_insert,
            has_table_privilege('orders', 'SELECT')              AS can_select,
            (SELECT rolconfig FROM pg_roles WHERE rolname = current_user) AS role_config`
  );
  const ok = r.user === expectedUser && r.ro === 'on' && r.can_insert === false && r.can_select === true;
  return {
    user: r.user,
    expected_user: expectedUser,
    ro: r.ro,
    can_insert: r.can_insert,
    can_select: r.can_select,
    role_config: r.role_config || [],
    ok,
  };
}

async function end() {
  await pool.end();
}

module.exports = { pool, query, selfCheck, end, READ_ONLY_SQL };
