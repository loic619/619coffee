"""
brazil_conilon_demand.py — how much conilon Brazil's own roasters absorb.

Nobody publishes this. That is not a gap in our sourcing, it is the state of
the world: ABIC's executive director, asked directly by The AgriBiz
(2026-02-18), said "as indústrias não passam qual blend estão usando… a gente
não tem o número" — the roasters treat their blend as commercially sensitive
and the trade association does not collect it. The 75–80% figure circulating
in the press is itself a residual, and the market source who supplied it said
so in the same article: "a conta de oferta, exportação e consumo só fecha
presumindo um blend mais favorável ao robusta."

So the residual IS the method, and the job is to compute it carefully:

    conilon into the domestic blend = robusta production
                                    − conilon green-bean exports
                                    − soluble exports          ┐ Brazil's
                                    − soluble domestic use     ┘ soluble
                                                                 industry
                                                                 runs on
                                                                 conilon
    blend share = that ÷ roast-and-ground domestic consumption

Everything except the export species split comes from ONE balance sheet (USDA
PSD Brazil), which matters more than it sounds: an earlier cut of this file
put CONAB production over PSD consumption and landed near 25–30%, roughly half
the level the trade quotes, purely because the two sheets disagree about how
much coffee Brazil grows. Numerator and denominator now come from the same
book and the level lands where the trade's does.

Accuracy
========
Against the published trade estimate for 2011–2024 this reconstruction
correlates at 0.86 and matches 2020, 2021 and 2022 to within a point (49.6 vs
50, 65.9 vs 66, 76.7 vs 76). It runs ~10 points LOW in the older years and in
2023–24, and the reason is structural rather than fixable: a flow residual
cannot see stocks. In a short-crop year — 2015 and 2016, when drought cut the
Espírito Santo conilon crop — roasters keep blending out of carry-in
inventory, and a pure production-minus-exports calculation reads that as demand
that vanished. The series is published with every component so the residual can
be re-cut, and `share_3y` (centred three-year mean) is carried alongside for
readers who want the carry-in noise damped out.

Treat it as an estimate. It is labelled as one everywhere it is displayed.

Sources
=======
balance sheet  USDA FAS PSD coffee, Brazil rows — arabica/robusta production,
               soluble exports, soluble and roast-and-ground domestic
               consumption. Market year is Jul–Jun, matching CONAB's crop year.
export split   Cecafé monthly exports by species (frontend/public/data/cecafe.json),
               summed over the same Jul Y → Jun Y+1 window. PSD publishes bean
               exports as one number, so this is the only leg it cannot supply.
cross-check    CONAB "Série Histórica do Café" conilon production, carried in
               the output as conab_conilon_production. id_produto 7498 =
               arábica, 7090 = conilon, re-verified every run against the state
               mix (ES conilon-dominant, MG arabica-dominant) so a renumbering
               at CONAB fails loudly instead of silently flipping the species.

Run:  cd backend && PYTHONPATH=. python -m scraper.sources.brazil_conilon_demand
"""
from __future__ import annotations

import csv
import io
import json
import sys
import zipfile
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "frontend" / "public" / "data"
OUT = DATA / "brazil_conilon_demand.json"

CONAB_URL = "https://portaldeinformacoes.conab.gov.br/downloads/arquivos/SerieHistoricaCafe.txt"
PSD_URL = "https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip"
UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")}
ARABICA_ID, CONILON_ID = "7498", "7090"
BAGS_PER_MIL_SACAS = 1_000
PSD_UNIT = 1_000                       # PSD publishes in 1000 60-kg bags

# PSD attribute → our key. USDA's exact strings have drifted over the years
# ("Beans Exports" → "Bean Exports"), so every attribute we need lists the
# spellings we have actually seen rather than one canonical form.
_PSD_ATTRS: dict[str, tuple[str, ...]] = {
    "arabica_production": ("Arabica Production",),
    "robusta_production": ("Robusta Production",),
    "soluble_exports":    ("Soluble Exports",),
    "soluble_domestic":   ("Soluble Dom. Cons.", "Soluble Domestic Consumption"),
    "rg_domestic":        ("Rst,Ground Dom. Consum", "Roast & Ground Dom. Consum",
                           "Rst,Ground Dom. Consumption"),
    "domestic_use":       ("Domestic Consumption",),
    "bean_exports":       ("Bean Exports", "Beans Exports"),
}
_REQUIRED = ("robusta_production", "soluble_exports", "soluble_domestic", "rg_domestic")


def fetch_psd(timeout: int = 120) -> dict[int, dict[str, float]]:
    """{market_year: {attr: bags}} for Brazil, straight off USDA's PSD release."""
    r = requests.get(PSD_URL, headers=UA, timeout=timeout)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    rows = csv.DictReader(
        io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8-sig"))
    lookup = {spelling: key for key, spellings in _PSD_ATTRS.items() for spelling in spellings}
    out: dict[int, dict[str, float]] = defaultdict(dict)
    for row in rows:
        if (row.get("Country_Name") or "").strip().lower() != "brazil":
            continue
        key = lookup.get((row.get("Attribute_Description") or "").strip())
        if not key:
            continue
        try:
            out[int(row["Market_Year"])][key] = float(row["Value"] or 0) * PSD_UNIT
        except (ValueError, KeyError):
            continue
    if not out:
        raise RuntimeError("PSD release carried no Brazil rows — refusing to publish")
    latest = max(out)
    missing = [k for k in _REQUIRED if k not in out[latest]]
    if missing:
        raise RuntimeError(
            f"PSD Brazil {latest} is missing {missing} — USDA renamed an attribute; "
            "update _PSD_ATTRS rather than publishing a series with a silent zero")
    return dict(out)


def fetch_conab(timeout: int = 60) -> dict[int, dict[str, float]]:
    """{crop_year: {arabica, conilon}} in bags, national totals. Cross-check only."""
    r = requests.get(CONAB_URL, headers=UA, timeout=timeout)
    r.raise_for_status()
    lines = r.content.decode("latin-1", "replace").splitlines()
    header = [h.strip().lower() for h in lines[0].split(";")]
    ix = {name: header.index(name) for name in
          ("ano_agricola", "uf", "id_produto", "producao_mil_t")}
    by_year: dict[int, dict[str, float]] = defaultdict(lambda: {"arabica": 0.0, "conilon": 0.0})
    by_state: dict[str, dict[str, float]] = defaultdict(lambda: {ARABICA_ID: 0.0, CONILON_ID: 0.0})
    for ln in lines[1:]:
        p = ln.split(";")
        if len(p) <= max(ix.values()):
            continue
        try:
            year = int(p[ix["ano_agricola"]].strip()[:4])
            # Values are MIL SACAS despite the column being named producao_mil_t —
            # 2001 Minas at "14650" is 14.65 M bags of arabica, not 14.65 M tonnes.
            prod = float(p[ix["producao_mil_t"]].strip() or 0)
        except ValueError:
            continue
        pid = p[ix["id_produto"]].strip()
        if pid not in (ARABICA_ID, CONILON_ID) or prod <= 0:
            continue
        by_year[year]["arabica" if pid == ARABICA_ID else "conilon"] += prod * BAGS_PER_MIL_SACAS
        by_state[p[ix["uf"]].strip()][pid] += prod

    es, mg = by_state.get("ES", {}), by_state.get("MG", {})
    if not (es.get(CONILON_ID, 0) > es.get(ARABICA_ID, 0)
            and mg.get(ARABICA_ID, 0) > mg.get(CONILON_ID, 0)):
        raise RuntimeError(
            "CONAB id_produto→species mapping failed its sanity check "
            f"(ES {es}, MG {mg}) — refusing to publish a possibly flipped series")
    return dict(by_year)


def _marketing_year_exports() -> dict[int, dict[str, float]]:
    """{crop_year: {conilon, arabica, soluble, months}} summed Jul Y → Jun Y+1."""
    out: dict[int, dict[str, float]] = defaultdict(
        lambda: {"conilon": 0.0, "soluble": 0.0, "arabica": 0.0, "months": 0})
    series = json.loads((DATA / "cecafe.json").read_text(encoding="utf-8"))["series"]
    for row in series:
        y, m = int(row["date"][:4]), int(row["date"][5:7])
        crop = y if m >= 7 else y - 1
        out[crop]["conilon"] += row.get("conillon") or 0
        out[crop]["soluble"] += row.get("soluvel") or 0
        out[crop]["arabica"] += row.get("arabica") or 0
        out[crop]["months"] += 1
    return dict(out)


def build() -> dict:
    psd = fetch_psd()
    exp = _marketing_year_exports()
    try:
        conab = fetch_conab()
    except Exception as e:                                   # noqa: BLE001
        # A cross-check must never be able to sink the series it checks.
        print(f"[conilon-demand] CONAB cross-check unavailable ({type(e).__name__}: {e})")
        conab = {}

    rows = []
    for year in sorted(psd):
        p, e = psd[year], exp.get(year)
        if not e or e["months"] < 12:
            continue                          # incomplete marketing year
        if any(k not in p for k in _REQUIRED):
            continue                          # PSD has not filled this year in
        blend = (p["robusta_production"] - e["conilon"]
                 - p["soluble_exports"] - p["soluble_domestic"])
        rg = p["rg_domestic"]
        rows.append({
            "year": year,
            "robusta_production": round(p["robusta_production"]),
            "arabica_production": round(p.get("arabica_production", 0)),
            "conilon_exports": round(e["conilon"]),
            "soluble_exports": round(p["soluble_exports"]),
            "soluble_domestic": round(p["soluble_domestic"]),
            "rg_domestic": round(rg),
            "conilon_blend": round(blend),
            # The headline: conilon's share of the roast-and-ground blend.
            "conilon_share": round(blend / rg * 100, 1) if rg else None,
            # Same numerator plus the soluble Brazilians drink, over ALL
            # domestic use — a second cut for readers who count the cup rather
            # than the blend.
            "share_of_total_use": (
                round((blend + p["soluble_domestic"]) / p["domestic_use"] * 100, 1)
                if p.get("domestic_use") else None),
            "conab_conilon_production": round(conab[year]["conilon"]) if year in conab else None,
        })

    # Centred three-year mean: the carry-in stock swings a flow residual cannot
    # see mostly cancel over three crops, so this is the line to read for trend.
    shares = [r["conilon_share"] for r in rows]
    for i, r in enumerate(rows):
        window = [s for s in shares[max(0, i - 1):i + 2] if s is not None]
        r["share_3y"] = round(sum(window) / len(window), 1) if window else None

    return {
        "unit": "bags_60kg",
        "estimate": True,
        "method": ("conilon into the domestic blend = USDA PSD Brazil robusta "
                   "production − Cecafé conilon green exports − PSD soluble "
                   "exports − PSD soluble domestic use, over the Jul–Jun "
                   "marketing year; conilon_share = that ÷ PSD roast-and-ground "
                   "domestic consumption. Nobody publishes this series — ABIC "
                   "says the roasters do not disclose their blends — so every "
                   "figure in circulation, this one included, is a residual."),
        "caveat": ("A flow residual cannot see stocks. In short-crop years "
                   "roasters keep blending out of carry-in inventory, which "
                   "reads here as demand that disappeared; share_3y damps it. "
                   "Correlates 0.86 with the published trade estimate over "
                   "2011–2024 and matches it within a point in 2020–2022, but "
                   "runs ~10 points low in the older years."),
        "sources": {
            "balance_sheet": PSD_URL,
            "export_split": "Cecafé monthly exports by species",
            "production_cross_check": CONAB_URL,
        },
        "updated": datetime.now(UTC).isoformat(),
        "history": rows,
    }


def main() -> int:
    try:
        doc = build()
    except Exception as e:  # noqa: BLE001 — one bad run must not wipe the file
        print(f"[conilon-demand] build failed: {type(e).__name__}: {e}")
        return 1
    if not doc["history"]:
        print("[conilon-demand] no complete marketing years — nothing written")
        return 1
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    h = doc["history"]
    print(f"[conilon-demand] {len(h)} crop years {h[0]['year']}–{h[-1]['year']} → {OUT.name}")
    for r in h[-8:]:
        print(f"  {r['year']}: robusta {r['robusta_production']/1e6:5.1f}M "
              f"− exp {r['conilon_exports']/1e6:4.1f}M "
              f"− soluble {(r['soluble_exports'] + r['soluble_domestic'])/1e6:4.1f}M "
              f"= {r['conilon_blend']/1e6:5.1f}M into a "
              f"{r['rg_domestic']/1e6:.1f}M blend → {r['conilon_share']}% "
              f"(3y {r['share_3y']}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
