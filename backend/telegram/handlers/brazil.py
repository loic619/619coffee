from __future__ import annotations

from telegram.data import load


def _latest(data: dict, type_key: str) -> tuple[str, str, int] | None:
    section = data.get(type_key, {})
    if not section:
        return None
    month = sorted(section.keys())[-1]
    days  = sorted(section[month].keys(), key=int)
    day   = days[-1]
    return month, day, section[month][day]


def _prior_value(data: dict, type_key: str, month: str, day: str) -> int | None:
    section = data.get(type_key, {})
    yr, mo = map(int, month.split("-"))
    mo -= 1
    if mo == 0:
        mo, yr = 12, yr - 1
    prev_month = f"{yr:04d}-{mo:02d}"
    prev_sec = section.get(prev_month, {})
    if not prev_sec:
        return None
    avail = sorted(prev_sec.keys(), key=int)
    target = int(day)
    best = None
    for d in avail:
        if int(d) <= target:
            best = d
    return prev_sec[best] if best else None


def _arrow(a, b) -> str:
    return "▲" if a > b else "▼" if a < b else "→"


def handle(args: str, context: dict) -> str:
    data = load("cecafe_daily.json")
    if not data:
        return "Brazil data unavailable. Run /run cecafe"

    # v2 nests the crop categories under sources.embarques (physical port
    # loadings); v1 had them at the top level. Reading the v1 shape against a
    # v2 file silently yielded {} for every category, so this command answered
    # "No Brazil registration data." on every call while /brief — which does
    # unwrap — showed the same figures fine.
    data = (data.get("sources") or {}).get("embarques") or data

    result = _latest(data, "arabica")
    if not result:
        return "No Brazil registration data."
    month, day, arab = result

    con_result = _latest(data, "conillon")
    sol_result = _latest(data, "soluvel")
    con = con_result[2] if con_result else 0
    sol = sol_result[2] if sol_result else 0
    total = arab + con + sol

    lines = [
        f"<b>Brazil Daily Registrations</b> ({month}-{int(day):02d})",
        f"Total: {total:,} bags",
        "",
        "MoM change (same day):",
    ]

    for label, key, cur_val in [("Arabica", "arabica", arab), ("Conilon", "conillon", con), ("Soluble", "soluvel", sol)]:
        prev = _prior_value(data, key, month, day)
        if prev is not None:
            delta = cur_val - prev
            lines.append(f"  {_arrow(cur_val, prev)}{'+' if delta >= 0 else ''}{delta:,}  {label}  ({cur_val:,})")
        else:
            lines.append(f"  {label}: {cur_val:,} (no prior month)")

    return "\n".join(lines)
