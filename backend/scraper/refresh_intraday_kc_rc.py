"""
refresh_intraday_kc_rc.py
Daily incremental refresh of intraday_kc_rc_15min.json — keeps the 15-min
RM+KC intraday points current so the open-direction model's two intraday
features (kc_after_rc_diff, rc_overnight_gap) don't go stale and freeze the
model's scored `as_of`.

The deep backfill (backfill_intraday_kc_rc.py, workflow 1.97) builds the full
~5.7y history from 59 contracts; that's heavy and manual. This refresh fetches
only the few NEAREST contracts (front + roll neighbours), volume-stitches them
with the SAME logic as the backfill (so the contract selection is identical),
extracts the recent days, and MERGES them into the existing file — recent dates
overwrite, all older history is preserved.

Scheduled (workflow 1.98) at ~20:13 UTC Mon-Fri, after both markets close and
before the 21:30 quant run (1.9), so the model picks up the fresh intraday the
same day. The current-day official settles aren't in the archive yet at that
hour (the OI workflow writes them ~02:00 UTC next day) — that's fine, the model
doesn't use the settle; the next refresh fills it in.

Usage (needs chromium):
    cd backend
    python -m scraper.refresh_intraday_kc_rc
"""
from __future__ import annotations

import asyncio
import json
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Reuse the backfill's contract enumeration, fetch, parse, volume-stitch and
# settle logic so the refresh and the deep backfill agree bar-for-bar.
from scraper.backfill_intraday_kc_rc import (  # noqa: E402
    _T_1630,
    _T_1730,
    _T_1830,
    _T_OPEN,
    OUT_PATH,
    _archive_settles,
    _contracts,
    _fetch_contracts,
    _parse_day_index,
    _stitch,
)
from scraper.symbols import to_canonical  # noqa: E402
from scraper.validate_export import safe_write_json  # noqa: E402

# Nearest contracts per market: enough to cover the current front plus the one
# that just rolled off and the next one (so the volume-stitch picks the liquid
# front correctly across a roll near "now").
_N_NEAREST = 4


def _merge(existing: list[dict], fresh: dict[str, dict]) -> tuple[list[dict], int]:
    """Merge freshly-fetched recent days into the existing history.

    Recent (re-fetched) dates overwrite their old record; every older date is
    preserved untouched. Returns (sorted_rows, n_new) where n_new counts dates
    that weren't already present. Pure — no I/O — so it's unit-testable without
    Barchart.
    """
    by_date = {r.get("date"): r for r in existing if isinstance(r, dict) and r.get("date")}
    n_new = sum(1 for d in fresh if d not in by_date)
    by_date.update(fresh)
    merged = [by_date[d] for d in sorted(by_date)]
    return merged, n_new


def run() -> dict:
    rc_contracts = _contracts("robusta", 1)[-_N_NEAREST:]
    kc_contracts = _contracts("arabica", 1)[-_N_NEAREST:]
    syms = [s for s, _ in rc_contracts] + [s for s, _ in kc_contracts]
    print(f"[refresh] nearest contracts: {syms}")

    raw = asyncio.run(_fetch_contracts(syms))
    rc_parsed = {s: _parse_day_index(raw.get(s, "")) for s, _ in rc_contracts}
    kc_parsed = {s: _parse_day_index(raw.get(s, "")) for s, _ in kc_contracts}
    rc_front = _stitch("robusta", rc_contracts, rc_parsed)
    kc_front = _stitch("arabica", kc_contracts, kc_parsed)
    if not rc_front and not kc_front:
        return {"ok": False, "reason": "no intraday bars returned"}

    settles = _archive_settles()

    def _settle(market, day, sym):
        return settles[market].get(f"{day}|{to_canonical(sym)}") if sym else None

    days = sorted(set(rc_front) | set(kc_front))
    fresh: dict[str, dict] = {}
    for day in days:
        rc_sym, rd = rc_front.get(day, (None, {}))
        kc_sym, kd = kc_front.get(day, (None, {}))
        first_rc = rd.get(_T_OPEN)
        fresh[day] = {
            "date":          day,
            "rc_open_first": (first_rc or {}).get("open"),
            "rc_open_0915":  (first_rc or {}).get("close"),
            "rc_last_1730":  (rd.get(_T_1730) or {}).get("close"),
            "rc_last_1630":  (rd.get(_T_1630) or {}).get("close"),
            "kc_last_1730":  (kd.get(_T_1730) or {}).get("close"),
            "kc_last_1830":  (kd.get(_T_1830) or {}).get("close"),
            "rc_settle":     _settle("robusta", day, rc_sym),
            "kc_settle":     _settle("arabica", day, kc_sym),
            "rc_symbol":     rc_sym,
            "kc_symbol":     kc_sym,
        }

    # Merge: existing history preserved; refreshed (recent) dates overwrite.
    existing: list[dict] = []
    if OUT_PATH.exists():
        try:
            loaded = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                existing = loaded
        except Exception:
            existing = []
    merged, n_new = _merge(existing, fresh)

    safe_write_json(OUT_PATH, merged, ensure_ascii=False, trailing_newline=True)
    span = f"{merged[0]['date']} → {merged[-1]['date']}" if merged else "—"
    print(f"[refresh] refreshed {len(fresh)} recent days ({n_new} new); "
          f"file now {len(merged)} days, span {span}")
    return {"ok": True, "refreshed": len(fresh), "new": n_new, "total": len(merged)}


if __name__ == "__main__":
    status = run()
    sys.exit(0 if status.get("ok") else 1)
