"""roaster_results.py — volume growth from roaster results releases.

WHY NOT THE TICKER FEED. fetch_earnings.py already pulls prices and revenue.
Revenue is not a demand signal: when green doubles, a roaster's sales can rise
while the cups it sells fall. The half that says something about consumption is
volume — and it exists only in the results releases, on each company's own
fixed definition:

    JDE Peet's   volume/mix vs price, split per segment
    Nestle       RIG (Real Internal Growth), same idea, different house style

WHAT THIS COVERS. Both. Nestle's HTML pages do return 403 from CI, but their
press releases sit on a STATIC file path that is not protected, so the PDFs are
fetched directly by URL pattern and the site is never scraped at all. That is
both faster and less brittle than walking the results calendar.

PARSING. The numbers live in prose, not a table, and the phrasing is not
stable. All four of these appear in one report:

    "Organic sales up +15.3%, driven by 19.5% price and -4.3% volume/mix"
    "... an increase in price of 16.2% and a decrease in volume/mix of 7.9%"
    "... an increase of 0.7% in volume/mix and 6.0% in price"     <- order flips
    "... an increase of 39.8% in price and very resilient volume/mix"  <- no number

So each percentage is associated with whichever metric word sits closest to it,
the sign is taken from an explicit minus OR a "decrease"/"decline" ahead of it,
and a metric mentioned without a number yields None. A fixed template matches
none of these reliably; proximity matches all of them.
"""
from __future__ import annotations

import io
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

log = logging.getLogger(__name__)

OUT_PATH = Path(__file__).resolve().parents[3] / "frontend" / "public" / "data" / "roaster_earnings.json"

_IR_INDEX = "https://www.jdepeets.com/investors/"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
_HEADERS = {"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"}

_NUM = re.compile(r"([+-]?\d+(?:\.\d+)?)\s*%")
_VOL = re.compile(r"volume\s*/?\s*mix", re.I)
_PRICE = re.compile(r"\bprice\b", re.I)
_ORGANIC = re.compile(r"organic sales (?:growth of |up )?([+-]?\d+(?:\.\d+)?)\s*%", re.I)
_DECREASE = re.compile(r"decrease|decline|down|lower", re.I)

# Segment names JDE Peet's reports under. Matched against the text preceding a
# sentence so each figure is attributed rather than dumped into one bucket.
_SEGMENTS = [
    "Europe", "LARMEA", "APAC", "Asia Pacific", "Peet's", "Peet’s",
    "Away From Home", "Out of Home", "CPG", "Total",
]


def _period_from_url(url: str) -> str | None:
    """'…full-year-results-2025-report.pdf' → '2025-FY'."""
    m = re.search(r"(half-year|full-year|q[1-4])[-_]results[-_](\d{4})", url, re.I)
    if not m:
        m2 = re.search(r"(\d{4})", url)
        return f"{m2.group(1)}-?" if m2 else None
    kind, year = m.group(1).lower(), m.group(2)
    suffix = {"half-year": "H1", "full-year": "FY"}.get(kind, kind.upper())
    return f"{year}-{suffix}"


_PCT = re.compile(r"(-?\d+(?:\.\d+)?)\s*%")
_VOLMIX_HEADER = re.compile(r"vol\s*/?\s*mix", re.I)
_BRIDGE = re.compile(r"growth bridge", re.I)


def _cell(v: object) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _pct(cell: str) -> float | None:
    """'1.8%' -> 1.8, '-1.2%' -> -1.2, an em-dash or blank -> None.

    A dash means the company reported no effect for that cell, which is not the
    same as zero and certainly not the same as a guess.
    """
    m = _PCT.search(cell)
    return float(m.group(1)) if m else None


def parse_bridge_table(table: list[list]) -> list[dict]:
    """Rows of the 'Sales growth bridge by segment' table.

    The table is the authoritative source — the same figures appear in prose
    elsewhere in the report, but the phrasing there is unstable (order flips,
    signs move between word and number, and some segments are described as
    "very resilient" with no figure at all). A table column is unambiguous.

    Column position is found by HEADER TEXT rather than fixed index, because
    the bridge carries Vol/Mix, Price, Organic, FX, Scope and Reported, and
    that layout is not guaranteed to stay put across years.
    """
    if not table:
        return []
    header_idx = None
    vol_col = price_col = organic_col = None
    for i, row in enumerate(table):
        cells = [_cell(c) for c in row]
        for j, c in enumerate(cells):
            if _VOLMIX_HEADER.search(c):
                header_idx, vol_col = i, j
            elif re.fullmatch(r"price", c, re.I):
                price_col = j
            elif re.search(r"organic", c, re.I):
                organic_col = j
        if header_idx is not None:
            break
    if header_idx is None or vol_col is None:
        return []

    out: list[dict] = []
    for row in table[header_idx + 1:]:
        cells = [_cell(c) for c in row]
        if not cells or not cells[0]:
            continue
        segment = cells[0]
        # Skip footnote / total-of-totals noise but keep the group line.
        if len(segment) > 40 or _PCT.search(segment):
            continue
        vol = _pct(cells[vol_col]) if vol_col < len(cells) else None
        if vol is None:
            continue
        out.append({
            "segment": segment.replace("\u2019", "'"),
            "volume_mix_pct": vol,
            "price_pct": _pct(cells[price_col]) if price_col is not None and price_col < len(cells) else None,
            "organic_pct": _pct(cells[organic_col]) if organic_col is not None and organic_col < len(cells) else None,
        })
    return out


def parse_report(pdf_bytes: bytes) -> list[dict]:
    """Vol/Mix per segment from the report's segment bridge."""
    try:
        import pdfplumber
    except ImportError:                                   # pragma: no cover
        log.error("[roaster_results] pdfplumber missing")
        return []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pageno, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            if not _BRIDGE.search(text):
                continue
            # The bridge is laid out with whitespace, not ruled lines, so
            # pdfplumber's default "lines" strategy finds no table at all —
            # which is how the first run silently fell back to prose figures
            # and mis-attributed price as volume. Try text alignment first.
            strategies = (
                {"vertical_strategy": "text", "horizontal_strategy": "text"},
                {"vertical_strategy": "text", "horizontal_strategy": "lines"},
                None,   # pdfplumber default, for a ruled table
            )
            for settings in strategies:
                try:
                    tables = page.extract_tables(settings) if settings else page.extract_tables()
                except Exception as e:                    # noqa: BLE001
                    log.debug("[roaster_results] p%d strategy %s: %s", pageno, settings, e)
                    continue
                for table in tables or []:
                    rows = parse_bridge_table(table)
                    if rows:
                        log.info("[roaster_results] bridge table p%d via %s → %d segments: %s",
                                 pageno, (settings or "default"), len(rows),
                                 ", ".join(f"{r['segment']}={r['volume_mix_pct']}" for r in rows))
                        return rows
            log.warning("[roaster_results] p%d names the bridge but no table parsed", pageno)
    return []


def _report_urls(back_years: int = 6) -> list[str]:
    """Financial-report PDFs, newest first.

    Built from the site's own URL pattern and HEAD-checked, rather than scraped
    from the index page: the pattern is stable across years, while the index
    markup is not (an earlier version of this scraper found exactly one PDF by
    parsing it).
    """
    base = "https://www.jdepeets.com/siteassets/home/investors/financial-reports/"
    year = datetime.now(timezone.utc).year
    urls: list[str] = []
    for y in range(year, year - back_years, -1):
        for kind in ("full-year", "half-year"):
            u = f"{base}jde-peets-{kind}-results-{y}-report.pdf"
            try:
                h = requests.head(u, headers=_HEADERS, timeout=30, allow_redirects=True)
            except Exception:                             # noqa: BLE001
                continue
            if h.status_code == 200:
                urls.append(u)
            else:
                log.debug("[roaster_results] %s → HTTP %s", u, h.status_code)
    log.info("[roaster_results] %d report(s) available", len(urls))
    return urls


# ── Nestle ───────────────────────────────────────────────────────────────────
# The HTML pages 403 from CI, but the press releases sit on a STATIC file path
# that is not behind the same protection — reachable with a plain GET. The
# directory is the publication month, which is fixed per release type: three-
# month sales in April, half-year in July, nine-month in October, and full-year
# the FOLLOWING February.
#
# Their "Sales performance summary" is TRANSPOSED relative to JDE's bridge:
# metrics run down the side (RIG, Pricing, Organic growth, Net M&A, FX,
# Reported) and segments across the top (Total Group, the Zones, Nespresso …).
# So the RIG row is located by its label and zipped against the header row,
# rather than reading a column.
_NESTLE_BASE = "https://www.nestle.com/sites/default/files"
_NESTLE_KINDS = [
    # (label, url slug, publication month, year offset)
    ("3M", "three-month-sales-press-release", 4, 0),
    ("H1", "half-year-results-press-release", 7, 0),
    ("9M", "nine-month-sales-press-release", 10, 0),
    ("FY", "full-year-results-press-release", 2, 1),
]
_RIG_ROW = re.compile(r"real internal growth|\bRIG\b", re.I)
_HEADER_ANCHOR = re.compile(r"total group", re.I)


def parse_nestle_summary(table: list[list]) -> list[dict]:
    """RIG per segment from the sales-performance summary."""
    flat = [[_cell(c) for c in row] for row in (table or [])]
    header = next((r for r in flat if _HEADER_ANCHOR.search(" ".join(r))), None)
    rig = next((r for r in flat if r and _RIG_ROW.search(r[0])), None)
    if not header or not rig:
        return []
    out: list[dict] = []
    for i, name in enumerate(header):
        if not name or i >= len(rig):
            continue
        if _HEADER_ANCHOR.search(name) is None and i == 0:
            continue                                   # the stub cell
        value = _pct(rig[i])
        if value is None:
            continue
        out.append({"segment": name, "volume_mix_pct": value,
                    "price_pct": None, "organic_pct": None})
    return out


def parse_nestle_report(pdf_bytes: bytes) -> list[dict]:
    try:
        import pdfplumber
    except ImportError:                                   # pragma: no cover
        return []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pageno, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            if not _RIG_ROW.search(text):
                continue
            # Lines FIRST here: Nestle's summary is a ruled table, and the text
            # strategy shreds the page header into cells that happen to contain
            # "RIG" — which is how an earlier attempt matched the wrong table.
            for settings in ({"vertical_strategy": "lines", "horizontal_strategy": "lines"},
                             {"vertical_strategy": "text", "horizontal_strategy": "lines"},
                             None):
                try:
                    tables = page.extract_tables(settings) if settings else page.extract_tables()
                except Exception:                          # noqa: BLE001
                    continue
                for table in tables or []:
                    rows = parse_nestle_summary(table)
                    if rows:
                        log.info("[roaster_results] nestle RIG p%d → %s", pageno,
                                 ", ".join(f"{r['segment']}={r['volume_mix_pct']}" for r in rows))
                        return rows
    return []


def nestle_periods(back_years: int = 3) -> list[dict]:
    now = datetime.now(timezone.utc)
    periods: list[dict] = []
    for year in range(now.year, now.year - back_years, -1):
        for label, slug, month, offset in _NESTLE_KINDS:
            url = f"{_NESTLE_BASE}/{year + offset}-{month:02d}/{slug}-{year}-en.pdf"
            try:
                r = requests.get(url, headers=_HEADERS, timeout=60)
            except Exception:                              # noqa: BLE001
                continue
            if not r.ok or b"%PDF" not in r.content[:1024]:
                continue
            rows = parse_nestle_report(r.content)
            if not rows:
                log.info("[roaster_results] nestle %s-%s: PDF found, no RIG table", year, label)
                continue
            periods.append({"period": f"{year}-{label}", "source_url": url, "segments": rows})
    return sorted(periods, key=lambda p: p["period"])


def build() -> dict:
    periods: list[dict] = []
    for url in _report_urls():
        period = _period_from_url(url)
        try:
            pr = requests.get(url, headers=_HEADERS, timeout=90)
            if not pr.ok or b"%PDF" not in pr.content[:1024]:
                log.info("[roaster_results] %s → HTTP %s / not a PDF", url, pr.status_code)
                continue
            segments = parse_report(pr.content)
        except Exception as e:                            # noqa: BLE001
            log.warning("[roaster_results] %s failed: %s", url, e)
            continue
        if not segments:
            log.info("[roaster_results] %s → no figures parsed", url)
            continue
        log.info("[roaster_results] %s (%s) → %d segments: %s", url, period, len(segments),
                 ", ".join(f"{s['segment']}={s['volume_mix_pct']}" for s in segments))
        periods.append({"period": period or "unknown", "source_url": url, "segments": segments})

    companies = []
    if periods:
        companies.append({
            "key": "jdep",
            "name": "JDE Peet's",
            "metric_name": "Volume/mix",
            "periods": sorted(periods, key=lambda p: p["period"]),
        })
    nestle = nestle_periods()
    if nestle:
        companies.append({
            "key": "nestle",
            "name": "Nestlé",
            "metric_name": "RIG",
            "periods": nestle,
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Company results releases (PDF)",
        "note": ("JDE Peet's only. Nestle's site returns 403 to bot, browser-UA and headless-"
                 "browser requests alike from CI runners, so RIG cannot be scraped there."),
        "companies": companies,
    }


async def run(page=None, db=None) -> None:  # noqa: ARG001
    data = build()
    n = sum(len(c["periods"]) for c in data["companies"])
    if not n:
        # Deliberately loud and non-writing. The first version of this scraper
        # fell back to prose and published price as volume — Total=19.5 when
        # 19.5 was the price effect. A stale or absent file is recoverable; a
        # plausible wrong number in a demand panel is not.
        print("[roaster_results] NO PERIODS PARSED — refusing to write. "
              "Check the bridge-table locator against the current report layout.")
        return
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[roaster_results] wrote {OUT_PATH.name}: {n} period(s)")


if __name__ == "__main__":
    import asyncio
    asyncio.run(run())
