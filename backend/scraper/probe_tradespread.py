"""
probe_tradespread.py — TEMPORARY. acaphe.com/tradespread.php is a frameset; the
real tick data lives in 8 *_data.php endpoints it loads. Dump each one so a
parser can be written against them. Delete once the parser exists.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraper.acaphe_poller import HEADERS, playwright_login  # noqa: E402

BASE = "https://acaphe.com/"
# name → endpoint. hisview = London (robusta), ny_hv = New York (arabica),
# spread = the two spread panels.
ENDPOINTS = {
    "rc1": "hisview1_data.php", "rc2": "hisview2_data.php", "rc3": "hisview3_data.php",
    "kc1": "ny_hv_1_data.php",  "kc2": "ny_hv_2_data.php",  "kc3": "ny_hv_3_data.php",
    "spread1": "spread1_data.php", "spread2": "spread2_data.php",
}
# the index pages carry the contract labels / column headers
INDEXES = {"rc1": "hisview1_index.php", "kc1": "ny_hv_1_index.php",
           "spread1": "spread1_index.php"}


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _dump(name: str, text: str, ctype: str) -> None:
    print(f"\n{'=' * 70}\n[{name}] type={ctype} len={len(text)}")
    print(f"[{name}] RAW first 900:\n{text[:900]}")
    if len(text) > 900:
        print(f"[{name}] RAW last 400:\n{text[-400:]}")
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(text, "html.parser")
    for ti, t in enumerate(soup.find_all("table")):
        rows = t.find_all("tr")
        print(f"[{name}] table#{ti}: {len(rows)} rows")
        for ri, tr in enumerate(rows[:10]):
            cells = [_clean(c.decode_contents()) for c in tr.find_all(["th", "td"])]
            if cells:
                print(f"[{name}]   r{ri}: {cells}")
        if len(rows) > 10:
            print(f"[{name}]   last: "
                  f"{[_clean(c.decode_contents()) for c in rows[-1].find_all(['th', 'td'])]}")
    # non-table layouts: show the visible text skeleton
    txt = _clean(text)
    if not soup.find_all("table") and txt:
        print(f"[{name}] TEXT: {txt[:800]}")


async def main() -> int:
    cookies = await playwright_login()
    ts = 1787217014000
    for name, ep in {**INDEXES, **ENDPOINTS}.items():
        url = f"{BASE}{ep}" + (f"?{ts}" if ep.endswith("_data.php") else "")
        try:
            r = requests.get(url, cookies=cookies, headers=HEADERS, timeout=20)
            _dump(f"{name}:{ep}", r.text, f"{r.status_code} {r.headers.get('content-type')}")
        except Exception as e:  # noqa: BLE001 — probe: report and continue
            print(f"[{name}] FAILED {url}: {e!r}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
