"""topic_notify.py — topical Telegram texts, sent when their data just landed.

Each composer reads the committed JSON it reports on and is FRESHNESS-GATED:
it returns None (→ nothing sent) unless the underlying data updated within
its gate window. Wiring:

  cot         — after the COT scraper (2.3); fires only on the ingest day
                (Fri evening), silent on the Mon–Thu no-new-report runs.
  freight     — after the freight scraper (1.2, Fri + Sun).
  us_imports  — after the USITC scraper (3.9, monthly).
  eu_imports  — after the Eurostat scraper (3.10, monthly).
  enso        — after the ENSO indices scraper (0.7, weekly Tue).
  origin digests — composed BY THE SENTINEL when a monthly origin release
                passes its ingestion check (compose_origin_digest), so the
                export numbers ride the ✅ message the moment they land.

CLI:  cd backend && python -m scraper.topic_notify <topic>
Env:  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (absent → compose-and-print only)

Stdlib + requests only — safe from any workflow and from the sentinel.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "public" / "data"
CACHE = ROOT / "backend" / "scraper" / "cache"


def _load(path: Path) -> dict | list | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _parse_ts(ts: str | None) -> dt.datetime | None:
    if not ts:
        return None
    try:
        if len(ts) == 10:
            return dt.datetime.strptime(ts, "%Y-%m-%d").replace(tzinfo=dt.UTC)
        d = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=dt.UTC)
    except ValueError:
        return None


def _fresh(ts: str | None, days: float, now: dt.datetime) -> bool:
    d = _parse_ts(ts)
    return d is not None and (now - d).total_seconds() <= days * 86400


def _arrow(cur: float | None, prev: float | None, span: str = "w/w") -> str:
    if cur is None or prev is None or prev == 0:
        return ""
    pct = (cur - prev) / abs(prev) * 100
    if abs(pct) < 0.05:
        return f" (= {span})"
    return f" ({'+' if pct >= 0 else ''}{pct:.1f}% {span})"


def _span_label(updated: str | None, prev_date: str | None) -> str:
    """Say what the comparison actually spans.

    The freight index is only scraped Fri/Sun, so the previous observation is
    not always seven days back. Calling a 12-day move "w/w" overstates the
    weekly pace, so anything outside a 6-8 day window names its real span.
    """
    if not updated or not prev_date:
        return "w/w"
    try:
        days = (dt.date.fromisoformat(updated) - dt.date.fromisoformat(prev_date)).days
    except ValueError:
        return "w/w"
    return "w/w" if 6 <= days <= 8 else f"vs {days}d ago"


def _yoy(cur: float | None, prev: float | None) -> str:
    if cur is None or not prev:
        return ""
    pct = (cur - prev) / abs(prev) * 100
    return f" ({'+' if pct >= 0 else ''}{pct:.1f}% y/y)"


def _fmt(n: float | None, dec: int = 0) -> str:
    return "—" if n is None else f"{n:,.{dec}f}"


# ── Weekly topics ────────────────────────────────────────────────────────────

LETTER_MONTH = {"F":1,"G":2,"H":3,"J":4,"K":5,"M":6,"N":7,"Q":8,"U":9,"V":10,"X":11,"Z":12}
LOT_MT = {"ny": 17.009, "ldn": 10.0}


def _contract_order(sym: str) -> tuple[int, int]:
    m = LETTER_MONTH.get(sym[-3], 99)
    return (2000 + int(sym[-2:]), m)


def _kl(lots: float) -> str:
    return f"{lots/1000:+.1f} k lots"


def _kt(mt: float, signed: bool = False) -> str:
    return f"{mt/1000:+.1f} k tons" if signed else f"{mt/1000:.1f} k tons"


def _cot_market_text(label: str, mk: str, cur: dict, prev: dict,
                     archive_mkt: dict | None, cur_date: str, prev_date: str) -> str | None:
    """One market's Overview narrative — a port of the app's COT Positioning
    Overview (frontend CotDashboard/Overview + lib/pdf/dataHelpers formulas)."""
    c, p = cur.get(mk), prev.get(mk)
    if not c or not p:
        return None
    lot_mt = LOT_MT[mk]
    lines = [label]

    # ── OI change + nearby/forward split (per-contract archive) ──────────────
    oi_chg = (c.get("oi_total") or 0) - (p.get("oi_total") or 0)
    lines.append(f"• Total OI change of {_kl(oi_chg)} since last COT")
    if archive_mkt and cur_date in archive_mkt and prev_date in archive_mkt:
        cur_day, prev_day = archive_mkt[cur_date], archive_mkt[prev_date]
        syms = sorted(cur_day, key=_contract_order)
        nearby = [x for x in syms if x in prev_day][:2]
        if len(nearby) == 2:
            near_chg = sum((cur_day[x].get("oi") or 0) - (prev_day[x].get("oi") or 0) for x in nearby)
            letters = " and ".join(x[-3] for x in nearby)
            lines.append(f"   ◦ {_kl(near_chg)} in nearby contracts ({letters})")
            lines.append(f"   ◦ {_kl(oi_chg - near_chg)} in forward contracts")

    # ── Price + structure — the same fields the app's Overview renders
    # (COT-week joined price + the DB structure value; inversion =
    # −structure/price, this week vs LW). ────────────────────────────────────
    price, prev_price = c.get(f"price_{mk}"), p.get(f"price_{mk}")
    struct, prev_struct = c.get(f"structure_{mk}"), p.get(f"structure_{mk}")
    if price and prev_price:
        chg = price - prev_price
        pct = chg / prev_price * 100
        unit = f"({chg:+.0f} cents/lb)" if mk == "ny" else f"(${chg:+.0f} per ton)"
        line = f"• Price {pct:+.1f}% {unit}"
        if struct is not None:
            inv_now = -struct / price * 100
            state = "inverted" if struct <= 0 else "in carry"
            if prev_struct is not None:
                inv_lw = -prev_struct / prev_price * 100
                toward = "backwardation" if inv_now > inv_lw else "carry"
                line += (f"; structure moving toward {toward}, {state} at "
                         f"{abs(inv_now):.1f}% (vs {abs(inv_lw):.1f}% LW)")
            else:
                line += f"; structure {state} at {abs(inv_now):.1f}%"
        lines.append(line + ".")

    # ── Industry (PMPU): roasters long / producers short, in tons ────────────
    def cov_pct(series: list[float], val: float) -> float:
        lo, hi = min(series), max(series)
        return 0.0 if hi <= lo else max(0.0, min(100.0, (val - lo) / (hi - lo) * 100))

    hist = _COT_HIST.get(mk) or []
    roast, prod = (c.get("pmpu_long") or 0) * lot_mt, (c.get("pmpu_short") or 0) * lot_mt
    d_rl = (c.get("pmpu_long") or 0) - (p.get("pmpu_long") or 0)
    d_ps = (c.get("pmpu_short") or 0) - (p.get("pmpu_short") or 0)
    roast_verb = "Roasters are covering for" if d_rl > 0 else "Roasters holding & fixing for"
    prod_verb = "Producers are selling for" if d_ps > 0 else "Producers holding & exporters are fixing for"
    roast_cov = cov_pct([r * lot_mt for r in hist["pmpu_long"]], roast) if hist else 0.0
    prod_cov = cov_pct([r * lot_mt for r in hist["pmpu_short"]], prod) if hist else 0.0
    lines.append(f"• {roast_verb} {_kl(d_rl)} ({_kt(d_rl*lot_mt, signed=True)}), "
                 f"reaching {_kt(roast)} ({roast_cov:.1f}% maxed).")
    lines.append(f"• {prod_verb} {_kl(d_ps)} ({_kt(d_ps*lot_mt, signed=True)}), "
                 f"reaching {_kt(prod)} ({prod_cov:.1f}% maxed).")

    # ── Managed money ────────────────────────────────────────────────────────
    d_ml = (c.get("mm_long") or 0) - (p.get("mm_long") or 0)
    d_ms = (c.get("mm_short") or 0) - (p.get("mm_short") or 0)
    long_verb = "liquidating" if d_ml < 0 else "adding to" if d_ml > 0 else "holding"
    short_verb = "increasing" if d_ms > 0 else "covering" if d_ms < 0 else "holding"
    ml_pct = d_ml / p["mm_long"] * 100 if p.get("mm_long") else 0.0
    ms_pct = d_ms / p["mm_short"] * 100 if p.get("mm_short") else 0.0
    net = (c.get("mm_long") or 0) - (c.get("mm_short") or 0)
    net_word = "Net long" if net >= 0 else "Net short"
    lines.append(f"• MM {long_verb} longs ({_kl(d_ml)} / {ml_pct:+.1f}% of their position) "
                 f"and {short_verb} shorts ({_kl(d_ms)} / {ms_pct:+.1f}% of their position). "
                 f"{net_word} of {abs(net)/1000:.1f} k lots.")
    return "\n".join(lines)


_COT_HIST: dict = {}


def compose_cot(now: dt.datetime) -> str | None:
    """Full COT Positioning Overview narrative for NY + LDN — the app's
    Overview panel, ported. Gate: newest report date within 4 days (Friday-
    evening ingest of a Tuesday-dated report)."""
    rows = _load(DATA / "cot.json")
    if not isinstance(rows, list) or len(rows) < 2:
        return None
    cur, prev = rows[-1], rows[-2]
    if not _fresh(cur.get("date"), 4, now):
        return None

    # Coverage normalisation history (app uses ~10y; use everything we have).
    global _COT_HIST
    _COT_HIST = {
        mk: {
            "pmpu_long": [(r.get(mk) or {}).get("pmpu_long") or 0 for r in rows[-520:]],
            "pmpu_short": [(r.get(mk) or {}).get("pmpu_short") or 0 for r in rows[-520:]],
        }
        for mk in ("ny", "ldn")
    }

    archive = _load(ROOT / "data" / "contract_prices_archive.json") or {}
    parts = [
        _cot_market_text("Arabica · NY Overview", "ny", cur, prev,
                         archive.get("arabica"), cur["date"], prev["date"]),
        _cot_market_text("Robusta · LDN Overview", "ldn", cur, prev,
                         archive.get("robusta"), cur["date"], prev["date"]),
    ]
    parts = [x for x in parts if x]
    if not parts:
        return None
    return f"📊 COT — report dated {cur['date']}:\n\n" + "\n\n".join(parts)


def compose_freight(now: dt.datetime) -> str | None:
    """Route rates with w/w movement. Gate: freight.json updated ≤1 day ago."""
    d = _load(DATA / "freight.json")
    if not isinstance(d, dict) or not _fresh(d.get("updated"), 1.5, now):
        return None
    lines = []
    for r in d.get("routes") or []:
        if r.get("rate") is None:
            continue
        span = _span_label(d.get("updated"), r.get("prev_date"))
        lines.append(f"• {r.get('from','?')}→{r.get('to','?')}: "
                     f"{_fmt(r['rate'])} {r.get('unit','')}"
                     f"{_arrow(r.get('rate'), r.get('prev'), span)}")
    if not lines:
        return None
    return f"🚢 Freight rates ({d.get('updated')}):\n" + "\n".join(lines)


# Origin list length: keep adding suppliers largest-first until they explain
# this share of the year-to-date total, so the breakdown covers most of the
# headline number instead of stopping at an arbitrary top-3.
ORIGIN_COVERAGE = 0.80
# Hard stop regardless (a fragmented market must not blow the 4096-char
# Telegram limit); a run that ends here reports how much it managed to cover.
ORIGIN_MAX_LINES = 12


def _ytd(monthly: dict[str, float], year: str, through_mm: str) -> float | None:
    """Sum of `year`'s months up to and including `through_mm` (e.g. '06').

    through_mm="12" gives the accumulated-monthly FULL year — the only annual
    figure this module will quote. It matches the sources' own published
    annual totals to the tonne, so the monthly series is the single base for
    every number here.
    """
    vals = [v for k, v in monthly.items()
            if k[:4] == year and k[5:7] <= through_mm and isinstance(v, (int, float))]
    return sum(vals) if vals else None


def _monthly_origins(d: dict) -> dict[str, dict]:
    """{origin: {'YYYY-MM': tonnes}} — from whichever shape the source uses.

    USITC ships a flat top-level `monthly_origins`. Eurostat nests the same
    thing per reporter (`reporters.EU27_2020.origins[].monthly`), which is why
    a top-level lookup found nothing and the message fell back to annual
    origins. Prefer the reporter whose monthly_total IS the file's headline
    series — that is the bloc the totals are quoted for, so its origin split
    divides the number shown above it.
    """
    flat = {n: s for n, s in (d.get("monthly_origins") or {}).items() if isinstance(s, dict)}
    if flat:
        return flat

    reporters = {c: r for c, r in (d.get("reporters") or {}).items() if isinstance(r, dict)}
    top = d.get("monthly_total") or {}
    bloc = next((r for r in reporters.values() if top and r.get("monthly_total") == top), None)
    if bloc is None:
        # No exact match (older file, or totals rebuilt) — take whichever
        # reporter carries the most monthly-bearing origins.
        bloc = max(reporters.values(), default=None,
                   key=lambda r: sum(1 for o in (r.get("origins") or []) if o.get("monthly")))
    if not bloc:
        return {}
    return {o["name"]: o["monthly"] for o in (bloc.get("origins") or [])
            if o.get("name") and isinstance(o.get("monthly"), dict)}


def _imports_text(path: Path, flag: str, dest: str, now: dt.datetime) -> str | None:
    """Latest reported MONTH first, then year-to-date on a like-for-like basis.

    This used to headline `total_by_year`, which holds only COMPLETE calendar
    years — the annual query asks for fullYears and skips the year in progress
    — so in August 2026 the message still announced 2025 while monthly data
    ran to June 2026. Leading with the month is both current and the right
    granularity for a series that publishes monthly.

    The year-to-date comparison is deliberately same-months-last-year, never
    partial-vs-full: 6 months of 2026 against all of 2025 would read as a
    collapse in demand that never happened.
    """
    d = _load(path)
    if not isinstance(d, dict) or not _fresh(d.get("updated"), 2, now):
        return None
    monthly = {k: v for k, v in (d.get("monthly_total") or {}).items()
               if isinstance(v, (int, float))}
    if not monthly:
        return None
    last = max(monthly)
    year, mm = last[:4], last[5:7]
    prev_year = f"{int(year) - 1:04d}"

    lines = [f"{flag} {dest} coffee imports — {last}: {_fmt(monthly[last] / 1000, 1)}k t"
             f"{_yoy(monthly[last], monthly.get(f'{prev_year}-{mm}'))}"]

    ytd, ytd_prev = _ytd(monthly, year, mm), _ytd(monthly, prev_year, mm)
    if ytd is None:
        return "\n".join(lines)
    ytd_line = f"• YTD {_fmt(ytd / 1000, 1)}k t"
    if ytd_prev is not None:
        ytd_line += f" ({_pct(ytd, ytd_prev)})"

    # Origins: the biggest contributors to that YTD, each carrying its OWN
    # y/y over the same window — so the line says whether a supplier is
    # growing or shrinking, not merely how big it is. Nothing here reads
    # total_by_year or origins[].by_year: those hold complete calendar years
    # only, which is what made the message announce 2025 in August 2026. Any
    # annual figure we ever want is the accumulated monthly one
    # (_ytd(monthly, year, "12")), which reconciles to the published annual
    # totals exactly.
    all_origins = [(n, v, s) for n, v, s in
                   sorted(((n, _ytd(s, year, mm) or 0, s) for n, s in _monthly_origins(d).items()),
                          key=lambda t: -t[1]) if n and v > 0]
    if not all_origins:
        lines.append(ytd_line)
        return "\n".join(lines)

    # Take origins largest-first until they account for ORIGIN_COVERAGE of the
    # YTD, so the list explains most of the number above it rather than showing
    # an arbitrary top-3. ORIGIN_MAX_LINES bounds a pathologically fragmented
    # market (Telegram rejects a message over 4096 chars, and this sender does
    # not split); if that cap binds first, the shortfall is stated rather than
    # silently truncated.
    picked, covered = [], 0.0
    for row in all_origins:
        picked.append(row)
        covered += row[1]
        if covered / ytd >= ORIGIN_COVERAGE or len(picked) >= ORIGIN_MAX_LINES:
            break

    lines.append(ytd_line + ", of which")
    for name, cur, series in picked:
        prev = _ytd(series, prev_year, mm)
        # No prior-year window for this origin (a newly-reporting supplier) →
        # state the tonnage without inventing a comparison, exactly as the
        # YTD line above does.
        chg = f" ({_pct(cur, prev)})" if prev else ""
        lines.append(f"• {name} {_fmt(cur / 1000, 1)}k t{chg}")
    if covered / ytd < ORIGIN_COVERAGE and len(all_origins) > len(picked):
        lines.append(f"• …{len(all_origins) - len(picked)} smaller origins "
                     f"({covered / ytd * 100:.0f}% shown)")
    return "\n".join(lines)


def compose_us_imports(now: dt.datetime) -> str | None:
    return _imports_text(DATA / "us_coffee_imports.json", "🇺🇸", "US", now)


def compose_eu_imports(now: dt.datetime) -> str | None:
    return _imports_text(DATA / "eu_coffee_imports.json", "🇪🇺", "EU", now)


def compose_enso(now: dt.datetime) -> str | None:
    """Weekly Niño-3.4 anomaly + phase, plus WWV when available."""
    d = _load(DATA / "enso_indices.json")
    if not isinstance(d, dict) or not _fresh(d.get("scraped_at"), 2, now):
        return None
    latest = (d.get("nino34") or {}).get("latest") or {}
    if latest.get("sst_anomaly") is None:
        return None
    phase = (latest.get("phase") or "?").replace("-", " ")
    txt = (f"🌊 ENSO weekly — Niño 3.4 anomaly {latest['sst_anomaly']:+.1f}°C "
           f"({phase}), week ending {latest.get('week_ending','?')}")
    sub = _load(DATA / "enso_subsurface.json") or {}
    wwv_latest = ((sub.get("wwv") or {}).get("latest") or {})
    if isinstance(wwv_latest, dict) and wwv_latest.get("value") is not None:
        txt += f"\n• warm-water volume {wwv_latest['value']:+.2f}×10¹⁴ m³ ({wwv_latest.get('month','?')})"
    return txt


# ── Origin export digests (invoked by the sentinel on verified ingestion) ────

# Crop-year start month per origin (Brazil Jul; Colombia/Uganda/Vietnam Oct).
CY_START = {"cecafe": 7, "ucda": 10, "dane": 10, "fnc": 10, "vn_customs": 10}
# PSD producer key in demand_stocks.json + display-unit conversion from MT.
PSD_KEY = {"cecafe": "brazil", "ucda": "uganda", "dane": "colombia", "fnc": "colombia",
           "vn_customs": "vietnam"}
BAGS_PER_MT = 1 / 0.06  # 60-kg bags


def _cy_months(month: str, start_month: int) -> list[str]:
    """All crop-year months from the crop-year start through `month`."""
    y, m = int(month[:4]), int(month[5:7])
    cy = y if m >= start_month else y - 1
    out, yy, mm = [], cy, start_month
    while (yy, mm) <= (y, m):
        out.append(f"{yy:04d}-{mm:02d}")
        mm += 1
        if mm > 12:
            mm, yy = 1, yy + 1
    return out

def _ctd(values: dict[str, float], month: str, start_month: int) -> tuple[float | None, float | None]:
    """(crop-to-date sum, same-window sum one crop year earlier)."""
    months = _cy_months(month, start_month)
    prev_months = [_year_back(m2) for m2 in months]
    def _sum(ms):
        got = [values[m2] for m2 in ms if values.get(m2) is not None]
        return sum(got) if got else None
    return _sum(months), _sum(prev_months)


def _pct(cur: float | None, prev: float | None) -> str:
    if cur is None or not prev:
        return "n/a"
    return f"{(cur - prev) / abs(prev) * 100:+.1f}%"


def _sd_lines(key: str, month: str, exports_ctd_mt: float | None,
              unit_label: str, mt_to_unit: float) -> list[str]:
    """Internal-consumption crop-to-date + remaining-to-export estimates from
    the USDA PSD producer block (pro-rated annual consumption; production −
    consumption − exports so far). Marked ≈ — PSD figures are estimates."""
    psd = ((_load(DATA / "demand_stocks.json") or {}).get("producers") or {}).get(PSD_KEY[key])
    if not psd:
        return []
    y, m = int(month[:4]), int(month[5:7])
    start = CY_START[key]
    cy = y if m >= start else y - 1
    row = next((r for r in psd.get("annual") or [] if r.get("year") == str(cy)), None)
    if not row:
        return []
    prod_mt, cons_mt = row.get("production_mt"), row.get("consumption_mt")
    if not prod_mt or not cons_mt:
        return []
    elapsed = len(_cy_months(month, start))
    cons_ctd_mt = cons_mt * elapsed / 12
    lines = [f"Internal consumption crop-to-date: ≈{cons_ctd_mt*mt_to_unit/1e6:.1f}M {unit_label}"]
    if exports_ctd_mt is not None:
        remaining_mt = max(0.0, prod_mt - cons_ctd_mt - exports_ctd_mt)
        lines.append(f"Remaining of the crop to be exported: ≈{remaining_mt*mt_to_unit/1e6:.1f}M {unit_label}")
    return lines


_MONTH_RE = re.compile(r"\d{4}-\d{2}")


def compose_origin_digest(sentinel_key: str, month: str | None) -> str | None:
    """Origin export digest for the month the sentinel just verified:
    total (+y/y and crop-to-date pace), per-type split, then PSD-based
    internal consumption and remaining-exportable estimates."""
    try:
        if sentinel_key == "cecafe":
            d = _load(DATA / "cecafe.json") or {}
            rows = {r.get("date"): r for r in d.get("series") or []}
            r, p = rows.get(month), rows.get(_year_back(month))
            if not r:
                return None
            totals = {k: (v or {}).get("total") for k, v in rows.items()}
            ctd, ctd_prev = _ctd(totals, month, CY_START["cecafe"])
            head = [
                f"🇧🇷 Brazil (Cecafé) {month}:",
                f"Total {_fmt(r.get('total'))} bags ({_pct(r.get('total'), (p or {}).get('total'))} y/y"
                f" / {_pct(ctd, ctd_prev)} ctd)",
                f"Arabica {_fmt(r.get('arabica'))}",
                f"Conillon {_fmt(r.get('conillon'))}",
            ]
            sd = _sd_lines("cecafe", month, (ctd or 0) * 0.06 if ctd else None, "bags", BAGS_PER_MT)
            return "\n".join(head + ([""] + sd if sd else []))

        if sentinel_key == "ucda":
            d = _load(DATA / "uganda_monthly.json") or {}
            rows = {r.get("month"): r for r in d.get("series") or []}
            r, p = rows.get(month), rows.get(_year_back(month))
            if not r:
                return None
            totals = {k: (v or {}).get("total_bags") for k, v in rows.items()}
            ctd, ctd_prev = _ctd(totals, month, CY_START["ucda"])
            head = [
                f"🇺🇬 Uganda (UCDA) {month}:",
                f"Total {_fmt(r.get('total_bags'))} bags ({_pct(r.get('total_bags'), (p or {}).get('total_bags'))} y/y"
                f" / {_pct(ctd, ctd_prev)} ctd)",
                f"Robusta {_fmt(r.get('robusta_bags'))}",
                f"Arabica {_fmt(r.get('arabica_bags'))}",
            ]
            sd = _sd_lines("ucda", month, (ctd or 0) * 0.06 if ctd else None, "bags", BAGS_PER_MT)
            return "\n".join(head + ([""] + sd if sd else []))

        if sentinel_key in ("dane", "fnc"):
            d = _load(DATA / "colombia_supply.json") or {}
            rows = {r.get("month"): r for r in (d.get("exports") or {}).get("monthly") or []}
            r, p = rows.get(month), rows.get(_year_back(month))
            if not r:
                return None
            totals = {k: (v or {}).get("total_t") for k, v in rows.items()}
            ctd, ctd_prev = _ctd(totals, month, CY_START["dane"])
            head = [
                f"🇨🇴 Colombia {month}:",
                f"Total {_fmt(r.get('total_k_bags'))}k bags / {_fmt(r.get('total_t'))} t "
                f"({_pct(r.get('total_t'), (p or {}).get('total_t'))} y/y / {_pct(ctd, ctd_prev)} ctd)",
            ]
            sd = _sd_lines("dane", month, ctd, "bags", BAGS_PER_MT)
            return "\n".join(head + ([""] + sd if sd else []))

        if sentinel_key == "vn_customs":
            d = _load(CACHE / "vn_coffee_export.json") or {}
            rows = {r.get("month"): r for r in d.get("monthly") or []}
            r = rows.get(month)
            if not r:
                return None
            p = rows.get(_year_back(month))
            totals = {k: (v or {}).get("tonnes") for k, v in rows.items()}
            ctd, ctd_prev = _ctd(totals, month, CY_START["vn_customs"])
            head = [
                f"🇻🇳 Vietnam {month}:",
                f"Total {_fmt(r.get('tonnes'))} t ({_pct(r.get('tonnes'), (p or {}).get('tonnes'))} y/y"
                f" / {_pct(ctd, ctd_prev)} ctd)",
                f"Calendar YTD {_fmt(r.get('ytd_cum_qty_tonnes'))} t",
            ]
            sd = _sd_lines("vn_customs", month, ctd, "t", 1.0)
            return "\n".join(head + ([""] + sd if sd else []))

        if sentinel_key == "vn_customs_dest":
            d = _load(DATA / "vn_export_by_destination.json") or {}
            month_vals = sorted(
                ((c, v.get(month)) for c, v in (d.get("countries") or {}).items() if v.get(month)),
                key=lambda t: -t[1],
            )[:5]
            if not month_vals:
                return None
            tops = ", ".join(f"{c} {_fmt(v)}t" for c, v in month_vals)
            return f"🇻🇳 Vietnam destinations {month}: top — {tops}"

        if sentinel_key == "ecf":
            # Destination stocks, not origin exports — a per-month table
            # (arabica / robusta / total), the verified month first plus two
            # prior months for the trend.
            d = _load(DATA / "ecf_history.json") or {}
            rows = {r.get("period"): r for r in d.get("monthly") or []}
            # ECF releases are identified by their source PDF, not a month, so
            # the sentinel has no month to hand us — report the newest one the
            # data now holds. A caller that DOES name a month still gets the
            # strict lookup (a missing one means the release didn't land).
            if not month or not _MONTH_RE.fullmatch(month):
                month = max(rows) if rows else ""
            r = rows.get(month)
            if not r or r.get("value_mt") is None:
                return None
            mm = (rows.get(_month_back(month)) or {}).get("value_mt")
            yy = (rows.get(_year_back(month)) or {}).get("value_mt")

            def _kt_cell(v: float | None) -> str:
                return "—" if v is None else f"{v/1000:.1f}k t"

            lines = [
                f"🇪🇺 European port stocks (ECF) {month} "
                f"({_pct(r['value_mt'], mm)} m/m / {_pct(r['value_mt'], yy)} y/y):",
                "Arabica / Robusta / Total",
            ]
            m2 = month
            for _ in range(3):
                row = rows.get(m2)
                if row and row.get("value_mt") is not None:
                    w, u = row.get("arabica_washed_mt"), row.get("arabica_unwashed_mt")
                    arabica = (w or 0) + (u or 0) if (w is not None or u is not None) else None
                    lines.append(f"{m2}: {_kt_cell(arabica)} / {_kt_cell(row.get('robusta_mt'))}"
                                 f" / {_kt_cell(row['value_mt'])}")
                m2 = _month_back(m2)
            return "\n".join(lines)
    except Exception:  # noqa: BLE001 — a digest must never break the sentinel
        return None
    return None


def _year_back(month: str) -> str:
    return f"{int(month[:4]) - 1}-{month[5:7]}"


def _month_back(month: str) -> str:
    y, m = int(month[:4]), int(month[5:7])
    return f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"


# ── Dedup keys for sentinel-driven topics ────────────────────────────────────
# cot.json / freight.json are produced by the export pipeline (not the scraper
# workflows), so their notifications ride the daily sentinel run instead —
# these keys let it send exactly once per new report/update.

def latest_cot_key() -> str | None:
    rows = _load(DATA / "cot.json")
    return rows[-1].get("date") if isinstance(rows, list) and rows else None


def latest_freight_key() -> str | None:
    """Identity of the freight report: the RATES, not the file's `updated`
    stamp.

    The scraper runs Friday and Sunday and re-stamps `updated` on both, even
    when nothing moved. On 2026-08-21 it advanced 08-16 → 08-21 with every
    rate byte-identical, so a timestamp key sent a second message for the same
    week's numbers; Sunday then genuinely moved them and sent again. Keying on
    the rates gives one message per actual change — which is once a week in a
    normal week, and correctly twice if the index really does move twice.
    """
    d = _load(DATA / "freight.json")
    if not isinstance(d, dict):
        return None
    routes = d.get("routes") or []
    if not routes:
        return d.get("updated")          # nothing to hash — fall back
    payload = ";".join(f"{r.get('from')}>{r.get('to')}={r.get('rate')}"
                       for r in routes)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


# ── Send + CLI ───────────────────────────────────────────────────────────────

TOPICS = {
    "cot": compose_cot,
    "freight": compose_freight,
    "us_imports": compose_us_imports,
    "eu_imports": compose_eu_imports,
    "enso": compose_enso,
}


def send(text: str) -> None:
    import os
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        print("[topic_notify] telegram not configured — printing only")
        return
    try:
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      data={"chat_id": chat, "text": text}, timeout=20)
    except requests.RequestException as e:  # best-effort by design
        print(f"[topic_notify] send failed: {e}")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in TOPICS:
        print(f"usage: python -m scraper.topic_notify <{'|'.join(TOPICS)}>")
        return 2
    topic = sys.argv[1]
    text = TOPICS[topic](dt.datetime.now(dt.UTC))
    if text is None:
        print(f"[topic_notify] {topic}: data not fresh (or absent) — nothing to send")
        return 0
    print(text)
    send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
