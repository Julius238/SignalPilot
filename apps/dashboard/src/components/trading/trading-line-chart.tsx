"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";

// Strukturell an components/CandlestickChart.tsx angelehnt: gleiches Theme,
// gleiches ResizeObserver-/Cleanup-Muster. Rechnet keine Fachkennzahl selbst —
// zeigt nur, was die API bereits als Decimalstring/ISO-Zeit liefert.

type SeriesPoint = { time: string | number; value: number | string };

function normalizePoints(points: SeriesPoint[]): { time: UTCTimestamp; value: number }[] {
  const byTime = new Map<number, number>();

  for (const point of points) {
    const time = normalizeTime(point.time);
    const value = typeof point.value === "number" ? point.value : Number(point.value);

    if (time === null || !Number.isFinite(value)) {
      continue;
    }

    byTime.set(time, value);
  }

  return [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

function normalizeTime(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

const CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: "#161b22" },
    textColor: "#8b949e"
  },
  grid: {
    vertLines: { color: "rgba(48, 56, 70, 0.55)" },
    horzLines: { color: "rgba(48, 56, 70, 0.55)" }
  },
  rightPriceScale: { borderColor: "#303846" },
  timeScale: { borderColor: "#303846", timeVisible: true, secondsVisible: false }
};

export function TradingLineChart({
  points,
  height = 260,
  title,
  emptyLabel = "Keine Daten für diesen Chart verfügbar.",
  lineColor = "#65d7c3"
}: {
  points: SeriesPoint[];
  height?: number;
  title?: string;
  emptyLabel?: string;
  lineColor?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const data = useMemo(() => normalizePoints(points), [points]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || data.length === 0) {
      return;
    }

    const chart = createChart(container, {
      height,
      width: container.clientWidth,
      autoSize: false,
      ...CHART_THEME
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: `${lineColor}33`,
      bottomColor: "rgba(22, 27, 34, 0)",
      lineWidth: 2
    });
    series.setData(data as { time: Time; value: number }[]);
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && chartRef.current) {
        chartRef.current.applyOptions({ width });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, height, lineColor]);

  return (
    <div className="chart-card">
      {title ? <h2>{title}</h2> : null}
      {data.length === 0 ? (
        <div className="empty-state">{emptyLabel}</div>
      ) : (
        <div ref={containerRef} style={{ height }} />
      )}
    </div>
  );
}

export function TradingBarChart({
  points,
  height = 220,
  title,
  emptyLabel = "Keine Trades für diesen Chart verfügbar.",
  positiveColor = "#3fb950",
  negativeColor = "#f85149"
}: {
  points: SeriesPoint[];
  height?: number;
  title?: string;
  emptyLabel?: string;
  positiveColor?: string;
  negativeColor?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const data = useMemo(() => normalizePoints(points), [points]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || data.length === 0) {
      return;
    }

    const chart = createChart(container, {
      height,
      width: container.clientWidth,
      autoSize: false,
      ...CHART_THEME
    });
    chartRef.current = chart;

    const series = chart.addSeries(HistogramSeries, { base: 0 });
    series.setData(
      data.map((point) => ({
        time: point.time,
        value: point.value,
        color: point.value >= 0 ? positiveColor : negativeColor
      })) as { time: Time; value: number; color: string }[]
    );
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && chartRef.current) {
        chartRef.current.applyOptions({ width });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, height, positiveColor, negativeColor]);

  return (
    <div className="chart-card">
      {title ? <h2>{title}</h2> : null}
      {data.length === 0 ? (
        <div className="empty-state">{emptyLabel}</div>
      ) : (
        <div ref={containerRef} style={{ height }} />
      )}
    </div>
  );
}
