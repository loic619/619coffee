"""
vietnam_supply.py — scrape Vietnam coffee export data and fertilizer import context.

Exports source chain (highest priority first):
  1. Vietnam Customs 2x monthly bulletins (customs.gov.vn) — primary source as of
     2026-05. Scraped by vn_coffee_export.run() in the monthly Playwright session,
     persisted to backend/scraper/cache/vn_coffee_export.json. ~10-day publication
     lag (e.g. Dec 2024 published Jan 10 2025). Same publication system as our
     existing vn_fertilizer 1n imports, just filtered for type "2x" (xuất khẩu).
  2. Static snapshot vn_export_destination_port.json — the long tail, which also
     backstops the chart if the Customs cache is ever empty.

Sources are attempted in order and merged by month, the higher-priority source
winning. Customs was added 2026-05 as the bypass for two upstreams that had
stopped answering: tap the same Vietnam Customs publication system that
vn_fertilizer.py already uses, filtered for type 2x (exports) and fetched via
direct URL prediction on files.customs.gov.vn (no portal session needed for the
data files themselves).

Removed 2026-08-14 — two dead tiers, +0 months and 270 s/run
============================================================
NSO Vietnam (www.nso.gov.vn) and the ICO historical CSV (www.ico.org) both sat
between Customs and the static snapshot. Neither has ever contributed a single
month from CI:

  * ICO — silently 403'd from cloud IPs since Sep 2024, which is what froze the
    chart on the static fallback for 21 months and prompted the Customs work in
    the first place. Its URL now returns HTTP 404 (the path moved when ICO
    rebuilt their site), so the CSV it was written against no longer exists.
  * NSO — never worked from cloud IPs. It was kept "in case the WAF behaviour
    relaxes", but the failure is not a WAF challenge: every connect times out,
    so the host is unroutable from GitHub runners rather than refusing us.

The cost was not zero. The NSO walk is 3 years x 3 slug candidates, and at the
original 30 s connect timeout that was 9 x 30 s = 270 s burned per export run,
5-10 runs/day — 275 s of a 310 s nightly export, 89% of the whole job, for +0
months. Verified before deletion that the merged output is byte-identical with
both tiers removed: same 36-month window, same values, same `source` string
(Customs + static), which is exactly what every shipped copy of
vietnam_supply.json has already carried.

If NSO or ICO ever become reachable again, restore them from this commit's
parent — the parsers were working code, just pointed at hosts that stopped
answering.

Fertilizer imports: same as before — Vietnam GSO / MARD monthly bulletin via
the vn_fertilizer cache, with static metadata as default.
"""
from __future__ import annotations

import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# No HTTP client here any more: both remaining sources are local reads (the
# Customs scraper's cache and a shipped JSON snapshot). `requests`, the browser
# User-Agent header and the csv/io/re parsing imports all went with NSO/ICO.


# ── Customs scraper cache reader (priority 1) ────────────────────────────────

def _backfill_from_ytd(monthly: list[dict]) -> list[dict]:
    """Recover a month missing from the cache using its successor's calendar
    year-to-date cumulative.

    The customs 2x bulletins carry a calendar-YTD cumulative alongside each
    month's own quantity, so a gap can be reconstructed exactly:
        period(prev) = ytd_cum(next) - period(next) - ytd_cum(prev-1)
    (with ytd_cum(prev-1)=0 when prev is January). This is how Jan-2026 — whose
    own bulletin was never captured — is recovered from the Feb-2026 cumulative.
    """
    by = {r.get("month"): r for r in monthly if r.get("month")}
    if not by:
        return monthly
    # Only self-heal *recent* gaps (a freshly-missed bulletin); never rewrite
    # deep history, where another source may already hold a vetted value.
    latest = max(by)
    ly, lmm = int(latest[:4]), int(latest[5:7])
    cutoff = (ly * 12 + lmm) - 15
    added: list[dict] = []
    for r in monthly:
        m = r.get("month")
        if not m:
            continue
        y, mm = int(m[:4]), int(m[5:7])
        if mm == 1:                       # January's YTD resets — can't reach December
            continue
        prev = f"{y}-{mm - 1:02d}"
        py, pmm = int(prev[:4]), int(prev[5:7])
        if py * 12 + pmm < cutoff:        # too old — leave established history alone
            continue
        if prev in by:
            continue
        ytd_n = r.get("ytd_cum_qty_tonnes")
        per_n = r.get("period_qty_tonnes") or r.get("tonnes")
        if not ytd_n or not per_n:
            continue
        ytd_prev = ytd_n - per_n          # cumulative through the missing month
        if mm - 1 == 1:                   # missing month is January → period == cumulative
            per_prev = ytd_prev
        else:
            pp = f"{y}-{mm - 2:02d}"
            ytd_pp = by[pp].get("ytd_cum_qty_tonnes") if pp in by else None
            if not ytd_pp:
                continue
            per_prev = ytd_prev - ytd_pp
        if per_prev <= 0:
            continue
        added.append({
            "month": prev,
            "tonnes": round(per_prev),
            "period_qty_tonnes": round(per_prev),
            "ytd_cum_qty_tonnes": round(ytd_prev),
            "derived_from_ytd": True,
        })
    if added:
        print(f"  [vn_exports][Customs] backfilled {len(added)} month(s) from YTD "
              f"cumulative: {', '.join(a['month'] for a in added)}")
    return monthly + added


def _fetch_customs_exports() -> list[dict]:
    """Read monthly coffee exports from vn_coffee_export cache (tonnes → k_bags).

    The cache is populated by backend/scraper/sources/vn_coffee_export.run() in
    the monthly Playwright session, then committed to git by scraper-monthly.yml
    so this function sees it on subsequent export-and-publish runs.
    """
    import json as _json
    from pathlib import Path as _Path
    cache = (
        _Path(__file__).resolve().parents[2]
        / "scraper" / "cache" / "vn_coffee_export.json"
    )
    if not cache.exists():
        print("  [vn_exports][Customs] cache file not found — skipping")
        return []
    try:
        data = _json.loads(cache.read_text(encoding="utf-8"))
        monthly = _backfill_from_ytd(data.get("monthly") or [])
        out: list[dict] = []
        for r in monthly:
            t = r.get("tonnes") or 0
            if t <= 0:
                continue
            out.append({
                "month":        r["month"],
                "total_k_bags": round(t / 60, 1),
            })
        out.sort(key=lambda r: r["month"])
        print(f"  [vn_exports][Customs] {len(out)} months from cache "
              f"(latest: {out[-1]['month'] if out else 'none'})")
        return out
    except Exception as e:
        print(f"  [vn_exports][Customs] cache read failed ({type(e).__name__}): {e}")
        return []


# ── Static fallback ───────────────────────────────────────────────────────────

def _fetch_static_exports() -> list[dict]:
    """Read monthly_total (MT) from vn_export_destination_port.json → k_bags."""
    import json as _json
    from pathlib import Path as _Path
    port_file = (
        _Path(__file__).resolve().parents[3]
        / "frontend" / "public" / "data" / "vn_export_destination_port.json"
    )
    if not port_file.exists():
        return []
    try:
        data = _json.loads(port_file.read_text(encoding="utf-8"))
        mt_by_month: dict = data.get("monthly_total", {})
        if not mt_by_month:
            return []
        return [
            {"month": m, "total_k_bags": round(mt / 60, 1)}
            for m, mt in sorted(mt_by_month.items())
            if mt and mt > 0
        ]
    except Exception as e:
        print(f"  [vn_exports][static] read failed: {e}")
        return []


# ── Merge + YoY ──────────────────────────────────────────────────────────────

def _compute_yoy(monthly: list[dict]) -> list[dict]:
    """Attach yoy_pct to each row based on the same-month-prior-year value."""
    by_month = {r["month"]: r["total_k_bags"] for r in monthly}
    out: list[dict] = []
    for r in monthly:
        y, mo = r["month"].split("-")
        prev = by_month.get(f"{int(y)-1}-{mo}")
        yoy = round((r["total_k_bags"] - prev) / prev * 100, 1) if prev else None
        out.append({**r, "yoy_pct": yoy})
    return out


def fetch_exports() -> dict | None:
    """Run the source chain and return a merged result.

    Sources in priority order: Customs → static. The first source that
    contributes a given month wins; the static snapshot only fills gaps. We
    keep the last 36 months of merged data, computing YoY across the merged
    series.

    Both sources are local reads, so this whole chain is I/O against the repo —
    no network, and nothing that can hang. See the module docstring for the two
    network tiers that used to sit in the middle and why they were removed.
    """
    sources = [
        ("Vietnam Customs (customs.gov.vn) 2x",            _fetch_customs_exports),
        ("Vietnam Customs (vn_export_destination_port)",   _fetch_static_exports),
    ]

    by_month: dict[str, dict] = {}  # month → {total_k_bags, source}
    for source_name, fn in sources:
        try:
            rows = fn()
        except Exception as e:
            print(f"  [vn_exports] {source_name} threw {type(e).__name__}: {e}")
            continue
        new_count = 0
        for r in rows:
            if r["month"] not in by_month:
                by_month[r["month"]] = {**r, "_source": source_name}
                new_count += 1
        print(f"  [vn_exports] {source_name} → +{new_count} new months "
              f"({len(rows)} returned, {len(by_month)} total in merge)")

    if not by_month:
        return None

    # Sort, keep last 36 months, compute YoY across the full merged set
    all_months = sorted(by_month.keys())
    full = [{"month": m, "total_k_bags": by_month[m]["total_k_bags"]} for m in all_months]
    full = _compute_yoy(full)
    monthly = full[-36:]

    # Identify which sources actually contributed to the window we shipped
    window_months = {r["month"] for r in monthly}
    sources_used = sorted({
        by_month[m]["_source"] for m in window_months
    })

    return {
        "source":       " + ".join(sources_used),
        "last_updated": monthly[-1]["month"],
        "unit":         "thousand_60kg_bags",
        "monthly":      monthly,
    }


# ── Fertilizer import context (unchanged) ─────────────────────────────────────

def build_fertilizer_context() -> dict:
    """Return fertilizer import context for Vietnam.

    Merges static metadata with scraped monthly data from vn_fertilizer cache
    (written by vn_fertilizer.run() in the monthly scraper workflow).
    """
    import json as _json
    from pathlib import Path as _Path

    _CACHE = _Path(__file__).resolve().parents[2] / "scraper" / "cache" / "vn_fertilizer.json"

    ctx: dict = {
        "source":  "Vietnam Customs (customs.gov.vn) 1n import reports",
        "note":    "Vietnam imports ~4–5Mt/yr fertilizer. Urea mainly from China/Russia; NPK from China; Potash from Canada/Russia via Singapore.",
        "key_suppliers": {
            "urea":  "China (60%), Russia (25%), Middle East (15%)",
            "npk":   "China (80%+)",
            "potash": "Canada/Russia via Singapore",
        },
        "price_sensitivity": "Vietnam urea prices lag global CFR by ~2–4 weeks via China trading channel.",
    }

    try:
        if _CACHE.exists():
            cache = _json.loads(_CACHE.read_text(encoding="utf-8"))
            monthly = cache.get("monthly")
            if monthly:
                ctx["monthly"] = monthly
                ctx["source"] = "Vietnam Customs 1n reports (auto-scraped)"
    except Exception as e:
        logger.warning(f"[vietnam_supply] vn_fertilizer cache read failed: {e}")

    return ctx


# ── Entry point ───────────────────────────────────────────────────────────────

def build_vietnam_supply() -> dict:
    """Build full vietnam_supply dict for JSON output."""
    exports = fetch_exports()
    return {
        "scraped_at":         datetime.utcnow().isoformat() + "Z",
        "country":            "vietnam",
        "exports":            exports,
        "fertilizer_context": build_fertilizer_context(),
    }
