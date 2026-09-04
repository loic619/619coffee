"""
fetch_tradespread.py — acaphe.com traded-price ("tradespread") tape.

acaphe.com/tradespread.php is a frameset; the tape lives in 8 data endpoints:

    hisview1/2/3_data.php   London robusta, 3 nearest contracts
    ny_hv_1/2/3_data.php    New York arabica, 3 nearest contracts
    spread1/2_data.php      the two robusta calendar-spread panels

Tick tables: columns Chng | Last | Vol | Time, newest row first, and a Vietnamese
title carrying the trade count and contract ("266 Khớp lệnh / Robusta 11/26").
Two things matter for the maths:

  * Vol is CUMULATIVE session volume, so a tick's own lots are the difference
    from the previous (chronological) row; the first row's Vol is its own size.
  * Times are Vietnam local (UTC+7) and the first tick sits at the market open:
    15:00:01 VN for robusta (09:00 London), 15:15:01 VN for arabica (04:15 ET).
    The open is READ FROM THE DATA, never hardcoded — 15:00 VN is the London
    open only during BST; in GMT the open lands at 16:00 VN.

Spread panels carry level+time but no size, so spread volume is inferred the
only way the tape allows: when both legs print at the identical second, the
spread's size is at most the smaller of the two — min(vol_a, vol_b).

Derived per contract per session (all from the tape):
    first_tick / open15   the opening print and the last print within 15 min
                          of it — both fed to the open-direction model
    up/down trades+lots   tick-rule classification (uptick = buyer-initiated,
                          downtick = seller-initiated, unchanged inherits the
                          previous direction)
    vwap_up / vwap_down   volume-weighted price of the lifted vs hit ticks

Writes:
    data/tradespread_archive.json          full tape per session (research)
    frontend/public/data/tradespread.json  per-session summary + history (UI)

Run:  cd backend && PYTHONPATH=. python -m scraper.fetch_tradespread
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraper.acaphe_poller import HEADERS, playwright_login  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "data" / "tradespread_archive.json"
OUT = ROOT / "frontend" / "public" / "data" / "tradespread.json"
BASE = "https://acaphe.com/"
VN = ZoneInfo("Asia/Ho_Chi_Minh")
LONDON = ZoneInfo("Europe/London")
KEEP_DAYS = 400
OPEN_WINDOW_MIN = 15          # "price 15 min after the open"

# Robusta opens 15:00 VN; that instant both starts a new session and ends the
# previous one's readability, so it is the pivot for _session_date and the hard
# ceiling on how late the tape can be fetched.
SESSION_OPEN_VN_HOUR = 15

# When it is safe to read a finished session, in New York wall-clock.
#
# Lower bound: arabica settles 13:30 ET and the exchange posts the settlement
# ~15 min later, so a fetch before 13:45 would store a partial tape.
#
# Upper bound: 15:00 VN the next day is when acaphe's panels roll to the new
# session — 04:00 ET under EDT. Stopping at 03:30 ET keeps half an hour of
# margin against that roll.
#
# The window used to close at 15:30 ET, i.e. 105 minutes wide, and that is why
# this feed died. GitHub runs these crons LATE and the lateness grew: the
# 18:50 UTC fire landed 23-47 min late through 25 Aug, then 2h26m on the 26th,
# 7h31m on the 28th, and has sat at ~2h30m since. Everything from 26 Aug on
# missed the window and the job skipped — ten sessions lost, every run green.
# 13:45 -> 03:30(+1) is 13h45m of room, which absorbs the worst drift observed
# with six hours to spare and is bounded by the market, not by a guess.
WINDOW_OPEN_NY = 13 * 60 + 45
WINDOW_CLOSE_NY = 3 * 60 + 30      # next calendar day

TICK_PANELS = {                # panel → market
    "hisview1_data.php": "robusta", "hisview2_data.php": "robusta",
    "hisview3_data.php": "robusta", "ny_hv_1_data.php": "arabica",
    "ny_hv_2_data.php": "arabica",  "ny_hv_3_data.php": "arabica",
}
SPREAD_PANELS = ["spread1_data.php", "spread2_data.php"]


# ── parsing ──────────────────────────────────────────────────────────────────

def _num(s: str) -> float | None:
    m = re.search(r"[-+]?\d*\.?\d+", str(s or "").replace(",", ""))
    return float(m.group(0)) if m else None


def _title(soup) -> tuple[int | None, str | None]:
    """'266 Khớp lệnh <br>Robusta 11/26' → (266, 'Robusta 11/26').
    Spread panels read '<i> Chênh lệch <br>Robusta 09/26 -> 11/26'."""
    node = soup.find("b")
    if not node:
        return None, None
    parts = [p.strip() for p in node.get_text("\n").split("\n") if p.strip()]
    if not parts:
        return None, None
    n = None
    head = parts[0]
    m = re.match(r"(\d+)\s", head)
    if m:
        n = int(m.group(1))
    label = parts[-1] if len(parts) > 1 else head
    return n, re.sub(r"\s+", " ", label).strip()


def _rows(html: str) -> tuple[int | None, str | None, list[list[str]]]:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    n, label = _title(soup)
    out = []
    table = soup.find("table")
    for tr in (table.find_all("tr") if table else []):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cells) >= 2 and re.match(r"^\d{1,2}:\d{2}:\d{2}$", cells[-1]):
            out.append(cells)
    out.reverse()                      # page is newest-first → chronological
    return n, label, out


def _parse_ticks(html: str) -> dict | None:
    """{label, n_trades, ticks:[[time, last, cum_vol, lots]]} — lots derived
    from the cumulative Vol column."""
    n, label, rows = _rows(html)
    if not rows:
        return None
    ticks, prev_cum = [], None
    for last, vol, tm in ((r[1], r[2], r[3]) for r in rows if len(r) >= 4):
        px, cum = _num(last), _num(vol)
        if px is None or cum is None:
            continue
        lots = cum if prev_cum is None else max(cum - prev_cum, 0.0)
        prev_cum = cum
        ticks.append([tm, px, int(cum), int(lots)])
    if not ticks:
        return None
    return {"label": label, "n_trades": n if n is not None else len(ticks),
            "ticks": ticks}


def _parse_spread(html: str) -> dict | None:
    n, label, rows = _rows(html)
    prints = [[r[-1], _num(r[0])] for r in rows if _num(r[0]) is not None]
    return {"label": label, "prints": prints} if prints else None


# ── analytics ────────────────────────────────────────────────────────────────

def _hms(t: str) -> int:
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def _elapsed(ticks: list) -> list[int]:
    """Seconds since the session's first tick, monotonic ACROSS MIDNIGHT.

    Arabica runs 15:15 VN to 00:30 VN the next day, so raw wall-clock seconds
    wrap: a 00:30 tick reads as 1,800s, i.e. "earlier" than the 15:15 open.
    Comparing those directly made open15 select the session's CLOSE for every
    arabica contract. Ticks are already chronological, so a drop in wall-clock
    time means a day boundary was crossed — add 24h from there on."""
    out, day = [], 0
    prev = None
    for t in ticks:
        v = _hms(t[0])
        if prev is not None and v < prev:
            day += 86400
        prev = v
        out.append(v + day)
    base = out[0] if out else 0
    return [v - base for v in out]


def _at_or_before_idx(secs: list[int], target: int) -> int | None:
    """Index of the last tick at or before `target` (session seconds).

    Index rather than the tick itself: prints repeat exactly on a quiet tape
    (same second, price, cumulative volume and size), so looking a tick back up
    by value can land on the wrong one.
    """
    hit = None
    for i, sec in enumerate(secs):
        if sec <= target:
            hit = i
        else:
            break
    return hit


def _at_or_before(ticks: list, secs: list[int], target: int) -> list | None:
    """The last tick at or before `target` (session seconds), or None."""
    i = _at_or_before_idx(secs, target)
    return ticks[i] if i is not None else None


def _rc_close_secs(session: str, base: int) -> int:
    """Session-seconds of 17:30 London on `session`, on the tape's VN clock.

    Both conversions matter. London's 17:30 lands at 23:30 VN under BST and
    00:30 VN under GMT — i.e. the SAME market event sits on either side of
    midnight depending on the season — so the target is derived with zoneinfo
    rather than a fixed offset, then unwrapped onto the session clock the same
    way the ticks are.
    """
    d = datetime.fromisoformat(session).replace(tzinfo=LONDON)
    vn = d.replace(hour=17, minute=30, second=0).astimezone(VN)
    hms = vn.hour * 3600 + vn.minute * 60 + vn.second
    return hms if hms >= base else hms + 86400


def _summarise(block: dict, session: str) -> dict:
    """Tick-rule flow stats for one contract's tape."""
    ticks = block["ticks"]
    secs = _elapsed(ticks)
    first_t, first_px = ticks[0][0], ticks[0][1]
    cutoff = OPEN_WINDOW_MIN * 60
    idx = max((i for i, e in enumerate(secs) if e <= cutoff), default=0)
    open15 = ticks[idx]

    up_n = dn_n = 0
    up_lots = dn_lots = flat_lots = 0
    up_pv = dn_pv = 0.0
    direction = 0
    prev_px = None
    for _tm, px, _cum, lots in ticks:
        if prev_px is not None:
            if px > prev_px:
                direction = 1
            elif px < prev_px:
                direction = -1
            # unchanged price inherits the previous direction (tick rule)
        prev_px = px
        if direction > 0:
            up_n += 1
            up_lots += lots
            up_pv += px * lots
        elif direction < 0:
            dn_n += 1
            dn_lots += lots
            dn_pv += px * lots
        else:
            flat_lots += lots           # before the first directional print
    # Price at the London robusta close (17:30 London), read off this contract's
    # own tape. For an ARABICA contract this is the `kc_at_rc_close` the
    # open-direction model wants: NY keeps trading for an hour after London
    # shuts, and that NY-only move leads robusta's next open. Workflow 0.2 used
    # to poll a live Redis snapshot 8× a day to catch this one instant; the tape
    # already carries every print with a timestamp, so one end-of-day fetch
    # reconstructs it exactly — and for every contract, not just the front.
    base = _hms(ticks[0][0])
    bell = _rc_close_secs(session, base) - base
    rc_idx = _at_or_before_idx(secs, bell)
    rc_close = ticks[rc_idx] if rc_idx is not None else None
    # How old that print was AT the bell. "Last print at or before 17:30" is
    # only a closing price on a contract that actually trades: Robusta 09/26 on
    # 2026-08-25 printed four times all session, and its at-the-bell value was
    # SIX HOURS stale — which reads as an 89-point eight-minute collapse when it
    # is six hours of nothing. A consumer that cannot see the staleness cannot
    # tell those apart, so it ships alongside the price.
    rc_stale = None if rc_idx is None else bell - secs[rc_idx]

    total = ticks[-1][2]
    return {
        "label": block["label"],
        "n_trades": block["n_trades"],
        "total_volume": total,
        "first_tick": {"time": first_t, "price": first_px},
        "open15": {"time": open15[0], "price": open15[1]},
        "at_rc_close": ({"time": rc_close[0], "price": rc_close[1],
                         "stale_s": rc_stale}
                        if rc_close else None),
        "last": {"time": ticks[-1][0], "price": ticks[-1][1]},
        "up_trades": up_n, "down_trades": dn_n,
        "up_volume": up_lots, "down_volume": dn_lots,
        "unclassified_volume": flat_lots,
        "vwap_up": round(up_pv / up_lots, 4) if up_lots else None,
        "vwap_down": round(dn_pv / dn_lots, 4) if dn_lots else None,
        "pressure": (round((up_lots - dn_lots) / total, 4)
                     if total else None),   # +1 all lifted, −1 all hit
    }


def _attach_settle(summary: dict, quote: dict | None) -> None:
    """Add the board's settle/prev to a tape summary, plus close − settle.

    close_vs_settle is the requested model variable: the gap between the last
    TRADE and the official SETTLEMENT. It is not noise — the settle is a
    committee/VWAP construct, so a wide gap says the closing print was unrepre-
    sentative of where the exchange thinks the market actually is, which is
    exactly the kind of thing that reverts on the next open.

    Nothing is invented when the board is unreachable: the fields go None and
    the tape stats stand on their own.
    """
    last_trade = (summary.get("last") or {}).get("price")
    settle = (quote or {}).get("last")
    prev = (quote or {}).get("prev")
    summary["settle"] = settle
    summary["prev_settle"] = prev
    summary["open_board"] = (quote or {}).get("open")
    # OI is recorded opportunistically, NOT as a source of truth. acaphe's
    # open-interest column is empty at the hour this runs (every contract came
    # back None on 2026-08-25), so the daily Barchart pull — workflow 1.3 —
    # stays the OI feed and must not be retired on the strength of this field.
    summary["oi"] = (quote or {}).get("oi")
    summary["board_volume"] = (quote or {}).get("vol")
    summary["close_vs_settle"] = (
        round(last_trade - settle, 4)
        if last_trade is not None and settle is not None else None
    )


def _spread_volume(a: dict, b: dict) -> dict:
    """Legs printing in the SAME second are (at most) one spread trade of
    min(size) — the only sizing the tape allows, since the spread panels
    carry no volume."""
    va: dict[str, int] = {}
    vb: dict[str, int] = {}
    for tm, _px, _cum, lots in a["ticks"]:
        va[tm] = va.get(tm, 0) + lots
    for tm, _px, _cum, lots in b["ticks"]:
        vb[tm] = vb.get(tm, 0) + lots
    common = sorted(set(va) & set(vb))
    lots = sum(min(va[t], vb[t]) for t in common)
    return {"matched_seconds": len(common), "volume": lots,
            "leg_a": a["label"], "leg_b": b["label"]}


def _session_date(now_vn: datetime) -> str:
    """The exchange session a VN wall-clock belongs to.

    A session opens 15:00 VN and its last print lands ~00:30 VN the next day,
    so ANY moment before 15:00 VN still belongs to the session that opened the
    previous VN date — right up to the instant the next one opens.

    The cutoff used to be 06:00 VN, which was fine only because the guard below
    never admitted a fetch later than ~02:30 VN. It is a trap the moment that
    window widens: at 09:21 VN — where a 7.5-hour cron drift actually landed on
    2026-08-28 — the old rule dated Thursday's tape as Friday's, silently
    filing a complete session under the wrong day. 15:00 is the real boundary
    and the only one that cannot be outgrown, because it is the next open.
    """
    d = now_vn.date()
    return (d - timedelta(days=1) if now_vn.hour < SESSION_OPEN_VN_HOUR else d).isoformat()


# ── io ───────────────────────────────────────────────────────────────────────

def _load(path: Path, empty: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return dict(empty)


def _fetch_quotes(cookies: dict) -> dict:
    """{contract label → quote row} from iquote.php — the board, not the tape.

    The tape is traded prints only, so it can never carry a SETTLEMENT: the
    exchange posts that ~15 min after the bell and it is frequently not the last
    trade. iquote.php does carry it. Two fields, deliberately both kept:

        last  — after the settle is posted this is the settlement price, but
                between the bell and the post it is still the last trade.
        prev  — the PREVIOUS session's settlement, and unambiguous. acaphe's own
                `change` is exactly last − prev, which is what identifies it.

    So today's `last` is the settle we want, and tomorrow's `prev` confirms it.
    Storing both lets the pair be reconciled after the fact instead of trusting
    a single reading taken minutes after the post.
    """
    from scraper.acaphe_poller import API_URL, transform
    ts = int(datetime.now(UTC).timestamp() * 1000)
    r = requests.get(f"{API_URL}{ts}", cookies=cookies, headers=HEADERS, timeout=25)
    r.raise_for_status()
    q = transform(r.json())
    rows: dict[str, dict] = {}
    for market in ("robusta", "arabica"):
        for e in q.get(market) or []:
            rows[_quote_label(e.get("month", ""), market)] = e
    return rows


# acaphe writes the board as "RK 05/26" / "AU 09/26" and the tape as
# "Robusta 05/26" / "Arabica 09/26" — same contract, two spellings. Join on the
# month code, which both carry.
def _quote_label(month: str, market: str) -> str:
    m = re.search(r"(\d{2}/\d{2})", month or "")
    return f"{'Arabica' if market == 'arabica' else 'Robusta'} {m.group(1)}" if m else month


async def _fetch_all() -> dict:
    cookies = await playwright_login()
    ts = int(datetime.now(UTC).timestamp() * 1000)
    out: dict = {"ticks": {}, "spreads": {}, "quotes": {}}
    try:
        out["quotes"] = _fetch_quotes(cookies)
        print(f"[tradespread] iquote: {len(out['quotes'])} board rows "
              f"({', '.join(sorted(out['quotes'])[:4])}…)")
    except Exception as e:  # noqa: BLE001 — the tape is the primary payload
        print(f"[tradespread] iquote failed: {e!r} — settles unavailable this run")
    for panel, market in TICK_PANELS.items():
        try:
            r = requests.get(f"{BASE}{panel}?{ts}", cookies=cookies,
                             headers=HEADERS, timeout=25)
            r.raise_for_status()
            block = _parse_ticks(r.text)
        except Exception as e:  # noqa: BLE001 — one dead panel must not kill the run
            print(f"[tradespread] {panel} failed: {e!r}")
            continue
        if block:
            block["market"] = market
            block["panel"] = panel
            out["ticks"][block["label"] or panel] = block
            print(f"[tradespread] {panel}: {block['label']} — "
                  f"{len(block['ticks'])} ticks, {block['ticks'][-1][2]} lots, "
                  f"first {block['ticks'][0][0]} last {block['ticks'][-1][0]}")
        else:
            print(f"[tradespread] {panel}: no ticks (market closed / tape cleared)")
    for panel in SPREAD_PANELS:
        try:
            r = requests.get(f"{BASE}{panel}?{ts}", cookies=cookies,
                             headers=HEADERS, timeout=25)
            r.raise_for_status()
            block = _parse_spread(r.text)
        except Exception as e:  # noqa: BLE001
            print(f"[tradespread] {panel} failed: {e!r}")
            continue
        if block:
            block["panel"] = panel
            out["spreads"][block["label"] or panel] = block
            print(f"[tradespread] {panel}: {block['label']} — "
                  f"{len(block['prints'])} prints")
    return out


def _window_check(ny: datetime) -> tuple[bool, str]:
    """(may_fetch, reason) for a New York wall-clock.

    The session being read is the one whose 13:30 ET settle has passed: today's
    if we are past the settle, yesterday's if we are in the small hours before
    the panels roll. The weekday test applies to THAT session, not to the fetch
    moment — a Friday tape read at 02:00 ET Saturday is still Friday's, and
    testing the clock instead of the session would throw it away.
    """
    hm = ny.hour * 60 + ny.minute
    if hm >= WINDOW_OPEN_NY:
        session_day = ny.date()
    elif hm <= WINDOW_CLOSE_NY:
        session_day = ny.date() - timedelta(days=1)
    else:
        return False, (f"{ny:%a %H:%M} New York is between the panel roll and the "
                       f"settle (window is 13:45 → 03:30 next day)")
    if session_day.weekday() >= 5:
        return False, f"the session it would read ({session_day}) is a weekend"
    return True, f"reading the {session_day} session"


def main() -> int:
    # ONE scheduled fire, 18:50 UTC — 14:50 ET under EDT, 13:50 ET under EST,
    # after the 13:30 ET arabica settle in both seasons. The window is wide
    # enough that the season needs no second cron, and wide enough that GitHub's
    # cron drift (see WINDOW_* above) can no longer push a run out of it.
    # --force bypasses it for manual dispatch.
    if "--force" not in sys.argv:
        ny = datetime.now(ZoneInfo("America/New_York"))
        ok, why = _window_check(ny)
        if not ok:
            print(f"[tradespread] skip — {why}")
            # A scheduled fire that lands outside the window is a SCHEDULING
            # DEFECT, not a quiet no-op. Returning 0 here is what let this feed
            # die on 26 Aug and stay dead for ten sessions with every run
            # reporting success. Fail so the run is red and the alert fires;
            # a hand dispatch at the wrong hour stays a harmless exit 0.
            if os.environ.get("GITHUB_EVENT_NAME") == "schedule":
                print("::error::scheduled run fell outside the capture window — "
                      "the tape for this session was not collected")
                return 1
            return 0
        print(f"[tradespread] {why}")
    raw = asyncio.run(_fetch_all())
    if not raw["ticks"]:
        print("[tradespread] no tick data — nothing stored")
        return 1
    now_vn = datetime.now(VN)
    session = _session_date(now_vn)

    # ── research archive: the full tape ──────────────────────────────────────
    arch = _load(ARCHIVE, {"note": "acaphe traded-price tape per session; ticks "
                                   "are [VN time, price, cumulative volume, lots]",
                           "days": {}})
    arch.setdefault("days", {})[session] = {
        "fetched_at": datetime.now(UTC).isoformat(),
        "contracts": {k: {"market": v["market"], "panel": v["panel"],
                          "n_trades": v["n_trades"], "ticks": v["ticks"]}
                      for k, v in raw["ticks"].items()},
        "spreads": {k: {"panel": v["panel"], "prints": v["prints"]}
                    for k, v in raw["spreads"].items()},
    }
    arch["days"] = {d: arch["days"][d] for d in sorted(arch["days"])[-KEEP_DAYS:]}
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_text(json.dumps(arch, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")

    # ── frontend summary ────────────────────────────────────────────────────
    contracts = {k: _summarise(v, session) for k, v in raw["ticks"].items()}
    for k, v in contracts.items():
        v["market"] = raw["ticks"][k]["market"]
        _attach_settle(v, (raw.get("quotes") or {}).get(k))
    # spread sizing: consecutive legs of the same market, in listed order
    spreads = []
    for market in ("robusta", "arabica"):
        legs = [v for v in raw["ticks"].values() if v["market"] == market]
        legs.sort(key=lambda b: b["panel"])
        for a, b in zip(legs, legs[1:]):
            spreads.append({**_spread_volume(a, b), "market": market})
    # acaphe's own spread prints (level + time, no size)
    for k, v in raw["spreads"].items():
        levels = [p[1] for p in v["prints"]]
        spreads.append({"leg_a": k, "leg_b": None, "market": "robusta",
                        "panel_prints": len(levels),
                        "last_level": levels[-1] if levels else None,
                        "min_level": min(levels) if levels else None,
                        "max_level": max(levels) if levels else None})

    doc = _load(OUT, {"note": "Per-session traded-tape stats from acaphe. "
                              "pressure = (lifted − hit lots) / total.",
                      "history": []})
    row = {"date": session, "contracts": contracts, "spreads": spreads}
    doc["history"] = [r for r in doc.get("history", []) if r.get("date") != session]
    doc["history"] = sorted(doc["history"] + [row], key=lambda r: r["date"])[-KEEP_DAYS:]
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")

    for name, c in contracts.items():
        arc = c.get("at_rc_close") or {}
        # Flag an anchor that is more than 15 min old — on an illiquid contract
        # the "price at the bell" can be hours stale and look like a crash.
        _st = arc.get("stale_s") or 0
        stale_note = f" (stale {_st // 60}m)" if _st > 900 else ""
        print(f"[tradespread] {session} {name}: {c['n_trades']} trades, "
              f"{c['total_volume']} lots | open {c['first_tick']['price']} "
              f"@{c['first_tick']['time']} → +15m {c['open15']['price']} "
              f"@{c['open15']['time']} | RC-close {arc.get('price')}{stale_note} "
              f"| close {c['last']['price']} settle {c.get('settle')} "
              f"(Δ {c.get('close_vs_settle')}) "
              f"| up {c['up_volume']} / down {c['down_volume']} "
              f"(pressure {c['pressure']}) | VWAP↑ {c['vwap_up']} ↓ {c['vwap_down']}")
    for s in spreads:
        if s.get("leg_b"):
            print(f"[tradespread] spread {s['leg_a']} / {s['leg_b']}: "
                  f"{s['volume']} lots over {s['matched_seconds']} matched seconds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
