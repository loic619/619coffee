"""
BLS API helpers shared by the CPI scrapers.

The hard-learned lesson encoded here: the keyless BLS v2 API does NOT reject
an over-long year window — it silently serves only the FIRST 10 calendar
years of it. Both CPI scrapers asked for 11- and 16-year windows, got
"REQUEST_SUCCEEDED" every month, and shipped series frozen at 2025-12 and
2020-12 respectively while every run logged OK. Requests must therefore be
chunked into windows the API actually honours (10 calendar years keyless,
20 with a registered key), and callers must log the newest period they got.
"""
from __future__ import annotations

import logging
import time

import requests

logger = logging.getLogger(__name__)

_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

_PERIOD_TO_MONTH = {f"M{i:02d}": f"{i:02d}" for i in range(1, 13)}

# BLS intermittently 503s (observed from GH runners 2026-08-09). Short in-call
# retries ride out blips; a persistent outage falls through to the callers'
# cache-retention paths.
_RETRIES = 3
_RETRY_SLEEP_S = (5, 20)


def _post_chunk(payload: dict, headers: dict | None, timeout: int, tag: str,
                span: str) -> dict | None:
    for attempt in range(_RETRIES):
        try:
            r = requests.post(_URL, headers=headers or {}, json=payload, timeout=timeout)
            r.raise_for_status()
            body = r.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"[{tag}] BLS chunk {span} attempt {attempt + 1}: {exc}")
            if attempt < _RETRIES - 1:
                time.sleep(_RETRY_SLEEP_S[min(attempt, len(_RETRY_SLEEP_S) - 1)])
            continue
        if body.get("status") != "REQUEST_SUCCEEDED":
            logger.warning(f"[{tag}] BLS chunk {span} status "
                           f"{body.get('status')}: {body.get('message')}")
            return None
        return body
    # Plain requests exhausted. BLS's Cloudflare intermittently blocks
    # datacenter IPs on the keyless tier (observed: persistent 503s from GH
    # runners on 2026-08-09 while browsers passed) — retry through a real
    # browser, same proven pattern as the Barchart/Sucafina fetchers.
    return _browser_post_chunk(payload, tag, span)


def _browser_post_chunk(payload: dict, tag: str, span: str) -> dict | None:
    """Same-origin in-page POST via headless Chromium. Landing on an
    api.bls.gov URL first makes the fetch same-origin (no CORS), and the
    browser's TLS/JA3 fingerprint passes the bot filter that 503s requests."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning(f"[{tag}] BLS chunk {span}: playwright unavailable — no browser fallback")
        return None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            pg = browser.new_page()
            try:
                pg.goto(f"{_URL}CUUR0000SA0", wait_until="domcontentloaded", timeout=45000)
                body = pg.evaluate(
                    """async (payload) => {
                        const r = await fetch('%s', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify(payload),
                        });
                        return await r.json();
                    }""" % _URL,
                    payload,
                )
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"[{tag}] BLS chunk {span} browser fallback failed: {exc}")
        return None
    if not isinstance(body, dict) or body.get("status") != "REQUEST_SUCCEEDED":
        status = body.get("status") if isinstance(body, dict) else type(body).__name__
        logger.warning(f"[{tag}] BLS chunk {span} browser fallback status {status}")
        return None
    logger.info(f"[{tag}] BLS chunk {span}: served via browser fallback")
    return body


def year_chunks(start_year: int, end_year: int, max_span: int) -> list[tuple[int, int]]:
    """Inclusive [start, end] windows of ≤ max_span CALENDAR YEARS, oldest
    first. (2016, 2026, 10) → [(2016, 2025), (2026, 2026)]."""
    out: list[tuple[int, int]] = []
    s = start_year
    while s <= end_year:
        e = min(s + max_span - 1, end_year)
        out.append((s, e))
        s = e + 1
    return out


def fetch_series(series_ids: list[str], start_year: int, end_year: int,
                 api_key: str = "", headers: dict | None = None,
                 timeout: int = 30, tag: str = "bls") -> dict[str, list] | None:
    """Fetch monthly rows for the given series over [start_year, end_year],
    one request per API-honoured chunk, merged per series and sorted.

    Returns {series_id: [{"period": "YYYY-MM", "index": float}, …]} with only
    series that returned data, or None if EVERY chunk failed outright.
    """
    max_span = 20 if api_key else 10
    merged: dict[str, dict[str, float]] = {}
    any_ok = False
    for s, e in year_chunks(start_year, end_year, max_span):
        payload: dict = {
            "seriesid": series_ids,
            "startyear": str(s),
            "endyear": str(e),
        }
        if api_key:
            payload["registrationkey"] = api_key
        body = _post_chunk(payload, headers, timeout, tag, f"{s}-{e}")
        if body is None:
            continue
        any_ok = True
        for series in body.get("Results", {}).get("series", []):
            sid = series.get("seriesID")
            if not sid:
                continue
            bucket = merged.setdefault(sid, {})
            for d in series.get("data", []):
                month = _PERIOD_TO_MONTH.get(d.get("period", ""))
                if not month:            # skip annual averages (M13) etc.
                    continue
                try:
                    bucket[f"{d['year']}-{month}"] = float(d["value"])
                except (KeyError, TypeError, ValueError):
                    continue
    if not any_ok:
        return None
    return {
        sid: [{"period": p, "index": v} for p, v in sorted(rows.items())]
        for sid, rows in merged.items() if rows
    }


def newest_period(series_map: dict[str, list]) -> str | None:
    """Latest 'YYYY-MM' across all series — for the freshness log line."""
    periods = [r["period"] for rows in (series_map or {}).values() for r in rows]
    return max(periods) if periods else None
