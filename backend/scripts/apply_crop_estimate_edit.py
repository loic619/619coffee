"""apply_crop_estimate_edit.py — apply an admin-UI crop-estimate edit to an
origin's multi-source balance-sheet seed.

The "edit mode" on each origin's S&D card posts edited production estimates
to /api/admin/crop-estimates (password-gated in the Next.js route); that
route dispatches the apply-crop-estimate-edit workflow, which runs this
script. The payload replaces the seed's `seasons` array wholesale — the UI
always loads the file fresh before editing — while sibling fields the UI
doesn't manage (Vietnam rows carry exports_ico / consumption; the file's
unit / note / sources) are preserved by merging against the prior content.

Payload shape (validated strictly — the workflow input is remote data):

    {
      "origin":  "brazil",                  # key in build_balance_sheets.ORIGINS
      "updated": "2026-08",                 # stamp to write
      "seasons": [
        {"season": "2025/26", "forecast": true,
         "production": {"usda": 63.0, "conab": 56.5}},
        ...
      ]
    }

Usage:
    cd backend
    PYTHONPATH=. python scripts/apply_crop_estimate_edit.py --payload /tmp/payload.json

Exit 0 on success (including a no-op), 1 on any validation failure — the
workflow only commits when the `changed` output is "true".
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from scraper.build_balance_sheets import ORIGINS, ROOT, _season_start_year, _split_target
from scraper.validate_export import safe_write_json

# vn_farmer_economics::balance_sheet carries no `sources` array (the Vietnam
# tab hardcodes its legend), so its source allowlist lives here.
FALLBACK_SOURCE_KEYS = {"vietnam": {"usda", "mard", "ico"}}

SEASON_RE = re.compile(r"^\d{4}/\d{2}$")
UPDATED_RE = re.compile(r"^\d{4}-\d{2}$")
MAX_SEASONS = 40
MAX_MBAGS = 200.0  # sanity ceiling, million 60-kg bags (world crop ≈ 175)


def _fail(msg: str) -> int:
    print(f"[crop-edit] REJECTED: {msg}", file=sys.stderr)
    return 1


def _emit_outputs(target: Path, origin: str, changed: bool) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if not out:
        return
    with open(out, "a", encoding="utf-8") as f:
        f.write(f"target={target.relative_to(ROOT).as_posix()}\n")
        f.write(f"origin={origin}\n")
        f.write(f"changed={'true' if changed else 'false'}\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", required=True, help="Path to the edit-payload JSON")
    args = ap.parse_args()

    try:
        payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return _fail(f"payload unreadable: {e}")

    origin = payload.get("origin")
    if origin not in ORIGINS:
        return _fail(f"unknown origin {origin!r} (allowed: {sorted(ORIGINS)})")
    updated = payload.get("updated") or datetime.now(UTC).strftime("%Y-%m")
    if not isinstance(updated, str) or not UPDATED_RE.match(updated):
        return _fail(f"bad updated stamp {updated!r} (want YYYY-MM)")
    seasons = payload.get("seasons")
    if not isinstance(seasons, list) or not (1 <= len(seasons) <= MAX_SEASONS):
        return _fail(f"seasons must be a list of 1..{MAX_SEASONS} entries")

    path, subkey = _split_target(ORIGINS[origin])
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return _fail(f"target {path.name} unreadable: {e}")
    seed = doc.get(subkey) if subkey else doc
    if not isinstance(seed, dict) or not isinstance(seed.get("seasons"), list):
        return _fail(f"{path.name}: seasons block missing")
    declared = {s.get("key") for s in seed.get("sources", []) if isinstance(s, dict)}
    declared = declared or FALLBACK_SOURCE_KEYS.get(origin, set())

    seen: set[str] = set()
    clean: list[dict] = []
    for s in seasons:
        if not isinstance(s, dict):
            return _fail("each season must be an object")
        label = s.get("season")
        if not isinstance(label, str) or not SEASON_RE.match(label):
            return _fail(f"bad season label {label!r} (want YYYY/ZZ)")
        start = _season_start_year(label)
        if start is None or int(label.split("/")[1]) != (start + 1) % 100:
            return _fail(f"season {label!r}: end year must follow the start year")
        if label in seen:
            return _fail(f"duplicate season {label!r}")
        seen.add(label)
        prod = s.get("production")
        if not isinstance(prod, dict) or not prod:
            return _fail(f"{label}: production must carry at least one source value")
        unknown = set(prod) - declared
        if unknown:
            return _fail(f"{label}: unknown source keys {sorted(unknown)} (allowed: {sorted(declared)})")
        for k, v in prod.items():
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not (0 < float(v) <= MAX_MBAGS):
                return _fail(f"{label}.{k}: value {v!r} outside (0, {MAX_MBAGS}] M bags")
        clean.append({
            "season": label,
            "forecast": bool(s.get("forecast")),
            "production": {k: round(float(v), 2) for k, v in prod.items()},
        })
    clean.sort(key=lambda s: _season_start_year(s["season"]) or 0)

    # Merge-preserve: a season keeps any sibling fields the UI doesn't manage.
    old_by_label = {s.get("season"): s for s in seed["seasons"] if isinstance(s, dict)}
    merged = []
    for s in clean:
        prior = old_by_label.get(s["season"], {})
        extras = {k: v for k, v in prior.items() if k not in ("season", "forecast", "production")}
        merged.append({**s, **extras})
    removed = [lbl for lbl in old_by_label if lbl not in seen]

    lines: list[str] = []
    for s in merged:
        prior = old_by_label.get(s["season"])
        if prior is None:
            vals = ", ".join(f"{k}={v}" for k, v in s["production"].items())
            lines.append(f"  + {s['season']}{' (f)' if s['forecast'] else ''}: {vals}")
            continue
        pp = prior.get("production", {}) if isinstance(prior.get("production"), dict) else {}
        for k in sorted(set(pp) | set(s["production"])):
            if pp.get(k) != s["production"].get(k):
                lines.append(f"  ~ {s['season']}.{k}: {pp.get(k)} → {s['production'].get(k)}")
        if bool(prior.get("forecast")) != s["forecast"]:
            lines.append(f"  ~ {s['season']}: forecast {bool(prior.get('forecast'))} → {s['forecast']}")
    for lbl in removed:
        lines.append(f"  − {lbl}: season removed")

    if not lines:
        print("[crop-edit] no-op: payload matches the file — nothing to write")
        _emit_outputs(path, origin, changed=False)
        return 0

    seed["seasons"] = merged
    # Vietnam's nested seed carries no `updated` of its own — stamp the root.
    if subkey and "updated" not in seed:
        doc["updated"] = updated
    else:
        seed["updated"] = updated
    safe_write_json(path, doc, trailing_newline=True)
    print(f"[crop-edit] {origin} → {path.name} (updated: {updated}):")
    print("\n".join(lines))
    _emit_outputs(path, origin, changed=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
