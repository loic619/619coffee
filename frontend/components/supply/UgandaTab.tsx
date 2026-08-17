"use client";
import { useEffect, useMemo, useState } from "react";
import { DataHealthBar } from "@/components/DataHealthBar";
import { buildRealizedExportsOverlay } from "@/lib/sdRealizedExports";
import { toMultiSource, type BalanceSheetFile } from "@/lib/sdMultiSource";
import UgandaAnnualTrendChart from "@/components/supply/uganda/UgandaAnnualTrendChart";
import UgandaCumulativePaceChart from "@/components/supply/uganda/UgandaCumulativePaceChart";
import UgandaDestinationChart from "@/components/supply/uganda/UgandaDestinationChart";
import UgandaExportPanel from "@/components/supply/uganda/UgandaExportPanel";
import UgandaFarmerEconomics from "@/components/supply/uganda/UgandaFarmerEconomics";
import UgandaMonthlyVolumeChart from "@/components/supply/uganda/UgandaMonthlyVolumeChart";
import UgandaTypeShareChart from "@/components/supply/uganda/UgandaTypeShareChart";
import type { UgandaMonthlyFile, UgandaMonthlyRow } from "@/components/supply/uganda/helpers";
import WeatherCharts from "@/components/supply/WeatherCharts";
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";
import UgandaTradeActors from "@/components/supply/uganda/UgandaTradeActorsPanel";
// UgandaTab itself is dynamic-imported from supply/page.tsx with { ssr: false },
// so these panels are already lazy-loaded as part of UgandaTab's chunk —
// nested dynamic() would just add per-subtab RTTs without bundle-size benefit
// (recharts and shared libs go into the vendor chunk regardless).

type SubTab = "exports" | "supply-demand" | "trade-actors" | "farmer-economics" | "weather";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "exports",          label: "Exports" },
  { id: "supply-demand",    label: "Supply & Demand" },
  // "Destinations" sub-tab removed — the destination chart now lives in
  // the Exports sub-tab (UgandaDestinationChart aggregates per-country
  // across L12M/L24M/CTD/ALL windows + Robusta/Arabica stacking).
  { id: "trade-actors",     label: "Exporters / Buyers" },
  { id: "farmer-economics", label: "Farmer Economics" },
  { id: "weather",          label: "Weather" },
];

interface ExportMonth {
  month: string;
  total_bags: number;
  total_k_bags: number;
  robusta_bags?: number;
  arabica_bags?: number;
  robusta_k_bags?: number;
  arabica_k_bags?: number;
  robusta_pct?: number;
  arabica_pct?: number;
  avg_price_usd_kg?: number;
  total_value_usd?: number;
  yoy_pct?: number | null;
}

interface UgandaSupply {
  country: string;
  scraped_at: string | null;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    monthly: ExportMonth[];
  } | null;
  ucda_detail: {
    month: string;
    grades: { grade: string; qty_bags?: number; pct_qty?: number; price_usd_kg?: number; pct_val?: number }[];
    exporters: { rank: number; company: string; robusta_bags?: number; arabica_bags?: number; total_bags: number; pct_individual?: number }[];
    destinations: { rank: number; country: string; robusta_bags?: number; arabica_bags?: number; total_bags: number; pct_individual?: number }[];
    buyers: { rank: number; company: string; robusta_bags?: number; arabica_bags?: number; total_bags: number; pct_individual?: number }[];
    farmgate: Record<string, number>;
  } | null;
  ucda_price: { usd_cwt?: number; as_of?: string; grade?: string } | null;
  weather: {
    scraped_at: string;
    regions: { name: string; drought: "HIGH" | "MED" | "LOW" | "NONE"; csi_30d?: number; csi_30d_level?: string }[];
    daily_drought: { region: string; days: ("H"|"M"|"L"|"-")[] }[];
  } | null;
  enso: {
    phase: "el-nino" | "la-nina" | "neutral";
    intensity: string;
    oni: number;
    peak_month: string;
    forecast_direction: string;
    oni_history: { month: string; value: number; preliminary?: boolean }[];
    regional_impact: { region: string; type: string; note: string; dots: number }[];
    historical_stat: string;
    last_updated: string;
  } | null;
  harvest_cal: { main_crop_harvest: string; fly_crop_harvest: string; description: string };
  production_mix: { robusta_pct: number; arabica_pct: number; note: string; key_regions: { robusta: string[]; arabica: string[] } };
}

const DEFAULT_HARVEST = {
  main_crop_harvest: "Oct-Feb",
  fly_crop_harvest:  "Apr-Jun",
  description: "Uganda has two crop cycles. Main crop Oct-Feb; fly crop Apr-Jun. 85% robusta, 15% arabica.",
};
// Fallbacks only — the live values come from uganda_supply.json. The split
// is measured from 78 months of UCDA by-type exports (85.6/14.4), not the
// 75/25 previously assumed here.
const DEFAULT_MIX = {
  robusta_pct: 85, arabica_pct: 15,
  note: "Uganda is Africa's leading robusta exporter. Screen 15 benchmark grade.",
  key_regions: {
    robusta: ["Greater Masaka", "Central", "Western", "Busoga"],
    arabica: ["Mt Elgon", "West Nile", "Rwenzori"],
  },
};

export default function UgandaTab() {
  const [subTab, setSubTab] = useState<SubTab>("exports");
  const [data, setData]     = useState<UgandaSupply | null>(null);
  const [monthly, setMonthly] = useState<UgandaMonthlyRow[] | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetFile | null>(null);
  const [error, setError]   = useState(false);

  useEffect(() => {
    fetch("/data/uganda_supply.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
    // Multi-source production estimates (USDA / UCDA / ICO) for the
    // S&D card's equation strip + production spread block.
    fetch("/data/ug_balance_sheet.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: BalanceSheetFile | null) => d && setBalanceSheet(d))
      .catch(() => { /* absent → equation strip + spread block hide */ });
  }, []);

  // uganda_monthly.json — multi-year UCDA series (parsed by the scraper).
  // Drives the Brazil-style chart suite below; absent file is non-fatal.
  useEffect(() => {
    fetch("/data/uganda_monthly.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: UgandaMonthlyFile | null) => d && setMonthly(d.series ?? []))
      .catch(() => { /* file absent → charts hidden gracefully */ });
  }, []);

  // Realised UCDA exports per Ugandan crop year (Oct → Sep). Falls
  // through to data.exports.monthly when uganda_monthly.json is absent
  // so the overlay still kicks in for the legacy short-history feed.
  // The multi-year UCDA file stores `total_bags` (raw 60-kg bags); the
  // legacy uganda_supply feed ships pre-rounded `total_k_bags`. Both
  // resolve to kbags before they reach the helper.
  const realizedUgExports = useMemo(() => {
    const src = monthly && monthly.length > 0
      ? monthly
          .filter(r => r.total_bags != null)
          .map(r => ({ month: r.month, kbags: (r.total_bags ?? 0) / 1000 }))
      : (data?.exports?.monthly ?? []).map(r => ({
          month: r.month, kbags: r.total_k_bags,
        }));
    return buildRealizedExportsOverlay({
      monthly:            src,
      cropYearStartMonth: 10,
      sourceLabel:        "UCDA",
    });
  }, [monthly, data]);

  return (
    <div className="space-y-4">
      <DataHealthBar keys={["uganda_exports"]} />

      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit flex-wrap">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t.id
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && subTab !== "weather" && subTab !== "supply-demand" && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center space-y-1">
          <div className="text-sm text-slate-400">Uganda data not yet available</div>
          <div className="text-[10px] text-slate-600">
            Run bootstrap_ucda_reports.py then export_uganda.py to populate.
          </div>
        </div>
      )}

      {!error && !data && subTab !== "weather" && subTab !== "supply-demand" && (
        <div className="text-xs text-slate-500 animate-pulse py-12 text-center">
          Loading Uganda data...
        </div>
      )}

      {subTab === "supply-demand" && (
        <SupplyDemandBalance
          origin="uganda"
          label="Uganda"
          cropYearMonths="Oct–Sep"
          realizedExports={realizedUgExports}
          multiSource={toMultiSource(balanceSheet)}
          editOrigin="uganda"
        />
      )}
      {subTab === "weather" && <WeatherCharts dataUrl="/data/uganda_weather.json" title="Weather · Uganda" />}

      {data && subTab === "exports" && (
        data.exports ? (
          <div className="space-y-4">
            <UgandaExportPanel
              exports={data.exports}
              ucda_price={data.ucda_price ?? null}
              ucda_detail={data.ucda_detail ?? null}
            />
            {/* Brazil-style chart suite — driven by uganda_monthly.json
                (multi-year UCDA history from the scraper). Falls back to
                the legacy 28-month feed when the UCDA file is absent. */}
            {monthly && monthly.length > 0 ? (
              <>
                <UgandaMonthlyVolumeChart monthly={monthly} />
                <UgandaCumulativePaceChart monthly={monthly} />
                <UgandaAnnualTrendChart monthly={monthly} />
                <UgandaTypeShareChart monthly={monthly} />
                <UgandaDestinationChart monthly={monthly} />
              </>
            ) : (
              <UgandaAnnualTrendChart monthly={data.exports.monthly} />
            )}
          </div>
        ) : (
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
            Export data not yet available — run UCDA report bootstrap
          </div>
        )
      )}

      {data && subTab === "trade-actors" && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <UgandaTradeActors
            exporters={data.ucda_detail?.exporters ?? []}
            buyers={data.ucda_detail?.buyers ?? []}
            month={data.ucda_detail?.month ?? ""}
          />
        </div>
      )}

      {data && subTab === "farmer-economics" && (
        <UgandaFarmerEconomics
          weather={data.weather}
          enso={data.enso}
          harvest_cal={data.harvest_cal ?? DEFAULT_HARVEST}
          production_mix={data.production_mix ?? DEFAULT_MIX}
        />
      )}
    </div>
  );
}
