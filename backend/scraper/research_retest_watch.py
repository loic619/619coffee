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


def _cci_trainable_rows() -> int | None:
    """Labelled sessions that actually carry a usable CCI value. The model
    trains listwise, so this — not the raw 40-session coverage gate — is what
    decides when cci_overnight can join without truncating the training set."""
    d = _load(DATA / "fx_intraday_snapshots.json")
    rows = (d or {}).get("days") or []
    sess = {r.get("date") for r in (_load(DATA / "intraday_kc_rc_15min.json") or [])}
    n = 0
    for r in rows:
        pairs = r.get("pairs") or {}
        used = sum(1 for p in pairs.values()
                   if (p or {}).get("prev_1730") and (p or {}).get("at_0300"))
        if used >= 6 and r.get("date") in sess:
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
     "history than the model; admitting it would truncate listwise training.",
     "At 252 it can finally join without shrinking the train set — re-check its "
     "walk-forward marginal then, and expect active_features() to admit it."),
    ("b3_close_gap", "b3_close_gap — LIVE MODEL activation gate", _b3_close_gap_sessions, 40,
     "sessions captured (gap present)",
     "The model's own B3 construction (post-KC-close window, PR #697) ships "
     "dormant and joins the deployed spec automatically at 40 sessions. "
     "Accrual restarts 2026-08-20: the at-KC-close capture had never fired — "
     "GitHub's cron drift landed every run one minute past the guard window.",
     "Grade it BEFORE it activates: run the walk-forward marginal on b3_close_gap "
     "vs kc_after+dsr, and update the research card's B3 section with the verdict."),
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
