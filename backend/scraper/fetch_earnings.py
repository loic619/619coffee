"""
fetch_earnings.py
Fetches annual financials + valuation + earnings dates for coffee-related
listed companies via yfinance. Writes frontend/public/data/earnings.json.

Usage:
    cd backend
    python -m scraper.fetch_earnings
"""
import sys
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import yfinance as yf

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT     = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "earnings.json"

COMPANIES = [
    # Pure-play coffee
    {"ticker": "SBUX",    "name": "Starbucks",           "group": "pure_coffee"},
    {"ticker": "BROS",    "name": "Dutch Bros",           "group": "pure_coffee"},
    {"ticker": "WEST",    "name": "Westrock Coffee",      "group": "pure_coffee"},
    {"ticker": "BRCC",    "name": "Black Rifle Coffee",   "group": "pure_coffee"},
    {"ticker": "DNUT",    "name": "Krispy Kreme",         "group": "pure_coffee"},
    # Coffee + food conglomerates
    {"ticker": "KDP",     "name": "Keurig Dr Pepper",     "group": "conglomerate"},
    {"ticker": "SJM",     "name": "JM Smucker",           "group": "conglomerate"},
    {"ticker": "KHC",     "name": "Kraft Heinz",          "group": "conglomerate"},
    {"ticker": "NESN.SW", "name": "Nestlé",               "group": "conglomerate"},
    {"ticker": "JDEP.AS", "name": "JDE Peet's",           "group": "conglomerate"},
    # Adjacent demand
    {"ticker": "QSR",     "name": "Restaurant Brands",    "group": "adjacent"},
    {"ticker": "KO",      "name": "Coca-Cola",            "group": "adjacent"},
    # Micro-caps
    {"ticker": "FARM",    "name": "Farmer Bros",          "group": "micro"},
    {"ticker": "JVA",     "name": "Coffee Holding Co",    "group": "micro"},
]


def _safe_float(val) -> float | None:
    try:
        v = float(val)
        return None if pd.isna(v) else round(v, 4)
    except Exception:
        return None


def _pct_change(cur: float | None, prev: float | None) -> float | None:
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur / prev - 1) * 100, 1)


def _fetch_financials(t: yf.Ticker) -> tuple[list[dict], str]:
    """Returns (periods, frequency) where frequency is 'quarterly' or 'annual'.
    Prefers quarterly; falls back to annual for European reporters (NESN, JDEP).
    Periods are most recent first, up to 8 quarters or 5 annual."""
    qfi = t.quarterly_income_stmt
    qbs = t.quarterly_balance_sheet
    if not qfi.empty:
        fi, bs, freq = qfi, qbs, "quarterly"
    else:
        fi, bs, freq = t.income_stmt, t.balance_sheet, "annual"
    periods = _parse_periods(fi, bs)
    return periods[:8], freq


def _parse_periods(fi, bs) -> list[dict]:
    """Extract financial periods from income statement + balance sheet DataFrames."""
    periods = []

    if fi.empty:
        return periods

    for col in fi.columns:
        period_end = col.date().isoformat()

        rev  = _safe_float(fi.loc["Total Revenue", col])          if "Total Revenue" in fi.index else None
        gp   = _safe_float(fi.loc["Gross Profit", col])           if "Gross Profit"  in fi.index else None
        ni   = _safe_float(fi.loc["Net Income", col])             if "Net Income"    in fi.index else None
        cogs_raw = _safe_float(fi.loc["Cost Of Revenue", col])    if "Cost Of Revenue" in fi.index else None
        cogs = cogs_raw if cogs_raw is not None else (round(rev - gp, 4) if rev is not None and gp is not None else None)

        # Net debt: match balance sheet column closest to this period
        net_debt = None
        if not bs.empty:
            bs_dates = [c.date().isoformat() for c in bs.columns]
            if period_end in bs_dates:
                bs_col = bs.columns[bs_dates.index(period_end)]
            else:
                # pick closest date
                diffs = [abs((pd.Timestamp(period_end) - c).days) for c in bs.columns]
                bs_col = bs.columns[diffs.index(min(diffs))]
            total_debt = _safe_float(bs.loc["Total Debt", bs_col]) if "Total Debt" in bs.index else None
            cash       = _safe_float(bs.loc["Cash And Cash Equivalents", bs_col]) if "Cash And Cash Equivalents" in bs.index else None
            if total_debt is not None and cash is not None:
                net_debt = round(total_debt - cash, 4)

        periods.append({
            "period_end":   period_end,
            "revenue":      rev,
            "cogs":         cogs,
            "gross_profit": gp,
            "net_income":   ni,
            "net_debt":     net_debt,
        })

    # Compute YoY% — compare each period to the one 4 positions later (same quarter prior year)
    # For annual data (<=5 periods) use adjacent period instead
    step = 4 if len(periods) > 5 else 1
    for i in range(len(periods) - step):
        cur  = periods[i]
        prev = periods[i + step]
        cur["revenue_yoy"]      = _pct_change(cur["revenue"],      prev["revenue"])
        cur["cogs_yoy"]         = _pct_change(cur["cogs"],         prev["cogs"])
        cur["gross_profit_yoy"] = _pct_change(cur["gross_profit"], prev["gross_profit"])
        cur["net_income_yoy"]   = _pct_change(cur["net_income"],   prev["net_income"])

    return periods


def _fetch_earnings_dates(t: yf.Ticker) -> list[dict]:
    """Returns up to 8 past/future earnings dates with EPS surprise."""
    try:
        ed = t.earnings_dates
        if ed is None or ed.empty:
            return []
        rows = []
        for dt, row in ed.iterrows():
            rows.append({
                "date":         dt.date().isoformat(),
                "eps_estimate": _safe_float(row.get("EPS Estimate")),
                "eps_actual":   _safe_float(row.get("Reported EPS")),
                "surprise_pct": _safe_float(row.get("Surprise(%)")),
            })
        return rows[:8]
    except Exception:
        return []


def _fetch_info(t: yf.Ticker) -> dict:
    info = t.info
    price   = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose"))
    w52_hi  = _safe_float(info.get("fiftyTwoWeekHigh"))
    w52_lo  = _safe_float(info.get("fiftyTwoWeekLow"))
    mktcap  = _safe_float(info.get("marketCap"))
    pe      = _safe_float(info.get("trailingPE"))
    fpe     = _safe_float(info.get("forwardPE"))
    evebitda = _safe_float(info.get("enterpriseToEbitda"))
    currency = info.get("currency", "USD")

    # YTD price change using 1y history
    ytd_pct = None
    try:
        hist = t.history(period="ytd", interval="1d", auto_adjust=True)
        if not hist.empty and price:
            ytd_start = float(hist["Close"].iloc[0])
            ytd_pct = round((price / ytd_start - 1) * 100, 1) if ytd_start else None
    except Exception:
        pass

    return {
        "price":      price,
        "currency":   currency,
        "w52_high":   w52_hi,
        "w52_low":    w52_lo,
        "mktcap":     mktcap,
        "pe":         pe,
        "forward_pe": fpe,
        "ev_ebitda":  evebitda,
        "ytd_pct":    ytd_pct,
    }


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    scraped_at = datetime.now(UTC).isoformat()
    results = []

    for co in COMPANIES:
        sym = co["ticker"]
        print(f"Fetching {sym} ({co['name']})...")
        try:
            t = yf.Ticker(sym)
            financials, frequency = _fetch_financials(t)
            earnings_dates        = _fetch_earnings_dates(t)
            market_info           = _fetch_info(t)

            results.append({
                "ticker":         sym,
                "name":           co["name"],
                "group":          co["group"],
                "scraped_at":     scraped_at,
                "frequency":      frequency,
                "market":         market_info,
                "financials":     financials,
                "earnings_dates": earnings_dates,
            })
            print(f"  OK — {len(financials)} {frequency} periods, {len(earnings_dates)} earnings dates")
        except Exception as e:
            print(f"  ERROR: {e}", file=sys.stderr)
            results.append({
                "ticker":     sym,
                "name":       co["name"],
                "group":      co["group"],
                "scraped_at": scraped_at,
                "error":      str(e),
            })

    from scraper.validate_export import safe_write_json
    safe_write_json(OUT_PATH, {"scraped_at": scraped_at, "companies": results},
                    lambda d: (isinstance(d.get("companies"), list), "companies missing"))
    print(f"\nSaved {len(results)} companies → {OUT_PATH}")


if __name__ == "__main__":
    main()
