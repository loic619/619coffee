"""
probe_vn_block.py — TEMPORARY. The Vietnam bid/offer block still shows on
acaphe (screenshot 22/08: "BMT bid 93000-94000 / offer 96000-97000 …") but
iquote.php row14.High now returns only the stub 'acaphe()' — so the block
MOVED. Find where. Delete once the poller is repointed.

Searches, in order:
  1. every row/field of iquote.php for the marker text (BMT / bid / Pepper)
  2. the logged-in home page for iframe/panel endpoints
  3. each *_index.php / *_data.php panel it finds, for the same markers
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraper.acaphe_poller import API_URL, HEADERS, playwright_login  # noqa: E402

BASE = "https://acaphe.com/"
MARKERS = ("BMT", "HCM", "R2 FOB", "Pepper", "tiêu", "bid")


def _hit(text: str) -> list[str]:
    return [m for m in MARKERS if m.lower() in (text or "").lower()]


async def main() -> int:
    cookies = await playwright_login()
    import time

    # ── 1. the quote API, field by field ─────────────────────────────────────
    r = requests.get(f"{API_URL}{int(time.time() * 1000)}", cookies=cookies,
                     headers=HEADERS, timeout=20)
    print(f"[iquote] status={r.status_code} len={len(r.text)}")
    try:
        rows = r.json()
        print(f"[iquote] rows={len(rows)}")
        for row in rows:
            stt = row.get("stt")
            for k, v in row.items():
                s = str(v)
                if _hit(s):
                    print(f"[iquote] *** stt={stt} field={k!r} hits={_hit(s)}\n"
                          f"         {s[:400]!r}")
            if str(stt) in ("13", "14", "15"):
                print(f"[iquote] stt={stt} fields: "
                      f"{ {k: str(v)[:90] for k, v in row.items()} }")
    except Exception as e:  # noqa: BLE001
        print(f"[iquote] not JSON ({e!r}); head: {r.text[:400]!r}")

    # ── 2. panels linked from the logged-in home page ────────────────────────
    home = requests.get(BASE, cookies=cookies, headers=HEADERS, timeout=20)
    print(f"\n[home] status={home.status_code} len={len(home.text)}")
    panels = sorted(set(re.findall(r"['\"]([\w./-]+\.php)['\"]", home.text)))
    print(f"[home] php endpoints referenced: {panels}")
    for m in re.findall(r"src\s*=\s*['\"]([^'\"]+)['\"]", home.text)[:40]:
        print(f"[home][src] {m}")

    # ── 3. sweep those panels for the VN markers ─────────────────────────────
    for p in panels:
        url = BASE + p.lstrip("./")
        try:
            resp = requests.get(f"{url}?{int(time.time() * 1000)}", cookies=cookies,
                                headers=HEADERS, timeout=15)
        except Exception as e:  # noqa: BLE001
            print(f"[panel] {p}: FAILED {e!r}")
            continue
        hits = _hit(resp.text)
        flag = "***" if hits else "   "
        print(f"[panel] {flag} {p}: {resp.status_code} len={len(resp.text)} hits={hits}")
        if hits:
            txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", resp.text)).strip()
            print(f"[panel]     TEXT: {txt[:600]!r}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
