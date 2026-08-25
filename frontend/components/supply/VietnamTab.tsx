"use client";
import { useEffect, useMemo, useState } from "react";
import { DataHealthBar } from "@/components/DataHealthBar";
import VietnamExportPanel from "@/components/supply/VietnamExportPanel";
import DestinationChart from "@/components/supply/VietnamTab/DestinationChart";
import CoffeeImportsPanel from "@/components/supply/VietnamTab/CoffeeImportsPanel";
import VietnamFarmerEconomics from "@/components/supply/VietnamFarmerEconomics";
import VnWeatherCharts from "@/components/supply/VnWeatherCharts";
import VnWaterLevels   from "@/components/supply/VnWaterLevels";
import WeatherAnalogs from "@/components/supply/WeatherAnalogs";
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";
import { buildRealizedExportsOverlay } from "@/lib/sdRealizedExports";

// Vietnam's multi-source production estimates (USDA / MAE / ICO) ship in
// vn_farmer_economics.json under `balance_sheet`. We keep just the season
// rows here so SupplyDemandBalance gets fed via its multiSource prop.
interface VnSeasonRow {
  season:   string;
  forecast: boolean;
  production: { usda: number; mard: number; ico: number };
  /** Analyst override for the displayed production figure (M bags). */
  production_final?: number;
  exports_ico: number;
  consumption: number;
}
interface VnBalanceSheet {
  unit: string;
  note: string;
  seasons: VnSeasonRow[];
  /** Materialized by the admin crop-estimate editor's first new-source
   *  edit; absent on the legacy seed (legend falls back to the hardcoded
   *  USDA/MAE/ICO below). */
  sources?: { key: string; label: string; color: string }[];
}

interface VietnamSupply {
  scraped_at: string | null;
  country: string;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    note?: string;
    monthly: { month: string; total_k_bags: number; yoy_pct: number | null }[];
  } | null;
  fertilizer_context: {
    source: string;
    note: string;
    key_suppliers: Record<string, string>;
    price_sensitivity: string;
    monthly?: { month: string; urea_kt: number; kcl_kt: number; npk_kt: number; dap_kt: number; total_kt: number }[];
  } | null;
}

function VnEnsoNote() {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        ENSO Impact · Vietnam
      </div>
      <div className="space-y-2 text-[9px]">
        <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <span className="font-bold text-blue-400 flex-shrink-0">La Niña</span>
          <span className="text-slate-400">
            Wetter dry season in Central Highlands. Reduced irrigation cost.
            Historically <span className="text-green-400 font-semibold">+5–10%</span> yield uplift.
          </span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <span className="font-bold text-orange-400 flex-shrink-0">El Niño</span>
          <span className="text-slate-400">
            Prolonged dry season (Jan–Apr critical). Srepok / Dak Bla basins most exposed.
            2023/24 drought cut production ~<span className="text-red-400 font-semibold">−10%</span>.
          </span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-700/50 border border-slate-600/30">
          <span className="font-bold text-slate-400 flex-shrink-0">Neutral</span>
          <span className="text-slate-500">Normal seasonal rainfall. Trend yield around 27–29 bags/ha.</span>
        </div>
      </div>
      <div className="text-[7px] text-slate-700 italic border-t border-slate-700 pt-2">
        Source: WASI / WMO historical analysis. ~90% of Vietnam coffee is Robusta (Dak Lak, Gia Lai, Dak Nong, Lam Dong).
      </div>
    </div>
  );
}

export default function VietnamTab() {
  const [subTab, setSubTab] = useState<"exports" | "supply-demand" | "farmer-economics" | "weather" | "analogs">("exports");
  const [vnSupply, setVnSupply] = useState<VietnamSupply | null>(null);
  // Multi-source production / exports / consumption series fed into
  // SupplyDemandBalance on the Supply & Demand sub-tab. Drives the
  // equation strip, production-spread block, table range cells and the
  // error bars on the production line.
  const [vnBalanceSheet, setVnBalanceSheet] = useState<VnBalanceSheet | null>(null);

  // Realised customs exports by Vietnam crop year (Oct → Sep). Helper
  // owns the bucketing + partial-crop policy so the four origins that
  // need this overlay can't drift apart.
  const realizedVnExports = useMemo(
    () => buildRealizedExportsOverlay({
      monthly: (vnSupply?.exports?.monthly ?? []).map(e => ({
        month: e.month, kbags: e.total_k_bags,
      })),
      cropYearStartMonth: 10,
      sourceLabel: "Vietnam Customs",
    }),
    [vnSupply],
  );

  useEffect(() => {
    fetch("/data/vietnam_supply.json")
      .then(r => r.json())
      .then(setVnSupply)
      .catch((err) => console.error("[VietnamTab] vietnam_supply fetch failed:", err));
    fetch("/data/vn_farmer_economics.json")
      .then(r => r.json())
      .then((d: { balance_sheet?: VnBalanceSheet }) => {
        if (d?.balance_sheet) setVnBalanceSheet(d.balance_sheet);
      })
      .catch((err) => console.error("[VietnamTab] vn_farmer_economics fetch failed:", err));
  }, []);

  return (
    <div className="space-y-4">
      <DataHealthBar keys={["vietnam_exports", "vietnam_price"]} />

      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "supply-demand", "farmer-economics", "weather", "analogs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
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
          </button>
        ))}
      </div>

      {/* ── Farmer Economics ───────────────────────────────────────── */}
      {subTab === "farmer-economics" && (
        <VietnamFarmerEconomics />
      )}

      {/* ── Supply & Demand ────────────────────────────────────────── */}
      {subTab === "supply-demand" && (
        <SupplyDemandBalance
          origin="vietnam"
          label="Vietnam"
          cropYearMonths="Oct–Sep"
          editOrigin="vietnam"
          realizedExports={realizedVnExports}
          multiSource={vnBalanceSheet ? {
            sources: vnBalanceSheet.sources ?? [
              { key: "usda", label: "USDA", color: "#3b82f6" },
              // MAE since the 2025 merger — key unchanged, see the seed.
              { key: "mard", label: "MAE", color: "#10b981" },
              { key: "ico",  label: "ICO",  color: "#f59e0b" },
            ],
            // Consumption deliberately omitted: the equation strip now pulls
            // it from USDA PSD (same source as the Demand tab's per-country
            // consumption chart) so the two surfaces can't drift apart.
            seasons: vnBalanceSheet.seasons.map(s => ({
              cropYear:    s.season,
              forecast:    s.forecast,
              production:  s.production,
              final:       s.production_final,
              exports:     s.exports_ico,
            })),
          } : null}
        />
      )}

      {/* ── Weather ────────────────────────────────────────────────── */}
      {subTab === "weather" && (
        <div className="space-y-5">
          <VnWeatherCharts />
          <VnWaterLevels />
          <VnEnsoNote />
        </div>
      )}

      {/* ── Analogs ────────────────────────────────────────────────── */}
      {subTab === "analogs" && (
        <WeatherAnalogs dataUrl="/data/weather_analogs_vietnam.json" label="Vietnam robusta" />
      )}

      {/* ── Exports ────────────────────────────────────────────────── */}
      {subTab === "exports" && (
        <div className="space-y-5">
          {/* Monthly export volumes */}
          <div>
            <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
              Monthly Export Volumes
            </h2>
            {vnSupply?.exports ? (
              <VietnamExportPanel exports={vnSupply.exports} />
            ) : (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-2">
                  Monthly Export Volumes · VICOFA / Vietnam Customs
                </div>
                <p className="text-slate-500 text-xs italic">
                  {vnSupply === null ? "Loading…" : "Export data unavailable — run export_static_json.py to populate."}
                </p>
              </div>
            )}
          </div>

          {/* Export by destination — Vietnam Customs 5X by-country series */}
          <div>
            <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
              Export by Destination
            </h2>
            <DestinationChart />
          </div>

          {/* Coffee imports (national, 1N bulletins) — renders once the
              vn_fertilizer piggyback harvest lands its first cache. */}
          <CoffeeImportsPanel />

        </div>
      )}
    </div>
  );
}
