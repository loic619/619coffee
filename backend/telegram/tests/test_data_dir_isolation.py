"""DATA_DIR must be read per call, not snapshotted at import.

The bug this pins took six tests down at once and looked like a data problem.
`telegram/data.py` read DATA_DIR into a module constant at import time, so a
test wanting a different directory had to monkeypatch the env var and then
`importlib.reload(telegram.data)`. monkeypatch undoes the env var at teardown;
nothing undoes the reload. The module kept pointing at a tmp_path that had been
cleaned up, and every later test that read a real published file got None and
rendered "<x> data unavailable" — which is the same string a genuinely empty
feed produces, so it read as six broken handlers rather than one leaked fixture.

It only bit when scraper/tests was collected before telegram/tests, i.e. only
in the full CI command and never when either directory ran alone. That is the
worst shape of flake: invisible locally, red in CI, and pointing at the wrong
file.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import telegram.data as td


def test_env_change_takes_effect_without_a_reload(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert td.data_dir() == tmp_path

    (tmp_path / "x.json").write_text('{"ok": true}', encoding="utf-8")
    assert td.load("x.json") == {"ok": True}


def test_the_default_returns_when_the_env_var_goes_away(monkeypatch):
    """The half that leaked: unsetting must restore the real directory."""
    monkeypatch.setenv("DATA_DIR", "/nonexistent-on-purpose")
    assert td.load("cecafe_daily.json") is None

    monkeypatch.delenv("DATA_DIR", raising=False)
    assert td.data_dir().name == "data"
    assert td.data_dir().is_absolute()


def test_no_module_level_snapshot_remains():
    """A reintroduced constant would restore the leak, so name it as a rule."""
    assert not hasattr(td, "_DATA_DIR"), (
        "telegram.data must not snapshot DATA_DIR at import — see this module's "
        "docstring for what that cost"
    )
