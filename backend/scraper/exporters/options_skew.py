"""
options_skew.py — the 25-delta risk reversal: what the wings price that the
ATM strike cannot.

Research D of the options program. The risk reversal RR25 = IV(25Δ call) −
IV(25Δ put) is the market's price for directional tail risk. Equity index
skew is famously put-side (crash insurance); a supply-shock commodity should
be the mirror image — and coffee is: the call wing carries a persistent
premium that swells on the Brazilian frost calendar and, on the robusta
board, flips sign with the supply cycle.

Construction
============
* Deltas are computed from the STORED per-strike IVs via Black-76
  (d1 = [ln(F/K) + σ²T/2]/(σ√T); call Δ = N(d1), put Δ = N(d1) − 1),
  uniformly across the whole archive. The vendor's own delta column is
  populated for recent sessions only — computing our own from IV keeps the
  history internally consistent.
* IV at |Δ| = 0.25 per wing: linear interpolation in delta space between the
  two bracketing strikes; a wing is null when no bracket exists or the
  bracketing deltas sit more than 0.25 apart (thin ladder).
* Board per session: the nearest tracked board with dte ≥ 7 (expiry-week
  wings are noise); RR25 in vol points, positive = calls dearer.
* Scope honesty: for much of 2024-25 only far-dated boards (500-900 dte)
  were tracked, whose listed strike ladders never reach a 25Δ call. The
  continuous daily series therefore starts 2025-07 (KC) / 2025-12 (RC) —
  same far-dated-era scope note as the gamma map and VRP papers.

Weather alignment
=================
* Brazil cold snaps: the daily weather seed stores region tmean (no Tmin),
  so a "cold snap" is a belt-minimum tmean at or below the 2.5th percentile
  of the 1995-2024 Jun-Aug distribution (11.4 °C) — a proxy calibrated on
  the 2021 frost disasters (2021-06-30 → 7.8 °C, 2021-07-20 → 11.3 °C, both
  captured; ERA5 Tmin backfill is not reachable from this environment).
* Uganda drought: weekly NOAA VHI (min across Masaka/Kasese/Mbale) against
  weekly-mean RC RR25, plus the IPHM alert onsets from the engine's own
  state block (first_seen dates).
* The alert ledger: data/iphm_alert_ledger.json accumulates one entry per
  day — active IPHM alert families per origin at max severity — so the
  "does skew lead or lag OUR published alerts" event study gains a real
  datapoint every session from 2026-08 onward. Append-once by date.
"""
from __future__ import annotations

import json
import math
import statistics as st
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from scraper.exporters.base import OUT_DIR, ROOT

BOARDS = ROOT / "data" / "options_boards_archive.json"
LEDGER = ROOT / "data" / "iphm_alert_ledger.json"
WEATHER_SEED = ROOT / "backend" / "seed" / "weather_history" / "brazil.json"
ALERTS = OUT_DIR / "agronomic_alerts.json"
VHI_UGANDA = OUT_DIR / "vhi_uganda.json"
OUT = OUT_DIR / "options_skew.json"

TARGET_DELTA = 0.25
MIN_DTE = 7                 # expiry-week wings excluded
MAX_BRACKET_GAP = 0.25      # max |Δ| gap between bracketing strikes
FROST_MONTHS = ("06", "07", "08")
SNAP_PCTILE = 2.5           # of the 1995-2024 Jun-Aug belt-min tmean dist
UGA_PROVINCES = ("Masaka", "Kasese", "Mbale")

# row indices in the boards archive
I_STRIKE, I_CALL_IV, I_PUT_IV = 0, 4, 12


def _r(x, n: int = 2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _wing_iv(rows, f: float, t: float, side: str) -> float | None:
    """IV (vol points) at |Δ| = TARGET_DELTA, interpolated in delta space."""
    pts = []
    for r in rows:
        k, iv = r[I_STRIKE], (r[I_CALL_IV] if side == "call" else r[I_PUT_IV])
        if not iv or iv <= 0.01 or iv > 3 or not k or k <= 0:
            continue
        d1 = (math.log(f / k) + 0.5 * iv * iv * t) / (iv * math.sqrt(t))
        d = _ncdf(d1) if side == "call" else abs(_ncdf(d1) - 1.0)
        pts.append((d, iv))
    pts.sort()
    lo = [p for p in pts if p[0] <= TARGET_DELTA]
    hi = [p for p in pts if p[0] >= TARGET_DELTA]
    if not lo or not hi:
        return None
    a, b = max(lo), min(hi)
    if b[0] - a[0] > MAX_BRACKET_GAP:
        return None
    if a[0] == b[0]:
        return a[1] * 100
    w = (TARGET_DELTA - a[0]) / (b[0] - a[0])
    return (a[1] + w * (b[1] - a[1])) * 100


def _atm_iv(rows, f: float) -> float | None:
    """Mean call/put IV on the strikes bracketing the settlement (vol pts)."""
    pts = []
    for r in rows:
        ivs = [v for v in (r[I_CALL_IV], r[I_PUT_IV]) if v and 0.01 < v < 3]
        if r[I_STRIKE] and ivs:
            pts.append((r[I_STRIKE], sum(ivs) / len(ivs)))
    pts.sort()
    lo = [p for p in pts if p[0] <= f]
    hi = [p for p in pts if p[0] >= f]
    if not lo or not hi:
        return None
    a, b = max(lo), min(hi)
    if a[0] == b[0]:
        return a[1] * 100
    w = (f - a[0]) / (b[0] - a[0])
    return (a[1] + w * (b[1] - a[1])) * 100


def _series(days: dict, market: str) -> list[dict]:
    out = []
    for dt in sorted(days):
        boards = sorted(days[dt].get(market, []), key=lambda b: b["dte"])
        eligible = [b for b in boards if b["dte"] >= MIN_DTE] or boards
        if not eligible:
            continue
        b = eligible[0]
        f, t = b.get("px"), b["dte"] / 365.0
        if not f or t <= 0:
            continue
        c = _wing_iv(b["rows"], f, t, "call")
        p = _wing_iv(b["rows"], f, t, "put")
        if c is None or p is None:
            continue
        a = _atm_iv(b["rows"], f)
        out.append({
            "date": dt, "u": b["u"], "dte": b["dte"], "px": f,
            "c25": _r(c), "p25": _r(p), "atm": _r(a), "rr": _r(c - p),
        })
    return out


def _corr(a: list[float], b: list[float]) -> float | None:
    if len(a) < 3:
        return None
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return num / (da * db) if da * db else None


def _t_of_r(r: float | None, n: int) -> float | None:
    if r is None or abs(r) >= 1 or n < 3:
        return None
    return r * math.sqrt(n - 2) / math.sqrt(1 - r * r)


def _summary(s: list[dict]) -> dict:
    rr = [x["rr"] for x in s]
    m = st.mean(rr)
    num = sum((rr[i] - m) * (rr[i - 1] - m) for i in range(1, len(rr)))
    den = sum((v - m) ** 2 for v in rr)
    return {
        "n": len(rr), "start": s[0]["date"], "end": s[-1]["date"],
        "mean": _r(m), "median": _r(st.median(rr)),
        "share_pos": _r(sum(1 for v in rr if v > 0) / len(rr) * 100, 1),
        "ar1": _r(num / den if den else None, 3),
        "min": _r(min(rr)), "max": _r(max(rr)),
    }


def _monthly(s: list[dict]) -> list[dict]:
    by = defaultdict(list)
    for x in s:
        by[x["date"][:7]].append(x["rr"])
    return [{"month": mo, "n": len(v), "mean": _r(st.mean(v))} for mo, v in sorted(by.items())]


def _wings_split(s: list[dict]) -> dict:
    """Call/put wing vs ATM, frost months vs rest — where the premium lives."""
    out = {}
    for label, seg in (
        ("frost", [x for x in s if x["date"][5:7] in FROST_MONTHS]),
        ("rest", [x for x in s if x["date"][5:7] not in FROST_MONTHS]),
    ):
        seg = [x for x in seg if x["atm"] is not None]
        if not seg:
            continue
        out[label] = {
            "n": len(seg),
            "c_minus_atm": _r(st.mean(x["c25"] - x["atm"] for x in seg)),
            "p_minus_atm": _r(st.mean(x["p25"] - x["atm"] for x in seg)),
        }
    return out


# ── Brazil cold-snap machinery ───────────────────────────────────────────────

def _belt_coldmin(regions: dict, d: str) -> float | None:
    vals = [regions[r][d]["tmean"] for r in regions
            if d in regions[r] and regions[r][d].get("tmean") is not None]
    return min(vals) if vals else None


def _frost_block(s: list[dict]) -> dict:
    seed = _load(WEATHER_SEED)
    regions = seed.get("regions", {})
    if not regions:
        return {}
    all_dates = sorted(set().union(*[set(v.keys()) for v in regions.values()]))

    # threshold: SNAP_PCTILE of the 1995-2024 winter belt-min tmean
    hist = sorted(
        v for v in (
            _belt_coldmin(regions, d) for d in all_dates
            if "1995" <= d[:4] <= "2024" and d[5:7] in FROST_MONTHS
        ) if v is not None
    )
    threshold = hist[int(SNAP_PCTILE / 100 * len(hist))]
    calibration = []
    for d in ("2021-06-30", "2021-07-20"):
        v = _belt_coldmin(regions, d)
        if v is not None:
            calibration.append({"date": d, "coldmin": _r(v, 1), "captured": v <= threshold})

    # episodes since 2025 (first day of each run of sub-threshold days)
    episodes, in_run = [], False
    for d in all_dates:
        if d < "2025-01-01" or d[5:7] not in ("05", "06", "07", "08", "09"):
            in_run = False
            continue
        v = _belt_coldmin(regions, d)
        cold = v is not None and v <= threshold
        if cold and not in_run:
            episodes.append({"date": d, "coldmin": _r(v, 1)})
        in_run = cold

    for e in episodes:
        # nearest session on/after the snap — but only if within 5 days
        # (the series has gaps early on; a reading weeks later is not a
        # reading "on the snap")
        after = [x for x in s if x["date"] >= e["date"]]
        near = after[0] if after and (
            date.fromisoformat(after[0]["date"]) - date.fromisoformat(e["date"])
        ).days <= 5 else None
        e["rr_on"] = near["rr"] if near else None
        e["rr_session"] = near["date"] if near else None

    fw = [x["rr"] for x in s if x["date"][5:7] in FROST_MONTHS]
    rest = [x["rr"] for x in s if x["date"][5:7] not in FROST_MONTHS]
    seasons = []
    for yr in sorted({x["date"][:4] for x in s}):
        seg = [x["rr"] for x in s if x["date"][:4] == yr and x["date"][5:7] in FROST_MONTHS]
        if len(seg) >= 10:
            n_snaps = sum(1 for e in episodes if e["date"][:4] == yr)
            seasons.append({"year": int(yr), "n": len(seg), "mean": _r(st.mean(seg)),
                            "max": _r(max(seg)), "snaps": n_snaps})

    # lead/lag vs day-of-year cold ANOMALY (level is calendar-confounded; both reported)
    doy_vals = defaultdict(list)
    d0, d1 = date(1995, 1, 1), date(2024, 12, 31)
    d = d0
    while d <= d1:
        v = _belt_coldmin(regions, d.isoformat())
        if v is not None:
            doy_vals[d.timetuple().tm_yday].append(v)
        d += timedelta(days=1)
    clim = {}
    for doy in range(1, 367):
        pool = []
        for k in range(-5, 6):
            pool += doy_vals.get((doy + k - 1) % 366 + 1, [])
        clim[doy] = st.mean(pool) if pool else None

    def _anom(diso: str) -> float | None:
        v = _belt_coldmin(regions, diso)
        c = clim.get(date.fromisoformat(diso).timetuple().tm_yday)
        return v - c if (v is not None and c is not None) else None

    def _win_anom(diso: str, sign: int) -> float | None:
        base = date.fromisoformat(diso)
        vals = [_anom((base + timedelta(days=sign * k)).isoformat()) for k in range(1, 8)]
        vals = [v for v in vals if v is not None]
        return min(vals) if vals else None

    rows = []
    for i, x in enumerate(s):
        if x["date"][5:7] not in ("05", "06", "07", "08", "09") or i == 0:
            continue
        fa, ba = _win_anom(x["date"], +1), _win_anom(x["date"], -1)
        if fa is None or ba is None:
            continue
        rows.append((x["rr"], x["rr"] - s[i - 1]["rr"], fa, ba))
    leadlag = {}
    if len(rows) > 20:
        n = len(rows)
        r_lvl_f = _corr([r[0] for r in rows], [r[2] for r in rows])
        r_lvl_b = _corr([r[0] for r in rows], [r[3] for r in rows])
        r_chg_f = _corr([r[1] for r in rows], [r[2] for r in rows])
        r_chg_b = _corr([r[1] for r in rows], [r[3] for r in rows])
        leadlag = {
            "n": n,
            "level_coming7": _r(r_lvl_f, 3), "level_past7": _r(r_lvl_b, 3),
            "change_coming7": {"r": _r(r_chg_f, 3), "t": _r(_t_of_r(r_chg_f, n))},
            "change_past7": {"r": _r(r_chg_b, 3), "t": _r(_t_of_r(r_chg_b, n))},
        }

    return {
        "threshold": _r(threshold, 1), "pctile": SNAP_PCTILE,
        "calibration": calibration, "episodes": episodes,
        "fw_mean": _r(st.mean(fw)) if fw else None,
        "rest_mean": _r(st.mean(rest)) if rest else None,
        "seasons": seasons, "leadlag": leadlag,
        "n_hist_days": len(hist),
    }


# ── Uganda drought alignment (robusta) ───────────────────────────────────────

def _iso_week(diso: str) -> str:
    y, w, _ = date.fromisoformat(diso).isocalendar()
    return f"{y}-W{w:02d}"


def _uganda_block(s: list[dict]) -> dict:
    vhi_doc = _load(VHI_UGANDA)
    provs = vhi_doc.get("provinces", {})
    weekly: dict[str, list[float]] = defaultdict(list)
    for name in UGA_PROVINCES:
        for row in provs.get(name, {}).get("vhi_recent", []):
            if row.get("vhi") is not None:
                weekly[row["iso_week"]].append(row["vhi"])
    vhi = [{"week": w, "vhi": _r(min(v), 1)} for w, v in sorted(weekly.items())]

    rc_w = defaultdict(list)
    for x in s:
        rc_w[_iso_week(x["date"])].append(x["rr"])
    rc_weekly = [{"week": w, "rr": _r(st.mean(v))} for w, v in sorted(rc_w.items())
                 if any(row["week"] == w for row in vhi)]

    onsets = {}
    state = _load(ALERTS).get("state", {})
    for key, rec in state.items():
        if not key.startswith("uganda|"):
            continue
        threat = key.split("|")[2]
        sev = ("critical" if threat == "severe_defoliation"
               else "alert" if threat.endswith("_alert") else "watch")
        fs = rec.get("first_seen")
        if fs and (sev not in onsets or fs < onsets[sev]):
            onsets[sev] = fs
    return {"vhi": vhi, "rc_weekly": rc_weekly, "onsets": onsets}


# ── skew → forward returns ───────────────────────────────────────────────────

def _ret_test(s: list[dict]) -> list[dict]:
    out = []
    for h in (5, 10):
        pairs = []
        for i in range(len(s) - h):
            if s[i + h]["u"] != s[i]["u"]:      # same board only (no roll jumps)
                continue
            pairs.append((s[i]["rr"], math.log(s[i + h]["px"] / s[i]["px"]) * 100))
        nb = pairs[::h]                          # non-overlapping for inference
        r_all = _corr([p[0] for p in pairs], [p[1] for p in pairs])
        r_nb = _corr([p[0] for p in nb], [p[1] for p in nb])
        out.append({"h": h, "n": len(pairs), "r": _r(r_all, 3),
                    "n_blocks": len(nb), "r_blocks": _r(r_nb, 3),
                    "t_blocks": _r(_t_of_r(r_nb, len(nb)))})
    return out


def _now(s: list[dict]) -> dict:
    last = s[-1]
    pct = sum(1 for x in s if x["rr"] <= last["rr"]) / len(s) * 100
    return {"date": last["date"], "u": last["u"], "dte": last["dte"],
            "rr": last["rr"], "c25": last["c25"], "p25": last["p25"],
            "pctile": _r(pct, 1), "n": len(s)}


# ── the alert ledger ─────────────────────────────────────────────────────────

SEV_RANK = {"watch": 1, "alert": 2, "critical": 3}


def _update_ledger() -> dict:
    """Append today's active IPHM alert families per origin. Append-once by
    the alerts file's own generated_at date; origins with no active alerts
    that day are simply absent from the entry."""
    alerts = _load(ALERTS)
    ledger = _load(LEDGER) or {
        "note": "Daily record of active IPHM alert families per origin "
                "(max severity). Appended by the options_skew exporter; "
                "append-once per date. Powers the skew-vs-alerts event "
                "study as it accumulates.",
        "entries": {},
    }
    gen = (alerts.get("generated_at") or "")[:10]
    if gen and gen not in ledger["entries"]:
        entry: dict[str, dict] = {}
        for origin, regions in (alerts.get("origins") or {}).items():
            fams: dict[str, str] = {}
            for alist in regions.values():
                for a in alist:
                    fam, sev = a.get("family"), a.get("severity")
                    if not fam or sev not in SEV_RANK:
                        continue
                    if fam not in fams or SEV_RANK[sev] > SEV_RANK[fams[fam]]:
                        fams[fam] = sev
            if fams:
                entry[origin] = fams
        ledger["entries"][gen] = entry
        LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=1),
                          encoding="utf-8")
    entries = ledger["entries"]
    latest_date = max(entries) if entries else None
    return {"n_days": len(entries), "latest_date": latest_date,
            "latest": entries.get(latest_date, {})}


def export_options_skew():
    arch = _load(BOARDS)
    days = arch.get("days", {})
    if not days:
        raise RuntimeError("options_boards_archive.json missing or empty")

    markets = {}
    for mk in ("arabica", "robusta"):
        s = _series(days, mk)
        if not s:
            continue
        block = {
            "series": s,
            "summary": _summary(s),
            "monthly": _monthly(s),
            "wings": _wings_split(s),
            "ret_test": _ret_test(s),
            "now": _now(s),
        }
        if mk == "arabica":
            block["frost"] = _frost_block(s)
        else:
            block["uganda"] = _uganda_block(s)
        markets[mk] = block

    out = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "method": {
            "target_delta": TARGET_DELTA, "min_dte": MIN_DTE,
            "max_bracket_gap": MAX_BRACKET_GAP,
            "delta_model": "Black-76 from stored per-strike IVs (uniform across the archive)",
            "board": "nearest tracked board with dte >= 7",
            "rr_units": "vol points, positive = 25-delta calls over puts",
            "snap_proxy": "belt-min region tmean <= p2.5 of 1995-2024 Jun-Aug (no Tmin in seed)",
        },
        "ledger": _update_ledger(),
        "markets": markets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    for mk, b in markets.items():
        sm, now = b["summary"], b["now"]
        print(f"  options_skew.json → {mk}: n={sm['n']} mean RR25 {sm['mean']} "
              f"({sm['share_pos']}% pos) | now {now['rr']} ({now['pctile']}th pctile)")


if __name__ == "__main__":
    export_options_skew()
