import { describe, it, expect } from "vitest";
import { buildDensityGrid, _gridCols, _rowsForCount, _assignSpans } from "../grid";
import type { AgeDist } from "../age";
import type { OriginFlowPair, PortFlow } from "../types";

const FRESH: AgeDist = { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
const AGED:  AgeDist = { fresh: 0.5, y1to2: 0.3, y2to3: 0.1, y3to4: 0.05, y4plus: 0.05 };

describe("_gridCols / _rowsForCount", () => {
  it("keeps the grid square-ish with a floor of 4 cols", () => {
    expect(_gridCols(0)).toBe(4);
    expect(_gridCols(9)).toBe(4);   // ceil(sqrt(9))=3 → floored to 4
    expect(_gridCols(100)).toBe(10);
  });
  it("rows = ceil(n / cols)", () => {
    expect(_rowsForCount(0, 4)).toBe(0);
    expect(_rowsForCount(10, 4)).toBe(3);
  });
});

describe("buildDensityGrid invariant: current = existing + netGained", () => {
  it("holds for a pure inflow (net-gained, no churn)", () => {
    const byOrigin = { Brazil: 1000, Colombia: 500 };
    const flow: Record<string, OriginFlowPair> = {
      Brazil:   { gross_in: 600, gross_out: 0 },
      Colombia: { gross_in: 0,   gross_out: 0 },
    };
    const g = buildDensityGrid(1500, byOrigin, AGED, flow, 100, "KC");
    // Warrant counts must satisfy the port-level invariant.
    expect(g.existing.length + g.netGained.length).toBe(g.totalWarrants);
    expect(g.netGainedVol).toBe(600);
    expect(g.lostVol).toBe(0);
    expect(g.transitVol).toBe(0);
  });

  it("splits in & out into transit when cohort-matched", () => {
    const flow: Record<string, OriginFlowPair> = {
      Vietnam: { gross_in: 300, gross_out: 200 },   // 200 in & out, 100 net-gained
    };
    const g = buildDensityGrid(1000, { Vietnam: 1000 }, FRESH, flow, 10, "RC", undefined, true);
    expect(g.netGainedVol).toBe(100);
    expect(g.transitVol).toBe(200);
    expect(g.lostVol).toBe(0);
  });

  it("treats every flow as pure in/out when NOT cohort-matched", () => {
    const flow: Record<string, OriginFlowPair> = {
      Vietnam: { gross_in: 300, gross_out: 200 },
    };
    const g = buildDensityGrid(1000, { Vietnam: 1000 }, FRESH, flow, 10, "RC", undefined, false);
    expect(g.netGainedVol).toBe(300);
    expect(g.lostVol).toBe(200);
    expect(g.transitVol).toBe(0);
  });

  it("prefers the backend cohort-resolved transit when present", () => {
    const flow: Record<string, OriginFlowPair> = {
      Vietnam: { gross_in: 300, gross_out: 200, transit: 50 },
    };
    const g = buildDensityGrid(1000, { Vietnam: 1000 }, FRESH, flow, 10, "RC", undefined, true);
    expect(g.transitVol).toBe(50);
    expect(g.netGainedVol).toBe(250); // 300 − 50
    expect(g.lostVol).toBe(150);      // 200 − 50
  });
});

describe("_assignSpans", () => {
  const mk = (capacity: number): PortFlow => ({
    market: "KC", code: "X", name: "X", current: 0, capacity, pctFull: 0,
    floor: 0, peakDate: null, historyFrom: null, peakIsHistorical: false,
    unit: "bags", squareUnit: 1, byOrigin: {}, age: FRESH, flowByOrigin: {},
    inflow: [], outflow: [], span: 1,
    poison: { pct: 0, total: 0, aged: 0, badOrigin: 0, deadPort: 0, lowClass: 0 },
  });
  it("scales spans 1..4 by sqrt of capacity, smallest never below 1", () => {
    const ports = [mk(10000), mk(2500), mk(100)];
    _assignSpans(ports);
    expect(ports[0].span).toBe(4);             // the max
    expect(ports[2].span).toBeGreaterThanOrEqual(1);
    expect(ports.every((p) => p.span >= 1 && p.span <= 4)).toBe(true);
  });
});
