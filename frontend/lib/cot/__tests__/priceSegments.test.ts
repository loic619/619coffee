import { describe, expect, it } from "vitest";
import { buildPriceSegments, shortLabel, type PriceDay } from "../priceSegments";

describe("shortLabel", () => {
  it("strips the contract root", () => {
    expect(shortLabel("KCZ26")).toBe("Z26");
    expect(shortLabel("RCX26")).toBe("X26");
    expect(shortLabel("RMX26")).toBe("X26");
    expect(shortLabel("WEIRD")).toBe("WEIRD");
  });
});

describe("buildPriceSegments", () => {
  // The real 2026-08-03 robusta roll: RCU26 settles 3786 that day, RCX26 opens
  // the new segment at its own 3784 on the SAME date.
  const days: PriceDay[] = [
    { date: "2026-07-30", price: 3800, contract: "RCU26" },
    { date: "2026-07-31", price: 3790, contract: "RCU26" },
    { date: "2026-08-03", price: 3784, contract: "RCX26", prev_contract: "RCU26", prev_price: 3786 },
    { date: "2026-08-04", price: 3770, contract: "RCX26" },
  ];
  const dates = days.map(d => d.date);

  it("keeps one contract on a single key", () => {
    const rows = buildPriceSegments(dates.slice(0, 2), days.slice(0, 2));
    expect(rows.map(r => r.segA)).toEqual([3800, 3790]);
    expect(rows.every(r => r.segB === null)).toBe(true);
  });

  it("ends the outgoing contract and starts the incoming one on the roll date", () => {
    const rows = buildPriceSegments(dates, days);
    const roll = rows[2];
    // Both values live on the SAME x — the visible break.
    expect(roll.date).toBe("2026-08-03");
    expect(roll.segA).toBe(3786);   // RCU26 closes at its own settle
    expect(roll.segB).toBe(3784);   // RCX26 opens at its own price
    expect(roll.rollKey).toBe("segB");
    expect(roll.rollTo).toBe("X26");
  });

  it("leaves the old key null after the roll so the line breaks", () => {
    const rows = buildPriceSegments(dates, days);
    expect(rows[3].segA).toBeNull();
    expect(rows[3].segB).toBe(3770);
  });

  it("alternates keys across successive rolls", () => {
    const three: PriceDay[] = [
      { date: "d1", price: 10, contract: "RCU26" },
      { date: "d2", price: 20, contract: "RCX26", prev_contract: "RCU26", prev_price: 11 },
      { date: "d3", price: 30, contract: "RCF27", prev_contract: "RCX26", prev_price: 21 },
      { date: "d4", price: 40, contract: "RCF27" },
    ];
    const rows = buildPriceSegments(three.map(d => d.date), three);
    expect([rows[0].segA, rows[0].segB]).toEqual([10, null]);
    expect([rows[1].segA, rows[1].segB]).toEqual([11, 20]);   // U closes, X opens
    expect([rows[2].segA, rows[2].segB]).toEqual([30, 21]);   // X closes, F opens on segA
    expect([rows[3].segA, rows[3].segB]).toEqual([40, null]);
    expect(rows[2].rollTo).toBe("F27");
  });

  it("still breaks when the roll day carries no outgoing settle (archive gap)", () => {
    const gap: PriceDay[] = [
      { date: "d1", price: 10, contract: "KCU26" },
      { date: "d2", price: 20, contract: "KCZ26" },   // no prev_price
    ];
    const rows = buildPriceSegments(gap.map(d => d.date), gap);
    expect([rows[0].segA, rows[0].segB]).toEqual([10, null]);
    expect([rows[1].segA, rows[1].segB]).toEqual([null, 20]);
    expect(rows[1].rollKey).toBe("segB");
  });

  it("emits all-null rows for dates with no price (COT date on a holiday)", () => {
    const rows = buildPriceSegments(["d0", "d1"], [{ date: "d1", price: 10, contract: "KCU26" }]);
    expect(rows[0]).toEqual({ date: "d0", segA: null, segB: null });
    expect(rows[1].segA).toBe(10);
  });

  it("does not treat the first contract as a roll", () => {
    const rows = buildPriceSegments(["d1"], [{ date: "d1", price: 10, contract: "KCU26" }]);
    expect(rows[0].rollKey).toBeUndefined();
    expect(rows[0].rollTo).toBeUndefined();
  });
});
