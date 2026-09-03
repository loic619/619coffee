"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { type AggMode, groupFor, groupOrder } from "@/lib/countryGroups";
import { chgTone } from "@/lib/formatters";

interface AnnualEntry {
  year: number;
  pop_18plus: number;
}

interface CountryEntry {
  name: string;
  iso3: string;
  location_id: number;
  annual: AnnualEntry[];
  latest_year: number | null;
  latest_pop: number | null;
}

interface AgeCohortData {
  source: string;
  last_updated: string;
  age_threshold: number;
  countries: Record<string, CountryEntry>;
}

interface DemandStocks {
  age_cohort_18plus?: AgeCohortData | null;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

// Distinct palette for individual-country lines (stable per ISO3 via hash).
const PALETTE = [
  "#0ea5e9", "#f59e0b", "#dc2626", "#16a34a", "#a855f7", "#ec4899", "#14b8a6",
  "#f97316", "#3b82f6", "#84cc16", "#ef4444", "#06b6d4", "#eab308", "#8b5cf6",
  "#10b981", "#fb7185", "#22d3ee", "#facc15", "#4ade80", "#c084fc",
];
function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Default individual-mode selection — the coffee-relevant heavyweights.
const DEFAULT_INDIVIDUAL = ["usa", "bra", "deu", "jpn", "ita", "fra", "idn", "vnm"];

const MODES: { id: AggMode; label: string }[] = [
  { id: "individual",  label: "Individual" },
  { id: "geo",         label: "Geographic hubs" },
  { id: "producing",   label: "Producing vs not" },
  { id: "development", label: "OECD vs developing" },
  { id: "consuming",   label: "Arabica vs Robusta" },
];

interface Series {
  key: string;
  label: string;
  color: string;
  byYear: Map<number, number>;
  latest: number;
}

function fmtPop(p: number | null | undefined): string {
  if (p == null) return "—";
  if (Math.abs(p) >= 1_000_000_000) return `${(p / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(p) >= 1_000_000)     return `${Math.round(p / 1_000_000)}M`;
  return String(p);
}

export default function AgeCohortPanel() {
  const [data, setData] = useState<AgeCohortData | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<AggMode>("geo");
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: DemandStocks) => setData(d.age_cohort_18plus ?? null))
      .catch(() => setError(true));
  }, []);

  // Build the series for the active mode (one per country, or summed per group).
  const { series, years } = useMemo(() => {
    if (!data) return { series: [] as Series[], years: [] as number[] };
    // Pair each country with a stable ISO3 (fall back to the record key for
    // older data that predates the iso3 field, so we never crash).
    const entries = Object.entries(data.countries).map(
      ([k, c]) => [(c.iso3 ?? k).toUpperCase(), c] as const,
    );
    const yearSet = new Set<number>();
    for (const [, c] of entries) for (const r of c.annual) yearSet.add(r.year);
    const yrs = Array.from(yearSet).sort((a, b) => a - b);
    const maxYear = yrs[yrs.length - 1];

    if (mode === "individual") {
      const ss: Series[] = entries.map(([iso3, c]) => {
        const byYear = new Map<number, number>();
        for (const r of c.annual) byYear.set(r.year, r.pop_18plus);
        return {
          key: iso3.toLowerCase(),
          label: c.name,
          color: hashColor(iso3),
          byYear,
          latest: byYear.get(maxYear) ?? c.latest_pop ?? 0,
        };
      });
      ss.sort((a, b) => b.latest - a.latest);
      return { series: ss, years: yrs };
    }

    // Aggregate: sum each country into its group for the active mode.
    const groups = new Map<string, Series>();
    for (const [iso3, c] of entries) {
      const g = groupFor(iso3, mode);
      if (!g) continue;
      let s = groups.get(g.key);
      if (!s) {
        s = { key: g.key, label: g.label, color: g.color, byYear: new Map(), latest: 0 };
        groups.set(g.key, s);
      }
      for (const r of c.annual) s.byYear.set(r.year, (s.byYear.get(r.year) ?? 0) + r.pop_18plus);
    }
    const order = groupOrder(mode);
    const ss = Array.from(groups.values())
      .map(s => ({ ...s, latest: s.byYear.get(maxYear) ?? 0 }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return { series: ss, years: yrs };
  }, [data, mode]);

  // Reset visible selection whenever the mode changes.
  useEffect(() => {
    if (series.length === 0) return;
    if (mode === "individual") {
      setVisible(new Set(DEFAULT_INDIVIDUAL.filter(k => series.some(s => s.key === k))));
    } else {
      setVisible(new Set(series.map(s => s.key)));   // all groups on
    }
  }, [mode, series]);

  const chartData = useMemo(() => years.map(y => {
    const row: Record<string, number | null> = { year: y };
    for (const s of series) row[s.key] = s.byYear.get(y) ?? null;
    return row;
  }), [years, series]);

  if (error || !data) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Coffee-drinking-age population data not yet available — requires UN WPP scraper run.
      </div>
    );
  }
  if (series.length === 0) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading age-cohort data…</div>;
  }

  const currentYear = new Date().getFullYear();
  const labelOf = (k: string) => series.find(s => s.key === k)?.label ?? k;
  const refFrom = 2025;
  const refTo   = 2050;

  function toggle(key: string) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Coffee-Drinking-Age Population (18+)</h2>
          <p className="text-xs text-slate-400">
            Structural demand pool — UN WPP medium-variant projection · {data.last_updated}
          </p>
        </div>
        <div className="text-[10px] font-mono text-slate-500">
          {Object.keys(data.countries).length} markets · {data.source.split("(")[0].trim()}
        </div>
      </div>

      {/* View-by mode selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1">View by</span>
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              mode === m.id
                ? "border-sky-400 bg-sky-400/15 text-sky-300"
                : "border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Series toggle chips */}
      <div className="flex flex-wrap gap-1.5">
        {series.map(s => {
          const on = visible.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className="px-2 py-0.5 rounded text-[10px] font-medium border transition-colors"
              style={{
                borderColor:     s.color,
                backgroundColor: on ? s.color + "22" : "transparent",
                color:           on ? s.color : "#94a3b8",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Trend chart */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          18+ population trajectory · history → projection
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval={4} />
              <YAxis
                tick={{ fontSize: 9, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => fmtPop(v)}
              />
              <ReferenceLine x={currentYear} stroke="#475569" strokeDasharray="4 4" label={{ value: "today", fontSize: 9, fill: "#94a3b8", position: "insideTopRight" }} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [v == null ? "—" : fmtPop(Number(v)), labelOf(String(name))]}
              />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => labelOf(v)} />
              {series.map(s => visible.has(s.key) && (
                <Line key={s.key} dataKey={s.key} type="monotone" stroke={s.color} strokeWidth={1.7} dot={false} connectNulls name={s.key} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ranking table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left  px-2 py-1.5">{mode === "individual" ? "Market" : "Group"}</th>
              <th className="text-right px-2 py-1.5">2025 cohort</th>
              <th className="text-right px-2 py-1.5">2050 cohort</th>
              <th className="text-right px-2 py-1.5">2025–2050 Δ</th>
              <th className="text-right px-2 py-1.5">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {[...series].sort((a, b) => b.latest - a.latest).map(s => {
              const v2025 = s.byYear.get(refFrom) ?? null;
              const v2050 = s.byYear.get(refTo) ?? null;
              const delta = (v2025 != null && v2050 != null) ? v2050 - v2025 : null;
              const pct   = (v2025 && v2050) ? ((v2050 - v2025) / v2025) * 100 : null;
              const pctCls = pct == null ? "text-slate-500" : chgTone(pct);
              return (
                <tr key={s.key} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="px-2 py-1 text-slate-200 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtPop(v2025)}</td>
                  <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtPop(v2050)}</td>
                  <td className={`px-2 py-1 text-right font-mono ${delta != null ? (chgTone(delta)) : "text-slate-500"}`}>
                    {delta != null ? `${delta >= 0 ? "+" : ""}${fmtPop(Math.abs(delta) * (delta < 0 ? -1 : 1))}` : "—"}
                  </td>
                  <td className={`px-2 py-1 text-right font-mono ${pctCls}`}>
                    {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Cohort = total population aged 18+ ≈ Σ(5yr brackets) with the 15–19 bracket weighted ×2/5 (ages 18–19,
        uniform-distribution assumption). Source: UN World Population Prospects, medium-variant projections.
        Hubs mirror the Brazil/Indonesia export groupings; arabica/robusta split is a consumption-style approximation.
      </div>
    </div>
  );
}
