"""research_vn_midmonth.py — is Vietnam's mid-month customs bulletin half a month?

Vietnam Customs publishes a first-half ("kỳ 1", k1) export bulletin covering
days 1-15, alongside the monthly series the app already scrapes:

    first half   2026-T8K1-1X(TA-SB).pdf   report type 1X  ← what this reads
    full month   2026-t8k2-2x(vn-sb).pdf   report type 2x  ← already scraped

The two are DIFFERENT TABLES, not two editions of one. `1X` is *biểu 1* (table
one) of the fortnight release — the alternate filename `ta_bieu1_ky-xk.pdf`
spells it out: biểu 1, kỳ (period), xk = xuất khẩu, exports. Searching for `2x`
filenames with a k1 marker, as this module first did, looks for a file that
does not exist, which is why it once ran for two hours and found nothing.

`TA` is the English edition and `VN` the Vietnamese one; both are tried, and
the coffee row is matched in either language here rather than by changing the
full-month parser, which works and is left alone.

The trade reads the k1 number early and wants to annualise it — the standing
assumption being "double it and you have the month". This script measures
whether that assumption holds, rather than repeating it.

    ratio = k1 period quantity / full-month period quantity

If the flow were uniform across the month, ratio would sit near 15/30 = 0.50.
It very likely does not: shipping clusters, and the second half of a month
carries month-end vessel departures. The point of the script is to put a
number and a dispersion on it — a mean ratio is only useful if it is STABLE,
so the report leads on spread and on how often doubling would have misled you
by more than a stated tolerance.

Where the k1 bulletins come from: predicted directly on files.customs.gov.vn,
under /CustomsCMS/TONG_CUC/{year}/{month}/{day}/. Every confirmed bulletin was
published INSIDE its own data month, between the 17th and the 20th, so the
search is small and lands early — see `_PUB_DAYS` and `k1_stems`, both derived
from real URLs rather than guessed at.

One month in six is posted under `ta_bieu1_ky-xk.pdf`, which carries no date at
all and is findable only by the directory holding it. That form is in the
candidate list, and `stem_signature` deliberately returns None for it: there is
no convention in it worth learning.

This does NOT touch the full-month path. That scraper works, keeps its own
Vietnamese-only parser, and is left exactly as it is.

Network note: the portal and files.customs.gov.vn must be reachable. Some
sandboxed environments deny them by network policy; the production scraper
reaches them fine, which is where this is meant to run.

    python -m backend.scraper.research_vn_midmonth --months 24
"""
from __future__ import annotations

import argparse
import io
import json
import re
import statistics
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from backend.scraper.sources.vn_coffee_export import (  # noqa: E402
    _CACHE_PATH,
    _FILES_HOST,
    _PORTAL_URL,
    _download_pdf,
    _fetch_publication_list,
    _is_2x,
    _parse_vn_number,
    _period_marker,
    _period_to_month,
    _strip_accents,
    _try_download_pdf,
)

REPORT_PATH = _HERE.parents[2] / "data" / "vn_midmonth_ratio.json"

# Doubling the mid-month number is the actual trading use. A miss of more than
# this against the eventual full month is what we count as "would have misled".
TOLERANCE = 0.10


def shift(year: int, month: int, by: int) -> tuple[int, int]:
    m = month + by
    y = year
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return y, m


# Publication days observed on real first-half bulletins: 17, 17, 18, 18, 19,
# 20 — every one inside the DATA month, none in the following one. Ordered by
# observed frequency so the first request usually hits.
_PUB_DAYS = [18, 17, 19, 20, 21, 22, 16, 23, 24, 25, 15, 26, 27, 28]


def k1_stems(data_year: int, data_month: int) -> list[str]:
    """Filename forms seen on real first-half ("kỳ 1") export bulletins.

    Two things here were wrong before and account for the study never finding a
    single file:

      * The report type is **1X**, not 2x. `2x` is the monthly
        export-by-commodity bulletin; the fortnight series is a different table.
        The alternate filename `ta_bieu1_ky-xk.pdf` spells it out — *biểu 1*
        (table 1), *kỳ* (period), *xk* = xuất khẩu (exports).
      * Case is consistent across the WHOLE filename — `2026-T8K1-1X(TA-SB)` or
        `2026-t5k1-1x(ta-sb)`, never mixed. Toggling the prefix, the month
        format and the suffix independently generated mostly impossible names
        and quadrupled the search for nothing.

    `TA` is tiếng Anh, the English edition; `VN` the Vietnamese one. Both are
    tried because only the English URLs are confirmed, and the two editions
    label the coffee row differently — see `extract_coffee_row_any_language`.
    """
    out: list[str] = []
    for mm in dict.fromkeys((str(data_month), f"{data_month:02d}")):
        for lang in ("TA", "VN"):
            upper = f"{data_year}-T{mm}K1-1X({lang}-SB).pdf"
            out.append(upper)
            out.append(upper.lower())
    # One month in six published under a fixed descriptive name carrying no
    # date at all, so it can only be found by the directory it sits in.
    out += ["ta_bieu1_ky-xk.pdf", "vn_bieu1_ky-xk.pdf"]
    return list(dict.fromkeys(out))


def k1_candidate_urls(data_year: int, data_month: int) -> list[str]:
    """Predicted URLs for one month's first-half (days 1-15) export bulletin.

    Ordered so the likeliest combination is tried first: the data month's own
    directory, around the 18th, under the dated uppercase English stem.
    """
    pub_windows = [
        shift(data_year, data_month, 0),   # every observed bulletin is here
        shift(data_year, data_month, 1),   # kept as a fallback for late months
    ]
    stems = k1_stems(data_year, data_month)
    urls: list[str] = []
    for pub_year, pub_month in pub_windows:
        for d in _PUB_DAYS:
            for stem in stems:
                urls.append(
                    f"{_FILES_HOST}/CustomsCMS/TONG_CUC/{pub_year}/{pub_month}/{d}/{stem}")
    return list(dict.fromkeys(urls))


# The stem of a first-half bulletin: '2026-T8K1-1X(TA-SB).pdf'. Two things vary
# between months but stay consistent across nearby ones — the case of the whole
# filename, and which language edition is posted.
_STEM_RE = re.compile(r"/(\d{4})-([tT])(\d{1,2})[kK]1-1[xX]\(([^)]*)\)\.pdf$")


def stem_signature(url: str) -> tuple[str, bool, str] | None:
    """(case, month-zero-padded, language-suffix) for a bulletin URL.

    None for the undated `ta_bieu1_ky-xk.pdf` form, which carries no convention
    worth learning — a month that resolves to it teaches us nothing, so the
    search order for later months is left as it was.
    """
    m = _STEM_RE.search(url or "")
    if not m:
        return None
    return (m.group(2), len(m.group(3)) == 2, m.group(4))


def prioritise(urls: list[str], signature: tuple[str, bool, str] | None) -> list[str]:
    """Put the naming convention that already worked at the front of the queue.

    `k1_candidate_urls` still fans out over two publication windows, fourteen
    plausible days and ten stem forms. Customs keeps the convention stable
    across nearby months, so once one month answers, the stem that worked is
    worth trying first for every later month — on the six confirmed URLs this
    moves July's hit from position 11 to position 2.

    This reorders rather than filters: the other forms stay at the back, so a
    month where Customs did change convention still resolves, just later.
    """
    if signature is None:
        return urls
    match = [u for u in urls if stem_signature(u) == signature]
    rest = [u for u in urls if stem_signature(u) != signature]
    return match + rest


def months_back(n: int, today_year: int, today_month: int) -> list[tuple[int, int]]:
    """The n most recent COMPLETE data months, newest first."""
    out = []
    y, m = shift(today_year, today_month, -1)
    for _ in range(n):
        out.append((y, m))
        y, m = shift(y, m, -1)
    return out


def full_month_series() -> dict[str, float]:
    """{'YYYY-MM': tonnes} from the existing full-month scraper cache."""
    if not _CACHE_PATH.exists():
        return {}
    try:
        cache = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, float] = {}
    for row in cache.get("monthly", []):
        month, t = row.get("month"), row.get("tonnes")
        if isinstance(month, str) and isinstance(t, (int, float)) and t > 0:
            out[month] = float(t)
    return out


def ratio_stats(pairs: list[dict]) -> dict:
    """Summarise k1/full ratios.

    Deliberately reports dispersion before the mean. A mean of 0.50 with a
    range of 0.30-0.70 does NOT license doubling the mid-month number, and a
    report that leads on the mean invites exactly that mistake.
    """
    ratios = [p["ratio"] for p in pairs if p.get("ratio")]
    if len(ratios) < 3:
        return {"n": len(ratios), "verdict": "insufficient data — need at least 3 paired months"}
    mean = statistics.mean(ratios)
    med = statistics.median(ratios)
    sd = statistics.pstdev(ratios) if len(ratios) > 1 else 0.0
    lo, hi = min(ratios), max(ratios)
    # How often would "double the k1 number" have landed within tolerance?
    within = sum(1 for r in ratios if abs(2 * r - 1.0) <= TOLERANCE)
    # Does the naive 0.50 assumption sit inside the observed spread at all?
    half_plausible = lo <= 0.50 <= hi
    verdict = (
        "doubling is reliable" if within / len(ratios) >= 0.80 and sd <= 0.05 else
        "doubling is directionally usable but noisy" if within / len(ratios) >= 0.60 else
        "doubling is NOT reliable — the mid-month share is too variable"
    )
    return {
        "n": len(ratios),
        "mean": round(mean, 4),
        "median": round(med, 4),
        "stdev": round(sd, 4),
        "min": round(lo, 4),
        "max": round(hi, 4),
        "spread": round(hi - lo, 4),
        "tolerance": TOLERANCE,
        "within_tolerance": within,
        "within_tolerance_pct": round(100 * within / len(ratios), 1),
        "half_inside_observed_range": half_plausible,
        "verdict": verdict,
    }


# A k1 bulletin's period quantity covers days 1-15 AND its YTD cumulative is a
# half-month cumulative, so period/ytd-step lands near 0.5. A genuine full month
# lands near 1.0. Anything between is the contamination signature.
HALF_MONTH_BAND = (0.35, 0.65)


def _prev_month(m: str) -> str:
    y, mm = int(m[:4]), int(m[5:])
    return f"{y - 1}-12" if mm == 1 else f"{y}-{mm - 1:02d}"


def half_month_audit(monthly: list[dict]) -> dict:
    """Did a mid-month bulletin ever get published as a monthly figure?

    Checks each month's stated period quantity against the step its YTD
    cumulative took. Only CONSECUTIVE cached months are comparable — where a
    month is missing the step spans two months and would look like a half.

    Ratios sit slightly under 1.0 in practice because Customs revises prior
    months upward, so a later YTD exceeds the sum of the as-published months.
    That is a revision, not contamination; only the ~0.5 band is.
    """
    rows = {r["month"]: r for r in monthly
            if isinstance(r.get("month"), str) and r.get("ytd_cum_qty_tonnes")}
    checked, suspect = [], []
    for m in sorted(rows):
        pm = _prev_month(m)
        if m[5:] == "01":
            step = rows[m].get("ytd_cum_qty_tonnes")
        elif pm in rows:
            step = rows[m]["ytd_cum_qty_tonnes"] - rows[pm]["ytd_cum_qty_tonnes"]
        else:
            continue                      # gap — step spans more than one month
        period = rows[m].get("period_qty_tonnes") or 0.0
        if not step or step <= 0 or period <= 0:
            continue
        ratio = period / step
        checked.append({"month": m, "ratio": round(ratio, 4)})
        if HALF_MONTH_BAND[0] <= ratio <= HALF_MONTH_BAND[1]:
            suspect.append(m)
    return {"checked": len(checked), "suspect_months": suspect,
            "clean": not suspect, "ratios": checked}


def k1_from_publications(publications: list[dict]) -> dict[str, str]:
    """{month: url} for every mid-month export bulletin in a portal listing.

    Pure: takes the already-fetched listing so it can be tested without a
    network. Mirrors the monthly scraper's field probing, because the portal
    has used several key spellings over time.
    """
    out: dict[str, str] = {}
    for pub in publications or []:
        file_url = pub.get("fileSoBo") or pub.get("filePath") or pub.get("url") or ""
        combined = (f"{file_url} {pub.get('loaiBaoCao') or pub.get('type') or ''} "
                    f"{pub.get('tenBaoCao') or pub.get('name') or ''}")
        if not _is_2x(combined) or _period_marker(combined) != "k1":
            continue
        month = _period_to_month(combined)
        if month and file_url:
            out.setdefault(month, file_url)
    return out


async def harvest_k1_via_portal(page) -> dict[str, dict]:
    """{month: coffee row} for the k1 bulletins the portal currently lists."""
    await page.goto(_PORTAL_URL, wait_until="domcontentloaded", timeout=30_000)
    await page.wait_for_timeout(2_000)
    pubs = await _fetch_publication_list(page)
    by_month = k1_from_publications(pubs)
    print(f"[vn-midmonth] portal listed {len(pubs)} publications, "
          f"{len(by_month)} of them mid-month export bulletins")
    out: dict[str, dict] = {}
    for month, url in sorted(by_month.items()):
        body = _download_pdf(url)
        if not body:
            print(f"[vn-midmonth] {month}: k1 PDF download failed")
            continue
        row = extract_coffee_row_any_language(body)
        if row:
            row["url"] = url
            out[month] = row
    return out


def host_reachable(timeout: float = 15.0) -> bool:
    """One cheap probe before the fan-out.

    Each month costs a few hundred candidate URLs at a 30s timeout apiece, so
    a blocked host turns a 5-minute study into an overnight one that still
    concludes nothing. Distinguishing "cannot reach the host" from "pattern
    wrong" up front is the difference between a useful failure and a hang.
    """
    import requests
    try:
        requests.head(_FILES_HOST, timeout=timeout, verify=False, allow_redirects=True)
        return True
    except Exception as e:                       # noqa: BLE001 — any failure is the answer
        print(f"[vn-midmonth] {_FILES_HOST} unreachable ({type(e).__name__}: {e})")
        return False


# Vietnam's monthly coffee exports have run roughly 50k-260k t over the cached
# span, so a first half sits somewhere around 15k-200k. The band is deliberately
# wide: it is not a forecast, it is a magnitude check that catches a thousands
# separator read as a decimal point — 147.890 t instead of 147,890 t — which is
# the one parse error that would otherwise sail through as a plausible ratio.
K1_TONNES_RANGE = (5_000.0, 400_000.0)

# The English edition labels the row "Coffee"; the Vietnamese one "Cà phê",
# which _strip_accents flattens to "ca phe". The full-month scraper only needs
# the Vietnamese form and is deliberately left alone, so the bilingual matcher
# lives here.
_COFFEE_ANY_RX = re.compile(r"\b(ca\s*phe|coffee)\b", re.IGNORECASE)


def extract_coffee_row_any_language(pdf_bytes: bytes) -> dict | None:
    """Coffee tonnage cells from a first-half bulletin, either language edition.

    Same column layout as the monthly 2x table, which the fortnight table
    shares: [3] is the period quantity, [7] the year-to-date cumulative.

    Deliberately a separate function rather than a change to the full-month
    parser: that path works and is not to be disturbed.
    """
    try:
        import pdfplumber
    except ImportError:
        print("[vn-midmonth] pdfplumber not installed")
        return None
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for pg in pdf.pages:
                for table in (pg.extract_tables() or []):
                    for row in table:
                        if not row or len(row) < 4:
                            continue
                        label = _strip_accents(row[1] or "").lower()
                        if not _COFFEE_ANY_RX.search(label):
                            continue
                        raw = [c if c is not None else "" for c in row]
                        nums = [_parse_vn_number(c) for c in raw]
                        period = round(nums[3] if len(nums) > 3 else 0.0, 1)
                        if not (K1_TONNES_RANGE[0] <= period <= K1_TONNES_RANGE[1]):
                            print(f"[vn-midmonth] coffee row found but {period} t is outside "
                                  f"{K1_TONNES_RANGE} — refusing it rather than recording a "
                                  f"misparsed number")
                            return None
                        return {
                            "period_qty_tonnes": period,
                            "ytd_cum_qty_tonnes": round(nums[7] if len(nums) > 7 else 0.0, 1),
                            "raw_row": [str(c).strip() if c else "" for c in raw],
                        }
        return None
    except Exception as e:                       # noqa: BLE001 — reported, not swallowed
        print(f"[vn-midmonth] PDF parse error: {e}")
        return None


def fetch_k1(year: int, month: int,
             signature: tuple[str, bool, str] | None = None) -> dict | None:
    """First k1 bulletin that answers, parsed to the coffee row.

    `signature` is the stem convention a previous month resolved to; it only
    reorders the search, never restricts it.
    """
    for url in prioritise(k1_candidate_urls(year, month), signature):
        body = _try_download_pdf(url)
        if not body:
            continue
        row = extract_coffee_row_any_language(body)
        if row:
            row["url"] = url
            return row
    return None


def main(n_months: int, today_year: int, today_month: int) -> int:
    full = full_month_series()
    if not full:
        print("[vn-midmonth] no full-month cache — run the vn_coffee_export scraper first")
        return 1
    if not host_reachable():
        print("[vn-midmonth] ABORT — no network path to Vietnam Customs. This study needs "
              "files.customs.gov.vn; run it where the scraper runs, not in a sandbox that "
              "denies outbound by policy. Nothing was written.")
        return 2

    pairs: list[dict] = []
    missing: list[str] = []
    # Learned from the first month that resolves, then reused to order every
    # later month's search. Without it each month pays for all four stem
    # variants when only one is real.
    signature: tuple[str, bool, str] | None = None
    for (y, m) in months_back(n_months, today_year, today_month):
        key = f"{y}-{m:02d}"
        if key not in full:
            continue
        row = fetch_k1(y, m, signature)
        if not row:
            missing.append(key)
            print(f"[vn-midmonth] {key}: no k1 bulletin found")
            continue
        if signature is None:
            signature = stem_signature(row["url"])
            if signature:
                print(f"[vn-midmonth] naming convention learned from {key}: {signature}")
        k1_t = float(row.get("period_qty_tonnes") or 0.0)
        full_t = full[key]
        if k1_t <= 0 or full_t <= 0:
            missing.append(key)
            continue
        ratio = k1_t / full_t
        pairs.append({"month": key, "k1_tonnes": k1_t, "full_tonnes": full_t,
                      "ratio": round(ratio, 4), "url": row["url"]})
        print(f"[vn-midmonth] {key}: k1={k1_t:>10,.0f}t  full={full_t:>10,.0f}t  ratio={ratio:.3f}")

    stats = ratio_stats(pairs)
    report = {
        "question": "Does Vietnam Customs' mid-month (k1) bulletin represent ~half the full month?",
        "method": "ratio = k1 period quantity / full-month period quantity, per data month",
        "months_requested": n_months,
        "months_paired": len(pairs),
        "months_missing_k1": missing,
        "stats": stats,
        "pairs": pairs,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n[vn-midmonth] {json.dumps(stats, indent=2)}")
    print(f"[vn-midmonth] wrote {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    from datetime import date
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=24)
    a = ap.parse_args()
    today = date.today()
    raise SystemExit(main(a.months, today.year, today.month))
