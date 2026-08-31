'use strict';
// analyticsdb のマイグレーション管理
// - analytics/db/migrations/NNNN_name.up.sql / NNNN_name.down.sql を扱う
// - schema_migrations(version, name, checksum, applied_at) は本モジュールが自前で作成する
// - up: 未適用ファイルを昇順に、1ファイル1トランザクションで適用し sha256 を記録
//       適用済みファイルの checksum が変わっていれば throw（履歴改変の検知）
// - down <version>: 最新の適用済みバージョンのみ戻せる（順序を崩さない）
// CLI: node db/migrate.js up | down <version> | status   （ANALYTICS_DATABASE_URL 必須）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'db', 'migrations');
const LOCK_KEY = 20260830; // pg_advisory_lock のキー（複数プロセス同時起動時の二重適用防止）

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`migrations ディレクトリが見つかりません: ${MIGRATIONS_DIR}`);
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.up\.sql$/.test(f)).sort();
  const seen = new Set();
  return files.map((f) => {
    const [, version, name] = f.match(/^(\d+)_(.+)\.up\.sql$/);
    if (seen.has(version)) throw new Error(`migration version が重複しています: ${version}`);
    seen.add(version);
    const upPath = path.join(MIGRATIONS_DIR, f);
    const downPath = path.join(MIGRATIONS_DIR, `${version}_${name}.down.sql`);
    const upSql = fs.readFileSync(upPath, 'utf8');
    return { version, name, upPath, downPath, upSql, checksum: sha256(upSql) };
  });
}

async function ensureTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    name       TEXT,
    checksum   TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function appliedMap(client) {
  const { rows } = await client.query(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version'
  );
  return new Map(rows.map((r) => [r.version, r]));
}

// 専用クライアントで advisory lock を取ってから fn を実行する
async function withLock(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

async function runInTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    await fn();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function up(pool, { log = () => {} } = {}) {
  return withLock(pool, async (client) => {
    await ensureTable(client);
    const applied = await appliedMap(client);
    const result = { applied: [], skipped: [] };
    for (const m of listMigrations()) {
      const row = applied.get(m.version);
      if (row) {
        if (row.checksum !== m.checksum) {
          throw new Error(
            `migration ${m.version}_${m.name}: 適用済みの checksum と一致しません` +
            `（適用後にファイルが変更されています。変更は新しいバージョンとして追加してください）`
          );
        }
        result.skipped.push(m.version);
        continue;
      }
      try {
        await runInTransaction(client, async () => {
          await client.query(m.upSql);
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [m.version, m.name, m.checksum]
          );
        });
      } catch (err) {
        err.message = `migration ${m.version}_${m.name} の適用に失敗: ${err.message}`;
        throw err;
      }
      log(`applied ${m.version}_${m.name}`);
      result.applied.push(m.version);
    }
    return result;
  });
}

function findDownFile(version) {
  const re = new RegExp(`^${version}_.+\\.down\\.sql$`);
  const f = fs.readdirSync(MIGRATIONS_DIR).find((x) => re.test(x));
  return f ? path.join(MIGRATIONS_DIR, f) : null;
}

async function down(pool, version, { log = () => {} } = {}) {
  if (!version) throw new Error('down にはバージョンを指定してください（例: node db/migrate.js down 0001）');
  return withLock(pool, async (client) => {
    await ensureTable(client);
    const applied = await appliedMap(client);
    if (!applied.has(version)) throw new Error(`version ${version} は未適用です`);
    const latest = [...applied.keys()].sort().pop();
    if (latest !== version) {
      throw new Error(`version ${version} より新しい ${latest} が適用済みです。新しい順に down してください`);
    }
    const downPath = findDownFile(version);
    if (!downPath) throw new Error(`version ${version} の down ファイルが見つかりません`);
    const downSql = fs.readFileSync(downPath, 'utf8');
    await runInTransaction(client, async () => {
      await client.query(downSql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
    });
    log(`reverted ${path.basename(downPath)}`);
    return { reverted: version };
  });
}

async function status(pool) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const applied = await appliedMap(client);
    const files = listMigrations();
    const rows = files.map((m) => {
      const row = applied.get(m.version);
      let state = 'pending';
      if (row) state = row.checksum === m.checksum ? 'applied' : 'checksum_mismatch';
      return { version: m.version, name: m.name, state, applied_at: row ? row.applied_at : null };
    });
    const known = new Set(files.map((m) => m.version));
    for (const [version, row] of applied) {
      if (!known.has(version)) rows.push({ version, name: row.name, state: 'missing_file', applied_at: row.applied_at });
    }
    return rows.sort((a, b) => (a.version < b.version ? -1 : 1));
  } finally {
    client.release();
  }
}

module.exports = { up, down, status, listMigrations, MIGRATIONS_DIR };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const url = process.env.ANALYTICS_DATABASE_URL;
  if (!url) {
    console.error('ANALYTICS_DATABASE_URL が未設定です');
    process.exit(2);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, max: 1 });
  (async () => {
    try {
      if (cmd === 'up') {
        const r = await up(pool, { log: console.log });
        console.log(JSON.stringify(r));
      } else if (cmd === 'down') {
        const r = await down(pool, arg, { log: console.log });
        console.log(JSON.stringify(r));
      } else if (cmd === 'status') {
        const rows = await status(pool);
        for (const r of rows) {
          console.log(`${r.version}  ${r.state.padEnd(17)} ${r.name}${r.applied_at ? '  ' + new Date(r.applied_at).toISOString() : ''}`);
        }
      } else {
        console.error('usage: node db/migrate.js up | down <version> | status');
        process.exitCode = 2;
      }
    } catch (err) {
      console.error(`migrate error: ${err.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}
