"""The watchdog's memory, and what it buys.

The behaviour under test is the whole point of the change: one outage should
produce a handful of escalating signals, not one identical triple every hour.
"""
from datetime import UTC

from backend.scraper import source_health as H

NOW = "2026-09-04T09:15:00Z"


def outage(hours: int, reason: str = "live_quotes is 3.0h old"):
    """Run `hours` consecutive stale checks through the state machine."""
    state, out = H.initial_state(), []
    for _ in range(hours):
        d = H.decide(state, stale=True, now_iso=NOW, stale_reason=reason)
        out.append(d)
        state = d.state
    return out


class TestHealthyPath:
    def test_a_fresh_check_does_nothing_and_stays_green(self):
        d = H.decide(H.initial_state(), stale=False, now_iso=NOW)
        assert (d.exit_code, d.rescue, d.alert) == (0, False, False)

    def test_recovery_after_a_degraded_spell_is_announced_once(self):
        # An outage that silently ends leaves the reader unsure it ever did.
        state = outage(3)[-1].state
        d = H.decide(state, stale=False, now_iso=NOW)
        assert d.alert is True and d.kind == "recovered" and d.exit_code == 0
        assert d.state["status"] == "healthy" and d.state["consecutive_stale"] == 0

    def test_state_resets_completely_on_recovery(self):
        state = outage(5)[-1].state
        d = H.decide(state, stale=False, now_iso=NOW)
        assert d.state == H.initial_state()


class TestBackoff:
    def test_first_stale_check_rescues_alerts_but_stays_GREEN(self):
        # Detecting staleness and dispatching a rescue is the watchdog WORKING.
        d = outage(1)[0]
        assert d.rescue is True and d.alert is True
        assert d.kind == "detected"
        assert d.exit_code == 0

    def test_rescues_follow_a_doubling_schedule(self):
        ds = outage(16)
        fired = [i + 1 for i, d in enumerate(ds) if d.rescue]
        assert fired == [1, 2, 4, 8, 16]

    def test_alerts_are_rationed_not_hourly(self):
        ds = outage(24)
        alerted = [i + 1 for i, d in enumerate(ds) if d.alert]
        assert alerted == [1, 4, 12, 24]

    def test_a_twelve_hour_outage_goes_red_TWICE_not_twelve_times(self):
        # The headline. Old behaviour: 12 red runs, 12 alerts, 12 rescues.
        ds = outage(12)
        assert sum(1 for d in ds if d.exit_code == 1) == 2      # at 4 and 12
        assert sum(1 for d in ds if d.alert) == 3               # at 1, 4, 12
        assert sum(1 for d in ds if d.rescue) == 4              # 1, 2, 4, 8

    def test_quiet_hours_are_genuinely_quiet(self):
        ds = outage(12)
        quiet = [d for i, d in enumerate(ds) if (i + 1) not in (1, 2, 4, 8, 12)]
        assert quiet, "expected some hours with nothing to do"
        for d in quiet:
            assert (d.rescue, d.alert, d.exit_code) == (False, False, 0)

    def test_red_means_recovery_repeatedly_failed_and_says_so(self):
        d = outage(4)[-1]
        assert d.exit_code == 1 and d.kind == "escalation"
        assert "recovery is not working" in d.reason

    def test_the_streak_and_attempt_counters_survive_across_checks(self):
        ds = outage(8)
        assert ds[-1].state["consecutive_stale"] == 8
        assert ds[-1].state["rescue_attempts"] == 4          # 1, 2, 4, 8
        assert ds[-1].state["first_stale_at"] == NOW


class TestRescueDispatchFailure:
    def test_a_failed_dispatch_is_ALWAYS_loud_even_during_backoff(self):
        # The old `if curl -sf` guard swallowed this: losing actions:write
        # silently stopped the self-heal while the check kept passing.
        d = outage(1)[0]
        esc = H.rescue_dispatch_failed(d, "live_quotes is 3.0h old")
        assert esc.exit_code == 1 and esc.alert is True
        assert esc.kind == "rescue_failed"
        assert "self-heal path is broken" in esc.reason

    def test_escalating_a_dispatch_failure_keeps_the_streak(self):
        d = outage(3)[-1]
        esc = H.rescue_dispatch_failed(d)
        assert esc.state["consecutive_stale"] == 3


class TestCorruptState:
    def test_a_missing_or_junk_state_reads_as_healthy_rather_than_crashing(self):
        for junk in (None, "", [], {"status": "nonsense"}, {"consecutive_stale": -4}):
            s = H.load_state(junk)
            assert s["status"] == "healthy" and s["consecutive_stale"] == 0

    def test_losing_memory_restarts_the_ladder_without_a_red_run(self):
        # A wiped key mid-outage should re-detect and re-rescue, not page.
        d = H.decide(H.load_state(None), stale=True, now_iso=NOW)
        assert d.exit_code == 0 and d.rescue is True

    def test_unknown_extra_keys_are_ignored(self):
        s = H.load_state({"consecutive_stale": 2, "status": "degraded", "junk": "x"})
        assert s["consecutive_stale"] == 2 and "junk" not in s


class TestSummary:
    def test_the_log_line_names_what_happened(self):
        line = H.summarise(outage(4)[-1])
        assert "exit=1" in line and "stale_streak=4" in line and "alert=escalation" in line


class TestStaleness:
    """The observation itself — separate from what we do about it."""
    from datetime import datetime, timezone
    NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)

    def _c(self):
        from backend.scraper import check_live_quotes as C
        return C

    def test_a_recent_payload_is_fresh(self):
        C = self._c()
        stale, why = C.staleness({"fetched_at": "2026-09-04T11:30:00Z"}, 2.0, self.NOW)
        assert stale is False and "fresh" in why

    def test_an_old_payload_is_stale_and_says_how_old(self):
        C = self._c()
        stale, why = C.staleness({"fetched_at": "2026-09-04T06:00:00Z"}, 2.0, self.NOW)
        assert stale is True and "6.0h old" in why

    def test_a_missing_payload_is_STALE_not_an_error(self):
        # An evicted key means the poller is not writing. That is the same
        # operational fact as a stale timestamp and takes the same ladder.
        C = self._c()
        assert C.staleness(None, 2.0, self.NOW)[0] is True
        assert C.staleness({}, 2.0, self.NOW)[0] is True

    def test_an_unparseable_timestamp_is_stale_rather_than_a_crash(self):
        C = self._c()
        stale, why = C.staleness({"fetched_at": "not-a-date"}, 2.0, self.NOW)
        assert stale is True and "unparseable" in why


class TestEndToEnd:
    """The wiring, not just the ladder. Pure logic passing proves nothing about
    whether main() reads the right keys and honours the decision."""

    def _fake(self, monkeypatch, quotes, health, dispatch_status=204):
        import json as _json

        from backend.scraper import check_live_quotes as C
        calls = {"dispatch": 0, "telegram": [], "set": []}

        class Resp:
            def __init__(self, payload=None, status=200):
                self._p, self.status_code, self.text = payload, status, ""
            def json(self): return self._p
            def raise_for_status(self):
                if self.status_code >= 400: raise C.requests.RequestException("boom")

        def get(url, **kw):
            if url.endswith("/get/live_quotes"):
                return Resp({"result": _json.dumps(quotes) if quotes else None})
            if url.endswith("/get/live_quotes_health"):
                return Resp({"result": _json.dumps(health) if health else None})
            raise AssertionError(f"unexpected GET {url}")

        def post(url, **kw):
            if "/dispatches" in url:
                calls["dispatch"] += 1
                return Resp(status=dispatch_status)
            if "telegram" in url:
                calls["telegram"].append(kw.get("data", {}).get("text", ""))
                return Resp()
            if "/set/" in url:
                calls["set"].append(kw.get("data"))
                return Resp()
            raise AssertionError(f"unexpected POST {url}")

        monkeypatch.setattr(C.requests, "get", get)
        monkeypatch.setattr(C.requests, "post", post)
        for k, v in {"UPSTASH_REDIS_REST_URL": "https://u", "UPSTASH_REDIS_REST_TOKEN": "t",
                     "GITHUB_TOKEN": "gh", "GITHUB_REPOSITORY": "o/r",
                     "TELEGRAM_BOT_TOKEN": "b", "TELEGRAM_CHAT_ID": "c",
                     "STALE_HOURS": "2"}.items():
            monkeypatch.setenv(k, v)
        monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
        return C, calls

    def test_first_stale_check_dispatches_alerts_and_returns_ZERO(self, monkeypatch):
        C, calls = self._fake(monkeypatch, {"fetched_at": "2020-01-01T00:00:00Z"}, None)
        assert C.main() == 0                       # green: the watchdog is working
        assert calls["dispatch"] == 1
        assert len(calls["telegram"]) == 1 and "🟡" in calls["telegram"][0]
        assert '"consecutive_stale": 1' in calls["set"][0]

    def test_the_fourth_consecutive_stale_check_returns_ONE(self, monkeypatch):
        C, calls = self._fake(monkeypatch, {"fetched_at": "2020-01-01T00:00:00Z"},
                              {"status": "degraded", "consecutive_stale": 3,
                               "rescue_attempts": 3})
        assert C.main() == 1                       # red: recovery keeps failing
        assert "🚨" in calls["telegram"][0]

    def test_a_quiet_hour_touches_nothing_but_the_state(self, monkeypatch):
        C, calls = self._fake(monkeypatch, {"fetched_at": "2020-01-01T00:00:00Z"},
                              {"status": "degraded", "consecutive_stale": 5,
                               "rescue_attempts": 4})
        assert C.main() == 0
        assert calls["dispatch"] == 0 and calls["telegram"] == []
        assert len(calls["set"]) == 1

    def test_a_failed_dispatch_goes_red_even_on_the_first_check(self, monkeypatch):
        C, calls = self._fake(monkeypatch, {"fetched_at": "2020-01-01T00:00:00Z"}, None,
                              dispatch_status=403)
        assert C.main() == 1
        assert "🛑" in calls["telegram"][0]

    def test_fresh_quotes_after_an_outage_announce_recovery_and_reset(self, monkeypatch):
        from datetime import UTC, datetime
        fresh = datetime.now(UTC).isoformat()
        C, calls = self._fake(monkeypatch, {"fetched_at": fresh},
                              {"status": "degraded", "consecutive_stale": 6})
        assert C.main() == 0
        assert "✅" in calls["telegram"][0]
        assert '"consecutive_stale": 0' in calls["set"][0]

    def test_missing_credentials_skip_rather_than_fail(self, monkeypatch):
        from backend.scraper import check_live_quotes as C
        monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
        monkeypatch.delenv("UPSTASH_REDIS_REST_TOKEN", raising=False)
        assert C.main() == 0
