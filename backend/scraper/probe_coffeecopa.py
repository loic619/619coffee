"""probe_coffeecopa.py — TEMPORARY (round 3).

Rounds 1-2 found the mechanism. /tabela/ ships an empty table and fills it
client-side from a PUBLIC Google Sheet:

    SHEET_ID   = 1wNX2fPobme6rAE869H8Zrv82K8eCjaDadE30DHU48tc
    SHEET_NAME = "Preços"
    gviz/tq?tqx=out:json  ->  JSONP-ish, strip 47 chars and the trailing ");"
    columns: row.c[0] qualidade | row.c[1] cata (fraction) | row.c[2] preço

The page only refreshes between 09:30 and 18:00 BRT, but that gate is in the
browser — the sheet itself should answer any time. This checks that, and prints
every row so the grades and the unit can be read off real data before a scraper
assumes either.

Delete once the answer is known.
"""
from __future__ import annotations

import json
import sys

import requests

SHEET_ID = "1wNX2fPobme6rAE869H8Zrv82K8eCjaDadE30DHU48tc"
GVIZ = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
        "/gviz/tq?tqx=out:json&sheet=Pre%C3%A7os")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126 Safari/537.36"}


def main() -> int:
    r = requests.get(GVIZ, headers=UA, timeout=40)
    print(f"GET gviz -> {r.status_code} {len(r.content)}B "
          f"{r.headers.get('content-type','?')}")
    if not r.ok:
        print(r.text[:800])
        return 1

    text = r.text
    print(f"first 80 chars: {text[:80]!r}")
    start, end = text.find("{"), text.rfind("}")
    payload = json.loads(text[start:end + 1])

    table = payload.get("table") or {}
    cols = [c.get("label") or c.get("id") for c in table.get("cols") or []]
    types = [c.get("type") for c in table.get("cols") or []]
    print(f"\ncolumn labels: {cols}")
    print(f"column types:  {types}")

    rows = table.get("rows") or []
    print(f"rows: {len(rows)}\n")
    for i, row in enumerate(rows):
        cells = row.get("c") or []
        vals = []
        for c in cells:
            if c is None:
                vals.append(None)
            else:
                vals.append((c.get("v"), c.get("f")))
        print(f"  {i:2d} {vals}")

    print("\n--- what a scraper would read ---")
    for row in rows:
        c = row.get("c") or []
        def val(i):
            return c[i].get("v") if i < len(c) and c[i] else None
        q, cata, preco = val(0), val(1), val(2)
        if q or preco:
            print(f"  qualidade={q!r:44s} cata={cata!r:10s} preco={preco!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
