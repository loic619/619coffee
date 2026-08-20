// Brewing-format mix and the grams-per-cup model.
//
// WHY THIS FILE IS HAND-CURATED: no source we scrape publishes retail format
// mix or the retail-vs-out-of-home split. These are documented desk estimates
// assembled from ICO country profiles, national coffee-association surveys
// (BDKV/DKV Germany, BCA UK, ANCC Italy, NCA USA, AJCA Japan), and trade press.
// They are ESTIMATES, labelled as such everywhere they surface, and are meant
// to be corrected as better data (e.g. a licensed retail-scan panel) arrives.
// Each entry carries the vintage of the estimate so staleness is visible.
//
// WHY IT MATTERS (the analytic point): a cup of coffee costs a very different
// amount of GREEN coffee depending on how it is brewed — filter/ground ~12 g,
// a capsule ~6 g, instant ~5 g green-equivalent, a coffee-shop double ~16 g.
// So a country can drink MORE cups while importing LESS coffee (capsule shift)
// or the reverse (whole-bean / third-wave shift). Mix change is a first-order
// driver of import demand that per-capita kg alone completely hides.

export type Format = "instant" | "ground" | "wholeBean" | "singleServe";

// Green-coffee grams consumed per cup, by format. Roasted→green uses the
// standard ~1.19 roasting loss; instant uses the ICO 2.6× soluble factor on
// ~2 g of powder per cup.
export const GRAMS_PER_CUP: Record<Format | "outOfHome", number> = {
  ground:      12,   // drip/filter or moka, ~10 g roasted
  wholeBean:   13,   // home espresso/grinder, ~11 g roasted
  singleServe:  6,   // capsule/pod, ~5.3 g roasted
  instant:      5,   // ~2 g soluble × 2.6 GBE
  outOfHome:   16,   // coffee-shop double shot, ~14 g roasted
};

export const FORMAT_LABEL: Record<Format, string> = {
  instant: "Instant / soluble",
  ground: "Roast & ground",
  wholeBean: "Whole bean",
  singleServe: "Single-serve (capsules/pods)",
};

export const FORMAT_COLOR: Record<Format, string> = {
  instant:     "#f59e0b",
  ground:      "#b45309",
  wholeBean:   "#16a34a",
  singleServe: "#0ea5e9",
};

export interface BrewingProfile {
  /** Shares of AT-HOME (retail) coffee volume by format — sum ≈ 1. */
  retail: Record<Format, number>;
  /** Share of total cups drunk outside the home (cafés, workplace, HoReCa). */
  outOfHomeShare: number;
  /** Confidence in the estimate: high = repeated national survey data. */
  confidence: "high" | "medium" | "low";
  /** What the estimate leans on, and roughly when. */
  note: string;
}

// Keyed by the `short` code used in demand_stocks growth_markets.
export const BREWING: Record<string, BrewingProfile> = {
  usa: {
    retail: { instant: 0.09, ground: 0.38, wholeBean: 0.17, singleServe: 0.36 },
    outOfHomeShare: 0.35,
    confidence: "high",
    note: "NCA National Coffee Data Trends — single-serve (K-cup) share among the world's highest; ~2024.",
  },
  uk: {
    retail: { instant: 0.55, ground: 0.17, wholeBean: 0.10, singleServe: 0.18 },
    outOfHomeShare: 0.40,
    confidence: "high",
    note: "Instant-dominant but eroding fast toward pods and OOH chains; BCA/trade press ~2024.",
  },
  eu: {
    retail: { instant: 0.16, ground: 0.47, wholeBean: 0.20, singleServe: 0.17 },
    outOfHomeShare: 0.30,
    confidence: "medium",
    note: "EU-27 blended average — masks very wide member spread (see Germany vs France vs Italy); ~2024.",
  },
  japan: {
    retail: { instant: 0.38, ground: 0.34, wholeBean: 0.08, singleServe: 0.20 },
    outOfHomeShare: 0.35,
    confidence: "medium",
    note: "AJCA surveys; RTD/canned coffee is a large extra channel not split out here; ~2024.",
  },
  canada: {
    retail: { instant: 0.13, ground: 0.34, wholeBean: 0.18, singleServe: 0.35 },
    outOfHomeShare: 0.38,
    confidence: "medium",
    note: "Single-serve penetration close to the US; Tim Hortons keeps OOH high; ~2024.",
  },
  australia: {
    retail: { instant: 0.40, ground: 0.20, wholeBean: 0.25, singleServe: 0.15 },
    outOfHomeShare: 0.45,
    confidence: "medium",
    note: "Espresso café culture → unusually high OOH; whole-bean strong at home; ~2024.",
  },
  new_zealand: {
    retail: { instant: 0.42, ground: 0.18, wholeBean: 0.25, singleServe: 0.15 },
    outOfHomeShare: 0.45,
    confidence: "low",
    note: "Assumed to track Australia closely; no dedicated survey consulted.",
  },
  switzerland: {
    retail: { instant: 0.08, ground: 0.22, wholeBean: 0.22, singleServe: 0.48 },
    outOfHomeShare: 0.32,
    confidence: "medium",
    note: "Home of Nespresso — the world's highest capsule share; ~2024.",
  },
  norway: {
    retail: { instant: 0.08, ground: 0.62, wholeBean: 0.22, singleServe: 0.08 },
    outOfHomeShare: 0.22,
    confidence: "medium",
    note: "Nordic filter culture: very high per-capita, ground-dominant, low OOH; ~2024.",
  },
  china: {
    retail: { instant: 0.55, ground: 0.12, wholeBean: 0.18, singleServe: 0.15 },
    outOfHomeShare: 0.55,
    confidence: "medium",
    note: "Instant still the base but chains (Luckin/Starbucks) drive an exceptionally high OOH share; ~2024.",
  },
  india: {
    retail: { instant: 0.72, ground: 0.20, wholeBean: 0.04, singleServe: 0.04 },
    outOfHomeShare: 0.30,
    confidence: "medium",
    note: "Instant-dominant nationally; South-Indian filter coffee is the ground share; ~2024.",
  },
  korea: {
    retail: { instant: 0.62, ground: 0.13, wholeBean: 0.13, singleServe: 0.12 },
    outOfHomeShare: 0.50,
    confidence: "medium",
    note: "Instant mix-sticks huge at home, but café density is world-leading; ~2024.",
  },
  russia: {
    retail: { instant: 0.60, ground: 0.25, wholeBean: 0.10, singleServe: 0.05 },
    outOfHomeShare: 0.20,
    confidence: "medium",
    note: "Instant-led, ground/whole-bean growing in cities; ~2023 (sanctions cloud newer data).",
  },
  turkey: {
    retail: { instant: 0.55, ground: 0.35, wholeBean: 0.05, singleServe: 0.05 },
    outOfHomeShare: 0.30,
    confidence: "medium",
    note: "Instant (Nescafé) plus finely-ground Turkish coffee; tea still the dominant hot drink; ~2024.",
  },
  brazil: {
    retail: { instant: 0.12, ground: 0.80, wholeBean: 0.04, singleServe: 0.04 },
    outOfHomeShare: 0.25,
    confidence: "high",
    note: "ABIC: overwhelmingly roast & ground at home; ~2024.",
  },
  indonesia: {
    retail: { instant: 0.70, ground: 0.22, wholeBean: 0.04, singleServe: 0.04 },
    outOfHomeShare: 0.35,
    confidence: "medium",
    note: "Instant/3-in-1 dominant; modern café chains growing fast in cities; ~2024.",
  },
  vietnam: {
    retail: { instant: 0.50, ground: 0.42, wholeBean: 0.04, singleServe: 0.04 },
    outOfHomeShare: 0.45,
    confidence: "medium",
    note: "Strong domestic café culture (cà phê phin) alongside heavy instant; ~2024.",
  },
  mexico: {
    retail: { instant: 0.60, ground: 0.30, wholeBean: 0.06, singleServe: 0.04 },
    outOfHomeShare: 0.28,
    confidence: "medium",
    note: "Instant-heavy despite being an origin; ~2024.",
  },
  ethiopia: {
    retail: { instant: 0.03, ground: 0.92, wholeBean: 0.05, singleServe: 0.00 },
    outOfHomeShare: 0.40,
    confidence: "low",
    note: "Traditional ceremony brewing from home-roasted beans; formats poorly captured by retail concepts.",
  },
  philippines: {
    retail: { instant: 0.85, ground: 0.10, wholeBean: 0.03, singleServe: 0.02 },
    outOfHomeShare: 0.25,
    confidence: "medium",
    note: "Among the world's most instant-dominant markets (3-in-1 sachets); ~2024.",
  },
};

/** Weighted green-grams per cup for a profile (retail mix + OOH blend). */
export function gramsPerCup(p: BrewingProfile): { retail: number; blended: number } {
  const retail =
    p.retail.instant * GRAMS_PER_CUP.instant +
    p.retail.ground * GRAMS_PER_CUP.ground +
    p.retail.wholeBean * GRAMS_PER_CUP.wholeBean +
    p.retail.singleServe * GRAMS_PER_CUP.singleServe;
  const blended = retail * (1 - p.outOfHomeShare) + GRAMS_PER_CUP.outOfHome * p.outOfHomeShare;
  return { retail, blended };
}

/** Cups per adult per year implied by a consumption level and a brewing mix. */
export function cupsPerAdult(consumptionMt: number, adults: number, p: BrewingProfile): number | null {
  if (!adults || !consumptionMt) return null;
  const { blended } = gramsPerCup(p);
  return (consumptionMt * 1e6) / blended / adults;   // MT→g, ÷ g/cup, ÷ adults
}

/**
 * Mix-shift sensitivity: hold cups constant, move `pts` of retail share from
 * one format to another, and report the % change in green-coffee demand.
 * This is the "capsules → whole bean" question made numeric.
 */
export function mixShiftImpactPct(p: BrewingProfile, from: Format, to: Format, pts: number): number {
  const before = gramsPerCup(p).blended;
  const shifted: BrewingProfile = {
    ...p,
    retail: {
      ...p.retail,
      [from]: Math.max(0, p.retail[from] - pts),
      [to]: p.retail[to] + Math.min(pts, p.retail[from]),
    },
  };
  const after = gramsPerCup(shifted).blended;
  return (after / before - 1) * 100;
}
