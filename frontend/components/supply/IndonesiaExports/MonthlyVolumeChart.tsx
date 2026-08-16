"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  CROP_MONTH_LABELS, CROP_MONTH_ORDER, CROP_YEAR_COLORS, TT_STYLE,
  TYPE_FILTER_OPTS,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { cropYearKey, kgToKT } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";
import {
  buildMonthlyCurve, computeBalanceSheet, selectProjectionRows,
  usdaYearForCropYear, type CurveStatus, type PsdRow,
} from "@/lib/balanceSheetProjection";

/** SSOT projection palette — current crop year is red across the
 *  dashboard, so the projection's seasonality bars are a striped
 *  variant of the same red family. Mirrors Brazil's MonthlyVolumeChart
 *  status colors. */
const STATUS_COLOR: Record<CurveStatus, string> = {
  realized:    "#ef4444",                // solid red — published BPS month
  seasonality: "url(#idn-seasonality)",  // SVG striped pattern — projection
};
const STATUS_LABEL: Record<CurveStatus, string> = {
  realized:    "Realized (BPS monthly)",
  seasonality: "Seasonality projection",
};

/** Monthly Export Volume — Total (All Types). Projection overlay
 *  uses the same balance-sheet engine as Brazil / Vietnam / Uganda:
 *    1. Pull `producers.indonesia.annual` from demand_stocks.json
 *       and look up the row whose year matches the in-progress
 *       USDA marketing year (cropYearKey + 1). Falls back to the
 *       latest realized row in PROXY mode if no forecast exists yet.
 *    2. Expected total = opening_stocks + production − consumption.
 *    3. Remaining budget = expected_total − already_exported_YTD.
 *    4. Distribute remaining budget across un-realized crop-months
 *       weighted by the SAME calendar months in the prior crop year. */
export default function MonthlyVolumeChart({
  series, typeFilter, isFiltered = false, isReportMode = false,
}: {
  series: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isFiltered?: boolean;
  isReportMode?: boolean;
}) {
  const activeKey: SeriesKey = typeFilter ?? "total";
  const [cropYears, setCropYears] = useState(3);
  const [psdRows, setPsdRows]     = useState<PsdRow[] | null>(null);

  // Pull USDA PSD rows for Indonesia — same fetch pattern as Vietnam /
  // Brazil / Uganda. Silent on absence (chart falls back to history-only).
  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const a = d?.producers?.indonesia?.annual ?? null;
        setPsdRows(Array.isArray(a) ? a : null);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  // Group by crop year key → calendar-month number → kt of the active type.
  const cropGroups = useMemo(() => {
    const m: Record<string, Record<number, number>> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      if (!m[key]) m[key] = {};
      m[key][mo] = kgToKT(r[activeKey] ?? r.total);
    });
    return m;
  }, [series, activeKey]);

  const sortedCropKeys = Object.keys(cropGroups).sort();
  const latestCrop     = sortedCropKeys[sortedCropKeys.length - 1];
  const priorCrop      = sortedCropKeys.length >= 2 ? sortedCropKeys[sortedCropKeys.length - 2] : null;

  // ── Projection for the current crop year ─────────────────────────────────
  //
  // Apply only on the unfiltered "total" view: per-type and per-destination
  // breakdowns would need their own balance-sheet rows (USDA doesn't ship
  // those for Indonesia), so a filtered chart renders history-only.
  const projectionByMonth = useMemo(() => {
    if (isFiltered || typeFilter) return null;
    if (!latestCrop || !priorCrop || !psdRows) return null;
    const realizedByMonth = cropGroups[latestCrop] ?? {};
    if (Object.keys(realizedByMonth).length === 0
        || Object.keys(realizedByMonth).length >= 12) return null;
    const alreadyExportedKt = Object.values(realizedByMonth).reduce((s, v) => s + v, 0);
    const inYear = usdaYearForCropYear(latestCrop);
    const { forecastRow, latestRow } = selectProjectionRows(psdRows, inYear);
    const proj = computeBalanceSheet(forecastRow, latestRow, alreadyExportedKt);
    if (!proj) return null;
    const curve = buildMonthlyCurve({
      cropMonthOrder:    CROP_MONTH_ORDER,
      realizedByMonth,
      priorYearByMonth:  cropGroups[priorCrop] ?? {},
      remainingBudgetKt: proj.expected_total_kt - alreadyExportedKt,
    });
    const map: Record<number, { kt: number; status: CurveStatus }> = {};
    for (const r of curve) map[r.month_num] = { kt: r.value_kt, status: r.status };
    return {
      map,
      psdYear: proj.psd_year,
      mode: proj.mode,
      expectedTotalKt: proj.expected_total_kt,
    };
  }, [cropGroups, latestCrop, priorCrop, psdRows, isFiltered, typeFilter]);

  const projectionApplies = !!projectionByMonth;

  // History bars: when the projection takes over the current crop year,
  // drop it from the history set so we don't render a partial bar
  // alongside the SSOT one.
  const showCrops = (() => {
    const all = sortedCropKeys.slice();
    if (projectionApplies && latestCrop) {
      const idx = all.indexOf(latestCrop);
      if (idx >= 0) all.splice(idx, 1);
    }
    return all.slice(-(cropYears - (projectionApplies ? 1 : 0))).reverse();
  })();
  const YEAR_COLORS = CROP_YEAR_COLORS.slice(0, cropYears);

  const CURRENT_BAR_KEY = "__current__";

  const chartData = CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string | null> = { month: CROP_MONTH_LABELS[i] };
    if (projectionApplies && projectionByMonth) {
      row[CURRENT_BAR_KEY] = projectionByMonth.map[mo]?.kt ?? null;
    } else if (latestCrop) {
      row[CURRENT_BAR_KEY] = cropGroups[latestCrop]?.[mo] ?? null;
    }
    showCrops.forEach(ck => {
      row[ck] = cropGroups[ck]?.[mo] ?? 0;
    });
    return row;
  });

  // Header sub-line: status breakdown when the projection's active.
  const statusBreakdown = useMemo(() => {
    if (!projectionApplies || !projectionByMonth) return null;
    const realized:    string[] = [];
    const seasonality: string[] = [];
    CROP_MONTH_ORDER.forEach((mo, i) => {
      const s = projectionByMonth.map[mo]?.status;
      if (s === "realized")    realized.push(CROP_MONTH_LABELS[i]);
      if (s === "seasonality") seasonality.push(CROP_MONTH_LABELS[i]);
    });
    return { realized, seasonality };
  }, [projectionApplies, projectionByMonth]);

  const typeLabel = typeFilter
    ? TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total"
    : "Total (All Types)";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Monthly Export Volume — {typeLabel}
          </div>
          <div className="text-[10px] text-slate-500">
            Crop year (Apr–Mar) · Thousand metric tons (kg ÷ 1M)
            {projectionByMonth && (
              <span className="ml-2 text-slate-600 italic">
                · {latestCrop} expected total {Math.round(projectionByMonth.expectedTotalKt).toLocaleString()} kt
                {projectionByMonth.psdYear && (
                  <span className="not-italic"> (USDA {projectionByMonth.psdYear}{projectionByMonth.mode === "proxy" ? " proxy" : ""})</span>
                )}
              </span>
            )}
            {statusBreakdown && (
              <span className="ml-2 text-slate-600 italic">
                · realized {statusBreakdown.realized.length}, seasonality {statusBreakdown.seasonality.length}
              </span>
            )}
            {isFiltered && <span className="ml-2 text-slate-600 italic">· filtered</span>}
          </div>
        </div>
        {!isReportMode && (
          <div className="flex gap-1">
            {[2, 3, 5].map(n => (
              <button key={n} onClick={() => setCropYears(n)}
                className={`text-[10px] px-2 py-0.5 rounded ${cropYears === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
                {n}Y
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          {/* SVG pattern for seasonality bars — diagonal red stripes
              on a faded red background, mirroring Brazil's `brz-seasonality`. */}
          <defs>
            <pattern id="idn-seasonality" patternUnits="userSpaceOnUse"
                     width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#ef4444" fillOpacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#ef4444" strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name, props) => {
              if (name === CURRENT_BAR_KEY) {
                if (projectionApplies && projectionByMonth) {
                  const monthLabel = (props?.payload as Record<string, unknown> | undefined)?.month as string | undefined;
                  const idx = monthLabel ? CROP_MONTH_LABELS.indexOf(monthLabel) : -1;
                  const monthNum = idx >= 0 ? CROP_MONTH_ORDER[idx] : null;
                  const status = monthNum != null ? projectionByMonth.map[monthNum]?.status : undefined;
                  const label = status ? `${latestCrop} (${STATUS_LABEL[status]})` : `Crop ${latestCrop}`;
                  return [`${v} kt`, label as NameType];
                }
                return [`${v} kt`, `Crop ${latestCrop}` as NameType];
              }
              return [`${v} kt`, `Crop ${name}` as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>
                {v === CURRENT_BAR_KEY
                  ? projectionApplies ? `Crop ${latestCrop} (projection)` : `Crop ${latestCrop}`
                  : `Crop ${v}`}
              </span>
            )} />
          {/* Current crop year — per-cell coloring driven by projection status.
              Solid red for realized months, striped pattern for projected ones. */}
          <Bar key={CURRENT_BAR_KEY} dataKey={CURRENT_BAR_KEY} name={CURRENT_BAR_KEY}
               fill={projectionApplies ? STATUS_COLOR.realized : YEAR_COLORS[0]}>
            {chartData.map((_, i) => {
              if (!projectionApplies || !projectionByMonth) {
                return <Cell key={`c-${i}`} fill={YEAR_COLORS[0]} />;
              }
              const mo     = CROP_MONTH_ORDER[i];
              const status = projectionByMonth.map[mo]?.status;
              return (
                <Cell key={`c-${i}`}
                      fill={status ? STATUS_COLOR[status] : "transparent"} />
              );
            })}
          </Bar>
          {showCrops.map((ck, i) => (
            <Bar key={ck} dataKey={ck} name={ck}
              fill={YEAR_COLORS[(i + 1) % YEAR_COLORS.length]}
              opacity={0.6}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
