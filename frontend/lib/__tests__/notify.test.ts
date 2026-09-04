import { beforeEach, describe, expect, it } from "vitest";
import { changedAt, markSeen, newSince, readSeen, TAB_FEEDS, SUPPLY_FEEDS, BRAZIL_SUBTAB_FEEDS, DEMAND_TAB_FEEDS, FUTURES_TAB_FEEDS } from "../notify";
import { FEED_META } from "../freshness";

const HEALTH = {
  scrapers: { futures: "2026-09-03T07:20:00Z", cot: "2026-09-01T10:00:00Z", brazil_exports: "2026-09-02T09:00:00Z" },
  data_changed_at: { cot: "2026-08-29T20:00:00Z", brazil_exports: "2026-08-12T09:00:00Z" },
  data_asof: { brazil_exports: "2026-07" },
};

describe("changedAt", () => {
  it("prefers the release stamp over the pipeline run", () => {
    expect(changedAt(HEALTH, "cot")).toBe("2026-08-29T20:00:00Z");
    expect(changedAt(HEALTH, "futures")).toBe("2026-09-03T07:20:00Z");
    expect(changedAt(HEALTH, "nope")).toBeNull();
  });
});

describe("newSince", () => {
  it("is everything stamped when there is no baseline", () => {
    expect(newSince(HEALTH, ["futures", "cot", "nope"], null)).toEqual(["futures", "cot"]);
  });
  it("is only what changed after the last visit", () => {
    expect(newSince(HEALTH, ["futures", "cot", "brazil_exports"], "2026-09-01T00:00:00Z")).toEqual(["futures"]);
    expect(newSince(HEALTH, ["futures"], "2026-09-03T08:00:00Z")).toEqual([]);
  });
  it("is empty without health", () => {
    expect(newSince(null, ["futures"], null)).toEqual([]);
  });
});

describe("seen store", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips per scope", () => {
    expect(readSeen("tab:/supply")).toBeNull();
    markSeen("tab:/supply", "2026-09-03T12:00:00Z");
    expect(readSeen("tab:/supply")).toBe("2026-09-03T12:00:00Z");
    expect(readSeen("tab:/demand")).toBeNull();
  });
});

describe("scope maps", () => {
  it("only name feeds the freshness registry knows", () => {
    const all = [TAB_FEEDS, SUPPLY_FEEDS, BRAZIL_SUBTAB_FEEDS, DEMAND_TAB_FEEDS, FUTURES_TAB_FEEDS]
      .flatMap((m) => Object.values(m).flat());
    const unknown = all.filter((k) => !FEED_META[k]);
    expect(unknown).toEqual([]);
  });
});
