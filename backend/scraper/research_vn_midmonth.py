"""research_vn_midmonth.py — is Vietnam's mid-month customs bulletin half a month?

Vietnam Customs publishes twice per month. In their filename scheme the period
marker is `k1` or `k2`:

    k1  data through the 15th          e.g. 2026-t6k1-2x(vn-sb).pdf
    k2  full-month cumulative          e.g. 2026-t6k2-2x(vn-sb).pdf

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

Where the k1 bulletins come from: the SAME portal page the monthly scraper
already reads (customs.gov.vn pageId=441, enumerated through the bridge
servlet). k1 and k2 sit side by side in that listing — both stamped '2x' and
both carrying the same '{year}-t{month}' month code, which is why the monthly
scraper now filters k1 out explicitly. Enumerating beats predicting URLs: the
listing gives the real filename rather than a guess at one.

Network note: the portal and files.customs.gov.vn must be reachable. Some
sandboxed environments deny them by network policy; the production scraper
reaches them fine, which is where this is meant to run.

    python -m backend.scraper.research_vn_midmonth --months 24
"""
from __future__ import annotations

import argparse
import json
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
    _extract_coffee_row,
    _fetch_publication_list,
    _is_2x,
    _period_marker,
    _period_to_month,
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


def k1_candidate_urls(data_year: int, data_month: int) -> list[str]:
    """Predicted URLs for one month's k1 (through-the-15th) export bulletin.

    Same fan-out as the full-month predictor in vn_coffee_export, with the
    period marker inserted. k1 publishes EARLIER than the full month — inside
    the same month for late-window days, or early the following month — so the
    publication window is shifted back by one relative to the k2 predictor.
    """
    pub_windows = [
        shift(data_year, data_month, 0),   # published late in the data month
        shift(data_year, data_month, 1),   # or early the next
    ]
    # k1 lands around the 20th-25th of its own month, or the first week of the
    # next. Ordered by plausibility so the first hit is usually within a few
    # requests rather than the full cross-product.
    day_order = [
        22, 23, 21, 24, 20, 25, 26, 19, 27, 18, 28, 17, 16,
        5, 6, 7, 8, 4, 9, 10, 3, 11, 12, 2, 13, 14, 1, 15,
    ]
    urls: list[str] = []
    for pub_year, pub_month in pub_windows:
        for tprefix in ("t", "T"):
            for mfmt in (str(data_month), f"{data_month:02d}"):
                for suffix in ("(vn-sb)", "(VN-SB)"):
                    stem = f"{data_year}-{tprefix}{mfmt}k1-2x{suffix}.pdf"
                    for d in day_order:
                        urls.append(
                            f"{_FILES_HOST}/CustomsCMS/TONG_CUC/{pub_year}/{pub_month}/{d}/{stem}")
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


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
        row = _extract_coffee_row(body)
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


def fetch_k1(year: int, month: int) -> dict | None:
    """First k1 bulletin that answers, parsed to the coffee row."""
    for url in k1_candidate_urls(year, month):
        body = _try_download_pdf(url)
        if not body:
            continue
        row = _extract_coffee_row(body)
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
    for (y, m) in months_back(n_months, today_year, today_month):
        key = f"{y}-{m:02d}"
        if key not in full:
            continue
        row = fetch_k1(y, m)
        if not row:
            missing.append(key)
            print(f"[vn-midmonth] {key}: no k1 bulletin found")
            continue
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
