from __future__ import annotations

import json
import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    """Where the published JSON lives, resolved per call.

    This used to be a module-level constant snapshotted from the environment at
    import time, which meant a test wanting a different DATA_DIR had to
    `monkeypatch.setenv` and then `importlib.reload(telegram.data)`. monkeypatch
    undoes the env var at teardown; it cannot undo the reload. So the reloaded
    module kept pointing at a tmp_path that no longer existed, and every later
    test in the same session read `None` and got "<x> data unavailable" —
    six of them, in a run where scraper/tests happens to be collected before
    telegram/tests. Reading the variable at call time removes the need to
    reload at all, and with it the whole class of leak.
    """
    return Path(os.environ.get("DATA_DIR") or (_REPO_ROOT / "frontend" / "public" / "data"))


def load(filename: str) -> dict | list | None:
    path = data_dir() / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
