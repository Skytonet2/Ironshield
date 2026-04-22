"use client";
// PriceChart — TradingView lightweight-charts wrapper.
//
// One candlestick series on top, one histogram (volume) pinned to the
// lower 25% of the pane. Colors come from the legacy theme object so
// the chart retints with preset changes. Data fetched from
// geckoTerminal on mount + whenever {pool, timeframe} change; the
// last candle gets live-updated every 5s so the wick extends as the
// current period progresses.
//
// This component owns its DOM container but not its parent — wrap it
// in a flex/grid cell with a defined height. `height` prop is a fallback
// when the parent hasn't given it one.

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/contexts";
import { fetchOhlcv } from "@/lib/api/geckoTerminal";

const LIVE_REFRESH_MS = 5_000;

export default function PriceChart({ chain, pool, timeframe = "1h", height = 360 }) {
  const t = useTheme();
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  // Mount the chart once. Subsequent prop changes touch series data,
  // not the chart itself — resetting on every change would flicker.
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    (async () => {
      const { createChart } = await import("lightweight-charts");
      if (disposed) return;
      const chart = createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { color: "transparent" },
          textColor: t.textMuted,
          fontFamily: "'Inter', 'Outfit', sans-serif",
        },
        grid: {
          vertLines: { color: t.border, style: 1 },
          horzLines: { color: t.border, style: 1 },
        },
        rightPriceScale: { borderColor: t.border },
        timeScale: { borderColor: t.border, timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 }, // magnet mode
      });
      chartRef.current = chart;
      // Candles on the main scale; volume pinned to its own scale with
      // 75% bottom margin so it hugs the lower quarter of the pane.
      candleRef.current = chart.addCandlestickSeries({
        upColor:     t.accent,
        borderUpColor: t.accent,
        wickUpColor:  t.accent,
        downColor:    t.red,
        borderDownColor: t.red,
        wickDownColor:   t.red,
      });
      volumeRef.current = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        color: t.textDim,
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.75, bottom: 0 },
      });
    })();
    return () => {
      disposed = true;
      chartRef.current?.remove();
      chartRef.current = null;
    };
    // t changes on preset switch — we want a fresh chart so colors flip.
  }, [t]);

  // Load + poll data. AbortController ties each fetch to the effect's
  // lifetime so stale responses can't overwrite a freshly-selected pool.
  useEffect(() => {
    if (!pool || !chain) return;
    const ctl = new AbortController();
    let intervalId;
    let disposed = false;

    async function loadInitial() {
      setErr(null);
      setLoading(true);
      try {
        const rows = await fetchOhlcv({ chain, pool, timeframe, signal: ctl.signal });
        if (disposed) return;
        candleRef.current?.setData(rows);
        volumeRef.current?.setData(rows.map((r) => ({
          time: r.time,
          value: r.volume,
          color: r.close >= r.open ? `${t.accent}66` : `${t.red}66`,
        })));
        chartRef.current?.timeScale().fitContent();
      } catch (e) {
        if (!disposed && e.name !== "AbortError") setErr(e.message || String(e));
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    async function refreshLast() {
      try {
        // Refetch a small tail and merge — cheaper than a full reload,
        // and lightweight-charts dedupes by time automatically via update().
        const rows = await fetchOhlcv({ chain, pool, timeframe, limit: 3, signal: ctl.signal });
        if (disposed) return;
        for (const r of rows) {
          candleRef.current?.update(r);
          volumeRef.current?.update({
            time: r.time,
            value: r.volume,
            color: r.close >= r.open ? `${t.accent}66` : `${t.red}66`,
          });
        }
      } catch { /* transient; the next tick tries again */ }
    }

    loadInitial();
    intervalId = setInterval(refreshLast, LIVE_REFRESH_MS);
    return () => {
      disposed = true;
      clearInterval(intervalId);
      ctl.abort();
    };
  }, [chain, pool, timeframe, t]);

  return (
    <div style={{ position: "relative", width: "100%", minHeight: height }}>
      <div ref={containerRef} style={{ width: "100%", height }} />
      {loading && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: t.textDim, fontSize: 12,
          pointerEvents: "none",
        }}>
          Loading chart…
        </div>
      )}
      {err && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: t.red, fontSize: 12, padding: 20, textAlign: "center",
        }}>
          {err}
        </div>
      )}
    </div>
  );
}
