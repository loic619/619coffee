"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { BLUE, GREEN, ORANGE, SLATE, TT_STYLE, TYPE_FILTER_OPTS } from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { cropYearKey, kgToKT } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";

/** Annual Export by Coffee Type — Crop Year (Apr → Mar).
 *  Stacked bars (Arabica green / Robusta green / Other) per crop year.
 *  No USDA balance-sheet projection layer — Indonesia uses BPS directly,
 *  and we don't carry a forecast row yet. */
export default function AnnualTrendChart({
  series, filteredSeries, typeFilter, isReportMode = false,
}: {
  series: VolumeSeries[];
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isReportMode?: boolean;
}) {
  const [since, setSince] = useState(2017);
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  const annualData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; robusta: number; other: number; total: number; months: number }> = {};
    activeSeries.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, robusta: 0, other: 0, total: 0, months: 0 };
      byCrop[key].arabica += r.arabica;
      byCrop[key].robusta += r.robusta;
      byCrop[key].other   += r.other;
      byCrop[key].total   += r.total;
      byCrop[key].months  += 1;
    });
    const sortedKeys = Object.keys(byCrop).sort();
    const showSingle = isFiltered || !!typeFilter;
    const typeLabel = typeFilter
      ? TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Selected"
      : "Total";

    return sortedKeys
      .map(k => {
        const d = byCrop[k];
        const row: Record<string, number | string> = {
          year: k,
          startYear: parseInt(k.split("/")[0]),
        };
        if (showSingle) {
          row[typeLabel] = kgToKT(d[activeKey]);
        } else {
          row["Arabica (green)"] = kgToKT(d.arabica);
          row["Robusta (green)"] = kgToKT(d.robusta);
          row["Other coffee"]    = kgToKT(d.other);
        }
        return row;
      })
      .filter(r => (r.startYear as number) >= since);
  }, [activeSeries, since, isFiltered, typeFilter, activeKey]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Annual Export by Coffee Type — Crop Year (Apr–Mar)
          </div>
          <div className="text-[10px] text-slate-500">
            kt · {isFiltered ? "Filtered to selected destinations" : "BTKI-2017 months (pre-Apr-2022) sit entirely under \"Other\" — no species split available"}
          </div>
        </div>
        {!isReportMode && (
          <div className="flex gap-1">
            {[2017, 2020, 2022].map(y => (
              <button key={y} onClick={() => setSince(y)}
                className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
                {y}+
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={annualData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [`${v} kt`, name as NameType]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {(isFiltered || typeFilter)
            ? <Bar
                dataKey={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total"}
                stackId="a"
                fill={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.color ?? BLUE) : BLUE} />
            : <>
                <Bar dataKey="Arabica (green)" stackId="a" fill={GREEN}  />
                <Bar dataKey="Robusta (green)" stackId="a" fill={ORANGE} />
                <Bar dataKey="Other coffee"    stackId="a" fill={SLATE}  />
              </>
          }
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
