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
              relative rounded-xl text-left transition-all duration-150 overflow-hidden
              ${isOccupied
                ? 'bg-white border-[1.5px] border-primary-200 shadow-sm'
                : 'bg-white border border-slate-200 shadow-sm'
              }
              ${isSelected
                ? 'ring-2 ring-offset-2 ring-primary-400'
                : 'hover:shadow-md hover:-translate-y-0.5'
              }
            `}
          >
            {/* 種別バッジ */}
            <div className={`px-3 py-1.5 border-b text-[10px] font-bold tracking-wider uppercase ${
              isOccupied
                ? 'bg-primary-50 border-primary-100 text-primary-600'
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
                <p className="text-base font-black text-primary-600">
                  {order ? `¥${Math.floor(order.total_amount + (order.charge_amount ?? 0)).toLocaleString()}` : '¥0'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {order ? elapsed(order.opened_at, now) : '00:00'}
                  </p>
                  {order?.guest_count > 0 && (
                    <p className="text-xs text-slate-400 flex items-center gap-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                      {order.guest_count}名
                    </p>
                  )}
                </div>
              </div>
            </div>

          </button>
        );
      })}
    </div>
  );
}
