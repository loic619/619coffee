"""
colombia.py — Colombia coffee data scraper.

Sources:
  FNC (Federación Nacional de Cafeteros): precio interno (daily farmer buy price)
  ICO historical CSV: monthly green coffee exports for Colombia (same source as Vietnam)

Returns NewsItem-shaped dicts for upsert_news_item().
"""
from __future__ import annotations

import json
import re
from datetime import date

from scraper.utils.page_probe import probe_urls


def _today() -> str:
    return date.today().isoformat()


# ── FNC precio interno ─────────────────────────────────────────────────────────

_FNC_URLS = [
    "https://federaciondecafeteros.org/wp/precio-del-cafe/",
    "https://federaciondecafeteros.org/",
]

# Regex: "$1,800,000" or "1.800.000" or "1800000" near "carga" / "kg"
_PRICE_RE = re.compile(
    r"\$?\s*([\d][,.\d]+)\s*(?:COP|pesos?)?",
    re.IGNORECASE,
)
_CARGA_RE = re.compile(
    r"(?:por\s+carga|precio\s+interno|carga\s+de\s+125|precio\s+caf[eé])",
    re.IGNORECASE,
)


def _extract_precio_interno(html: str) -> dict | None:
    """Try to extract precio interno (COP per 125-kg load) from page HTML."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)

    # Find paragraphs / divs with "precio interno" or "por carga" context
    candidates = []
    for tag in soup.find_all(string=_CARGA_RE):
        parent_text = tag.parent.get_text(" ", strip=True) if tag.parent else str(tag)
        m = _PRICE_RE.search(parent_text)
        if m:
            raw = m.group(1).replace(".", "").replace(",", "")
            try:
                val = int(raw)
                if 500_000 < val < 10_000_000:  # sanity: 500k–10M COP/carga
                    candidates.append(val)
            except ValueError:
                pass

    if not candidates:
        # Broader fallback: look for any large number near "COP" in page text
        for m in re.finditer(r"([\d][.,\d]+)\s*(?:cop|pesos?)", text, re.IGNORECASE):
            raw = m.group(1).replace(".", "").replace(",", "")
            try:
                val = int(raw)
                if 500_000 < val < 10_000_000:
                    candidates.append(val)
            except ValueError:
                pass

    if not candidates:
        return None

    # Take the most common value (or largest if all unique)
    from collections import Counter
    most_common = Counter(candidates).most_common(1)[0][0]
    return {"cop_per_carga": most_common, "as_of": _today(), "source": "FNC"}


async def run(page) -> list[dict]:
    results = []

    # ── 1. FNC precio interno ────────────────────────────────────────────────
    # Working source (1 item/run) — same guard applied so a future FNC outage
    # costs one timeout instead of one per candidate.
    precio = await probe_urls(
        page, _FNC_URLS, _extract_precio_interno, tag="colombia/FNC",
    )

    if precio:
        results.append({
            "title":    f"Colombia FNC Precio Interno – {_today()}",
            "body":     f"FNC internal purchase price: {precio['cop_per_carga']:,} COP/carga (125 kg) as of {precio['as_of']}.",
            "source":   "FNC",
            "category": "supply",
            "lat":      4.571,
            "lng":      -74.297,
            "tags":     ["price", "colombia", "fnc", "precio-interno"],
            "meta":     json.dumps(precio),
        })

    return results
