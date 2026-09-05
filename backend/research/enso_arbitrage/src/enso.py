"""ENSO variables: continuous indices, and two different ideas of an "event".

The distinction this module exists to keep:

  official  NOAA's rule — five consecutive overlapping seasons with ONI past
            ±0.5. The right label for the historical record, and confirmable
            only four to five months AFTER onset. Used for the event study.
  realtime  What a desk could have seen at the time: two consecutive ONI
            months past ±0.5, one month past ±1.0, or four weekly Niño 3.4
            readings past ±0.5 (the repo's own "emerging" rule in enso.py),
            each shifted by its publication delay. Used for the predictive
            test. Includes the signals that later fizzled — a trader sees the
            signal, not the label.

Publication delay of the ONI: the value anchored at month m averages m−1, m,
m+1 and NOAA publishes it in the first days of m+2. Treated monthly, that is
"known from m+2". The weekly Niño 3.4 is published the following Monday, so a
week-ending in month m is known in month m (worst case, the first days of m+1).
"""
from __future__ import annotations

import pandas as pd

ONI_THRESHOLD = 0.5
OFFICIAL_MIN_SEASONS = 5
EMERGING_MONTHS = 2
SINGLE_MONTH_STRONG = 1.0
NINO34_THRESHOLD = 0.5
NINO34_WEEKS = 4
ONI_PUBLICATION_LAG_MONTHS = 2


# ── continuous ───────────────────────────────────────────────────────────────

def nino34_monthly(weekly: pd.Series) -> pd.Series:
    """Monthly mean of the weekly Niño 3.4 anomaly, keyed by the week-ending month."""
    return weekly.groupby(weekly.index.to_period("M")).mean().sort_index()


def availability_shift(s: pd.Series, months: int = ONI_PUBLICATION_LAG_MONTHS) -> pd.Series:
    """The series as it was KNOWN: value for month m re-keyed to m+months."""
    out = s.copy()
    out.index = out.index + months
    return out


# ── official episodes ─────────────────────────────────────────────────────────

def official_episodes(oni: pd.Series, threshold: float = ONI_THRESHOLD,
                      min_seasons: int = OFFICIAL_MIN_SEASONS) -> list[dict]:
    """Every El Niño / La Niña episode under NOAA's rule.

    Returns [{phase, onset, end, n_months, peak, peak_month}], onset being the
    FIRST month of the qualifying run (which NOAA labels retrospectively).
    """
    eps: list[dict] = []
    for phase, sign in (("el_nino", 1), ("la_nina", -1)):
        run: list[pd.Period] = []
        for p, v in oni.items():
            if pd.notna(v) and (v * sign) >= threshold:
                run.append(p)
            else:
                if len(run) >= min_seasons:
                    eps.append(_episode(phase, run, oni))
                run = []
        if len(run) >= min_seasons:
            eps.append(_episode(phase, run, oni))
    eps.sort(key=lambda e: e["onset"])
    return eps


def _episode(phase: str, run: list[pd.Period], oni: pd.Series) -> dict:
    vals = oni.loc[run]
    pk = vals.abs().idxmax()
    return {"phase": phase, "onset": run[0], "end": run[-1], "n_months": len(run),
            "peak": float(oni[pk]), "peak_month": pk}


def regime_labels(oni: pd.Series, episodes: list[dict] | None = None) -> pd.Series:
    """Monthly label: el_nino / la_nina / neutral by official-episode membership."""
    eps = episodes if episodes is not None else official_episodes(oni)
    lab = pd.Series("neutral", index=oni.index, dtype=object)
    for e in eps:
        lab.loc[e["onset"]:e["end"]] = e["phase"]
    return lab


def collapse_back_to_back(episodes: list[dict], gap_months: int = 12) -> list[dict]:
    """Treat a same-phase episode that starts within `gap_months` of the previous
    one's end as a continuation (2018-09 / 2019-10 El Niño; 2020-09 / 2021-09 La Niña).
    Primary event lists use this; the sensitivity keeps both."""
    out: list[dict] = []
    for e in sorted(episodes, key=lambda x: x["onset"]):
        if out and out[-1]["phase"] == e["phase"] and (e["onset"] - out[-1]["end"]).n <= gap_months:
            prev = out[-1]
            prev["end"] = e["end"]
            prev["n_months"] = (prev["end"] - prev["onset"]).n + 1
            if abs(e["peak"]) > abs(prev["peak"]):
                prev["peak"], prev["peak_month"] = e["peak"], e["peak_month"]
            prev["merged"] = prev.get("merged", 0) + 1
        else:
            out.append(dict(e))
    return out


# ── real-time signals ─────────────────────────────────────────────────────────

def realtime_signals(oni: pd.Series, nino34_w: pd.Series) -> pd.DataFrame:
    """Every month a desk could first have called a developing event, with the
    rule that fired. One row per signal; a signal is the FIRST month a phase
    is flagged after at least one unflagged month.

    Columns: month, phase, rule, value. Later fizzles are kept — the trader
    saw them too.
    """
    flags: dict[pd.Period, tuple[str, str, float]] = {}

    def _put(p: pd.Period, phase: str, rule: str, val: float) -> None:
        # earliest rule wins for a month; rules are checked cheapest-signal first
        if p not in flags:
            flags[p] = (phase, rule, val)

    # (c) four consecutive weekly Niño 3.4 readings past the line → month of the 4th week
    w = nino34_w.dropna()
    for phase, sign in (("el_nino", 1), ("la_nina", -1)):
        streak = 0
        for d, v in w.items():
            streak = streak + 1 if v * sign >= NINO34_THRESHOLD else 0
            if streak >= NINO34_WEEKS:
                _put(pd.Period(d, freq="M"), phase, "nino34_4wk", float(v))
    # (a) two consecutive ONI months past ±0.5, known two months after the second
    # (b) one ONI month past ±1.0, known two months later
    o = oni.dropna()
    for phase, sign in (("el_nino", 1), ("la_nina", -1)):
        prev_ok = False
        for p, v in o.items():
            ok = v * sign >= ONI_THRESHOLD
            known = p + ONI_PUBLICATION_LAG_MONTHS
            if ok and prev_ok:
                _put(known, phase, "oni_2mo", float(v))
            if v * sign >= SINGLE_MONTH_STRONG:
                _put(known, phase, "oni_1mo_strong", float(v))
            prev_ok = ok

    # collapse consecutive flagged months into onsets: first flagged month after a gap
    rows = []
    last_phase, last_p = None, None
    for p in sorted(flags):
        phase, rule, val = flags[p]
        if phase != last_phase or last_p is None or (p - last_p).n > 1:
            rows.append({"month": p, "phase": phase, "rule": rule, "value": val})
        last_phase, last_p = phase, p
    return pd.DataFrame(rows)


def label_signals(signals: pd.DataFrame, episodes: list[dict], window: int = 9) -> pd.DataFrame:
    """Mark each real-time signal as confirmed (an official same-phase episode
    begins within ±window months) or a false alarm, and the lead it gave."""
    out = signals.copy()
    conf, lead = [], []
    for _, r in out.iterrows():
        match = None
        for e in episodes:
            if e["phase"] == r["phase"] and abs((e["onset"] - r["month"]).n) <= window:
                match = e
                break
        conf.append(match is not None)
        lead.append((match["onset"] - r["month"]).n if match else None)
    out["confirmed"] = conf
    out["lead_months_vs_official_onset"] = lead
    return out
