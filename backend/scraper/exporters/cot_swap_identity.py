"""
cot_swap_identity.py — are swap dealers commercials, or are they speculators?

The CFTC disaggregated report splits reportable positions into Producer /
Merchant / Processor / User (PMPU), Swap Dealers, Managed Money (MM) and Other
Reportables. PMPU is unambiguously the commercial pole and MM the speculative
pole; swap dealers are the contested cohort. The common shortcut — folding
swaps into a "commercial net" alongside PMPU — is an assumption nobody in this
codebase has tested, and the app's own intraweek model leans on it (it pools
swap positions with PMPU/other/non-reportable when splitting producer vs roaster
flow).

This exporter tests it, for BOTH contracts (ICE US KC arabica, ICE Europe RC
robusta) and with the long and short legs kept separate throughout — a swap book
hedging index length behaves nothing like one hedging an OTC producer deal, so
collapsing them to a net would hide the answer.

Three independent tests
=======================
1. CO-MOVEMENT — does the swap leg move with PMPU or with MM week to week?
   Run on weekly CHANGES, not levels: every cohort's level trends with open
   interest, so level correlations are largely spurious. Reported raw and
   partialled on ΔOI, because the report's adding-up constraint (Σ longs = Σ
   shorts = OI) mechanically pushes cohort changes apart when OI is fixed.
   Also at a 4-week horizon, where weekly reporting noise averages out.

2. PRICE RESPONSE — the discriminating test. A hedger leans AGAINST the move
   (sells the rally: rising prices make forward sales attractive and mark the
   physical book up), a speculator leans WITH it. So the sign of
   corr(Δposition, weekly return) separates the poles without reference to any
   label, and where a swap leg falls between them is the answer.

3. PERSISTENCE — how sticky is the book? Weekly turnover (mean |Δ| as a share
   of the position) and the AR(1) of the level. A passive intermediated book
   barely moves; an active spec book churns.

Every statistic carries its n and t, and the price response is also reported
split-half, because an unstable coefficient is not evidence of anything.

Writes frontend/public/data/cot_swap_identity.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR

COT = OUT_DIR / "cot.json"
PRICES = OUT_DIR / "futures_price_history.json"
OUT = OUT_DIR / "cot_swap_identity.json"

MARKETS = [
    {"key": "ny", "label": "New York — KC arabica", "price": "arabica", "contract": "ICE US Coffee C"},
    {"key": "ldn", "label": "London — RC robusta", "price": "robusta", "contract": "ICE Europe Robusta"},
]
COHORTS = ["pmpu", "swap", "mm"]
ROLL = 52          # weeks, for the rolling windows
LAG4 = 4           # weeks, for the slower-horizon co-movement test


def _corr(x: list[float], y: list[float]) -> float:
    if len(x) < 8 or len(x) != len(y):
        return float("nan")
    mx, my = st.mean(x), st.mean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy) if sx and sy else float("nan")


def _t(r: float, n: int) -> float:
    """Two-sided t for a correlation; |t| > ~1.97 is p<0.05 at these n."""
    if n < 3 or math.isnan(r) or abs(r) >= 1:
        return float("nan")
    return r * math.sqrt((n - 2) / (1 - r * r))


def _resid(y: list[float], x: list[float]) -> list[float]:
    mx, my = st.mean(x), st.mean(y)
    sxx = sum((a - mx) ** 2 for a in x)
    b = sum((a - mx) * (c - my) for a, c in zip(x, y)) / sxx if sxx else 0.0
    a0 = my - b * mx
    return [c - (a0 + b * a) for a, c in zip(x, y)]


def _partial(x: list[float], y: list[float], z: list[float]) -> float:
    """corr(x, y | z) — used to strip the ΔOI channel out of a co-movement."""
    return _corr(_resid(x, z), _resid(y, z))


def _diff(v: list[float], k: int = 1) -> list[float]:
    return [v[i] - v[i - k] for i in range(k, len(v))]


def _ar1(v: list[float]) -> float:
    m = st.mean(v)
    x = [a - m for a in v]
    den = sum(a * a for a in x[:-1])
    return sum(x[i] * x[i - 1] for i in range(1, len(x))) / den if den else float("nan")


def _r(x, n: int = 3):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _asof(series: list[dict], date: str) -> float | None:
    best = None
    for row in series:
        if row["date"] <= date:
            best = row.get("price")
        else:
            break
    return best


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _market_block(rows: list[dict], mkey: str, price_series: list[dict]) -> dict:
    col = lambda k: [r[mkey][k] for r in rows]  # noqa: E731 — tight local accessor
    dates = [r["date"] for r in rows]
    oi = col("oi_total")
    d_oi, d4_oi = _diff(oi), _diff(oi, LAG4)

    # Weekly return aligned to the COT reporting date (Tuesday), as-of.
    px = [_asof(price_series, d) for d in dates]
    pidx = [i for i in range(1, len(rows)) if px[i] and px[i - 1]]
    ret = [(px[i] / px[i - 1] - 1) * 100 for i in pidx]

    cohorts: dict[str, dict] = {}
    for c in COHORTS:
        for side in ("long", "short"):
            v = col(f"{c}_{side}")
            dv_all = _diff(v)
            dv = [v[i] - v[i - 1] for i in pidx]
            r = _corr(dv, ret)
            cohorts[f"{c}_{side}"] = {
                "share_oi_pct": _r(st.mean([a / b * 100 for a, b in zip(v, oi) if b]), 2),
                "mean_lots": _r(st.mean(v), 0),
                "price_response_r": _r(r),
                "price_response_t": _r(_t(r, len(ret)), 2),
                "significant": bool(abs(_t(r, len(ret))) > 1.97) if not math.isnan(r) else False,
                "ar1": _r(_ar1(v)),
                "weekly_turnover_pct": _r(st.mean([abs(a) for a in dv_all]) / st.mean(v) * 100, 2),
            }

    legs: dict[str, dict] = {}
    for side in ("long", "short"):
        s, p, m = col(f"swap_{side}"), col(f"pmpu_{side}"), col(f"mm_{side}")
        ds, dp, dm = _diff(s), _diff(p), _diff(m)
        d4s, d4p, d4m = _diff(s, LAG4), _diff(p, LAG4), _diff(m, LAG4)
        n1 = len(ds)
        # Split-half stability of the price response — an unstable coefficient
        # is not evidence, so the card can say so rather than quote a number.
        dsv = [s[i] - s[i - 1] for i in pidx]
        h = len(pidx) // 2
        legs[side] = {
            "vs_pmpu_1w": _r(_corr(ds, dp)), "vs_mm_1w": _r(_corr(ds, dm)),
            "vs_pmpu_1w_t": _r(_t(_corr(ds, dp), n1), 2), "vs_mm_1w_t": _r(_t(_corr(ds, dm), n1), 2),
            "vs_pmpu_1w_partial": _r(_partial(ds, dp, d_oi)),
            "vs_mm_1w_partial": _r(_partial(ds, dm, d_oi)),
            "vs_pmpu_4w_partial": _r(_partial(d4s, d4p, d4_oi)),
            "vs_mm_4w_partial": _r(_partial(d4s, d4m, d4_oi)),
            "leadlag": [{"k": k,
                         "pmpu": _r(_corr(ds[k:], dp[:len(dp) - k] if k else dp)),
                         "mm": _r(_corr(ds[k:], dm[:len(dm) - k] if k else dm))}
                        for k in (0, 1, 2)],
            "price_response_first_half": _r(_corr(dsv[:h], ret[:h])),
            "price_response_second_half": _r(_corr(dsv[h:], ret[h:])),
        }

    # Rolling windows for the charts: co-movement of the swap leg with each pole,
    # and the rolling price response of all three cohorts.
    rolling: dict[str, list[dict]] = {}
    for side in ("long", "short"):
        s, p, m = col(f"swap_{side}"), col(f"pmpu_{side}"), col(f"mm_{side}")
        ds, dp, dm = _diff(s), _diff(p), _diff(m)
        out = []
        for i in range(ROLL, len(ds) + 1):
            out.append({"date": dates[i], "vs_pmpu": _r(_corr(ds[i - ROLL:i], dp[i - ROLL:i]), 3),
                        "vs_mm": _r(_corr(ds[i - ROLL:i], dm[i - ROLL:i]), 3)})
        rolling[f"comovement_{side}"] = out

        pr = []
        for j in range(ROLL, len(pidx) + 1):
            w = pidx[j - ROLL:j]
            rr = ret[j - ROLL:j]
            pt = {"date": dates[w[-1]]}
            for c in COHORTS:
                v = col(f"{c}_{side}")
                pt[c] = _r(_corr([v[i] - v[i - 1] for i in w], rr), 3)
            pr.append(pt)
        rolling[f"price_response_{side}"] = pr

    return {
        "cohorts": cohorts,
        "legs": legs,
        "rolling": rolling,
        "price_window": {"start": dates[pidx[0]] if pidx else None,
                         "end": dates[pidx[-1]] if pidx else None, "weeks": len(ret)},
    }


def export_cot_swap_identity() -> None:
    cot = _load(COT)
    prices = _load(PRICES)
    if not isinstance(cot, list) or not cot:
        print("  cot_swap_identity → cot.json empty or unexpected shape; skipping")
        return

    markets = {}
    for m in MARKETS:
        rows = [r for r in cot
                if isinstance(r.get(m["key"]), dict) and r[m["key"]].get("swap_long") is not None
                and r[m["key"]].get("oi_total")]
        if len(rows) < ROLL + 8:
            print(f"  cot_swap_identity → {m['key']}: only {len(rows)} weeks; skipping")
            continue
        block = _market_block(rows, m["key"], prices.get(m["price"]) or [])
        block.update({"label": m["label"], "contract": m["contract"],
                      "weeks": len(rows), "start": rows[0]["date"], "end": rows[-1]["date"]})
        markets[m["key"]] = block

    if not markets:
        print("  cot_swap_identity → no market had enough history")
        return

    doc = {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "method": {
            "comovement": "Pearson on weekly CHANGES in lots; partials strip ΔOI, which the "
                          "report's adding-up constraint (Σ long = Σ short = OI) would otherwise "
                          "impose on every cohort pair.",
            "price_response": "corr(Δposition, same-week % return of the front contract). "
                              "Hedgers lean against the move, speculators with it.",
            "persistence": "AR(1) of the position level and mean |Δ| as a share of the position.",
            "significance": "|t| > 1.97 ⇒ p < 0.05.",
            "roll_weeks": ROLL,
        },
        "markets": markets,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    ny = markets.get("ny", {}).get("cohorts", {})
    print(f"  cot_swap_identity.json → {len(markets)} markets; "
          f"NY price-response swap_long {ny.get('swap_long', {}).get('price_response_r')} "
          f"vs pmpu_long {ny.get('pmpu_long', {}).get('price_response_r')} "
          f"vs mm_long {ny.get('mm_long', {}).get('price_response_r')}")


if __name__ == "__main__":
    export_cot_swap_identity()
