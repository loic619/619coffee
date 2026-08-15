"""
Probe: discover login-free ICE data for (a) options OI per strike and
(b) daily EFP/EFS/block/spread volume per contract. Builds on the proven
Report Center SPA API (POST /marketdata/api/reports/142/data works from CI
for cert stocks). Pure diagnostic — prints, writes nothing.
"""
from __future__ import annotations

import json
import re

import requests

H = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
}
S = requests.Session()
S.headers.update(H)


def show(label, r, n=400):
    body = r.text or ""
    print(f"  [{r.status_code}] {len(body):>7}B  {label}")
    if r.status_code == 200 and body:
        print(f"      {body[:n]!r}")


def jget(url, label, n=400):
    try:
        r = S.get(url, timeout=30)
        show(label, r, n)
        return r
    except Exception as e:  # noqa: BLE001
        print(f"  ERR {type(e).__name__}: {label}")
        return None


def jpost(url, body, label, n=500):
    try:
        r = S.post(url, json=body, timeout=40,
                   headers={"Content-Type": "application/json"})
        show(f"{label}  body={json.dumps(body)}", r, n)
        return r
    except Exception as e:  # noqa: BLE001
        print(f"  ERR {type(e).__name__}: {label}")
        return None


def sec(t):
    print(f"\n{'#' * 10} {t} {'#' * 10}")


def main():
    sec("1. Report Center catalog discovery")
    for u in [
        "https://www.ice.com/marketdata/api/reports",
        "https://www.ice.com/marketdata/api/report-center/reports",
        "https://www.ice.com/api/report-center/reports",
        "https://www.ice.com/marketdata/api/reports/categories",
    ]:
        r = jget(u, u, 200)
        if r is not None and r.status_code == 200 and r.text.lstrip().startswith(("[", "{")):
            try:
                data = r.json()
                items = data if isinstance(data, list) else data.get("reports", data.get("data", []))
                print(f"      → parsed {len(items)} entries; coffee/volume/option matches:")
                for it in items if isinstance(items, list) else []:
                    s = json.dumps(it)[:160]
                    if re.search(r"volume|option|coffee|open.?interest", s, re.I):
                        print(f"        · {s}")
            except Exception as e:  # noqa: BLE001
                print(f"      parse fail: {e}")

    sec("2. Report metadata (GET /marketdata/api/reports/{id})")
    for rid in [26, 27, 42, 142, 176]:
        jget(f"https://www.ice.com/marketdata/api/reports/{rid}",
             f"report {rid} metadata", 500)

    sec("3. Report data endpoints (POST /marketdata/api/reports/{id}/data)")
    bodies = [
        {},
        {"exchangeCodeAndContract": "IFUS,KC"},
        {"exchange": "IFUS"},
        {"exchangeCode": "IFUS"},
        {"productName": "Coffee C"},
    ]
    for rid in [26, 27, 176]:
        for b in bodies:
            jpost(f"https://www.ice.com/marketdata/api/reports/{rid}/data",
                  b, f"report {rid}", 400)

    sec("4. Coffee product page → delayed-market ids")
    ids = {}
    for u in [
        "https://www.ice.com/products/15-Coffee-C-Futures",
        "https://www.ice.com/products/15/Coffee-C-Futures",
    ]:
        try:
            r = S.get(u, timeout=30)
            print(f"  [{r.status_code}] {len(r.text)}B  {u}")
            if r.status_code == 200:
                for pat in ["productId", "hubId", "marketId", "optionProduct", "specId"]:
                    hits = sorted(set(re.findall(pat + r"[\"'\s:=]+(\d+)", r.text)))[:6]
                    if hits:
                        print(f"      {pat}: {hits}")
                        ids[pat] = hits
                break
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {type(e).__name__} {u}")

    sec("5. DelayedMarkets JSON candidates")
    pid = (ids.get("productId") or ["254"])[0]
    hub = (ids.get("hubId") or ["584"])[0]
    for u in [
        f"https://www.ice.com/marketdata/DelayedMarkets.shtml?getContractsAsJson=&productId={pid}&hubId={hub}",
        "https://www.ice.com/marketdata/DelayedMarkets.shtml?getProductsAsJson=",
        f"https://www.ice.com/marketdata/DelayedMarkets.shtml?getOptionsProductMarketDataJson=&productId={pid}",
    ]:
        jget(u, u, 400)

    sec("6. publicdocs guesses — IFUS daily volume / options files")
    from datetime import date, timedelta
    d = date.today()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    d -= timedelta(days=1 if d.weekday() else 3)
    ymd = d.strftime("%Y%m%d")
    for u in [
        f"https://www.ice.com/publicdocs/futures_us_reports/coffee/coffee_option_oi_{ymd}.xls",
        f"https://www.ice.com/publicdocs/futures_us_reports/exchange/ICE_Futures_US_Daily_Volume_{ymd}.xls",
        "https://www.ice.com/publicdocs/futures_us/exchange_volume.xls",
        f"https://www.ice.com/marketdata/publicdocs/liffe/coffee/daily_volume/volrc_{d.strftime('%y%m%d')}.txt",
    ]:
        try:
            r = S.head(u, timeout=20, allow_redirects=True)
            print(f"  [{r.status_code}] {u}")
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {type(e).__name__} {u}")


if __name__ == "__main__":
    main()
