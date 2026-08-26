import type { ProcessedCotRow } from "./types";

export type SignalSeverity = "info" | "warn" | "alert";
export type SignalMarket   = "NY" | "LDN";

/** In-page deep link rendered as a chip alongside a signal. */
export interface SignalLink {
  /** Short chip label shown to the user, e.g. "Global Flow". */
  label: string;
  /** Anchor or route, e.g. "#cot-section-1" or "/macro#softs". */
  href:  string;
}

export interface Signal {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  market: SignalMarket;
  severity: SignalSeverity;
  /** Directional score: positive = bullish, negative = bearish, 0 = neutral */
  score: number;
  text: string;
  /** WoW move size of the rule's primary driver (or percentile-distance for
   *  percentile-driven rules). Populated by the engine on every signal. */
  magnitude: "small" | "medium" | "large";
  /** Optional in-page links to dashboard sections that complement the rule
   *  text. Rendered as chips by the UI. */
  links?: SignalLink[];
}

// ── Deep-link targets used by aspirational-text rules ────────────────────────
// Section IDs (`cot-section-N`) are STABLE URL slugs, decoupled from display
// order — the `id` attributes on each section wrapper in CotDashboard/index.tsx.
// Display order can be reshuffled without touching these hrefs. Labels here
// describe the destination semantically, not by display number, so they
// survive renumberings.
const LINK_FLOW      : SignalLink = { label: "Global Flow",  href: "#cot-section-1" }; // → Step1GlobalFlow
const LINK_GAUGES    : SignalLink = { label: "Gauges",       href: "#cot-section-3" }; // → CotGauges
const LINK_INDUSTRY  : SignalLink = { label: "Industry",     href: "#cot-section-4" }; // → Step4IndustryPulse
const LINK_DRYPOWDER : SignalLink = { label: "Dry Powder",   href: "#cot-section-5" }; // → Step5DryPowder
const LINK_CYCLE     : SignalLink = { label: "Cycle",        href: "#cot-section-6" }; // → Step6CycleLocation

export interface HistoricalWeek {
  date: string;
  signals: Signal[];
  /** Net composite score for NY (KC) */
  scoreNY: number;
  /** Net composite score for LDN (RC) */
  scoreLDN: number;
  priceNY: number;
  priceLDN: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tunable thresholds for the rule engine. Hoisted here so a future back-test
 * pass can tweak them without grepping the rule bodies.
 *
 * OB_HIGH / OB_LOW are kept aligned with PCT_HIGH / PCT_LOW so the
 * overbought/oversold price-percentile gate behaves consistently with
 * the position-percentile gate (`isHigh` / `isLow`).
 *
 * NOTE on trader counts: LDN short-side breakouts (`t_*_short` on Robusta)
 * are unpublished and arrive as `null`. The short-count time-series below
 * therefore carry nulls on LDN rows, and `dirCount` returns "unknown" when
 * either endpoint is null — count-comparison rules naturally skip in that
 * case.
 */
const THRESHOLDS = {
  PCT_HIGH:        0.75,
  PCT_LOW:         0.25,
  OB_HIGH:         75,   // was 80, aligned with PCT_HIGH
  OB_LOW:          25,   // was 20, aligned with PCT_LOW
  DIR_FLAT_PCT:    0.01,
  DIR_FLAT_COUNT:  2,
  // Magnitude band offsets for percentile-driven rules. medium = threshold +
  // MAG_MEDIUM_OFFSET; large = threshold + MAG_LARGE_OFFSET (mirrored for
  // the low side). Derived from THRESHOLDS so a future PCT_HIGH/LOW change
  // shifts the magnitude bands automatically.
  MAG_MEDIUM_OFFSET: 0.05,
  MAG_LARGE_OFFSET:  0.15,
} as const;

type Dir = "up" | "down" | "flat";
type DirCount = Dir | "unknown";

/**
 * WoW % change direction with a configurable flat threshold (default 1%).
 *
 * Near-zero `prev`: `base = |prev| || 1` falls back to 1 to avoid divide-by-zero.
 * One consequence — for series that legitimately cross zero (e.g.
 * curve structure), a small 0.01 → -0.01 flip is divided by 0.01 and
 * registers as a "down" move of huge magnitude. The downstream rules
 * either gate on signs (`str < 0` for backwardation) or accept the
 * direction without re-checking the magnitude, so this is currently
 * harmless — but be cautious about adding rules that depend on `mag()`
 * for zero-crossing series.
 */
export function dir(prev: number, curr: number): Dir {
  const base = Math.abs(prev) || 1;
  const chg  = (curr - prev) / base;
  if (chg >  THRESHOLDS.DIR_FLAT_PCT) return "up";
  if (chg < -THRESHOLDS.DIR_FLAT_PCT) return "down";
  return "flat";
}

/**
 * Direction for absolute-units series (trader counts, structure values).
 * Uses an absolute flat band rather than a percentage — a 1% change in a
 * 40-trader count is 0.4, so the ratio-based `dir()` essentially never
 * reports "flat" for count series and the count-comparison rules fire on
 * noise.
 *
 * Default flat band scales with the magnitude of `prev`:
 *   flat = max(DIR_FLAT_COUNT, 5% of |prev|)
 * This keeps the absolute-2 floor for small NY MM counts (~30-50 traders →
 * 5% = 1.5-2.5, floor kicks in) while preventing high-count categories
 * (~100+ traders → 5% = 5+) from firing on single-trader noise. Pass an
 * explicit `flat` to override.
 *
 * Returns "unknown" when either endpoint is null — see the LDN note above.
 */
export function dirCount(
  prev: number | null,
  curr: number | null,
  flat?: number,
): DirCount {
  if (prev == null || curr == null) return "unknown";
  const band = flat ?? Math.max(THRESHOLDS.DIR_FLAT_COUNT, 0.05 * Math.abs(prev));
  const delta = curr - prev;
  if (Math.abs(delta) < band) return "flat";
  return delta > 0 ? "up" : "down";
}

/** 52-week min-max percentile of values[idx] — matches the Gauges display formula: (current−min)/(max−min). */
export function pct52(values: number[], idx: number): number {
  const start  = Math.max(0, idx - 51);
  const window = values.slice(start, idx + 1);
  const min    = Math.min(...window);
  const max    = Math.max(...window);
  return max > min ? (values[idx] - min) / (max - min) : 0.5;
}

export const isHigh = (s: number[], i: number) => pct52(s, i) >= THRESHOLDS.PCT_HIGH;
export const isLow  = (s: number[], i: number) => pct52(s, i) <= THRESHOLDS.PCT_LOW;

// Re-exported for tests; not part of the public engine API otherwise.
export { THRESHOLDS as __THRESHOLDS };

export type Magnitude = "small" | "medium" | "large";

/** WoW magnitude: small <5%, medium 5–12%, large >12%. */
/** Week-on-week move in the 1st/2nd spread, sized in the market's own quote
 *  unit rather than as a percentage.
 *
 *  The spread crosses zero routinely, which makes a ratio-based magnitude
 *  meaningless near the crossing: |curr-prev|/|prev| explodes as prev→0 even
 *  when nothing happened. Thresholds are absolute and per-market because the
 *  units differ — KC quotes c/lb, RC quotes $/t — and a number that reads
 *  "large" in one is noise in the other.
 *
 *  A null on either side means the move cannot be sized at all (the contract
 *  archive does not cover that week), which is "small", not zero: the engine
 *  should not shout about a move it cannot measure. */
export const SPREAD_MAG_BANDS: Record<"NY" | "LDN", { medium: number; large: number }> = {
  NY:  { medium: 0.75, large: 2.0 },    // c/lb
  LDN: { medium: 15,   large: 40 },     // $/t
};

export function magSpreadMove(
  prev: number | null, curr: number | null, mkt: "NY" | "LDN",
): Magnitude {
  if (prev === null || curr === null || !Number.isFinite(prev) || !Number.isFinite(curr)) {
    return "small";
  }
  const move = Math.abs(curr - prev);
  const b = SPREAD_MAG_BANDS[mkt];
  if (move >= b.large) return "large";
  if (move >= b.medium) return "medium";
  return "small";
}

export function mag(prev: number, curr: number): Magnitude {
  const base = Math.abs(prev) || 1;
  const pct  = Math.abs((curr - prev) / base);
  if (pct < 0.05) return "small";
  if (pct < 0.12) return "medium";
  return "large";
}

/**
 * Magnitude for percentile-driven rules. `kind="high"` means the rule
 * fires when pct ≥ PCT_HIGH; magnitude grows as pct climbs further past
 * the threshold. `kind="low"` is the mirror. Band edges are derived from
 * THRESHOLDS so tightening PCT_HIGH/LOW shifts the magnitude buckets
 * automatically.
 *
 * Current numerics (PCT_HIGH=0.75, MEDIUM=+0.05, LARGE=+0.15):
 *   high: small 0.75–0.80, medium 0.80–0.90, large ≥ 0.90
 *   low:  small 0.20–0.25, medium 0.10–0.20, large ≤ 0.10
 */
export function magFromPct(pct: number, kind: "high" | "low"): Magnitude {
  if (kind === "high") {
    if (pct >= THRESHOLDS.PCT_HIGH + THRESHOLDS.MAG_LARGE_OFFSET)  return "large";
    if (pct >= THRESHOLDS.PCT_HIGH + THRESHOLDS.MAG_MEDIUM_OFFSET) return "medium";
    return "small";
  }
  if (pct <= THRESHOLDS.PCT_LOW - THRESHOLDS.MAG_LARGE_OFFSET)  return "large";
  if (pct <= THRESHOLDS.PCT_LOW - THRESHOLDS.MAG_MEDIUM_OFFSET) return "medium";
  return "small";
}

const MAG_ORDER: Record<Magnitude, number> = { small: 0, medium: 1, large: 2 };
/** Returns the larger of two magnitudes. */
export function magBig(a: Magnitude, b: Magnitude): Magnitude {
  return MAG_ORDER[a] >= MAG_ORDER[b] ? a : b;
}

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Evaluate all 59 rule-based signals against the most recent COT week.
 * Requires at least 2 rows (current + previous for WoW deltas).
 * Uses full row history for 52-week percentile calculations.
 *
 * Proxy convention:
 *   pmpuShort ≈ Producers (hedgers)
 *   pmpuLong  ≈ Roasters  (commercial buyers)
 */
export function evaluateSignals(rows: ProcessedCotRow[]): Signal[] {
  const n = rows.length;
  if (n < 2) return [];

  const i    = n - 1;
  const curr = rows[i];
  const prev = rows[i - 1];

  // ── Time-series for 52-week percentile calcs ──────────────────────────────
  const nyProdS   = rows.map(r => r.ny.pmpuShort);
  const nyRoastL  = rows.map(r => r.ny.pmpuLong);
  const nyMmL     = rows.map(r => r.ny.mmLong);
  const nyMmS     = rows.map(r => r.ny.mmShort);
  const ldnProdS  = rows.map(r => r.ldn.pmpuShort);
  const ldnRoastL = rows.map(r => r.ldn.pmpuLong);
  const ldnMmL    = rows.map(r => r.ldn.mmLong);
  const ldnMmS    = rows.map(r => r.ldn.mmShort);
  const nyPrices  = rows.map(r => r.priceNY);
  const ldnPrices = rows.map(r => r.priceLDN);

  // ── Net MM OI (long − short) ──────────────────────────────────────────────
  const nyMmNet   = rows.map(r => r.ny.mmLong  - r.ny.mmShort);
  const ldnMmNet  = rows.map(r => r.ldn.mmLong - r.ldn.mmShort);

  // ── Trader counts (# entities per category, long and short sides) ─────────
  // Long-side counts are always reported. Short-side counts (`tradersNY_short`,
  // `tradersLDN_short`) are optional in the schema and arrive as `null` on
  // LDN (Robusta doesn't publish the breakouts). Carry the nulls through so
  // `dirCount` can report "unknown" and downstream count-comparison rules
  // skip cleanly on LDN.
  const nyMmLongT   = rows.map(r => r.tradersNY.mm);
  const nyMmShortT  = rows.map(r => r.tradersNY_short?.mm  ?? null);
  const ldnMmLongT  = rows.map(r => r.tradersLDN.mm);
  const ldnMmShortT = rows.map(r => r.tradersLDN_short?.mm ?? null);
  const nyMmNetT    = rows.map(r => {
    const s = r.tradersNY_short?.mm;
    return s == null ? null : r.tradersNY.mm - s;
  });
  const ldnMmNetT   = rows.map(r => {
    const s = r.tradersLDN_short?.mm;
    return s == null ? null : r.tradersLDN.mm - s;
  });

  const nyProdShortT  = rows.map(r => r.tradersNY_short?.pmpu   ?? null);
  const ldnProdShortT = rows.map(r => r.tradersLDN_short?.pmpu  ?? null);
  const nyRoastLongT  = rows.map(r => r.tradersNY.pmpu);
  const ldnRoastLongT = rows.map(r => r.tradersLDN.pmpu);

  // ── WoW directions ────────────────────────────────────────────────────────
  type Mkt = "NY" | "LDN";

  const prodDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.pmpuShort,  curr.ny.pmpuShort),
    LDN: dir(prev.ldn.pmpuShort, curr.ldn.pmpuShort),
  };
  const roastDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.pmpuLong,  curr.ny.pmpuLong),
    LDN: dir(prev.ldn.pmpuLong, curr.ldn.pmpuLong),
  };
  const mmLDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.mmLong,  curr.ny.mmLong),
    LDN: dir(prev.ldn.mmLong, curr.ldn.mmLong),
  };
  const mmSDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.mmShort,  curr.ny.mmShort),
    LDN: dir(prev.ldn.mmShort, curr.ldn.mmShort),
  };
  const priceDir: Record<Mkt, Dir> = {
    NY:  dir(prev.priceNY,  curr.priceNY),
    LDN: dir(prev.priceLDN, curr.priceLDN),
  };

  // ── Trader count WoW directions ───────────────────────────────────────────
  // Trader counts use `dirCount` (absolute-units flat band) — a 1% change in
  // a 30-trader count is 0.3, so the ratio-based `dir()` essentially never
  // reports "flat" and the count-comparison rules fire on noise.
  // Short-side direction records can produce "unknown" on LDN where the
  // raw `t_*_short` fields arrive as null (Robusta doesn't publish them).
  const mmLongTDir: Record<Mkt, DirCount> = {
    NY:  dirCount(nyMmLongT[i - 1],   nyMmLongT[i]),
    LDN: dirCount(ldnMmLongT[i - 1],  ldnMmLongT[i]),
  };
  const mmShortTDir: Record<Mkt, DirCount> = {
    NY:  dirCount(nyMmShortT[i - 1],  nyMmShortT[i]),
    LDN: dirCount(ldnMmShortT[i - 1], ldnMmShortT[i]),
  };
  const mmNetTDir: Record<Mkt, DirCount> = {
    NY:  dirCount(nyMmNetT[i - 1],   nyMmNetT[i]),
    LDN: dirCount(ldnMmNetT[i - 1],  ldnMmNetT[i]),
  };
  // mmNetDir uses positions (OI sums), not counts — stays on `dir()`.
  const mmNetDir: Record<Mkt, Dir> = {
    NY:  dir(nyMmNet[i - 1],   nyMmNet[i]),
    LDN: dir(ldnMmNet[i - 1],  ldnMmNet[i]),
  };
  const prodShortTDir: Record<Mkt, DirCount> = {
    NY:  dirCount(nyProdShortT[i - 1],  nyProdShortT[i]),
    LDN: dirCount(ldnProdShortT[i - 1], ldnProdShortT[i]),
  };
  const roastLongTDir: Record<Mkt, DirCount> = {
    NY:  dirCount(nyRoastLongT[i - 1],  nyRoastLongT[i]),
    LDN: dirCount(ldnRoastLongT[i - 1], ldnRoastLongT[i]),
  };

  // ── OB/OS: 52-week price percentile (0–100) ───────────────────────────────
  const obosNY  = pct52(nyPrices,  i) * 100;
  const obosLDN = pct52(ldnPrices, i) * 100;

  // ── Curve structure (positive = backwardation, negative = contango) ────────
  const strNY   = (curr.rawNy?.structure_ny   ?? null) as number | null;
  const strLDN  = (curr.rawLdn?.structure_ldn ?? null) as number | null;
  const pStrNY  = (prev.rawNy?.structure_ny   ?? null) as number | null;
  const pStrLDN = (prev.rawLdn?.structure_ldn ?? null) as number | null;

  // ── Spreading OI ──────────────────────────────────────────────────────────
  const nySpOI   = curr.ny.swapSpread  + curr.ny.mmSpread  + curr.ny.otherSpread;
  const ldnSpOI  = curr.ldn.swapSpread + curr.ldn.mmSpread + curr.ldn.otherSpread;
  const pNySpOI  = prev.ny.swapSpread  + prev.ny.mmSpread  + prev.ny.otherSpread;
  const pLdnSpOI = prev.ldn.swapSpread + prev.ldn.mmSpread + prev.ldn.otherSpread;
  const nySpDir:  Dir = dir(pNySpOI,  nySpOI);
  const ldnSpDir: Dir = dir(pLdnSpOI, ldnSpOI);

  // ── Per-market WoW magnitudes (drivers for the magnitude field) ──────────
  const magProd: Record<Mkt, Magnitude> = {
    NY:  mag(prev.ny.pmpuShort,  curr.ny.pmpuShort),
    LDN: mag(prev.ldn.pmpuShort, curr.ldn.pmpuShort),
  };
  const magRoast: Record<Mkt, Magnitude> = {
    NY:  mag(prev.ny.pmpuLong,   curr.ny.pmpuLong),
    LDN: mag(prev.ldn.pmpuLong,  curr.ldn.pmpuLong),
  };
  const magMmL: Record<Mkt, Magnitude> = {
    NY:  mag(prev.ny.mmLong,     curr.ny.mmLong),
    LDN: mag(prev.ldn.mmLong,    curr.ldn.mmLong),
  };
  const magMmS: Record<Mkt, Magnitude> = {
    NY:  mag(prev.ny.mmShort,    curr.ny.mmShort),
    LDN: mag(prev.ldn.mmShort,   curr.ldn.mmShort),
  };
  const magMmNet: Record<Mkt, Magnitude> = {
    NY:  mag(nyMmNet[i - 1],     nyMmNet[i]),
    LDN: mag(ldnMmNet[i - 1],    ldnMmNet[i]),
  };
  const magPrice: Record<Mkt, Magnitude> = {
    NY:  mag(prev.priceNY,       curr.priceNY),
    LDN: mag(prev.priceLDN,      curr.priceLDN),
  };
  const magSpread: Record<Mkt, Magnitude> = {
    NY:  mag(pNySpOI,            nySpOI),
    LDN: mag(pLdnSpOI,           ldnSpOI),
  };
  // Curve structure magnitude: undefined endpoints → "small" (engine can't
  // meaningfully size the move when one side is missing).
  //
  // NOT mag(): that is a percent change, and the spread is a signed quantity
  // that crosses zero. A curve going +0.5 → -0.5 is a trivial move in carry
  // terms and a 200% change in mag()'s terms, so every week the curve passes
  // through flat would have read "large". Size it on the ABSOLUTE move in the
  // market's own quote unit instead — see magSpreadMove.
  const magStr: Record<Mkt, Magnitude> = {
    NY:  magSpreadMove(pStrNY,  strNY,  "NY"),
    LDN: magSpreadMove(pStrLDN, strLDN, "LDN"),
  };

  const signals: Signal[] = [];
  const add = (s: Signal) => signals.push(s);

  // ── CP — Producer Behavior ────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const pd = prodDir[mkt];
    const pr = priceDir[mkt];
    const ps = mkt === "NY" ? nyProdS : ldnProdS;

    if (pd === "up"   && pr === "up")
      add({ id:"CP1", name:"Normal Hedging",       category:"CP", categoryLabel:"Producer", market:mkt, severity:"info",  score:  0,
        magnitude: magProd[mkt],
        text:"Producers locking in levels into price strength — standard hedging flow." });

    if (pd === "up"   && pr === "down")
      add({ id:"CP2", name:"Forced Liquidation",   category:"CP", categoryLabel:"Producer", market:mkt, severity:"warn",  score: -2,
        magnitude: magProd[mkt],
        text:"Producers selling into weakness — suggests stock overhang or cash flow pressure regardless of price." });

    if (pd === "down" && pr === "up")
      add({ id:"CP3", name:"Bullish De-hedging",   category:"CP", categoryLabel:"Producer", market:mkt, severity:"warn",  score: +2,
        magnitude: magProd[mkt],
        text:"Producers lifting hedges into rising price — signals expectation of further upside." });

    if (pd === "down" && pr === "down")
      add({ id:"CP4", name:"Defensive De-hedging", category:"CP", categoryLabel:"Producer", market:mkt, severity:"info",  score:  0,
        magnitude: magProd[mkt],
        text:"Producers covering shorts on weakness — normal deleveraging, low conviction." });

    if (isHigh(ps, i))
      add({ id:"CP5", name:"Producer Exhaustion",  category:"CP", categoryLabel:"Producer", market:mkt, severity:"warn",  score: +2,
        magnitude: magFromPct(pct52(ps, i), "high"),
        text:"Producers near fully hedged (>75th pct, 52-week) — limited additional selling capacity from this actor." });

    if (isLow(ps, i))
      add({ id:"CP6", name:"Producer Dry Powder",  category:"CP", categoryLabel:"Producer", market:mkt, severity:"alert", score: -3,
        magnitude: magFromPct(pct52(ps, i), "low"),
        text:"Producers significantly under-hedged (<25th pct, 52-week) — large potential selling overhang ahead." });

    if (pd === "up" && prodShortTDir[mkt] === "down")
      add({ id:"CP7", name:"Producer Concentration", category:"CP", categoryLabel:"Producer", market:mkt, severity:"warn",  score: -1,
        magnitude: magProd[mkt],
        text:"Producer short OI rising while number of hedging entities falls — fewer, larger hedges being placed. Concentrated positioning makes the hedge book more binary: a single actor decision can shift the curve." });
  }

  // ── CR — Roaster Behavior ─────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const rd = roastDir[mkt];
    const pr = priceDir[mkt];
    const rs = mkt === "NY" ? nyRoastL : ldnRoastL;

    if (rd === "up"   && pr === "down")
      add({ id:"CR1", name:"Normal Coverage",     category:"CR", categoryLabel:"Roaster", market:mkt, severity:"info",  score:  0,
        magnitude: magRoast[mkt],
        text:"Roasters adding coverage into price weakness — standard buying flow." });

    if (rd === "up"   && pr === "up")
      add({ id:"CR2", name:"Forced Coverage",     category:"CR", categoryLabel:"Roaster", market:mkt, severity:"warn",  score: +1,
        magnitude: magRoast[mkt],
        text:"Roasters buying into rising price — suggests coverage urgency, potentially being squeezed." });

    if (rd === "down" && pr === "down")
      add({ id:"CR3", name:"Coverage Reduction",  category:"CR", categoryLabel:"Roaster", market:mkt, severity:"info",  score: -1,
        magnitude: magRoast[mkt],
        text:"Roasters reducing coverage on weakness — expecting further downside or reducing exposure." });

    if (rd === "down" && pr === "up")
      add({ id:"CR4", name:"Unusual Liquidation", category:"CR", categoryLabel:"Roaster", market:mkt, severity:"warn",  score: -2,
        magnitude: magRoast[mkt],
        text:"Roasters reducing coverage into rising price — may signal demand destruction or blend substitution toward Robusta." });

    if (isLow(rs, i) && pr === "up")
      add({ id:"CR5", name:"Squeeze Risk",        category:"CR", categoryLabel:"Roaster", market:mkt, severity:"alert", score: +3,
        magnitude: magBig(magFromPct(pct52(rs, i), "low"), magPrice[mkt]),
        text:"Roasters dangerously under-covered (<25th pct) into rising price — high risk of being forced to buy at unfavorable levels." });

    if (isHigh(rs, i))
      add({ id:"CR6", name:"Roaster Dry Powder",    category:"CR", categoryLabel:"Roaster", market:mkt, severity:"warn",  score: -2,
        magnitude: magFromPct(pct52(rs, i), "high"),
        text:"Roasters near fully covered (>75th pct) — limited additional buying capacity from this actor." });

    if (rd === "up" && roastLongTDir[mkt] === "down")
      add({ id:"CR7", name:"Roaster Concentration", category:"CR", categoryLabel:"Roaster", market:mkt, severity:"warn",  score: +1,
        magnitude: magRoast[mkt],
        text:"Roaster long OI rising while number of buying entities falls — fewer, larger coverage positions. Concentration suggests urgency from a small number of actors, potentially amplifying short-term price impact." });
  }

  // ── CI — Commercial Interaction ───────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const pd = prodDir[mkt];
    const rd = roastDir[mkt];

    if (pd === "down" && rd === "up")
      add({ id:"CI1", name:"Commercial Convergence Bullish", category:"CI", categoryLabel:"Commercial", market:mkt, severity:"warn",  score: +3,
        magnitude: magBig(magProd[mkt], magRoast[mkt]),
        text:"Both commercials aligned bullish — strong fundamental demand signal." });

    if (pd === "up"   && rd === "down")
      add({ id:"CI2", name:"Commercial Convergence Bearish", category:"CI", categoryLabel:"Commercial", market:mkt, severity:"warn",  score: -3,
        magnitude: magBig(magProd[mkt], magRoast[mkt]),
        text:"Both commercials aligned bearish — strong fundamental supply pressure signal." });

    // CI3 stays gated off pr=down: when both sides are active but price is
    // falling, CP2 ("Forced Liquidation", −2) fires concurrently and the
    // "equilibrium" framing here would contradict it. Restrict to pr=up
    // (genuine two-sided demand) or pr=flat (true equilibrium).
    if (pd === "up"   && rd === "up"   && priceDir[mkt] !== "down")
      add({ id:"CI3", name:"Normal Commercial Flow",         category:"CI", categoryLabel:"Commercial", market:mkt, severity:"info",  score:  0,
        magnitude: magBig(magProd[mkt], magRoast[mkt]),
        text:"Producers and roasters both active on their respective sides — healthy two-sided commercial flow." });

    if (pd === "flat" && rd === "flat")
      add({ id:"CI4", name:"Commercial Vacuum",              category:"CI", categoryLabel:"Commercial", market:mkt, severity:"alert", score:  0,
        // CI4 has no WoW driver (both sides flat) and no percentile gate;
        // hard-code medium so the chip surfaces the structural alert.
        magnitude: "medium",
        text:"No commercial activity — market driven purely by speculative flow. Highly fragile, vulnerable to sharp reversal when commercials re-engage." });
  }

  // ── ML — MM Longs Behavior ────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml  = mmLDir[mkt];
    const pr  = priceDir[mkt];
    const mls = mkt === "NY" ? nyMmL : ldnMmL;

    if (ml === "up" && pr === "up" && !isHigh(mls, i))
      add({ id:"ML1", name:"Fund Bullish Entry",      category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"info",  score: +1,
        magnitude: magMmL[mkt],
        text:"Funds building longs into price strength — conviction depends on magnitude of the move." });

    if (ml === "up" && pr === "up" && isHigh(mls, i))
      add({ id:"ML2", name:"Fund Bullish Exhaustion", category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn",  score: -2,
        magnitude: magBig(magMmL[mkt], magFromPct(pct52(mls, i), "high")),
        text:"Funds adding longs but near capacity (>75th pct) — bullish momentum likely limited, reversal risk increasing." });

    if (ml === "up" && pr === "down")
      add({ id:"ML3", name:"Contrarian Fund Buying",  category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn",  score: +1,
        magnitude: magMmL[mkt],
        links: [LINK_FLOW],
        text:"Funds buying into weakness — contrarian positioning. Cross-reference OI sequence and the brother contract." });

    if (ml === "down" && pr === "down")
      add({ id:"ML4", name:"Fund Long Liquidation",   category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"info",  score: -1,
        magnitude: magMmL[mkt],
        text:"Funds reducing longs into falling price — bearish momentum, trend following." });

    if (ml === "down" && pr === "up")
      add({ id:"ML5", name:"Fund Long Exit",          category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn",  score: -2,
        magnitude: magMmL[mkt],
        links: [LINK_FLOW],
        text:"Funds reducing longs despite rising price — may reflect lack of conviction or profit taking after a strong rally." });

    if (isHigh(mls, i) && pr === "down")
      add({ id:"ML6", name:"Fund Long Overhang",       category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"alert", score: -3,
        magnitude: magFromPct(pct52(mls, i), "high"),
        text:"Large speculative long position (>75th pct) with price already reversing — liquidation underway, momentum risk elevated." });

    if (isHigh(mls, i) && pr === "flat")
      add({ id:"ML6W", name:"Fund Long Overhang (Watch)", category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn", score: -2,
        magnitude: magFromPct(pct52(mls, i), "high"),
        text:"Large speculative long position (>75th pct) with stalling price — momentum failing to follow, liquidation risk if price doesn't resume." });

    if (ml === "up" && mmLongTDir[mkt] === "down")
      add({ id:"ML7", name:"Long Concentration",       category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn",  score: -1,
        magnitude: magMmL[mkt],
        text:"MM long OI rising while number of long traders falls — fewer, larger positions. Concentration increases fragility: a forced exit by one actor can cascade." });
  }

  // ── MS — MM Shorts Behavior ───────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ms  = mmSDir[mkt];
    const ml  = mmLDir[mkt];
    const pr  = priceDir[mkt];
    const mss = mkt === "NY" ? nyMmS : ldnMmS;

    if (ms === "up" && pr === "down" && !isHigh(mss, i))
      add({ id:"MS1", name:"Fund Bearish Entry",       category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"info",  score: -1,
        magnitude: magMmS[mkt],
        text:"Funds building shorts into price weakness — conviction depends on magnitude of the move." });

    if (ms === "up" && pr === "down" && isHigh(mss, i))
      add({ id:"MS2", name:"Fund Bearish Exhaustion",  category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: +2,
        magnitude: magBig(magMmS[mkt], magFromPct(pct52(mss, i), "high")),
        text:"Funds adding shorts near capacity (>75th pct) — bearish momentum likely limited, short covering risk increasing." });

    if (ms === "up" && pr === "up")
      add({ id:"MS3", name:"Contrarian Fund Shorting", category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: -2,
        magnitude: magMmS[mkt],
        text:"Funds shorting into rising price — contrarian positioning, betting on reversal." });

    if (ms === "down" && pr === "up")
      add({ id:"MS4", name:"Fund Short Covering",      category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"info",  score: +1,
        magnitude: magMmS[mkt],
        text:`Funds covering shorts into rising price — adds fuel to bullish momentum. ${
          ml === "up" ? "MM longs also rising: strong bullish conviction." :
          ml === "down" ? "MM longs falling: funds may be reducing coffee exposure overall." : ""
        }`.trim() });

    if (ms === "down" && pr === "down")
      add({ id:"MS5", name:"Reluctant Short Cover",    category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: +1,
        magnitude: magMmS[mkt],
        text:"Funds covering shorts despite falling price — may signal exhaustion of bearish thesis." });

    if (isHigh(mss, i) && pr === "up")
      add({ id:"MS6", name:"Fund Short Squeeze Risk",     category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"alert", score: +3,
        magnitude: magFromPct(pct52(mss, i), "high"),
        text:"Large speculative short position (>75th pct) with price already rising — short squeeze underway, covering pressure accelerating." });

    if (isHigh(mss, i) && pr === "flat")
      add({ id:"MS6W", name:"Fund Short Squeeze (Watch)", category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: +2,
        magnitude: magFromPct(pct52(mss, i), "high"),
        text:"Large speculative short position (>75th pct) with price stalling — bears failing to push through, squeeze risk if price reverses." });

    if (ms === "up" && mmShortTDir[mkt] === "down")
      add({ id:"MS7", name:"Short Concentration",         category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: +1,
        magnitude: magMmS[mkt],
        text:"MM short OI rising while number of short traders falls — fewer, larger short positions. Concentration increases squeeze fragility: a stop-out by one large actor can compress the market rapidly." });
  }

  // ── MI — MM Longs × MM Shorts Interaction ────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml = mmLDir[mkt];
    const ms = mmSDir[mkt];

    if (ml === "up"   && ms === "down")
      add({ id:"MI1", name:"Speculative Conviction Bullish", category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score: +2,
        magnitude: magBig(magMmL[mkt], magMmS[mkt]),
        text:"Funds adding longs and covering shorts simultaneously — strong bullish conviction." });

    if (ml === "down" && ms === "up")
      add({ id:"MI2", name:"Speculative Conviction Bearish", category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score: -2,
        magnitude: magBig(magMmL[mkt], magMmS[mkt]),
        text:"Funds reducing longs and adding shorts simultaneously — strong bearish conviction." });

    if (ml === "up"   && ms === "up")
      add({ id:"MI3", name:"Speculative Confusion",          category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score:  0,
        magnitude: magBig(magMmL[mkt], magMmS[mkt]),
        links: [LINK_GAUGES, LINK_FLOW],
        text:"Both sides growing — net position will decide which side dominates." });

    if (ml === "down" && ms === "down")
      add({ id:"MI4", name:"Speculative Retreat",            category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"info",  score:  0,
        magnitude: magBig(magMmL[mkt], magMmS[mkt]),
        links: [LINK_FLOW],
        text:"Both sides reducing — net change will reveal whether this is coffee-specific or broader deleveraging." });

    const mmNetS = mkt === "NY" ? nyMmNet : ldnMmNet;
    if (isHigh(mmNetS, i))
      add({ id:"MI5", name:"Net Long Exhaustion",            category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score: -2,
        magnitude: magFromPct(pct52(mmNetS, i), "high"),
        text:"MM net long position near 52-week high (>75th pct) — speculative net longs at extreme, limited room to add. Mean-reversion risk elevated." });

    if (isLow(mmNetS, i))
      add({ id:"MI6", name:"Net Short Exhaustion",           category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score: +2,
        magnitude: magFromPct(pct52(mmNetS, i), "low"),
        text:"MM net position near 52-week low (<25th pct) — speculative net shorts at extreme, limited room to extend. Short-covering catalyst risk elevated." });
  }

  // ── MPI — MM × Producers Interaction ─────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml   = mmLDir[mkt];
    const pd   = prodDir[mkt];
    const pr   = priceDir[mkt];
    const _mls = mkt === "NY" ? nyMmL : ldnMmL;
    const _ps  = mkt === "NY" ? nyProdS : ldnProdS;

    if (ml === "up"   && pd === "up"   && pr === "up")
      add({ id:"MPI1", name:"Classic Bullish Flow",              category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"info",  score: +2,
        magnitude: magBig(magMmL[mkt], magProd[mkt]),
        text:"Funds buying against producer hedging into rising price — textbook bullish market structure. Producers locking in levels, funds betting on further upside." });

    if (ml === "up"   && pd === "up"   && pr === "down")
      add({ id:"MPI2", name:"Forced Market",                     category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"warn",  score: -2,
        magnitude: magBig(magMmL[mkt], magProd[mkt]),
        links: [LINK_GAUGES, LINK_FLOW],
        text:"Funds buying against producer selling into falling price — min/max levels of both actors and daily OI sequence reveal the dominant pressure." });

    if (ml === "up"   && pd === "down" && pr === "up")
      add({ id:"MPI3", name:"Squeeze Setup",                     category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"alert", score: +3,
        magnitude: magBig(magMmL[mkt], magProd[mkt]),
        text:"Funds and producers both bullish simultaneously — strong squeeze risk, limited natural selling. Confirm with roaster coverage levels: if under-covered, squeeze is amplified." });

    if (ml === "down" && pd === "up"   && pr === "down")
      add({ id:"MPI4", name:"Bearish Capitulation",              category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"alert", score: -3,
        magnitude: magBig(magMmL[mkt], magProd[mkt]),
        links: [LINK_GAUGES],
        text:"Funds liquidating longs while producers add hedges — broad bearish alignment. Roaster behavior confirms breadth: if they're also reducing coverage, conviction is across all actors." });

    if (ml === "down" && pd === "down" && pr === "up")
      add({ id:"MPI5", name:"Divergence Signal",                 category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"warn",  score: -1,
        magnitude: magBig(magMmL[mkt], magProd[mkt]),
        text:"Funds reducing longs while producers lift hedges into rising price — neither actor convinced by the rally. Check if funds are near historical max (profit taking) or early in rally (lack of conviction)." });

    if (ml === "up"   && pd === "up"   && pr === "flat")
      add({ id:"MPI7", name:"Natural Market Balance",            category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"info",  score:  0,
        magnitude: magBig(magMmL[mkt], magProd[mkt]),
        text:"Funds and producers both active but price going nowhere — equilibrium. Expand to MM shorts and roaster coverage to identify which actor breaks first." });
  }

  // ── MRI — MM × Roasters Interaction ──────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml  = mmLDir[mkt];
    const rd  = roastDir[mkt];
    const _pd = prodDir[mkt];
    const pr  = priceDir[mkt];
    const rs  = mkt === "NY" ? nyRoastL : ldnRoastL;

    if (ml === "up" && rd === "up" && pr === "up" && !isLow(rs, i))
      add({ id:"MRI1", name:"Double Buying Pressure",        category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"warn",  score: +2,
        magnitude: magBig(magMmL[mkt], magRoast[mkt]),
        text:"Funds and roasters buying simultaneously — powerful bullish combination creating structural demand pressure. Watch for producer response as natural counterbalance." });

    if (ml === "up" && rd === "up" && pr === "up" && isLow(rs, i))
      add({ id:"MRI2", name:"Roaster Squeeze Confirmed",     category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"alert", score: +3,
        magnitude: magBig(magBig(magMmL[mkt], magRoast[mkt]), magFromPct(pct52(rs, i), "low")),
        text:"Funds buying while under-covered roasters (<25th pct) are forced into the market — classic squeeze dynamic. Price likely continues rising until roaster coverage normalizes." });

    if (ml === "up" && rd === "down" && pr === "up")
      add({ id:"MRI3", name:"Contrarian Divergence",         category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"warn",  score: -1,
        magnitude: magBig(magMmL[mkt], magRoast[mkt]),
        text:`Funds adding longs while roasters reduce coverage into rising price — the brother contract (${mkt === "NY" ? "LDN" : "NY"}, shown opposite) reveals whether blend switching is at play. Substitution would undermine the bullish thesis.` });

    if (ml === "down" && rd === "down" && pr === "down")
      add({ id:"MRI4", name:"Bearish Convergence",           category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"alert", score: -3,
        magnitude: magBig(magMmL[mkt], magRoast[mkt]),
        text:"Funds and roasters both reducing exposure — broad-based selling. Roasters either well covered or expecting further downside. Strong bearish signal." });

    if (ml === "up" && rd === "flat" && pr === "up")
      add({ id:"MRI5", name:"Fund Buying vs Roaster Absence",category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"warn",  score:  0,
        magnitude: magMmL[mkt],
        links: [LINK_DRYPOWDER, LINK_CYCLE],
        text:"Funds driving price higher but roasters not participating — rally sustainable only if roasters are eventually forced to cover. Roaster coverage percentile and calendar spread carry costs gate the squeeze." });

    if (ml === "down" && rd === "up" && pr === "down")
      add({ id:"MRI6", name:"Roaster Coverage Opportunity",  category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"info",  score: +1,
        magnitude: magBig(magMmL[mkt], magRoast[mkt]),
        text:"Funds reducing while roasters opportunistically add coverage into weakness — puts a floor under the price decline." });

  }

  // ── TC — Trader Count vs Net Position Mismatch ───────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    if (mmNetDir[mkt] === "up" && mmNetTDir[mkt] === "down")
      add({ id:"TC1", name:"Bullish Concentration",  category:"TC", categoryLabel:"Trader Count", market:mkt, severity:"warn",  score: -1,
        magnitude: magMmNet[mkt],
        text:"MM net position growing bullish while net trader count shrinks — the bullish move is driven by fewer actors. Concentration increases reversal fragility." });

    if (mmNetDir[mkt] === "down" && mmNetTDir[mkt] === "up")
      add({ id:"TC2", name:"Bearish Distribution",   category:"TC", categoryLabel:"Trader Count", market:mkt, severity:"info",  score:  0,
        magnitude: magMmNet[mkt],
        text:"MM net position turning more bearish while net trader count expands — broad-based shift in sentiment, more participants positioning short. Distributed, not concentrated." });
  }

  // ── CS — Curve Structure ──────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const str  = mkt === "NY" ? strNY  : strLDN;
    const pStr = mkt === "NY" ? pStrNY : pStrLDN;
    const rs   = mkt === "NY" ? nyRoastL : ldnRoastL;
    const ps   = mkt === "NY" ? nyProdS  : ldnProdS;
    const ml   = mmLDir[mkt];
    const rd   = roastDir[mkt];
    const label = mkt === "NY" ? "KC" : "RC";
    if (str === null) continue;

    // DB stores structure = deferred − front: negative = backwardation, positive = contango
    const back = str < 0;
    const con  = str > 0;

    if (back)
      add({ id:"CS1", name:"Backwardation Incentive", category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"info",  score: +1,
        magnitude: magStr[mkt],
        text:`${label} curve in backwardation — front premium rewards long holders, supportive of bullish positioning. Verify that roll yield exceeds the risk-free rate to confirm the incentive is real.` });

    if (con && ml === "up")
      add({ id:"CS3", name:"Contango Pressure",       category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"warn",  score: -1,
        magnitude: magBig(magStr[mkt], magMmL[mkt]),
        text:`${label} in contango while funds build longs — negative carry works against long holders. Conviction must be strong to justify the position.` });

    if (con && rd === "up")
      add({ id:"CS4", name:"Contango Relief",         category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"info",  score:  0,
        magnitude: magBig(magStr[mkt], magRoast[mkt]),
        text:`${label} in contango while roasters add coverage — forward prices cheaper than spot, incentivizes forward buying. Normal and sustainable.` });

    if (back && pStr !== null && str < pStr && isLow(rs, i))
      add({ id:"CS5", name:"Deepening Inversion",     category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"alert", score: +2,
        magnitude: magBig(magStr[mkt], magFromPct(pct52(rs, i), "low")),
        text:`${label} backwardation deepening while roasters are under-covered (<25th pct) — cost of forward coverage increasing week-on-week, amplifying squeeze risk. Cross-check against roll window.` });

    if (back && pStr !== null && str > pStr)
      add({ id:"CS6", name:"Inversion Easing",        category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"warn",  score: -1,
        magnitude: magStr[mkt],
        text:`${label} backwardation losing strength — reduces incentive for longs to hold, may trigger gradual long liquidation. Check if easing coincides with roll window.` });

    if (con && isLow(ps, i))
      add({ id:"CS7", name:"Structural Contango",     category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"warn",  score: -1,
        magnitude: magBig(magStr[mkt], magFromPct(pct52(ps, i), "low")),
        text:`${label} in contango while producers significantly under-hedged — forward prices give producers attractive levels to add hedges. Potential selling overhang building.` });
  }

  // ── OB — Overbought / Oversold ────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const obos  = mkt === "NY" ? obosNY : obosLDN;
    const pr    = priceDir[mkt];
    const mls   = mkt === "NY" ? nyMmL    : ldnMmL;
    const rs    = mkt === "NY" ? nyRoastL : ldnRoastL;
    const ps    = mkt === "NY" ? nyProdS  : ldnProdS;
    const label = mkt === "NY" ? "KC" : "RC";

    // OB gates use >= / <= (inclusive) to match isHigh / isLow's boundary
    // behaviour. At exactly pct52 = PCT_HIGH, isHigh(rs,i) fires and so does
    // any OB rule that gates on obos >= OB_HIGH.
    if (obos >= THRESHOLDS.OB_HIGH && !isLow(rs, i))
      add({ id:"OB1", name:"Overbought Warning",       category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score: -2,
        magnitude: magFromPct(obos / 100, "high"),
        links: [LINK_CYCLE],
        text:`${label} technically overbought (≥${THRESHOLDS.OB_HIGH}th pct, 52-week) with funds near capacity — upside limited. If calendar-spread inversion weakens, holding costs may accelerate long liquidation.` });

    if (obos >= THRESHOLDS.OB_HIGH && isLow(rs, i))
      add({ id:"OB2", name:"Overbought but Supported", category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score:  0,
        magnitude: magBig(magFromPct(obos / 100, "high"), magFromPct(pct52(rs, i), "low")),
        text:`${label} overbought but roasters significantly under-covered (≤25th pct) — technical selling pressure offset by structural commercial demand. Correction likely shallow.` });

    if (obos <= THRESHOLDS.OB_LOW && isLow(mls, i))
      add({ id:"OB3", name:"Oversold Opportunity",     category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score: +2,
        magnitude: magBig(magFromPct(obos / 100, "low"), magFromPct(pct52(mls, i), "low")),
        text:`${label} technically oversold (≤${THRESHOLDS.OB_LOW}th pct) with funds near minimum exposure — high potential for mean-reversion rally. If contango is deep, re-entry incentive for funds is reduced. Watch for catalyst.` });

    if (obos <= THRESHOLDS.OB_LOW && isLow(ps, i))
      add({ id:"OB4", name:"Oversold but Vulnerable",  category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score:  0,
        magnitude: magBig(magFromPct(obos / 100, "low"), magFromPct(pct52(ps, i), "low")),
        text:`${label} oversold but producers significantly under-hedged (≤25th pct) — potential recovery capped by producer selling overhang. Bounce likely limited.` });

    if (obos >= THRESHOLDS.OB_HIGH && pr === "down")
      add({ id:"OB6", name:"Divergence Warning",       category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"alert", score: -3,
        magnitude: magBig(magFromPct(obos / 100, "high"), magPrice[mkt]),
        links: [LINK_INDUSTRY],
        text:`${label} overbought but price already falling — momentum turning. Weekly change in trader counts reveals breadth: if also falling, the unwind is broad-based.` });

    if (obos <= THRESHOLDS.OB_LOW && pr === "up")
      add({ id:"OB7", name:"Oversold Divergence",      category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score: +2,
        magnitude: magBig(magFromPct(obos / 100, "low"), magPrice[mkt]),
        text:`${label} technically oversold but price already recovering — short covering likely driving the move. Sustainable only if commercial buyers confirm with increased coverage.` });
  }

  // ── SP — Spreading ────────────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const spDir = mkt === "NY" ? nySpDir  : ldnSpDir;
    const pr    = priceDir[mkt];
    const str   = mkt === "NY" ? strNY   : strLDN;
    const pStr  = mkt === "NY" ? pStrNY  : pStrLDN;

    if (spDir === "up" && pr !== "up")
      add({ id:"SP1", name:"Spreading Increase",     category:"SP", categoryLabel:"Spreading", market:mkt, severity:"info",  score:  0,
        magnitude: magSpread[mkt],
        links: [LINK_CYCLE],
        text:"Spreading OI increasing without directional price move — funds positioning across the curve. Often precedes a decisive directional move; the calendar-spread direction hints which way." });

    if (spDir === "down")
      add({ id:"SP2", name:"Spreading Decrease",     category:"SP", categoryLabel:"Spreading", market:mkt, severity:"info",  score:  0,
        magnitude: magSpread[mkt],
        text:"Funds collapsing spread positions — may signal transition to outright directional positioning. Watch which direction longs and shorts move next." });

    if (spDir === "up" && str !== null && pStr !== null && str < 0 && str < pStr)
      add({ id:"SP3", name:"Spreading vs Inversion", category:"SP", categoryLabel:"Spreading", market:mkt, severity:"warn",  score:  0,
        magnitude: magBig(magSpread[mkt], magStr[mkt]),
        text:"Spreading OI increasing while backwardation deepens — funds likely harvesting backwardation premium. Not a directional signal but confirms curve structure is attracting capital." });
  }

  return signals;
}

// ── Composite score helpers ───────────────────────────────────────────────────

/**
 * Category weights for the composite score.
 *
 * Multiple rules can fire on the same underlying market state — e.g. a
 * bullish flow lights up CP3 (producer) + CR2 (roaster) + CI1 (commercial
 * interaction) + ML1 (fund long) + MPI1 (MM×Producer) all at once. Treating
 * each as a fresh +score triple-counts the evidence and inflates the
 * composite. Tiered weighting gives interaction and meta categories
 * diminishing returns so each unit of evidence is counted once at full
 * strength.
 *
 *   Primitive (direct observations of one actor) : weight 1.00
 *   Interaction (cross-actor / multi-driver)     : weight 0.50
 *   Meta / structure / context                    : weight 0.25
 */
const CATEGORY_WEIGHTS: Record<string, number> = {
  // Primitive actor categories
  CP: 1.0, CR: 1.0, ML: 1.0, MS: 1.0,
  // Interaction categories — combinations of primitives, halved
  CI: 0.5, MI: 0.5, MPI: 0.5, MRI: 0.5,
  // Meta / structure / context — quarter weight
  TC: 0.25, OB: 0.25, CS: 0.25, SP: 0.25,
};

/**
 * Magnitude weights for the composite score. A "large" CP3 carries more
 * conviction than a "small" CP3, so it should contribute more to the gauge.
 *   small  → 0.5  (just past the gate, low conviction)
 *   medium → 1.0  (baseline)
 *   large  → 1.5  (well past the gate / large WoW move)
 */
const MAGNITUDE_WEIGHTS: Record<Magnitude, number> = {
  small:  0.5,
  medium: 1.0,
  large:  1.5,
};

export function computeCompositeScores(signals: Signal[]): { scoreNY: number; scoreLDN: number } {
  let scoreNY  = 0;
  let scoreLDN = 0;
  for (const s of signals) {
    const cw = CATEGORY_WEIGHTS[s.category]  ?? 1.0;
    const mw = MAGNITUDE_WEIGHTS[s.magnitude] ?? 1.0;
    const weighted = s.score * cw * mw;
    if (s.market === "NY")  scoreNY  += weighted;
    else                    scoreLDN += weighted;
  }
  return { scoreNY, scoreLDN };
}

// ── Historical tracking ───────────────────────────────────────────────────────

/**
 * Evaluate signals for each of the last `weeks` weeks.
 * Each call uses the full history up to that point for accurate percentile calcs.
 *
 * IMPORTANT — known off-by-one (locked behaviour): the loop iterates
 * `for (end = max(1, n - weeks); end <= n; end++)` which produces
 * `weeks + 1` entries when `n > weeks` (e.g. n=60, weeks=8 → 9 entries).
 * This is intentional and pinned by the test suite. The 8-week heatmap UI
 * slices `history.slice(-8)` so the extra leading entry is dropped at the
 * presentation layer. Do not "fix" without coordinating the UI slice and
 * the back-test bookkeeping.
 */
export function evaluateHistoricalSignals(rows: ProcessedCotRow[], weeks = 8): HistoricalWeek[] {
  const result: HistoricalWeek[] = [];
  const start = Math.max(1, rows.length - weeks);
  for (let end = start; end <= rows.length; end++) {
    const slice   = rows.slice(0, end);
    const sigs    = evaluateSignals(slice);
    const raw = computeCompositeScores(sigs);
    const scoreNY  = Math.max(-10, Math.min(10, Math.round(raw.scoreNY)));
    const scoreLDN = Math.max(-10, Math.min(10, Math.round(raw.scoreLDN)));
    const row = rows[end - 1];
    result.push({ date: row.date, signals: sigs, scoreNY, scoreLDN, priceNY: row.priceNY, priceLDN: row.priceLDN });
  }
  return result;
}
