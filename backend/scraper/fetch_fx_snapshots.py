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
  --backfill deep pull. queryminutes caps a response at 5,000 records however
            many are asked for (MEASURED — a 40,000 ask returned exactly 5,000
            for all twelve pairs), so depth comes from PAGING the window
            backwards rather than from a bigger number. Gap-fill only: stored
            values are never overwritten, they are AUDITED against the fresh
            pull and disagreements reported. Run it by dispatching workflow
            1.16b, which commits data/fx_backfill_source_reach.json — what the
            source actually served, per pair.

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
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.validate_export import safe_write_json  # noqa: E402

_REPO    = Path(__file__).resolve().parents[2]
OUT_PATH = _REPO / "frontend" / "public" / "data" / "fx_intraday_snapshots.json"
# Written by --backfill only: how deep the SOURCE went, per pair.
REPORT_PATH = _REPO / "data" / "fx_backfill_source_reach.json"

_CHICAGO = ZoneInfo("America/Chicago")
_LONDON  = ZoneInfo("Europe/London")
_UTC     = UTC

# Rows retained. Was 500, which the 2026-08-20 backfill filled exactly — the
# next run would have started dropping the oldest rows to make room, and once
# a backfill can no longer reach that far back (the source's own limit moves
# forward with time) a dropped day is gone for good. 1200 covers the model's
# whole ~1500-session frame with room to spare at ~700 bytes a row.
_KEEP_DAYS = 1200

# How stale the prior-session 17:30 anchor may be, in calendar days. See
# _pair_days — this is what keeps a sparsely-quoted pair from contributing a
# multi-day move labelled "overnight".
_MAX_PREV_GAP_DAYS = 4

# Backfill pull depth. A liquid pair prints 96 bars a session (24h weekday
# tape ÷ 15 min), so the record count converts to sessions almost directly.
#
# Two thresholds matter downstream, and they are far apart:
#   40  usable days — cci_overnight's COVERAGE gate. 200 sessions clears this
#       many times over, and is enough to walk-forward-test the feature on a
#       sample worth believing (today's n=51 is not).
#   252 TRAINABLE rows — what active_features() needs before it will admit the
#       feature at all (the gate added in #719, after a thin feature took the
#       model dark). Only ~2/3 of calendar sessions are trainable — roll days
#       are unlabelled and kc_after_rc_diff has holes — so 252 trainable rows
#       means roughly 384 calendar sessions of coverage, not 252.
# A single response is capped at _RESPONSE_CAP records regardless, so this is
# per PAGE, not per pull — _deep_bars walks the window backwards to get depth.
_BACKFILL_MAXRECORDS = 5_000
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
                              chunk: int = 0,
                              extra_qs: dict[str, str] | None = None) -> dict[str, str]:
    """{barchart_symbol: raw_csv} — same XSRF-cookie in-page fetch as
    fetch_intraday_kc_rc.py, initialised from a forex chart page.

    `chunk` splits the symbol list across several evaluate() calls on the same
    page. At the daily maxrecords the whole basket is a few hundred KB and one
    round-trip is fine; a backfill pull is ~1.5 MB PER liquid pair, and holding
    a dozen of those in the page before serialising them over CDP is how you
    turn a slow fetch into an OOM. 0 = no chunking (the daily path, unchanged).

    `extra_qs` appends a per-symbol query fragment — how the backfill walks
    backwards past the endpoint's 5,000-record ceiling (see _deep_bars).
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
                    """async ({syms, maxrec, extra}) => {
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
                            + '&order=asc&volume=contract&contractroll=combined'
                            + (extra[s] || '');
                        try { const r = await fetch(url, h); res[s] = r.ok ? await r.text() : ''; }
                        catch (e) { res[s] = ''; }
                    }
                    return res;
                }""",
                    {"syms": batch, "maxrec": maxrecords,
                     "extra": {s: (extra_qs or {}).get(s, "") for s in batch}},
                ))
        except Exception as e:  # noqa: BLE001
            print(f"[fx_snaps] Barchart fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


# queryminutes.ashx caps a response at 5,000 records — MEASURED, not assumed:
# a 40,000-record ask returned exactly 5,000 for all twelve pairs
# (data/fx_backfill_source_reach.json, run 2 of workflow 1.16b). At 96 bars a
# session that is ~52 sessions for a liquid pair, which is the entire reason
# the first backfill added no new liquid-pair days. Going deeper therefore
# means WALKING BACKWARDS, one window at a time.
#
# Barchart is not documented publicly, so the cut-off parameter is probed
# rather than assumed: each candidate is tried once against a real symbol and
# accepted only if the returned window actually moves older. If none does,
# the backfill degrades to exactly the single-page behaviour it had before
# and the report says `paging_param: null` — a measured "this source cannot
# go deeper", not a silent no-op.
_RESPONSE_CAP = 5_000
_PAGE_PROBES = [
    ("end",     "%Y%m%d%H%M%S"),
    ("end",     "%Y-%m-%d %H:%M:%S"),
    ("endDate", "%Y%m%d%H%M%S"),
    ("endDate", "%Y-%m-%d"),
    ("maxDate", "%Y%m%d%H%M%S"),
    ("to",      "%Y%m%d%H%M%S"),
]
_MAX_PAGES = 10


def _sessions(bars: list) -> int:
    return len({dt.astimezone(_UTC).date() for dt, _c in bars})


async def _probe_paging(symbol: str, earliest: datetime, maxrecords: int):
    """Find the query parameter that moves the window older. (name, fmt) or None."""
    for name, fmt in _PAGE_PROBES:
        qs = f"&{name}={quote(earliest.strftime(fmt))}"
        raw = await _fetch_barchart_15m([symbol], maxrecords, extra_qs={symbol: qs})
        bars = _parse_bars(raw.get(symbol, ""))
        if bars and bars[0][0] < earliest - timedelta(hours=1):
            print(f"[fx_snaps] paging works via '{name}' ({fmt}) — "
                  f"{symbol} reached back to {bars[0][0].date()}")
            return name, fmt
        print(f"[fx_snaps] paging probe '{name}' ({fmt}): no older data returned")
    return None


async def _deep_bars(symbols: list[str], maxrecords: int, target_sessions: int):
    """{symbol: bars} pulled as deep as the source allows, plus (param, pages).

    Page 1 is the ordinary request. From there each symbol asks for the window
    ENDING at its own current earliest bar, so pairs that are already deep
    enough drop out of later pages instead of re-fetching what we have.
    """
    raw = await _fetch_barchart_15m(symbols, maxrecords, chunk=_BACKFILL_CHUNK)
    acc = {s: _parse_bars(raw.get(s, "")) for s in symbols}
    seeded = {s: b for s, b in acc.items() if b}
    if not seeded:
        return acc, None, 1

    # Probe on the symbol with the most bars — the likeliest to have more.
    probe_sym = max(seeded, key=lambda s: len(seeded[s]))
    probe = await _probe_paging(probe_sym, seeded[probe_sym][0][0], maxrecords)
    if probe is None:
        print("[fx_snaps] endpoint refuses a cut-off parameter — single page only")
        return acc, None, 1
    name, fmt = probe

    pages = 1
    for page in range(2, _MAX_PAGES + 1):
        need = [s for s in symbols if acc[s] and _sessions(acc[s]) < target_sessions]
        if not need:
            break
        extra = {s: f"&{name}={quote(acc[s][0][0].strftime(fmt))}" for s in need}
        raw = await _fetch_barchart_15m(need, maxrecords, chunk=_BACKFILL_CHUNK,
                                        extra_qs=extra)
        grew = 0
        for s in need:
            older = [b for b in _parse_bars(raw.get(s, "")) if b[0] < acc[s][0][0]]
            if older:
                acc[s] = sorted(older + acc[s], key=lambda b: b[0])
                grew += 1
        pages = page
        print(f"[fx_snaps] page {page}: {grew}/{len(need)} pair(s) went deeper")
        if not grew:                      # the window stopped moving — done
            break
    return acc, name, pages


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
_BRENT_MONTHS = "FGHJKMNQUVXZ"   # Brent lists every month


def brent_front_candidates(today: datetime, n: int = 4) -> list[str]:
    """The next `n` listed Brent contracts, Barchart style (CB + month + YY).

    The daily appender used to rely solely on the continuous symbol `CB*1`,
    and when that stopped returning bars on 2026-07-03 the anchors froze for
    seven weeks without a single failed run — `_update_brent_anchors` returns
    0 both when the symbol is dead and when there is simply nothing new, so
    the log said "+0 new day(s)" either way.

    backfill_brent_intraday.py never had this problem because it addresses
    contracts explicitly and picks the front by traded volume. These are the
    fallback symbols; Brent trades ~2 months ahead, so a handful from the
    current month covers the front comfortably.
    """
    out, y, m = [], today.year, today.month
    for _ in range(n):
        out.append(f"CB{_BRENT_MONTHS[m - 1]}{y % 100:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def _update_brent_anchors(bars: list[tuple[datetime, float]],
                          symbol: str = _BRENT_SYMBOL) -> int:
    """Append NEW days' Brent anchors.

    The backfilled per-contract rows (backfill_brent_intraday.py) are higher
    quality (roll-immune) and are never overwritten — this only fills dates the
    file doesn't have yet, keeping the brent_overnight feature current daily.
    `symbol` is recorded per row so a fallback contract is auditable later.
    """
    if not bars:
        # A silent no-op and a dead symbol looked identical here, which is how
        # the anchor file sat frozen from 2026-07-03 without anyone noticing.
        print(f"[fx_snaps] WARNING: no bars for {_BRENT_SYMBOL} — brent anchors "
              "NOT updated. If this repeats, the Barchart symbol has changed.",
              file=sys.stderr)
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
    added = [{"date": d, "symbol": symbol, **rec}
             for d, rec in fresh.items() if d not in have]
    if not added:
        return 0
    days = sorted(existing + added, key=lambda r: r["date"])
    safe_write_json(_BRENT_OUT, {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "source": "backfill (per-contract) + daily front-contract appends",
        "days": days,
    }, ensure_ascii=False, indent=1)
    return len(added)


def _brent_pick(by_symbol: dict[str, list]) -> tuple[str, list]:
    """(symbol, bars) — the continuous symbol if it returned anything, else
    the candidate contract whose bars reach FURTHEST FORWARD IN TIME.

    Not the one with the most bars. Brent lists every month and expires two
    months before delivery, so several candidates are already dead by the time
    we ask, and a dead contract still serves a full `maxrecords` window of its
    own history. On 2026-08-23 that is exactly what happened: CB*1 returned
    nothing, CBQ26 (August, expired end of June) returned 2000 bars, won the
    count comparison against the live October contract — every one of those
    bars predating the frozen 2026-07-03 anchor — and the run reported
    "+0 new day(s)" while looking like the fallback had worked.

    Recency decides; bar count only breaks ties between contracts that both
    trade up to the same moment. A day-to-day roll between contracts is
    harmless here: the anchors feed brent_overnight, a move measured BETWEEN
    two anchors of the same session, so a level shift across sessions never
    enters the feature.
    """
    cont = by_symbol.get(_BRENT_SYMBOL) or []
    if cont:
        return _BRENT_SYMBOL, cont
    fallbacks = {s: b for s, b in by_symbol.items() if s != _BRENT_SYMBOL and b}
    if not fallbacks:
        return _BRENT_SYMBOL, []
    # max() over the bar timestamps rather than bars[-1] — the CSV arrives in
    # ascending order today, but the pick must not silently invert if that
    # ever changes.
    def _last(sym: str) -> datetime:
        return max(b[0] for b in fallbacks[sym])
    best = max(fallbacks, key=lambda s: (_last(s), len(fallbacks[s])))
    print(f"[fx_snaps] brent: '{_BRENT_SYMBOL}' returned NO bars — "
          f"falling back to {best} ({len(fallbacks[best])} bars, "
          f"last {_last(best):%Y-%m-%d %H:%M})", file=sys.stderr)
    return best, fallbacks[best]


def _write_backfill_report(maxrecords: int, reach: dict, filled: int, kept: int,
                           mismatched: int, usable: list[str],
                           paging_param: str | None = None,
                           pages: int = 1) -> None:
    """Commit what the SOURCE was actually willing to serve, per pair.

    A backfill's most valuable output is not the rows it adds, it is the
    answer to "how far back can this go at all" — and that answer lives only
    in a run log that expires. Writing it next to the data makes the ceiling
    auditable, and makes a re-run's improvement (or lack of one) a diff
    rather than a memory. `bars` vs `maxrecords` is the tell: bars well under
    the ask means the source ran out of history, not that we asked too
    politely.
    """
    ranked = sorted(reach.items(), key=lambda kv: -kv[1].get("anchor_days", 0))
    safe_write_json(REPORT_PATH, {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "note": ("What Barchart's queryminutes actually returned per pair for a "
                 "--backfill pull. bars << maxrecords means the source is out of "
                 "history for that symbol; the liquid pairs print 96 bars a "
                 "session, the thin ones far fewer, so the same record count "
                 "buys wildly different calendar reach."),
        "maxrecords_requested": maxrecords,
        "response_cap": _RESPONSE_CAP,
        "paging_param": paging_param,      # null = the endpoint refused every
        "pages_fetched": pages,            #        cut-off parameter probed
        "merge": {"new_pair_days": filled, "confirmed_on_overlap": kept,
                  "mismatched_on_overlap": mismatched},
        "usable_days_after": len(usable),
        "usable_span": [usable[0], usable[-1]] if usable else None,
        "pairs": dict(ranked),
    }, ensure_ascii=False, indent=1)
    print(f"[fx_snaps] source-reach report → {REPORT_PATH.name}")


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
    paging_param, pages = None, 1
    if backfill:
        # Sessions worth aiming for: the trainability gate is 252 rows and
        # only ~2/3 of calendar sessions are trainable.
        bars_by_symbol, paging_param, pages = asyncio.run(
            _deep_bars(symbols, min(maxrecords, _RESPONSE_CAP), target_sessions=400))
        print("[fx_snaps] backfill mode — Brent anchors left alone "
              "(continuous-front bars are roll-contaminated for old dates)")
    else:
        brent_syms = [_BRENT_SYMBOL, *brent_front_candidates(datetime.now(_UTC))]
        raw = asyncio.run(_fetch_barchart_15m(symbols + brent_syms, maxrecords))
        bars_by_symbol = {s: _parse_bars(raw.get(s, ""))
                          for s in symbols + brent_syms}
        b_sym, b_bars = _brent_pick({s: bars_by_symbol.get(s) or []
                                     for s in brent_syms})
        n_brent = _update_brent_anchors(b_bars, symbol=b_sym)
        if not b_bars:
            # Distinguish a dead symbol from a quiet day. Conflating the two is
            # what let the anchors freeze from 2026-07-03 to 2026-08-21 with
            # every run green — see brent_front_candidates.
            print("[fx_snaps] brent: NO bars from any symbol "
                  f"({', '.join(brent_syms)}) — anchors NOT advancing",
                  file=sys.stderr)
        else:
            print(f"[fx_snaps] brent anchors ({b_sym}): +{n_brent} new day(s)")

    per_day: dict[str, dict] = {}
    ok_pairs = 0
    reach: dict[str, dict] = {}
    for ticker in tickers:
        bars = bars_by_symbol.get(_BARCHART_FX[ticker]) or []
        if not bars:
            print(f"[fx_snaps] {ticker} ({_BARCHART_FX[ticker]}): no bars — skipped")
            reach[ticker] = {"bars": 0, "anchor_days": 0}
            continue
        ok_pairs += 1
        l1730, u0300 = _anchors(bars)
        pd_ = _pair_days(l1730, u0300)
        for d, rec in pd_.items():
            per_day.setdefault(d, {})[ticker] = rec
        reach[ticker] = {
            "bars": len(bars),
            "anchor_days": len(pd_),
            "first_bar": bars[0][0].astimezone(_UTC).strftime("%Y-%m-%d"),
            "last_bar":  bars[-1][0].astimezone(_UTC).strftime("%Y-%m-%d"),
            "first_day": min(pd_) if pd_ else None,
            "last_day":  max(pd_) if pd_ else None,
        }
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
    if backfill:
        _write_backfill_report(maxrecords, reach, filled, kept, mismatched, usable,
                               paging_param, pages)
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
