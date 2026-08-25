#!/usr/bin/env python3
"""apply_world_balance_edit.py — apply an admin-UI edit to the world balance
sheet and its two depth files.

Writes, all from one payload so one password check covers the whole
statement:
    frontend/public/data/world_balance_sheet.json  — the statement itself
    frontend/public/data/origin_grades.json        — quality ladders per origin
    frontend/public/data/demand_segments.json      — consumption mix per hub

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
                 "note":"…"}],

      # Depth level 3. Both are SHARES of the parent leg, never bags, so the
      # detail always re-sums to its parent and cannot drift when the parent
      # moves. Each leg's shares must total 1.
      "origin_grades":   {"honduras": {"arabica_washed":
                            [{"key":"shg","label":"SHG","share":0.55}, …]}},
      "demand_segments": {"default_mix": {"robusta": {"instant_pure":0.26, …}},
                          "hub_mix": {"europe": {"robusta": {…}}}}
    }

The segment TAXONOMY (which formats exist) is structural and not writable
here — only the mix across it. Grade ladders are fully writable: the whole
point of per-origin vocabulary is that the analyst names the grades.

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
DATA = ROOT / "frontend" / "public" / "data"
OUT_PATH = DATA / "world_balance_sheet.json"
GRADES_PATH = DATA / "origin_grades.json"
SEGMENTS_PATH = DATA / "demand_segments.json"

LEGS = ("arabica_washed", "arabica_natural", "arabica", "robusta")
LINE_BLOCKS = ("carry_in", "demand_hubs", "carry_out")
KEY_RE = re.compile(r"^[a-z0-9_]{1,32}$")
SEASON_RE = re.compile(r"^\d{4}/\d{2}$")
UPDATED_RE = re.compile(r"^\d{4}-\d{2}$")
MAX_LINES = 24
MAX_RISKS = 40
MAX_MBAGS = 400.0        # world-scale lines, not per-origin
MAX_IMPACT = 50.0
MAX_ORIGINS = 32
MAX_GRADES = 8           # a ladder longer than this is a price list, not a grade split
SHARE_TOL = 0.005        # a leg's shares must total 1 within half a point


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


def _clean_shares(raw, label: str, keys: list[str] | None):
    """{key: share} → validated dict. Shares must total 1: a mix that does not
    is an entry slip, and silently renormalising it would hide the slip."""
    if not isinstance(raw, dict):
        return f"{label}: must be an object of key → share"
    out = {}
    for k, v in raw.items():
        if not isinstance(k, str) or not KEY_RE.match(k):
            return f"{label}: bad key {k!r}"
        if keys is not None and k not in keys:
            return f"{label}.{k}: not a declared segment"
        s = _num(v, 0.0, 1.0)
        if s is None:
            return f"{label}.{k}: share must be 0-1"
        out[k] = round(s, 4)
    if not out:
        return f"{label}: empty"
    tot = sum(out.values())
    if abs(tot - 1.0) > SHARE_TOL:
        return f"{label}: shares total {tot:.3f}, must total 1"
    return out


def _clean_grades(raw):
    """{origin: {leg: [{key,label,share}]}} — the per-origin quality ladders."""
    if not isinstance(raw, dict) or len(raw) > MAX_ORIGINS:
        return f"origin_grades: must be an object of at most {MAX_ORIGINS} origins"
    out = {}
    for origin, legs in raw.items():
        if not isinstance(origin, str) or not KEY_RE.match(origin):
            return f"origin_grades: bad origin key {origin!r}"
        if not isinstance(legs, dict):
            return f"origin_grades.{origin}: must be an object of leg → ladder"
        cleaned = {}
        for leg, ladder in legs.items():
            if leg not in LEGS:
                return f"origin_grades.{origin}: unknown leg {leg!r}"
            if not isinstance(ladder, list) or not ladder or len(ladder) > MAX_GRADES:
                return f"origin_grades.{origin}.{leg}: 1-{MAX_GRADES} grades"
            seen, rows, total = set(), [], 0.0
            for g in ladder:
                if not isinstance(g, dict):
                    return f"origin_grades.{origin}.{leg}: each grade must be an object"
                key, lbl = g.get("key"), g.get("label")
                if not isinstance(key, str) or not KEY_RE.match(key):
                    return f"origin_grades.{origin}.{leg}: bad grade key {key!r}"
                if key in seen:
                    return f"origin_grades.{origin}.{leg}: duplicate grade {key!r}"
                seen.add(key)
                if not isinstance(lbl, str) or not (1 <= len(lbl.strip()) <= 32):
                    return f"origin_grades.{origin}.{leg}.{key}: label must be 1-32 chars"
                share = _num(g.get("share"), 0.0, 1.0)
                if share is None:
                    return f"origin_grades.{origin}.{leg}.{key}: share must be 0-1"
                total += share
                rows.append({"key": key, "label": lbl.strip(), "share": round(share, 4)})
            if abs(total - 1.0) > SHARE_TOL:
                return (f"origin_grades.{origin}.{leg}: shares total {total:.3f}, "
                        "must total 1")
            cleaned[leg] = rows
        if cleaned:
            out[origin] = cleaned
    return out


def _clean_segments(raw, declared: list[str]):
    """{default_mix, hub_mix} — the consumption mix. The segment taxonomy
    itself is structural and stays where it is."""
    if not isinstance(raw, dict):
        return "demand_segments: must be an object"
    out = {}
    if "default_mix" in raw:
        res = _mix(raw["default_mix"], "demand_segments.default_mix", declared)
        if isinstance(res, str):
            return res
        out["default_mix"] = res
    if "hub_mix" in raw:
        hubs = raw["hub_mix"]
        if not isinstance(hubs, dict) or len(hubs) > MAX_LINES:
            return f"demand_segments.hub_mix: at most {MAX_LINES} hubs"
        cleaned = {}
        for hub, mix in hubs.items():
            if not isinstance(hub, str) or not KEY_RE.match(hub):
                return f"demand_segments.hub_mix: bad hub key {hub!r}"
            res = _mix(mix, f"demand_segments.hub_mix.{hub}", declared)
            if isinstance(res, str):
                return res
            cleaned[hub] = res
        out["hub_mix"] = cleaned
    return out


def _mix(raw, label: str, declared: list[str]):
    """{leg: {segment: share}} for one hub (or the default)."""
    if not isinstance(raw, dict):
        return f"{label}: must be an object of leg → mix"
    out = {}
    for leg, shares in raw.items():
        if leg not in LEGS:
            return f"{label}: unknown leg {leg!r}"
        res = _clean_shares(shares, f"{label}.{leg}", declared)
        if isinstance(res, str):
            return res
        out[leg] = res
    return out


def _write(path: Path, doc: dict, updated: str) -> None:
    doc["updated"] = updated
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


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

    # Everything above touched the statement; anything below touches only a
    # depth file. Tracked separately so editing a grade share does not bump
    # the statement's own updated stamp and leave a diff that says nothing.
    stmt_changed = bool(lines)

    # ── Depth files ────────────────────────────────────────────────────
    depth_writes: list[tuple[Path, dict]] = []
    if "origin_grades" in payload:
        res = _clean_grades(payload["origin_grades"])
        if isinstance(res, str):
            return _fail(res)
        try:
            gdoc = json.loads(GRADES_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            return _fail(f"{GRADES_PATH.name} unreadable: {e}")
        prior = gdoc.get("origins") or {}
        if res != prior:
            # Name the origins that moved — "28 → 28 ladders" is true and
            # useless when the edit was a share, which it usually is.
            moved = sorted(set(prior) | set(res))
            moved = [o for o in moved if prior.get(o) != res.get(o)]
            lines.append(f"  ~ origin_grades: {', '.join(moved) or 'reordered'}")
            gdoc["origins"] = res
            depth_writes.append((GRADES_PATH, gdoc))

    if "demand_segments" in payload:
        try:
            sdoc = json.loads(SEGMENTS_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            return _fail(f"{SEGMENTS_PATH.name} unreadable: {e}")
        declared = [s.get("key") for s in (sdoc.get("segments") or [])]
        res = _clean_segments(payload["demand_segments"], declared)
        if isinstance(res, str):
            return _fail(res)
        changed_seg = False
        for block in ("default_mix", "hub_mix"):
            if block in res and res[block] != sdoc.get(block):
                sdoc[block] = res[block]
                changed_seg = True
                lines.append(f"  ~ demand_segments.{block}")
        if changed_seg:
            depth_writes.append((SEGMENTS_PATH, sdoc))

    out = os.environ.get("GITHUB_OUTPUT")
    if not lines:
        print("[world-balance] no-op: payload matches the file — nothing to write")
        if out:
            Path(out).open("a").write("changed=false\n")
        return 0

    if stmt_changed:
        _write(OUT_PATH, new_doc, updated)
    for path, d in depth_writes:
        _write(path, d, updated)
    print(f"[world-balance] updated {updated}:")
    print("\n".join(lines))
    if out:
        Path(out).open("a").write("changed=true\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
