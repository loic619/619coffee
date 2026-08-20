"""
fetch_fx_snapshots.py — intraday FX anchors for the open-direction model's
`cci_overnight` feature.

For every Coffee-Currency-Index component pair it records, per session day D:

    prev_1730  the rate at 17:30 London on the PRIOR trading day (RC close)
    at_0300    the rate at 03:00 UTC on day D (the model's pre-open fire time)

so the model can compute the CCI's overnight move 17:30(D−1) → 03:00(D) with
the published index weights.

Two modes, same source and same anchor rule:

  daily     (default) ~2000 bars/pair — 15-min bars, so a liquid pair's 96
            prints a session mean this reaches back about three weeks. Enough
            to append yesterday; it is why the file's deep history had only
            the thinly-quoted pairs (^USDPEN prints sparsely enough that 2000
            bars span years).
  --backfill deep pull, ~26,000 bars/pair ≈ 200 sessions of the liquid pairs.
            Gap-fill only: stored values are never overwritten, they are
            AUDITED against the fresh pull and disagreements reported. Run it
            by dispatching workflow 1.16b.

Mixing sources here would be silent poison — a yfinance hourly series would
anchor at 17:00/18:00, not 17:30, and blend indistinguishably with true
17:30 captures. Both modes therefore go through the identical extraction
below; only the pull depth and the merge policy differ.

Mechanics mirror fetch_intraday_kc_rc.py exactly (the proven CI path): Barchart
`queryminutes.ashx` 15-min bars via a Playwright page holding the XSRF cookie.
Bars are stamped America/Chicago; each is converted tz-aware, then:

  * 17:30-London anchor = CLOSE of the bar that STARTS 17:15 Europe/London
    (correct across DST, including the US/UK mismatch weeks — see the
    regression test on _parse_csv_to_london's identical conversion).
  * 03:00-UTC anchor    = CLOSE of the bar that STARTS 02:45 UTC. The rule is
    "latest bar starting ≤ 02:45 UTC that day", which stays DETERMINISTIC no
    matter how late the 03:00 cron actually fires (GH cron drift can't shift
    the anchor to a later bar).

Per-pair failures degrade gracefully (pair skipped that run); the model
requires a majority of the basket per day, so partial days simply don't count.

Output (merged, last ~500 days kept):
  frontend/public/data/fx_intraday_snapshots.json
  {"scraped_at": ..., "days": [{"date": "YYYY-MM-DD",
      "pairs": {"BRL=X": {"prev_1730": 5.43, "at_0300": 5.44}, ...}}]}
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.validate_export import safe_write_json  # noqa: E402

_REPO    = Path(__file__).resolve().parents[2]
OUT_PATH = _REPO / "frontend" / "public" / "data" / "fx_intraday_snapshots.json"

_CHICAGO = ZoneInfo("America/Chicago")
_LONDON  = ZoneInfo("Europe/London")
_UTC     = UTC

_KEEP_DAYS = 500

# How stale the prior-session 17:30 anchor may be, in calendar days. See
# _pair_days — this is what keeps a sparsely-quoted pair from contributing a
# multi-day move labelled "overnight".
_MAX_PREV_GAP_DAYS = 4

# Backfill pull depth. A liquid pair prints 96 bars a session, so 200 sessions
# ≈ 19,200 bars; 26,000 leaves room for the 24h-a-day weekday tape and for
# Barchart returning slightly more than asked. Thin pairs simply reach further
# back in calendar time for the same record count.
_BACKFILL_MAXRECORDS = 26_000
_BACKFILL_CHUNK      = 3

# CCI component ticker (fx_history.json orientation) → Barchart forex symbol.
# Orientations match: "BRL=X" stores BRL-per-USD = ^USDBRL; "EURUSD=X" stores
# USD-per-EUR = ^EURUSD. The overnight RETURN is orientation-agnostic anyway
# (the model normalises with _strength_sign), but keeping them aligned lets the
# raw levels be eyeballed against fx_history.
_BARCHART_FX = {
    "BRL=X":    "^USDBRL",
    "VND=X":    "^USDVND",
    "COP=X":    "^USDCOP",
    "IDR=X":    "^USDIDR",
    "PEN=X":    "^USDPEN",
    "EURUSD=X": "^EURUSD",
    "JPY=X":    "^USDJPY",
    "CHF=X":    "^USDCHF",
    "CNY=X":    "^USDCNY",
    "CAD=X":    "^USDCAD",
    "KRW=X":    "^USDKRW",
    "GBP=X":    "^USDGBP",
}


async def _fetch_barchart_15m(symbols: list[str], maxrecords: int,
                              chunk: int = 0) -> dict[str, str]:
    """{barchart_symbol: raw_csv} — same XSRF-cookie in-page fetch as
    fetch_intraday_kc_rc.py, initialised from a forex chart page.

    `chunk` splits the symbol list across several evaluate() calls on the same
    page. At the daily maxrecords the whole basket is a few hundred KB and one
    round-trip is fine; a backfill pull is ~1.5 MB PER liquid pair, and holding
    a dozen of those in the page before serialising them over CDP is how you
    turn a slow fetch into an OOM. 0 = no chunking (the daily path, unchanged).
    """
    from playwright.async_api import async_playwright
    out: dict[str, str] = {}
    batches = ([symbols[i:i + chunk] for i in range(0, len(symbols), chunk)]
               if chunk else [symbols])
    init = f"https://www.barchart.com/forex/quotes/{symbols[0]}/interactive-chart"
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        try:
            await pg.goto(init, wait_until="domcontentloaded", timeout=30000)
            await pg.wait_for_timeout(3500)
            for batch in batches:
                out.update(await pg.evaluate(
                    """async ({syms, maxrec}) => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const xsrf = getCookie('XSRF-TOKEN');
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': xsrf, 'accept': 'text/plain,*/*' } };
                    const res = {};
                    for (const s of syms) {
                        const url = 'https://www.barchart.com/proxies/timeseries/queryminutes.ashx?symbol='
                            + encodeURIComponent(s)
                            + '&interval=15&maxrecords=' + maxrec
                            + '&order=asc&volume=contract&contractroll=combined';
                        try { const r = await fetch(url, h); res[s] = r.ok ? await r.text() : ''; }
                        catch (e) { res[s] = ''; }
                    }
                    return res;
                }""",
                    {"syms": batch, "maxrec": maxrecords},
                ))
        except Exception as e:  # noqa: BLE001
            print(f"[fx_snaps] Barchart fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


def _parse_bars(csv_text: str) -> list[tuple[datetime, float]]:
    """[(aware start datetime, close)] from a queryminutes CSV (Chicago-stamped)."""
    out = []
    for line in (csv_text or "").strip().splitlines():
        parts = line.split(",")
        if len(parts) < 6:
            continue
        try:
            ct = datetime.strptime(parts[0].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=_CHICAGO)
            close = float(parts[-2])
        except (ValueError, TypeError):
            continue
        out.append((ct, close))
    return out


def _anchors(bars: list[tuple[datetime, float]]) -> tuple[dict, dict]:
    """(london_1730, utc_0300) anchor maps for one pair.

    london_1730[london_date] = close of the bar starting 17:15 Europe/London.
    utc_0300[utc_date]       = close of the LATEST bar starting ≤ 02:45 UTC
                               that day (i.e. the 03:00 UTC price).
    """
    l1730: dict[str, float] = {}
    u0300: dict[str, tuple[str, float]] = {}   # date → (HH:MM, close), keep max ≤ 02:45
    for dt, close in bars:
        ldn = dt.astimezone(_LONDON)
        if ldn.strftime("%H:%M") == "17:15":
            l1730[ldn.strftime("%Y-%m-%d")] = close
        utc = dt.astimezone(_UTC)
        hm = utc.strftime("%H:%M")
        if hm <= "02:45":
            d = utc.strftime("%Y-%m-%d")
            if d not in u0300 or hm > u0300[d][0]:
                u0300[d] = (hm, close)
    return l1730, {d: v for d, (_hm, v) in u0300.items()}


def _pair_days(l1730: dict, u0300: dict,
               max_gap_days: int = _MAX_PREV_GAP_DAYS) -> dict[str, dict]:
    """{session date D: {prev_1730, at_0300, prev_date}} — prev_1730 is the
    most recent London 17:30 anchor strictly BEFORE D.

    `max_gap_days` bounds how old that anchor may be. It exists because the
    thin pairs quote sporadically: ^USDPEN's 15-min series is sparse enough
    that 2000 bars reach back to 2022, and without a bound its "overnight"
    move can silently span a fortnight. Fine while those days carried one
    pair and never met the model's 6-pair majority — actively wrong once a
    deep pull makes the same days usable. 4 days covers Fri→Mon plus one
    holiday; anything longer is not an overnight move and is dropped.
    """
    out: dict[str, dict] = {}
    ldn_dates = sorted(l1730)
    for d in sorted(u0300):
        prevs = [x for x in ldn_dates if x < d]
        if not prevs:
            continue
        prev = prevs[-1]
        gap = (datetime.strptime(d, "%Y-%m-%d")
               - datetime.strptime(prev, "%Y-%m-%d")).days
        if gap > max_gap_days:
            continue
        out[d] = {"prev_1730": l1730[prev], "at_0300": u0300[d], "prev_date": prev}
    return out


_BRENT_SYMBOL = "CB*1"      # Barchart continuous front Brent
_BRENT_OUT    = _REPO / "data" / "brent_intraday_anchors.json"


def _update_brent_anchors(bars: list[tuple[datetime, float]]) -> int:
    """Append NEW days' Brent anchors from the continuous-front bars.

    The backfilled per-contract rows (backfill_brent_intraday.py) are higher
    quality (roll-immune) and are never overwritten — this only fills dates the
    file doesn't have yet, keeping the brent_overnight feature current daily."""
    if not bars:
        return 0
    l1730, u0300 = _anchors(bars)
    fresh = _pair_days(l1730, u0300)
    existing = []
    if _BRENT_OUT.exists():
        try:
            existing = json.loads(_BRENT_OUT.read_text(encoding="utf-8")).get("days") or []
        except Exception:
            existing = []
    have = {r["date"] for r in existing}
    added = [{"date": d, "symbol": _BRENT_SYMBOL, **rec}
             for d, rec in fresh.items() if d not in have]
    if not added:
        return 0
    days = sorted(existing + added, key=lambda r: r["date"])
    safe_write_json(_BRENT_OUT, {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "source": "backfill (per-contract) + daily continuous-front appends",
        "days": days,
    }, ensure_ascii=False, indent=1)
    return len(added)


def _agrees(old: dict, new: dict, tol: float = 1e-6) -> bool:
    """Do a stored record and a freshly-pulled one describe the same anchors?"""
    for k in ("prev_1730", "at_0300"):
        a, b = old.get(k), new.get(k)
        if not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
            return False
        if a == 0 or abs(b / a - 1.0) > tol:
            return False
    return True


def run(maxrecords: int = 2000, backfill: bool = False) -> dict:
    """Daily append (default) or deep historical backfill.

    The two differ in exactly two places, and both differences exist to
    protect the forward-captured record:

      * merge policy — the daily run lets the newest fetch win per pair
        (it is re-reading today, and today's later bars are better). A
        backfill only FILLS GAPS: where a stored value already exists it is
        kept, and the freshly-pulled one is used to AUDIT it. If a deep pull
        disagreed with what we captured live, that is a finding to report,
        not a value to overwrite.
      * Brent — skipped on backfill. Those anchors come from the continuous
        front contract, so a deep pull would spread roll-contaminated
        anchors across old dates that the per-contract backfill already
        covers properly.
    """
    tickers = list(_BARCHART_FX)
    symbols = [_BARCHART_FX[t] for t in tickers]
    if not backfill:
        symbols.append(_BRENT_SYMBOL)
    raw = asyncio.run(_fetch_barchart_15m(
        symbols, maxrecords, chunk=_BACKFILL_CHUNK if backfill else 0))

    if backfill:
        print("[fx_snaps] backfill mode — Brent anchors left alone "
              "(continuous-front bars are roll-contaminated for old dates)")
    else:
        n_brent = _update_brent_anchors(_parse_bars(raw.get(_BRENT_SYMBOL, "")))
        print(f"[fx_snaps] brent anchors: +{n_brent} new day(s)")

    per_day: dict[str, dict] = {}
    ok_pairs = 0
    for ticker in tickers:
        bars = _parse_bars(raw.get(_BARCHART_FX[ticker], ""))
        if not bars:
            print(f"[fx_snaps] {ticker} ({_BARCHART_FX[ticker]}): no bars — skipped")
            continue
        ok_pairs += 1
        l1730, u0300 = _anchors(bars)
        pd_ = _pair_days(l1730, u0300)
        for d, rec in pd_.items():
            per_day.setdefault(d, {})[ticker] = rec
        if backfill:
            span = f"{min(pd_)} → {max(pd_)}" if pd_ else "none"
            print(f"[fx_snaps] {ticker:9s} {len(bars):6d} bars · "
                  f"{len(pd_):4d} anchor days · {span}")

    if not per_day:
        print("[fx_snaps] no usable days this run — retaining existing file")
        return {"ok": False, "pairs": ok_pairs, "days": 0}

    existing: list = []
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding="utf-8")).get("days") or []
        except Exception:
            existing = []
    by_date = {r["date"]: r for r in existing if r.get("date")}
    filled = kept = mismatched = 0
    for d, pairs in per_day.items():
        row = by_date.setdefault(d, {"date": d, "pairs": {}})
        if not backfill:
            row["pairs"].update(pairs)      # newest fetch wins per pair
            continue
        for ticker, rec in pairs.items():
            old = row["pairs"].get(ticker)
            if old is None:
                row["pairs"][ticker] = rec
                filled += 1
            elif _agrees(old, rec):
                kept += 1
            else:
                mismatched += 1
                print(f"[fx_snaps] MISMATCH {d} {ticker}: stored "
                      f"{old.get('prev_1730')}→{old.get('at_0300')} vs pulled "
                      f"{rec.get('prev_1730')}→{rec.get('at_0300')} (stored kept)")
    if backfill:
        agree_pct = 100.0 * kept / (kept + mismatched) if (kept + mismatched) else float("nan")
        print(f"[fx_snaps] backfill merge: +{filled} new pair-days · "
              f"{kept} confirmed / {mismatched} mismatched on overlap "
              f"({agree_pct:.2f}% agreement)")

    ordered = sorted(by_date.values(), key=lambda r: r["date"])
    if len(ordered) > _KEEP_DAYS:
        print(f"[fx_snaps] retention: dropping {len(ordered) - _KEEP_DAYS} "
              f"oldest row(s) beyond the {_KEEP_DAYS}-row window "
              f"(oldest kept {ordered[-_KEEP_DAYS]['date']})")
    days = ordered[-_KEEP_DAYS:]
    safe_write_json(
        OUT_PATH,
        {"scraped_at": datetime.utcnow().isoformat() + "Z", "days": days},
        ensure_ascii=False, indent=1)

    usable = [r["date"] for r in days if len(r["pairs"]) >= 6]
    print(f"[fx_snaps] pairs ok {ok_pairs}/{len(tickers)} · {len(days)} days stored "
          f"({len(usable)} with ≥6-pair coverage) · latest {days[-1]['date']}")
    if usable:
        # The model's gate is a 6-pair MAJORITY of the basket, so this — not
        # the row count — is what actually feeds cci_overnight.
        print(f"[fx_snaps] usable span {usable[0]} → {usable[-1]}")
    return {"ok": True, "pairs": ok_pairs, "days": len(days), "usable": len(usable)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fetch intraday FX anchors (17:30 London / 03:00 UTC) for the CCI overnight feature.")
    ap.add_argument("--maxrecords", type=int, default=2000)
    ap.add_argument("--backfill", action="store_true",
                    help=f"deep historical pull ({_BACKFILL_MAXRECORDS} bars/pair, "
                         "gap-fill only, audits overlap against the stored record)")
    args = ap.parse_args()
    maxrec = args.maxrecords
    if args.backfill and maxrec == 2000:
        maxrec = _BACKFILL_MAXRECORDS
    status = run(maxrecords=maxrec, backfill=args.backfill)
    # Non-fatal by design: the open-direction model runs fine without the
    # feature until snapshots accumulate. Exit 0 either way; the log job's
    # step-level continue-on-error is belt-and-braces.
    sys.exit(0)
