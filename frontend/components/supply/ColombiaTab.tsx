"use client";
import { useEffect, useMemo, useState } from "react";
import { DataHealthBar } from "@/components/DataHealthBar";
import OriginExportPanel from "@/components/supply/OriginExportPanel";
import ColombiaFarmerEconomics from "@/components/supply/colombia/ColombiaFarmerEconomics";
import WeatherCharts from "@/components/supply/WeatherCharts";
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";
import AnnualExportsPanel from "@/components/supply/AnnualExportsPanel";
import { toMultiSource, type BalanceSheetFile } from "@/lib/sdMultiSource";
import { buildRealizedExportsOverlay } from "@/lib/sdRealizedExports";

interface ColombiaSupply {
  country: string;
  scraped_at: string | null;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    monthly: {
      month: string;
      total_k_bags: number;
      yoy_pct: number | null;             // exports YoY (DANE/FNC)
      // Optional fields populated by DANE (NANDINA breakdown + FOB USD)
      // and FNC (national production). All tabs degrade gracefully when
      // absent so the older USDA-PSD-only seed still renders.
      production_k_bags?: number | null;
      production_yoy_pct?: number | null; // production YoY (FNC, kept separate
                                          // from yoy_pct so neither clobbers
                                          // the other during a same-month merge)
      total_t?: number | null;
      by_nandina?: { code: string; tons: number | null; fob_usd: number | null }[];
    }[];
    annual?: { year: string; total_k_bags: number; yoy_pct: number | null }[];
  } | null;
  fnc_price: {
    cop_per_carga: number;
    as_of: string;
    source: string;
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
    oni_forecast?: { season: string; la_nina: number | null; neutral: number | null; el_nino: number | null }[];
    regional_impact: { region: string; type: string; note: string; dots: number }[];
    historical_stat: string;
    last_updated: string;
  } | null;
  mitaca: {
    current_phase: string;
    harvest_window: string;
    flowering_window: string;
    main_crop_harvest: string;
    main_crop_flowering: string;
    description: string;
  };
}

const DEFAULT_MITACA = {
  current_phase: "off-season",
  harvest_window: "Apr–Jun",
  flowering_window: "Sep–Oct",
  main_crop_harvest: "Oct–Jan",
  main_crop_flowering: "Mar–May",
  description: "Colombia's unique bimodal rainfall pattern enables two crop cycles per year.",
};

export default function ColombiaTab() {
  const [subTab, setSubTab] = useState<"exports" | "supply-demand" | "farmer-economics" | "weather">("exports");
  const [data, setData] = useState<ColombiaSupply | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetFile | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/colombia_supply.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => { setData(d); if (!d.exports) setSubTab("farmer-economics"); })
      .catch(() => setError(true));
    // Multi-source production estimates (USDA / FNC / ICO) for the
    // S&D card's equation strip + production-spread block.
    fetch("/data/co_balance_sheet.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d: BalanceSheetFile | null) => d && setBalanceSheet(d))
      .catch(() => { /* absent → equation strip + spread block hide */ });
  }, []);

  // Colombia ships two coffee crops (main Oct–Mar + mitaca Apr–Jun)
  // inside one USDA marketing year that starts Oct 1. The realised
  // exports overlay buckets by that 10-9 window so customs YTD
  // overrides USDA PSD on the in-progress crop, consistent with VN/UG.
  const realizedCoExports = useMemo(
    () => buildRealizedExportsOverlay({
      monthly: (data?.exports?.monthly ?? []).map(r => ({
        month: r.month,
        kbags: r.total_k_bags,
      })),
      cropYearStartMonth: 10,
      sourceLabel: "DANE / FNC Colombia",
    }),
    [data?.exports?.monthly],
  );

  return (
    <div className="space-y-4">
      <DataHealthBar keys={["colombia_exports"]} />

      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "supply-demand", "farmer-economics", "weather"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors capitalize ${
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
          <div className="text-sm text-slate-400">Colombia data not yet available</div>
          <div className="text-[10px] text-slate-600">
            Requires at least one scraper run with <code className="text-slate-400">colombia</code> and{" "}
            <code className="text-slate-400">colombia_weather</code> sources active.
          </div>
        </div>
      )}

      {!error && !data && subTab !== "weather" && subTab !== "supply-demand" && (
        <div className="text-xs text-slate-500 animate-pulse py-12 text-center">
          Loading Colombia data…
        </div>
      )}

      {subTab === "supply-demand" && (
        <SupplyDemandBalance
          origin="colombia"
          label="Colombia"
          cropYearMonths="Oct–Sep"
          realizedExports={realizedCoExports}
          multiSource={toMultiSource(balanceSheet)}
          editOrigin="colombia"
        />
      )}
      {subTab === "weather" && <WeatherCharts dataUrl="/data/colombia_weather.json" title="Weather · Colombia" />}

      {data && subTab === "exports" && (
        (() => {
          const hasMonthly = !!data.exports?.monthly?.length;
          const hasAnnual  = !!data.exports?.annual?.length;
          if (!hasMonthly && !hasAnnual) {
            return (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
                Export data not yet available — pending the next USDA PSD / DANE / FNC scrape.
              </div>
            );
          }
          // Monthly first (granular, recent — DANE NANDINA + FNC headline);
          // annual second for long-run USDA context.
          return (
            <div className="space-y-4">
              {hasMonthly && (
                <OriginExportPanel
                  exports={data.exports!}
                  title="Colombia Green Coffee Exports (Monthly)"
                  barColor="#f97316"
                  originNote="DANE customs annex + FNC bulletins; suave-lavado (0901.11.10.00) + los demás (0901.11.90.00)."
                />
              )}
              {hasAnnual && (
                <AnnualExportsPanel
                  exports={{ ...data.exports!, annual: data.exports!.annual! }}
                  title="Colombia Green Coffee Exports (Annual · USDA)"
                />
              )}
            </div>
          );
        })()
      )}

      {data && subTab === "farmer-economics" && (
        <ColombiaFarmerEconomics
          fnc_price={data.fnc_price}
          weather={data.weather}
          enso={data.enso}
          mitaca={data.mitaca ?? DEFAULT_MITACA}
        />
      )}
    </div>
  );
}
