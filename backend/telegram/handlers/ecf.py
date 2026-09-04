"""/ecf — European port stocks, as a short trend rather than four loose numbers.

Four isolated monthly levels make the reader compute the direction; the
message states it. The closing line is the move across the whole window,
which is usually the thing worth knowing.
"""
from __future__ import annotations

from telegram.data import load
from telegram.formatting import compare, header, num, table, title

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_WINDOW = 4


def _month_label(period: str) -> str:
    try:
        yr, mo = period.split("-")
        return f"{_MONTHS[int(mo) - 1]} {yr[2:]}"
    except (ValueError, IndexError):
        return period


def handle(args: str, context: dict) -> str:
    # ECF port stocks live in their own file. They used to sit under
    # demand_stocks.json → "ecf"; that key is gone (demand_stocks now carries
    # eu/japan/usa/ajca/… only), so this command answered "ECF data empty."
    # on every call. ecf_history.json carries the same {period, value_mt}
    # monthly shape this formatter already expects, plus deeper history.
    data = load("ecf_history.json")
    if not data:
        return "ECF data unavailable. Run /run ecf"

    monthly = data.get("monthly") or []
    if not monthly:
        return "ECF data empty."

    window = monthly[-_WINDOW:]
    latest = window[-1]
    prev   = window[-2] if len(window) > 1 else None

    rows: list[list] = []
    for i, m in enumerate(window):
        p = window[i - 1] if i > 0 else None
        rows.append([_month_label(m["period"]), num(m.get("value_mt")),
                     compare(m.get("value_mt"), (p or {}).get("value_mt"), "",
                             as_pct=True).strip()])

    head = f"<b>{num(latest.get('value_mt'))} MT</b>"
    mom = compare(latest.get("value_mt"), (prev or {}).get("value_mt"), "MoM", as_pct=True)

    parts = [
        title("🇪🇺 ECF EUROPEAN PORT STOCKS",
              f"latest {_month_label(latest['period'])} · reported {data.get('last_updated', '?')}"),
        f"{head}  {mom}".strip(),
        header("📉", "trend"),
        table(rows, align="lrr"),
    ]

    # The window move: four monthly steps in the same direction is a different
    # story from four that cancel out, and neither reads off the rows alone.
    first = window[0].get("value_mt")
    if first and len(window) > 1:
        span = f"{_month_label(window[0]['period'])} → {_month_label(latest['period'])}"
        parts.append(f"{span}: {compare(latest.get('value_mt'), first, '', as_pct=True).strip()}")
    return "\n\n".join(parts)
