/**
 * Price units — the conversion in ONE place, and the choice of display unit.
 *
 * The ¢/lb ↔ USD/MT factor lived in five files (originPrices, OriginPricesPanel,
 * MarketTicker, cot/transformApiData, FuturesMethodology) as 22.046, 22.0462
 * and 2204.62/100. Round one canonicalised the SPELLING of the units; this
 * canonicalises the number and the choice. Arabica people think in ¢/lb,
 * robusta people in USD/MT, and anyone comparing origins across both wants
 * one basis for the whole screen.
 */
export const LB_PER_MT = 2204.62;
/** ¢/lb → USD/MT: 1 MT = 2204.62 lb and 1¢ = $0.01, so ×22.0462. */
export const KC_CENTS_TO_USD_MT = LB_PER_MT / 100;

export type PriceUnit = "cents_lb" | "usd_mt";

export const UNIT_LABEL: Record<PriceUnit, string> = { cents_lb: "¢/lb", usd_mt: "USD/MT" };

export function centsLbToUsdMt(cents: number): number {
  return cents * KC_CENTS_TO_USD_MT;
}
export function usdMtToCentsLb(usd: number): number {
  return usd / KC_CENTS_TO_USD_MT;
}

/** Multiplier that takes a value quoted in `from` to a value in `to`. */
export function unitFactor(from: PriceUnit, to: PriceUnit): number {
  if (from === to) return 1;
  return from === "cents_lb" ? KC_CENTS_TO_USD_MT : 1 / KC_CENTS_TO_USD_MT;
}

/** Decimals a price is normally shown to in each unit. */
export function unitDecimals(unit: PriceUnit): number {
  return unit === "cents_lb" ? 2 : 0;
}

/** Convert and format: value quoted in `from`, rendered in `to`. */
export function fmtPriceIn(value: number | null | undefined, from: PriceUnit, to: PriceUnit): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return (value * unitFactor(from, to)).toFixed(unitDecimals(to));
}
