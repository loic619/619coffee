// Certified-stocks density-grid math (pure). One square ≈ one ICE warrant.
//
// Each square targets one ICE warrant. Tunable cap so giant ports (ANT at
// 1k+ arabica warrants, LON at 1.7k robusta lots) don't blow up the DOM —
// when a port exceeds the cap we scale uniformly across {existing, gained,
// ghost} groups and surface the effective per-square volume in the click
// popover so the visual stays honest.
// DENSITY_COLS is now per-card: `p.span * 3` (span ∈ 1-4 → cols ∈ 3-12).
// HARD RULE — never compromise: 1 square = exactly 1 ICE warrant.
//   • Robusta: 1 warrant = 1 lot = 10 MT.
//   • Arabica: 1 warrant = 37,500 lb = 17.009 MT ≈ 283.49 bags @ 60 kg.
// The cap that used to scale down giant ports has been raised to a value
// large enough that we never hit it in practice (max historical robusta
// peak ≈ 12k lots). Cards grow as tall as the data demands — the user
// chose accuracy over compactness.

import { AGE_BIN_ORDER, type AgeBin, type AgeDist } from "./age";
import { _originColor } from "./colors";
import type { DensitySquare, OriginFlowPair, PortFlow } from "./types";

export const DENSITY_MAX_SQUARES = 20000;
export const BAGS_PER_WARRANT_KC = (37_500 * 0.45359237) / 60;   // ≈ 283.49
export const LOTS_PER_WARRANT_RC = 1;

// Robusta-class contour colours (1px inset border). Class 1 = par (no
// border, the cleanest visual), faded yellow / orange / red walk down
// the differential ladder (-30 / -60 / -90). Class P (premium, +30)
// would be green when the source feed starts emitting it.
export const CLASS_BORDER_RC: Record<number, string> = {
  2: "rgba(250, 204, 21, 0.65)",  // faded yellow (-30)
  3: "rgba(249, 115, 22, 0.95)",  // orange       (-60)
  4: "rgba(239, 68, 68, 0.98)",   // red          (-90)
};
export const CLASS_LABEL_RC: Record<number, string> = {
  1: "Class 1 (par)",
  2: "Class 2 (−30)",
  3: "Class 3 (−60)",
  4: "Class 4 (−90)",
};

// Per-card grid sizing. Hard rule (locked at user's request):
//   • Arabica : Robusta square size stays in the ratio √(17 MT / 10 MT) ≈ 1.30
//     so the square area scales with the contract's warrant volume (Arabica
//     17 MT lot vs Robusta 10 MT lot).
//   • Sizes halved from the original 17/13 px at the user's request — the
//     full-size grids overflowed the warehouse cards on narrow screens (a
//     26-wide Antwerp grid was ~442 px, past a phone's width). Half size keeps
//     the same relative areas while fitting the card.
// cols = ceil(√squares) keeps the grid square-ish; cards grow to fit and
// the parent row wraps. This means visual area is comparable across
// warehouses and contracts — one Antwerp lot covers the same number of
// pixels regardless of how many lots Antwerp holds.
export const CELL_PX_KC = 8.5;
export const CELL_PX_RC = 6.5;
export const _gridCols = (squares: number) => (squares <= 0 ? 4 : Math.max(4, Math.ceil(Math.sqrt(squares))));
export const _rowsForCount = (n: number, cols: number) => (n <= 0 ? 0 : Math.ceil(n / cols));

// ── Density-grid formulas ────────────────────────────────────────────────────
//
// Per port, over a chosen window:
//
//   • Per origin we know two gross flows:
//       gross_in[o]  = lots arriving in the window
//       gross_out[o] = lots leaving in the window
//
//   • Per-origin invariant (mass balance):
//       base[o] + gross_in[o] − gross_out[o]  =  cur[o]
//     so:
//       net_delta[o] = gross_in[o] − gross_out[o]
//
//   • Buckets rendered on the card:
//       net_gained[o] = max(0,  net_delta[o])      arrived and still here
//       lost[o]       = max(0, −net_delta[o])      were here, gone now
//       transited[o]  = min(gross_in[o], gross_out[o])   arrived AND left
//
//   • Existing portion (the colored grid above the dashed boxes):
//       existing[o]   = max(0, cur[o] − net_gained[o])
//     i.e. what's still on hand from before the window started.
//
//   • Port-level invariant:
//       current = existing_total + net_gained_total
//       gross_in_total  = net_gained_total + transited_total
//       gross_out_total = lost_total        + transited_total
//
// How gross_in / gross_out are sourced:
//
//   Arabica (KC) — we walk every snapshot in the window and read
//   `total_certified.by_origin[o].by_port[p]` directly. Positive daily
//   deltas at (p, o) accumulate into gross_in[o], negative into gross_out[o].
//
//   Robusta (RC) — see _simulateRobustaPortStock (lib/certifiedStocks/sim).
//   ─────────────────────────────────────────────────────────────────────────

// Helper — distribute `count` squares across origins proportionally and
// stamp each with an age bin sampled from the age distribution. For
// Robusta squares an optional `originClassShares` lets us also stamp
// each square's C-contract class (1..4) proportionally to that
// origin's class mix recorded in gradings at the port.
export function _allocSquares(
  count: number,
  byOrigin: Record<string, number>,
  age: AgeDist,
  status: DensitySquare["status"],
  perSquareWarrants: number,
  market: "KC" | "RC",
  originClassShares?: Record<string, Record<number, number>>,
): DensitySquare[] {
  if (count <= 0) return [];
  const origins = Object.entries(byOrigin).filter(([, v]) => v > 0);
  const total = origins.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return [];

  const originPool: string[] = [];
  for (const [origin, v] of origins) {
    const n = Math.round(count * (v / total));
    for (let i = 0; i < n; i++) originPool.push(origin);
  }
  while (originPool.length < count) originPool.push(origins[0][0]);
  while (originPool.length > count) originPool.pop();

  const agePool: AgeBin[] = [];
  for (const bin of AGE_BIN_ORDER) {
    const n = Math.round(count * age[bin]);
    for (let i = 0; i < n; i++) agePool.push(bin);
  }
  while (agePool.length < count) agePool.push("fresh");
  while (agePool.length > count) agePool.pop();

  // Per-square class assignment (Robusta only). Group indices by origin,
  // then partition each origin's slot of the pool proportionally to its
  // gradings-derived class mix; the leftover fills with class 1 (par).
  const klassByIdx: (number | null)[] = new Array(count).fill(null);
  if (market === "RC" && originClassShares) {
    const indicesByOrigin: Record<string, number[]> = {};
    originPool.forEach((o, i) => {
      indicesByOrigin[o] = indicesByOrigin[o] || [];
      indicesByOrigin[o].push(i);
    });
    for (const [origin, indices] of Object.entries(indicesByOrigin)) {
      const shares = originClassShares[origin] ?? {};
      const classes = Object.entries(shares)
        .map(([k, v]) => [Number(k), v] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      let assigned = 0;
      for (const [cls, share] of classes) {
        const n = Math.round(indices.length * share);
        for (let j = 0; j < n && assigned < indices.length; j++) {
          klassByIdx[indices[assigned]] = cls;
          assigned++;
        }
      }
      while (assigned < indices.length) {
        klassByIdx[indices[assigned]] = 1;
        assigned++;
      }
    }
  }

  return originPool.map((origin, i) => ({
    status,
    origin,
    color: _originColor(origin, market),
    ageBin: agePool[i] ?? "fresh",
    warrants: perSquareWarrants,
    klass: klassByIdx[i],
  }));
}

// Build the four sub-grids for one port from per-origin gross flows:
//   • `existing`   — what's still here from before the window started
//                    (current − net-gained). Inherits the port's age mix.
//   • `netGained`  — net new warrants added over the window (sum of per-
//                    origin max(0, in−out)). Green dashed border, fresh.
//   • `ghosts`     — net warrants that disappeared (sum of per-origin
//                    max(0, out−in)). Red dashed border.
//   • `transited`  — coffee that arrived AND left within the window
//                    (sum of per-origin min(in, out)). Amber dashed,
//                    fresh — these never show up in current stock.
//
// Invariant: current = existing + netGained, so the visible current stock
// is exactly `existing` + `netGained`. `ghosts` and `transited` sit
// alongside as window-only ghost groups.
export function buildDensityGrid(
  current: number,
  byOrigin: Record<string, number>,
  age: AgeDist,
  flowByOrigin: Record<string, OriginFlowPair>,
  unit: number,
  market: "KC" | "RC",
  originClassShares?: Record<string, Record<number, number>>,
  // When true an ageing report inside the window lets us match cohorts, so we
  // can separate stock that arrived AND left (transited / "in & out"). When
  // false every inflow is "in" and every outflow is "out" — no in & out, the
  // model's pre-ageing-report state.
  cohortMatched: boolean = true,
): {
  existing:  DensitySquare[];
  netGained: DensitySquare[];
  ghosts:    DensitySquare[];
  transited: DensitySquare[];
  // Volume breakdown per origin for each bucket. Drives the small
  // top-origin chip strip beneath each sub-grid header.
  byOriginExisting:  Record<string, number>;
  byOriginNetGained: Record<string, number>;
  byOriginGhost:     Record<string, number>;
  byOriginTransit:   Record<string, number>;
  // Raw volume per bucket (bags for KC, lots for RC). Square counts are
  // ceil'd to whole warrants for visual integrity, so the headline label
  // must use these to avoid a rounding inflation (e.g. 500 lost bags
  // → 2 warrants → 567 bags via the warrant count).
  netGainedVol: number;
  lostVol:      number;
  transitVol:   number;
  effectivePerSquare: number;
  totalWarrants: number;
} {
  // 1. Decompose per-origin gross flows into net / lost / transit volumes.
  let netGainedVol = 0, lostVol = 0, transitVol = 0;
  const netGainedByOrigin: Record<string, number> = {};
  const ghostByOrigin:     Record<string, number> = {};
  const transitByOrigin:   Record<string, number> = {};
  for (const [origin, f] of Object.entries(flowByOrigin)) {
    const tIn  = Math.max(0, f.gross_in);
    const tOut = Math.max(0, f.gross_out);
    if (cohortMatched) {
      // Ageing report matched → split the overlap (arrived AND left) out as
      // transited. Prefer the backend's cohort-resolved transit (outflow from
      // cohorts graded in-window); fall back to min(in, out) when it's absent.
      // Clamp to [0, min(in, out)] so net-gained / lost stay non-negative.
      const tr = Math.max(0, Math.min(
        origin in flowByOrigin && flowByOrigin[origin].transit != null
          ? (flowByOrigin[origin].transit as number)
          : Math.min(tIn, tOut),
        tIn, tOut,
      ));
      const ng = tIn - tr;   // pure in (graded and stayed)
      const lo = tOut - tr;  // pure out (legacy decertifications)
      if (ng > 0) { netGainedByOrigin[origin] = ng; netGainedVol += ng; }
      if (lo > 0) { ghostByOrigin[origin]     = lo; lostVol      += lo; }
      if (tr > 0) { transitByOrigin[origin]   = tr; transitVol   += tr; }
    } else {
      // No ageing report yet → we cannot tell which inflow also left, so all
      // inflow is "in" and all outflow is "out" (no in & out). This is what
      // keeps freshly-graded lots visible instead of netting them against
      // same-window decertifications.
      if (tIn  > 0) { netGainedByOrigin[origin] = tIn;  netGainedVol += tIn;  }
      if (tOut > 0) { ghostByOrigin[origin]     = tOut; lostVol      += tOut; }
    }
  }

  const totalWarrants    = Math.max(0, Math.ceil(current / unit));
  const netGainedWarrants = Math.max(0, Math.ceil(netGainedVol / unit));
  const lostWarrants      = Math.max(0, Math.ceil(lostVol      / unit));
  const transitWarrants   = Math.max(0, Math.ceil(transitVol   / unit));
  const existingWarrants  = Math.max(0, totalWarrants - netGainedWarrants);

  // 2. Uniform scale-down if the grand total of squares would overflow.
  const grand = existingWarrants + netGainedWarrants + lostWarrants + transitWarrants;
  void market;
  const scale = grand > DENSITY_MAX_SQUARES ? DENSITY_MAX_SQUARES / grand : 1;
  const existingShown  = Math.round(existingWarrants  * scale);
  const netGainedShown = Math.round(netGainedWarrants * scale);
  const lostShown      = Math.round(lostWarrants      * scale);
  const transitShown   = Math.round(transitWarrants   * scale);
  const effectivePerSquare = scale === 1 ? 1 : 1 / scale;

  // 3. Existing origin shares = byOrigin minus per-origin net-gained.
  const existingByOrigin: Record<string, number> = {};
  for (const [origin, v] of Object.entries(byOrigin)) {
    const ng = netGainedByOrigin[origin] ?? 0;
    existingByOrigin[origin] = Math.max(0, v - ng);
  }

  // 4. Stamp squares. Existing inherits the port's age mix; net-gained and
  // transit are fresh by definition; ghosts have no surviving age info.
  const FRESH_ONLY: AgeDist = { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
  const existing  = _allocSquares(existingShown,  existingByOrigin,  age,        "filled",  effectivePerSquare, market, originClassShares);
  const netGained = _allocSquares(netGainedShown, netGainedByOrigin, FRESH_ONLY, "gained",  effectivePerSquare, market, originClassShares);
  const ghosts    = _allocSquares(lostShown,      ghostByOrigin,     FRESH_ONLY, "ghost",   effectivePerSquare, market, originClassShares);
  const transited = _allocSquares(transitShown,   transitByOrigin,   FRESH_ONLY, "transit", effectivePerSquare, market, originClassShares);

  return {
    existing, netGained, ghosts, transited,
    byOriginExisting:  existingByOrigin,
    byOriginNetGained: netGainedByOrigin,
    byOriginGhost:     ghostByOrigin,
    byOriginTransit:   transitByOrigin,
    netGainedVol, lostVol, transitVol,
    effectivePerSquare, totalWarrants,
  };
}

// Card-width spans (1–4 of a 12-col container). Sqrt scaling so a port at
// 5% of max capacity still gets span 1 (visible) rather than collapsing.
// Top-8 sum ≤ 12 typically; if it overflows the container grid wraps.
export function _assignSpans(ports: PortFlow[]): void {
  if (ports.length === 0) return;
  const maxCap = Math.max(...ports.map((p) => p.capacity));
  for (const p of ports) {
    const r = maxCap > 0 ? Math.sqrt(p.capacity / maxCap) : 0;
    const raw = Math.round(4 * r);
    p.span = Math.max(1, Math.min(4, raw)) as 1 | 2 | 3 | 4;
  }
}
