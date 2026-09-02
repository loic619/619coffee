"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { ceilingK, isDemographicallyDiscounted, demographicFactor, K_BASE, logisticIntensity, MODEL_LIMITS } from "@/lib/demandCeilings";
import ConsumptionRanking from "./ConsumptionRanking";
import ConsumptionPace, { adultsFor, MARKET_ISO3 } from "./ConsumptionPace";
import BrewingMixPanel from "./BrewingMixPanel";

interface AnnualEntry {
  year: string;
  consumption_mt?: number | null;
  imports_mt?: number | null;
}

interface GrowthMarket {
  short: string;
  name: string;
  group?: "producing" | "historical" | "growing";
  tea_culture?: boolean;
  latest_year: string | null;
  consumption_mt: number | null;
  population: number | null;
  per_capita_kg: number | null;
  annual: AnnualEntry[];
}

interface CohortCountry {
  name: string;
  annual: { year: number; pop_18plus: number; median_age?: number | null }[];
}

// The coverage the exporter computed on MATCHED seasons. The panel must not
// re-derive one: `act` here is the latest USDA year (a forecast), and dividing
// it by an ICO total two seasons older read 100% and left a NEGATIVE remainder
// to be described as "markets USDA PSD does not break out".
interface WorldCoverage {
  ico_reference?:         { world_consumption_mt?: number; marketing_year?: string };
  tracked_consumption_mt?: number;
  tracked_marketing_year?: string | null;
  tracked_vs_ico_pct?:     number | null;
}

interface DemandStocks {
  growth_markets?: GrowthMarket[];
  world_consumption?: WorldCoverage | null;
  populations?: { source: string; last_updated: string };
  age_cohort_18plus?: { countries: Record<string, CohortCountry> };
}

// Drinking-age population per market comes from ConsumptionPace.adultsFor —
// it maps all ~50 tracked markets to their UN WPP cohort and sums EU members
// for the bloc, which the old 12-entry bridge could not do.

const PROJ_END = 2050;

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

// Stable color per country — also used in the trend chart
const COUNTRY_COLORS: Record<string, string> = {
  china:       "#dc2626",
  india:       "#f59e0b",
  brazil:      "#16a34a",
  indonesia:   "#0ea5e9",
  vietnam:     "#a855f7",
  russia:      "#3b82f6",
  mexico:      "#10b981",
  turkey:      "#ef4444",
  philippines: "#06b6d4",
  egypt:       "#facc15",
  korea:       "#ec4899",
  ethiopia:    "#84cc16",
};

function fmtMt(mt: number | null | undefined): string {
  if (mt == null) return "—";
  if (mt >= 1_000_000) return `${(mt / 1_000_000).toFixed(2)}Mt`;
  if (mt >= 1_000)     return `${Math.round(mt / 1000)}kt`;
  return `${Math.round(mt)}t`;
}

function fmtPop(p: number | null | undefined): string {
  if (p == null) return "—";
  if (p >= 1_000_000_000) return `${(p / 1_000_000_000).toFixed(2)}B`;
  if (p >= 1_000_000)     return `${Math.round(p / 1_000_000)}M`;
  return String(p);
}

// ── Demand projection ───────────────────────────────────────────────────────
// Joins each market's USDA consumption series with its projected 18+ population
// to (a) express consumption per drinking-age adult ("intensity") and (b) carry
// demand past 2025 to 2050: base case freezes intensity (demand moves only with
// the adult population); the S-curve scenario bends intensity toward the market's
// saturation ceiling K (per the Demand-modelling research methodology) at the
// observed recent growth rate. Both ride the same projected-adult population.

interface MarketSeries {
  short: string; name: string; perCapitaKg: number | null;
  ly: number; y0: number; i0: number; g: number; K: number;
  medianAge?: number; demoDiscounted: boolean; effAge: number; demoFactor: number;
  cons: Record<number, number>;   // USDA domestic consumption, MT
  pop: Record<number, number>;    // 18+ population
  inten: Record<number, number>;  // kg/adult/yr (overlap years)
  projI: Record<number, number>;  // logistic intensity, ly → 2050
}

// How far back the S-curve reads its growth rate. Seeding from the whole
// history is what made the old projection run hot: USDA's series carry thin or
// structurally-zero early years (the US reads 11 kt for 2000 and 0 for 2001),
// which turned a mature +0.5%/yr market into a +20%/yr one and pushed the 2050
// aggregate to 15.0 Mt. Fifteen years is a full demand cycle and, on the
// backtest below, anything from 8 to 20 lands within a few percent of actual —
// the number is not delicately tuned, but the full history is plainly wrong.
const SEED_WINDOW = 15;

/** CAGR of intensity over the SEED_WINDOW years ending at `end`, or null. */
function seedGrowth(inten: Record<number, number>, end: number, win = SEED_WINDOW): number | null {
  const years = Object.keys(inten).map(Number)
    .filter(y => y <= end && inten[y] > 0).sort((a, b) => a - b);
  if (years.length < 3 || !inten[end]) return null;
  // Earliest year inside the window; falls back to the oldest we have.
  const start = years.find(y => y >= end - win) ?? years[0];
  if (start >= end) return null;
  return Math.pow(inten[end] / inten[start], 1 / (end - start)) - 1;
}

// Build one market's full projection inputs, or null if it can't be joined.
function computeSeries(mkt: GrowthMarket, pop: Record<number, number>,
                       cohort?: CohortCountry): MarketSeries | null {
  const cons: Record<number, number> = {};
  for (const a of mkt.annual) {
    // Strictly positive: USDA carries structural zeros in years it had not yet
    // started publishing a market (the US series reads 0 kt for 2001), and a
    // zero anywhere in the series makes intensity growth meaningless.
    if (a.consumption_mt != null && a.consumption_mt > 0) cons[Number(a.year)] = a.consumption_mt;
  }
  const inten: Record<number, number> = {};
  for (const ys of Object.keys(cons)) {
    const y = Number(ys);
    const p = pop[y];
    if (p) inten[y] = (cons[y] * 1000) / p;
  }
  const overlap = Object.keys(inten).map(Number).sort((a, b) => a - b);
  const consYears = Object.keys(cons).map(Number);
  const ly = consYears.length ? Math.max(...consYears) : 0;
  const i0 = inten[ly];
  if (!overlap.length || i0 == null) return null;

  // Trailing-window CAGR of intensity — seeds the S-curve's growth rate.
  const y0 = overlap[0];
  const g = seedGrowth(inten, ly);
  if (g == null) return null;

  // Live whole-population median age (UN WPP) at the latest actual year. For
  // analog-anchored markets it drives the demographic discount on K; ceilingK
  // falls back to the baked-in 2025 median when the series carries none yet.
  const medianAgeByYear: Record<number, number> = {};
  for (const a of cohort?.annual ?? []) if (a.median_age != null) medianAgeByYear[a.year] = a.median_age;
  const medianAge = medianAgeByYear[ly];
  const demoDiscounted = isDemographicallyDiscounted(mkt.short);
  const effAge = medianAge ?? K_BASE[mkt.short]?.medianAge ?? 30;
  const demoFactor = demoDiscounted ? demographicFactor(effAge) : 1;

  // Saturation ceiling (kg/adult), and the bounded logistic intensity path
  // toward it. Replaces the old uncapped CAGR extrapolation.
  const K = ceilingK(mkt.short, medianAge) || i0 * 3;
  const projI = logisticIntensity(i0, g, K, ly, PROJ_END);

  return {
    short: mkt.short, name: mkt.name, perCapitaKg: mkt.per_capita_kg,
    ly, y0, i0, g, K, medianAge, demoDiscounted, effAge, demoFactor,
    cons, pop, inten, projI,
  };
}

const AGG = "__all__";

// ── Backtest ────────────────────────────────────────────────────────────────
// "Would this model have called the last H years right?" Refit each market
// using ONLY data up to ly−H (same logistic, same ceiling), project forward to
// ly against the actual adult population, then compare with the USDA actual.
// Population is taken as known — this tests the intensity model, not a
// demographic forecast, which is what the projection actually leans on.
interface BacktestRow {
  short: string; name: string; actualKt: number; predKt: number; errPct: number;
}
function backtest(seriesList: MarketSeries[], H: number): {
  rows: BacktestRow[]; actual: number; pred: number; errPct: number; mape: number;
} | null {
  const rows: BacktestRow[] = [];
  for (const m of seriesList) {
    const cut = m.ly - H;
    const iCut = m.inten[cut], pNow = m.pop[m.ly], cNow = m.cons[m.ly];
    if (iCut == null || !pNow || cNow == null) continue;
    // Growth rate seeded only from data at or before the cut — same rule the
    // live projection uses, so the test measures the model that ships.
    const g = seedGrowth(m.inten, cut);
    if (g == null) continue;
    const path = logisticIntensity(iCut, g, m.K, cut, m.ly);
    const iPred = path[m.ly] ?? iCut;
    const predKt = iPred * pNow / 1e6;
    const actualKt = cNow / 1000;
    if (actualKt <= 0) continue;
    rows.push({ short: m.short, name: m.name, actualKt, predKt, errPct: (predKt / actualKt - 1) * 100 });
  }
  if (rows.length < 3) return null;
  const actual = rows.reduce((s, r) => s + r.actualKt, 0);
  const pred = rows.reduce((s, r) => s + r.predKt, 0);
  const mape = rows.reduce((s, r) => s + Math.abs(r.errPct), 0) / rows.length;
  return { rows, actual, pred, errPct: (pred / actual - 1) * 100, mape };
}

function DemandProjection({ markets, cohorts, coverage }: {
  markets: GrowthMarket[];
  cohorts: Record<string, CohortCountry>;
  coverage?: WorldCoverage | null;
}) {
  // Only markets we can both join (have a cohort) and that carry consumption.
  const adultsByShort = new Map<string, Record<number, number>>();
  for (const m of markets) {
    const a = adultsFor(m.short, cohorts as Record<string, { annual: { year: number; pop_18plus: number }[] }>);
    if (a) adultsByShort.set(m.short, a);
  }
  const joinable = markets.filter(m => adultsByShort.has(m.short));
  const [sel, setSel] = useState(joinable[0]?.short ?? "");
  const [metric, setMetric] = useState<"total" | "intensity">("total");
  const [showLimits, setShowLimits] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [horizon, setHorizon] = useState<5 | 10>(10);

  // Every joinable market's series (also summed for the aggregate "top-line").
  const seriesList = joinable
    .map(m => computeSeries(m, adultsByShort.get(m.short)!, cohorts[MARKET_ISO3[m.short] ?? ""]))
    .filter((s): s is MarketSeries => s != null);
  // Matched-season coverage, straight from the exporter — never recomputed
  // against `act`, which is a later (forecast) year than the ICO reference.
  const ico = coverage?.ico_reference?.world_consumption_mt;
  const cov = (ico && coverage?.tracked_consumption_mt && coverage?.tracked_vs_ico_pct != null)
    ? { icoKt: ico / 1000, trackedKt: coverage.tracked_consumption_mt / 1000,
        pct: coverage.tracked_vs_ico_pct,
        season: coverage.tracked_marketing_year ?? coverage.ico_reference?.marketing_year ?? "" }
    : null;

  if (!seriesList.length) return null;

  const isAgg = sel === AGG;
  const s = seriesList.find(x => x.short === sel) ?? seriesList[0];
  const isTotal = isAgg ? true : metric === "total";   // intensity is per-market only
  const color = isAgg ? "#e2e8f0" : (COUNTRY_COLORS[s.short] ?? "#6366f1");
  const ly = s.ly;
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

  // One row per year (2000 → 2050). actual stops at the latest year; base/trend
  // start there (sharing the latest point so the lines connect seamlessly).
  const chart: Record<string, number | null>[] = [];
  for (let y = 2000; y <= PROJ_END; y++) {
    const row: Record<string, number | null> = { year: y };
    if (isAgg) {
      // Sum total demand (kt) across every market.
      let a = 0, b = 0, t = 0, hasA = false, hasB = false;
      for (const m of seriesList) {
        const p = m.pop[y];
        if (y <= m.ly && m.cons[y] != null) { a += m.cons[y] / 1000; hasA = true; }
        if (y >= m.ly && p) { b += m.i0 * p / 1e6; t += (m.projI[y] ?? m.i0) * p / 1e6; hasB = true; }
      }
      row.actual = hasA ? a : null;
      row.base   = hasB ? b : null;
      row.trend  = hasB ? t : null;
    } else if (isTotal) {
      const p = s.pop[y]; const iy = s.projI[y];
      row.actual = y <= ly && s.cons[y] != null ? s.cons[y] / 1000 : null;
      row.base   = y >= ly && p ? s.i0 * p / 1e6 : null;
      row.trend  = y >= ly && p && iy != null ? iy * p / 1e6 : null;
    } else {
      const iy = s.projI[y];
      row.actual = y <= ly && s.inten[y] != null ? s.inten[y] : null;
      row.base   = y >= ly ? s.i0 : null;
      row.trend  = y >= ly && iy != null ? iy : null;
    }
    chart.push(row);
  }

  // 2050 headline numbers (single market or summed).
  let act: number, base2050: number, trend2050: number, adultGrowth: number;
  if (isAgg) {
    const sum = (fn: (m: MarketSeries) => number) => seriesList.reduce((acc, m) => acc + fn(m), 0);
    act       = sum(m => (m.cons[m.ly] ?? 0) / 1000);
    base2050  = sum(m => m.i0 * (m.pop[PROJ_END] ?? 0) / 1e6);
    trend2050 = sum(m => (m.projI[PROJ_END] ?? m.i0) * (m.pop[PROJ_END] ?? 0) / 1e6);
    const pop0 = sum(m => m.pop[m.ly] ?? 0);
    const pop1 = sum(m => m.pop[PROJ_END] ?? 0);
    adultGrowth = pop0 ? pop1 / pop0 - 1 : 0;
  } else {
    const p2050 = s.pop[PROJ_END] ?? 0;
    act       = s.cons[ly] / 1000;
    base2050  = s.i0 * p2050 / 1e6;
    trend2050 = (s.projI[PROJ_END] ?? s.i0) * p2050 / 1e6;
    adultGrowth = s.pop[ly] ? p2050 / s.pop[ly] - 1 : 0;
  }
  const bt = backtest(seriesList, horizon);
  const unit = isTotal ? "kt" : "kg/adult";
  const limitsForMkt = isAgg ? [] : MODEL_LIMITS.filter(l => l.markets.includes(s.short));

  const Stat = ({ label, value, sub, tone }: {
    label: string; value: string; sub?: string; tone?: string;
  }) => (
    <div className="bg-slate-900/60 rounded px-2.5 py-1.5">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-mono ${tone ?? "text-slate-100"}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500 font-mono">{sub}</div>}
    </div>
  );

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Demand Projection to 2050 — per-adult intensity × drinking-age population
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLimits(v => !v)}
            className={`text-[9px] px-2 py-0.5 rounded border ${showLimits ? "border-amber-500/60 text-amber-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
            ⚠ Model limits
          </button>
          <button onClick={() => setShowBacktest(v => !v)}
            className={`text-[9px] px-2 py-0.5 rounded border ${showBacktest ? "border-sky-500/60 text-sky-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
            ✓ Backtest
          </button>
          {!isAgg && (
            <div className="flex rounded overflow-hidden border border-slate-700 text-[9px]">
              {([["total", "Total demand (kt)"], ["intensity", "Per-adult (kg)"]] as const).map(([m, lbl]) => (
                <button key={m} onClick={() => setMetric(m)}
                  className={`px-2 py-0.5 ${metric === m ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}>
                  {lbl}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLimits && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
          <div className="text-[9px] uppercase tracking-wide text-amber-400/90">
            Confidence &amp; limits — the S-curve ceiling K is a research anchor, not a measured value
          </div>
          {MODEL_LIMITS.map(l => {
            const hits = !isAgg && l.markets.includes(s.short);
            return (
              <div key={l.title} className="text-[10px] leading-snug">
                <span className={hits ? "text-amber-300 font-medium" : "text-slate-300 font-medium"}>
                  {hits ? "▸ " : ""}{l.title}
                  {hits && <span className="text-amber-400/80"> · flagged for {s.name}</span>}
                </span>
                <span className="text-slate-400"> — {l.detail}</span>
              </div>
            );
          })}
          {isAgg ? (
            <div className="text-[10px] text-slate-500 italic">Aggregated across all markets — the caveats above bite hardest on China / India / Russia within the total.</div>
          ) : limitsForMkt.length === 0 && (
            <div className="text-[10px] text-slate-500 italic">No specific caveat flagged for {s.name}; general limits still apply.</div>
          )}
          {!isAgg && (
            <div className="text-[10px] leading-snug pt-0.5 border-t border-amber-500/20">
              <span className="text-slate-300 font-medium">Demographic discount</span>
              <span className="text-slate-400">
                {" — "}
                {s.demoDiscounted
                  ? <>K discounted live by ×{s.demoFactor.toFixed(2)} for median age {s.effAge.toFixed(0)}
                      {s.medianAge == null && <span className="text-slate-500 italic"> (fallback — WPP median-age series not in data yet)</span>}.</>
                  : <>none — {s.name} is anchored on its own observed plateau, so its demographics are already embedded.</>}
              </span>
            </div>
          )}
          <div className="text-[9px] text-slate-500 pt-0.5">
            Full methodology &amp; the per-market K table: Research → Demand modelling.
          </div>
        </div>
      )}

      {showBacktest && bt && (
        <div className="rounded border border-sky-500/30 bg-sky-500/5 p-2.5 space-y-2">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div className="text-[9px] uppercase tracking-wide text-sky-400/90">
              Backtest — refit on data to {ly - horizon}, project {horizon} yrs, compare with USDA actual {ly}
            </div>
            <div className="flex rounded overflow-hidden border border-slate-700 text-[9px]">
              {([5, 10] as const).map(h => (
                <button key={h} onClick={() => setHorizon(h)}
                  className={`px-2 py-0.5 ${horizon === h ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}>{h}y</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label={`Actual ${ly}`} value={`${Math.round(bt.actual).toLocaleString()} kt`} sub={`${bt.rows.length} markets`} tone="text-amber-300" />
            <Stat label="Model said" value={`${Math.round(bt.pred).toLocaleString()} kt`} sub={`from ${ly - horizon}`} />
            <Stat label="Aggregate error"
              value={`${bt.errPct >= 0 ? "+" : ""}${bt.errPct.toFixed(1)}%`}
              sub={Math.abs(bt.errPct) < 10 ? "within ±10%" : "outside ±10%"}
              tone={Math.abs(bt.errPct) < 10 ? "text-emerald-400" : "text-red-400"} />
            <Stat label="Mean abs. error" value={`${bt.mape.toFixed(1)}%`} sub="per market" />
          </div>
          <div className="max-h-40 overflow-y-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
                  <th className="text-left px-1.5 py-1">Market</th>
                  <th className="text-right px-1.5 py-1">Actual</th>
                  <th className="text-right px-1.5 py-1">Predicted</th>
                  <th className="text-right px-1.5 py-1">Error</th>
                </tr>
              </thead>
              <tbody>
                {[...bt.rows].sort((a, b) => Math.abs(b.errPct) - Math.abs(a.errPct)).map(r => (
                  <tr key={r.short} className="border-b border-slate-800/70">
                    <td className="px-1.5 py-0.5 text-slate-300">{r.name}</td>
                    <td className="px-1.5 py-0.5 text-right font-mono text-slate-200">{Math.round(r.actualKt).toLocaleString()}</td>
                    <td className="px-1.5 py-0.5 text-right font-mono text-slate-400">{Math.round(r.predKt).toLocaleString()}</td>
                    <td className={`px-1.5 py-0.5 text-right font-mono ${Math.abs(r.errPct) < 10 ? "text-emerald-400" : Math.abs(r.errPct) < 25 ? "text-amber-300" : "text-red-400"}`}>
                      {r.errPct >= 0 ? "+" : ""}{r.errPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[9px] text-slate-500 italic">
            Population is taken as known, so this tests the intensity (per-adult) model rather than a demographic
            forecast. A market the model over-shoots was assumed to keep climbing toward its ceiling faster than it
            did; under-shoots are markets that accelerated. Read the 2050 numbers with this error band in mind.
          </div>
        </div>
      )}

      {/* Country selector + aggregate top-line */}
      <div className="flex flex-wrap gap-1">
        <button onClick={() => setSel(AGG)}
          className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
            isAgg ? "border-transparent bg-slate-200 text-slate-900 font-medium" : "border-slate-600 text-slate-300 hover:text-white"
          }`}>
          🌍 All markets
        </button>
        {joinable.map(m => (
          <button key={m.short} onClick={() => setSel(m.short)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              !isAgg && m.short === sel
                ? "border-transparent text-white"
                : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
            style={!isAgg && m.short === sel ? { background: COUNTRY_COLORS[m.short] ?? "#6366f1" } : undefined}>
            {m.name}
          </button>
        ))}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart} margin={{ top: 4, right: 12, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <ReferenceArea x1={ly} x2={PROJ_END} fill="#64748b" fillOpacity={0.06} />
            <ReferenceLine x={ly} stroke="#64748b" strokeDasharray="2 2"
              label={{ value: "projection →", position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }} />
            {!isTotal && (
              <ReferenceLine y={s.K} stroke={color} strokeDasharray="4 3" strokeOpacity={0.55}
                label={{ value: `ceiling K = ${s.K.toFixed(1)}`, position: "insideTopLeft", fontSize: 8, fill: color }} />
            )}
            <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
              type="number" domain={[2000, PROJ_END]} ticks={[2000, 2010, 2020, 2030, 2040, 2050]} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={v => isTotal ? `${v}kt` : `${v}`} width={38} />
            <Tooltip contentStyle={TT_STYLE}
              labelFormatter={l => `${l}`}
              formatter={(v: unknown, name: unknown) => {
                if (v == null) return ["—", String(name)];
                const lbl = name === "actual" ? "Actual"
                  : name === "base" ? "Projection (flat intensity)"
                  : "Projection (S-curve to ceiling)";
                const num = isTotal ? `${Number(v).toLocaleString()} kt` : `${Number(v).toFixed(2)} kg/adult`;
                return [num, lbl];
              }} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) =>
              v === "actual" ? "Actual (USDA)"
                : v === "base" ? "Flat intensity"
                : "S-curve → ceiling"} />
            <Line dataKey="actual" stroke={color} strokeWidth={2.2} dot={false} connectNulls />
            <Line dataKey="base"   stroke={color} strokeWidth={2.2} dot={false} connectNulls strokeOpacity={0.85} />
            <Line dataKey="trend"  stroke={color} strokeWidth={1.8} dot={false} connectNulls strokeDasharray="2 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {isAgg ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Markets" value={`${seriesList.length}`} sub="summed" />
          <Stat label={`Demand ${ly}`} value={`${Math.round(act).toLocaleString()} kt`}
            sub={cov ? `${cov.pct.toFixed(0)}% of ICO world in ${cov.season}` : "USDA latest"} tone="text-amber-300" />
          <Stat label="2050 demand · flat" value={`${Math.round(base2050).toLocaleString()} kt`} sub={pct(base2050 / act - 1)} />
          <Stat label="2050 demand · S-curve" value={`${Math.round(trend2050).toLocaleString()} kt`} sub={pct(trend2050 / act - 1)} tone="text-slate-100" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Stat label={`Intensity ${ly}`} value={`${s.i0.toFixed(2)}`} sub="kg/adult/yr" tone="text-amber-300" />
          <Stat label="Ceiling K" value={s.K.toFixed(1)} sub={`${(s.K / s.i0).toFixed(1)}× now`} tone="text-amber-300" />
          <Stat label="Initial rate" value={`${s.g >= 0 ? "+" : ""}${(s.g * 100).toFixed(1)}%`} sub="per yr" />
          <Stat label="Adults 2050" value={pct(adultGrowth)} sub={`vs ${ly}`} />
          <Stat label="2050 demand · flat" value={`${Math.round(base2050)} kt`} sub={pct(base2050 / act - 1)} tone="text-slate-100" />
          <Stat label="2050 demand · S-curve" value={`${Math.round(trend2050)} kt`} sub={pct(trend2050 / act - 1)} tone="text-slate-100" />
        </div>
      )}

      <div className="text-[9px] text-slate-500 italic">
        {isAgg
          ? <>Top-line = Σ of all {seriesList.length} joinable markets&rsquo; capped projections —
              {" "}{Math.round(act).toLocaleString()} kt at {ly}, USDA&rsquo;s newest year and a forecast.
              {cov ? <> ICO&rsquo;s last published world total is {Math.round(cov.icoKt).toLocaleString()} kt
              for {cov.season}; on that same season these markets sum to
              {" "}{Math.round(cov.trackedKt).toLocaleString()} kt, or {cov.pct.toFixed(1)}% of it — the
              remaining {Math.round(cov.icoKt - cov.trackedKt).toLocaleString()} kt is markets USDA PSD
              does not break out. The two figures are different seasons and do not net.</> : null} Each market bends its per-adult intensity toward its own ceiling K then scales by projected 18+ population; the flat case holds {ly} intensity. Per-market ceilings &amp; logic: Research → Demand modelling.</>
          : <>Intensity = USDA domestic consumption ÷ UN WPP 18+ population (true {unit} per drinking-age adult, vs {s.perCapitaKg?.toFixed(2) ?? "—"} kg per total head).
              Flat case holds {ly} intensity and scales by projected adults; dotted case bends intensity from the {s.y0}–{ly} growth rate ({(s.g * 100).toFixed(1)}%/yr) toward the saturation ceiling K = {s.K.toFixed(1)} kg/adult via a logistic g·(1−i/K) — see Research → Demand modelling.</>}
      </div>
    </div>
  );
}

export default function GrowthMarketsPanel() {
  const [data, setData] = useState<DemandStocks | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!data) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading growth-market data…</div>;

  const rows = data.growth_markets ?? [];
  if (rows.length === 0) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Growth-market data not yet available — requires PSD + World Bank scraper runs.
      </div>
    );
  }

  // Per-capita ranking data (rows arrive already sorted by consumption desc).
  const perCapRanked = rows
    .filter(r => r.per_capita_kg != null)
    .slice()
    .sort((a, b) => (b.per_capita_kg ?? 0) - (a.per_capita_kg ?? 0))
    .map(r => ({
      name:          r.name,
      per_capita_kg: r.per_capita_kg,
      short:         r.short,
    }));

  // Trend chart — top 6 by latest consumption
  const trendCountries = rows.slice(0, 6);
  const yearSet = new Set<string>();
  for (const c of trendCountries) {
    for (const r of c.annual) yearSet.add(r.year);
  }
  const years = Array.from(yearSet).sort();
  const trendChart = years.map(y => {
    const row: Record<string, number | string | null> = { year: y.slice(2) };
    for (const c of trendCountries) {
      const entry = c.annual.find(a => a.year === y);
      row[c.short] = entry?.consumption_mt != null ? Math.round(entry.consumption_mt / 1000) : null;
    }
    return row;
  });

  // Year-over-year deltas for the same six markets (kt).
  const trendYoy = trendChart.map((row, i) => {
    if (i === 0) return null;
    const prev = trendChart[i - 1];
    const out: Record<string, number | string | null> = { year: row.year };
    for (const c of trendCountries) {
      const a = row[c.short], b = prev[c.short];
      out[c.short] = typeof a === "number" && typeof b === "number" ? a - b : null;
    }
    return out;
  }).filter((r): r is Record<string, number | string | null> => r != null);

  const totalConsumption = rows.reduce((s, r) => s + (r.consumption_mt ?? 0), 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">World Coffee Demand</h2>
          <p className="text-xs text-slate-400">
            Every market USDA tracks — {rows.length} countries, mature to emerging to origin ·
            USDA PSD{rows.some(r => r.per_capita_kg != null) ? " ÷ World Bank population" : ""}
          </p>
        </div>
        <div className="text-[10px] font-mono text-slate-400">
          Σ consumption: <span className="text-white">{fmtMt(totalConsumption)}</span>
        </div>
      </div>

      {/* Grouped ranking — replaces the old chart whose nested <Bar> elements
          rendered one identical series per country (the "13 same values" bug). */}
      <ConsumptionRanking markets={rows} />

      {/* Per-capita ranking */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Per-Capita Consumption (kg/person/yr)
        </div>
        {/* An empty <BarChart> renders a blank framed box that looks like a
            broken chart rather than missing data — which is exactly how this
            read while the World Bank population feed was absent and all 49
            markets carried population: null. Say so instead. */}
        {perCapRanked.length === 0 ? (
          <div className="text-[10px] text-slate-500 italic py-6 text-center">
            No population denominator loaded, so per-capita cannot be computed.
            Consumption comes from USDA PSD; the divisor is World Bank
            SP.POP.TOTL, refreshed by the annual population job.
          </div>
        ) : (
        <div style={{ height: Math.max(220, perCapRanked.length * 18 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={perCapRanked} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kg`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} width={96} interval={0} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(2)} kg/person/yr`, "Per-capita"]} />
              <Bar dataKey="per_capita_kg" fill="#f59e0b" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}
      </div>

      {/* Growth decomposition: demography vs behaviour, and whether it is speeding up */}
      {data.age_cohort_18plus?.countries && (
        <ConsumptionPace markets={rows} cohorts={data.age_cohort_18plus.countries} />
      )}

      {/* Trend lines — top 6 */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Consumption Trajectory — top 6 markets (kt/yr)
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendChart} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name: unknown) => {
                const country = trendCountries.find(c => c.short === name);
                return [v == null ? "—" : `${Number(v).toLocaleString()} kt`, country?.name ?? String(name)];
              }} />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => trendCountries.find(c => c.short === v)?.name ?? v} />
              {trendCountries.map(c => (
                <Line key={c.short} dataKey={c.short} type="monotone" stroke={COUNTRY_COLORS[c.short] ?? "#6366f1"} strokeWidth={1.6} dot={false} connectNulls name={c.short} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Year-over-year change, stacked — the level chart above shows where
            each market is, this shows what actually moved in a given year. */}
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mt-3 mb-1">
          Year-over-year change (kt) — stacked contributions
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendYoy} stackOffset="sign" margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name: unknown) => {
                const country = trendCountries.find(c => c.short === name);
                return [v == null ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toLocaleString()} kt`, country?.name ?? String(name)];
              }} />
              {trendCountries.map(c => (
                <Bar key={c.short} dataKey={c.short} stackId="yoy" fill={COUNTRY_COLORS[c.short] ?? "#6366f1"} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-slate-500 italic mt-1">
          Each bar is the sum of the six markets&rsquo; year-on-year changes; a bar near zero with tall
          opposite-signed segments means the markets offset each other rather than the world standing still.
        </div>
      </div>

      {/* Demand projection — joins consumption with the 18+ cohort */}
      {data.age_cohort_18plus?.countries && (
        <DemandProjection markets={rows} cohorts={data.age_cohort_18plus.countries}
          coverage={data.world_consumption ?? null} />
      )}

      {/* How each market brews — the grams-per-cup lever on import demand */}
      <BrewingMixPanel markets={rows} />

      {/* Detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left  px-2 py-1.5">Market</th>
              <th className="text-right px-2 py-1.5">Year</th>
              <th className="text-right px-2 py-1.5">Consumption</th>
              <th className="text-right px-2 py-1.5">Population</th>
              <th className="text-right px-2 py-1.5">Per-capita</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.short} className="border-b border-slate-800 hover:bg-slate-800/40">
                <td className="px-2 py-1 text-slate-200 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COUNTRY_COLORS[r.short] ?? "#6366f1" }} />
                  {r.name}
                </td>
                <td className="px-2 py-1 text-right text-slate-500 font-mono">{r.latest_year ?? "—"}</td>
                <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtMt(r.consumption_mt)}</td>
                <td className="px-2 py-1 text-right font-mono text-slate-300">{fmtPop(r.population)}</td>
                <td className="px-2 py-1 text-right font-mono text-amber-300">
                  {r.per_capita_kg != null ? `${r.per_capita_kg.toFixed(2)} kg` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Population via World Bank SP.POP.TOTL. Per-capita = USDA PSD domestic consumption (MT) × 1000 / latest population.
        Brazil/Indonesia/Vietnam/India/Mexico/Ethiopia are origin countries with substantial domestic demand.
      </div>
    </div>
  );
}
