"use client";
import { useState, useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { MONTH_ABBR } from "@/lib/formatters";

interface FertMonth {
  month: string;
  urea_kt: number;
  kcl_kt: number;
  npk_kt: number;
  dap_kt: number;
  total_kt: number;
}

interface FertContext {
  source: string;
  note: string;
  key_suppliers: Record<string, string>;
  price_sensitivity: string;
  monthly?: FertMonth[];
}

interface Props { context: FertContext }

const VN_TYPES = ["urea_kt", "kcl_kt", "npk_kt", "dap_kt"] as const;
type VnType = typeof VN_TYPES[number];

const VN_COLORS: Record<VnType, string> = {
  urea_kt: "#3b82f6",
  kcl_kt:  "#8b5cf6",
  npk_kt:  "#10b981",
  dap_kt:  "#f59e0b",
};
const VN_LABELS: Record<VnType, string> = {
  urea_kt: "Urea",
  kcl_kt:  "KCl",
  npk_kt:  "NPK",
  dap_kt:  "DAP",
};

const SUPPLIER_COLORS: Record<string, string> = {
  urea:   "#3b82f6",
  npk:    "#10b981",
  potash: "#f59e0b",
};

function VnStackedTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const byYear: Record<string, Record<string, number>> = {};
  for (const entry of payload) {
    if (!entry.value || entry.value <= 0) continue;
    const parts = entry.dataKey.split("_");
    const yr = parts[0];
    if (!/^\d{4}$/.test(yr)) continue;
    const type = parts.slice(1).join("_");
    if (!byYear[yr]) byYear[yr] = {};
    byYear[yr][type] = entry.value;
  }
  if (!Object.keys(byYear).length) return null;
  return (
    <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:6, padding:"8px 10px", fontSize:10 }}>
      <div style={{ color:"#94a3b8", marginBottom:6, fontWeight:"bold" }}>{label}</div>
      {Object.entries(byYear).sort().map(([yr, types]) => {
        const total = Object.values(types).reduce((s,v) => s+v, 0);
        return (
          <div key={yr} style={{ marginBottom:4 }}>
            <div style={{ color:"#e2e8f0", fontWeight:"bold", marginBottom:2 }}>{yr}: {total.toFixed(0)} kt</div>
            {VN_TYPES.filter(t => (types[t] ?? 0) > 0).map(t => (
              <div key={t} style={{ color:VN_COLORS[t], paddingLeft:8 }}>
                {VN_LABELS[t]}: {(types[t] ?? 0).toFixed(0)} kt
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function VietnamFertilizerContext({ context }: Props) {
  // Memoised so the `?? []` fallback doesn't hand a fresh array to the memos
  // below on every render.
  const monthly = useMemo(() => context.monthly ?? [], [context.monthly]);
  const [view, setView] = useState<"monthly" | "cumulative">("monthly");

  const { byKey, sortedYears, lastMonthIdx } = useMemo(() => {
    const byKey: Record<string, FertMonth> = {};
    const years = new Set<string>();
    const lastMonthIdx: Record<string, number> = {};
    for (const m of monthly) {
      byKey[m.month] = m;
      const [yr, mo] = m.month.split("-");
      years.add(yr);
      const moIdx = parseInt(mo) - 1;
      if (!(yr in lastMonthIdx) || moIdx > lastMonthIdx[yr]) lastMonthIdx[yr] = moIdx;
    }
    return { byKey, sortedYears: Array.from(years).sort(), lastMonthIdx };
  }, [monthly]);

  const chartData = useMemo(() => {
    if (view === "monthly") {
      return MONTH_ABBR.map((label, i) => {
        const row: Record<string, string | number | null> = { month: label };
        const yearTotals: number[] = [];
        for (const yr of sortedYears) {
          const m = byKey[`${yr}-${String(i + 1).padStart(2, "0")}`];
          if (m) {
            for (const t of VN_TYPES) row[`${yr}_${t}`] = m[t] || null;
            yearTotals.push(m.total_kt);
          } else {
            for (const t of VN_TYPES) row[`${yr}_${t}`] = null;
          }
        }
        const vals = yearTotals.filter(v => v > 0);
        row.min_range = vals.length > 1 ? Math.min(...vals) : null;
        row.max_range = vals.length > 1 ? Math.max(...vals) : null;
        return row;
      }).filter(row => sortedYears.some(yr => (row as Record<string, unknown>)[`${yr}_urea_kt`] != null));
    } else {
      const cum: Record<string, Record<VnType, number>> = {};
      for (const yr of sortedYears) cum[yr] = { urea_kt:0, kcl_kt:0, npk_kt:0, dap_kt:0 };
      return MONTH_ABBR.map((label, i) => {
        const row: Record<string, string | number | null> = { month: label };
        for (const yr of sortedYears) {
          const m = byKey[`${yr}-${String(i + 1).padStart(2, "0")}`];
          if (m) { for (const t of VN_TYPES) cum[yr][t] += m[t]; }
          if (i <= (lastMonthIdx[yr] ?? -1)) {
            for (const t of VN_TYPES) row[`${yr}_${t}`] = Math.round(cum[yr][t]) || null;
          } else {
            for (const t of VN_TYPES) row[`${yr}_${t}`] = null;
          }
        }
        return row;
      });
    }
  }, [view, byKey, sortedYears, lastMonthIdx]);

  const last = monthly[monthly.length - 1];
  const avg12 = monthly.slice(-13, -1);
  const avgTotal = avg12.length
    ? Math.round(avg12.reduce((s, r) => s + r.total_kt, 0) / avg12.length)
    : null;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Vietnam Fertilizer Imports</div>
        <div className="text-[8px] text-slate-600">{context.source}</div>
      </div>

      {/* KPI row */}
      {last && (
        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
          {VN_TYPES.map(t => (
            <div key={t}>
              <div className="text-[9px] mb-0.5 font-bold uppercase" style={{ color: VN_COLORS[t] }}>{VN_LABELS[t]}</div>
              <div className="text-white font-bold">{last[t]}</div>
              <div className="text-[9px] text-slate-600">kt</div>
            </div>
          ))}
        </div>
      )}
      {avgTotal && (
        <div className="text-[9px] text-slate-500">
          12-mo avg total: <span className="text-slate-300 font-mono font-bold">{avgTotal} kt/month</span>
        </div>
      )}

      {/* Type legend + toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap gap-2">
          {VN_TYPES.map(t => (
            <span key={t} className="flex items-center gap-1 text-[7px] text-slate-500">
              <span className="w-2 h-2 rounded-sm" style={{ background: VN_COLORS[t] }} />{VN_LABELS[t]}
            </span>
          ))}
        </div>
        <div className="flex gap-0.5">
          {(["monthly", "cumulative"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2 py-0.5 rounded text-[8px] font-bold transition-colors ${
                view === v ? "bg-slate-600 text-slate-100" : "text-slate-500 hover:text-slate-400"
              }`}>
              {v === "monthly" ? "Monthly" : "Cumul."}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped stacked bar chart */}
      {chartData.length > 0 && (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, left: -20, bottom: 0 }} barCategoryGap="20%" barGap={2}>
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
              <Tooltip content={<VnStackedTooltip />} />
              {sortedYears.flatMap((yr, i) => {
                const opacity = Math.max(0.4, 1 - (sortedYears.length - 1 - i) * 0.25);
                return VN_TYPES.map(t => (
                  <Bar key={`${yr}_${t}`} dataKey={`${yr}_${t}`} stackId={yr}
                    fill={VN_COLORS[t]} opacity={opacity} isAnimationActive={false} />
                ));
              })}
              {view === "monthly" && <>
                <Line dataKey="min_range" stroke="#334155" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
                <Line dataKey="max_range" stroke="#475569" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
              </>}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Year legend */}
      <div className="flex flex-wrap gap-3 text-[7px] text-slate-500">
        {sortedYears.map((yr, i) => {
          const opacity = Math.max(0.4, 1 - (sortedYears.length - 1 - i) * 0.25);
          return (
            <span key={yr} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-slate-400" style={{ opacity }} />{yr}
            </span>
          );
        })}
        {view === "monthly" && (
          <span className="flex items-center gap-1 text-slate-600">
            <span className="w-3 h-px border-t border-dashed border-slate-500 inline-block" />yr range
          </span>
        )}
      </div>

      {/* Supplier breakdown */}
      <div className="border-t border-slate-700 pt-3">
        <div className="text-[9px] text-slate-500 mb-2">Key suppliers by input</div>
        <div className="space-y-1.5">
          {Object.entries(context.key_suppliers).map(([type, suppliers]) => (
            <div key={type} className="flex gap-2 text-[9px]">
              <div className="px-1.5 py-0.5 rounded font-bold uppercase text-white flex-shrink-0"
                style={{ background: SUPPLIER_COLORS[type] ?? "#64748b", fontSize: "8px" }}>
                {type}
              </div>
              <div className="text-slate-400">{suppliers}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-amber-400/80 bg-amber-950/30 border border-amber-800/40 rounded px-2 py-1.5">
        {context.price_sensitivity}
      </div>

      <div className="text-[9px] text-slate-600 italic">{context.note}</div>
    </div>
  );
}
