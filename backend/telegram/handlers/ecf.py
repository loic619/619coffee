from __future__ import annotations

from telegram.data import load


def handle(args: str, context: dict) -> str:
    # ECF port stocks live in their own file. They used to sit under
    # demand_stocks.json → "ecf"; that key is gone (demand_stocks now carries
    # eu/japan/usa/ajca/… only), so this command answered "ECF data empty."
    # on every call. ecf_history.json carries the same {period, value_mt}
    # monthly shape this formatter already expects, plus deeper history.
    data = load("ecf_history.json")
    if not data:
        return "ECF data unavailable. Run /run ecf"

    monthly = data.get("monthly", [])
    if not monthly:
        return "ECF data empty."
    ecf = data

    last4 = monthly[-4:]
    lines = [
        "<b>ECF European Port Stocks</b>",
        f"Updated: {ecf.get('last_updated', '?')}",
        "",
    ]
    for i, m in enumerate(last4):
        prev = last4[i - 1] if i > 0 else None
        mom = ""
        if prev:
            delta = m["value_mt"] - prev["value_mt"]
            pct   = delta / prev["value_mt"] * 100
            mom   = f"  ({'+' if delta >= 0 else ''}{delta:,} MT / {'+' if pct >= 0 else ''}{pct:.1f}%)"
        lines.append(f"  {m['period']}: {m['value_mt']:,} MT{mom}")
    return "\n".join(lines)
