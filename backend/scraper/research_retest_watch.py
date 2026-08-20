"""
research_retest_watch.py — the memory for research that is WAITING ON DATA.

Several studies ended with "not enough data yet — retest at N". Those N's are
months away and nothing in the pipeline remembers them, so this module is the
registry: one entry per parked hypothesis, each with the file it accrues in, a
counting rule, and the threshold at which it becomes testable again.

Run daily by workflow "research-retest-watch"; exits non-zero (→ Telegram
alert) only when something has just crossed its threshold. It also writes
frontend/public/data/research_retest_status.json so the progress is visible
on the site rather than living only in a cron job.

Why a registry and not a comment in a doc
=========================================
Every one of these was a deliberate "the evidence rule says wait" decision.
The failure mode is not that the retest goes wrong — it is that nobody
remembers to run it, the data quietly matures, and a finding sits unclaimed
for a year. Each entry therefore carries WHERE it came from, so the alert
tells you what to re-run and why it was parked.

Adding an entry: append to WATCHES with a counter fn returning an int (or
None when the file is missing), the threshold, and a one-line action.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "public" / "data"
REPO_DATA = ROOT / "data"
OUT = DATA / "research_retest_status.json"
# Studies parked before this date count their "forward" evidence from it.
DRIFT_STUDY_DATE = "2026-08-19"
HARVEST_MONTHS = (5, 6, 7, 8, 9)


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── counters ────────────────────────────────────────────────────────────────

def _cnl_sessions() -> int | None:
    d = _load(DATA / "brazil_b3_conilon.json")
    return len(d.get("history", [])) if d else None


def _core_trainable_sessions() -> set[str]:
    """Sessions the CORE model can train on — the rows an optional feature has
    to overlap with to be worth anything.

      y                — needs rc_open_first, the PRIOR session's rc_last_1730,
                         and no contract roll between the two.
      kc_after_rc_diff — needs the prior session's kc_last_1730 + kc_last_1830.

    Shared by every optional-feature watch below, because the mistake it
    prevents is shared too: counting a feature's raw captures reads about a
    third high, and a watch that fires before the gate it watches is worse
    than no watch (see _cci_trainable_rows for the live instance of this).
    """
    intraday = _load(DATA / "intraday_kc_rc_15min.json") or []
    out: set[str] = set()
    for prev, cur in zip(intraday, intraday[1:]):
        if cur.get("rc_symbol") != prev.get("rc_symbol"):
            continue                                   # roll day → unlabelled
        if not (cur.get("rc_open_first") and prev.get("rc_last_1730")):
            continue                                   # no target
        if not (prev.get("kc_last_1730") and prev.get("kc_last_1830")):
            continue                                   # no kc_after_rc_diff
        out.add(cur.get("date"))
    return out


def _b3_trainable_rows() -> int | None:
    """Rows the model could actually train on with b3_close_gap in the set.

    Same shape as _cci_trainable_rows, and the same correction: the 40-session
    watch below tracks when the feature becomes TESTABLE, not when it can join.
    Since #719 every optional feature must also leave _MIN_TRAIN=252 trainable
    rows, so 40 captures does NOT put b3_close_gap in the deployed model — it
    needs roughly 384 calendar sessions. The watchdog said "joins the deployed
    spec automatically at 40 sessions" until 2026-08-20; that was the
    pre-#719 behaviour and it would have announced an activation ~10% of the
    way to the real bar.

    Note the shift: the model uses session t−1's gap as pre-open information
    for session t, so a capture on date D is trainable if D's SUCCESSOR is.
    """
    rows = (_load(DATA / "b3_kc_close_snapshots.json") or {}).get("days") or []
    captured = sorted(r["date"] for r in rows
                      if r.get("date") and isinstance(r.get("gap"), (int, float)))
    if not captured:
        return 0
    trainable = _core_trainable_sessions()
    sess = sorted({r.get("date") for r in
                   (_load(DATA / "intraday_kc_rc_15min.json") or []) if r.get("date")})
    nxt = {d: sess[i + 1] for i, d in enumerate(sess[:-1])}
    return sum(1 for d in captured if nxt.get(d) in trainable)


def _cci_trainable_rows() -> int | None:
    """Rows the model could ACTUALLY train on with cci_overnight in the set.

    The model trains listwise on dropna(["y"] + active), so a CCI day only
    counts if that whole row survives — it must also carry the label and the
    core features. Counting "days with ≥6 pairs that are also RC sessions"
    overstates it by about a third, because roll days are unlabelled and
    kc_after_rc_diff has its own holes.

    That is not hypothetical: the 2026-08-20 backfill took CCI coverage to
    314 such days and this counter reported 314/252 MATURE, while
    active_features() correctly refused the feature at 207 trainable rows.
    A watchdog that fires before the gate it watches is worse than no
    watchdog, so it now replicates the model's own dropna:

      y                — needs rc_open_first, the PRIOR session's rc_last_1730,
                         and no contract roll between the two.
      kc_after_rc_diff — needs the prior session's kc_last_1730 + kc_last_1830.
    """
    d = _load(DATA / "fx_intraday_snapshots.json")
    rows = (d or {}).get("days") or []
    trainable = _core_trainable_sessions()

    n = 0
    for r in rows:
        pairs = r.get("pairs") or {}
        used = sum(1 for p in pairs.values()
                   if (p or {}).get("prev_1730") and (p or {}).get("at_0300"))
        if used >= 6 and r.get("date") in trainable:
            n += 1
    return n


def _b3_close_gap_sessions() -> int | None:
    """Sessions captured for the MODEL's own B3 feature (b3_close_gap, added
    2026-08). This is the gate that actually flips the live spec — at 40 the
    feature joins the deployed model automatically, so it matters more than
    any research threshold here."""
    d = _load(DATA / "b3_kc_close_snapshots.json")
    rows = (d or {}).get("days") or []
    return sum(1 for r in rows if isinstance(r.get("gap"), (int, float)))


def _icf_matched_oos() -> int | None:
    d = _load(DATA / "open_direction_factors.json")
    if not d:
        return None
    base = (d.get("gate", {}).get("b3_matched", {}) or {}).get("base") or {}
    return base.get("n")


def _b3_tail_days() -> int | None:
    """Sessions in the |z| >= 2 bucket of the B3 power analysis — the
    wrong-way tail flagged as a possible FADE candidate."""
    d = _load(DATA / "open_direction_factors.json")
    if not d:
        return None
    for b in (d.get("power", {}) or {}).get("buckets", []):
        # exact band — "1 <= |z| < 2" also ends in "2", so endswith() would
        # silently count the middle bucket and report the tail as mature
        if b.get("band", "").replace(" ", "") == "|z|≥2":
            return b.get("n")
    return None


def _rc_last_hour_harvest() -> int | None:
    """Harvest sessions carrying the rc_last_1630 anchor — added 2026-08, so
    this counts from zero and only accrues May–Sep."""
    rows = _load(DATA / "intraday_kc_rc_15min.json")
    if not isinstance(rows, list):
        return None
    return sum(1 for r in rows
               if r.get("rc_last_1630") is not None
               and int(r.get("date", "0000-00")[5:7] or 0) in HARVEST_MONTHS)


def _drift_forward_events() -> int | None:
    """Gated firings of the intraday-drift rule AFTER the study was published
    — the genuinely out-of-sample record for a rule discovered in-sample."""
    d = _load(DATA / "intraday_drift.json")
    if not d:
        return None
    return sum(1 for t in d.get("trades", []) if t.get("date", "") > DRIFT_STUDY_DATE)


def _flow_cot_weeks() -> int | None:
    d = _load(DATA / "options_flow_cot.json")
    if not d:
        return None
    return ((d.get("markets", {}).get("arabica", {}) or {}).get("stats", {}) or {}).get("n")


def _expiry_ledger() -> int | None:
    d = _load(REPO_DATA / "options_expiry_ledger.json")
    return len(d.get("events", [])) if d else None


def _iphm_ledger_days() -> int | None:
    d = _load(REPO_DATA / "iphm_alert_ledger.json")
    return len(d.get("entries", {})) if d else None


VN_ACCUMULATOR_START = "2026-05-14"


def _vn_physical_rows() -> int | None:
    """Vietnam rows captured SINCE the same-morning accumulator started. The
    file also holds deeper historical prices, but only the post-start rows
    have the 01:07-UTC capture timing the feature needs."""
    d = _load(DATA / "origin_prices_history.json")
    hist = ((d or {}).get("origins", {}).get("vietnam", {}) or {}).get("history")
    if not isinstance(hist, list):
        return None
    return sum(1 for x in hist if x.get("date", "") >= VN_ACCUMULATOR_START)


def _certified_robusta_days() -> int | None:
    d = _load(DATA / "certified_stocks_robusta.json")
    snaps = (d or {}).get("snapshots")
    return len(snaps) if isinstance(snaps, list) else None


# ── registry ────────────────────────────────────────────────────────────────
# (key, label, counter, threshold, unit, parked_because, action)
WATCHES = [
    ("drift_forward", "Intraday-drift rule — forward record", _drift_forward_events, 20,
     "gated firings since the study",
     "The harvest condition was discovered in-sample; only forward firings are true OOS.",
     "Re-read intraday_drift.json: is the forward hit-rate holding near 76%?"),
    ("cci_trainable", "cci_overnight — trainable rows (real activation bar)", _cci_trainable_rows, 252,
     "labelled sessions carrying CCI",
     "Cleared its 40-session COVERAGE gate on 2026-07-29 but has far less "
     "history than the model; admitting it would truncate listwise training. "
     "The 2026-08-20 backfill took it 51 → 207 trainable rows and made a real "
     "test possible — and it came back NULL: corr +0.05 (t 0.75, n 207), sign "
     "rule 50.2% vs a 53.1% baseline, and zero walk-forward marginal over "
     "kc_after+dsr on matched OOS dates. Expect this one to be rejected.",
     "Re-run the marginal at 252 and, unless it has changed character, RETIRE "
     "the feature rather than activating it — the 2026-08 read at n=207 found "
     "nothing, and the encouraging n=51 signal before it was small-sample noise."),
    ("b3_close_gap", "b3_close_gap — enough captures to TEST", _b3_close_gap_sessions, 40,
     "sessions captured (gap present)",
     "The model's own B3 construction (post-KC-close window, PR #697) ships "
     "dormant. 40 captures is its COVERAGE gate — enough to run a first "
     "walk-forward marginal, NOT enough to join the model (see the trainable-"
     "rows watch below). Accrual restarts 2026-08-20: the at-KC-close capture "
     "had never fired — GitHub's cron drift landed every run one minute past "
     "the guard window.",
     "Grade it here, long before it can activate: walk-forward marginal of "
     "b3_close_gap vs kc_after+dsr on matched OOS dates, then update the "
     "research card's B3 section with the verdict. cci_overnight is the "
     "cautionary tale — promising at n=51, worthless at n=207."),
    ("b3_trainable", "b3_close_gap — trainable rows (real activation bar)", _b3_trainable_rows, 252,
     "labelled sessions carrying the gap",
     "Since #719 an optional feature must ALSO leave 252 trainable rows, so "
     "40 captures does not deploy it — roughly 384 calendar sessions do. This "
     "watch existed as a 40-session 'LIVE MODEL activation gate' until "
     "2026-08-20, which was the pre-#719 behaviour: it would have announced "
     "activation at ~10% of the real bar.",
     "At 252, re-run the marginal on the full sample and decide activate vs "
     "retire — the coverage-gate test above is the early read, this is the one "
     "that matters."),
    ("cnl_sessions", "Conilon (B3 CNL) late-close factor", _cnl_sessions, 300,
     "sessions accrued",
     "B3 exposes no CNL history; the accumulator started 2026-08.",
     "Run the cnl_after_rc construction in open_direction_factors — the London-side B3 test."),
    # Threshold arithmetic: the KC version's gate fired on ~11% of harvest
    # sessions (54 of ~494), so ~250 harvest sessions are needed before the
    # RC replication has a comparable event count — not 120.
    ("rc_last_hour", "London's own last hour (rc_last_1630)", _rc_last_hour_harvest, 250,
     "harvest sessions with the anchor",
     "The 16:30 anchor was never stored; added to the refresher 2026-08 "
     "(which backfilled its window to 2025-09).",
     "Repeat the pre-hedging drift test on RC's own last hour, not KC's."),
    ("icf_matched", "B3 arabica after-KC residual", _icf_matched_oos, 400,
     "matched OOS days",
     "Rejected at the gate (+0.5pp marginal) on 200 matched days.",
     "Re-run the matched-window gate; specifically the harvest-only cell (r +0.13, t 1.66)."),
    ("b3_tail", "B3 wrong-way tail (fade candidate)", _b3_tail_days, 40,
     "sessions at |z| >= 2",
     "27.3% sign accuracy on 22 days — inverted read only z ~ 1.3.",
     "Re-test the FADE of strong B3 moves against the bucket's own blind baseline."),
    ("flow_cot", "Options flow → next-week COT lead", _flow_cot_weeks, 60,
     "aligned COT weeks",
     "r 0.401 (t 2.36) survived its controls but is 1 of 16 tests.",
     "Re-run the lead partial; bar is t ~ 3, or t ~ 2.5 with a nonzero return transfer."),
    ("expiry_ledger", "Options expiry ledger", _expiry_ledger, 6,
     "graded expiries",
     "Expired boards are unrecoverable upstream; each expiry adds one datapoint.",
     "Test ITM-overhang vs post-expiry drift across the accumulated expiries."),
    ("iphm_ledger", "IPHM alert ledger (skew vs alerts)", _iphm_ledger_days, 90,
     "days recorded",
     "The skew-vs-alerts event study rested on one Uganda episode.",
     "Run the lead/lag event study of RR25 around published alert onsets."),
    ("vn_physical", "Vietnam physical overnight", _vn_physical_rows, 300,
     "rows accrued",
     "Timing verified viable; only ~50 days existed in 2026-07.",
     "Walk-forward the VN fresh-morning change as an open-direction feature."),
    ("cert_robusta", "Certified robusta stocks as a feature", _certified_robusta_days, 350,
     "days of history",
     "Only ~13 months existed — exploratory windows too small.",
     "Re-open the certified-stocks feature battery for the open-direction model."),
]


def collect() -> list[dict]:
    out = []
    for key, label, fn, thr, unit, why, action in WATCHES:
        try:
            n = fn()
        except Exception as e:  # noqa: BLE001 — one broken counter must not kill the sweep
            print(f"  [{key}] counter error: {type(e).__name__}: {e}", file=sys.stderr)
            n = None
        pct = round(min(100.0, n / thr * 100), 1) if isinstance(n, int) and thr else None
        out.append({
            "key": key, "label": label, "n": n, "threshold": thr, "unit": unit,
            "pct": pct, "mature": bool(isinstance(n, int) and n >= thr),
            "parked_because": why, "action": action,
        })
    return out


def main(force: bool = False) -> int:
    rows = collect()
    OUT.write_text(json.dumps({
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "note": "Parked research hypotheses and the data each is waiting on. "
                "Maintained by scraper/research_retest_watch.py; alerts fire "
                "when a counter crosses its threshold.",
        "watches": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    ready = [r for r in rows if r["mature"]]
    unknown = [r for r in rows if r["n"] is None]
    print(f"[retest-watch] {len(rows)} watches · {len(ready)} MATURE · {len(unknown)} uncountable")
    for r in sorted(rows, key=lambda x: -(x["pct"] or 0)):
        mark = "✅" if r["mature"] else ("··" if r["n"] is not None else "??")
        print(f"  {mark} {r['label']:44s} {str(r['n']):>5}/{r['threshold']:<5} {r['unit']}")

    if ready and (force or os.environ.get("GITHUB_OUTPUT")):
        lines = [f"📊 Research retest ready — {len(ready)} hypothesis(es) matured:", ""]
        for r in ready:
            lines += [f"• {r['label']} — {r['n']}/{r['threshold']} {r['unit']}",
                      f"  parked: {r['parked_because']}",
                      f"  → {r['action']}", ""]
        msg = "\n".join(lines).strip()
        gh = os.environ.get("GITHUB_OUTPUT")
        if gh:
            with open(gh, "a", encoding="utf-8") as g:
                g.write("ready<<EOF\n" + msg + "\nEOF\n")
        print("\n" + msg)
        return 1
    return 0


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Check parked research hypotheses for matured data.")
    ap.add_argument("--force", action="store_true", help="print the alert body even outside CI")
    a = ap.parse_args()
    sys.exit(main(force=a.force))
