"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import {
  VN_CROP_MONTH_LABELS, VN_CROP_MONTH_ORDER, VN_CROP_YEAR_COLORS,
  TT_STYLE, vnCropYearKey, kBagsToKT,
} from "./helpers";
import {
  buildMonthlyCurve, computeBalanceSheet, selectProjectionRows,
  usdaYearForCropYear, type CurveStatus, type PsdRow,
} from "@/lib/balanceSheetProjection";

export interface ExportMonth {
  month:        string;
  total_k_bags: number;
  yoy_pct:      number | null;
}

// Status palette — current crop year reads sky-blue across the dashboard;
// the projection's seasonality bars are a striped variant of the same
// blue family so the eye groups them as "current crop year, projected".
const STATUS_COLOR: Record<CurveStatus, string> = {
  realized:    "#0ea5e9",                  // sky-500 (solid)
  seasonality: "url(#vn-seasonality)",     // SVG striped pattern
};
const STATUS_LABEL: Record<CurveStatus, string> = {
  realized:    "Realized (Vietnam Customs)",
  seasonality: "Seasonality projection",
};

export default function MonthlyVolumeChart({ monthly, isReportMode = false }: { monthly: ExportMonth[]; isReportMode?: boolean }) {
  const [cropYears, setCropYears] = useState(3);
  const [psdRows, setPsdRows] = useState<PsdRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const a = d?.producers?.vietnam?.annual ?? null;
        setPsdRows(Array.isArray(a) ? a : null);
      })
      .catch(() => { /* silent — projection falls back to no bars */ });
    return () => { cancelled = true; };
  }, []);

  // Group by crop year key → month number → kt
  const cropGroups = useMemo(() => {
    const m: Record<string, Record<number, number>> = {};
    monthly.forEach(r => {
      const key = vnCropYearKey(r.month);
      const mo  = parseInt(r.month.split("-")[1]);
      if (!m[key]) m[key] = {};
      m[key][mo] = kBagsToKT(r.total_k_bags);
    });
    return m;
  }, [monthly]);

  const sortedCropKeys = Object.keys(cropGroups).sort();
  const latestCrop     = sortedCropKeys[sortedCropKeys.length - 1];
  const priorCrop      = sortedCropKeys.length >= 2 ? sortedCropKeys[sortedCropKeys.length - 2] : null;

  // ── Projection for the current crop year ────────────────────────────────
  // Balance-sheet identity gives the expected total exports; seasonality
  // distributes the remaining-after-realized budget across the unreported
  // months using last year's same-period pattern. Same method as Brazil's
  // SSOT engine, minus the certificados pacing step (Vietnam has no
  // daily customs feed equivalent).
  const projectionByMonth = useMemo(() => {
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
      cropMonthOrder:   VN_CROP_MONTH_ORDER,
      realizedByMonth,
      priorYearByMonth: cropGroups[priorCrop] ?? {},
      remainingBudgetKt: proj.expected_total_kt - alreadyExportedKt,
    });
    const map: Record<number, { kt: number; status: CurveStatus }> = {};
    for (const r of curve) map[r.month_num] = { kt: r.value_kt, status: r.status };
    return { map, psdYear: proj.psd_year, mode: proj.mode, expectedTotalKt: proj.expected_total_kt };
  }, [cropGroups, latestCrop, priorCrop, psdRows]);

  const projectionApplies = !!projectionByMonth;

  // Show only PAST crop years from history — the current year now comes
  // from the projection (avoids drawing partial bars from monthly[]
  // alongside the SSOT bar). When projection isn't applicable, render every
  // crop year as before.
  const showCrops = (() => {
    const all = sortedCropKeys.slice();
    if (projectionApplies && latestCrop) {
      const idx = all.indexOf(latestCrop);
      if (idx >= 0) all.splice(idx, 1);
    }
    return all.slice(-(cropYears - (projectionApplies ? 1 : 0))).reverse();
  })();
  const YEAR_COLORS = VN_CROP_YEAR_COLORS.slice(0, cropYears);

  const CURRENT_BAR_KEY = "__current__";

  const chartData = VN_CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string | null> = { month: VN_CROP_MONTH_LABELS[i] };
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

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Monthly Export Volume
          </div>
          <div className="text-[10px] text-slate-500">
            Crop year (Oct–Sep) · Thousand metric tons (60 kg bags)
            {projectionByMonth && (
              <span className="ml-2 text-slate-600 italic">
                · {latestCrop} expected total {Math.round(projectionByMonth.expectedTotalKt).toLocaleString()} kt
                {projectionByMonth.psdYear && (
                  <span className="not-italic"> (USDA {projectionByMonth.psdYear}{projectionByMonth.mode === "proxy" ? " proxy" : ""})</span>
                )}
              </span>
            )}
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
          {/* SVG pattern for seasonality bars — diagonal blue stripes on
              a faded blue background so the eye reads "current year,
              projected" without losing the sky-blue family. */}
          <defs>
            <pattern id="vn-seasonality" patternUnits="userSpaceOnUse"
                     width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#0ea5e9" fillOpacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#0ea5e9" strokeWidth="2" />
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
                  const idx = monthLabel ? VN_CROP_MONTH_LABELS.indexOf(monthLabel) : -1;
                  const monthNum = idx >= 0 ? VN_CROP_MONTH_ORDER[idx] : null;
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
              When projection is absent, falls back to a single solid color. */}
          <Bar key={CURRENT_BAR_KEY} dataKey={CURRENT_BAR_KEY} name={CURRENT_BAR_KEY}
               fill={projectionApplies ? STATUS_COLOR.realized : YEAR_COLORS[0]}>
            {chartData.map((_, i) => {
              if (!projectionApplies || !projectionByMonth) {
                return <Cell key={`c-${i}`} fill={YEAR_COLORS[0]} />;
              }
              const mo     = VN_CROP_MONTH_ORDER[i];
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
