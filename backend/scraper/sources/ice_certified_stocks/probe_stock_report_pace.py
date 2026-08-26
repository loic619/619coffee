"""
probe_stock_report_pace.py — does ICE tolerate a 3-second sequential pace?

The tier-2 sweep just stepped from 4s/request to 3s. That step is what makes a
full 10:29–11:00 walk (1,920 candidates) fit inside the 120-minute job timeout:
128 minutes at 4s, 96 at 3s. Everything downstream depends on it — "swept the
whole window and found nothing" is only a same-day answer if the walk finishes.

But the evidence for 3s was inferred, not measured: a run swept ~1,300
candidates at 4s and drew zero 429s, so 3s "should" be fine. Should is not a
measurement. This probe measures it.

Method
    Walk a block of consecutive HHMMSS candidates at the target interval, on a
    day and minute where the file cannot exist, so every response is a clean
    404 and nothing is fetched twice. Count 429s, capture any Retry-After, and
    watch for the other shape a ban takes: connection resets and timeouts that
    replace HTTP responses entirely.

    Interleaved with the walk are CONTROL fetches of a known-good retained
    report (probe 0.18 confirmed June reports are still served in August). The
    control is the actual question. 404s tell you the URL is wrong; they do not
    tell you whether you are still welcome. A control that returned 200 at the
    start and still returns 200 after N fast requests is the proof that the
    pace did not get us kicked out. A control that stops returning 200 is a
    ban, whatever status code the 404s were showing.

    The walk is ~10 minutes of requests. It is not a load test and must not
    become one: ICE answers impatience with a one-hour Retry-After, and this
    shares an IP and a concurrency lane with the real scraper.

Reading the result
    PASS  → no 429, no transport failures, final control 200. Keep 3s, and the
            step-down rule allows trying 2s next.
    FAIL  → anything else. Revert _STOCK_SWEEP_INTERVAL_S to 4.0 and accept
            that a full-window sweep spans two runs via the cursor.

Run:  cd backend && PYTHONPATH=. python -m scraper.sources.ice_certified_stocks.probe_stock_report_pace
      [--interval 3.0] [--requests 200] [--control-every 50]
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date, timedelta

import requests

from scraper.sources.ice_certified_stocks import fetch as F

# A retained report with a known-good URL — the "am I still allowed in?" probe.
CONTROL = ("2026-06-10", "102956")

# Where to walk. 13:xx is hours after ICE has ever published, so every second in
# the block is guaranteed absent: the walk cannot accidentally find a file, and
# cannot be confused by one. The date is a recent weekday for realism.
WALK_HOUR, WALK_MINUTE = 13, 0


def _walk_day() -> str:
    d = date.today() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


def _get(url: str) -> tuple[int, float, str]:
    """→ (status, elapsed_s, note). status -1 means no HTTP response at all."""
    t0 = time.time()
    try:
        r = requests.get(url, headers=F.HEADERS, timeout=30, allow_redirects=True)
        note = r.headers.get("Retry-After", "") if r.status_code == 429 else ""
        return r.status_code, time.time() - t0, note
    except Exception as e:  # noqa: BLE001
        return -1, time.time() - t0, f"{type(e).__name__}: {e}"[:80]


def _control(label: str) -> bool:
    day, hhmmss = CONTROL
    url = F.ROBUSTA_STOCK_REPORT_CSV.format(yyyymmdd=day.replace("-", ""), hhmmss=hhmmss)
    code, dt, note = _get(url)
    ok = code == 200
    print(f"  CONTROL[{label:<7}] {code:>4}  {dt:5.2f}s  "
          f"{'still accepted' if ok else 'NOT ACCEPTED — ' + (note or 'unexpected status')}")
    return ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=3.0,
                    help="seconds between requests (the value under test)")
    ap.add_argument("--requests", type=int, default=200,
                    help="how many 404-walk requests to issue")
    ap.add_argument("--control-every", type=int, default=50,
                    help="issue a known-good control fetch every N walk requests")
    a = ap.parse_args(argv)

    yyyymmdd = _walk_day()
    print(f"pace probe · interval={a.interval}s · {a.requests} requests · "
          f"walking {yyyymmdd} {WALK_HOUR:02d}:{WALK_MINUTE:02d}:00+")
    print(f"expected duration ≈ {(a.requests * a.interval) / 60:.1f} min\n")

    if not _control("before"):
        print("\n  → ABORTED: the control failed before the walk even started. "
              "Either we are already rate-limited or the control URL has "
              "expired; either way this run would measure nothing.")
        return 2
    print()

    codes: dict[int, int] = {}
    retry_after: list[str] = []
    transport_errors: list[str] = []
    latencies: list[float] = []
    first_bad_at: int | None = None
    t_start = time.time()

    for i in range(a.requests):
        sec = WALK_MINUTE * 60 + i
        hhmmss = f"{WALK_HOUR + sec // 3600:02d}{(sec // 60) % 60:02d}{sec % 60:02d}"
        url = F.ROBUSTA_STOCK_REPORT_CSV.format(yyyymmdd=yyyymmdd, hhmmss=hhmmss)
        code, dt, note = _get(url)
        codes[code] = codes.get(code, 0) + 1
        latencies.append(dt)

        if code == 429:
            retry_after.append(note or "(absent)")
            first_bad_at = first_bad_at if first_bad_at is not None else i + 1
            print(f"  ! 429 at request {i + 1} — Retry-After={note or '(absent)'}")
            # Stop immediately. Continuing past a 429 at a pace ICE has just
            # rejected is how a rate limit becomes an hour-long ban, and the
            # question is already answered.
            break
        if code == -1:
            transport_errors.append(note)
            first_bad_at = first_bad_at if first_bad_at is not None else i + 1
            print(f"  ! transport failure at request {i + 1} — {note}")
            if len(transport_errors) >= 3:
                print("  ! three transport failures — stopping")
                break
        elif code not in (404, 200):
            print(f"  ? unexpected {code} at request {i + 1}")

        if a.control_every and (i + 1) % a.control_every == 0:
            if not _control(f"@{i + 1}"):
                first_bad_at = first_bad_at if first_bad_at is not None else i + 1
                print("  ! the control stopped returning 200 — we have been "
                      "kicked out. Stopping.")
                break

        time.sleep(a.interval)

    issued = sum(codes.values())
    elapsed = time.time() - t_start
    print(f"\nwalk: {issued} requests in {elapsed / 60:.1f} min "
          f"({elapsed / max(issued, 1):.2f}s/req actual)")
    print(f"  statuses: {dict(sorted(codes.items()))}")
    if latencies:
        print(f"  latency: median {sorted(latencies)[len(latencies) // 2]:.2f}s · "
              f"max {max(latencies):.2f}s")
    print(f"  429s: {codes.get(429, 0)}"
          + (f" · Retry-After {retry_after}" if retry_after else ""))
    print(f"  transport failures: {len(transport_errors)}")

    print()
    ok_after = _control("after")

    passed = codes.get(429, 0) == 0 and not transport_errors and ok_after
    print()
    if passed:
        print(f"  → PASS: {issued} sequential requests at {a.interval}s drew no 429, no")
        print("    transport failures, and the control still returns 200. The pace is")
        print(f"    accepted; {a.interval}s is evidenced rather than assumed.")
    else:
        print(f"  → FAIL at {a.interval}s"
              + (f" (first bad response at request {first_bad_at})" if first_bad_at else ""))
        print("    Revert _STOCK_SWEEP_INTERVAL_S in orchestrate.py to the last")
        print("    value that passed. A slower sweep spanning two runs via the")
        print("    cursor is strictly better than a banned IP.")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
