/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * テスト専用デバッグルート — 本番リリース前に必ず削除すること
 * TEST-ONLY DEBUG ROUTES — DELETE BEFORE PRODUCTION RELEASE
 *
 * 削除対象:
 *   - このファイル (server/routes/debug.js)
 *   - server/index.js の app.use('/api/debug', ...) 行
 *   - client/src/pages/DebugPage.jsx
 *   - client/src/App.jsx の import DebugPage と /debug Route
 *   - docker-compose.yml の /var/run/docker.sock ボリュームマウント
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 */

const express = require('express');
const router = express.Router();
const Docker = require('dockerode');
const { query } = require('../db/database');
const logger = require('../utils/logger');

// docker-compose.yml の container_name と一致させること
const CONTAINERS = {
  postgres: 'bar-pos-postgres',
  server:   'bar-pos-server',
  client:   'bar-pos-client',
};

const DB_TABLE_WHITELIST = new Set([
  'tables', 'categories', 'subcategories', 'menu_items',
  'orders', 'order_items', 'pricing_events', 'price_history',
  'system_settings', 'ingredients', 'recipes',
  'ingredient_stock', 'ingredient_stock_logs',
]);

// Docker クライアントは遅延初期化（docker.sock 未マウント時のサーバークラッシュ回避）
let docker = null;
function getDocker() {
  if (!docker) docker = new Docker({ socketPath: '/var/run/docker.sock' });
  return docker;
}

// ログ行をレベル付きオブジェクトに変換
function parseLine(rawLine, containerKey) {
  const tsMatch = rawLine.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) ([\s\S]*)$/);
  const timestamp = tsMatch ? tsMatch[1] : null;
  const text = tsMatch ? tsMatch[2] : rawLine;
  let level = 'info';

  if (containerKey === 'server') {
    const m = text.match(/\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/);
    if (m) {
      const l = m[1];
      level = l === 'DEBUG' || l === 'TRACE' ? 'debug'
            : l === 'WARN'                   ? 'warn'
            : l === 'ERROR' || l === 'FATAL' ? 'error'
            : 'info';
    } else {
      try {
        const json = JSON.parse(text);
        if (typeof json.level === 'number') {
          level = json.level >= 50 ? 'error' : json.level >= 40 ? 'warn' : json.level <= 20 ? 'debug' : 'info';
        }
      } catch (_) {}
    }
  } else if (containerKey === 'postgres') {
    if (/\b(ERROR|FATAL|PANIC)\b/.test(text))  level = 'error';
    else if (/\b(WARNING)\b/.test(text))        level = 'warn';
    else if (/\bDEBUG\b/.test(text))            level = 'debug';
  } else if (containerKey === 'client') {
    if (/\[(error|crit|emerg|alert)\]/i.test(text)) level = 'error';
    else if (/\[warn\]/i.test(text))                level = 'warn';
    else if (/ 5\d{2} /.test(text))                 level = 'error';
    else if (/ 4\d{2} /.test(text))                 level = 'warn';
  }

  return { timestamp, text, level, container: containerKey };
}

// GET /api/debug/logs/:container — SSE でコンテナログをストリーミング
router.get('/logs/:container', async (req, res) => {
  const containerKey = req.params.container;
  const containerName = CONTAINERS[containerKey];
  if (!containerName) {
    return res.status(400).json({ error: `不正なコンテナキー: ${containerKey}` });
  }

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  let dockerStream = null;

  function cleanup() {
    clearInterval(heartbeat);
    if (dockerStream) {
      try { dockerStream.destroy(); } catch (_) {}
    }
    res.end();
  }

  function send(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const container = getDocker().getContainer(containerName);
    dockerStream = await container.logs({
      follow: true, stdout: true, stderr: true, tail: 200, timestamps: true,
    });

    // Docker multiplexed stream: 8バイトヘッダーを除去してペイロードを取り出す
    dockerStream.on('data', (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        if (chunk.length - offset < 8) break;
        const payloadLen = chunk.readUInt32BE(offset + 4);
        if (chunk.length - offset < 8 + payloadLen) break;
        const payload = chunk.slice(offset + 8, offset + 8 + payloadLen).toString('utf8');
        offset += 8 + payloadLen;
        payload.split('\n').filter(l => l.trim()).forEach(line => send(parseLine(line, containerKey)));
      }
    });

    dockerStream.on('error', (err) => {
      logger.warn({ err, containerName }, 'debug: docker log stream error');
      send({ type: 'error', message: err.message });
      cleanup();
    });

    dockerStream.on('end', () => {
      send({ type: 'end', message: 'stream ended' });
      cleanup();
    });
  } catch (err) {
    logger.warn({ err, containerName }, 'debug: docker ログ接続失敗');
    send({ type: 'error', message: `Docker 接続失敗: ${err.message}` });
    cleanup();
    return;
  }

  req.on('close', cleanup);
});

// GET /api/debug/db/tables — テーブル一覧（概算行数付き）
router.get('/db/tables', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT t.table_name,
             COALESCE(s.n_live_tup, 0)::int AS approx_rows
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `);
    res.json(rows.filter(r => DB_TABLE_WHITELIST.has(r.table_name)));
  } catch (err) {
    next(err);
  }
});

// GET /api/debug/db/:table — テーブルデータ（読み取り専用・ページ付き）
router.get('/db/:table', async (req, res, next) => {
  try {
    const tableName = req.params.table;
    if (!DB_TABLE_WHITELIST.has(tableName)) {
      return res.status(403).json({ error: `テーブル "${tableName}" へのアクセスは許可されていません` });
    }
    const limit  = Math.min(Math.max(parseInt(req.query.limit  ?? '50', 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset ?? '0',  10) || 0, 0);

    const [{ rows }, { rows: [{ total }] }] = await Promise.all([
      query(`SELECT * FROM "${tableName}" LIMIT $1 OFFSET $2`, [limit, offset]),
      query(`SELECT COUNT(*)::int AS total FROM "${tableName}"`),
    ]);

    res.json({ table: tableName, rows, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
