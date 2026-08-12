"""
conilon_basis.py — the Brazilian conilon reference stack, and the gaps between them.

Four numbers quote the same physical coffee (Espírito Santo robusta, R$ per
60-kg saca) and none of them agree:

    Cooabriel Tipo 7 / Tipo 8   co-op purchase bid, São Gabriel da Palha (interior ES)
    CCCV Tipo 7/8               Vitória trade-centre reference, the B3 delivery spec
    CEPEA/ESALQ conilon         deal-weighted market indicator, tipo 6 / peneira 13+
    B3 CNL future               the exchange leg, settlement of the front contract

The visible gaps between them look almost constant, which is the question this
exporter answers quantitatively: what is the structural level of each gap, how
much of it is a fixed cost (freight, handling) versus an ad-valorem share
(grade discount, margin, carry), how wide can it get transiently, and why.

Method
======
* Align every leg on the CCCV Tipo 7/8 benchmark — the delivery spec, and the
  only leg quoted by the same body that the futures contract references.
* For each pair compute the gap in R$/saca and in % of the base leg, with the
  full distribution (min, p5, median, p95, max) — the "amplitude" answer.
* Split each gap with an OLS of gap on the base price:  gap = a + b·base.
  `a` is the fixed R$/saca component (a cost that does not care about the price
  level — internal freight, handling); `b` is the ad-valorem component (grade
  discount, trade margin, financing — all proportional). The R² says how much
  of the day-to-day gap that two-parameter cost model explains at all.
* Measure quote staleness per leg (share of sessions with an unchanged print)
  and the correlation between the gap's deviation from its own 60-session
  median and 5-session price momentum. Together these identify the transient
  component: an administered bid that does not reprice daily mechanically
  opens a gap when the market moves, and closes it when the bid catches up.

Writes frontend/public/data/conilon_basis.json — consumed by the
"Conilon reference stack" research card.
"""
from __future__ import annotations

import json
import math
import statistics as st
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR

VITORIA = OUT_DIR / "brazil_conilon_vitoria.json"
CEPEA = OUT_DIR / "cepea_conilon_indicator.json"
CNL = OUT_DIR / "brazil_b3_conilon.json"
OUT = OUT_DIR / "conilon_basis.json"

# Pairs studied, as (leg, base). Every pair is quoted against the CCCV Tipo 7/8
# delivery-spec benchmark except the co-op's own internal grade step (T7-T8),
# which isolates one clean grade increment.
PAIRS = [
    ("cepea", "cccv", "CEPEA indicator vs Vitória T7/8", "grade (tipo 6 vs 7/8) + deal-average vs reference quote"),
    ("co7",   "cccv", "Cooabriel T7 vs Vitória T7/8",    "interior co-op bid vs port trade reference"),
    ("co8",   "cccv", "Cooabriel T8 vs Vitória T7/8",    "same grade band, interior vs port"),
    ("cepea", "co7",  "CEPEA indicator vs Cooabriel T7", "the two quotes a producer actually compares"),
    ("co7",   "co8",  "Cooabriel T7 vs T8",              "one administered grade step, same buyer, same day"),
    ("cnl",   "cccv", "B3 CNL front vs Vitória T7/8",    "futures basis: carry, warehousing, delivery frictions"),
    ("cnl",   "cepea", "B3 CNL front vs CEPEA",          "futures vs the deal-weighted indicator"),
]

LEGS = [
    {"key": "cccv", "label": "CCCV Vitória T7/8", "tone": "slate",
     "spec": "tipo 7/8, ≤13% moisture, ≤5% broca", "place": "Vitória-ES (port)",
     "role": "trade-centre reference — the B3 CNL delivery spec"},
    {"key": "co7", "label": "Cooabriel Tipo 7", "tone": "rose",
     "spec": "tipo 7", "place": "São Gabriel da Palha-ES (interior)",
     "role": "co-op purchase bid to its member farmers"},
    {"key": "co8", "label": "Cooabriel Tipo 8", "tone": "rose",
     "spec": "tipo 8", "place": "São Gabriel da Palha-ES (interior)",
     "role": "co-op purchase bid, one grade lower"},
    {"key": "cepea", "label": "CEPEA/ESALQ conilon", "tone": "sky",
     "spec": "tipo 6, peneira 13+", "place": "Espírito Santo market",
     "role": "deal-weighted daily indicator, cash-equivalent terms"},
    {"key": "cnl", "label": "B3 CNL front", "tone": "emerald",
     "spec": "tipo 7/8 deliverable", "place": "licensed warehouses ES",
     "role": "futures settlement of the nearest contract"},
]

MOM_WINDOW = 5        # sessions, for the momentum test
MED_WINDOW = 60       # sessions, for the "structural" rolling median


# ── small stats helpers (stdlib only, like the rest of the exporters) ────────

def _pct(v: list[float], p: float) -> float:
    v = sorted(v)
    if not v:
        return float("nan")
    k = (len(v) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)


def _ols(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """(intercept, slope, R²) — the fixed / ad-valorem split of a gap."""
    n = len(xs)
    if n < 10:
        return float("nan"), float("nan"), float("nan")
    mx, my = st.mean(xs), st.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return float("nan"), float("nan"), float("nan")
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    a = my - b * mx
    ssr = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    sst = sum((y - my) ** 2 for y in ys)
    return a, b, (1 - ssr / sst) if sst else float("nan")


def _corr(xs: list[float], ys: list[float]) -> float:
    if len(xs) < 10:
        return float("nan")
    mx, my = st.mean(xs), st.mean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if not sx or not sy:
        return float("nan")
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def _r(x: float, n: int = 2) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, n)


# ── frame assembly ──────────────────────────────────────────────────────────

def _quote(entry: dict, section: str, tipo_exact: str | None = None,
           tipo_sub: str | None = None) -> float | None:
    for q in entry.get("quotes", []):
        if section in q.get("section", ""):
            tipo = q.get("tipo", "").strip()
            if tipo_exact and tipo == tipo_exact:
                return q.get("price")
            if tipo_sub and tipo_sub in tipo:
                return q.get("price")
    return None


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _frame() -> list[dict]:
    """One row per Vitória session: every leg's print, or None."""
    viz = (_load(VITORIA).get("history") or [])
    cepea = {e["date"]: e.get("price") for e in (_load(CEPEA).get("history") or [])}
    cnl = {e["date"]: e.get("front_price") for e in (_load(CNL).get("history") or [])}
    rows = []
    for e in viz:
        d = e.get("date")
        if not d:
            continue
        rows.append({
            "date": d,
            "cccv": _quote(e, "Centro do Com", tipo_sub="7/8"),
            "co7": _quote(e, "Gabriel", tipo_exact="Tipo 7"),
            "co8": _quote(e, "Gabriel", tipo_exact="Tipo 8"),
            "cepea": cepea.get(d),
            "cnl": cnl.get(d),
        })
    # CNL sessions the Vitória page missed still belong in the frame.
    known = {r["date"] for r in rows}
    for d, price in cnl.items():
        if d not in known:
            rows.append({"date": d, "cccv": None, "co7": None, "co8": None,
                         "cepea": cepea.get(d), "cnl": price})
    return sorted(rows, key=lambda r: r["date"])


def _pair_stats(rows: list[dict], leg: str, base: str, label: str, driver: str) -> dict:
    both = [(r["date"], r[leg], r[base]) for r in rows if r.get(leg) and r.get(base)]
    if len(both) < 10:
        return {"key": f"{leg}_{base}", "leg": leg, "base": base, "label": label,
                "driver": driver, "n": len(both), "insufficient": True}
    gaps = [x[1] - x[2] for x in both]
    pcts = [(x[1] - x[2]) / x[2] * 100 for x in both]
    a, b, r2 = _ols([x[2] for x in both], gaps)

    # Transient component: deviation from the trailing median vs price momentum.
    devs, moms = [], []
    for i in range(MOM_WINDOW + 1, len(both)):
        window = pcts[max(0, i - MED_WINDOW):i]
        mom = (both[i][2] - both[i - MOM_WINDOW][2]) / both[i - MOM_WINDOW][2] * 100
        devs.append(pcts[i] - st.median(window))
        moms.append(mom)

    # AR(1) persistence of the % gap → half-life of an excursion.
    m = st.mean(pcts)
    dm = [p - m for p in pcts]
    denom = sum(v * v for v in dm[:-1])
    rho = sum(dm[i] * dm[i - 1] for i in range(1, len(dm))) / denom if denom else float("nan")
    half = math.log(0.5) / math.log(rho) if 0 < rho < 1 else float("nan")

    by_year: dict[str, dict] = {}
    for (d, _leg, _base), g, p in zip(both, gaps, pcts):
        yr = by_year.setdefault(d[:4], {"g": [], "p": []})
        yr["g"].append(g)
        yr["p"].append(p)
    by_month = []
    for mth in range(1, 13):
        v = [p for (d, _, _), p in zip(both, pcts) if int(d[5:7]) == mth]
        by_month.append(_r(st.mean(v)) if v else None)

    extremes = sorted(zip([x[0] for x in both], gaps, pcts), key=lambda t: t[1])
    return {
        "key": f"{leg}_{base}", "leg": leg, "base": base, "label": label, "driver": driver,
        "n": len(both), "start": both[0][0], "end": both[-1][0],
        "mean": _r(st.mean(gaps)), "sd": _r(st.pstdev(gaps)),
        "min": _r(min(gaps)), "p5": _r(_pct(gaps, 5)), "p25": _r(_pct(gaps, 25)),
        "median": _r(_pct(gaps, 50)), "p75": _r(_pct(gaps, 75)),
        "p95": _r(_pct(gaps, 95)), "max": _r(max(gaps)),
        "mean_pct": _r(st.mean(pcts)), "sd_pct": _r(st.pstdev(pcts)),
        "min_pct": _r(min(pcts)), "p5_pct": _r(_pct(pcts, 5)),
        "median_pct": _r(_pct(pcts, 50)), "p95_pct": _r(_pct(pcts, 95)),
        "max_pct": _r(max(pcts)),
        # Which parameterisation is the stable one? Lower CV wins.
        "cv_brl": _r(st.pstdev(gaps) / abs(st.mean(gaps)), 3) if st.mean(gaps) else None,
        "cv_pct": _r(st.pstdev(pcts) / abs(st.mean(pcts)), 3) if st.mean(pcts) else None,
        "fixed": _r(a), "advalorem_pct": _r(b * 100, 3), "r2": _r(r2, 3),
        "fit_at": [{"base": lvl, "gap": _r(a + b * lvl)} for lvl in (700, 1000, 1500, 2000)],
        "share_positive": _r(sum(1 for g in gaps if g > 0) / len(gaps) * 100, 1),
        "momentum_corr": _r(_corr(moms, devs), 3),
        "ar1": _r(rho, 3), "half_life_sessions": _r(half, 1),
        "by_year": {y: {"mean": _r(st.mean(v["g"])), "mean_pct": _r(st.mean(v["p"]))}
                    for y, v in sorted(by_year.items())},
        "by_month_pct": by_month,
        "widest": [{"date": d, "gap": _r(g), "pct": _r(p)} for d, g, p in extremes[-4:][::-1]],
        "tightest": [{"date": d, "gap": _r(g), "pct": _r(p)} for d, g, p in extremes[:4]],
    }


def _staleness(rows: list[dict]) -> dict:
    out = {}
    for leg in ("cccv", "co7", "co8", "cepea", "cnl"):
        s = [r[leg] for r in rows if r.get(leg) is not None]
        if len(s) < 10:
            continue
        diffs = [abs(s[i] - s[i - 1]) for i in range(1, len(s))]
        out[leg] = {
            "n": len(s),
            "unchanged_pct": _r(sum(1 for d in diffs if d < 1e-9) / len(diffs) * 100, 1),
            "mean_abs_change": _r(st.mean(diffs)),
            "max_abs_change": _r(max(diffs)),
        }
    return out


def export_conilon_basis() -> None:
    rows = _frame()
    if not rows:
        print("  conilon_basis → no input history")
        return

    pairs = [_pair_stats(rows, leg, base, label, driver) for leg, base, label, driver in PAIRS]

    # Daily series for the chart: levels + the two deep gaps in %.
    series = []
    for r in rows:
        pt = {"date": r["date"]}
        for k in ("cccv", "co7", "co8", "cepea", "cnl"):
            if r.get(k) is not None:
                pt[k] = r[k]
        if r.get("cepea") and r.get("cccv"):
            pt["g_cepea"] = round((r["cepea"] - r["cccv"]) / r["cccv"] * 100, 3)
        if r.get("co7") and r.get("cccv"):
            pt["g_co7"] = round((r["co7"] - r["cccv"]) / r["cccv"] * 100, 3)
        if r.get("cnl") and r.get("cccv"):
            pt["g_cnl"] = round((r["cnl"] - r["cccv"]) / r["cccv"] * 100, 3)
        series.append(pt)

    covered = [r for r in rows if r.get("cccv")]
    # The ladder reads the last session the physical legs all printed; the
    # futures leg is stamped separately because B3 settles after the physical
    # tables are published (so its last date can run one session ahead).
    last_phys = next((s for s in reversed(series) if "cccv" in s), {})
    last_cnl = next((s for s in reversed(series) if "cnl" in s), {})
    doc = {
        "unit": "BRL/saca_60kg",
        "updated": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "window": {"start": covered[0]["date"] if covered else None,
                   "end": covered[-1]["date"] if covered else None,
                   "sessions": len(covered)},
        "legs": LEGS,
        "latest": {**{k: v for k, v in last_phys.items()},
                   "cnl": last_cnl.get("cnl"), "cnl_date": last_cnl.get("date")},
        "pairs": pairs,
        "staleness": _staleness(rows),
        "series": series,
        "sources": [
            "Centro do Comércio de Café de Vitória (CCCV) — disponível table via noticiasagricolas",
            "Cooperativa Agrária dos Cafeicultores de São Gabriel (Cooabriel) — same table",
            "CEPEA/ESALQ conilon indicator (Universidade de São Paulo)",
            "B3 — Contrato Futuro de Café Conilon (CNL), settlement",
        ],
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    deep = next((p for p in pairs if p["key"] == "cepea_cccv"), {})
    print(f"  conilon_basis.json → {len(series)} sessions, {len(pairs)} pairs; "
          f"CEPEA−CCCV mean R$ {deep.get('mean')} ({deep.get('mean_pct')}%)")


if __name__ == "__main__":
    export_conilon_basis()
