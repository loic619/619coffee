"""
Probe: can we get HISTORY for B3 conilon (CNL)? Two candidate sources:
  1. noticiasagricolas — do they republish a conilon-B3 quotes page, and does
     it take the /YYYY-MM-DD date suffix like the arabica 4/5 page we backfilled?
  2. B3/BMF legacy "ajustes do pregao" page — takes a date parameter.
Pure diagnostic — prints findings, writes nothing.
"""
from __future__ import annotations

import re
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*",
                                               "Accept-Language": "pt-BR,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def probe_na_index():
    print("\n########## 1. noticiasagricolas: coffee quote pages ##########")
    try:
        st, html = get("https://www.noticiasagricolas.com.br/cotacoes/cafe/")
    except Exception as e:  # noqa: BLE001
        print(f"  index ERR {type(e).__name__}: {e}")
        return []
    links = sorted(set(re.findall(r'href="(/cotacoes/cafe/[a-z0-9\-]+)"', html)))
    print(f"  index HTTP {st}, {len(links)} quote pages:")
    for l in links:
        print("   ·", l)
    return [l for l in links if "conilon" in l or "robusta" in l or "cnl" in l]


def probe_na_conilon(cands):
    print("\n########## 2. noticiasagricolas: conilon candidates + date-URL ##########")
    for path in cands:
        for suffix in ["", "/2026-06-02", "/2025-03-12", "/2024-10-15"]:
            url = f"https://www.noticiasagricolas.com.br{path}{suffix}"
            try:
                st, html = get(url, timeout=20)
            except Exception as e:  # noqa: BLE001
                print(f"  ERR {type(e).__name__}  {url}")
                continue
            fech = re.search(r"Fechamento[:\s]*(\d{2}/\d{2}/\d{4})", html)
            ths = re.findall(r"<th[^>]*>(.*?)</th>", html, re.S)
            ths = [re.sub(r"<[^>]+>|\s+", " ", t).strip() for t in ths][:8]
            has_b3 = "B3" in html or "b3" in path
            print(f"  [{st}] {url}")
            print(f"        Fechamento={fech.group(1) if fech else '-'}  B3-page={has_b3}  th={ths}")
            rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)[1:5]
            for row in rows:
                cells = [re.sub(r"<[^>]+>|\s+", " ", c).strip()
                         for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
                if cells:
                    print("        row:", cells[:4])


def probe_bmf_ajustes():
    print("\n########## 3. BMF legacy ajustes-do-pregao (date param) ##########")
    base = "https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-ajustes-do-pregao-ptBR.asp"
    for d in ["", "12/03/2025", "15/10/2024"]:
        url = base + (f"?txtData={urllib.parse.quote(d)}" if d else "")
        try:
            st, html = get(url, timeout=25)
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {type(e).__name__}  {url}")
            continue
        has_cnl = re.search(r"CNL|[Cc]onilon", html)
        print(f"  [{st}] {len(html)}B  {url}  CNL-mention={bool(has_cnl)}")
        if has_cnl:
            idx = html.find("CNL") if "CNL" in html else html.lower().find("conilon")
            snippet = re.sub(r"<[^>]+>|\s+", " ", html[idx:idx + 900]).strip()
            print("        …", snippet[:400])


def main():
    cands = probe_na_index()
    probe_na_conilon(cands or ["/cotacoes/cafe/cafe-conilon"])
    probe_bmf_ajustes()


if __name__ == "__main__":
    main()
