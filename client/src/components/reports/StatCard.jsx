// 売上管理ページのサマリーカード。accent は value の色(呼び出し側指定)。
export default function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
      <p className="text-2xs font-semibold text-muted uppercase tracking-wider mb-1.5">{label}</p>
      <p className={`text-2xl font-bold leading-none tabular-nums ${accent ?? 'text-heading'}`}>{value}</p>
      {sub && <p className="text-xs text-muted mt-1.5">{sub}</p>}
    </div>
  );
}
