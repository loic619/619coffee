"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { BLUE, TT_STYLE, TYPE_FILTER_OPTS, TYPE_SERIES } from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { bagsToKT, cropYearKey } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";

export default function YoYByTypeChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const [since, setSince] = useState(2010);
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const showSingle = isFiltered || !!typeFilter;

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; total: number; months: number }> = {};
    activeSeries.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, total: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].total    += r.total;
      byCrop[key].months   += 1;
    });
    const sortedKeys = Object.keys(byCrop).sort();
    const latestKey  = sortedKeys[sortedKeys.length - 1];
    const completeKeys = sortedKeys.filter(k => k !== latestKey || byCrop[k].months === 12);
    const delta = (curr: number, prev: number) =>
      prev > 0 ? Math.round(bagsToKT(curr - prev) * 10) / 10 : null;

    return completeKeys
      .slice(1)
      .map((k, i) => {
        const prev = byCrop[completeKeys[i]];
        const curr = byCrop[k];
        const row: Record<string, number | string | null> = { year: k, startYear: parseInt(k.split("/")[0]) };
        if (showSingle) {
          const tf = typeFilter;
          const label = tf ? (TYPE_FILTER_OPTS.find(t => t.key === tf)?.label ?? "Total") : "Total";
          const key   = tf ?? "total";
          row[label] = delta(curr[key], prev[key]);
        } else {
          row["Arabica"]  = delta(curr.arabica,  prev.arabica);
          row["Conillon"] = delta(curr.conillon, prev.conillon);
          row["Soluble"]  = delta(curr.soluvel,  prev.soluvel);
          row["Roasted"]  = delta(curr.torrado,  prev.torrado);
        }
        return row;
      })
      .filter(r => (r.startYear as number) >= since);
  }, [activeSeries, since, showSingle, typeFilter]);

  const bars = showSingle
    ? [{ label: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total",
         color: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.color ?? BLUE) : BLUE }]
    : TYPE_SERIES.map(t => ({ label: t.label, color: t.color }));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Y/Y Change by Coffee Type — Crop Year</div>
          <div className="text-[10px] text-slate-500">Volume change vs prior crop year (kt) · complete crop years only</div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }} barCategoryGap="20%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
          <Tooltip contentStyle={TT_STYLE} formatter={((v, name) => [v != null ? `${Number(v) > 0 ? "+" : ""}${v} kt` : "—", name as NameType]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {bars.map(b => (
            <Bar key={b.label} dataKey={b.label} fill={b.color} radius={[2, 2, 0, 0]} maxBarSize={14} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
