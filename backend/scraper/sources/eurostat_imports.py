"""
eurostat_imports.py — EU coffee imports by country of origin (Eurostat Comext).

Authoritative EU trade data: dataset ds-045409 (EU trade since 1988 by HS2-4-6),
product HS 0901 (coffee), flow 1 (imports), reporter = EU bloc, broken out by
partner (origin), annual, quantity in kg. The EU analogue of the USITC US-by-
origin view.

API (Comext dissemination, JSON-stat):
  https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409
  ?format=JSON&freq=A&reporter=<EU>&product=0901&flow=1&indicators=QUANTITY_IN_KG&time=YYYY...
No key required. Egress to ec.europa.eu must be allowed (works in CI).

Output: frontend/public/data/eu_coffee_imports.json (same shape as
us_coffee_imports.json), refreshed by .github/workflows/scraper-eurostat-imports.yml.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path

import requests

from scraper.sources._imports_util import merge_monthly, merge_origin_monthly
from scraper.validate_export import safe_write_json

log = logging.getLogger(__name__)

BASE = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409"
PRODUCT = "0901"
# Soluble coffee HS6 codes (extracts/essences/concentrates of coffee and
# preparations thereof). 2101 also covers tea/maté extracts — never fetch the
# 4-digit heading, only these coffee lines. ICO green-bean-equivalent factor
# for soluble is ×2.6 (applied in the frontend netting, not here — the JSON
# stores product weight).
SOLUBLE_CODES = ["210111", "210112"]
N_YEARS = 6
REPORTER = "EU27_2020"          # confirmed valid EU-bloc reporter code
INDICATOR = "QUANTITY_IN_100KG"  # the only quantity indicator (units = 100 kg)
KG_PER_UNIT = 100                # 100-kg units → MT = value × 100 / 1000

# Reporters broken out individually (bloc + the major EU coffee importers). For
# members we keep intra-EU origins (re-export hubs like NL/BE matter); only the
# bloc view is extra-EU. Codes are Comext `reporter` geo codes.
EU_BLOC_CODES = {"EU27_2020", "EU", "EU27", "EU28"}
EU_MEMBER_CODES = ["DE", "IT", "FR", "NL", "BE", "ES", "SE", "PL",
                   "AT", "PT", "FI", "DK", "GR", "CZ", "RO"]
REPORTER_NAMES = {
    "EU27_2020": "European Union", "DE": "Germany", "IT": "Italy", "FR": "France",
    "NL": "Netherlands", "BE": "Belgium", "ES": "Spain", "SE": "Sweden",
    "PL": "Poland", "AT": "Austria", "PT": "Portugal", "FI": "Finland",
    "DK": "Denmark", "GR": "Greece", "EL": "Greece", "CZ": "Czechia", "RO": "Romania",
}
MONTHLY_TOP_ORIGINS = 12        # cap monthly-by-origin rows per reporter

# EU member geo codes — excluded from "origins" so the view is extra-EU only
# (reporter=EU bloc + intra-EU partner would otherwise show member states).
EU_MEMBERS = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "EL",
    "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI",
    "ES", "SE",
}
# Non-country partner aggregates / blocs to skip (by code).
SKIP_PARTNERS = {
    "EU27_2020", "EU", "EU27", "EU28", "EA", "EA21", "EA20", "EA19", "WORLD",
    "EXT_EU27_2020", "EXT_EU", "INT_EU27_2020", "INTRA_EU", "EXTRA_EU", "TOTAL",
}
# Comext also returns aggregate "partners" whose codes vary by reporter (e.g.
# "Extra-euro area", "European Union", "Not specified") — catch them by name so
# they don't outrank real origins, especially for member-state reporters.
_AGG_RE = re.compile(
    r"(euro area|european union|extra[- ]?eu|intra[- ]?eu|extra[- ]?euro|intra[- ]?euro"
    r"|\bworld\b|not specified|not declared|stores and provisions|bunkers"
    r"|countries and territories|free zones|^total$|^all\b)", re.I)


def _is_aggregate(name: str) -> bool:
    return bool(_AGG_RE.search(str(name)))

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "eu_coffee_imports.json"

_HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelBot/1.0)", "Accept": "application/json"}


def _fetch(years: list[str], reporter: str = REPORTER, flow: str = "1",
           products: list[str] | None = None) -> dict:
    """One reporter's trade by partner, annual, quantity (100-kg units).
    flow: "1" = imports, "2" = exports. `products` defaults to HS 0901; a list
    yields one cube whose product dim the stride decoder sums over."""
    params = [("format", "JSON"), ("freq", "A"), ("reporter", reporter),
              ("flow", flow), ("indicators", INDICATOR)]
    params += [("product", pr) for pr in (products or [PRODUCT])]
    params += [("time", y) for y in years]
    try:
        r = requests.get(BASE, params=params, headers=_HEADERS, timeout=60)
        if r.status_code != 200:
            log.info("Eurostat HTTP %s body: %s", r.status_code, r.text[:300])
            return {}
        body = r.json()
        log.info("Eurostat HTTP 200 size=%s nval=%d", body.get("size"), len(body.get("value", {}) or {}))
        return body
    except Exception as e:
        log.error("Eurostat fetch error: %s", e)
        return {}


_RENAME = {"Viet Nam": "Vietnam", "Korea, Republic of": "South Korea",
           "Russian Federation": "Russia", "Tanzania, United Republic of": "Tanzania"}


def clean_name(label: str) -> str:
    """Eurostat partner labels carry verbose parentheticals, e.g.
    "Viet Nam (incl. North Viet Nam 'VD' from 1977)" → "Vietnam"."""
    s = re.sub(r"\s*\(.*", "", str(label)).strip() or str(label)
    return _RENAME.get(s, s)


def parse_jsonstat(body: dict, kg_per_unit: int = KG_PER_UNIT,
                   reporter_code: str = REPORTER) -> dict:
    """Decode a JSON-stat cube → {years, origins[], total_by_year} in MT.

    `kg_per_unit` converts the raw measure to kg (Comext quantity is in 100-kg
    units). For the EU bloc, intra-EU partners are excluded (extra-EU view); for
    an individual member, intra-EU origins are kept and only the member itself is
    dropped. Only `partner` and `time` vary (other dims are pinned). Pure —
    unit-tested."""
    bloc = reporter_code in EU_BLOC_CODES
    try:
        ids = body["id"]
        sizes = body["size"]
        dims = body["dimension"]
        values = body["value"]
    except (KeyError, TypeError):
        return {"years": [], "origins": [], "total_by_year": {}}
    if not values:
        return {"years": [], "origins": [], "total_by_year": {}}

    # position → code for partner and time
    def pos_to_code(dim: str) -> dict[int, str]:
        idx = dims[dim]["category"]["index"]
        if isinstance(idx, dict):
            return {v: k for k, v in idx.items()}
        return dict(enumerate(idx))

    # Dimension ids vary in case/spelling — find the partner & time dims robustly.
    def find_dim(*cands: str) -> str | None:
        for c in cands:
            if c in ids:
                return c
        for d in ids:
            if any(c in d.lower() for c in cands):
                return d
        return None

    pdim = find_dim("partner")
    tdim = find_dim("time")
    if not pdim or not tdim:
        log.warning("Eurostat parse: partner/time dim not found in ids=%s", ids)
        return {"years": [], "origins": [], "total_by_year": {}}

    partner_codes = pos_to_code(pdim)
    time_codes = pos_to_code(tdim)
    partner_labels = dims.get(pdim, {}).get("category", {}).get("label", {})

    # strides for flat-index decoding (row-major over `ids`)
    strides = [1] * len(ids)
    for i in range(len(ids) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    pi = ids.index(pdim)
    ti = ids.index(tdim)

    # Accumulate by YEAR (sum) — handles annual ("2023") and monthly ("2023-01"/
    # "202301") time codes alike via the 4-digit year prefix.
    acc: dict[str, dict[str, float]] = {}
    for flat, val in values.items():
        if val is None:
            continue
        f = int(flat)
        p_pos = (f // strides[pi]) % sizes[pi]
        t_pos = (f // strides[ti]) % sizes[ti]
        pcode = partner_codes.get(p_pos)
        ycode = time_codes.get(t_pos)
        if not pcode or not ycode:
            continue
        if pcode in SKIP_PARTNERS or (bloc and pcode in EU_MEMBERS) or (not bloc and pcode == reporter_code):
            continue
        if _is_aggregate(partner_labels.get(pcode, pcode)):
            continue
        year = str(ycode)[:4]
        try:
            mt = float(val) * kg_per_unit / 1000.0
        except (TypeError, ValueError):
            continue
        d = acc.setdefault(pcode, {})
        d[year] = round(d.get(year, 0.0) + mt, 1)

    years = sorted({int(y) for d in acc.values() for y in d}) if acc else []
    origins = []
    total_by_year: dict[str, float] = {}
    for pcode, by_year in acc.items():
        name = clean_name(partner_labels.get(pcode, pcode))
        latest = max(by_year) if by_year else None
        origins.append({"name": name, "by_year": by_year,
                        "latest_mt": by_year.get(latest) if latest else None})
        for y, v in by_year.items():
            total_by_year[y] = round(total_by_year.get(y, 0.0) + v, 1)
    origins.sort(key=lambda o: o.get("latest_mt") or 0, reverse=True)
    return {"years": years, "origins": origins, "total_by_year": total_by_year}


def _month_code(t: str) -> str | None:
    """Comext monthly time code → 'YYYY-MM' ('202401' / '2024-01' / '2024M01')."""
    digs = re.sub(r"[^0-9]", "", str(t))
    if len(digs) >= 6 and 1 <= int(digs[4:6]) <= 12:
        return f"{digs[:4]}-{digs[4:6]}"
    return None


def _fetch_monthly(last_n: int, reporter: str = REPORTER, flow: str = "1") -> dict:
    """Recent `last_n` months of one reporter's monthly HS-0901 trade by partner
    (flow "1"=imports, "2"=exports). Uses lastTimePeriod (annual time= doesn't
    expand to months); large windows trip Comext's async 413, so the caller
    steps the window down."""
    params = [("format", "JSON"), ("freq", "M"), ("reporter", reporter),
              ("product", PRODUCT), ("flow", flow), ("indicators", INDICATOR),
              ("lastTimePeriod", str(last_n))]
    try:
        r = requests.get(BASE, params=params, headers=_HEADERS, timeout=60)
        if r.status_code != 200:
            log.info("Eurostat monthly lastN=%d HTTP %s: %s", last_n, r.status_code, r.text[:160])
            return {}
        body = r.json()
        tdim = body.get("dimension", {}).get("time", {}).get("category", {}).get("index", {})
        log.info("Eurostat monthly lastN=%d size=%s nval=%d times=%s", last_n, body.get("size"),
                 len(body.get("value", {}) or {}), list(tdim)[:3])
        return body
    except Exception as e:
        log.error("Eurostat monthly fetch error lastN=%d: %s", last_n, e)
        return {}


# ── Deep monthly totals ──────────────────────────────────────────────────────
# The by-partner monthly query trips Comext's async 413 past ~40 months, which
# caps `monthly_total` at ~31 months — too short to regress EU arrivals against
# EU stock changes over more than one demand cycle. Asking for a single partner
# AGGREGATE instead of ~200 individual partners returns 185 months in under
# 9 KB, so the depth was never a Comext limit, only a payload one.
#
# Partner code matters for correctness, not just depth: `monthly_total` is
# EXTRA-EU (it drops intra-EU partners), so falling back to WORLD would fold
# intra-EU re-trade into the same series. The extra-EU aggregate is tried
# first and WORLD only as a last resort, with the choice recorded in the
# payload so the frontend can say which basis it is showing.
_EXTRA_EU_PARTNERS = ("EXT_EU27_2020", "EXTRA_EU27_2020", "WORLD")


def _fetch_monthly_partner_total(partner: str, last_n: int = 200,
                                 reporter: str = REPORTER, flow: str = "1") -> dict:
    params = [("format", "JSON"), ("freq", "M"), ("reporter", reporter),
              ("partner", partner), ("product", PRODUCT), ("flow", flow),
              ("indicators", INDICATOR), ("lastTimePeriod", str(last_n))]
    try:
        r = requests.get(BASE, params=params, headers=_HEADERS, timeout=90)
    except Exception as e:                                        # noqa: BLE001
        log.info("Eurostat deep monthly partner=%s error: %s", partner, e)
        return {}
    if r.status_code != 200:
        log.info("Eurostat deep monthly partner=%s HTTP %s", partner, r.status_code)
        return {}
    try:
        return r.json()
    except ValueError:
        return {}


def fetch_deep_monthly(flow: str = "1") -> tuple[dict, str | None]:
    """{'YYYY-MM': mt} as far back as Comext serves, plus the partner used."""
    for partner in _EXTRA_EU_PARTNERS:
        body = _fetch_monthly_partner_total(partner, flow=flow)
        dims = (body.get("dimension") or {}).get("time", {}).get("category", {}).get("index") or {}
        values = body.get("value") or {}
        if not dims or not values:
            continue
        pos_to_month = {v: k for k, v in dims.items()} if isinstance(dims, dict) else {}
        out: dict[str, float] = {}
        for pos, val in values.items():
            month = pos_to_month.get(int(pos))
            if not month or val is None:
                continue
            mt = float(val) / 10.0          # Comext quantity is 100 kg
            if mt > 0:
                out[month] = round(mt, 1)
        if out:
            log.info("Eurostat deep monthly partner=%s flow=%s → %d months (%s → %s)",
                     partner, flow, len(out), min(out), max(out))
            return dict(sorted(out.items())), partner
    log.warning("Eurostat deep monthly: no partner aggregate returned data")
    return {}, None

def parse_monthly_total(body: dict) -> dict:
    """Sum extra-EU partners per month → {'YYYY-MM': mt}. (Excludes EU members
    and bloc aggregates, like the annual parse.)"""
    try:
        ids, sizes, dims, values = body["id"], body["size"], body["dimension"], body["value"]
    except (KeyError, TypeError):
        return {}
    if not values:
        return {}

    def pos_to_code(dim: str) -> dict[int, str]:
        idx = dims[dim]["category"]["index"]
        return {v: k for k, v in idx.items()} if isinstance(idx, dict) else dict(enumerate(idx))

    def find_dim(*cands: str) -> str | None:
        for c in cands:
            if c in ids:
                return c
        return next((d for d in ids if any(c in d.lower() for c in cands)), None)

    pdim, tdim = find_dim("partner"), find_dim("time")
    if not pdim or not tdim:
        return {}
    pcodes, tcodes = pos_to_code(pdim), pos_to_code(tdim)
    strides = [1] * len(ids)
    for i in range(len(ids) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    pi, ti = ids.index(pdim), ids.index(tdim)

    out: dict[str, float] = {}
    for flat, val in values.items():
        if val is None:
            continue
        f = int(flat)
        pcode = pcodes.get((f // strides[pi]) % sizes[pi])
        tc = tcodes.get((f // strides[ti]) % sizes[ti])
        if not pcode or pcode in SKIP_PARTNERS or pcode in EU_MEMBERS:
            continue
        mk = _month_code(tc) if tc else None
        if not mk:
            continue
        try:
            out[mk] = round(out.get(mk, 0.0) + float(val) * KG_PER_UNIT / 1000.0, 1)
        except (TypeError, ValueError):
            continue
    return dict(sorted(out.items()))


def parse_monthly_origins(body: dict, reporter_code: str = REPORTER,
                          top_n: int = MONTHLY_TOP_ORIGINS) -> dict:
    """Monthly imports broken out by origin → {origin: {'YYYY-MM': mt}} for the
    top-`top_n` origins, plus a '__total__' key with the all-origin monthly sum.
    Bloc = extra-EU; member keeps intra-EU origins (drops only self)."""
    bloc = reporter_code in EU_BLOC_CODES
    try:
        ids, sizes, dims, values = body["id"], body["size"], body["dimension"], body["value"]
    except (KeyError, TypeError):
        return {}
    if not values:
        return {}

    def pos_to_code(dim: str) -> dict[int, str]:
        idx = dims[dim]["category"]["index"]
        return {v: k for k, v in idx.items()} if isinstance(idx, dict) else dict(enumerate(idx))

    def find_dim(*cands: str) -> str | None:
        for c in cands:
            if c in ids:
                return c
        return next((d for d in ids if any(c in d.lower() for c in cands)), None)

    pdim, tdim = find_dim("partner"), find_dim("time")
    if not pdim or not tdim:
        return {}
    pcodes, tcodes = pos_to_code(pdim), pos_to_code(tdim)
    plabels = dims.get(pdim, {}).get("category", {}).get("label", {})
    strides = [1] * len(ids)
    for i in range(len(ids) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    pi, ti = ids.index(pdim), ids.index(tdim)

    by_origin: dict[str, dict[str, float]] = {}
    total: dict[str, float] = {}
    for flat, val in values.items():
        if val is None:
            continue
        f = int(flat)
        pcode = pcodes.get((f // strides[pi]) % sizes[pi])
        tc = tcodes.get((f // strides[ti]) % sizes[ti])
        if not pcode or pcode in SKIP_PARTNERS or (bloc and pcode in EU_MEMBERS) or (not bloc and pcode == reporter_code):
            continue
        if _is_aggregate(plabels.get(pcode, pcode)):
            continue
        mk = _month_code(tc) if tc else None
        if not mk:
            continue
        try:
            mt = round(float(val) * KG_PER_UNIT / 1000.0, 1)
        except (TypeError, ValueError):
            continue
        name = clean_name(plabels.get(pcode, pcode))
        by_origin.setdefault(name, {})[mk] = round(by_origin.get(name, {}).get(mk, 0.0) + mt, 1)
        total[mk] = round(total.get(mk, 0.0) + mt, 1)

    ranked = sorted(by_origin.items(),
                    key=lambda kv: sum(kv[1].values()), reverse=True)[:top_n]
    out = {name: dict(sorted(m.items())) for name, m in ranked}
    out["__total__"] = dict(sorted(total.items()))
    return out


# ── German roasting-trade detail (Kaffeesteuer cross-check) ──────────────────
# The Kaffeesteuer is levied per kg on coffee RELEASED FOR CONSUMPTION in
# Germany; exports are exempt/refunded. To separate "real domestic demand" from
# "roasting for re-export", we need Germany's monthly HS6 trade split: green
# (0901.11/.12) vs roasted (0901.21/.22), imports vs exports. Same Comext
# dataset, flow=1 imports / flow=2 exports. Written to de_coffee_trade.json.

DE_TRADE_OUT = Path(__file__).parents[3] / "frontend" / "public" / "data" / "de_coffee_trade.json"
_DE = "DE"
_HS6_GROUPS = {"green": ["090111", "090112"], "roasted": ["090121", "090122"]}
_FLOWS = {"imports": "1", "exports": "2"}


def _fetch_monthly_products(reporter: str, products: list[str], flow: str, last_n: int) -> dict:
    """Monthly quantity for a reporter × HS6-product-list × flow. Repeated
    `product` params return one cube whose product dim the parser sums over."""
    params = [("format", "JSON"), ("freq", "M"), ("reporter", reporter),
              ("flow", flow), ("indicators", INDICATOR),
              ("lastTimePeriod", str(last_n))]
    params += [("product", p) for p in products]
    try:
        r = requests.get(BASE, params=params, headers=_HEADERS, timeout=60)
        if r.status_code != 200:
            log.info("Eurostat DE-trade %s flow=%s lastN=%d HTTP %s: %s",
                     "+".join(products), flow, last_n, r.status_code, r.text[:160])
            return {}
        return r.json()
    except Exception as e:
        log.error("Eurostat DE-trade fetch error flow=%s lastN=%d: %s", flow, last_n, e)
        return {}


def build_de_coffee_trade() -> dict:
    """Germany's monthly green/roasted × import/export series (MT), archived
    with merge-on-write like the other monthly feeds."""
    series: dict[str, dict] = {}
    for grp, codes in _HS6_GROUPS.items():
        for flow_name, flow_code in _FLOWS.items():
            key = f"{grp}_{flow_name}"
            months: dict = {}
            for last_n in (40, 36, 30, 24, 18, 12):
                body = _fetch_monthly_products(_DE, codes, flow_code, last_n)
                # parse_monthly_origins with a member reporter keeps intra-EU
                # partners (vital: German re-exports go mostly to EU neighbours)
                # and sums the product dim implicitly; __total__ = world total.
                months = parse_monthly_origins(body, reporter_code=_DE).get("__total__", {})
                log.info("DE trade %s lastN=%d → %d months", key, last_n, len(months))
                if months:
                    break
            series[key] = {k: v for k, v in sorted(months.items()) if v > 0}

    if DE_TRADE_OUT.exists():  # archive: extend history, never shrink it
        try:
            prev = json.loads(DE_TRADE_OUT.read_text(encoding="utf-8")).get("series", {})
        except Exception:
            prev = {}
        for key in set(series) | set(prev):
            series[key] = merge_monthly(prev.get(key), series.get(key))

    out = {
        "updated":  datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":   "Eurostat Comext ds-045409 — Germany HS6 coffee trade, monthly quantity (100kg→MT)",
        "reporter": _DE,
        "hs6":      _HS6_GROUPS,
        "measure":  "quantity_mt",
        "series":   series,
    }
    if any(series.values()):
        DE_TRADE_OUT.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(DE_TRADE_OUT, out, ensure_ascii=False)
        log.info("de_coffee_trade.json written: %s",
                 {k: len(v) for k, v in series.items()})
    else:
        log.warning("de_coffee_trade: nothing fetched; keeping existing file")
    return out


# ── Comtrade EU-bloc (for the EU↔Comtrade reconciliation) ─────────────────────
# Comtrade re-publishes national stats with a lag; for the EU bloc, imports
# "from World" are extra-EU (intra-EU is internal). We pull that here so the UI
# can show the systematic gap vs Eurostat. Kept on this (reliable) workflow as a
# single reporter pull, rather than the throttled 42-country coffee_imports run.
_COMTRADE_REF = "https://comtradeapi.un.org/files/v1/app/reference/Reporters.json"


def _comtrade_eu_total_by_year() -> dict:
    try:
        ref = requests.get(_COMTRADE_REF, headers=_HEADERS, timeout=30)
        ref.raise_for_status()
        rows = ref.json().get("results") or ref.json()
    except Exception as e:
        log.warning("Comtrade EU reporter ref failed: %s", e)
        return {}
    cands = []
    for x in rows:
        code = str(x.get("id") or x.get("reporterCode") or "").strip()
        text = str(x.get("text") or x.get("reporterDesc") or "")
        if code and ("european union" in text.lower() or text.strip() in ("EU", "EU-27", "EU-28", "EU27_2020")):
            cands.append((code, text))
    log.info("Comtrade EU reporter candidates: %s", cands[:6])
    if not cands:
        return {}
    # Prefer the EU27_2020 / newest "European Union" entry.
    cands.sort(key=lambda c: ("27_2020" in c[1], "27" in c[1], "european union" in c[1].lower()), reverse=True)
    eu_code = cands[0][0]
    try:
        from scraper.sources import coffee_imports as ci
        now = datetime.utcnow()
        periods = ",".join(reversed([str(now.year - 1 - i) for i in range(12)]))
        annual = ci.parse_country_rows(ci._comtrade_annual(eu_code, periods))  # noqa: SLF001
        by_year = {str(r["year"]): r["total_mt"] for r in annual if r.get("total_mt")}
        # The EU is not a sovereign Comtrade reporter, so the aggregate carries
        # little/no data (members report individually). Treat a near-empty
        # series (≪ EU's ~3 Mt) as "unavailable" rather than store noise.
        if not by_year or max(by_year.values()) < 100_000:
            log.info("Comtrade EU-bloc (reporter=%s) negligible (%s) — no usable EU series",
                     eu_code, {k: round(v) for k, v in by_year.items()})
            return {}
        log.info("Comtrade EU-bloc (reporter=%s) → %d years", eu_code, len(by_year))
        return by_year
    except Exception as e:
        log.warning("Comtrade EU-bloc fetch failed: %s", e)
        return {}


def _build_reporter(code: str, years: list[str], monthly_steps: tuple[int, ...]) -> dict | None:
    """One reporter's block: annual origins (with monthly attached to the top
    origins) + monthly_total. Returns None if the reporter has no usable data."""
    parsed = parse_jsonstat(_fetch(years, code), reporter_code=code)
    if not parsed["origins"]:
        log.info("Eurostat reporter=%s: no origins", code)
        return None

    mo: dict = {}
    for last_n in monthly_steps:
        mo = parse_monthly_origins(_fetch_monthly(last_n, code), reporter_code=code)
        tot = mo.get("__total__", {})
        log.info("Eurostat reporter=%s monthly lastN=%d → %d origins, %d months",
                 code, last_n, max(0, len(mo) - 1), len(tot))
        if len(mo) > 1:   # more than just __total__
            break
    monthly_total = {k: v for k, v in sorted(mo.pop("__total__", {}).items()) if v > 0}

    origins = []
    for o in parsed["origins"]:
        oo = dict(o)
        m = mo.get(o["name"])
        if m:
            oo["monthly"] = m
        origins.append(oo)

    log.info("Eurostat reporter=%s → %d origins, %d monthly pts, %d monthly origins",
             code, len(origins), len(monthly_total), len(mo))
    return {
        "name":          REPORTER_NAMES.get(code, clean_name(parsed.get("name", code))),
        "years":         parsed["years"],
        "origins":       origins,
        "total_by_year": parsed["total_by_year"],
        "monthly_total": monthly_total,
    }


def build_eu_coffee_imports(db=None) -> dict:  # noqa: ARG001
    now = datetime.utcnow()
    years = list(reversed([str(now.year - 1 - i) for i in range(N_YEARS)]))

    # EU bloc (extra-EU) — also the backward-compatible top-level series.
    bloc = _build_reporter(REPORTER, years, (40, 36, 30, 24, 18, 12))
    if bloc is None:
        log.warning("eurostat_imports: no bloc origins parsed; retaining existing file")
        if OUT_PATH.exists():
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))

    reporters: dict[str, dict] = {REPORTER: bloc}
    for code in EU_MEMBER_CODES:
        block = _build_reporter(code, years, (40, 36, 30, 24, 18, 12))
        if block:
            reporters[code] = block
    log.info("Eurostat: %d reporters (bloc + %d members)", len(reporters), len(reporters) - 1)

    # Archive: merge each reporter's monthly series (per-reporter total + per
    # origin) into the previously-committed history so old months persist as the
    # lastTimePeriod window rolls forward.
    if OUT_PATH.exists():
        try:
            prev_reporters = json.loads(OUT_PATH.read_text(encoding="utf-8")).get("reporters", {})
        except Exception:
            prev_reporters = {}
        for code, rep in reporters.items():
            prev = prev_reporters.get(code) or {}
            rep["monthly_total"] = merge_monthly(prev.get("monthly_total"), rep.get("monthly_total"))
            merge_origin_monthly(prev.get("origins"), rep["origins"])

    # Extra-EU EXPORTS of the bloc (flow=2) — the EU's re-exports/value-added
    # shipments to the rest of the world. Needed for NET imports: at bloc level
    # intra-EU flows cancel, so net = extra-EU imports − extra-EU exports.
    exp_parsed = parse_jsonstat(_fetch(years, REPORTER, flow="2"))
    exports_total_by_year = exp_parsed["total_by_year"]
    monthly_exports: dict = {}
    for last_n in (40, 36, 30, 24, 18, 12):
        monthly_exports = parse_monthly_total(_fetch_monthly(last_n, REPORTER, flow="2"))
        log.info("Eurostat bloc EXPORTS lastN=%d → %d months", last_n, len(monthly_exports))
        if monthly_exports:
            break
    monthly_exports = {k: v for k, v in sorted(monthly_exports.items()) if v > 0}

    # Long monthly arrivals series for the arrivals-vs-stock-change scatter.
    # Separate from monthly_total because that one is capped by the by-partner
    # query's payload limit; this one asks for a single aggregate and reaches
    # back to 2011.
    deep_monthly, deep_partner = fetch_deep_monthly(flow="1")
    if OUT_PATH.exists():
        try:
            prev_all = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            prev_all = {}
        exports_total_by_year = {**(prev_all.get("exports_total_by_year") or {}), **exports_total_by_year}
        monthly_exports = merge_monthly(prev_all.get("monthly_exports"), monthly_exports)
    log.info("Eurostat bloc exports: %d years, %d monthly pts",
             len(exports_total_by_year), len(monthly_exports))

    # SOLUBLE exports (HS 2101.11/.12, product weight MT). The EU exports a lot
    # of instant coffee; netting only HS 0901 understates re-exports. The GBE
    # conversion (×2.6) happens in the frontend so the stored series stays raw.
    sol_parsed = parse_jsonstat(_fetch(years, REPORTER, flow="2", products=SOLUBLE_CODES))
    exports_soluble_by_year = sol_parsed["total_by_year"]
    monthly_exports_soluble: dict = {}
    for last_n in (40, 36, 30, 24, 18, 12):
        monthly_exports_soluble = parse_monthly_total(
            _fetch_monthly_products(REPORTER, SOLUBLE_CODES, "2", last_n))
        log.info("Eurostat bloc SOLUBLE exports lastN=%d → %d months",
                 last_n, len(monthly_exports_soluble))
        if monthly_exports_soluble:
            break
    monthly_exports_soluble = {k: v for k, v in sorted(monthly_exports_soluble.items()) if v > 0}
    if OUT_PATH.exists():
        try:
            prev_all2 = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            prev_all2 = {}
        exports_soluble_by_year = {**(prev_all2.get("exports_soluble_by_year") or {}),
                                   **exports_soluble_by_year}
        monthly_exports_soluble = merge_monthly(prev_all2.get("monthly_exports_soluble"),
                                                monthly_exports_soluble)
    log.info("Eurostat bloc soluble exports: %d years, %d monthly pts",
             len(exports_soluble_by_year), len(monthly_exports_soluble))

    # SOLUBLE imports (flow=1) — the symmetric term: the EU also imports
    # instant coffee (Brazil/Vietnam/India). A GBE-honest net needs it on the
    # import side just as soluble exports are netted off.
    soli_parsed = parse_jsonstat(_fetch(years, REPORTER, flow="1", products=SOLUBLE_CODES))
    imports_soluble_by_year = soli_parsed["total_by_year"]
    monthly_imports_soluble: dict = {}
    for last_n in (40, 36, 30, 24, 18, 12):
        monthly_imports_soluble = parse_monthly_total(
            _fetch_monthly_products(REPORTER, SOLUBLE_CODES, "1", last_n))
        log.info("Eurostat bloc SOLUBLE imports lastN=%d → %d months",
                 last_n, len(monthly_imports_soluble))
        if monthly_imports_soluble:
            break
    monthly_imports_soluble = {k: v for k, v in sorted(monthly_imports_soluble.items()) if v > 0}
    if OUT_PATH.exists():
        try:
            prev_all3 = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            prev_all3 = {}
        imports_soluble_by_year = {**(prev_all3.get("imports_soluble_by_year") or {}),
                                   **imports_soluble_by_year}
        monthly_imports_soluble = merge_monthly(prev_all3.get("monthly_imports_soluble"),
                                                monthly_imports_soluble)

    comtrade_by_year = _comtrade_eu_total_by_year()

    out = {
        "updated":       now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":        "Eurostat Comext ds-045409 — HS 0901 imports by origin, quantity (100kg→MT)",
        "hts":           PRODUCT,
        "measure":       "quantity_mt",
        "is_seed":       False,
        # Top-level = EU bloc (extra-EU), kept for backward compatibility.
        "years":         bloc["years"],
        "origins":       bloc["origins"],
        "total_by_year": bloc["total_by_year"],
        "monthly_total": bloc["monthly_total"],
        # Deep monthly arrivals (single partner aggregate, ~2011 onward) plus
        # the aggregate actually used, so the UI can name its basis honestly
        # rather than implying extra-EU when it fell back to WORLD.
        "monthly_total_deep": deep_monthly,
        "monthly_total_deep_partner": deep_partner,
        # Extra-EU exports (flow=2) — net imports = total_by_year − exports_total_by_year.
        "exports_total_by_year": exports_total_by_year,
        "monthly_exports": monthly_exports,
        # Soluble trade (HS 2101.11/.12, PRODUCT weight — apply ×2.6 GBE downstream).
        "exports_soluble_by_year": exports_soluble_by_year,
        "monthly_exports_soluble": monthly_exports_soluble,
        "imports_soluble_by_year": imports_soluble_by_year,
        "monthly_imports_soluble": monthly_imports_soluble,
        "comtrade_total_by_year": comtrade_by_year,   # EU-bloc extra-EU, for reconciliation
        # Per-reporter breakdown: bloc + individual member states.
        "reporters":     reporters,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(OUT_PATH, out, ensure_ascii=False)
    log.info("eu_coffee_imports.json written: %d reporters, bloc %d origins",
             len(reporters), len(bloc["origins"]))

    # German HS6 roasting-trade detail (Kaffeesteuer cross-check) — own file;
    # never let its failure sink the main EU build.
    try:
        build_de_coffee_trade()
    except Exception as e:  # noqa: BLE001
        log.error("de_coffee_trade build failed: %s", e)
    return out


async def run(page, db=None) -> None:  # noqa: ARG001
    build_eu_coffee_imports(db)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    res = build_eu_coffee_imports()
    print(f"Done. {len(res.get('origins', []))} origins → {OUT_PATH}")
