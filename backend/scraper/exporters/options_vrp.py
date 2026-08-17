"""
options_vrp.py — the variance risk premium: what implied vol costs vs what
realized vol delivers.

Research C of the options program. Option sellers earn (and buyers pay) the
gap between the volatility priced into premiums and the volatility the future
subsequently realizes. If coffee IV is structurally rich, systematically
selling it is a carry; if it is cheap, the market underprices the frost/
drought tail. This exporter measures that gap for both contracts.

Construction
============
* ATM IV per session per tracked board: OI-agnostic interpolation at the
  money — the mean of call/put IVs on the two strikes bracketing the
  settlement (boards archive, IV populated across all 565 sessions).
* Forward realized vol: annualized close-to-close vol of the SAME contract's
  own settlements (data/contract_prices_archive.json; RM option underlyings
  map to RC futures symbols) over the next H=21 sessions.
* VRP(t) = IV(t) − RV(t→t+21), in vol points.

Two honesty rules
=================
1. Horizon mismatch is stated, not hidden: IV is for the option's remaining
   life (often months), RV is a fixed 21-session window. The premium is
   therefore "IV level vs next-month realized", the standard practical VRP,
   not a life-matched replication P&L. One life-matched datapoint exists —
   RMU26, observed over ~its whole life — and is reported separately.
2. Overlapping daily windows inflate t-stats. The headline mean uses all
   daily observations; the significance test uses NON-overlapping 21-session
   blocks only.

Writes frontend/public/data/options_vrp.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR, ROOT

BOARDS = ROOT / "data" / "options_boards_archive.json"
PRICES = ROOT / "data" / "contract_prices_archive.json"
OUT = OUT_DIR / "options_vrp.json"

H = 21                      # forward realized-vol window, sessions
ANN = 252
BUCKETS = [("near", 0, 120), ("mid", 120, 250), ("far", 250, 10_000)]


def _r(x, n: int = 2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _atm_iv(contract: dict, cols: dict) -> float | None:
    """Mean of call/put IVs on the strikes bracketing the settlement."""
    f = contract.get("px")
    if not f:
        return None
    rows = []
    for r in contract["rows"]:
        k = r[cols["strike"]]
        ivs = [v for v in (r[cols["call_iv"]], r[cols["put_iv"]]) if v]
        if k is not None and ivs:
            rows.append((k, sum(ivs) / len(ivs)))
    if len(rows) < 2:
        return None
    below = max((x for x in rows if x[0] <= f), default=None, key=lambda x: x[0])
    above = min((x for x in rows if x[0] > f), default=None, key=lambda x: x[0])
    if below and above:
        w = (f - below[0]) / (above[0] - below[0])
        return below[1] * (1 - w) + above[1] * w
    return (below or above)[1]


def _fut_symbol(u: str) -> str:
    """Options underlying → futures archive symbol (RM boards settle RC futures)."""
    return "RC" + u[2:] if u.startswith("RM") else u


def _settle_series(prices_mkt: dict, symbol: str) -> tuple[list[str], list[float]]:
    px = {d: e["price"] for d, e in ((d, prices_mkt[d].get(symbol)) for d in prices_mkt)
          if e and e.get("price") is not None}
    dates = sorted(px)
    return dates, [px[d] for d in dates]


def _fwd_rv(dates: list[str], vals: list[float], start: str, h: int = H) -> float | None:
    """Annualized close-to-close vol over the h sessions after `start`."""
    idx = max((i for i, d in enumerate(dates) if d <= start), default=None)
    if idx is None or idx + h >= len(dates):
        return None
    rets = [math.log(vals[i + 1] / vals[i]) for i in range(idx, idx + h)]
    if len(rets) < h:
        return None
    return math.sqrt(ANN * sum(x * x for x in rets) / len(rets))


def _trailing_rv(dates: list[str], vals: list[float], end: str, h: int = H) -> float | None:
    idx = max((i for i, d in enumerate(dates) if d <= end), default=None)
    if idx is None or idx - h < 0:
        return None
    rets = [math.log(vals[i + 1] / vals[i]) for i in range(idx - h, idx)]
    return math.sqrt(ANN * sum(x * x for x in rets) / len(rets)) if rets else None


def _t_mean(v: list[float]) -> float:
    if len(v) < 3:
        return float("nan")
    sd = st.stdev(v)
    return st.mean(v) / (sd / math.sqrt(len(v))) if sd else float("nan")


def _agg(obs: list[dict]) -> dict:
    """Daily-overlapping level stats + block-non-overlapping significance."""
    if not obs:
        return {"n": 0}
    vrp = [o["vrp"] for o in obs]
    # non-overlapping blocks: every H-th observation, chronological
    blocks = [o["vrp"] for o in obs[::H]]
    return {
        "n": len(obs), "start": obs[0]["date"], "end": obs[-1]["date"],
        "mean_iv": _r(st.mean([o["iv"] for o in obs]) * 100, 1),
        "mean_rv": _r(st.mean([o["rv"] for o in obs]) * 100, 1),
        "mean_vrp": _r(st.mean(vrp) * 100, 1),
        "median_vrp": _r(st.median(vrp) * 100, 1),
        "share_positive": _r(sum(1 for v in vrp if v > 0) / len(vrp) * 100, 1),
        "n_blocks": len(blocks),
        "t_blocks": _r(_t_mean(blocks), 2),
        "first_half_vrp": _r(st.mean(vrp[:len(vrp) // 2]) * 100, 1),
        "second_half_vrp": _r(st.mean(vrp[len(vrp) // 2:]) * 100, 1),
    }


def export_options_vrp() -> None:
    boards = _load(BOARDS)
    prices = _load(PRICES)
    days = boards.get("days") or {}
    header = boards.get("header") or []
    if not days or not header or not prices:
        print("  options_vrp → missing archives; skipping")
        return
    cols = {h: i for i, h in enumerate(header)}
    dates = sorted(days)

    markets = {}
    for mkt in ("arabica", "robusta"):
        pm = prices.get(mkt) or {}
        settle_cache: dict[str, tuple[list[str], list[float]]] = {}
        obs: list[dict] = []          # every (session, contract) with iv + fwd rv
        iv_series_all: dict[str, list[dict]] = {}
        for d in dates:
            for c in days[d].get(mkt) or []:
                iv = _atm_iv(c, cols)
                if iv is None or not c.get("dte") or c["dte"] <= 0:
                    continue
                sym = _fut_symbol(c["u"])
                if sym not in settle_cache:
                    settle_cache[sym] = _settle_series(pm, sym)
                sd, sv = settle_cache[sym]
                iv_series_all.setdefault(c["u"], []).append({"date": d, "iv": iv, "dte": c["dte"]})
                rv = _fwd_rv(sd, sv, d)
                if rv is None:
                    continue
                obs.append({"date": d, "contract": c["u"], "dte": c["dte"],
                            "iv": iv, "rv": rv, "vrp": iv - rv})
        obs.sort(key=lambda o: (o["date"], o["dte"]))

        # nearest-contract series for the chart (one row per session)
        nearest = {}
        for o in obs:
            cur = nearest.get(o["date"])
            if cur is None or o["dte"] < cur["dte"]:
                nearest[o["date"]] = o
        series = [{"date": k, "contract": v["contract"], "dte": v["dte"],
                   "iv": _r(v["iv"] * 100, 1), "rv_fwd": _r(v["rv"] * 100, 1),
                   "vrp": _r(v["vrp"] * 100, 1)}
                  for k, v in sorted(nearest.items())]

        by_bucket = {}
        for name, lo, hi in BUCKETS:
            by_bucket[name] = _agg([o for o in obs if lo <= o["dte"] < hi])

        # life-matched showcase: contract nearest its death — realized vol over
        # its whole observed window vs its average IV over the same window
        life = None
        min_dte_contract = min(iv_series_all,
                               key=lambda u: iv_series_all[u][-1]["dte"], default=None)
        if min_dte_contract and iv_series_all[min_dte_contract][-1]["dte"] <= 30:
            rows = iv_series_all[min_dte_contract]
            sym = _fut_symbol(min_dte_contract)
            sd, sv = settle_cache.get(sym) or _settle_series(pm, sym)
            i0 = max((i for i, x in enumerate(sd) if x <= rows[0]["date"]), default=None)
            i1 = max((i for i, x in enumerate(sd) if x <= rows[-1]["date"]), default=None)
            if i0 is not None and i1 is not None and i1 - i0 > 60:
                rets = [math.log(sv[i + 1] / sv[i]) for i in range(i0, i1)]
                rv_life = math.sqrt(ANN * sum(x * x for x in rets) / len(rets))
                # IV as priced over that window (only sessions with fwd coverage kept out —
                # use the raw IV rows so the whole life counts)
                iv_life = st.mean([x["iv"] for x in rows])
                life = {"contract": min_dte_contract,
                        "window": f'{rows[0]["date"]} → {rows[-1]["date"]}',
                        "sessions": i1 - i0,
                        "mean_iv": _r(iv_life * 100, 1), "rv": _r(rv_life * 100, 1),
                        "vrp": _r((iv_life - rv_life) * 100, 1)}

        # current read: latest IV per contract + trailing realized
        latest = {}
        for u, rows in iv_series_all.items():
            last = rows[-1]
            sym = _fut_symbol(u)
            sd, sv = settle_cache.get(sym) or _settle_series(pm, sym)
            latest[u] = {"date": last["date"], "dte": last["dte"],
                         "iv": _r(last["iv"] * 100, 1),
                         "rv_trailing": _r((_trailing_rv(sd, sv, last["date"]) or float("nan")) * 100, 1)}

        # how unusual is today's IV-minus-trailing-RV spread vs its own history?
        # Built from the RAW IV series (no forward-RV requirement), so it runs
        # to the latest session instead of stopping H sessions short.
        near_iv: dict[str, dict] = {}
        for u, rows in iv_series_all.items():
            for x in rows:
                cur = near_iv.get(x["date"])
                if cur is None or x["dte"] < cur["dte"]:
                    near_iv[x["date"]] = {"dte": x["dte"], "iv": x["iv"], "contract": u}
        spread_hist = []
        for k, v in sorted(near_iv.items()):
            sym = _fut_symbol(v["contract"])
            sd, sv = settle_cache.get(sym) or _settle_series(pm, sym)
            tr = _trailing_rv(sd, sv, k)
            if tr is not None:
                spread_hist.append({"date": k, "spread": (v["iv"] - tr) * 100})
        cur_spread = None
        if spread_hist:
            last_sp = spread_hist[-1]["spread"]
            pctile = sum(1 for x in spread_hist if x["spread"] <= last_sp) / len(spread_hist) * 100
            cur_spread = {"date": spread_hist[-1]["date"], "spread": _r(last_sp, 1),
                          "percentile": _r(pctile, 0), "n": len(spread_hist)}

        markets[mkt] = {
            "spread_now": cur_spread,
            "all": _agg(obs),
            "by_bucket": by_bucket,
            "series": series,
            "life_matched": life,
            "latest": dict(sorted(latest.items(), key=lambda kv: kv[1]["dte"])),
        }

    doc = {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "method": {
            "iv": "ATM IV per session: mean of call/put IVs on the strikes bracketing the "
                  "settlement, from the boards archive (Black-76-implied from settlement "
                  "premiums where the vendor serves no IV).",
            "rv": f"Annualized close-to-close vol of the SAME contract's settlements over the "
                  f"next {H} sessions (per-contract archive; RM underlyings map to RC futures).",
            "vrp": "VRP = IV − forward RV, vol points. Horizon mismatch (contract-life IV vs "
                   f"{H}-session RV) is inherent and stated.",
            "significance": f"Level stats use all daily (overlapping) observations; t-stats use "
                            f"non-overlapping {H}-session blocks only.",
        },
        "markets": markets,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    for mkt, m in markets.items():
        a = m["all"]
        print(f"  options_vrp.json → {mkt}: n={a.get('n')} mean IV {a.get('mean_iv')} "
              f"vs RV {a.get('mean_rv')} → VRP {a.get('mean_vrp')} pts "
              f"({a.get('share_positive')}% positive, t_blocks {a.get('t_blocks')}); "
              f"life-matched: {m['life_matched']}")


if __name__ == "__main__":
    export_options_vrp()
