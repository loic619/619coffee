// ── Constants ──────────────────────────────────────────────────────────────────
export const ARABICA_MT_FACTOR   = 17.01;
export const ROBUSTA_MT_FACTOR   = 10.00;
export const MARGIN_OUTRIGHT     = 6000;
export const MARGIN_SPREAD       = 1200;
import { KC_CENTS_TO_USD_MT } from "@/lib/units";
/** Kept as a named export for existing callers; the number lives in lib/units. */
export const CENTS_LB_TO_USD_TON = KC_CENTS_TO_USD_MT;

import type { CotRawRow, CotRawMarket, ProcessedCotRow, CotMarketPositions, CotTradersGroup, CotTradersGroupShort } from "./types";

// ── Real data transform ─────────────────────────────────────────────────────
export function transformApiData(rows: CotRawRow[]): ProcessedCotRow[] {
  if (!rows.length) return [];

  // Drop price-only placeholder rows (CFTC not yet released for that week).
  // These have price_ny/price_ldn but oi_total null on both markets.
  const positioned = rows.filter(r => (r.ny?.oi_total != null) || (r.ldn?.oi_total != null));
  if (!positioned.length) return [];

  // Forward-fill missing market data (e.g. US holiday shifts NY release by 1 day)
  let lastNY:  CotRawMarket | null = null;
  let lastLDN: CotRawMarket | null = null;
  const filledRows = positioned.map(row => {
    const ny  = row.ny  ?? lastNY  ?? null;
    const ldn = row.ldn ?? lastLDN ?? null;
    if (row.ny  != null) lastNY  = row.ny;
    if (row.ldn != null) lastLDN = row.ldn;
    return { ...row, ny, ldn };
  });

  let prevPriceNY  = 130;
  let prevPriceLDN = 1800;
  let cumulativeNominal = 0;
  let cumulativeMargin  = 0;

  // Pass 1: ordered for-loop — delta fields require access to previous row
  const base: ProcessedCotRow[] = [];
  for (let i = 0; i < filledRows.length; i++) {
    const row = filledRows[i];
    const ny: CotRawMarket  = row.ny  ?? {};
    const ldn: CotRawMarket = row.ldn ?? {};

    const oiNY  = ny.oi_total  ?? 0;
    const oiLDN = ldn.oi_total ?? 0;
    const totalOI = oiNY + oiLDN;

    // Spreading — from RAW API spread fields (NOT from the ny/ldn sub-objects below)
    const spreadingNY  = (ny.swap_spread  ?? 0) + (ny.mm_spread  ?? 0) + (ny.other_spread  ?? 0);
    const spreadingLDN = (ldn.swap_spread ?? 0) + (ldn.mm_spread ?? 0) + (ldn.other_spread ?? 0);
    const spreadingTotal = spreadingNY + spreadingLDN;
    const outrightTotal  = totalOI - spreadingTotal;

    // Price carry-forward
    const priceNY  = ny.price_ny   != null ? ny.price_ny   : prevPriceNY;
    const priceLDN = ldn.price_ldn != null ? ldn.price_ldn : prevPriceLDN;
    prevPriceNY  = priceNY;
    prevPriceLDN = priceLDN;

    const priceNY_USD_Ton  = priceNY * CENTS_LB_TO_USD_TON;
    const avgPrice_USD_Ton = totalOI > 0
      ? ((priceNY_USD_Ton * oiNY) + (priceLDN * oiLDN)) / totalOI
      : 0;

    // Delta OI
    const prev       = base[i - 1] ?? null;
    const deltaOINY  = prev ? oiNY  - prev.oiNY  : 0;
    const deltaOILDN = prev ? oiLDN - prev.oiLDN : 0;

    // Weekly nominal flow ($M)
    const flowNY  = (deltaOINY  * priceNY  * 375) / 1_000_000;
    const flowLDN = (deltaOILDN * priceLDN * 10)  / 1_000_000;
    const weeklyNominalFlow = flowNY + flowLDN;

    // Weekly margin flow ($M)
    const prevSpread   = prev ? prev.spreadingTotal : 0;
    const prevOutright = prev ? prev.outrightTotal  : 0;
    const deltaSpread   = spreadingTotal - prevSpread;
    const deltaOutright = outrightTotal  - prevOutright;
    const weeklyMarginFlow =
      ((deltaOutright * MARGIN_OUTRIGHT) + (deltaSpread * MARGIN_SPREAD)) / 1_000_000;

    cumulativeNominal += weeklyNominalFlow;
    cumulativeMargin  += weeklyMarginFlow;

    // ny/ldn sub-objects: camelCase OI fields used by Tabs 2-6
    // nonRepLong (capital R) matches d.ny[`${cat}Long`] where cat="nonRep" in Tab 2
    const nyObj: CotMarketPositions = {
      pmpuLong:    ny.pmpu_long   ?? 0,  pmpuShort:   ny.pmpu_short  ?? 0,  pmpuSpread:   0,
      swapLong:    ny.swap_long   ?? 0,  swapShort:   ny.swap_short  ?? 0,  swapSpread:   ny.swap_spread  ?? 0,
      mmLong:      ny.mm_long     ?? 0,  mmShort:     ny.mm_short    ?? 0,  mmSpread:     ny.mm_spread    ?? 0,
      otherLong:   ny.other_long  ?? 0,  otherShort:  ny.other_short ?? 0,  otherSpread:  ny.other_spread ?? 0,
      nonRepLong:  ny.nr_long     ?? 0,  nonRepShort: ny.nr_short    ?? 0,  nonRepSpread: 0,
    };
    const ldnObj: CotMarketPositions = {
      pmpuLong:    ldn.pmpu_long  ?? 0,  pmpuShort:   ldn.pmpu_short  ?? 0,  pmpuSpread:   0,
      swapLong:    ldn.swap_long  ?? 0,  swapShort:   ldn.swap_short  ?? 0,  swapSpread:   ldn.swap_spread  ?? 0,
      mmLong:      ldn.mm_long    ?? 0,  mmShort:     ldn.mm_short    ?? 0,  mmSpread:     ldn.mm_spread    ?? 0,
      otherLong:   ldn.other_long ?? 0,  otherShort:  ldn.other_short ?? 0,  otherSpread:  ldn.other_spread ?? 0,
      nonRepLong:  ldn.nr_long    ?? 0,  nonRepShort: ldn.nr_short    ?? 0,  nonRepSpread: 0,
    };

    // Options book per cohort (combined - futures), emitted by the exporter as
    // `*_opt`. Absent for weeks with no combined report and for legacy rows —
    // undefined then, so the gauges can hide the options bar rather than draw
    // a fake zero. Values are delta-adjusted and CAN be negative.
    const optObj = (m: Record<string, number | null> | undefined): Partial<CotMarketPositions> | undefined => {
      if (!m || m.pmpu_long_opt == null) return undefined;
      // `?? undefined` (not `?? 0`): a leg the report doesn't carry must stay
      // ABSENT so the gauge hides its options bar. Zero would read as "this
      // cohort has no options book", which is a different claim.
      const v = (k: string) => m[k] ?? undefined;
      return {
        pmpuLong:    v("pmpu_long_opt"),   pmpuShort:   v("pmpu_short_opt"),
        swapLong:    v("swap_long_opt"),   swapShort:   v("swap_short_opt"),   swapSpread:   v("swap_spread_opt"),
        mmLong:      v("mm_long_opt"),     mmShort:     v("mm_short_opt"),     mmSpread:     v("mm_spread_opt"),
        otherLong:   v("other_long_opt"),  otherShort:  v("other_short_opt"),  otherSpread:  v("other_spread_opt"),
        nonRepLong:  v("nr_long_opt"),     nonRepShort: v("nr_short_opt"),
      };
    };
    const nyOptObj  = optObj(ny  as unknown as Record<string, number | null>);
    const ldnOptObj = optObj(ldn as unknown as Record<string, number | null>);

    // tradersNY/LDN: lowercase keys used by Tab 5 dpCats loop as m.tr["nonrep"]
    const tradersNY: CotTradersGroup = {
      pmpu:   ny.t_pmpu_long  ?? 0,
      mm:     ny.t_mm_long    ?? 0,
      swap:   ny.t_swap_long  ?? 0,
      other:  ny.t_other_long ?? 0,
      nonrep: ny.t_nr_long    ?? 0,
    };
    // Short-side counts are nullable: ICE/LDN omits them, and `signalEngine`
    // relies on nulls flowing through so `dirCount` returns "unknown" and
    // count-comparison rules skip cleanly. Coalescing to 0 here would silently
    // make `mmNetTDir.LDN` track long-count direction and corrupt TC1/TC2.
    // Omit the subobject entirely when every short field is null so consumers
    // (and `signalEngine.ts:204-219`) see `undefined`.
    const nyShort: CotTradersGroupShort = {
      pmpu:   ny.t_pmpu_short  ?? null,
      mm:     ny.t_mm_short    ?? null,
      swap:   ny.t_swap_short  ?? null,
      other:  ny.t_other_short ?? null,
      nonrep: ny.t_nr_short    ?? null,
    };
    const tradersNY_short = Object.values(nyShort).every(v => v === null) ? undefined : nyShort;

    const tradersLDN: CotTradersGroup = {
      pmpu:   ldn.t_pmpu_long  ?? 0,
      mm:     ldn.t_mm_long    ?? 0,
      swap:   ldn.t_swap_long  ?? 0,
      other:  ldn.t_other_long ?? 0,
      nonrep: 0,  // ICE has no NR trader count
    };
    const ldnShort: CotTradersGroupShort = {
      pmpu:   ldn.t_pmpu_short  ?? null,
      mm:     ldn.t_mm_short    ?? null,
      swap:   ldn.t_swap_short  ?? null,
      other:  ldn.t_other_short ?? null,
      nonrep: null,  // ICE has no NR trader count
    };
    const tradersLDN_short = Object.values(ldnShort).every(v => v === null) ? undefined : ldnShort;

    const pmpuShortMT_NY  = nyObj.pmpuShort * ARABICA_MT_FACTOR;
    const pmpuShortMT_LDN = ldnObj.pmpuShort * ROBUSTA_MT_FACTOR;
    const pmpuLongMT_NY   = nyObj.pmpuLong  * ARABICA_MT_FACTOR;
    const pmpuLongMT_LDN  = ldnObj.pmpuLong * ROBUSTA_MT_FACTOR;
    const efpMT = (ny.efp_ny ?? 0) * ARABICA_MT_FACTOR;

    base.push({
      id: i,
      date: row.date,
      priceNY, priceLDN, avgPrice_USD_Ton,
      // Contract symbols whose lastPrice was sampled into priceNY / priceLDN
      // on this COT Tuesday. May 2026+ rows have this set; legacy rows are
      // null. Step4IndustryPulse uses week-to-week changes to mark switches.
      priceContractNY:  (ny.price_contract_ny  ?? null) as string | null,
      priceContractLDN: (ldn.price_contract_ldn ?? null) as string | null,
      oiNY, oiLDN, totalOI,
      spreadingTotal, outrightTotal,
      weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
      ny: nyObj, ldn: ldnObj,
      nyOpt: nyOptObj, ldnOpt: ldnOptObj,
      // Preserve forward-filled raw sub-objects for buildMarketMetrics
      // (structure, exch_oi, t_mm_short). String-typed contract fields are
      // hoisted to priceContract{NY,LDN} above, so this cast to the numeric
      // shape is safe.
      rawNy: ny as unknown as Record<string, number | null>,
      rawLdn: ldn as unknown as Record<string, number | null>,
      tradersNY, tradersNY_short, tradersLDN, tradersLDN_short,
      pmpuShortMT_NY, pmpuShortMT_LDN,
      pmpuShortMT: pmpuShortMT_NY + pmpuShortMT_LDN,
      pmpuLongMT_NY, pmpuLongMT_LDN,
      pmpuLongMT: pmpuLongMT_NY + pmpuLongMT_LDN,
      efpMT,
      timeframe: "historical" as const,
      priceRank: 0, oiRank: 0, priceRankLDN: 0, oiRankLDN: 0,
    });
  }

  // Pass 2: timeframe buckets + 5-year (260-week) rolling ranks
  // Single loop per row (no intermediate array allocations).
  const n = base.length;
  return base.map((d, i) => {
    const timeframe =
      i === n - 1                ? "current"    :
      i === n - 2                ? "recent_1"   :
      (i >= n - 6 && i <= n - 3) ? "recent_4"  :
      (i >= n - 58 && i <= n - 7) ? "year"      :
                                    "historical";

    let maxP = -Infinity, minP = Infinity;
    let maxNet = -Infinity, minNet = Infinity;
    let maxLP = -Infinity, minLP = Infinity;
    let maxNetLDN = -Infinity, minNetLDN = Infinity;
    for (let j = Math.max(0, i - 260); j <= i; j++) {
      const s = base[j];
      const p = s.priceNY, lp = s.priceLDN;
      const net = s.ny.mmLong - s.ny.mmShort;
      const netLDN = s.ldn.mmLong - s.ldn.mmShort;
      if (p   > maxP)      maxP      = p;   if (p   < minP)      minP      = p;
      if (net > maxNet)    maxNet    = net;  if (net < minNet)    minNet    = net;
      if (lp  > maxLP)     maxLP     = lp;  if (lp  < minLP)     minLP     = lp;
      if (netLDN > maxNetLDN) maxNetLDN = netLDN; if (netLDN < minNetLDN) minNetLDN = netLDN;
    }

    const net    = d.ny.mmLong  - d.ny.mmShort;
    const netLDN = d.ldn.mmLong - d.ldn.mmShort;

    return {
      ...d,
      timeframe,
      priceRank:    maxP      !== minP      ? ((d.priceNY  - minP)      / (maxP      - minP))      * 100 : 50,
      oiRank:       maxNet    !== minNet    ? ((net         - minNet)    / (maxNet    - minNet))    * 100 : 50,
      priceRankLDN: maxLP     !== minLP     ? ((d.priceLDN  - minLP)     / (maxLP     - minLP))     * 100 : 50,
      oiRankLDN:    maxNetLDN !== minNetLDN ? ((netLDN      - minNetLDN) / (maxNetLDN - minNetLDN)) * 100 : 50,
    };
  });
}
