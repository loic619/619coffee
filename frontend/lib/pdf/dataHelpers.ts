// frontend/lib/pdf/dataHelpers.ts
import type { MarketMetrics, GlobalFlowMetrics } from "./types";
import type { MacroCotWeek, MacroCotEntry } from "@/lib/api";
import type { ProcessedCotRow } from "@/lib/cot/types";

// ── Primitive helpers ────────────────────────────────────────────────────────

/** Annualised front roll. Positive = backwardation (roll income). Negative = contango. */
export function computeAnnualizedRoll(structureValue: number, price: number): number {
  if (price === 0 || structureValue === 0) return 0;
  // structure = M2 - M1. Contango (M2 > M1) means you pay on roll → negative income.
  return -(structureValue / price) * (365 / 30) * 100;
}

/** Coverage % normalised on 52-week range. Returns 50 if no range. */
export function computeCovPct(current: number, min52: number, max52: number): number {
  if (max52 === min52) return 50;
  return Math.min(100, Math.max(0, ((current - min52) / (max52 - min52)) * 100));
}

/** Funds % maxed: current / historical max × 100, capped at 100. */
export function computeFundsMaxedPct(current: number, history: number[]): number {
  const max = Math.max(...history);
  if (max === 0) return 0;
  return Math.min(100, (current / max) * 100);
}

/** OB/OS flag: both price AND OI rank must cross threshold. */
export function computeObosFlag(
  priceRank: number,
  oiRank: number
): "overbought" | "oversold" | "neutral" {
  if (priceRank > 75 && oiRank > 75) return "overbought";
  if (priceRank < 25 && oiRank < 25) return "oversold";
  return "neutral";
}

/**
 * Position mismatch: MM are net long in contracts but net short in # traders, or vice versa.
 * mmLong/mmShort = contract lots. tLong/tShort = number of traders.
 */
export function computePositionMismatch(
  mmLong: number, mmShort: number,
  tLong: number, tShort: number
): boolean {
  const lotsSign    = Math.sign(mmLong - mmShort);
  const tradersSign = Math.sign(tLong  - tShort);
  return lotsSign !== 0 && tradersSign !== 0 && lotsSign !== tradersSign;
}

/**
 * OI nearby/forward split.
 * exch_oi_ny = ICE/CBOT nearby OI (first ~2 contracts listed on exchange).
 * forward = total_oi - exch_oi.
 */
export function computeOiSplit(
  current: { oi_total: number; exch_oi_ny?: number | null },
  prev:    { oi_total: number; exch_oi_ny?: number | null }
): { total: number; nearby: number; forward: number } {
  const total   = current.oi_total - prev.oi_total;
  const nearbyC = current.exch_oi_ny ?? 0;
  const nearbyP = prev.exch_oi_ny    ?? 0;
  const nearby  = nearbyC - nearbyP;
  return { total, nearby, forward: total - nearby };
}

// ── High-level builders ──────────────────────────────────────────────────────

// Static contract_unit lookup — mirrors COMMODITY_SPECS in backend/scraper/sources/macro_cot.py.
// close_price from the API is already normalized to USD per base unit
// (e.g. ZC=F corn is stored as USD/bushel after the scraper divides cents by 100).
// No additional unit conversion needed here.
const COMMODITY_SPECS_FRONTEND: Record<string, { contract_unit: number }> = {
  wti:           { contract_unit: 1000    },
  brent:         { contract_unit: 1000    },
  natgas:        { contract_unit: 10000   },
  heating_oil:   { contract_unit: 42000   },
  rbob:          { contract_unit: 42000   },
  lsgo:          { contract_unit: 100     },
  gold:          { contract_unit: 100     },
  silver:        { contract_unit: 5000    },
  copper:        { contract_unit: 25000   },
  corn:          { contract_unit: 5000    },
  wheat:         { contract_unit: 5000    },
  soybeans:      { contract_unit: 5000    },
  soy_meal:      { contract_unit: 100     },
  soy_oil:       { contract_unit: 60000   },
  live_cattle:   { contract_unit: 40000   },
  feeder_cattle: { contract_unit: 50000   },
  lean_hogs:     { contract_unit: 40000   },
  sugar11:       { contract_unit: 112000  },
  white_sugar:   { contract_unit: 50      },
  cotton:        { contract_unit: 50000   },
  arabica:       { contract_unit: 37500   },
  robusta:       { contract_unit: 10      },
  cocoa_ny:      { contract_unit: 10      },
  cocoa_ldn:     { contract_unit: 10      },
  oj:            { contract_unit: 15000   },
  oats:          { contract_unit: 5000    },
  lumber:        { contract_unit: 110000  },
  wheat_hrw:     { contract_unit: 5000    },
  platinum:      { contract_unit: 50      },
};

// MacroCotEntry.sector values: "hard" | "grains" | "meats" | "softs" | "micros"
// "hard" is split into energy vs metals using ENERGY_SYMS at display time only.
const ENERGY_SYMS = new Set(["wti","brent","natgas","heating_oil","rbob","lsgo"]);
// Display sectors used for biggestMover label
const DISPLAY_SECTORS = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;

/** Percentile rank of value in history array (0 = min, 100 = max). */
function percRank(value: number, history: number[], positiveOnly = true): number {
  const valid = positiveOnly ? history.filter(h => h > 0) : history.filter(h => h !== 0);
  if (valid.length === 0) return 50;
  const below = valid.filter(h => h < value).length;
  return (below / valid.length) * 100;
}

export function buildGlobalFlowMetrics(
  macroData: MacroCotWeek[],
  windowWeeks = 1,
): GlobalFlowMetrics | null {
  if (macroData.length < 2) return null;
  const latest = macroData[macroData.length - 1];
  // Comparison week for every Δ field: N weeks back, clamped to the oldest
  // available week so a short history degrades gracefully instead of erroring.
  const prev = macroData[Math.max(0, macroData.length - 1 - Math.max(1, windowWeeks))];
  // Immediately-previous week — used ONLY for the priceOutlier data-quality
  // flag, which must stay a weekly check regardless of the display window
  // (corruption manifests as one week's batch being garbage).
  const weekPrev = macroData[macroData.length - 2];

  // Helper: sum gross exposure for a week
  const sumGross = (week: MacroCotWeek) =>
    week.commodities.reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);
  const totalGross = sumGross(latest);
  const prevGross  = sumGross(prev);

  // Sector breakdowns — map display sector name to actual MacroCotEntry.sector filter
  const sectorGross = (week: MacroCotWeek, displaySector: string) =>
    week.commodities
      .filter(c => {
        if (displaySector === "energy")  return c.sector === "hard" &&  ENERGY_SYMS.has(c.symbol);
        if (displaySector === "metals")  return c.sector === "hard" && !ENERGY_SYMS.has(c.symbol);
        return c.sector === displaySector; // grains | meats | softs | micros match directly
      })
      .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);

  const sectorDeltas = DISPLAY_SECTORS.map(s => ({
    sector: s,
    delta: sectorGross(latest, s) - sectorGross(prev, s),
  }));
  const biggest = sectorDeltas.reduce((a, b) => Math.abs(a.delta) > Math.abs(b.delta) ? a : b);

  const softsGross  = sectorGross(latest, "softs");
  const coffeeGross = latest.commodities
    .filter(c => c.symbol === "arabica" || c.symbol === "robusta")
    .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);
  const coffeePrev = prev.commodities
    .filter(c => c.symbol === "arabica" || c.symbol === "robusta")
    .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);

  const netExp = latest.commodities.reduce((s, c) => s + (c.net_exposure_usd ?? 0), 0);

  // Pre-compute total gross per historical week (for share percentile)
  const totalGrossHistory = macroData.map(w =>
    w.commodities.reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0)
  );

  // Sector filter helper (reuses existing sectorGross)
  const sectorFilter = (c: MacroCotEntry, displaySector: string) => {
    if (displaySector === "energy") return c.sector === "hard" &&  ENERGY_SYMS.has(c.symbol);
    if (displaySector === "metals") return c.sector === "hard" && !ENERGY_SYMS.has(c.symbol);
    return c.sector === displaySector;
  };

  // ── Per-commodity table ──
  const SECTOR_ORDER = ["energy", "metals", "grains", "meats", "softs", "micros"];
  const commodityTable: import("./types").CommodityRow[] = latest.commodities
    .filter(e => (e.gross_exposure_usd ?? 0) > 0 || (e.mm_long + e.mm_short) > 0)
    .map(entry => {
      const sym       = entry.symbol;
      const dSector   = ENERGY_SYMS.has(sym) ? "energy" : (entry.sector === "hard" ? "metals" : entry.sector);
      const prevEntry = prev.commodities.find(c => c.symbol === sym);
      const curG      = entry.gross_exposure_usd  ?? 0;
      const prevG2    = prevEntry?.gross_exposure_usd ?? 0;
      const curN      = entry.net_exposure_usd     ?? 0;
      const prevN     = prevEntry?.net_exposure_usd    ?? 0;
      const curShare  = totalGross > 0 ? (curG / totalGross) * 100  : 0;
      const prevShare2 = prevGross > 0 ? (prevG2 / prevGross) * 100 : 0;
      const grossHist  = macroData.map(w => w.commodities.find(c => c.symbol === sym)?.gross_exposure_usd ?? 0);
      const shareHist  = grossHist.map((g, i) => totalGrossHistory[i] > 0 ? (g / totalGrossHistory[i]) * 100 : 0);
      const netHist = macroData.map(w => w.commodities.find(c => c.symbol === sym)?.net_exposure_usd ?? 0);
      const netDelta = curN - prevN;

      // Attribution computation
      const cu = COMMODITY_SPECS_FRONTEND[sym]?.contract_unit ?? null;
      const prevMmLong  = prevEntry?.mm_long  ?? null;
      const prevMmShort = prevEntry?.mm_short ?? null;
      const prevPrice   = prevEntry?.close_price ?? null;
      const curPrice    = entry.close_price ?? null;

      // gross_oi = mm_long + mm_short (MM lots only, NOT oi_total which covers all participants)
      // net_oi   = mm_long - mm_short
      let grossOiEffectB:    number | null = null;
      let grossPriceEffectB: number | null = null;
      let netOiEffectB:      number | null = null;
      let netPriceEffectB:   number | null = null;

      if (
        cu !== null &&
        prevPrice !== null && curPrice !== null &&
        prevMmLong !== null && prevMmShort !== null
        // entry.mm_long / mm_short are typed as number (never null) per MacroCotEntry
      ) {
        const curMmLong  = entry.mm_long;
        const curMmShort = entry.mm_short;
        const dGrossOi   = (curMmLong + curMmShort) - (prevMmLong + prevMmShort);
        const dNetOi     = (curMmLong - curMmShort)  - (prevMmLong - prevMmShort);
        const dPrice     = curPrice - prevPrice;

        // Price effect uses current-period quantity (deliberate — assigns interaction term to price)
        grossOiEffectB    = (dGrossOi                  * prevPrice * cu) / 1e9;
        grossPriceEffectB = ((curMmLong + curMmShort)  * dPrice    * cu) / 1e9;
        netOiEffectB      = (dNetOi                    * prevPrice * cu) / 1e9;
        netPriceEffectB   = ((curMmLong - curMmShort)  * dPrice    * cu) / 1e9;
      }

      // Raw price/OI verification columns + weekly outlier flag. The outlier
      // check compares against the immediately previous week (not the window)
      // — a >±50% one-week jump is the signature of a corrupt feed batch.
      const weekPrevPrice = weekPrev.commodities.find(c => c.symbol === sym)?.close_price ?? null;
      const priceOutlier =
        curPrice !== null && weekPrevPrice !== null && weekPrevPrice > 0 &&
        Math.abs((curPrice - weekPrevPrice) / weekPrevPrice) * 100 > 50;
      const prevOi = prevEntry?.oi_total ?? 0;

      return {
        symbol: sym,
        name:   entry.name,
        displaySector: dSector,
        isCoffee: sym === "arabica" || sym === "robusta",
        closePrice: curPrice,
        priceDeltaPct:
          curPrice !== null && prevPrice !== null && prevPrice > 0
            ? ((curPrice - prevPrice) / prevPrice) * 100
            : null,
        oiTotal: entry.oi_total ?? 0,
        oiDeltaPct: prevOi > 0 ? (((entry.oi_total ?? 0) - prevOi) / prevOi) * 100 : null,
        priceOutlier,
        grossB:          curG / 1e9,
        netB:            curN / 1e9,
        deltaB:          (curG - prevG2) / 1e9,
        deltaPct:        prevG2 > 0 ? ((curG - prevG2) / prevG2) * 100 : 0,
        shareOfTotalPct: curShare,
        shareDeltaPp:    curShare - prevShare2,
        histRankGrossPct: percRank(curG, grossHist),
        histRankSharePct: percRank(curShare, shareHist),
        histRankNetPct: percRank(curN, netHist, false),
        netDeltaB:       netDelta / 1e9,
        netDeltaPct:     prevN !== 0 ? (netDelta / Math.abs(prevN)) * 100 : 0,
        grossOiEffectB,
        grossPriceEffectB,
        netOiEffectB,
        netPriceEffectB,
      };
    })
    .sort((a, b) => {
      const ai = SECTOR_ORDER.indexOf(a.displaySector);
      const bi = SECTOR_ORDER.indexOf(b.displaySector);
      if (ai !== bi) return ai - bi;
      return b.grossB - a.grossB;
    });

  // ── Sector breakdown (now with net, shareDelta, histRank) ──
  const sectorBreakdown = DISPLAY_SECTORS.map(s => {
    const gross  = sectorGross(latest, s);
    const prevG  = sectorGross(prev, s);
    const delta  = gross - prevG;
    const net    = latest.commodities
      .filter(c => sectorFilter(c, s))
      .reduce((sum, c) => sum + (c.net_exposure_usd ?? 0), 0);
    const curShare  = totalGross > 0 ? (gross / totalGross) * 100 : 0;
    const prevShare = prevGross > 0  ? (prevG / prevGross) * 100  : 0;
    const grossHistory = macroData.map(w =>
      w.commodities.filter(c => sectorFilter(c, s)).reduce((sum, c) => sum + (c.gross_exposure_usd ?? 0), 0)
    );
    const shareHistory = grossHistory.map((g, i) =>
      totalGrossHistory[i] > 0 ? (g / totalGrossHistory[i]) * 100 : 0
    );
    const netHistory = macroData.map(w =>
      w.commodities.filter(c => sectorFilter(c, s)).reduce((sum, c) => sum + (c.net_exposure_usd ?? 0), 0)
    );
    const prevNet = prev.commodities
      .filter(c => sectorFilter(c, s))
      .reduce((sum, c) => sum + (c.net_exposure_usd ?? 0), 0);
    const netDelta = net - prevNet;

    // Attribution subtotals: null if ALL commodities in sector have null; otherwise sum of non-null
    const attrVals = (field: "grossOiEffectB" | "grossPriceEffectB" | "netOiEffectB" | "netPriceEffectB") => {
      const vals = commodityTable
        .filter(c => c.displaySector === s)
        .map(c => c[field]);
      const nonNull = vals.filter((v): v is number => v !== null);
      return nonNull.length === 0 ? null : nonNull.reduce((a, b) => a + b, 0);
    };

    return {
      sector: s,
      grossB:          gross / 1e9,
      netB:            net   / 1e9,
      deltaB:          delta / 1e9,
      deltaPct:        prevG > 0 ? (delta / prevG) * 100 : 0,
      shareOfTotalPct: curShare,
      shareDeltaPp:    curShare - prevShare,
      histRankGrossPct: percRank(gross, grossHistory),
      histRankSharePct: percRank(curShare, shareHistory),
      histRankNetPct: percRank(net, netHistory, false),
      netDeltaB:       netDelta / 1e9,
      netDeltaPct:     prevNet !== 0 ? (netDelta / Math.abs(prevNet)) * 100 : 0,
      grossOiEffectB:    attrVals("grossOiEffectB"),
      grossPriceEffectB: attrVals("grossPriceEffectB"),
      netOiEffectB:      attrVals("netOiEffectB"),
      netPriceEffectB:   attrVals("netPriceEffectB"),
    };
  });

  // ── Net exposure WoW ──
  const prevNetExp = prev.commodities.reduce((s, c) => s + (c.net_exposure_usd ?? 0), 0);

  return {
    date:               latest.date,
    totalGrossB:        totalGross  / 1e9,
    netExpB:            netExp      / 1e9,
    wowDeltaB:          (totalGross - prevGross) / 1e9,
    softSharePct:       totalGross > 0 ? (softsGross / totalGross) * 100 : 0,
    biggestMoverSector: biggest.sector,
    biggestMoverDeltaB: biggest.delta / 1e9,
    coffeeSharePct:     totalGross > 0 ? (coffeeGross / totalGross) * 100 : 0,
    coffeeDeltaB:       (coffeeGross - coffeePrev) / 1e9,
    coffeeGrossB:       coffeeGross / 1e9,
    sectorBreakdown,
    wowDeltaNetB:       (netExp - prevNetExp) / 1e9,
    softsGrossB:        softsGross / 1e9,
    commodityTable,
    windowWeeks:        Math.max(1, windowWeeks),
    prevDate:           prev.date,
  };
}

/**
 * Build MarketMetrics for one market (ny or ldn) from the processed recent52 array
 * and the raw data[] array.
 *
 * @param recent52  — processed rows from CotDashboard (has priceRank, oiRank, tradersNY/LDN, etc.)
 * @param rawData   — raw rows from /api/cot (has structure_ny, exch_oi_ny, efp_ny, etc.)
 * @param market    — "ny" | "ldn"
 */
export function buildMarketMetrics(
  recent52: ProcessedCotRow[],
  rawData:  ProcessedCotRow[],
  market:   "ny" | "ldn"
): MarketMetrics | null {
  if (recent52.length < 2 || rawData.length < 2) return null;

  const cur  = recent52[recent52.length - 1];
  const prev = recent52[recent52.length - 2];
  const rawCur  = rawData[rawData.length - 1];
  const rawPrev = rawData[rawData.length - 2];

  const isNY = market === "ny";
  const mk   = isNY ? "ny" : "ldn";        // key in raw data and in cur/prev

  const price      = isNY ? cur.priceNY  : cur.priceLDN;
  const prevPrice  = isNY ? prev.priceNY : prev.priceLDN;
  const priceUnit  = isNY ? "¢/lb" : "$/MT" as "¢/lb" | "$/MT";

  const curNY  = cur[mk];   // the ny/ldn sub-object from processed data
  const prevNY = prev[mk];

  // Access forward-filled raw sub-objects (added by transformApiData for this purpose)
  const rawMk  = isNY ? rawCur?.rawNy  : rawCur?.rawLdn;
  const rawPMk = isNY ? rawPrev?.rawNy : rawPrev?.rawLdn;

  // OI total change: compute directly from processed oiNY/oiLDN (reliable from scraper)
  const oiChangeLots = isNY ? (cur.oiNY - prev.oiNY) : (cur.oiLDN - prev.oiLDN);

  // Nearby/forward split: only available when exch_oi_ny/ldn is populated in DB (manual import only)
  const exchKey  = isNY ? "exch_oi_ny" : "exch_oi_ldn";
  const exchCur  = rawMk?.[exchKey]  ?? null;
  const exchPrev = rawPMk?.[exchKey] ?? null;
  const oiChangeNearby  = (exchCur !== null && exchPrev !== null) ? (exchCur  - exchPrev) : null;
  const oiChangeForward = oiChangeNearby !== null ? (oiChangeLots - oiChangeNearby) : null;

  // Structure / roll: only available when structure_ny/ldn is populated in DB (manual import only)
  const structKey      = isNY ? "structure_ny" : "structure_ldn";
  const structureValue: number | null     = rawMk?.[structKey]  ?? null;
  const structurePrevValue: number | null = rawPMk?.[structKey] ?? null;
  const structureType  = structureValue === null ? null : structureValue <= 0 ? "backwardation" : "carry" as const;
  const annualizedRollPct = structureValue !== null ? computeAnnualizedRoll(structureValue, price) : null;

  // PMPU MT (industry coverage) — normalize over 10-year history
  const hist10y      = rawData.slice(-520);
  const pmpuLongMTs  = hist10y.map(d => (isNY ? d.pmpuLongMT_NY  : d.pmpuLongMT_LDN)  ?? 0);
  const pmpuShortMTs = hist10y.map(d => (isNY ? d.pmpuShortMT_NY : d.pmpuShortMT_LDN) ?? 0);
  // Roasters/commercial buyers hedge LONG; producers/farmers hedge SHORT —
  // matches Step4IndustryPulse's convention (long=roasters, short=producers).
  const roastMT     = isNY ? cur.pmpuLongMT_NY   : cur.pmpuLongMT_LDN;
  const prodMT      = isNY ? cur.pmpuShortMT_NY  : cur.pmpuShortMT_LDN;
  const roastMTPrev = isNY ? prev.pmpuLongMT_NY  : prev.pmpuLongMT_LDN;
  const prodMTPrev  = isNY ? prev.pmpuShortMT_NY : prev.pmpuShortMT_LDN;

  // Funds maxed — use 10-year history
  const mmLongs  = hist10y.map(d => d[mk].mmLong  ?? 0);
  const mmShorts = hist10y.map(d => d[mk].mmShort ?? 0);

  // Counterparty deltas (lots WoW)
  const cpDelta = (field: string, side: "long" | "short") => {
    const k = field + (side === "long" ? "Long" : "Short");
    const curPos  = cur[mk]  as unknown as Record<string, number>;
    const prevPos = prev[mk] as unknown as Record<string, number>;
    return (curPos[k] ?? 0) - (prevPos[k] ?? 0);
  };

  // Trader counts
  // tradersNY/LDN currently stores t_mm_long under key "mm" (long-side count only).
  // t_mm_short is available in the raw COT row as rawMk.t_mm_short.
  const traders  = isNY ? cur.tradersNY  : cur.tradersLDN;
  const tMmLong  = traders?.mm ?? 0;
  // Both NY and LDN raw rows store the MM short trader count under "t_mm_short".
  const tMmShort = rawMk?.t_mm_short ?? 0;

  return {
    market:   isNY ? "NY Arabica" : "LDN Robusta",
    date:     cur.date,

    oiChangeLots,
    oiChangeNearby,
    oiChangeForward,

    price,
    priceUnit,
    priceChangePct:  prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0,
    priceChangeAbs:  price - prevPrice,

    structureValue,
    structurePrevValue,
    structureType,
    annualizedRollPct,

    // Coverage %: PMPU position normalised on 52-week min/max range (0% = 52w low, 100% = 52w high)
    producerCovPct:  computeCovPct(prodMT,  Math.min(...pmpuShortMTs), Math.max(...pmpuShortMTs)),
    producerMT:      prodMT,
    producerMTWoW:   prodMT - prodMTPrev,
    roasterCovPct:   computeCovPct(roastMT, Math.min(...pmpuLongMTs),  Math.max(...pmpuLongMTs)),
    roasterMT:       roastMT,
    roasterMTWoW:    roastMT - roastMTPrev,

    mmLong:             curNY.mmLong,
    mmShort:            curNY.mmShort,
    mmLongChangeLots:   cpDelta("mm", "long"),
    mmShortChangeLots:  cpDelta("mm", "short"),
    mmLongChangePct:    prevNY.mmLong > 0 ? (cpDelta("mm","long")  / prevNY.mmLong)  * 100 : 0,
    mmShortChangePct:   prevNY.mmShort> 0 ? (cpDelta("mm","short") / prevNY.mmShort) * 100 : 0,
    fundsMaxedLongPct:  computeFundsMaxedPct(curNY.mmLong,  mmLongs),
    fundsMaxedShortPct: computeFundsMaxedPct(curNY.mmShort, mmShorts),

    obosFlag: computeObosFlag(
      isNY ? cur.priceRank : cur.priceRankLDN,
      isNY ? cur.oiRank    : cur.oiRankLDN
    ),
    priceRank:          isNY ? cur.priceRank    : cur.priceRankLDN,
    oiRank:             isNY ? cur.oiRank       : cur.oiRankLDN,
    // tMmLong = long-side trader count; tMmShort = short-side from raw row
    positionMismatch:   computePositionMismatch(curNY.mmLong, curNY.mmShort, tMmLong, tMmShort),
    // MM concentration: exclude spread OI (non-directional) from denominator
    mmConcentrationPct: (() => {
      const oiTotal    = isNY ? cur.oiNY : cur.oiLDN;
      const spreadOI   = (curNY.swapSpread ?? 0) + (curNY.mmSpread ?? 0) + (curNY.otherSpread ?? 0);
      const dirOI      = Math.max(0, oiTotal - spreadOI);
      return dirOI > 0 ? ((curNY.mmLong + curNY.mmShort) / dirOI) * 100 : 0;
    })(),

    cp: {
      longs:  { pmpu: cpDelta("pmpu","long"),  sd: cpDelta("swap","long"),  mm: cpDelta("mm","long"),  or: cpDelta("other","long"),  nr: cpDelta("nonRep","long")  },
      shorts: { pmpu: cpDelta("pmpu","short"), sd: cpDelta("swap","short"), mm: cpDelta("mm","short"), or: cpDelta("other","short"), nr: cpDelta("nonRep","short") },
    },

    cats: {
      pmpu:  { long: curNY.pmpuLong,   short: curNY.pmpuShort,   dLong: cpDelta("pmpu","long"),   dShort: cpDelta("pmpu","short") },
      swap:  { long: curNY.swapLong,   short: curNY.swapShort,   spread: curNY.swapSpread,   dLong: cpDelta("swap","long"),   dShort: cpDelta("swap","short"),   dSpread: (curNY.swapSpread  ?? 0) - (prevNY.swapSpread  ?? 0) },
      mm:    { long: curNY.mmLong,     short: curNY.mmShort,     spread: curNY.mmSpread,     dLong: cpDelta("mm","long"),     dShort: cpDelta("mm","short"),     dSpread: (curNY.mmSpread    ?? 0) - (prevNY.mmSpread    ?? 0) },
      other: { long: curNY.otherLong,  short: curNY.otherShort,  spread: curNY.otherSpread,  dLong: cpDelta("other","long"),  dShort: cpDelta("other","short"),  dSpread: (curNY.otherSpread ?? 0) - (prevNY.otherSpread ?? 0) },
      nr:    { long: curNY.nonRepLong, short: curNY.nonRepShort, dLong: cpDelta("nonRep","long"), dShort: cpDelta("nonRep","short") },
      oi:    isNY ? cur.oiNY : cur.oiLDN,
    },
  };
}
