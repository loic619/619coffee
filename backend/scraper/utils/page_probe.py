"""Probe a list of same-host URL candidates with one Playwright page.

Several origin scrapers (ECX Ethiopia, IHCAFE Honduras, FNC Colombia) publish
the same figure at a URL that moves between site redesigns, so each keeps a
list of candidate paths and tries them in turn. They all wrote the same loop:

    for url in _URLS:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2_000)
            value = _extract(await page.content())
            if value:
                break
        except Exception as e:
            print(f"[tag] {url} failed: {e}")

The bug in that shape is the same one that cost the nightly export 270 s on
NSO Vietnam (see scraper/sources/vietnam_supply.py): every candidate is on the
SAME host, so when the host is unreachable each candidate burns the full
navigation timeout re-proving it. ECX was measured on 2026-08-14 doing exactly
that — 3 x 30 s = 90 s per run, on a workflow that runs several times a day,
to return nothing:

    [ethiopia] ECX https://www.ecx.com.et/ failed: Page.goto: Timeout 30000ms exceeded.
    [ethiopia] ECX https://www.ecx.com.et/CoffeeMarketSummary.aspx failed: Timeout 30000ms
    [ethiopia] ECX https://www.ecx.com.et/MarketData.aspx failed: Timeout 30000ms
    [ethiopia] ECX price not found — skipping

`probe_urls` keeps the candidate-list behaviour but stops after the first
NAVIGATION TIMEOUT, because that one failure has already established that the
host is not answering. Any other error (a 404, a redirect loop, a parse
problem) is specific to that one URL, so the remaining candidates are still
tried — which is the whole reason the list exists.

Deliberately NOT a deletion: unlike NSO, these hosts do answer sometimes. ECX
last returned a price on 2026-07-23 and that value is rendered in
EthiopiaTab.tsx, so the source has to keep working the moment the host is back.
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any


def _is_timeout(exc: Exception) -> bool:
    """True for a Playwright navigation timeout, without importing Playwright.

    Importing playwright._impl errors here would couple this helper to
    Playwright's internal module layout, which has moved between releases.
    The class name is the stable part of that contract.
    """
    return "timeout" in type(exc).__name__.lower() or "Timeout" in str(exc)


async def probe_urls(
    page,
    urls: Sequence[str],
    extract: Callable[[str], Any],
    *,
    tag: str,
    settle_ms: int = 2_000,
    timeout_ms: int = 30_000,
) -> Any | None:
    """Return the first truthy `extract(html)` across `urls`, or None.

    Stops early on the first navigation timeout: every candidate is expected to
    be on the same host, so one timeout means the host is down for this run and
    the remaining probes can only repeat the wait.

    extract: called with the page HTML; return a falsy value to try the next
             candidate. Its own exceptions are treated as a per-URL problem.
    """
    for i, url in enumerate(urls):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            await page.wait_for_timeout(settle_ms)
            value = extract(await page.content())
            if value:
                return value
            print(f"[{tag}] {url} → loaded but no value extracted")
        except Exception as e:  # noqa: BLE001 — a dead source must not sink the run
            if _is_timeout(e):
                skipped = len(urls) - i - 1
                print(
                    f"[{tag}] {url} → navigation timeout after {timeout_ms/1000:g}s "
                    + (
                        f"— host unreachable, skipping {skipped} remaining candidate(s)"
                        if skipped
                        else "— host unreachable"
                    )
                )
                return None
            print(f"[{tag}] {url} failed: {e}")
    return None
