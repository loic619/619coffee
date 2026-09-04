"""Phase-3 messages: /exports, /imports, /help, /run.

Rendered against the real published files, same contract as the Phase-2 suite:
a schema move breaks CI rather than the bot.

The two new commands carry a unit hazard the older ones do not — four origin
feeds publishing in bags, thousand bags and kilos — so the numeric assertions
here are order-of-magnitude sanity checks, not pinned values. A row that reads
745k bags is a plausible month for Uganda; the same field read as its own
`unit` string claims would print 745M, which is the bug these guard.
"""
from __future__ import annotations

import re

import pytest

from telegram.formatting.tables import WIDTH_BUDGET, width_of
from telegram.handlers import exports, imports, run
from telegram.handlers import help as help_handler

_PRE = re.compile(r"<pre>.*?</pre>", re.S)
_NAMES = ["exports", "imports"]


@pytest.fixture(scope="module")
def messages() -> dict[str, str]:
    return {"exports": exports.handle("", {}),
            "imports": imports.handle("", {})}


@pytest.mark.parametrize("name", _NAMES)
def test_renders_with_data(messages, name):
    assert "unavailable" not in messages[name]


@pytest.mark.parametrize("name", _NAMES)
def test_pre_blocks_fit_the_phone(messages, name):
    for block in _PRE.findall(messages[name]):
        assert width_of(block) <= WIDTH_BUDGET, f"{name}: {width_of(block)} chars"


@pytest.mark.parametrize("name", _NAMES)
def test_pre_blocks_are_escaped_and_unstyled(messages, name):
    for block in _PRE.findall(messages[name]):
        body = block[len("<pre>"):-len("</pre>")]
        assert "<" not in body and ">" not in body


# ── /exports ─────────────────────────────────────────────────────────────────

def test_exports_covers_the_four_origins(messages):
    for code in ("BR", "VN", "ID", "UG"):
        assert re.search(rf"\b{code}\b", messages["exports"]), f"{code} missing"


def test_exports_volumes_are_in_bags_not_source_units(messages):
    """The whole point of the handler: Vietnam publishes thousand bags and
    Indonesia kilos, so an un-normalised row is off by 10^3 either way. Every
    origin ships between ~0.1M and ~5M bags in a month."""
    block = _PRE.findall(messages["exports"])[0]
    seen = 0
    for value, suffix in re.findall(r"([\d.,]+)([Mk])\b", block):
        bags = float(value.replace(",", "")) * (1_000_000 if suffix == "M" else 1_000)
        assert 50_000 <= bags <= 6_000_000, f"{value}{suffix} is not a month of bags"
        seen += 1
    assert seen >= 3, f"expected a volume on each origin row: {block!r}"


def test_exports_labels_each_row_with_its_own_month(messages):
    """The origins report on different lags; a single header month would imply
    a like-for-like comparison the rows cannot support."""
    block = _PRE.findall(messages["exports"])[0]
    months = re.findall(r"\b[A-Z][a-z]{2} \d{2}\b", block)
    assert len(months) >= 3, f"per-row month missing: {block!r}"
    assert "does not total" in messages["exports"]


# ── /imports ─────────────────────────────────────────────────────────────────

def test_imports_covers_both_blocs(messages):
    assert "US" in messages["imports"] and "EU" in messages["imports"]


def test_imports_keeps_the_unit(messages):
    assert "MT" in messages["imports"]


def test_imports_shows_a_trend_per_bloc(messages):
    """One month of customs data moves on shipping schedules as much as on
    demand, so the latest figure alone is not readable."""
    assert messages["imports"].lower().count("trend") >= 2
    assert re.search(r"[▲▼→]", messages["imports"])


# ── /help ────────────────────────────────────────────────────────────────────

def test_help_advertises_only_dispatchable_commands():
    """The /brief footer once advertised six commands that did not exist. The
    list here is generated from DISPATCH so it cannot drift the same way."""
    from telegram.commands import DISPATCH
    out = help_handler.handle("", {})
    advertised = set(re.findall(r"<b>/(\w+)</b>", out))
    assert advertised, f"no commands listed: {out!r}"
    assert not advertised - set(DISPATCH), f"not dispatchable: {advertised - set(DISPATCH)}"


def test_help_lists_every_registered_command():
    """And the other direction: a command added to DISPATCH but never described
    still has to appear, rather than going missing silently."""
    from telegram.commands import DISPATCH
    out = help_handler.handle("", {})
    listed = set(re.findall(r"<b>/(\w+)</b>", out))
    assert set(DISPATCH) - listed == set(), f"unlisted: {set(DISPATCH) - listed}"


# ── /run ─────────────────────────────────────────────────────────────────────

def test_run_without_args_lists_the_workflows():
    out = run.handle("", {})
    for name in run.WORKFLOWS:
        assert f"/run {name}" in out


def test_run_rejects_an_unknown_workflow_without_calling_github(monkeypatch):
    """An unknown name must not reach requests.post — the dispatch URL would be
    built from an attacker-supplied path segment."""
    import requests
    def _boom(*a, **k):
        raise AssertionError("requests.post called for an unknown workflow")
    monkeypatch.setattr(requests, "post", _boom)
    assert "/run prices" in run.handle("../../etc/passwd", {})


def test_run_reports_a_timeout_as_pending_not_failed(monkeypatch):
    """GitHub may have accepted the dispatch and simply been slow to answer;
    calling that a failure invites a second trigger of a running workflow."""
    import requests
    monkeypatch.setenv("GH_OWNER", "o")
    monkeypatch.setenv("GH_REPO", "r")
    monkeypatch.setenv("GH_PAT", "p")
    monkeypatch.setattr(requests, "post",
                        lambda *a, **k: (_ for _ in ()).throw(requests.Timeout()))
    out = run.handle("prices", {})
    assert "timed out" in out and "failed" not in out.lower()


def test_run_says_nothing_changed_when_github_refuses(monkeypatch):
    import requests
    monkeypatch.setenv("GH_OWNER", "o")
    monkeypatch.setenv("GH_REPO", "r")
    monkeypatch.setenv("GH_PAT", "p")
    monkeypatch.setattr(requests, "post",
                        lambda *a, **k: type("R", (), {"status_code": 403})())
    out = run.handle("prices", {})
    assert "403" in out and "No data was changed" in out
