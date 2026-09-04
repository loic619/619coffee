"""/kaffeesteuer — German coffee clearances (Kaffeesteuer), monthly and MAT.

Clearances are lumpy month to month: a single month's YoY swings on how many
working days and how much pre-buying fell in the period, so a plain monthly
comparison can read as a demand story when it is a calendar one. The moving
annual total (last 12 months vs the 12 before) is the version that carries a
trend, and it is what the closing signal line is drawn from. Both are shown —
the monthly figure is what the message published before.
"""
from __future__ import annotations

from telegram.data import load
from telegram.formatting import compare, header, num, table, title

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_WINDOW = 3     # months shown in the trend block
_MAT = 12


def _month_label(period: str) -> str:
    try:
        yr, mo = period.split("-")
        return f"{_MONTHS[int(mo) - 1]} {yr[2:]}"
    except (ValueError, IndexError):
        return period


def _months_back(period: str, n: int) -> str:
    """'2026-07' shifted back n calendar months."""
    yr, mo = map(int, period.split("-"))
    total = yr * 12 + (mo - 1) - n
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _mat(data: dict, end_period: str) -> float | None:
    """Moving annual total for the twelve calendar months ending at
    `end_period` (inclusive).

    Calendar-addressed, not index-addressed: the published series has a hole
    at 2018-02, so counting twelve list entries backwards would quietly span
    thirteen calendar months and compare unlike windows. Returns None when any
    month in the span is absent — a partial sum understates the total and
    would read as a demand collapse.
    """
    periods = [_months_back(end_period, i) for i in range(_MAT)]
    values = [data.get(p) for p in periods]
    if any(v is None for v in values):
        return None
    return sum(values)


def handle(args: str, context: dict) -> str:
    data = load("kaffeesteuer.json")
    if not data:
        return "Kaffeesteuer data unavailable. Run /run kaffeesteuer"

    series = sorted(data.items())
    if not series:
        return "Kaffeesteuer data empty."

    latest_period, latest_val = series[-1]

    def yoy_of(period: str, value: float) -> float | None:
        yr, mo = period.split("-")
        return data.get(f"{int(yr) - 1}-{mo}") if value is not None else None

    rows: list[list] = [["", "bags", "YoY"]]
    for period, value in series[-_WINDOW:]:
        rows.append([_month_label(period), num(value),
                     compare(value, yoy_of(period, value), "", as_pct=True).strip() or "—"])

    # MAT: the last twelve months against the twelve before them.
    mat_now  = _mat(data, latest_period)
    mat_prev = _mat(data, _months_back(latest_period, _MAT))

    head = f"<b>{num(latest_val)} bags</b>"
    mom_yoy = compare(latest_val, yoy_of(latest_period, latest_val), "YoY", as_pct=True)

    # Every row must be appended BEFORE the table is rendered — table() takes a
    # snapshot, so mutating `rows` afterwards silently drops the addition.
    signal = None
    if mat_now is not None and mat_prev:
        rows += [[""], ["MAT 12m", num(mat_now),
                        compare(mat_now, mat_prev, "", as_pct=True).strip()]]
        pct = (mat_now - mat_prev) / abs(mat_prev) * 100
        # Threshold, not sign: a MAT moving under half a percent over a year is
        # flat, and calling that a trend either way would be false precision.
        if pct <= -0.5:
            signal = "demand softer YoY on the annual total"
        elif pct >= 0.5:
            signal = "demand firmer YoY on the annual total"
        else:
            signal = "demand flat YoY on the annual total"

    parts = [
        title("🇩🇪 GERMANY · COFFEE CLEARANCES", f"latest {_month_label(latest_period)}"),
        f"{head}  {mom_yoy}".strip(),
        header("📉", "trend"),
        table(rows, align="lrr"),
    ]
    if signal:
        parts.append(f"Signal: {signal}")

    return "\n\n".join(parts)
