"""
Diagnostic probe: where does the real USD/VND (VCB) rate live in the acaphe
iquote.php row14?

The Vietnam Local Prices panel shows USD/VND ~105,615 but acaphe's real VCB rate
is ~26,070. _parse_vietnam() reads the FIRST number of row14['whenldclose']; this
probe logs in, fetches iquote.php, and dumps row14's raw fields + hunts every
cell for a number in the plausible USD/VND range so we can see the true source
field/format.

Pure diagnostic — no DB, no commits. Run via the "Probe: Acaphe" workflow.
"""
from __future__ import annotations

import asyncio
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

from scraper.acaphe_poller import API_URL, HEADERS, playwright_login  # noqa: E402


def _nums(s: str):
    return re.findall(r"\d[\d.,]*", str(s or ""))


async def main() -> None:
    cookies = await playwright_login()
    url = f"{API_URL}{int(time.time() * 1000)}"
    resp = requests.get(url, cookies=cookies, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    raw = resp.json()
    print(f"[probe] {len(raw)} rows; row0 keys = {list(raw[0].keys()) if raw else []}")

    row14 = next((r for r in raw if str(r.get("stt")) == "14"), None)
    if not row14:
        print("[probe] no stt==14 row! stt values:", [r.get("stt") for r in raw])
        return

    print("\n=== row14 raw fields ===")
    for k, v in row14.items():
        vs = str(v)
        if len(vs) > 200:
            vs = vs[:200] + "…"
        print(f"  {k!r}: {vs!r}")

    print("\n=== hunt for USD/VND-range numbers (24000-28000) across ALL rows/fields ===")
    for r in raw:
        for k, v in r.items():
            for n in _nums(v):
                try:
                    val = float(n.replace(".", "").replace(",", ""))
                except ValueError:
                    continue
                if 24000 <= val <= 28000:
                    print(f"  stt={r.get('stt')} field={k!r} num={n!r} → {val}  (cell={str(v)[:80]!r})")

    print("\n=== whenldclose specifically ===")
    print("  whenldclose =", repr(row14.get("whenldclose")))


if __name__ == "__main__":
    asyncio.run(main())
