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

// ── Depth level 3: quality grades (supply) and consumption segments (demand) ──
//
// The two sides of the statement gain depth in different currencies, on
// purpose. Supply breaks down into the grades that actually trade, in each
// origin's own vocabulary — Honduras sells SHG, Vietnam sells G2, Brazil
// sells GC, and those names do not map onto one another, so a grade row is
// only ever summed inside its own origin. Demand breaks down into the form
// the coffee is sold in, which IS comparable across hubs.
//
// Both are stored as SHARES of the parent leg rather than absolute bags:
// production is derived from the crop estimates and hub totals are entered,
// so a share keeps the detail re-summing to their parent exactly and stops
// them drifting when the parent moves.

export interface GradeRow { key: string; label: string; share: number }
export interface OriginGradesDoc {
  unit: string; updated: string; note?: string;
  origins: Record<string, Partial<Record<Leg, GradeRow[]>>>;
}

export interface SegmentDef { key: string; channel: string; label: string }
export interface ChannelDef { key: string; label: string }
/** leg → segment key → share of that leg. */
export type SegMix = Partial<Record<Leg, Record<string, number>>>;
export interface DemandSegmentsDoc {
  unit: string; updated: string; note?: string;
  channels: ChannelDef[]; segments: SegmentDef[];
  default_mix: SegMix; hub_mix: Record<string, SegMix>;
}

/** Split `total` across `shares` at one decimal, largest-remainder, so the
 *  parts sum to the rounded parent EXACTLY. Without this a reader can add up
 *  a column of rounded children and find they miss the subtotal by 0.1 —
 *  which reads as a bug in a statement whose whole job is to add up. */
export function allocate(total: number, shares: number[]): number[] {
  const tenths = Math.round(total * 10);
  if (tenths <= 0 || !shares.length) return shares.map(() => 0);
  const raw = shares.map(s => s * tenths);
  const base = raw.map(v => Math.floor(v));
  let rem = tenths - base.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < byRemainder.length && rem > 0; k++, rem--) base[byRemainder[k].i]++;
  return base.map(v => v / 10);
}

/** Display names for the origins carried in the world view. Shared by the
 *  statement's grade rows and the editor's origin picker so a rename lands
 *  in one place. */
export const ORIGIN_LABELS: Record<string, string> = {
  brazil: "Brazil", colombia: "Colombia", honduras: "Honduras",
  guatemala: "Guatemala", nicaragua: "Nicaragua", costa_rica: "Costa Rica",
  mexico: "Mexico", peru: "Peru", vietnam: "Vietnam", indonesia: "Indonesia",
  india: "India", china: "China", uganda: "Uganda", ethiopia: "Ethiopia",
  ivory_coast: "Ivory Coast", tanzania: "Tanzania",
};
