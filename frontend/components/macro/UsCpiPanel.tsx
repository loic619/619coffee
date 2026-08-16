"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface MonthlyEntry {
  period:  string;   // YYYY-MM
  index:   number;
  yoy_pct: number | null;
}

interface SeriesEntry {
  name:        string;
  series_id?:  string;
  source_url:  string;
  monthly:     MonthlyEntry[];
  components?: Record<string, SeriesEntry>;
}

interface UsCpi {
  source:       string;
  source_url?:  string;
  last_updated: string;
  series:       Record<string, SeriesEntry>;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

const TOP_ORDER = ["all_items", "core", "food", "energy"] as const;
const TOP_LABEL: Record<string, string> = {
  all_items: "Headline (all items)",
  core:      "Core (ex food & energy)",
  food:      "Food",
  energy:    "Energy",
};
const TOP_COLOR: Record<string, string> = {
  all_items: "#0ea5e9",
  core:      "#a855f7",
  food:      "#10b981",
  energy:    "#f59e0b",
};
// Categories that have a sub-component breakdown to drill into.
const DRILLABLE = new Set(["core", "food", "energy"]);
// Palette for sub-component lines in the drill-down view.
const PALETTE = [
  "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#a855f7",
  "#ec4899", "#14b8a6", "#eab308", "#8b5cf6",
];

type ChartLine = { key: string; label: string; color: string; monthly: MonthlyEntry[]; bold?: boolean };

function fmtPeriodLabel(p: string): string {
  const [y, m] = p.split("-");
  return `${m}/${y.slice(2)}`;
}

function latestYoY(monthly: MonthlyEntry[]): { yoy: number; period: string } | null {
  for (let i = monthly.length - 1; i >= 0; i--) {
    if (monthly[i].yoy_pct != null) return { yoy: monthly[i].yoy_pct as number, period: monthly[i].period };
  }
  return null;
}

function buildRows(lines: ChartLine[]): Record<string, number | string | null>[] {
  const all = new Set<string>();
  for (const l of lines) for (const m of l.monthly) all.add(m.period);
  return Array.from(all).sort().map(p => {
    const row: Record<string, number | string | null> = { period: p, label: fmtPeriodLabel(p) };
    for (const l of lines) row[l.key] = l.monthly.find(m => m.period === p)?.yoy_pct ?? null;
    return row;
  });
}

export default function UsCpiPanel() {
  const [data, setData] = useState<UsCpi | null>(null);
  const [error, setError] = useState(false);
  // null = overview; otherwise the drilled category key (food/energy/core).
  const [drill, setDrill] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/us_cpi.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // The set of lines to plot + the KPI tiles to show, for the current mode.
  const { lines, tiles, title, subtitle } = useMemo(() => {
    if (!data) return { lines: [] as ChartLine[], tiles: [] as ChartLine[], title: "", subtitle: "" };

    if (drill && data.series[drill]?.components) {
      const cat = data.series[drill];
      const total: ChartLine = {
        key: "__total__", label: `${cat.name} (total)`, color: TOP_COLOR[drill] ?? "#94a3b8",
        monthly: cat.monthly, bold: true,
      };
      const comps: ChartLine[] = Object.entries(cat.components ?? {}).map(([k, s], i) => ({
        key: k, label: s.name, color: PALETTE[i % PALETTE.length], monthly: s.monthly,
      }));
      const all = [total, ...comps];
      return {
        lines: all,
        tiles: all,
        title: `${cat.name} — sub-components`,
        subtitle: `Breakdown of ${cat.name.toLowerCase()} (BLS CPI-U). The other top-level lines are hidden — click "Overview" to return.`,
      };
    }

    // Overview
    const overview: ChartLine[] = TOP_ORDER.flatMap(k => {
      const s = data.series[k];
      return s ? [{ key: k, label: TOP_LABEL[k], color: TOP_COLOR[k], monthly: s.monthly, bold: k === "all_items" }] : [];
    });
    return {
      lines: overview,
      tiles: overview,
      title: "US Inflation (CPI-U)",
      subtitle: "Headline US consumer prices — the macro backdrop for the Fed-path / USD / real-rate regime. Click Food, Energy or Core to drill into its sub-components.",
    };
  }, [data, drill]);

  const chartData = useMemo(() => buildRows(lines), [lines]);

  if (error || !data) {
    return (
      <div className="p-4 text-xs text-slate-500">
        US CPI data not yet available — requires the BLS CPI-U scraper run.
      </div>
    );
  }
  if (chartData.length === 0) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading US CPI data…</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-3">
            {drill && (
              <button
                onClick={() => setDrill(null)}
                className="text-[11px] px-2 py-1 rounded bg-slate-800 border border-slate-700 text-sky-400 hover:text-sky-300 hover:border-slate-600"
              >
                ← Overview
              </button>
            )}
            <h2 className="text-lg font-bold text-white">{title}</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            {subtitle}{" "}
            <a href={data.source_url ?? "https://www.bls.gov/news.release/cpi.t01.htm"}
               target="_blank" rel="noreferrer"
               className="underline hover:text-slate-200">{data.source}</a>{" "}
            · {data.last_updated}
          </p>
        </div>
      </div>

      {/* KPI strip — latest YoY per series (clickable in overview to drill) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {tiles.map(t => {
          const l = latestYoY(t.monthly);
          const isOverview = !drill;
          const canDrill = isOverview && DRILLABLE.has(t.key)
            && !!data.series[t.key]?.components
            && Object.keys(data.series[t.key].components ?? {}).length > 0;
          const cls = !l ? "text-slate-400" : l.yoy >= 0 ? "text-red-400" : "text-emerald-400";
          return (
            <button
              key={t.key}
              type="button"
              disabled={!canDrill}
              onClick={() => canDrill && setDrill(t.key)}
              className={`text-left bg-slate-800 border rounded-lg p-3 transition-colors ${
                canDrill
                  ? "border-slate-700 hover:border-sky-500 hover:bg-slate-800/70 cursor-pointer"
                  : "border-slate-700 cursor-default"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: t.color }} />
                <span className="text-[10px] text-slate-300 leading-tight">{t.label}</span>
                {canDrill && <span className="ml-auto text-[9px] text-sky-500">drill ⤢</span>}
              </div>
              <div className={`text-xl font-bold font-mono ${cls}`}>
                {l ? `${l.yoy >= 0 ? "+" : ""}${l.yoy.toFixed(1)}%` : "—"}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">{l ? `YoY · ${l.period}` : "no data"}</div>
            </button>
          );
        })}
      </div>

      {/* YoY trend chart */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          12-month change (YoY %)
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 12) - 1)} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
              {!drill && (
                <ReferenceLine y={2} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} label={{ value: "2% target", position: "insideTopRight", fontSize: 8, fill: "#64748b" }} />
              )}
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [
                  v == null ? "—" : `${Number(v).toFixed(1)}%`,
                  lines.find(l => l.key === String(name))?.label ?? String(name),
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => lines.find(l => l.key === v)?.label ?? v} />
              {lines.map(l => (
                <Line
                  key={l.key}
                  dataKey={l.key}
                  type="monotone"
                  stroke={l.color}
                  strokeWidth={l.bold ? 2.2 : 1.4}
                  dot={false}
                  connectNulls
                  name={l.key}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-slate-500 mt-2 italic">
          {drill
            ? "Sub-component 12-month change (NSA, BLS CPI-U). The bold line is the category total."
            : "NSA 12-month change, the basis BLS quotes in the headline release (Table 1). Core strips out food & energy; the dashed line marks the Fed's 2% goal. Tap a category tile to drill in."}
        </div>
      </div>
    </div>
  );
}
