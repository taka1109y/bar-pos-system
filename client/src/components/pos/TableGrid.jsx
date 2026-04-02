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

  // table_id → order のマップ
  const orderByTable = openOrders.reduce((acc, o) => { acc[o.table_id] = o; return acc; }, {});

  const typeColor = {
    table:   { base: 'border-blue-200',  header: 'bg-blue-50',   text: 'text-blue-700',  badge: 'bg-blue-100 text-blue-700' },
    counter: { base: 'border-amber-200', header: 'bg-amber-50',  text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  };

  const handleClick = (table) => onSelectTable(table);

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        テーブルがありません
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 p-6">
      {tables.map((table) => {
        const type    = table.table_type === 'counter' ? 'counter' : 'table';
        const cfg     = typeColor[type];
        const order   = orderByTable[table.id];
        const isSelected = selectedTableId === table.id;

        return (
          <button
            key={table.id}
            onClick={() => handleClick(table)}
            className={`
              relative rounded-xl border-2 text-left transition-all duration-150 overflow-hidden shadow-sm bg-white
              ${order ? cfg.base.replace('200', '300') : cfg.base}
              ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 shadow-md' : 'hover:shadow-md hover:-translate-y-0.5'}
            `}
          >

            {/* 種別ヘッダー */}
            <div className={`px-3 py-2 ${cfg.header} border-b ${order ? cfg.base.replace('200', '300') : cfg.base}`}>
              <span className={`text-xs font-semibold ${cfg.text}`}>
                {type === 'counter' ? 'カウンター' : 'テーブル'}
              </span>
            </div>

            {/* テーブル情報 */}
            <div className="px-4 py-3">
              <p className="font-bold text-sm text-gray-900">{table.name}</p>

              <div className={`mt-2 space-y-1 ${order ? '' : 'invisible'}`}>
                <p className="text-sm font-bold text-gray-800">
                  {order ? `¥${Math.floor(order.total_amount).toLocaleString()}` : '¥0'}
                </p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <span>⏱</span>
                  {order ? elapsed(order.opened_at, now) : '00:00'}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
