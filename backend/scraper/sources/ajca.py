"""
ajca.py — All Japan Coffee Association scraper.

Source pages
  - https://coffee.ajca.or.jp/data/           statistics hub
  - PDFs under /wordpress/wp-content/uploads/{YYYY}/{MM}/

The data-hub HTML already exposes the latest annual figures inline
(consumption + green-coffee imports in tonnes), so the MVP simply
regexes them out. Monthly PDFs are discovered by URL pattern so we
can layer monthly granularity on top later without touching this file
much. Replaces the AJCA HTML scraper that returned bad magnitudes.

Writes backend/scraper/cache/ajca.json:

  {
    "source": "AJCA",
    "source_url": "https://coffee.ajca.or.jp/data/",
    "last_updated": "2026-05-12",
    "latest_year":            "2025",
    "latest_consumption_mt":  397272,
    "latest_imports_mt":      359382,
    "monthly_imports_pdf":    "https://coffee.ajca.or.jp/wordpress/.../j-import202603.pdf",
    "monthly_exports_pdf":    "...",
    "supply_demand_pdf":      "...",
    "yearly_imports_pdf":     "...",
    "pdf_index": [...]   # all data-* PDFs found on the page
  }
"""
from __future__ import annotations

import io
import json
import logging
import re
from datetime import datetime
from pathlib import Path

import pdfplumber
import requests

logger = logging.getLogger(__name__)

_HUB_URL    = "https://www.ajca.or.jp/data/"
_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "ajca.json"
# Multi-year history file, distinct from the latest-state cache. Stores
# {year_str: {imports_mt, consumption_mt, stocks_mt}}. Appended on every
# successful parse so the next run can compute YoY change vs prev period.
_HISTORY_PATH = Path(__file__).resolve().parents[1] / "cache" / "ajca_history.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
}

# Patterns mining the inline Japanese text on the data hub.
# "2025年の日本のコーヒー消費量 397,272 トン" → consumption 397272
_CONS_PAT  = re.compile(
    r"(20\d{2})\s*年\s*の\s*日本\s*の\s*コーヒー\s*消費量\s*([\d,]+)\s*トン",
)
# "2025年のコーヒー生豆の輸入量 359,382 トン" → imports 359382
_IMP_PAT   = re.compile(
    r"(20\d{2})\s*年\s*の\s*コーヒー\s*生豆\s*の\s*輸入量\s*([\d,]+)\s*トン",
)
# Defensive stocks pattern — AJCA occasionally publishes inventory figures
# alongside imports/consumption with phrasing like "在庫" (zaiko, "stocks").
# Captures any phrase ending in 在庫 followed by digits + トン. Fires only
# when the hub page surfaces it; returns None otherwise.
_STOCKS_PAT = re.compile(
    r"(?:在庫|ストック)\s*(?:量)?\s*([\d,]+)\s*トン",
)

# Reasonable range gate (Japan imports ≈ 350-450k MT/yr historically).
_MT_MIN = 100_000
_MT_MAX = 1_000_000


def _parse_mt(raw: str) -> int | None:
    try:
        v = int(raw.replace(",", ""))
        return v if _MT_MIN <= v <= _MT_MAX else None
    except ValueError:
        return None


# All PDFs under /wp-content/uploads/, with their data prefix and trailing
# year+month or year tag. Captures help us identify the "latest" of each kind.
_PDF_PAT = re.compile(
    r'href="(https?://[^"]*/wp-content/uploads/(\d{4})/(\d{2})/'
    r'(data-jukyu|data-yunyu-suii|data-24|data-gc-yunyuryo-tanka|data-rcic-yunyuryo-tanka|'
    r'data7-import-(?:nama|gc|rc|ic|other)|data7-export|data-decaf|'
    r'j-import|j-export)([^.]*)\.pdf)"',
    re.I,
)


def _collect_pdf_index(html: str) -> list[dict]:
    """Return every coffee-data PDF link on the hub page, with metadata."""
    out: list[dict] = []
    for m in _PDF_PAT.finditer(html):
        url, year, month, kind, tail = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        # Some filenames bake the date into the tail too (e.g. "202603").
        tail_date = re.search(r"(\d{6})", tail)
        out.append({
            "url":         url,
            "kind":        kind,
            "upload_year": year,
            "upload_month": month,
            "data_period": tail_date.group(1) if tail_date else None,
        })
    return out


def _latest_pdf_by_kind(index: list[dict], kind: str) -> str | None:
    """Most recent PDF of a given kind, sorted by data_period or upload date."""
    candidates = [p for p in index if p["kind"] == kind]
    if not candidates:
        return None
    candidates.sort(
        key=lambda p: (p.get("data_period") or (p["upload_year"] + p["upload_month"])),
        reverse=True,
    )
    return candidates[0]["url"]


# Japanese country names → English. AJCA uses kanji in PDF tables.
_COUNTRY_MAP: dict[str, str] = {
    "ブラジル":                 "Brazil",
    "コロンビア":               "Colombia",
    "ベトナム":                 "Vietnam",
    "インドネシア":             "Indonesia",
    "エチオピア":               "Ethiopia",
    "グアテマラ":               "Guatemala",
    "ホンジュラス":             "Honduras",
    "インド":                   "India",
    "タンザニア":               "Tanzania",
    "ペルー":                   "Peru",
    "メキシコ":                 "Mexico",
    "コスタリカ":               "Costa Rica",
    "ニカラグア":               "Nicaragua",
    "パプアニューギニア":       "Papua New Guinea",
    "ウガンダ":                 "Uganda",
    "ケニア":                   "Kenya",
    "イエメン":                 "Yemen",
    "エルサルバドル":           "El Salvador",
    "ルワンダ":                 "Rwanda",
    "カメルーン":               "Cameroon",
    "その他":                   "Others",
    "合計":                     "Total",
    "計":                       "Subtotal",
    # Romanized forms that appear in some PDFs
    "Brazil":                   "Brazil",
    "Colombia":                 "Colombia",
    "Vietnam":                  "Vietnam",
    "Indonesia":                "Indonesia",
    "Ethiopia":                 "Ethiopia",
    "Guatemala":                "Guatemala",
    "Honduras":                 "Honduras",
    "India":                    "India",
}

# Minimum and maximum plausible MT for a single country in one month.
_COUNTRY_MT_MIN = 100
_COUNTRY_MT_MAX = 80_000


def _parse_country_breakdown(pdf_url: str) -> list[dict] | None:
    """Download a j-import PDF and return country-of-origin breakdown.

    AJCA j-import PDFs contain a table keyed by 生産国 (country of origin)
    with current-month tonnage and cumulative tonnage. We return a list of
    {country, imports_mt} dicts for the current-month column.
    """
    try:
        r = requests.get(pdf_url, headers=_HEADERS, timeout=60)
        if r.status_code != 200:
            logger.warning(f"[ajca] PDF download HTTP {r.status_code}: {pdf_url}")
            return None
        raw = r.content
    except Exception as e:
        logger.warning(f"[ajca] PDF download failed: {e}")
        return None

    try:
        results: list[dict] = []
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            for page in pdf.pages:
                # Try structured table extraction first.
                tables = page.extract_tables()
                for table in tables:
                    for row in (table or []):
                        if not row or len(row) < 2:
                            continue
                        country_raw = str(row[0] or "").strip()
                        country = _COUNTRY_MAP.get(country_raw)
                        if not country or country in ("Total", "Subtotal"):
                            continue
                        # First numeric column = current-month imports.
                        for cell in row[1:]:
                            val_str = str(cell or "").replace(",", "").strip()
                            if not val_str:
                                continue
                            try:
                                val = int(val_str)
                            except ValueError:
                                continue
                            if _COUNTRY_MT_MIN <= val <= _COUNTRY_MT_MAX:
                                results.append({"country": country, "imports_mt": val})
                                break

                # If tables failed, fall back to line-by-line text parsing.
                if not results:
                    text = page.extract_text() or ""
                    for line in text.splitlines():
                        line = line.strip()
                        for jp, en in _COUNTRY_MAP.items():
                            if en in ("Total", "Subtotal"):
                                continue
                            if jp in line:
                                nums = re.findall(r"[\d,]{3,}", line)
                                for n in nums:
                                    try:
                                        val = int(n.replace(",", ""))
                                    except ValueError:
                                        continue
                                    if _COUNTRY_MT_MIN <= val <= _COUNTRY_MT_MAX:
                                        results.append({"country": en, "imports_mt": val})
                                        break
                                break

        # Deduplicate by country (keep first occurrence per country).
        seen: dict[str, dict] = {}
        for r in results:
            seen.setdefault(r["country"], r)
        unique = list(seen.values())
        return unique if unique else None

    except Exception as e:
        logger.warning(f"[ajca] PDF parse failed: {e}")
        return None


def _fetch_hub() -> str | None:
    try:
        r = requests.get(_HUB_URL, headers=_HEADERS, timeout=30, allow_redirects=True)
        r.raise_for_status()
        return r.text
    except Exception as e:
        logger.warning(f"[ajca] hub fetch failed: {e}")
        return None


def _strip_html(html: str) -> str:
    """Strip tags so a phrase split across <strong>/<span> renders as flat text."""
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text)


def _load_history() -> dict:
    if not _HISTORY_PATH.exists():
        return {}
    try:
        return json.loads(_HISTORY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_history(history: dict) -> None:
    _HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8",
    )


def _parse_hub(html: str) -> dict | None:
    text = _strip_html(html)
    cons_match   = _CONS_PAT.search(text)
    imp_match    = _IMP_PAT.search(text)
    stocks_match = _STOCKS_PAT.search(text)

    consumption_mt: int | None = None
    imports_mt:     int | None = None
    stocks_mt:      int | None = None
    consumption_year: str | None = None
    imports_year:     str | None = None

    if cons_match:
        consumption_year = cons_match.group(1)
        consumption_mt   = _parse_mt(cons_match.group(2))
    if imp_match:
        imports_year = imp_match.group(1)
        imports_mt   = _parse_mt(imp_match.group(2))
    if stocks_match:
        stocks_mt = _parse_mt(stocks_match.group(1))

    if consumption_mt is None and imports_mt is None:
        return None

    latest_year = imports_year or consumption_year

    # YoY deltas from the accumulating history cache. Falls through cleanly
    # when no prior-year snapshot is available (first run, or after a cache
    # wipe) — we report None rather than synthesising a fake delta.
    history = _load_history()
    prev_imports_mt:     int | None = None
    prev_consumption_mt: int | None = None
    prev_stocks_mt:      int | None = None
    if latest_year:
        prev_year = str(int(latest_year) - 1)
        prev = history.get(prev_year) or {}
        prev_imports_mt     = prev.get("imports_mt")
        prev_consumption_mt = prev.get("consumption_mt")
        prev_stocks_mt      = prev.get("stocks_mt")

    def _pct_delta(curr: int | None, prev: int | None) -> float | None:
        if curr is None or prev is None or prev == 0:
            return None
        return round((curr - prev) / prev * 100, 1)

    imports_yoy_pct     = _pct_delta(imports_mt,     prev_imports_mt)
    consumption_yoy_pct = _pct_delta(consumption_mt, prev_consumption_mt)
    stocks_yoy_pct      = _pct_delta(stocks_mt,      prev_stocks_mt)

    # Append the current snapshot so next run sees it as `prev`. Only write
    # when at least one figure is present — avoids a partial-year clobber.
    if latest_year and (imports_mt is not None or consumption_mt is not None
                        or stocks_mt is not None):
        history[latest_year] = {
            k: v for k, v in (
                ("imports_mt",     imports_mt),
                ("consumption_mt", consumption_mt),
                ("stocks_mt",      stocks_mt),
            ) if v is not None
        }
        _save_history(history)

    pdf_index = _collect_pdf_index(html)

    # Real data date = the latest monthly import report's period (e.g. "202603"
    # → 2026-03-01), not the run time, so freshness reflects the actual AJCA
    # release. Falls back to the latest yearly figure, then run-date.
    _periods = [p.get("data_period") for p in pdf_index
                if p.get("kind") == "j-import" and p.get("data_period")]
    _last_updated = datetime.utcnow().date().isoformat()
    if _periods:
        _lp = max(_periods)  # "YYYYMM" — lexical max == chronological max
        if len(_lp) >= 6 and _lp[:6].isdigit():
            _last_updated = f"{_lp[:4]}-{_lp[4:6]}-01"

    return {
        "source":                  "AJCA",
        "source_url":              _HUB_URL,
        "last_updated":            _last_updated,
        "latest_year":             latest_year,
        "latest_consumption_mt":   consumption_mt,
        "latest_imports_mt":       imports_mt,
        "latest_stocks_mt":        stocks_mt,
        "prev_imports_mt":         prev_imports_mt,
        "prev_consumption_mt":     prev_consumption_mt,
        "prev_stocks_mt":          prev_stocks_mt,
        "imports_yoy_pct":         imports_yoy_pct,
        "consumption_yoy_pct":     consumption_yoy_pct,
        "stocks_yoy_pct":          stocks_yoy_pct,
        "monthly_imports_pdf":     _latest_pdf_by_kind(pdf_index, "j-import"),
        "monthly_exports_pdf":     _latest_pdf_by_kind(pdf_index, "j-export"),
        "supply_demand_pdf":       _latest_pdf_by_kind(pdf_index, "data-jukyu"),
        "yearly_imports_pdf":      _latest_pdf_by_kind(pdf_index, "data-yunyu-suii"),
        "pdf_index":               pdf_index,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        html = _fetch_hub()
        if not html:
            print("[ajca] No HTML — retaining cache")
            return
        parsed = _parse_hub(html)
        if not parsed:
            print("[ajca] Could not extract figures from hub page — retaining cache")
            return

        # Attempt country-of-origin breakdown from latest j-import PDF.
        monthly_pdf = parsed.get("monthly_imports_pdf")
        origin_breakdown: list[dict] | None = None
        if monthly_pdf:
            origin_breakdown = _parse_country_breakdown(monthly_pdf)
            if origin_breakdown:
                print(
                    f"[ajca] origin breakdown: {len(origin_breakdown)} countries "
                    f"from {monthly_pdf.rsplit('/', 1)[-1]}"
                )
            else:
                print(f"[ajca] no country breakdown extracted from {monthly_pdf.rsplit('/', 1)[-1]}")
        parsed["latest_origin_breakdown"] = origin_breakdown
        parsed["latest_origin_pdf"] = monthly_pdf

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8")
        print(
            f"[ajca] {parsed['latest_year']} "
            f"imports={parsed['latest_imports_mt']} MT  "
            f"consumption={parsed['latest_consumption_mt']} MT "
            f"({len(parsed['pdf_index'])} pdfs indexed)"
        )
        # Persist to DB so export jobs on separate runners can fall back to DB.
        # Body now includes optional stocks + YoY tokens. The frontend
        # NewsFeed.tsx AJCA-specific extractors regex
        # these out — see _SOURCE_EXTRACTORS["AJCA"]. Missing values are
        # omitted entirely so the line stays compact when stocks / YoY
        # aren't yet available (first run after a cache wipe, or hub page
        # doesn't expose stocks).
        if db is not None:
            body_parts = [f"AJCA Japan {parsed['latest_year']}:"]
            if parsed.get("latest_imports_mt") is not None:
                body_parts.append(f"imports={parsed['latest_imports_mt']} MT")
            if parsed.get("latest_consumption_mt") is not None:
                body_parts.append(f"consumption={parsed['latest_consumption_mt']} MT")
            if parsed.get("latest_stocks_mt") is not None:
                body_parts.append(f"stocks={parsed['latest_stocks_mt']} MT")
            if parsed.get("imports_yoy_pct") is not None:
                yoy = parsed["imports_yoy_pct"]
                sign = "+" if yoy >= 0 else ""
                body_parts.append(f"YoY={sign}{yoy:.1f}%")
            body = body_parts[0] + " " + ", ".join(body_parts[1:])

            from scraper.db import upsert_news_item
            try:
                _pub = datetime.strptime(parsed["last_updated"][:10], "%Y-%m-%d")
            except Exception:
                _pub = datetime.utcnow()
            upsert_news_item(db, {
                "title":    f"AJCA Japan Coffee Data – {parsed['last_updated']}",
                "body":     body,
                "source":   "AJCA",
                "category": "demand",
                "lat":      35.689,
                "lng":      139.692,
                "tags":     ["japan", "demand", "imports", "latest_only"],
                "meta":     json.dumps(parsed),
                "pub_date": _pub,
            })
    except Exception as e:
        print(f"[ajca] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[ajca] cache read failed: {e}")
        return None


if __name__ == "__main__":
    import asyncio

    async def _main():
        await run(None, None)

    asyncio.run(_main())
