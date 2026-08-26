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
from datetime import UTC, datetime
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
    year = datetime.now(UTC).year
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
# (label, candidate slugs, publication month, year offset). Only the 3M slug is
# confirmed; the rest 404'd on the first pass, so each carries alternates and
# every miss is logged rather than swallowed.
_NESTLE_KINDS = [
    ("3M", ["three-month-sales-press-release", "three-month-sales-press-release-en",
            "q1-sales-press-release"], 4, 0),
    ("H1", ["half-year-results-press-release", "half-yearly-results-press-release",
            "half-year-report-press-release", "hy-results-press-release"], 7, 0),
    ("9M", ["nine-month-sales-press-release", "nine-months-sales-press-release",
            "q3-sales-press-release"], 10, 0),
    ("FY", ["full-year-results-press-release", "full-year-results-press-release-en",
            "fy-results-press-release", "annual-results-press-release"], 2, 1),
]
_RIG_ROW = re.compile(r"real internal growth|\bRIG\b", re.I)
_HEADER_ANCHOR = re.compile(r"total group", re.I)


def parse_nestle_summary(table: list[list]) -> list[dict]:
    """RIG per segment from the sales-performance summary.

    The header is MULTI-LINE: "Zone Americas" and "Nestlé Health Science" are
    stacked across two or three PDF rows, so no single row carries them all.
    Reading one row found only the single-line "Total Group" and silently
    dropped every segment. So the header is rebuilt column-wise by joining
    every row above the RIG line.
    """
    flat = [[_cell(c) for c in row] for row in (table or [])]
    rig_idx = next((i for i, r in enumerate(flat) if r and _RIG_ROW.search(r[0])), None)
    if rig_idx is None:
        return []
    rig = flat[rig_idx]

    width = max(len(r) for r in flat[:rig_idx + 1]) if rig_idx >= 0 else 0
    header: list[str] = []
    for col in range(width):
        parts = []
        for row in flat[:rig_idx]:
            cell = row[col] if col < len(row) else ""
            # A sales figure means we have reached the data rows, not headers.
            if cell and not re.search(r"\d[\d ,.]*$", cell):
                parts.append(cell)
        header.append(" ".join(parts).strip())
    if not any(_HEADER_ANCHOR.search(h) for h in header):
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
    now = datetime.now(UTC)
    periods: list[dict] = []
    for year in range(now.year, now.year - back_years, -1):
        for label, slugs, month, offset in _NESTLE_KINDS:
            got = False
            for slug in slugs:
                # Both the month directory and the neighbouring month, since
                # a release published late in the window lands in the next one.
                for d_month in (month, month + 1):
                    url = f"{_NESTLE_BASE}/{year + offset}-{d_month:02d}/{slug}-{year}-en.pdf"
                    try:
                        r = requests.get(url, headers=_HEADERS, timeout=60)
                    except Exception:                      # noqa: BLE001
                        continue
                    if not r.ok or b"%PDF" not in r.content[:1024]:
                        continue
                    rows = parse_nestle_report(r.content)
                    if not rows:
                        log.info("[roaster_results] nestle %s-%s: PDF at %s, no RIG table",
                                 year, label, url)
                        continue
                    periods.append({"period": f"{year}-{label}", "source_url": url,
                                    "segments": rows})
                    got = True
                    break
                if got:
                    break
            if not got:
                log.info("[roaster_results] nestle %s-%s: no PDF found (tried %d slugs)",
                         year, label, len(slugs))
    return sorted(periods, key=lambda p: p["period"])


# ── Strauss Group ────────────────────────────────────────────────────────────
# Strauss is a DIFFERENT KIND of source, and the difference matters more than
# the similarity. Nestle and JDE both publish a volume figure on a fixed
# definition every period. Strauss publishes no volume number at all — checked
# across four filings, ~360 pages, with coffee discussed on 24-31 pages each.
# What it does publish is a sentence, e.g. Q2-2026:
#
#   "The decrease in sales stems mainly from exchange-rate translation ... and
#    from a decline in selling prices in Brazil following the fall in green
#    coffee prices, partly offset by an increase in the quantities sold in most
#    countries."
#
# That is a real demand signal — volumes up while revenue fell on price and FX
# — but it is a DIRECTION, not a magnitude. It is carried here as narrative and
# rendered as narrative, never as a bar, because the moment a direction is
# plotted on a percentage axis it starts being read as a quantity.
#
# TEXT ORIENTATION. The filings are Hebrew and pdfplumber returns each line
# fully reversed — letters and word order both. Reversing the whole line
# restores readable Hebrew; storing the raw extraction would put mojibake in
# front of a reader who could otherwise check the quote against the source.
_STRAUSS_REPORTS = {
    "2026-Q2": "https://ir.strauss-group.com/wp-content/uploads/2026/08/P1762866-00.pdf",
    "2026-Q1": "https://ir.strauss-group.com/wp-content/uploads/2026/07/Q1-2026-STRS.pdf",
    "2025-FY": "https://ir.strauss-group.com/wp-content/uploads/2024/08/FY2025-report.pdf",
    "2025-Q3": "https://ir.strauss-group.com/wp-content/uploads/2024/08/Reporting_Package_Q3_2025.pdf",
}
# THE THREE RECURRING EXPLANATION CELLS.
#
# Strauss's reports carry the same three tables every period, each with an
# "Explanation" column, and the coffee-demand commentary always sits in the
# same rows. They are not extractable as tables: pdfplumber finds no
# multi-column structure in these filings at all — the ruled tables of the
# translated edition come through as plain text lines. So each is anchored on a
# phrase that identifies its row, and the sentence is read from there.
#
# Anchored rather than keyword-matched because keyword proximity kept selecting
# the wrong subject: a section cross-reference, a marketing-expense line, and a
# sentence attributing higher sales to higher prices all read as volume
# commentary until you looked at them.
_STRAUSS_ANCHORS = [
    # (topic key, human label, Hebrew anchor found in that row's explanation)
    ("group_sales", "Group sales",
     ("מגידול כמותי", "גידול כמותי", "מצמיחה כמותית", "בכמויות הנמכרות")),
    ("intl_coffee", "International Coffee — net sales",
     ("קפה בינלאומי", "הקפה הבינלאומי")),
    ("brazil", "Brazil — Três Corações",
     ("Corações", "Coracoes", "טרס קורסאוס")),
]
_HE_COFFEE = ("קפה",)
_HE_VOLUME = ("כמויות", "כמותי")
_HE_UP = ("עלייה", "עליה", "גידול", "צמיחה")
_HE_DOWN = ("ירידה", "קיטון", "צמצום")
# Verbs of attribution. An explanation cell always says something "stems
# from" / "is attributable to"; a definitions list never does.
_HE_EXPLAINS = ("נובע", "נובעת", "נבע", "נבעה", "מיוחס", "מיוחסת", "בעיקר", "כתוצאה")
_HE_PRICE_DRIVEN = ("מחירי המכירה", "עדכון מחירי", "מחירי מכירה")

# Keyed by a distinctive Hebrew FRAGMENT, never by period. Keying on the period
# would attach English to whatever sentence the extractor happened to select —
# which is how a quote ends up attributed to a company that did not say it.
# These are the Q1-2026 explanation cells from the translated edition of that
# report, not machine translation.
_STRAUSS_TRANSLATIONS = {
    # Keyed by a LONG, distinctive fragment of the sentence itself.
    #
    # The first version keyed on the period, which would have attached English
    # to whatever sentence the extractor happened to pick. The second keyed on
    # short phrases like "the International Coffee" — which appears in the
    # explanation cell, in a line about selling EXPENSES, and in a paragraph
    # about expanding into Europe in the 1990s. That would have rendered
    # "the decline in sales is attributable to exchange rates" beside a
    # sentence on 1990s history: a quote attributed to a company that did not
    # say it, in the place it was said.
    #
    # So fragments must be long enough that a false pairing is not possible.
    # A period with no match shows its Hebrew and says the translation is
    # pending — the failure mode is silence, never a wrong attribution.
    "מגידול כמותי ושיפור בתמהיל המכירות": (
        "The increase is primarily attributable to higher volume and the improved sales mix. "
        "The increase was partially offset by the negative impact of exchange rates as well as "
        "a decline in sale prices in the International Coffee segment, consistent with the "
        "decline in green coffee prices, primarily in Brazil."),
    "מירידה במחירי המכירה בעקבות הירידה במחירי הקפ": (
        "The decline in Três Corações's sales in local currency is largely due to lower sales "
        "prices following the decline in coffee prices. The Company's sales were adversely "
        "impacted by the strengthening of the Shekel against the Brazilian Real by "
        "approximately NIS 41 million."),
    "בכמויות הנמכרות במרבית": (
        "… following the fall in green coffee prices, partly offset by an increase in the "
        "quantities sold in most countries."),
    # The International Coffee net-sales explanation is NOT keyed here. The
    # extractor is not yet reliably selecting that row — it has returned the
    # selling-expenses line and a company-history paragraph — and a translation
    # is worse than useless until the sentence it belongs to is the one shown.
}


def _he(line: str) -> str:
    """Restore reversed RTL extraction to readable Hebrew.

    Reversing the whole line fixes the Hebrew — letters and word order both —
    but BREAKS anything already left-to-right: "9,340" comes back as "043,9".
    Digit runs are therefore flipped a second time, restoring them.
    """
    flipped = line[::-1].strip()
    # Digits AND Latin words were already left-to-right before the flip, so
    # both come back reversed. "9,340" arrived as "043,9" and "Três Corações"
    # as "seõçaroC sêrT" — which is why a Hebrew anchor for the Brazilian JV
    # could never match: the report writes that name in Latin script.
    flipped = re.sub(r"[\d.,%()]+", lambda m: m.group(0)[::-1], flipped)
    return re.sub(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\u2019]*", lambda m: m.group(0)[::-1], flipped)


def _is_about_quantity(text: str) -> bool:
    """True only when the passage speaks about quantities of goods.

    Guards the failure that matters most here: a sentence attributing higher
    SALES to higher PRICES reads as growth and means the opposite of a volume
    gain, which is the single most misleading thing this panel could show.
    """
    if not any(v in text for v in _HE_VOLUME):
        return False
    idx = min((text.find(v) for v in _HE_VOLUME if v in text), default=-1)
    near = text[max(0, idx - 60): idx + 60]
    return not any(pd in near for pd in _HE_PRICE_DRIVEN)


def _direction(text: str) -> str | None:
    """up / down / mixed, from how the passage describes quantities."""
    idx = min((text.find(v) for v in _HE_VOLUME if v in text), default=-1)
    if idx < 0:
        return None
    window = text[max(0, idx - 90): idx + 90]
    up = any(w in window for w in _HE_UP)
    down = any(w in window for w in _HE_DOWN)
    if up and down:
        return "mixed"
    if up:
        return "up"
    if down:
        return "down"
    return None


def _quote_at(lines: list[str], i: int, span: int = 3) -> str:
    """The anchored line plus its wrap, as one readable sentence."""
    return re.sub(r"\s+", " ", " ".join(lines[i: i + span])).strip()


def strauss_periods() -> list[dict]:
    """One entry per report, carrying up to three anchored explanation quotes."""
    try:
        import pdfplumber
    except ImportError:                                   # pragma: no cover
        return []
    out: list[dict] = []
    for period, url in _STRAUSS_REPORTS.items():
        try:
            r = requests.get(url, headers=_HEADERS, timeout=120)
        except Exception:                                 # noqa: BLE001
            continue
        if not r.ok or b"%PDF" not in r.content[:2048]:
            log.info("[roaster_results] strauss %s: not a PDF", period)
            continue

        found: dict[str, dict] = {}
        try:
            with pdfplumber.open(io.BytesIO(r.content)) as pdf:
                for page in pdf.pages:
                    raw = page.extract_text() or ""
                    if not any(c in raw for c in ("קפה", "הפק")):
                        continue
                    lines = [_he(l) for l in raw.splitlines()]
                    for key, label, anchors in _STRAUSS_ANCHORS:
                        if key in found:
                            continue
                        for i, line in enumerate(lines):
                            if not any(a in line for a in anchors):
                                continue
                            quote = _quote_at(lines, i)
                            # Must EXPLAIN, not merely name. Without this the
                            # "International Coffee" anchor matched the
                            # legal-entity glossary — Strauss Coffee B.V., São
                            # Miguel Holding, Três Corações (JV) — in every
                            # report, which reads as a hit and says nothing.
                            if len(quote) < 60 or not any(m in quote for m in _HE_EXPLAINS):
                                continue
                            english = None
                            for marker, text in _STRAUSS_TRANSLATIONS.items():
                                if marker in quote:
                                    english = text
                                    break
                            found[key] = {
                                "topic": key,
                                "label": label,
                                "quote_he": quote[:700],
                                "quote_en": english,
                                "direction": _direction(quote) if _is_about_quantity(quote) else None,
                            }
                            break
                    if len(found) == len(_STRAUSS_ANCHORS):
                        break
        except Exception as e:                            # noqa: BLE001
            log.info("[roaster_results] strauss %s parse failed: %s", period, e)
            continue

        if not found:
            log.info("[roaster_results] strauss %s: no anchored explanation found", period)
            continue
        quotes = [found[k] for k, _, _ in _STRAUSS_ANCHORS if k in found]
        # Period direction = the group-sales row's, the only one that speaks to
        # quantities outright; the other two explain price and currency.
        direction = next((q["direction"] for q in quotes if q["topic"] == "group_sales"), None)
        out.append({
            "period": period,
            "source_url": url,
            "direction": direction,
            "quotes": quotes,
        })
        log.info("[roaster_results] strauss %s → %d quote(s): %s",
                 period, len(quotes), ", ".join(q["topic"] for q in quotes))
    return sorted(out, key=lambda p: p["period"])


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

    narratives = []
    strauss = strauss_periods()
    if strauss:
        narratives.append({
            "key": "strauss",
            "name": "Strauss Group",
            "metric_name": "Volume commentary",
            "note": ("Strauss publishes no volume figure. These are their own words on "
                     "quantities sold, translated — direction only, never a magnitude."),
            "periods": strauss,
        })
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "source": "Company results releases (PDF)",
        "narratives": narratives,
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
