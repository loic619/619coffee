import { describe, expect, it } from "vitest";
import {
  cumAt, daysInMonth, fmtPerDay, isComplete, latestDay, monthFinal,
  paceFull, paceMTD, paceThrough, pctChange, projectMonthEnd,
} from "../pace";

// Shape lifted from the real file: not monotonic (day 13 < day 12 because the
// next month's fetch stored the page's "mês anterior" figure there), a key
// past the month's end (June "31"), and gaps on weekends.
const JUNE = {
  "1": 0, "2": 19587, "3": 49440, "5": 85865, "8": 344013, "10": 363015,
  "12": 582625, "13": 363015, "15": 693075, "19": 1048214, "20": 959027,
  "26": 1513852, "30": 1787492, "31": 1971549,
};

describe("daysInMonth", () => {
  it("knows month lengths, leap years included", () => {
    expect(daysInMonth("2026-06")).toBe(30);
    expect(daysInMonth("2026-08")).toBe(31);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
  });
});

describe("cumAt", () => {
  it("is the running maximum through the day, not the raw key", () => {
    expect(cumAt(JUNE, 12)).toBe(582625);
    expect(cumAt(JUNE, 13)).toBe(582625);   // 363015 stored at 13 is stale
    expect(cumAt(JUNE, 20)).toBe(1048214);  // 959027 at 20 is stale
  });
  it("carries across gaps and is null before any data", () => {
    expect(cumAt(JUNE, 4)).toBe(49440);
    expect(cumAt(JUNE, 6)).toBe(85865);
    expect(cumAt({ "5": 10 }, 4)).toBeNull();
    expect(cumAt(undefined, 4)).toBeNull();
  });
});

describe("latestDay / monthFinal", () => {
  it("clamps the latest key to the calendar month", () => {
    expect(latestDay(JUNE, "2026-06")).toBe(30);
    expect(latestDay({ "1": 5, "2": 9 }, "2026-09")).toBe(2);
    expect(latestDay({}, "2026-09")).toBe(0);
    expect(latestDay(undefined, "2026-09")).toBe(0);
  });
  it("takes the month's maximum as its closing figure", () => {
    expect(monthFinal(JUNE)).toBe(1971549);
    expect(monthFinal({})).toBeNull();
  });
});

describe("pace", () => {
  it("MTD pace divides the cumulative by days elapsed", () => {
    const p = paceMTD({ "1": 40482, "2": 74812 }, "2026-09");
    expect(p).toEqual({ day: 2, cum: 74812, perDay: 37406 });
  });
  it("paceThrough clamps to the month and uses the running max", () => {
    const p = paceThrough(JUNE, "2026-06", 13)!;
    expect(p.day).toBe(13);
    expect(p.cum).toBe(582625);
    expect(p.perDay).toBeCloseTo(582625 / 13, 6);
    expect(paceThrough(JUNE, "2026-06", 45)!.day).toBe(30);
    expect(paceThrough(JUNE, "2026-06", 0)).toBeNull();
  });
  it("full-month pace is the closing total over the calendar month", () => {
    const p = paceFull(JUNE, "2026-06")!;
    expect(p.day).toBe(30);
    expect(p.cum).toBe(1971549);
    expect(p.perDay).toBeCloseTo(1971549 / 30, 6);
    expect(paceFull({}, "2026-06")).toBeNull();
  });
  it("projects a month end by holding the pace", () => {
    expect(projectMonthEnd({ day: 2, cum: 74812, perDay: 37406 }, "2026-09")).toBe(37406 * 30);
  });
  it("marks a month complete once the file has moved past it", () => {
    expect(isComplete("2026-08", "2026-09")).toBe(true);
    expect(isComplete("2026-09", "2026-09")).toBe(false);
  });
});

describe("formatting", () => {
  it("pctChange", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(90, 100)).toBeCloseTo(-10);
    expect(pctChange(5, 0)).toBeNull();
  });
  it("fmtPerDay scales", () => {
    expect(fmtPerDay(640)).toBe("640/day");
    expect(fmtPerDay(1234)).toBe("1.2k/day");
    expect(fmtPerDay(82_400)).toBe("82k/day");
    expect(fmtPerDay(1_234_567)).toBe("1.23M/day");
  });
});
