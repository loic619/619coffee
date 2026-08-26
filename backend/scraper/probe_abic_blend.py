"""probe_abic_blend.py — TEMPORARY.

Looks for a published, year-by-year series of conilon/canéfora's share of the
Brazilian domestic roast-and-ground blend. That is the metric the reference
arbitrage chart plots on its right axis ("Domestic Conillon Demand %", 35–76%),
and it is NOT what a production-minus-exports residual measures — the residual
absorbs stock swings and lands at half the level.

ABIC (Associação Brasileira da Indústria de Café) is the only body that surveys
roasters directly. Its "Indicadores da Indústria" deck is a PDF; the sandbox
cannot reach abic.com.br, so this runs on a CI runner with full egress.

Delete once the answer is known.
"""
from __future__ import annotations

import io
import re
import sys

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126 Safari/537.36"}

PAGES = [
    "https://www.abic.com.br/estatisticas/indicadores-da-industria/",
    "https://www.abic.com.br/estatisticas/producao-e-consumo/",
    "https://www.abic.com.br/estatisticas/",
    "https://www.theagribiz.com/cafe/robusta-toma-o-cafe-brasileiro-75-do-blend-ja-e-dele/",
]

# Lines worth printing out of a 60-page deck.
HOT = re.compile(r"conilon|canéfora|canefora|robusta|blend|arábica|arabica|"
                 r"mistura|espécie", re.I)


def _get(url: str) -> requests.Response | None:
    try:
        r = requests.get(url, headers=UA, timeout=45)
        print(f"  GET {url} -> {r.status_code} {len(r.content)}B "
              f"{r.headers.get('content-type', '?')}")
        return r if r.ok else None
    except Exception as e:                                   # noqa: BLE001
        print(f"  GET {url} -> FAILED {e}")
        return None


def _pdf_text(blob: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(blob))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def main() -> int:
    pdfs: list[str] = []

    print("=" * 78)
    print("STEP 1 — HTML pages: collect PDF links and inline blend numbers")
    print("=" * 78)
    for url in PAGES:
        print(f"\n--- {url}")
        r = _get(url)
        if not r:
            continue
        html = r.text
        for href in re.findall(r'href="([^"]+\.pdf[^"]*)"', html, re.I):
            full = href if href.startswith("http") else \
                "https://www.abic.com.br" + ("" if href.startswith("/") else "/") + href
            if full not in pdfs:
                pdfs.append(full)
                print(f"  pdf: {full}")
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text)
        for m in re.finditer(r"[^.]{0,160}(?:conilon|canéfora|robusta|blend)[^.]{0,160}\.",
                             text, re.I):
            print(f"  txt: {m.group(0).strip()[:340]}")

    print()
    print("=" * 78)
    print(f"STEP 2 — {len(pdfs)} PDF(s): extract blend/species lines")
    print("=" * 78)
    for url in pdfs[:14]:
        print(f"\n--- {url}")
        r = _get(url)
        if not r:
            continue
        try:
            text = _pdf_text(r.content)
        except Exception as e:                               # noqa: BLE001
            print(f"  pdf parse failed: {e}")
            continue
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        print(f"  {len(lines)} non-empty lines")
        hits = [ln for ln in lines if HOT.search(ln)]
        if not hits:
            print("  no species/blend mentions")
        for ln in hits[:120]:
            print(f"  | {ln[:220]}")

    print()
    print("=" * 78)
    print("STEP 3 — sanity: does anything carry a % series 30–80 next to conilon?")
    print("=" * 78)
    print("(read the STEP 2 dump above; nothing automatic here)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
