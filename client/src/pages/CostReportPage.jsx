import { useState } from 'react';
import { yen, num } from '../utils/format';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const t = today();
  return t.slice(0, 8) + '01';
};

function fmt(n) { return yen(Math.round(n)); }
function fmtRate(n) { return num(n, 1); }

function CostRateBadge({ rate }) {
  const color =
    rate === 0    ? 'bg-slate-100 text-slate-500' :
    rate < 30     ? 'bg-emerald-50 text-emerald-700' :
    rate < 50     ? 'bg-amber-50 text-amber-700' :
                    'bg-red-50 text-red-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {rate === 0 ? '未設定' : `${fmtRate(rate)}%`}
    </span>
  );
}

// タブ1: 商品別原価分析
function ItemCostTab() {
  const [start, setStart] = useState(today());
  const [end,   setEnd]   = useState(today());
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('revenue');

  const { data, isLoading, error } = useQuery({
    queryKey: ['cost-analysis', start, end],
    queryFn: () => api.getCostAnalysis(start, end),
    staleTime: 60_000,
  });

  const items = (data?.items ?? [])
    .filter(r => !search || r.name.includes(search))
    .sort((a, b) => {
      if (sortKey === 'cost_rate')    return b.cost_rate - a.cost_rate;
      if (sortKey === 'gross_profit') return b.gross_profit - a.gross_profit;
      return b.revenue - a.revenue;
    });

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="leading-normal">
            <label className="block text-xs font-medium text-slate-500 mb-1">開始日</label>
            <input
              type="date" value={start}
              onChange={e => setStart(e.target.value)}
              className="h-9 px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500"
            />
          </div>
          <div className="leading-normal">
            <label className="block text-xs font-medium text-slate-500 mb-1">終了日</label>
            <input
              type="date" value={end}
              onChange={e => setEnd(e.target.value)}
              className="h-9 px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500"
            />
          </div>
          <div className="leading-normal">
            <label className="block text-xs font-medium text-slate-500 mb-1">並び替え</label>
            <div className="relative">
              <select
                value={sortKey} onChange={e => setSortKey(e.target.value)}
                className="h-9 appearance-none pl-3 pr-8 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/50"
              >
                <option value="revenue">売上順</option>
                <option value="gross_profit">粗利順</option>
                <option value="cost_rate">原価率順</option>
              </select>
              <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </div>
          <div className="leading-normal flex-1 min-w-36">
            <label className="block text-xs font-medium text-slate-500 mb-1">商品名絞り込み</label>
            <input
              type="text" value={search}
              placeholder="商品名..."
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-full px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 caret-primary-500"
            />
          </div>
        </div>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '売上合計', value: `¥${fmt(s.total_revenue)}` },
            { label: '原価合計', value: `¥${fmt(s.total_cost)}` },
            { label: '粗利合計', value: `¥${fmt(s.gross_profit)}` },
            { label: '原価率',   value: `${fmtRate(s.cost_rate)}%`, sub: `粗利率 ${fmtRate(100 - s.cost_rate)}%` },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className="text-xl font-bold text-slate-900">{value}</p>
              {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">読み込み中...</div>
        ) : error ? (
          <div className="py-16 text-center text-red-500 text-sm">データ取得エラー</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">該当期間の売上データがありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-gray-50">
                <th scope="col" className="text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">商品名</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">販売数</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">売上</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">原価/杯</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">原価合計</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">粗利</th>
                <th scope="col" className="text-center py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">原価率</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={`${row.menu_item_id}-${i}`} className="border-b border-slate-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-slate-900 font-medium">{row.name}</td>
                  <td className="py-3 px-4 text-right text-slate-700">{row.quantity_sold}</td>
                  <td className="py-3 px-4 text-right text-slate-900 font-medium">¥{fmt(row.revenue)}</td>
                  <td className="py-3 px-4 text-right text-slate-600">
                    {row.cost_per_unit > 0 ? `¥${num(row.cost_per_unit, 2)}` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-700">
                    {row.total_cost > 0 ? `¥${fmt(row.total_cost)}` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={row.gross_profit >= 0 ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                      ¥{fmt(row.gross_profit)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <CostRateBadge rate={row.cost_rate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// タブ2: 日次粗利推移
function DailyProfitTab() {
  const [start, setStart] = useState(firstOfMonth());
  const [end,   setEnd]   = useState(today());

  const { data, isLoading, error } = useQuery({
    queryKey: ['profit-summary', start, end],
    queryFn: () => api.getProfitSummary(start, end),
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];
  const s    = data?.summary;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="leading-normal">
            <label className="block text-xs font-medium text-slate-500 mb-1">開始日</label>
            <input
              type="date" value={start}
              onChange={e => setStart(e.target.value)}
              className="h-9 px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500"
            />
          </div>
          <div className="leading-normal">
            <label className="block text-xs font-medium text-slate-500 mb-1">終了日</label>
            <input
              type="date" value={end}
              onChange={e => setEnd(e.target.value)}
              className="h-9 px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 caret-primary-500"
            />
          </div>
        </div>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '期間売上', value: `¥${fmt(s.total_revenue)}` },
            { label: '期間原価', value: `¥${fmt(s.total_cost)}` },
            { label: '期間粗利', value: `¥${fmt(s.gross_profit)}` },
            { label: '粗利率',   value: `${fmtRate(s.gross_profit_rate)}%` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className="text-xl font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">読み込み中...</div>
        ) : error ? (
          <div className="py-16 text-center text-red-500 text-sm">データ取得エラー</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">該当期間のデータがありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-gray-50">
                <th scope="col" className="text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">日付</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">売上</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">原価</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">粗利</th>
                <th scope="col" className="text-center py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">粗利率</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">件数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.date} className="border-b border-slate-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-slate-900 font-medium">{row.date}</td>
                  <td className="py-3 px-4 text-right text-slate-900">¥{fmt(row.revenue)}</td>
                  <td className="py-3 px-4 text-right text-slate-600">¥{fmt(row.total_cost)}</td>
                  <td className="py-3 px-4 text-right">
                    <span className={row.gross_profit >= 0 ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                      ¥{fmt(row.gross_profit)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      row.gross_profit_rate >= 70 ? 'bg-emerald-50 text-emerald-700' :
                      row.gross_profit_rate >= 50 ? 'bg-amber-50 text-amber-700' :
                                                    'bg-red-50 text-red-700'
                    }`}>
                      {fmtRate(row.gross_profit_rate)}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-slate-600">{row.order_count}件</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-gray-50">
                <td className="py-3 px-4 text-xs font-semibold text-slate-600">合計</td>
                <td className="py-3 px-4 text-right text-sm font-bold text-slate-900">¥{s ? fmt(s.total_revenue) : '—'}</td>
                <td className="py-3 px-4 text-right text-sm font-medium text-slate-700">¥{s ? fmt(s.total_cost) : '—'}</td>
                <td className="py-3 px-4 text-right text-sm font-bold text-emerald-700">¥{s ? fmt(s.gross_profit) : '—'}</td>
                <td className="py-3 px-4 text-center text-sm font-medium text-slate-700">{s ? fmtRate(s.gross_profit_rate) : '—'}%</td>
                <td className="py-3 px-4 text-right text-sm font-medium text-slate-700">{rows.reduce((n, r) => n + r.order_count, 0)}件</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

// タブ3: 材料在庫評価額
function StockValuationTab() {
  const { data: inventory, isLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: api.getInventory,
    staleTime: 30_000,
  });

  const rows = (inventory ?? [])
    .filter(r => r.quantity_current != null)
    .map(r => ({
      ...r,
      unit_cost: r.purchase_quantity > 0
        ? r.cost_per_purchase_unit / r.purchase_quantity
        : 0,
      valuation: r.quantity_current > 0 && r.purchase_quantity > 0
        ? r.quantity_current * r.cost_per_purchase_unit / r.purchase_quantity
        : 0,
    }))
    .sort((a, b) => b.valuation - a.valuation);

  const totalValuation = rows.reduce((sum, r) => sum + r.valuation, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">在庫評価額合計</p>
          <p className="text-2xl font-bold text-slate-900">¥{fmt(totalValuation)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">管理材料数</p>
          <p className="text-2xl font-bold text-slate-900">{rows.length} 種</p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs text-amber-700 mb-1 font-medium">計算式</p>
          <p className="text-xs text-amber-600">現在在庫量 × (仕入れ値 ÷ 仕入れ容量)</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">読み込み中...</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">在庫設定済みの材料がありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-gray-50">
                <th scope="col" className="text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">材料名</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">現在在庫</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">単価(/単位)</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">評価額</th>
                <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">仕入れ換算</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const purchaseUnitsLeft = row.purchase_quantity > 0
                  ? num((row.quantity_current / row.purchase_quantity), 2)
                  : '—';
                return (
                  <tr key={row.ingredient_id} className="border-b border-slate-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-slate-900 font-medium">{row.name}</td>
                    <td className="py-3 px-4 text-right text-slate-700">
                      {yen(row.quantity_current)}{row.quantity_unit}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-600">
                      ¥{num(row.unit_cost, 4)}/{row.quantity_unit}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">¥{fmt(row.valuation)}</td>
                    <td className="py-3 px-4 text-right text-slate-500">
                      {purchaseUnitsLeft}{row.purchase_unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-gray-50">
                <td className="py-3 px-4 text-xs font-semibold text-slate-600" colSpan={3}>評価額合計</td>
                <td className="py-3 px-4 text-right text-sm font-bold text-slate-900">¥{fmt(totalValuation)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'items', label: '商品別原価分析' },
  { id: 'daily', label: '日次粗利推移' },
  { id: 'stock', label: '材料在庫評価額' },
];

export default function CostReportPage() {
  const [tab, setTab] = useState('items');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">原価分析</h1>
        <p className="text-sm text-slate-500 mt-1">レシピベースの原価・粗利・在庫評価</p>
      </div>

      <div className="flex gap-4 border-b border-slate-200 mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'text-primary-500 border-primary-500'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'items' && <ItemCostTab />}
      {tab === 'daily' && <DailyProfitTab />}
      {tab === 'stock' && <StockValuationTab />}
    </div>
  );
}
