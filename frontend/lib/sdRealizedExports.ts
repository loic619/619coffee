// Builds the realised-exports overlay every per-origin Supply & Demand
// card consumes. Each origin's monthly customs/exports feed has its own
// JSON shape — bags vs k-bags vs kg, "month" vs "date", Oct-Sep vs
// Apr-Mar crop year — and rewriting the bucketing logic per origin
// reliably produces drift. Caller hands us {month, kbags} pairs and
// the crop-year start month; we hand back the overlay SupplyDemandBalance
// expects.
//
// Coverage rule (matches the Vietnam wiring):
//   • Fully realised crops (12 months present) → use the realised sum.
//   • In-progress crop (the one containing the most recent month in the
//     feed) → realised YTD + remaining-forecast split in the chart.
//   • Older crops with incomplete coverage (typical for the partial
//     crop at the start of a customs feed) → omitted from the overlay
//     so SupplyDemandBalance falls back to USDA PSD.

import type { RealizedExportsOverlay } from "@/components/supply/SupplyDemandBalance";

export interface MonthlyKbagsEntry {
  /** "YYYY-MM". */
  month: string;
  /** Thousand 60-kg bags shipped that month. */
  kbags: number;
}

export interface RealizedExportsInput {
  monthly: MonthlyKbagsEntry[];
  /** First calendar month of the crop year (1–12). Apr-Mar origins
   *  (Brazil, Indonesia) pass 4; Oct-Sep origins (Vietnam, Uganda)
   *  pass 10. */
  cropYearStartMonth: number;
  /** Display name surfaced on tooltips + the header chip, e.g.
   *  "Vietnam Customs" or "Cecafé". */
  sourceLabel: string;
}

/** Convert a "YYYY-MM" date to the crop-year key its bucket lives in,
 *  e.g. ("2025-04", 4) → "2025/26", ("2024-09", 10) → "2023/24". */
function cropYearKey(ym: string, startMonth: number): string {
  const [yStr, mStr] = ym.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

export function buildRealizedExportsOverlay(
  input: RealizedExportsInput,
): RealizedExportsOverlay | null {
  if (!input.monthly?.length) return null;

  type Bucket = { kbags: number; months: string[] };
  const byCrop: Record<string, Bucket> = {};
  let latestMonthOverall = "";
  for (const e of input.monthly) {
    if (!e.month || !Number.isFinite(e.kbags)) continue;
    const cy = cropYearKey(e.month, input.cropYearStartMonth);
    (byCrop[cy] ??= { kbags: 0, months: [] }).kbags += e.kbags;
    byCrop[cy].months.push(e.month);
    if (e.month > latestMonthOverall) latestMonthOverall = e.month;
  }
  if (!latestMonthOverall) return null;
  const currentCropYear = cropYearKey(latestMonthOverall, input.cropYearStartMonth);

  const out: RealizedExportsOverlay["byCropYear"] = {};
  for (const [cy, bucket] of Object.entries(byCrop)) {
    const isComplete = bucket.months.length === 12;
    const isCurrent  = cy === currentCropYear;
    // Older partial crops fall back to USDA PSD — sneaking the
    // 4-out-of-12 sum in would silently understate the year.
    if (!isComplete && !isCurrent) continue;
    out[cy] = {
      kbags:       bucket.kbags,
      isPartial:   !isComplete,
      latestMonth: bucket.months.reduce((a, b) => (a > b ? a : b)),
    };
  }

  // Seasonality-derived estimate of the current crop's still-unshipped
  // months, from the feed's own history: each missing calendar month is
  // valued at the average of its last ≤3 prior-year observations.
  // SupplyDemandBalance uses this when the analyst budget (multi-source
  // exports / projection / USDA) is already exceeded by realised YTD —
  // without it the "forecast remaining" segment snapped to 0 with months
  // still left in the crop (Vietnam 2025/26, Aug 2026: realised 25,610
  // kbags vs a stale 25,500 ICO budget → remaining showed 0 despite
  // Aug+Sep shipping ~2,200 kbags in a normal year).
  const cur = out[currentCropYear];
  if (cur?.isPartial) {
    const curMonths = new Set(byCrop[currentCropYear].months);
    const startYear = parseInt(currentCropYear.split("/")[0] ?? "", 10);
    const missingCalMonths: number[] = [];
    for (let i = 0; i < 12; i++) {
      const m = ((input.cropYearStartMonth - 1 + i) % 12) + 1;
      const y = m >= input.cropYearStartMonth ? startYear : startYear + 1;
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      if (!curMonths.has(ym)) missingCalMonths.push(m);
    }
    if (missingCalMonths.length) {
      const history: Record<number, MonthlyKbagsEntry[]> = {};
      for (const e of input.monthly) {
        if (!e.month || !Number.isFinite(e.kbags) || curMonths.has(e.month)) continue;
        const m = parseInt(e.month.split("-")[1] ?? "", 10);
        (history[m] ??= []).push(e);
      }
      let total = 0;
      let covered = 0;
      for (const m of missingCalMonths) {
        const samples = (history[m] ?? [])
          .sort((a, b) => (a.month < b.month ? 1 : -1))
          .slice(0, 3);
        if (!samples.length) continue;
        total += samples.reduce((s, e) => s + e.kbags, 0) / samples.length;
        covered++;
      }
      if (covered > 0) cur.seasonalRemainingKbags = Math.round(total);
    }
  }

  return Object.keys(out).length > 0
    ? { byCropYear: out, sourceLabel: input.sourceLabel }
    : null;
}
