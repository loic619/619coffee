"""
probe_mapbiomas.py — discover how to get MapBiomas coffee-area statistics.

Goal: area in hectares of MapBiomas class 46 (Coffee / Café), per municipality,
per year (1985→present), so the map can show where coffee is grown and how that
footprint has moved.

Why a probe rather than just writing the scraper: MapBiomas is unreachable from
the dev sandbox, and the last time a source was assumed rather than verified
(PortWatch) it cost a day. So this run answers, against the real site:

  1. Which statistics/download pages exist and respond.
  2. What downloadable files they link to (name, size, type) — MapBiomas
     publishes area-by-class-by-municipality-by-year, but the file naming and
     hosting are not documented anywhere I can reach.
  3. Whether the platform exposes a JSON API that would beat a 100 MB xlsx.

Writes nothing. Run via workflow 0.23 (dispatch-only).

    cd backend && python -m scraper.probe_mapbiomas
"""
from __future__ import annotations

import re
import sys
import time

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en,pt-BR;q=0.9",
}

# Pages that plausibly list the statistics downloads, in both languages — the
# English paths sometimes redirect to Portuguese ones.
_PAGES = [
    "https://brasil.mapbiomas.org/en/estatisticas/",
    "https://brasil.mapbiomas.org/estatisticas/",
    "https://brasil.mapbiomas.org/en/downloads/",
    "https://brasil.mapbiomas.org/downloads/",
    "https://brasil.mapbiomas.org/en/colecoes-mapbiomas/",
]

# Endpoints worth a look for a JSON alternative to a huge spreadsheet.
_API_CANDIDATES = [
    "https://plataforma.mapbiomas.org/api/graphql",
    "https://plataforma.mapbiomas.org/graphql",
    "https://api.mapbiomas.org/graphql",
]

_FILE_RE = re.compile(r'https?://[^\s"\'<>]+\.(?:xlsx|xls|csv|zip|json)', re.I)


def _get(url: str, timeout: int = 45):
    import requests

    time.sleep(1.0)
    return requests.get(url, headers=_HEADERS, timeout=timeout, allow_redirects=True)


def _head(url: str) -> str:
    """Size and type of a candidate download, without pulling the whole file."""
    import requests

    try:
        time.sleep(0.5)
        r = requests.head(url, headers=_HEADERS, timeout=30, allow_redirects=True)
        size = r.headers.get("Content-Length")
        mb = f"{int(size) / 1e6:.1f} MB" if size and size.isdigit() else "unknown size"
        return f"{r.status_code} {r.headers.get('Content-Type', '?')} {mb}"
    except Exception as e:  # noqa: BLE001
        return f"HEAD failed: {type(e).__name__}"


def main() -> int:
    found: dict[str, str] = {}

    print("=== statistics / download pages ===")
    for url in _PAGES:
        try:
            r = _get(url)
            hits = set(_FILE_RE.findall(r.text))
            print(f"  {r.status_code}  {url}  ({len(r.text) // 1024} KB, "
                  f"{len(hits)} file link(s))")
            for h in hits:
                found[h] = ""
            # Surface where the assets are hosted even if the regex misses them.
            for host in ("storage.googleapis.com", "drive.google.com",
                         "amazonaws.com", "/wp-content/"):
                if host in r.text:
                    print(f"        mentions {host}")
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR {url} — {type(e).__name__}: {e}")

    print(f"\n=== {len(found)} candidate download(s) ===")
    # Coffee lives in the land-cover ("cobertura") tables; surface those first.
    ranked = sorted(found, key=lambda u: (
        0 if re.search(r"cobertura|coverage|munic", u, re.I) else 1, u))
    for url in ranked[:40]:
        print(f"  {url}")
        print(f"      {_head(url)}")

    print("\n=== JSON API candidates ===")
    for url in _API_CANDIDATES:
        try:
            r = _get(url, timeout=25)
            print(f"  {r.status_code}  {url}  {r.headers.get('Content-Type', '?')}")
            if r.status_code < 400:
                print(f"      {r.text[:200]}")
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR {url} — {type(e).__name__}")

    print("\nNext: pick the smallest file that carries class 46 by municipality "
          "by year, and build the exporter against it.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
