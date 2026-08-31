"use client";
// recharts-backed charts for the freight page, split out so they can be
// lazy-loaded (next/dynamic, ssr:false) — keeps the ~120 kB recharts bundle
// out of the page's initial load. The header + rate table render immediately;
// these stream in a moment later.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, Bar, Area } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { VESSEL_TYPE_META } from "./vesselTypes";
import { MONTH_TICKS, monthTickLabel, idxToLabel } from "./seasonal";

const TT_STYLE = { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

const CHART_LINES = [
  { key: "vn-eu", label: "VN → EU", color: "#38bdf8" },
  { key: "br-eu", label: "BR → EU", color: "#4ade80" },
  { key: "vn-us", label: "VN → US", color: "#fb923c" },
  { key: "et-eu", label: "ET → EU", color: "#c084fc" },
];

export function FreightHistoryChart({ history }: { history: Record<string, number | string>[] }) {
  // The series can now span years rather than a fixed twelve weeks, so "MM-DD"
  // ticks would repeat each January and read as a loop. Past roughly seven
  // months, label by month-and-year instead.
  const first = String(history[0]?.date ?? "");
  const last = String(history[history.length - 1]?.date ?? "");
  const spanDays =
    first && last ? (Date.parse(last) - Date.parse(first)) / 86_400_000 : 0;
  const longRange = spanDays > 210;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
          minTickGap={longRange ? 44 : 8}
          tickFormatter={(v: string) => (longRange ? v.slice(0, 7) : v.slice(5))} />
        <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={50}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
          formatter={(v: unknown) => [`$${Number(v).toLocaleString("en-US")}`, ""]}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: "#94a3b8" }}
          formatter={(value) => CHART_LINES.find((l) => l.key === value)?.label ?? value}
        />
        {CHART_LINES.map((l) => (
          <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color}
            strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Vessel-type bands for the PortWatch stacked bars (shared with the toggle chips).
const PA_TYPES = VESSEL_TYPE_META;

function fmtTons(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return `${v}`;
}

export type PortActivityRow = {
  date: string; ma: number;
  container: number; dry_bulk: number; general_cargo: number; roro: number; tanker: number;
};

export function PortActivityChart(
  { data, unit, activeTypes }:
  { data: PortActivityRow[]; unit: "count" | "tons"; activeTypes?: readonly string[] },
) {
  const fmtAxis = unit === "tons" ? fmtTons : (v: number) => `${v}`;
  const fmtVal = (v: unknown) =>
    unit === "tons" ? `${Number(v).toLocaleString("en-US")} t` : `${Number(v).toLocaleString("en-US")}`;
  const bars = activeTypes ? PA_TYPES.filter((t) => activeTypes.includes(t.key)) : PA_TYPES;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false}
          minTickGap={28} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={48}
          tickFormatter={(v: number) => fmtAxis(v)} />
        <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8" }}
          formatter={(v: unknown, name: unknown) => [fmtVal(v), name as string]} />
        <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
        {bars.map((t) => (
          <Bar key={t.key} dataKey={t.key} stackId="a" name={t.label} fill={t.color} isAnimationActive={false} />
        ))}
        <Line type="monotone" dataKey="ma" name="7-day Moving Average" stroke="#f59e0b"
          strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export type SeasonalRow = {
  idx: number;
  cur: number | null; prev: number | null; prev2: number | null;
  band: [number, number] | null; // [min, max] across prior years — a range area
};

// Year-over-year seasonal overlay: current year (red), prior two years (orange),
// and a grey min–max band across the remaining prior years. The x-axis defaults
// to a full Jan→Dec calendar but can be reconfigured for a single-month view.
export function SeasonalChart(
  { data, unit, years, xDomain = [1, 365], xTicks = MONTH_TICKS,
    xTickFormat = monthTickLabel, xLabelFormat = idxToLabel, height = 300 }:
  {
    data: SeasonalRow[]; unit: "count" | "tons"; years: { cur: number; prev: number; prev2: number };
    xDomain?: [number, number]; xTicks?: number[];
    xTickFormat?: (v: number) => string; xLabelFormat?: (v: number) => string; height?: number;
  },
) {
  const fmtAxis = unit === "tons" ? fmtTons : (v: number) => `${v}`;
  const fmtVal = (v: unknown) =>
    v == null ? "—" : unit === "tons"
      ? `${Math.round(Number(v)).toLocaleString("en-US")} t`
      : `${Math.round(Number(v)).toLocaleString("en-US")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="idx" type="number" domain={xDomain} ticks={xTicks}
          tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false}
          tickFormatter={(v: number) => xTickFormat(v)} />
        <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={48}
          tickFormatter={(v: number) => fmtAxis(v)} />
        <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: "#94a3b8" }}
          labelFormatter={(v) => xLabelFormat(Number(v))}
          formatter={(v: unknown, name: unknown) =>
            Array.isArray(v)
              ? [`${fmtVal(v[0])} – ${fmtVal(v[1])}`, name as string]
              : [fmtVal(v), name as string]} />
        <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
        {/* Grey min–max band across prior years (range area between min and max). */}
        <Area dataKey="band" stroke="none" fill="#64748b" fillOpacity={0.18}
          name="Min–max (prior years)" isAnimationActive={false} activeDot={false} connectNulls />
        <Line type="monotone" dataKey="prev2" name={`${years.prev2}`} stroke="#fdba74"
          strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
        <Line type="monotone" dataKey="prev" name={`${years.prev}`} stroke="#ea580c"
          strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
        <Line type="monotone" dataKey="cur" name={`${years.cur}`} stroke="#ef4444"
          strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function DryBulkChart({ chartData, ticker }: { chartData: { label: string; close: number }[]; ticker: string }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false}
          tickFormatter={v => `$${Number(v).toFixed(0)}`} />
        <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, ticker]} />
        <Bar dataKey="close" fill="#3b82f6" opacity={0.75} radius={[2,2,0,0]} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
