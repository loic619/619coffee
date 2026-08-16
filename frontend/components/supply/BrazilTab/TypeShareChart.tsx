"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { AMBER, BLUE, GREEN, TEAL, TT_STYLE } from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { cropYearKey } from "./helpers";
import type { VolumeSeries } from "./types";

export default function TypeShareChart({ series }: { series: VolumeSeries[] }) {
  const [since, setSince] = useState(2010);

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; months: number }> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].months   += 1;
    });

    return Object.entries(byCrop)
      .filter(([k]) => parseInt(k.split("/")[0]) >= since)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, d]) => {
        const total = d.arabica + d.conillon + d.soluvel + d.torrado;
        if (total === 0) return null;
        return {
          year:     k,
          Arabica:  Math.round(d.arabica  / total * 1000) / 10,
          Conillon: Math.round(d.conillon / total * 1000) / 10,
          Soluble:  Math.round(d.soluvel  / total * 1000) / 10,
          Roasted:  Math.round(d.torrado  / total * 1000) / 10,
        };
      })
      .filter(Boolean) as { year: string; Arabica: number; Conillon: number; Soluble: number; Roasted: number }[];
  }, [series, since]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Coffee Type Share — Crop Year Mix</div>
          <div className="text-[10px] text-slate-500">% of total exports per type · complete and partial crop years</div>
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
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [`${v}%`, name as NameType]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          <Bar dataKey="Arabica"  stackId="s" fill={GREEN} />
          <Bar dataKey="Conillon" stackId="s" fill={TEAL}  />
          <Bar dataKey="Soluble"  stackId="s" fill={AMBER} />
          <Bar dataKey="Roasted"  stackId="s" fill={BLUE}  />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
