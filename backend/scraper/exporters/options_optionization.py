"""
options_optionization.py — the optionization ratio: how much of coffee's
open risk now lives in the options book rather than the futures book.

Research G of the options program. Options OI ÷ futures OI, matched per
contract, through time — plus the piece that matters for how this site
reads positioning: our COT feed is the CFTC's `fut_disagg` (futures-ONLY)
series, so every lot of delta-equivalent exposure sitting in options is
invisible to the cohort tables. This exporter measures the ratio, its
lifecycle shape, the migration evidence, and the size of that invisible
book against the managed-money net.

Construction
============
* Ratio: total option OI (calls + puts) of the tracked boards ÷ futures OI
  of the SAME contracts, per session (options_oi.json, which re-dates OI to
  the session it belongs to). This is the front-complex matched-pairs
  ratio — not "all coffee options / all coffee futures": untracked
  futures months (e.g. KCU26) are excluded from both sides.
* Lifecycle: per contract, ratio vs days-to-expiry. Matched-dte
  comparisons across successive contracts are the honest migration test —
  with one stated confound: the lead option board carries disproportionate
  OI regardless of calendar (KCZ26 today), so KC's cross-contract
  comparison mixes board role with vintage. RC's boards are cleaner.
* COT overlay: delta-equivalent net of the options book (Black-76 deltas
  from stored IVs — the Research E convention) at each COT Tuesday,
  against managed-money and PMPU nets from cot.json. Our COT source is
  fut_disagg_txt (futures only) — the options book is NOT in those
  numbers.

Writes frontend/public/data/options_optionization.json.
"""
from __future__ import annotations

import json
import math
import statistics as st
from collections import defaultdict
from datetime import UTC, datetime

from scraper.exporters.base import OUT_DIR, ROOT

BOARDS = ROOT / "data" / "options_boards_archive.json"
OI_HIST = OUT_DIR / "options_oi.json"
COT = OUT_DIR / "cot.json"
OUT = OUT_DIR / "options_optionization.json"

SERIES_FROM = "2026-01-01"   # front era: tracked boards are the live complex
COT_FROM = "2026-01-01"
MIN_FUT_OI = 200             # lifecycle points need a real futures book
MATCHED_DTES = [300, 250, 200, 150, 120, 100, 60, 30, 10]
DTE_TOL = 10

I_STRIKE, I_CALL_OI, I_CALL_IV, I_PUT_OI, I_PUT_IV = 0, 1, 4, 9, 12


def _r(x, n: int = 3):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _dw_net(days: dict, dt: str, mk: str) -> float | None:
    """Delta-equivalent net exposure (lots) of the tracked options book."""
    tot, ok = 0.0, False
    for b in days.get(dt, {}).get(mk, []):
        f, t = b.get("px"), b["dte"] / 365.0
        if not f or t <= 0:
            continue
        for r in b["rows"]:
            k, c_oi, p_oi = r[I_STRIKE], r[I_CALL_OI] or 0, r[I_PUT_OI] or 0
            iv = None
            for v in (r[I_CALL_IV], r[I_PUT_IV]):
                if v and 0.01 < v < 3:
                    iv = v
                    break
            if iv and k and k > 0:
                d1 = (math.log(f / k) + 0.5 * iv * iv * t) / (iv * math.sqrt(t))
                tot += c_oi * _ncdf(d1) - p_oi * (1.0 - _ncdf(d1))
                ok = True
    return tot if ok else None


def export_options_optionization():
    hist = _load(OI_HIST).get("history", [])
    cot = _load(COT)
    arch = _load(BOARDS)
    days = arch.get("days", {})
    if not hist or not cot or not days:
        raise RuntimeError("options_oi.json / cot.json / boards archive missing")

    markets = {}
    for mk, ck in (("arabica", "ny"), ("robusta", "ldn")):
        series = []
        life: dict[str, list] = defaultdict(list)
        for row in hist:
            num = den = 0
            ok = False
            for b in row.get(mk, []):
                if b.get("call_oi") is not None and b.get("fut_oi"):
                    o = (b["call_oi"] or 0) + (b["put_oi"] or 0)
                    num += o
                    den += b["fut_oi"]
                    ok = True
                    if b["fut_oi"] >= MIN_FUT_OI:
                        life[b["underlying"]].append({"dte": b["days_to_expiry"],
                                                      "ratio": _r(o / b["fut_oi"])})
            if ok and den > 0 and row["date"] >= SERIES_FROM:
                series.append({"date": row["date"], "opt": num, "fut": den,
                               "ratio": _r(num / den)})

        monthly_map = defaultdict(list)
        for x in series:
            monthly_map[x["date"][:7]].append(x["ratio"])
        monthly = [{"month": m, "ratio": _r(st.mean(v))} for m, v in sorted(monthly_map.items())]

        # matched-dte migration table across this market's contracts
        contracts = sorted(life.keys())
        matched = []
        for target in MATCHED_DTES:
            entry: dict = {"dte": target}
            hit = False
            for u in contracts:
                best = min(life[u], key=lambda p: abs(p["dte"] - target), default=None)
                if best and abs(best["dte"] - target) <= DTE_TOL:
                    entry[u] = best["ratio"]
                    hit = True
            if hit:
                matched.append(entry)

        # lifecycle curves, downsampled (every point, sorted by dte desc)
        curves = {}
        for u in contracts:
            pts = sorted({p["dte"]: p["ratio"] for p in life[u]}.items(), reverse=True)
            curves[u] = [{"dte": d, "ratio": r_} for d, r_ in pts]

        # COT Tuesdays: options delta-net vs MM / PMPU nets (futures-only feed)
        ds = sorted(days.keys())
        cot_rows = []
        for r in cot:
            t = r["date"]
            if t < COT_FROM or not r.get(ck) or r[ck].get("mm_long") is None:
                continue
            sess = max([x for x in ds if x <= t], default=None)
            if not sess:
                continue
            dwn = _dw_net(days, sess, mk)
            if dwn is None:
                continue
            mm = (r[ck]["mm_long"] or 0) - (r[ck]["mm_short"] or 0)
            pmpu = (r[ck]["pmpu_long"] or 0) - (r[ck]["pmpu_short"] or 0)
            cot_rows.append({"t": t, "dw_net": round(dwn), "mm_net": mm, "pmpu_net": pmpu,
                             "share_of_mm": _r(dwn / abs(mm), 3) if mm else None})

        # quarterly means of the invisible-book share
        q_map = defaultdict(list)
        for x in cot_rows:
            if x["share_of_mm"] is not None:
                q = f"{x['t'][:4]}-Q{(int(x['t'][5:7]) - 1) // 3 + 1}"
                q_map[q].append(x["share_of_mm"])
        quarterly_share = [{"q": q, "share": _r(st.mean(v))} for q, v in sorted(q_map.items())]

        now = series[-1] if series else None
        per_board = []
        if hist:
            # newest session with OI present
            for row in reversed(hist):
                rows_mk = [b for b in row.get(mk, []) if b.get("call_oi") is not None and b.get("fut_oi")]
                if rows_mk:
                    per_board = [{"u": b["underlying"], "dte": b["days_to_expiry"],
                                  "opt": (b["call_oi"] or 0) + (b["put_oi"] or 0),
                                  "fut": b["fut_oi"],
                                  "ratio": _r(((b["call_oi"] or 0) + (b["put_oi"] or 0)) / b["fut_oi"])}
                                 for b in rows_mk]
                    break

        markets[mk] = {
            "series": series, "monthly": monthly, "matched_dte": matched,
            "curves": curves, "cot": cot_rows, "quarterly_share": quarterly_share,
            "now": {"total": now, "per_board": per_board,
                    "latest_cot": cot_rows[-1] if cot_rows else None},
        }

    out = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "method": {
            "ratio": "total option OI (calls+puts) of tracked boards / futures OI of the SAME contracts, per session",
            "scope": "front-complex matched pairs — untracked futures months excluded from both sides",
            "cot_feed": "CFTC fut_disagg (futures ONLY) for NY; ICE London for RC — the options book is invisible to these cohort numbers",
            "dw": "delta-equivalent net via Black-76 deltas from stored per-strike IVs",
        },
        "markets": markets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    for mk, blk in markets.items():
        n = blk["now"]
        tot = n["total"]
        lc = n["latest_cot"]
        print(f"  options_optionization.json → {mk}: ratio {tot['ratio'] if tot else None} "
              f"({tot['opt'] if tot else 0} opt / {tot['fut'] if tot else 0} fut) | "
              f"dw_net {lc['dw_net'] if lc else None} vs MM {lc['mm_net'] if lc else None} "
              f"({lc['share_of_mm'] if lc else None} of MM)")


if __name__ == "__main__":
    export_options_optionization()
