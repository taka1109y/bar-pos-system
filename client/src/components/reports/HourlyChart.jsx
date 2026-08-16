import { yen } from '../../utils/format';

// サーバは売上のあった時間しか返さないため、0〜23時を0埋めして連続させる
function fillHours(hourly) {
  const byHour = new Map((hourly ?? []).map(h => [h.hour, h]));
  return Array.from({ length: 24 }, (_, hour) =>
    byHour.get(hour) ?? { hour, revenue: 0, quantity: 0 }
  );
}

export default function HourlyChart({ hourly }) {
  const hours = fillHours(hourly);
  const maxRevenue = Math.max(...hours.map(h => h.revenue), 1);
  const total = hours.reduce((sum, h) => sum + h.revenue, 0);
  const peak = hours.reduce((best, h) => (h.revenue > best.revenue ? h : best), hours[0]);

  if (total === 0) {
    return (
      <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
        <h3 className="text-sm font-bold text-heading mb-4">時間帯別売上</h3>
        <p className="text-sm text-muted text-center py-16">この期間の売上データはありません</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-bold text-heading">時間帯別売上</h3>
        <p className="text-xs text-muted">ピーク {peak.hour}時台 ¥{yen(peak.revenue)}</p>
      </div>

      <div className="flex items-end gap-1 h-40" role="img" aria-label={`時間帯別売上。ピークは${peak.hour}時台`}>
        {hours.map(h => (
          // タッチ端末では hover が無いため、tabIndex でフォーカス可能にし tap でツールチップを表示する
          <div key={h.hour} tabIndex={h.revenue > 0 ? 0 : -1}
            className="flex-1 flex flex-col justify-end h-full group relative focus:outline-none rounded"
            aria-label={h.revenue > 0 ? `${h.hour}時台 ¥${yen(h.revenue)} ${h.quantity}点` : undefined}>
            <div
              className={`w-full rounded-t transition-colors ${h.hour === peak.hour ? 'bg-primary-500' : 'bg-primary-200 group-hover:bg-primary-400 group-focus:bg-primary-400'}`}
              style={{ height: `${(h.revenue / maxRevenue) * 100}%` }}
            />
            {h.revenue > 0 && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block group-focus:block z-10 pointer-events-none">
                <div className="bg-slate-700 text-white text-xs rounded-lg shadow-md px-3 py-2 whitespace-nowrap">
                  {h.hour}時台 ¥{yen(h.revenue)}／{h.quantity}点
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-1 mt-2">
        {hours.map(h => (
          <span key={h.hour} className={`flex-1 text-center text-2xs tabular-nums ${h.hour % 3 === 0 ? 'text-faint' : 'text-transparent'}`}>
            {h.hour}
          </span>
        ))}
      </div>

      <p className="text-xs text-muted mt-3">
        注文時刻で集計（暦日 0:00 区切り・JST）。深夜営業分は翌日の未明として左端に表示されます。
      </p>
    </div>
  );
}
