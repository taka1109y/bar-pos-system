import { yen, num } from '../../utils/format';

// 増減率バッジ。pct が null のときは比較対象期間の売上が0で、増減を計算できない
function Delta({ pct }) {
  if (pct == null) {
    return <span className="text-xs text-slate-400">比較対象なし</span>;
  }
  const flat = pct === 0;
  const up = pct > 0;
  const color = flat ? 'bg-slate-100 text-slate-500'
    : up ? 'bg-emerald-50 text-emerald-700'
         : 'bg-red-50 text-red-700';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <span aria-hidden="true">{flat ? '→' : up ? '↑' : '↓'}</span>
      {up ? '+' : ''}{num(pct, 1)}%
    </span>
  );
}

function Row({ label, period }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-0">
      <div className="w-32 flex-shrink-0">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-400">
          {period.start === period.end ? period.start : `${period.start} 〜 ${period.end}`}
        </p>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-8 flex-shrink-0">売上</span>
          <span className="text-sm text-slate-600 w-24 text-right">¥{yen(period.total_revenue)}</span>
          <Delta pct={period.revenue_change_pct} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-8 flex-shrink-0">粗利</span>
          <span className="text-sm text-slate-600 w-24 text-right">¥{yen(period.gross_profit)}</span>
          <Delta pct={period.profit_change_pct} />
        </div>
      </div>
    </div>
  );
}

export default function ComparisonCard({ comparison, isSingleDay }) {
  if (!comparison) return null;

  const { prev_period: prev, prev_week: week } = comparison;
  // ちょうど7日間を選ぶと前期間と前週同期間が同一になる。同じ行を2つ出さない
  const sameRange = prev.start === week.start && prev.end === week.end;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 mb-2">過去との比較</h3>
      <Row label={isSingleDay ? '前日' : '前期間'} period={prev} />
      {!sameRange && (
        <Row label={isSingleDay ? '前週同曜日' : '前週同期間'} period={week} />
      )}
    </div>
  );
}
