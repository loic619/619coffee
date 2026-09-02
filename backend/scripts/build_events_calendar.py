#!/usr/bin/env python3
"""
build_events_calendar.py — generate backend/seed/events.json for 2026

Hand-maintained scheduling data is brittle; this script computes the
recurring entries (WASDE, ICO monthly, Cecafé monthly, ICE FND dates,
Vietnam Customs monthly bulletin) from known patterns so the file stays
in sync without manual data entry every month.

Run:
    python backend/scripts/build_events_calendar.py            # preview to stdout
    python backend/scripts/build_events_calendar.py --write    # overwrite seed/events.json

Known patterns:
  - WASDE: USDA publishes around the 10th-12th of each month (exact list
           in WASDE_2026_DATES below — copied from USDA's published
           schedule at oce.usda.gov).
  - ICO monthly: last business day of each month.
  - Cecafé monthly: ~17th-20th of the following month. Encoded as the 17th
           with a note explaining the date is approximate.
  - ICE KC (Arabica) months: H K N U Z (Mar May Jul Sep Dec).
    First Notice Day: 7 business days before the 1st business day of the
    delivery month. Matches `firstNoticeDay()` in the frontend chain logic.
  - ICE RC (Robusta) months: F H K N U X (Jan Mar May Jul Sep Nov).
    First Notice Day: 4 business days before the 1st business day of the
    delivery month.
  - Vietnam Customs: monthly export bulletin published 22-28 of each month
           (variable; encoded as the 25th with a date-range note).

To add a one-off (NCA, SCA, Sintercafé, Fed FOMC, etc.), append it to
ONE_OFFS below and re-run with --write.
"""
from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parents[2]
EVENTS_PATH        = REPO_ROOT / "backend" / "seed" / "events.json"
EVENTS_PUBLIC_PATH = REPO_ROOT / "frontend" / "public" / "data" / "events.json"

# ── Recurring patterns ────────────────────────────────────────────────────────

# USDA WASDE 2026 published schedule (oce.usda.gov; release time 12:00 ET = 16:00/17:00 UTC).
WASDE_2026_DATES = [
    ("2026-01-12", "12:00"),  # times in ET; we'll convert below
    ("2026-02-11", "12:00"),
    ("2026-03-10", "12:00"),
    ("2026-04-09", "12:00"),
    ("2026-05-12", "12:00"),
    ("2026-06-11", "12:00"),
    ("2026-07-10", "12:00"),
    ("2026-08-12", "12:00"),
    ("2026-09-11", "12:00"),
    ("2026-10-09", "12:00"),
    ("2026-11-10", "12:00"),
    ("2026-12-10", "12:00"),
]


# ── ICE FND helpers ───────────────────────────────────────────────────────────

# Month-letter → calendar month for ICE coffee.
KC_MONTHS = {"H": 3, "K": 5, "N": 7, "U": 9, "Z": 12}
RC_MONTHS = {"F": 1, "H": 3, "K": 5, "N": 7, "U": 9, "X": 11}


# Exchange holidays — this used to be Mon–Fri only, with a note saying "good
# enough for a watchlist". It was not: an FND that is a day off is exactly what
# a watchlist exists to prevent. Weekend-only maths put RMF26 on 26 Dec 2025
# (true: 24 Dec — Christmas and Boxing Day sit inside the count) and KCZ26 on
# 20 Nov 2026 (true: 19 Nov — Thanksgiving). These rules mirror
# frontend/lib/fnd.ts exactly; a vitest cross-check there fails the build if
# the two ever disagree on an entry in events.json.

def _easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e, f = b // 4, b % 4, (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
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
    return d - timedelta(days=1) if d.weekday() == 5 else d + timedelta(days=1) if d.weekday() == 6 else d


def _uk_substitute(d: date, taken: set) -> date:
    while d.weekday() >= 5 or d in taken:
        d += timedelta(days=1)
    return d


def ice_us_holidays(y: int) -> set:
    """ICE Futures U.S. softs closures. Friday after Thanksgiving is an early
    close, not a closure."""
    e = _easter(y)
    days = {
        _observed_us(date(y, 1, 1)), _nth_weekday(y, 1, 0, 3), _nth_weekday(y, 2, 0, 3),
        e - timedelta(days=2), _nth_weekday(y, 5, 0, -1), _observed_us(date(y, 6, 19)),
        _observed_us(date(y, 7, 4)), _nth_weekday(y, 9, 0, 1), _nth_weekday(y, 11, 3, 4),
        _observed_us(date(y, 12, 25)),
    }
    if date(y + 1, 1, 1).weekday() == 5:          # next New Year on a Saturday
        days.add(date(y, 12, 31))
    return days


def ice_eu_holidays(y: int) -> set:
    """ICE Futures Europe softs closures — England & Wales bank holidays with
    the substitute-day rule."""
    e = _easter(y)
    taken: set = set()
    taken.add(_uk_substitute(date(y, 1, 1), taken))
    taken |= {e - timedelta(days=2), e + timedelta(days=1),
              _nth_weekday(y, 5, 0, 1), _nth_weekday(y, 5, 0, -1), _nth_weekday(y, 8, 0, -1)}
    taken.add(_uk_substitute(date(y, 12, 25), taken))
    taken.add(_uk_substitute(date(y, 12, 26), taken))
    return taken


_HOL_CACHE: dict = {}


def _is_biz(d: date, market: str) -> bool:
    if d.weekday() >= 5:
        return False
    key = (market, d.year)
    if key not in _HOL_CACHE:
        _HOL_CACHE[key] = ice_us_holidays(d.year) if market == "us" else ice_eu_holidays(d.year)
    return d not in _HOL_CACHE[key]


def _first_biz_day(year: int, month: int, market: str = "us") -> date:
    """First exchange business day of the month."""
    d = date(year, month, 1)
    while not _is_biz(d, market):
        d += timedelta(days=1)
    return d


def _sub_biz_days(d: date, n: int, market: str = "us") -> date:
    """Subtract n exchange business days."""
    out = d
    while n > 0:
        out -= timedelta(days=1)
        if _is_biz(out, market):
            n -= 1
    return out


def _fnd_kc(year: int, month: int) -> date:
    return _sub_biz_days(_first_biz_day(year, month, "us"), 7, "us")


def _fnd_rc(year: int, month: int) -> date:
    return _sub_biz_days(_first_biz_day(year, month, "eu"), 4, "eu")


def _last_biz_day(year: int, month: int) -> date:
    """Last Mon-Fri of the given month."""
    # Jump to the 1st of next month, step back to find last weekday.
    if month == 12:
        d = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        d = date(year, month + 1, 1) - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


# ── One-offs — extend manually as new dates are confirmed ─────────────────────

# FOMC 2026 — the Fed publishes its schedule two years ahead. Dates below are
# the DECISION day (day 2 of each two-day meeting), when the statement lands at
# 14:00 ET; that is the tradeable moment, not the day the meeting opens.
# 19:00 UTC covers the EDT half of the year and is an hour early in EST — close
# enough for a watchlist, and the calendar has no intraday alerting.
# Mar/Jun/Sep/Dec additionally carry the Summary of Economic Projections (the
# "dot plot"), which moves the dollar more than a no-change statement does.
FOMC_2026 = [
    ("2026-01-28", False), ("2026-03-18", True),
    ("2026-04-29", False), ("2026-06-17", True),
    ("2026-07-29", False), ("2026-09-16", True),
    ("2026-10-28", False), ("2026-12-09", True),
]

ONE_OFFS: list[dict] = [
    # ── Jackson Hole 2026 (Kansas City Fed, Jackson Lake Lodge WY) ───────────
    # Aug 27-29. Coffee cares because the symposium is where the Fed signals
    # the rate path, and the dollar leg of that repricing feeds straight into
    # the CCI — a weaker dollar lifts producer-currency terms of trade and, via
    # the exporter side of the index, the arabica/robusta complex.
    {
        "date":     "2026-08-27",
        "category": "central_bank",
        "title":    "Jackson Hole Symposium — Day 1",
        "url":      "https://www.kansascityfed.org/research/jackson-hole-economic-symposium/",
        "notes":    "Kansas City Fed symposium opens. 2026 theme: Financial Innovation — Implications for Payments and Policy.",
    },
    {
        "date":     "2026-08-28",
        "time":     "14:00",
        "category": "central_bank",
        "title":    "Jackson Hole — Fed Chair keynote",
        "url":      "https://www.kansascityfed.org/research/jackson-hole-economic-symposium/",
        "notes":    "The market-moving session: the chair's address is the clearest read on the rate path between FOMC meetings. Watch USD → CCI → origin terms of trade.",
    },
    {
        "date":     "2026-08-29",
        "category": "central_bank",
        "title":    "Jackson Hole Symposium — Day 3 (close)",
        "url":      "https://www.kansascityfed.org/research/jackson-hole-economic-symposium/",
        "notes":    "Final papers and panels.",
    },
]

# FOMC decision days, expanded into the same one-off shape.
ONE_OFFS += [
    {
        "date":     d,
        "time":     "19:00",
        "category": "central_bank",
        "title":    "FOMC rate decision" + (" + economic projections (dot plot)" if sep else ""),
        "url":      "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        "notes":    ("Statement 14:00 ET, press conference 14:30 ET; minutes ~3 weeks later."
                     + (" Quarterly SEP/dot plot released with the statement — the bigger dollar event."
                        if sep else "")),
    }
    for d, sep in FOMC_2026
]


def build_events(year: int = 2026) -> list[dict]:
    out: list[dict] = []

    # WASDE
    for date_str, _time_et in WASDE_2026_DATES:
        out.append({
            "date":     date_str,
            "time":     "17:00",  # 12:00 ET → 17:00 UTC (winter; close enough for watchlist)
            "category": "wasde",
            "title":    f"USDA WASDE — {date_str[:7]} report",
            "url":      "https://www.usda.gov/oce/commodity/wasde",
            "notes":    "Monthly world S&D balance; coffee section usually drives end-of-year stocks revisions.",
        })

    # ICO monthly — last business day of each month.
    for m in range(1, 13):
        d = _last_biz_day(year, m)
        out.append({
            "date":     d.isoformat(),
            "category": "ico",
            "title":    f"ICO Coffee Market Report — {d.strftime('%b %Y')}",
            "url":      "https://www.ico.org/show_news.asp",
            "notes":    "Monthly composite indicator + export figures; published end of month.",
        })

    # Cecafé monthly — ~17th of the following month (approximate window).
    for m in range(1, 13):
        # Publishes the prior month's data; e.g. April figures in May ~17.
        pub_month = m + 1
        pub_year  = year
        if pub_month > 12:
            pub_month -= 12
            pub_year  += 1
        d = date(pub_year, pub_month, 17)
        # Skip the December 2026 publication for January 2027 if we're only doing 2026.
        if d.year != year:
            continue
        out.append({
            "date":     d.isoformat(),
            "category": "cecafe",
            "title":    f"Cecafé {date(year, m, 1).strftime('%b %Y')} monthly export figures",
            "url":      "https://www.cecafe.com.br",
            "notes":    "Approximate — published 15-20 of the month following the reference month.",
        })

    # ICE KC FND
    for letter, month in KC_MONTHS.items():
        d = _fnd_kc(year, month)
        out.append({
            "date":     d.isoformat(),
            "category": "fnd",
            "title":    f"KC{letter}{str(year)[-2:]} First Notice Day",
            "notes":    f"KC (Arabica) {date(year, month, 1).strftime('%b %Y')} contract — watch for max-OI roll into the next month in the prior 17 business days.",
        })

    # ICE Robusta FND. The active Robusta contract is the 10-tonne RM
    # series (since the 5-T RC was phased out for active trading); the
    # rest of the brief pipeline reads RMN26 / RMU26 / ... from
    # futures_chain.json and latest_prices.json, so the FND title must
    # match that symbol or the user sees a phantom contract here that
    # appears nowhere else in the morning brief.
    for letter, month in RC_MONTHS.items():
        d = _fnd_rc(year, month)
        out.append({
            "date":     d.isoformat(),
            "category": "fnd",
            "title":    f"RM{letter}{str(year)[-2:]} First Notice Day",
            "notes":    f"RM (Robusta 10-T) {date(year, month, 1).strftime('%b %Y')} contract — watch for max-OI roll into the next month in the prior 26 business days.",
        })

    # Vietnam Customs — monthly statistical bulletin, ~25th of the month.
    for m in range(1, 13):
        d = date(year, m, 25)
        if d.weekday() >= 5:  # nudge to nearest weekday
            d -= timedelta(days=d.weekday() - 4)
        out.append({
            "date":     d.isoformat(),
            "category": "vietnam_customs",
            "title":    f"Vietnam Customs — {d.strftime('%b %Y')} export bulletin (approx)",
            "url":      "https://customs.gov.vn",
            "notes":    "Monthly export figures; published 22-28 of each month. Date is approximate — VN Customs has been irregular in 2025-26.",
        })

    out.extend(ONE_OFFS)

    # Sort by (date, time, title) for stable, readable output.
    out.sort(key=lambda e: (e.get("date", ""), e.get("time", "99:99"), e.get("title", "")))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year",  type=int, default=2026)
    ap.add_argument("--write", action="store_true",
                    help="Overwrite backend/seed/events.json. Default is preview-only.")
    args = ap.parse_args()

    events = build_events(args.year)

    # Preserve the schema block; replace only the events array.
    existing = json.loads(EVENTS_PATH.read_text(encoding="utf-8")) if EVENTS_PATH.exists() else {}
    schema   = existing.get("_schema", {})
    doc = {"_schema": schema, "events": events}

    payload = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    print(f"[build_events_calendar] {len(events)} events for {args.year}")
    if args.write:
        EVENTS_PATH.write_text(payload, encoding="utf-8")
        print(f"[build_events_calendar] wrote {EVENTS_PATH}")
        # Mirror into /public/data so the News tab can fetch it without a
        # separate copier step. Two files, one source of truth.
        EVENTS_PUBLIC_PATH.parent.mkdir(parents=True, exist_ok=True)
        EVENTS_PUBLIC_PATH.write_text(payload, encoding="utf-8")
        print(f"[build_events_calendar] mirrored to {EVENTS_PUBLIC_PATH}")
    else:
        print(payload[:2000] + ("...(truncated)" if len(payload) > 2000 else ""))


if __name__ == "__main__":
    main()
