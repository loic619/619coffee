"""/exports — monthly export volume by origin, on one scale.

Every source publishes in its own unit, so the first job is normalising to
60-kg bags; the second is being explicit that the origins do not report to the
same month, which is why each row carries its own.

    Brazil     cecafe.json          series[].total            bags
    Vietnam    vietnam_supply.json  exports.monthly[].total_k_bags   THOUSAND bags
    Uganda     uganda_supply.json   exports.monthly[].total_bags     bags
    Indonesia  indonesia_exports.json series[].total_coffee_kg       kg

Uganda is the trap: its `exports.unit` string reads "thousand 60-kg bags"
while `total_bags` is plainly bags (744,540 for a country exporting ~7M bags a
year). The field name is authoritative, the unit string is not — trusting the
latter would report Uganda at 744 million bags a month.

YoY is computed here for every origin from its own series, against the same
calendar month a year earlier, rather than taken from the `yoy_pct` some feeds
publish: one definition across the table beats four rows that each mean
something slightly different.
"""
from __future__ import annotations

from telegram.data import load
from telegram.formatting import compare, header, table, title

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
KG_PER_BAG = 60.0


def _month_label(period: str) -> str:
    try:
        yr, mo = period.split("-")
        return f"{_MONTHS[int(mo) - 1]} {yr[2:]}"
    except (ValueError, IndexError):
        return period


def _year_earlier(period: str) -> str:
    yr, mo = period.split("-")
    return f"{int(yr) - 1}-{mo}"


def _fmt_bags(bags: float | None) -> str:
    """Bags at a readable magnitude — origins span 400k to 3M a month."""
    if bags is None:
        return "—"
    if bags >= 1_000_000:
        return f"{bags / 1_000_000:.2f}M"
    return f"{bags / 1_000:,.0f}k"


def _series() -> list[tuple[str, str, dict[str, float]]]:
    """(flag, name, {period: bags}) per origin, skipping any that failed to load."""
    out: list[tuple[str, str, dict[str, float]]] = []

    cecafe = load("cecafe.json") or {}
    br = {r["date"]: r.get("total") for r in cecafe.get("series") or []
          if r.get("date") and r.get("total") is not None}
    if br:
        out.append(("🇧🇷", "BR", br))

    vn_doc = ((load("vietnam_supply.json") or {}).get("exports") or {}).get("monthly") or []
    vn = {r["month"]: r["total_k_bags"] * 1_000 for r in vn_doc
          if r.get("month") and r.get("total_k_bags") is not None}
    if vn:
        out.append(("🇻🇳", "VN", vn))

    id_doc = (load("indonesia_exports.json") or {}).get("series") or []
    idn = {r["month"]: r["total_coffee_kg"] / KG_PER_BAG for r in id_doc
           if r.get("month") and r.get("total_coffee_kg") is not None}
    if idn:
        out.append(("🇮🇩", "ID", idn))

    ug_doc = ((load("uganda_supply.json") or {}).get("exports") or {}).get("monthly") or []
    ug = {r["month"]: r["total_bags"] for r in ug_doc
          if r.get("month") and r.get("total_bags") is not None}
    if ug:
        out.append(("🇺🇬", "UG", ug))

    return out


def handle(args: str, context: dict) -> str:
    origins = _series()
    if not origins:
        return "Export data unavailable."

    rows: list[list] = [["", "bags", "month", "YoY"]]
    for flag, name, series in origins:
        period = max(series)
        cur = series[period]
        rows.append([f"{flag} {name}", _fmt_bags(cur), _month_label(period),
                     compare(cur, series.get(_year_earlier(period)), "", as_pct=True).strip() or "—"])

    return "\n\n".join([
        title("🚢 ORIGIN EXPORTS", "latest month published per origin"),
        header("📦", "monthly volume"),
        table(rows, align="lrrr"),
        # Stated, not implied: the origins publish on different lags, so the
        # rows are not a like-for-like month and should not be summed.
        "Each origin reports to its own latest month — not a common period, so the column does not total.",
    ])
