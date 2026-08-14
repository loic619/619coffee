"""Tests for the shared same-host URL probe.

Context: ECX Ethiopia burned 3 x 30 s = 90 s per daily-scraper run timing out on
all three of its candidate URLs, several runs a day, to return nothing. All the
candidates are on one host, so the 2nd and 3rd waits could only re-prove what
the 1st already showed. Same shape as the NSO tier removed from vietnam_supply.

The tests pin both halves: stop early on a timeout, but never let that guard
degrade a source whose host is actually answering.
"""
import asyncio

from scraper.utils.page_probe import probe_urls


def run(coro):
    """Drive a coroutine without pytest-asyncio — the repo has no async
    tests and no asyncio plugin, and this needs neither."""
    return asyncio.run(coro)


class FakePage:
    """Minimal Playwright page: scripted per-URL outcomes."""

    def __init__(self, outcomes: dict):
        self.outcomes = outcomes      # url -> "html string" | Exception
        self.visited: list[str] = []
        self._html = ""

    async def goto(self, url, **kw):
        self.visited.append(url)
        out = self.outcomes[url]
        if isinstance(out, Exception):
            raise out
        self._html = out

    async def wait_for_timeout(self, ms):
        return None

    async def content(self):
        return self._html


class NavTimeout(Exception):
    """Stands in for playwright's TimeoutError (matched by class name)."""


URLS = ["https://h.example/", "https://h.example/a", "https://h.example/b"]


# ── the fix: one timeout ends the walk ───────────────────────────────────────

def test_first_timeout_skips_every_remaining_candidate():
    """The ECX production case: 3 probes collapse to 1."""
    page = FakePage(dict.fromkeys(URLS, NavTimeout("Page.goto: Timeout 30000ms exceeded")))
    assert run(probe_urls(page, URLS, lambda h: h, tag="t")) is None
    assert page.visited == URLS[:1], f"expected 1 probe, got {len(page.visited)}"


# ── the guard must not break a live host ─────────────────────────────────────

def test_a_working_first_url_returns_immediately():
    page = FakePage({URLS[0]: "PRICE 42", URLS[1]: "x", URLS[2]: "x"})
    assert run(probe_urls(page, URLS, lambda h: h.split()[-1], tag="t")) == "42"
    assert page.visited == URLS[:1]


def test_non_timeout_error_still_tries_the_other_candidates():
    """A 404/redirect on one path is per-URL — the list exists for exactly this."""
    page = FakePage({
        URLS[0]: RuntimeError("404"),
        URLS[1]: "",              # loads, extracts nothing
        URLS[2]: "PRICE 7",
    })
    assert run(probe_urls(page, URLS, lambda h: h.split()[-1] if h else None, tag="t")) == "7"
    assert page.visited == URLS, "all three candidates should have been tried"


def test_empty_extraction_is_not_treated_as_host_failure():
    """honduras: pages load fine, extractor finds nothing. Must keep walking."""
    page = FakePage(dict.fromkeys(URLS, "<html>no price here</html>"))
    assert run(probe_urls(page, URLS, lambda h: None, tag="t")) is None
    assert page.visited == URLS


def test_a_timeout_after_a_bad_url_still_stops_there():
    page = FakePage({
        URLS[0]: RuntimeError("404"),
        URLS[1]: NavTimeout("Timeout 30000ms exceeded"),
        URLS[2]: "PRICE 9",
    })
    assert run(probe_urls(page, URLS, lambda h: h, tag="t")) is None
    assert page.visited == URLS[:2], "must stop at the timeout, not reach url 3"


def test_extractor_exception_does_not_sink_the_run():
    def boom(_html):
        raise ValueError("bad markup")
    page = FakePage({URLS[0]: "a", URLS[1]: "b", URLS[2]: "c"})
    assert run(probe_urls(page, URLS, boom, tag="t")) is None
    assert page.visited == URLS
