export default function TableGrid({ tables, selectedTableId, onSelectTable, calledTables, onAckCall }) {
  const statusConfig = {
    available: { label: '空席', bg: 'bg-emerald-900/40', border: 'border-emerald-500', text: 'text-emerald-300', dot: 'bg-emerald-400' },
    occupied:  { label: '使用中', bg: 'bg-amber-900/40', border: 'border-amber-500', text: 'text-amber-300', dot: 'bg-amber-400' },
    closing:   { label: '会計中', bg: 'bg-red-900/40', border: 'border-red-500', text: 'text-red-300', dot: 'bg-red-400' },
  };

  const handleClick = (table) => {
    onSelectTable(table);
    // テーブルカードをクリックしたらコールバッジを消去
    if (calledTables?.has(table.id)) {
      onAckCall?.(table.id);
    }
  };

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 p-4">
      {tables.map((table) => {
        const cfg = statusConfig[table.status] || statusConfig.available;
        const isSelected = selectedTableId === table.id;
        const isCalled = calledTables?.has(table.id);

        return (
          <button
            key={table.id}
            onClick={() => handleClick(table)}
            className={`
              relative p-4 rounded-xl border-2 text-left transition-all duration-150
              ${cfg.bg} ${cfg.border} ${cfg.text}
              ${isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-105' : 'hover:scale-102 hover:brightness-110'}
            `}
          >
            {/* スタッフ呼び出しバッジ */}
            {isCalled && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full animate-pulse flex items-center justify-center text-white text-xs font-bold z-10">
                !
              </span>
            )}

            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm">{table.name}</span>
              <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
            </div>
            <div className="text-xs opacity-70">{cfg.label}</div>
            <div className="text-xs opacity-50 mt-1">{table.capacity}席</div>
          </button>
        );
      })}
    </div>
  );
}
