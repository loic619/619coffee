"""Probe round 3: B3 DailyFluctuationHistory with full contract tickers."""
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0"


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


for tick in ["CNLU26", "CNLX26", "ICFU26", "ICFZ26"]:
    url = f"https://cotacao.b3.com.br/mds/api/v1/DailyFluctuationHistory/{tick}"
    try:
        st, body = get(url)
        print(f"[{st}] {len(body)}B  {tick}")
        print("   head:", body[:600].replace("\n", " "))
        print()
    except Exception as e:  # noqa: BLE001
        print(f"ERR {type(e).__name__} {tick}")
