"""Number rendering, and the rule that every comparison names its period."""
from __future__ import annotations

from telegram.formatting.indicators import arrow

# Every delta carries one of these, so the reader is never left inferring
# what a number is measured against.
PERIODS = ("d/d", "WoW", "MoM", "YoY", "MTD", "MAT YoY")


def num(value: float | None, dp: int = 0, dash: str = "—") -> str:
    """Thousands-separated, fixed dp. `dash` for missing — never '0'."""
    if value is None:
        return dash
    return f"{value:,.{dp}f}"


def signed(value: float | None, dp: int = 0, dash: str = "—") -> str:
    """Always carries its sign: +42, -2.15."""
    if value is None:
        return dash
    return f"{value:+,.{dp}f}"


def pct(value: float | None, dp: int = 1, dash: str = "—") -> str:
    if value is None:
        return dash
    return f"{value:+.{dp}f}%"


def delta(cur: float | None, prev: float | None, dp: int = 0,
          as_pct: bool = False, pct_dp: int = 1) -> str:
    """'▲+42' or '▲+3.2%'. Empty string when there is nothing to compare, so a
    caller can append it unconditionally.

    `dp` is the precision of the ABSOLUTE delta and `pct_dp` that of the
    percentage; they are separate because a price carried to 0 dp still wants
    its percentage to one. Percentages divide by abs(prev): producer cohorts
    run net short, and dividing by a negative base would invert the sign of
    every move.
    """
    if cur is None or prev is None:
        return ""
    if as_pct:
        if not prev:
            return ""
        return f"{arrow(cur, prev)}{pct((cur - prev) / abs(prev) * 100, pct_dp)}"
    return f"{arrow(cur, prev)}{signed(cur - prev, dp)}"


def compare(cur: float | None, prev: float | None, period: str,
            dp: int = 0, as_pct: bool = False, pct_dp: int = 1) -> str:
    """A delta with its period attached: '▲42 d/d', '▼3.2% MoM'.

    Unlabelled deltas are the single easiest way to mislead in a market
    message — the same '▲42' means very different things d/d and MoM.
    """
    d = delta(cur, prev, dp, as_pct, pct_dp)
    return f"{d} {period}" if d else ""
