"""/prices — the fast one. A terminal snapshot, not a report.

Built to be read in a second: both boards with the day's move, then the
physical quotes, then FX. Everything tabular so the columns line up.
"""
from __future__ import annotations

from telegram.data import load
from telegram.formatting import delta, header, num, table, title

# Front contract per board, with its unit and quoted precision.
_BOARDS = [("RC", "robusta", "$/MT", 0), ("KC", "arabica", "¢/lb", 2)]


def _ticker_rows(tickers: list[dict], category: str) -> list[list]:
    """Every ticker in a category, in publication order.

    Selected by the feed's own `category` rather than a hard-coded allowlist:
    the previous version named three physical labels and three FX pairs, so
    GT SHB, USD/HNL and USD/UGX were published but never shown, and any ticker
    added upstream would have been dropped silently too.
    """
    return [[t["label"], t["value"]]
            for t in tickers
            if t.get("category") == category and t.get("label") and t.get("value")]


def handle(args: str, context: dict) -> str:
    chain  = load("futures_chain.json")
    latest = load("latest_prices.json")
    if not chain and not latest:
        return "Price data unavailable. Run /run prices"

    parts = [title("📊 COFFEE SNAPSHOT")]

    # Futures: the chain carries `chg` (Barchart's settle-over-settle delta),
    # which the old message never showed — it printed a bare level with no
    # indication of the day's direction.
    fut: list[list] = [["", "last", "d/d", ""]]
    for label, key, unit, dp in _BOARDS:
        contracts = ((chain or {}).get(key) or {}).get("contracts") or []
        if not contracts:
            continue
        front = contracts[0]
        last = front.get("last")
        if last is None:
            continue
        chg = front.get("chg")
        prev = last - chg if chg is not None else None
        # Unit on the label, as in /cot: RC is $/MT and KC ¢/lb, and the old
        # message stated both — dropping them would lose information.
        fut.append([f"{label} {unit}", num(last, dp), delta(last, prev, dp),
                    front.get("symbol", "?")])
    if len(fut) > 1:
        parts += [header("📈", "futures"), table(fut, align="lrrl")]

    tickers = (latest or {}).get("tickers") or []
    phys = _ticker_rows(tickers, "physical")
    if phys:
        # Left-aligned: these values are heterogeneous strings
        # ("93.800 VND ($3,607)", "Q2,231.33 ($6,448)"), so no alignment lines
        # the numbers up and a clean left edge reads better than a ragged one.
        parts += [header("🌍", "physical"), table(phys, align="ll")]
    fx = _ticker_rows(tickers, "fx")
    if fx:
        parts += [header("💱", "fx"), table(fx, align="lr")]

    if len(parts) == 1:
        return "Price data unavailable. Run /run prices"
    return "\n\n".join(parts)
