// Certified-stocks shared domain types (pure type declarations, no runtime).
// Extracted from CertifiedStocksSystemFlow so the math layer (grid / sim /
// poison) and the component can agree on one set of shapes.

import type { AgeBin, AgeDist } from "./age";

// (Source JSON shapes — RobustaSnap / RobustaGradingEvent etc. — live in
// ./shapes; this module holds the derived view/domain types.)

// ── Density-grid square ──────────────────────────────────────────────────────
export interface DensitySquare {
  status: "filled" | "gained" | "ghost" | "transit";
  origin: string;
  color: string;
  ageBin: AgeBin;
  warrants: number;            // effective warrants this square represents
  klass: number | null;        // Robusta C-contract class (1..4) — null for KC.
}

// Per-origin gross flow over the window. gross_in = sum of all positive daily
// deltas (or grading events for Robusta). gross_out = sum of all negative
// daily deltas. We derive net / lost / transit from these:
//   • net_delta = gross_in − gross_out
//   • net_gained = max(0, net_delta)            (showed up in current stock)
//   • lost      = max(0, −net_delta)            (disappeared, shown as ghost)
//   • transit   = min(gross_in, gross_out)      (arrived AND left within window)
// `transit` is the cohort-matched "in & out" amount (graded AND left in-window)
// when the backend can resolve it from ageing-report cohort shrinkage —
// overrides the min(gross_in, gross_out) heuristic in buildDensityGrid when
// present.
export interface OriginFlowPair { gross_in: number; gross_out: number; transit?: number }

export interface OriginFlow { origin: string; volume: number; color: string }

// ── Robusta per-port stock simulation result ─────────────────────────────────
export interface RobustaPortSim {
  state: Record<string, number>;
  inflowByOriginByDate:  Record<string, Record<string, number>>;
  outflowByOriginByDate: Record<string, Record<string, number>>;
}

// ── Poison stats ─────────────────────────────────────────────────────────────
export interface PoisonStats {
  pct:        number;   // 0..1 — share of standing stock flagged poison
  total:      number;   // volume (bags or lots) flagged poison
  aged:       number;   // contribution of the aged>1y criterion
  badOrigin:  number;   // contribution of bad-origin (Brazil / Conillon)
  deadPort:   number;   // contribution of dead-port (RC only)
  lowClass:   number;   // contribution of class 3/4 (RC only, inferred)
}

// ── Per-port flow card ───────────────────────────────────────────────────────
export interface PortFlow {
  market: "KC" | "RC";
  code: string;
  name: string;
  current: number;
  // Top of the gauge: the port's own all-time high, from the deep archives via
  // `port_peaks`. Falls back to the loaded window's max when a port has no
  // archived history — which is what every port used to use, and why a port at
  // a 15-month high read "100% full" no matter how small the number was.
  capacity: number;
  /** All-time low, the bottom of the gauge. 0 for most ports. */
  floor: number;
  /** When the all-time high was set, and how far back the history runs. */
  peakDate: string | null;
  historyFrom: string | null;
  /** True when capacity is a real archived peak rather than a window max. */
  peakIsHistorical: boolean;
  /** Position between floor and capacity, 0–100. */
  pctFull: number;
  unit: "bags" | "lots";
  squareUnit: number;            // bags-per-square or lots-per-square
  byOrigin: Record<string, number>;
  age: AgeDist;
  // Per-origin gross flows over the window — drives the four-bucket density
  // grid (existing / net-gained / lost / transited). Replaces the older
  // signed-delta-only model so we can surface intra-window churn.
  flowByOrigin: Record<string, OriginFlowPair>;
  // Per-origin C-contract class mix (Robusta only). Tagged on each square
  // so a hover reveals "Class 2 (−30)" etc. and the border colour reflects
  // the class differential.
  classShares?: Record<string, Record<number, number>>;
  inflow: OriginFlow[];
  outflow: OriginFlow[];
  // Display sizing — assigned after all ports are computed. Card spans
  // 1–4 columns of a 12-col container grid based on capacity-rank (sqrt-
  // scaled so small ports don't collapse to invisible). Density grid
  // inside each card uses span × 3 columns.
  span: 1 | 2 | 3 | 4;
  // Poison stats — share + per-criterion breakdown for the card header.
  poison: PoisonStats;
}
