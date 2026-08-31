import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, HeatmapChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// echarts はツリーシェイク前提で必要なチャート/コンポーネントのみ登録する(バンドル削減)。
echarts.use([CanvasRenderer, BarChart, LineChart, PieChart, HeatmapChart, ScatterChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent, DataZoomComponent, VisualMapComponent,
  MarkLineComponent, MarkAreaComponent]);

// 薄い ECharts ラッパ。option 変更で setOption(notMerge)、ResizeObserver で追従、unmount で dispose。
// onReady(chart) で生インスタンスを受け取れる(イベント登録など)。
export default function EChart({ option, height = 280, onReady, className, style }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const chart = echarts.init(el, null, { renderer: 'canvas' });
    chartRef.current = chart;
    onReadyRef.current?.(chart);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option || {}, { notMerge: true });
  }, [option]);

  return <div ref={elRef} className={className} style={{ width: '100%', height, ...style }} />;
}
