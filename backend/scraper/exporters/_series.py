"""
_series.py — shared helpers for exporters that align a local price series
against a futures series: as-of lookups and local-unit → USD/MT conversion.

tender_parity.py carries a near-identical private copy of `_to_usd_mt`,
`_ffill_map` and `_asof`. It is deliberately NOT migrated here: it has no test
coverage, and rewiring a working exporter as a side effect of an unrelated
feature is how working exporters break. Migrate it when it gets tests — the
signatures below are the same, so it is a straight import swap.

The one difference is `per_quintal_100lb` (Guatemala, ANACAFE), which
tender_parity has no origin for and so never implemented.
"""
from __future__ import annotations

import json
from bisect import bisect_right
from pathlib import Path

LB_PER_MT = 2204.62
# A Guatemalan quintal is 100 lb, NOT the 46 kg quintal used in parts of the
# Andes. ANACAFE quotes oro (green) per 100 lb; getting this wrong scales the
# whole series by 2.2 and would make Guatemala look like a runaway leader.
QUINTAL_LB = 100.0


def load_json(out_dir: Path, name: str) -> dict:
    try:
        return json.loads((out_dir / name).read_text(encoding="utf-8"))
    except Exception:                                        # noqa: BLE001
        return {}


def ffill_map(pairs: list[tuple[str, float]]) -> tuple[list[str], dict[str, float]]:
    """(sorted_dates, {date: value}) for as-of-or-before lookups."""
    d = {k: v for k, v in pairs if v is not None}
    return sorted(d), d


def asof(dates: list[str], by_date: dict[str, float], on: str) -> float | None:
    """Value on `on`, else the most recent value strictly before it.

    Local quotes are sparse — Guatemala and Uganda publish weekly, Brazil skips
    holidays — so an exact-date join would drop most of the grid. Carrying the
    last print forward is what a trader reads off the screen anyway.
    """
    if on in by_date:
        return by_date[on]
    i = bisect_right(dates, on)
    return by_date[dates[i - 1]] if i else None


def to_usd_mt(price: float | None, fx: float | None, unit: str) -> float | None:
    """Local quote → USD per tonne. `fx` is local currency per USD."""
    if price is None or price <= 0:
        return None
    if unit == "cents_lb":                    # already USD-denominated
        return price / 100.0 * LB_PER_MT
    if fx is None or fx <= 0:
        return None
    if unit == "per_kg":
        return price / fx * 1000.0
    if unit == "per_saca_60kg":
        return price / fx / 60.0 * 1000.0
    if unit == "per_quintal_100lb":
        return price / fx / QUINTAL_LB * LB_PER_MT
    return None
