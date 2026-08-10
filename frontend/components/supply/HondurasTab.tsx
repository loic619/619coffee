"use client";
import { useEffect, useState } from "react";
import { DataHealthBar } from "@/components/DataHealthBar";
import OriginExportPanel from "@/components/supply/OriginExportPanel";
import HondurasFarmerEconomics from "@/components/supply/honduras/HondurasFarmerEconomics";
import WeatherCharts from "@/components/supply/WeatherCharts";
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";
import AnnualExportsPanel from "@/components/supply/AnnualExportsPanel";
import { toMultiSource, type BalanceSheetFile } from "@/lib/sdMultiSource";

interface HondurasSupply {
  country: string;
  scraped_at: string | null;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    monthly: { month: string; total_k_bags: number; yoy_pct: number | null }[];
    annual?: { year: string; total_k_bags: number; yoy_pct: number | null }[];
  } | null;
  ihcafe_price: {
    hnl_per_quintal: number;
    as_of: string;
    source: string;
  } | null;
  weather: {
    scraped_at: string;
    regions: {
      name: string;
      frost: "HIGH" | "MED" | "LOW" | "NONE";
      drought: "HIGH" | "MED" | "LOW" | "NONE";
      csi_30d?: number;
      csi_30d_level?: string;
      csi_60d?: number;
      csi_60d_level?: string;
    }[];
    daily_frost:   { region: string; days: ("H"|"M"|"L"|"-")[] }[];
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
  harvest_cal: {
    current_phase: string;
    harvest_window: string;
    flowering_window: string;
    development: string;
    description: string;
  };
}

const DEFAULT_HARVEST_CAL = {
  current_phase: "off-season",
  harvest_window: "Oct–Feb",
  flowering_window: "Apr–Jun",
  development: "Jul–Sep",
  description: "Honduras has a single annual harvest (cosecha). Honduras is Central America's largest arabica producer.",
};

export default function HondurasTab() {
  const [subTab, setSubTab] = useState<"exports" | "supply-demand" | "farmer-economics" | "weather">("exports");
  const [data, setData] = useState<HondurasSupply | null>(null);
  const [error, setError] = useState(false);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetFile | null>(null);

  useEffect(() => {
    fetch("/data/honduras_supply.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => { setData(d); if (!d.exports) setSubTab("farmer-economics"); })
      .catch(() => setError(true));
    // Multi-source production estimates for the S&D card (equation strip +
    // spread block). Seed added Aug 2026 with the wider origin set.
    fetch("/data/hn_balance_sheet.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: BalanceSheetFile | null) => d && setBalanceSheet(d))
      .catch(() => { /* absent → card stays USDA-only */ });
  }, []);

  return (
    <div className="space-y-4">
      <DataHealthBar keys={["honduras_exports"]} />

      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "supply-demand", "farmer-economics", "weather"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t === "farmer-economics" ? "Farmer Economics" : t === "weather" ? "Weather" : t === "supply-demand" ? "Supply & Demand" : "Exports"}
          </button>
        ))}
      </div>

      {error && subTab !== "weather" && subTab !== "supply-demand" && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center space-y-1">
          <div className="text-sm text-slate-400">Honduras data not yet available</div>
          <div className="text-[10px] text-slate-600">
            Requires at least one scraper run with <code className="text-slate-400">honduras</code> and{" "}
            <code className="text-slate-400">honduras_weather</code> sources active.
          </div>
        </div>
      )}

      {!error && !data && subTab !== "weather" && subTab !== "supply-demand" && (
        <div className="text-xs text-slate-500 animate-pulse py-12 text-center">
          Loading Honduras data…
        </div>
      )}

      {subTab === "supply-demand" && (
        <SupplyDemandBalance
          origin="honduras"
          label="Honduras"
          cropYearMonths="Oct–Sep"
          multiSource={toMultiSource(balanceSheet)}
          editOrigin="honduras"
        />
      )}
      {subTab === "weather" && <WeatherCharts dataUrl="/data/honduras_weather.json" title="Weather · Honduras" />}

      {data && subTab === "exports" && (
        data.exports?.annual?.length ? (
          <AnnualExportsPanel exports={{ ...data.exports, annual: data.exports.annual }} title="Honduras Green Coffee Exports" />
        ) : data.exports?.monthly?.length ? (
          <OriginExportPanel exports={data.exports} title="Honduras Green Coffee Exports" barColor="#10b981" originNote="Honduras: largest arabica producer in Central America." />
        ) : (
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
            Export data not yet available — pending the next USDA PSD scrape.
          </div>
        )
      )}

      {data && subTab === "farmer-economics" && (
        <HondurasFarmerEconomics
          ihcafe_price={data.ihcafe_price}
          weather={data.weather}
          enso={data.enso}
          harvest_cal={data.harvest_cal ?? DEFAULT_HARVEST_CAL}
        />
      )}
    </div>
  );
}
