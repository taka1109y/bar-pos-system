import { cn } from './cn';

// 高密度データテーブル。生 <table>(8ファイル)の overflow/scope 欠落を一掃する統合先。
// 外側を常に overflow-x-auto でラップし、<th scope="col"> を強制。
// columns: [{ key, header, align:'left'|'right'|'center', width, className, thClassName, render:(row,i)=>node }]
export default function DataTable({ columns, rows, rowKey, dense = true, onRowClick, stickyHeader = false, empty, className }) {
  const pad = dense ? 'px-3 py-1.5' : 'px-4 py-2.5';
  const alignCls = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  return (
    <div className={cn('w-full overflow-x-auto bg-surface border border-line rounded-xl', className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className={cn('bg-surface-sunken border-b border-line', stickyHeader && 'sticky top-0 z-10')}>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cn(pad, 'text-2xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap', alignCls(c.align), c.thClassName)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows || rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty || <div className="py-10 text-center text-sm text-muted">データがありません</div>}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : i}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={cn('border-b border-line last:border-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-hover')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn(pad, 'text-dense text-body align-middle', alignCls(c.align), c.className)}>
                    {c.render ? c.render(row, i) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
