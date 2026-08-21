"""Mirror model inputs that live OUTSIDE frontend/public into the served tree.

The Research tab offers the open-direction model's data files for download so
the model can be reconstructed and its numbers reproduced. That only works for
files the browser can actually fetch, i.e. files under frontend/public/data.

brent_intraday_anchors.json does not qualify: it is written to the repo-root
data/ directory by fetch_fx_snapshots (daily appends) and
backfill_brent_intraday (the per-contract history). Next.js never serves that
directory, so the file was unreachable — a link to it would 404, and anyone
rebuilding the model from the published set would silently be missing the
brent_overnight input behind the oil_shock regime tag.

The repo-root copy stays the source of truth — open_direction._BRENT still
reads it, so the model cannot end up training on a stale mirror. This exporter
only republishes it, daily, from whichever writer last touched it.
"""
from __future__ import annotations

import json
from pathlib import Path

from scraper.validate_export import safe_write_json

_ROOT = Path(__file__).resolve().parents[3]
_SRC_DIR = _ROOT / "data"
_PUB_DIR = _ROOT / "frontend" / "public" / "data"

# source filename → what it feeds, for the failure message
_MIRROR = {
    "brent_intraday_anchors.json": "brent_overnight (oil_shock regime tag)",
}


def export_model_inputs() -> dict:
    """Copy each mirrored file into the served tree. Returns {name: rows}."""
    out: dict[str, int] = {}
    for name, role in _MIRROR.items():
        src = _SRC_DIR / name
        if not src.exists():
            raise FileNotFoundError(f"{name} missing from data/ — feeds {role}")
        doc = json.loads(src.read_text(encoding="utf-8"))
        days = doc.get("days") or []
        if not days:
            raise ValueError(f"{name} has no rows — feeds {role}")
        # Re-serialise rather than shutil.copy so the mirror goes through
        # safe_write_json's atomic write and validation, like every other
        # published file.
        safe_write_json(_PUB_DIR / name, doc, ensure_ascii=False, indent=1)
        out[name] = len(days)
        print(f"[model_inputs] {name}: {len(days)} rows → public "
              f"(latest {days[-1].get('date')})")
    return out
