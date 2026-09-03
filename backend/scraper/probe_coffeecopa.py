"""probe_coffeecopa.py — TEMPORARY (round 2).

Round 1: /tabela/ serves ONE table — headers `Qualidade | Cata | Preço` and a
single row reading "Carregando dados...". No BRL amounts, no dates in the HTML.
The prices are drawn client-side, and the page's own script says it refreshes
"durante o horário comercial" and otherwise shows a fixed message; the probe ran
04:51 BRT, outside those hours.

So: find the endpoint the script calls. Dump the inline scripts around
#tabela-precos, and try the usual WordPress data routes.

Delete once the answer is known.
"""
from __future__ import annotations

import json
import re
import sys

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"}


def _get(url, **kw):
    try:
        r = requests.get(url, headers=UA, timeout=40, **kw)
        print(f"  GET {url} -> {r.status_code} {len(r.content)}B "
              f"{r.headers.get('content-type','?')}")
        return r
    except Exception as e:                                    # noqa: BLE001
        print(f"  GET {url} -> FAILED {type(e).__name__}: {e}")
        return None


def main() -> int:
    print("=" * 78)
    print("STEP 1 — inline scripts on /tabela/")
    print("=" * 78)
    r = _get("https://coffeecopa.com/tabela/")
    html = r.text if r and r.ok else ""
    for m in re.finditer(r"<script[^>]*>([\s\S]*?)</script>", html, re.I):
        body = m.group(1)
        if "tabela-precos" in body or "fetch(" in body or "ajax" in body.lower():
            print("--- script block ---")
            print(body.strip()[:4000])
            print("--- end ---")

    print()
    print("=" * 78)
    print("STEP 2 — every URL the page references that could carry the data")
    print("=" * 78)
    cands = set(re.findall(r"https?://[^\s\"'<>]{6,160}", html))
    for u in sorted(cands):
        if any(k in u.lower() for k in ("json", "ajax", "api", "preco", "tabela",
                                        "cota", "sheet", "csv", "docs.google")):
            print(f"  candidate: {u}")

    print()
    print("=" * 78)
    print("STEP 3 — the page object via wp-json, scripts and all")
    print("=" * 78)
    r = _get("https://coffeecopa.com/wp-json/wp/v2/pages?search=tabela")
    if r and r.ok:
        try:
            for page in r.json():
                print(f"--- page id={page.get('id')} slug={page.get('slug')!r}")
                content = (page.get("content") or {}).get("rendered") or ""
                for m in re.finditer(r"<script[^>]*>([\s\S]*?)</script>", content, re.I):
                    print(m.group(1).strip()[:4000])
        except Exception as e:                                # noqa: BLE001
            print(f"  json parse failed: {e}")

    print()
    print("=" * 78)
    print("STEP 4 — common WordPress data routes")
    print("=" * 78)
    for u in ("https://coffeecopa.com/wp-admin/admin-ajax.php?action=precos",
              "https://coffeecopa.com/wp-json/coffeecopa/v1/precos",
              "https://coffeecopa.com/wp-json/",
              "https://coffeecopa.com/precos.json",
              "https://coffeecopa.com/wp-content/uploads/precos.json"):
        rr = _get(u)
        if rr is not None and rr.ok:
            body = rr.text[:900]
            print(f"    body: {body!r}")
            if "wp-json/" in u and u.endswith("wp-json/"):
                try:
                    routes = [k for k in rr.json().get("routes", {})
                              if "wp/v2" not in k and "oembed" not in k]
                    print(f"    custom routes: {json.dumps(routes, indent=2)[:1500]}")
                except Exception:                             # noqa: BLE001
                    pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
