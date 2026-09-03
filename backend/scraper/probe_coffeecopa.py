"""probe_coffeecopa.py — TEMPORARY.

coffeecopa.com/tabela/ is proposed as a Brazil domestic arabica price source.
The sandbox cannot reach it, so this runs on CI to answer the only questions
that matter before writing a scraper: is the table in the served HTML or drawn
by JavaScript, what grades and columns does it carry, and in what unit.

Delete once the answer is known.
"""
from __future__ import annotations

import re
import sys

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"}

URLS = [
    "https://coffeecopa.com/tabela/",
    "https://coffeecopa.com/",
    "https://coffeecopa.com/wp-json/wp/v2/pages?search=tabela",
]


def main() -> int:
    for url in URLS:
        print("=" * 78)
        print(url)
        print("=" * 78)
        try:
            r = requests.get(url, headers=UA, timeout=45)
        except Exception as e:                                # noqa: BLE001
            print(f"  FAILED {type(e).__name__}: {e}")
            continue
        print(f"  {r.status_code}  {len(r.content)}B  {r.headers.get('content-type', '?')}")
        if not r.ok:
            continue
        html = r.text

        tables = re.findall(r"<table[\s\S]*?</table>", html, re.I)
        print(f"  <table> elements in the served HTML: {len(tables)}")
        for i, t in enumerate(tables[:4]):
            rows = re.findall(r"<tr[\s\S]*?</tr>", t, re.I)
            print(f"  --- table {i}: {len(rows)} rows")
            for row in rows[:14]:
                cells = re.findall(r"<t[dh][^>]*>([\s\S]*?)</t[dh]>", row, re.I)
                clean = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in cells]
                clean = [c for c in clean if c]
                if clean:
                    print("      | " + " | ".join(clean))

        # If the table is drawn client-side the numbers still usually ship in a
        # bootstrapped JSON blob or a JS array — worth looking before reaching
        # for a browser.
        for pat, label in (
            (r"(?:arabica|arábica|bebida|rio|dura|mole)[^<>{}\n]{0,120}", "grade words"),
            (r"R\$\s?[\d.,]+", "BRL amounts"),
            (r"\d{1,2}/\d{1,2}/\d{2,4}", "dates"),
        ):
            hits = re.findall(pat, html, re.I)
            uniq = list(dict.fromkeys(h.strip() for h in hits))[:12]
            print(f"  {label}: {len(hits)} hits -> {uniq}")

        for key in ("wp-json", "admin-ajax", "datatables", "__NEXT_DATA__",
                    "application/json", "var tabela", "chart"):
            if key.lower() in html.lower():
                print(f"  mentions {key!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
