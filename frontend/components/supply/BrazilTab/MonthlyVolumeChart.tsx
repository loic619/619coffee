"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  CROP_MONTH_LABELS, CROP_MONTH_ORDER, CROP_YEAR_COLORS, TT_STYLE,
  TYPE_FILTER_OPTS,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { bagsToKT, cropYearKey } from "./helpers";
import type { BrazilProjection, ProjectionStatus, SeriesKey, VolumeSeries } from "./types";

// Status palette — current crop year is red across the dashboard, so the
// three status tones live in the red family: realized = solid dark red,
// certificados = solid light red, seasonality = diagonal-striped (SVG
// pattern defined per-render in <defs> so it travels with the chart's
// responsive container).
const STATUS_COLOR: Record<ProjectionStatus, string> = {
  realized:     "#991b1b",                 // dark red
  certificados: "#f87171",                 // light red / coral
  seasonality:  "url(#brz-seasonality)",   // SVG striped pattern
};
const STATUS_LABEL: Record<ProjectionStatus, string> = {
  realized:     "Realized (Cecafé monthly)",
  certificados: "Certificados pacing",
  seasonality:  "Seasonality projection",
};

export default function MonthlyVolumeChart({ series, typeFilter, isFiltered, projection, isReportMode = false }: {
  series: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isFiltered?: boolean;
  projection?: BrazilProjection | null;
  isReportMode?: boolean;
}) {
  const activeKey: SeriesKey = typeFilter ?? "total";
  const [cropYears, setCropYears] = useState(3);

  // Group by crop year key → month number → record (prior-year bars only).
  const cropGroups = useMemo(() => {
    const m: Record<string, Record<number, VolumeSeries>> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      if (!m[key]) m[key] = {};
      m[key][mo] = r;
    });
    return m;
  }, [series]);

  const sortedCropKeys = Object.keys(cropGroups).sort();
  const latestCrop     = sortedCropKeys[sortedCropKeys.length - 1];

  // Use the projection (SSOT) for the current crop year when nothing's
  // filtered. Filters (country / hub / type ≠ total) fall back to history
  // only — the projection doesn't carry per-type or per-destination splits.
  const projectionApplies = !!projection && !isFiltered && activeKey === "total";
  const currentCropKey   = projectionApplies ? projection!.crop_year : latestCrop;

  // Show only PAST crop years from the series — the current year comes
  // from the projection (avoids drawing partial bars from cecafe.json
  // alongside the SSOT bar). When the projection is absent or doesn't
  // apply, render every crop year from history as before.
  const showCrops = (() => {
    const all = sortedCropKeys.slice();
    if (projectionApplies) {
      const idx = all.indexOf(currentCropKey);
      if (idx >= 0) all.splice(idx, 1);
    }
    return all.slice(-(cropYears - (projectionApplies ? 1 : 0))).reverse();
  })();
  const YEAR_COLORS = CROP_YEAR_COLORS.slice(0, cropYears);

  // Projection: month-num → row, for the current crop year.
  const projectionByMonth = useMemo(() => {
    const m: Record<number, { kt: number; status: ProjectionStatus }> = {};
    if (projectionApplies) {
      for (const row of projection!.monthly_curve) {
        // Recover month-number from the abbr (1–12).
        const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
          .indexOf(row.month) + 1;
        if (mo >= 1) m[mo] = { kt: bagsToKT(row.value), status: row.status };
      }
    }
    return m;
  }, [projection, projectionApplies]);

  const CURRENT_BAR_KEY = "__current__";

  const chartData = CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string | null> = { month: CROP_MONTH_LABELS[i] };
    if (projectionApplies) {
      row[CURRENT_BAR_KEY] = projectionByMonth[mo]?.kt ?? null;
    } else {
      const r = cropGroups[currentCropKey]?.[mo];
      row[CURRENT_BAR_KEY] = r ? bagsToKT(r[activeKey] ?? r.total) : null;
    }
    showCrops.forEach(ck => {
      const r = cropGroups[ck]?.[mo];
      row[ck] = r ? bagsToKT(r[activeKey] ?? r.total) : 0;
    });
    return row;
  });

  // Header sub-line listing the months in each status (when projection applies).
  const statusBreakdown = useMemo(() => {
    if (!projectionApplies) return null;
    const buckets: Record<ProjectionStatus, string[]> = {
      realized: [], certificados: [], seasonality: [],
    };
    for (const r of projection!.monthly_curve) {
      buckets[r.status].push(r.month);
    }
    return buckets;
  }, [projection, projectionApplies]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Monthly Export Volume — {typeFilter ? TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label : "Total (All Types)"}
          </div>
          <div className="text-[10px] text-slate-500">
            Crop year (Apr–Mar) · Thousand metric tons (60 kg bags)
            {statusBreakdown && (
              <span className="ml-2 text-slate-600 italic">
                · {projection!.crop_year}: realized {statusBreakdown.realized.length}, certs {statusBreakdown.certificados.length}, seasonality {statusBreakdown.seasonality.length}
                {projection!.safeguard_triggered && (
                  <span className="ml-1 text-amber-400 not-italic font-semibold">· safeguard active</span>
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
          {/* SVG pattern for the seasonality bars — diagonal red stripes
              on a faded red background so the eye reads them as projected
              while keeping the current-crop-year red family. */}
          <defs>
            <pattern id="brz-seasonality" patternUnits="userSpaceOnUse"
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
                const monthLabel = props?.payload?.month;
                const monthNum = CROP_MONTH_LABELS.indexOf(monthLabel) >= 0
                  ? CROP_MONTH_ORDER[CROP_MONTH_LABELS.indexOf(monthLabel)] : null;
                const status = monthNum ? projectionByMonth[monthNum]?.status : undefined;
                const label = projectionApplies && status
                  ? `${projection!.crop_year} (${STATUS_LABEL[status]})`
                  : `Crop ${currentCropKey}`;
                return [`${v} kt`, label as NameType];
              }
              return [`${v} kt`, `Crop ${name}` as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>
                {v === CURRENT_BAR_KEY
                  ? projectionApplies ? `Crop ${currentCropKey} (projection)` : `Crop ${currentCropKey}`
                  : `Crop ${v}`}
              </span>
            )} />
          {/* Current crop year — per-cell coloring driven by projection status.
              When projection is absent, falls back to a single solid colour
              matching the prior pattern. */}
          <Bar key={CURRENT_BAR_KEY} dataKey={CURRENT_BAR_KEY} name={CURRENT_BAR_KEY}
               fill={projectionApplies ? STATUS_COLOR.realized : YEAR_COLORS[0]}>
            {chartData.map((row, i) => {
              if (!projectionApplies) {
                return <Cell key={`c-${i}`} fill={YEAR_COLORS[0]} />;
              }
              const mo     = CROP_MONTH_ORDER[i];
              const status = projectionByMonth[mo]?.status;
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
