/** The vintage check is only worth publishing if its arithmetic is right.
 *
 * The two claims that carry real weight are the differential parser (an offer
 * misread as +49 instead of −49 moves a median by a lot) and the Cortés lag
 * (the paper says shipping trails picking by a quarter, and reads that lag off
 * a correlation peak). Both are tested against constructed data where the
 * answer is known in advance.
 */
import { describe, expect, it } from "vitest";
import { cortesSeasonality, kBags, parseDiff, HARVEST_BY_MONTH } from "./hondurasLive";

describe("parseDiff", () => {
  it("reads both signs", () => {
    expect(parseDiff("plus 49")).toBe(49);
    expect(parseDiff("minus 94")).toBe(-94);
  });

  it("accepts the decimal comma the source uses", () => {
    expect(parseDiff("plus 7,5")).toBe(7.5);
  });

  it("refuses outright prices rather than treating them as a differential", () => {
    // "€/kg 7,1" is a price. Folding it into a median of differentials would
    // silently drag the whole ladder toward zero.
    expect(parseDiff("€/kg 7,1")).toBeNull();
    expect(parseDiff("")).toBeNull();
    expect(parseDiff(undefined)).toBeNull();
    expect(parseDiff("plus")).toBeNull();
    expect(parseDiff("49")).toBeNull();
  });
});

describe("kBags", () => {
  it("converts tonnes to thousand 60-kg bags", () => {
    expect(kBags(60)).toBe(1);
    expect(kBags(300_000)).toBe(5000);
  });
});

/** Build a daily series whose monthly container-export totals follow `shape`
 *  (indexed 1..12), every month fully observed. */
function synth(years: number[], shape: Record<number, number>) {
  const out: { date: string; export_container: number }[] = [];
  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= dim; d++) {
        out.push({
          date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          export_container: (shape[m] ?? 0) / dim,
        });
      }
    }
  }
  return out;
}

describe("cortesSeasonality", () => {
  it("recovers a planted 3-month lag as the correlation peak", () => {
    // Shipping = the harvest curve pushed three months later. If the lag
    // search works, lag 3 must win outright.
    const shifted: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) {
      const src = ((m - 3 - 1 + 12) % 12) + 1;
      shifted[m] = 50 + (HARVEST_BY_MONTH[src] ?? 0) * 10;
    }
    const { lags, index } = cortesSeasonality(synth([2021, 2022, 2023], shifted));
    expect(index).toHaveLength(12);
    const best = lags.reduce((a, b) => (b.r > a.r ? b : a));
    expect(best.lag).toBe(3);
    expect(best.r).toBeGreaterThan(0.99);
  });

  it("finds no lag in a flat series", () => {
    const flat: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) flat[m] = 100;
    const { lags } = cortesSeasonality(synth([2021, 2022], flat));
    // Constant port volume has zero variance, so every r is undefined rather
    // than a confident zero — the important part is that none of them is high.
    for (const l of lags) expect(Number.isNaN(l.r) || Math.abs(l.r) < 0.2).toBe(true);
  });

  it("drops truncated months instead of reading them as weak trade", () => {
    const shape: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) shape[m] = 100;
    const days = synth([2021], shape).filter(d => !d.date.startsWith("2021-06-2"));
    // June now has ~20 observed days. Kept, it would look like a 33% slump.
    const { index } = cortesSeasonality(days.concat(synth([2022], shape)));
    const jun = index.find(r => r.m === 6)!;
    expect(jun.n).toBe(1);                    // 2022 only; 2021's June excluded
    expect(jun.index).toBeCloseTo(100, 0);
  });

  it("indexes to 100 = the average month", () => {
    const shape: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) shape[m] = m <= 6 ? 50 : 150;
    const { index } = cortesSeasonality(synth([2021, 2022], shape));
    const mean = index.reduce((s, r) => s + r.index, 0) / index.length;
    expect(mean).toBeCloseTo(100, 6);
    expect(index.find(r => r.m === 1)!.index).toBeCloseTo(50, 6);
    expect(index.find(r => r.m === 12)!.index).toBeCloseTo(150, 6);
  });

  it("returns empty rather than a fake reading when there is too little data", () => {
    const shape: Record<number, number> = { 1: 100, 2: 100, 3: 100 };
    const { index, lags, years } = cortesSeasonality(synth([2021], shape).slice(0, 60));
    expect(index).toEqual([]);
    expect(lags).toEqual([]);
    expect(years).toEqual([]);
  });

  it("reports per-year spring/autumn ratios so one season cannot carry the claim", () => {
    const shape: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) shape[m] = m === 3 || m === 4 ? 200 : 100;
    const { years } = cortesSeasonality(synth([2021, 2022], shape));
    expect(years).toHaveLength(2);
    for (const y of years) {
      expect(y.springX).toBeGreaterThan(1.5);
      expect(y.autumnX).toBeLessThan(1);
    }
  });
});
