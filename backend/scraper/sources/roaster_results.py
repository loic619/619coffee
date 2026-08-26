"""roaster_results.py — volume growth from roaster results releases.

WHY NOT THE TICKER FEED. fetch_earnings.py already pulls prices and revenue.
Revenue is not a demand signal: when green doubles, a roaster's sales can rise
while the cups it sells fall. The half that says something about consumption is
volume — and it exists only in the results releases, on each company's own
fixed definition:

    JDE Peet's   volume/mix vs price, split per segment
    Nestle       RIG (Real Internal Growth), same idea, different house style

WHAT THIS COVERS. JDE Peet's only, for now. Nestle's site returns HTTP 403 to a
plain bot user-agent, to a full browser user-agent, and to a real headless
Chromium driving a browser user-agent — all three measured from a GitHub
runner. Their protection rejects datacentre traffic outright, so no scraper
that runs in CI reaches them. Nestle RIG needs another route entirely, which is
recorded in docs/TODO.md rather than half-built here.

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


def parse_sentence(sentence: str) -> tuple[float | None, float | None]:
    """(organic %, volume/mix %) from one results sentence.

    Returns None for volume/mix when the sentence names it without a figure —
    "very resilient volume/mix" is a claim, not a number, and inventing one
    would defeat the point of tracking the metric at all.
    """
    organic = None
    om = _ORGANIC.search(sentence)
    if om:
        organic = float(om.group(1))

    vol: float | None = None
    best: int | None = None
    for nm in _NUM.finditer(sentence):
        if om and nm.start() == om.start(1):
            continue                                   # that's the organic figure
        value = float(nm.group(1))
        candidates = [(abs(nm.start() - v.start()), "vol") for v in _VOL.finditer(sentence)]
        candidates += [(abs(nm.start() - p.start()), "price") for p in _PRICE.finditer(sentence)]
        if not candidates:
            continue
        distance, which = min(candidates)
        if which != "vol":
            continue
        # An unsigned number after "a decrease in" is negative.
        if value > 0 and _DECREASE.search(sentence[max(0, nm.start() - 60):nm.start()]):
            value = -value
        if best is None or distance < best:
            best, vol = distance, value
    return organic, vol


def _segment_for(text: str, position: int) -> str:
    """Nearest preceding segment name, or 'Group' for the headline figure."""
    window = text[max(0, position - 400):position]
    hits = [(window.rfind(s), s) for s in _SEGMENTS if window.rfind(s) >= 0]
    if not hits:
        return "Group"
    return max(hits)[1].replace("’", "'")


def parse_report(pdf_bytes: bytes) -> list[dict]:
    """Every (segment, organic, volume/mix) triple a results PDF carries."""
    try:
        import pdfplumber
    except ImportError:                                   # pragma: no cover
        log.error("[roaster_results] pdfplumber missing")
        return []

    rows: list[dict] = []
    seen: set[str] = set()
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages[:12]:                       # figures live at the front
            text = (page.extract_text() or "").replace("\n", " ")
            for m in re.finditer(r"Organic sales[^.]*?\.", text):
                sentence = m.group(0)
                if not _VOL.search(sentence):
                    continue
                organic, vol = parse_sentence(sentence)
                if organic is None and vol is None:
                    continue
                segment = _segment_for(text, m.start())
                key = f"{segment}|{organic}|{vol}"
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "segment": segment,
                    "volume_mix_pct": vol,
                    "organic_pct": organic,
                })
    return rows


def _report_urls() -> list[str]:
    try:
        r = requests.get(_IR_INDEX, headers=_HEADERS, timeout=45)
        r.raise_for_status()
    except Exception as e:                                # noqa: BLE001
        log.warning("[roaster_results] IR index fetch failed: %s", e)
        return []
    hrefs = re.findall(r'href="([^"]+\.pdf[^"]*)"', r.text, re.I)
    out = []
    for h in hrefs:
        if not re.search(r"result", h, re.I):
            continue
        out.append(h if h.startswith("http") else requests.compat.urljoin(_IR_INDEX, h))
    return sorted(set(out))


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
        print("[roaster_results] no periods parsed — leaving existing file untouched")
        return
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[roaster_results] wrote {OUT_PATH.name}: {n} period(s)")


if __name__ == "__main__":
    import asyncio
    asyncio.run(run())
