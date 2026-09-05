"""A confirmed hard block must cost one attempt, one message, and no data.

Run 33978343636 (1.14, 2026-09-05) is the shape under test end to end:

    scheduled run
      -> first request 403
      -> every request 403 (26 of 26)
      -> AllRequestsRefused, exit 3
      -> workflow retries anyway: sleep 300, attempt 2, sleep 300, attempt 3
      -> three identical Telegram messages, then a fourth saying "failed"
      -> 14 minutes of runner time
      -> run_degradations.json never committed (the commit step is skipped
         when the scraper step fails)

Every arrow after "exit 3" was wrong. These tests pin the corrected behaviour,
including the workflow shell itself — the ladder is where the waste lived, and
a Python-only test would have passed against the broken version.
"""
import json
import re
import subprocess
import time
from pathlib import Path

import pytest
import yaml

from scraper.sources.ice_certified_stocks import orchestrate as o

WF_DIR = Path(__file__).resolve().parents[3] / ".github" / "workflows"
MONTHLY_WF = WF_DIR / "scraper-ice-monthly-reports.yml"
DAILY_WF = WF_DIR / "scraper-ice-certified-stocks.yml"


def _pull_step(wf: Path) -> dict:
    doc = yaml.safe_load(wf.read_text())
    for step in doc["jobs"]["scrape"]["steps"]:
        if step.get("id") == "pull":
            return step
    raise AssertionError(f"no step with id 'pull' in {wf.name}")


# ── The ladder, run for real ────────────────────────────────────────────────

@pytest.mark.parametrize("wf", [MONTHLY_WF, DAILY_WF], ids=["1.14", "1.13"])
def test_exit_3_stops_after_one_attempt(wf, tmp_path):
    """The incident itself: exit 3 must not sleep, and must not try again.

    The workflow's shell is extracted and run with the orchestrator replaced by
    a stub that exits 3 and counts its own invocations. If the ladder retries,
    the counter reads 2+ and the wall clock shows the 60s sleep.
    """
    script = _pull_step(wf)["run"]
    # Strip GitHub expressions (${{ ... }}) — they are substituted before the
    # shell ever sees them, and inputs.days_back is irrelevant to the ladder.
    script = re.sub(r"\$\{\{[^}]*\}\}", "3", script)

    calls = tmp_path / "calls"
    stub = tmp_path / "python"
    stub.write_text(
        "#!/bin/bash\n"
        f'echo x >> "{calls}"\n'
        "exit 3\n")
    stub.chmod(0o755)

    # run_scraper() in 1.13 wraps the same `python -m ...` call.
    outputs = tmp_path / "gh_output"
    outputs.touch()
    t0 = time.monotonic()
    proc = subprocess.run(
        ["bash", "-e", "-c", script],
        env={"PATH": f"{tmp_path}:/usr/bin:/bin", "GITHUB_OUTPUT": str(outputs),
             "HOME": str(tmp_path)},
        capture_output=True, text=True, timeout=120)
    elapsed = time.monotonic() - t0

    n = calls.read_text().count("x") if calls.exists() else 0
    assert n == 1, f"orchestrator ran {n} times on a hard block, expected 1"
    assert proc.returncode == 3, f"ladder returned {proc.returncode}, expected 3"
    # The old ladder slept 300s between attempts; the fixed one sleeps not at all.
    assert elapsed < 30, f"ladder slept {elapsed:.0f}s on a hard block"
    assert "ice_blocked=true" in outputs.read_text(), \
        "the block flag must be set so the failure notifier stays quiet"


@pytest.mark.parametrize("wf", [MONTHLY_WF, DAILY_WF], ids=["1.14", "1.13"])
def test_a_transient_failure_still_retries(wf, tmp_path):
    """Exit 1 is not a block. The one retry has to survive this change."""
    script = re.sub(r"\$\{\{[^}]*\}\}", "3", _pull_step(wf)["run"])
    calls = tmp_path / "calls"
    stub = tmp_path / "python"
    stub.write_text("#!/bin/bash\n" f'echo x >> "{calls}"\n' "exit 1\n")
    stub.chmod(0o755)
    outputs = tmp_path / "gh_output"
    outputs.touch()
    proc = subprocess.run(
        ["bash", "-e", "-c", script.replace("sleep 60", "sleep 0")],
        env={"PATH": f"{tmp_path}:/usr/bin:/bin", "GITHUB_OUTPUT": str(outputs),
             "HOME": str(tmp_path)},
        capture_output=True, text=True, timeout=120)
    assert calls.read_text().count("x") == 2, "a transient fault gets exactly one retry"
    assert proc.returncode == 1
    assert "ice_blocked" not in outputs.read_text()


@pytest.mark.parametrize("wf", [MONTHLY_WF, DAILY_WF], ids=["1.14", "1.13"])
def test_success_runs_once(wf, tmp_path):
    script = re.sub(r"\$\{\{[^}]*\}\}", "3", _pull_step(wf)["run"])
    calls = tmp_path / "calls"
    stub = tmp_path / "python"
    stub.write_text("#!/bin/bash\n" f'echo x >> "{calls}"\n' "exit 0\n")
    stub.chmod(0o755)
    outputs = tmp_path / "gh_output"
    outputs.touch()
    proc = subprocess.run(
        ["bash", "-e", "-c", script],
        env={"PATH": f"{tmp_path}:/usr/bin:/bin", "GITHUB_OUTPUT": str(outputs),
             "HOME": str(tmp_path)},
        capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0
    assert calls.read_text().count("x") == 1


def test_no_five_minute_sleep_survives_anywhere():
    """The specific waste. 300s between attempts is what made one block cost
    fourteen minutes; nothing in either ladder may sleep that long again."""
    for wf in (MONTHLY_WF, DAILY_WF):
        script = _pull_step(wf)["run"]
        for m in re.findall(r"sleep\s+(\d+)", script):
            assert int(m) <= 60, f"{wf.name} sleeps {m}s in the retry ladder"


# ── The failure notifier must not contradict the BLOCKED message ────────────

@pytest.mark.parametrize("wf", [MONTHLY_WF, DAILY_WF], ids=["1.14", "1.13"])
def test_failure_notifier_is_gated_on_the_block_flag(wf):
    doc = yaml.safe_load(wf.read_text())
    steps = doc["jobs"]["scrape"]["steps"]
    notify = next(s for s in steps if s.get("name") == "Notify on failure")
    cond = notify["if"]
    assert "ice_blocked" in cond, \
        "a hard block already sent BLOCKED; the generic failure line must be suppressed"
    assert "failure()" in cond, "genuine failures must still alert"


@pytest.mark.parametrize("wf", [MONTHLY_WF, DAILY_WF], ids=["1.14", "1.13"])
def test_degradation_record_survives_a_failed_run(wf):
    """#844's ledger is empty on main because the commit step is skipped when
    the scraper step fails — losing exactly the events it was built for."""
    doc = yaml.safe_load(wf.read_text())
    steps = doc["jobs"]["scrape"]["steps"]
    persist = next((s for s in steps
                    if s.get("name") == "Persist the degradation record (blocked run)"), None)
    assert persist is not None, f"{wf.name} has no failure-path record step"
    assert persist["if"].strip() == "failure()"
    body = persist["run"]
    assert "run_degradations.json" in body and "ice_block_state.json" in body
    # Must NOT commit the data files: they carry a generated_at that moves on
    # every write, so committing them from a blocked run advances a freshness
    # marker on a run that captured nothing.
    assert "certified_stocks_arabica.json" not in body
    assert "certified_stocks_robusta.json" not in body


# ── Orchestrator side ───────────────────────────────────────────────────────

@pytest.fixture
def clean_run(tmp_path, monkeypatch):
    """A pristine _RUN_STATS / _RATE_STATE plus an isolated block-state file."""
    keep_stats, keep_rate = dict(o._RUN_STATS), dict(o._RATE_STATE)
    o._RUN_STATS.update({"requests": 0, "ok_200": 0, "http_403": 0, "http_429": 0,
                         "http_404": 0, "blocked_sections": [], "sections": 0,
                         "aborted_by_403": 0, "block_signature": None})
    o._RATE_STATE.update({"consecutive_429s": 0, "consecutive_403s": 0,
                          "aborted": 0, "section_blocked": 0})
    monkeypatch.setattr(o, "BLOCK_STATE_PATH", tmp_path / "ice_block_state.json")
    sent: list[str] = []
    monkeypatch.setattr(o, "_telegram", lambda text, *, tag: sent.append(text))
    yield sent
    o._RUN_STATS.clear(); o._RUN_STATS.update(keep_stats)
    o._RATE_STATE.clear(); o._RATE_STATE.update(keep_rate)


def _block(section="robusta monthly reports", after=8):
    o._RUN_STATS["blocked_sections"].append(
        {"section": section, "at": "2026-09-05T16:43:16", "after_403s": after,
         "skipped_requests": 0})


def test_wholly_refused_says_blocked_not_green(clean_run, monkeypatch):
    monkeypatch.setenv("GITHUB_WORKFLOW", "1.14 – ICE Monthly Reports")
    o._RUN_STATS.update(requests=26, ok_200=0, http_403=26, sections=2)
    _block()
    assert o._notify_blocked_sections(only_monthly=True) is True
    assert len(clean_run) == 1
    msg = clean_run[0]
    assert "ICE BLOCKED" in msg
    assert "Green run" not in msg, "a run that captured nothing is not green"
    assert "1.14 – ICE Monthly Reports" in msg, "the message must name its own workflow"
    assert "preserved" in msg


def test_partial_block_says_degraded(clean_run, monkeypatch):
    monkeypatch.setenv("GITHUB_WORKFLOW", "1.13 – ICE Certified Stocks")
    o._RUN_STATS.update(requests=400, ok_200=120, http_403=280, sections=5)
    _block()
    o._notify_blocked_sections()
    assert "ICE DEGRADED" in clean_run[0]
    assert "kept the rest" in clean_run[0]


def test_identical_repeat_is_suppressed(clean_run):
    """The three-messages-in-fourteen-minutes bug, at the notifier."""
    for _ in range(3):
        o._RUN_STATS.update(requests=26, ok_200=0, http_403=26, sections=2)
        o._RUN_STATS["blocked_sections"] = []
        _block()
        o._notify_blocked_sections(only_monthly=True)
    assert len(clean_run) == 1, f"expected 1 alert for an unchanged block, got {len(clean_run)}"


def test_a_materially_different_block_alerts_again(clean_run):
    o._RUN_STATS.update(requests=26, ok_200=0, http_403=26, sections=2)
    _block("robusta monthly reports")
    o._notify_blocked_sections(only_monthly=True)
    # A different section goes dark — a new fact, not a repeat.
    o._RUN_STATS["blocked_sections"] = []
    _block("arabica ageing report")
    o._notify_blocked_sections(only_monthly=True)
    assert len(clean_run) == 2


def test_recovery_notifies_once_and_rearms(clean_run):
    o._RUN_STATS.update(requests=26, ok_200=0, http_403=26, sections=2)
    _block()
    o._notify_blocked_sections(only_monthly=True)
    # Next run serves.
    o._RUN_STATS.update(requests=8, ok_200=8, http_403=0, blocked_sections=[])
    assert o._notify_blocked_sections(only_monthly=True) is False
    assert "ICE RECOVERED" in clean_run[-1]
    # A second clean run says nothing more.
    o._notify_blocked_sections(only_monthly=True)
    assert len(clean_run) == 2


def test_recovery_needs_evidence_not_just_silence(clean_run):
    """A run that fetched nothing (everything already captured) has not shown
    that ICE is serving again — claiming recovery off it would be a guess."""
    o._RUN_STATS.update(requests=26, ok_200=0, http_403=26, sections=2)
    _block()
    o._notify_blocked_sections(only_monthly=True)
    o._RUN_STATS.update(requests=0, ok_200=0, http_403=0, blocked_sections=[])
    o._notify_blocked_sections(only_monthly=True)
    assert len(clean_run) == 1, "no requests is not evidence of recovery"


def test_block_state_is_keyed_per_feed_set(clean_run):
    """1.13 and 1.14 cover different feeds; a block on one must not silence
    the first report of a block on the other."""
    o._RUN_STATS.update(requests=26, ok_200=0, http_403=26, sections=2)
    _block()
    o._notify_blocked_sections(only_monthly=True)
    o._RUN_STATS["blocked_sections"] = []
    _block()
    o._notify_blocked_sections(skip_monthly=True)
    assert len(clean_run) == 2
    state = json.loads(o.BLOCK_STATE_PATH.read_text())
    assert set(state) == {"ice_monthly", "ice_daily"}


# ── 403 signature ───────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, body, headers, url="https://www.ice.com/publicdocs/x.xls"):
        self.status_code = 403
        self.text = body
        self.headers = headers
        self.url = url


def test_block_signature_is_captured_and_sanitised(clean_run):
    o._record_block_signature(_Resp(
        "<html><head><title>Access Denied</title></head><body>"
        "You don't have permission. Reference #18.abcd1234</body></html>",
        {"Server": "AkamaiGHost", "Content-Type": "text/html",
         "Set-Cookie": "session=SUPERSECRET; Path=/",
         "Authorization": "Bearer nope"}))
    sig = o._RUN_STATS["block_signature"]
    assert sig["status"] == 403
    assert "Access Denied" in sig["body_excerpt"]
    assert "<" not in sig["body_excerpt"], "tags stripped"
    assert len(sig["body_excerpt"]) <= 200
    # Only the allowlisted headers, and nothing sensitive by construction.
    assert sig["headers"] == {"Server": "AkamaiGHost", "Content-Type": "text/html"}
    blob = json.dumps(sig)
    assert "SUPERSECRET" not in blob and "Bearer" not in blob
    # The path is useful; the query string (which could carry a token) is not.
    assert sig["url_path"] == "/publicdocs/x.xls"


def test_block_signature_keeps_only_the_first(clean_run):
    o._record_block_signature(_Resp("first", {"Server": "A"}))
    o._record_block_signature(_Resp("second", {"Server": "B"}))
    assert o._RUN_STATS["block_signature"]["body_excerpt"] == "first"


def test_signature_survives_an_unreadable_body(clean_run):
    class Bad(_Resp):
        @property
        def text(self):
            raise ValueError("boom")
        @text.setter
        def text(self, v):
            pass
    o._record_block_signature(Bad("x", {"Server": "A"}))
    assert o._RUN_STATS["block_signature"]["body_excerpt"] == ""


# ── Good data survives a block ──────────────────────────────────────────────

def test_a_blocked_run_cannot_overwrite_held_data():
    """The merge is what protects the archive: a run that parsed nothing must
    leave every existing snapshot and monthly row exactly where it was."""
    old = {
        "snapshots": [{"date": "2026-09-03", "total_lots_certified": 4982,
                       "by_port_lots": {"LON": 3457}}],
        "daily_fetched": ["2026-09-03"],
        "monthly": {
            "iss_recv_monthly": [{"month": "2026-07", "total": 111}],
            "age_allowance": [{"month_end": "2026-08-31", "total": 222}],
        },
    }
    # What a wholly-refused run produces: structure, no content.
    blocked = {"snapshots": [], "daily_fetched": [],
               "monthly": {"iss_recv_monthly": [], "age_allowance": []}}
    merged = o._merge_robusta(blocked, old)
    assert merged["snapshots"] == old["snapshots"]
    assert merged["monthly"]["iss_recv_monthly"] == old["monthly"]["iss_recv_monthly"]
    assert merged["monthly"]["age_allowance"] == old["monthly"]["age_allowance"]


def test_a_blocked_run_keeps_the_previous_ageing_report():
    old = {"ageing_report": {"month_end": "2026-08-31", "grand_total": 9},
           "ageing_report_url": "https://ice/x.xls", "snapshots": []}
    merged = o._merge_arabica({"ageing_report": None, "snapshots": []}, old)
    assert merged["ageing_report"] == old["ageing_report"]
    assert merged["ageing_report_url"] == old["ageing_report_url"]


# ── No watchdog may rescue a blocked source in a loop ───────────────────────

def test_nothing_dispatches_the_ice_workflows():
    """There is no ICE watchdog today, and a blocked source is the worst
    possible thing to put one on: every rescue run draws a runner, gets 403,
    leaves the data stale, and re-triggers. This pins the absence so a future
    rescue loop has to be a deliberate decision with a cooldown, not a default.
    """
    offenders = []
    for wf in WF_DIR.glob("*.yml"):
        if wf.name in {MONTHLY_WF.name, DAILY_WF.name}:
            continue
        body = wf.read_text()
        for target in (MONTHLY_WF.name, DAILY_WF.name):
            if f"{target}/dispatches" in body:
                offenders.append(f"{wf.name} -> {target}")
    assert not offenders, f"a workflow now dispatches a blocked-prone ICE job: {offenders}"
