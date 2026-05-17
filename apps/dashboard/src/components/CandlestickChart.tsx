"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";

type ChartCandle = {
  time: string | number;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string;
};

type SignalMarker = {
  time: string | number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  status: string;
  label: string;
};

type CandlestickChartProps = {
  candles: ChartCandle[];
  height?: number;
  title?: string;
  signalMarker?: SignalMarker;
};

export function CandlestickChart({
  candles,
  height = 360,
  title,
  signalMarker
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const data = useMemo(() => normalizeCandles(candles), [candles]);
  const marker = useMemo(() => normalizeMarker(signalMarker), [signalMarker]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || data.length === 0) {
      return;
    }

    const chart = createChart(container, {
      height,
      width: container.clientWidth,
      autoSize: false,
      layout: {
        background: {
          type: ColorType.Solid,
          color: "#161b22"
        },
        textColor: "#8b949e"
      },
      grid: {
        vertLines: {
          color: "rgba(48, 56, 70, 0.55)"
        },
        horzLines: {
          color: "rgba(48, 56, 70, 0.55)"
        }
      },
      rightPriceScale: {
        borderColor: "#303846"
      },
      timeScale: {
        borderColor: "#303846",
        timeVisible: true,
        secondsVisible: false
      }
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#3fb950",
      downColor: "#f85149",
      borderUpColor: "#3fb950",
      borderDownColor: "#f85149",
      wickUpColor: "#7ee787",
      wickDownColor: "#ff7b72"
    });

    series.setData(data);

    if (marker) {
      createSeriesMarkers(series, [
        {
          time: marker.time,
          position: marker.direction === "BEARISH" ? "aboveBar" : "belowBar",
          shape: marker.direction === "BEARISH" ? "arrowDown" : "arrowUp",
          color: markerColor(marker.direction),
          text: `${marker.status} · ${marker.label}`,
          size: 1.2
        }
      ]);
    }

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;

      if (width && chartRef.current) {
        chartRef.current.applyOptions({
          width
        });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, height, marker]);

  return (
    <div className="chart-card">
      {title ? <h2>{title}</h2> : null}
      {data.length === 0 ? (
        <div className="empty-state">Keine Candles für den Chart verfügbar.</div>
      ) : (
        <div ref={containerRef} style={{ height }} />
      )}
    </div>
  );
}

function normalizeCandles(candles: ChartCandle[]): CandlestickData<Time>[] {
  const byTime = new Map<number, CandlestickData<Time>>();

  for (const candle of candles) {
    const time = normalizeTime(candle.time);
    const open = toFiniteNumber(candle.open);
    const high = toFiniteNumber(candle.high);
    const low = toFiniteNumber(candle.low);
    const close = toFiniteNumber(candle.close);

    if (time === null || open === null || high === null || low === null || close === null) {
      continue;
    }

    if (high < low) {
      continue;
    }

    byTime.set(time, {
      time: time as UTCTimestamp,
      open,
      high,
      low,
      close
    });
  }

  return [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, candle]) => candle);
}

function normalizeMarker(marker: SignalMarker | undefined) {
  if (!marker) {
    return null;
  }

  const time = normalizeTime(marker.time);

  if (time === null) {
    return null;
  }

  return {
    ...marker,
    time: time as UTCTimestamp
  };
}

function normalizeTime(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
}

function toFiniteNumber(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function markerColor(direction: SignalMarker["direction"]) {
  if (direction === "BULLISH") {
    return "#7ee787";
  }

  if (direction === "BEARISH") {
    return "#ff7b72";
  }

  if (direction === "MIXED") {
    return "#d2a8ff";
  }

  return "#f2cc60";
}
