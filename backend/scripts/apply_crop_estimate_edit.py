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
         "production": {"usda": 63.0, "conab": 56.5},
         "production_split": {                       # optional per-source crop split
           "usda": {"arabica_washed": 6.0, "arabica_natural": 34.0, "robusta": 23.0}
         }},
        ...
      ],
      "sources": [                          # optional: NEW sources to declare
        {"key": "stonex", "label": "StoneX", "color": "#a78bfa"}
      ]
    }

`production` stays the per-source TOTAL in million bags — everything the
S&D card renders keeps reading it. `production_split` is advisory crop
detail entered via the editor's "by source" view. Legs:

    arabica_washed · arabica_natural · robusta     (current)
    arabica                                        (legacy, unsplit)

A split must accompany a total for the same key; it may never exceed that
total; and once two or more legs are given it must sum to it (±0.05). The
legacy `arabica` leg and the washed/natural pair describe the same volume,
so a split carries one form or the other, never both. A season WITHOUT the
field keeps its prior split — except entries whose total changed, which are
dropped as stale; a season WITH the field (even {}) replaces it wholesale.

New sources are appended to the seed's `sources` legend — but only when at
least one season actually carries a value for them, so an accidental add
never litters the legend. Vietnam's nested seed historically had no
`sources` array (the tab hardcoded USDA/MAE/ICO); the first new-source
edit materializes it with the canonical three plus the addition, and the
tab prefers the file's array when present.

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

# vn_farmer_economics::balance_sheet carried no `sources` array (the Vietnam
# tab hardcoded its legend) until the first new-source edit materializes it
# from this canonical list. Keep colors in sync with VietnamTab's fallback.
FALLBACK_SOURCES = {
    "vietnam": [
        {"key": "usda", "label": "USDA", "color": "#3b82f6"},
        # Relabelled MAE in 2025 (MARD merged with the environment
        # ministry); the key stays `mard` so existing seeds keep matching.
        {"key": "mard", "label": "MAE", "color": "#10b981"},
        {"key": "ico",  "label": "ICO",  "color": "#f59e0b"},
    ],
}

SEASON_RE = re.compile(r"^\d{4}/\d{2}$")
UPDATED_RE = re.compile(r"^\d{4}-\d{2}$")
SOURCE_KEY_RE = re.compile(r"^[a-z0-9_]{1,20}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_SEASONS = 40
MAX_SOURCES = 10
# Crop legs a split may carry. `arabica` is the LEGACY unsplit form, kept
# so existing seeds stay valid; new edits use the washed/natural pair. A
# split may use one or the other, never both (see the check below).
SPLIT_LEGS = ("arabica_washed", "arabica_natural", "arabica", "robusta")

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
    existing_sources = [s for s in seed.get("sources", []) if isinstance(s, dict)]
    if not existing_sources:
        existing_sources = FALLBACK_SOURCES.get(origin, [])
    declared = {s.get("key") for s in existing_sources}

    # Optional new-source declarations. Validated here; appended to the
    # legend further down only if some season actually references them.
    new_sources: list[dict] = []
    raw_sources = payload.get("sources") or []
    if not isinstance(raw_sources, list) or len(raw_sources) > MAX_SOURCES:
        return _fail(f"sources must be a list of at most {MAX_SOURCES} entries")
    for src in raw_sources:
        if not isinstance(src, dict):
            return _fail("each source must be an object")
        key, label, color = src.get("key"), src.get("label"), src.get("color")
        if not isinstance(key, str) or not SOURCE_KEY_RE.match(key):
            return _fail(f"bad source key {key!r} (want ^[a-z0-9_]{{1,20}}$)")
        if key in declared or any(s["key"] == key for s in new_sources):
            continue  # already known — nothing to declare
        if not isinstance(label, str) or not (1 <= len(label.strip()) <= 24):
            return _fail(f"source {key}: label must be 1–24 chars")
        if not isinstance(color, str) or not COLOR_RE.match(color):
            return _fail(f"source {key}: color must be #rrggbb")
        new_sources.append({"key": key, "label": label.strip(), "color": color})
    if len(existing_sources) + len(new_sources) > MAX_SOURCES:
        return _fail(f"legend would exceed {MAX_SOURCES} sources")
    declared |= {s["key"] for s in new_sources}

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
        production = {k: round(float(v), 2) for k, v in prod.items()}

        # Optional A/R split. Presence of the field (even {}) makes the
        # payload authoritative for this season's splits.
        split_provided = "production_split" in s
        split_clean: dict[str, dict[str, float]] = {}
        if split_provided:
            raw_split = s.get("production_split")
            if not isinstance(raw_split, dict) or len(raw_split) > MAX_SOURCES:
                return _fail(f"{label}: production_split must be an object")
            for k, sp in raw_split.items():
                if k not in declared:
                    return _fail(f"{label}: split for unknown source {k!r}")
                if k not in production:
                    return _fail(f"{label}.{k}: split without a total")
                if not isinstance(sp, dict):
                    return _fail(f"{label}.{k}: split must be an object")
                legs: dict[str, float] = {}
                for leg in SPLIT_LEGS:
                    v = sp.get(leg)
                    if v is None:
                        continue
                    if isinstance(v, bool) or not isinstance(v, (int, float)) or not (0 < float(v) <= MAX_MBAGS):
                        return _fail(f"{label}.{k}.{leg}: value {v!r} outside (0, {MAX_MBAGS}] M bags")
                    legs[leg] = round(float(v), 2)
                if not legs:
                    return _fail(f"{label}.{k}: split needs at least one of {', '.join(SPLIT_LEGS)}")
                # `arabica` (legacy, unsplit) and the washed/natural pair are
                # alternative descriptions of the same volume — carrying both
                # would double-count in any consumer that sums the legs.
                if "arabica" in legs and ("arabica_washed" in legs or "arabica_natural" in legs):
                    return _fail(
                        f"{label}.{k}: use arabica_washed/arabica_natural OR legacy arabica, not both")
                legs_sum = round(sum(legs.values()), 2)
                if legs_sum > production[k] + 0.051:
                    return _fail(
                        f"{label}.{k}: split {legs_sum} exceeds total {production[k]}")
                # Two or more legs means the split is meant to be complete —
                # same rule the 2-leg version enforced, generalised.
                if len(legs) >= 2 and abs(legs_sum - production[k]) > 0.051:
                    return _fail(
                        f"{label}.{k}: split {legs_sum} ≠ total {production[k]}")
                split_clean[k] = legs

        # Optional analyst "Final" override for the displayed production
        # figure. Field present (number or null) = authoritative; null
        # clears the override so the display falls back to the avg.
        final_provided = "production_final" in s
        final_val = None
        if final_provided:
            fv = s.get("production_final")
            if fv is not None:
                if isinstance(fv, bool) or not isinstance(fv, (int, float)) or not (0 < float(fv) <= MAX_MBAGS):
                    return _fail(f"{label}: production_final {fv!r} outside (0, {MAX_MBAGS}] M bags")
                final_val = round(float(fv), 2)

        entry = {"season": label, "forecast": bool(s.get("forecast")), "production": production}
        if split_clean:
            entry["production_split"] = split_clean
        if split_provided:
            entry["_split_provided"] = True  # merge marker, stripped below
        if final_val is not None:
            entry["production_final"] = final_val
        if final_provided:
            entry["_final_provided"] = True
        clean.append(entry)
    clean.sort(key=lambda s: _season_start_year(s["season"]) or 0)

    # Merge-preserve: a season keeps any sibling fields the UI doesn't manage.
    old_by_label = {s.get("season"): s for s in seed["seasons"] if isinstance(s, dict)}
    merged = []
    for s in clean:
        split_provided = s.pop("_split_provided", False)
        final_provided = s.pop("_final_provided", False)
        prior = old_by_label.get(s["season"], {})
        managed = {"season", "forecast", "production"}
        if split_provided:
            managed.add("production_split")
        if final_provided:
            managed.add("production_final")
        extras = {k: v for k, v in prior.items() if k not in managed}
        row = {**s, **extras}
        # A preserved (payload-untouched) split whose total changed is stale
        # — drop just those entries so split and total can't disagree.
        if not split_provided and isinstance(row.get("production_split"), dict):
            pp = prior.get("production", {}) if isinstance(prior.get("production"), dict) else {}
            kept = {k: v for k, v in row["production_split"].items()
                    if k in row["production"] and row["production"].get(k) == pp.get(k)}
            if kept:
                row["production_split"] = kept
            else:
                row.pop("production_split", None)
        merged.append(row)
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
        ps = prior.get("production_split") if isinstance(prior.get("production_split"), dict) else {}
        ns = s.get("production_split", {})
        for k in sorted(set(ps or {}) | set(ns)):
            if (ps or {}).get(k) != ns.get(k):
                new = ns.get(k)
                desc = (
                    " / ".join(
                        f"{lbl} {new[leg]}"
                        for leg, lbl in (("arabica_washed", "Aw"),
                                         ("arabica_natural", "An"),
                                         ("arabica", "A"),
                                         ("robusta", "R"))
                        if new.get(leg) is not None
                    ) or "—"
                ) if new else "removed"
                lines.append(f"  ~ {s['season']}.{k} split: {desc}")
        if prior.get("production_final") != s.get("production_final"):
            lines.append(
                f"  ~ {s['season']}: final {prior.get('production_final')} → {s.get('production_final')}")
    for lbl in removed:
        lines.append(f"  − {lbl}: season removed")

    # Only declare new sources that some season actually carries — an
    # accidental add with no values never litters the legend.
    referenced = {k for s in merged for k in s["production"]}
    adopted = [s for s in new_sources if s["key"] in referenced]
    for s in adopted:
        lines.append(f"  + source {s['key']} ({s['label']}, {s['color']})")

    if not lines:
        print("[crop-edit] no-op: payload matches the file — nothing to write")
        _emit_outputs(path, origin, changed=False)
        return 0

    if adopted:
        # Materializes the array for Vietnam's legacy seed (no `sources` key);
        # the tab prefers the file's array when present.
        seed["sources"] = existing_sources + adopted

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
