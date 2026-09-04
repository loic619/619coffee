# backend/tests/test_workflow_activity_resilience.py
"""C5: one 502 from the Actions API used to discard a whole sweep.

The collector makes ~100 API calls per run (one per workflow), writes nothing
on the way out, and aborted the entire build on any HTTPError — so a routine
502 froze workflow_activity.json until some later run got a clean sweep. Two
defences, both asserted here: transient statuses are retried, and a workflow
that still cannot be read is recorded in `errored_workflows` rather than
killing the run.
"""
import importlib.util
import json
import sys
import urllib.error
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "build_workflow_activity",
    Path(__file__).resolve().parents[1] / "scripts" / "build_workflow_activity.py",
)
bwa = importlib.util.module_from_spec(_SPEC)
sys.modules["build_workflow_activity"] = bwa
_SPEC.loader.exec_module(bwa)


def _http_error(code, headers=None):
    return urllib.error.HTTPError("https://api.github.com/x", code, "boom", headers or {}, None)


class _Resp:
    """Minimal stand-in for the context manager urlopen returns."""

    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._payload


@pytest.fixture
def no_sleep(monkeypatch):
    """Backoff is real seconds in production; the test only cares that it waits."""
    waited = []
    monkeypatch.setattr(bwa.time, "sleep", waited.append)
    return waited


# ---------------------------------------------------------------- _api retry

@pytest.mark.parametrize("code", sorted(bwa.RETRY_STATUSES))
def test_transient_status_is_retried_and_succeeds(monkeypatch, no_sleep, code):
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(1)
        if len(calls) == 1:
            raise _http_error(code)
        return _Resp({"ok": True})

    monkeypatch.setattr(bwa.urllib.request, "urlopen", fake_urlopen)
    assert bwa._api("https://api.github.com/x", "tok") == {"ok": True}
    assert len(calls) == 2
    assert no_sleep == [1]  # first backoff step


def test_the_502_that_froze_the_record_is_survivable(monkeypatch, no_sleep):
    """Run 11 of workflow 0.17 died on exactly one 502. Four of them in a row
    are now survivable, which is more than that incident needed."""
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(1)
        if len(calls) <= 4:
            raise _http_error(502)
        return _Resp({"workflow_runs": []})

    monkeypatch.setattr(bwa.urllib.request, "urlopen", fake_urlopen)
    assert bwa._api("https://api.github.com/x", "tok") == {"workflow_runs": []}
    assert no_sleep == [1, 2, 4, 8]


def test_retries_are_finite(monkeypatch, no_sleep):
    """Five consecutive 502s exhaust the budget and the error escapes — the
    caller decides what to do with it, but the job must not spin forever."""
    monkeypatch.setattr(
        bwa.urllib.request, "urlopen",
        lambda req, timeout=None: (_ for _ in ()).throw(_http_error(502)),
    )
    with pytest.raises(urllib.error.HTTPError):
        bwa._api("https://api.github.com/x", "tok")
    assert len(no_sleep) == len(bwa.RETRY_BACKOFF)


@pytest.mark.parametrize("code", [401, 403, 404, 422])
def test_real_errors_fail_immediately(monkeypatch, no_sleep, code):
    """A bad token or a deleted workflow is an answer, not weather. Retrying
    it would only turn a clear failure into a slow one."""
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(1)
        raise _http_error(code)

    monkeypatch.setattr(bwa.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(urllib.error.HTTPError):
        bwa._api("https://api.github.com/x", "tok")
    assert len(calls) == 1
    assert no_sleep == []


def test_url_error_is_retried(monkeypatch, no_sleep):
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.URLError("connection reset")
        return _Resp({"ok": True})

    monkeypatch.setattr(bwa.urllib.request, "urlopen", fake_urlopen)
    assert bwa._api("https://api.github.com/x", "tok") == {"ok": True}
    assert len(calls) == 2


def test_retry_after_header_is_honoured(monkeypatch, no_sleep):
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(1)
        if len(calls) == 1:
            raise _http_error(429, {"Retry-After": "3"})
        return _Resp({"ok": True})

    monkeypatch.setattr(bwa.urllib.request, "urlopen", fake_urlopen)
    bwa._api("https://api.github.com/x", "tok")
    assert no_sleep == [3.0]  # header wins over the 1s backoff step


def test_hostile_retry_after_is_capped(monkeypatch, no_sleep):
    """A Retry-After of an hour would stall the job past any usefulness."""
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(1)
        if len(calls) == 1:
            raise _http_error(503, {"Retry-After": "9999"})
        return _Resp({"ok": True})

    monkeypatch.setattr(bwa.urllib.request, "urlopen", fake_urlopen)
    bwa._api("https://api.github.com/x", "tok")
    assert no_sleep == [bwa.MAX_RETRY_AFTER]


def test_unparseable_retry_after_falls_back_to_backoff(monkeypatch, no_sleep):
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append(1)
        if len(calls) == 1:
            raise _http_error(503, {"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"})
        return _Resp({"ok": True})

    monkeypatch.setattr(bwa.urllib.request, "urlopen", fake_urlopen)
    bwa._api("https://api.github.com/x", "tok")
    assert no_sleep == [1]


# ------------------------------------------------------- partial-write path

def _run_main(monkeypatch, tmp_path, responder):
    """Drive main() against a fake API, writing the file into tmp_path."""
    out = tmp_path / "workflow_activity.json"
    monkeypatch.setattr(bwa, "OUT_PATH", out)
    monkeypatch.setenv("GITHUB_TOKEN", "tok")
    monkeypatch.setenv("GITHUB_REPOSITORY", "loic619/619coffee")
    monkeypatch.setattr(bwa.time, "sleep", lambda s: None)
    monkeypatch.setattr(bwa, "_api", lambda url, token: responder(url))
    rc = bwa.main()
    return rc, out


def test_one_workflows_failure_no_longer_discards_the_sweep(monkeypatch, tmp_path):
    """The C5 scenario end to end: workflow B is unreachable, A and C are fine.
    The file must still be written, with A and C in it and B named."""
    listing = {"workflows": [
        {"id": 1, "name": "9.1 – CI Tests", "path": ".github/workflows/ci.yml"},
        {"id": 2, "name": "1.4 – Export", "path": ".github/workflows/export.yml"},
        {"id": 3, "name": "0.17 – Activity", "path": ".github/workflows/activity.yml"},
    ]}
    now = bwa.datetime.now(bwa.UTC).isoformat().replace("+00:00", "Z")

    def responder(url):
        if "/actions/workflows?" in url:
            return listing
        if "/workflows/2/runs" in url:
            raise _http_error(502)
        wf_id = url.split("/workflows/")[1].split("/")[0]
        return {"workflow_runs": [{
            "id": int(wf_id) * 100, "conclusion": "success", "event": "schedule",
            "run_started_at": now, "updated_at": now,
        }]}

    rc, out = _run_main(monkeypatch, tmp_path, responder)

    assert rc == 0, "a single unreachable workflow must not fail the whole build"
    payload = json.loads(out.read_text())
    assert payload["errored_workflows"] == ["1.4 – Export"]
    collected = {w["name"] for w in payload["workflows"]}
    assert collected == {"9.1 – CI Tests", "0.17 – Activity"}
    assert payload["totals"]["runs"] == 2


def test_clean_sweep_reports_nothing_errored(monkeypatch, tmp_path):
    listing = {"workflows": [{"id": 1, "name": "9.1 – CI Tests", "path": "x/ci.yml"}]}

    def responder(url):
        if "/actions/workflows?" in url:
            return listing
        return {"workflow_runs": []}

    rc, out = _run_main(monkeypatch, tmp_path, responder)
    assert rc == 0
    assert json.loads(out.read_text())["errored_workflows"] == []


def test_workflow_listing_failure_is_still_fatal(monkeypatch, tmp_path):
    """With no workflow list there is nothing to collect, so this one keeps
    the hard failure — writing an empty record would look like a quiet week."""
    def responder(url):
        raise _http_error(502)

    rc, out = _run_main(monkeypatch, tmp_path, responder)
    assert rc == 1
    assert not out.exists()
