"use client";
import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  CROP_MONTH_LABELS, CROP_MONTH_ORDER, CROP_YEAR_COLORS, TT_STYLE,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { bagsToKT, cropYearKey } from "./helpers";
import type { BrazilProjection, SeriesKey, VolumeSeries } from "./types";
import { chgTone } from "@/lib/formatters";

export default function CumulativePaceChart({ series, filteredSeries, typeFilter, projection }: {
  series: VolumeSeries[];
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  projection?: BrazilProjection | null;
}) {
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  // Group by crop year → crop month index → cumulative kt
  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    activeSeries.forEach(r => {
      const ck = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: bagsToKT(r[activeKey] ?? r.total) });
    });
    // Sort each year's entries by crop month index, compute cumulative
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
  // Projection only applies on the unfiltered "total" view — country/hub/type
  // filters carry their own narrower history and don't intersect the SSOT.
  const projectionApplies = !!projection && !filteredSeries && activeKey === "total";

  // Projection cumulative line — built fresh from monthly_curve so it's
  // guaranteed to agree with the bar chart's numbers. Split into a solid
  // segment (realized + certificados) and a dashed segment (seasonality),
  // each null where the other carries the value, with one bridge point so
  // the dashed segment continues visually from the solid one.
  const projectionCum = useMemo(() => {
    if (!projectionApplies) return null;
    const solid:  (number | null)[] = Array(12).fill(null);
    const dashed: (number | null)[] = Array(12).fill(null);
    let cum = 0;
    let firstSeasonalityIdx = -1;
    projection!.monthly_curve.forEach((row, i) => {
      cum += bagsToKT(row.value);
      const v = Math.round(cum * 10) / 10;
      if (row.status === "seasonality") {
        if (firstSeasonalityIdx === -1) {
          firstSeasonalityIdx = i;
          // Bridge the dashed segment back one slot so the line is continuous.
          if (i > 0 && solid[i - 1] != null) dashed[i - 1] = solid[i - 1];
        }
        dashed[i] = v;
      } else {
        solid[i] = v;
      }
    });
    return {
      cropKey: projection!.crop_year,
      solid, dashed,
      target_kt: Math.round(bagsToKT(projection!.annual_target) * 10) / 10,
      safeguard: !!projection!.safeguard_triggered,
    };
  }, [projection, projectionApplies]);

  // Drop the in-progress crop year's history-derived line when the projection
  // is rendering — otherwise we'd draw two overlapping lines for the same year.
  const visibleHistoryKeys = projectionApplies
    ? sortedKeys.filter(k => k !== projection!.crop_year)
    : sortedKeys;
  if (visibleHistoryKeys.length === 0 && !projectionApplies) return null;

  const prior1Key = visibleHistoryKeys[visibleHistoryKeys.length - 1];
  const prior2Key = visibleHistoryKeys.length >= 2 ? visibleHistoryKeys[visibleHistoryKeys.length - 2] : null;

  // Pace KPI — current-vs-prior at the latest realized/certificados point.
  const lastSolidIdx = projectionCum
    ? projectionCum.solid.reduce<number>((acc, v, i) => v !== null ? i : acc, -1)
    : -1;
  const lastSolidKt = lastSolidIdx >= 0 ? (projectionCum!.solid[lastSolidIdx] ?? null) : null;
  const priorAtIdx  = (prior1Key && lastSolidIdx >= 0)
    ? (grouped[prior1Key]?.[lastSolidIdx] ?? null) : null;
  const pacePct     = lastSolidKt && priorAtIdx && priorAtIdx > 0
    ? Math.round((lastSolidKt - priorAtIdx) / priorAtIdx * 100 * 10) / 10
    : null;

  const SOLID_KEY  = "__cur_solid__";
  const DASHED_KEY = "__cur_dashed__";

  const chartData = CROP_MONTH_LABELS.map((month, i) => {
    const row: Record<string, number | string | null> = { month };
    if (projectionCum) {
      row[SOLID_KEY]  = projectionCum.solid[i];
      row[DASHED_KEY] = projectionCum.dashed[i];
    }
    if (prior1Key) row[prior1Key] = grouped[prior1Key][i];
    if (prior2Key) row[prior2Key] = grouped[prior2Key][i];
    return row;
  });

  const currentCropKey = projectionCum?.cropKey ?? prior1Key;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Cumulative Crop-Year Pace
          </div>
          <div className="text-[10px] text-slate-500">
            Cumulative exports by crop month (Apr → Mar) · kt
            {projectionCum && (
              <span className="ml-2 text-slate-600 italic">
                · target {projectionCum.target_kt.toLocaleString()} kt
                {projectionCum.safeguard && (
                  <span className="ml-1 text-amber-400 not-italic font-semibold">· safeguard active</span>
                )}
              </span>
            )}
          </div>
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
              if (name === SOLID_KEY)  return [`${v} kt`, `${currentCropKey} (realized + certs)` as NameType];
              if (name === DASHED_KEY) return [`${v} kt`, `${currentCropKey} (projection)` as NameType];
              return [`${v} kt`, `Crop ${name}` as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>
                {v === SOLID_KEY  ? `Crop ${currentCropKey}`
                : v === DASHED_KEY ? `Crop ${currentCropKey} (projection)`
                : `Crop ${v}`}
              </span>
            )} />
          {prior2Key && (
            <Line type="monotone" dataKey={prior2Key} stroke={CROP_YEAR_COLORS[2]}
              strokeWidth={1} dot={false} connectNulls
              legendType="line" />
          )}
          {prior1Key && (
            <Line type="monotone" dataKey={prior1Key} stroke={CROP_YEAR_COLORS[1]}
              strokeWidth={1.5} dot={false} connectNulls
              legendType="line" />
          )}
          {projectionCum && (
            <>
              <Line type="monotone" dataKey={SOLID_KEY} name={SOLID_KEY}
                stroke={CROP_YEAR_COLORS[0]} strokeWidth={2.5} dot={false}
                connectNulls legendType="line" />
              <Line type="monotone" dataKey={DASHED_KEY} name={DASHED_KEY}
                stroke={CROP_YEAR_COLORS[0]} strokeWidth={2.5}
                strokeDasharray="5 5" dot={false}
                connectNulls legendType="plainline" />
            </>
          )}
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
