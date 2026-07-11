const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://bar:bar@localhost:5432/bardb',
});

// アイドル接続の異常切断などでPoolが発行するerrorイベントを拾う
// （リスナーが無いとNode.jsのデフォルト動作でプロセスがクラッシュしうる）
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // PostgreSQL が起動するまでリトライ
  const MAX_RETRIES = 30;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await pool.query(schema);
      logger.info('DB schema applied successfully');
      return;
    } catch (err) {
      if (i < MAX_RETRIES - 1) {
        logger.warn({ attempt: i + 1, maxRetries: MAX_RETRIES }, 'Waiting for PostgreSQL');
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }
}

module.exports = { pool, query, initDb };
