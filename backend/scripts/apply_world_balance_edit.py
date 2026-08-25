#!/usr/bin/env python3
"""apply_world_balance_edit.py — apply an admin-UI edit to the world balance
sheet (frontend/public/data/world_balance_sheet.json).

Only the analyst-entered blocks are writable here: carry-in, consumption by
hub, carry-out and the risk register. PRODUCTION IS NOT — the balance sheet
derives it from the per-origin crop estimates at render time, which is the
property that keeps the world view from disagreeing with an origin tab.
Accepting a production figure through this path would reintroduce exactly
the drift the derivation exists to prevent, so a payload carrying one is
rejected rather than silently ignored.

Payload (validated strictly — the workflow input is remote data):

    {
      "crop_year": "2025/26",
      "updated":   "2026-08",
      "carry_in":     [{"key":"origin_stocks","label":"Origin stocks",
                        "arabica_washed":3.5,"arabica_natural":6.0,"robusta":8.0}],
      "demand_hubs":  [ …same shape… ],
      "carry_out":    [ …same shape… ],
      "risks": [{"key":"enso_vn","driver":"El Niño","origin":"Vietnam",
                 "crop":"robusta","impact_m_bags":-2.5,"probability":0.35,
                 "note":"…"}]
    }

A block that is absent is left as-is; a block that is present replaces its
predecessor wholesale, so deleting a line works.

Usage:
    cd backend
    PYTHONPATH=. python scripts/apply_world_balance_edit.py --payload /tmp/p.json

Exit 0 on success (including a no-op), 1 on any validation failure — the
workflow only commits when `changed` is "true".
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "world_balance_sheet.json"

LEGS = ("arabica_washed", "arabica_natural", "arabica", "robusta")
LINE_BLOCKS = ("carry_in", "demand_hubs", "carry_out")
KEY_RE = re.compile(r"^[a-z0-9_]{1,32}$")
SEASON_RE = re.compile(r"^\d{4}/\d{2}$")
UPDATED_RE = re.compile(r"^\d{4}-\d{2}$")
MAX_LINES = 24
MAX_RISKS = 40
MAX_MBAGS = 400.0        # world-scale lines, not per-origin
MAX_IMPACT = 50.0


def _fail(msg: str) -> int:
    print(f"[world-balance] REJECTED: {msg}", file=sys.stderr)
    return 1


def _num(v, lo: float, hi: float):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if lo <= f <= hi else None


def _clean_lines(raw, block: str):
    if not isinstance(raw, list) or len(raw) > MAX_LINES:
        return f"{block}: must be a list of at most {MAX_LINES} lines"
    seen, out = set(), []
    for ln in raw:
        if not isinstance(ln, dict):
            return f"{block}: each line must be an object"
        key, label = ln.get("key"), ln.get("label")
        if not isinstance(key, str) or not KEY_RE.match(key):
            return f"{block}: bad key {key!r}"
        if key in seen:
            return f"{block}: duplicate key {key!r}"
        seen.add(key)
        if not isinstance(label, str) or not (1 <= len(label.strip()) <= 48):
            return f"{block}.{key}: label must be 1-48 chars"
        row = {"key": key, "label": label.strip()}
        for leg in LEGS:
            if ln.get(leg) is None:
                continue
            v = _num(ln[leg], 0.0, MAX_MBAGS)
            if v is None:
                return f"{block}.{key}.{leg}: must be 0-{MAX_MBAGS} M bags"
            if v:
                row[leg] = round(v, 2)
        out.append(row)
    return out


def _clean_risks(raw):
    if not isinstance(raw, list) or len(raw) > MAX_RISKS:
        return f"risks: must be a list of at most {MAX_RISKS} entries"
    seen, out = set(), []
    for r in raw:
        if not isinstance(r, dict):
            return "risks: each entry must be an object"
        key = r.get("key")
        if not isinstance(key, str) or not KEY_RE.match(key):
            return f"risks: bad key {key!r}"
        if key in seen:
            return f"risks: duplicate key {key!r}"
        seen.add(key)
        row = {"key": key}
        for f in ("driver", "origin", "crop"):
            v = r.get(f)
            if not isinstance(v, str) or not (1 <= len(v.strip()) <= 32):
                return f"risks.{key}.{f}: must be 1-32 chars"
            row[f] = v.strip()
        imp = _num(r.get("impact_m_bags"), -MAX_IMPACT, MAX_IMPACT)
        if imp is None or imp == 0:
            return f"risks.{key}.impact_m_bags: non-zero, within ±{MAX_IMPACT}"
        row["impact_m_bags"] = round(imp, 2)
        prob = _num(r.get("probability"), 0.0, 1.0)
        if prob is None:
            return f"risks.{key}.probability: must be 0-1"
        row["probability"] = round(prob, 3)
        note = r.get("note")
        if note is not None:
            if not isinstance(note, str) or len(note) > 400:
                return f"risks.{key}.note: max 400 chars"
            if note.strip():
                row["note"] = note.strip()
        out.append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", required=True)
    args = ap.parse_args()
    try:
        payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return _fail(f"payload unreadable: {e}")
    if not isinstance(payload, dict):
        return _fail("payload must be an object")

    # Production is derived, never stored — see the module docstring.
    for banned in ("production", "supply", "workflows"):
        if banned in payload:
            return _fail(f"'{banned}' is derived from the crop estimates and cannot be set here")

    try:
        doc = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return _fail(f"{OUT_PATH.name} unreadable: {e}")

    updated = payload.get("updated") or datetime.now(UTC).strftime("%Y-%m")
    if not isinstance(updated, str) or not UPDATED_RE.match(updated):
        return _fail(f"bad updated stamp {updated!r} (want YYYY-MM)")
    crop_year = payload.get("crop_year", doc.get("crop_year"))
    if not isinstance(crop_year, str) or not SEASON_RE.match(crop_year):
        return _fail(f"bad crop_year {crop_year!r} (want YYYY/ZZ)")

    new_doc = dict(doc)
    lines = []
    for block in LINE_BLOCKS:
        if block not in payload:
            continue
        res = _clean_lines(payload[block], block)
        if isinstance(res, str):
            return _fail(res)
        if res != doc.get(block):
            lines.append(f"  ~ {block}: {len(doc.get(block) or [])} → {len(res)} lines")
        new_doc[block] = res
    if "risks" in payload:
        res = _clean_risks(payload["risks"])
        if isinstance(res, str):
            return _fail(res)
        if res != doc.get("risks"):
            lines.append(f"  ~ risks: {len(doc.get('risks') or [])} → {len(res)} entries")
        new_doc["risks"] = res
    if crop_year != doc.get("crop_year"):
        lines.append(f"  ~ crop_year: {doc.get('crop_year')} → {crop_year}")
    new_doc["crop_year"] = crop_year

    out = os.environ.get("GITHUB_OUTPUT")
    if not lines:
        print("[world-balance] no-op: payload matches the file — nothing to write")
        if out:
            Path(out).open("a").write("changed=false\n")
        return 0

    new_doc["updated"] = updated
    OUT_PATH.write_text(json.dumps(new_doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[world-balance] {OUT_PATH.name} (updated: {updated}):")
    print("\n".join(lines))
    if out:
        Path(out).open("a").write("changed=true\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
