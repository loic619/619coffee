"""
brazil_conilon_demand.py — Brazil's DOMESTIC conilon demand, derived.

Nobody publishes "domestic conilon demand" as a series; the figure quoted in
trade research is an estimate. This builds one from public sources, by residual:

    conilon domestic demand = conilon production
                            − conilon green exports
                            − soluble exports            (Brazil's soluble
                                                          industry runs on
                                                          conilon)
    conilon demand share    = conilon domestic demand ÷ total domestic use

Sources
=======
production   CONAB "Série Histórica do Café", crop years 2001→, split by
             id_produto: 7498 = arábica, 7090 = conilon (verified against the
             state mix — ES is conilon-dominant, MG arabica-dominant; the
             loader re-checks this every run and refuses a flipped mapping).
             Values are MIL SACAS despite the column being named
             producao_mil_t — 2001 Minas at "14650" is 14.65 M bags of
             arabica, not 14.65 M tonnes.
exports      Cecafé monthly by species (frontend/public/data/cecafe.json).
consumption  USDA PSD Brazil domestic use (demand_stocks.json).

Crop-year alignment
===================
CONAB's `ano_agricola` Y is harvested mid-Y and marketed Jul Y → Jun Y+1, so
the export legs are summed over THAT window rather than calendar Y. Getting
this wrong shifts the series by roughly half a year, which matters most in the
years the crop swings hardest.

This is an ESTIMATE and is labelled as one wherever it is displayed. It tracks
published estimates closely in recent years but not in every year — the
methodologies differ (soluble treatment above all), and the output carries its
components so a reader can re-cut it.

Run:  cd backend && PYTHONPATH=. python -m scraper.sources.brazil_conilon_demand
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "frontend" / "public" / "data"
OUT = DATA / "brazil_conilon_demand.json"
URL = "https://portaldeinformacoes.conab.gov.br/downloads/arquivos/SerieHistoricaCafe.txt"
UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")}
ARABICA_ID, CONILON_ID = "7498", "7090"
BAGS_PER_MIL_SACAS = 1_000
MT_TO_BAGS = 1_000 / 60


def fetch_conab(timeout: int = 60) -> dict[int, dict[str, float]]:
    """{crop_year: {arabica, conilon}} in bags, national totals."""
    r = requests.get(URL, headers=UA, timeout=timeout)
    r.raise_for_status()
    text = r.content.decode("latin-1", "replace")
    lines = text.splitlines()
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
            prod = float(p[ix["producao_mil_t"]].strip() or 0)
        except ValueError:
            continue
        pid = p[ix["id_produto"]].strip()
        uf = p[ix["uf"]].strip()
        if pid not in (ARABICA_ID, CONILON_ID) or prod <= 0:
            continue
        species = "arabica" if pid == ARABICA_ID else "conilon"
        by_year[year][species] += prod * BAGS_PER_MIL_SACAS
        by_state[uf][pid] += prod

    # Guard the id→species mapping instead of trusting it: Espírito Santo is
    # overwhelmingly conilon and Minas Gerais overwhelmingly arabica. If CONAB
    # ever renumbers, this fails loudly rather than silently swapping the series.
    es, mg = by_state.get("ES", {}), by_state.get("MG", {})
    if not (es.get(CONILON_ID, 0) > es.get(ARABICA_ID, 0)
            and mg.get(ARABICA_ID, 0) > mg.get(CONILON_ID, 0)):
        raise RuntimeError(
            "CONAB id_produto→species mapping failed its sanity check "
            f"(ES {es}, MG {mg}) — refusing to publish a possibly flipped series")
    return dict(by_year)


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def _marketing_year_exports() -> dict[int, dict[str, float]]:
    """{crop_year: {conilon, soluble, arabica}} summed Jul Y → Jun Y+1."""
    out: dict[int, dict[str, float]] = defaultdict(
        lambda: {"conilon": 0.0, "soluble": 0.0, "arabica": 0.0, "months": 0})
    for row in _load("cecafe.json")["series"]:
        y, m = int(row["date"][:4]), int(row["date"][5:7])
        crop = y if m >= 7 else y - 1          # Jul-Jun marketing year
        out[crop]["conilon"] += row.get("conillon") or 0
        out[crop]["soluble"] += row.get("soluvel") or 0
        out[crop]["arabica"] += row.get("arabica") or 0
        out[crop]["months"] += 1
    return dict(out)


def build() -> dict:
    prod = fetch_conab()
    exp = _marketing_year_exports()
    cons = {int(r["year"]): (r.get("consumption_mt") or 0) * MT_TO_BAGS
            for r in _load("demand_stocks.json")["producers"]["brazil"]["annual"]}

    rows = []
    for year in sorted(prod):
        p, e = prod[year], exp.get(year)
        c = cons.get(year)
        if not e or not c or e["months"] < 12:
            continue                      # incomplete marketing year — skip
        domestic = p["conilon"] - e["conilon"] - e["soluble"]
        rows.append({
            "year": year,
            "conilon_production": round(p["conilon"]),
            "arabica_production": round(p["arabica"]),
            "conilon_exports": round(e["conilon"]),
            "soluble_exports": round(e["soluble"]),
            "conilon_domestic": round(domestic),
            "domestic_consumption": round(c),
            "conilon_share": round(domestic / c * 100, 1) if c else None,
        })
    return {
        "unit": "bags_60kg",
        "estimate": True,
        "method": ("conilon domestic demand = CONAB conilon production − Cecafé "
                   "conilon green exports − Cecafé soluble exports, over the "
                   "Jul–Jun marketing year; share = that ÷ USDA PSD Brazilian "
                   "domestic use. An estimate, not a published series."),
        "sources": {
            "production": URL,
            "exports": "Cecafé monthly exports by species",
            "consumption": "USDA PSD Brazil domestic consumption",
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
    for r in h[-6:]:
        print(f"  {r['year']}: prod {r['conilon_production']/1e6:5.1f}M "
              f"− exp {r['conilon_exports']/1e6:4.1f}M − sol {r['soluble_exports']/1e6:4.1f}M "
              f"= {r['conilon_domestic']/1e6:5.1f}M domestic "
              f"({r['conilon_share']}% of {r['domestic_consumption']/1e6:.1f}M use)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
