export interface CotTradersGroup {
  pmpu: number;
  mm: number;
  swap: number;
  other: number;
  nonrep: number;
}

/** Trader-count group for short-side breakouts. Fields are nullable because
 *  ICE/LDN doesn't publish them (Robusta `t_*_short` arrive as null from the
 *  API). `transformApiData` propagates the nulls so `signalEngine.dirCount`
 *  reports "unknown" and count-comparison rules skip cleanly. */
export interface CotTradersGroupShort {
  pmpu: number | null;
  mm: number | null;
  swap: number | null;
  other: number | null;
  nonrep: number | null;
}

export interface CotMarketPositions {
  pmpuLong: number;   pmpuShort: number;   pmpuSpread: number;
  swapLong: number;   swapShort: number;   swapSpread: number;
  mmLong: number;     mmShort: number;     mmSpread: number;
  otherLong: number;  otherShort: number;  otherSpread: number;
  nonRepLong: number; nonRepShort: number; nonRepSpread: number;
}

export interface ProcessedCotRow {
  id: number;
  date: string;
  priceNY: number;
  priceLDN: number;
  /** Futures contract that priceNY/priceLDN were sampled from on the COT
   *  Tuesday (max-OI contract; PR following the contract-switch markers).
   *  Optional — null on legacy rows. */
  priceContractNY?: string | null;
  priceContractLDN?: string | null;
  avgPrice_USD_Ton: number;
  oiNY: number;
  oiLDN: number;
  totalOI: number;
  spreadingTotal: number;
  outrightTotal: number;
  weeklyNominalFlow: number;
  weeklyMarginFlow: number;
  cumulativeNominal: number;
  cumulativeMargin: number;
  ny: CotMarketPositions;
  ldn: CotMarketPositions;
  /** Options book per cohort (futures+options COMBINED report minus futures).
   *  Undefined when no combined report covers the week — the gauges then hide
   *  the options bar instead of drawing a misleading zero. Delta-adjusted, so
   *  legs can be NEGATIVE (a delta-short call book). */
  nyOpt?: Partial<CotMarketPositions>;
  ldnOpt?: Partial<CotMarketPositions>;
  /** Forward-filled raw API sub-objects — only present in real data, not in mock.
   *  Numeric subset only; the string-typed `price_contract_*` fields live on
   *  this row's top-level `priceContractNY`/`priceContractLDN` instead. */
  rawNy?: Record<string, number | null>;
  rawLdn?: Record<string, number | null>;
  tradersNY: CotTradersGroup;
  /** Only present on real data, not on synthetic mock rows. Fields may be
   *  null when the exchange omits the breakout (LDN short side on Robusta);
   *  the subobject itself is omitted when every short field is null. */
  tradersNY_short?: CotTradersGroupShort;
  tradersLDN: CotTradersGroup;
  /** Only present on real data, not on synthetic mock rows. See note on
   *  `tradersNY_short` for the null-tolerance contract. */
  tradersLDN_short?: CotTradersGroupShort;
  pmpuShortMT_NY: number;
  pmpuShortMT_LDN: number;
  pmpuShortMT: number;
  pmpuLongMT_NY: number;
  pmpuLongMT_LDN: number;
  pmpuLongMT: number;
  efpMT: number;
  timeframe: "current" | "recent_1" | "recent_4" | "year" | "historical";
  priceRank: number;
  oiRank: number;
  priceRankLDN: number;
  oiRankLDN: number;
}

/** Shape of one weekly row as returned by the COT API / static JSON. */
export interface CotRawMarket {
  oi_total?: number | null;
  pmpu_long?: number | null; pmpu_short?: number | null;
  swap_long?: number | null; swap_short?: number | null; swap_spread?: number | null;
  mm_long?: number | null;   mm_short?: number | null;   mm_spread?: number | null;
  other_long?: number | null; other_short?: number | null; other_spread?: number | null;
  nr_long?: number | null;   nr_short?: number | null;
  t_pmpu_long?: number | null; t_pmpu_short?: number | null;
  t_swap_long?: number | null; t_swap_short?: number | null; t_swap_spread?: number | null;
  t_mm_long?: number | null;   t_mm_short?: number | null;   t_mm_spread?: number | null;
  t_other_long?: number | null; t_other_short?: number | null; t_other_spread?: number | null;
  t_nr_long?: number | null;    t_nr_short?: number | null;
  price_ny?: number | null; price_ldn?: number | null;
  /** Futures contract whose lastPrice was recorded into price_* on the COT
   *  Tuesday for this row. Populated from May 2026 onwards (max-OI rule);
   *  NULL on legacy rows. Industry Pulse marks switches between weeks. */
  price_contract_ny?: string | null; price_contract_ldn?: string | null;
  structure_ny?: number | null; structure_ldn?: number | null;
  exch_oi_ny?: number | null;   exch_oi_ldn?: number | null;
  vol_ny?: number | null; vol_ldn?: number | null;
  efp_ny?: number | null; efp_ldn?: number | null;
  spread_vol_ny?: number | null; spread_vol_ldn?: number | null;
  [key: string]: number | string | null | undefined;
}

export interface CotRawRow {
  date: string;
  ny?: CotRawMarket | null;
  ldn?: CotRawMarket | null;
}
