"""
origin_prices_history.py
Accumulates daily local farmgate prices per coffee origin into a single
JSON file. Each export run appends today's row if not already present.

Brazil (Arabica + Conilon) bootstraps from BCB SGS — Brazilian Central
Bank's Sistema Gerenciador de Séries, which mirrors CEPEA/ESALQ daily
indicators back to ~1996. Vietnam and Uganda accumulate forward from the
day this module first runs; backfill for those origins is deferred to a
follow-up (UCDA bulletins for UG; user-supplied file for VN).

This module reads-then-writes so it MUST NOT run before the upstream
files it depends on (vn_physical_prices.json, uganda_supply.json,
brazil_arabica_fisico.json, brazil_conilon_vitoria.json) are themselves
up-to-date for the day.
"""

import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

from scraper.validate_export import safe_write_json

ROOT     = Path(__file__).resolve().parents[3]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "origin_prices_history.json"

# BCB SGS series codes — daily CEPEA/ESALQ mirror, R$/saca de 60kg.
SGS_ARABICA = 4332  # Café Arábica — São Paulo SP indicator (Cooxupé / Garça basis)
BACKFILL_YEARS = 2

# Some Brazilian government endpoints reject bare-Python user agents (egress
# from GH Actions runners has hit 403 with no UA). A standard browser UA
# gets us through.
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.7",
}

ORIGINS = {
    "vietnam": {
        "name":      "Vietnam Robusta FAQ Grade 2 (Dak Lak)",
        "source":    "Giacaphe.com",
        "currency":  "VND",
        "unit":      "per_kg",
        "color":     "#06b6d4",
        "commodity": "robusta",
    },
    "brazil_conilon": {
        "name":      "Brazil Conilon Tipo 7 (Cooabriel)",
        "source":    "noticiasagricolas — Vitória-ES disponível (Cooabriel T7)",
        "currency":  "BRL",
        "unit":      "per_saca_60kg",
        "color":     "#10b981",
        "commodity": "robusta",
    },
    "uganda": {
        "name":      "Uganda Robusta Screen 15 (UCDA)",
        "source":    "Uganda Coffee Development Authority",
        "currency":  "USD",
        "unit":      "cents_lb",
        "color":     "#f59e0b",
        "commodity": "robusta",
    },
    "brazil_arabica": {
        "name":      "Brazil Arabica Físico Tipo 6/7",
        "source":    "noticiasagricolas (município trimmed mean)",
        "currency":  "BRL",
        "unit":      "per_saca_60kg",
        "color":     "#a855f7",
        "commodity": "arabica",
    },
    "uganda_drugar": {
        "name":      "Uganda Drugar (UCDA)",
        "source":    "Uganda Coffee Development Authority",
        "currency":  "USD",
        "unit":      "cents_lb",
        "color":     "#ec4899",
        "commodity": "arabica",
    },
    "uganda_wugar": {
        "name":      "Uganda Wugar (UCDA)",
        "source":    "Uganda Coffee Development Authority",
        "currency":  "USD",
        "unit":      "cents_lb",
        "color":     "#14b8a6",
        "commodity": "arabica",
    },
    "guatemala_prima_lavado": {
        "name":      "Guatemala Prima Lavado (ANACAFE)",
        "source":    "ANACAFE precios de referencia",
        "currency":  "GTQ",
        "unit":      "per_quintal_100lb",
        "color":     "#f97316",
        "commodity": "arabica",
    },
    "guatemala_duro": {
        "name":      "Guatemala Duro (ANACAFE)",
        "source":    "ANACAFE precios de referencia",
        "currency":  "GTQ",
        "unit":      "per_quintal_100lb",
        "color":     "#eab308",
        "commodity": "arabica",
    },
    "guatemala_estrictamente_duro": {
        "name":      "Guatemala Estrictamente Duro / SHB (ANACAFE)",
        "source":    "ANACAFE precios de referencia",
        "currency":  "GTQ",
        "unit":      "per_quintal_100lb",
        "color":     "#ef4444",
        "commodity": "arabica",
    },
}

# Guatemala origin key → ANACAFE grade key in the NewsItem meta.
_GUATEMALA_GRADES = {
    "guatemala_prima_lavado":       "prima_lavado",
    "guatemala_duro":               "duro",
    "guatemala_estrictamente_duro": "estrictamente_duro",
}


def _load_existing() -> dict:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[origin_prices_history] failed to parse {OUT_PATH}: {e} — starting from empty",
                  file=sys.stderr, flush=True)
            return {}
    return {}


def _fetch_bcb_sgs(series_code: int, lookback_years: int = BACKFILL_YEARS) -> list[dict]:
    """Fetch a daily series from BCB SGS as [{date: YYYY-MM-DD, value: float}].

    Loud error logging — when this returns empty we want to know why on the
    next CI run rather than silently shipping a 1-row Brazil history again
    (PR #44 hit exactly that failure mode and produced no diagnostic output).
    """
    today = date.today()
    start = today - timedelta(days=lookback_years * 365)
    url = (
        f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{series_code}/dados"
        f"?formato=json"
        f"&dataInicial={start.strftime('%d/%m/%Y')}"
        f"&dataFinal={today.strftime('%d/%m/%Y')}"
    )
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            status = resp.status
            body   = resp.read().decode("utf-8", errors="replace")
        if status != 200:
            print(f"  BCB SGS {series_code} → HTTP {status} (body len={len(body)})")
            return []
        try:
            raw = json.loads(body)
        except json.JSONDecodeError as e:
            snippet = body[:200].replace("\n", " ")
            print(f"  BCB SGS {series_code} → JSON parse FAILED: {e}; body[:200]={snippet!r}")
            return []
        if not isinstance(raw, list) or not raw:
            print(f"  BCB SGS {series_code} → unexpected payload shape (len={len(raw) if hasattr(raw,'__len__') else '?'})")
            return []
        out: list[dict] = []
        for r in raw:
            try:
                iso = datetime.strptime(r["data"], "%d/%m/%Y").date().isoformat()
                v   = float(str(r["valor"]).replace(",", "."))
                out.append({"date": iso, "value": v})
            except Exception as e:
                print(f"  BCB SGS {series_code} → row parse skip ({e}): {r!r}")
                continue
        print(f"  BCB SGS {series_code} → {len(out)} rows over {lookback_years}y")
        return out
    except urllib.error.HTTPError as e:
        print(f"  BCB SGS {series_code} → HTTPError {e.code}: {e.reason}")
        return []
    except urllib.error.URLError as e:
        print(f"  BCB SGS {series_code} → URLError: {e.reason}")
        return []
    except Exception as e:
        print(f"  BCB SGS {series_code} → FAILED ({type(e).__name__}): {e}")
        return []


def _backfill_from_sgs(history: list[dict], series_code: int, label: str) -> list[dict]:
    """If we have fewer than 30 days, pull the full BCB SGS series."""
    if len(history) >= 30:
        return history
    print(f"  {label} → backfilling from BCB SGS {series_code} ({BACKFILL_YEARS}y)...")
    fetched = _fetch_bcb_sgs(series_code)
    if not fetched:
        return history
    by_date = {h["date"]: h for h in history}
    for row in fetched:
        if row["date"] not in by_date:
            by_date[row["date"]] = {"date": row["date"], "price": row["value"]}
    merged = sorted(by_date.values(), key=lambda r: r["date"])
    print(f"  {label} → {len(merged)} rows after backfill")
    return merged


def _today_vn_price() -> float | None:
    p = ROOT / "frontend" / "public" / "data" / "vn_physical_prices.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        v = d.get("vn_faq", {}).get("vnd_per_kg")
        return float(v) if v else None
    except Exception as e:
        print(f"[origin_prices_history] vn_price unavailable from {p}: {e}",
              file=sys.stderr, flush=True)
        return None


def _brazil_conilon_dated() -> tuple[str | None, float | None]:
    """(trading_date, price) for Conilon Tipo 7, from the Vitória-ES archive.

    Previously this read the latest Cooabriel NewsItem and the caller stamped
    it with the RUN date. Cooabriel publishes the prior session's quote, so
    every point landed one trading day late: checked against the same quote as
    republished by noticiasagricolas over a 62-day overlap, same-date agreement
    was 17/62 (mean |err| R$10.08) but 60/62 at a one-day shift (R$0.24). Reading
    the republished table instead carries the page's own Fechamento date, so the
    point is filed under the session it belongs to.
    """
    from scraper.sources.brazil_conilon_vitoria import latest_cooabriel_t7
    try:
        return latest_cooabriel_t7()
    except Exception as e:
        print(f"[origin_prices_history] brazil_conilon unavailable from Vitória archive: {e}",
              file=sys.stderr, flush=True)
        return None, None


def _today_brazil_arabica_price(db) -> float | None:
    """Brazil Arabica display price = the físico (Tipo 6/7) trimmed mean.

    Reads brazil_arabica_fisico.json (written earlier in the same export run by
    export_brazil_arabica_fisico), which keeps every município quote and derives
    the trimmed mean (drop highest+lowest, average the rest). `db` is unused —
    kept for signature parity with the other _today_* helpers."""
    try:
        from scraper.sources.brazil_arabica_fisico import latest_trimmed_mean
        return latest_trimmed_mean()
    except Exception as e:
        print(f"[origin_prices_history] brazil_arabica trimmed mean unavailable: {e}",
              file=sys.stderr, flush=True)
        return None


def _today_uganda_price() -> float | None:
    """Read today's UCDA Screen 15 farmgate price from uganda_supply.json."""
    p = ROOT / "frontend" / "public" / "data" / "uganda_supply.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        v = d.get("ucda_price", {}).get("usd_cwt")
        return float(v) if v else None
    except Exception as e:
        print(f"[origin_prices_history] uganda_price unavailable from {p}: {e}",
              file=sys.stderr, flush=True)
        return None


def _today_uganda_arabica_price(grade_names: list[str]) -> float | None:
    """Read a UCDA arabica grade daily farmgate price (USD/cwt) from the UCDA
    homepage table captured in uganda_supply.json → ucda_price.grades. Used for
    Drugar / Wugar (scraped alongside Robusta Screen 15 in one pass). Returns
    None when the grade isn't listed that day."""
    p = ROOT / "frontend" / "public" / "data" / "uganda_supply.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        grades = (d.get("ucda_price") or {}).get("grades") or {}
        for name in grade_names:
            for gk, gv in grades.items():
                if gk.lower() == name.lower() and gv:
                    return float(gv)
        return None
    except Exception as e:
        print(f"[origin_prices_history] uganda arabica price unavailable from {p}: {e}",
              file=sys.stderr, flush=True)
        return None


def _today_guatemala_grades(db) -> dict:
    """Read today's ANACAFE café-oro reference prices (GTQ per 100-lb quintal)
    from the latest ANACAFE NewsItem meta → grades_gtq_quintal."""
    try:
        from models import NewsItem
        item = (db.query(NewsItem)
                  .filter(NewsItem.source == "ANACAFE")
                  .order_by(NewsItem.pub_date.desc()).first())
        if not item:
            return {}
        return (json.loads(item.meta or "{}").get("grades_gtq_quintal") or {})
    except Exception as e:
        print(f"[origin_prices_history] guatemala prices unavailable from ANACAFE NewsItem: {e}",
              file=sys.stderr, flush=True)
        return {}


def _append_point(history: list[dict], date_iso: str, price: float | None) -> list[dict]:
    """Append `price` under `date_iso` (usually today, but sources that carry
    their own trading date pass that instead). No-op if the date is present."""
    if price is None:
        return history
    if any(h["date"] == date_iso for h in history):
        return history
    history.append({"date": date_iso, "price": price})
    return sorted(history, key=lambda r: r["date"])


def export_origin_prices_history(db) -> None:
    """Build/update origin_prices_history.json — backfill Brazil, accumulate VN/UG."""
    existing = _load_existing()
    origins  = existing.get("origins") or {}
    today    = date.today().isoformat()

    # Migrate legacy "brazil" key (Conilon only) from PR #44 → brazil_conilon.
    if "brazil" in origins and "brazil_conilon" not in origins:
        origins["brazil_conilon"] = origins.pop("brazil")

    # Seed origin slots with their static metadata; preserve existing history.
    for key, cfg in ORIGINS.items():
        slot = origins.get(key) or {}
        slot["name"]      = cfg["name"]
        slot["source"]    = cfg["source"]
        slot["currency"]  = cfg["currency"]
        slot["unit"]      = cfg["unit"]
        slot["color"]     = cfg["color"]
        slot["commodity"] = cfg["commodity"]
        slot["history"]   = slot.get("history") or []
        origins[key] = slot

    # Drop any obsolete keys (e.g. the migrated-away "brazil") to keep file clean.
    for key in list(origins.keys()):
        if key not in ORIGINS:
            del origins[key]

    # Vietnam — append today's snapshot.
    origins["vietnam"]["history"] = _append_point(
        origins["vietnam"]["history"], today, _today_vn_price()
    )

    # Brazil Conilon — append the latest Cooabriel Tipo 7 under its own trading
    # date (see _brazil_conilon_dated). The SGS 4333 backfill is deliberately
    # NOT run here: it is as dead as its arabica sibling (this history stayed
    # 90 days long under it), and now that the series is seeded from the
    # Vitória archive a revived SGS would splice the CEPEA conilon *indicator*
    # — a different quote — into a history labelled Cooabriel T7.
    conilon_date, conilon_price = _brazil_conilon_dated()
    origins["brazil_conilon"]["history"] = _append_point(
        origins["brazil_conilon"]["history"], conilon_date or today, conilon_price
    )

    # Brazil Arabica — append today's CEPEA/ESALQ price (when the cepea
    # scraper has run today) and backfill from BCB SGS 4332 on first run.
    # The backfill went stale in production (SGS 4332 has been returning
    # empty since at least the 18 May 2026 daily run — visible in
    # origin_prices_history.json where brazil_arabica.history was []),
    # so the daily CEPEA news item is now the primary source.
    origins["brazil_arabica"]["history"] = _append_point(
        origins["brazil_arabica"]["history"], today, _today_brazil_arabica_price(db)
    )
    origins["brazil_arabica"]["history"] = _backfill_from_sgs(
        origins["brazil_arabica"]["history"], SGS_ARABICA, "brazil_arabica"
    )

    # Uganda — append today's UCDA Screen 15 (robusta) + Drugar / Wugar (arabica).
    origins["uganda"]["history"] = _append_point(
        origins["uganda"]["history"], today, _today_uganda_price()
    )
    origins["uganda_drugar"]["history"] = _append_point(
        origins["uganda_drugar"]["history"], today, _today_uganda_arabica_price(["Drugar"])
    )
    origins["uganda_wugar"]["history"] = _append_point(
        origins["uganda_wugar"]["history"], today, _today_uganda_arabica_price(["Wugar"])
    )

    # Guatemala — ANACAFE reference prices per grade (USD per 100-lb quintal).
    gua_grades = _today_guatemala_grades(db)
    for origin_key, grade_key in _GUATEMALA_GRADES.items():
        origins[origin_key]["history"] = _append_point(
            origins[origin_key]["history"], today, gua_grades.get(grade_key)
        )

    payload = {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "origins":    origins,
    }
    safe_write_json(OUT_PATH, payload, ensure_ascii=False)
    total = sum(len(v.get("history", [])) for v in origins.values())
    print(f"  origin_prices_history.json → {total} total rows across {len(origins)} origins")
