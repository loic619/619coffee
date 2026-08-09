"""
retail_cpi.py — Retail coffee CPI scraper for the demand-tab cost-pass-through view.

Three free public sources:
  US     — Bureau of Labor Statistics, series CUSR0000SEFP02
           (Roasted coffee, U.S. city average, all urban consumers, SA)
  EU     — Eurostat HICP, COICOP CP01211 ("Coffee"), area EU27_2020
  Brazil — Banco Central do Brasil SGS series 1635
           (IPCA — sub-item Café moído, monthly index)

Each is a monthly index. We compute YoY % so the three are comparable
and can be overlaid against a coffee-futures YoY proxy on the frontend.

Cache shape:
  {
    "source":       "BLS + Eurostat + BCB SGS",
    "last_updated": "2026-05-14",
    "series": {
      "us":     {"name": "...", "source_url": "...", "monthly": [{"period": "YYYY-MM", "index": float, "yoy_pct": float|null}]},
      "eu":     {...},
      "brazil": {...}
    }
  }

API access is anonymous (BLS API key optional — no key works for 25
queries/day, more than enough for one series). On any single-source
failure the cache is retained so the demand tab continues rendering.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "retail_cpi.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# US coffee CPI series (BLS, seasonally adjusted). SEFP02 is roasted coffee
# only; SEFP01 is the broader "Coffee" expenditure group (roasted + instant +
# other). Both are overlaid in the retail panel so the roasted-vs-all spread is
# visible. Both are fetched in a single BLS API call.
_BLS_SERIES = {
    "us":        {"id": "CUSR0000SEFP02", "name": "US — Roasted coffee (BLS CPI, SA)"},
    "us_coffee": {"id": "CUSR0000SEFP01", "name": "US — Coffee, all (BLS CPI, SA)"},
}
_EUROSTAT_DATAFLOW = "prc_hicp_midx"
_BCB_SGS = 1635

# Max acceptable lag (in months) on the EU27_2020 aggregate before falling
# back to the DE/FR/IT/ES weighted basket. Eurostat publishes the aggregate
# 2-3 weeks after the member-state releases, so a lag of 1-2 months on the
# 1st of the month is the steady state. >2 months means Eurostat itself is
# behind (observed at ~5 months for CP01211 in mid-2026).
_EUROSTAT_FRESHNESS_THRESHOLD_MONTHS = 2

_PERIOD_TO_MONTH = {f"M{i:02d}": f"{i:02d}" for i in range(1, 13)}


def _yoy_series(rows: list[dict]) -> list[dict]:
    """Compute YoY % from prior-year same month. Input rows have 'period' YYYY-MM and 'index'."""
    by_period = {r["period"]: r["index"] for r in rows if r.get("index") is not None}
    out: list[dict] = []
    for r in rows:
        if r.get("index") is None:
            continue
        y, m = r["period"].split("-")
        prev = f"{int(y) - 1}-{m}"
        prev_idx = by_period.get(prev)
        yoy = round(((r["index"] / prev_idx) - 1.0) * 100.0, 2) if prev_idx else None
        out.append({"period": r["period"], "index": r["index"], "yoy_pct": yoy})
    return out


def _fetch_bls() -> dict[str, dict] | None:
    """BLS public API — both US coffee CPI series in one request (15yr window).

    Returns {series_key: series_dict} for whichever of the configured series
    came back with data, or None if the request failed outright.
    """
    end_year = datetime.utcnow().year
    # 15-year window for the chart. Keyless BLS silently truncates over-long
    # requests to their FIRST 10 calendar years — which froze these series at
    # 2020-12 while runs logged OK. The shared helper chunks the window into
    # API-honoured requests (2/day keyless — well inside the 25/day budget).
    start_year = end_year - 15
    import os as _os
    from scraper.utils.bls import fetch_series, newest_period
    fetched = fetch_series([m["id"] for m in _BLS_SERIES.values()],
                           start_year, end_year,
                           api_key=_os.environ.get("BLS_API_KEY", "").strip(),
                           headers=_HEADERS, tag="retail_cpi")
    if fetched is None:
        logger.warning("[retail_cpi] all BLS chunks failed")
        return None
    logger.info(f"[retail_cpi] BLS newest period: {newest_period(fetched)}")

    id_to_key = {m["id"]: k for k, m in _BLS_SERIES.items()}
    out: dict[str, dict] = {}
    for sid, rows in fetched.items():
        key = id_to_key.get(sid)
        if not key or not rows:
            continue
        out[key] = {
            "name":       _BLS_SERIES[key]["name"],
            "source_url": f"https://data.bls.gov/timeseries/{sid}",
            "monthly":    _yoy_series(rows),
        }
    return out or None


def _fetch_eurostat_series(geo: str) -> list[dict] | None:
    """Fetch one Eurostat HICP coffee series for the given geo code.

    Returns a sorted list of {"period": "YYYY-MM", "index": float} dicts
    or None on any fetch / parse failure. Caller decides what to do with
    the result — composing a basket vs. picking a single one.
    """
    url = (
        "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
        f"{_EUROSTAT_DATAFLOW}"
        f"?format=JSON&lang=EN&unit=I15&coicop=CP01211&geo={geo}"
    )
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning(f"[retail_cpi] Eurostat {geo} fetch failed: {e}")
        return None

    try:
        time_cat = body["dimension"]["time"]["category"]
        time_idx = time_cat["index"]
        values   = body["value"]
    except (KeyError, TypeError):
        logger.warning(f"[retail_cpi] Eurostat {geo}: unexpected JSON-stat shape")
        return None

    if isinstance(time_idx, dict):
        periods = sorted(time_idx.keys(), key=lambda p: time_idx[p])
    elif isinstance(time_idx, list):
        periods = list(time_idx)
    else:
        return None

    rows: list[dict] = []
    for i, period in enumerate(periods):
        raw = values.get(str(i)) if isinstance(values, dict) else values[i] if i < len(values) else None
        if raw is None:
            continue
        try:
            rows.append({"period": period, "index": float(raw)})
        except (TypeError, ValueError):
            continue
    rows.sort(key=lambda r: r["period"])
    return rows if rows else None


# Coffee-consumption weights for the EU member-state fallback basket.
# Source: ICO consumption stats 2023/24 — DE/FR/IT/ES cover ~68% of EU27
# bag volume and publish HICP coffee 2-3 weeks after month-end, well
# ahead of the EU27_2020 aggregate (which has been running a ~5-month lag
# on CP01211 — observed Dec 2025 latest as of mid-May 2026). Weights here
# are normalised within the four-country basket; the resulting index is a
# proxy, not a true EU27 figure, but it tracks the aggregate closely and
# lets the demand-tab chart stay current.
_EU_BASKET_WEIGHTS: dict[str, float] = {
    "DE": 0.412,   # Germany
    "FR": 0.221,   # France
    "IT": 0.250,   # Italy
    "ES": 0.117,   # Spain
}


def _fetch_eurostat_basket() -> list[dict] | None:
    """Synthesise an EU coffee CPI from DE/FR/IT/ES weighted average.

    For each period present in all 4 series, compute the weighted mean of
    the indices. Periods missing from any contributor are dropped (we
    require all four to keep the basket coherent — silently substituting
    last-known values would smear the YoY signal).
    """
    per_country: dict[str, list[dict]] = {}
    for geo in _EU_BASKET_WEIGHTS:
        series = _fetch_eurostat_series(geo)
        if not series:
            logger.warning(f"[retail_cpi] EU basket: {geo} fetch returned no data")
            return None
        per_country[geo] = series

    # Build a (period -> { geo: index }) map, then keep periods with all 4.
    by_period: dict[str, dict[str, float]] = {}
    for geo, rows in per_country.items():
        for row in rows:
            by_period.setdefault(row["period"], {})[geo] = row["index"]

    complete = [p for p, vals in by_period.items() if len(vals) == len(_EU_BASKET_WEIGHTS)]
    if not complete:
        return None
    complete.sort()
    out: list[dict] = []
    for period in complete:
        vals = by_period[period]
        weighted = sum(vals[geo] * _EU_BASKET_WEIGHTS[geo] for geo in _EU_BASKET_WEIGHTS)
        out.append({"period": period, "index": round(weighted, 3)})
    return out


def _fetch_eurostat() -> dict | None:
    """Eurostat HICP monthly index for coffee (CP01211).

    Tries EU27_2020 aggregate first — that's the true headline figure
    when it's current. If the aggregate is more than 2 months behind
    today (Eurostat's lag for this series has been observed at ~5 months
    in mid-2026), falls back to a weighted DE/FR/IT/ES member-state
    basket which publishes 2-3 weeks after month-end. The series name in
    the JSON cache marks which path was used so the frontend can label
    accordingly.
    """
    from datetime import date

    aggregate = _fetch_eurostat_series("EU27_2020")
    today = date.today()
    aggregate_latest = aggregate[-1]["period"] if aggregate else None

    def _months_behind(period: str | None) -> int:
        if not period or len(period) < 7:
            return 9999
        try:
            y, m = int(period[:4]), int(period[5:7])
        except ValueError:
            return 9999
        return (today.year - y) * 12 + (today.month - m)

    aggregate_lag = _months_behind(aggregate_latest)
    if aggregate and aggregate_lag <= _EUROSTAT_FRESHNESS_THRESHOLD_MONTHS:
        logger.info(f"[retail_cpi] Eurostat EU27_2020 fresh ({aggregate_latest}, "
                    f"{aggregate_lag}mo lag) — using aggregate")
        return {
            "name":       "EU — Coffee HICP (Eurostat CP01211, EU27)",
            "source_url": "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_midx",
            "monthly":    _yoy_series(aggregate),
        }

    if aggregate:
        logger.warning(f"[retail_cpi] Eurostat EU27_2020 stale ({aggregate_latest}, "
                       f"{aggregate_lag}mo behind) — trying DE/FR/IT/ES basket fallback")
    basket = _fetch_eurostat_basket()
    if basket:
        basket_latest = basket[-1]["period"]
        logger.info(f"[retail_cpi] EU basket fallback: latest={basket_latest}, "
                    f"{len(basket)} periods")
        return {
            "name":       "EU — Coffee HICP (DE/FR/IT/ES basket proxy)",
            "source_url": "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_midx",
            "monthly":    _yoy_series(basket),
        }

    # Basket also failed — fall back to whatever aggregate we have, even stale.
    if aggregate:
        logger.warning("[retail_cpi] EU basket failed — returning stale aggregate")
        return {
            "name":       "EU — Coffee HICP (Eurostat CP01211, EU27 — stale)",
            "source_url": "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_midx",
            "monthly":    _yoy_series(aggregate),
        }
    return None


def _fetch_kc_futures() -> dict | None:
    """KC=F monthly closes from Stooq — free CSV, no auth.

    Used as the cost-pass-through reference: when KC YoY rises faster
    than the retail CPI YoYs, the trade is absorbing the spike rather
    than passing it through. When they diverge for too long, retail
    pressure eventually catches up.
    """
    url = "https://stooq.com/q/d/l/?s=kc.f&i=m"
    try:
        r = requests.get(url, headers=_HEADERS, timeout=20)
        r.raise_for_status()
        text = r.text
    except Exception as e:
        logger.warning(f"[retail_cpi] Stooq KC fetch failed: {e}")
        return None

    # CSV header: Date,Open,High,Low,Close,Volume
    lines = text.strip().splitlines()
    if len(lines) < 2:
        return None
    rows: list[dict] = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        d, close = parts[0], parts[4]
        try:
            y, m, _ = d.split("-")
            rows.append({"period": f"{y}-{m}", "index": float(close)})
        except ValueError:
            continue
    rows.sort(key=lambda r: r["period"])
    # Trim to last 15 years so the chart range matches the CPI series
    cutoff = f"{datetime.utcnow().year - 15}-01"
    rows = [r for r in rows if r["period"] >= cutoff]
    if not rows:
        return None
    return {
        "name":       "ICE KC (Arabica front-month, monthly close)",
        "source_url": "https://stooq.com/q/?s=kc.f",
        "monthly":    _yoy_series(rows),
    }


def _fetch_bcb() -> dict | None:
    """BCB SGS series 1635 — IPCA sub-item Café moído (monthly index level)."""
    url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{_BCB_SGS}/dados?formato=json"
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        rows_raw = r.json()
    except Exception as e:
        logger.warning(f"[retail_cpi] BCB SGS fetch failed: {e}")
        return None

    # rows_raw: [{"data": "01/01/2000", "valor": "..."}]
    # BCB returns the percentage change MoM, not an index. To get a level we
    # cumulate from a base of 100.
    parsed: list[tuple[str, float]] = []
    for r_ in rows_raw:
        try:
            d = r_["data"]
            day, month, year = d.split("/")
            period = f"{year}-{month}"
            pct = float(str(r_["valor"]).replace(",", "."))
        except (KeyError, ValueError):
            continue
        parsed.append((period, pct))
    parsed.sort()
    if not parsed:
        return None

    level = 100.0
    rows: list[dict] = []
    for period, pct in parsed:
        level *= 1.0 + pct / 100.0
        rows.append({"period": period, "index": round(level, 4)})

    # Trim to last 15 years for consistency with BLS/Eurostat panel range
    cutoff = f"{datetime.utcnow().year - 15}-01"
    rows = [r for r in rows if r["period"] >= cutoff]
    return {
        "name":       "Brazil — Café moído (IPCA, BCB SGS 1635)",
        "source_url": f"https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarValores&seriesEscolhidas={_BCB_SGS}",
        "monthly":    _yoy_series(rows),
    }


def _build_payload() -> dict | None:
    series: dict[str, dict] = {}

    # BLS returns multiple US coffee series (roasted + all-coffee) in one call.
    try:
        bls = _fetch_bls()
    except Exception as e:
        logger.warning(f"[retail_cpi] BLS unhandled error: {e}")
        bls = None
    if bls:
        series.update(bls)

    for key, fn in (("eu", _fetch_eurostat), ("brazil", _fetch_bcb), ("kc_futures", _fetch_kc_futures)):
        try:
            s = fn()
        except Exception as e:
            logger.warning(f"[retail_cpi] {key} unhandled error: {e}")
            s = None
        if s:
            series[key] = s

    if not series:
        return None
    return {
        "source":       "BLS + Eurostat + BCB SGS",
        "last_updated": datetime.utcnow().date().isoformat(),
        "series":       series,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        payload = _build_payload()
        if not payload:
            print("[retail_cpi] all 3 sources failed — retaining cache")
            return

        # Per-series cache retention: BLS / Eurostat / BCB fail independently,
        # and a source failing must NOT delete its series from the shipped
        # file. (A BLS 503 on 2026-08-09 wiped us/us_coffee from the JSON —
        # restored and guarded since.) The scraper cache is not tracked in
        # git, so on a fresh CI checkout fall back to the SHIPPED file, which
        # always carries the last committed series.
        prior: dict = {}
        _shipped = Path(__file__).resolve().parents[3] / "frontend" / "public" / "data" / "retail_cpi.json"
        for _src in (_CACHE_PATH, _shipped):
            try:
                prior = json.loads(_src.read_text(encoding="utf-8")).get("series") or {}
                if prior:
                    break
            except Exception:
                continue
        retained = [k for k in prior if k not in payload["series"]]
        for k in retained:
            payload["series"][k] = prior[k]
        if retained:
            print(f"[retail_cpi] retained cached series (source failed this run): "
                  f"{', '.join(sorted(retained))}")

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        n = len(payload["series"])
        names = ", ".join(payload["series"].keys())
        print(f"[retail_cpi] OK: {n} series ({names}), last_updated={payload['last_updated']}")

        if db is not None:
            # Build a headline-stat body so the news table / Telegram brief can
            # extract a meaningful data label per source — previously this read
            # "Retail coffee CPI series fetched: us, eu, brazil" with no numbers,
            # so the NewsFeed dispatcher (which keys on `source` = "Retail CPI")
            # had nothing to surface. New format includes the most-recent YoY %
            # for each region in a stable "US: X%, EU: Y%, Brazil: Z%" shape
            # that the source-specific regex in NewsFeed.tsx now matches.
            yoy_parts: list[str] = []
            for region, label in (("us", "US"), ("eu", "EU"), ("brazil", "Brazil")):
                series = payload["series"].get(region, {})
                monthly = series.get("monthly") or []
                if not monthly:
                    continue
                latest = monthly[-1]
                yoy = latest.get("yoy_pct")
                if yoy is None:
                    continue
                sign = "+" if yoy >= 0 else ""
                yoy_parts.append(f"{label}: {sign}{yoy:.2f}%")
            body = (
                "Retail coffee CPI YoY — " + ", ".join(yoy_parts)
                if yoy_parts
                else f"Retail coffee CPI series fetched: {names}"
            )

            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"Retail Coffee CPI – {payload['last_updated']}",
                "body":     body,
                "source":   "Retail CPI",
                "category": "demand",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["cpi", "retail", "demand"],
                "meta":     json.dumps(payload),
            })
    except Exception as e:
        print(f"[retail_cpi] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[retail_cpi] cache read failed: {e}")
        return None
