'use strict';
// すべての /api/v1 応答に付与する meta 情報
//   meta: { definitions_version, tz, boundary_hour, snapshot: { imported_at, orders_count } }
// store_settings と snapshot_imports を短時間キャッシュする（設定変更・取込記録時は invalidateMeta()）
const ana = require('../db/ana');
const logger = require('./logger');
const { TZ } = require('./businessDay');

const DEFINITIONS_VERSION = '1';
const CACHE_TTL_MS = 5000;
let cache = null; // { at: number, value: object }

async function loadMeta() {
  const [settings, snapshot] = await Promise.all([
    ana.query('SELECT business_day_boundary_hour FROM store_settings WHERE id = 1'),
    ana.query('SELECT imported_at, orders_count FROM snapshot_imports ORDER BY imported_at DESC, id DESC LIMIT 1'),
  ]);
  const snap = snapshot.rows[0];
  return {
    definitions_version: DEFINITIONS_VERSION,
    tz: TZ,
    boundary_hour: settings.rows[0] ? settings.rows[0].business_day_boundary_hour : null,
    snapshot: {
      imported_at: snap ? snap.imported_at : null,
      orders_count: snap ? snap.orders_count : null,
    },
  };
}

async function getMeta() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const value = await loadMeta();
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn('meta の取得に失敗（analyticsdb 未接続？）', logger.errInfo(err));
    return {
      definitions_version: DEFINITIONS_VERSION,
      tz: TZ,
      boundary_hour: null,
      snapshot: { imported_at: null, orders_count: null },
      error: 'meta_unavailable',
    };
  }
}

function invalidateMeta() {
  cache = null;
}

async function withMeta(payload) {
  return { ...payload, meta: await getMeta() };
}

module.exports = { withMeta, getMeta, invalidateMeta, DEFINITIONS_VERSION };
