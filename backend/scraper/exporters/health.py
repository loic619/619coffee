"""Health/freshness manifest export."""
import json
from datetime import date, datetime

from models import (
    CommodityCot,
    CotWeekly,
    FertilizerImport,
    FreightRate,
    NewsItem,
    WeatherSnapshot,
)
from scraper.exporters import base as _base
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import (
    safe_write_json,
    validate_health,
)


def export_health(
    db,
    *,
    exporters_published_at: dict[str, str] | None = None,
    known_exporters: set[str] | None = None,
) -> None:
    """Write health.json: last successful DB write per scraper + last
    successful publish per exporter topic.

    `exporters_published_at` is the map the orchestrator builds during
    its per-topic loop ({topic: iso_ts} for topics that published on
    this run). Topics that didn't run on this invocation (because the
    --only slice excluded them, or because they raised) keep their
    previous timestamp from the existing health.json — preserved by a
    defensive merge below, so a 1-topic --only run doesn't blow away
    the other topics' freshness signals.

    `known_exporters` is the orchestrator's full topic registry. That
    merge keeps a previous timestamp forever, which is right for a topic
    that merely didn't run — and wrong for one that has been DELETED: its
    last stamp ages without limit and the 1.5 freshness check alerts on it
    every day, because that check reads whatever keys this map contains and
    cannot know which still exist. Passing the registry lets the two cases
    be told apart. Omit it to skip pruning.
    """

    def _ts(val) -> str | None:
        if val is None:
            return None
        return val.isoformat() if isinstance(val, (date, datetime)) else str(val)

    def _supply_ts(filename: str) -> str | None:
        """Read scraped_at/updated from a supply JSON file written earlier in this run."""
        try:
            p = OUT_DIR / filename
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("scraped_at") or d.get("updated")
        except Exception:
            pass
        return None

    scrapers: dict[str, str | None] = {}

    # Futures (Barchart)
    items = db.query(NewsItem).filter(NewsItem.meta.isnot(None)).order_by(NewsItem.pub_date.desc()).limit(50).all()
    fi = next((i for i in items if "futures" in (i.tags or []) and "price" in (i.tags or [])), None)
    scrapers["futures"] = _ts(fi.pub_date) if fi else None

    # COT (coffee)
    row = db.query(CotWeekly).order_by(CotWeekly.date.desc()).first()
    scrapers["cot"] = _ts(row.date) if row else None

    # Macro COT
    row = db.query(CommodityCot).order_by(CommodityCot.date.desc()).first()
    scrapers["macro_cot"] = _ts(row.date) if row else None

    # Freight
    row = db.query(FreightRate).order_by(FreightRate.date.desc()).first()
    scrapers["freight"] = _ts(row.date) if row else None

    # Weather (Brazil regions)
    row = db.query(WeatherSnapshot).order_by(WeatherSnapshot.scraped_at.desc()).first()
    scrapers["weather"] = _ts(row.scraped_at) if row else None

    # ENSO / ONI
    item = db.query(NewsItem).filter(NewsItem.source == "NOAA CPC").order_by(NewsItem.pub_date.desc()).first()
    scrapers["enso"] = _ts(item.pub_date) if item else None

    # Fertilizer — World Bank
    item = db.query(NewsItem).filter(NewsItem.source == "World Bank").order_by(NewsItem.pub_date.desc()).first()
    scrapers["fertilizer_wb"] = _ts(item.pub_date) if item else None

    # Fertilizer — Comex imports
    row = db.query(FertilizerImport).order_by(FertilizerImport.scraped_at.desc()).first()
    scrapers["fertilizer_comex"] = _ts(row.scraped_at) if row else None

    # ECF European port stocks. The PDF-history pipeline (ecf_history.json,
    # workflow-updated) is the live path; the legacy NewsItem row from the old
    # HTML parse stopped updating and made a healthy feed look stale (80d in
    # Jul-2026 while ecf_history had refreshed 26d earlier). Prefer the
    # pipeline's own last_updated; fall back to the NewsItem for old deploys.
    def _ecf_ts() -> str | None:
        try:
            p = OUT_DIR / "ecf_history.json"
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8")).get("last_updated")
        except Exception:
            pass
        return None
    item = db.query(NewsItem).filter(NewsItem.source == "ECF").order_by(NewsItem.pub_date.desc()).first()
    scrapers["ecf"] = _ecf_ts() or (_ts(item.pub_date) if item else None)

    # USDA PSD coffee (EU + Japan, annual, from DB — cache file doesn't survive cross-job)
    item = db.query(NewsItem).filter(NewsItem.source == "PSD Coffee").order_by(NewsItem.pub_date.desc()).first()
    scrapers["psd_coffee"] = _ts(item.pub_date) if item else None

    # World Bank population (annual, from DB — the cache file is gitignored and
    # doesn't survive cross-job, same as PSD above). It had NO health row at
    # all, which is how demand_stocks.json shipped populations: null without
    # anyone noticing — the demand tab's per-capita chart silently rendered an
    # empty box and all 49 markets showed "—".
    item = db.query(NewsItem).filter(NewsItem.source == "World Bank").order_by(NewsItem.pub_date.desc()).first()
    scrapers["population"] = _ts(item.pub_date) if item else None

    # Vietnam Robusta retail price (giacaphe.com via vietnam.py scraper).
    # Tracked separately from vietnam_exports (the supply scraper) — the price
    # scraper failed silently between Apr 23 and May 14 2026 without anyone
    # noticing because it wasn't surfaced here. 48h threshold in the freshness
    # workflow will alert on the next outage.
    item = db.query(NewsItem).filter(NewsItem.source == "Giacaphe").order_by(NewsItem.pub_date.desc()).first()
    scrapers["vietnam_price"] = _ts(item.pub_date) if item else None

    # AJCA (Japan). Freshness = when AJCA last UPLOADED a report, not the data
    # period it covers: AJCA publishes month M's PDFs ~5-9 weeks after M ends,
    # so period-dating makes a perfectly-healthy feed look 60-100+ days old and
    # the stale alert cries wolf every cycle. The committed ajca.json carries
    # each report's source_pdf URL with the wp upload path (/uploads/YYYY/MM/)
    # — the max of those is the last time AJCA actually published anything.
    # Falls back to the DB item's period-dated pub_date if the file is absent.
    def _ajca_upload_ts() -> str | None:
        try:
            d = json.loads((OUT_DIR / "ajca.json").read_text(encoding="utf-8"))
        except Exception:
            return None
        import re as _re
        best = None
        for m in _re.finditer(r"/uploads/(\d{4})/(\d{2})/", json.dumps(d)):
            ym = f"{m.group(1)}-{m.group(2)}-01T00:00:00"
            best = max(best, ym) if best else ym
        return best

    item = db.query(NewsItem).filter(NewsItem.source == "AJCA").order_by(NewsItem.pub_date.desc()).first()
    scrapers["ajca"] = _ajca_upload_ts() or (_ts(item.pub_date) if item else None)

    # CONAB Costs (arabica production cost, monthly)
    item = db.query(NewsItem).filter(NewsItem.source == "CONAB Custos").order_by(NewsItem.pub_date.desc()).first()
    scrapers["conab_costs"] = _ts(item.pub_date) if item else None

    # CONAB Safra (area/yield, monthly)
    item = db.query(NewsItem).filter(NewsItem.source == "CONAB Safra").order_by(NewsItem.pub_date.desc()).first()
    scrapers["conab_safra"] = _ts(item.pub_date) if item else None

    # Quant currency index (12-currency basket, daily, written by quant export
    # earlier in this run). Surfaces in the Macro tab's Coffee Currency Index
    # section — tracking it here means a silent quant_report.json staleness
    # gets caught by the freshness monitor.
    def _qci_ts() -> str | None:
        try:
            p = OUT_DIR / "quant_report.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("currency_index", {}).get("scraped_at")
        except Exception:
            return None
        return None
    scrapers["quant_currency_index"] = _qci_ts()

    # Retail coffee CPI (BLS + Eurostat + BCB SGS, monthly). Surfaces in the
    # Macro tab's Retail Inflation section.
    def _cpi_ts() -> str | None:
        try:
            p = OUT_DIR / "retail_cpi.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("last_updated")
        except Exception:
            return None
        return None
    scrapers["retail_cpi"] = _cpi_ts()

    # Headline US CPI (BLS CPI-U, monthly). Surfaces in the Macro tab's
    # US Inflation (CPI-U) section.
    def _us_cpi_ts() -> str | None:
        try:
            p = OUT_DIR / "us_cpi.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("last_updated")
        except Exception:
            return None
        return None
    scrapers["us_cpi"] = _us_cpi_ts()

    # FX history (12 currency pairs, daily closes, ~1 year window). Backs the
    # Macro tab's FX Pair Time-Series widget. Written by the quant currency
    # index workflow alongside quant_report.json.
    def _fx_history_ts() -> str | None:
        try:
            p = OUT_DIR / "fx_history.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("scraped_at")
        except Exception:
            return None
        return None
    scrapers["fx_history"] = _fx_history_ts()

    # Origin prices history (Vietnam/Brazil/Uganda daily farmgate accumulator).
    # Backs the Macro tab's Origin Prices time-series widget.
    def _origin_prices_ts() -> str | None:
        try:
            p = OUT_DIR / "origin_prices_history.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("scraped_at")
        except Exception:
            return None
        return None
    scrapers["origin_prices"] = _origin_prices_ts()

    # Cecafe daily (updates every business day)
    scrapers["cecafe_daily"]      = _supply_ts("cecafe_daily.json")

    # Origin export supply JSON files
    scrapers["brazil_exports"]    = _supply_ts("cecafe.json")
    scrapers["colombia_exports"]  = _supply_ts("colombia_supply.json")
    scrapers["honduras_exports"]  = _supply_ts("honduras_supply.json")
    scrapers["ethiopia_exports"]  = _supply_ts("ethiopia_supply.json")
    scrapers["vietnam_exports"]   = _supply_ts("vietnam_supply.json")
    scrapers["indonesia_exports"] = _supply_ts("indonesia_supply.json")
    # Uganda: uganda_supply.json's scraped_at refreshes on EVERY export run,
    # so it reads green even when the underlying UCDA harvest has stalled
    # (July-2026: the monthly run was silently cancelled and the panel stayed
    # green for weeks). uganda_monthly.json's `updated` is stamped only when
    # the UCDA scraper actually lands data — that is the honest signal.
    scrapers["uganda_exports"]    = _supply_ts("uganda_monthly.json")

    # ICE certified stocks — three freshness rows on two cadences (the daily
    # stock scraper and the two monthly reports run as separate workflows):
    #   ice_certified_daily        — newest snapshot date (daily, Mon-Fri)
    #   ice_arabica_ageing         — arabica ageing report month_end (monthly)
    #   ice_robusta_age_allowance  — robusta age-allowance month_end (monthly)
    def _cert_json(fname: str) -> dict:
        try:
            p = OUT_DIR / fname
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
        return {}
    _ca = _cert_json("certified_stocks_arabica.json")
    _cr = _cert_json("certified_stocks_robusta.json")

    def _last_snap_date(d: dict) -> str | None:
        ss = d.get("snapshots") or []
        return ss[-1].get("date") if ss else None
    _daily = [x for x in (_last_snap_date(_ca), _last_snap_date(_cr)) if x]
    scrapers["ice_certified_daily"]       = max(_daily) if _daily else None
    scrapers["ice_arabica_ageing"]        = (_ca.get("ageing_report") or {}).get("month_end")
    _aa = (_cr.get("monthly") or {}).get("age_allowance") or []
    scrapers["ice_robusta_age_allowance"] = _aa[-1].get("month_end") if _aa else None

    # Per-exporter timestamps — when did each topic in workflow 1.4 last
    # publish successfully? Merge-with-previous, so a partial (--only) run
    # or a single-topic failure doesn't blow away the rest of the map.
    # Fresh successes overwrite; previous values survive when the topic
    # didn't run or failed on this invocation.
    existing_exporters: dict[str, str | None] = {}
    try:
        prev = json.loads((OUT_DIR / "health.json").read_text(encoding="utf-8"))
        existing_exporters = prev.get("exporters") or {}
    except Exception:
        # First run, file missing/unreadable → empty baseline.
        pass
    exporters_map: dict[str, str | None] = {
        **existing_exporters,
        **(exporters_published_at or {}),
    }
    # Drop topics the orchestrator no longer knows about. Removing an exporter
    # used to leave its last timestamp here permanently: vn_coffee_imports went
    # in #815 as verified dead code, kept its 2026-08-31 stamp, and started
    # paging every morning from 2 Sep as "3.9d old (limit 2.0d)" — a pipeline
    # failure alert for a pipeline that had been deliberately deleted.
    # Only prune when the caller supplied the registry: an empty/absent one
    # would otherwise wipe the map on any caller that doesn't pass it.
    if known_exporters:
        exporters_map = {k: v for k, v in exporters_map.items() if k in known_exporters}

    # ── Newer feature feeds (added with the news-desk freshness revamp) ───────
    # Each reads the JSON its visual consumes, so the pipeline timestamp is the
    # file's own publish stamp. All defensive: absent file → None (grey chip).
    def _feed_ts(fname: str, *keys: str) -> str | None:
        try:
            p = OUT_DIR / fname
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                for k in keys:
                    v = d.get(k)
                    if v:
                        return str(v)
        except Exception:
            pass
        return None

    def _sentiment_ts() -> str | None:
        try:
            d = json.loads((OUT_DIR / "quant_report.json").read_text(encoding="utf-8"))
            return (d.get("sentiment") or {}).get("scraped_at")
        except Exception:
            return None
    scrapers["news_sentiment"]  = _sentiment_ts()

    def _open_dir_ts() -> str | None:
        try:
            rows = json.loads((OUT_DIR / "open_direction_history.json").read_text(encoding="utf-8"))
            return rows[-1].get("date") if rows else None
        except Exception:
            return None
    scrapers["open_direction"]  = _open_dir_ts()
    scrapers["port_activity"]   = _feed_ts("port_activity/index.json", "updated")
    scrapers["spot_coffee"]     = _feed_ts("spot_coffee.json", "generated_at", "as_of")
    scrapers["us_imports"]      = _feed_ts("us_coffee_imports.json", "updated")
    scrapers["eu_imports"]      = _feed_ts("eu_coffee_imports.json", "updated")
    scrapers["enso_indices"]    = _feed_ts("enso_indices.json", "scraped_at")
    scrapers["enso_subsurface"] = _feed_ts("enso_subsurface.json", "scraped_at")
    scrapers["vn_water"]        = _feed_ts("vn_water_levels.json", "updated")
    # Nothing watched the traded tape, which is how it went silent for ten
    # sessions (26 Aug – 4 Sep 2026) with every scheduled run reporting success.
    # The workflow now fails loudly when it misses its window, but a feed this
    # easy to lose should also be visible on the health bar.
    scrapers["tradespread"]     = _feed_ts("tradespread.json", "updated")

    # ── Data as-of map ────────────────────────────────────────────────────────
    # `scrapers` answers "when did the pipeline last run" (used by DataHealthBar
    # and the stale-feed alert workflow — semantics unchanged). `data_asof`
    # answers "what period does the DATA currently cover" — what a reader should
    # see as freshness in the news-desk view. E.g. the Uganda scraper runs daily,
    # but UCDA's latest report month may be three months back; the old display
    # showed "today" for data from April.
    #
    # Starts as a copy of scrapers (for daily feeds run date ≈ data date) and
    # overrides the periodic feeds from the period fields of the JSONs exported
    # earlier in this run. Every override is defensive — on any failure the
    # scrapers value stands.
    def _fjson(fname: str) -> dict:
        try:
            p = OUT_DIR / fname
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
        return {}

    def _dig(d, *path):
        cur = d
        for k in path:
            try:
                cur = cur[k]
            except Exception:
                return None
        return cur if isinstance(cur, str) and cur else None

    data_asof: dict[str, str | None] = dict(scrapers)

    def _set_asof(key: str, *candidates) -> None:
        for v in candidates:
            if v:
                data_asof[key] = v
                return

    _set_asof("brazil_exports", _dig(_fjson("cecafe.json"), "series", -1, "date"))
    _set_asof("vietnam_exports", _dig(_fjson("vietnam_supply.json"), "exports", "monthly", -1, "month"))
    _set_asof(
        "uganda_exports",
        _dig(_fjson("uganda_monthly.json"), "series", -1, "month"),
        _dig(_fjson("uganda_supply.json"), "exports", "monthly", -1, "month"),
    )
    _set_asof("indonesia_exports", _dig(_fjson("indonesia_exports.json"), "series", -1, "month"))
    _set_asof("colombia_exports", _dig(_fjson("colombia_supply.json"), "exports", "monthly", -1, "month"))
    _set_asof("honduras_exports", _dig(_fjson("honduras_supply.json"), "exports", "last_updated"))
    _set_asof("ethiopia_exports", _dig(_fjson("ethiopia_supply.json"), "exports", "last_updated"))
    _set_asof("ecf", _dig(_fjson("ecf_history.json"), "monthly", -1, "period"))

    def _cpi_asof(fname: str) -> str | None:
        best = None
        for s in (_fjson(fname).get("series") or {}).values():
            monthly = (s or {}).get("monthly") or []
            if monthly and isinstance(monthly[-1], dict):
                p = monthly[-1].get("period")
                if p:
                    best = max(best, p) if best else p
        return best

    _set_asof("us_cpi", _cpi_asof("us_cpi.json"))
    _set_asof("retail_cpi", _cpi_asof("retail_cpi.json"))

    def _enso_asof() -> str | None:
        hist = _fjson("enso.json").get("oni_history") or []
        raw = hist[-1].get("month") if hist and isinstance(hist[-1], dict) else None
        if not raw:
            return None
        try:  # "May-26" → "2026-05"
            return datetime.strptime(str(raw), "%b-%y").strftime("%Y-%m")
        except Exception:
            return None

    _set_asof("enso", _enso_asof())

    def _fert_asof() -> str | None:
        raw = _dig(_fjson("farmer_economics.json"), "fertilizer", "prices_as_of")
        if not raw:
            return None
        try:  # "Jun-2026" → "2026-06"
            return datetime.strptime(raw, "%b-%Y").strftime("%Y-%m")
        except Exception:
            return None

    _set_asof("fertilizer_wb", _fert_asof())

    # New-feed data periods.
    def _sentiment_asof() -> str | None:
        try:
            rows = json.loads((OUT_DIR / "sentiment_history.json").read_text(encoding="utf-8"))
            return rows[-1].get("date") if rows else None
        except Exception:
            return None
    _set_asof("news_sentiment", _sentiment_asof())
    _set_asof("spot_coffee", _dig(_fjson("spot_coffee.json"), "as_of"))
    def _imports_asof(fname: str) -> str | None:
        mt = _fjson(fname).get("monthly_total")
        if isinstance(mt, dict) and mt:
            keys = sorted(k for k in mt if isinstance(k, str) and len(k) == 7)
            return keys[-1] if keys else None
        return None
    _set_asof("us_imports", _imports_asof("us_coffee_imports.json"))
    _set_asof("eu_imports", _imports_asof("eu_coffee_imports.json"))
    _set_asof("enso_indices", _dig(_fjson("enso_indices.json"), "nino34", "latest", "week_ending"))
    _set_asof("enso_subsurface", _dig(_fjson("enso_subsurface.json"), "wwv", "latest", "month"))
    _set_asof("vn_water", _dig(_fjson("vn_water_levels.json"), "bulletin_date"))
    def _port_asof() -> str | None:
        try:
            d = json.loads((OUT_DIR / "port_activity" / "hcmc.json").read_text(encoding="utf-8"))
            s = d.get("series") or []
            return s[-1].get("date") if s else None
        except Exception:
            return None
    _set_asof("port_activity", _port_asof())

    # ── When did each feed's DATA last change? ────────────────────────────────
    # data_asof tells you the period; this tells you when a NEW period actually
    # landed — the difference between "the scraper re-ran" (every day) and "a
    # release dropped" (what the news desk should lead with). Computed by
    # diffing this run's data_asof against the previous health.json; unchanged
    # keys carry their previous stamp forward.
    prev_asof: dict[str, str | None] = {}
    prev_changed: dict[str, str | None] = {}
    try:
        _prev = json.loads((OUT_DIR / "health.json").read_text(encoding="utf-8"))
        prev_asof = _prev.get("data_asof") or {}
        prev_changed = _prev.get("data_changed_at") or {}
    except Exception:
        pass

    _now_iso = datetime.utcnow().isoformat() + "Z"
    data_changed_at: dict[str, str | None] = {}
    for key, cur in data_asof.items():
        was = prev_asof.get(key)
        if cur and was and cur != was:
            data_changed_at[key] = _now_iso        # a new period landed on this run
        elif cur and key not in prev_asof:
            data_changed_at[key] = prev_changed.get(key)  # first sighting — no claim
        else:
            data_changed_at[key] = prev_changed.get(key)  # unchanged — keep last release stamp

    healthy   = sum(1 for v in scrapers.values() if v)
    published = sum(1 for v in exporters_map.values() if v)
    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "scrapers":     scrapers,
        "data_asof":    data_asof,
        "data_changed_at": data_changed_at,
        "exporters":    exporters_map,
    }
    # Phase 3 sunset signal — present only when latest_prices had to use the
    # legacy regex fallback. CI/ops can alert on this; once it stays absent we
    # can delete _build_tickers_from_news and the extract_physical_price regex.
    if _base.LATEST_PRICES_FALLBACK:
        result["warnings"] = ["latest_prices_used_regex_fallback"]

    path = OUT_DIR / "health.json"
    safe_write_json(path, result, validate_health)
    print(
        f"  health.json → {healthy}/{len(scrapers)} scrapers + "
        f"{published}/{len(exporters_map)} exporters tracked"
    )
