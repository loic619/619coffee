import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  firstBusinessDay, firstNoticeDayISO, iceEuHolidays, iceUsHolidays,
  isBusinessDay, parseContract, subtractBusinessDays,
} from "@/lib/fnd";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("holiday rules", () => {
  it("ICE US 2026: the recurring set", () => {
    const h = iceUsHolidays(2026);
    for (const d of [
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
      "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]) expect(h.has(d), d).toBe(true);
    // The Friday after Thanksgiving is an early close, not a closure.
    expect(h.has("2026-11-27")).toBe(false);
  });

  it("ICE Europe 2026: UK bank holidays with substitute days", () => {
    const h = iceEuHolidays(2026);
    for (const d of [
      "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25",
      "2026-08-31", "2026-12-25", "2026-12-28",   // Boxing Day (Sat) → Mon 28
    ]) expect(h.has(d), d).toBe(true);
  });

  it("ICE Europe 2027: Christmas on a Saturday — one substitute day, per ICE's table", () => {
    // The UK gazettes Mon 27 AND Tue 28. ICE's published RMF28 FND (28 Dec
    // 2027) only reconciles if the exchange trades Tue 28, so that is what
    // the calendar encodes. This test used to assert both days closed — an
    // assumption the exchange's own table contradicted.
    const h = iceEuHolidays(2027);
    expect(h.has("2027-12-27")).toBe(true);
    expect(h.has("2027-12-28")).toBe(false);
    expect(h.has("2028-01-03")).toBe(false);  // belongs to 2028's set
    expect(iceEuHolidays(2028).has("2028-01-03")).toBe(true);  // NY Sat → Mon
  });
});

describe("business-day arithmetic", () => {
  it("skips weekends and holidays", () => {
    expect(isBusinessDay(utc(2026, 11, 26), "us")).toBe(false);   // Thanksgiving
    expect(isBusinessDay(utc(2026, 11, 27), "us")).toBe(true);
    expect(isBusinessDay(utc(2026, 12, 28), "eu")).toBe(false);   // Boxing Day (sub)
    expect(isBusinessDay(utc(2026, 12, 28), "us")).toBe(true);
  });

  it("first business day steps over a New Year holiday", () => {
    expect(firstBusinessDay(2027, 1, "eu").toISOString().slice(0, 10)).toBe("2027-01-04");
    expect(firstBusinessDay(2026, 9, "us").toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("subtracting business days counts only business days", () => {
    // From Tue 1 Dec 2026 back 7 US business days, skipping Thanksgiving.
    expect(subtractBusinessDays(utc(2026, 12, 1), 7, "us").toISOString().slice(0, 10))
      .toBe("2026-11-19");
  });
});

describe("first notice day", () => {
  it("parses KC / RM and treats legacy RC as RM", () => {
    expect(parseContract("KCZ26")).toEqual({ product: "KC", month: 12, year: 2026 });
    expect(parseContract("RMU26")).toEqual({ product: "RM", month: 9, year: 2026 });
    expect(parseContract("RCU26")).toEqual({ product: "RM", month: 9, year: 2026 });
    expect(parseContract("XYZ26")).toBeNull();
  });

  it("KCZ26 lands on 19 Nov, not 20 — Thanksgiving is inside the count", () => {
    expect(firstNoticeDayISO("KCZ26")).toBe("2026-11-19");
  });

  it("RMF26 lands on 24 Dec, not 26 — Christmas and Boxing Day are inside the count", () => {
    expect(firstNoticeDayISO("RMF26")).toBe("2025-12-24");
  });

  it("RMU26 lands on 25 Aug, not 26 — the Summer bank holiday (31 Aug) is inside the count", () => {
    expect(firstNoticeDayISO("RMU26")).toBe("2026-08-25");
  });

  it("a contract with no holiday in the count is unchanged from weekend maths", () => {
    expect(firstNoticeDayISO("KCU26")).toBe("2026-08-21");
  });
});

// ── The cross-check: the calendar must agree with the table ─────────────────
// events.json is what the Daily Brief and the Telegram brief show; the chain
// table is what a trader reads next to the price. They were computed
// separately and could disagree. This test makes that a red build.
describe("events.json agrees with lib/fnd", () => {
  const file = path.resolve(__dirname, "../../public/data/events.json");
  const doc = JSON.parse(readFileSync(file, "utf8")) as {
    events: { date: string; category: string; title: string }[];
  };
  const fnd = doc.events.filter((e) => e.category === "fnd");

  it("has FND entries to check", () => {
    expect(fnd.length).toBeGreaterThan(0);
  });

  for (const e of fnd) {
    const sym = e.title.match(/^([A-Z]{2}[FGHJKMNQUVXZ]\d{2})\b/)?.[1];
    it(`${e.title} → ${e.date}`, () => {
      expect(sym, `cannot read a contract symbol from "${e.title}"`).toBeTruthy();
      expect(firstNoticeDayISO(sym!)).toBe(e.date);
    });
  }
});

// ── Ground truth: ICE's own expiry table ─────────────────────────────────────
// Read from ice.com on 2026-09-03 by probe 0.30 (workflow
// probe-ice-expiry-calendar.yml), product pages 15 (Coffee "C", KC) and
// 37089079 (Robusta, RC). This is the exchange's published First Notice Day
// for every listed contract, not a derivation. The rules the library encodes —
// KC "seven business days prior to first business day of delivery month",
// RC "fourth business day preceding the first business day of the delivery
// month" — are quoted verbatim from those pages. If a date here ever fails,
// either ICE changed a holiday or a rule, and the table is what to re-read.
const ICE_PUBLISHED_FND: Record<string, string> = {
  KCU26: "2026-08-21", KCZ26: "2026-11-19", KCH27: "2027-02-18", KCK27: "2027-04-22",
  KCN27: "2027-06-22", KCU27: "2027-08-23", KCZ27: "2027-11-19", KCH28: "2028-02-18",
  RMU26: "2026-08-25", RMX26: "2026-10-27", RMF27: "2026-12-24", RMH27: "2027-02-23",
  RMK27: "2027-04-27", RMN27: "2027-06-25", RMU27: "2027-08-25", RMX27: "2027-10-26",
  RMF28: "2027-12-28", RMH28: "2028-02-24",
};

describe("matches ICE's published expiry table (2026-09-03)", () => {
  for (const [sym, iso] of Object.entries(ICE_PUBLISHED_FND)) {
    it(`${sym} → ${iso}`, () => {
      expect(firstNoticeDayISO(sym)).toBe(iso);
    });
  }
});
