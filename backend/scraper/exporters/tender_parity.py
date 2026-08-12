"""
tender_parity.py
Accumulates a daily per-origin tenderable-parity history — the exact series the
Research "Tender parity" tool needs to eventually fit a rigorous
"differential-hits-parity → exchange-inflow" event study.

For each robusta origin and each day we have a farmgate price, it records:
  farmgate_usd  local price → USD/MT (via that day's FX)
  at_port       farmgate_usd + FOBbing            (origin → vessel)
  tendering     at_port + freight + parity adders  (all-in into an exchange warehouse)
  rc            London Robusta front (USD/MT)
  differential  at_port − rc                       (the N-diff)
  parity_gap    rc − tendering                     (≥ 0 ⇒ tendering is profitable)
  tenderable    parity_gap ≥ 0

It is DERIVED (reads the already-published static JSONs — origin_prices_history,
fx_history, freight, futures_price_history) and APPEND-ONLY / idempotent: any date
already recorded is left as-observed, missing dates (incl. the whole existing
farmgate back-history on first run) are backfilled. So the file lengthens in
lockstep with origin_prices_history — today it is ~2 months; give it a year and
the per-origin event study becomes statistically viable. Must run AFTER
origin_prices_history, freight and futures_price_history in the export order.
"""
import json
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json, validate_tender_parity

OUT_PATH = OUT_DIR / "tender_parity_history.json"

# Tenderable-parity adders beyond FOB + freight (USD/MT), per confirmed values:
#   port transport 18  EU-average DTHC + DO from the Destination In-store cost research
#                      (Bremen/Le Havre/Barcelona/Genoa/Trieste ≈ €16.3/t ≈ $18/t)
#   rent            0  taken as financed by the chosen ICE-nominated warehouse
#   loading-out    40  one-time load-out charge (OCA) when the buyer collects
#   import duty     0  EU MFN tariff on green robusta (HS 0901.11) is 0%
PARITY_ADDERS_USD = 58.0
CONTAINER_MT      = 21.6
LB_PER_MT         = 2204.62

# Robusta origins tendered against London RC. FOBbing mirrors lib/originCosts.ts
# (FOBBING_MODEL) and MUST be kept in step with it; freight_route indexes the
# FBX-derived routes in freight.json.
#
# fobbing = fobbing_fixed + fobbing_pct% × farmgate_usd, so the cost re-rates
# with the cargo's value every day instead of standing at a frozen reference.
# The ad-valorem half covers quality preparation/outturn, weight loss, cess,
# financing and exporter margin; the fixed half is haulage, inspection and
# terminal handling. Each origin's percentage is the sum of its own
# value-scaling lines and its fixed block is set to reproduce the published
# headline at that origin's reference price — a change of form, not level —
# except Brazil conilon, whose quality component was re-based to 4.0% on the
# measured tipo 7/8 → tipo 6 grade ladder (see exporters/conilon_basis.py).
FOBBING_MODEL_VERSION = 3      # bump to re-derive stored rows under a new model
ORIGINS = [
    {"key": "vietnam",        "name": "Vietnam Robusta FAQ G2", "fx": "VND=X", "unit": "per_kg",
     "fobbing_fixed": 55.0,  "fobbing_pct": 1.29, "freight_route": "vn-eu"},
    {"key": "brazil_conilon", "name": "Brazil Conilon T7",      "fx": "BRL=X", "unit": "per_saca_60kg",
     "fobbing_fixed": 62.5,  "fobbing_pct": 5.5, "freight_route": "br-eu"},
    {"key": "uganda",         "name": "Uganda Robusta S15",     "fx": None,    "unit": "cents_lb",
     "fobbing_fixed": 142.5, "fobbing_pct": 3.31, "freight_route": "et-eu"},
]


def _remodel(row: dict, cfg: dict) -> dict:
    """Re-apply the current FOBbing model to an already-stored row.

    Uses only what the row itself observed — farmgate_usd, freight, rc — so no
    date is ever lost to an upstream series that has since rolled off. A row
    missing any of those (shouldn't happen; every writer sets all three) is
    returned untouched rather than corrupted.
    """
    farm, fr, rc = row.get("farmgate_usd"), row.get("freight"), row.get("rc")
    if farm is None or fr is None or rc is None:
        return row
    fobbing = cfg["fobbing_fixed"] + cfg["fobbing_pct"] / 100.0 * farm
    at_port = farm + fobbing
    tendering = at_port + fr + PARITY_ADDERS_USD
    return {**row,
            "fobbing": round(fobbing, 1),
            "at_port": round(at_port, 1),
            "tendering": round(tendering, 1),
            "differential": round(at_port - rc, 1),
            "parity_gap": round(rc - tendering, 1),
            "tenderable": rc >= tendering}


def _load(name: str) -> dict:
    p = OUT_DIR / name
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _ffill_map(pairs: list[tuple[str, float]]):
    """Return (sorted_dates, {date: value}) for as-of-or-before lookups."""
    d = {k: v for k, v in pairs if v is not None}
    return sorted(d.keys()), d


def _asof(dates: list[str], by_date: dict, on: str):
    if on in by_date:
        return by_date[on]
    lo, hi, ans = 0, len(dates) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if dates[mid] <= on:
            ans = dates[mid]; lo = mid + 1
        else:
            hi = mid - 1
    return by_date[ans] if ans is not None else None


def _to_usd_mt(price: float, fx: float | None, unit: str) -> float | None:
    if unit == "cents_lb":
        return price / 100.0 * LB_PER_MT
    if fx is None or fx <= 0:
        return None
    if unit == "per_kg":
        return price / fx * 1000.0
    if unit == "per_saca_60kg":
        return price / fx / 60.0 * 1000.0
    return None


def export_tender_parity() -> None:
    origin_prices = _load("origin_prices_history.json").get("origins") or {}
    fx_pairs      = _load("fx_history.json").get("pairs") or {}
    freight       = _load("freight.json")
    futures       = _load("futures_price_history.json")

    rc_dates, rc_by = _ffill_map([(r.get("date"), r.get("price")) for r in (futures.get("robusta") or [])])
    if not rc_dates:
        print("  tender_parity → no RC price history; skipping")
        return

    # freight per route: prefer the daily history column; for dates earlier than
    # that (short) history, estimate via the Containerized Freight Index shape,
    # calibrated to the real route rate over their overlap window.
    freight_hist = freight.get("history") or []
    freight_routes = {r.get("id"): r.get("rate") for r in (freight.get("routes") or [])}
    cfi_dates, cfi_by = _ffill_map([(r.get("date"), r.get("index")) for r in (_load("containerized_freight_index.json").get("series") or [])])

    def _cfi_factor(route: str) -> float | None:
        """Median (real route USD/FEU ÷ CFI index) over their overlap — maps the
        index onto this route's price level."""
        ratios = []
        for row in freight_hist:
            d, feu = row.get("date"), row.get(route)
            c = _asof(cfi_dates, cfi_by, d) if (d and cfi_dates) else None
            if feu and c:
                ratios.append(feu / c)
        if not ratios:
            return None
        ratios.sort()
        return ratios[len(ratios) // 2]

    factor = {cfg["freight_route"]: _cfi_factor(cfg["freight_route"]) for cfg in ORIGINS}

    def freight_usd_mt(route: str, on: str) -> float | None:
        dates, by = _ffill_map([(row.get("date"), row.get(route)) for row in freight_hist])
        if dates and on >= dates[0]:
            feu = _asof(dates, by, on)                       # real, as-observed
        else:
            c, f = _asof(cfi_dates, cfi_by, on) if cfi_dates else None, factor.get(route)
            feu = (f * c) if (c and f) else freight_routes.get(route)  # CFI-scaled, else flat
        return (feu / CONTAINER_MT) if feu else None

    existing = _load("tender_parity_history.json").get("origins") or {}
    out_origins: dict = {}

    for cfg in ORIGINS:
        key = cfg["key"]
        farmgate = (origin_prices.get(key) or {}).get("history") or []
        fx_dates, fx_by = ([], {})
        if cfg["fx"]:
            fx_dates, fx_by = _ffill_map([(r.get("date"), r.get("close")) for r in (fx_pairs.get(cfg["fx"]) or {}).get("history", [])])

        # Append-only applies to OBSERVATIONS, not to model inputs: at_port and
        # everything downstream of it depend on the FOBbing model, so a model
        # change leaves stored rows stale. They are re-derived IN PLACE from
        # each row's own observed inputs (farmgate_usd, freight, rc — all
        # persisted), never rebuilt from the source series: re-deriving from
        # source silently drops any date whose upstream inputs have since moved
        # out of reach, which would delete real observations.
        stored = existing.get(key) or {}
        rows_in = stored.get("history") or []
        if stored.get("fobbing_model") != FOBBING_MODEL_VERSION and rows_in:
            rows_in = [_remodel(r, cfg) for r in rows_in]
            print(f"    {key} → fobbing model v{FOBBING_MODEL_VERSION}: "
                  f"re-derived {len(rows_in)} stored rows in place")
        prior = {r["date"]: r for r in rows_in}
        for pt in farmgate:
            d, price = pt.get("date"), pt.get("price")
            if not d or price is None or d in prior:
                continue
            fx = _asof(fx_dates, fx_by, d) if cfg["fx"] else None
            rc = _asof(rc_dates, rc_by, d)
            fr = freight_usd_mt(cfg["freight_route"], d)
            farm_usd = _to_usd_mt(price, fx, cfg["unit"])
            if rc is None or farm_usd is None or fr is None:
                continue
            fobbing   = cfg["fobbing_fixed"] + cfg["fobbing_pct"] / 100.0 * farm_usd
            at_port   = farm_usd + fobbing
            tendering = at_port + fr + PARITY_ADDERS_USD
            prior[d] = {
                "date": d,
                "farmgate_usd": round(farm_usd, 1),
                "fobbing": round(fobbing, 1),
                "at_port": round(at_port, 1),
                "freight": round(fr, 1),
                "tendering": round(tendering, 1),
                "rc": round(rc, 1),
                "differential": round(at_port - rc, 1),
                "parity_gap": round(rc - tendering, 1),
                "tenderable": rc >= tendering,
            }
        rows = sorted(prior.values(), key=lambda r: r["date"])
        out_origins[key] = {
            "name": cfg["name"], "market": "RC",
            # Headline figure = the model evaluated on the latest farmgate value,
            # so consumers reading a single number get today's, not a stale one.
            "fobbing_usd": round(rows[-1]["fobbing"], 1) if rows else cfg["fobbing_fixed"],
            "fobbing_fixed": cfg["fobbing_fixed"], "fobbing_pct": cfg["fobbing_pct"],
            "fobbing_model": FOBBING_MODEL_VERSION,
            "history": rows,
        }

    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "meta": {
            "adders_usd": PARITY_ADDERS_USD, "container_mt": CONTAINER_MT,
            "note": "differential = at_port − RC; parity_gap = RC − tendering (≥0 ⇒ tenderable). "
                    "Append-only, as-observed; backfilled from origin_prices_history.",
        },
        "origins": out_origins,
    }
    safe_write_json(OUT_PATH, payload, validate_tender_parity)
    total = sum(len(v["history"]) for v in out_origins.values())
    print(f"  tender_parity_history.json → {total} rows across {len(out_origins)} origins")
