"""
cot_schema — single source of truth for the CotWeekly serialization shape.

The cot_weekly table is denormalized: each row carries ~50 position fields
spanning category × side × crop-split, plus trader counts and per-market
extras. Two callers (routes/cot.py and scraper/export_static_json.py) used
to copy-paste near-identical dict builders that diverged subtly. This module
generates the dict programmatically so adding a new field is a one-line
change in one place — and the unit test locks the wire format.

Key design points:
  * Output dict KEY ORDER must remain stable. Downstream consumers compare
    JSON output across runs; reordering would produce noisy diffs.
  * The API endpoint (/api/cot) drops the old/other crop-split fields; the
    static export (cot.json) keeps them. Toggle via include_crop_split.
"""
from __future__ import annotations

from typing import Any

# Position categories and their sides. pmpu and nr do not have a "spread"
# column — only swap / mm / other do.
_CATEGORIES_WITH_SPREAD: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("pmpu",  ("long", "short")),
    ("swap",  ("long", "short", "spread")),
    ("mm",    ("long", "short", "spread")),
    ("other", ("long", "short", "spread")),
    ("nr",    ("long", "short")),
)

# Per-market data points joined onto the weekly row from the COT Excel
# "Other" sheet. Same names for ny/ldn variants.
#
# `price_contract` (added 2026-05) is the futures contract symbol whose
# lastPrice was recorded into `price_{ny,ldn}` for that Tuesday — the
# Industry Pulse chart uses week-to-week contract changes to render
# switch markers (PR following the max-OI rule change).
_MARKET_EXTRAS: tuple[str, ...] = (
    "price", "price_contract", "structure", "exch_oi", "vol", "efp", "spread_vol",
)
_MARKETS: tuple[str, ...] = ("ny", "ldn")


def _position_field_names(suffix: str = "") -> list[str]:
    """e.g. suffix='' → ['pmpu_long','pmpu_short',...]; '_old'/'_other' for crop splits."""
    return [
        f"{cat}_{side}{suffix}"
        for cat, sides in _CATEGORIES_WITH_SPREAD
        for side in sides
    ]


def _trader_count_field_names() -> list[str]:
    """Trader-count columns mirror the position columns with a 't_' prefix."""
    return [f"t_{name}" for name in _position_field_names()]


def _market_extra_field_names() -> list[str]:
    """e.g. ['price_ny','price_ldn','structure_ny',...]"""
    return [f"{base}_{mkt}" for base in _MARKET_EXTRAS for mkt in _MARKETS]


def serialize_cot_row(row: Any, *, positions: Any = None,
                      include_crop_split: bool = False,
                      combined: Any = None) -> dict[str, Any]:
    """
    Build the JSON-shaped dict for a CotWeekly row.

    Position fields can come from two sources:
      * `positions` is a dict keyed by ``(crop, category, side)`` mapping to
        either a 2-tuple ``(oi, traders)`` or any object with ``.oi`` /
        ``.traders`` attributes (e.g. a CotPosition ORM row). When provided,
        position values come from this dict — the narrow `cot_position`
        table is the source of truth.
      * If `positions` is None, position values fall back to attributes on
        `row` (the legacy wide-column path).

    Market scalars (oi_total, price_ny, structure_ny, …) always come from
    `row` since they live only in cot_weekly.

    Set `include_crop_split=True` to include the NY-only old/other crop
    fields (used by the static export but not the API).

    `combined` is an optional dict keyed by ``(category, side)`` holding the
    futures-AND-OPTIONS combined position for this market-week. When given,
    ``{cat}_{side}_opt`` fields are emitted as combined - futures: the OPTIONS
    book on its own. Those values are delta-adjusted, so a leg can be negative
    (a delta-short call book pulls a cohort's combined long below its futures
    long) — consumers must keep the sign. Omitted entirely when `combined` is
    None or lacks the key, so weeks with no combined report stay absent rather
    than reading as a zero-sized options book.
    """
    out: dict[str, Any] = {"oi_total": getattr(row, "oi_total", None)}

    def _pos_value(crop: str, cat: str, side: str, kind: str) -> Any:
        """Look up a position value. Prefers the narrow `positions` dict;
        falls back to the wide column on `row` if the (crop, cat, side) key
        isn't in the dict. Per-key (not per-week) fallback protects against
        partial backfill states or new wide fields added between PRs."""
        if positions is not None:
            entry = positions.get((crop, cat, side))
            if entry is not None:
                if isinstance(entry, tuple):
                    return entry[0] if kind == "oi" else entry[1]
                return getattr(entry, kind, None)
        return getattr(row, _build_field_name(crop, cat, side, kind), None)

    # Positions (all-crop)
    for cat, sides in _CATEGORIES_WITH_SPREAD:
        for side in sides:
            out[f"{cat}_{side}"] = _pos_value("all", cat, side, "oi")
    # Trader counts (all-crop)
    for cat, sides in _CATEGORIES_WITH_SPREAD:
        for side in sides:
            out[f"t_{cat}_{side}"] = _pos_value("all", cat, side, "traders")
    # Crop split — old then other
    if include_crop_split:
        for crop_label, suffix in (("old", "_old"), ("other", "_other")):
            for cat, sides in _CATEGORIES_WITH_SPREAD:
                for side in sides:
                    out[f"{cat}_{side}{suffix}"] = _pos_value(crop_label, cat, side, "oi")
    # Options book (combined - futures), all-crop. Absent when unavailable.
    if combined is not None:
        for cat, sides in _CATEGORIES_WITH_SPREAD:
            for side in sides:
                comb = combined.get((cat, side))
                fut = out.get(f"{cat}_{side}")
                if comb is None or fut is None:
                    continue
                out[f"{cat}_{side}_opt"] = comb - fut
    # Market extras (always from row)
    for name in _market_extra_field_names():
        out[name] = getattr(row, name, None)
    return out


def _build_field_name(crop: str, cat: str, side: str, kind: str) -> str:
    """Inverse of field_to_position — builds the wide-column name from
    ``(crop, category, side, kind)``. Used by the legacy fallback path
    inside serialize_cot_row."""
    suffix = "" if crop == "all" else f"_{crop}"
    prefix = "t_" if kind == "traders" else ""
    return f"{prefix}{cat}_{side}{suffix}"


def positions_dict(rows: Any) -> dict[tuple[str, str, str], Any]:
    """Index an iterable of CotPosition ORM rows by (crop, category, side).

    Convenience for callers who load rows via SQLAlchemy and want the dict
    shape that serialize_cot_row's `positions` parameter expects.
    """
    return {(r.crop, r.category, r.side): r for r in rows}


# ── Wide → narrow mapping (for the cot_position child table migration) ────────

_CROP_SUFFIXES: dict[str, str] = {
    "":       "all",
    "_old":   "old",
    "_other": "other",
}
_CATEGORIES_BY_NAME = {cat: sides for cat, sides in _CATEGORIES_WITH_SPREAD}


def field_to_position(field_name: str) -> tuple[str, str, str, str] | None:
    """Parse a wide-table column name into (crop, category, side, kind).

    kind is "oi" for position fields and "traders" for the t_-prefixed
    trader-count fields. Returns None for non-position fields like
    oi_total, price_ny, structure_ny, etc.

    Examples:
        "mm_long"          -> ("all",   "mm",   "long",   "oi")
        "swap_spread_old"  -> ("old",   "swap", "spread", "oi")
        "t_pmpu_short"     -> ("all",   "pmpu", "short",  "traders")
        "price_ny"         -> None
    """
    name = field_name
    kind = "oi"
    if name.startswith("t_"):
        kind = "traders"
        name = name[2:]

    # Detect crop suffix (longest match wins so "_other" beats "")
    crop = "all"
    base = name
    for suffix in ("_other", "_old"):
        if name.endswith(suffix):
            crop = _CROP_SUFFIXES[suffix]
            base = name[: -len(suffix)]
            break

    # Trader counts only exist for crop=all in the wide schema
    if kind == "traders" and crop != "all":
        return None

    parts = base.rsplit("_", 1)
    if len(parts) != 2:
        return None
    cat, side = parts
    sides = _CATEGORIES_BY_NAME.get(cat)
    if not sides or side not in sides:
        return None

    return (crop, cat, side, kind)


def position_rows_from_fields(fields: dict[str, Any]) -> list[dict[str, Any]]:
    """Group a wide-style fields dict into one (crop, category, side) row per
    physical position, merging the oi and traders values for each row.

    Returns a list of dicts shaped like:
        {"crop": "all", "category": "mm", "side": "long",
         "oi": 50000, "traders": 30}

    Only includes rows that have at least one non-None value in the input.
    Used by upsert_cot_weekly to dual-write into the cot_position table.
    """
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for field_name, value in fields.items():
        parsed = field_to_position(field_name)
        if parsed is None:
            continue
        crop, cat, side, kind = parsed
        key = (crop, cat, side)
        if key not in grouped:
            grouped[key] = {"crop": crop, "category": cat, "side": side,
                            "oi": None, "traders": None}
        grouped[key][kind] = value
    # Drop rows where both oi and traders are None (defensive — shouldn't
    # happen since we only land here for parseable fields, but keeps the
    # output table clean if a caller passes literal None values).
    return [r for r in grouped.values()
            if r["oi"] is not None or r["traders"] is not None]


# Note: an earlier helper (cot_weekly_to_position_rows) was used by the
# one-shot backfill in PR B. Now that the wide position columns are dropped
# from cot_weekly, that helper would always return [] — removed.


def combined_dict(rows: Any) -> dict[tuple[str, str], Any]:
    """Index CotCombinedPosition ORM rows by (category, side) → oi."""
    return {(r.category, r.side): r.oi for r in rows}
