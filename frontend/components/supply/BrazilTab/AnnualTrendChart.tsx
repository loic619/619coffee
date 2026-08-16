"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import {
  AMBER, BLUE, BRAZIL_DOMESTIC_KT, GREEN, TEAL, TT_STYLE, TYPE_FILTER_OPTS,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { bagsToKT, cropYearKey } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";
import {
  computeBalanceSheet, formatBalanceSheetTooltip, selectProjectionRows,
  usdaYearForCropYear, type BalanceSheetProjection, type PsdRow,
} from "@/lib/balanceSheetProjection";

export default function AnnualTrendChart({ series, filteredSeries, typeFilter, isReportMode = false }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null; isReportMode?: boolean }) {
  const [since, setSince] = useState(2010);
  const [psdRows, setPsdRows] = useState<PsdRow[] | null>(null);
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  // demand_stocks.json → producers.brazil.annual (incl. GAIN-merged forecast
  // row when available) drives the balance-sheet projection on the latest
  // incomplete crop year.
  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const a = d?.producers?.brazil?.annual ?? null;
        setPsdRows(Array.isArray(a) ? a : null);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  const { annualData, projection } = useMemo(() => {
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
    const latestData = byCrop[latestKey];

    // Projection: skipped when a type/country filter narrows the view (the
    // balance-sheet identity assumes total exports, not per-type slices).
    const skipProj  = isFiltered || !!typeFilter;
    let proj: BalanceSheetProjection | null = null;
    let projGapBags = 0;
    if (!skipProj && latestData && latestData.months < 12) {
      const inYear = usdaYearForCropYear(latestKey);
      const { forecastRow, latestRow } = selectProjectionRows(psdRows, inYear);
      // Already-exported in kt (bags-to-kt: ×60/1e6). The chart's bars are
      // already in kt, so we keep the projection in the same unit.
      const alreadyKt = bagsToKT(latestData.total);
      const result = computeBalanceSheet(forecastRow, latestRow, alreadyKt);
      if (result) {
        proj = result;
        // Convert the kt gap back to bags for the per-type stacked bar
        // alignment (the downstream `row[..]` cells are populated from
        // `bagsToKT(...)` on integer-bag counts).
        projGapBags = result.projected_gap_kt * 1e6 / 60;
      }
    }

    // Determine which bars to show
    const showSingle = isFiltered || !!typeFilter;
    const typeLabel = typeFilter
      ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Selected")
      : "Total";

    const rows = sortedKeys
      .map(k => {
        const d = byCrop[k];
        const isIncomplete = k === latestKey && d.months < 12;
        const row: Record<string, number | string | null> = {
          year: k,
          startYear: parseInt(k.split("/")[0]),
          domestic:  (!isFiltered && !typeFilter) ? (BRAZIL_DOMESTIC_KT[k] ?? null) : null,
          proj_gap:  isIncomplete ? Math.round(bagsToKT(projGapBags) * 10) / 10 : 0,
        };
        if (showSingle) {
          row[typeLabel] = bagsToKT(d[activeKey]);
        } else {
          row["Arabica (green)"]  = bagsToKT(d.arabica);
          row["Conillon (green)"] = bagsToKT(d.conillon);
          row["Soluble"]          = bagsToKT(d.soluvel);
          row["Roasted & Ground"] = bagsToKT(d.torrado);
        }
        return row;
      })
      .filter(r => (r.startYear as number) >= since);
    return { annualData: rows, projection: proj };
    // `series` is not listed: the memo reads only `activeSeries`, which is
    // already derived from it (filteredSeries ?? series).
  }, [activeSeries, since, isFiltered, typeFilter, activeKey, psdRows]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Annual Export by Coffee Type — Crop Year (Apr–Mar)</div>
          <div className="text-[10px] text-slate-500">
            kt · {isFiltered ? "Total exports for selected origin" : "incl. domestic consumption (USDA est.) · † projected full year"}
            {projection && (
              <span className="ml-1 italic" title={formatBalanceSheetTooltip(projection)}>
                · expected total {Math.round(projection.expected_total_kt).toLocaleString()} kt
                {projection.psd_year && (
                  <span className="text-slate-600 not-italic">
                    {" "}(USDA {projection.psd_year}{projection.mode === "proxy" ? " proxy" : ""})
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        {!isReportMode && (
          <div className="flex gap-1">
            {[2000, 2010, 2015].map(y => (
              <button key={y} onClick={() => setSince(y)}
                className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
                {y}+
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={annualData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => {
              if (name === "domestic") return [`${v} kt`, "Domestic consumption (USDA est.)" as NameType];
              if (name === "proj_gap") return [`+${v} kt`, "Projected remaining" as NameType];
              return [`${v} kt`, name as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: v === "domestic" ? "#f97316" : "#cbd5e1" }}>{
                v === "domestic" ? "Domestic consump. (USDA)" :
                v === "proj_gap" ? "† Projected" : v
              }</span>
            )} />
          {(isFiltered || typeFilter)
            ? <Bar dataKey={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total"}
                stackId="a" fill={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.color ?? BLUE) : BLUE} />
            : <>
                <Bar dataKey="Arabica (green)"  stackId="a" fill={GREEN} />
                <Bar dataKey="Conillon (green)" stackId="a" fill={TEAL}  />
                <Bar dataKey="Soluble"          stackId="a" fill={AMBER} />
                <Bar dataKey="Roasted & Ground" stackId="a" fill={BLUE}  />
              </>
          }
          <Bar dataKey="proj_gap" stackId="a" fill="#818cf8" fillOpacity={0.35} stroke="#818cf8" strokeWidth={1} />
          {!isFiltered && (
            <Line dataKey="domestic" type="monotone" stroke="#f97316" strokeWidth={2}
              strokeDasharray="5 3" dot={false} connectNulls />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
