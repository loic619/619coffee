// Types + presentation constants for the ENSO Intelligence tab (enso.json,
// written by backend/scraper/build_enso_intel.py).

export interface EnsoForecastSeason {
  season: string;   // 3-mo code, e.g. "MAM"
  la_nina: number;  // probability %
  neutral: number;
  el_nino: number;
}

export interface OniPoint {
  month?: string;
  value: number;
  preliminary?: boolean;
}

export interface OniLongPoint {
  year: number;
  month: number;
  label: string;
  value: number;
}

export interface AlignedPoint {
  offset: number;   // 0 == "now" (latest ONI month); negatives trail, positives forward
  value: number;
  label?: string;
}

export interface EnsoAnalog {
  year: number;
  mse: number;
  series: AlignedPoint[];
}

export type RiskLevel = "high" | "moderate" | "low";

export interface EnsoRiskPin {
  region: string;
  country: string;
  lat: number;
  lon: number;
  level: RiskLevel;
  color: string;
  driver: string;
  severity: number;
  /** Present only while the event is developing but not NOAA-confirmed. Such
   *  pins are capped at amber — see backend/scraper/enso_risk.py. */
  status?: "emerging";
  /** False when no measured response exists for this region — the pin is
   *  shown so the map does not silently shrink, but it is a gap, not a
   *  low-risk finding. */
  measured?: boolean;
  /** Months the ONI signal leads this region's rainfall response by. */
  lag_months?: number | null;
  lag_r?: number | null;
  /** Every crop phase the projected event's weather lands on, with the
   *  measured evidence behind each. This is what makes the colour auditable:
   *  the same anomaly is a severity-2 quality event at harvest and benign at
   *  cherry fill, and the reader can see which one drove the pin. */
  phase_hits?: EnsoPhaseHit[];
}

export interface EnsoPhaseHit {
  cycle: string;
  phase: "flowering" | "fruit_fill" | "harvest";
  months: number[];
  severity: number;
  driver: string;
  anomaly_pct: number | null;
  n: number;
  consistency: number | null;
}

export interface EnsoData {
  phase: string;
  /** How much the phase is to be trusted: "official" once NOAA's five-season
   *  rule is met, "emerging" while the ocean has clearly turned but the rule
   *  has not, "neutral" otherwise. NOAA's rule confirms an event four to five
   *  months after onset, which is longer than a flowering window — so the map
   *  reads the observed state and flags the confidence rather than waiting. */
  phase_status?: "official" | "emerging" | "neutral";
  /** What NOAA's rule alone would say — kept so the tab can show both. */
  official_phase?: string;
  /** One line explaining which test fired. */
  phase_basis?: string;
  /** Months the event is projected to stay active, "YYYY-MM". Its duration
   *  is what decides which crop phases it can reach. */
  event_months?: string[];
  /** Analogue-mean ONI path behind that projection, months 1..6 ahead. */
  event_forward_oni?: number[];
  /** Latest weekly Niño 3.4 SST anomaly; leads the ONI. */
  nino34?: { week_ending?: string; sst_anomaly?: number; phase?: string } | null;
  intensity: string;
  oni: number | null;
  peak_month: string | null;
  forecast_direction: string | null;
  oni_history: OniPoint[];
  oni_forecast: EnsoForecastSeason[];
  historical_stat: string | null;
  analogs: EnsoAnalog[];
  oni_history_long: OniLongPoint[];
  current_window: AlignedPoint[];
  risk: { pins: EnsoRiskPin[]; summary: Record<string, number> };
  last_updated: string | null;
}

export const PHASE_META: Record<string, { label: string; color: string }> = {
  "el-nino": { label: "El Niño", color: "#dc2626" },
  "la-nina": { label: "La Niña", color: "#3b82f6" },
  neutral:   { label: "Neutral", color: "#94a3b8" },
};

export const RISK_META: Record<RiskLevel, { label: string; color: string }> = {
  high:     { label: "High",     color: "#dc2626" },
  moderate: { label: "Moderate", color: "#f59e0b" },
  low:      { label: "Low",      color: "#16a34a" },
};

export function phaseLabel(phase: string): string {
  return PHASE_META[phase]?.label ?? phase;
}
