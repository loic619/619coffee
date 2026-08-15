"""
Probe round 2: ICE endpoints on the CORRECT domain (theice.com — where the
proven cert-stocks SPA API lives; ice.com 404s the API and bot-guards
DelayedMarkets). Baseline sanity: report 142 POST must succeed.
"""
from __future__ import annotations

import json
import re

import requests

S = requests.Session()
S.headers.update({
    "Accept": "application/json, text/plain, */*",
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
})
B = "https://www.theice.com"


def show(label, r, n=400):
    print(f"  [{r.status_code}] {len(r.text or ''):>7}B  {label}")
    if r.status_code == 200 and r.text:
        print(f"      {r.text[:n]!r}")


def g(url, label=None, n=400):
    try:
        r = S.get(url, timeout=30)
        show(label or url, r, n)
        return r
    except Exception as e:  # noqa: BLE001
        print(f"  ERR {type(e).__name__}: {url}")
        return None


def p(url, body, label, n=600):
    try:
        r = S.post(url, json=body, timeout=40, headers={"Content-Type": "application/json"})
        show(f"{label} body={json.dumps(body)}", r, n)
        return r
    except Exception as e:  # noqa: BLE001
        print(f"  ERR {type(e).__name__}: {label}")
        return None


print("########## 0. Baseline: report 142 (must be 200) ##########")
p(f"{B}/marketdata/api/reports/142/data", {"exchangeCodeAndContract": "IFUS,KC"}, "report 142", 250)

print("\n########## 1. Catalog on theice.com ##########")
for u in [f"{B}/marketdata/api/reports",
          f"{B}/marketdata/api/reports/list",
          f"{B}/marketdata/api/report-center",
          f"{B}/api/report-center/reports"]:
    r = g(u, n=200)
    if r is not None and r.status_code == 200 and r.text.lstrip().startswith(("[", "{")):
        try:
            data = r.json()
            items = data if isinstance(data, list) else data.get("reports", data.get("data", []))
            print(f"      → {len(items)} entries; volume/option/coffee/interest matches:")
            for it in (items if isinstance(items, list) else []):
                s = json.dumps(it)[:170]
                if re.search(r"volume|option|coffee|interest", s, re.I):
                    print(f"        · {s}")
        except Exception as e:  # noqa: BLE001
            print(f"      parse fail: {e}")

print("\n########## 2. Report metadata GETs ##########")
for rid in [26, 27, 42, 142, 176, 7, 10]:
    g(f"{B}/marketdata/api/reports/{rid}", f"meta {rid}", 500)

print("\n########## 3. Report /data POSTs ##########")
for rid in [26, 27, 176]:
    for b in [{}, {"exchangeCodeAndContract": "IFUS,KC"}, {"exchangeCode": "IFUS"},
              {"exchangeId": "2"}, {"productId": 254}]:
        p(f"{B}/marketdata/api/reports/{rid}/data", b, f"report {rid}", 400)

print("\n########## 4. DelayedMarkets on theice.com (+Referer) ##########")
S.headers["Referer"] = f"{B}/products/15-Coffee-C-Futures"
for u in [f"{B}/marketdata/DelayedMarkets.shtml?getContractsAsJson=&productId=254&hubId=584",
          f"{B}/marketdata/DelayedMarkets.shtml?getProductsAsJson="]:
    g(u, n=300)

print("\n########## 5. Product page URL mining ##########")
for u in [f"{B}/products/15-Coffee-C-Futures", "https://www.ice.com/products/15-Coffee-C-Futures"]:
    try:
        r = S.get(u, timeout=30)
        print(f"  [{r.status_code}] {len(r.text)}B  {u}")
        if r.status_code == 200:
            urls = sorted(set(re.findall(r'["\'](/(?:marketdata|api|report)[^"\'\s]{3,120})["\']', r.text)))
            print(f"      embedded api-ish paths ({len(urls)}):")
            for x in urls[:25]:
                print(f"        · {x}")
            for pat in [r'productId["\'\s:=]+(\d+)', r'hubId["\'\s:=]+(\d+)', r'marketId["\'\s:=]+(\d+)']:
                hits = sorted(set(re.findall(pat, r.text)))[:8]
                if hits:
                    print(f"      {pat}: {hits}")
            break
    except Exception as e:  # noqa: BLE001
        print(f"  ERR {type(e).__name__} {u}")
