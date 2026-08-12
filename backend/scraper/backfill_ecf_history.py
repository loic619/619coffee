"""
backfill_ecf_history.py — one-shot historical backfill of ECF European
port-stocks from the yearly "Stocks-European-Ports" PDFs (2014 → present).

ECF publishes one PDF per year listing green-coffee stocks by European port and
month (tonnes). From 2020 onward the reports also break the figures down by
coffee type (Arabica washed/unwashed, Robusta). We parse every yearly PDF into
a single static series:

This is a self-contained ECF flow: it writes ONE file that the front-end ECF
panel reads directly (no demand_stocks.json involvement):

    frontend/public/data/ecf_history.json
    {
      "source": "ECF", "unit": "metric_tonnes", "last_updated": "YYYY-MM-DD",
      "latest_bags": ..., "latest_m_bags": ..., "source_url": "...",
      "latest_pdf": "...", "yearly_pdfs": [{"year": "2026", "pdf_url": "..."}],
      "count": <n>,
      "monthly": [
        { "period": "YYYY-MM",
          "value_mt": <total tonnes>, "value_raw": <total 60-kg bags>,
          "ports": { "Antwerp": <mt>, ... },                 # when available
          "arabica_washed_mt": ..., "arabica_unwashed_mt": ...,
          "robusta_mt": ...,                                  # flat, 2020+ only
          "source_pdf": "<url>" },
        ...
      ]
    }

This must run where ecf-coffee.org is reachable (the GitHub Actions runner or a
local machine). The Claude sandbox is blocked by a host allowlist, so it can't
download the PDFs itself — use .github/workflows/backfill-ecf-history.yml.

Usage:
    cd backend
    python -m scraper.backfill_ecf_history            # write ecf_history.json
    python -m scraper.backfill_ecf_history --debug    # also dump raw tables
"""
from __future__ import annotations

import io
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

from scraper.sources.ecf_stocks import (
    _HEADERS,
    _PDF_MONTHS_EN,
    _cell_to_mt,
    _tons_to_bags,
    _type_field,
)

ROOT     = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "frontend" / "public" / "data"
OUT_PATH = DATA_DIR / "ecf_history.json"
DEBUG_PATH = DATA_DIR / "ecf_history_debug.json"
# Certified stock files: the recent rolling snapshot + the deep-history buckets.
# The deep files extend coverage back years (robusta to 2020+, arabica to 2010+),
# so last year's months (e.g. Jan–Apr) also get a certified overlay. Arabica
# stores the port split under `by_port` (recent) or `by_port_totals` (deep);
# robusta uses `by_port_lots` in both.
ARABICA_CERT_PATHS = [DATA_DIR / "certified_stocks_arabica.json",
                      *sorted(DATA_DIR.glob("certified_stocks_arabica_deep_*.json"))]
ROBUSTA_CERT_PATHS = [DATA_DIR / "certified_stocks_robusta.json",
                      *sorted(DATA_DIR.glob("certified_stocks_robusta_deep_*.json"))]
ARABICA_PORT_KEYS = ("by_port", "by_port_totals")
ROBUSTA_PORT_KEYS = ("by_port_lots",)

# ICE certified warehouse codes that are European ports. Robusta (LIFFE) is all
# European (incl. GEN=Genoa); arabica (ICE 'C') also lists US ports
# (HOU/MIA/MIAMI/NOLA/NY/NYK/VA/VIR and NOR=New Orleans) which are excluded.
# Robusta 'NOR' is an uncertain code — also excluded, per "filter by warehouse".
# 'HA/BR' = Hamburg/Bremen (arabica reports them merged).
EUROPEAN_CERT_PORTS = {
    "AMS", "ANT", "BAR", "BRE", "FEL", "GEN", "HAM", "HA/BR", "LEH", "LIV",
    "LON", "ROT", "TRI",
}
ROBUSTA_LOT_TONNES = 10  # LIFFE robusta lot = 10 t

# One PDF per year — the FALLBACK map. ECF re-uploads the current year's PDF
# on every bi-monthly release, each time under a fresh /uploads/YYYY/MM/ path,
# so a hardcoded current-year URL silently freezes the series at whatever the
# pinned upload contained (it did: pinned at the June upload, the series stuck
# at April while newer releases went unseen). discover_yearly_pdfs() looks the
# current upload up at run time and only ever overrides an entry here with a
# STRICTLY NEWER upload, so this map remains the floor when the site is
# unreachable or the markup changes.
YEARLY_PDFS: dict[int, str] = {
    2014: "https://www.ecf-coffee.org/wp-content/uploads/2020/09/2014-Stocks-European-Ports.pdf",
    2015: "https://www.ecf-coffee.org/wp-content/uploads/2020/09/2015-Stocks-European-Ports.pdf",
    2016: "https://www.ecf-coffee.org/wp-content/uploads/2020/09/2016-Stocks-European-Ports.pdf",
    2017: "https://www.ecf-coffee.org/wp-content/uploads/2020/09/2017-Stocks-European-Ports.pdf",
    2018: "https://www.ecf-coffee.org/wp-content/uploads/2020/09/2018-Stocks-European-Ports.pdf",
    2019: "https://www.ecf-coffee.org/wp-content/uploads/2020/09/2019-Stocks-European-Ports.pdf",
    2020: "https://www.ecf-coffee.org/wp-content/uploads/2021/03/2020-Stocks-European-Ports.pdf",
    2021: "https://www.ecf-coffee.org/wp-content/uploads/2021/11/2021-Stocks-European-Ports_updated.pdf",
    2022: "https://www.ecf-coffee.org/wp-content/uploads/2023/01/2022-Stocks-European-Ports.pdf",
    2023: "https://www.ecf-coffee.org/wp-content/uploads/2024/01/2023-Stocks-European-Ports.pdf",
    2024: "https://www.ecf-coffee.org/wp-content/uploads/2025/01/2024-Stocks-European-Ports.pdf",
    2025: "https://www.ecf-coffee.org/wp-content/uploads/2026/01/2025-Stocks-European-Ports.pdf",
    2026: "https://www.ecf-coffee.org/wp-content/uploads/2026/06/2026-Stocks-European-Ports.pdf",
}

# ── Current-upload discovery ─────────────────────────────────────────────────
# A stocks PDF href carries both the DATA year (filename) and the UPLOAD date
# (/wp-content/uploads/YYYY/MM/), which is what distinguishes a re-issue.
STOCKS_PDF_RE = re.compile(
    r'https?://(?:www\.)?ecf-coffee\.org/wp-content/uploads/'
    r'(\d{4})/(\d{2})/[^"\'<>\s]*?(\d{4})-Stocks-European-Ports[^"\'<>\s]*?\.pdf',
    re.I,
)
# Listing pages that carry (or link to posts carrying) the stocks PDFs.
INDEX_PAGES = (
    "https://www.ecf-coffee.org/category/publications/stocks/",
    "https://www.ecf-coffee.org/category/whats-new/news/",
)
POST_HREF_RE = re.compile(
    r'href="(https?://(?:www\.)?ecf-coffee\.org/stocks-in-european-ports-[^/"?#]+)[^"]*"',
    re.I,
)
# How many recent stocks posts to open when hunting for the current PDF.
MAX_POSTS_SCANNED = 4


def upload_key(url: str) -> tuple[int, int]:
    """(upload_year, upload_month) from the /uploads/YYYY/MM/ path — the
    ordering that says which re-issue of a yearly PDF is the newest."""
    m = STOCKS_PDF_RE.search(url or "")
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _pdf_year(url: str) -> int | None:
    m = STOCKS_PDF_RE.search(url or "")
    return int(m.group(3)) if m else None


def _get_text(url: str, timeout: int = 30) -> str | None:
    try:
        r = requests.get(url, headers=_HEADERS, timeout=timeout)
    except Exception as e:  # noqa: BLE001
        print(f"  [discover] GET {url} failed ({type(e).__name__}: {e})")
        return None
    if r.status_code != 200:
        print(f"  [discover] GET {url} → HTTP {r.status_code}")
        return None
    return r.text


def discover_yearly_pdfs(index_pages: tuple[str, ...] = INDEX_PAGES) -> dict[int, str]:
    """{data_year → newest stocks-PDF URL} found on the listing pages and the
    most recent stocks posts they link to. Best-effort: any failure just means
    fewer discoveries, never a wrong URL."""
    html_blobs: list[str] = []
    post_urls: list[str] = []
    for page in index_pages:
        html = _get_text(page)
        if not html:
            continue
        html_blobs.append(html)
        for u in POST_HREF_RE.findall(html):
            if u not in post_urls:
                post_urls.append(u)
    for post in post_urls[:MAX_POSTS_SCANNED]:
        html = _get_text(post)
        if html:
            html_blobs.append(html)

    newest: dict[int, str] = {}
    for blob in html_blobs:
        for m in STOCKS_PDF_RE.finditer(blob):
            url, year = m.group(0), int(m.group(3))
            if upload_key(url) > upload_key(newest.get(year, "")):
                newest[year] = url
    if newest:
        print(f"  [discover] {len(newest)} yearly PDF(s) on site: "
              + ", ".join(f"{y}→{u.rsplit('/uploads/', 1)[-1]}" for y, u in sorted(newest.items())))
    else:
        print("  [discover] no stocks PDFs found — falling back to the pinned map")
    return newest


def resolve_yearly_pdfs() -> dict[int, str]:
    """The pinned map, with any year whose site copy is a NEWER upload replaced."""
    urls = dict(YEARLY_PDFS)
    try:
        found = discover_yearly_pdfs()
    except Exception as e:  # noqa: BLE001 — discovery must never break the run
        print(f"  [discover] skipped ({type(e).__name__}: {e})")
        return urls
    for year, url in found.items():
        if upload_key(url) > upload_key(urls.get(year, "")):
            old = urls.get(year, "none")
            urls[year] = url
            print(f"  [discover] {year}: using newer upload {url}\n"
                  f"             (was {old})")
    return dict(sorted(urls.items()))


_TYPE_LABELS = ("washed", "unwashed", "mild", "brazilian", "natural", "robusta", "other")

# Plausible ECF European total stock (metric tonnes) ≈ 4-16M bags. Used to drop
# mis-parsed totals from the oldest yearly PDFs.
TOTAL_MT_MIN, TOTAL_MT_MAX = 150_000, 1_050_000


def _norm(cell) -> str:
    return re.sub(r"\s+", " ", str(cell or "").strip())


def _month_in(text: str) -> int | None:
    """Return a 1-12 month number if the cell text starts with / contains a
    month name or abbreviation, else None."""
    t = _norm(text).lower()
    if not t:
        return None
    for abbr, mo in _PDF_MONTHS_EN.items():
        if t == abbr or t.startswith(abbr + " ") or t.startswith(abbr + "-") \
           or t.startswith(abbr + ".") or re.match(rf"{abbr}\b", t):
            return mo
    return None


def _classify(label: str) -> tuple[str, str]:
    """Classify a row/column label → (kind, name).
    kind ∈ {'total', 'type', 'port'}; name is the type field or port label."""
    low = _norm(label).lower()
    if not low:
        return "port", ""
    if "total" in low or "grand total" in low or low in {"sum", "europe", "all ports"}:
        return "total", "total"
    field = _type_field(low)
    if field and any(k in low for k in _TYPE_LABELS):
        return "type", field
    return "port", _norm(label)


def _ingest(period_map: dict[str, dict], period: str, kind: str,
            name: str, value: int, source_pdf: str) -> None:
    rec = period_map.setdefault(period, {"ports": {}, "types": {}, "source_pdf": source_pdf})
    if kind == "total":
        rec["total_mt"] = value
    elif kind == "type":
        rec["types"][name] = value
    elif kind == "port" and name:
        rec["ports"][name] = value


# ECF date headers look like "31-Dec-17", "29-Feb-20", "31-Jan-2026".
_DATE_RE = re.compile(r"\b\d{1,2}[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})\b")


def _date_to_period(cell: str) -> str | None:
    """'31-Dec-17' → '2017-12'; '29-Feb-2020' → '2020-02'. None if not a date."""
    m = _DATE_RE.search(_norm(cell))
    if not m:
        return None
    mo = _PDF_MONTHS_EN.get(m.group(1)[:3].lower())
    if not mo:
        return None
    y = int(m.group(2))
    if y < 100:
        y += 2000
    return f"{y}-{mo:02d}"


def _ecf_tonnes(cell) -> int | None:
    """ECF cells are whole tonnes with '.'/',' as thousands separators
    ('321.519', '346,220'). Strip separators → int. Wider band than the
    type-only helper so small ports are kept."""
    s = re.sub(r"[^\d]", "", str(cell or "").strip())
    if not s:
        return None
    n = int(s)
    return n if 1 <= n <= 2_000_000 else None


def _parse_table(table: list, default_year: int, source_pdf: str,
                 period_map: dict[str, dict]) -> int:
    """Parse one extracted table; mutate period_map. Returns cells ingested.

    Primary path = ECF's real layout: end-of-month date columns in the header
    ('31-Dec-17'…) with port/type labels down the first column. pdfplumber
    splits the wide tables with spacer columns and offsets values from their
    header cell, so we zip the *ordered* date headers with the *ordered* numeric
    cells of each row rather than matching by column index."""
    if not table or len(table) < 2:
        return 0
    header = [_norm(c) for c in table[0]]
    ingested = 0

    date_periods = [p for c in header if (p := _date_to_period(c))]
    if date_periods:
        for row in table[1:]:
            if not row:
                continue
            label = _norm(row[0])
            if not label or _date_to_period(label):
                continue
            kind, name = _classify(label)
            nums = [v for cell in row[1:] if (v := _ecf_tonnes(cell)) is not None]
            for period, val in zip(date_periods, nums):
                _ingest(period_map, period, kind, name, val, source_pdf)
                ingested += 1
        return ingested

    # Year from any header/label cell, else the file's year.
    year = default_year
    for cell in header:
        m = re.search(r"(20\d{2})", cell)
        if m:
            year = int(m.group(1))
            break

    # Orientation A: months across the header row, labels down the first column.
    month_cols = {ci: mo for ci, h in enumerate(header) if (mo := _month_in(h))}
    if month_cols:
        for row in table[1:]:
            if not row:
                continue
            label = _norm(row[0])
            ym = re.search(r"(20\d{2})", label)
            row_year = int(ym.group(1)) if ym else year
            kind, name = _classify(label)
            for ci, mo in month_cols.items():
                if ci < len(row):
                    val = _cell_to_mt(_norm(row[ci]))
                    if val:
                        _ingest(period_map, f"{row_year}-{mo:02d}", kind, name, val, source_pdf)
                        ingested += 1
        if ingested:
            return ingested

    # Orientation B: labels across the header, month/period down the first column.
    label_cols = {ci: _classify(h) for ci, h in enumerate(header) if ci > 0 and _norm(h)}
    for row in table[1:]:
        if not row:
            continue
        first = _norm(row[0])
        mo = _month_in(first)
        if mo is None:
            continue
        ym = re.search(r"(20\d{2})", first)
        row_year = int(ym.group(1)) if ym else year
        period = f"{row_year}-{mo:02d}"
        for ci, (kind, name) in label_cols.items():
            if ci < len(row):
                val = _cell_to_mt(_norm(row[ci]))
                if val:
                    _ingest(period_map, period, kind, name, val, source_pdf)
                    ingested += 1
    return ingested


def _debug_pdf(pdf_bytes: bytes, year: int) -> dict:
    """Print what pdfplumber actually sees in a PDF (text/table presence) so we
    can tell a layout mismatch from an image-only/infographic PDF."""
    import pdfplumber
    info: dict = {"year": year, "pages": 0, "tables": 0, "text_chars": 0,
                  "samples": []}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        info["pages"] = len(pdf.pages)
        for pno, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            info["text_chars"] += len(text)
            tables = page.extract_tables() or []
            info["tables"] += len(tables)
            for t in tables[:2]:
                info["samples"].append({
                    "page": pno,
                    "dims": f"{len(t)}x{max((len(r) for r in t), default=0)}",
                    "head": [[(str(c)[:16] if c is not None else None)
                              for c in row[:8]] for row in t[:3]],
                })
            if pno == 1 and text:
                info["page1_text"] = text[:400]
    print(f"  [debug] {year}: pages={info['pages']} tables={info['tables']} "
          f"text_chars={info['text_chars']}")
    if info.get("page1_text"):
        preview = info["page1_text"].replace("\n", " | ")[:240]
        print(f"    page1 text: {preview}")
    for s in info["samples"][:4]:
        print(f"    p{s['page']} {s['dims']} head={s['head']}")
    return info


def _parse_pdf(pdf_bytes: bytes, year: int, source_pdf: str,
               debug: dict) -> dict[str, dict]:
    import pdfplumber
    period_map: dict[str, dict] = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            for table in (page.extract_tables() or []):
                n = _parse_table(table, year, source_pdf, period_map)
                if n:
                    debug.setdefault(f"{year}:parsed", []).append(
                        {"page": pno, "cells": n, "sample": table[:4]}
                    )
    return period_map


def _finalise(period_map: dict[str, dict]) -> list[dict]:
    """Turn the raw period map into the output schema: compute total (explicit
    or summed from ports), bags, and drop empty breakdown dicts."""
    out: list[dict] = []
    for period in sorted(period_map):
        rec = period_map[period]
        ports = {k: v for k, v in rec.get("ports", {}).items()}
        types = {k: v for k, v in rec.get("types", {}).items()}
        total = rec.get("total_mt")
        if total is None and ports:
            total = sum(ports.values())
        if total is None and types:           # 2020+ type-only periods
            total = sum(types.values())
        entry: dict = {"period": period, "source_pdf": rec.get("source_pdf")}
        # Sanity band for a European total (≈4-16M bags). Drops mis-parses from
        # the oldest PDFs (e.g. 874 t, or 1.09M t) so they can't distort the
        # chart; any valid port/type breakdown for the period is still kept.
        if total is not None and TOTAL_MT_MIN <= int(total) <= TOTAL_MT_MAX:
            entry["value_mt"] = int(total)
            entry["value_raw"] = _tons_to_bags(int(total))
        if ports:
            entry["ports"] = ports
        # Type fields are emitted FLAT (arabica_washed_mt/arabica_unwashed_mt/
        # robusta_mt/…) — that's the shape StocksPanel reads for the breakdown.
        entry.update(types)
        out.append(entry)
    return out


def _month_end(period: str) -> str:
    """'2026-04' → '2026-04-30' (ISO), for aligning daily certified snapshots."""
    y, m = (int(x) for x in period.split("-"))
    nxt = date(y + (m // 12), (m % 12) + 1, 1)
    return (nxt - timedelta(days=1)).isoformat()


def _european_sum(by_port: dict, scale: float) -> int:
    """Sum European-port values and scale to metric tonnes."""
    return int(round(sum(v for code, v in (by_port or {}).items()
                         if code.strip().upper() in EUROPEAN_CERT_PORTS
                         and isinstance(v, (int, float))) * scale))


def _cert_series(paths: list[Path], port_keys: tuple[str, ...],
                 scale: float) -> list[tuple[str, int]]:
    """Merge the recent + deep-history certified files into a sorted
    [(date, european_mt)] series. Each snapshot's port split is read from the
    first present key in `port_keys` (recent vs deep files name it differently).
    Dedup by date (later file wins). Empty/absent files degrade gracefully."""
    by_date: dict[str, int] = {}
    for path in paths:
        if not path.exists():
            continue
        try:
            snaps = json.loads(path.read_text(encoding="utf-8")).get("snapshots", [])
        except Exception as e:
            print(f"  [cert] {path.name} unreadable ({e})")
            continue
        n = 0
        for s in snaps:
            d = s.get("date")
            if not d:
                continue
            ports = next((s[k] for k in port_keys if isinstance(s.get(k), dict)), None)
            if ports is None:
                continue
            by_date[d] = _european_sum(ports, scale)
            n += 1
        print(f"  [cert] {path.name}: {n} snapshots")
    return sorted(by_date.items())


def _cert_at(series: list[tuple[str, int]], month_end: str,
             max_gap_days: int = 45) -> int | None:
    """Latest certified value on/before month_end, if within max_gap_days."""
    pick = None
    for d, v in series:
        if d <= month_end:
            pick = (d, v)
        else:
            break
    if not pick:
        return None
    gap = (date.fromisoformat(month_end) - date.fromisoformat(pick[0])).days
    return pick[1] if gap <= max_gap_days else None


def _merge_certified(monthly: list[dict]) -> int:
    """Add cert_eu_robusta_mt / cert_eu_arabica_mt (ICE certified at European
    ports, by type) to each ECF month where a near-date snapshot exists.
    Returns the number of months enriched."""
    arabica = _cert_series(ARABICA_CERT_PATHS, ARABICA_PORT_KEYS, 0.06)   # bags → t
    robusta = _cert_series(ROBUSTA_CERT_PATHS, ROBUSTA_PORT_KEYS, ROBUSTA_LOT_TONNES)
    if not arabica and not robusta:
        return 0
    n = 0
    for e in monthly:
        me = _month_end(e["period"])
        ra = _cert_at(robusta, me)
        aa = _cert_at(arabica, me)
        if ra is not None:
            e["cert_eu_robusta_mt"] = ra
        if aa is not None:
            e["cert_eu_arabica_mt"] = aa
        if ra is not None or aa is not None:
            n += 1
    return n


def _build_payload(monthly: list[dict]) -> dict:
    """Assemble the self-contained ECF file that the front-end reads directly:
    historic series + the headline metadata the panel needs."""
    latest = next((e for e in reversed(monthly) if e.get("value_raw")),
                  monthly[-1] if monthly else {})
    bags = latest.get("value_raw")
    return {
        "source": "ECF",
        "unit": "metric_tonnes",
        "last_updated": date.today().isoformat(),
        "latest_bags": bags,
        "latest_m_bags": round(bags / 1_000_000, 2) if bags else None,
        "source_url": "https://www.ecf-coffee.org/category/publications/stocks/",
        "latest_pdf": latest.get("source_pdf"),
        # {year, pdf_url} list — matches the front-end EcfData.yearly_pdfs shape.
        "yearly_pdfs": [{"year": str(y), "pdf_url": u}
                        for y, u in sorted(YEARLY_PDFS.items(), reverse=True)],
        "count": len(monthly),
        "monthly": monthly,
    }


def main(debug: bool = False) -> None:
    period_map: dict[str, dict] = {}
    debug_tables: dict = {}
    failures: list[int] = []

    for year, url in resolve_yearly_pdfs().items():
        try:
            r = requests.get(url, headers=_HEADERS, timeout=60)
            if r.status_code != 200 or len(r.content) < 5_000:
                print(f"  {year}: download failed (HTTP {r.status_code}, "
                      f"{len(r.content)} bytes)", file=sys.stderr)
                failures.append(year)
                continue
        except Exception as e:
            print(f"  {year}: ERROR — {e}", file=sys.stderr)
            failures.append(year)
            continue
        if debug:
            try:
                debug_tables[str(year)] = _debug_pdf(r.content, year)
            except Exception as e:
                print(f"  [debug] {year}: introspection error — {e}", file=sys.stderr)
        parsed = _parse_pdf(r.content, year, url, debug_tables)
        for period, rec in parsed.items():
            dst = period_map.setdefault(period, {"ports": {}, "types": {}, "source_pdf": rec["source_pdf"]})
            dst["ports"].update(rec.get("ports", {}))
            dst["types"].update(rec.get("types", {}))
            if "total_mt" in rec:
                dst["total_mt"] = rec["total_mt"]
        print(f"  {year}: {len(parsed)} periods parsed "
              f"(running total {len(period_map)})")

    monthly = _finalise(period_map)
    if not monthly:
        print("ERROR: parsed zero periods — not writing ecf_history.json",
              file=sys.stderr)
        sys.exit(1)
    n_cert = _merge_certified(monthly)
    print(f"  certified-European overlay added to {n_cert} month(s)")
    payload = _build_payload(monthly)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=False)
        f.write("\n")
    print(f"\nWrote {len(monthly)} periods → {OUT_PATH}")
    print(f"  range: {monthly[0]['period']} … {monthly[-1]['period']}")
    print(f"  with ports: {sum('ports' in m for m in monthly)}, "
          f"with types: {sum('robusta_mt' in m for m in monthly)}")
    print(f"  latest: {payload['latest_m_bags']}M bags ({payload['last_updated']})")
    if failures:
        print(f"  WARNING: {len(failures)} PDF(s) failed: {failures}")

    if debug:
        with open(DEBUG_PATH, "w", encoding="utf-8") as f:
            json.dump(debug_tables, f, indent=2, default=str)
        print(f"  debug tables → {DEBUG_PATH}")


if __name__ == "__main__":
    main(debug="--debug" in sys.argv)
