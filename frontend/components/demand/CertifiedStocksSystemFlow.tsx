"use client";
/**
 * Certified Stocks System Flow — production component
 *
 * Renders two end-to-end workflows (Arabica + Robusta):
 *   Grading intake → branched arrows → per-warehouse density grids
 *   → gained/ghost change boxes → outflow indicators.
 *
 * Originally prototyped in CertifiedStocksTestPanel; promoted here once the
 * layout, poison-rule logic, and full-history origin inference were
 * verified. Consumes the same JSON shape the panel already loads — pass
 * arabica + robusta JSON in as props.
 */
import { useEffect, useMemo, useState } from "react";
import { fmtNum, _fmtUnit, unitWord, type FlowUnit } from "@/lib/certifiedStocks/units";
import { AGE_OPACITY, AGE_LABEL, AGE_BIN_ORDER, type AgeBin } from "@/lib/certifiedStocks/age";
import { KC_ORIGIN_COLORS, RC_ORIGIN_COLORS, _originColor } from "@/lib/certifiedStocks/colors";
import { type DensitySquare } from "@/lib/certifiedStocks/types";
import {
  CLASS_BORDER_RC, CLASS_LABEL_RC, CELL_PX_KC, CELL_PX_RC,
  _rowsForCount, buildDensityGrid,
} from "@/lib/certifiedStocks/grid";
import { type ArabicaJsonShape, type RobustaJsonShape } from "@/lib/certifiedStocks/shapes";
import { buildArabica, buildRobusta, type SystemFlowMarket } from "@/lib/certifiedStocks/builders";


// ── Flow range selector ──────────────────────────────────────────────────────
// The period is a [start, end] window. `end` is a free calendar pick that
// defaults to the latest available data date; `start` is chosen from a small
// menu computed *relative to end*: one week back, or the 1st of end's month
// (month-to-date — the default view) and the 1st of each earlier month, back
// to the first month we hold data for. Both ends are anchored to real data
// dates (never the wall clock) so a window is never empty.

// Period-window helpers live in lib/certifiedStocks/window (shared with the
// panel). Re-exported here for existing importers.
export {
  parseFlowISO, flowDateISO, flowAnchor, flowDateBounds, flowStartOptions,
  FLOW_START_DEFAULT, type FlowStartOpt,
} from "@/lib/certifiedStocks/window";


// ── Main test panel ──────────────────────────────────────────────────────────


// ── systemFlows memo body (lifted from test panel) ──


// ── Component body ─────────────────────────────────────────────────────────

// Tiny lucide-style truck SVG, parked at the right end of each ↓out
// conveyor strip so the visual reads as "stock flowing out to a buyer".
const IconTruck = (p: { className?: string }) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);

interface Props {
  arabica: ArabicaJsonShape | null;
  robusta: RobustaJsonShape | null;
  // Flow range + display unit are owned by the parent panel (rendered up by
  // the metric toggle) and passed down so both stay in sync. `start`/`end`
  // are the window bounds (local-midnight Dates).
  start: Date;
  end: Date;
  unit: FlowUnit;
}

export default function CertifiedStocksSystemFlow({ arabica, robusta, start, end, unit }: Props) {
  const fmtU = (v: number, native: "bags" | "lots") => _fmtUnit(v, native, unit);
  // Hover-only inspector — no click state. The tooltip pops out of the
  // square the mouse is over and renders origin / age / (Robusta) class.
  const [hoveredSquare, setHoveredSquare] = useState<{
    market: "KC" | "RC"; portName: string;
    origin: string; ageBin: AgeBin; klass: number | null;
    status: DensitySquare["status"];
    anchorLeft: number; anchorTop: number;     // viewport pixels
  } | null>(null);

  // Inject the flowing-dash keyframes once, the same way the map's
  // logistics routes get their animation. Lives in document.head so it
  // survives re-renders and doesn't compound when this component re-mounts.
  useEffect(() => {
    if (document.getElementById("cs-flow-anim")) return;
    const s = document.createElement("style");
    s.id = "cs-flow-anim";
    s.textContent = `
      @keyframes csFlowDash { to { stroke-dashoffset: -10; } }
      .cs-flow      { stroke-dasharray: 2.4 1.4; animation: csFlowDash 1.6s linear infinite; }
      .cs-flow-slow { stroke-dasharray: 3.2 1.8; animation: csFlowDash 2.2s linear infinite; }
      /* Mini conveyor — animates per-card "out" boxes from left edge to
         right edge of the outflow indicator strip. Same look-and-feel as
         the cohort-explainer conveyor on the test tab, scaled down. */
      @keyframes csConveyorMini {
        0%   { left: 0%;                opacity: 0; }
        15%  {                           opacity: 1; }
        85%  {                           opacity: 1; }
        100% { left: calc(100% - 5px);  opacity: 0; }
      }
      .cs-conveyor-mini { animation: csConveyorMini 1.8s linear infinite; }
    `;
    document.head.appendChild(s);
  }, []);

  // Resolve both markets' flows from the raw JSON. The heavy lifting lives in
  // lib/certifiedStocks/builders (pure, unit-tested); this component only
  // renders the result.
  const systemFlows = useMemo<{ kc: SystemFlowMarket; rc: SystemFlowMarket }>(
    () => ({ kc: buildArabica(arabica, start, end), rc: buildRobusta(robusta, start, end) }),
    [arabica, robusta, start, end],
  );

  return (
    <div>
      <div className="pb-2 border-b border-slate-800 mb-4">
        <h3 className="text-base font-bold text-slate-100">
          Certified stocks system flow
          <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-2">arabica + robusta</span>
        </h3>
      </div>

      {/* Shared legend — colour scheme summary + age + change groups */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 text-[10px] bg-slate-950 px-3 py-2 rounded border border-slate-800">
        <details className="cursor-pointer">
          <summary className="text-slate-500 uppercase tracking-wider hover:text-slate-300">
            Origin scheme · click to expand
          </summary>
          <div className="mt-2 space-y-2 max-w-3xl">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-amber-400 font-bold mb-1">Arabica (KC) — by C-contract group</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {[
                  { label: "G0 · LA",  example: "Honduras",        color: KC_ORIGIN_COLORS["Honduras"] },
                  { label: "G0 · AS",  example: "Papua New Guinea",color: KC_ORIGIN_COLORS["Papua New Guinea"] },
                  { label: "G0 · AF",  example: "Kenya",           color: KC_ORIGIN_COLORS["Kenya"] },
                  { label: "G1",       example: "Colombia",        color: KC_ORIGIN_COLORS["Colombia"] },
                  { label: "G2",       example: "Burundi",         color: KC_ORIGIN_COLORS["Burundi"] },
                  { label: "G3",       example: "Ecuador",         color: KC_ORIGIN_COLORS["Ecuador"] },
                  { label: "G4",       example: "Brazil",          color: KC_ORIGIN_COLORS["Brazil"] },
                ].map((g) => (
                  <span key={g.label} className="flex items-center text-slate-300">
                    <span className="w-2.5 h-2.5 rounded mr-1" style={{ background: g.color }} />
                    <span className="font-mono text-slate-400 mr-1">{g.label}</span>{g.example}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold mb-1">Robusta (RC) — by region</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {[
                  { label: "Vietnam",   color: RC_ORIGIN_COLORS["Vietnam"] },
                  { label: "Indonesia", color: RC_ORIGIN_COLORS["Indonesia"] },
                  { label: "Brazil",    color: RC_ORIGIN_COLORS["Brazil"] },
                  { label: "African",   color: RC_ORIGIN_COLORS["Uganda"] },
                  { label: "Other AS",  color: RC_ORIGIN_COLORS["India"] },
                ].map((g) => (
                  <span key={g.label} className="flex items-center text-slate-300">
                    <span className="w-2.5 h-2.5 rounded mr-1" style={{ background: g.color }} />
                    {g.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </details>
        <span className="text-slate-700 mx-1">|</span>
        <span className="text-slate-500 uppercase">Age (fade):</span>
        {AGE_BIN_ORDER.map((bin) => (
          <span key={bin} className="flex items-center text-slate-300">
            <span className="w-2 h-2 rounded mr-1 bg-white" style={{ opacity: AGE_OPACITY[bin] }} />
            {AGE_LABEL[bin]}
          </span>
        ))}
        <span className="text-slate-700 mx-1">|</span>
        <span className="text-slate-500 uppercase">Change:</span>
        <span className="flex items-center text-slate-300">
          <span className="w-3 h-3 rounded mr-1 border border-dashed border-emerald-400 bg-emerald-950/50" />
          net gained
        </span>
        <span className="flex items-center text-slate-300">
          <span className="w-3 h-3 rounded mr-1 border border-dashed border-rose-400 bg-rose-950/50" />
          lost
        </span>
        <span className="flex items-center text-slate-300" title="stock that arrived AND left within the window — never showed up in current stock">
          <span className="w-3 h-3 rounded mr-1 border border-dashed border-amber-400 bg-amber-950/50" />
          in & out (transited)
        </span>
        <span className="text-slate-700 mx-1">|</span>
        <span className="text-slate-500 uppercase">1 ◻ =</span>
        <span className="flex items-center text-slate-300">KC: 1 warrant = 37,500 lb (17.009 MT ≈ 283 bags) · RC: 1 lot (10 MT)</span>
        <span className="text-slate-700 mx-1">|</span>
        <span className="text-slate-500 uppercase" title="Robusta C-contract class — apportioned to each square from each origin's class mix at the port">RC class:</span>
        <span className="flex items-center text-slate-300" title="par (0 differential)">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" /> 1 (par)
        </span>
        <span className="flex items-center text-slate-300" title="−30 differential">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" style={{ boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[2]}` }} /> 2 (−30)
        </span>
        <span className="flex items-center text-slate-300" title="−60 differential">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" style={{ boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[3]}` }} /> 3 (−60)
        </span>
        <span className="flex items-center text-slate-300" title="−90 differential">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" style={{ boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[4]}` }} /> 4 (−90)
        </span>
      </div>

      {([systemFlows.kc, systemFlows.rc] as SystemFlowMarket[]).map((mkt) => (
        <div key={mkt.market} className="mb-8">
          <div className={`text-xs uppercase tracking-wider font-bold mb-3 ${mkt.market === "KC" ? "text-amber-400" : "text-emerald-400"}`}>
            {mkt.label}
            {mkt.market === "RC" && (
              <span className="ml-2 text-[10px] text-slate-500 normal-case font-normal">
                origin per port inferred from gradings flow*
              </span>
            )}
            {/* How in & out is derived for this market. */}
            <span
              className={`ml-2 text-[10px] normal-case font-normal ${mkt.inOutBasis === "none" ? "text-slate-500" : "text-amber-400/80"}`}
              title={
                mkt.inOutBasis === "fifo"
                  ? "in & out from the exact daily per-(origin, port) ledger: in = gradings, out = mass balance, in & out = FIFO (oldest warrants leave first). The monthly ageing report has no origin column, so it powers the age fade and validates this ledger."
                  : mkt.inOutBasis === "ageing"
                  ? "An ageing report inside this window lets us cohort-match outflow — stock graded AND decertified in-window is split out as in & out."
                  : "No ageing report inside this window yet — every passed lot counts as in and the decline as out; in & out is matched once the next ageing report lands."
              }
            >
              · {mkt.inOutBasis === "fifo"
                  ? "in & out · daily per-origin ledger (FIFO)"
                  : mkt.inOutBasis === "ageing"
                  ? "in & out matched (ageing report)"
                  : "in & out pending next ageing report"}
            </span>
          </div>

          {/* Stage 1 — intake row */}
          {!mkt.intake ? (
            <div className="text-xs text-slate-600 italic mb-3">No intake data loaded.</div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 mb-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                <span>⊕</span>Stage 1 · grading intake
                {mkt.intake.date && <span className="font-mono normal-case text-slate-600 ml-1">{mkt.intake.date}</span>}
              </div>
              <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-5">
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Pending</div>
                  <div className="w-16 h-16 rounded-full bg-amber-950/40 border-2 border-amber-700/60 flex items-center justify-center">
                    <span className="text-sm font-mono font-bold text-amber-300">{fmtU(mkt.intake.pending, mkt.unit)}</span>
                  </div>
                </div>
                <span className="hidden md:block w-6 h-px bg-slate-700" />
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Graded</div>
                  <div className="w-20 h-20 rounded-full bg-indigo-900/40 border-2 border-indigo-500 flex items-center justify-center"
                       style={{ boxShadow: "0 0 12px rgba(99,102,241,0.18)" }}>
                    <span className="text-base font-mono font-bold text-indigo-200">{fmtU(mkt.intake.passed + mkt.intake.failed, mkt.unit)}</span>
                  </div>
                </div>
                <span className="hidden md:block w-6 h-px bg-slate-700" />
                <div className="flex flex-col gap-1 w-full md:w-auto md:min-w-[220px]">
                  <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/60 px-2 py-1 rounded">
                    <span className="text-[10px] text-emerald-300">✓ Premium</span>
                    <span className="font-mono font-bold text-sm text-emerald-300">{fmtU(mkt.intake.passedPremium, mkt.unit)}</span>
                  </div>
                  <div className="flex items-center justify-between bg-amber-950/40 border border-amber-800/60 px-2 py-1 rounded">
                    <span className="text-[10px] text-amber-300">⚠ Borderline</span>
                    <span className="font-mono font-bold text-sm text-amber-300">{fmtU(mkt.intake.passedBorderline, mkt.unit)}</span>
                  </div>
                  <div className="flex items-center justify-between bg-rose-950/40 border border-rose-800/60 px-2 py-1 rounded">
                    <span className="text-[10px] text-rose-300">✕ Failed</span>
                    <span className="font-mono font-bold text-sm text-rose-300">{fmtU(mkt.intake.failed, mkt.unit)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Grading-intake → warehouses conveyor. Replaces the previous
              SVG manifold tree with a single horizontal conveyor that mirrors
              the per-port ↓in / ↓out strips — boxes flow left-to-right from
              the intake stage to the warehouse row, coloured by the dominant
              origins arriving in the window. Hidden when no passed graded
              coffee landed in this window. */}
          {mkt.ports.length > 0 && (() => {
            const visible = mkt.ports.slice(0, 8);
            if (visible.length === 0) return null;
            // Aggregate inflow across visible ports and pick the dominant
            // origins for the box-colour cycle.
            const totals: Record<string, { volume: number; color: string }> = {};
            for (const p of visible) {
              for (const o of p.inflow) {
                totals[o.origin] = totals[o.origin] || { volume: 0, color: o.color };
                totals[o.origin].volume += o.volume;
              }
            }
            const totalInflow = Object.values(totals).reduce((a, b) => a + b.volume, 0);
            // Nothing passed grading in this window → no conveyor.
            if (totalInflow <= 0) return null;
            const topOrigins = Object.entries(totals)
              .sort(([, a], [, b]) => b.volume - a.volume)
              .slice(0, 4)
              .map(([, v]) => v);
            const colors = topOrigins.length > 0 ? topOrigins : [{ volume: 0, color: "#10b981" }];
            return (
              <div className="my-2 flex items-stretch gap-2">
                {/* Source badge */}
                <div className="flex flex-col items-center justify-center px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[9px] text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  Grading intake
                </div>
                {/* Conveyor — flex-grow so it stretches with the row */}
                <div className="relative flex-1 h-10 bg-slate-900/40 border border-slate-800 rounded overflow-hidden">
                  {/* Belt rails */}
                  <div className="absolute inset-x-2 top-1/2 h-px bg-emerald-900/50 -translate-y-1/2" />
                  <div className="absolute inset-x-2 top-1/2 mt-[2px] h-px bg-emerald-900/30" />
                  {/* 8 boxes flowing right, slower cadence — duration bumped
                      to 3.5s and delays restaggered so the belt feels calm
                      rather than racing. */}
                  <div className="absolute inset-x-2 inset-y-0">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <span key={i}
                        className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-sm cs-conveyor-mini"
                        style={{
                          background: colors[i % colors.length].color,
                          animationDelay: `${i * 0.44}s`,
                          animationDuration: "3.5s",
                          boxShadow: "0 0 5px rgba(16,185,129,0.4)",
                        }}
                      />
                    ))}
                  </div>
                  {/* Direction label + magnitude, centred above the belt */}
                  <div className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[8.5px] font-mono text-emerald-400/80 px-1.5 bg-slate-950/60 rounded">
                    → net in +{fmtU(totalInflow, mkt.unit)}
                  </div>
                </div>
                {/* Destination badge */}
                <div className="flex flex-col items-center justify-center px-2 py-1 bg-emerald-950/40 border border-emerald-900/60 rounded text-[9px] text-emerald-300 uppercase tracking-wider whitespace-nowrap">
                  Warehouses
                </div>
              </div>
            );
          })()}

          {/* Per-port warehouse grid — compact vertical cards, up to 6 per row */}
          {mkt.ports.length === 0 ? (
            <div className="text-xs text-slate-600 italic">No port data loaded.</div>
          ) : (
            <div className="flex flex-wrap items-start gap-1.5 w-full">
              {[...mkt.ports]
                .sort((a, b) => Math.ceil(b.current / b.squareUnit) - Math.ceil(a.current / a.squareUnit))
                .slice(0, 8)
                .map((p) => {
                const {
                  existing, netGained, ghosts, transited,
                  byOriginExisting, byOriginNetGained, byOriginGhost, byOriginTransit,
                  netGainedVol, lostVol, transitVol,
                  effectivePerSquare, totalWarrants,
                } = buildDensityGrid(p.current, p.byOrigin, p.age, p.flowByOrigin, p.squareUnit, p.market, p.classShares, mkt.cohortMatched);
                const inflowSum  = p.inflow.reduce((a, b) => a + b.volume, 0);
                const outflowSum = p.outflow.reduce((a, b) => a + b.volume, 0);
                const topInflow  = p.inflow.slice(0, 2);
                const topOutflow = p.outflow.slice(0, 2);
                // Top-2 origins per bucket — drives the small chip strip
                // beneath each sub-grid header so the user sees the
                // origin mix at a glance.
                const top2 = (m: Record<string, number>) =>
                  Object.entries(m)
                    .filter(([, v]) => v > 0)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 2)
                    .map(([origin, volume]) => ({ origin, volume, color: _originColor(origin, p.market) }));
                const topExisting  = top2(byOriginExisting);
                const topNetGained = top2(byOriginNetGained);
                const topGhost     = top2(byOriginGhost);
                const topTransit   = top2(byOriginTransit);
                // Label that explains the per-square scale. If
                // effectivePerSquare > 1 the port exceeded the cap and
                // each square is now ≈N warrants instead of 1 exactly.
                const sqLabel = effectivePerSquare === 1
                  ? "1 ◻ = 1 warrant"
                  : `1 ◻ ≈ ${effectivePerSquare.toFixed(1)} warrants`;
                // Per-card grid: cols ≈ √(existing + net-gained) so the
                // grid is square-ish and the card sizes to its content.
                // Cells are fixed-pixel (17 px Arabica, 13 px Robusta) so
                // one warrant always covers the same area across cards
                // and contracts — the user can eyeball "this is twice as
                // much coffee" because the squares ARE the same size.
                const cellPx = p.market === "KC" ? CELL_PX_KC : CELL_PX_RC;
                // Horizontal axis (columns) is a fixed step per warehouse size, so
                // the grid width reads the warehouse's magnitude at a glance:
                //   > 2000 lots → 50 wide · 500–2000 → 30 · < 500 → 15.
                // 1 square = 1 lot, so rows = ceil(lots / cols); the total area
                // still equals the lot count. Ports are rendered biggest-first.
                const cols = totalWarrants > 2000 ? 50 : totalWarrants >= 500 ? 30 : 15;
                const colsTemplate = `repeat(${cols}, ${cellPx}px)`;
                // Card width tracks the grid (cols squares + 1px gaps + grid p-1
                // + card p-1.5). A low floor keeps tiny cards readable while still
                // letting a medium (30-wide) + small (15-wide) pair share one
                // phone row and small ones pack several-up.
                const cardPx = Math.max(120, cols * cellPx + (cols - 1) + 8 + 12);
                const dimLabel = (n: number) => {
                  const r = _rowsForCount(n, cols);
                  return r === 0 ? "" : `${cols}×${r}`;
                };
                // Hover-tooltip helpers — read the square's viewport rect
                // from the event target and set state. Same handler shape
                // for every sub-grid; the status field distinguishes
                // existing / gained / lost / transit.
                const onSquareEnter = (e: React.MouseEvent<HTMLButtonElement>, sq: DensitySquare) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setHoveredSquare({
                    market: p.market, portName: p.name,
                    origin: sq.origin, ageBin: sq.ageBin, klass: sq.klass,
                    status: sq.status,
                    anchorLeft: r.left + r.width / 2,
                    anchorTop: r.top,
                  });
                };
                const onSquareLeave = () => setHoveredSquare(null);
                // Per-class border for Robusta squares — inset 1px so the
                // contour doesn't disturb the grid alignment.
                const classBorder = (sq: DensitySquare) =>
                  p.market === "RC" && sq.klass != null && CLASS_BORDER_RC[sq.klass]
                    ? { boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[sq.klass]}` }
                    : {};
                return (
                  <div key={`${p.market}-${p.code}`}
                       className="bg-slate-950/60 border border-slate-800 rounded-md p-1.5 flex flex-col shrink-0"
                       style={{ width: cardPx, maxWidth: "100%" }}>
                    {/* Header */}
                    <div className="flex justify-between items-baseline mb-1">
                      <div>
                        <div className="text-[11px] font-bold text-slate-100 leading-tight">{p.name}</div>
                        <div className="text-[9px] font-mono text-slate-500">{p.code}</div>
                      </div>
                      <div className={`text-xs font-bold ${p.pctFull > 80 ? "text-rose-400" : p.pctFull > 50 ? "text-amber-400" : "text-slate-400"}`}
                           title={p.peakIsHistorical
                             ? `${Math.round(p.pctFull)}% of the way from this warehouse's all-time low (${fmtU(p.floor, p.unit)}) to its all-time high of ${fmtU(p.capacity, p.unit)} ${unitWord(unit)}${p.peakDate ? `, set ${p.peakDate}` : ""}${p.historyFrom ? ` — history from ${p.historyFrom}` : ""}`
                             : `No archived history for this warehouse — scaled against its high over the loaded window only, so a quiet port can read high on a small number.`}>
                        {Math.round(p.pctFull)}%
                      </div>
                    </div>
                    <div className="text-[9px] text-slate-500 mb-1 font-mono leading-tight">
                      <span className="text-slate-300">{fmtU(p.current, p.unit)}</span>/{fmtU(p.capacity, p.unit)} {unitWord(unit)}
                      {p.peakIsHistorical
                        ? <span className="text-slate-600"> peak{p.peakDate ? ` ${p.peakDate.slice(0, 7)}` : ""}</span>
                        : <span className="text-amber-600/80"> window</span>}
                    </div>

                    {/* Poison breakdown — % + per-criterion contribution. */}
                    {p.poison.pct > 0 && (
                      <div className="bg-purple-950/30 border border-purple-900/50 rounded px-1 py-0.5 mb-1 text-[9px]">
                        <div className="flex items-center justify-between text-purple-300 font-bold">
                          <span>☣ poison</span>
                          <span className="font-mono">
                            {Math.round(p.poison.pct * 100)}% · {fmtU(p.poison.total, p.unit)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-1.5 gap-y-0 text-purple-300/80 text-[8.5px]">
                          {p.poison.deadPort > 0 && (
                            <span title="London / US warehouse">
                              dead-port {Math.round((p.poison.deadPort / p.current) * 100)}%
                            </span>
                          )}
                          {p.poison.badOrigin > 0 && (
                            <span title={p.market === "KC" ? "Brazil" : "Brazilian Conillon"}>
                              {p.market === "KC" ? "Brazil" : "Conillon"}{" "}
                              {Math.round((p.poison.badOrigin / p.current) * 100)}%
                            </span>
                          )}
                          {p.poison.aged > 0 && (
                            <span title="stock graded over 1 year ago">
                              aged {Math.round((p.poison.aged / p.current) * 100)}%
                            </span>
                          )}
                          {p.poison.lowClass > 0 && (
                            <span title="inferred from gradings history at this port">
                              class3/4 {Math.round((p.poison.lowClass / p.current) * 100)}%*
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Inflow indicator (compact) — header / animated
                        conveyor strip / top-origin chip line. Mirrors the
                        ↓out belt but emerald, and only renders when this
                        port saw positive inflow over the window. */}
                    <div className="bg-emerald-950/20 border border-emerald-900/50 rounded px-1 py-0.5 mb-1 text-[9px]">
                      <div className="flex items-center justify-between text-emerald-400 font-bold">
                        <span>↓ in</span>
                        <span className="font-mono">+{fmtU(inflowSum, p.unit)}</span>
                      </div>
                      {inflowSum > 0 && topInflow.length > 0 && (
                        <div className="relative h-2.5 mt-0.5 overflow-hidden">
                          {/* Track */}
                          <div className="absolute inset-x-0 top-1/2 h-px bg-emerald-900/40 -translate-y-1/2" />
                          {/* 4 boxes flowing right, cycling the top inflow
                              origin colours. Staggered delays give a steady
                              stream rather than a wave. */}
                          {Array.from({ length: 4 }).map((_, i) => (
                            <span key={i}
                              className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-sm cs-conveyor-mini"
                              style={{
                                background: topInflow[i % topInflow.length].color,
                                animationDelay: `${i * 0.45}s`,
                                animationDuration: "2.4s",
                                boxShadow: "0 0 4px rgba(16,185,129,0.45)",
                              }}
                            />
                          ))}
                        </div>
                      )}
                      {topInflow.length > 0 && (
                        <div className="flex flex-wrap gap-x-1.5">
                          {topInflow.map((b) => (
                            <span key={b.origin} className="flex items-center text-slate-300 text-[8.5px]">
                              <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                              {b.origin}: {fmtU(b.volume, p.unit)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Density grid — existing portion (= current − net-gained). */}
                    {topExisting.length > 0 && (
                      <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                        <span className="text-slate-500 uppercase tracking-wider">Existing top:</span>
                        {topExisting.map((b) => (
                          <span key={b.origin} className="flex items-center text-slate-300">
                            <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                            {b.origin}: {fmtU(b.volume, p.unit)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <div
                        className="grid gap-[1px] bg-slate-900/50 border border-slate-800 p-1 rounded"
                        style={{ gridTemplateColumns: colsTemplate }}
                      >
                        {existing.map((sq, i) => (
                          <button
                            key={i}
                            type="button"
                            onMouseEnter={(e) => onSquareEnter(e, sq)}
                            onMouseLeave={onSquareLeave}
                            className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                            style={{ background: sq.color, opacity: AGE_OPACITY[sq.ageBin], ...classBorder(sq) }}
                            aria-label={`${p.name} square ${i}`}
                          />
                        ))}
                      </div>
                      {existing.length > 0 && (
                        <span className="absolute -top-2 right-1 text-[8px] font-mono text-slate-500 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(existing.length)} = ${existing.length} warrants`}>
                          {dimLabel(existing.length)}
                        </span>
                      )}
                    </div>

                    {/* Net gained — origins whose net delta is positive over the window. */}
                    {netGained.length > 0 && (
                      <div className="mt-1 border border-dashed border-emerald-400/70 rounded p-1 bg-emerald-950/10 relative">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-bold">Net gained</span>
                          <span className="text-[8px] font-mono text-emerald-400">+{fmtU(netGainedVol, p.unit)}</span>
                        </div>
                        {topNetGained.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                            {topNetGained.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin}: {fmtU(b.volume, p.unit)}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-[1px]" style={{ gridTemplateColumns: colsTemplate }}>
                          {netGained.map((sq, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseEnter={(e) => onSquareEnter(e, sq)}
                              onMouseLeave={onSquareLeave}
                              className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                              style={{ background: sq.color, opacity: AGE_OPACITY[sq.ageBin], ...classBorder(sq) }}
                              aria-label={`${p.name} net-gained ${i}`}
                            />
                          ))}
                        </div>
                        <span className="absolute -bottom-2 right-1 text-[8px] font-mono text-emerald-400 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(netGained.length)} = ${netGained.length} warrants`}>
                          {dimLabel(netGained.length)}
                        </span>
                      </div>
                    )}

                    {/* Lost group — net warrants that disappeared over the window. */}
                    {ghosts.length > 0 && (
                      <div className="mt-1 border border-dashed border-rose-400/70 rounded p-1 bg-rose-950/10 relative">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-[8px] uppercase tracking-wider text-rose-400 font-bold">Lost</span>
                          <span className="text-[8px] font-mono text-rose-400">−{fmtU(lostVol, p.unit)}</span>
                        </div>
                        {topGhost.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                            {topGhost.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin}: {fmtU(b.volume, p.unit)}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-[1px]" style={{ gridTemplateColumns: colsTemplate }}>
                          {ghosts.map((sq, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseEnter={(e) => onSquareEnter(e, sq)}
                              onMouseLeave={onSquareLeave}
                              className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                              style={{ background: sq.color, opacity: 0.4, ...classBorder(sq) }}
                              aria-label={`${p.name} lost ${i}`}
                            />
                          ))}
                        </div>
                        <span className="absolute -bottom-2 right-1 text-[8px] font-mono text-rose-400 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(ghosts.length)} = ${ghosts.length} warrants`}>
                          {dimLabel(ghosts.length)}
                        </span>
                      </div>
                    )}

                    {/* Transited — stock that arrived AND departed inside the
                        window. Per-origin min(gross_in, gross_out), summed. */}
                    {transited.length > 0 && (
                      <div className="mt-1 border border-dashed border-amber-400/70 rounded p-1 bg-amber-950/10 relative">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-[8px] uppercase tracking-wider text-amber-400 font-bold">In & out</span>
                          <span className="text-[8px] font-mono text-amber-400">↻{fmtU(transitVol, p.unit)}</span>
                        </div>
                        {topTransit.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                            {topTransit.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin}: {fmtU(b.volume, p.unit)}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-[1px]" style={{ gridTemplateColumns: colsTemplate }}>
                          {transited.map((sq, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseEnter={(e) => onSquareEnter(e, sq)}
                              onMouseLeave={onSquareLeave}
                              className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                              style={{ background: sq.color, opacity: 0.55, ...classBorder(sq) }}
                              aria-label={`${p.name} transited ${i}`}
                            />
                          ))}
                        </div>
                        <span className="absolute -bottom-2 right-1 text-[8px] font-mono text-amber-400 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(transited.length)} = ${transited.length} warrants`}>
                          {dimLabel(transited.length)}
                        </span>
                      </div>
                    )}

                    <div className="text-[8.5px] text-slate-600 mt-1 flex justify-between">
                      <span>{sqLabel}</span>
                      <span>{fmtNum(totalWarrants)} warrants</span>
                    </div>

                    {/* Outflow indicator (compact) — header / animated
                        conveyor strip / top-origin chip line. */}
                    <div className="bg-rose-950/20 border border-rose-900/50 rounded px-1 py-0.5 mt-1 text-[9px]">
                      <div className="flex items-center justify-between text-rose-400 font-bold">
                        <span>↓ out</span>
                        <span className="font-mono">−{fmtU(outflowSum, p.unit)}</span>
                      </div>
                      {outflowSum > 0 && topOutflow.length > 0 && (
                        <div className="relative h-3 mt-0.5 overflow-hidden">
                          {/* Conveyor track — narrower than the container so
                              the boxes fade out just before reaching the
                              truck parked at the right edge. */}
                          <div className="absolute left-0 right-3.5 top-1/2 h-px bg-rose-900/40 -translate-y-1/2" />
                          <div className="absolute left-0 right-3.5 top-0 bottom-0">
                            {/* 4 boxes flowing right, cycling the top outflow
                                origin colours. Staggered delays give a steady
                                stream rather than a wave. */}
                            {Array.from({ length: 4 }).map((_, i) => (
                              <span key={i}
                                className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-sm cs-conveyor-mini"
                                style={{
                                  background: topOutflow[i % topOutflow.length].color,
                                  animationDelay: `${i * 0.45}s`,
                                  boxShadow: "0 0 4px rgba(239,68,68,0.45)",
                                }}
                              />
                            ))}
                          </div>
                          {/* Truck destination — the stock leaves the system here. */}
                          <IconTruck className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 text-rose-400" />
                        </div>
                      )}
                      {topOutflow.length > 0 && (
                        <div className="flex flex-wrap gap-x-1.5">
                          {topOutflow.map((b) => (
                            <span key={b.origin} className="flex items-center text-slate-300 text-[8.5px]">
                              <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                              {b.origin}: {fmtU(b.volume, p.unit)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Hover tooltip — anchored to the square the cursor is over.
          Renders origin, age band, and (Robusta only) C-contract class.
          pointer-events:none so it never eats hover from neighbouring
          squares. Transform pulls the tooltip above and centred on the
          anchor point. */}
      {hoveredSquare && (
        <div
          role="tooltip"
          className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-700 rounded shadow-2xl px-2 py-1.5 text-[10px] font-mono whitespace-nowrap"
          style={{
            left: hoveredSquare.anchorLeft,
            top:  hoveredSquare.anchorTop - 6,
            transform: "translate(-50%, -100%)",
            boxShadow: "0 8px 20px rgba(0,0,0,0.6)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-2 h-2 rounded" style={{ background: _originColor(hoveredSquare.origin, hoveredSquare.market) }} />
            <span className="text-slate-100">{hoveredSquare.origin}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">{hoveredSquare.portName}</span>
          </div>
          <div className="text-slate-400">
            <span className="text-slate-500">age</span> {AGE_LABEL[hoveredSquare.ageBin]}
          </div>
          {hoveredSquare.market === "RC" && hoveredSquare.klass != null && (
            <div className="text-slate-400">
              <span className="text-slate-500">quality</span>{" "}
              <span style={{ color: CLASS_BORDER_RC[hoveredSquare.klass] ?? "#94a3b8" }}>
                {CLASS_LABEL_RC[hoveredSquare.klass] ?? `Class ${hoveredSquare.klass}`}
              </span>
            </div>
          )}
          {hoveredSquare.status !== "filled" && (
            <div className="text-[9px] text-slate-600 italic mt-0.5">
              {hoveredSquare.status === "gained" ? "net gained over window"
                : hoveredSquare.status === "ghost" ? "lost over window"
                : "in & out over window"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
