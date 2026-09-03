"use client";
import { chgTone } from "@/lib/formatters";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import {
  VN_CROP_MONTH_LABELS, VN_CROP_MONTH_ORDER, VN_CROP_YEAR_COLORS,
  TT_STYLE, vnCropYearKey, kBagsToKT,
} from "./helpers";
import type { ExportMonth } from "./MonthlyVolumeChart";
import {
  buildMonthlyCurve, computeBalanceSheet, selectProjectionRows,
  usdaYearForCropYear, type PsdRow,
} from "@/lib/balanceSheetProjection";

export default function CumulativePaceChart({ monthly }: { monthly: ExportMonth[] }) {
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
      .catch(() => { /* silent — current-year line stays purely historical */ });
    return () => { cancelled = true; };
  }, []);

  // Group by crop year → crop-month-index → cumulative kt
  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    monthly.forEach(r => {
      const ck  = vnCropYearKey(r.month);
      const mo  = parseInt(r.month.split("-")[1]);
      const idx = VN_CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: kBagsToKT(r.total_k_bags) });
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
  }, [monthly]);

  // Per-month kt for the current and prior crop years (NON-cumulative) — needed
  // to feed the seasonality builder. Computed from the same source so the
  // numbers line up exactly with the bar chart.
  const monthlyByYear = useMemo(() => {
    const out: Record<string, Record<number, number>> = {};
    monthly.forEach(r => {
      const ck = vnCropYearKey(r.month);
      const mo = parseInt(r.month.split("-")[1]);
      if (!out[ck]) out[ck] = {};
      out[ck][mo] = kBagsToKT(r.total_k_bags);
    });
    return out;
  }, [monthly]);

  const sortedKeys = Object.keys(grouped).sort();
  const currentKey = sortedKeys[sortedKeys.length - 1];
  const prior1Key  = sortedKeys.length >= 2 ? sortedKeys[sortedKeys.length - 2] : null;
  const prior2Key  = sortedKeys.length >= 3 ? sortedKeys[sortedKeys.length - 3] : null;

  // ── Projection — solid line through realized months, dashed line over
  // seasonality months, with one bridge point so the dashed segment is
  // visually continuous with the solid one (same pattern as Brazil's
  // CumulativePaceChart). When demand_stocks isn't loaded yet OR the
  // current crop has no remaining months, the dashed line just isn't drawn.
  const projectionCum = useMemo(() => {
    if (!currentKey || !prior1Key || !psdRows) return null;
    const realizedByMonth = monthlyByYear[currentKey] ?? {};
    const realizedCount = Object.keys(realizedByMonth).length;
    if (realizedCount === 0 || realizedCount >= 12) return null;

    const alreadyExportedKt = Object.values(realizedByMonth).reduce((s, v) => s + v, 0);
    const inYear = usdaYearForCropYear(currentKey);
    const { forecastRow, latestRow } = selectProjectionRows(psdRows, inYear);
    const proj = computeBalanceSheet(forecastRow, latestRow, alreadyExportedKt);
    if (!proj) return null;

    const curve = buildMonthlyCurve({
      cropMonthOrder:   VN_CROP_MONTH_ORDER,
      realizedByMonth,
      priorYearByMonth: monthlyByYear[prior1Key] ?? {},
      remainingBudgetKt: proj.expected_total_kt - alreadyExportedKt,
    });

    const solid:  (number | null)[] = Array(12).fill(null);
    const dashed: (number | null)[] = Array(12).fill(null);
    let cum = 0;
    let firstSeasonalityIdx = -1;
    curve.forEach((row, i) => {
      cum += row.value_kt;
      const v = Math.round(cum * 10) / 10;
      if (row.status === "seasonality") {
        if (firstSeasonalityIdx === -1) {
          firstSeasonalityIdx = i;
          if (i > 0 && solid[i - 1] != null) dashed[i - 1] = solid[i - 1];
        }
        dashed[i] = v;
      } else {
        solid[i] = v;
      }
    });
    return {
      solid, dashed,
      target_kt: Math.round(proj.expected_total_kt * 10) / 10,
      psdYear: proj.psd_year,
      mode: proj.mode,
    };
  }, [currentKey, prior1Key, monthlyByYear, psdRows]);

  if (sortedKeys.length < 2 || !currentKey || !prior1Key) return null;

  const lastSolidIdx = projectionCum
    ? projectionCum.solid.reduce<number>((acc, v, i) => v !== null ? i : acc, -1)
    : grouped[currentKey].reduce<number>((acc, v, i) => v !== null ? i : acc, -1);
  const lastSolidKt = projectionCum
    ? (lastSolidIdx >= 0 ? (projectionCum.solid[lastSolidIdx] ?? null) : null)
    : (lastSolidIdx >= 0 ? (grouped[currentKey][lastSolidIdx] ?? null) : null);
  const prior1AtIdx = lastSolidIdx >= 0 ? (grouped[prior1Key][lastSolidIdx] ?? null) : null;
  const pacePct     = lastSolidKt && prior1AtIdx && prior1AtIdx > 0
    ? Math.round((lastSolidKt - prior1AtIdx) / prior1AtIdx * 100 * 10) / 10
    : null;

  const SOLID_KEY  = "__cur_solid__";
  const DASHED_KEY = "__cur_dashed__";

  const chartData = VN_CROP_MONTH_LABELS.map((month, i) => {
    const row: Record<string, number | string | null> = { month };
    if (projectionCum) {
      row[SOLID_KEY]  = projectionCum.solid[i];
      row[DASHED_KEY] = projectionCum.dashed[i];
    } else {
      row[currentKey] = grouped[currentKey][i];
    }
    if (prior1Key) row[prior1Key] = grouped[prior1Key][i];
    if (prior2Key) row[prior2Key] = grouped[prior2Key][i];
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Cumulative Crop-Year Pace</div>
          <div className="text-[10px] text-slate-500">
            Cumulative exports by crop month (Oct → Sep) · kt
            {projectionCum && (
              <span className="ml-2 text-slate-600 italic">
                · target {projectionCum.target_kt.toLocaleString()} kt
                {projectionCum.psdYear && (
                  <span className="not-italic"> (USDA {projectionCum.psdYear}{projectionCum.mode === "proxy" ? " proxy" : ""})</span>
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
              if (name === SOLID_KEY)  return [`${v} kt`, `${currentKey} (realized)` as NameType];
              if (name === DASHED_KEY) return [`${v} kt`, `${currentKey} (projection)` as NameType];
              return [`${v} kt`, `Crop ${name}` as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>{
                v === SOLID_KEY  ? `Crop ${currentKey}`
              : v === DASHED_KEY ? `Crop ${currentKey} (projection)`
              : `Crop ${v}`
              }</span>
            )} />
          {prior2Key && (
            <Line type="monotone" dataKey={prior2Key} stroke={VN_CROP_YEAR_COLORS[2]}
              strokeWidth={1} dot={false} connectNulls legendType="line" />
          )}
          <Line type="monotone" dataKey={prior1Key} stroke={VN_CROP_YEAR_COLORS[1]}
            strokeWidth={1.5} dot={false} connectNulls legendType="line" />
          {projectionCum ? (
            <>
              <Line type="monotone" dataKey={SOLID_KEY} name={SOLID_KEY}
                stroke={VN_CROP_YEAR_COLORS[0]} strokeWidth={2.5} dot={false}
                connectNulls legendType="line" />
              <Line type="monotone" dataKey={DASHED_KEY} name={DASHED_KEY}
                stroke={VN_CROP_YEAR_COLORS[0]} strokeWidth={2.5}
                strokeDasharray="5 5" dot={false}
                connectNulls legendType="plainline" />
            </>
          ) : (
            <Line type="monotone" dataKey={currentKey} stroke={VN_CROP_YEAR_COLORS[0]}
              strokeWidth={2.5} dot={(props) => {
                const p = props.payload as Record<string, number | null> | undefined;
                if (props.index !== lastSolidIdx || p?.[currentKey] == null) return <g key={props.key as string} />;
                return (
                  <g key={props.key as string}>
                    <circle cx={props.cx} cy={props.cy} r={3} fill={VN_CROP_YEAR_COLORS[0]} />
                    <text x={props.cx} y={(props.cy ?? 0) + 16} fill="#f87171" fontSize={9} fontFamily="monospace" textAnchor="middle">
                      {Number(lastSolidKt).toLocaleString("en-US")}kt
                    </text>
                  </g>
                );
              }}
              connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>
      {pacePct !== null && (
        <div className="text-[10px] text-slate-500 mt-1">
          {currentKey} pace vs {prior1Key}:{" "}
          <span className={`font-bold ${chgTone(pacePct)}`}>
            {pacePct >= 0 ? "+" : ""}{pacePct}%
          </span>{" "}
          at same crop-month
        </div>
      )}
    </div>
  );
}
