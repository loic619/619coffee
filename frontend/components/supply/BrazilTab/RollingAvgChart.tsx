"use client";
import { useMemo } from "react";
import { BarChart, Bar, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { TT_STYLE, TYPE_FILTER_OPTS, WINDOWS, WINDOW_COLORS } from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { bagsToKT, monthLabel } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";

export default function RollingAvgChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const showSingle = isFiltered || !!typeFilter;

  const avg = (arr: VolumeSeries[], key: "arabica" | "conillon" | "soluvel" | "torrado" | "total") =>
    arr.length > 0 ? arr.reduce((s, r) => s + r[key], 0) / arr.length : 0;

  const delta = (curr: number, prev: number) =>
    prev > 0 ? Math.round(bagsToKT(curr - prev) * 10) / 10 : null;

  const chartData = useMemo(() => {
    const typesWithTotal = showSingle
      ? [{ key: (typeFilter ?? "total") as SeriesKey, label: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total" }]
      : [
          { key: "arabica"  as const, label: "Arabica"  },
          { key: "conillon" as const, label: "Conillon" },
          { key: "soluvel"  as const, label: "Soluble"  },
          { key: "torrado"  as const, label: "Roasted"  },
          { key: "total"    as const, label: "Total"    },
        ];
    return typesWithTotal.map(t => {
      const row: Record<string, number | string | null> = { type: t.label };
      WINDOWS.forEach(w => {
        const curr = activeSeries.slice(-w.n);
        const prev = activeSeries.slice(-(w.n + 12), -12);
        row[w.label] = delta(avg(curr, t.key), avg(prev, t.key));
      });
      return row;
    });
  }, [activeSeries, showSingle, typeFilter]);

  const latest = activeSeries[activeSeries.length - 1]?.date ?? "";
  const subtitle = latest ? `Latest: ${monthLabel(latest)} ${latest.split("-")[0]} · L1M→MAT = short-term to moving annual total` : "";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Trend Tracker</div>
        <div className="text-[10px] text-slate-500">
          Volume delta vs same window one year prior (kt) · {subtitle}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="25%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="type" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [v != null ? `${Number(v) > 0 ? "+" : ""}${v} kt` : "—", name as NameType]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {WINDOWS.map(w => (
            <Bar key={w.label} dataKey={w.label} fill={WINDOW_COLORS[w.label]} radius={[2, 2, 0, 0]} maxBarSize={18} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
