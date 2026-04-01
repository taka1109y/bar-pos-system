export default function TableGrid({ tables, selectedTableId, onSelectTable, calledTables, onAckCall }) {
  const statusConfig = {
    available: {
      label: '空席',
      bg: 'bg-white',
      border: 'border-gray-200',
      headerBg: 'bg-emerald-50',
      text: 'text-gray-900',
      labelText: 'text-emerald-600',
      dot: 'bg-emerald-400',
    },
    occupied: {
      label: '使用中',
      bg: 'bg-white',
      border: 'border-amber-200',
      headerBg: 'bg-amber-50',
      text: 'text-gray-900',
      labelText: 'text-amber-600',
      dot: 'bg-amber-400',
    },
    closing: {
      label: '会計中',
      bg: 'bg-white',
      border: 'border-red-200',
      headerBg: 'bg-red-50',
      text: 'text-gray-900',
      labelText: 'text-red-600',
      dot: 'bg-red-400',
    },
  };

  const handleClick = (table) => {
    onSelectTable(table);
    if (calledTables?.has(table.id)) {
      onAckCall?.(table.id);
    }
  };

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        テーブルがありません
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 p-6">
      {tables.map((table) => {
        const cfg = statusConfig[table.status] || statusConfig.available;
        const isSelected = selectedTableId === table.id;
        const isCalled = calledTables?.has(table.id);

        return (
          <button
            key={table.id}
            onClick={() => handleClick(table)}
            className={`
              relative rounded-xl border-2 text-left transition-all duration-150 overflow-hidden shadow-sm
              ${cfg.bg} ${cfg.border}
              ${isSelected
                ? 'ring-2 ring-blue-500 ring-offset-2 shadow-md'
                : 'hover:shadow-md hover:-translate-y-0.5'}
            `}
          >
            {/* スタッフ呼び出しバッジ */}
            {isCalled && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full animate-pulse flex items-center justify-center text-white text-xs font-bold z-10 shadow">
                !
              </span>
            )}

            {/* ステータスヘッダー */}
            <div className={`px-3 py-1.5 ${cfg.headerBg} flex items-center justify-between`}>
              <span className={`text-[11px] font-semibold ${cfg.labelText}`}>{cfg.label}</span>
              <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            </div>

            {/* テーブル情報 */}
            <div className="px-3 py-2.5">
              <p className={`font-bold text-sm ${cfg.text}`}>{table.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{table.capacity}席</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
