// Shared vocabulary for the world balance sheet — the statement component
// and its editor both read and write the same file, so the leg names, the
// line shape and the little arithmetic helpers live here rather than being
// defined twice and drifting apart.

/** `arabica` is the LEGACY unsplit leg. It is kept as a first-class column
 *  rather than folded into natural: most origins still carry it, and
 *  guessing a process for them would be wrong in both directions (Colombia
 *  and the MAG 6 are washed, Brazil is largely natural). Both the statement
 *  and the editor hide it once nothing uses it. */
export const LEGS = ["arabica_washed", "arabica_natural", "arabica", "robusta"] as const;
export type Leg = (typeof LEGS)[number];

export const LEG_LABEL: Record<Leg, string> = {
  arabica_washed: "Ar. washed",
  arabica_natural: "Ar. natural",
  arabica: "Ar. unsplit",
  robusta: "Robusta",
};
export const LEG_TONE: Record<Leg, string> = {
  arabica_washed: "text-amber-300",
  arabica_natural: "text-orange-400",
  arabica: "text-amber-600",
  robusta: "text-emerald-400",
};

export type Legs = Partial<Record<Leg, number>>;

export interface Line {
  key: string; label: string;
  arabica_washed?: number; arabica_natural?: number; arabica?: number; robusta?: number;
}
export interface Risk {
  key: string; driver: string; origin: string; crop: string;
  impact_m_bags: number; probability: number; note?: string;
}
export interface WorldBalanceDoc {
  crop_year: string; unit: string; updated: string; note?: string;
  carry_in: Line[]; demand_hubs: Line[]; carry_out: Line[]; risks: Risk[];
}

/** The three analyst-entered blocks, in statement order. Production is
 *  absent on purpose — it is derived from the per-origin crop estimates and
 *  both the API route and the applier reject a payload carrying it. */
export const LINE_BLOCKS = [
  { key: "carry_in"    as const, label: "Carry-in stocks",      side: "supply" as const },
  { key: "demand_hubs" as const, label: "Consumption by hub",   side: "demand" as const },
  { key: "carry_out"   as const, label: "Carry-out stocks",     side: "demand" as const },
];
export type LineBlock = (typeof LINE_BLOCKS)[number]["key"];

export const r1 = (v: number) => Math.round(v * 10) / 10;
/** Statement formatting: a value under half a decimal reads as a dash, not
 *  as "0.0" — an empty line and a rounding artefact are different things. */
export const fmt = (v: number) => (Math.abs(v) < 0.05 ? "–" : v.toFixed(1));

export const emptyLegs = (): Record<Leg, number> =>
  ({ arabica_washed: 0, arabica_natural: 0, arabica: 0, robusta: 0 });
export const addLegs = (a: Record<Leg, number>, b: Legs) => {
  for (const l of LEGS) a[l] += b[l] ?? 0;
  return a;
};
export const legTotal = (l: Record<Leg, number>) => LEGS.reduce((s, k) => s + l[k], 0);
/** Arabica however it is currently expressed — the roll-up that keeps the
 *  statement comparable while some origins are still unsplit. */
export const arabicaAll = (l: Record<Leg, number>) =>
  l.arabica_washed + l.arabica_natural + l.arabica;
