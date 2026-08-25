"""
fetch_currency_index.py
Computes the daily Coffee Currency Index (CCI) — a DXY-replication framework
tracking the net FX impact on coffee trade from producing and consuming nations.

Formula:
    ΔI = Σ w_Ex,i × s_Ex,i  −  Σ w_Im,j × s_Im,j

Where:
    - s = the daily return of each currency's STRENGTH vs USD (positive = the
      currency strengthened against the dollar that day).
    - Exporters carry a + sign: a stronger producer currency lifts origin costs
      in USD terms → bullish coffee → index up.
    - Importers carry a − sign: a stronger consumer currency makes coffee cheaper
      for that market → bearish → index down.

    The raw FX series are stored in mixed orientations (USD-per-EUR for the
    six-letter EURUSD ticker, local-per-USD for the plain three-letter tickers),
    so each return is first normalised to a strength return via _strength_sign()
    before the weight and group sign are applied. This is what keeps the index
    economically coherent (a stronger Real pushes it up, a stronger Euro down).

Timing: daily close-to-close % change for all FX pairs.

Weights source: USDA PSD 2023/24 crop year export/import volumes.
Exporter weights normalized over the eight tracked origins (76.7% of world
exports). HNL, UGX and ETB joined 2026-08-25 — see the weight block below.
Importer weights normalized excl. USD (base currency) and untracked currencies.

Usage:
    cd backend
    python -m scraper.quant_model.fetch_currency_index
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Make backend/ importable so we can pull the shared safe_write_json helper.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np
import pandas as pd
import requests

from scraper.validate_export import (
    fx_history_swing_guard,
    safe_write_json,
    scalar_swing_guard,
)

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT       = Path(__file__).resolve().parents[3]
OUT_PATH   = ROOT / "frontend" / "public" / "data" / "quant_report.json"
FX_OUT     = ROOT / "frontend" / "public" / "data" / "fx_history.json"

# FX source: @fawazahmed0/currency-api via jsDelivr CDN.
#
# Why we're not on yfinance anymore: Yahoo Finance + cloud IPs has been a
# series of escalating cat-and-mouse fixes — first a UA override (PR #46),
# then curl_cffi TLS impersonation (PR #48), and as of May 2026 the
# workflow still produces empty data on every scheduled run. The freshness
# alert in 1.5 catches it ~3 days late.
#
# jsDelivr serves a static JSON file per date that contains USD-base rates
# for 150+ currencies, updated daily from open FX feeds. No auth, no
# Cloudflare, no rate limit, no fingerprint games — it's a CDN-cached
# static file. We fetch ~365 daily snapshots concurrently (~36s total) and
# pivot into per-ticker Series matching yfinance's old shape so the rest
# of this module is unchanged.

_FX_API_BASE = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api"
FX_HISTORY_DAYS = 365  # ~1 year of daily closes per pair

# ── Weights (USDA PSD market year 2024 = 2023/24, normalized over tracked) ────
#
# Recomputed 2026-08-25 from ONE PSD download (probe run 32825668787) when
# Honduras, Uganda and Ethiopia were added. That re-derivation was necessary,
# not cosmetic: the previous table was internally consistent (every weight =
# raw / 70.6) but its raw shares could not be reproduced from any single PSD
# pull — Colombia's figure implied a 135.6M-bag world and Indonesia's a 170.4M
# one. Bolting three origins onto that basis would have silently reweighted the
# existing five against a denominator nobody could reconstruct.
#
# Raw USDA export shares, market year 2024, world total 147,746k bags:
#   Brazil    44,750k  30.29%      Ethiopia   7,430k   5.03%
#   Vietnam   25,200k  17.06%      Indonesia  7,285k   4.93%
#   Colombia  13,377k   9.05%      Uganda     6,350k   4.30%
#   Honduras   4,960k   3.36%      Peru       3,908k   2.65%
#   Total tracked: 113,260k = 76.7% of world → normalized to 1.0
#   (was 64.0% with five origins)
#
# The three additions are publishable and they move: over five sampled 2026
# dates the ranges were UGX 5.73%, ETB 3.67%, HNL 1.38% — HNL is the quietest
# but still more variable than VND (1.01%), which already carries a 22% weight,
# so the old "illiquid, no information" objection no longer holds.
#
# Raw USDA import shares (excl. USA as base currency):
#   EU 39.2%, Japan 5.5%, Switzerland 3.0%, China 3.0%,
#   Canada 2.7%, South Korea 2.6%, UK 2.2%
#   Total tracked: 58.2% → normalized to 1.0

EXPORTERS = [
    # (yfinance ticker, display name, normalized weight)
    # NB: the plain 3-letter tickers below are stored local-per-USD, so a raw
    # positive return means the currency WEAKENED. _strength_sign() flips them
    # back to a strength return before the index applies the + exporter sign.
    ("BRL=X",  "Brazilian Real",     0.395),
    ("VND=X",  "Vietnamese Dong",    0.222),
    ("COP=X",  "Colombian Peso",     0.118),
    ("ETB=X",  "Ethiopian Birr",     0.066),
    ("IDR=X",  "Indonesian Rupiah",  0.064),
    ("UGX=X",  "Ugandan Shilling",   0.056),
    ("HNL=X",  "Honduran Lempira",   0.044),
    ("PEN=X",  "Peruvian Sol",       0.035),
]

IMPORTERS = [
    # EURUSD=X is stored USD-per-EUR (a raw positive return already means a
    # stronger Euro); the plain 3-letter tickers are local-per-USD and get
    # flipped by _strength_sign(). The index then applies the − importer sign.
    ("EURUSD=X", "Euro",          0.673),
    ("JPY=X",    "Japanese Yen",  0.095),
    ("CHF=X",    "Swiss Franc",   0.052),
    ("CNY=X",    "Chinese Yuan",  0.052),
    ("CAD=X",    "Canadian Dollar", 0.046),
    ("KRW=X",    "South Korean Won", 0.045),
    ("GBP=X",    "British Pound",  0.038),
]

# ── Frozen basket for the model's cci_overnight feature ──────────────────────
#
# open_direction.py builds cci_overnight by applying FX weights to the INTRADAY
# snapshot file, which is captured from Barchart (fetch_fx_snapshots._BARCHART_FX)
# and covers exactly the twelve pairs below. Its summation zero-fills any pair
# missing from a snapshot row and gates only on `used >= 6`, so pointing it at
# the widened EXPORTERS table would have silently shrunk EVERY historical value
# by the ~23% of weight that moved to HNL/UGX/ETB — pairs no snapshot contains —
# while still passing the gate and raising nothing.
#
# So the published index widens and the model's feature does not. This is a
# deliberate divergence, not drift: the walk-forward record was earned on the
# twelve-pair basket, and there is no intraday history for the new three to
# re-earn it on. Revisit only if Barchart turns out to quote ^USDHNL/^USDUGX/
# ^USDETB and enough overlap accumulates to re-validate.
SNAPSHOT_EXPORTERS = [
    ("BRL=X",  "Brazilian Real",    0.513),
    ("VND=X",  "Vietnamese Dong",   0.262),
    ("COP=X",  "Colombian Peso",    0.128),
    ("IDR=X",  "Indonesian Rupiah", 0.051),
    ("PEN=X",  "Peruvian Sol",      0.047),
]
SNAPSHOT_IMPORTERS = list(IMPORTERS)   # importers were not re-weighted

# Z-score lookback window (trading days)
Z_WINDOW = 252

# FX outlier guard: a single corrupt FX print (glitch, decimal slip, stale dup,
# a 0) would otherwise inject a fake spike-and-recover into the returns-based
# CCI. Reject any close implying a > ±30% one-day move. The check is vs the
# PRIOR RAW close (not the prior accepted one), so the filter self-heals: a
# one-off glitch is dropped and the next genuine print kept, while a real
# permanent step-devaluation (rare, but VND/IDR/COP can do it) re-levels on the
# next day rather than blanking the rest of the series.
_MAX_FX_DAILY_MOVE = 0.30


def _filter_fx_outliers(history: list[dict], ticker: str = "") -> tuple[list[dict], int]:
    """Drop close prints implying an absurd (> _MAX_FX_DAILY_MOVE) 1-day move or
    a non-positive value. `history` is date-sorted [{date, close}]. Returns
    (clean_history, n_dropped)."""
    clean: list[dict] = []
    prev_raw: float | None = None
    dropped = 0
    for row in history:
        try:
            c = float(row.get("close"))
        except (TypeError, ValueError):
            prev_raw = None
            continue
        if not (c > 0):
            dropped += 1
            prev_raw = None          # garbage: don't use it as a baseline
            continue
        if prev_raw is not None and abs(c / prev_raw - 1.0) > _MAX_FX_DAILY_MOVE:
            dropped += 1
            prev_raw = c             # let the next day judge against this level
            continue
        clean.append({"date": row["date"], "close": c})
        prev_raw = c
    return clean, dropped


def _merge_close_series(existing_history: "list[dict] | None", closes,
                        ticker: str = "") -> tuple[list[dict], int]:
    """Merge an existing [{date, close}] history with a fresh closes Series —
    new values win on overlapping dates, older non-overlapping dates preserved —
    then drop outlier prints. Returns (sorted_clean_history, n_dropped). Shared
    by the daily merge (fetch_currency_index) and the deep backfill so both apply
    the same merge + outlier-guard contract."""
    by_date: dict[str, float] = {}
    for row in existing_history or []:
        d, c = row.get("date"), _safe_float(row.get("close"))
        if d and c is not None:
            by_date[d] = c
    if closes is not None and not getattr(closes, "empty", True):
        for ts, val in closes.items():
            c = _safe_float(val)
            if c is not None:
                by_date[ts.date().isoformat()] = c
    hist = [{"date": d, "close": by_date[d]} for d in sorted(by_date)]
    return _filter_fx_outliers(hist, ticker)


def _safe_float(val) -> float | None:
    try:
        v = float(val)
        return None if (pd.isna(v) or np.isinf(v)) else round(v, 6)
    except Exception:
        return None


def _ticker_to_currency(ticker: str) -> tuple[str, bool]:
    """Map yfinance-style FX ticker to (currency_code, invert_flag) for the FX API.

    yfinance ticker conventions (preserved here so the index math stays identical):
      "BRL=X"     → USDBRL ticker: 5.04 BRL per USD → ('brl', invert=False)
                    jsDelivr's usd.brl gives the same number; use directly.
      "EURUSD=X"  → EURUSD ticker: 1.08 USD per EUR → ('eur', invert=True)
                    jsDelivr's usd.eur gives 0.927 (EUR per USD), so we
                    return 1/0.927 = 1.079 to match yfinance's convention.

    All our tracked tickers follow one of these two forms — single 3-letter
    code → USDXXX (no invert), six-letter XXXUSD → invert.
    """
    t = ticker.replace("=X", "").upper()
    if len(t) == 6 and t.endswith("USD"):
        return t[:3].lower(), True
    return t.lower(), False


def _strength_sign(ticker: str) -> int:
    """Convert a stored daily return into a 'currency strength vs USD' return.

    The stored series orientation (see _fetch_all_closes) is mixed:
      invert=True  → USD-per-foreign  → a +return already means the currency
                     strengthened against the dollar, so keep it (+1).
      invert=False → local-per-USD    → a +return means MORE local units per USD,
                     i.e. the currency *weakened*, so flip the sign (−1).

    Multiplying a raw return by this factor yields a strength return that is
    positive when (and only when) the currency gained on the dollar — the single
    convention the index is built on.
    """
    _, invert = _ticker_to_currency(ticker)
    return 1 if invert else -1


def _fetch_one_date(date_str: str, wanted: set[str]) -> dict[str, float] | None:
    """Fetch USD-base rates for a single date. Returns {currency: rate} or None.

    date_str = "YYYY-MM-DD" for historical, "latest" for today.
    wanted = set of currency codes we care about (lowercase ISO 4217).
    """
    url = f"{_FX_API_BASE}@{date_str}/v1/currencies/usd.json"
    try:
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            return None
        data = r.json()
        usd = data.get("usd", {})
        return {c: usd[c] for c in wanted if c in usd and usd[c] is not None}
    except Exception:
        return None


def _fetch_all_closes(tickers: list[str], days: int = FX_HISTORY_DAYS) -> dict[str, pd.Series]:
    """Fetch ~days of historical USD-base FX closes for all tickers in parallel.

    Returns {ticker: pd.Series indexed by date}. Each Series has the same
    units as yfinance's `Close` would (preserving invert convention for EURUSD).
    """
    ticker_meta = {t: _ticker_to_currency(t) for t in tickers}
    wanted_currencies = {c for c, _ in ticker_meta.values()}

    today = date.today()
    # Today's snapshot may not have a tagged version yet; use 'latest'.
    # Historical dates use 'YYYY-MM-DD'.
    date_keys = ["latest"] + [(today - timedelta(days=d)).isoformat() for d in range(1, days)]

    rates_by_date: dict[str, dict[str, float]] = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = ex.map(
            lambda d: (d, _fetch_one_date(d, wanted_currencies)),
            date_keys,
        )
        for date_key, rates in results:
            if rates:
                # Resolve 'latest' to today's date for indexing.
                resolved = today.isoformat() if date_key == "latest" else date_key
                rates_by_date[resolved] = rates

    print(f"  [fx-api] {len(rates_by_date)}/{len(date_keys)} dates fetched from jsDelivr",
          file=sys.stderr)

    out: dict[str, pd.Series] = {}
    for ticker, (currency, invert) in ticker_meta.items():
        series_data: dict[pd.Timestamp, float] = {}
        for date_str, rates in rates_by_date.items():
            v = rates.get(currency)
            if v is None or v == 0:
                continue
            series_data[pd.Timestamp(date_str)] = (1.0 / v) if invert else v
        if not series_data:
            print(f"  WARNING: no data for {ticker} (currency='{currency}')", file=sys.stderr)
            out[ticker] = pd.Series(dtype=float)
        else:
            out[ticker] = pd.Series(series_data).sort_index().dropna()
    return out


def _fetch_closes(ticker: str) -> pd.Series:
    """Legacy single-ticker wrapper. Prefer _fetch_all_closes for bulk use."""
    return _fetch_all_closes([ticker]).get(ticker, pd.Series(dtype=float))


def _fetch_returns(ticker: str) -> pd.Series:
    """Return close-to-close % changes for a ticker (legacy entrypoint)."""
    closes = _fetch_closes(ticker)
    if closes.empty:
        return pd.Series(dtype=float)
    return closes.pct_change().dropna()


def _compute_index_series(
    exporter_returns: dict[str, pd.Series],
    importer_returns: dict[str, pd.Series],
) -> pd.Series:
    """
    Compute the daily CCI values over the common date range.
    Starts at a base of 100 and accumulates daily ΔI.
    """
    # Align all series to common dates
    all_series = {}
    for ticker, _, w in EXPORTERS:
        if ticker in exporter_returns and not exporter_returns[ticker].empty:
            all_series[ticker] = exporter_returns[ticker]
    for ticker, _, w in IMPORTERS:
        if ticker in importer_returns and not importer_returns[ticker].empty:
            all_series[ticker] = importer_returns[ticker]

    if not all_series:
        return pd.Series(dtype=float)

    df = pd.DataFrame(all_series).dropna(how="all")

    # Weighted daily ΔI. Each raw return is normalised to a strength return via
    # _strength_sign(), then exporters add (+) and importers subtract (−) so the
    # index rises when producer currencies strengthen and falls when consumer
    # currencies strengthen.
    delta_i = pd.Series(0.0, index=df.index)
    for ticker, _, w in EXPORTERS:
        if ticker in df.columns:
            delta_i += df[ticker].fillna(0) * (w * _strength_sign(ticker))
    for ticker, _, w in IMPORTERS:
        if ticker in df.columns:
            delta_i += df[ticker].fillna(0) * (-w * _strength_sign(ticker))

    # Cumulative index starting at 100
    index_series = (1 + delta_i).cumprod() * 100
    return index_series


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    scraped_at = datetime.now(timezone.utc).isoformat()

    print("Fetching FX data for Coffee Currency Index...")

    # ── Bulk fetch all closes in one parallel pass ─────────────────────────────
    all_tickers = [t for t, _, _ in EXPORTERS] + [t for t, _, _ in IMPORTERS]
    all_closes = _fetch_all_closes(all_tickers)

    exporter_closes = {t: all_closes.get(t, pd.Series(dtype=float)) for t, _, _ in EXPORTERS}
    importer_closes = {t: all_closes.get(t, pd.Series(dtype=float)) for t, _, _ in IMPORTERS}

    for ticker, name, _ in EXPORTERS + IMPORTERS:
        n = len(all_closes.get(ticker, pd.Series(dtype=float)))
        print(f"  {ticker} ({name}): {n} closes")

    exporter_returns = {t: s.pct_change().dropna() for t, s in exporter_closes.items()}
    importer_returns = {t: s.pct_change().dropna() for t, s in importer_closes.items()}

    # ── Build index series ─────────────────────────────────────────────────────
    index_series = _compute_index_series(exporter_returns, importer_returns)

    if index_series.empty:
        print("ERROR: no data to compute index", file=sys.stderr)
        sys.exit(1)

    # ── Today's values ─────────────────────────────────────────────────────────
    today_value = _safe_float(index_series.iloc[-1])
    prev_value  = _safe_float(index_series.iloc[-2]) if len(index_series) > 1 else None
    daily_delta = _safe_float((today_value - prev_value) / prev_value * 100) \
        if today_value and prev_value else None

    # ── Z-score over trailing window ───────────────────────────────────────────
    window = index_series.tail(Z_WINDOW)
    mu    = _safe_float(window.mean())
    sigma = _safe_float(window.std())
    zscore = _safe_float((today_value - mu) / sigma) \
        if today_value and mu and sigma and sigma != 0 else None

    # ── Per-currency contributions (today only) ────────────────────────────────
    currency_details = []

    def _today_strength(ticker: str, returns: dict[str, pd.Series]) -> float | None:
        """Today's % strength change vs USD (positive = the currency gained)."""
        s = returns.get(ticker)
        if s is None or s.empty:
            return None
        return _safe_float(s.iloc[-1] * 100 * _strength_sign(ticker))  # in %, strength-signed

    # daily_chg is the currency's strength move vs USD (positive = stronger).
    # contribution is its signed impact on the index: + for exporters, − for
    # importers — so a stronger Real reads bullish and a stronger Euro bearish.
    for ticker, name, w in EXPORTERS:
        chg = _today_strength(ticker, exporter_returns)
        currency_details.append({
            "ticker":       ticker,
            "name":         name,
            "type":         "export",
            "weight":       w,
            "daily_chg":    chg,
            "contribution": _safe_float(chg * w / 100) if chg is not None else None,
        })

    for ticker, name, w in IMPORTERS:
        chg = _today_strength(ticker, importer_returns)
        currency_details.append({
            "ticker":       ticker,
            "name":         name,
            "type":         "import",
            "weight":       w,
            "daily_chg":    chg,
            "contribution": _safe_float(-chg * w / 100) if chg is not None else None,
        })

    total_delta_i = sum(
        c["contribution"] for c in currency_details
        if c["contribution"] is not None
    )

    # ── 30-day history for sparkline ───────────────────────────────────────────
    history = []
    for dt, val in index_series.tail(30).items():
        history.append({
            "date":  dt.date().isoformat(),
            "value": _safe_float(val),
        })

    # ── Assemble output ────────────────────────────────────────────────────────
    cci_output = {
        "scraped_at":       scraped_at,
        "index_value":      today_value,
        "daily_delta_i":    _safe_float(total_delta_i),
        "daily_delta_pct":  daily_delta,
        "zscore":           zscore,
        "zscore_mean":      mu,
        "zscore_std":       sigma,
        "currencies":       currency_details,
        "history":          history,
    }

    # ── Merge into quant_report.json (preserving other sections) ──────────────
    existing = {}
    if OUT_PATH.exists():
        try:
            with open(OUT_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            pass

    existing["currency_index"] = cci_output
    existing["scraped_at"]     = scraped_at

    safe_write_json(
        OUT_PATH, existing,
        lambda d: (d.get("currency_index") is not None, "missing currency_index"),
        # Guard only the CCI level (a price-like scalar with parse risk); the
        # model-output sections in quant_report.json move by design and must not
        # be swing-gated.
        sanity_fn=scalar_swing_guard("currency_index", "index_value"),
    )

    print(f"\nCCI = {today_value:.2f}  ΔI = {total_delta_i:+.4f}  Z = {zscore:+.2f}")
    print(f"Saved → {OUT_PATH}")

    # ── fx_history.json: per-pair daily closes for the FX time-series widget ──
    # The Macro tab's CurrencyIndexSection shows the aggregate index. This file
    # backs the FX time-series widget AND the open-direction model's CCI features.
    #
    # We MERGE into the existing file rather than overwriting: the deep history
    # (built once by backfill_fx_history.py back to 2020) must persist so the
    # model's CCI features keep multi-year depth. jsDelivr only serves ~1y per
    # run, so truncating to tail(365) here would silently amputate the backfill
    # on every daily run. Merge keeps every older date and refreshes recent ones.
    existing_pairs: dict[str, dict] = {}
    if FX_OUT.exists():
        try:
            existing_pairs = (json.loads(FX_OUT.read_text(encoding="utf-8"))
                              .get("pairs") or {})
        except Exception:
            existing_pairs = {}

    def _merge_pair(ticker, name, typ, w, closes):
        hist, n_drop = _merge_close_series(
            (existing_pairs.get(ticker) or {}).get("history"), closes, ticker)
        if n_drop:
            print(f"  {ticker}: dropped {n_drop} FX outlier print(s) "
                  f"(> ±{int(_MAX_FX_DAILY_MOVE*100)}%/day)")
        return {"name": name, "type": typ, "weight": w, "history": hist} if hist else None

    fx_pairs: dict[str, dict] = {}
    for ticker, name, w in EXPORTERS:
        merged = _merge_pair(ticker, name, "export", w, exporter_closes.get(ticker))
        if merged:
            fx_pairs[ticker] = merged
    for ticker, name, w in IMPORTERS:
        merged = _merge_pair(ticker, name, "import", w, importer_closes.get(ticker))
        if merged:
            fx_pairs[ticker] = merged

    # GTQ (Guatemala) — fetched standalone, NOT part of the CCI exporter/importer
    # weights, so the Origin Farmgate panel can convert ANACAFE's quetzal café-oro
    # prices to USD/MT per day.
    try:
        gtq_closes = _fetch_all_closes(["GTQ=X"]).get("GTQ=X")
        merged = _merge_pair("GTQ=X", "USD/GTQ", "reference", 0.0, gtq_closes)
        if merged:
            fx_pairs["GTQ=X"] = merged
    except Exception as e:  # noqa: BLE001
        print(f"  GTQ=X (reference) fetch failed: {e}")

    fx_output = {
        "scraped_at":   scraped_at,
        "history_days": max((len(p["history"]) for p in fx_pairs.values()), default=0),
        "pairs":        fx_pairs,
    }
    safe_write_json(
        FX_OUT, fx_output,
        lambda d: (bool(d.get("pairs")), "no fx pairs"),
        # Cross-run guard on each pair's latest close — complements the per-row
        # outlier drop above by catching a systematic rescale/inversion.
        sanity_fn=fx_history_swing_guard(),
    )
    print(f"Saved → {FX_OUT}  ({len(fx_pairs)} pairs, "
          f"{fx_output['history_days']} max history days)")


if __name__ == "__main__":
    main()
