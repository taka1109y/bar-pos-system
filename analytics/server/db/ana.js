'use strict';
// 分析DB(analyticsdb) への接続。ANALYTICS_DATABASE_URL を使う。
const { Pool } = require('pg');
const logger = require('../lib/logger');

const pool = new Pool({
  connectionString: process.env.ANALYTICS_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  logger.error('ana: アイドル接続でエラー', logger.errInfo(err));
});

async function query(sql, params) {
  return pool.query(sql, params);
}

// 未適用のマイグレーションを適用する（migrate.js の up を呼ぶ）
async function ensureMigrations() {
  const migrate = require('./migrate');
  return migrate.up(pool, { log: (m) => logger.info(`migrate: ${m}`) });
}

async function ping() {
  await pool.query('SELECT 1');
  return true;
}

async function end() {
  await pool.end();
}

module.exports = { pool, query, ensureMigrations, ping, end };
