"""/imports — green coffee arriving in the two consuming blocs.

    US   us_coffee_imports.json   USITC DataWeb, HTS 0901, imports for consumption
    EU   eu_coffee_imports.json   Eurostat Comext ds-045409, HS 0901, extra-EU

Both publish `monthly_total` as {period: metric tonnes}, so unlike /exports no
unit reconciliation is needed — but both also lag by roughly two months, and
they lag by *different* amounts, so each row carries its own period.

MT is kept as the unit rather than converted to bags: these are customs
tonnage series, and the trade quotes consumer-side arrivals in tonnes.
"""
from __future__ import annotations

from telegram.data import load
from telegram.formatting import compare, header, num, table, title

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_TREND = 3

_BLOCS = [
    ("🇺🇸", "US", "us_coffee_imports.json"),
    ("🇪🇺", "EU", "eu_coffee_imports.json"),
]


def _month_label(period: str) -> str:
    try:
        yr, mo = period.split("-")
        return f"{_MONTHS[int(mo) - 1]} {yr[2:]}"
    except (ValueError, IndexError):
        return period


def _year_earlier(period: str) -> str:
    yr, mo = period.split("-")
    return f"{int(yr) - 1}-{mo}"


def handle(args: str, context: dict) -> str:
    blocs: list[tuple[str, str, dict[str, float]]] = []
    for flag, name, filename in _BLOCS:
        doc = load(filename) or {}
        monthly = doc.get("monthly_total") or {}
        series = {p: v for p, v in monthly.items() if v is not None}
        if series:
            blocs.append((flag, name, series))

    if not blocs:
        return "Import data unavailable."

    latest: list[list] = [["", "MT", "month", "YoY"]]
    for flag, name, series in blocs:
        period = max(series)
        cur = series[period]
        latest.append([f"{flag} {name}", num(cur), _month_label(period),
                       compare(cur, series.get(_year_earlier(period)), "",
                               as_pct=True).strip() or "—"])

    parts = [
        title("📥 CONSUMER IMPORTS", "green coffee arrivals, customs data"),
        header("📦", "latest month"),
        table(latest, align="lrrr"),
    ]

    # A short trend per bloc: one month of customs data moves on shipping
    # schedules as much as on demand, so the direction only reads over several.
    for flag, name, series in blocs:
        periods = sorted(series)[-_TREND:]
        if len(periods) < 2:
            continue
        rows: list[list] = []
        for i, p in enumerate(periods):
            prev = periods[i - 1] if i > 0 else None
            rows.append([_month_label(p), num(series[p]),
                         compare(series[p], series.get(prev) if prev else None, "",
                                 as_pct=True).strip()])
        parts += [header(flag, f"{name} trend"), table(rows, align="lrr")]

    parts.append("US and EU publish on different lags — the rows are not a common month.")
    return "\n\n".join(parts)
