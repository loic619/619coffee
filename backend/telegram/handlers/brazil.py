"""/brazil — Cecafé daily export registrations, against the same day last month.

The comparison period is in the header rather than implied, because the whole
message is a comparison: "83,991 bags" alone says nothing without knowing it
is being read against 2 Aug.
"""
from __future__ import annotations

from telegram.data import load
from telegram.formatting import compare, header, num, table, title

_CROPS = [("Arabica", "arabica"), ("Conilon", "conillon"), ("Soluble", "soluvel")]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _latest(data: dict, type_key: str) -> tuple[str, str, int] | None:
    section = data.get(type_key, {})
    if not section:
        return None
    month = sorted(section.keys())[-1]
    days  = sorted(section[month].keys(), key=int)
    day   = days[-1]
    return month, day, section[month][day]


def _prev_month(month: str) -> str:
    yr, mo = map(int, month.split("-"))
    mo -= 1
    if mo == 0:
        mo, yr = 12, yr - 1
    return f"{yr:04d}-{mo:02d}"


def _prior_value(data: dict, type_key: str, month: str, day: str) -> int | None:
    """Same day last month, or the closest earlier day that was reported —
    registrations are cumulative, so a missing exact day would otherwise read
    as a collapse rather than a gap."""
    prev_sec = data.get(type_key, {}).get(_prev_month(month), {})
    if not prev_sec:
        return None
    target = int(day)
    best = None
    for d in sorted(prev_sec.keys(), key=int):
        if int(d) <= target:
            best = d
    return prev_sec[best] if best else None


def _label(month: str, day: str) -> str:
    return f"{int(day)} {_MONTHS[int(month.split('-')[1]) - 1]}"


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
    month, day, _ = result

    rows: list[list] = [["", "bags", "MoM"]]
    total = prior_total = 0
    have_prior = False
    for label, key in _CROPS:
        cur = (data.get(key) or {}).get(month, {}).get(day, 0)
        prv = _prior_value(data, key, month, day)
        total += cur
        if prv is not None:
            prior_total += prv
            have_prior = True
        rows.append([label, num(cur), compare(cur, prv, "", as_pct=True).strip() or "—"])

    head = [f"<b>TOTAL {num(total)} bags</b>"]
    if have_prior:
        head.append(compare(total, prior_total, "MoM", as_pct=True))

    return "\n\n".join([
        title("🇧🇷 BRAZIL REGISTRATIONS",
              f"{_label(month, day)} · vs {_label(_prev_month(month), day)}"),
        "  ".join(h for h in head if h),
        header("📦", "by crop"),
        table(rows, align="lrr"),
    ])
