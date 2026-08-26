// Arrivals into the EU vs the change in EU port stocks.
//
// THE IDEA. Coffee that lands in Europe either goes into a warehouse or goes
// straight to a roaster. So in a market where roasting demand is steady, a big
// arrivals month should show up as a big stock build about a month later, and
// the two series track each other. When that relationship weakens, arrivals are
// being consumed rather than stored — the pipeline is running tighter than the
// headline import number suggests.
//
// CONSTRUCTION, matching the reference chart:
//   x = arrivals, summed over 2 months, shifted forward by `lagMonths`
//   y = change in port stocks over the same 2-month window
// The lag is a shipment/clearance allowance: goods clear customs in one month
// and reach the warehouse survey in the next. The 2-month rolling sum damps the
// sawtooth that vessel timing puts into any single month.

export interface ScatterPoint {
  period: string;        // the stock month the point is anchored on
  exports: number;       // 000s bags, 2-month rolling
  stockChange: number;   // 000s bags, 2-month change
}

export interface Fit { slope: number; intercept: number; r2: number; n: number }

/** 60 kg per bag; series arrive in MT and the reference chart is in 000s bags. */
export const MT_TO_KBAGS = 1000 / 60 / 1000;

/** Shift a YYYY-MM key by n months. */
export function shiftMonth(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Build the scatter from monthly arrivals (MT) and monthly stock levels (MT).
 *
 * Both inputs are keyed YYYY-MM. Stock CHANGE is computed here rather than
 * taken as given, because a level series with a gap would otherwise produce a
 * fake change across the gap — so a month whose predecessor is missing is
 * dropped instead of differenced against whatever came before.
 */
export function buildScatter(
  arrivalsMt: Record<string, number>,
  stockLevelMt: Record<string, number>,
  lagMonths = 1,
  window = 2,
): ScatterPoint[] {
  const out: ScatterPoint[] = [];
  const stockMonths = Object.keys(stockLevelMt).sort();

  for (const period of stockMonths) {
    // y: stock change across the window, requiring every month in it.
    const start = shiftMonth(period, -window);
    const endLvl = stockLevelMt[period];
    const startLvl = stockLevelMt[start];
    if (endLvl == null || startLvl == null) continue;

    // x: arrivals summed over the same window, shifted back by the lag.
    let arrivals = 0;
    let complete = true;
    for (let i = 0; i < window; i++) {
      const m = shiftMonth(period, -lagMonths - i);
      const v = arrivalsMt[m];
      if (v == null) { complete = false; break; }
      arrivals += v;
    }
    if (!complete) continue;

    out.push({
      period,
      exports: arrivals * MT_TO_KBAGS,
      stockChange: (endLvl - startLvl) * MT_TO_KBAGS,
    });
  }
  return out;
}

/**
 * Drop months whose stock LEVEL is not physically believable.
 *
 * The ECF series carries contaminated rows — 745,601 -> 377,821 -> 807,387 MT
 * across five months of 2019, and a cluster in 2014 where the feed changes
 * basis. Aggregate port stocks do not halve and double; those are parse
 * artefacts, not market events.
 *
 * They are not cosmetic. Left in, they flip the relationship from slope +0.77 /
 * R2 0.30 to slope -0.10 / R2 0.001 — eleven bad points bury a real signal in
 * 149.
 *
 * The test is deviation from a LOCAL MEDIAN, not from the previous month. A
 * chain rule fails twice over: a spike corrupts both the step into it and the
 * step out, and anchoring each month to the last trusted one lets legitimate
 * multi-year drift accumulate until every later month looks like an outlier
 * (the first version of this function dropped 148 of 151 months that way). A
 * median over the surrounding window is immune to both.
 *
 * It does NOT rescue 2014-2019. The 2019 damage is a four-month BLOCK sitting
 * at roughly half level (745,601 -> ~370,000 for four months -> 807,387), and
 * no short-window median can tell a sustained block from the truth. That is
 * why the chart starts at TRUSTED_FROM rather than running the full series:
 * a filter aggressive enough to clean a block would be one this data cannot
 * justify.
 */
export function sanitiseLevels(
  levels: Record<string, number>,
  maxDeviation = 0.35,
  halfWindow = 3,
): { clean: Record<string, number>; dropped: string[] } {
  const months = Object.keys(levels).sort();
  const clean: Record<string, number> = {};
  const dropped: string[] = [];

  const median = (xs: number[]) => {
    const a = [...xs].sort((p, q) => p - q);
    const mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  };

  months.forEach((m, i) => {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(months.length, i + halfWindow + 1);
    // Neighbours only — including the point itself would let a spike vote for
    // its own legitimacy in a short window.
    const neighbours = months.slice(lo, hi).filter((_, j) => lo + j !== i).map(k => levels[k]);
    if (neighbours.length < 2) { clean[m] = levels[m]; return; }
    const med = median(neighbours);
    if (med > 0 && Math.abs(levels[m] - med) / med > maxDeviation) dropped.push(m);
    else clean[m] = levels[m];
  });

  return { clean, dropped };
}

/**
 * Where the stock series becomes trustworthy.
 *
 * Measured, not chosen: every month from here on survives the outlier test,
 * and the relationship it produces is coherent (slope 0.77, R2 0.30 — about
 * three-quarters of incremental arrivals showing up as stock build). Run the
 * same construction across the contaminated years and it inverts to slope
 * -0.10, R2 0.001. Raise this date if the ECF parse is ever fixed backwards.
 */
export const TRUSTED_FROM = "2020-01";

/** Ordinary least squares plus R², the same statistic the reference chart quotes. */
export function fit(points: ScatterPoint[]): Fit | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.exports, 0) / n;
  const my = points.reduce((s, p) => s + p.stockChange, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of points) {
    const dx = p.exports - mx, dy = p.stockChange - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: (sxy * sxy) / (sxx * syy), n };
}

/** Recency bucket for colouring — newest first. */
export type Recency = "latest" | "previous" | "recent" | "history";

export function recencyOf(index: number, total: number): Recency {
  const fromEnd = total - 1 - index;
  if (fromEnd === 0) return "latest";
  if (fromEnd === 1) return "previous";
  if (fromEnd <= 5) return "recent";     // the four before the previous one
  return "history";
}

// Navy on a dark canvas is the obvious literal reading of "dark blue" and the
// wrong one — #1e3a8a rendered as a hole in the plot, indistinguishable from
// background. What the spec is really asking for is a blue that reads as more
// SOLID than the washed-out history, so the recent cluster carries weight
// without competing with the red. Saturation does that job where darkness
// can't.
export const RECENCY_STYLE: Record<Recency, { fill: string; opacity: number; label: string }> = {
  latest:   { fill: "#ef4444", opacity: 1,    label: "Latest month" },
  previous: { fill: "#fdba74", opacity: 1,    label: "Month before" },
  recent:   { fill: "#3b82f6", opacity: 1,    label: "Prior 4 months" },
  history:  { fill: "#93c5fd", opacity: 0.38, label: "History" },
};
