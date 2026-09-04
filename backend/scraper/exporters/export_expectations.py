"""export_expectations.py — what the mid-month said the month would be, against
what the month turned out to be. Brazil and Vietnam.

Both origins print a half-month figure long before the month closes, and the
trade extrapolates it. This keeps every such extrapolation next to the number
it was later measured against, so the chart shows a track record rather than
a fresh guess each month.

Brazil · Cecafé daily accumulator (cecafe_daily.json, embarques)
    expected = cumulative bags registered through day 15 ÷ the median day-15
               SHARE of the month (cum15 / monthly-report total) over the
               closed months on file
    actual   = the month's total in Cecafé's monthly report (cecafe.json)
    Port loadings are back-loaded — the first half of May–Jul 2026 carried
    27–39% of the month, not half — so scaling day 15 by the calendar
    understated every month by a third or more. The share is measured, like
    Vietnam's ratio. Closed months are scored leave-one-out (their own share
    excluded from the median) so the error column is out-of-sample; with
    fewer than two other months the calendar scale is used and flagged.
    The accumulator's day keys are not monotonic (see BrazilTab/pace.ts), so
    "through day 15" is the running maximum over keys ≤ 15.

Vietnam · Customs first-half bulletin (kỳ 1, days 1-15)
    expected = k1 tonnes ÷ the median k1/full-month ratio measured over every
               valid paired month in data/vn_midmonth_ratio.json
    actual   = the full-month customs figure
    The research page shows the ratio is NOT a stable ½ (stdev ~0.065 around
    0.465), which is the point of measuring: the error column here is what
    "annualise the k1 print" actually costs. A month whose k1 exceeds its
    full-month total is impossible and is carried flagged, not dropped. The
    current month's k1, if published and not yet paired, is fetched so the
    open month carries an expectation while the actual is still to come.

Output frontend/public/data/export_expectations.json:
    {generated_at,
     brazil:  {unit: "bags", method, basis_day, rows: [{month, cum_at_basis, expected, actual, error_pct, defect}]},
     vietnam: {unit: "tonnes", method, ratio, ratio_n, rows: [{month, k1, expected, actual, error_pct, defect}]}}
error_pct = (expected − actual) / actual × 100: positive means the mid-month
overstated the month.
"""
from __future__ import annotations

import calendar
import json
from datetime import UTC, date, datetime
from pathlib import Path

from scraper.exporters.base import OUT_DIR

ROOT = Path(__file__).resolve().parents[3]
OUT = OUT_DIR / "export_expectations.json"
BR_DAILY = OUT_DIR / "cecafe_daily.json"
BR_MONTHLY = OUT_DIR / "cecafe.json"
VN_RATIO = ROOT / "data" / "vn_midmonth_ratio.json"

BASIS_DAY = 15
STREAMS = ("arabica", "conillon", "soluvel")


def _load(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def days_in_month(ym: str) -> int:
    y, m = (int(x) for x in ym.split("-"))
    return calendar.monthrange(y, m)[1]


def cum_through(md: dict | None, day: int) -> float | None:
    """Running maximum of the cumulative over stored day keys ≤ day."""
    if not md:
        return None
    best = None
    for k, v in md.items():
        try:
            d = int(k)
        except (TypeError, ValueError):
            continue
        if d > day or v is None:
            continue
        if best is None or v > best:
            best = v
    return best


def error_pct(expected: float | None, actual: float | None) -> float | None:
    if expected is None or not actual:
        return None
    return round((expected - actual) / actual * 100, 1)


def _median(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def brazil_rows(daily: dict, monthly: dict, basis_day: int = BASIS_DAY) -> tuple[list[dict], float | None, int]:
    """Rows plus (share used for open months, number of closed months behind it)."""
    sources = daily.get("sources") or {}
    bucket = sources.get("embarques") or sources.get("certificados") or {}
    actual_by_month = {r["date"]: r.get("total") for r in monthly.get("series") or []
                       if isinstance(r, dict) and r.get("date")}
    months = sorted({ym for s in STREAMS for ym in (bucket.get(s) or {})})

    cums: dict[str, float] = {}
    for ym in months:
        parts = [cum_through((bucket.get(s) or {}).get(ym), basis_day) for s in STREAMS]
        if all(p is None for p in parts):
            continue
        cums[ym] = sum(p or 0 for p in parts)

    # Day-15 share of each closed month, the thing the calendar gets wrong.
    shares = {ym: cums[ym] / actual_by_month[ym] for ym in cums
              if actual_by_month.get(ym) and cums[ym] > 0}

    rows = []
    for ym, cum in cums.items():
        actual = actual_by_month.get(ym)
        others = [v for k, v in shares.items() if k != ym]        # leave-one-out
        share = _median(others)
        if share and len(others) >= 2:
            expected = round(cum / share)
            method = "share"
        else:
            expected = round(cum * days_in_month(ym) / basis_day)
            method = "calendar"
        rows.append({
            "month": ym, "cum_at_basis": round(cum), "expected": expected,
            "share_used": round(share, 4) if share and method == "share" else None,
            "share_actual": round(shares[ym], 4) if ym in shares else None,
            "method": method,
            "actual": actual, "error_pct": error_pct(expected, actual), "defect": None,
        })
    return rows, _median(list(shares.values())), len(shares)


def vietnam_rows(report: dict, current_k1: dict | None = None) -> tuple[list[dict], float | None, int]:
    """Rows from the paired study plus, optionally, an unpaired current month
    {"month", "k1_tonnes", "url"}. Returns (rows, ratio_used, ratio_n)."""
    stats = report.get("stats") or {}
    ratio = stats.get("median")
    n = stats.get("n") or 0
    rows = []
    seen = set()
    for p in report.get("pairs") or []:
        k1, full = p.get("k1_tonnes"), p.get("full_tonnes")
        if not k1 or not ratio:
            continue
        expected = round(k1 / ratio)
        rows.append({
            "month": p["month"], "k1": k1, "expected": expected, "actual": full,
            "error_pct": None if p.get("valid") is False else error_pct(expected, full),
            "defect": p.get("defect"),
        })
        seen.add(p["month"])
    if current_k1 and ratio and current_k1.get("month") not in seen and current_k1.get("k1_tonnes"):
        k1 = float(current_k1["k1_tonnes"])
        rows.append({"month": current_k1["month"], "k1": k1, "expected": round(k1 / ratio),
                     "actual": None, "error_pct": None, "defect": None})
    rows.sort(key=lambda r: r["month"])
    return rows, ratio, n


def _current_vn_k1(report: dict, today: date | None = None) -> dict | None:
    """The newest k1 bulletin not yet paired with a full month, fetched live.
    The bulletins land between the 17th and 20th of their own month, so the
    current month is tried once the 17th has passed, else the previous one."""
    today = today or date.today()
    paired = {p["month"] for p in report.get("pairs") or []}
    y, m = today.year, today.month
    candidates = [(y, m)] if today.day >= 17 else []
    py, pm = (y, m - 1) if m > 1 else (y - 1, 12)
    candidates.append((py, pm))
    try:
        from scraper.research_vn_midmonth import fetch_k1, host_reachable
        if not host_reachable(timeout=8):
            return None
        for yy, mm in candidates:
            key = f"{yy}-{mm:02d}"
            if key in paired:
                continue
            row = fetch_k1(yy, mm)
            if row and row.get("period_qty_tonnes"):
                return {"month": key, "k1_tonnes": float(row["period_qty_tonnes"]), "url": row.get("url")}
    except Exception as e:  # noqa: BLE001
        print(f"  export_expectations → current VN k1 unavailable: {type(e).__name__}: {e}")
    return None


def export_expectations() -> None:
    daily, monthly, report = _load(BR_DAILY), _load(BR_MONTHLY), _load(VN_RATIO)
    br, br_share, br_n = brazil_rows(daily, monthly)
    vn, ratio, n = vietnam_rows(report, _current_vn_k1(report) if report else None)
    doc = {
        "generated_at": datetime.now(UTC).isoformat(),
        "brazil": {
            "unit": "bags",
            "basis_day": BASIS_DAY,
            "ratio": round(br_share, 4) if br_share else None, "ratio_n": br_n,
            "method": f"Cecafé daily embarques through day {BASIS_DAY} ÷ median day-{BASIS_DAY} share of the "
                      "month over closed months (leave-one-out when scoring); actual = Cecafé monthly report total",
            "rows": br,
        },
        "vietnam": {
            "unit": "tonnes",
            "ratio": ratio, "ratio_n": n,
            "method": "Customs first-half (k1) tonnes ÷ median k1/full-month ratio over valid paired months; "
                      "actual = full-month customs figure",
            "rows": vn,
        },
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  export_expectations.json → Brazil {len(br)} months (day-15 share {br_share} over {br_n}), "
          f"Vietnam {len(vn)} months (k1 ratio {ratio} over {n})")


if __name__ == "__main__":
    export_expectations()
