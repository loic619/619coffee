import { KC_CENTS_TO_USD_MT } from "@/lib/units";
/**
 * originPrices.ts
 *
 * Computes per-origin price labels for the map's permanent tooltips.
 * Each origin shows three lines: local-currency price, USD equivalent,
 * and the differential vs the matching futures front month (KC for
 * arabica, RC for robusta).
 *
 * Data sources (already on disk under /public/data):
 *   - latest_prices.json  — physical tickers + FX rates
 *   - acaphe_live.json    — KC / RC front-month
 */

export interface OriginPrice {
  countryName: string;     // canonical name for the label header
  /** Anchor for the floating label on the map. Hardcoded to a meaningful
   *  point inside the producing region so the label appears regardless of
   *  whether a CountryIntel pin happens to be seeded for that country. */
  lat: number;
  lng: number;
  local: string;           // "88,300 VND/kg"
  usd: string;             // "$3,371/MT"
  diff: string;            // "+50 vs RC"   or  "−120 vs KC"
  diffColor: string;       // CSS color for the diff line
}

interface Ticker { label: string; value: string; category: string }
interface LatestPrices { tickers: Ticker[] }
interface AcapheLive {
  robusta: Array<{ last: number | null; oi?: number | null; vol?: number | null }>;
  arabica: Array<{ last: number | null; oi?: number | null; vol?: number | null }>;
}

/** Parse "88.300 VND ($3,371)" → { local: "88.300 VND", usd: 3371 }
 *  Brazilian/Vietnamese style numbers (dot as thousands separator) are
 *  preserved as written.
 */
function parsePhysical(value: string): { localStr: string; usd: number | null } {
  // Split off the parenthesised USD if present
  const usdMatch = value.match(/\$([0-9,.]+)/);
  const usd = usdMatch ? Number(usdMatch[1].replace(/,/g, "")) : null;
  // Everything before the "$" parenthesis is the local-currency part
  const local = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return { localStr: local, usd };
}

/** Parse VND/kg from "88.300 VND" (dot = thousands separator) → number */
function parseVndKg(localStr: string): number | null {
  const m = localStr.match(/([\d.]+)\s*VND/);
  if (!m) return null;
  // Vietnamese format: dots are thousands separators ("88.300" = 88300)
  const cleaned = m[1].replace(/\./g, "");
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/** Arabica futures: ¢/lb → USD/MT. 1 MT = 2204.62 lb, 1¢ = $0.01.
 *  Exported for when arabica-origin pins (Colombia, Honduras, Ethiopia)
 *  are wired up — diff them against KC, not RC.
 */
export function kcCentsToUsdMt(cents: number): number {
  return cents * KC_CENTS_TO_USD_MT;
}

function fmtDiff(usdPhys: number, benchmarkUsdMt: number): { diff: string; color: string } {
  const d = Math.round(usdPhys - benchmarkUsdMt);
  if (d === 0) return { diff: "flat", color: "#94a3b8" };
  const sign = d > 0 ? "+" : "−";
  return {
    diff: `${sign}${Math.abs(d)} USD`,
    color: d > 0 ? "#22c55e" : "#ef4444",
  };
}

export function computeOriginPrices(
  latest: LatestPrices | null,
  acaphe: AcapheLive | null,
): OriginPrice[] {
  const out: OriginPrice[] = [];
  if (!latest || !acaphe) return out;

  const tickers = new Map(latest.tickers.map(t => [t.label, t.value]));

  // Pick most-liquid contract: highest OI, falling back to highest Vol if OI absent.
  function mostLiquid<T extends { oi?: number | null; vol?: number | null; last: number | null }>(
    contracts: T[] | null | undefined
  ): T | null {
    if (!contracts?.length) return null;
    const hasOi = contracts.some(c => (c.oi ?? 0) > 0);
    return contracts.reduce<T | null>(
      (best, c) => {
        const score = hasOi ? (c.oi ?? 0) : (c.vol ?? 0);
        const bestScore = hasOi ? (best?.oi ?? 0) : (best?.vol ?? 0);
        return score > bestScore ? c : best;
      }, null
    );
  }

  const rcFront = mostLiquid(acaphe.robusta)?.last ?? null;

  // USD/VND FX rate from tickers — recomputed fresh here rather than relying
  // on the pre-baked $USD in the ticker string, which may be from a different
  // timestamp than the live RC price.
  const usdVndRaw = tickers.get("USD/VND");
  const usdVnd = usdVndRaw ? Number(usdVndRaw) : null;

  // ── Vietnam (FAQ — robusta) ─────────────────────────────────────────────
  // Ticker: "VN FAQ" -> "88.300 VND ($3,371)"
  const vn = tickers.get("VN FAQ");
  if (vn && rcFront != null) {
    const { localStr } = parsePhysical(vn);
    // Recompute USD/MT from VND + live FX rate to avoid stale pre-baked value
    const vndKg = parseVndKg(localStr);
    const usd = (vndKg != null && usdVnd != null && usdVnd > 0)
      ? Math.round(vndKg / usdVnd * 1000)
      : null;
    if (usd != null) {
      const { diff, color } = fmtDiff(usd, rcFront);
      out.push({
        countryName: "Vietnam",
        lat: 12.7,  lng: 108.0,   // Central Highlands (Buon Ma Thuot region)
        local: `${localStr}/kg`,
        usd:   `$${usd.toLocaleString()}/MT`,
        diff:  `${diff} vs RC`,
        diffColor: color,
      });
    }
  }

  // ── Uganda (Screen 15 — robusta) ────────────────────────────────────────
  // Ticker: "UGA S15" -> "166.93 ($3,680)"  (USD/cwt + USD/MT)
  const uga = tickers.get("UGA S15");
  if (uga && rcFront != null) {
    const { localStr, usd } = parsePhysical(uga);
    if (usd != null) {
      const { diff, color } = fmtDiff(usd, rcFront);
      out.push({
        countryName: "Uganda",
        lat: 1.0,   lng: 32.5,    // Central Uganda (Kampala area)
        local: `${localStr} USD/cwt`,
        usd:   `$${usd.toLocaleString()}/MT`,
        diff:  `${diff} vs RC`,
        diffColor: color,
      });
    }
  }

  // ── Brazil Conilon (CON T7 — robusta) ───────────────────────────────────
  // Ticker: "CON T7" -> "870,00 BRL ($2,959)"
  const con = tickers.get("CON T7");
  if (con && rcFront != null) {
    const { localStr, usd } = parsePhysical(con);
    if (usd != null) {
      const { diff, color } = fmtDiff(usd, rcFront);
      out.push({
        countryName: "Brazil",
        lat: -19.5, lng: -40.5,   // Espírito Santo (Conilon heartland)
        local: `${localStr}/bag (Conilon)`,
        usd:   `$${usd.toLocaleString()}/MT`,
        diff:  `${diff} vs RC`,
        diffColor: color,
      });
    }
  }

  return out;
}
