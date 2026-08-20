// Daily front-month price → per-contract chart segments for Industry Pulse.
//
// The price line must break at every contract roll: the outgoing contract ends
// at ITS OWN settle on the roll date, and the incoming contract starts at ITS
// OWN price on that same date. The vertical gap between them is the roll
// spread — drawing one continuous line instead would show that spread as a
// price move that never happened.
//
// Segments alternate between exactly two dataKeys rather than one key per
// contract: consecutive segments then never share a key (so recharts can't
// join them into a single polyline), while same-key segments are separated by
// nulls, which recharts breaks on (`connectNulls` defaults to false). Two
// <Line>s keep the legend and render cost flat regardless of how many rolls
// the window spans.

/** One trading day of front-month pricing (futures_price_history.json).
 *  `prev_*` appear only on roll days: the OUTGOING contract's settle that day. */
export interface PriceDay {
  date: string;
  price: number;
  contract?: string;
  prev_contract?: string;
  prev_price?: number;
}

export const SEG_KEYS = ["segA", "segB"] as const;
export type SegKey = (typeof SEG_KEYS)[number];

export interface SegmentRow {
  date: string;
  segA: number | null;
  segB: number | null;
  /** dataKey holding the INCOMING contract on a roll day — drives the marker. */
  rollKey?: SegKey;
  /** Incoming contract label, root stripped (e.g. "Z26"). */
  rollTo?: string;
}

/** 'KCZ26' → 'Z26'; passes through anything that isn't a coffee symbol. */
export function shortLabel(sym: string): string {
  return sym.replace(/^(KC|RC|RM)/, "");
}

/**
 * Assign each contract run an alternating segment key over `dates`.
 *
 * `dates` is the full x-axis (trading days, plus any COT date the price feed
 * lacks). Days with no price produce an all-null row so the axis slot still
 * exists for the weekly series.
 */
export function buildPriceSegments(dates: string[], days: PriceDay[]): SegmentRow[] {
  const byDate = new Map(days.map(d => [d.date, d]));
  const rows: SegmentRow[] = [];
  let segIdx = 0;
  let curContract: string | null = null;

  for (const date of dates) {
    const row: SegmentRow = { date, segA: null, segB: null };
    const day = byDate.get(date);
    if (day) {
      const changed = !!(curContract && day.contract && day.contract !== curContract);
      if (changed && day.prev_price != null) {
        // Close the outgoing segment at its own settle on the roll date …
        row[SEG_KEYS[segIdx % 2]] = day.prev_price;
        segIdx += 1;                                    // … then open the next.
        row.rollKey = SEG_KEYS[segIdx % 2];
        row.rollTo = shortLabel(day.contract!);
      } else if (changed) {
        // Contract changed without a same-day outgoing settle (archive gap):
        // still break the line rather than draw a move that never happened.
        segIdx += 1;
        row.rollKey = SEG_KEYS[segIdx % 2];
        row.rollTo = shortLabel(day.contract!);
      }
      row[SEG_KEYS[segIdx % 2]] = day.price;
      curContract = day.contract ?? curContract;
    }
    rows.push(row);
  }
  return rows;
}
