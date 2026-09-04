"use client";
import StatCard from "@/components/supply/BrazilTab/StatCard";
import MonthlyVolumeChart, { type ExportMonth } from "@/components/supply/VietnamTab/MonthlyVolumeChart";
import CumulativePaceChart from "@/components/supply/VietnamTab/CumulativePaceChart";
import AnnualTrendChart from "@/components/supply/VietnamTab/AnnualTrendChart";
import ExpectedVsActual from "@/components/supply/ExpectedVsActual";
import {
  vnCropYearKey, kBagsToKT, kBagsToMT, shortMonthLabel,
} from "@/components/supply/VietnamTab/helpers";

interface ExportsData {
  source:       string;
  last_updated: string;
  unit:         string;
  note?:        string;
  monthly:      ExportMonth[];
}

interface Props {
  exports: ExportsData;
}

export default function VietnamExportPanel({ exports: exp }: Props) {
  const monthly = exp.monthly;
  const latest  = monthly[monthly.length - 1];
  const prev    = monthly.length >= 13 ? monthly[monthly.length - 13] : null; // same month last year

  // Crop-to-date for the current crop year
  const latestCropKey = latest ? vnCropYearKey(latest.month) : "";
  const [cropStartY]  = latestCropKey.split("/").map(Number);
  const prevCropKey   = latestCropKey
    ? `${cropStartY - 1}/${String(cropStartY).slice(2)}`
    : "";

  const ctdCurrent = latest
    ? monthly.filter(r => vnCropYearKey(r.month) === latestCropKey)
    : [];
  const ctdMonthNums = new Set(ctdCurrent.map(r => parseInt(r.month.split("-")[1])));
  const ctdPrev = monthly.filter(r =>
    vnCropYearKey(r.month) === prevCropKey
    && ctdMonthNums.has(parseInt(r.month.split("-")[1]))
  );
  const ctdTotalKt = ctdCurrent.reduce((s, r) => s + kBagsToKT(r.total_k_bags), 0);
  const ctdPrevKt  = ctdPrev.reduce((s, r) => s + kBagsToKT(r.total_k_bags), 0);
  const ctdChg     = ctdPrevKt > 0 ? Math.round((ctdTotalKt - ctdPrevKt) / ctdPrevKt * 100) : null;

  const lyChg = latest && prev && prev.total_k_bags > 0
    ? Math.round((latest.total_k_bags - prev.total_k_bags) / prev.total_k_bags * 100)
    : null;

  const ctdMonthRange = ctdCurrent.length > 0
    ? `${shortMonthLabel(ctdCurrent[0].month)} – ${shortMonthLabel(ctdCurrent[ctdCurrent.length - 1].month)}`
    : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-200">Vietnam — Green Coffee Exports</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Source: {exp.source} · Last updated {exp.last_updated} ({exp.unit.replace(/_/g, " ")})
          </p>
        </div>
        <span className="text-[10px] bg-cyan-900/50 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800">
          Robusta origin · ICE RC basis
        </span>
      </div>

      {/* KPI quartet */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={`${latest?.month ?? "—"} — total exports`}
          value={latest ? `${kBagsToKT(latest.total_k_bags).toFixed(1)} kt` : "—"}
          sub={latest ? `${kBagsToMT(latest.total_k_bags).toLocaleString()} MT` : ""}
        />
        <StatCard
          label="vs same month last year"
          value={lyChg !== null ? `${lyChg > 0 ? "+" : ""}${lyChg}%` : "—"}
          sub={prev ? `${kBagsToKT(prev.total_k_bags).toFixed(1)} kt in ${prev.month}` : ""}
        />
        <StatCard
          label={`Crop ${latestCropKey || "—"} — ${ctdMonthRange}`}
          value={`${ctdTotalKt.toFixed(1)} kt`}
          sub={`${ctdCurrent.length} month${ctdCurrent.length === 1 ? "" : "s"} of data`}
        />
        <StatCard
          label={`vs crop ${prevCropKey || "—"} same period`}
          value={ctdChg !== null ? `${ctdChg > 0 ? "+" : ""}${ctdChg}%` : "—"}
          sub={ctdPrevKt > 0 ? `${prevCropKey}: ${ctdPrevKt.toFixed(1)} kt` : ""}
        />
      </div>

      {/* Charts — same visual language as the Brazil tab */}
      <MonthlyVolumeChart    monthly={monthly} />
      {/* What the customs first-half bulletin implied vs what the month did. */}
      <ExpectedVsActual origin="vietnam" />
      <CumulativePaceChart   monthly={monthly} />
      <AnnualTrendChart      monthly={monthly} />

      {exp.note && (
        <div className="text-[10px] text-slate-500 italic border-t border-slate-700 pt-2">
          {exp.note}
        </div>
      )}
    </div>
  );
}
