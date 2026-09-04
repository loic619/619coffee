"""/cot — weekly CFTC positioning for both boards.

Laid out in the house four layers: the market snapshot, the week's move, the
signals, then the gross long/short detail. Net position gets visual priority
because it is what a desk acts on; the gross legs are indented under it as
supporting numbers.
"""
from __future__ import annotations

from telegram.data import load
from telegram.formatting import delta, header, num, severity, signed, table, title

# Severity (lowercase) → fixed-width display tag.
#
# Schema drift caught on first live render: existing quant signals (CR5, ML5,
# …) use severity="warn"; the Phase 5 agronomic engine (PR #140) uses
# severity="watch". Both denote the same tier, so both spellings are accepted
# everywhere and sort together.
_SEVERITY_RANK = {"critical": 4, "alert": 3, "watch": 2, "warn": 2, "info": 1}

# Both boards, with the unit and decimal precision their price is quoted in.
_MARKETS = [
    ("☕", "ARABICA · KC",  "ny",  "price_ny",  "¢/lb", 2),
    ("🌱", "ROBUSTA · RC",  "ldn", "price_ldn", "$/MT", 0),
]


def _net(row: dict, long_key: str, short_key: str) -> int | None:
    lo, sh = row.get(long_key), row.get(short_key)
    return None if lo is None or sh is None else lo - sh


def _find_rows(data: list) -> tuple[dict | None, dict | None]:
    """Latest positioned week and the one before it, for the WoW column."""
    latest = prev = None
    for row in reversed(data):
        if (row.get("ny") or {}).get("mm_long") is not None:
            if latest is None:
                latest = row
            elif prev is None:
                prev = row
                break
    return latest, prev


def _cohort_rows(label: str, cur: dict, prv: dict, long_key: str, short_key: str) -> list[list]:
    """A cohort as four lines: the group label, its net, then the gross legs.

    Net is rendered signed — a producer book at -35,429 and a fund book at
    +31,188 are opposite states and the sign is the whole story.
    """
    net, p_net = _net(cur, long_key, short_key), _net(prv, long_key, short_key)
    if net is None:
        return []
    rows: list[list] = [[""], [label], ["Net", signed(net), delta(net, p_net)]]
    for leg, key in (("Long", long_key), ("Short", short_key)):
        v, p = cur.get(key), prv.get(key)
        if v is not None:
            rows.append([f"  {leg}", num(v), delta(v, p)])
    return rows


def _signal_lines(signals: list, market: str) -> list[str]:
    """Signals for one board, worst first. Severity carries a mark rather than
    a [TAG] so the eye lands on the actionable ones without reading."""
    rows = [s for s in signals if s.get("market") == market]
    if not rows:
        return []
    rows.sort(key=lambda s: (-_SEVERITY_RANK.get((s.get("severity") or "info").lower(), 0),
                             -abs(s.get("score", 0))))
    out = []
    for s in rows:
        score = s.get("score", 0)
        out.append(f"{severity(s.get('severity') or 'info')} {market} · "
                   f"{s.get('name', s.get('id', '?'))} ({signed(score)})")
    return out


def handle(args: str, context: dict) -> str:
    data = load("cot_recent.json")
    if not data or not isinstance(data, list):
        return "No COT data available yet."

    latest, prev = _find_rows(data)
    if not latest:
        return "No COT data available yet."

    parts = [title("📋 COT POSITIONING", f"week of {latest['date']}")]

    for emoji, label, key, price_key, unit, dp in _MARKETS:
        cur = latest.get(key) or {}
        prv = (prev or {}).get(key) or {}

        rows: list[list] = [["", "latest", "WoW"]]
        price, p_price = cur.get(price_key), prv.get(price_key)
        if price is not None:
            rows.append([f"Price {unit}", num(price, dp), delta(price, p_price, dp)])
        oi, p_oi = cur.get("oi_total"), prv.get("oi_total")
        if oi is not None:
            rows.append(["OI lots", num(oi), delta(oi, p_oi)])

        rows += _cohort_rows("MANAGED MONEY", cur, prv, "mm_long", "mm_short")
        rows += _cohort_rows("PRODUCERS",     cur, prv, "pmpu_long", "pmpu_short")

        parts.append(header(emoji, label))
        if len(rows) > 1:
            parts.append(table(rows, align="lrr"))
        else:
            parts.append("Data pending next release.")

    sig_doc = load("signals.json")
    signals = sig_doc.get("signals") or [] if isinstance(sig_doc, dict) else []
    lines = _signal_lines(signals, "NY") + _signal_lines(signals, "LDN")
    if lines:
        parts.append(header("🚨", "signals"))
        parts.append("\n".join(lines))

    return "\n\n".join(parts)
