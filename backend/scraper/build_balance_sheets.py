"""build_balance_sheets.py — semi-annual refresh of the per-origin
multi-source production-estimate seed files.

The S&D card on each origin tab (Brazil / Indonesia / Uganda / Vietnam)
reads a `*_balance_sheet.json` carrying production estimates from several
independent sources (USDA / CONAB / GAEKI / UCDA / ICO). Of those, only
**USDA** is machine-readable on a reliable cadence: psd_coffee + the
usda_gain_pdf source already merge it into demand_stocks.json daily.

This builder keeps the seed files' USDA column in lock-step with that
live USDA pipeline so the equation strip + production-spread block never
drift from the backbone bars. The non-USDA sources (CONAB / GAEKI / UCDA
/ ICO) are PDFs / press releases with no dependable feed — those stay
human-curated and the workflow emits a checklist reminding the operator
to refresh them twice a year (after USDA's June Annual + December
Semi-Annual, when the other agencies publish too).

Mapping
-------
A seed season label "YYYY/ZZ" denotes the crop STARTING in calendar year
YYYY. demand_stocks.json keys USDA rows by that same start year, so
season "2025/26" ← demand_stocks producers.<origin>.annual[year == 2025].
USDA production_mt → million 60-kg bags = production_mt / 60000.

Idempotent. Re-running with no upstream change rewrites nothing.

Usage
-----
    cd backend
    python -m scraper.build_balance_sheets            # refresh + report
    python -m scraper.build_balance_sheets --check    # report only, exit 1 if stale
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scraper.validate_export import safe_write_json

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "public" / "data"
DEMAND_STOCKS = DATA / "demand_stocks.json"

# Seed file ↔ demand_stocks producer key. Vietnam is nested inside
# vn_farmer_economics.json under `balance_sheet`; we handle that as a
# sub-path below.
ORIGINS = {
    "brazil":    "br_balance_sheet.json",
    "colombia":  "co_balance_sheet.json",
    "indonesia": "id_balance_sheet.json",
    "uganda":    "ug_balance_sheet.json",
    "vietnam":   "vn_farmer_economics.json::balance_sheet",
    # Added Aug 2026 for the global S&D aggregation: every origin the
    # operator wants to hand-curate through the admin editor's "by source"
    # view. The first five (honduras…mexico) have USDA backbones in
    # demand_stocks.json, so their usda column auto-syncs here; the rest
    # have no PSD producer entry yet — refresh_origin skips them with a
    # warning and their numbers are editor-curated only.
    "honduras":    "hn_balance_sheet.json",
    "ethiopia":    "et_balance_sheet.json",
    "india":       "in_balance_sheet.json",
    "peru":        "pe_balance_sheet.json",
    "mexico":      "mx_balance_sheet.json",
    "guatemala":   "gt_balance_sheet.json",
    "nicaragua":   "ni_balance_sheet.json",
    "china":       "cn_balance_sheet.json",
    "ivory_coast": "ci_balance_sheet.json",
    "costa_rica":  "cr_balance_sheet.json",
    "tanzania":    "tz_balance_sheet.json",
}

# Non-USDA sources are curated by hand from these reports. Surfaced in the
# refresh checklist so the operator knows exactly where to look.
MANUAL_SOURCE_REFS = {
    "brazil": [
        ("CONAB", "https://www.conab.gov.br/info-agro/safras/cafe — Acomp. da Safra Café (4 surveys/yr)"),
        ("ICO",   "https://www.ico.org/coffee-market-report — Coffee Market Report (monthly)"),
    ],
    "colombia": [
        ("FNC", "https://federaciondecafeteros.org/wp/informe-mensual-de-cifras/ — Informe Mensual (monthly)"),
        ("ICO", "https://www.ico.org/coffee-market-report — Coffee Market Report (monthly)"),
    ],
    "indonesia": [
        ("GAEKI", "https://gaeki.or.id/en/areal-dan-produksi/ — Areal & Produksi table"),
        ("ICO",   "https://www.ico.org/coffee-market-report — Coffee Market Report (monthly)"),
    ],
    "uganda": [
        ("UCDA", "https://ugandacoffee.go.ug/resource-center — Monthly Reports (production/exports)"),
        ("ICO",  "https://www.ico.org/coffee-market-report — Coffee Market Report (monthly)"),
    ],
    "vietnam": [
        # MARD merged with the environment ministry in 2025 → Ministry of
        # Agriculture and Environment. The seed key stays `mard` so the
        # numbers already attributed to it keep their history.
        ("MAE", "https://www.mard.gov.vn — Bộ Nông nghiệp và Môi trường (ex-MARD) / monthly statistics"),
        ("ICO",  "https://www.ico.org/coffee-market-report — Coffee Market Report (monthly)"),
    ],
}

MT_PER_MBAGS = 60_000  # 1 million 60-kg bags = 1e6 × 60 kg = 60,000 MT


def _load(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _usda_by_start_year(demand: dict, origin: str) -> dict[int, float]:
    """{crop_start_year: production_in_M_bags} from demand_stocks USDA rows."""
    annual = (((demand or {}).get("producers") or {}).get(origin) or {}).get("annual") or []
    out: dict[int, float] = {}
    for row in annual:
        year = row.get("year")
        prod_mt = row.get("production_mt")
        try:
            y = int(str(year))
        except (TypeError, ValueError):
            continue
        if prod_mt is None:
            continue
        out[y] = round(float(prod_mt) / MT_PER_MBAGS, 1)
    return out


def _season_start_year(season: str) -> int | None:
    try:
        return int(season.split("/")[0])
    except (AttributeError, ValueError, IndexError):
        return None


def _split_target(filename: str) -> tuple[Path, str | None]:
    """Resolve a "file" or "file::subkey" target into (path, subkey).
    Vietnam stores its balance sheet at vn_farmer_economics.json under
    `balance_sheet`; the other three sit at top level."""
    if "::" in filename:
        f, sub = filename.split("::", 1)
        return DATA / f, sub
    return DATA / filename, None


def refresh_origin(origin: str, filename: str, demand: dict) -> list[str]:
    """Sync one seed file's USDA column from demand_stocks. Returns a list
    of human-readable change lines (empty when nothing changed)."""
    path, subkey = _split_target(filename)
    doc = _load(path)
    if doc is None:
        return [f"⚠ {filename}: missing or unparseable — skipped"]
    seed = doc.get(subkey) if subkey else doc
    if not isinstance(seed, dict) or not isinstance(seed.get("seasons"), list):
        return [f"⚠ {filename}: seasons block missing — skipped"]

    usda = _usda_by_start_year(demand, origin)
    if not usda:
        return [f"⚠ {origin}: no USDA rows in demand_stocks — skipped"]

    changes: list[str] = []

    # Bootstrap: a seed created empty (the Aug 2026 aggregation origins ship
    # with seasons: [] until PSD coverage lands) gets its last four crop
    # years materialized from USDA, newest as forecast. Seeds that already
    # carry seasons keep the warn-only behavior below — the operator adds
    # rows by hand so the other sources come along.
    if not seed["seasons"]:
        recent = sorted(usda)[-4:]
        for y in recent:
            seed["seasons"].append({
                "season": f"{y}/{str(y + 1)[-2:]}",
                "forecast": y == recent[-1],
                "production": {"usda": usda[y]},
            })
        changes.append(
            f"  {origin}: bootstrapped {len(recent)} seasons from USDA "
            f"({recent[0]}/{str(recent[0] + 1)[-2:]} → {recent[-1]}/{str(recent[-1] + 1)[-2:]})"
        )

    latest_seed_year = 0
    for season in seed["seasons"]:
        sy = _season_start_year(season.get("season", ""))
        if sy is None:
            continue
        latest_seed_year = max(latest_seed_year, sy)
        if sy not in usda:
            continue
        prod = season.setdefault("production", {})
        old = prod.get("usda")
        new = usda[sy]
        if old != new:
            prod["usda"] = new
            changes.append(f"  {origin} {season['season']}: USDA {old} → {new} M bags")

    # Flag a newer USDA crop the seed doesn't carry yet (operator should add
    # a row with the other sources during the manual refresh).
    newer = sorted(y for y in usda if y > latest_seed_year)
    for y in newer:
        changes.append(
            f"  {origin}: USDA now has crop {y}/{str(y + 1)[-2:]} "
            f"({usda[y]} M bags) — add a season row with the other sources"
        )

    if changes:
        # Write back via the original document so the nested vn_farmer_economics
        # subkey case doesn't lose its sibling fields (cost_robusta, acreage…).
        safe_write_json(path, doc, trailing_newline=True)
    return changes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="Report drift without writing; exit 1 if any seed is stale.")
    args = ap.parse_args()

    demand = _load(DEMAND_STOCKS)
    if not demand:
        print(f"[balance-sheets] FATAL: {DEMAND_STOCKS} unreadable", file=sys.stderr)
        return 1

    all_changes: list[str] = []
    for origin, filename in ORIGINS.items():
        if args.check:
            # Dry-run: load, compute would-be changes, but don't persist.
            path, subkey = _split_target(filename)
            doc = _load(path)
            seed = doc.get(subkey) if doc and subkey else doc
            usda = _usda_by_start_year(demand, origin)
            if seed and usda:
                for season in seed.get("seasons", []):
                    sy = _season_start_year(season.get("season", ""))
                    if sy in usda and season.get("production", {}).get("usda") != usda[sy]:
                        all_changes.append(
                            f"  {origin} {season['season']}: USDA "
                            f"{season['production'].get('usda')} → {usda[sy]} (stale)"
                        )
        else:
            all_changes.extend(refresh_origin(origin, filename, demand))

    print("=" * 64)
    if all_changes:
        print("[balance-sheets] USDA column refreshed from demand_stocks.json:")
        print("\n".join(all_changes))
    else:
        print("[balance-sheets] USDA column already in sync — no changes.")

    print("\n[balance-sheets] MANUAL refresh reminder (non-USDA sources):")
    # Origins without a dedicated agency feed fall back to the ICO monthly
    # report, which covers every producing country.
    ico_ref = [("ICO", "https://www.ico.org/coffee-market-report — Coffee Market Report (monthly)")]
    for origin in ORIGINS:
        print(f"  {origin}:")
        for label, ref in MANUAL_SOURCE_REFS.get(origin, ico_ref):
            print(f"    · {label}: {ref}")
    print("=" * 64)

    if args.check and all_changes:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
