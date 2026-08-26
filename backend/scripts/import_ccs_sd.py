"""Import the CCS Coffee S&D tables as a source in the crop-estimate seeds.

CCS publishes three tables — Total, Robusta, Arabica — by origin, 2016/17
onward, plus world consumption and stocks. This adds them as the `ccs` source
alongside USDA / Marex / ECOM / Sopex and friends.

TWO THINGS THE SEEDS CANNOT HOLD, and why

  "Super Six"   CCS aggregates six Central American origins into one line AND
                lists Peru separately — so it is NOT this repo's MAG 6, which
                includes Peru. Splitting 18.8 M bags back across our five
                Central American seeds would be invention, so the group line
                goes to ccs_sd.json instead and no per-origin seed claims it.
  "Others"      A residual by construction. Same treatment.

Everything else maps one-to-one: Brazil, Vietnam, Colombia, Indonesia, India,
Ethiopia, Peru, Uganda, Ivory Coast.

CCS reports arabica as a single number, so the split lands on the LEGACY
`arabica` leg. Run scripts/split_arabica_processing.py afterwards and it is
restated under the same per-origin processing convention as every other
source — that script only ever touches a still-unsplit leg.

Nothing here is trusted on transcription: `_check` asserts that each origin's
arabica + robusta equals its published total, that the origin column sums to
the published Production row, and that arabica + robusta consumption and
stocks reconcile to the published world totals. A typo fails the run.

Usage:
    PYTHONPATH=. python scripts/import_ccs_sd.py --dry-run
    PYTHONPATH=. python scripts/import_ccs_sd.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.validate_export import safe_write_json  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "public" / "data"
CCS_OUT = DATA / "ccs_sd.json"

SEASONS = ["2016/17", "2017/18", "2018/19", "2019/20", "2020/21",
           "2021/22", "2022/23", "2023/24", "2024/25"]

SOURCE = {"key": "ccs", "label": "CCS Coffee", "color": "#facc15"}

# ── Transcribed tables, million 60-kg bags ──────────────────────────────────
TOTAL = {
    "brazil":      [57.3, 50.6, 67.0, 59.0, 72.6, 57.2, 61.0, 69.5, 72.0],
    "vietnam":     [24.1, 30.0, 28.9, 28.7, 27.5, 30.1, 30.7, 28.0, 27.5],
    "colombia":    [14.6, 13.4, 13.9, 13.8, 13.2, 11.8, 10.5, 12.5, 13.0],
    "super_six":   [19.8, 21.0, 20.3, 18.5, 19.3, 18.4, 18.7, 18.8, 18.8],
    "indonesia":   [13.8, 10.8, 11.2, 12.6, 13.7, 13.8, 13.3, 10.2, 12.0],
    "india":       [6.0, 5.9, 5.7, 5.0, 5.7, 6.7, 5.7, 6.2, 6.2],
    "ethiopia":    [5.9, 5.8, 6.4, 6.5, 7.1, 7.4, 7.0, 7.2, 7.2],
    "peru":        [4.1, 4.3, 4.4, 3.8, 3.7, 4.2, 3.5, 4.0, 4.0],
    "uganda":      [5.1, 4.9, 5.0, 5.9, 7.0, 6.4, 6.7, 7.2, 7.2],
    "ivory_coast": [1.4, 2.1, 2.1, 1.9, 1.4, 1.5, 1.5, 1.5, 1.5],
    "others":      [10.4, 10.3, 11.1, 9.6, 8.6, 8.8, 8.7, 8.7, 8.8],
}
TOTAL_PRODUCTION = [162.6, 159.1, 176.0, 165.2, 179.8, 166.3, 167.3, 173.8, 178.2]

ROBUSTA = {
    "vietnam":     [23.1, 29.0, 27.9, 27.7, 26.5, 29.1, 29.7, 27.0, 26.5],
    "brazil":      [11.6, 13.3, 19.0, 20.0, 19.6, 21.2, 22.5, 24.5, 24.0],
    "indonesia":   [12.1, 9.0, 9.6, 10.8, 12.1, 12.1, 11.7, 8.5, 10.3],
    "india":       [5.2, 5.0, 4.8, 4.3, 4.9, 6.0, 5.0, 5.5, 5.5],
    "uganda":      [4.1, 3.7, 4.0, 4.9, 6.3, 5.4, 5.7, 6.2, 6.2],
    "ivory_coast": [1.4, 2.1, 2.1, 1.9, 1.4, 1.5, 1.5, 1.5, 1.5],
    "others":      [5.3, 5.1, 5.7, 5.1, 4.9, 4.6, 4.6, 4.6, 4.6],
}
ROBUSTA_PRODUCTION = [62.8, 67.2, 73.1, 74.8, 75.6, 79.9, 80.6, 77.8, 78.6]

ARABICA = {
    "brazil":    [45.7, 37.3, 48.0, 39.0, 53.0, 36.0, 38.5, 45.0, 48.0],
    "colombia":  [14.6, 13.4, 13.9, 13.8, 13.2, 11.8, 10.5, 12.5, 13.0],
    "super_six": [19.2, 20.1, 19.5, 17.7, 18.5, 17.6, 17.9, 18.0, 18.0],
    "ethiopia":  [5.9, 5.8, 6.4, 6.5, 7.1, 7.4, 7.0, 7.2, 7.2],
    "peru":      [4.1, 4.3, 4.4, 3.8, 3.7, 4.2, 3.5, 4.0, 4.0],
    "others":    [10.3, 10.9, 10.7, 9.6, 8.7, 9.4, 9.4, 9.4, 9.3],
}
ARABICA_PRODUCTION = [99.8, 91.9, 102.9, 90.5, 104.2, 86.3, 86.7, 96.1, 99.5]

CONSUMPTION = {
    "total":   [158.8, 162.1, 169.6, 168.7, 167.9, 172.9, 169.8, 171.6, 174.1],
    "robusta": [64.6, 68.6, 71.6, 74.0, 71.9, 81.5, 83.7, 78.7, 78.4],
    "arabica": [94.2, 93.5, 97.9, 94.6, 96.0, 91.4, 86.1, 92.9, 95.7],
}
STOCKS = {
    "total":   [42.3, 38.3, 44.3, 40.6, 45.6, 39.2, 36.6, 38.9, 43.0],
    "robusta": [15.5, 13.5, 14.8, 14.8, 15.2, 13.6, 10.4, 9.4, 9.6],
    "arabica": [26.8, 24.8, 29.6, 25.7, 30.4, 25.6, 26.3, 29.5, 33.3],
}

#: Origins whose CCS line maps onto one of our seeds. super_six and others
#: are deliberately absent — see the module docstring.
SEED_FILE = {
    "brazil": "br_balance_sheet.json", "vietnam": ("vn_farmer_economics.json", "balance_sheet"),
    "colombia": "co_balance_sheet.json", "indonesia": "id_balance_sheet.json",
    "india": "in_balance_sheet.json", "ethiopia": "et_balance_sheet.json",
    "peru": "pe_balance_sheet.json", "uganda": "ug_balance_sheet.json",
    "ivory_coast": "ci_balance_sheet.json",
}

TOL = 0.35  # published rows are rounded to 0.1, so column sums drift a little


def _check() -> list[str]:
    """Reconcile the transcription against CCS's own published totals."""
    errs: list[str] = []

    def col_sum(table, i):
        return round(sum(v[i] for v in table.values()), 2)

    for i, season in enumerate(SEASONS):
        for name, table, published in (
            ("total", TOTAL, TOTAL_PRODUCTION),
            ("robusta", ROBUSTA, ROBUSTA_PRODUCTION),
            ("arabica", ARABICA, ARABICA_PRODUCTION),
        ):
            got = col_sum(table, i)
            if abs(got - published[i]) > TOL:
                errs.append(f"{season} {name}: origins sum to {got}, table says {published[i]}")

        # The two type tables must add back to the total table.
        if abs(ARABICA_PRODUCTION[i] + ROBUSTA_PRODUCTION[i] - TOTAL_PRODUCTION[i]) > TOL:
            errs.append(f"{season}: arabica + robusta production != total production")

        # Per origin, only where CCS itemises it in BOTH type tables. It does
        # not itemise consistently — Vietnam's small arabica sits inside the
        # arabica table's "Others" row, super_six's small robusta inside the
        # robusta table's — so a blanket per-origin check would compare a
        # number against a blank and fail on correct data.
        for key in set(ARABICA) & set(ROBUSTA) & set(TOTAL) - {"others"}:
            a, r, t = ARABICA[key][i], ROBUSTA[key][i], TOTAL[key][i]
            if abs((a + r) - t) > TOL:
                errs.append(f"{season} {key}: arabica {a} + robusta {r} != total {t}")

        # An origin CCS shows only in the arabica table should carry no robusta.
        for key in (set(ARABICA) & set(TOTAL)) - set(ROBUSTA) - {"others", "super_six"}:
            implied = TOTAL[key][i] - ARABICA[key][i]
            if abs(implied) > TOL:
                errs.append(f"{season} {key}: implied robusta {implied:.1f}, expected none")

        # ...and one shown only in the robusta table must leave a sane arabica
        # remainder, since that remainder is what we derive and store.
        for key in (set(ROBUSTA) & set(TOTAL)) - set(ARABICA) - {"others"}:
            implied = TOTAL[key][i] - ROBUSTA[key][i]
            if implied < -TOL:
                errs.append(f"{season} {key}: implied arabica {implied:.1f} is negative")

        for name, block in (("consumption", CONSUMPTION), ("stocks", STOCKS)):
            if abs(block["arabica"][i] + block["robusta"][i] - block["total"][i]) > TOL:
                errs.append(f"{season} {name}: arabica + robusta != total")
    return errs


def _origin_split(origin: str, i: int) -> dict:
    """CCS's arabica/robusta for one origin-season. Arabica lands on the LEGACY
    leg because CCS publishes one arabica number; split_arabica_processing.py
    restates it under the origin's processing convention afterwards."""
    total = TOTAL[origin][i]
    rob = ROBUSTA.get(origin, [0] * len(SEASONS))[i]
    ara = round(total - rob, 2)
    out = {}
    if ara > 0:
        out["arabica"] = ara
    if rob > 0:
        out["robusta"] = rob
    return out


def apply_to_seed(origin: str, dry_run: bool) -> str:
    spec = SEED_FILE[origin]
    fname, subkey = spec if isinstance(spec, tuple) else (spec, None)
    path = DATA / fname
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return f"{origin:12s} SKIP — {e}"
    seed = doc[subkey] if subkey else doc

    srcs = seed.setdefault("sources", [])
    if not any(s.get("key") == "ccs" for s in srcs):
        srcs.append(dict(SOURCE))

    by_label = {s["season"]: s for s in seed.setdefault("seasons", [])}
    added, updated = 0, 0
    for i, season in enumerate(SEASONS):
        row = by_label.get(season)
        if row is None:
            # CCS reaches back further than the seeds do; keep the history.
            row = {"season": season}
            seed["seasons"].append(row)
            by_label[season] = row
            added += 1
        else:
            updated += 1
        row.setdefault("production", {})["ccs"] = TOTAL[origin][i]
        split = _origin_split(origin, i)
        if split:
            row.setdefault("production_split", {})["ccs"] = split

    seed["seasons"].sort(key=lambda s: s["season"])
    if not dry_run:
        safe_write_json(path, doc, trailing_newline=True)
    return f"{origin:12s} {added} season(s) added, {updated} updated → {fname}"


def write_reference(dry_run: bool) -> None:
    """The CCS world view, including the lines no per-origin seed can hold."""
    doc = {
        "source": "CCS Coffee",
        "unit": "million 60-kg bags",
        "seasons": SEASONS,
        "note": (
            "CCS Coffee supply & demand, as published. `super_six` is CCS's own grouping of six "
            "Central American origins and is NOT this repo's MAG 6 — CCS lists Peru separately — "
            "so it is kept here as a group line rather than split across the per-origin seeds, "
            "which would be invention. `others` is a residual by construction. The per-origin "
            "lines that do map (Brazil, Vietnam, Colombia, Indonesia, India, Ethiopia, Peru, "
            "Uganda, Ivory Coast) are written into those seeds as the `ccs` source; this file is "
            "the rest of the table — group lines, world consumption and world stocks — kept so "
            "the world balance sheet can be read against an independent published set."
        ),
        "production": {
            "total": {k: v for k, v in TOTAL.items()},
            "robusta": {k: v for k, v in ROBUSTA.items()},
            "arabica": {k: v for k, v in ARABICA.items()},
        },
        "production_totals": {
            "total": TOTAL_PRODUCTION, "robusta": ROBUSTA_PRODUCTION, "arabica": ARABICA_PRODUCTION,
        },
        "consumption": CONSUMPTION,
        "stocks": STOCKS,
        "stock_consumption_pct": {
            k: [round(STOCKS[k][i] / CONSUMPTION[k][i] * 100, 1) for i in range(len(SEASONS))]
            for k in ("total", "robusta", "arabica")
        },
        "balance": {
            k: [round(
                (TOTAL_PRODUCTION if k == "total" else
                 ROBUSTA_PRODUCTION if k == "robusta" else ARABICA_PRODUCTION)[i]
                - CONSUMPTION[k][i], 1)
                for i in range(len(SEASONS))]
            for k in ("total", "robusta", "arabica")
        },
    }
    if not dry_run:
        CCS_OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  reference   {'(dry run) ' if dry_run else ''}→ {CCS_OUT.name}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    errs = _check()
    if errs:
        print("[ccs] TRANSCRIPTION CHECK FAILED — nothing written:")
        for e in errs:
            print(f"    {e}")
        return 1
    print(f"[ccs] transcription reconciles across {len(SEASONS)} seasons "
          "(origin sums, arabica+robusta, consumption, stocks)")

    for origin in SEED_FILE:
        print("  " + apply_to_seed(origin, args.dry_run))
    write_reference(args.dry_run)
    if args.dry_run:
        print("[ccs] dry run — no files written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
