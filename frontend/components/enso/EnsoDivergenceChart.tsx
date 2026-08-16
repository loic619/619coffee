"use client";
/**
 * Niño 3.4 SST anomaly (weekly) + SOI (monthly) divergence chart.
 *
 * The two indices capture opposite sides of the ENSO loop:
 *   • Niño 3.4 = ocean — bars, red above 0, blue below
 *   • SOI      = atmosphere — overlaid dotted line on a second axis,
 *                with the SIGN INVERTED so that "El Niño" reads as
 *                an UP move on both series (NOAA SOI flips negative
 *                when the atmosphere couples to a warm Pacific).
 *
 * When the bars (ocean) climb above 0 and the line (atmosphere) also
 * climbs above 0 in the same window, the ocean and atmosphere have
 * COUPLED — an El Niño is locked in. The chart's value is showing
 * the coupling visually, before it lands in the slower ONI value
 * the rest of the page already displays.
 *
 * Data: /data/enso_indices.json (NOAA CPC; weekly Tuesday refresh).
 * Falls back gracefully when the file is missing — the rest of the
 * ENSO tab renders unchanged.
 */
import { useEffect, useState } from "react";
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  ENSO_DEFAULT_RANGE, rangeMonths, type EnsoTimeRange,
} from "@/lib/ensoTimeRange";

interface Nino34Weekly { week_ending: string; sst_anomaly: number; }
interface SoiMonthly   { month: string;       soi: number; }

interface IndicesPayload {
  scraped_at: string;
  nino34: {
    source: string;
    latest: { week_ending: string | null; sst_anomaly: number | null; phase: string };
    weekly: Nino34Weekly[];
  };
  soi: {
    source: string;
    latest: { month: string | null; soi: number | null };
    monthly: SoiMonthly[];
  };
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function monthAbbr(iso: string): string {
  // "2025-12-24" or "2025-12" → "Dec'25"
  const [yr, mo] = iso.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[parseInt(mo) - 1]}'${yr.slice(2)}`;
}

interface Props {
  /** Time window for the chart slice. Defaults to 2Y if the parent
      hasn't wired the shared selector yet. */
  range?: EnsoTimeRange;
}

export default function EnsoDivergenceChart({ range = ENSO_DEFAULT_RANGE }: Props) {
  const [data, setData] = useState<IndicesPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/data/enso_indices.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setMissing(true));
  }, []);

  if (missing) return null;     // Degrade silently — other panels still render.
  if (!data) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 text-xs text-slate-500 animate-pulse">
        Loading ocean-atmosphere coupling chart…
      </div>
    );
  }

  // Map SOI monthly → a lookup by "YYYY-MM" so each weekly bar can
  // borrow the SOI value from its containing month. The atmosphere
  // moves slowly enough that step-overlaying the monthly line over
  // the weekly bars reads cleanly. SIGN INVERTED so an El Niño
  // (ocean +, atmosphere typically NOAA-SOI -) shows both lines
  // moving the same direction.
  const soiByMonth: Record<string, number> = {};
  for (const r of data.soi.monthly) soiByMonth[r.month] = -r.soi;   // invert sign

  // Window the weekly Niño 3.4 series. ~4.345 weeks per month; null
  // means "no slice" so the chart shows the full 1981→now history.
  const months = rangeMonths(range);
  const weeksToPlot = months == null ? data.nino34.weekly.length : Math.ceil(months * 4.345);
  const recent = data.nino34.weekly.slice(-weeksToPlot);
  const chartData = recent.map((r) => {
    const yyyymm = r.week_ending.slice(0, 7);
    const soiInv = soiByMonth[yyyymm];
    return {
      week:    r.week_ending,
      label:   monthAbbr(r.week_ending),
      sst:     r.sst_anomaly,
      soiInv:  soiInv ?? null,
    };
  });

  const latestN34 = data.nino34.latest;
  const latestSoi = data.soi.latest;
  const phaseColor = {
    "el-nino": "#ef4444",
    "la-nina": "#3b82f6",
    "neutral": "#94a3b8",
    "unknown": "#94a3b8",
  }[latestN34.phase] ?? "#94a3b8";

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Ocean–Atmosphere Coupling · Niño 3.4 SST + SOI
        </div>
        <div className="text-[8px] text-slate-600">
          NOAA CPC · weekly + monthly · refreshed {data.scraped_at.slice(0, 10)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest Niño 3.4 (week)</div>
          <div className="text-white font-bold flex items-baseline gap-2">
            <span style={{ color: phaseColor }}>
              {latestN34.sst_anomaly != null
                ? `${latestN34.sst_anomaly >= 0 ? "+" : ""}${latestN34.sst_anomaly.toFixed(2)} °C`
                : "—"}
            </span>
            <span className="text-[9px] uppercase tracking-wider" style={{ color: phaseColor }}>
              {latestN34.phase}
            </span>
          </div>
          <div className="text-[9px] text-slate-600">
            {latestN34.week_ending ?? ""}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest SOI (month)</div>
          <div className="text-white font-bold">
            {latestSoi.soi != null
              ? `${latestSoi.soi >= 0 ? "+" : ""}${latestSoi.soi.toFixed(2)}`
              : "—"}
          </div>
          <div className="text-[9px] text-slate-600">
            {latestSoi.month ?? ""} · NOAA-standardized
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Reading</div>
          <div className="text-white text-[11px] leading-tight">
            {latestN34.phase === "el-nino" && (latestSoi.soi ?? 0) < 0
              ? "Ocean + atmosphere COUPLED warm — El Niño locked in."
              : latestN34.phase === "la-nina" && (latestSoi.soi ?? 0) > 0
              ? "Ocean + atmosphere COUPLED cold — La Niña locked in."
              : "Ocean and atmosphere out of phase — regime in transition."}
          </div>
        </div>
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 38, left: -8, bottom: 0 }}>
            <XAxis
              dataKey="label" tick={{ fontSize: 7, fill: "#64748b" }}
              axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(weeksToPlot / 8))}
            />
            <YAxis
              yAxisId="sst" orientation="left"
              tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}°`}
              domain={[-3, 3]}
            />
            <YAxis
              yAxisId="soi" orientation="right" width={32}
              tick={{ fontSize: 7, fill: "#f59e0b" }} axisLine={false} tickLine={false}
              tickFormatter={(v) => v.toFixed(1)}
              domain={[-3, 3]}
            />
            <ReferenceLine yAxisId="sst" y={0}    stroke="#475569" strokeDasharray="3 3" />
            <ReferenceLine yAxisId="sst" y={ 0.5} stroke="#7f1d1d" strokeDasharray="1 4" />
            <ReferenceLine yAxisId="sst" y={-0.5} stroke="#1e3a8a" strokeDasharray="1 4" />
            <Tooltip
              contentStyle={TT_STYLE}
              labelFormatter={(_label, payload) => {
                const p = (payload?.[0]?.payload ?? null) as { week?: string } | null;
                return p?.week ?? "";
              }}
              formatter={(v: unknown, name?: string | number) => {
                if (String(name) === "sst")
                  return [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)} °C`, "Niño 3.4 anomaly"];
                if (String(name) === "soiInv")
                  return [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}`, "SOI (sign-inverted)"];
                return [v as string, name as string];
              }}
            />
            <Bar yAxisId="sst" dataKey="sst" name="sst" radius={[2,2,0,0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.sst >= 0 ? "#ef4444" : "#3b82f6"} fillOpacity={0.75} />
              ))}
            </Bar>
            <Line
              yAxisId="soi" dataKey="soiInv" name="soiInv"
              type="stepAfter" stroke="#f59e0b" strokeWidth={1.5}
              strokeDasharray="4 3" dot={false} connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[9px] text-slate-600 leading-snug">
        Bars = weekly Niño 3.4 SST anomaly (red &gt; +0.5 °C → El Niño, blue &lt; −0.5 °C → La Niña).
        Dashed line = monthly SOI, sign-inverted so a coupled warming event reads as both bars and line
        climbing together. NOAA CPC; updated weekly.
      </div>
    </div>
  );
}
