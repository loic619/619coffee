"""ACAPHE poller: payload validation, the cookie cache, and the publish gate.

The two failure modes pinned here both used to pass silently:
  * a parseable but empty payload was pushed over a good live_quotes snapshot,
    blanking the panel AND refreshing the key's timestamp, which hid the
    outage from the 1.8 freshness checker;
  * every tick launched Chromium to mint a session, because --once runs in a
    fresh container with nowhere to keep one.
"""
import asyncio
import json

import pytest

from scraper import acaphe_poller as m

PRICED = {
    "robusta": [{"month": "RCX26", "last": 3406.0}, {"month": "RCF27", "last": 3390.0}],
    "arabica": [{"month": "KCZ26", "last": 298.1}],
}


# ── classify ─────────────────────────────────────────────────────────────────

def test_a_priced_payload_is_healthy():
    status, reasons = m.classify(PRICED)
    assert status == "healthy"
    assert reasons == []


def test_empty_boards_are_degraded():
    status, reasons = m.classify({"robusta": [], "arabica": []})
    assert status == "degraded"
    assert reasons == ["robusta: no rows", "arabica: no rows"]


def test_rows_present_but_unpriced_are_degraded():
    """The shape acaphe serves off-session: scaffolding, no numbers. Valid
    JSON, right row count — and useless as a quote."""
    status, reasons = m.classify({
        "robusta": [{"month": "RCX26", "last": None}],
        "arabica": [{"month": "KCZ26", "last": None}],
    })
    assert status == "degraded"
    assert reasons == ["robusta: 1 rows, none priced", "arabica: 1 rows, none priced"]


def test_one_dead_board_is_enough_to_degrade():
    status, reasons = m.classify({"robusta": PRICED["robusta"], "arabica": []})
    assert status == "degraded"
    assert reasons == ["arabica: no rows"]


def test_a_missing_key_is_not_a_crash():
    assert m.classify({})[0] == "degraded"


# ── the publish gate ─────────────────────────────────────────────────────────

@pytest.fixture
def spy(tmp_path, monkeypatch):
    """Capture Redis writes and keep the poller off the filesystem/network."""
    pushed: list[tuple[str, dict]] = []
    monkeypatch.setattr(m, "OUTPUT", tmp_path / "acaphe_live.json")
    monkeypatch.setattr(m, "VIETNAM_LAST", tmp_path / "vietnam_last.json")
    monkeypatch.setattr(m, "DATABASE_URL", "")
    monkeypatch.setattr(m, "VN_ONLY", False)
    monkeypatch.setattr(m, "_push_redis", lambda data, key=m.REDIS_KEY, ttl_s=None: pushed.append((key, data)))
    monkeypatch.setattr(m, "_get_redis", lambda key: None)
    return pushed


def _serve(monkeypatch, payload, status_code=200):
    class _Resp:
        status_code = 200
        text = ""
        def raise_for_status(self): pass
        def json(self): return payload
    monkeypatch.setattr(m.requests, "get", lambda *a, **k: _Resp())


def test_healthy_payload_is_published(spy, monkeypatch):
    monkeypatch.setattr(m, "transform", lambda raw: {**PRICED, "fetched_at": "t", "vietnam": {}})
    _serve(monkeypatch, [{}])
    assert m.fetch_and_save({"c": "1"}) is True
    assert [k for k, _ in spy] == [m.REDIS_KEY]
    assert spy[0][1]["status"] == "healthy"


def test_degraded_payload_is_not_published(spy, monkeypatch):
    """The whole point: retain the last good snapshot rather than overwrite it
    with an empty one — and leave its timestamp alone so 1.8 still sees the
    staleness."""
    monkeypatch.setattr(m, "transform",
                        lambda raw: {"robusta": [], "arabica": [], "fetched_at": "t", "vietnam": {}})
    _serve(monkeypatch, [{}])
    assert m.fetch_and_save({"c": "1"}) is True      # handled, not a job failure
    assert [k for k, _ in spy] == []                  # nothing written to live_quotes


def test_vn_only_still_skips_the_live_push(spy, monkeypatch):
    """VN-only ticks run while London and NY are shut; the futures half is
    legitimately off-session and must not touch live_quotes even when the
    payload validates."""
    monkeypatch.setattr(m, "VN_ONLY", True)
    monkeypatch.setattr(m, "transform", lambda raw: {**PRICED, "fetched_at": "t", "vietnam": {}})
    _serve(monkeypatch, [{}])
    assert m.fetch_and_save({"c": "1"}) is True
    assert [k for k, _ in spy] == []


def test_vn_snapshot_is_saved_even_when_futures_are_degraded(spy, monkeypatch):
    """The VN block and the futures boards fail independently — a dead futures
    payload must not cost us the Vietnamese morning print."""
    monkeypatch.setattr(m, "transform", lambda raw: {
        "robusta": [], "arabica": [], "fetched_at": "t",
        "vietnam": {"bmt_bid": 94300, "hcm_bid": 94500},
    })
    _serve(monkeypatch, [{}])
    assert m.fetch_and_save({"c": "1"}) is True
    assert [k for k, _ in spy] == ["vietnam_last"]


def test_a_transport_failure_returns_false(spy, monkeypatch):
    def _boom(*a, **k):
        raise TimeoutError("acaphe timed out")
    monkeypatch.setattr(m.requests, "get", _boom)
    assert m.fetch_and_save({"c": "1"}) is False
    assert spy == []


# ── cookie cache ─────────────────────────────────────────────────────────────

def test_cached_cookies_skip_the_browser(monkeypatch):
    monkeypatch.setattr(m, "_get_redis", lambda key: {"PHPSESSID": "abc"})

    async def _no(*a, **k):
        raise AssertionError("playwright_login must not run on a cache hit")
    monkeypatch.setattr(m, "playwright_login", _no)

    cookies, from_cache = asyncio.run(m.get_cookies())
    assert (cookies, from_cache) == ({"PHPSESSID": "abc"}, True)


def test_a_cache_miss_logs_in_and_stores_the_jar_with_a_ttl(monkeypatch):
    saved: dict = {}
    monkeypatch.setattr(m, "_get_redis", lambda key: None)
    monkeypatch.setattr(m, "_push_redis",
                        lambda data, key=m.REDIS_KEY, ttl_s=None: saved.update(key=key, data=data, ttl=ttl_s))

    async def _login():
        return {"PHPSESSID": "fresh"}
    monkeypatch.setattr(m, "playwright_login", _login)

    cookies, from_cache = asyncio.run(m.get_cookies())
    assert (cookies, from_cache) == ({"PHPSESSID": "fresh"}, False)
    assert saved == {"key": m.COOKIE_KEY, "data": {"PHPSESSID": "fresh"}, "ttl": m.COOKIE_TTL_S}


def test_force_login_ignores_a_warm_cache(monkeypatch):
    monkeypatch.setattr(m, "_get_redis", lambda key: {"PHPSESSID": "stale"})
    monkeypatch.setattr(m, "_push_redis", lambda *a, **k: None)

    async def _login():
        return {"PHPSESSID": "fresh"}
    monkeypatch.setattr(m, "playwright_login", _login)

    cookies, from_cache = asyncio.run(m.get_cookies(force_login=True))
    assert (cookies, from_cache) == ({"PHPSESSID": "fresh"}, False)


# ── redis helpers ────────────────────────────────────────────────────────────

def test_push_redis_sets_an_expiry_only_when_asked(monkeypatch):
    sent: list = []
    monkeypatch.setattr(m, "UPSTASH_URL", "https://redis.example")
    monkeypatch.setattr(m, "UPSTASH_TOKEN", "tok")

    class _Resp:
        def raise_for_status(self): pass
    monkeypatch.setattr(m.requests, "post",
                        lambda url, **k: (sent.append(k["json"]), _Resp())[1])

    m._push_redis({"a": 1}, key="k")
    m._push_redis({"a": 1}, key="k", ttl_s=60)
    assert sent[0] == ["SET", "k", '{"a":1}']
    assert sent[1] == ["SET", "k", '{"a":1}', "EX", "60"]


def test_get_redis_decodes_a_json_string(monkeypatch):
    monkeypatch.setattr(m, "UPSTASH_URL", "https://redis.example")
    monkeypatch.setattr(m, "UPSTASH_TOKEN", "tok")

    class _Resp:
        ok = True
        def json(self): return {"result": json.dumps({"PHPSESSID": "x"})}
    monkeypatch.setattr(m.requests, "get", lambda *a, **k: _Resp())
    assert m._get_redis("acaphe_cookies") == {"PHPSESSID": "x"}


def test_get_redis_returns_none_when_unset(monkeypatch):
    monkeypatch.setattr(m, "UPSTASH_URL", "https://redis.example")
    monkeypatch.setattr(m, "UPSTASH_TOKEN", "tok")

    class _Resp:
        ok = True
        def json(self): return {"result": None}
    monkeypatch.setattr(m.requests, "get", lambda *a, **k: _Resp())
    assert m._get_redis("acaphe_cookies") is None
