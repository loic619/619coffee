"use client";
import { useEffect, useMemo, useState } from "react";
import { DataHealthBar } from "@/components/DataHealthBar";
import IndonesiaExportsPanel from "@/components/supply/IndonesiaExports";
import IndonesiaFarmerEconomics from "@/components/supply/indonesia/IndonesiaFarmerEconomics";
import WeatherCharts from "@/components/supply/WeatherCharts";
import WeatherAnalogs from "@/components/supply/WeatherAnalogs";
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";
import { buildRealizedExportsOverlay } from "@/lib/sdRealizedExports";
import { toMultiSource, type BalanceSheetFile } from "@/lib/sdMultiSource";

interface BpsMonthRow { month: string; total_coffee_kg: number; }
interface BpsExportsFile { series?: BpsMonthRow[]; }

interface IndonesiaSupply {
  country: string;
  scraped_at: string | null;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    monthly: { month: string; total_k_bags: number; yoy_pct: number | null }[];
    annual?: { year: string; total_k_bags: number; yoy_pct: number | null }[];
  } | null;
  weather: {
    scraped_at: string;
    regions: {
      name: string;
      drought: "HIGH" | "MED" | "LOW" | "NONE";
      csi_30d?: number;
      csi_30d_level?: string;
      csi_60d?: number;
      csi_60d_level?: string;
    }[];
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
  harvest_windows: {
    island: string;
    harvest: string;
    flowering: string;
    crop: "robusta" | "arabica" | "mixed";
  }[];
  production_mix: {
    robusta_pct: number;
    arabica_pct: number;
    note: string;
    key_regions: { robusta: string[]; arabica: string[] };
  };
}

const DEFAULT_MIX = {
  robusta_pct: 75,
  arabica_pct: 25,
  note: "Indonesia is the world's 3rd largest robusta producer.",
  key_regions: { robusta: ["Lampung", "Java"], arabica: ["Gayo", "Toraja", "Flores"] },
};

const DEFAULT_HARVEST: IndonesiaSupply["harvest_windows"] = [
  { island: "Sumatra (Robusta)", harvest: "Mar–Aug",  flowering: "Oct–Dec", crop: "robusta" },
  { island: "Sumatra (Arabica)", harvest: "Oct–Mar",  flowering: "Apr–Jun", crop: "arabica" },
  { island: "Java",              harvest: "Jul–Sep",  flowering: "Nov–Jan", crop: "mixed"   },
  { island: "Sulawesi",          harvest: "Oct–Mar",  flowering: "Apr–Jun", crop: "arabica" },
  { island: "Flores",            harvest: "Jun–Sep",  flowering: "Jan–Mar", crop: "arabica" },
];

export default function IndonesiaTab() {
  const [subTab, setSubTab] = useState<"exports" | "supply-demand" | "farmer-economics" | "weather" | "analogs">("exports");
  const [data, setData] = useState<IndonesiaSupply | null>(null);
  const [bpsExports, setBpsExports] = useState<BpsExportsFile | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetFile | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/indonesia_supply.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
    // indonesia_exports.json drives both the Exports panel (its own
    // fetch) and the realised-exports overlay we feed into
    // SupplyDemandBalance below. Two parallel requests, dedupe is the
    // browser's job — the file is static + cached.
    fetch("/data/indonesia_exports.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: BpsExportsFile | null) => d && setBpsExports(d))
      .catch(() => { /* feed absent → S&D falls back to USDA PSD */ });
    // Multi-source production estimates (USDA / GAEKI / ICO) for the
    // S&D card's equation strip + production spread block.
    fetch("/data/id_balance_sheet.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: BalanceSheetFile | null) => d && setBalanceSheet(d))
      .catch(() => { /* absent → equation strip + spread block hide */ });
  }, []);

  // BPS publishes kg per month — divide by 60 000 to land in
  // thousand 60-kg bags ("kbags") before the helper buckets them.
  const realizedIdnExports = useMemo(
    () => buildRealizedExportsOverlay({
      monthly: (bpsExports?.series ?? []).map(r => ({
        month: r.month, kbags: r.total_coffee_kg / 60_000,
      })),
      cropYearStartMonth: 4,
      sourceLabel: "BPS Indonesia",
    }),
    [bpsExports],
  );

  return (
    <div className="space-y-4">
      <DataHealthBar keys={["indonesia_exports"]} />

      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "supply-demand", "farmer-economics", "weather", "analogs"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t === "farmer-economics" ? "Farmer Economics"
              : t === "weather" ? "Weather"
              : t === "analogs" ? "Analogs"
              : t === "supply-demand" ? "Supply & Demand"
              : "Exports"}
          </button>
        ))}
      </div>

      {error && subTab === "farmer-economics" && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center space-y-1">
          <div className="text-sm text-slate-400">Farmer-economics data not yet available</div>
          <div className="text-[10px] text-slate-600">
            Requires at least one scraper run with <code className="text-slate-400">indonesia</code> and{" "}
            <code className="text-slate-400">indonesia_weather</code> sources active.
          </div>
        </div>
      )}

      {!error && !data && subTab === "farmer-economics" && (
        <div className="text-xs text-slate-500 animate-pulse py-12 text-center">
          Loading Indonesia data…
        </div>
      )}

      {subTab === "supply-demand" && (
        <SupplyDemandBalance
          origin="indonesia"
          label="Indonesia"
          cropYearMonths="Apr–Mar"
          realizedExports={realizedIdnExports}
          multiSource={toMultiSource(balanceSheet)}
          editOrigin="indonesia"
        />
      )}
      {subTab === "weather" && <WeatherCharts dataUrl="/data/indonesia_weather.json" title="Weather · Indonesia" />}
      {subTab === "analogs" && (
        <WeatherAnalogs dataUrl="/data/weather_analogs_indonesia.json" label="Indonesia robusta" />
      )}

      {subTab === "exports" && <IndonesiaExportsPanel />}

      {data && subTab === "farmer-economics" && (
        <IndonesiaFarmerEconomics
          weather={data.weather}
          enso={data.enso}
          harvest_windows={data.harvest_windows ?? DEFAULT_HARVEST}
          production_mix={data.production_mix ?? DEFAULT_MIX}
        />
      )}
    </div>
  );
}
