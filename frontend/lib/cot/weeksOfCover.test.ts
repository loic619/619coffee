/** Weeks of cover is a unit conversion, and unit conversions are exactly the
 *  kind of code that looks right and is off by a factor. The two lot sizes
 *  differ (KC 17.01 t, RC 10 t), so the same lot count must NOT produce the
 *  same number of weeks — that is the bug worth guarding against.
 */
import { describe, expect, it } from "vitest";
import {
  basisFromHubs, DEFAULT_BASIS, lotsPerWeek, netCommercial, toWeeksOfCover,
} from "./weeksOfCover";
import type { CotMarketPositions, ProcessedCotRow } from "./types";

const pos = (o: Partial<CotMarketPositions> = {}): CotMarketPositions => ({
  pmpuLong: 0, pmpuShort: 0, pmpuSpread: 0,
  swapLong: 0, swapShort: 0, swapSpread: 0,
  mmLong: 0, mmShort: 0, mmSpread: 0,
  otherLong: 0, otherShort: 0, otherSpread: 0,
  nonRepLong: 0, nonRepShort: 0, nonRepSpread: 0, ...o,
});

const row = (date: string, ny: Partial<CotMarketPositions>, ldn: Partial<CotMarketPositions>) =>
  ({ date, ny: pos(ny), ldn: pos(ldn) } as unknown as ProcessedCotRow);

describe("lotsPerWeek", () => {
  it("reproduces the robusta figure by hand", () => {
    // 78m bags x 60 kg = 4.68m t/yr; / 10 t per lot = 468,000 lots/yr; / 52.
    expect(lotsPerWeek(78, "ldn")).toBeCloseTo(9000, 0);
  });

  it("reproduces the arabica figure by hand", () => {
    // 86m bags x 60 kg = 5.16m t/yr; / 17.01 t per lot / 52.
    expect(lotsPerWeek(86, "ny")).toBeCloseTo(5.16e6 / 17.01 / 52, 6);
  });

  it("does NOT give the same answer for both markets at equal volume", () => {
    // The whole point of dividing per market: a KC lot carries 70% more
    // coffee, so equal bag volumes buy materially different lot counts.
    expect(lotsPerWeek(80, "ny")).not.toBeCloseTo(lotsPerWeek(80, "ldn"), 0);
    expect(lotsPerWeek(80, "ldn") / lotsPerWeek(80, "ny")).toBeCloseTo(17.01 / 10, 6);
  });

  it("scales linearly with consumption", () => {
    expect(lotsPerWeek(156, "ldn")).toBeCloseTo(2 * lotsPerWeek(78, "ldn"), 6);
  });
});

describe("toWeeksOfCover", () => {
  const basis = { ny: 86, ldn: 78 };

  it("puts the two sides of the trade on opposite sides of zero", () => {
    const out = toWeeksOfCover(
      [row("2026-01-06", { pmpuLong: 20000, pmpuShort: 40000 },
                         { pmpuLong: 18000, pmpuShort: 45000 })],
      "ldn", basis);
    expect(out[0].roaster).toBeGreaterThan(0);
    expect(out[0].producer).toBeLessThan(0);
  });

  it("converts a known robusta position to weeks", () => {
    // 9,000 lots/week at the 78m basis, so 45,000 short = exactly 5 weeks.
    const out = toWeeksOfCover(
      [row("2026-01-06", {}, { pmpuLong: 18000, pmpuShort: 45000 })], "ldn", basis);
    expect(out[0].producer).toBeCloseTo(-5, 6);
    expect(out[0].roaster).toBeCloseTo(2, 6);
  });

  it("reads the right market's block", () => {
    const out = toWeeksOfCover(
      [row("2026-01-06", { pmpuLong: 99999 }, { pmpuLong: 9000 })], "ldn", basis);
    expect(out[0].roaster).toBeCloseTo(1, 6);          // ldn, not the ny 99999
  });

  it("nets spec across managed money AND other reportables", () => {
    const out = toWeeksOfCover(
      [row("2026-01-06", {}, { mmLong: 27000, mmShort: 9000, otherLong: 4500, otherShort: 4500 })],
      "ldn", basis);
    expect(out[0].spec).toBeCloseTo(2, 6);             // (27000-9000)/9000
  });

  it("returns empty rather than Infinity when the basis is unusable", () => {
    expect(toWeeksOfCover([row("2026-01-06", {}, { pmpuLong: 1 })], "ldn",
      { ny: 86, ldn: 0 })).toEqual([]);
  });
});

describe("basisFromHubs", () => {
  const hubs = [
    { arabica_washed: 13.2, arabica_natural: 13.3, robusta: 24.0 },
    { arabica_washed: 12.6, arabica_natural: 10.4, robusta: 8.5 },
    { arabica_washed: 5.4, arabica_natural: 6.6, robusta: 20.0 },
    { arabica_washed: 4.7, arabica_natural: 8.8, robusta: 7.5 },
    { arabica_washed: 3.2, arabica_natural: 3.3, robusta: 9.0 },
    { arabica_washed: 2.5, arabica_natural: 2.0, robusta: 9.0 },
  ];

  it("sums both arabica legs and the single robusta leg", () => {
    const b = basisFromHubs(hubs)!;
    expect(b.ldn).toBeCloseTo(78.0, 6);
    expect(b.ny).toBeCloseTo(86.0, 6);
  });

  it("matches the committed fallback, so a failed fetch does not move the axis", () => {
    const b = basisFromHubs(hubs)!;
    expect(b.ny).toBeCloseTo(DEFAULT_BASIS.ny, 6);
    expect(b.ldn).toBeCloseTo(DEFAULT_BASIS.ldn, 6);
  });

  it("refuses a malformed payload instead of scaling the panel by garbage", () => {
    expect(basisFromHubs(null)).toBeNull();
    expect(basisFromHubs([])).toBeNull();
    expect(basisFromHubs([{ robusta: 24 }])).toBeNull();               // missing arabica legs
    expect(basisFromHubs([{ arabica_washed: "13.2", arabica_natural: 13.3, robusta: 24 }])).toBeNull();
  });

  it("refuses an implausibly small world", () => {
    // A single hub parsed out of six would silently make every position look
    // ~6x larger. Cheaper to fall back than to publish that.
    expect(basisFromHubs([hubs[1]])).toBeNull();
  });
});

describe("netCommercial", () => {
  it("adds the signed legs, so net short reads negative", () => {
    expect(netCommercial({ date: "x", roaster: 2, producer: -5, spec: 1 })).toBeCloseTo(-3, 6);
  });
});
