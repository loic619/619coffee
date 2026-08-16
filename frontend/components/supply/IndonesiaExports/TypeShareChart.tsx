"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { GREEN, ORANGE, SLATE, TT_STYLE } from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { cropYearKey } from "./helpers";
import type { VolumeSeries } from "./types";

/** Coffee Type Share — Crop Year Mix.
 *  Shows arabica / robusta / other as % of total per crop year. */
export default function TypeShareChart({ series }: { series: VolumeSeries[] }) {
  const [since, setSince] = useState(2017);

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; robusta: number; other: number; months: number }> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, robusta: 0, other: 0, months: 0 };
      byCrop[key].arabica += r.arabica;
      byCrop[key].robusta += r.robusta;
      byCrop[key].other   += r.other;
      byCrop[key].months  += 1;
    });

    return Object.entries(byCrop)
      .filter(([k]) => parseInt(k.split("/")[0]) >= since)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, d]) => {
        const total = d.arabica + d.robusta + d.other;
        if (total === 0) return null;
        return {
          year:    k,
          Arabica: Math.round(d.arabica / total * 1000) / 10,
          Robusta: Math.round(d.robusta / total * 1000) / 10,
          Other:   Math.round(d.other   / total * 1000) / 10,
        };
      })
      .filter(Boolean) as { year: string; Arabica: number; Robusta: number; Other: number }[];
  }, [series, since]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Coffee Type Share — Crop Year Mix</div>
          <div className="text-[10px] text-slate-500">
            % of total exports per type · partial crop years included
          </div>
        </div>
        <div className="flex gap-1">
          {[2017, 2020, 2022].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [`${v}%`, name as NameType]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          <Bar dataKey="Arabica" stackId="s" fill={GREEN}  />
          <Bar dataKey="Robusta" stackId="s" fill={ORANGE} />
          <Bar dataKey="Other"   stackId="s" fill={SLATE}  />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
