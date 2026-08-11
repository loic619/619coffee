"""
Probe round 2: CNL history candidates.
  1. NA "cafe-conillon-disponivel-vitoria-es" (physical conilon at the CNL
     delivery point) — date-URL support + table structure + depth.
  2. B3 mds API guessed history endpoints for CNL.
  3. B3 arquivos tickercsv (trades per ticker/date).
"""
from __future__ import annotations

import re
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*",
                                               "Accept-Language": "pt-BR,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def na_conillon_disponivel():
    print("\n########## 1. NA conillon disponivel Vitoria-ES: date-URLs ##########")
    base = "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-conillon-disponivel-vitoria-es"
    for suffix in ["", "/2026-06-02", "/2025-03-12", "/2024-10-15", "/2023-06-01", "/2022-06-01"]:
        url = base + suffix
        try:
            st, html = get(url, timeout=20)
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {type(e).__name__}  {url}")
            continue
        fech = re.search(r"Fechamento[:\s]*(\d{2}/\d{2}/\d{4})", html)
        ths = [re.sub(r"<[^>]+>|\s+", " ", t).strip()
               for t in re.findall(r"<th[^>]*>(.*?)</th>", html, re.S)][:6]
        print(f"  [{st}] {url}")
        print(f"        Fechamento={fech.group(1) if fech else '-'}  th={ths}")
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)[1:6]
        for row in rows:
            cells = [re.sub(r"<[^>]+>|\s+", " ", c).strip()
                     for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if cells:
                print("        row:", cells[:4])


def b3_api_guesses():
    print("\n########## 2. B3 mds API history endpoint guesses ##########")
    for url in [
        "https://cotacao.b3.com.br/mds/api/v1/DailyFluctuationHistory/CNL",
        "https://cotacao.b3.com.br/mds/api/v1/InstrumentPriceFluctuation/CNL",
        "https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotationHistory/CNL",
    ]:
        try:
            st, body = get(url, timeout=20)
            print(f"  [{st}] {len(body)}B  {url}")
            print("        head:", body[:220].replace("\n", " "))
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {type(e).__name__}  {url}")


def b3_tickercsv():
    print("\n########## 3. B3 arquivos tickercsv (trades) ##########")
    for url in [
        "https://arquivos.b3.com.br/apinegocios/tickercsv/CNLU26/2026-08-08",
        "https://arquivos.b3.com.br/apinegocios/tickercsv/CNLU26/2026-08-07",
    ]:
        try:
            st, body = get(url, timeout=25)
            print(f"  [{st}] {len(body)}B  {url}")
            print("        head:", body[:200].replace("\n", " | "))
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {type(e).__name__}  {url}")


if __name__ == "__main__":
    na_conillon_disponivel()
    b3_api_guesses()
    b3_tickercsv()
