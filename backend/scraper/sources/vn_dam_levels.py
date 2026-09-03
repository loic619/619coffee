"""
Vietnam Water Flow Tracker — Coffee Region Focus
Source: NCHMF (nchmf.gov.vn) "Bản tin dự báo nguồn nước thời hạn ngắn"
PDF URL pattern (two upload roots have been seen — the archive moved from
thuyvan1 to thuyvan2 during 2026, so both are tried):
    kttv.gov.vn/upload/thuyvan{1,2}/{YYYY}/{M}/{D}/dbqg_nnhn_{YYYYMMDD}_1500.pdf

Key rivers for coffee (Central Highlands):
  - ĐắkBla at Kon Tum → Gia Lai / Kon Tum
  - Srêpôk at Giang Sơn → Đắk Lắk (main coffee province)
  - Đồng Nai tributary → Đắk Nông, Lâm Đồng

Signal: % vs TBNN (Trung bình nhiều năm = multi-year historical average)
  > +20%  → surplus (good)
  -20% to +20% → normal
  < -20%  → deficit (drought risk for irrigation)
  < -50%  → severe deficit

History
=======
The JSON carries a `history` list — one entry per bulletin, keyed on the
bulletin's own date (read from the PDF file name, never from the clock: the
listing-page fallback used to stamp a 22 Aug bulletin as 2 Sep). The daily
build upserts the latest bulletin; `backfill(start, end)` walks the archive by
date and fills every bulletin it finds, so the series can be rebuilt back to
whatever kttv.gov.vn still serves. The panel draws tbnn_pct per river over
time from it.
"""

from __future__ import annotations

import io
import json
import logging
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

from scraper.validate_export import safe_write_json

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
}

NCHMF_BASE = "https://nchmf.gov.vn/kttv/vi-VN/1/nguon-nuoc-21-18.html"
# Newest root first: the 2026-08-22 bulletin the listing page pointed at lived
# under thuyvan2 while the code still guessed thuyvan1 — every date guess
# missed and the fallback took over, which is how the date bug got in.
KTTV_PDF_BASES = (
    "https://kttv.gov.vn/upload/thuyvan2",
    "https://kttv.gov.vn/upload/thuyvan1",
)

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "vn_water_levels.json"

# Rivers of interest and their coffee province mapping
COFFEE_RIVERS = {
    "Srêpôk":  {"label": "Srepok",    "provinces": ["Dak Lak"],           "station": "Giang Sơn"},
    "Srépôk":  {"label": "Srepok",    "provinces": ["Dak Lak"],           "station": "Giang Sơn"},
    "Srepok":  {"label": "Srepok",    "provinces": ["Dak Lak"],           "station": "Giang Sơn"},
    "ĐăkBla":  {"label": "Dak Bla",   "provinces": ["Gia Lai", "Kon Tum"], "station": "Kon Tum"},
    "Đăk Bla": {"label": "Dak Bla",   "provinces": ["Gia Lai", "Kon Tum"], "station": "Kon Tum"},
    "Đồng Trăng": {"label": "Dong Nai", "provinces": ["Dak Nong", "Lam Dong"], "station": "Cái N,T"},
}

_PDF_DATE_RE = re.compile(r"dbqg_nnhn_(\d{4})(\d{2})(\d{2})")


# ── PDF URL resolution ─────────────────────────────────────────────────────────

def pdf_url_candidates(d: date) -> list[str]:
    """Every URL a bulletin dated `d` could live at, newest archive root first."""
    return [f"{base}/{d.year}/{d.month}/{d.day}/dbqg_nnhn_{d.strftime('%Y%m%d')}_1500.pdf"
            for base in KTTV_PDF_BASES]


def _pdf_url_for_date(d: date) -> str:
    return pdf_url_candidates(d)[0]


def date_from_pdf_url(url: str) -> date | None:
    """The bulletin's own date, from its file name."""
    m = _PDF_DATE_RE.search(url or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _head_ok(url: str, timeout: int = 10) -> bool:
    try:
        r = requests.head(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        return r.status_code == 200
    except Exception:
        return False


def _find_latest_pdf_url(lookback_days: int = 14) -> tuple[str, date] | tuple[None, None]:
    """
    Try today and up to `lookback_days` back, both archive roots, to find the
    most recent available PDF. Falls back to scraping the bulletin listing page
    for the link — dated from the file name it finds, not from the clock.
    """
    for delta in range(lookback_days + 1):
        d = date.today() - timedelta(days=delta)
        for url in pdf_url_candidates(d):
            if _head_ok(url):
                log.info("Found PDF for %s: %s", d, url)
                return url, d

    try:
        from bs4 import BeautifulSoup
        r = requests.get(NCHMF_BASE, headers=HEADERS, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.content, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            txt  = a.get_text()
            if "nguon-nuoc-thoi-han-ngan" in href or "NGUỒN NƯỚC THỜI HẠN NGẮN" in txt.upper():
                article_url = href if href.startswith("http") else f"https://nchmf.gov.vn{href}"
                r2 = requests.get(article_url, headers=HEADERS, timeout=15)
                soup2 = BeautifulSoup(r2.content, "html.parser")
                for a2 in soup2.find_all("a", href=True):
                    h = a2.get("href", "")
                    if h.endswith(".pdf") and "dbqg_nnhn" in h:
                        return h, (date_from_pdf_url(h) or date.today())
    except Exception as e:
        log.error("Fallback scrape failed: %s", e)

    return None, None


# ── PDF parsing ────────────────────────────────────────────────────────────────

def _parse_tbnn_pct(cell: str) -> float | None:
    """Extract % vs TBNN from cells like '< 68' or '> 34' or '~ TBNN'."""
    cell = (cell or "").strip()
    if "~" in cell or "tbnn" in cell.lower():
        return 0.0
    m = re.search(r"([<>])\s*(\d+(?:[.,]\d+)?)", cell)
    if m:
        sign = -1 if m.group(1) == "<" else 1
        return sign * float(m.group(2).replace(",", "."))
    # Try bare number from "So sanh TBNN (%)" column
    m2 = re.search(r"([+-]?\d+(?:[.,]\d+)?)", cell)
    if m2:
        return float(m2.group(1).replace(",", "."))
    return None


def _extract_flow_table(pdf) -> list[dict]:
    """
    Parse "Bảng 1.2: Tổng lượng nước" (flow volume table) from appendix pages.
    Columns: Sông | Trạm | Thực đo 7 ngày | So sánh TBNN (%) | forecast days | Tổng | So sánh TBNN (%)
    Returns list of {river, station, actual_mm3, tbnn_pct, forecast_total_mm3, forecast_tbnn_pct}
    """
    results = []
    in_table = False

    for page in pdf.pages:
        text = page.extract_text() or ""
        if "Bảng 1.2" in text or "Tổng lượng nước" in text:
            in_table = True

        if not in_table:
            continue

        rows = page.extract_table() or []
        if not rows:
            # Parse from text as fallback using line patterns
            lines = text.split("\n")
            for line in lines:
                # Pattern: "River Station  actual_value  </>  NN  ...  total  </>  NN"
                # e.g. "ĐăkBla KonTum 6,17 < 68  1  0,84 ..."
                # Skip header lines
                if any(k in line for k in ["Sông", "Trạm", "Dự báo", "Đơn vị", "Bảng"]):
                    continue
                parts = line.split()
                if len(parts) < 4:
                    continue
                # Check if first few tokens match a known river name pattern
                for river_key in COFFEE_RIVERS:
                    if river_key in line:
                        # Extract numbers from line
                        nums = re.findall(r"\d+(?:[,\.]\d+)?", line)
                        actual = float(nums[0].replace(",", ".")) if nums else None
                        # Find the < or > before a number
                        pct_match = re.search(r"([<>])\s*(\d+)", line)
                        tbnn_pct = None
                        if pct_match:
                            tbnn_pct = (-1 if pct_match.group(1) == "<" else 1) * float(pct_match.group(2))
                        results.append({
                            "river":           COFFEE_RIVERS[river_key]["label"],
                            "river_vn":        river_key,
                            "provinces":       COFFEE_RIVERS[river_key]["provinces"],
                            "station":         COFFEE_RIVERS[river_key]["station"],
                            "actual_mm3":      actual,
                            "tbnn_pct":        tbnn_pct,
                        })
                        break
            continue

        # Table parsing
        for row in rows:
            if not row or not any(row):
                continue
            cells = [str(c or "").strip() for c in row]
            line  = " ".join(cells)
            for river_key in COFFEE_RIVERS:
                if river_key in line:
                    # Cells: river | station | actual | tbnn_pct | day1..day9 | total | forecast_tbnn_pct
                    actual_str  = cells[2] if len(cells) > 2 else ""
                    tbnn1_str   = cells[3] if len(cells) > 3 else ""
                    tbnn2_str   = cells[-1] if len(cells) > 1 else ""
                    try:
                        actual = float(actual_str.replace(",", ".").replace(" ", ""))
                    except (ValueError, AttributeError):
                        actual = None
                    results.append({
                        "river":           COFFEE_RIVERS[river_key]["label"],
                        "river_vn":        river_key,
                        "provinces":       COFFEE_RIVERS[river_key]["provinces"],
                        "station":         COFFEE_RIVERS[river_key]["station"],
                        "actual_mm3":      actual,
                        "tbnn_pct":        _parse_tbnn_pct(tbnn1_str),
                        "forecast_tbnn_pct": _parse_tbnn_pct(tbnn2_str),
                    })
                    break

    return results


def _extract_narrative_signals(pdf) -> dict[str, str]:
    """
    Parse narrative text pages for qualitative signals per river basin.
    Returns {river_label: signal} where signal is "low|normal|high|critical".
    """
    signals: dict[str, str] = {}
    full_text = ""
    for page in pdf.pages[:5]:
        full_text += (page.extract_text() or "") + "\n"

    # Srepok section
    srepok_match = re.search(
        r"Srê[pP]ôk[^\n]*?\n(.{0,500})",
        full_text, re.DOTALL
    )
    if srepok_match:
        chunk = srepok_match.group(1)
        if "thấp hơn" in chunk and re.search(r"thấp hơn.*?(\d+)%", chunk):
            pct = int(re.search(r"thấp hơn.*?(\d+)%", chunk).group(1))
            signals["Srepok"] = "low" if pct < 30 else "slightly_low"
        elif "cao hơn" in chunk:
            signals["Srepok"] = "high"
        else:
            signals["Srepok"] = "normal"

    return signals


def _signal_from_pct(pct: float | None) -> str:
    if pct is None:
        return "unknown"
    if pct <= -50:
        return "critical"
    if pct <= -20:
        return "low"
    if pct <= 20:
        return "normal"
    return "high"


def parse_bulletin(pdf_bytes: bytes) -> list[dict]:
    """The coffee-basin rows of one bulletin, each with its signal."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        rivers = _extract_flow_table(pdf)
        narrative = _extract_narrative_signals(pdf)
    for rv in rivers:
        rv["signal"] = _signal_from_pct(rv.get("tbnn_pct"))
        if rv["signal"] == "unknown" and rv["river"] in narrative:
            rv["signal"] = narrative[rv["river"]]
    return rivers


# ── History ────────────────────────────────────────────────────────────────────

def history_entry(bulletin_date: date, rivers: list[dict], pdf_url: str | None = None) -> dict:
    """One bulletin, reduced to what the time series needs."""
    return {
        "date": bulletin_date.isoformat(),
        "pdf_url": pdf_url,
        "rivers": [{
            "river": rv["river"], "station": rv["station"],
            "actual_mm3": rv.get("actual_mm3"),
            "tbnn_pct": rv.get("tbnn_pct"),
            "forecast_tbnn_pct": rv.get("forecast_tbnn_pct"),
        } for rv in rivers],
    }


def upsert_history(history: list[dict], entry: dict) -> list[dict]:
    by_date = {e["date"]: e for e in history}
    by_date[entry["date"]] = entry
    return sorted(by_date.values(), key=lambda e: e["date"])


def _load_existing() -> dict:
    try:
        return json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


# ── Static fallback ────────────────────────────────────────────────────────────

STATIC_SEED: dict[str, Any] = {
    "note": "Static seed — updated when NCHMF PDF fetch succeeds",
    "rivers": [
        {"river": "Srepok",   "river_vn": "Srêpôk", "provinces": ["Dak Lak"],
         "station": "Giang Son", "tbnn_pct": -8,  "signal": "normal"},
        {"river": "Dak Bla",  "river_vn": "ĐăkBla", "provinces": ["Gia Lai", "Kon Tum"],
         "station": "Kon Tum",  "tbnn_pct": -68, "signal": "critical"},
        {"river": "Dong Nai", "river_vn": "Đồng Trăng", "provinces": ["Dak Nong", "Lam Dong"],
         "station": "Cai N,T",  "tbnn_pct": 34,  "signal": "high"},
    ],
}


# ── Main build ─────────────────────────────────────────────────────────────────

def build_vn_water_levels(db=None) -> dict:
    now = datetime.utcnow()
    existing = _load_existing()
    history: list[dict] = existing.get("history") or []
    out: dict[str, Any] = {
        "updated":    now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":     "NCHMF – Bản tin dự báo nguồn nước thời hạn ngắn",
        "source_url": "https://nchmf.gov.vn/kttv/vi-VN/1/nguon-nuoc-21-18.html",
        "rivers":     [],
        "bulletin_date": None,
        "has_live_data": False,
        "history":    history,
    }

    def _write_seed(reason: str) -> dict:
        log.warning("%s — returning static seed", reason)
        out["note"] = STATIC_SEED["note"]
        out["rivers"] = STATIC_SEED["rivers"]
        # Keep the newest bulletin on file rather than pretending there is none.
        if history:
            last = history[-1]
            out["rivers"] = [{**rv, "river_vn": rv["river"], "provinces": [],
                              "signal": _signal_from_pct(rv.get("tbnn_pct"))} for rv in last["rivers"]]
            out["bulletin_date"] = last["date"]
            out["pdf_url"] = last.get("pdf_url")
            out["has_live_data"] = True
            out["note"] = f"{reason}; showing the last bulletin on file ({last['date']})"
        safe_write_json(OUT_PATH, out, ensure_ascii=False)
        return out

    if not HAS_PDFPLUMBER:
        return _write_seed("pdfplumber not installed")

    pdf_url, bulletin_date = _find_latest_pdf_url()
    if not pdf_url:
        return _write_seed("Could not find NCHMF PDF")

    out["pdf_url"] = pdf_url
    out["bulletin_date"] = bulletin_date.isoformat() if bulletin_date else None

    try:
        r = requests.get(pdf_url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        rivers = parse_bulletin(r.content)
        if rivers:
            out["rivers"] = rivers
            out["has_live_data"] = True
            if bulletin_date:
                out["history"] = upsert_history(history, history_entry(bulletin_date, rivers, pdf_url))
            log.info("vn_water_levels: extracted %d rivers from PDF", len(rivers))
        else:
            return _write_seed("PDF parsed but no coffee rivers found")
    except Exception as e:
        return _write_seed(f"PDF fetch/parse failed: {e}")

    safe_write_json(OUT_PATH, out, ensure_ascii=False)
    log.info("vn_water_levels.json written (%d bytes)", OUT_PATH.stat().st_size)
    return out


def backfill(start: str, end: str | None = None, delay: float = 0.3) -> dict:
    """Walk the archive by date over [start, end] and fill every bulletin found.

    Dates already in the history are skipped, so a re-run only costs the HEAD
    requests. Nothing on file is ever overwritten. Returns a summary."""
    if not HAS_PDFPLUMBER:
        raise RuntimeError("pdfplumber is required for the backfill")
    end_d = date.fromisoformat(end) if end else date.today()
    existing = _load_existing()
    history: list[dict] = existing.get("history") or []
    have = {e["date"] for e in history}
    d = date.fromisoformat(start)
    found = parsed = empty = 0
    while d <= end_d:
        if d.isoformat() not in have:
            for url in pdf_url_candidates(d):
                if not _head_ok(url):
                    continue
                found += 1
                try:
                    r = requests.get(url, headers=HEADERS, timeout=30)
                    r.raise_for_status()
                    rivers = parse_bulletin(r.content)
                except Exception as e:  # noqa: BLE001
                    print(f"    {d}: {type(e).__name__}: {str(e)[:80]}")
                    break
                if rivers:
                    history = upsert_history(history, history_entry(d, rivers, url))
                    parsed += 1
                    print(f"    {d}: " + ", ".join(
                        f"{rv['river']} {rv.get('tbnn_pct'):+.0f}%" if rv.get("tbnn_pct") is not None
                        else f"{rv['river']} ?" for rv in rivers))
                else:
                    empty += 1
                    print(f"    {d}: bulletin found, no coffee rivers parsed")
                break
            time.sleep(delay)
        d += timedelta(days=1)

    existing["history"] = history
    existing.setdefault("source", "NCHMF – Bản tin dự báo nguồn nước thời hạn ngắn")
    existing.setdefault("rivers", [])
    existing["updated"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    safe_write_json(OUT_PATH, existing, ensure_ascii=False)
    summary = {"found": found, "parsed": parsed, "empty": empty, "history": len(history),
               "span": [history[0]["date"], history[-1]["date"]] if history else None}
    print(f"[backfill] {summary}")
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) > 1 and sys.argv[1] == "backfill":
        backfill(sys.argv[2] if len(sys.argv) > 2 else "2025-01-01",
                 sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        result = build_vn_water_levels()
        print(f"Rivers found: {len(result['rivers'])}")
        for r in result["rivers"]:
            pct = r.get("tbnn_pct")
            pct_str = f"{pct:+.0f}%" if pct is not None else "n/a"
            print(f"  {r['river']:12} | {r['station']:12} | vs TBNN: {pct_str:8} | {r.get('signal','?')}")
        print(f"Live data: {result['has_live_data']} · history {len(result.get('history', []))} bulletins")
