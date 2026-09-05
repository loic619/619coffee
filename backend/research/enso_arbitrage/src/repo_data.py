"""Readers for the series already in this repository. Offline, read-only.

Every function returns a pandas object indexed by a real date, with the unit
in the docstring and nothing silently filled. Where a source has a known
defect the rule applied is written here and logged, never buried.
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import sys
from pathlib import Path

import pandas as pd

from .paths import BACKEND, PUB, REPO_DATA, SEED, VN_LOCAL_OVERRIDE

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
from contract_dates import calc_fnd, market_for, trading_days_to  # noqa: E402

LB_PER_MT = 2204.62
KC_CENTS_TO_USD_MT = LB_PER_MT / 100          # ¢/lb → USD/t, as lib/units.ts
ROBUSTA_LOT_T = 10                            # one London lot is 10 tonnes


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


# ── futures: the clean per-contract archive, NOT futures_price_history.json ──
# (that file's arabica "front" was a two-years-deferred contract for 26 months;
#  see notes/futures_price_history_defect.md)

def contract_archive() -> dict:
    """{market: {date: {symbol: {price, oi}}}} from data/contract_prices_archive.json."""
    doc = _load(REPO_DATA / "contract_prices_archive.json")
    return {"arabica": doc["arabica"], "robusta": doc["robusta"]}


def _expiry_key(sym: str) -> tuple[int, int]:
    from contract_dates import LETTER_TO_MONTH
    return 2000 + int(sym[-2:]), LETTER_TO_MONTH[sym[-3].upper()]


def front_series(market: str, roll_days_before_fnd: int | None = None, position: int = 1) -> pd.DataFrame:
    """Continuous nearby series from the archive, rolled by CALENDAR RULE, not by OI.

    front(d) = the earliest-expiring listed contract whose First Notice Day is
    still more than `roll_days_before_fnd` exchange trading days away.
    `position=2` returns the contract after that one. Deterministic, immune to
    a bad OI print, and it never steps backwards. Default roll: 5 trading days
    before FND for KC, 3 for RC (RC's FND is itself only 4 days before the
    delivery month).

    Columns: price (native unit: KC ¢/lb, RC USD/t), contract, fnd.
    """
    arch = contract_archive()[market]
    if roll_days_before_fnd is None:
        roll_days_before_fnd = 5 if market == "arabica" else 3
    rows = []
    fnd_cache: dict[str, dt.date | None] = {}
    for d in sorted(arch):
        day = arch[d] or {}
        dd = dt.date.fromisoformat(d)
        # The nearby is chosen among EVERY listed contract, priced or not. On a
        # partial archive day (2026-08-31: only RCU26 and RCH28 carried a price)
        # choosing among priced contracts alone would hand the front to a
        # contract eighteen months out. If the true nearby has no price that
        # day, the day is a gap, not a jump.
        live = []
        for s, v in day.items():
            if not isinstance(v, dict):
                continue
            if s not in fnd_cache:
                fnd_cache[s] = calc_fnd(s)
            f = fnd_cache[s]
            if f is None:
                continue
            mkt = market_for(s) or "us"
            if trading_days_to(dd, f, mkt) < -roll_days_before_fnd:   # negative = before FND
                live.append((_expiry_key(s), s, v.get("price"), f))
        live.sort()
        if len(live) < position:
            continue
        _, s, p, f = live[position - 1]
        if p is None:
            continue
        rows.append({"date": pd.Timestamp(dd), "price": float(p), "contract": s, "fnd": pd.Timestamp(f)})
    return pd.DataFrame(rows).set_index("date").sort_index()


def front_series_max_oi(market: str) -> pd.DataFrame:
    """Robustness variant: max-OI front, but a candidate must be one of the two
    nearest unexpired contracts — the guard that would have stopped KCZ23."""
    arch = contract_archive()[market]
    rows = []
    for d in sorted(arch):
        day = arch[d] or {}
        dd = dt.date.fromisoformat(d)
        priced = {s: v for s, v in day.items() if isinstance(v, dict) and v.get("price") is not None}
        unexp = sorted((_expiry_key(s), s) for s in priced
                       if (calc_fnd(s) or dt.date.min) > dd)
        if not unexp:
            continue
        nearest = [s for _, s in unexp[:2]]
        with_oi = {s: priced[s].get("oi") or 0 for s in nearest}
        front = max(with_oi, key=with_oi.get) if any(with_oi.values()) else nearest[0]
        rows.append({"date": pd.Timestamp(dd), "price": float(priced[front]["price"]), "contract": front})
    return pd.DataFrame(rows).set_index("date").sort_index()


def intraday_1730() -> pd.DataFrame:
    """Same-instant KC and RC at 17:30 London, plus settles. From intraday_kc_rc_15min.json.
    Columns: kc_1730 (¢/lb), rc_1730 (USD/t), kc_settle, rc_settle. 2020-10 →."""
    rows = _load(PUB / "intraday_kc_rc_15min.json")
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return (df.set_index("date")[["kc_last_1730", "rc_last_1730", "kc_settle", "rc_settle"]]
              .rename(columns={"kc_last_1730": "kc_1730", "rc_last_1730": "rc_1730"})
              .astype(float).sort_index())


# ── physical legs ─────────────────────────────────────────────────────────────

VN_OUTLIER_PCT = 0.30   # a print this far from its 15-day neighbours is a parse error, not a market


def origin_price(origin: str) -> tuple[pd.Series, list[dict]]:
    """Daily local price for one origin from origin_prices_history.json, native unit.

    vietnam: VND/kg (giacaphe, FAQ G2 Dak Lak); brazil_arabica: R$/saca 60 kg
    (Tipo 6/7 trimmed co-op mean); brazil_conilon: R$/saca (Vitória T7).
    Returns (series, exclusions). Exclusions are listed, never filled.
    """
    doc = _load(PUB / "origin_prices_history.json")["origins"][origin]
    s = pd.Series({pd.Timestamp(r["date"]): r["price"] for r in doc["history"] if r.get("price")},
                  dtype=float).sort_index()
    excl: list[dict] = []
    if origin == "vietnam":
        # local-median screen: |x / median(±7 obs) − 1| > 30 %
        med = s.rolling(15, center=True, min_periods=6).median()
        bad = (s / med - 1).abs() > VN_OUTLIER_PCT
        for d in s.index[bad.fillna(False)]:
            excl.append({"date": d.date().isoformat(), "price": float(s[d]), "local_median": float(med[d]),
                         "rule": f"> {VN_OUTLIER_PCT:.0%} off 15-obs local median"})
        s = s[~bad.fillna(False)]
    return s, excl


def vietnam_local() -> tuple[pd.Series, list[dict], str]:
    """The Vietnam leg: the user-supplied history if present, else the repo series.
    Returns (VND/kg daily, exclusions, provenance)."""
    if VN_LOCAL_OVERRIDE.exists():
        df = pd.read_csv(VN_LOCAL_OVERRIDE, parse_dates=["date"])
        s = df.set_index("date")["price_vnd_per_kg"].astype(float).sort_index()
        return s, [], f"user-supplied {VN_LOCAL_OVERRIDE.name}"
    s, excl, = origin_price("vietnam")
    return s, excl, "origin_prices_history.json (giacaphe, 2021-05 →)"


def fx() -> pd.DataFrame:
    """Daily USD/BRL and USD/VND closes (Yahoo *=X) from fx_history.json, 2020-01 →."""
    pairs = _load(PUB / "fx_history.json")["pairs"]
    out = {}
    for code, col in (("BRL=X", "usdbrl"), ("VND=X", "usdvnd")):
        out[col] = pd.Series({pd.Timestamp(r["date"]): r["close"] for r in pairs[code]["history"] if r.get("close")},
                             dtype=float)
    return pd.DataFrame(out).sort_index()


# ── ENSO ──────────────────────────────────────────────────────────────────────

def oni() -> pd.Series:
    """NOAA ONI, 3-month running mean anchored to the season's CENTRE month, 1980-01 →.
    Monthly PeriodIndex. Note the centre-month anchoring: the value at m uses
    m+1 and is published early in m+2 — see enso.availability_shift."""
    rows = _load(SEED / "oni_history_full.json")["oni"]
    s = pd.Series({pd.Period(year=r["year"], month=r["month"], freq="M"): r["value"] for r in rows}, dtype=float)
    return s.sort_index()


def nino34_weekly() -> pd.Series:
    """Weekly Niño 3.4 SST anomaly (°C vs 1991–2020), week-ending dates, 1981-09 →."""
    rows = _load(PUB / "enso_indices.json")["nino34"]["weekly"]
    return pd.Series({pd.Timestamp(r["week_ending"]): r["sst_anomaly"] for r in rows}, dtype=float).sort_index()


def soi() -> pd.Series:
    """Monthly standardised SOI (NOAA CPC), 1951-01 →. Monthly PeriodIndex."""
    rows = _load(PUB / "enso_indices.json")["soi"]["monthly"]
    return pd.Series({pd.Period(r["month"], freq="M"): r["soi"] for r in rows}, dtype=float).sort_index()


# ── confounders and mechanism links ──────────────────────────────────────────

def cert_stocks_monthly() -> pd.DataFrame:
    """Month-average ICE certified stocks. robusta_t (tonnes, lots×10) 1993-10 →;
    arabica_bags 2010-08 →. Monthly PeriodIndex."""
    rob, ara = {}, {}
    for f in sorted(glob.glob(str(PUB / "certified_stocks_robusta_deep_*.json"))):
        for s in _load(Path(f))["snapshots"]:
            if s.get("total_lots_certified") is not None:
                rob[pd.Timestamp(s["date"])] = s["total_lots_certified"] * ROBUSTA_LOT_T
    for f in sorted(glob.glob(str(PUB / "certified_stocks_arabica_deep_*.json"))):
        for s in _load(Path(f))["snapshots"]:
            if s.get("total_bags") is not None:
                ara[pd.Timestamp(s["date"])] = s["total_bags"]
    r = pd.Series(rob, dtype=float).sort_index()
    a = pd.Series(ara, dtype=float).sort_index()
    out = pd.DataFrame({"robusta_t": r.groupby(r.index.to_period("M")).mean(),
                        "arabica_bags": a.groupby(a.index.to_period("M")).mean()})
    # the 1993-10 row is a zero placeholder in the source
    out.loc[out["robusta_t"] <= 0, "robusta_t"] = float("nan")
    return out.sort_index()


def cecafe_monthly() -> pd.DataFrame:
    """Brazil green exports, 60-kg bags, 1990-01 →: arabica, conillon. Monthly PeriodIndex."""
    rows = _load(PUB / "cecafe.json")["series"]
    df = pd.DataFrame(rows)
    df["period"] = pd.PeriodIndex(df["date"], freq="M")
    return df.set_index("period")[["arabica", "conillon", "total_verde"]].astype(float).sort_index()


def weather_monthly(country: str, regions: list[str]) -> pd.DataFrame:
    """Monthly rain total (mm) and mean temperature (°C), averaged across regions,
    from backend/seed/weather_history (Open-Meteo daily, 1995-01 →). A month
    needs ≥ 25 daily records or it is left NaN — a partial month masquerades as
    a dry one. Also returns z-anomalies vs the 1995–2020 calendar-month mean/sd."""
    doc = _load(SEED / "weather_history" / f"{country}.json")["regions"]
    frames = []
    for reg in regions:
        d = doc[reg]
        df = pd.DataFrame.from_dict(d, orient="index")[["rain", "tmean"]].astype(float)
        df.index = pd.to_datetime(df.index)
        g = df.groupby(df.index.to_period("M"))
        m = pd.DataFrame({"rain": g["rain"].sum(min_count=1), "tmean": g["tmean"].mean(), "n": g["rain"].count()})
        m.loc[m["n"] < 25, ["rain", "tmean"]] = float("nan")
        frames.append(m[["rain", "tmean"]])
    m = sum(frames) / len(frames)
    base = m[(m.index.year >= 1995) & (m.index.year <= 2020)]
    mu = base.groupby(base.index.month).mean()
    sd = base.groupby(base.index.month).std()
    months = m.index.month
    m["rain_z"] = (m["rain"].values - mu.loc[months, "rain"].values) / sd.loc[months, "rain"].values
    m["tmean_z"] = (m["tmean"].values - mu.loc[months, "tmean"].values) / sd.loc[months, "tmean"].values
    return m.sort_index()


def production_annual() -> pd.DataFrame:
    """Approximate USDA PSD harvests, thousand 60-kg bags: brazil_arabica (calendar year of
    the May–Sep harvest), vietnam_robusta (marketing-year start). 1996 →."""
    b = _load(SEED / "brazil_arabica_production.json")["production_kbags"]
    v = _load(SEED / "vietnam_robusta_production.json")["production_kbags"]
    df = pd.DataFrame({"brazil_arabica": pd.Series({int(k): float(x) for k, x in b.items()}),
                       "vietnam_robusta": pd.Series({int(k): float(x) for k, x in v.items()})})
    return df.sort_index()


def cot_weekly() -> pd.DataFrame:
    """Managed-money net (long − short) for NY (KC) and London (RC), weekly, 2020-09 →."""
    rows = _load(PUB / "cot.json")
    out = []
    for r in rows:
        ny, ldn = r.get("ny") or {}, r.get("ldn") or {}
        out.append({"date": pd.Timestamp(r["date"]),
                    "mm_net_ny": (ny.get("mm_long") or 0) - (ny.get("mm_short") or 0),
                    "mm_net_ldn": (ldn.get("mm_long") or 0) - (ldn.get("mm_short") or 0)})
    return pd.DataFrame(out).set_index("date").sort_index()


BRAZIL_REGIONS = ["Sul de Minas", "Cerrado"]        # the arabica belt in the weather store
VIETNAM_REGIONS = ["Dak Lak", "Lam Dong", "Dak Nong", "Gia Lai"]   # Central Highlands robusta
