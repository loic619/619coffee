"""Restate legacy unsplit arabica as washed / natural in the crop-estimate seeds.

The world balance sheet reports arabica in two processing legs because the
trade prices them separately — Colombian and Central American washed against
Brazilian and Ethiopian naturals. The per-origin seeds, however, were filed
with a single `arabica` leg, because that is all the source documents
(Marex, ECOM, Sopex, USDA) publish: a country total, not a processing
breakdown.

So the split is an ANALYST OVERLAY, not a source figure, and this script is
where the overlay lives. Each origin gets a washed share from how the crop is
actually processed, with the reasoning written down next to it, and the seed
records `arabica_split_basis` so nobody has to come back here to find out
where the number came from.

Deliberately conservative in two ways:

  · It only touches a split that still carries the legacy `arabica` leg. An
    entry already restated — by hand, by the admin editor, or by an earlier
    run — is left exactly as it is, so the script is safe to re-run and never
    overwrites a real published breakdown with a convention.
  · The two legs are made to sum to the original arabica figure exactly
    (natural takes the rounding residual), so restating can never change an
    origin's headline production.

Usage:
    PYTHONPATH=. python scripts/split_arabica_processing.py --dry-run
    PYTHONPATH=. python scripts/split_arabica_processing.py
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

# origin → (file, nested key or None, washed share of arabica, why).
#
# Shares are round numbers on purpose: they are processing conventions, not
# measurements, and pretending to two decimals would dress a judgement up as
# a statistic. Override any of them per source in the ✎ crop-estimate editor
# — a hand-entered split always wins, because this script never re-splits.
ORIGINS: dict[str, tuple[str, str | None, float, str]] = {
    "brazil": ("br_balance_sheet.json", None, 0.0,
               "Brazilian arabica is dry-processed (natural and pulped-natural); "
               "the trade prices the whole crop as naturals."),
    "colombia": ("co_balance_sheet.json", None, 1.0,
                 "Fully washed — the reference for the washed arabica complex."),
    "honduras": ("hn_balance_sheet.json", None, 1.0, "Other milds — washed."),
    "guatemala": ("gt_balance_sheet.json", None, 1.0, "Other milds — washed."),
    "nicaragua": ("ni_balance_sheet.json", None, 1.0, "Other milds — washed."),
    "costa_rica": ("cr_balance_sheet.json", None, 1.0,
                   "Other milds — washed; honey lots are immaterial at balance-sheet scale."),
    "mexico": ("mx_balance_sheet.json", None, 1.0, "Other milds — washed."),
    "peru": ("pe_balance_sheet.json", None, 1.0, "Other milds — washed."),
    "ethiopia": ("et_balance_sheet.json", None, 0.30,
                 "Sun-dried naturals dominate (Harrar, Sidama, Guji); the washed share is "
                 "Yirgacheffe/Limu and the ECX washed grades — conventionally about a third."),
    "india": ("in_balance_sheet.json", None, 0.50,
              "Indian arabica splits between Plantation (washed) and Cherry (natural), "
              "historically close to half and half."),
    "indonesia": ("id_balance_sheet.json", None, 1.0,
                  "Sumatran giling basah / semi-washed; traded against the washed complex."),
    "vietnam": ("vn_farmer_economics.json", "balance_sheet", 1.0,
                "The Son La / Dien Bien arabica crop is washed."),
    "china": ("cn_balance_sheet.json", None, 1.0, "Yunnan arabica is washed."),
    "uganda": ("ug_balance_sheet.json", None, 0.65,
               "Mt Elgon (Bugisu) is washed; West Nile drugar is natural. The share "
               "follows the arabica belt weights in the Uganda weather model "
               "(Mt Elgon 38 kt washed vs West Nile 16 kt natural, Rwenzori 12 kt mixed)."),
    "tanzania": ("tz_balance_sheet.json", None, 1.0,
                 "Northern (Kilimanjaro/Arusha) and southern (Mbeya) arabica is washed; "
                 "Kagera's crop is robusta."),
    # Ivory Coast is robusta only — no arabica leg to restate.
}


def _r1(v: float) -> float:
    return round(v * 10) / 10


def restate(origin: str, dry_run: bool) -> bool:
    file, subkey, washed_share, basis = ORIGINS[origin]
    path = DATA / file
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  {origin:12s} SKIP — {e}")
        return False

    seed = doc[subkey] if subkey else doc
    touched = []
    for season in seed.get("seasons", []):
        for src, legs in (season.get("production_split") or {}).items():
            arabica = legs.get("arabica")
            if not arabica:
                continue
            if legs.get("arabica_washed") or legs.get("arabica_natural"):
                # Already restated — a real breakdown outranks a convention.
                continue
            washed = _r1(arabica * washed_share)
            natural = _r1(arabica - washed)  # residual keeps the total exact
            legs.pop("arabica")
            if washed:
                legs["arabica_washed"] = washed
            if natural:
                legs["arabica_natural"] = natural
            touched.append(f"{season['season']}/{src}: {arabica} → w {washed} + n {natural}")

    if not touched:
        print(f"  {origin:12s} nothing to restate")
        return False

    seed["arabica_split_basis"] = (
        f"washed {round(washed_share * 100)}% / natural {round((1 - washed_share) * 100)}% — {basis} "
        "Analyst convention applied to sources that publish only an arabica total; "
        "a source's own breakdown, or a hand edit in the crop-estimate editor, wins over it."
    )
    print(f"  {origin:12s} {len(touched)} entries restated (washed {round(washed_share * 100)}%)")
    for t in touched:
        print(f"      {t}")
    if not dry_run:
        safe_write_json(path, doc, trailing_newline=True)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(f"[arabica-split] {'DRY RUN — ' if args.dry_run else ''}restating legacy arabica legs")
    changed = sum(restate(o, args.dry_run) for o in ORIGINS)
    print(f"[arabica-split] {changed} seed(s) {'would change' if args.dry_run else 'written'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
