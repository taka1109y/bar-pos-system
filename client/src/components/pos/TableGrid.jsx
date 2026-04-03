import { useState, useEffect } from 'react';

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function elapsed(openedAt, now) {
  const ms = now - new Date(openedAt).getTime();
  const totalMin = Math.floor(ms / 60_000);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function TableGrid({ tables, openOrders = [], selectedTableId, onSelectTable }) {
  const now = useNow();

  const orderByTable = openOrders.reduce((acc, o) => { acc[o.table_id] = o; return acc; }, {});

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        テーブルがありません
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-6">
      {tables.map((table) => {
        const isCounter  = table.table_type === 'counter';
        const order      = orderByTable[table.id];
        const isOccupied = !!order;
        const isSelected = selectedTableId === table.id;

        return (
          <button
            key={table.id}
            onClick={() => onSelectTable(table)}
            className={`
              relative rounded-xl text-left transition-all duration-150 overflow-hidden border-2 bg-white
              ${isOccupied
                ? isCounter
                  ? 'border-amber-300 shadow-md shadow-amber-100'
                  : 'border-indigo-300 shadow-md shadow-indigo-100'
                : 'border-slate-200 shadow-sm'
              }
              ${isSelected
                ? `ring-2 ring-offset-2 ${isCounter ? 'ring-amber-500' : 'ring-indigo-500'}`
                : 'hover:shadow-lg hover:-translate-y-0.5'
              }
            `}
          >
            {/* 種別バッジ */}
            <div className={`px-3 py-1.5 border-b text-xs font-bold tracking-wide ${
              isOccupied
                ? isCounter
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-slate-50 border-slate-100 text-slate-400'
            }`}>
              {isCounter ? 'カウンター' : 'テーブル'}
            </div>

            {/* コンテンツ */}
            <div className="px-4 py-3">
              <p className={`font-bold text-sm ${isOccupied ? 'text-slate-900' : 'text-slate-500'}`}>
                {table.name}
              </p>

              <div className={`mt-2 space-y-0.5 ${isOccupied ? '' : 'invisible'}`}>
                <p className={`text-base font-black ${isCounter ? 'text-amber-600' : 'text-indigo-600'}`}>
                  {order ? `¥${Math.floor(order.total_amount).toLocaleString()}` : '¥0'}
                </p>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  <span>⏱</span>
                  {order ? elapsed(order.opened_at, now) : '00:00'}
                </p>
              </div>
            </div>

            {/* 在席インジケーター */}
            {isOccupied && (
              <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                isCounter ? 'bg-amber-400' : 'bg-indigo-400'
              }`} />
            )}
          </button>
        );
      })}
    </div>
  );
}
