// テスト専用ページ — 本番前に削除すること / DELETE BEFORE PRODUCTION
// 削除対象:
//   - このファイル (client/src/pages/DebugPage.jsx)
//   - client/src/App.jsx の import DebugPage と /debug Route
//   - server/routes/debug.js
//   - server/index.js の app.use('/api/debug', ...) 行
//   - docker-compose.yml の /var/run/docker.sock ボリューム

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

const LEVEL_CLASSES = {
  info:  'text-green-400',
  warn:  'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-slate-500',
};

const CONTAINERS = [
  { key: 'postgres', label: 'postgres' },
  { key: 'server',   label: 'server' },
  { key: 'client',   label: 'client (nginx)' },
];

function fmtTs(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch {
    return ts.substring(11, 19);
  }
}

function LogPanel({ containerKey, label }) {
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    const es = new EventSource(`/api/debug/logs/${containerKey}`);

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'error') {
          setError(data.message);
          setConnected(false);
        } else if (data.type === 'end') {
          setConnected(false);
        } else {
          setLines(prev => [...prev.slice(-1999), data]);
        }
      } catch (_) {}
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [containerKey]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [lines, autoScroll]);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-400' : 'bg-slate-600'}`} />
          <span className="text-xs font-mono font-semibold text-slate-300">{label}</span>
          <span className="text-xs text-slate-600">({lines.length})</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="w-3 h-3"
            />
            自動scroll
          </label>
          <button
            onClick={() => setLines([])}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 transition-colors"
          >
            クリア
          </button>
        </div>
      </div>
      <div className="h-64 overflow-y-auto bg-slate-950 p-2">
        {error && (
          <div className="text-red-400 text-xs p-2 font-mono">Docker 接続エラー: {error}</div>
        )}
        {!error && lines.length === 0 && (
          <div className="text-slate-600 text-xs p-2 font-mono animate-pulse">接続中...</div>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            className={`text-xs leading-5 whitespace-pre-wrap break-all font-mono ${LEVEL_CLASSES[line.level] ?? 'text-slate-400'}`}
          >
            <span className="text-slate-700 mr-2 select-none">{fmtTs(line.timestamp)}</span>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function DbViewer() {
  const [selectedTable, setSelectedTable] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const { data: tablesData } = useQuery({
    queryKey: ['debug-tables'],
    queryFn: async () => {
      const res = await fetch('/api/debug/db/tables');
      if (!res.ok) throw new Error('テーブル一覧の取得に失敗');
      return res.json();
    },
    staleTime: Infinity,
  });

  const { data: rowsData, isLoading, isError } = useQuery({
    queryKey: ['debug-rows', selectedTable, offset],
    queryFn: async () => {
      const res = await fetch(`/api/debug/db/${selectedTable}?limit=${LIMIT}&offset=${offset}`);
      if (!res.ok) throw new Error('データの取得に失敗');
      return res.json();
    },
    enabled: !!selectedTable,
    staleTime: 10_000,
  });

  const columns = rowsData?.rows?.length > 0 ? Object.keys(rowsData.rows[0]) : [];
  const totalPages = rowsData ? Math.max(1, Math.ceil(rowsData.total / LIMIT)) : 0;
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="mt-4 border border-slate-700 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-slate-800 border-b border-slate-700">
        <span className="text-xs font-semibold text-slate-400 tracking-widest uppercase">DB Table Viewer</span>
        <div className="relative">
          <select
            value={selectedTable}
            onChange={e => { setSelectedTable(e.target.value); setOffset(0); }}
            className="appearance-none bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
          >
            <option value="">テーブルを選択...</option>
            {(tablesData ?? []).map(t => (
              <option key={t.table_name} value={t.table_name}>
                {t.table_name}{t.approx_rows > 0 ? ` (≈${t.approx_rows})` : ''}
              </option>
            ))}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {rowsData && (
          <span className="text-xs text-slate-500">
            全{rowsData.total}行 — ページ {currentPage}/{totalPages}
          </span>
        )}
        {rowsData && rowsData.total > LIMIT && (
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
              disabled={offset === 0}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← 前
            </button>
            <button
              onClick={() => setOffset(o => o + LIMIT)}
              disabled={offset + LIMIT >= (rowsData?.total ?? 0)}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              次 →
            </button>
          </div>
        )}
      </div>

      {!selectedTable && (
        <div className="text-center py-10 text-slate-600 text-sm bg-slate-900">テーブルを選択してください</div>
      )}
      {selectedTable && isLoading && (
        <div className="text-center py-10 text-slate-500 text-sm bg-slate-900 animate-pulse">読み込み中...</div>
      )}
      {selectedTable && isError && (
        <div className="text-center py-10 text-red-400 text-sm bg-slate-900">データの取得に失敗しました</div>
      )}
      {rowsData?.rows?.length === 0 && (
        <div className="text-center py-10 text-slate-600 text-sm bg-slate-900">データがありません</div>
      )}
      {rowsData?.rows?.length > 0 && (
        <div className="overflow-x-auto bg-slate-900">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800">
                {columns.map(col => (
                  <th key={col} scope="col" className="text-left px-3 py-2 text-slate-400 font-medium whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsData.rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/60 transition-colors">
                  {columns.map(col => (
                    <td key={col} className="px-3 py-1.5 text-slate-300 whitespace-nowrap max-w-xs overflow-hidden text-ellipsis">
                      {row[col] === null ? (
                        <span className="text-slate-700 italic">null</span>
                      ) : typeof row[col] === 'boolean' ? (
                        <span className={row[col] ? 'text-green-400' : 'text-slate-500'}>{String(row[col])}</span>
                      ) : (
                        String(row[col])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DebugPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* 削除リマインダーバナー */}
      <div className="bg-red-950 border-b border-red-900 text-red-300 text-xs px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold text-red-400">⚠ TEST-ONLY PAGE</span>
        <span className="text-red-400">—</span>
        <span>テスト完了後に以下を削除すること:</span>
        <code className="bg-red-900/50 px-1.5 py-0.5 rounded text-red-300">server/routes/debug.js</code>
        <code className="bg-red-900/50 px-1.5 py-0.5 rounded text-red-300">server/index.js (debug行)</code>
        <code className="bg-red-900/50 px-1.5 py-0.5 rounded text-red-300">client/src/pages/DebugPage.jsx</code>
        <code className="bg-red-900/50 px-1.5 py-0.5 rounded text-red-300">client/src/App.jsx (/debug Route)</code>
        <code className="bg-red-900/50 px-1.5 py-0.5 rounded text-red-300">docker-compose.yml (docker.sock)</code>
      </div>

      <div className="px-6 py-4">
        <h1 className="text-base font-bold text-slate-300 mb-3 tracking-wider uppercase">Debug Console</h1>

        {/* ログパネル 3列 */}
        <div className="flex border border-slate-700 rounded-xl overflow-hidden">
          {CONTAINERS.map((c, i) => (
            <div
              key={c.key}
              className={`flex-1 min-w-0 ${i < CONTAINERS.length - 1 ? 'border-r border-slate-700' : ''}`}
            >
              <LogPanel containerKey={c.key} label={c.label} />
            </div>
          ))}
        </div>

        {/* DB ビューア */}
        <DbViewer />
      </div>
    </div>
  );
}
