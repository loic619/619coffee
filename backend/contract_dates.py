"""Shared ICE coffee contract date math — First Notice Day (FND), exchange
business days and trading-day offsets for KC / RC / RM contract symbols.

This is THE Python source for the rule. build_events_calendar.py (the Daily
Brief's events.json) imports from here; exporters/futures.py (the OI-to-FND
chart) imports from here; frontend/lib/fnd.ts is the TypeScript mirror and a
vitest asserts every FND in events.json agrees with it. Before September 2026
there were three independent weekend-only copies, and "business day" meant
Mon–Fri — so every exchange holiday inside the count shifted the true date
silently. RMF26 came out two days late, KCZ26 and RMU26 a day late.

The rule (ICE contract specifications)
    Coffee "C" (KC, ICE Futures U.S.):  FND = 7 exchange business days prior
        to the first business day of the delivery month.
    Robusta (RM / legacy RC, ICE Europe): FND = 4 exchange business days prior
        to the first business day of the delivery month.

"Exchange business day" excludes the exchange's own holidays. The calendars
below are RULE-BASED so they do not go stale at year end; an ad-hoc closure
ICE announces goes in EXTRA_CLOSURES.

VERIFIED against ICE's published expiry table on 2026-09-03 (probe 0.21,
product pages 15 and 37089079): both rules quoted verbatim, every listed
contract through March 2028 matching to the day. The table is pinned in
scraper/tests/test_contract_dates.py.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

LETTER_TO_MONTH = {
    "F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
    "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12,
}

Market = str  # "us" (ICE Futures U.S.) | "eu" (ICE Futures Europe)

# Ad-hoc closures beyond the recurring rules, as ISO dates.
EXTRA_CLOSURES: dict[Market, set[date]] = {"us": set(), "eu": set()}


# ── Holiday calendars ─────────────────────────────────────────────────────────

def _easter(y: int) -> date:
    """Easter Sunday, Gregorian (Meeus/Jones/Butcher)."""
    a, b, c = y % 19, y // 100, y % 100
    d, e, f = b // 4, b % 4, (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(y, month, day)


def _nth_weekday(y: int, m: int, weekday: int, n: int) -> date:
    """weekday: Mon=0…Sun=6. n=1 first, n=-1 last."""
    if n > 0:
        first = date(y, m, 1)
        return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
    nxt = date(y + (m == 12), (m % 12) + 1, 1)
    last = nxt - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _observed_us(d: date) -> date:
    """US observance: Saturday → Friday before, Sunday → Monday after."""
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def _uk_substitute(d: date, taken: set[date]) -> date:
    """UK substitute day: a weekend holiday moves to the next free weekday."""
    while d.weekday() >= 5 or d in taken:
        d += timedelta(days=1)
    return d


def ice_us_holidays(y: int) -> set[date]:
    """ICE Futures U.S. softs closures. The Friday after Thanksgiving is an
    early close, not a closure, so it counts as a business day."""
    e = _easter(y)
    days = {
        _observed_us(date(y, 1, 1)),        # New Year's Day
        _nth_weekday(y, 1, 0, 3),           # Martin Luther King Jr. Day
        _nth_weekday(y, 2, 0, 3),           # Presidents' Day
        e - timedelta(days=2),              # Good Friday
        _nth_weekday(y, 5, 0, -1),          # Memorial Day
        _observed_us(date(y, 6, 19)),       # Juneteenth
        _observed_us(date(y, 7, 4)),        # Independence Day
        _nth_weekday(y, 9, 0, 1),           # Labor Day
        _nth_weekday(y, 11, 3, 4),          # Thanksgiving
        _observed_us(date(y, 12, 25)),      # Christmas
    }
    if date(y + 1, 1, 1).weekday() == 5:    # next New Year on a Saturday → Fri 31 Dec
        days.add(date(y, 12, 31))
    return days | EXTRA_CLOSURES["us"]


def ice_eu_holidays(y: int) -> set[date]:
    """ICE Futures Europe softs closures — England & Wales bank holidays with
    the substitute-day rule (Christmas and Boxing Day resolved together)."""
    e = _easter(y)
    taken: set[date] = set()
    taken.add(_uk_substitute(date(y, 1, 1), taken))     # New Year's Day
    taken |= {
        e - timedelta(days=2),                          # Good Friday
        e + timedelta(days=1),                          # Easter Monday
        _nth_weekday(y, 5, 0, 1),                       # Early May bank holiday
        _nth_weekday(y, 5, 0, -1),                      # Spring bank holiday
        _nth_weekday(y, 8, 0, -1),                      # Summer bank holiday
    }
    xmas = date(y, 12, 25)
    taken.add(_uk_substitute(xmas, taken))              # Christmas Day
    # Boxing Day. When Christmas is a SATURDAY the UK gazettes two substitute
    # days (Mon 27, Tue 28) — but ICE's published expiry table only reconciles
    # if the exchange trades the Tuesday: RMF28's FND is 28 Dec 2027, which
    # needs 28 Dec to be a business day. One substitute day, not two, for that
    # configuration; every other year the ordinary rule holds (RMF27 = 24 Dec
    # 2026 confirms Mon 28 Dec 2026 closed).
    if xmas.weekday() != 5:
        taken.add(_uk_substitute(date(y, 12, 26), taken))   # Boxing Day
    return taken | EXTRA_CLOSURES["eu"]


_HOL_CACHE: dict[tuple[Market, int], set[date]] = {}


def holidays(market: Market, year: int) -> set[date]:
    key = (market, year)
    if key not in _HOL_CACHE:
        _HOL_CACHE[key] = ice_us_holidays(year) if market == "us" else ice_eu_holidays(year)
    return _HOL_CACHE[key]


# ── Business-day arithmetic ───────────────────────────────────────────────────

def is_business_day(d: date, market: Market = "us") -> bool:
    return d.weekday() < 5 and d not in holidays(market, d.year)


def first_business_day(year: int, month: int, market: Market = "us") -> date:
    """First exchange business day of the month."""
    d = date(year, month, 1)
    while not is_business_day(d, market):
        d += timedelta(days=1)
    return d


def subtract_business_days(d: date, n: int, market: Market = "us") -> date:
    """Move back `n` exchange business days from `d`."""
    remaining = n
    while remaining > 0:
        d -= timedelta(days=1)
        if is_business_day(d, market):
            remaining -= 1
    return d


# ── Contracts ─────────────────────────────────────────────────────────────────

_SYM = re.compile(r"^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$", re.I)


def market_for(symbol: str) -> Market | None:
    """Which exchange a contract trades on: KC → ICE U.S., RM/RC → ICE Europe."""
    m = _SYM.match(symbol or "")
    if not m:
        return None
    return "us" if m.group(1).upper() == "KC" else "eu"


def calc_fnd(symbol: str) -> date | None:
    """First Notice Day for an ICE coffee contract symbol, or None if it does
    not parse. Holiday-aware for the contract's own exchange."""
    m = _SYM.match(symbol or "")
    if not m:
        return None
    product, letter, yr = m.group(1).upper(), m.group(2).upper(), int(m.group(3))
    month_num = LETTER_TO_MONTH.get(letter)
    if not month_num:
        return None
    market: Market = "us" if product == "KC" else "eu"
    days_before = 7 if product == "KC" else 4
    return subtract_business_days(first_business_day(2000 + yr, month_num, market), days_before, market)


def trading_days_to(d1: date, fnd: date, market: Market = "us") -> int:
    """Signed exchange trading days from d1 to fnd; negative = before FND,
    0 if d1 is already on/after fnd. Pass the contract's market so its own
    holidays are skipped — `market_for(symbol)` gives it."""
    if d1 >= fnd:
        return 0
    count, cur = 0, d1
    while cur < fnd:
        cur += timedelta(days=1)
        if is_business_day(cur, market):
            count += 1
    return -count
