import { useState } from 'react';
import { yen, num } from '../utils/format';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Field, Input, Select, DataTable, Badge, Tabs, Toolbar, FilterBar, StatTile } from '../components/ui';

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => today().slice(0, 8) + '01';
const fmt = (n) => yen(Math.round(n));
const fmtRate = (n) => num(n, 1);

function CostRateBadge({ rate }) {
  const tone = rate === 0 ? 'neutral' : rate < 30 ? 'success' : rate < 50 ? 'warning' : 'danger';
  return <Badge tone={tone} size="sm">{rate === 0 ? '未設定' : `${fmtRate(rate)}%`}</Badge>;
}

// ── タブ1: 商品別原価 ──
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
      <FilterBar>
        <Field label="開始日"><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="終了日"><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field>
        <Field label="並び替え">
          <Select value={sortKey} onChange={e => setSortKey(e.target.value)} options={[
            { value: 'revenue', label: '売上順' }, { value: 'gross_profit', label: '粗利順' }, { value: 'cost_rate', label: '原価率順' },
          ]} />
        </Field>
        <Field label="商品名絞り込み" className="flex-1 min-w-36"><Input value={search} placeholder="商品名..." onChange={e => setSearch(e.target.value)} /></Field>
      </FilterBar>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="売上合計" value={`¥${fmt(s.total_revenue)}`} />
          <StatTile label="原価合計" value={`¥${fmt(s.total_cost)}`} />
          <StatTile label="粗利合計" value={`¥${fmt(s.gross_profit)}`} />
          <StatTile label="原価率" value={`${fmtRate(s.cost_rate)}%`} sub={`粗利率 ${fmtRate(100 - s.cost_rate)}%`} />
        </div>
      )}

      <DataTable
        rowKey={(r, i) => `${r.menu_item_id}-${i}`}
        empty={<div className="py-12 text-center text-sm text-muted">{isLoading ? '読み込み中...' : error ? 'データ取得エラー' : '該当期間の売上データがありません'}</div>}
        columns={[
          { key: 'name', header: '商品名', render: (r) => <span className="font-medium text-heading">{r.name}</span> },
          { key: 'qty', header: '販売数', align: 'right', render: (r) => r.quantity_sold },
          { key: 'rev', header: '売上', align: 'right', render: (r) => <span className="font-medium text-heading">¥{fmt(r.revenue)}</span> },
          { key: 'cpu', header: '原価/杯', align: 'right', render: (r) => r.cost_per_unit > 0 ? `¥${num(r.cost_per_unit, 2)}` : <span className="text-faint">—</span> },
          { key: 'tc', header: '原価合計', align: 'right', render: (r) => r.total_cost > 0 ? `¥${fmt(r.total_cost)}` : <span className="text-faint">—</span> },
          { key: 'gp', header: '粗利', align: 'right', render: (r) => <span className={r.gross_profit >= 0 ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>¥{fmt(r.gross_profit)}</span> },
          { key: 'rate', header: '原価率', align: 'center', render: (r) => <CostRateBadge rate={r.cost_rate} /> },
        ]}
        rows={error ? [] : items}
      />
    </div>
  );
}

// ── タブ2: 日次粗利 ──
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
      <FilterBar>
        <Field label="開始日"><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="終了日"><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field>
      </FilterBar>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="期間売上" value={`¥${fmt(s.total_revenue)}`} />
          <StatTile label="期間原価" value={`¥${fmt(s.total_cost)}`} />
          <StatTile label="期間粗利" value={`¥${fmt(s.gross_profit)}`} />
          <StatTile label="粗利率" value={`${fmtRate(s.gross_profit_rate)}%`} sub={`${rows.reduce((n, r) => n + r.order_count, 0)}件`} />
        </div>
      )}

      <DataTable
        rowKey={(r) => r.date}
        empty={<div className="py-12 text-center text-sm text-muted">{isLoading ? '読み込み中...' : error ? 'データ取得エラー' : '該当期間のデータがありません'}</div>}
        columns={[
          { key: 'date', header: '日付', render: (r) => <span className="font-medium text-heading">{r.date}</span> },
          { key: 'rev', header: '売上', align: 'right', render: (r) => <span className="text-heading">¥{fmt(r.revenue)}</span> },
          { key: 'cost', header: '原価', align: 'right', render: (r) => `¥${fmt(r.total_cost)}` },
          { key: 'gp', header: '粗利', align: 'right', render: (r) => <span className={r.gross_profit >= 0 ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>¥{fmt(r.gross_profit)}</span> },
          { key: 'rate', header: '粗利率', align: 'center', render: (r) => {
            const tone = r.gross_profit_rate >= 70 ? 'success' : r.gross_profit_rate >= 50 ? 'warning' : 'danger';
            return <Badge tone={tone} size="sm">{fmtRate(r.gross_profit_rate)}%</Badge>;
          } },
          { key: 'n', header: '件数', align: 'right', render: (r) => `${r.order_count}件` },
        ]}
        rows={error ? [] : rows}
      />
    </div>
  );
}

// ── 価格ログ(タブ3/4: 価格変動・基準価格履歴。商品セレクタを共有) ──
function eventTone(ev) {
  const t = ev.event_type, trig = ev.trigger;
  if (t === 'crash' || t === 'crash_manual') return { label: '暴落', tone: 'danger' };
  if (t === 'crash_reset')                    return { label: '暴落解除', tone: 'info' };
  if (t === 'base_edit')                      return { label: '基準価格変更', tone: 'neutral' };
  if (t === 'seesaw_win')                     return { label: 'シーソー勝者↑', tone: 'success' };
  if (t === 'seesaw_lose')                    return { label: 'シーソー犠牲↓', tone: 'warning' };
  if (t === 'market_open')                    return { label: '寄り付き', tone: 'info' };
  if (t === 'tick' && trig === 'order')       return { label: '注文で上昇(旧)', tone: 'success' };  // 旧モデルの履歴
  if (t === 'tick' && trig === 'decay')       return { label: '減衰で下降(旧)', tone: 'warning' };  // 旧モデルの履歴(減衰は廃止)
  return { label: `${t}${trig ? ` / ${trig}` : ''}`, tone: 'neutral' };
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function Delta({ before, after }) {
  const diff = (after ?? 0) - (before ?? 0);
  if (diff > 0) return <span className="text-emerald-600 font-medium tabular-nums">▲ +{yen(diff)}</span>;
  if (diff < 0) return <span className="text-red-600 font-medium tabular-nums">▼ {yen(diff)}</span>;
  return <span className="text-faint tabular-nums">±0</span>;
}

function PriceLogTabs({ tab }) {
  const [selectedId, setSelectedId] = useState('');
  const { data: menuItems = [] } = useQuery({ queryKey: ['menu-all'], queryFn: api.getAllMenu });
  const { data: events = [], isLoading: evLoading } = useQuery({
    queryKey: ['price-events', selectedId], queryFn: () => api.getPriceEvents(selectedId, 200), enabled: !!selectedId, staleTime: 15_000,
  });
  const { data: baseHistory = [], isLoading: baseLoading } = useQuery({
    queryKey: ['base-price-history', selectedId], queryFn: () => api.getBasePriceHistory(selectedId), enabled: !!selectedId, staleTime: 15_000,
  });
  const selectedItem = menuItems.find((m) => String(m.id) === String(selectedId));

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-line p-4">
        <Field label="商品を選択" className="max-w-md">
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">— 商品を選んでください —</option>
            {menuItems.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_active ? '' : '（無効）'}</option>)}
          </Select>
        </Field>
        {selectedItem && (
          <div className="mt-2 text-xs text-muted">
            基準 <span className="font-mono text-body">{yen(selectedItem.base_price)}</span>
            <span className="mx-2">/</span>現在 <span className="font-mono text-body">{yen(selectedItem.current_price)}</span>
            <span className="mx-2">/</span>下限 <span className="font-mono text-body">{yen(selectedItem.min_price)}</span>
            <span className="mx-2">/</span>上限 <span className="font-mono text-body">{yen(selectedItem.max_price)}</span>
          </div>
        )}
      </div>

      {!selectedId ? (
        <div className="text-center py-16 text-sm text-muted">商品を選択するとログが表示されます。</div>
      ) : tab === 'events' ? (
        <DataTable
          rowKey={(ev) => ev.id}
          empty={<div className="py-12 text-center text-sm text-muted">{evLoading ? '読み込み中...' : 'この商品の価格変動イベントはまだありません。'}</div>}
          columns={[
            { key: 'time', header: '日時', render: (ev) => <span className="text-body tabular-nums">{fmtTime(ev.event_time)}</span> },
            { key: 'type', header: '種別', render: (ev) => { const m = eventTone(ev); return <Badge tone={m.tone}>{m.label}</Badge>; } },
            { key: 'before', header: '変更前', align: 'right', render: (ev) => <span className="tabular-nums">{yen(ev.price_before)}</span> },
            { key: 'after', header: '変更後', align: 'right', render: (ev) => <span className="tabular-nums">{yen(ev.price_after)}</span> },
            { key: 'delta', header: '変動', align: 'right', render: (ev) => <Delta before={ev.price_before} after={ev.price_after} /> },
          ]}
          rows={events}
        />
      ) : (
        <DataTable
          rowKey={(h) => h.id}
          empty={<div className="py-12 text-center text-sm text-muted">{baseLoading ? '読み込み中...' : '基準価格の変更履歴はまだありません。'}</div>}
          columns={[
            { key: 'time', header: '日時', render: (h) => <span className="text-body tabular-nums">{fmtTime(h.changed_at)}</span> },
            { key: 'before', header: '変更前', align: 'right', render: (h) => <span className="tabular-nums">{yen(h.price_before)}</span> },
            { key: 'after', header: '変更後', align: 'right', render: (h) => <span className="tabular-nums">{yen(h.price_after)}</span> },
            { key: 'delta', header: '変動', align: 'right', render: (h) => <Delta before={h.price_before} after={h.price_after} /> },
            { key: 'op', header: '操作者', render: (h) => <span className="text-body">{h.operator || '—'}</span> },
          ]}
          rows={baseHistory}
        />
      )}
    </div>
  );
}

// ── 原価・価格分析ビュー(原価分析 + 価格ログ を4タブに統合) ──
export default function CostPriceView() {
  const [tab, setTab] = useState('items');
  return (
    <div className="ui-pad p-4 md:p-6 space-y-4">
      <Toolbar title="原価・価格分析" subtitle="商品別原価・日次粗利と価格変動ログ" />
      <Tabs
        activeId={tab}
        onChange={setTab}
        tabs={[
          { id: 'items', label: '商品別原価' },
          { id: 'daily', label: '日次粗利' },
          { id: 'events', label: '価格変動' },
          { id: 'base', label: '基準価格履歴' },
        ]}
      />
      {tab === 'items' && <ItemCostTab />}
      {tab === 'daily' && <DailyProfitTab />}
      {(tab === 'events' || tab === 'base') && <PriceLogTabs tab={tab} />}
    </div>
  );
}
