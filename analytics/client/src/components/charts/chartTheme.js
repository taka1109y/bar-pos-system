// 分析サイトのチャート共通定義(色・軸・共通 option ビルダー)。
// カテゴリカル色は dataviz 検証(validate_palette.js: 明度帯/彩度床/CVD分離/通常視分離/コントラスト)を
// 全 PASS した固定順 4 色。系列には常にこの順で割り当て、循環生成はしない。
// 比較・参照系列(前期間など)は muted + 破線で「参照」であることを形でも示す。
import { yen, num } from '../../utils/format';

export const PALETTE = {
  blue:    '#2b70ef', // categorical 1 (= primary-500)
  emerald: '#059669', // categorical 2 (= success)
  amber:   '#b45309', // categorical 3 (amber-700。#d97706 は緑との CVD 分離が不足するため 1 段暗く)
  violet:  '#7c3aed', // categorical 4
  muted:   '#94a3b8', // 比較・参照系列専用(破線とセットで使う)
  axis:    '#64748b', // 軸ラベル (= text-muted)
  grid:    '#e2e8f0', // グリッド線 (= border-line)
  surface: '#ffffff', // チャート面 (= bg-surface)。積み上げ区切りの 2px ボーダーに使う
};

export const CATEGORICAL = [PALETTE.blue, PALETTE.emerald, PALETTE.amber, PALETTE.violet];

// 逐次スケール(単一色相・明→暗)。ヒートマップ/カレンダー濃淡用
export const SEQ_BLUE = ['#f0f5ff', '#c0d4ff', '#6492ff', '#2b70ef', '#13318d'];

export const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// 支払方法の表示名・色(固定割り当て。系列の増減で塗り替えない)
export const PAYMENT_LABELS = { cash: '現金', card: 'カード', emoney: '電子マネー' };
export const PAYMENT_COLORS = { cash: PALETTE.blue, card: PALETTE.emerald, emoney: PALETTE.amber };

// 軸ラベル用の短縮円表記(¥は付けない): 12,000 → "1.2万"
export function yenShort(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return Math.abs(n) >= 10000 ? `${num(n / 10000, Math.abs(n) >= 100000 ? 0 : 1)}万` : n.toLocaleString();
}

// hour32 → "21時" / "26時(翌2時)"
export function hourLabel(h) {
  const n = Number(h);
  return n <= 23 ? `${n}時` : `${n}時(翌${n - 24}時)`;
}

// 営業時軸(hour32 の一覧)。business は B..B+23、calendar(または境界不明)は 0..23
export function hoursRange(dayMode, boundaryHour) {
  const b = dayMode === 'business' && Number.isInteger(boundaryHour) ? boundaryHour : 0;
  return Array.from({ length: 24 }, (_, i) => b + i);
}

export const baseGrid = { left: 56, right: 16, top: 28, bottom: 32 };

export function catAxis(data, extra = {}) {
  return {
    type: 'category',
    data,
    axisTick: { alignWithLabel: true },
    axisLine: { lineStyle: { color: PALETTE.grid } },
    ...extra,
    axisLabel: { color: PALETTE.axis, ...(extra.axisLabel || {}) },
  };
}

export function yenAxis(extra = {}) {
  return {
    type: 'value',
    axisLabel: { color: PALETTE.axis, formatter: yenShort },
    splitLine: { lineStyle: { color: PALETTE.grid } },
    ...extra,
  };
}

export function pctAxis(extra = {}) {
  return {
    type: 'value',
    axisLabel: { color: PALETTE.axis, formatter: (v) => `${v}%` },
    splitLine: { show: false },
    ...extra,
  };
}

export function legend(extra = {}) {
  return { top: 0, left: 0, itemWidth: 14, itemHeight: 8, textStyle: { color: PALETTE.axis, fontSize: 11 }, ...extra };
}

// 積み上げ棒の区切り(2px の surface ギャップ)
export const stackedBarItemStyle = { borderColor: PALETTE.surface, borderWidth: 2 };

// dow×hour32 ヒートマップの共通 option。
//   cells=[{dow,hour32,value}] / hours=hoursRange(...) / max=最大値 / fmt=値の表示関数
export function buildHeatmapOption({ cells, hours, max, fmt = (v) => `¥${yen(v)}` }) {
  const data = (cells || [])
    .map((c) => [hours.indexOf(Number(c.hour32)), Number(c.dow), Number(c.value) || 0])
    .filter((d) => d[0] >= 0);
  return {
    animation: false,
    grid: { left: 44, right: 16, top: 8, bottom: 60 },
    tooltip: {
      position: 'top',
      formatter: (p) => `${DOW_LABELS[p.value[1]]}曜 ${hourLabel(hours[p.value[0]])}<br/>${fmt(p.value[2])}`,
    },
    xAxis: catAxis(hours.map(hourLabel), { axisLabel: { interval: 1, fontSize: 10 }, axisTick: { show: false } }),
    yAxis: catAxis(DOW_LABELS, { axisTick: { show: false } }),
    visualMap: {
      min: 0,
      max: Math.max(1, Number(max) || 0),
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 90,
      inRange: { color: SEQ_BLUE },
      textStyle: { color: PALETTE.axis, fontSize: 10 },
      formatter: (v) => yenShort(v),
    },
    series: [{
      type: 'heatmap',
      data,
      itemStyle: { borderColor: PALETTE.surface, borderWidth: 2, borderRadius: 2 },
      emphasis: { itemStyle: { shadowBlur: 4, shadowColor: 'rgba(15,23,42,0.3)' } },
    }],
  };
}
