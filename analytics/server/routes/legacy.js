'use strict';
// 既存 POS の集計 API をそのまま読み取り専用で公開する（/api/legacy/reports, /api/legacy/logs）
// - ルータ本体は server/routes/reports.js, logs.js を無改変で流用
// - それらは server/db/database.js の Pool（DATABASE_URL=bar_ro）で動く
// - GET/HEAD 以外は 405 で拒否（nginx 側でも limit_except で二重に遮断）
const path = require('path');
const express = require('express');

const SERVER_ROUTES = path.resolve(__dirname, '..', '..', '..', 'server', 'routes');
const reports = require(path.join(SERVER_ROUTES, 'reports'));
const logs = require(path.join(SERVER_ROUTES, 'logs'));

function readOnlyGuard(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'read-only' });
  }
  next();
}

const router = express.Router();
router.use(readOnlyGuard);
router.use('/reports', reports);
router.use('/logs', logs);

module.exports = router;
