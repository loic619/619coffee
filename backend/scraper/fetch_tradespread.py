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
KEEP_DAYS = 400
OPEN_WINDOW_MIN = 15          # "price 15 min after the open"

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


def _summarise(block: dict) -> dict:
    """Tick-rule flow stats for one contract's tape."""
    ticks = block["ticks"]
    first_t, first_px = ticks[0][0], ticks[0][1]
    cutoff = _hms(first_t) + OPEN_WINDOW_MIN * 60
    open15 = next((t for t in reversed(ticks) if _hms(t[0]) <= cutoff), ticks[0])

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
    total = ticks[-1][2]
    return {
        "label": block["label"],
        "n_trades": block["n_trades"],
        "total_volume": total,
        "first_tick": {"time": first_t, "price": first_px},
        "open15": {"time": open15[0], "price": open15[1]},
        "last": {"time": ticks[-1][0], "price": ticks[-1][1]},
        "up_trades": up_n, "down_trades": dn_n,
        "up_volume": up_lots, "down_volume": dn_lots,
        "unclassified_volume": flat_lots,
        "vwap_up": round(up_pv / up_lots, 4) if up_lots else None,
        "vwap_down": round(dn_pv / dn_lots, 4) if dn_lots else None,
        "pressure": (round((up_lots - dn_lots) / total, 4)
                     if total else None),   # +1 all lifted, −1 all hit
    }


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
    """The exchange session a VN wall-clock belongs to. The tape runs 15:00 VN
    to ~00:30 VN(+1), so an after-midnight fetch still belongs to the previous
    VN date."""
    d = now_vn.date()
    return (d - timedelta(days=1) if now_vn.hour < 6 else d).isoformat()


# ── io ───────────────────────────────────────────────────────────────────────

def _load(path: Path, empty: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return dict(empty)


async def _fetch_all() -> dict:
    cookies = await playwright_login()
    ts = int(datetime.now(UTC).timestamp() * 1000)
    out: dict = {"ticks": {}, "spreads": {}}
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


def main() -> int:
    # Scheduled runs fire at both 18:00 and 19:00 UTC so 14:00 New York (the
    # arabica close + 30 min) is hit in either DST season; the wall-clock guard
    # lets exactly one through. --force bypasses it for manual dispatch.
    if "--force" not in sys.argv:
        ny = datetime.now(ZoneInfo("America/New_York"))
        hm = ny.hour * 60 + ny.minute
        if ny.weekday() >= 5 or not (13 * 60 + 45 <= hm <= 14 * 60 + 30):
            print(f"[tradespread] {ny:%a %H:%M} New York is outside the "
                  "post-close window — skip (the other cron fire covers this season)")
            return 0
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
    contracts = {k: _summarise(v) for k, v in raw["ticks"].items()}
    for k, v in contracts.items():
        v["market"] = raw["ticks"][k]["market"]
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
        print(f"[tradespread] {session} {name}: {c['n_trades']} trades, "
              f"{c['total_volume']} lots | open {c['first_tick']['price']} "
              f"@{c['first_tick']['time']} → +15m {c['open15']['price']} "
              f"| up {c['up_volume']} / down {c['down_volume']} "
              f"(pressure {c['pressure']}) | VWAP↑ {c['vwap_up']} ↓ {c['vwap_down']}")
    for s in spreads:
        if s.get("leg_b"):
            print(f"[tradespread] spread {s['leg_a']} / {s['leg_b']}: "
                  f"{s['volume']} lots over {s['matched_seconds']} matched seconds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
