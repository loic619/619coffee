"""Guard the two ways a GitHub Actions workflow can go quiet without failing.

Both bit this project already, and neither shows up as a red check:

1. `workflow_run` matches on the workflow's exact DISPLAY TITLE. Rename a
   workflow and every listener stops waking — no error, no warning, just a
   trigger that never fires again. A renumbering pass is exactly when this
   happens.

2. Two workflows sharing a leading number makes the run record ambiguous and
   any human instruction ("re-run 1.17") unresolvable.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

WF_DIR = Path(__file__).resolve().parents[3] / ".github" / "workflows"
NUMBER_RE = re.compile(r"^([\d.]+[a-z]?)\s*[–-]")


def _workflows() -> list[tuple[str, dict]]:
    out = []
    for f in sorted(WF_DIR.glob("*.yml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        if isinstance(doc, dict):
            out.append((f.name, doc))
    return out


def _triggers(doc: dict) -> dict:
    # PyYAML reads a bare `on:` key as the boolean True.
    return doc.get(True) if True in doc else (doc.get("on") or {})


def test_workflow_dir_is_present():
    assert WF_DIR.is_dir(), f"no workflow directory at {WF_DIR}"
    assert _workflows(), "no workflows parsed — the glob or the parser is wrong"


def test_every_workflow_run_reference_resolves():
    """A listener naming a title nothing publishes is a dead trigger."""
    files = _workflows()
    titles = {doc["name"] for _, doc in files if doc.get("name")}

    dangling = []
    for name, doc in files:
        on = _triggers(doc)
        wr = on.get("workflow_run") if isinstance(on, dict) else None
        if not isinstance(wr, dict):
            continue
        for wanted in wr.get("workflows") or []:
            if wanted not in titles:
                dangling.append(f"{name} listens for {wanted!r}, which no workflow is named")

    assert not dangling, (
        "workflow_run triggers that will never fire:\n  " + "\n  ".join(dangling)
    )


def test_workflow_numbers_are_unique():
    """Two workflows on one number make the run record ambiguous."""
    seen: dict[str, list[str]] = {}
    for name, doc in _workflows():
        title = doc.get("name")
        if not title:
            continue
        m = NUMBER_RE.match(title)
        if m:
            seen.setdefault(m.group(1), []).append(f"{title} [{name}]")

    clashes = {n: v for n, v in seen.items() if len(v) > 1}
    assert not clashes, "duplicate workflow numbers:\n" + "\n".join(
        f"  {n}: " + "; ".join(v) for n, v in sorted(clashes.items())
    )
