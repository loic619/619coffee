import re
from datetime import date

from bs4 import BeautifulSoup

from scraper.translate import translate_to_english


def _today() -> str:
    return date.today().isoformat()

_LAT, _LNG = -0.789, 113.921  # Indonesia


def parse_alfabean(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"price|idr|harga", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Indonesia Local Coffee Price (Alfabean) – {_today()}",
        "body": translate_to_english(f"Indonesia local coffee price: {text} IDR/kg", "id"),
        "source": "Alfabean",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "indonesia"],
    }


async def run(page) -> list[dict]:
    results = []
    try:
        await page.goto("https://www.alfabean.com/price-list/", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        html = await page.content()
        item = parse_alfabean(html)
        if item:
            results.append(item)
        else:
            # Observed 2026-08-13/14: "origins: 0 items" on every run with NOTHING
            # logged, because the page loads fine and parse_alfabean just returns
            # None — the price/idr/harga class it keys on is no longer in the
            # markup. Same silent-extraction failure as honduras/IHCAFE. Log the
            # size and title so the next CI run says whether we got the real page,
            # a consent wall, or a redirect, without needing the host reachable
            # from a dev sandbox (it is not — Alfabean refuses non-CI IPs).
            title = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
            print(f"[origins] alfabean loaded ({len(html)}b, title="
                  f"{(title.group(1).strip()[:60] if title else '?')!r}) but no price "
                  f"element matched — extractor needs updating, not the URL")
    except Exception as e:
        print(f"[origins] alfabean failed: {e}")
    return results
