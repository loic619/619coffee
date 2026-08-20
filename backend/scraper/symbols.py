"""
symbols.py — single source of truth for coffee futures contract symbol
conventions. Removes the per-consumer RM/RC conversions that were scattered
across the scrapers and exporters.

Three conventions exist in the pipeline:

  FETCH (Barchart):  robusta root = "RM"  (e.g. RMN26)  — DO NOT change; the
                     Barchart API only answers to RM^F / RM-rooted symbols.
  CANONICAL (store): robusta root = "RC"  (e.g. RCN26)  — used in cot_weekly,
                     contract_prices_archive.json, the COT signal engine, and
                     the Industry Pulse price labels.
  DISPLAY (OI/FND):  robusta root = "RM"  (e.g. RMN26)  — the futures-page OI
                     tables and OI-to-FND chart (incl. their embedded
                     STATIC_SERIES) render RM.

Arabica is "KC" everywhere — no conversion needed.

Rule of thumb:
  - ingest a fetched/raw symbol  → to_canonical()   (RM→RC)
  - emit a display-facing JSON    → to_display()      (RC→RM)
"""
from __future__ import annotations

import re

_SYM_RE = re.compile(r"^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$", re.I)


def parse(sym: str) -> tuple[str, str, str] | None:
    """('RCN26') → ('RC','N','26'); returns None if not a coffee contract."""
    m = _SYM_RE.match((sym or "").strip().upper())
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def market_of(sym: str) -> str | None:
    """'KCN26'→'arabica'; 'RMN26'/'RCN26'→'robusta'; else None."""
    p = parse(sym)
    if not p:
        return None
    return "arabica" if p[0] == "KC" else "robusta"


def to_canonical(sym: str) -> str:
    """Storage form: RM→RC, KC unchanged. RCN26 stays RCN26."""
    p = parse(sym)
    if not p:
        return sym
    root, letter, yy = p
    if root == "RM":
        root = "RC"
    return f"{root}{letter}{yy}"


def to_display(sym: str) -> str:
    """Display form for OI tables + OI-to-FND chart: RC→RM, KC unchanged."""
    p = parse(sym)
    if not p:
        return sym
    root, letter, yy = p
    if root == "RC":
        root = "RM"
    return f"{root}{letter}{yy}"


def month_label(sym: str) -> str:
    """'RCN26'/'RMN26'/'KCN26' → 'N26' (root stripped, for chart labels)."""
    p = parse(sym)
    if not p:
        return sym
    _, letter, yy = p
    return f"{letter}{yy}"


# Delivery-month letter → calendar month. Standard futures month codes.
_MONTH_OF_LETTER = {
    "F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
    "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12,
}


def expiry_key(sym: str) -> int:
    """Sortable expiry rank: 'RCU26' → 202609. Unparseable symbols sort last.

    Lets consumers order contracts by delivery date instead of alphabetically
    (which would put Z before others), and lets the front-month roll be held
    monotonic — max-OI alone oscillates between two contracts around a roll.
    """
    p = parse(sym)
    if not p:
        return 999999
    _, letter, yy = p
    return (2000 + int(yy)) * 100 + _MONTH_OF_LETTER.get(letter, 0)
