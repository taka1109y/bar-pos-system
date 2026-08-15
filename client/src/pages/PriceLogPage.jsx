import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { yen } from '../utils/format';

// event_type ごとの表示ラベルとバッジ色（trigger も加味）
function eventMeta(ev) {
  const t = ev.event_type;
  const trig = ev.trigger;
  if (t === 'crash' || t === 'crash_manual') return { label: '暴落', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (t === 'crash_reset')                    return { label: '暴落解除', cls: 'bg-primary-50 text-primary-700 border-primary-200' };
  if (t === 'base_edit')                      return { label: '基準価格変更', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  if (t === 'tick' && trig === 'order')       return { label: '注文で上昇', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (t === 'tick' && trig === 'decay')       return { label: '減衰で下降', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: `${t}${trig ? ` / ${trig}` : ''}`, cls: 'bg-slate-100 text-slate-700 border-slate-200' };
}

// ISO 文字列を「MM/DD HH:mm:ss」で表示
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 変動額の矢印表示
function Delta({ before, after }) {
  const diff = (after ?? 0) - (before ?? 0);
  if (diff > 0) return <span className="text-emerald-600 font-medium tabular-nums">▲ +{yen(diff)}</span>;
  if (diff < 0) return <span className="text-red-600 font-medium tabular-nums">▼ {yen(diff)}</span>;
  return <span className="text-slate-400 tabular-nums">±0</span>;
}

export default function PriceLogPage() {
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState('events'); // 'events' | 'base'

  const { data: menuItems = [] } = useQuery({ queryKey: ['menu-all'], queryFn: api.getAllMenu });

  const { data: events = [], isLoading: evLoading } = useQuery({
    queryKey: ['price-events', selectedId],
    queryFn: () => api.getPriceEvents(selectedId, 200),
    enabled: !!selectedId,
    staleTime: 15_000,
  });

  const { data: baseHistory = [], isLoading: baseLoading } = useQuery({
    queryKey: ['base-price-history', selectedId],
    queryFn: () => api.getBasePriceHistory(selectedId),
    enabled: !!selectedId,
    staleTime: 15_000,
  });

  const selectedItem = menuItems.find((m) => String(m.id) === String(selectedId));

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">価格ログ</h1>
        <p className="text-sm text-slate-500 mt-1">商品ごとの価格変動イベント（注文上昇・減衰・暴落）と基準価格の変更履歴を確認できます。</p>
      </div>

      {/* 商品セレクタ */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <label className="block leading-normal">
          <span className="text-sm font-medium text-slate-700">商品を選択</span>
          <div className="relative mt-2 max-w-md">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="appearance-none w-full pl-3 pr-10 py-2 text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/50 bg-white leading-normal"
            >
              <option value="">— 商品を選んでください —</option>
              {menuItems.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.is_active ? '' : '（無効）'}
                </option>
              ))}
            </select>
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </label>
        {selectedItem && (
          <div className="mt-3 text-xs text-slate-500">
            基準 <span className="font-mono text-slate-700">{yen(selectedItem.base_price)}</span>
            <span className="mx-2">/</span>現在 <span className="font-mono text-slate-700">{yen(selectedItem.current_price)}</span>
            <span className="mx-2">/</span>下限 <span className="font-mono text-slate-700">{yen(selectedItem.min_price)}</span>
            <span className="mx-2">/</span>上限 <span className="font-mono text-slate-700">{yen(selectedItem.max_price)}</span>
          </div>
        )}
      </div>

      {!selectedId ? (
        <div className="text-center py-16 text-base text-slate-500">商品を選択するとログが表示されます。</div>
      ) : (
        <>
          {/* タブ */}
          <div className="flex items-center gap-6 border-b border-slate-200">
            <button
              onClick={() => setTab('events')}
              className={`text-sm border-b-2 pb-2 -mb-px ${tab === 'events' ? 'font-semibold text-primary-500 border-primary-500 cursor-default' : 'font-medium text-slate-500 border-transparent hover:text-slate-700 cursor-pointer'}`}
            >価格変動</button>
            <button
              onClick={() => setTab('base')}
              className={`text-sm border-b-2 pb-2 -mb-px ${tab === 'base' ? 'font-semibold text-primary-500 border-primary-500 cursor-default' : 'font-medium text-slate-500 border-transparent hover:text-slate-700 cursor-pointer'}`}
            >基準価格変更履歴</button>
          </div>

          {tab === 'events' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {evLoading ? (
                <p className="text-sm text-slate-400 p-6">読み込み中...</p>
              ) : events.length === 0 ? (
                <p className="text-base text-slate-500 text-center py-16">この商品の価格変動イベントはまだありません。</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 bg-gray-50">
                        <th scope="col" className="text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">日時</th>
                        <th scope="col" className="text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">種別</th>
                        <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">変更前</th>
                        <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">変更後</th>
                        <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">変動</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((ev) => {
                        const meta = eventMeta(ev);
                        return (
                          <tr key={ev.id} className="border-b border-slate-100 hover:bg-gray-50 transition-colors">
                            <td className="py-3 px-4 text-sm text-body tabular-nums">{fmtTime(ev.event_time)}</td>
                            <td className="py-3 px-4 text-sm">
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${meta.cls}`}>{meta.label}</span>
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-900 tabular-nums">{yen(ev.price_before)}</td>
                            <td className="py-3 px-4 text-sm text-right text-slate-900 tabular-nums">{yen(ev.price_after)}</td>
                            <td className="py-3 px-4 text-sm text-right"><Delta before={ev.price_before} after={ev.price_after} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'base' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {baseLoading ? (
                <p className="text-sm text-slate-400 p-6">読み込み中...</p>
              ) : baseHistory.length === 0 ? (
                <p className="text-base text-slate-500 text-center py-16">基準価格の変更履歴はまだありません。</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 bg-gray-50">
                        <th scope="col" className="text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">日時</th>
                        <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">変更前</th>
                        <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">変更後</th>
                        <th scope="col" className="text-right py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">変動</th>
                        <th scope="col" className="text-left py-3 px-4 text-xs font-medium text-slate-500 uppercase tracking-wider">操作者</th>
                      </tr>
                    </thead>
                    <tbody>
                      {baseHistory.map((h) => (
                        <tr key={h.id} className="border-b border-slate-100 hover:bg-gray-50 transition-colors">
                          <td className="py-3 px-4 text-sm text-body tabular-nums">{fmtTime(h.changed_at)}</td>
                          <td className="py-3 px-4 text-sm text-right text-slate-900 tabular-nums">{yen(h.price_before)}</td>
                          <td className="py-3 px-4 text-sm text-right text-slate-900 tabular-nums">{yen(h.price_after)}</td>
                          <td className="py-3 px-4 text-sm text-right"><Delta before={h.price_before} after={h.price_after} /></td>
                          <td className="py-3 px-4 text-sm text-body">{h.operator || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
