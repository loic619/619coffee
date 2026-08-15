"""
backfill_options_history.py — seed the options archive from Barchart's
per-option EOD history (one-shot; re-runnable).

The probe established that /proxies/core-api/v1/historical/get serves a full
daily series (tradeTime, lastPrice, volume, openInterest) for every LIVE
option symbol — RMU26|3600C answered 299 rows back to Jun-2025 — but returns
nothing once an option has expired (KCU26 boards were empty one day after
expiry). So expired contracts are unrecoverable, and the deepest possible
backfill is: every strike of the currently-tracked boards, from listing to
today. From now on the daily archive keeps boards before they die.

For each archived day it also computes Black-76 IV + delta per side, using the
underlying future's settlement from data/contract_prices_archive.json and the
exchange-rule expiry — so the historical rows carry the same reconstruction
fields as the live ones (gamma/theta/vega derive from IV offline).

Run:  python backend/scraper/backfill_options_history.py [start YYYY-MM-DD]
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_options_json import (  # noqa: E402
    ARCHIVE,
    ARCHIVE_HEADER,
    INIT_URL,
    MARKETS,
    MAX_CONTRACTS,
    ROOT,
    _b76_delta,
    _implied_vol,
    _load_archive,
    _rule_expiry,
)

PRICES = ROOT / "data" / "contract_prices_archive.json"
DEFAULT_START = "2024-06-01"


async def _fetch_histories(start: str) -> dict:
    """{market: [{underlying, options: {optSym: {strike, type}},
                  hist: {optSym: [[date, last, vol, oi], ...]}}]}"""
    from playwright.async_api import async_playwright
    out: dict = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=45000)
        await pg.wait_for_timeout(3000)
        out = await pg.evaluate(
            """async ([roots, startDate, maxContracts]) => {
                function getCookie(n) {
                    const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                    return v ? decodeURIComponent(v[2]) : null;
                }
                const h = { credentials: 'include',
                            headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                                       'accept': 'application/json' } };
                const base = 'https://www.barchart.com/proxies/core-api/v1';
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                // Barchart throttles hard after ~60 rapid core-api calls:
                // pace every request and back off long on 429/5xx.
                const jfetch = async (url) => {
                    for (let i = 0; i < 4; i++) {
                        try {
                            const r = await fetch(url, h);
                            if (r.ok) return await r.json();
                            if (r.status !== 429 && r.status < 500) return null;
                        } catch (e) { /* retry */ }
                        await sleep(20000 * (i + 1));
                    }
                    return null;
                };
                const res = {};
                for (const [mkt, root] of Object.entries(roots)) {
                    const cj = await jfetch(base + '/quotes/get?symbol=' + root +
                        '%5EF&fields=symbol&orderBy=contractExpirationDate&orderDir=asc&limit=6&raw=1');
                    if (!cj) { res[mkt] = []; continue; }
                    const chain = (cj.data || [])
                        .map(c => (c.raw || c).symbol).filter(Boolean);
                    const blocks = [];
                    for (const und of chain) {
                        if (blocks.length >= maxContracts) break;
                        await sleep(1000);
                        const bj = await jfetch(base + '/quotes/get?symbol=' + und +
                            '&list=futures.options&fields=symbol,strike,optionType&raw=1&limit=999');
                        if (!bj) continue;
                        const bd = bj.data;
                        const arr = Array.isArray(bd) ? bd
                            : bd ? Object.values(bd).flat() : [];
                        const options = {};
                        for (const it of arr) {
                            const r = it.raw || it;
                            const s = String(r.symbol || '');
                            if (!s) continue;
                            // side comes from the SYMBOL suffix (KCZ6|1000C):
                            // the strike field is plain numeric, no C/P marker
                            const ot = String(r.optionType || '').toUpperCase();
                            const side = ot.startsWith('P') ? 'P'
                                : ot.startsWith('C') ? 'C'
                                : s.endsWith('P') ? 'P' : 'C';
                            let k = parseFloat(String(r.strike).replace(/[^0-9.\\-]/g, ''));
                            if (!isFinite(k)) {
                                const m = s.split('|')[1];
                                k = m ? parseFloat(m) / 10 : NaN;
                            }
                            if (!isFinite(k)) continue;
                            options[s] = { strike: k, type: side };
                        }
                        if (!Object.keys(options).length) continue;
                        // the underlying future's own settlement series, for
                        // historical IV where the local archive has no price
                        const futHist = {};
                        await sleep(1000);
                        const fj = await jfetch(base + '/historical/get?symbol=' +
                            encodeURIComponent(und) +
                            '&type=eod&startDate=' + startDate +
                            '&fields=tradeTime,lastPrice&raw=1&limit=600');
                        for (const x of ((fj && fj.data) || [])) {
                            const r = x.raw || x;
                            if (r.tradeTime && r.lastPrice != null)
                                futHist[String(r.tradeTime).slice(0, 10)] = r.lastPrice;
                        }
                        const hist = {};
                        let fails = 0;
                        for (const sym of Object.keys(options)) {
                            await sleep(900);
                            const hj = await jfetch(base + '/historical/get?symbol=' +
                                encodeURIComponent(sym) +
                                '&type=eod&startDate=' + startDate +
                                '&fields=tradeTime,lastPrice,volume,openInterest&raw=1&limit=600');
                            if (!hj) { fails++; continue; }
                            const rows = (hj.data || [])
                                .map(x => { const r = x.raw || x; return [
                                    r.tradeTime, r.lastPrice, r.volume, r.openInterest]; })
                                .filter(r => r[0]);
                            if (rows.length) hist[sym] = rows;
                        }
                        blocks.push({ underlying: und, options, hist, futHist, fails });
                    }
                    res[mkt] = blocks;
                }
                return res;
            }""",
            [MARKETS, start, MAX_CONTRACTS],
        )
        await browser.close()
    return out or {}


def _future_prices() -> dict:
    """{market: {date: {symbol: price}}} from the per-contract futures archive."""
    try:
        arch = json.loads(PRICES.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict = {}
    for mkt, days in arch.items():
        if mkt.startswith("_") or not isinstance(days, dict):  # skip _meta
            continue
        out[mkt] = {}
        for d, contracts in days.items():
            if not isinstance(contracts, dict):
                continue
            out[mkt][d] = {sym: v.get("price")
                           for sym, v in contracts.items()
                           if isinstance(v, dict)}
    return out


def _one_sided(board: dict) -> bool:
    """True when no row carries any put-side value (index 9+) — the mark of
    a partial/corrupted backfill board; real boards always have both sides."""
    rows = board.get("rows") or []
    return bool(rows) and all(
        all(v is None for v in r[9:]) for r in rows)


def main() -> int:
    start = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_START
    raw = asyncio.run(_fetch_histories(start))
    if not any(raw.values()):
        print("[backfill-options] nothing fetched")
        return 1
    fut = _future_prices()
    archive = _load_archive()
    days = archive.setdefault("days", {})
    n_cols = len(ARCHIVE_HEADER)
    c0, p0 = 1, 9          # call/put column offsets in the 17-col row
    added_days = 0
    replaced = 0

    for mkt, blocks in raw.items():
        # RM prices live under the robusta archive keyed RC-normalised symbols;
        # try both the board symbol and an RC-spelled variant.
        for blk in blocks:
            und = blk["underlying"]
            exp = _rule_expiry(und)
            # per-date per-strike accumulation
            by_day: dict[str, dict[float, list]] = {}
            for sym, series in (blk.get("hist") or {}).items():
                meta = blk["options"].get(sym) or {}
                strike, typ = meta.get("strike"), meta.get("type")
                if strike is None:
                    continue
                off = c0 if typ == "C" else p0
                for d, last, vol, oi in series:
                    d = str(d)[:10]
                    row = by_day.setdefault(d, {}).setdefault(
                        strike, [strike] + [None] * (n_cols - 1))
                    row[off + 0] = oi
                    row[off + 1] = vol
                    row[off + 2] = last
            # IV/delta per day: prefer the future's own fetched settlement
            # series, fall back to the local futures archive (RC-keyed for RM)
            fut_hist = blk.get("futHist") or {}
            px_days = fut.get(mkt) or {}
            for d, strikes in by_day.items():
                px = fut_hist.get(d)
                if px is None:
                    px = (px_days.get(d) or {}).get(und)
                if px is None and und.startswith("RM"):
                    px = (px_days.get(d) or {}).get("RC" + und[2:])
                t = None
                if exp:
                    t = (exp - date.fromisoformat(d)).days / 365.0
                for strike, row in strikes.items():
                    if px and t and t > 0:
                        for off, is_call in ((c0, True), (p0, False)):
                            last = row[off + 2]
                            if last:
                                iv = _implied_vol(last, px, strike, t, is_call)
                                row[off + 3] = iv
                                if iv:
                                    row[off + 4] = _b76_delta(px, strike, t, iv, is_call)
                # merge into archive. Keep an existing board unless ours is
                # strictly richer (more strikes) or the existing one is
                # one-sided (an earlier corrupted/partial backfill) — live
                # boards carry every listed strike so they always win.
                day_slot = days.setdefault(d, {})
                mkt_boards = day_slot.setdefault(mkt, [])
                new_board = {
                    "u": und, "px": px,
                    "dte": (exp - date.fromisoformat(d)).days if exp else None,
                    "rows": [strikes[k] for k in sorted(strikes)],
                    "bf": 1,
                }
                old = next((b for b in mkt_boards if b.get("u") == und), None)
                if old is None:
                    mkt_boards.append(new_board)
                    added_days += 1
                elif (len(new_board["rows"]) > len(old.get("rows") or [])
                      or _one_sided(old)):
                    mkt_boards[mkt_boards.index(old)] = new_board
                    replaced += 1
            print(f"[backfill-options] {mkt} {und}: {len(by_day)} sessions "
                  f"({len(blk.get('hist') or {})} option series, "
                  f"{blk.get('fails') or 0} failed fetches)")

    ARCHIVE.write_text(json.dumps(archive, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")
    print(f"[backfill-options] archive now holds {len(days)} dates "
          f"(+{added_days} board-days, {replaced} replaced), "
          f"{ARCHIVE.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
