// Positioning expressed as WEEKS OF COVER.
//
// A COT position in lots tells you nothing on its own — 55,000 robusta lots is
// meaningless until you know what the world drinks in a week. Dividing by
// weekly consumption turns it into a number with a unit people already reason
// in: "the trade is short eleven weeks of demand." It also makes KC and RC
// directly comparable, which raw lots never are (a KC lot is 17.01 t, an RC
// lot is 10 t) and makes a 2020 position comparable to a 2026 one.
//
// This is the transform behind the "Market Positioning" panel research brokers
// publish. The concept is unambiguous; the DENOMINATOR is a house convention,
// and ours is stated here rather than tuned to match anyone else's chart:
// consumption comes from the app's own world balance sheet, so this panel
// cannot disagree with the Demand tab.
import { ARABICA_MT_FACTOR, ROBUSTA_MT_FACTOR } from "./transformApiData";
import type { ProcessedCotRow } from "./types";

const KG_PER_BAG = 60;
const WEEKS = 52;

export type Market = "ny" | "ldn";

/** Annual consumption in million 60-kg bags, per market. */
export interface CoverBasis { ny: number; ldn: number }

/** Fallback only. The live values are read from world_balance_sheet.json;
 *  these keep the panel rendering when that fetch fails, and are the same
 *  numbers the balance sheet held when this was written. */
export const DEFAULT_BASIS: CoverBasis = { ny: 86.0, ldn: 78.0 };

/** Lots consumed per week at a given annual rate.
 *  m bags/yr → tonnes/yr → lots/yr → lots/week. */
export function lotsPerWeek(mBagsPerYear: number, market: Market): number {
  const tonnesPerYear = mBagsPerYear * 1e6 * KG_PER_BAG / 1000;
  const perLot = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
  return tonnesPerYear / perLot / WEEKS;
}

export interface CoverPoint {
  date: string;
  /** Commercial LONG — roasters' forward cover, in weeks of consumption. */
  roaster: number;
  /** Commercial SHORT — origin and trade hedges. Negative by convention, so
   *  the two sides of the trade sit on opposite sides of zero. */
  producer: number;
  /** Managed money + other reportables, net. Positive = net long. */
  spec: number;
}

/** Sum the demand hubs from the world balance sheet into a per-market annual
 *  consumption. Arabica is split by processing in the source, so both legs are
 *  added; robusta is a single leg. Returns null when the shape is not what we
 *  expect, so the caller falls back rather than rendering a wrong axis. */
export function basisFromHubs(hubs: unknown): CoverBasis | null {
  if (!Array.isArray(hubs) || hubs.length === 0) return null;
  let ny = 0, ldn = 0;
  for (const h of hubs) {
    if (!h || typeof h !== "object") return null;
    const r = h as Record<string, unknown>;
    const w = r.arabica_washed, n = r.arabica_natural, rb = r.robusta;
    if (typeof w !== "number" || typeof n !== "number" || typeof rb !== "number") return null;
    ny += w + n;
    ldn += rb;
  }
  // A world that drinks under 20m bags of either type is a parse accident,
  // not a market. Refuse it rather than scaling the whole panel by it.
  if (ny < 20 || ldn < 20) return null;
  return { ny, ldn };
}

export function toWeeksOfCover(
  rows: ProcessedCotRow[], market: Market, basis: CoverBasis,
): CoverPoint[] {
  const perWeek = lotsPerWeek(market === "ny" ? basis.ny : basis.ldn, market);
  if (!(perWeek > 0)) return [];
  return rows.map(d => {
    const b = market === "ny" ? d.ny : d.ldn;
    return {
      date: d.date,
      roaster: b.pmpuLong / perWeek,
      producer: -b.pmpuShort / perWeek,
      spec: ((b.mmLong - b.mmShort) + (b.otherLong - b.otherShort)) / perWeek,
    };
  });
}

/** Net commercial cover — long minus short, in weeks. The single number the
 *  panel's caption leads on: how many weeks of demand the trade is net short. */
export function netCommercial(p: CoverPoint): number {
  return p.roaster + p.producer;      // producer is already negative
}
