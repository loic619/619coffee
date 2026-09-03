/**
 * First Notice Day for ICE coffee futures — the ONE place it is computed.
 *
 * Why this file exists
 * --------------------
 * Until September 2026 FND was derived in two places that could disagree:
 * the Futures chain table (app/futures/page.tsx) and the events calendar
 * (backend/scripts/build_events_calendar.py → events.json, which the Daily
 * Brief and the Telegram brief both read). Both used weekend-only arithmetic —
 * "business day" meant Mon–Fri — so every exchange holiday inside the count
 * silently shifted the true FND by a day. FND drives roll timing and delivery
 * exposure; a date that is quietly one day off is the kind of error that costs
 * someone money. Concretely, weekend-only maths put RMF26's FND on 26 Dec 2025
 * when Christmas and Boxing Day inside the count make it 24 Dec, and KCZ26's on
 * 20 Nov 2026 when Thanksgiving makes it 19 Nov.
 *
 * The rule (ICE contract specifications)
 * --------------------------------------
 *   Coffee "C" (KC, ICE Futures U.S.):
 *     FND = seven exchange business days prior to the first business day of
 *     the delivery month.
 *   Robusta (RM / legacy RC, ICE Futures Europe):
 *     FND = four exchange business days prior to the first business day of
 *     the delivery month.
 *
 * "Exchange business day" excludes the exchange's own holidays. The holiday
 * sets below are RULE-BASED (not a static table), so they do not go stale at
 * year end. They encode the published patterns; if ICE announces an ad-hoc
 * closure it must be added to `EXTRA_CLOSURES`.
 *
 * VERIFIED against ICE's published expiry table on 2026-09-03 (probe 0.30):
 * both rules are quoted verbatim from the product pages, and every listed
 * contract through March 2028 matches to the day — the holiday-shifted ones
 * included. That table is pinned in lib/__tests__/fnd.test.ts, so drift fails
 * a test rather than a trade. (The check also caught that the product id the
 * repo had assumed was Robusta, 37089080, is White Sugar; Robusta is 37089079.)
 *
 * Two consumers, one source: the chain table calls `firstNoticeDay()`; the
 * cross-check test (lib/__tests__/fnd.test.ts) asserts every `category: "fnd"`
 * entry in events.json matches it, so the calendar cannot drift from the table
 * again without a red test.
 */

export type IceMarket = "us" | "eu";

const LETTER_TO_MONTH: Record<string, number> = {
  F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12,
};

/** Ad-hoc closures ICE has announced beyond the recurring rules. YYYY-MM-DD. */
const EXTRA_CLOSURES: Record<IceMarket, ReadonlySet<string>> = {
  us: new Set<string>([]),
  eu: new Set<string>([]),
};

// ── Date helpers (all in UTC to keep the arithmetic timezone-free) ──────────

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utc(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day));
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** nth weekday of a month (weekday 0=Sun…6=Sat). n=1 first, n=-1 last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = utc(y, m, 1);
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return addDays(first, offset + (n - 1) * 7);
  }
  const last = addDays(utc(y, m + 1, 1), -1);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return addDays(last, -offset);
}

/** Easter Sunday (Gregorian, Meeus/Jones/Butcher). */
function easterSunday(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

/** US federal-style observance: Sat → Fri before, Sun → Mon after. */
function observedUS(d: Date): Date {
  const wd = d.getUTCDay();
  return wd === 6 ? addDays(d, -1) : wd === 0 ? addDays(d, 1) : d;
}

/** UK substitute-day rule: a holiday on Sat/Sun moves to the next weekday
 *  that is not already a holiday. Christmas+Boxing Day interact, so they are
 *  resolved together. */
function ukSubstitute(d: Date, taken: Set<string>): Date {
  let out = d;
  while (out.getUTCDay() === 0 || out.getUTCDay() === 6 || taken.has(ymd(out))) {
    out = addDays(out, 1);
  }
  return out;
}

// ── Holiday calendars ───────────────────────────────────────────────────────

/**
 * ICE Futures U.S. — softs (Coffee "C") trading holidays.
 * New Year's, MLK, Presidents', Good Friday, Memorial, Juneteenth,
 * Independence, Labor, Thanksgiving, Christmas. The Friday after Thanksgiving
 * is an early close, not a closure, so it counts as a business day.
 */
export function iceUsHolidays(y: number): Set<string> {
  const easter = easterSunday(y);
  const days = [
    observedUS(utc(y, 1, 1)),               // New Year's Day
    nthWeekday(y, 1, 1, 3),                 // Martin Luther King Jr. Day
    nthWeekday(y, 2, 1, 3),                 // Presidents' Day
    addDays(easter, -2),                    // Good Friday
    nthWeekday(y, 5, 1, -1),                // Memorial Day
    observedUS(utc(y, 6, 19)),              // Juneteenth
    observedUS(utc(y, 7, 4)),               // Independence Day
    nthWeekday(y, 9, 1, 1),                 // Labor Day
    nthWeekday(y, 11, 4, 4),                // Thanksgiving
    observedUS(utc(y, 12, 25)),             // Christmas
  ];
  // New Year's observed on the previous Friday belongs to THIS year's list
  // when 1 Jan of next year is a Saturday.
  const nextNY = utc(y + 1, 1, 1);
  if (nextNY.getUTCDay() === 6) days.push(addDays(nextNY, -1));
  const s = new Set(days.map(ymd));
  EXTRA_CLOSURES.us.forEach((x) => { if (x.startsWith(String(y))) s.add(x); });
  return s;
}

/**
 * ICE Futures Europe — London softs (Robusta) trading holidays: the England &
 * Wales bank holidays. New Year's, Good Friday, Easter Monday, Early May,
 * Spring, Summer, Christmas, Boxing Day — with the UK substitute-day rule
 * when a fixed-date holiday lands on a weekend.
 */
export function iceEuHolidays(y: number): Set<string> {
  const easter = easterSunday(y);
  const taken = new Set<string>();
  const add = (d: Date) => { taken.add(ymd(d)); };
  add(ukSubstitute(utc(y, 1, 1), taken));   // New Year's Day
  add(addDays(easter, -2));                 // Good Friday
  add(addDays(easter, 1));                  // Easter Monday
  add(nthWeekday(y, 5, 1, 1));              // Early May bank holiday
  add(nthWeekday(y, 5, 1, -1));             // Spring bank holiday
  add(nthWeekday(y, 8, 1, -1));             // Summer bank holiday
  const xmas = utc(y, 12, 25);
  add(ukSubstitute(xmas, taken));            // Christmas Day
  // Boxing Day. When Christmas is a SATURDAY the UK gazettes two substitute
  // days (Mon 27, Tue 28) — but ICE's published expiry table only reconciles
  // if the exchange trades the Tuesday: RMF28's FND is 28 Dec 2027, which
  // needs 28 Dec to be a business day. So one substitute day, not two, for
  // that configuration. Every other year the ordinary rule holds (2026:
  // Fri 25 + Sat 26 → Mon 28 closed, and RMF27 = 24 Dec confirms it).
  if (xmas.getUTCDay() !== 6) add(ukSubstitute(utc(y, 12, 26), taken));
  EXTRA_CLOSURES.eu.forEach((x) => { if (x.startsWith(String(y))) taken.add(x); });
  return taken;
}

const holidayCache = new Map<string, Set<string>>();
function holidays(market: IceMarket, y: number): Set<string> {
  const k = `${market}:${y}`;
  let s = holidayCache.get(k);
  if (!s) {
    s = market === "us" ? iceUsHolidays(y) : iceEuHolidays(y);
    holidayCache.set(k, s);
  }
  return s;
}

// ── Business-day arithmetic ─────────────────────────────────────────────────

export function isBusinessDay(d: Date, market: IceMarket): boolean {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !holidays(market, d.getUTCFullYear()).has(ymd(d));
}

export function firstBusinessDay(y: number, m: number, market: IceMarket): Date {
  let d = utc(y, m, 1);
  while (!isBusinessDay(d, market)) d = addDays(d, 1);
  return d;
}

export function subtractBusinessDays(d: Date, n: number, market: IceMarket): Date {
  let out = d;
  let remaining = n;
  while (remaining > 0) {
    out = addDays(out, -1);
    if (isBusinessDay(out, market)) remaining--;
  }
  return out;
}

// ── First Notice Day ────────────────────────────────────────────────────────

export interface ContractId { product: "KC" | "RM"; month: number; year: number; }

/** Parse KCZ26 / RMU26 / RCU26 (legacy RC treated as RM). */
export function parseContract(symbol: string): ContractId | null {
  const m = symbol.match(/^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return null;
  const month = LETTER_TO_MONTH[m[2].toUpperCase()];
  if (!month) return null;
  const product = m[1].toUpperCase() === "KC" ? "KC" : "RM";
  return { product, month, year: 2000 + parseInt(m[3], 10) };
}

/** FND as a UTC date, or null for an unparseable symbol. */
export function firstNoticeDay(symbol: string): Date | null {
  const c = parseContract(symbol);
  if (!c) return null;
  const market: IceMarket = c.product === "KC" ? "us" : "eu";
  const days = c.product === "KC" ? 7 : 4;
  return subtractBusinessDays(firstBusinessDay(c.year, c.month, market), days, market);
}

/** FND as YYYY-MM-DD, or null. */
export function firstNoticeDayISO(symbol: string): string | null {
  const d = firstNoticeDay(symbol);
  return d ? ymd(d) : null;
}

/** Compact d/m form used by the chain table, "—" when unknown. */
export function fmtFirstNoticeDay(symbol: string): string {
  const d = firstNoticeDay(symbol);
  return d ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}` : "—";
}
