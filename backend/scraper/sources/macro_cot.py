# backend/scraper/sources/macro_cot.py
# Daily scraper for multi-commodity COT positions + prices.
# Integrates into scraper/main.py ALL_SOURCES via run(page) stub.

import functools
import io
import json
import os
import sys
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests

from scraper.utils.http import get_with_backoff

# ── COMMODITY_SPECS ────────────────────────────────────────────────────────────
# One entry per traded symbol.
# Entries marked *est* require manual verification at ice.com.
#
# Margins
# =======
# `margin_outright_usd` and `margin_spread_usd` come from the R.J. O'Brien
# margin guide effective 3/14/2026 (`rjo_margins.pdf` at the repo root —
# the only research-paper-shaped doc carried in-tree). They feed the
# `initial_margin_usd` calculation in `exporters/cot.py` so the macro-COT
# dashboard can answer "how much speculative capital is actually at risk
# across the futures complex?" — see MacroMethodology for the formula.
# Entries tagged `# *est*` weren't on the RJO guide and use a conservative
# guess; replace with verified ICE / SGX numbers when available.
COMMODITY_SPECS = {
  # ── Hard Commodities ─────────────────────────────────────────────────────────
  "wti": {
    "name": "WTI Crude Oil", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "CL=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 1000, "price_unit": "usd_per_bbl", "currency": "USD",
    "margin_outright_usd": 4675, "margin_spread_usd": 420,
  },
  "brent": {
    "name": "Brent Crude Oil", "sector": "hard", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Brent Crude Futures - ICE Futures Europe",
    "yfinance_ticker": "BZ=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 1000, "price_unit": "usd_per_bbl", "currency": "USD",
    "margin_outright_usd": 4785, "margin_spread_usd": 540,
  },
  "natgas": {
    "name": "Natural Gas (Henry Hub)", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "HENRY HUB LAST DAY FIN - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "NG=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 10000, "price_unit": "usd_per_mmbtu", "currency": "USD",
    "margin_outright_usd": 6259, "margin_spread_usd": 570,
  },
  "heating_oil": {
    "name": "NY Harbor ULSD (Heating Oil)", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "NY HARBOR ULSD - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "HO=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 42000, "price_unit": "usd_per_gal", "currency": "USD",
    "margin_outright_usd": 7596, "margin_spread_usd": 690,
  },
  "rbob": {
    "name": "RBOB Gasoline", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "GASOLINE RBOB - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "RB=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 42000, "price_unit": "usd_per_gal", "currency": "USD",
    "margin_outright_usd": 5988, "margin_spread_usd": 545,
  },
  "lsgo": {
    "name": "Low Sulphur Gasoil", "sector": "hard", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Gasoil Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": "heating_oil",
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 264.17,
    "contract_unit": 100, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 8993, "margin_spread_usd": 800,  # *est*
  },
  "gold": {
    "name": "Gold", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "GOLD - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "GC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 100, "price_unit": "usd_per_oz", "currency": "USD",
    "margin_outright_usd": 38905, "margin_spread_usd": 400,
  },
  "silver": {
    "name": "Silver", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "SILVER - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "SI=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 5000, "price_unit": "usd_per_oz", "currency": "USD",
    "margin_outright_usd": 62304, "margin_spread_usd": 441,
  },
  "copper": {
    "name": "Copper", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "COPPER- #1 - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "HG=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 25000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 13200, "margin_spread_usd": 660,
  },
  # ── Grains ───────────────────────────────────────────────────────────────────
  "corn": {
    "name": "Corn", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "CORN - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZC=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZC=F quotes in cents/bushel — divide by 100 to get USD/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 1073, "margin_spread_usd": 303,
  },
  "wheat": {
    "name": "Wheat (SRW)", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZW=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZW=F quotes in cents/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 1815, "margin_spread_usd": 440,
  },
  "soybeans": {
    "name": "Soybeans", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEANS - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZS=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZS=F quotes in cents/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 2200, "margin_spread_usd": 660,
  },
  "soy_meal": {
    "name": "Soybean Meal", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEAN MEAL - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZM=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZM=F quotes in USD/short ton — no conversion needed
    "contract_unit": 100, "price_unit": "usd_per_short_ton", "currency": "USD",
    "margin_outright_usd": 1705, "margin_spread_usd": 495,
  },
  "soy_oil": {
    "name": "Soybean Oil", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEAN OIL - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZL=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZL=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 60000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 2310, "margin_spread_usd": 605,
  },
  # ── Meats ────────────────────────────────────────────────────────────────────
  "live_cattle": {
    "name": "Live Cattle", "sector": "meats", "exchange": "CME",
    "cftc_filter": "LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "LE=F", "price_proxy": None,
    "price_source": "yfinance",
    # LE=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 40000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 3630, "margin_spread_usd": 1100,
  },
  "feeder_cattle": {
    "name": "Feeder Cattle", "sector": "meats", "exchange": "CME",
    "cftc_filter": "FEEDER CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "GF=F", "price_proxy": None,
    "price_source": "yfinance",
    # GF=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 50000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 6600, "margin_spread_usd": 1595,
  },
  "lean_hogs": {
    "name": "Lean Hogs", "sector": "meats", "exchange": "CME",
    "cftc_filter": "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "HE=F", "price_proxy": None,
    "price_source": "yfinance",
    # HE=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 40000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 1870, "margin_spread_usd": 1760,
  },
  # ── Softs ────────────────────────────────────────────────────────────────────
  "cotton": {
    "name": "Cotton No. 2", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COTTON NO. 2 - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "CT=F", "price_proxy": None,
    "price_source": "yfinance",
    # CT=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 50000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 1254, "margin_spread_usd": 364,
  },
  "sugar11": {
    "name": "Sugar No. 11", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "SUGAR NO. 11 - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "SB=F", "price_proxy": None,
    "price_source": "yfinance",
    # SB=F quotes in cents/lb (also used as proxy source for white_sugar)
    "yfinance_mult": 0.01,
    "contract_unit": 112000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 838, "margin_spread_usd": 183,
  },
  "white_sugar": {
    "name": "White Sugar No. 5", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE White Sugar Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": "sugar11",
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 2204.62,
    "contract_unit": 50, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 1526, "margin_spread_usd": 150,  # *est*
  },
  "arabica": {
    "name": "Coffee Arabica (C)", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COFFEE C - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "KC=F", "price_proxy": None,
    "price_source": "yfinance",
    # KC=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 37500, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 7376, "margin_spread_usd": 830,
  },
  "robusta": {
    "name": "Coffee Robusta", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Robusta Coffee Futures - ICE Futures Europe",
    # Yahoo's RM=F continuous feed is dead (empty downloads → null price),
    # like LCC=F/LBS=F. Reuse the Barchart-sourced front-month price we
    # already archive daily, read on the COT report date (Tuesday) so it
    # lines up with every other commodity.
    "yfinance_ticker": None, "price_proxy": None,
    "price_source": "internal_archive", "internal_market": "robusta",
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 5000, "margin_spread_usd": 500,  # *est* (RM 10-T not in RJO guide)
  },
  "cocoa_ny": {
    "name": "Cocoa NY", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COCOA - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "CC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 4961, "margin_spread_usd": 535,
  },
  "cocoa_ldn": {
    "name": "Cocoa London", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Cocoa Futures - ICE Futures Europe",
    # LCC=F is delisted on Yahoo Finance; proxy off NY Cocoa (CC=F, USD/MT) instead.
    "yfinance_ticker": None, "price_proxy": "cocoa_ny",
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 1.0,
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 7069, "margin_spread_usd": 700,  # *est* (≈ £5,566 × 1.27)
  },
  "oj": {
    "name": "Orange Juice (FCOJ-A)", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "FRZN CONCENTRATED ORANGE JUICE - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "OJ=F", "price_proxy": None,
    "price_source": "yfinance",
    # OJ=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 15000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 4775, "margin_spread_usd": 1881,
  },
  # ── Micros ───────────────────────────────────────────────────────────────────
  "oats": {
    "name": "Oats", "sector": "micros", "exchange": "CBOT",
    "cftc_filter": "OATS - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZO=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZO=F quotes in cents/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 1375, "margin_spread_usd": 1100,
  },
  "lumber": {
    "name": "Lumber", "sector": "micros", "exchange": "CME",
    "cftc_filter": "LUMBER - CHICAGO MERCANTILE EXCHANGE",
    # LBS=F is delisted on Yahoo Finance; no price source available.
    "ice_filter": None, "yfinance_ticker": None, "price_proxy": None,
    "price_source": None,
    "contract_unit": 110000, "price_unit": "usd_per_mbf", "currency": "USD",
    "margin_outright_usd": 9500, "margin_spread_usd": 950,  # *est*
  },
  # rough_rice was retired 2026-07: ZR=F died on Yahoo (froze at 12.66 then went
  # bad) and stooq's zr.f 404s, leaving no viable price source — exposure had
  # been honestly null since 06-23. Replaced by the markets below, chosen from
  # the audit-cftc-markets coverage run (biggest untracked MM-active physical
  # commodities with a clean USD yfinance feed). Exact cftc_filter strings come
  # from that audit's log — the hardened matcher requires exact/prefix names.
  # Margin fields intentionally omitted (Initial Margin KPI guard treats them
  # as not-posted) until real RJO guide numbers are added.
  "wheat_hrw": {
    "name": "Wheat (HRW)", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "WHEAT-HRW - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "KE=F", "price_proxy": None,
    "price_source": "yfinance",
    # KE=F quotes in cents/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
  },
  "platinum": {
    "name": "Platinum", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "PL=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 50, "price_unit": "usd_per_oz", "currency": "USD",
  },
  # palladium removed 2026-08-14 (requested). Its 2026-07-21 close came in at
  # 733.0 against ~1300 neighbours, so the poisoned-price healer flagged it and
  # re-requested PA=F on every run — and yfinance answers that ticker with
  # YFRateLimitError every time, so the heal could never converge. The retry was
  # unbounded by design ("poisoned prices must keep retrying daily").
}

# ── CFTC / ICE column name constants (both files use the same disaggregated format) ──
_CFTC_MARKET_COL = "Market_and_Exchange_Names"
_CFTC_DATE_COL   = "As_of_Date_In_Form_YYMMDD"
_CFTC_OI         = "Open_Interest_All"
_CFTC_MM_LONG    = "M_Money_Positions_Long_All"
_CFTC_MM_SHORT   = "M_Money_Positions_Short_All"
_CFTC_MM_SPREAD  = "M_Money_Positions_Spread_All"

_ICE_MARKET_COL  = "Market_and_Exchange_Names"
_ICE_DATE_COL    = "As_of_Date_In_Form_YYMMDD"
_ICE_OI          = "Open_Interest_All"
_ICE_MM_LONG     = "M_Money_Positions_Long_All"
_ICE_MM_SHORT    = "M_Money_Positions_Short_All"
_ICE_MM_SPREAD   = "M_Money_Positions_Spread_All"

# Full position breakdown columns (identical names in CFTC and ICE disaggregated files)
_COL_PMPU_LONG    = "Prod_Merc_Positions_Long_All"
_COL_PMPU_SHORT   = "Prod_Merc_Positions_Short_All"
_COL_SWAP_LONG    = "Swap_Positions_Long_All"
_COL_SWAP_SHORT   = "Swap_Positions_Short_All"
_COL_SWAP_SPREAD  = "Swap_Positions_Spread_All"
_COL_OTHER_LONG   = "Other_Rept_Positions_Long_All"
_COL_OTHER_SHORT  = "Other_Rept_Positions_Short_All"
_COL_OTHER_SPREAD = "Other_Rept_Positions_Spread_All"
_COL_NR_LONG      = "NonRept_Positions_Long_All"
_COL_NR_SHORT     = "NonRept_Positions_Short_All"

# Trader count columns (identical names in CFTC and ICE disaggregated files)
_COL_T_PMPU_LONG    = "Traders_Prod_Merc_Long_All"
_COL_T_PMPU_SHORT   = "Traders_Prod_Merc_Short_All"
_COL_T_SWAP_LONG    = "Traders_Swap_Long_All"
_COL_T_SWAP_SHORT   = "Traders_Swap_Short_All"
_COL_T_SWAP_SPREAD  = "Traders_Swap_Spread_All"
_COL_T_MM_LONG      = "Traders_M_Money_Long_All"
_COL_T_MM_SHORT     = "Traders_M_Money_Short_All"
_COL_T_MM_SPREAD    = "Traders_M_Money_Spread_All"
_COL_T_OTHER_LONG   = "Traders_Other_Rept_Long_All"
_COL_T_OTHER_SHORT  = "Traders_Other_Rept_Short_All"
_COL_T_OTHER_SPREAD = "Traders_Other_Rept_Spread_All"
_COL_T_NR_LONG      = "Traders_NonRept_Long_All"
_COL_T_NR_SHORT     = "Traders_NonRept_Short_All"


def _safe_int(val, default: int = 0) -> int:
    """Cast val to int; return default on NaN/None/blank."""
    try:
        if pd.isna(val):
            return default
    except (TypeError, ValueError):
        pass
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _row_int(row, col: str, default=0):
    """Safely read an integer column from a pandas Series; return default if column absent."""
    try:
        return _safe_int(row[col], default)
    except KeyError:
        return default


_GBPUSD_TICKER = "GBPUSD=X"


def _fetch_gbpusd_rates(dates: set) -> dict:
    """Fetch GBP/USD spot rates for a set of dates via yfinance.
    Returns {date: rate} using up to a 6-day lookback per date.
    """
    import yfinance as yf
    if not dates:
        return {}
    start = min(dates) - timedelta(days=7)
    end   = max(dates) + timedelta(days=1)
    result = {}
    try:
        hist = yf.download(_GBPUSD_TICKER, start=start.isoformat(), end=end.isoformat(),
                           interval="1d", auto_adjust=True, progress=False)
        if hist.empty:
            print(f"[macro_cot] WARNING: no GBPUSD data for range {start}–{end}", file=sys.stderr)
            return result
        if isinstance(hist.columns, pd.MultiIndex):
            hist.columns = hist.columns.get_level_values(0)
        hist.index = pd.to_datetime(hist.index).date
        for dt in dates:
            for offset in range(6):
                check = dt - timedelta(days=offset)
                if check in hist.index:
                    result[dt] = float(hist.loc[check, "Close"])
                    break
    except Exception as e:
        print(f"[macro_cot] GBPUSD fetch error: {e}", file=sys.stderr)
    return result


def _download_cftc_df(year: int) -> pd.DataFrame:
    url = f"https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
    resp = get_with_backoff(url, timeout=(10, 60))
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        csv_name = [n for n in z.namelist() if n.endswith(".txt") or n.endswith(".csv")][0]
        with z.open(csv_name) as f:
            return pd.read_csv(f, low_memory=False)


# ICE's edge rejects a bare "python-requests/x.y" with 403 Forbidden — the
# 2026-08-20 COT failure. Every other ICE fetcher in this repo already sends a
# browser UA for exactly that reason (futures._fetch_ice_robusta_cot,
# ice_certified_stocks/spa_api); this one was the outlier.
# get_with_backoff treats a non-429 4xx as fatal, so the 403 killed the run
# outright rather than retrying.
_ICE_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
}


def _download_ice_df(year: int) -> pd.DataFrame:
    url = f"https://www.ice.com/publicdocs/futures/COTHist{year}.csv"
    resp = get_with_backoff(url, timeout=(10, 60), headers=_ICE_HEADERS)
    # ICE files may have a UTF-8 BOM on the first column — use utf-8-sig to strip it
    return pd.read_csv(io.StringIO(resp.content.decode("utf-8-sig")), low_memory=False)


# How many recent weekly reports each run re-parses and re-upserts. The yearly
# CFTC/ICE downloads contain the FULL history, so re-reading a trailing window
# makes every run self-healing: a week one run missed (holiday-delayed release,
# ICE file lagging behind CFTC, a failed job) is backfilled automatically by the
# next successful run instead of being lost forever. 8 weeks ≈ two months of
# outage tolerance; upserts are idempotent so re-writing existing rows is a no-op.
SELF_HEAL_WEEKS = 8

# Env override for the window (workflow_dispatch "heal_weeks" input). When set,
# the run also FORCES the upsert phase even with no new data and no detected
# holes — that's what lets a manual deep heal re-read and overwrite months of
# history (e.g. re-ingesting Jan–Mar to fix rows corrupted by an older parser).
_HEAL_WEEKS_ENV = "MACRO_COT_HEAL_WEEKS"


def _match_market_rows(df: pd.DataFrame, market_col: str, market_filter: str) -> pd.DataFrame:
    """Rows belonging to exactly this market, and never a lookalike.

    Exact stripped-name match wins. If none exists (formatting variance), fall
    back to rows whose stripped name STARTS WITH the filter — never rows that
    merely embed it. That distinction matters: "MICRO SILVER - COMMODITY
    EXCHANGE INC." CONTAINS "SILVER - COMMODITY EXCHANGE INC.", and the old
    contains-fallback ingested those micro rows (mm_long=mm_short=0, OI ~30k)
    as full-size silver for 4 weeks in early 2026 whenever the real row was
    absent from a partially-written file. Returning an empty frame is the safe
    failure: a skipped symbol heals on the next run's window; a wrong-market
    ingest is silent corruption.
    """
    names = df[market_col].astype(str).str.strip()
    exact = df[names == market_filter]
    if not exact.empty:
        return exact
    return df[names.str.startswith(market_filter)]


def _parse_cftc(df: pd.DataFrame, weeks_back: int = SELF_HEAL_WEEKS) -> dict:
    """Return {symbol: [(report_date, fields), ...]} newest-first for the last
    `weeks_back` report rows per CFTC symbol."""
    results = {}
    for sym, spec in COMMODITY_SPECS.items():
        filt = spec.get("cftc_filter")
        if not filt:
            continue
        rows = _match_market_rows(df, _CFTC_MARKET_COL, filt)
        if rows.empty:
            print(f"[macro_cot] WARNING: no CFTC rows matched '{filt}' for {sym}", file=sys.stderr)
            continue
        rows = rows.copy()
        rows["_date_parsed"] = pd.to_datetime(rows[_CFTC_DATE_COL], format="%y%m%d", errors="coerce")
        rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
        results[sym] = [
            (row["_date_parsed"].date(), {
                "mm_long":   _safe_int(row[_CFTC_MM_LONG]),
                "mm_short":  _safe_int(row[_CFTC_MM_SHORT]),
                "mm_spread": _safe_int(row[_CFTC_MM_SPREAD]),
                "oi_total":  _safe_int(row[_CFTC_OI]),
            })
            for _, row in rows.head(weeks_back).iterrows()
        ]
    return results


def _parse_ice(df: pd.DataFrame, weeks_back: int = SELF_HEAL_WEEKS) -> dict:
    """Return {symbol: [(report_date, fields), ...]} newest-first for the last
    `weeks_back` report rows per ICE symbol."""
    results = {}
    for sym, spec in COMMODITY_SPECS.items():
        filt = spec.get("ice_filter")
        if not filt:
            continue
        rows = _match_market_rows(df, _ICE_MARKET_COL, filt)
        if rows.empty:
            print(f"[macro_cot] WARNING: no ICE rows matched '{filt}' for {sym}", file=sys.stderr)
            continue
        rows = rows.copy()
        rows["_date_parsed"] = pd.to_datetime(rows[_ICE_DATE_COL], format="%y%m%d", errors="coerce")
        rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
        results[sym] = [
            (row["_date_parsed"].date(), {
                "mm_long":   _safe_int(row[_ICE_MM_LONG]),
                "mm_short":  _safe_int(row[_ICE_MM_SHORT]),
                "mm_spread": _safe_int(row[_ICE_MM_SPREAD]),
                "oi_total":  _safe_int(row[_ICE_OI]),
            })
            for _, row in rows.head(weeks_back).iterrows()
        ]
    return results


def _parse_full_symbol(df: pd.DataFrame, market_col: str, date_col: str,
                       market_filter: str, has_nr_traders: bool = True,
                       weeks_back: int = SELF_HEAL_WEEKS):
    """Extract full position breakdown + trader counts for one market filter.
    Returns [(report_date, fields_dict), ...] newest-first for the last
    `weeks_back` report rows, or [] if no rows matched.
    Works with both CFTC and ICE disaggregated CSV files (same column format).
    Only position/trader fields are returned — price fields are left for Excel import.
    """
    rows = _match_market_rows(df, market_col, market_filter)
    if rows.empty:
        return []
    rows = rows.copy()
    rows["_date_parsed"] = pd.to_datetime(rows[date_col], format="%y%m%d", errors="coerce")
    rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
    return [
        (row["_date_parsed"].date(), _full_symbol_fields(row, has_nr_traders))
        for _, row in rows.head(weeks_back).iterrows()
    ]


def _full_symbol_fields(row, has_nr_traders: bool) -> dict:
    fields = {
        "oi_total":      _row_int(row, _CFTC_OI),
        "pmpu_long":     _row_int(row, _COL_PMPU_LONG),
        "pmpu_short":    _row_int(row, _COL_PMPU_SHORT),
        "swap_long":     _row_int(row, _COL_SWAP_LONG),
        "swap_short":    _row_int(row, _COL_SWAP_SHORT),
        "swap_spread":   _row_int(row, _COL_SWAP_SPREAD),
        "mm_long":       _row_int(row, _CFTC_MM_LONG),
        "mm_short":      _row_int(row, _CFTC_MM_SHORT),
        "mm_spread":     _row_int(row, _CFTC_MM_SPREAD),
        "other_long":    _row_int(row, _COL_OTHER_LONG),
        "other_short":   _row_int(row, _COL_OTHER_SHORT),
        "other_spread":  _row_int(row, _COL_OTHER_SPREAD),
        "nr_long":       _row_int(row, _COL_NR_LONG),
        "nr_short":      _row_int(row, _COL_NR_SHORT),
        # Trader counts: use None (not 0) when column absent or value is 0
        # so the UI can distinguish "no data" from "genuinely zero traders"
        "t_pmpu_long":    _row_int(row, _COL_T_PMPU_LONG)    or None,
        "t_pmpu_short":   _row_int(row, _COL_T_PMPU_SHORT)   or None,
        "t_swap_long":    _row_int(row, _COL_T_SWAP_LONG)    or None,
        "t_swap_short":   _row_int(row, _COL_T_SWAP_SHORT)   or None,
        "t_swap_spread":  _row_int(row, _COL_T_SWAP_SPREAD)  or None,
        "t_mm_long":      _row_int(row, _COL_T_MM_LONG)      or None,
        "t_mm_short":     _row_int(row, _COL_T_MM_SHORT)     or None,
        "t_mm_spread":    _row_int(row, _COL_T_MM_SPREAD)    or None,
        "t_other_long":   _row_int(row, _COL_T_OTHER_LONG)   or None,
        "t_other_short":  _row_int(row, _COL_T_OTHER_SHORT)  or None,
        "t_other_spread": _row_int(row, _COL_T_OTHER_SPREAD) or None,
        "t_nr_long":      (_row_int(row, _COL_T_NR_LONG)  or None) if has_nr_traders else None,
        "t_nr_short":     (_row_int(row, _COL_T_NR_SHORT) or None) if has_nr_traders else None,
    }
    return fields


def _fetch_stooq_prices(symbols_dates: list) -> dict:
    """Fetch latest closing prices from stooq.com for [(symbol, date), ...].
    Returns {(symbol, date): price}. Uses the latest-quote endpoint since
    stooq does not provide historical data for continuous futures like RM.F.
    The price is keyed by the COT report date even though it is the most
    recent available quote (typically within a few days of the COT date).
    """
    results = {}
    for sym, dt in symbols_dates:
        ticker = COMMODITY_SPECS[sym].get("stooq_ticker", "")
        if not ticker:
            continue
        url = f"https://stooq.com/q/l/?s={ticker}&f=sd2ohlcv&h&e=csv"
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            df = pd.read_csv(io.StringIO(resp.text))
            if df.empty or "Close" not in df.columns:
                print(f"[macro_cot] stooq: no data for {ticker}", file=sys.stderr)
                continue
            price = float(df["Close"].iloc[0])
            if price <= 0:
                print(f"[macro_cot] stooq: invalid price {price} for {ticker}", file=sys.stderr)
                continue
            results[(sym, dt)] = price
            print(f"[macro_cot] stooq {ticker}: {price} (keyed to COT date {dt})", file=sys.stderr)
        except Exception as e:
            print(f"[macro_cot] stooq error for {ticker}: {e}", file=sys.stderr)
    return results


def _fetch_one_ticker(ticker: str, pairs: list) -> dict:
    """Fetch one ticker's history and resolve prices for each (symbol, date)
    pair that maps to that ticker. Returns {(sym, dt): price_usd}. Errors are
    logged and produce an empty dict — never raise to the caller, so one bad
    ticker can't poison the parallel batch."""
    import yfinance as yf
    out: dict = {}
    dates = sorted({dt for _, dt in pairs})
    start = min(dates) - timedelta(days=7)
    end   = max(dates) + timedelta(days=1)
    try:
        hist = yf.download(ticker, start=start.isoformat(), end=end.isoformat(),
                           interval="1d", auto_adjust=True, progress=False)
        if hist.empty:
            return out
        if isinstance(hist.columns, pd.MultiIndex):
            hist.columns = hist.columns.get_level_values(0)
        hist.index = pd.to_datetime(hist.index).date
        for sym, dt in pairs:
            for offset in range(6):
                check = dt - timedelta(days=offset)
                if check in hist.index:
                    close = float(hist.loc[check, "Close"])
                    mult  = COMMODITY_SPECS[sym].get("yfinance_mult", 1.0)
                    out[(sym, dt)] = close * mult
                    break
    except Exception as e:
        print(f"[macro_cot] yfinance error for {ticker}: {e}", file=sys.stderr)
    return out


def _fetch_yfinance_prices(symbols_dates: list) -> dict:
    """Fetch yfinance prices for [(symbol, date), ...] in parallel.

    Groups by ticker, then runs up to YF_MAX_WORKERS downloads concurrently.
    Same per-ticker response handling as the original sequential version, so
    the multi-index DataFrame quirks of yfinance don't change shape between
    versions. ~3-5x faster than the sequential loop and keeps the run under
    the 420s side-channel timeout even on slow days.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    YF_MAX_WORKERS = 4   # Yahoo tolerates ~5 concurrent before rate-limiting

    ticker_map: dict[str, list] = {}
    for sym, dt in symbols_dates:
        spec = COMMODITY_SPECS[sym]
        ticker = spec["yfinance_ticker"]
        if not ticker:
            continue
        ticker_map.setdefault(ticker, []).append((sym, dt))

    if not ticker_map:
        return {}

    results: dict = {}
    with ThreadPoolExecutor(max_workers=YF_MAX_WORKERS) as ex:
        future_to_ticker = {
            ex.submit(_fetch_one_ticker, ticker, pairs): ticker
            for ticker, pairs in ticker_map.items()
        }
        for fut in as_completed(future_to_ticker):
            try:
                results.update(fut.result())
            except Exception as e:
                ticker = future_to_ticker[fut]
                print(f"[macro_cot] yfinance worker for {ticker} crashed: {e}", file=sys.stderr)
    return results


def _phase(name: str) -> None:
    """Log a phase marker so CI logs make it obvious where the scraper died."""
    print(f"[macro_cot] PHASE: {name}", file=sys.stderr, flush=True)


# Date-keyed per-contract OI+price archive committed by the Daily OI Snapshot
# workflow: {market: {YYYY-MM-DD: {SYMBOL: {price, oi}}}}. macro_cot.py lives at
# backend/scraper/sources/, so the repo root is parents[3].
_ARCHIVE_PATH = Path(__file__).resolve().parents[3] / "data" / "contract_prices_archive.json"


@functools.lru_cache(maxsize=1)
def _load_price_archive() -> dict:
    """Load + cache the per-contract price archive once per process."""
    try:
        return json.loads(_ARCHIVE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[macro_cot] archive read failed: {e}", file=sys.stderr)
        return {}


def _front_month_price_from_archive(market: str, report_date) -> float | None:
    """Front-month settlement price ($/t) for `market` on the COT report date.

    Used for symbols whose Yahoo feed is dead (robusta / RM=F): instead of an
    external download we read the Barchart-sourced prices we already archive
    daily, on the *same* report date (Tuesday) the other commodities use. Looks
    back up to 6 calendar days, mirroring the yfinance close-on-report-date
    lookback, in case the exact Tuesday is a market holiday / archive gap.
    """
    by_date = _load_price_archive().get(market) or {}
    for offset in range(6):
        day = by_date.get((report_date - timedelta(days=offset)).isoformat())
        if not day:
            continue
        # Front month = first contract in insertion (expiry) order; the archive
        # drops expired contracts, so the first entry is the active front month.
        first = next(iter(day.values()), None)
        if first and first.get("price") is not None:
            return float(first["price"])
    return None


def _backfill_archive_prices(db) -> None:
    """Self-heal price history for internal_archive symbols (robusta).

    The main upsert loop only writes the latest COT date, but the archive holds
    every past Tuesday — so fill any CommodityPrice rows still missing in the
    52-week window the macro_cot export reads. One run backfills the whole
    history (robusta had no prices at all while RM=F was dead); subsequent runs
    are no-ops once every date is populated.
    """
    from models import CommodityCot, CommodityPrice
    from scraper.db_macro import upsert_commodity_price

    cutoff = date.today() - timedelta(weeks=52)
    for sym, spec in COMMODITY_SPECS.items():
        if spec.get("price_source") != "internal_archive":
            continue
        have = {
            p.date
            for p in db.query(CommodityPrice).filter(
                CommodityPrice.symbol == sym,
                CommodityPrice.date > cutoff,
                CommodityPrice.close_price.isnot(None),
            )
        }
        cot_dates = [
            r.date
            for r in db.query(CommodityCot).filter(
                CommodityCot.symbol == sym, CommodityCot.date > cutoff
            )
        ]
        filled = 0
        for d in cot_dates:
            if d in have:
                continue
            price = _front_month_price_from_archive(spec["internal_market"], d)
            if price is not None:
                upsert_commodity_price(db, sym, d, price)
                filled += 1
        if filled:
            print(f"[macro_cot] backfilled {filled} {sym} prices from archive", file=sys.stderr)


def _fetch_and_upsert(db) -> None:
    from sqlalchemy import func

    from models import CommodityCot, CommodityPrice
    from scraper.db import upsert_cot_weekly
    from scraper.db_macro import upsert_commodity_cot, upsert_commodity_price

    today = date.today()
    year  = today.year

    # Snapshot current max date before downloading — used for staleness guard below
    prev_arabica_date = db.query(func.max(CommodityCot.date)).filter_by(symbol="arabica").scalar()

    # ── Pre-download gate (2026-08 Actions-efficiency pass) ───────────────────
    # CFTC/ICE publish WEEKLY (Fri ~15:30 ET, holiday-shifted), but this runs
    # daily inside scraper 1.1 — so ~5 runs a week downloaded + parsed both
    # ZIPs just to hit the no-new-data early-return below. Skip the downloads
    # entirely (pure-DB check, zero network) when ALL of:
    #   • no manual deep-heal requested (MACRO_COT_HEAL_WEEKS unset);
    #   • the next report physically can't be in the files yet (today <= its
    #     holiday-aware release date — it publishes ~20:30 UTC that day, hours
    #     AFTER the 01:07 UTC daily run, so first pickup is release+1 either way
    #     and this gate adds zero data latency);
    #   • the latest ingested week is COMPLETE — every symbol present the week
    #     before is present now (keeps the ICE-file-lags-CFTC partial-week case
    #     downloading daily until healed, per the 2026-06-30 incident);
    #   • no stored price in the window is insane or a corrupt-batch jump
    #     survivor (poisoned prices must keep retrying daily).
    if prev_arabica_date is not None and not os.environ.get(_HEAL_WEEKS_ENV, ""):
        from scraper.cot_calendar import cot_release_date as _release_date
        from scraper.price_sanity import baselines_by_symbol as _bases
        from scraper.price_sanity import is_price_sane as _sane
        from scraper.price_sanity import weekly_jump_pairs as _jumps

        _next_tue = prev_arabica_date + timedelta(days=7)
        _release  = _release_date(_next_tue)
        if today <= _release:
            _wstart = prev_arabica_date - timedelta(weeks=SELF_HEAL_WEEKS)
            # Window completeness: for each symbol, every window report-date on
            # or after its first appearance must have a row. Catches interior
            # holes (robusta missing a middle week — the 2026-06-30 incident
            # seen a week later) AND a symbol lagging the latest week (the
            # incident on the day). A symbol that leaves the complex triggers
            # downloads only until its rows age out of the window.
            _rows = (db.query(CommodityCot.symbol, CommodityCot.date)
                       .filter(CommodityCot.date >= _wstart).all())
            _all_dates = sorted({d for (_, d) in _rows})
            _by_sym: dict = {}
            for (s, d) in _rows:
                _by_sym.setdefault(s, set()).add(d)
            _holes = {
                (s, d) for s, ds in _by_sym.items()
                for d in _all_dates if d >= min(ds) and d not in ds
            }
            _prows = db.query(CommodityPrice).filter(CommodityPrice.date >= _wstart).all()
            _pb = _bases(_prows)
            _insane = [p for p in _prows
                       if p.close_price is not None and not _sane(p.close_price, _pb.get(p.symbol))]
            _jmp = _jumps(_prows)
            if not _holes and not _insane and not _jmp:
                print(f"[macro_cot] gate: next report ({_next_tue}) not due until {_release}; "
                      f"window complete ({len(_by_sym)} symbols × {len(_all_dates)} weeks), "
                      "prices sane — skipping CFTC/ICE downloads.", file=sys.stderr)
                return
            print(f"[macro_cot] gate: no-new-report day but proceeding — "
                  f"holes={sorted(_holes)[:6]} insane={len(_insane)} "
                  f"jumps={len(_jmp)}", file=sys.stderr)

    # Download CFTC — fallback to prior year if current year returns 0 rows
    _phase(f"download_cftc({year})")
    try:
        cftc_df = _download_cftc_df(year)
        if len(cftc_df) == 0:
            raise ValueError("empty")
    except Exception as e:
        print(f"[macro_cot] CFTC {year} unavailable ({e}), falling back to {year - 1}", file=sys.stderr)
        cftc_df = _download_cftc_df(year - 1)
    print(f"[macro_cot] CFTC rows: {len(cftc_df)}", file=sys.stderr)

    # Download ICE Europe — same fallback
    _phase(f"download_ice({year})")
    try:
        ice_df = _download_ice_df(year)
        if len(ice_df) == 0:
            raise ValueError("empty")
    except Exception as e:
        print(f"[macro_cot] ICE {year} unavailable ({e}), falling back to {year - 1}", file=sys.stderr)
        ice_df = _download_ice_df(year - 1)
    print(f"[macro_cot] ICE rows: {len(ice_df)}", file=sys.stderr)

    _phase("parse_positions")
    # {symbol: [(report_date, fields), ...]} newest-first over the trailing
    # window — every run re-reads the recent history it already downloaded, so a
    # week missed by an earlier run heals automatically. The MACRO_COT_HEAL_WEEKS
    # env (workflow_dispatch "heal_weeks" input) widens the window for manual
    # deep heals AND forces the upsert phase even when nothing looks missing —
    # that's how months-old rows corrupted by an older parser get overwritten.
    heal_env = os.environ.get(_HEAL_WEEKS_ENV, "")
    weeks_back = int(heal_env) if heal_env else SELF_HEAL_WEEKS
    force_heal = bool(heal_env)
    if force_heal:
        print(f"[macro_cot] {_HEAL_WEEKS_ENV}={weeks_back} — deep heal, forcing upsert", file=sys.stderr)
    cot_data = {}
    cot_data.update(_parse_cftc(cftc_df, weeks_back=weeks_back))
    cot_data.update(_parse_ice(ice_df, weeks_back=weeks_back))

    # Log report dates seen in the window (helps diagnose stale/lagging feeds)
    dates_seen = sorted({str(rd) for rows_ in cot_data.values() for (rd, _) in rows_})
    print(f"[macro_cot] report dates in this run ({weeks_back}wk window): {dates_seen}", file=sys.stderr)

    # ── Self-heal detection: which (symbol, date) rows are missing in the DB? ──
    # E.g. 2026-06-30 lost the whole ICE complex (robusta/brent/gasoil/white
    # sugar/cocoa London) because the ICE file lagged the holiday-shifted CFTC
    # run and the old code only ever ingested the newest row per symbol.
    all_pairs = {(sym, rd) for sym, rows_ in cot_data.items() for (rd, _) in rows_}
    window_start = min((rd for (_, rd) in all_pairs), default=today)
    existing_positions = set(
        db.query(CommodityCot.symbol, CommodityCot.date)
          .filter(CommodityCot.date >= window_start)
          .all()
    )
    missing_positions = all_pairs - existing_positions

    # Price trust-state for the window, computed BEFORE the guard so poisoned
    # prices count as a reason to proceed: pairs whose stored price is
    # per-value insane (dead/garbled feed) or a >±50% weekly jump (sub-3x
    # corrupt-batch survivor — arabica's poisoned 6.31 vs real ~3.15). Both are
    # transient (a fresh refetch resolves them), unlike permanently price-less
    # symbols (lumber) whose null rows deliberately do NOT trigger runs.
    from scraper.price_sanity import baselines_by_symbol, is_price_sane, weekly_jump_pairs

    price_rows_window = (
        db.query(CommodityPrice)
          .filter(CommodityPrice.date >= window_start)
          .all()
    )
    price_baselines = baselines_by_symbol(price_rows_window)
    sane_priced = {
        (p.symbol, p.date) for p in price_rows_window
        if p.close_price is not None and is_price_sane(p.close_price, price_baselines.get(p.symbol))
    }
    stored_insane = {
        (p.symbol, p.date) for p in price_rows_window
        if p.close_price is not None and not is_price_sane(p.close_price, price_baselines.get(p.symbol))
    }
    jump_pairs = weekly_jump_pairs(price_rows_window) & all_pairs
    poisoned_pairs = (stored_insane & all_pairs) | jump_pairs
    if poisoned_pairs:
        print(f"[macro_cot] {len(poisoned_pairs)} poisoned price pairs to refetch: "
              f"{sorted(poisoned_pairs)[:8]}", file=sys.stderr)

    new_arabica_date = cot_data.get("arabica", [(None, None)])[0][0]

    # Guard: if downloaded arabica date is not newer than DB, CFTC hasn't
    # published yet. This is the normal state mid-week — CFTC posts ~15:30 ET on
    # the report week's Friday (or, when a US federal holiday falls in that week,
    # on the holiday-shifted business day). Don't fail — just no-op the upsert
    # phase, UNLESS the window has holes to heal. We only escalate to a hard
    # error when the *next* report is genuinely overdue against its holiday-aware
    # expected release date.
    if prev_arabica_date is not None and new_arabica_date is not None and new_arabica_date <= prev_arabica_date:
        from scraper.cot_calendar import cot_release_date, next_report_overdue

        today = date.today()
        gap_days = (today - prev_arabica_date).days
        next_report_tue = prev_arabica_date + timedelta(days=7)
        expected_release = cot_release_date(next_report_tue)
        if next_report_overdue(prev_arabica_date, today):
            raise ValueError(
                f"[macro_cot] DB COT data is {gap_days} days stale "
                f"(latest={prev_arabica_date}, downloaded={new_arabica_date}); "
                f"the {next_report_tue} report was due {expected_release} and is "
                "still missing — CFTC may be having a real outage, investigate."
            )
        if not missing_positions and not poisoned_pairs and not force_heal:
            print(
                f"[macro_cot] no new COT data yet — DB has {prev_arabica_date}, "
                f"downloaded {new_arabica_date} (gap {gap_days} d). Next report "
                f"({next_report_tue}) is due {expected_release}; not published yet. "
                "Window complete — skipping upsert.",
                file=sys.stderr,
            )
            return
        if missing_positions:
            print(
                f"[macro_cot] no new COT data, but {len(missing_positions)} "
                f"(symbol, date) rows are missing in the {weeks_back}wk window "
                f"— proceeding to self-heal: {sorted(missing_positions)[:10]}",
                file=sys.stderr,
            )
    elif missing_positions - {(s, new_arabica_date) for s in cot_data}:
        healed = sorted(p for p in missing_positions if p[1] != new_arabica_date)
        print(f"[macro_cot] self-healing {len(healed)} older missing rows alongside "
              f"the new week: {healed[:10]}", file=sys.stderr)

    # Upsert COT rows into commodity_cot — every (symbol, date) in the window.
    # Idempotent: unchanged existing rows are simply overwritten in place.
    total_rows = sum(len(v) for v in cot_data.values())
    _phase(f"upsert_commodity_cot({len(cot_data)} symbols, {total_rows} rows)")
    for sym, rows_ in cot_data.items():
        for report_date, fields in rows_:
            upsert_commodity_cot(db, sym, report_date, fields)

    # ── Upsert full positions + trader counts into cot_weekly for arabica/robusta ──
    # This keeps the Dry Powder chart current without requiring a manual Excel import.
    # Only position/trader fields are written; price fields remain under Excel-import control.
    _phase("upsert_cot_weekly_coffee")
    arabica_full = _parse_full_symbol(
        cftc_df, _CFTC_MARKET_COL, _CFTC_DATE_COL,
        COMMODITY_SPECS["arabica"]["cftc_filter"],
        has_nr_traders=True, weeks_back=weeks_back,
    )
    for ard, arf in arabica_full:
        upsert_cot_weekly("ny", ard, arf)
    if arabica_full:
        print(f"[macro_cot] cot_weekly ny upserted for {len(arabica_full)} weeks "
              f"(latest {arabica_full[0][0]})", file=sys.stderr)
    else:
        print("[macro_cot] WARNING: arabica full parse returned no data", file=sys.stderr)

    robusta_full = _parse_full_symbol(
        ice_df, _ICE_MARKET_COL, _ICE_DATE_COL,
        COMMODITY_SPECS["robusta"]["ice_filter"],
        has_nr_traders=False, weeks_back=weeks_back,
    )
    for rbd, rbf in robusta_full:
        upsert_cot_weekly("ldn", rbd, rbf)
    if robusta_full:
        print(f"[macro_cot] cot_weekly ldn upserted for {len(robusta_full)} weeks "
              f"(latest {robusta_full[0][0]})", file=sys.stderr)
    else:
        print("[macro_cot] WARNING: robusta full parse returned no data", file=sys.stderr)

    # ── Prices: (re)fetch every pair in the window without a TRUSTED stored price ──
    # Trust-state (sane_priced / poisoned_pairs) was computed above, before the
    # staleness guard. need_price = holes (incl. the newest week) + poisoned
    # pairs; symbols with no price source (lumber) are excluded.
    need_price = {
        (sym, rd) for (sym, rd) in (all_pairs - sane_priced) | poisoned_pairs
        if COMMODITY_SPECS[sym].get("price_source")
    }

    # Build yfinance fetch list (yfinance + yfinance_gbp both need price download)
    yfinance_pairs = [
        (sym, rd) for (sym, rd) in need_price
        if COMMODITY_SPECS[sym]["price_source"] in ("yfinance", "yfinance_gbp")
    ]
    # Proxy sources price off another symbol's close on the same date — fetch
    # the underlying ticker for those dates too (it may already have a stored
    # price for its own row while the proxied symbol's date still needs one).
    for sym, rd in need_price:
        spec = COMMODITY_SPECS[sym]
        if spec["price_source"] == "proxy":
            proxy_sym = spec["price_proxy"]
            if COMMODITY_SPECS[proxy_sym]["price_source"] in ("yfinance", "yfinance_gbp"):
                yfinance_pairs.append((proxy_sym, rd))
    yfinance_pairs = sorted(set(yfinance_pairs))
    _phase(f"fetch_yfinance({len(yfinance_pairs)} pairs)")
    price_cache = _fetch_yfinance_prices(yfinance_pairs)

    # Build stooq fetch list
    stooq_pairs = sorted(
        (sym, rd) for (sym, rd) in need_price
        if COMMODITY_SPECS[sym]["price_source"] == "stooq"
    )
    _phase(f"fetch_stooq({len(stooq_pairs)} pairs)")
    stooq_cache = _fetch_stooq_prices(stooq_pairs)

    # Fetch GBP/USD rates for any yfinance_gbp symbols
    gbp_dates = {
        rd for (sym, rd) in need_price
        if COMMODITY_SPECS[sym]["price_source"] == "yfinance_gbp"
    }
    _phase(f"fetch_gbpusd({len(gbp_dates)} dates)")
    gbpusd_cache = _fetch_gbpusd_rates(gbp_dates) if gbp_dates else {}

    def _upsert_price_checked(sym_, d_, price_):
        """Refuse to (re)ingest a per-value-insane price — a refetch that comes
        back garbled must not overwrite the DB with new garbage."""
        if not is_price_sane(price_, price_baselines.get(sym_)):
            print(f"[macro_cot] WARNING: refusing insane fetched price {price_} "
                  f"for {sym_} on {d_}", file=sys.stderr)
            return
        upsert_commodity_price(db, sym_, d_, price_)

    _phase(f"upsert_prices({len(need_price)} pairs)")
    for sym, report_date in sorted(need_price):
        spec = COMMODITY_SPECS[sym]
        src  = spec["price_source"]

        if src == "yfinance":
            price = price_cache.get((sym, report_date))
            if price is None:
                print(f"[macro_cot] WARNING: no yfinance price for {sym} on {report_date}", file=sys.stderr)
                continue
            _upsert_price_checked(sym, report_date, price)

        elif src == "yfinance_gbp":
            price_gbp = price_cache.get((sym, report_date))
            gbpusd    = gbpusd_cache.get(report_date)
            if price_gbp is None:
                print(f"[macro_cot] WARNING: no yfinance price for {sym} ({spec['yfinance_ticker']}) on {report_date}", file=sys.stderr)
                continue
            if gbpusd is None:
                print(f"[macro_cot] WARNING: no GBPUSD rate for {report_date}, skipping {sym}", file=sys.stderr)
                continue
            _upsert_price_checked(sym, report_date, price_gbp * gbpusd)

        elif src == "proxy":
            proxy_sym = spec["price_proxy"]
            # The underlying ticker was fetched for this exact date above
            # (yfinance looks back up to 6 days around it for holidays).
            proxy_price = price_cache.get((proxy_sym, report_date))
            if proxy_price is None:
                print(f"[macro_cot] WARNING: no proxy price for {sym} on {report_date} (proxy={proxy_sym})", file=sys.stderr)
                continue
            converted = proxy_price * spec["proxy_to_usd_per_mt_factor"]
            _upsert_price_checked(sym, report_date, converted)

        elif src == "stooq":
            price = stooq_cache.get((sym, report_date))
            if price is None:
                print(f"[macro_cot] WARNING: no stooq price for {sym} on {report_date}", file=sys.stderr)
                continue
            _upsert_price_checked(sym, report_date, price)

        elif src == "internal_archive":
            price = _front_month_price_from_archive(spec["internal_market"], report_date)
            if price is None:
                print(f"[macro_cot] WARNING: no internal-archive price for {sym} on {report_date}", file=sys.stderr)
                continue
            _upsert_price_checked(sym, report_date, price)

    # Fill in the rest of the history for archive-priced symbols so the
    # cross-commodity 1W/1M/YTD columns are correct immediately, not only after
    # weeks of forward accumulation.
    _backfill_archive_prices(db)


async def run(page):  # page unused — no browser needed
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from scraper.db import get_session
    with get_session() as db:
        _fetch_and_upsert(db)
