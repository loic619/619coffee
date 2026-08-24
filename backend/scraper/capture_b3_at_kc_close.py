"""
capture_b3_at_kc_close.py
Two-phase daily capture of the B3 arabica 4/5 (ICF) front price:

  phase kc_close  — snapshot the LIVE front price at the instant ICE Coffee C
                    settles (13:30 ET). B3's regular session (9:00–15:00 BRT)
                    is still running then in the US summer and its after-hours
                    session in the US winter — either way, Brazil keeps
                    pricing arabica AFTER New York stops.
  phase final     — after B3's after-hours closes (18:00 BRT), read the
                    session's official regular-session fechamento
                    (noticiasagricolas, same series the futures panel shows),
                    attach it to the snapshot and store the gap:

        b3_close_gap = B3_final / B3_at_KC_close − 1

    the Brazilian-market move in the window AFTER the KC close — information
    New York hasn't priced yet. Candidate feature for the open-direction
    model (scraper/quant_model/open_direction.py), which activates it once
    ≥ _MIN_B3_OVERLAP sessions accumulate and the walk-forward keeps it —
    the same forward-only path cci_overnight took.

Scheduling (workflow b3-kc-close.yml)
=====================================
  kc_close: cron 16:55 UTC AND 17:55 UTC Mon–Fri = 12:55 New York, ~35 min
            BEFORE the settle; a New-York guard (12:45–14:30 ET) lets exactly
            one through per DST season and the script then waits for 13:30.
            Aiming early and waiting is the only reliable shape here: GitHub
            runs crons late by 15–25 min as a matter of course, so aiming AT
            the settle captures late every time (it did — 13:53 NY, 23 min
            past, on both of the first two sessions).
  final:    cron 21:37 UTC Mon–Fri = 18:37 BRT (Brazil has no DST), ~30 min
            after the after-hours close; a BRT guard skips early fires.
            This run also refreshes brazil_b3_arabica.json, so the futures
            panel gets the day's close ~5h before the nightly 02:41 export.

Clean data over complete data: a guard miss or API hiccup skips the day —
one fewer observation, which the model tolerates.

Usage (debug):
    cd backend && python -m scraper.capture_b3_at_kc_close kc_close|final
"""
from __future__ import annotations

import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "data" / "b3_kc_close_snapshots.json"
_API = "https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/ICF"
_KEEP = 520                    # ~2y of sessions
_NY = ZoneInfo("America/New_York")
_BR = ZoneInfo("America/Sao_Paulo")

# KC settles 13:30 NY. The guard's job is to admit exactly ONE of the two
# kc_close crons per DST season — NOT to be a tight fence around the settle,
# which is what it was and why it never fired once. GitHub's scheduler runs
# crons LATE, routinely by 15–25 minutes: every scheduled fire of the 17:33
# UTC slot landed at 17:52–17:56 UTC, i.e. 13:52–13:56 NY, and the old
# 13:28–13:52 fence rejected all of them — the first by a single minute. The
# window below tolerates the observed drift while still excluding the other
# season's cron (which drifts to ≥14:50 NY), and a too-early fire waits for
# the settle instead of being thrown away. `late_min` is stored per row so a
# capture that drifted far from the settle can be filtered later.
#
# 2026-08-24: aiming AT the settle still captured 23 min late (13:53 NY) on
# both sessions, because drift only ever runs one way. The crons now fire at
# 12:55 NY — ~35 min early — so even a 25-min drift lands BEFORE the settle
# and the wait below pins the snapshot to 13:31 NY. That matters: the gap is
# meant to measure B3's move AFTER New York shuts, and starting it 23 min
# late was silently discarding most of B3's remaining regular session.
_KC_SETTLE    = 13 * 60 + 30
_WINDOW_OPEN  = 12 * 60 + 45
_WINDOW_CLOSE = 14 * 60 + 30

# Noticiasagricolas curve months are Portuguese ("Setembro/2026"); the API
# symbol carries the futures month code (ICFU26). Map code → PT month name.
_CODE_PT = {"F": "janeiro", "G": "fevereiro", "H": "março", "J": "abril",
            "K": "maio", "M": "junho", "N": "julho", "Q": "agosto",
            "U": "setembro", "V": "outubro", "X": "novembro", "Z": "dezembro"}


def _load() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d.setdefault("days", [])
        return d
    except Exception:
        return {
            "note": ("b3_at_kc_close = ICF front live price at the KC settle "
                     "(13:30 ET); b3_final = the session's official regular "
                     "fechamento; gap = final/at_kc_close - 1 — Brazil's move "
                     "after New York stopped trading. Feeds the open-direction "
                     "model once enough history accrues."),
            "days": [],
        }


def _save(doc: dict) -> None:
    doc["days"] = sorted(doc["days"], key=lambda r: r["date"])[-_KEEP:]
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")


def _fetch_front_live() -> tuple[str, float] | None:
    """(symbol, live price) of the nearest live ICF future, or None.

    Live price field: curPrc when present; the schema is logged when no
    usable field is found so the first market-hours run documents it.
    """
    r = requests.get(_API, headers={"User-Agent": "Mozilla/5.0",
                                    "Accept": "application/json"}, timeout=20)
    r.raise_for_status()
    today = datetime.now(_BR).date().isoformat()
    futs = []
    for c in r.json().get("Scty") or []:
        a = c.get("asset", {}).get("AsstSummry", {})
        if (c.get("mkt", {}).get("cd") == "FUT"
                and (a.get("opnCtrcts") or 0) > 0
                and a.get("mtrtyCode", "") > today):
            futs.append(c)
    if not futs:
        print("[b3-kc-close] no live ICF futures in API payload")
        return None
    front = min(futs, key=lambda c: c["asset"]["AsstSummry"].get("mtrtyCode", "9999"))
    q = front.get("SctyQtn", {})
    for field in ("curPrc", "tradPric", "lastPric"):
        v = q.get(field)
        if isinstance(v, (int, float)) and v > 0:
            return front.get("symb", "?"), float(v)
    print(f"[b3-kc-close] no live price field; SctyQtn keys = {sorted(q.keys())}")
    return None


def _phase_kc_close() -> int:
    now_ny = datetime.now(_NY)
    hm = now_ny.hour * 60 + now_ny.minute
    if not (_WINDOW_OPEN <= hm <= _WINDOW_CLOSE):
        print(f"[b3-kc-close] {now_ny:%H:%M} NY is outside the KC-close window "
              f"({_WINDOW_OPEN // 60}:{_WINDOW_OPEN % 60:02d}–"
              f"{_WINDOW_CLOSE // 60}:{_WINDOW_CLOSE % 60:02d} NY) — skip "
              "(the other cron fire covers this DST season)")
        return 0
    if now_ny.weekday() >= 5:
        print("[b3-kc-close] weekend — skip")
        return 0
    if hm < _KC_SETTLE:                 # cron fired early — wait for the settle
        wait = (_KC_SETTLE + 1 - hm) * 60 - now_ny.second
        print(f"[b3-kc-close] {now_ny:%H:%M} NY is before the KC settle — "
              f"waiting {wait}s")
        time.sleep(max(0, wait))
        now_ny = datetime.now(_NY)
        hm = now_ny.hour * 60 + now_ny.minute
    got = _fetch_front_live()
    if not got:
        return 0                     # logged above; missing day is acceptable
    symb, px = got
    session = datetime.now(_BR).date().isoformat()
    late = hm - _KC_SETTLE
    doc = _load()
    if any(r["date"] == session and r.get("at_kc_close") for r in doc["days"]):
        print(f"[b3-kc-close] {session} already captured — keep first")
        return 0
    row = next((r for r in doc["days"] if r["date"] == session), {"date": session})
    doc["days"] = [r for r in doc["days"] if r["date"] != session]
    # Merge rather than replace: `final` may already have run and stored
    # b3_final for this session (it does when kc_close is re-dispatched by
    # hand after the fact), and overwriting it would throw away the leg that
    # makes the gap computable.
    row.update({"symb": symb, "at_kc_close": px,
                "captured_at": datetime.now(UTC).isoformat(),
                "captured_ny": now_ny.strftime("%H:%M"),
                "late_min": late})
    doc["days"].append(row)
    _save(doc)
    print(f"[b3-kc-close] {session}: {symb} at KC close = US$ {px} "
          f"(captured {now_ny:%H:%M} NY, {late:+d} min vs the settle)")
    return 0


def _phase_final() -> int:
    now_br = datetime.now(_BR)
    if now_br.hour * 60 + now_br.minute < 18 * 60 + 15:
        print(f"[b3-kc-close] {now_br:%H:%M} BRT is before the after-hours close — skip")
        return 0
    from scraper.sources.brazil_b3_arabica import export_brazil_b3_arabica, fetch
    fech, contracts = fetch()
    session = now_br.date().isoformat()
    if fech != session or not contracts:
        print(f"[b3-kc-close] fechamento page shows {fech!r} (want {session}) — "
              "no session today or page not updated yet")
        return 0
    doc = _load()
    row = next((r for r in doc["days"] if r["date"] == session), None)
    if row is None:
        row = {"date": session}
        doc["days"].append(row)
    # match the snapshot's contract month in the fechamento curve; fall back
    # to the front row when there was no snapshot to match against.
    final = None
    symb = row.get("symb") or ""
    if len(symb) >= 6:
        want = f"{_CODE_PT.get(symb[3], '?')}/{'20' + symb[4:6]}"
        final = next((c["price"] for c in contracts
                      if c["month"].strip().lower() == want), None)
    if final is None:
        final = contracts[0]["price"]
        row["final_is_front"] = True
    row["b3_final"] = final
    if row.get("at_kc_close"):
        row["gap"] = round(final / row["at_kc_close"] - 1.0, 6)
        print(f"[b3-kc-close] {session}: final US$ {final} vs at-KC-close "
              f"US$ {row['at_kc_close']} → gap {row['gap']*100:+.3f}%")
    else:
        print(f"[b3-kc-close] {session}: final US$ {final} (no KC-close snapshot today)")
    _save(doc)
    # publish the panel series ~5h earlier than the nightly export (idempotent)
    export_brazil_b3_arabica()
    return 0


def main() -> int:
    phase = sys.argv[1] if len(sys.argv) > 1 else ""
    if phase == "kc_close":
        return _phase_kc_close()
    if phase == "final":
        return _phase_final()
    print("usage: python -m scraper.capture_b3_at_kc_close <kc_close|final>")
    return 2


if __name__ == "__main__":
    sys.exit(main())
