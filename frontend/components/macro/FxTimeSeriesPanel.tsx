"use client";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

import { fmtDateLabel } from "@/lib/formatters";

interface HistoryPoint {
  date:  string;
  close: number;
}

interface FxPair {
  name:    string;
  type:    "export" | "import";
  weight:  number;
  history: HistoryPoint[];
}

interface FxHistory {
  scraped_at:   string;
  history_days: number;
  pairs:        Record<string, FxPair>;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

// Order mirrors the CCI exporter weights (USDA PSD MY2024 export shares),
// heaviest first. ETB/UGX/HNL joined the basket 2026-08-25.
const EXPORTER_ORDER = ["BRL=X", "VND=X", "COP=X", "ETB=X", "IDR=X",
                        "UGX=X", "HNL=X", "PEN=X"] as const;
const IMPORTER_ORDER = ["EURUSD=X", "JPY=X", "CHF=X", "CNY=X", "CAD=X", "KRW=X", "GBP=X"] as const;

const PAIR_COLOR: Record<string, string> = {
  "BRL=X":    "#10b981",  // exporters: green/teal palette
  "VND=X":    "#06b6d4",
  "COP=X":    "#0ea5e9",
  "IDR=X":    "#14b8a6",
  "PEN=X":    "#22d3ee",
  "ETB=X":    "#34d399",  // added with the basket widening
  "UGX=X":    "#2dd4bf",
  "HNL=X":    "#4ade80",
  "EURUSD=X": "#a855f7",  // importers: purple/orange palette
  "JPY=X":    "#ec4899",
  "CHF=X":    "#f43f5e",
  "CNY=X":    "#f97316",
  "CAD=X":    "#f59e0b",
  "KRW=X":    "#eab308",
  "GBP=X":    "#d946ef",
};

type Group = "exporters" | "importers";
type Window = "1M" | "3M" | "6M" | "1Y";

const WINDOW_DAYS: Record<Window, number> = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };

export default function FxTimeSeriesPanel() {
  const [data,   setData]   = useState<FxHistory | null>(null);
  const [error,  setError]  = useState(false);
  const [group,  setGroup]  = useState<Group>("exporters");
  const [window, setWindow] = useState<Window>("3M");

  useEffect(() => {
    fetch("/data/fx_history.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // Only render pairs the data file actually carries. The order arrays are the
  // CCI basket, and fx_history.json trails it: when ETB/UGX/HNL were added to
  // the basket the chart drew three legend cards reading "ETB=X —" (raw ticker,
  // because the name lookup falls back to the key, and no history to price)
  // until the next quant-currency-index run caught up. Filtering here means a
  // pair that is in the basket but not yet — or no longer — in the file simply
  // does not appear, instead of appearing broken.
  const tickers = useMemo(() => {
    const order = group === "exporters" ? EXPORTER_ORDER : IMPORTER_ORDER;
    if (!data) return [] as readonly string[];
    return order.filter(t => (data.pairs[t]?.history?.length ?? 0) > 0);
  }, [data, group]);

  const chartData = useMemo(() => {
    if (!data) return [];

    // Collect all dates from the active group, restricted to the window.
    const days = WINDOW_DAYS[window];
    const dateSet = new Set<string>();
    for (const t of tickers) {
      const hist = data.pairs[t]?.history;
      if (!hist) continue;
      for (const h of hist.slice(-days)) dateSet.add(h.date);
    }
    const dates = Array.from(dateSet).sort();

    // Rebase each series to 100 at the first date in the window so cross-pair
    // % moves are visually comparable on a single chart.
    const base: Record<string, number | null> = {};
    for (const t of tickers) {
      const hist = data.pairs[t]?.history.slice(-days);
      const first = hist?.find(h => h.close != null && h.close > 0)?.close ?? null;
      base[t] = first;
    }

    return dates.map(d => {
      const row: Record<string, number | string | null> = { date: d, label: fmtDateLabel(d) };
      for (const t of tickers) {
        const hist = data.pairs[t]?.history;
        const point = hist?.find(h => h.date === d);
        const b = base[t];
        row[t] = point?.close != null && b ? (point.close / b) * 100 : null;
      }
      return row;
    });
  }, [data, tickers, window]);

  const latestStats = useMemo(() => {
    if (!data) return [] as { ticker: string; name: string; pct: number | null }[];
    const days = WINDOW_DAYS[window];
    return tickers.map(t => {
      const pair = data.pairs[t];
      const hist = pair?.history.slice(-days);
      if (!hist || hist.length < 2) return { ticker: t, name: pair?.name ?? t, pct: null };
      const first = hist.find(h => h.close != null && h.close > 0)?.close;
      const last  = [...hist].reverse().find(h => h.close != null)?.close;
      if (!first || !last) return { ticker: t, name: pair?.name ?? t, pct: null };
      return { ticker: t, name: pair.name, pct: ((last - first) / first) * 100 };
    });
  }, [data, tickers, window]);

  if (error) {
    return (
      <div className="p-4 text-xs text-slate-500">
        FX history unavailable — fx_history.json failed to load.
        Will populate after the next quant-currency-index workflow run.
      </div>
    );
  }
  if (!data) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading FX history…</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">FX Pair Time-Series</h2>
          <p className="text-xs text-slate-400">
            Per-pair price action over time, rebased to 100 at the start of the window so cross-pair % moves are comparable.
            For exporters (BRL, VND, COP, IDR, PEN), the chart shows USD-per-local-currency — line going{" "}
            <span className="text-emerald-400">up</span> = exporter currency stronger = bullish coffee in USD terms.
            For importers (EUR, JPY, etc.), line going <span className="text-red-400">down</span> = importer currency weakening = bearish coffee for that market.
            Source: yfinance · {new Date(data.scraped_at).toISOString().slice(0,10)}
          </p>
        </div>
        <div className="flex gap-3">
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {(["exporters","importers"] as Group[]).map(g => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`px-3 py-1.5 transition ${group === g ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}
              >
                {g === "exporters" ? "Exporters" : "Importers"}
              </button>
            ))}
          </div>
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {(["1M","3M","6M","1Y"] as Window[]).map(w => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`px-2.5 py-1.5 transition ${window === w ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip — window % move per pair */}
      <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-7 gap-2 text-[10px]">
        {latestStats.map(s => {
          const cls = s.pct == null ? "text-slate-500"
                    : s.pct >= 0   ? "text-emerald-400"
                                   : "text-red-400";
          return (
            <div key={s.ticker} className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: PAIR_COLOR[s.ticker] }} />
                <span className="text-slate-300 truncate">{s.name}</span>
              </div>
              <div className={`text-sm font-bold font-mono ${cls}`}>
                {s.pct == null ? "—" : `${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(1)}%`}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          {group === "exporters" ? "Exporter currencies" : "Importer currencies"} — rebased to 100 at start of {window}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={20} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} domain={["auto","auto"]} />
              <Tooltip
                contentStyle={TT_STYLE}
                labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                formatter={(v) => typeof v === "number" ? v.toFixed(2) : "—"}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              <ReferenceLine y={100} stroke="#475569" strokeDasharray="3 3" />
              {tickers.map(t => (
                <Line
                  key={t}
                  type="monotone"
                  dataKey={t}
                  name={data.pairs[t]?.name ?? t}
                  stroke={PAIR_COLOR[t]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
