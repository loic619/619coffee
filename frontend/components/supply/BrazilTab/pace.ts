// Pace arithmetic for the Cecafé daily accumulator (cecafe_daily.json).
//
// Each month is a { "day": cumulativeBags } map built by a scraper that runs
// once or twice a day. Two quirks of that file shape everything here:
//
//   * It is NOT monotonic. On day N of month M+1 the scraper also stores the
//     page's "mês anterior" cumulative under day N of month M, which can be
//     lower than what was recorded live on that day. So "cumulative through
//     day D" is the running maximum over keys ≤ D, never the raw key.
//   * Day keys can exceed the month's length (June carries a "31" — July 31st's
//     fetch storing June's closing figure). Elapsed days are clamped to the
//     calendar month so a pace never divides by a day that does not exist.
//
// Pace is bags per CALENDAR day: a month's average pace is its final total
// divided by its number of days, and month-to-date pace is the cumulative
// through the latest reported day divided by that day. Cecafé registers on
// business days, so both are "average over the month", not a per-session rate.
// The same definition on both sides is what makes the comparisons honest.

export type MonthDays = Record<string, number>;

export interface Pace {
  /** Days elapsed the pace is measured over (clamped to the month). */
  day: number;
  /** Cumulative bags through `day`. */
  cum: number;
  /** Bags per calendar day. */
  perDay: number;
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Cumulative bags through `day`: the running maximum over stored keys ≤ day.
 *  null when nothing has been stored at or before that day. */
export function cumAt(md: MonthDays | undefined, day: number): number | null {
  if (!md) return null;
  let best: number | null = null;
  for (const [k, v] of Object.entries(md)) {
    const d = Number(k);
    if (!Number.isFinite(d) || d > day || v == null) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Latest day with data, clamped to the calendar month. 0 when empty. */
export function latestDay(md: MonthDays | undefined, ym: string): number {
  if (!md) return 0;
  const days = Object.keys(md).map(Number).filter(Number.isFinite);
  if (!days.length) return 0;
  return Math.min(Math.max(...days), daysInMonth(ym));
}

/** The month's closing total as far as the file knows it (its maximum). */
export function monthFinal(md: MonthDays | undefined): number | null {
  if (!md) return null;
  const vals = Object.values(md).filter((v) => v != null);
  return vals.length ? Math.max(...vals) : null;
}

/** Pace through a given day of the month. */
export function paceThrough(md: MonthDays | undefined, ym: string, day: number): Pace | null {
  const d = Math.min(day, daysInMonth(ym));
  if (d <= 0) return null;
  const cum = cumAt(md, d);
  if (cum === null) return null;
  return { day: d, cum, perDay: cum / d };
}

/** Month-to-date pace: through the latest reported day. */
export function paceMTD(md: MonthDays | undefined, ym: string): Pace | null {
  return paceThrough(md, ym, latestDay(md, ym));
}

/** Whole-month average pace: closing total over the calendar month. Only
 *  meaningful for a month that has closed — callers decide that with
 *  isComplete(). */
export function paceFull(md: MonthDays | undefined, ym: string): Pace | null {
  const cum = monthFinal(md);
  if (cum === null) return null;
  const day = daysInMonth(ym);
  return { day, cum, perDay: cum / day };
}

/** A month has closed when the file's reference month is past it. */
export function isComplete(ym: string, latestYm: string): boolean {
  return ym < latestYm;
}

/** Month-end volume implied by holding a pace for the whole month. */
export function projectMonthEnd(pace: Pace, ym: string): number {
  return pace.perDay * daysInMonth(ym);
}

export function pctChange(cur: number, base: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(base) || base === 0) return null;
  return ((cur - base) / base) * 100;
}

/** "82k/day", "1.2M/day", "640/day". */
export function fmtPerDay(perDay: number): string {
  const n = Math.round(perDay);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M/day`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k/day`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k/day`;
  return `${n}/day`;
}

export function fmtPct(p: number | null): string {
  if (p === null) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}
