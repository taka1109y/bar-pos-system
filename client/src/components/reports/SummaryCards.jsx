import { yen, num } from '../../utils/format';
import StatCard from './StatCard';

// 分を「1時間42分」形式にする
function stayLabel(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

export default function SummaryCards({ summary }) {
  const s = summary ?? {};
  const coverage = s.cost_coverage_pct ?? 0;
  // レシピ未登録の商品は原価0として集計されるため、カバー率が100%未満なら粗利は上振れしている。
  // 売上が1件も無い日はカバー率が0%になるが、それは原価未設定が理由ではないので警告しない
  const hasSales = (s.total_item_count ?? 0) > 0;
  const costUnderstated = hasSales && coverage < 100;

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="総売上"   value={`¥${yen(s.total_revenue)}`} />
        <StatCard label="会計件数" value={`${s.order_count ?? 0}件`} sub={`${s.total_item_count ?? 0}点`} />
        <StatCard label="平均単価" value={`¥${yen(s.avg_order_value)}`} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="原価合計"
          value={`¥${yen(s.total_cost)}`}
          accent="text-slate-700"
          sub={!hasSales ? undefined : costUnderstated ? `原価設定 ${num(coverage, 1)}%` : '全商品に原価設定あり'}
        />
        <StatCard
          label="粗利"
          value={`¥${yen(s.gross_profit)}`}
          accent={(s.gross_profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}
          sub={costUnderstated ? '原価未設定分があり上振れ' : undefined}
        />
        <StatCard
          label="粗利率"
          value={`${num(s.gross_profit_rate, 1)}%`}
          accent={(s.gross_profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}
        />
      </div>

      {costUnderstated && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm leading-relaxed">
            レシピ未登録の商品は原価0として計算されます。原価が設定されているのは売上の{' '}
            <strong className="font-semibold">{num(coverage, 1)}%</strong>{' '}
            のため、実際の粗利はこの表示より低くなります。「レシピ管理」で原価を登録すると精度が上がります。
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="客数"         value={`${s.guest_count ?? 0}名`} sub={`平均 ${num(s.avg_guests_per_order, 1)}名/組`} />
        <StatCard label="客単価"       value={`¥${yen(s.avg_per_guest)}`} />
        <StatCard label="平均滞在時間" value={stayLabel(s.avg_stay_minutes)} sub="即会計を除く" />
      </div>
    </>
  );
}
