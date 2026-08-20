"""
backfill_cot_deep.py — one-off deep-history backfill for the COT×harvest
multi-day model track (docs/research/open-price-direction-findings.md).

The COT×harvest interaction (commercials' positioning conditioned on the
robusta harvest calendar) tested directionally-coherent but statistically
inconclusive on the 6 years (~5 harvest cycles) we ship. This backfill roughly
doubles the cycles so the hypothesis can be re-tested with real power.

Two artifacts, both committed:

1. data/ice_cot_robusta_history.json — ALL weekly ICE Robusta Coffee COT rows
   (as-of date, OI, commercial pmpu long/short, managed-money long/short) from
   the ICE COTHist{year} CSVs (2011→2021; robusta appears once ICE Europe took
   over the LIFFE contract, so early years may be empty — reported, not fatal),
   merged with the ldn series already in frontend/public/data/cot.json
   (2020→present, preferred on overlap).

2. data/rc_daily_continuous.json — long daily settles for the continuous
   front robusta (RM*1) and arabica (KC*1) from Barchart queryeod (same
   XSRF-cookie proxy mechanism as the proven 15-min fetchers). Needed for
   forward-return labels back to the start of the COT history.

Run: workflow_dispatch (.github/workflows/backfill-cot-deep.yml) or locally
     with Playwright installed. Pure requests for part 1; Playwright for 2.
"""
from __future__ import annotations

import asyncio
import io
import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.sources.macro_cot import (  # noqa: E402
    _CFTC_MM_LONG,
    _CFTC_MM_SHORT,
    _CFTC_OI,
    _COL_PMPU_LONG,
    _COL_PMPU_SHORT,
    _ICE_DATE_COL,
    _ICE_MARKET_COL,
)
from scraper.utils.http import get_with_backoff  # noqa: E402

_REPO      = Path(__file__).resolve().parents[2]
_COT_JSON  = _REPO / "frontend" / "public" / "data" / "cot.json"
_OUT_COT   = _REPO / "data" / "ice_cot_robusta_history.json"
_OUT_PX    = _REPO / "data" / "rc_daily_continuous.json"

_ROBUSTA_FILTER = "Robusta"          # contains-match: contract naming drifted
_YEARS = range(2011, 2022)           # 2022+ already covered by cot.json ldn


# ── Part 1: ICE COTHist weekly rows ──────────────────────────────────────────

from scraper.sources.macro_cot import _ICE_HEADERS  # noqa: E402 — shared UA

def _year_rows(year: int) -> list[dict]:
    url = f"https://www.ice.com/publicdocs/futures/COTHist{year}.csv"
    try:
        # Browser UA: ICE 403s the default requests agent (see macro_cot).
        resp = get_with_backoff(url, timeout=(10, 120), headers=_ICE_HEADERS)
        df = pd.read_csv(io.StringIO(resp.content.decode("utf-8-sig")), low_memory=False)
    except Exception as e:
        print(f"[cot_deep] {year}: download/parse failed — {e}")
        return []
    if _ICE_MARKET_COL not in df.columns:
        print(f"[cot_deep] {year}: unexpected columns — skipped")
        return []
    rows = df[df[_ICE_MARKET_COL].str.contains(_ROBUSTA_FILTER, na=False)].copy()
    if rows.empty:
        print(f"[cot_deep] {year}: no robusta rows (pre-migration?)")
        return []
    rows["_d"] = pd.to_datetime(rows[_ICE_DATE_COL], format="%y%m%d", errors="coerce")
    rows = rows.dropna(subset=["_d"])

    def _i(row, col):
        try:
            v = row.get(col)
            return int(v) if pd.notna(v) else None
        except (TypeError, ValueError):
            return None

    out = []
    for _, r in rows.iterrows():
        out.append({
            "date":       r["_d"].strftime("%Y-%m-%d"),
            "oi":         _i(r, _CFTC_OI),
            "pmpu_long":  _i(r, _COL_PMPU_LONG),
            "pmpu_short": _i(r, _COL_PMPU_SHORT),
            "mm_long":    _i(r, _CFTC_MM_LONG),
            "mm_short":   _i(r, _CFTC_MM_SHORT),
            "market":     str(r[_ICE_MARKET_COL]).strip(),
        })
    print(f"[cot_deep] {year}: {len(out)} robusta weekly rows")
    return out


def _existing_ldn_rows() -> list[dict]:
    """The already-shipped ldn series (cot.json, 2020→present)."""
    try:
        weeks = json.loads(_COT_JSON.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[cot_deep] cot.json unreadable ({e}) — merging historic only")
        return []
    out = []
    for w in weeks:
        l = w.get("ldn") or {}
        if l.get("pmpu_long") is None or l.get("pmpu_short") is None:
            continue
        out.append({
            "date":       w["date"],
            "oi":         l.get("oi_total"),
            "pmpu_long":  l["pmpu_long"],
            "pmpu_short": l["pmpu_short"],
            "mm_long":    l.get("mm_long"),
            "mm_short":   l.get("mm_short"),
            "market":     "cot.json ldn",
        })
    return out


def backfill_cot() -> int:
    by_date: dict[str, dict] = {}
    for year in _YEARS:
        for r in _year_rows(year):
            by_date[r["date"]] = r
    for r in _existing_ldn_rows():        # current pipeline wins on overlap
        by_date[r["date"]] = r
    if not by_date:
        print("[cot_deep] nothing fetched — leaving existing file untouched")
        return 0
    rows = sorted(by_date.values(), key=lambda r: r["date"])
    _OUT_COT.write_text(json.dumps({
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "source": "ICE COTHist CSVs (2011–2021) + cot.json ldn (2020→)",
        "rows": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[cot_deep] wrote {len(rows)} weekly rows "
          f"({rows[0]['date']} → {rows[-1]['date']})")
    return len(rows)


# ── Part 2: long daily continuous settles (Barchart queryeod) ────────────────

async def _fetch_eod(symbols: list[str], maxrecords: int) -> dict[str, str]:
    from playwright.async_api import async_playwright
    out: dict[str, str] = {}
    init = f"https://www.barchart.com/futures/quotes/{symbols[0]}/interactive-chart"
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
            out = await pg.evaluate(
                """async ({syms, maxrec}) => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                                           'accept': 'text/plain,*/*' } };
                    const res = {};
                    for (const s of syms) {
                        const url = 'https://www.barchart.com/proxies/timeseries/queryeod.ashx?symbol='
                            + encodeURIComponent(s)
                            + '&data=daily&maxrecords=' + maxrec
                            + '&order=asc&volume=contract&contractroll=combined';
                        try { const r = await fetch(url, h); res[s] = r.ok ? await r.text() : ''; }
                        catch (e) { res[s] = ''; }
                    }
                    return res;
                }""",
                {"syms": symbols, "maxrec": maxrecords},
            )
        except Exception as e:  # noqa: BLE001
            print(f"[cot_deep] Barchart EOD fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


def _parse_eod(csv_text: str) -> dict[str, float]:
    """queryeod CSV row: symbol,YYYY-MM-DD,open,high,low,close,volume[,oi]."""
    out: dict[str, float] = {}
    for line in (csv_text or "").strip().splitlines():
        p = line.split(",")
        if len(p) < 6:
            continue
        try:
            d = p[1].strip()
            datetime.strptime(d, "%Y-%m-%d")
            out[d] = float(p[5])
        except (ValueError, TypeError):
            continue
    return out


def backfill_prices(maxrecords: int = 6000) -> int:
    symbols = {"robusta": "RM*1", "arabica": "KC*1"}
    raw = asyncio.run(_fetch_eod(list(symbols.values()), maxrecords))
    series = {}
    for market, sym in symbols.items():
        px = _parse_eod(raw.get(sym, ""))
        if px:
            days = sorted(px)
            print(f"[cot_deep] {market} ({sym}): {len(px)} daily settles "
                  f"({days[0]} → {days[-1]})")
            series[market] = px
        else:
            print(f"[cot_deep] {market} ({sym}): no data")
    if not series:
        print("[cot_deep] no EOD data — leaving existing file untouched")
        return 0
    _OUT_PX.write_text(json.dumps({
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "source": "Barchart queryeod continuous front (RM*1 / KC*1), settle=close",
        "series": series,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    return sum(len(v) for v in series.values())


if __name__ == "__main__":
    n_cot = backfill_cot()
    n_px = backfill_prices()
    print(f"[cot_deep] done: {n_cot} COT weeks, {n_px} price points")
    sys.exit(0 if (n_cot or n_px) else 1)
