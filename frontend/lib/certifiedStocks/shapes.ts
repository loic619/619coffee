// Certified-stocks source JSON shapes (a subset of the rich panel types) and
// the one pure normaliser the flow builders share. Mirrors the backend
// scraper output (orchestrate.py + cohort_outflow.py).

import { _canonicalKC } from "./ports";

// ── Arabica (KC) ─────────────────────────────────────────────────────────────
export interface ArabicaSectionHierarchy {
  grand_total: number;
  by_port: Record<string, number>;
  by_origin: Record<string, { by_port: Record<string, number>; group: string; total: number }>;
}
// Per-(origin, port) grading detail. Two equivalent shapes are accepted:
//   • live scraper  — passed_by_origin / failed_by_origin:
//       { origin: { by_port: { code: bags }, group?, total? } }
//   • xlsx importer — graded_today_by_port_origin (sheet 6_ny_gradings):
//       { port: { origin: { passed: bags, failed: bags } } }
// Present only on action days; older "N Bags Passed Today" days carry only
// the scalar passed_today_bags.
export type ArabicaGradingByOrigin = Record<string, { by_port: Record<string, number>; group?: string; total?: number }>;
export type ArabicaGradingByPortOrigin = Record<string, Record<string, { passed?: number; failed?: number }>>;
export interface ArabicaSnap {
  date: string;
  total_bags: number;
  passed_today_bags?: number;
  failed_today_bags?: number;
  pending_grading_bags?: number;
  by_port?: Record<string, number>;
  sections?: { total_certified?: ArabicaSectionHierarchy; pending_grading?: ArabicaSectionHierarchy };
  passed_by_origin?: ArabicaGradingByOrigin;
  failed_by_origin?: ArabicaGradingByOrigin;
  graded_today_by_port_origin?: ArabicaGradingByPortOrigin;
}

// Normalise either snapshot shape into passed bags per (canonical port, origin).
// Returns null when the day carries no per-origin grading detail at all.
export function _arabicaPassedByPortOrigin(s: ArabicaSnap): Array<[string, string, number]> | null {
  const out: Array<[string, string, number]> = [];
  if (s.passed_by_origin) {
    for (const [origin, od] of Object.entries(s.passed_by_origin))
      for (const [p, bags] of Object.entries(od.by_port ?? {}))
        if (bags) out.push([_canonicalKC(p), origin, bags]);
    return out;
  }
  if (s.graded_today_by_port_origin) {
    for (const [p, byO] of Object.entries(s.graded_today_by_port_origin))
      for (const [origin, st] of Object.entries(byO))
        if (st?.passed) out.push([_canonicalKC(p), origin, st.passed]);
    return out;
  }
  return null;
}
export interface ArabicaAgeBucketRow { age_bucket: string; bags: number }
// Monthly ageing report — the per-origin × age-band cohort snapshot. Drives
// `cohortMatched` for Arabica: in & out (transited) is only surfaced when a
// usable report's month_end falls inside the window (so cohorts can be matched).
export interface ArabicaAgeingReport {
  month_end?: string | null;
  by_origin_band?: Record<string, Record<string, number>> | null;
  grand_total?: number | null;
}
// Per-port all-time extremes, reduced from the deep archives by the exporter so
// the browser gets the scale without downloading ~800 KB of history.
//
// Latched: computed once from the deepest history available, then only ever
// ratcheted outward when stocks exceed a stored extreme. An extreme is a fact
// about the past, so nothing else may move it — recomputing each run would make
// a permanent value hostage to an archive read that might fail.
export interface PortPeak {
  min: number; min_date?: string | null;
  max: number; max_date?: string | null;
  first_seen?: string | null; last_seen?: string | null;
  observations?: number;
  /** Present once the value is latched; only a new extreme moves it. */
  locked?: boolean;
}

export interface ArabicaJsonShape {
  snapshots: ArabicaSnap[];
  as_of?: string | null;
  latest_detail?: { age_detail?: Record<string, ArabicaAgeBucketRow[]>; age_detail_date?: string | null } | null;
  ageing_report?: ArabicaAgeingReport | null;
  port_peaks?: Record<string, PortPeak>;
}

// ── Robusta (RC) ─────────────────────────────────────────────────────────────
export interface RobustaSnap { date: string; total_lots_certified: number; by_port_lots?: Record<string, number> }
export interface RobustaGradingEntry { port?: string; origin?: string; class?: number | null; tenderable?: boolean; lots: number }
export interface RobustaGradingEvent { date: string; entries?: RobustaGradingEntry[] }
export interface RobustaAgeBucket { months_since_graded: number; by_port: Record<string, number>; grand_total_mt: number }
export interface RobustaAgeMonth  { month_end: string; valid?: { ports?: string[]; buckets?: RobustaAgeBucket[] } | null }
export interface RobustaOverviewEvent { date: string; total_pending_lots?: number | null; queue_lots?: number | null; forecast_lots?: number | null }
// Output of the cohort-DNA pipeline (backend cohort_outflow.py). When
// present these drive the system flow's per-origin buckets; missing →
// we fall back to the in-browser stock simulation.
export interface ImpliedOutflowMonth {
  month_end: string;
  by_port: Record<string, Record<string, number>>;
  // Subset of by_port that is "in & out": outflow from cohorts graded inside
  // this same month-end interval (arrived AND left). by_port_transit ⊆ by_port.
  by_port_transit?: Record<string, Record<string, number>>;
}
export interface RobustaJsonShape {
  snapshots: RobustaSnap[];
  as_of?: string | null;
  monthly?: {
    age_allowance?: RobustaAgeMonth[];
    implied_outflow?: ImpliedOutflowMonth[];
    current_by_origin?: Record<string, Record<string, number>>;
  };
  recent_activity?: { gradings?: RobustaGradingEvent[]; grading_overview?: RobustaOverviewEvent[] };
  port_origin_history?: Record<string, Record<string, { tenderable: number; class34: number }>>;
  port_peaks?: Record<string, PortPeak>;
}
