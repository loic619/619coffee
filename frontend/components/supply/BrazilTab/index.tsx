"use client";
import { useEffect, useMemo, useState } from "react";
import { DataHealthBar } from "@/components/DataHealthBar";
import BrazilFarmerEconomics from "../farmer-economics/BrazilFarmerEconomics";
import WeatherCharts from "../WeatherCharts";
import WeatherAnalogs from "../WeatherAnalogs";
import SupplyDemandBalance from "../SupplyDemandBalance";
import { COUNTRY_HUB, EMPTY_CY, ICE_KC_COUNTRIES, ICE_RC_COUNTRIES } from "./constants";
import { bagsToKT, buildFilteredSeries, cropYearKey, monthLabel } from "./helpers";
import type { BrazilProjection, CecafeData, FilterState } from "./types";
import { useUrlState } from "@/lib/useUrlState";

type BrazilSubTab = "exports" | "supply-demand" | "farmer-economics" | "weather" | "analogs";

import StatCard from "./StatCard";
import CecafeDailyKPIs from "./CecafeDailyKPIs";
import DailyRegistrationSection from "./DailyRegistration";
import TypeShareChart from "./TypeShareChart";
import SeasonalityHeatmap from "./SeasonalityHeatmap";
import YoYByTypeChart from "./YoYByTypeChart";
import RollingAvgChart from "./RollingAvgChart";
import CountryHubFilter from "./CountryHubFilter";
import { MonthlyVolumeCard, CumulativePaceCard, AnnualTrendCard, DestinationCard } from "./exportCharts";
import ExpectedVsActual from "@/components/supply/ExpectedVsActual";
import NewBadge from "@/components/NewBadge";
import { BRAZIL_SUBTAB_FEEDS } from "@/lib/notify";
import PinToReport from "@/components/report/PinToReport";
import { buildRealizedExportsOverlay } from "@/lib/sdRealizedExports";
import { toMultiSource, type BalanceSheetFile } from "@/lib/sdMultiSource";

export default function BrazilTab() {
  const [data, setData]   = useState<CecafeData | null>(null);
  const [projection, setProjection] = useState<BrazilProjection | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetFile | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterState>({ hub: null, country: null, type: null });
  const [subTab, setSubTab] = useUrlState<BrazilSubTab>("brazilTab", "exports", (raw) =>
    raw === "farmer-economics" ? "farmer-economics"
    : raw === "weather" ? "weather"
    : raw === "analogs" ? "analogs"
    : raw === "supply-demand" ? "supply-demand"
    : "exports"
  );

  useEffect(() => {
    fetch("/data/cecafe.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // SSOT projection — one fetch feeds MonthlyVolume, CumulativePace and the
  // S&D table. Absent file is non-fatal (charts fall back to history-only).
  useEffect(() => {
    fetch("/data/brazil_export_projection.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: BrazilProjection | null) => d && setProjection(d))
      .catch(() => { /* engine hasn't run yet — silent */ });
  }, []);

  // Multi-source production estimates (USDA / CONAB / ICO) for the
  // S&D card's equation strip + production spread block.
  useEffect(() => {
    fetch("/data/br_balance_sheet.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: BalanceSheetFile | null) => d && setBalanceSheet(d))
      .catch(() => { /* absent → equation strip + spread block hide gracefully */ });
  }, []);

  // Realised Cecafé exports by Brazilian crop year (Apr → Mar). cecafe's
  // `series` ships totals in 60-kg bags, so we divide by 1000 to feed
  // the helper in kbags.
  const realizedBrExports = useMemo(
    () => buildRealizedExportsOverlay({
      monthly: (data?.series ?? []).map(r => ({
        month: r.date, kbags: r.total / 1000,
      })),
      cropYearStartMonth: 4,
      sourceLabel: "Cecafé",
    }),
    [data],
  );

  // All hooks must be called before any conditional return
  const filteredSeries = useMemo(() => {
    if (!data) return undefined;
    const { by_country_history, by_country_prev, by_country } = data;
    const history = by_country_history ?? {};
    const ptCountries = filter.country
      ? [filter.country]
      : filter.hub === "ICE KC"
      ? [...ICE_KC_COUNTRIES]
      : filter.hub === "ICE RC"
      ? [...ICE_RC_COUNTRIES]
      : filter.hub
      ? Object.entries(COUNTRY_HUB).filter(([, h]) => h === filter.hub).map(([pt]) => pt)
      : null;
    if (!ptCountries) return undefined;
    return buildFilteredSeries(ptCountries, history, by_country_prev ?? EMPTY_CY, by_country ?? EMPTY_CY);
  }, [filter, data]);

  if (error) return (
    <div className="text-center text-slate-500 py-16 text-sm">
      Cecafe data unavailable — scraper may not have run yet.
    </div>
  );
  if (!data) return (
    <div className="text-center text-slate-500 py-16 text-sm animate-pulse">Loading Cecafe data…</div>
  );

  const { series, by_country, report, updated } = data;
  const latest = series[series.length - 1];
  const prev   = series[series.length - 13]; // same month last year

  // Crop-to-date: Apr → latest month, using cropYearKey
  const latestCropKey  = cropYearKey(latest.date);
  const [cropStartY]   = latestCropKey.split("/").map(Number); // e.g. 2025 for "2025/26"
  const prevCropKey    = `${cropStartY - 1}/${String(cropStartY).slice(2)}`;

  // All months in the current crop year up to (and including) latest
  const ctdCurrent = series.filter(r => cropYearKey(r.date) === latestCropKey);
  // Same months in the previous crop year (same month indices)
  const ctdMonthIndices = new Set(ctdCurrent.map(r => parseInt(r.date.split("-")[1])));
  const ctdPrev    = series.filter(r =>
    cropYearKey(r.date) === prevCropKey &&
    ctdMonthIndices.has(parseInt(r.date.split("-")[1]))
  );

  const ctdTotal      = ctdCurrent.reduce((s, r) => s + r.total, 0);
  const ctdPrevTotal  = ctdPrev.reduce((s, r) => s + r.total, 0);
  const ctdChg        = ctdPrevTotal > 0 ? Math.round((ctdTotal - ctdPrevTotal) / ctdPrevTotal * 100) : null;
  const lyChg         = prev ? Math.round((latest.total - prev.total) / prev.total * 100) : null;
  const ctdMonthRange = ctdCurrent.length > 0
    ? `${monthLabel(ctdCurrent[0].date)}–${monthLabel(ctdCurrent[ctdCurrent.length - 1].date)}`
    : "";

  return (
    <div className="space-y-5">
      <DataHealthBar keys={["brazil_exports", "cecafe_daily", "conab_costs", "conab_safra"]} />

      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "supply-demand", "farmer-economics", "weather", "analogs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t === "exports" ? "Exports"
              : t === "weather" ? "Weather"
              : t === "analogs" ? "Analogs"
              : t === "supply-demand" ? "Supply & Demand"
              : "Farmer Economics"}
            <NewBadge scope={`brazil:${t}`} keys={BRAZIL_SUBTAB_FEEDS[t] ?? []} active={subTab === t} />
          </button>
        ))}
      </div>

      {subTab === "farmer-economics" && <BrazilFarmerEconomics />}

      {subTab === "supply-demand" && (
        <SupplyDemandBalance
          origin="brazil"
          label="Brazil"
          projection={projection}
          cropYearMonths="Apr–Mar"
          realizedExports={realizedBrExports}
          multiSource={toMultiSource(balanceSheet)}
          editOrigin="brazil"
        />
      )}

      {subTab === "weather" && (
        <WeatherCharts
          dataUrl="/data/brazil_weather.json"
          title="Weather · Brazil"
          farmerEconomicsUrl="/data/farmer_economics.json"
          startMonthIdx={5}  // Brazil = southern hemisphere → calendar starts in June
        />
      )}

      {subTab === "analogs" && (
        <WeatherAnalogs dataUrl="/data/weather_analogs_brazil.json" label="Brazil arabica" />
      )}

      {subTab === "exports" && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Brazil — Cecafe Export Data</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Report: {report} · Updated {updated} · Source: Cecafe (60 kg bags)
              </p>
            </div>
            <span className="text-[10px] bg-green-900/50 text-green-400 px-2 py-0.5 rounded border border-green-800">
              Arabica &amp; Conillon origin
            </span>
          </div>

          {/* Daily export registration (top section, rendered only when cecafe_daily.json exists) */}
          <DailyRegistrationSection />

          {/* Daily MTD KPIs — Embarques + Certificados month-to-date with
              vs-same-day-last-month deltas. Fed by the same cecafe_daily.json
              the panel above reads, so the numbers always match. */}
          <CecafeDailyKPIs />

          {/* KPI cards (released monthly data) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={`${latest.date} — total exports`}
              value={`${bagsToKT(latest.total).toFixed(1)} kt`}
              sub={`${(latest.total / 1000).toFixed(0)}k bags`}
            />
            <StatCard
              label="vs same month last year"
              value={lyChg !== null ? `${lyChg > 0 ? "+" : ""}${lyChg}%` : "—"}
              sub={prev ? `${bagsToKT(prev.total).toFixed(1)} kt in ${prev.date}` : ""}
            />
            <StatCard
              label={`Crop ${latestCropKey} — ${ctdMonthRange}`}
              value={`${bagsToKT(ctdTotal).toFixed(1)} kt`}
              sub={`${(ctdTotal / 1000).toFixed(0)}k bags crop-to-date`}
            />
            <StatCard
              label={`vs crop ${prevCropKey} same period`}
              value={ctdChg !== null ? `${ctdChg > 0 ? "+" : ""}${ctdChg}%` : "—"}
              sub={`${prevCropKey}: ${bagsToKT(ctdPrevTotal).toFixed(1)} kt`}
            />
          </div>

          {/* Origin filter */}
          <CountryHubFilter byCountry={by_country} filter={filter} onChange={setFilter} />

          {/* Charts — instantiated through the shared exportCharts module so the
              News report builder renders these identically. */}
          <MonthlyVolumeCard data={data} projection={projection} filteredSeries={filteredSeries} typeFilter={filter.type} />
          {/* What the mid-month Cecafé registration implied vs the monthly report. */}
          <ExpectedVsActual origin="brazil" />
          <CumulativePaceCard data={data} projection={projection} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <div className="relative">
            <div className="absolute right-3 top-3 z-10"><PinToReport id="brazil_annual_trend" /></div>
            <AnnualTrendCard data={data} filteredSeries={filteredSeries} typeFilter={filter.type} />
          </div>
          <TypeShareChart series={series} />
          <YoYByTypeChart      series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <SeasonalityHeatmap series={series} />
          <RollingAvgChart     series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <DestinationCard data={data} />
        </>
      )}
    </div>
  );
}
