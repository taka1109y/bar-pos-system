'use strict';
// FANZONE 分析サイト API サーバ
// 起動順: analyticsdb マイグレーション → bardb 読み取り専用セルフチェック（失敗で exit 1）→ ルート登録 → listen
const express = require('express');
const cors = require('cors');
const logger = require('./lib/logger');
const ana = require('./db/ana');
const pos = require('./db/pos');

const PORT = Number(process.env.PORT) || 3101;
const STARTUP_RETRIES = 10;
const STARTUP_RETRY_MS = 2000;

const app = express();
app.disable('x-powered-by');
// CORS: 任意オリジンの反射（origin:true）は禁止。認証が無いサイトのため、外部サイトのページから
// 127.0.0.1:8080 経由で売上データを読まれたり analyticsdb を書き換えられたりしないよう、
// SPA を配信する同一オリジン（nginx 8080）と Vite dev（5174）の許可リストに限定する。
// 通常運用（nginx 経由・Vite proxy 経由）はすべて同一オリジンなので CORS ヘッダー自体が不要だが、
// 許可リスト外の Origin を明示的に 403 で弾くために前置ガードを置く（簡易リクエスト POST の CSRF も防ぐ）。
const ALLOWED_ORIGINS = [
  'http://127.0.0.1:8080', 'http://localhost:8080', // analytics-web(nginx) 経由
  'http://127.0.0.1:5174', 'http://localhost:5174', // Vite dev（/api → 3101 proxy）
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    logger.warn(`許可されていない Origin からのリクエストを拒否: ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ error: 'forbidden_origin' });
  }
  next();
});
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '1mb' }));

// アクセスログ（health はノイズになるので debug）
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;
    if (req.path.endsWith('/meta/health')) logger.debug(line);
    else logger.info(line);
  });
  next();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 起動直後は DB がまだ接続を受け付けないことがあるので少しリトライする
async function retry(label, fn) {
  let lastErr;
  for (let i = 1; i <= STARTUP_RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.warn(`${label} 失敗 (${i}/${STARTUP_RETRIES})`, logger.errInfo(err));
      if (i < STARTUP_RETRIES) await sleep(STARTUP_RETRY_MS);
    }
  }
  throw lastErr;
}

async function main() {
  // 1. analyticsdb マイグレーション
  const mig = await retry('migrate', () => ana.ensureMigrations());
  logger.info('migrations ok', mig);

  // 2. bardb 読み取り専用セルフチェック
  const check = await retry('selfCheck', () => pos.selfCheck());
  if (!check.ok) {
    console.error('[FATAL] bardb セルフチェック失敗: 読み取り専用ロールで接続できていません', JSON.stringify(check));
    console.error('        analytics/bin/ana.sh grant を実行して bar_ro ロールと SELECT 権限を整えてください');
    process.exit(1);
  }
  logger.info('bardb self-check ok', { user: check.user, ro: check.ro, can_insert: check.can_insert });

  // 3. ルート登録
  app.use('/api/v1/meta', require('./routes/meta'));
  app.use('/api/v1/settings', require('./routes/settings'));
  app.use('/api/v1/sales', require('./routes/sales'));
  app.use('/api/v1/export', require('./routes/export'));
  app.use('/api/legacy', require('./routes/legacy'));

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.originalUrl });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // 既存 logs.js は { status, error } のプレーンオブジェクトを throw することがある
    if (err && err.status && err.error && !(err instanceof Error)) {
      return res.status(err.status).json({ error: err.error });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON の形式が不正です' });
    }
    const status = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    logger.error(`${req.method} ${req.originalUrl} -> ${status}`, logger.errInfo(err));
    res.status(status).json({ error: status === 500 ? 'internal_error' : err.message });
  });

  // 4. listen
  const server = app.listen(PORT, () => {
    logger.info(`bar-analytics-server listening on :${PORT}`, { env: process.env.NODE_ENV || 'development' });
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await Promise.allSettled([pos.end(), ana.end()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[FATAL] 起動に失敗しました:', err && err.message ? err.message : err);
  process.exit(1);
});
