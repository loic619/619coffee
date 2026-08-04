# backend/scraper/sources/rss.py
# Fetches coffee industry news from RSS feeds.
# Uses only requests + feedparser — no Playwright page needed.
import asyncio
import html
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import feedparser
import requests

RSS_FEEDS = [
    {
        "url":      "https://perfectdailygrind.com/feed/",
        "source":   "Perfect Daily Grind",
        "default_category": "supply",
    },
    {
        "url":      "https://sprudge.com/feed",
        "source":   "Sprudge",
        "default_category": "general",
    },
    # Trade/market-focused feeds — heavier on price-, crop- and export-relevant
    # headlines than the culture feeds above, so the sentiment classifier has
    # genuinely directional news to score. A dead feed just logs and is skipped.
    {
        "url":      "https://www.comunicaffe.com/feed/",
        "source":   "Comunicaffe",
        "default_category": "macro",
    },
    # Daily Coffee News removed 2026-07 (owner request): mostly culture/gear
    # headlines that diluted the sentiment signal. Replaced by the Sucafina
    # weekly origin reports (fetch_sucafina_reports.py) as the origin-news feed.
    {
        "url":      "https://www.globalcoffeereport.com/feed/",
        "source":   "Global Coffee Report",
        "default_category": "macro",
    },
]

# Keywords → category override (checked against title + summary, case-insensitive)
CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("macro",  ["price", "futures", "ico ", "cftc", "market", "export", "import",
                "tariff", "inflation", "dollar", "usd", "brl", "vnd"]),
    ("supply", ["harvest", "production", "crop", "yield", "supply", "robusta",
                "arabica", "brazil", "vietnam", "colombia", "ethiopia", "kenya",
                "drought", "rain", "weather", "certifi", "frost"]),
    ("demand", ["demand", "consumption", "sales", "retail", "café", "cafe",
                "roaster", "roasting", "specialty"]),
]

MAX_ITEMS_PER_FEED = 10


def _classify(text: str) -> str:
    lower = text.lower()
    for category, keywords in CATEGORY_RULES:
        if any(kw in lower for kw in keywords):
            return category
    return "general"


def _parse_date(entry) -> datetime:
    """Return a timezone-aware datetime for an RSS entry."""
    # feedparser exposes published_parsed (time.struct_time, UTC)
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        return datetime(*entry.published_parsed[:6], tzinfo=UTC)
    # Fallback: raw published string
    if hasattr(entry, "published") and entry.published:
        try:
            return parsedate_to_datetime(entry.published)
        except Exception:
            pass
    return datetime.now(UTC)


BOILERPLATE_PATTERNS = [
    r"This article is from the coffee website .+?(?:https?://\S+)\.",
    r"This article is from the coffee website .+?\.",
    r"This is the RSS feed version\.",
    r"Key takeaways\s*",
    r"^com\.\s*",  # URL remnant after above stripping
]

def _strip_html(text: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", text or "")
    cleaned = html.unescape(cleaned)
    for pattern in BOILERPLATE_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _fetch_feed(feed_cfg: dict) -> list[dict]:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelBot/1.0)"}
    try:
        resp = requests.get(feed_cfg["url"], headers=headers, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"[rss] {feed_cfg['source']}: fetch failed — {e}")
        return []

    parsed = feedparser.parse(resp.content)
    items = []

    for entry in parsed.entries[:MAX_ITEMS_PER_FEED]:
        title = _strip_html(entry.get("title", "")).strip()
        if not title:
            continue

        summary = _strip_html(entry.get("summary", entry.get("description", ""))).strip()
        body = summary[:500] if summary else ""

        pub_date = _parse_date(entry)
        text_for_classify = f"{title} {body}"
        category = _classify(text_for_classify) if feed_cfg["default_category"] != "general" \
                   else (_classify(text_for_classify) if _classify(text_for_classify) != "general" else "general")

        url = entry.get("link", "")
        items.append({
            "title":    title,
            "body":     body,
            "source":   feed_cfg["source"],
            "category": category,
            "lat":      None,
            "lng":      None,
            "tags":     ["news", feed_cfg["source"].lower().replace(" ", "_")],
            "meta":     url,
            "pub_date": pub_date,
        })

    print(f"[rss] {feed_cfg['source']}: {len(items)} items")
    return items


async def run(page) -> list[dict]:
    """Fetch all RSS feeds concurrently using threads (no Playwright needed)."""
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, _fetch_feed, cfg) for cfg in RSS_FEEDS]
    results = await asyncio.gather(*tasks)
    return [item for batch in results for item in batch]
