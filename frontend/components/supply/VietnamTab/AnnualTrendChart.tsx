"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TT_STYLE, vnCropYearKey, kBagsToKT } from "./helpers";
import type { ExportMonth } from "./MonthlyVolumeChart";
import {
  computeBalanceSheet, formatBalanceSheetTooltip, selectProjectionRows,
  usdaYearForCropYear, type PsdRow,
} from "@/lib/balanceSheetProjection";

export default function AnnualTrendChart({ monthly }: { monthly: ExportMonth[] }) {
  const [rows, setRows] = useState<PsdRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const a = d?.producers?.vietnam?.annual ?? null;
        setRows(Array.isArray(a) ? a : null);
      })
      .catch(() => { /* silent — projection falls back to "no gap" */ });
    return () => { cancelled = true; };
  }, []);

  const { data, projection } = useMemo(() => {
    const byCrop: Record<string, { kt: number; months: number }> = {};
    monthly.forEach(r => {
      const key = vnCropYearKey(r.month);
      if (!byCrop[key]) byCrop[key] = { kt: 0, months: 0 };
      byCrop[key].kt     += kBagsToKT(r.total_k_bags);
      byCrop[key].months += 1;
    });
    const keys = Object.keys(byCrop).sort();
    const latestKey = keys[keys.length - 1];
    const latestData = byCrop[latestKey];
    const incomplete = latestData && latestData.months < 12;

    // Derive USDA MY ending-year label from the latest crop-year key.
    const inYear = usdaYearForCropYear(latestKey);
    const { forecastRow, latestRow } = selectProjectionRows(rows, inYear);
    const proj = incomplete
      ? computeBalanceSheet(forecastRow, latestRow, latestData.kt)
      : null;

    const projGap = proj ? proj.projected_gap_kt : 0;
    return {
      data: keys.map(k => ({
        year:      k,
        actual:    Math.round(byCrop[k].kt * 10) / 10,
        projected: k === latestKey && incomplete ? projGap : 0,
        months:    byCrop[k].months,
      })),
      projection: proj,
    };
  }, [monthly, rows]);

  if (data.length < 2) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Annual Export Volume</div>
        <div className="text-[10px] text-slate-500">
          Crop year totals (Oct–Sep) · kt · † projected when crop is incomplete
          {projection && (
            <span
              className="ml-1 italic"
              title={formatBalanceSheetTooltip(projection)}>
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
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }}
            tickFormatter={v => {
              const row = data.find(d => d.year === v);
              return row && row.months < 12 ? `${v}†` : v;
            }}
          />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [`${v} kt`, name === "actual" ? "Reported" : "Projected (gap)"]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v === "actual" ? "Reported" : "Projected (gap)"}</span>} />
          <Bar dataKey="actual"    stackId="a" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
          <Bar dataKey="projected" stackId="a" fill="#0ea5e9" fillOpacity={0.35} stroke="#0ea5e9" strokeDasharray="3 3" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
