"""probe_abic_blend.py — TEMPORARY (round 2).

Round 1 settled the sourcing question: nobody publishes conilon's share of the
Brazilian blend. ABIC's own executive director, quoted in The AgriBiz
(2026-02-18): "As indústrias não passam qual blend estão usando... a gente não
tem o número." The 75–80% figure in circulation is itself a residual — the
market source who gave it says so outright: "a conta de oferta, exportação e
consumo só fecha presumindo um blend mais favorável ao robusta."

So the residual IS the method. What is wrong with ours is the LEVEL: it lands
around 25–30% where trade estimates land at 50–76%, a ratio near 1.9. Prime
suspect: CONAB's conilon production is materially below USDA PSD's Brazilian
robusta, and our denominator (USDA domestic use) comes off a different balance
sheet than our numerator (CONAB production). Mixing the two understates the
share by construction.

This round reads PSD's Brazil rows to see what it carries — an arabica/robusta
production split, soluble exports, domestic use — so the whole balance can be
built inside ONE balance sheet.

Delete once the answer is known.
"""
from __future__ import annotations

import csv
import io
import sys
import zipfile
from collections import defaultdict

import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
PSD = "https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip"


def main() -> int:
    r = requests.get(PSD, headers=UA, timeout=120)
    print(f"GET {PSD} -> {r.status_code} {len(r.content)}B")
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    print("members:", z.namelist())
    rows = list(csv.DictReader(
        io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8-sig")))
    print(f"rows: {len(rows)}")
    print("columns:", list(rows[0].keys()))

    br = [x for x in rows if x["Country_Name"].strip().lower() == "brazil"]
    print(f"\nBrazil rows: {len(br)}")
    attrs = sorted({x["Attribute_Description"].strip() for x in br})
    print("Brazil attributes:")
    for a in attrs:
        print(f"  - {a}")
    units = sorted({(x["Attribute_Description"].strip(), x["Unit_Description"].strip())
                    for x in br})
    print("\nattribute -> unit:")
    for a, u in units:
        print(f"  {a:<34} {u}")

    print("\nBrazil by market year (all attributes, 2000+):")
    by_year: dict[int, dict[str, float]] = defaultdict(dict)
    for x in br:
        try:
            y = int(x["Market_Year"])
            v = float(x["Value"] or 0)
        except ValueError:
            continue
        if y >= 2000:
            by_year[y][x["Attribute_Description"].strip()] = v
    keys = attrs
    print("year | " + " | ".join(k[:22] for k in keys))
    for y in sorted(by_year):
        print(f"{y} | " + " | ".join(f"{by_year[y].get(k, float('nan')):.0f}" for k in keys))
    return 0


if __name__ == "__main__":
    sys.exit(main())
