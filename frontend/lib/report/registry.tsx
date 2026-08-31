/**
 * Chart registry — the backbone of the Dynamic Briefing Engine.
 *
 * One place maps a stable ID → how to render it in a report. The cart UI, the
 * preview canvas and the export all read from this list, so "make a chart
 * report-able" is a single entry here (plus, if needed, a self-contained
 * wrapper that fetches its own data and hides interactive chrome).
 *
 * Every visual is loaded with `next/dynamic` (ssr:false) so the heavy chart
 * code only ships when a chart is actually selected — the News landing page
 * stays cheap. NOTE: next/dynamic's options must be an inline object literal
 * (SWC compile-time transform), so each call repeats `{ ssr: false, loading }`.
 */
import type { ComponentType } from "react";
import dynamic from "next/dynamic";

export type ReportCategory = "Price" | "Freight" | "Supply" | "Demand" | "Macro";

export interface ReportChartDef {
  id: string;
  label: string;
  category: ReportCategory;
  description?: string;
  Component: ComponentType<{ isReportMode?: boolean }>;
  /**
   * Split note boxes. When set, the report canvas renders one note textarea per
   * entry (laid out in a row that aligns under the chart's columns) instead of a
   * single full-width box — e.g. a separate note under the NY and London charts.
   * Each note is stored under `${id}__${key}`.
   */
  notes?: { key: string; label: string }[];
  /**
   * Canvas footprint. "full" spans the report column (use for combined two-up
   * visuals like Arabica+Robusta, and dense panels); "half" takes half the
   * column so two consecutive half visuals pack side by side. Defaults to "full".
   */
  width?: "full" | "half";
  /**
   * Cart hierarchy mirroring the app's tab structure: category → group → subgroup
   * → item (e.g. Supply → Brazil → Exports). Both optional; items with no group
   * render directly under the category, items with no subgroup directly under the
   * group. Order follows the registry array.
   */
  group?: string;
  subgroup?: string;
}

const loading = () => <div className="p-4 text-xs text-slate-500">Loading…</div>;

// Arabica/Robusta split notes — the options ticks render KC left / RM right.
const KC_RM_NOTES = [
  { key: "arabica", label: "Arabica · KC" },
  { key: "robusta", label: "Robusta · RM" },
];

// NY/London split notes — shared by the dual futures visuals.
const NY_LDN_NOTES = [
  { key: "ny", label: "NY · Arabica" },
  { key: "ldn", label: "London · Robusta" },
];

export const REPORT_REGISTRY: ReportChartDef[] = [
  // ── Price ──────────────────────────────────────────────────────────────────
  {
    id: "daily_quotes",
    label: "Daily Quotes",
    category: "Price",
    description: "ICE futures chain (Barchart) — NY Arabica & London Robusta, last/change/spread/OI/volume.",
    Component: dynamic(() => import("@/components/report/charts/DailyQuotesReport"), { ssr: false, loading }),
    notes: NY_LDN_NOTES,
    width: "full",
  },
  {
    id: "cot_overview",
    label: "COT Positioning Overview",
    category: "Price",
    description: "Weekly per-market summary — OI, price/structure, industry coverage and managed-money flow.",
    Component: dynamic(() => import("@/components/report/charts/CotOverviewReport"), { ssr: false, loading }),
    notes: NY_LDN_NOTES,
    width: "full",
    group: "COT",
  },
  {
    id: "cot_heatmap",
    label: "13-Week Positioning Heatmap",
    category: "Price",
    description: "Rolling 13-week signal heatmap across the positioning rule set, per market.",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotHeatmapReport })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "cot_gauges",
    label: "52-Week Positioning Gauges",
    category: "Price",
    description: "Where each cohort sits within its trailing 52-week positioning range.",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotGaugesReport })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "cot_global_flow",
    label: "Global Money Flow",
    category: "Price",
    description: "Cross-market managed-money flow from the macro-COT feed (gross/net).",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotGlobalFlowReport })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "cot_industry_pulse",
    label: "Industry Pulse (Metric Tons)",
    category: "Price",
    description: "Producer & roaster coverage in metric tons, with week-over-week variation.",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotIndustryPulseReport })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "cot_dry_powder",
    label: "Dry Powder Indicator",
    category: "Price",
    description: "Managed-money room-to-add vs historical extremes — fuel for a squeeze or flush.",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotDryPowderReport })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "cot_cycle_location",
    label: "Cycle Location (OB/OS Matrix)",
    category: "Price",
    description: "Overbought/oversold matrix locating each market in the positioning cycle.",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotCycleLocationReport })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "cot_signals",
    label: "Rule-Based Signal Analysis",
    category: "Price",
    description: "Composite rule-engine score with the firing alert/warn/info signals per market.",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotSignalsReport })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "cot_report",
    label: "COT Report — Positioning Analysis",
    category: "Price",
    description: "Automated positioning read — positioning, WoW flow, price divergence, crowd risk and overall bias per market.",
    Component: dynamic(() => import("@/components/report/charts/CotReports").then((m) => ({ default: m.CotReportAnalysis })), { ssr: false, loading }),
    width: "full",
    group: "COT",
  },
  {
    id: "oi_fnd",
    label: "OI Evolution to FND — NY & London",
    category: "Price",
    description: "Open-interest run-down into First Notice Day — NY Arabica (left) & London Robusta (right).",
    Component: dynamic(() => import("@/components/report/charts/FuturesReports"), { ssr: false, loading }),
    notes: NY_LDN_NOTES,
    width: "full",
  },
  {
    id: "options_tiles",
    label: "Options — Headline Tiles",
    category: "Price",
    group: "Options",
    description: "Per-contract expiry, total OI + put/call ratio, ITM share vs max pain, net delta and 25Δ skew — KC & RM.",
    Component: dynamic(() => import("@/components/report/charts/OptionsReports").then((m) => ({ default: m.OptionsTiles })), { ssr: false, loading }),
    notes: KC_RM_NOTES,
    width: "full",
  },
  {
    id: "options_positioning",
    label: "Options — Positioning",
    category: "Price",
    group: "Options",
    description: "Per-strike OI board with strike walls, session ΔOI movers and the put/call ratio through time.",
    Component: dynamic(() => import("@/components/report/charts/OptionsReports").then((m) => ({ default: m.OptionsPositioning })), { ssr: false, loading }),
    notes: KC_RM_NOTES,
    width: "full",
  },
  {
    id: "options_greeks",
    label: "Options — Greeks Pressure",
    category: "Price",
    group: "Options",
    description: "Gamma-exposure and net-delta profiles by strike — where dealer hedging pins or accelerates the futures.",
    Component: dynamic(() => import("@/components/report/charts/OptionsReports").then((m) => ({ default: m.OptionsGreeks })), { ssr: false, loading }),
    notes: KC_RM_NOTES,
    width: "full",
  },
  {
    id: "options_expiry",
    label: "Options — Expiry & Pin Risk",
    category: "Price",
    group: "Options",
    description: "Deep-ITM option OI vs the underlying future's OI over the last 45 sessions into option expiry.",
    Component: dynamic(() => import("@/components/report/charts/OptionsReports").then((m) => ({ default: m.OptionsExpiry })), { ssr: false, loading }),
    notes: KC_RM_NOTES,
    width: "full",
  },
  {
    id: "options_vol",
    label: "Options — Volatility",
    category: "Price",
    group: "Options",
    description: "ATM implied-vol history and the IV term structure across listed expiries.",
    Component: dynamic(() => import("@/components/report/charts/OptionsReports").then((m) => ({ default: m.OptionsVol })), { ssr: false, loading }),
    notes: KC_RM_NOTES,
    width: "full",
  },
  {
    id: "origin_farmgate_prices",
    label: "Origin Farmgate Prices",
    category: "Price",
    description: "Reindexed farmgate price trends across Vietnam, Brazil arabica/conilon and Uganda.",
    Component: dynamic(() => import("@/components/macro/OriginPricesPanel"), { ssr: false, loading }),
    width: "full",
  },

  // ── Freight ────────────────────────────────────────────────────────────────
  {
    id: "freight_spot",
    label: "Freight Spot Rates — Coffee Corridors",
    category: "Freight",
    description: "Current container spot rates on the key coffee shipping corridors, vs prior reading.",
    Component: dynamic(() => import("@/components/report/charts/FreightReports").then((m) => ({ default: m.FreightSpotRates })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "freight_evolution",
    label: "Freight Rate Evolution",
    category: "Freight",
    description: "Historical freight-rate trend across VN→EU, BR→EU, VN→US and ET→EU corridors.",
    Component: dynamic(() => import("@/components/report/charts/FreightReports").then((m) => ({ default: m.FreightRateEvolution })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "port_activity",
    label: "Port Activity — Seasonal (IMF PortWatch)",
    category: "Freight",
    description: "Monthly port calls / import / export volume vs prior years, with a min–max seasonal band.",
    Component: dynamic(() => import("@/app/freight/PortActivity"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "origin_freight_costs",
    label: "Origin Freight Costs",
    category: "Freight",
    description: "Per-route container freight cost table with inline history sparklines.",
    Component: dynamic(() => import("@/components/macro/FreightContextPanel"), { ssr: false, loading }),
    width: "full",
  },

  // ── Supply ─────────────────────────────────────────────────────────────────
  {
    id: "brazil_daily_registration",
    label: "Brazil — Daily Export Registration",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Cecafe daily cumulative registration (Arabica + Conilon) vs prior crop years.",
    Component: dynamic(() => import("@/components/supply/BrazilTab/DailyRegistration"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "brazil_monthly_volume",
    label: "Brazil — Monthly Export Volume",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Cecafe monthly export volumes by crop year (Apr–Mar).",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilMonthlyVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_annual_trend",
    label: "Brazil — Annual Exports by Type",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Cecafe crop-year exports split by arabica / conillon / soluble / R&G, with projected gap.",
    Component: dynamic(() => import("@/components/report/charts/BrazilAnnualTrendReport"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_cumulative_pace",
    label: "Brazil — Cumulative Crop-Year Pace",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Current vs prior two crop years, cumulative export pace through the marketing year.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilCumulativePace })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_destination",
    label: "Brazil — Export by Destination",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Top destinations for Brazilian coffee, current vs prior period.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilDestination })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "brazil_type_share",
    label: "Brazil — Coffee Type Share",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Crop-year export mix — arabica / conilon / soluble / R&G share over time.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExtraReports").then((m) => ({ default: m.BrazilTypeShare })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_yoy_type",
    label: "Brazil — Y/Y Change by Type",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Year-on-year change in Cecafe exports by coffee type.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExtraReports").then((m) => ({ default: m.BrazilYoYType })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_seasonality",
    label: "Brazil — Monthly Seasonality Heatmap",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Monthly export-intensity heatmap across crop years.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExtraReports").then((m) => ({ default: m.BrazilSeasonality })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "brazil_supply_demand",
    label: "Brazil — Supply & Demand",
    group: "Brazil",
    subgroup: "Supply & Demand",
    category: "Supply",
    description: "USDA PSD balance: production, exports, domestic use and ending stocks.",
    Component: dynamic(() => import("@/components/report/charts/SupplyDemandReports").then((m) => ({ default: m.BrazilSupplyDemand })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "brazil_weather_analogs",
    label: "Brazil — Top-5 Weather Analogs",
    group: "Brazil",
    subgroup: "Weather",
    category: "Supply",
    description: "Closest historical weather analogs with detrended crop outcomes.",
    Component: dynamic(() => import("@/components/report/charts/WeatherAnalogReports").then((m) => ({ default: m.BrazilWeatherAnalogs })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_weather_pack",
    label: "Brazil — Weather (rainfall & temperature)",
    group: "Brazil",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.BrazilWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "brazil_weather_risk",
    label: "Brazil — Frost & Drought Risk",
    group: "Brazil",
    subgroup: "Weather",
    category: "Supply",
    description: "Per-region frost severity and drought (CSI) risk over the forecast window.",
    Component: dynamic(() => import("@/components/report/charts/WeatherRiskReport"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "vietnam_monthly_volume",
    label: "Vietnam — Monthly Export Volume",
    group: "Vietnam",
    subgroup: "Exports",
    category: "Supply",
    description: "Green coffee monthly exports by crop year (Oct–Sep).",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamMonthlyVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_cumulative_pace",
    label: "Vietnam — Cumulative Crop-Year Pace",
    group: "Vietnam",
    subgroup: "Exports",
    category: "Supply",
    description: "Current vs prior crop years, cumulative export pace (Oct–Sep).",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamCumulativePace })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_annual_volume",
    label: "Vietnam — Annual Export Volume",
    group: "Vietnam",
    subgroup: "Exports",
    category: "Supply",
    description: "Annual green coffee export totals.",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamAnnualVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_destination",
    label: "Vietnam — Export by Destination",
    group: "Vietnam",
    subgroup: "Exports",
    category: "Supply",
    description: "Top destinations for Vietnamese green coffee (customs by-country), recent shares.",
    Component: dynamic(() => import("@/components/supply/VietnamTab/DestinationChart"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "vietnam_supply_demand",
    label: "Vietnam — Supply & Demand",
    group: "Vietnam",
    subgroup: "Supply & Demand",
    category: "Supply",
    description: "Crop-year balance (Oct–Sep): USDA PSD backbone, realised customs exports and the USDA/MAE/ICO production spread.",
    Component: dynamic(() => import("@/components/report/charts/SupplyDemandReports").then((m) => ({ default: m.VietnamSupplyDemand })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "vietnam_farmer_economics",
    label: "Vietnam — Farmer Economics",
    group: "Vietnam",
    subgroup: "Supply & Demand",
    category: "Supply",
    description: "Robusta production cost vs VN FAQ spot (grower margin), plus acreage and yield.",
    Component: dynamic(() => import("@/components/supply/VietnamFarmerEconomics"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "vietnam_water_levels",
    label: "Vietnam — River Flow (irrigation water)",
    group: "Vietnam",
    subgroup: "Weather",
    category: "Supply",
    description: "Central Highlands basin flow vs the multi-year normal (TBNN) — the Jan–Apr irrigation constraint.",
    Component: dynamic(() => import("@/components/supply/VnWaterLevels"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "vietnam_weather_analogs",
    label: "Vietnam — Top-5 Weather Analogs",
    group: "Vietnam",
    subgroup: "Weather",
    category: "Supply",
    description: "Closest historical weather analogs with detrended crop outcomes.",
    Component: dynamic(() => import("@/components/report/charts/WeatherAnalogReports").then((m) => ({ default: m.VietnamWeatherAnalogs })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_weather_pack",
    label: "Vietnam — Weather (rainfall & temperature)",
    group: "Vietnam",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.VietnamWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "colombia_weather_pack",
    label: "Colombia — Weather (rainfall & temperature)",
    group: "Colombia",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.ColombiaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "honduras_weather_pack",
    label: "Honduras — Weather (rainfall & temperature)",
    group: "Honduras",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.HondurasWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "ethiopia_weather_pack",
    label: "Ethiopia — Weather (rainfall & temperature)",
    group: "Ethiopia",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.EthiopiaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "uganda_monthly_volume",
    label: "Uganda — Monthly Export Volume",
    group: "Uganda",
    subgroup: "Exports",
    category: "Supply",
    description: "UCDA monthly green coffee exports (robusta + arabica bags).",
    Component: dynamic(() => import("@/components/report/charts/UgandaExportReports").then((m) => ({ default: m.UgandaMonthlyVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "uganda_cumulative_pace",
    label: "Uganda — Cumulative Crop-Year Pace",
    group: "Uganda",
    subgroup: "Exports",
    category: "Supply",
    description: "Current vs prior crop years, cumulative UCDA export pace (Oct–Sep).",
    Component: dynamic(() => import("@/components/report/charts/UgandaExportReports").then((m) => ({ default: m.UgandaCumulativePace })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "uganda_annual_trend",
    label: "Uganda — Annual Exports by Type",
    group: "Uganda",
    subgroup: "Exports",
    category: "Supply",
    description: "UCDA crop-year exports split by robusta / arabica.",
    Component: dynamic(() => import("@/components/report/charts/UgandaExportReports").then((m) => ({ default: m.UgandaAnnualTrend })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "uganda_type_share",
    label: "Uganda — Coffee Type Share",
    group: "Uganda",
    subgroup: "Exports",
    category: "Supply",
    description: "Robusta / arabica share of Ugandan exports over time.",
    Component: dynamic(() => import("@/components/report/charts/UgandaExportReports").then((m) => ({ default: m.UgandaTypeShare })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "uganda_destination",
    label: "Uganda — Export by Destination",
    group: "Uganda",
    subgroup: "Exports",
    category: "Supply",
    description: "Top destinations for Ugandan coffee, robusta vs arabica.",
    Component: dynamic(() => import("@/components/report/charts/UgandaExportReports").then((m) => ({ default: m.UgandaDestination })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "uganda_weather_pack",
    label: "Uganda — Weather (rainfall & temperature)",
    group: "Uganda",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.UgandaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "indonesia_monthly_volume",
    label: "Indonesia — Monthly Export Volume",
    group: "Indonesia",
    subgroup: "Exports",
    category: "Supply",
    description: "BPS monthly coffee exports (HS-0901) by crop year.",
    Component: dynamic(() => import("@/components/report/charts/IndonesiaExportReports").then((m) => ({ default: m.IndonesiaMonthlyVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "indonesia_cumulative_pace",
    label: "Indonesia — Cumulative Crop-Year Pace",
    group: "Indonesia",
    subgroup: "Exports",
    category: "Supply",
    description: "Current vs prior crop years, cumulative BPS export pace.",
    Component: dynamic(() => import("@/components/report/charts/IndonesiaExportReports").then((m) => ({ default: m.IndonesiaCumulativePace })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "indonesia_annual_trend",
    label: "Indonesia — Annual Exports by Type",
    group: "Indonesia",
    subgroup: "Exports",
    category: "Supply",
    description: "BPS crop-year exports split by arabica / robusta / other.",
    Component: dynamic(() => import("@/components/report/charts/IndonesiaExportReports").then((m) => ({ default: m.IndonesiaAnnualTrend })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "indonesia_type_share",
    label: "Indonesia — Coffee Type Share",
    group: "Indonesia",
    subgroup: "Exports",
    category: "Supply",
    description: "Arabica / robusta / other share of Indonesian exports over time.",
    Component: dynamic(() => import("@/components/report/charts/IndonesiaExportReports").then((m) => ({ default: m.IndonesiaTypeShare })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "indonesia_yoy_type",
    label: "Indonesia — Y/Y Change by Type",
    group: "Indonesia",
    subgroup: "Exports",
    category: "Supply",
    description: "Year-on-year change in BPS exports by coffee type.",
    Component: dynamic(() => import("@/components/report/charts/IndonesiaExportReports").then((m) => ({ default: m.IndonesiaYoYType })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "indonesia_seasonality",
    label: "Indonesia — Monthly Seasonality Heatmap",
    group: "Indonesia",
    subgroup: "Exports",
    category: "Supply",
    description: "Monthly export-intensity heatmap across crop years.",
    Component: dynamic(() => import("@/components/report/charts/IndonesiaExportReports").then((m) => ({ default: m.IndonesiaSeasonality })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "indonesia_destination",
    label: "Indonesia — Export by Destination",
    group: "Indonesia",
    subgroup: "Exports",
    category: "Supply",
    description: "Top destinations and ports for Indonesian coffee, arabica vs robusta.",
    Component: dynamic(() => import("@/components/report/charts/IndonesiaExportReports").then((m) => ({ default: m.IndonesiaDestination })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "indonesia_weather_pack",
    label: "Indonesia — Weather (rainfall & temperature)",
    group: "Indonesia",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.IndonesiaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "enso_oni",
    label: "ENSO — ONI Trajectory & Analogs",
    group: "Cross-origin",
    category: "Supply",
    description: "Current ONI window vs closest historical ENSO analogs (offset 0 = latest month).",
    Component: dynamic(() => import("@/components/report/charts/EnsoReport"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "enso_plume",
    label: "ENSO — Probability Plume",
    group: "Cross-origin",
    category: "Supply",
    description: "Forecast probability of La Niña / Neutral / El Niño over the coming overlapping seasons.",
    Component: dynamic(() => import("@/components/report/charts/EnsoExtraReports").then((m) => ({ default: m.EnsoPlumeReport })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "enso_risk_table",
    label: "ENSO — 6-Month Crop Risk by Region",
    group: "Cross-origin",
    category: "Supply",
    description: "Per-country growing-region crop-risk outlook driven by the current ENSO phase.",
    Component: dynamic(() => import("@/components/report/charts/EnsoExtraReports").then((m) => ({ default: m.EnsoRiskTableReport })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "enso_divergence",
    label: "ENSO — Ocean/Atmosphere Coupling",
    group: "Cross-origin",
    category: "Supply",
    description: "Niño 3.4 SST anomaly and the SOI atmospheric response — how coupled the current ENSO phase is.",
    Component: dynamic(() => import("@/components/report/charts/EnsoExtraReports").then((m) => ({ default: m.EnsoDivergenceReport })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "enso_subsurface",
    label: "ENSO — Subsurface Warm Water Volume",
    group: "Cross-origin",
    category: "Supply",
    description: "Warm Water Volume anomaly — a 4–6 month leading indicator for the next ENSO phase.",
    Component: dynamic(() => import("@/components/report/charts/EnsoExtraReports").then((m) => ({ default: m.EnsoSubsurfaceReport })), { ssr: false, loading }),
    width: "half",
  },

  // ── Demand ─────────────────────────────────────────────────────────────────
  {
    id: "certified_stocks_tiles",
    label: "Certified Stocks — Headline Tiles",
    category: "Demand",
    group: "Certified Stocks",
    description: "ICE-certified deliverable inventory — headline tiles for Arabica (KC) and Robusta (RC).",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksTilesReport"), { ssr: false, loading }),
    notes: [
      { key: "arabica", label: "Arabica · KC" },
      { key: "robusta", label: "Robusta · RC" },
    ],
    width: "full",
  },
  {
    id: "certified_stocks_activity",
    label: "Certified Stocks — Recent Activity",
    category: "Demand",
    group: "Certified Stocks",
    description: "Recent gradings, decertifications and movements per contract (Arabica & Robusta).",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksReports").then((m) => ({ default: m.CertifiedStocksActivity })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "certified_stocks_flow",
    label: "Certified Stocks — System Flow",
    category: "Demand",
    group: "Certified Stocks",
    description: "Certified-inventory flow diagram (graded in → decertified out) over the period.",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksReports").then((m) => ({ default: m.CertifiedStocksFlow })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "certified_stocks_period_arabica",
    label: "Certified Stocks — Period View (Arabica)",
    category: "Demand",
    group: "Certified Stocks",
    description: "Arabica certified-stock table by period — certified, graded and ageing detail.",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksReports").then((m) => ({ default: m.CertifiedStocksPeriodArabica })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "certified_stocks_period_robusta",
    label: "Certified Stocks — Period View (Robusta)",
    category: "Demand",
    group: "Certified Stocks",
    description: "Robusta certified-stock table by period — gradings, age allowance and issuance.",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksReports").then((m) => ({ default: m.CertifiedStocksPeriodRobusta })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "spot_tiles",
    label: "Spot — Headline Tiles",
    category: "Demand",
    group: "Spot",
    description: "Physical spot offers (ATTE) — total offered, week-on-week, offer count and vs ECF stocks.",
    Component: dynamic(() => import("@/components/report/charts/SpotReports").then((m) => ({ default: m.SpotTiles })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "spot_origin_port",
    label: "Spot — Origin × Port",
    category: "Demand",
    group: "Spot",
    description: "Where each origin's offered spot volume sits across European ports.",
    Component: dynamic(() => import("@/components/report/charts/SpotReports").then((m) => ({ default: m.SpotOriginPort })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "spot_ecf",
    label: "Spot — vs ECF European Stocks",
    category: "Demand",
    group: "Spot",
    description: "Offered spot volume as a share of ECF reported European port stocks, by type.",
    Component: dynamic(() => import("@/components/report/charts/SpotReports").then((m) => ({ default: m.SpotEcf })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "spot_square_map",
    label: "Spot — Port Square-Map",
    category: "Demand",
    group: "Spot",
    description: "Each square ≈ a lot; fill = origin, border = crop-year freshness, sorted by price.",
    Component: dynamic(() => import("@/components/report/charts/SpotReports").then((m) => ({ default: m.SpotSquareMap })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "ecf_port_stocks",
    label: "ECF European Port Stocks",
    category: "Demand",
    description: "Green coffee stocks at European ports — ECF series with ICE-certified subset.",
    Component: dynamic(() => import("@/components/report/charts/EcfReport"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "kaffeesteuer",
    label: "German Coffee Tax (Kaffeesteuer)",
    category: "Demand",
    description: "Monthly Kaffeesteuer revenue with 12-mo average — a proxy for German consumption.",
    Component: dynamic(() => import("@/components/demand/KaffeesteuerChart"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "world_consumption",
    label: "World Consumption",
    category: "Demand",
    group: "Consumption",
    description: "Tracked global coffee consumption vs the ICO reference total.",
    Component: dynamic(() => import("@/components/demand/WorldConsumptionWidget"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "age_cohort",
    label: "Coffee-Drinking-Age Population (18+)",
    category: "Demand",
    group: "Consumption",
    description: "18+ population trajectory across tracked markets — the structural demand base.",
    Component: dynamic(() => import("@/components/demand/AgeCohortPanel"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "us_imports_origin",
    label: "US Coffee Imports by Origin",
    category: "Demand",
    group: "Imports",
    description: "Where the US sources its green coffee (USITC, HTS 0901) — origin ranking and trend.",
    Component: dynamic(() => import("@/components/report/charts/DemandReports").then((m) => ({ default: m.UsImportsByOrigin })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "eu_imports_origin",
    label: "EU Coffee Imports by Origin",
    category: "Demand",
    group: "Imports",
    description: "Extra-EU coffee sourcing (Eurostat Comext, HS 0901) — origin ranking and trend.",
    Component: dynamic(() => import("@/components/report/charts/DemandReports").then((m) => ({ default: m.EuImportsByOrigin })), { ssr: false, loading }),
    width: "full",
  },

  // ── Macro ──────────────────────────────────────────────────────────────────
  {
    id: "coffee_currency_index",
    label: "Coffee Currency Index",
    category: "Macro",
    description: "Trade-weighted index of producer-currency moves vs USD, with per-currency breakdown.",
    Component: dynamic(() => import("@/components/macro/CurrencyIndexSection"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "fertilizer_inputs",
    label: "Fertilizer Inputs (N-P-K)",
    category: "Macro",
    description: "Headline N-P-K prices (World Bank Pink Sheet) that drive coffee production cost, with history.",
    Component: dynamic(() => import("@/components/macro/FertilizerInputsPanel"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "fx_timeseries",
    label: "FX Pair Time-Series",
    category: "Macro",
    description: "Rebased producer-currency FX pairs vs USD over selectable windows.",
    Component: dynamic(() => import("@/components/macro/FxTimeSeriesPanel"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "cross_commodity",
    label: "Cross-Commodity Performance",
    category: "Macro",
    description: "Softs & macro commodities — last, 1W / 1M / YTD performance table.",
    Component: dynamic(() => import("@/components/macro/CrossCommodityPanel"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "us_cpi",
    label: "US Inflation (CPI-U)",
    category: "Macro",
    description: "US CPI headline and coffee-relevant components, year-on-year.",
    Component: dynamic(() => import("@/components/macro/UsCpiPanel"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "retail_cpi",
    label: "Retail Coffee Inflation",
    category: "Macro",
    description: "Retail coffee price inflation — US / EU / Brazil vs KC futures, year-on-year.",
    Component: dynamic(() => import("@/components/macro/RetailCpiPanel"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "news_sentiment",
    label: "News Sentiment Index",
    category: "Macro",
    group: "Signals",
    description: "Net coffee-news sentiment (−100…+100), confidence-weighted bullish minus bearish, with daily trend.",
    Component: dynamic(() => import("@/components/report/charts/SentimentReport"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "price_direction",
    label: "Open Price Direction (ML)",
    category: "Macro",
    group: "Signals",
    description: "Next-open direction classifier — factor table, SHAP attribution and model performance.",
    Component: dynamic(() => import("@/components/signals/PriceDirectionSection"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "open_direction_calendar",
    label: "Open-Direction Track Record",
    category: "Macro",
    group: "Signals",
    description: "Prediction-vs-realized open calendar heatmap with live hit-rate and backtest stats.",
    Component: dynamic(() => import("@/components/signals/OpenDirectionCalendar"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "robusta_forecast",
    label: "Robusta Futures Forecast",
    category: "Macro",
    group: "Signals",
    description: "Multi-factor OLS 4-week robusta price forecast with factor contributions.",
    Component: dynamic(() => import("@/components/signals/RobustaForecastSection"), { ssr: false, loading }),
    width: "full",
  },
];

export const REPORT_CATEGORIES: ReportCategory[] = ["Price", "Freight", "Supply", "Demand", "Macro"];

export const REPORT_BY_ID: Record<string, ReportChartDef> = Object.fromEntries(
  REPORT_REGISTRY.map((d) => [d.id, d]),
);

/**
 * One-click report packages. Each preset resolves to a set of registry chart
 * ids — defined as a predicate over REPORT_REGISTRY where possible, so adding a
 * new chart to a group automatically folds it into the matching package (no
 * second list to keep in sync). The "Demand" preset is a hand-picked key subset
 * rather than the whole (large) Demand category.
 */
export interface ReportPreset {
  id: string;
  label: string;
  description: string;
  ids: string[];
}

const idsWhere = (pred: (d: ReportChartDef) => boolean): string[] =>
  REPORT_REGISTRY.filter(pred).map((d) => d.id);

export const REPORT_PRESETS: ReportPreset[] = [
  {
    id: "briefing",
    label: "Briefing",
    description:
      "Quick daily briefing — prices, OI, farmgate, COT positioning, freight, " +
      "per-origin export pace & weather (Brazil · Vietnam · Uganda · Indonesia), " +
      "ENSO, certified-stock tiles and the coffee currency index",
    // Ordered as the briefing reads top-to-bottom (addMany preserves this order).
    ids: [
      "daily_quotes",               // last prices
      "oi_fnd",                     // OI evolution to FND
      "origin_farmgate_prices",     // origin farmgate prices
      "cot_industry_pulse",         // COT industry pulse
      "cot_dry_powder",             // COT dry-powder indicator
      "origin_freight_costs",       // origin freight cost
      "brazil_daily_registration",  // Brazil daily export registration
      "brazil_cumulative_pace",     // Brazil cumulative export pace
      "brazil_weather_pack",        // Brazil rainfall & temperature
      "vietnam_cumulative_pace",    // Vietnam cumulative export pace
      "vietnam_weather_pack",       // Vietnam rainfall & temperature
      "uganda_cumulative_pace",     // Uganda cumulative export pace
      "uganda_weather_pack",        // Uganda rainfall & temperature
      "indonesia_cumulative_pace",  // Indonesia cumulative export pace
      "indonesia_weather_pack",     // Indonesia rainfall & temperature
      "enso_divergence",            // ENSO — Ocean/Atmosphere Coupling
      "enso_subsurface",            // ENSO — Subsurface Warm Water Volume
      "certified_stocks_tiles",     // certified stocks headline tiles
      "coffee_currency_index",      // coffee currency index
    ],
  },
  {
    id: "vietnam",
    label: "Vietnam",
    description:
      "Vietnam-focused robusta report — export pace & destinations, the " +
      "crop-year S&D and grower margin, weather, river flow, analogs and ENSO, the " +
      "HCM logistics chain, plus the London/robusta market context (RM quotes, COT, " +
      "options, forecast, certified stocks, farmgate)",
    // Ordered as the report reads within each category block.
    ids: [
      // Price — robusta market context (both markets render; RM is the read)
      "daily_quotes",                    // RM front month
      "cot_overview",                    // London positioning
      "options_tiles",                   // RM options book
      "origin_farmgate_prices",          // includes VN robusta farmgate
      // Freight — the Vietnam export chain
      "port_activity",                   // Ho Chi Minh City vessel calls
      "origin_freight_costs",            // VN→EU corridor vs BR→EU
      // Supply — Vietnam itself
      "vietnam_monthly_volume",
      "vietnam_cumulative_pace",
      "vietnam_annual_volume",
      "vietnam_destination",
      "vietnam_supply_demand",
      "vietnam_farmer_economics",        // grower margin, acreage, yield
      "vietnam_weather_pack",
      "vietnam_water_levels",            // Jan–Apr irrigation constraint
      "vietnam_weather_analogs",
      "enso_divergence",                 // ENSO drives VN rainfall
      // Demand — robusta deliverable stocks
      "certified_stocks_period_robusta",
      // Macro
      "robusta_forecast",
    ],
  },
  {
    id: "brazil",
    label: "Brazil",
    description: "All Brazil visuals — exports, supply & demand, weather and analogs",
    ids: idsWhere((d) => d.group === "Brazil"),
  },
  {
    id: "weather",
    label: "Weather & ENSO",
    description: "Every origin's weather pack plus the analog scenarios and ENSO/ONI",
    ids: idsWhere((d) => d.subgroup === "Weather" || d.id === "enso_oni"),
  },
  {
    id: "cot",
    label: "COT",
    description: "The full COT positioning suite",
    ids: idsWhere((d) => d.group === "COT"),
  },
  {
    id: "demand",
    label: "Demand",
    description: "Key demand visuals — certified stocks, spot offers, EU port stocks and the German coffee-tax proxy",
    ids: [
      "certified_stocks_tiles",
      "certified_stocks_flow",
      "spot_tiles",
      "spot_square_map",
      "ecf_port_stocks",
      "kaffeesteuer",
    ],
  },
];
