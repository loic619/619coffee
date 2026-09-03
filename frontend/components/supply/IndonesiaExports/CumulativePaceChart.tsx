"use client";
import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  CROP_MONTH_LABELS, CROP_MONTH_ORDER, CROP_YEAR_COLORS, TT_STYLE,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { cropYearKey, kgToKT } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";
import { chgTone } from "@/lib/formatters";

/** Cumulative export pace across crop years. No projection overlay
 *  (Indonesia doesn't ship an SSOT forecast yet); always lines-only. */
export default function CumulativePaceChart({
  series, filteredSeries, typeFilter,
}: {
  series: VolumeSeries[];
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
}) {
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    activeSeries.forEach(r => {
      const ck  = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: kgToKT(r[activeKey] ?? r.total) });
    });
    const result: Record<string, (number | null)[]> = {};
    Object.entries(byYear).forEach(([ck, pts]) => {
      pts.sort((a, b) => a.mo - b.mo);
      const arr: (number | null)[] = Array(12).fill(null);
      let cum = 0;
      pts.forEach(({ mo, kt }) => { cum += kt; arr[mo] = Math.round(cum * 10) / 10; });
      result[ck] = arr;
    });
    return result;
  }, [activeSeries, activeKey]);

  const sortedKeys = Object.keys(grouped).sort();
  if (sortedKeys.length === 0) return null;

  const currentCropKey = sortedKeys[sortedKeys.length - 1];
  const prior1Key      = sortedKeys.length >= 2 ? sortedKeys[sortedKeys.length - 2] : null;
  const prior2Key      = sortedKeys.length >= 3 ? sortedKeys[sortedKeys.length - 3] : null;

  // Pace KPI — last realized month vs prior year's same crop-month.
  const currentArr = grouped[currentCropKey];
  const lastIdx    = currentArr.reduce<number>((acc, v, i) => v !== null ? i : acc, -1);
  const curKt      = lastIdx >= 0 ? currentArr[lastIdx] : null;
  const priorAtIdx = prior1Key && lastIdx >= 0 ? grouped[prior1Key][lastIdx] : null;
  const pacePct    = curKt && priorAtIdx && priorAtIdx > 0
    ? Math.round((curKt - priorAtIdx) / priorAtIdx * 100 * 10) / 10
    : null;

  const chartData = CROP_MONTH_LABELS.map((month, i) => {
    const row: Record<string, number | string | null> = { month };
    row[currentCropKey] = grouped[currentCropKey][i];
    if (prior1Key) row[prior1Key] = grouped[prior1Key][i];
    if (prior2Key) row[prior2Key] = grouped[prior2Key][i];
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Cumulative Crop-Year Pace</div>
        <div className="text-[10px] text-slate-500">
          Cumulative exports by crop month (Apr → Mar) · kt
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => {
              if (v == null) return ["—", "—" as NameType];
              return [`${v} kt`, `Crop ${name}` as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>Crop {v}</span>} />
          {prior2Key && (
            <Line type="monotone" dataKey={prior2Key} stroke={CROP_YEAR_COLORS[2]}
              strokeWidth={1} dot={false} connectNulls legendType="line" />
          )}
          {prior1Key && (
            <Line type="monotone" dataKey={prior1Key} stroke={CROP_YEAR_COLORS[1]}
              strokeWidth={1.5} dot={false} connectNulls legendType="line" />
          )}
          <Line type="monotone" dataKey={currentCropKey} stroke={CROP_YEAR_COLORS[0]}
            strokeWidth={2.5} dot={false} connectNulls legendType="line" />
        </LineChart>
      </ResponsiveContainer>
      {pacePct !== null && (
        <div className="text-[10px] text-slate-500 mt-1">
          {currentCropKey} pace vs {prior1Key}:{" "}
          <span className={`font-bold ${chgTone(pacePct)}`}>
            {pacePct >= 0 ? "+" : ""}{pacePct}%
          </span>{" "}
          at same crop-month
        </div>
      )}
    </div>
  );
}
