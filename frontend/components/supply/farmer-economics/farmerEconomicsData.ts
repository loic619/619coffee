// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "HIGH" | "MED" | "LOW" | "NONE";
export type EnsoPhase = "el-nino" | "la-nina" | "neutral";
export type ImpactType = "DRY" | "WET" | "COLD" | "WARM";
export type DayRisk = "H" | "M" | "L" | "-";

export interface CostComponent {
  label: string;
  share: number;   // 0–1
  usd: number;
  color: string;
}

export interface InputDetail {
  label: string;
  share: number;   // 0–1 of inputs total
  usd: number;
}

// Physics-based frost detail for the worst forecast day (from the deepened
// frost model — scraper.rules.frost_model). Absent when the forecast holds
// no frost, or on JSON written before Phase 2.
export interface FrostDetail {
  date: string | null;
  risk: DayRisk;
  frost_type: "none" | "radiative" | "advective" | "black";
  surface_c: number | null;   // canopy/grass-minimum estimate (°C)
  air_min_c: number | null;   // 2 m air minimum (°C)
  hours_below_0: number;      // hours the canopy stayed below freezing
  severity?: "critical" | "alert" | "watch" | null;  // same tier the alert fires
}

export interface WeatherRegion {
  name: string;
  frost: RiskLevel;
  frost_detail?: FrostDetail | null;
  drought: RiskLevel;
  csi_30d?: number;
  csi_60d?: number;
  csi_30d_level?: string;
  csi_60d_level?: string;
}

export interface DailyRiskRow {
  region: string;
  days: DayRisk[];  // length 14
}

export interface DroughtDayDetail {
  date: string;
  vpd: number;           // kPa
  precip_prob: number;   // %
  soil_moisture: number; // m³/m³ root-zone weighted
  drought_risk: DayRisk;
}

// One forecast day's full frost physics for a region — the variables the model
// keyed on, so the 14-day frost grid can expand into a per-variable trend.
export interface FrostDayDetail {
  date: string;
  risk: DayRisk;
  frost_type: "none" | "radiative" | "advective" | "black";
  severity: "critical" | "alert" | "watch" | null;
  canopy_c: number | null;         // estimated canopy/grass-minimum (°C)
  air_min_c: number | null;        // 2 m air minimum (°C)
  dew_c: number | null;            // mean dew point (°C)
  cloud_pct: number | null;        // mean cloud cover (%)
  wind_kmh: number | null;         // peak 10 m wind (km/h)
  hours_below_0: number;           // hours canopy below freezing
  hours_below_hard: number | null; // hours below the −2 °C hard-freeze line
}

export interface FrostDetailRow {
  region: string;
  days: FrostDayDetail[];  // length 14
}

export interface DroughtDetailRow {
  region: string;
  days: DroughtDayDetail[];
}

// Current conditions from today's weather snapshot (replaces ForecastAccuracyPoint)
export interface CurrentCondition {
  region: string;
  temp_c: number;
  dew_point_c: number;
  cloud_cover_pct: number;
  wind_speed_kmh: number;
}

export interface OniHistoryPoint {
  month: string;      // "Oct-24"
  value: number;
  forecast?: boolean;
  preliminary?: boolean;
}

export interface OniForecastPoint {
  season: string;     // "MAM", "AMJ", …
  la_nina: number | null;
  neutral: number | null;
  el_nino: number | null;
}

export interface RegionalImpact {
  region: string;
  type: ImpactType;
  dots: number;       // 1–4
  note: string;
}

export interface FertilizerItem {
  name: string;
  price_usd_mt: number;
  mom_pct: number;
  sparkline: number[];   // 6 monthly prices, oldest first
  input_weight: number;
  base_usd_per_bag: number;
}

export interface FertilizerImportMonth {
  month: string;                    // "2026-01"
  urea_kt: number;
  kcl_kt: number;
  map_kt?: number;
  dap_kt?: number;
  an_kt?: number;
  as_kt?: number;
  superp_kt?: number;
  map_dap_kt: number;               // map + dap combined (backward compat)
  total_kt: number;
  total_fob_usd_m: number;
  urea_price_usd_mt:    number | null;
  kcl_price_usd_mt:     number | null;
  map_dap_price_usd_mt: number | null;
}

export interface CopLineItem {
  label: string;
  usd_per_ha?: number;
  usd_per_ton: number;
  family_usd_per_ha?: number;
  hired_usd_per_ha?: number;
  family_usd_per_ton?: number;
  hired_usd_per_ton?: number;
  note?: string;
  items?: CopLineItem[];
}

export interface CopSection {
  number: number;
  label: string;
  usd_per_ha?: number;   // absent for post-farm-gate sections (10+)
  usd_per_ton: number;
  family_usd_per_ha?: number;
  hired_usd_per_ha?: number;
  color: string;
  unit?: string;         // "USD/ton" for post-farm-gate sections
  note?: string;
  items: CopLineItem[];
}

export interface CostData {
  total_usd_per_bag: number;
  total_usd_per_ton?: number;
  total_usd_per_ton_excl_family?: number;
  fob_total_usd_per_ton?: number;
  yoy_pct: number;
  season_label: string;
  components: CostComponent[];
  inputs_detail: InputDetail[];
  sections?: CopSection[];
  kc_spot?: number | null;
  rc_spot?: number | null;
  last_updated: string;
}

export interface BalanceSeasonRow {
  season: string;
  type: "on" | "off";
  forecast: boolean;
  production: { usda: number; conab: number; cecafe: number };
  exports_ico: number;
  consumption: number;
}

export interface BalanceSheet {
  unit: string;
  note: string;
  seasons: BalanceSeasonRow[];
}

export interface FarmerEconomicsData {
  country: string;
  season: string;
  scraped_at: string;
  cost: CostData | null;
  cost_arabica: CostData | null;
  cost_conilon: CostData | null;
  acreage: { thousand_ha: number; yoy_pct: number; source_label: string } | null;
  yield:   { bags_per_ha: number; yoy_pct: number; source_label: string } | null;
  acreage_arabica: { thousand_ha: number; yoy_pct: number; source_label: string } | null;
  yield_arabica:   { bags_per_ha: number; yoy_pct: number; source_label: string } | null;
  acreage_conilon: { thousand_ha: number; yoy_pct: number; source_label: string } | null;
  yield_conilon:   { bags_per_ha: number; yoy_pct: number; source_label: string } | null;
  weather: {
    scraped_at: string;
    regions: WeatherRegion[];
    daily_frost: DailyRiskRow[];
    frost_drivers?: FrostDetailRow[];
    daily_drought: DailyRiskRow[];
    drought_detail?: DroughtDetailRow[];
    current_conditions: CurrentCondition[];
  } | null;
  enso: {
    phase: EnsoPhase;
    intensity: string;
    oni: number;
    peak_month: string;
    forecast_direction: string;
    oni_history: OniHistoryPoint[];
    oni_forecast: OniForecastPoint[];
    regional_impact: RegionalImpact[];
    historical_stat: string;
    last_updated: string;
  } | null;
  fertilizer: {
    items: FertilizerItem[];
    prices_as_of?: string;
    imports: {
      last_updated: string;
      monthly: FertilizerImportMonth[];
    } | null;
    import_origins?: Record<string, Record<string, {
      countries: { code: string; name: string; kg_kt: number; share: number }[];
      states: { name: string; kg_kt: number }[];
    }>>;
    dry_bulk?: {
      ticker: string;
      name: string;
      description: string;
      last_price: number;
      last_date: string;
      mom_pct: number | null;
      wow_pct: number | null;
      week52_low: number | null;
      week52_high: number | null;
      series: { date: string; close: number }[];
      first_date?: string;
      adjusted?: boolean;
      source: string;
    } | null;
    next_application: string;
  };
  balance_sheet?: BalanceSheet;
}
