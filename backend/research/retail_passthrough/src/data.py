"""The two legs, the deflator, the volume series. Offline, read-only.

Every loader returns a monthly PeriodIndex, says its unit in the docstring, and
fills nothing. Where a series has a known defect (the EU HICP stops in 2025-12)
the loader reports it rather than hiding it behind a reindex.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

from .paths import BACKEND, ENSO_RESULTS, PUB

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

#: German coffee tax, € per kg of roasted coffee. Set by the Kaffeesteuergesetz
#: and unchanged since 1993, which is what makes the revenue series divisible
#: into a volume. Soluble coffee is taxed at €4.78/kg and is excluded from the
#: implied volume below for that reason — see `german_volume`.
KAFFEESTEUER_EUR_PER_KG = 2.19
#: Green → roasted weight loss. A roaster loses water: 1 kg green yields about
#: 0.84 kg roasted, so a kilo of ROASTED coffee embodies ~1.19 kg of green.
ROAST_YIELD = 0.84


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


# ── the green leg ────────────────────────────────────────────────────────────

def green() -> tuple[pd.DataFrame, dict]:
    """ICO indicator prices, USD/t, monthly.

    `arabica` = Other Milds (the ICO group closest to what a US roaster buys),
    `robusta` = Robustas, `blend` = a 70/30 arabica/robusta composite — US roast
    is predominantly arabica but not purely, and the weight is varied in the
    robustness run rather than asserted here.

    Source: World Bank CMO "Pink Sheet", fetched and manifested by the ENSO
    study (`backend/research/enso_arbitrage/data/MANIFEST.json`).
    """
    df = pd.read_csv(ENSO_RESULTS / "monthly_series.csv")
    df = df.rename(columns={df.columns[0]: "month"})
    df["p"] = pd.PeriodIndex(df["month"], freq="M")
    out = df.set_index("p")[["other_milds_usd_t", "robustas_usd_t"]].rename(
        columns={"other_milds_usd_t": "arabica", "robustas_usd_t": "robusta"}).dropna(how="all")
    out["blend"] = blend(out["arabica"], out["robusta"], 0.70)
    meta = {"source": "World Bank CMO Pink Sheet (ICO indicator prices), via backend/research/enso_arbitrage",
            "unit": "USD/t", "first": str(out.index.min()), "last": str(out.dropna().index.max()),
            "n": int(out["arabica"].notna().sum()), "blend_weight_arabica": 0.70}
    return out, meta


def blend(arabica: pd.Series, robusta: pd.Series, w: float) -> pd.Series:
    """Composite green cost at weight `w` on arabica. A cost index is a weighted
    sum of PRICES, not of logs — a roaster pays the blended bill."""
    return w * arabica + (1 - w) * robusta


# ── the retail leg ───────────────────────────────────────────────────────────

RETAIL_KEYS = ("us_coffee", "us", "brazil", "eu")


def retail() -> tuple[pd.DataFrame, dict]:
    """Retail coffee price INDICES (not levels), monthly.

    us_coffee  BLS CUSR0000SEFP01, "Coffee, all", seasonally adjusted — headline
    us         BLS CUSR0000SEFP02, "Roasted coffee", the narrower basket
    brazil     IPCA café moído via BCB SGS 1635
    eu         Eurostat HICP CP01211, DE/FR/IT/ES proxy

    These are indices with arbitrary bases, so only their CHANGES are
    comparable across series and none of them can give a price per kilo — the
    limit that §4 of the report is built around.
    """
    doc = _load(PUB / "retail_cpi.json")
    ser = doc["series"]
    cols, meta = {}, {}
    for k in RETAIL_KEYS:
        if k not in ser:
            continue
        m = ser[k]["monthly"]
        cols[k] = pd.Series({pd.Period(r["period"], freq="M"): r["index"] for r in m if r.get("index")}, dtype=float)
        meta[k] = {"name": ser[k].get("name"), "n": len(m), "first": m[0]["period"], "last": m[-1]["period"],
                   "source_url": ser[k].get("source_url")}
    df = pd.DataFrame(cols).sort_index()
    # The EU series stopped 2025-12 while the others run to 2026-07. Reported,
    # not patched: it is why the EU is a footnote in this study, not a market.
    last = {k: str(df[k].dropna().index.max()) for k in df.columns}
    stale = [k for k, v in last.items() if v < max(last.values())]
    return df, {"series": meta, "last_observation": last, "stale": stale,
                "source": doc.get("source"), "last_updated": doc.get("last_updated")}


# ── deflator ─────────────────────────────────────────────────────────────────

def us_cpi_all_items() -> tuple[pd.Series, dict]:
    """US CPI-U all items, monthly index. The deflator.

    Only 2017-01 → present is in the repo (`us_cpi.json` is a 10-year window),
    so every real-terms result runs on a shorter sample than the nominal one.
    That is stated wherever a deflated number is reported rather than quietly
    shortening the headline.
    """
    doc = _load(PUB / "us_cpi.json")["series"]["all_items"]["monthly"]
    s = pd.Series({pd.Period(r["period"], freq="M"): r["index"] for r in doc if r.get("index")}, dtype=float).sort_index()
    return s, {"source": "BLS CPI-U all items, via us_cpi.json", "n": len(s),
               "first": str(s.index.min()), "last": str(s.index.max()),
               "note": "repo holds a rolling ~10-year window, so real-terms tests start 2017-01"}


# ── FX, for the Brazilian leg ────────────────────────────────────────────────

def fx_monthly(pair: str) -> pd.Series:
    """Monthly mean of a daily close from fx_history.json (2020-01 → for the
    majors). Quote convention is Yahoo's and differs by pair, so callers use
    `local_per_usd` rather than this directly."""
    pairs = _load(PUB / "fx_history.json")["pairs"]
    s = pd.Series({pd.Timestamp(r["date"]): r["close"] for r in pairs[pair]["history"] if r.get("close")},
                  dtype=float).sort_index()
    return s.groupby(s.index.to_period("M")).mean()


def local_per_usd(currency: str) -> pd.Series:
    """Units of `currency` per USD, monthly.

    A retail index denominated in euros or reais cannot be regressed on a green
    price in dollars without this: a pass-through regression that skips it is
    partly measuring the exchange rate. `EURUSD=X` is quoted the other way up
    (USD per EUR) and is inverted here; the rest are already local-per-USD.
    """
    if currency == "EUR":
        return 1.0 / fx_monthly("EURUSD=X")
    return fx_monthly({"BRL": "BRL=X", "JPY": "JPY=X", "CNY": "CNY=X", "GBP": "GBP=X"}[currency])


def usdbrl_monthly() -> pd.Series:
    """Monthly mean BRL per USD. Brazil's retail index is in BRL and the green
    price is in USD; available only from 2020, which caps the Brazilian sample."""
    return local_per_usd("BRL")


# ── the quantity leg ─────────────────────────────────────────────────────────

def german_volume() -> tuple[pd.Series, dict]:
    """Monthly German roasted-coffee volume implied by coffee-tax receipts, tonnes.

    The Kaffeesteuer is a fixed €2.19/kg on roasted coffee, unchanged since 1993,
    so receipts divided by the rate are kilograms cleared to consumption. This is
    the only monthly QUANTITY series in the repo for a consuming market, which is
    what makes the demand question askable at all.

    Two honest caveats travel with it: soluble coffee is taxed at a different
    rate (€4.78/kg) and is mixed into the same receipts, so the implied tonnage
    overstates roasted volume by the soluble share; and receipts are recognised
    when duty is paid, not when a consumer buys, so the series leads consumption
    by the trade's own stock cycle.
    """
    raw = _load(PUB / "kaffeesteuer.json")
    s = pd.Series({pd.Period(k, freq="M"): float(v) for k, v in raw.items() if len(k) == 7 and v},
                  dtype=float).sort_index()
    tonnes = s * 1000.0 / KAFFEESTEUER_EUR_PER_KG / 1000.0    # €k receipts → kg → t
    return tonnes, {"source": "German Kaffeesteuer receipts (Destatis) ÷ €2.19/kg statutory rate",
                    "unit": "tonnes roasted-equivalent", "n": int(tonnes.notna().sum()),
                    "first": str(tonnes.index.min()), "last": str(tonnes.index.max()),
                    "caveats": ["soluble coffee is taxed at €4.78/kg and is not separated in the receipts",
                                "receipts are booked on duty payment, not at the till"]}


# ── derived ──────────────────────────────────────────────────────────────────

def green_cost_per_kg_roasted(green_usd_t: pd.Series) -> pd.Series:
    """The green bill embodied in one kilo of ROASTED coffee, USD/kg.

    A roaster buys green and sells roasted, and loses ~16% of the weight to
    water. Comparing a green USD/t against a retail price per roasted kilo
    without this step understates the green share by about a fifth.
    """
    return green_usd_t / 1000.0 / ROAST_YIELD


def align(*series: pd.Series) -> pd.DataFrame:
    df = pd.concat(series, axis=1).dropna()
    return df


def log(s: pd.Series) -> pd.Series:
    return np.log(s.astype(float))
