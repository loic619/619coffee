"""
model_health.py — daily audit of the open-direction model (workflow 1.17).

Workflow 1.16 answers "what is the call?". Nothing answered the two questions
underneath it: is every declared factor still reaching the model with LIVE
data, and is the model still earning the edge its spec claims? A model input
(the Brent anchor feed) died on 2026-07-03 and the panel published a
confident-looking `false` for 35 sessions, because 1.5 watches scrapers,
exporters, committed artifacts and the panel payload — but not a MODEL INPUT.
This closes that gap.

Two design constraints, both deliberate:

READ-ONLY
    Writes frontend/public/data/model_health.json and sends a Telegram
    message. It never touches open_direction_history.json or the panel
    payload. An auditor that can edit the record is not an auditor.

SECOND OPINION, NOT A RE-READ
    Every walk-forward number is recomputed from the raw frame, never copied
    out of quant_report.json. A payload that silently disagrees with a fresh
    fit is one of the failures this exists to catch — reading the payload
    would make that failure invisible by construction.

Findings are graded CRIT / WARN / INFO. Only CRIT and WARN reach the phone;
INFO lives in the JSON.

CLI:  cd backend && PYTHONPATH=. python -m scraper.quant_model.model_health
Env:  TELEGRAM_MODEL_BOT_TOKEN / TELEGRAM_MODEL_CHAT_ID, falling back to
      TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID. With neither set it composes and
      prints without sending — keep that dry-run path working.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path

import numpy as np

from scraper.quant_model import open_direction as od

_ROOT = Path(__file__).resolve().parents[3]
_OUT = _ROOT / "frontend" / "public" / "data" / "model_health.json"
_HISTORY = _ROOT / "frontend" / "public" / "data" / "open_direction_history.json"
_PANEL = _ROOT / "frontend" / "public" / "data" / "quant_report.json"

# Every file the model reads. The Brent freeze is exactly what this catches.
_INPUTS = {
    "intraday_kc_rc_15min": od._INTRADAY,
    "fx_intraday_snapshots": od._FX_SNAPS,
    "b3_kc_close_snapshots": od._B3_SNAPS,
    "brent_intraday_anchors": od._BRENT,
}

MAX_INPUT_STALE_SESSIONS = 5      # ~1 calendar week; absorbs a holiday
SHAP_TOLERANCE = 1e-6             # the decomposition is exact by construction
WF_MISMATCH_PP = 0.03             # payload vs fresh fit
WEAK_FACTOR_HIT = 0.55            # φ-sign agreement floor
WEAK_FACTOR_MIN_N = 25
WEAK_FACTOR_MIN_PHI = 0.05        # spending confidence...
FADE_PCT = 0.20                   # monotone decay across refits
BASE_RATE_DRIFT_PP = 0.04
COLD_STREAK_PP = 0.10
COLD_STREAK_MIN_N = 30
BAND_GAIN_PP = 0.03
BAND_MIN_ACTED = 150
TELEGRAM_LIMIT = 4096


# ── helpers ──────────────────────────────────────────────────────────────────

def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _finding(grade: str, check: str, message: str, **extra) -> dict:
    return {"grade": grade, "check": check, "message": message, **extra}


def _latest_date_in(obj) -> str | None:
    """Newest YYYY-MM-DD anywhere in a JSON document. Input files disagree on
    shape (list of days, dict of series, nested pairs), and an auditor that
    only understands one of them would silently pass the others."""
    best: str | None = None

    def walk(o, depth=0):
        nonlocal best
        if depth > 6:
            return
        if isinstance(o, str):
            if len(o) >= 10 and o[4] == "-" and o[7] == "-":
                head = o[:10]
                try:
                    dt.date.fromisoformat(head)
                except ValueError:
                    return
                if best is None or head > best:
                    best = head
            return
        if isinstance(o, dict):
            for k, v in o.items():
                walk(k, depth + 1)
                walk(v, depth + 1)
        elif isinstance(o, list):
            for it in o[:5000]:
                walk(it, depth + 1)

    walk(obj)
    return best


def _sessions_since(day: str, today: dt.date | None = None) -> int:
    today = today or dt.datetime.now(dt.UTC).date()
    return int(np.busday_count(dt.date.fromisoformat(day), today))


# ── checks: inputs ───────────────────────────────────────────────────────────

def check_inputs(today: dt.date | None = None) -> list[dict]:
    """Is every declared model input still arriving? This is the check that
    would have caught the Brent freeze on day six instead of week seven."""
    out = []
    for name, path in _INPUTS.items():
        if not Path(path).exists():
            out.append(_finding("CRIT", "input freshness",
                                f"{name}: file missing ({path})", input=name))
            continue
        last = _latest_date_in(_load(Path(path)))
        if last is None:
            out.append(_finding("CRIT", "input freshness",
                                f"{name}: no dated rows", input=name))
            continue
        stale = _sessions_since(last, today)
        if stale > MAX_INPUT_STALE_SESSIONS:
            out.append(_finding("CRIT", "input freshness",
                                f"{name}: FROZEN — last {last}, {stale} sessions stale",
                                input=name, last=last, stale_sessions=stale))
        else:
            out.append(_finding("INFO", "input freshness",
                                f"{name}: fresh ({last})",
                                input=name, last=last, stale_sessions=stale))
    return out


# ── checks: the published payload's own arithmetic ───────────────────────────

def check_payload(panel: dict | None, today: dt.date | None = None) -> list[dict]:
    """The payload must be internally consistent. φ is exact for logistic
    regression, so any residual means the panel and the model spec diverged."""
    out: list[dict] = []
    odp = (panel or {}).get("open_direction") or {}
    if not odp.get("available"):
        return [_finding("CRIT", "panel freshness",
                         f"panel unavailable: {odp.get('reason', 'no reason given')}")]

    if odp.get("stale"):
        s = odp["stale"]
        out.append(_finding("CRIT", "panel freshness",
                            f"panel FROZEN since {s.get('since')} "
                            f"({s.get('reason', 'no reason')})"))

    base, final = odp.get("base_margin"), odp.get("final_margin")
    phis = [f.get("phi") for f in (odp.get("features") or [])]
    if base is not None and final is not None and phis and all(p is not None for p in phis):
        resid = abs(sum(phis) - (final - base))
        if resid > SHAP_TOLERANCE:
            out.append(_finding("CRIT", "SHAP identity",
                                f"Σφ − (final−base) = {resid:.2e} (> {SHAP_TOLERANCE:.0e})",
                                residual=resid))
        else:
            out.append(_finding("INFO", "SHAP identity",
                                f"exact — residual {resid:.1e}", residual=resid))

    fp = odp.get("final_prob")
    if final is not None and fp is not None:
        expect = od._sigmoid(final)
        if abs(expect - fp) > 1e-9:
            out.append(_finding("CRIT", "sigmoid",
                                f"sigmoid(final_margin)={expect:.10f} ≠ final_prob={fp:.10f}"))

    band = ((odp.get("target") or {}).get("abstain_band")) or od._ABSTAIN_BAND
    pu, direction = odp.get("prob_up"), odp.get("direction")
    if pu is not None and direction:
        expected = ("Abstain" if abs(pu - 0.5) < band
                    else "Bullish" if pu >= 0.5 else "Bearish")
        if expected != direction:
            out.append(_finding("CRIT", "direction rule",
                                f"stored '{direction}' but prob_up={pu:.4f} with band "
                                f"±{band} implies '{expected}'"))

    for_session = odp.get("for_session")
    if for_session:
        behind = _sessions_since(for_session, today)
        if behind > 1:
            out.append(_finding("CRIT", "panel freshness",
                                f"for_session {for_session} is {behind} sessions behind",
                                sessions_behind=behind))
    return out


# ── checks: is the model still earning its edge? ─────────────────────────────

def _walk_forward_probs(Xraw: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Expanding-window walk-forward run ONCE, returning (probs, truth).

    open_direction._walk_forward_eval refits from scratch on every call, so
    drawing a band curve through it would burn N× the CI minutes fitting
    identical models. Every band is scored off these same fits instead.
    """
    n = len(y)
    probs, truth = [], []
    cut = od._MIN_TRAIN
    while cut < n:
        tr_end = cut - od._WF_EMBARGO
        Xtr, ytr = Xraw[:tr_end], y[:tr_end]
        mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1.0
        beta = od._fit_logistic(
            np.column_stack([np.ones(tr_end), (Xtr - mu) / sd]), ytr, l2=1.0)
        te = slice(cut, min(cut + od._WF_STEP, n))
        Zte = (Xraw[te] - mu) / sd
        p = 1.0 / (1.0 + np.exp(-np.clip(
            np.column_stack([np.ones(Zte.shape[0]), Zte]) @ beta, -35, 35)))
        probs.extend(p); truth.extend(y[te])
        cut += od._WF_STEP
    return np.asarray(probs), np.asarray(truth)


def _score_band(probs: np.ndarray, truth: np.ndarray, band: float) -> dict:
    yhat = (probs >= 0.5).astype(float)
    acted = np.abs(probs - 0.5) >= band
    return {
        "band": band,
        "acted_n": int(acted.sum()),
        "acted_accuracy": float((yhat[acted] == truth[acted]).mean()) if acted.any() else None,
        "coverage": float(acted.mean()),
    }


def check_model(frame, panel: dict | None) -> list[dict]:
    """Recomputed walk-forward, coefficient stability, base-rate drift and the
    abstain-band curve — all from the raw frame, never from the payload."""
    out: list[dict] = []
    if frame is None or frame.empty:
        return [_finding("CRIT", "walk-forward", "no dataset — build_dataset() returned nothing")]

    active = od.active_features(frame)
    trainable = frame.dropna(subset=["y"] + active)
    if len(trainable) < od._MIN_TRAIN + od._WF_STEP:
        return [_finding("CRIT", "walk-forward",
                         f"only {len(trainable)} trainable rows (need "
                         f"{od._MIN_TRAIN + od._WF_STEP})")]

    Xraw = trainable[active].to_numpy(float)
    y = trainable["y"].to_numpy(float)
    probs, truth = _walk_forward_probs(Xraw, y)

    band = (((panel or {}).get("open_direction") or {}).get("target") or {}).get(
        "abstain_band") or od._ABSTAIN_BAND
    cur = _score_band(probs, truth, band)

    stored = ((panel or {}).get("open_direction") or {}).get("model") or {}
    stored_acc = stored.get("acted_accuracy")
    if stored_acc is not None and cur["acted_accuracy"] is not None:
        diff = abs(stored_acc - cur["acted_accuracy"])
        if diff > WF_MISMATCH_PP:
            out.append(_finding("WARN", "walk-forward mismatch",
                                f"payload acted accuracy {stored_acc:.1%} vs recomputed "
                                f"{cur['acted_accuracy']:.1%} ({diff*100:.1f}pp apart)",
                                stored=stored_acc, recomputed=cur["acted_accuracy"]))
    out.append(_finding("INFO", "walk-forward",
                        f"acted {cur['acted_accuracy']:.1%} on {cur['acted_n']} calls "
                        f"({cur['coverage']:.1%} coverage) at band ±{band}",
                        **cur))

    # Band curve — same fits, so this is nearly free.
    curve = [_score_band(probs, truth, b) for b in (0.06, 0.08, 0.10, 0.12, 0.15)]
    better = [c for c in curve
              if c["band"] > band and c["acted_n"] >= BAND_MIN_ACTED
              and c["acted_accuracy"] is not None and cur["acted_accuracy"] is not None
              and c["acted_accuracy"] - cur["acted_accuracy"] >= BAND_GAIN_PP]
    if better:
        b = max(better, key=lambda c: c["acted_accuracy"])
        out.append(_finding("INFO", "band tuning",
                            f"band ±{b['band']} scores {b['acted_accuracy']:.1%} on "
                            f"{b['acted_n']} calls vs {cur['acted_accuracy']:.1%} now",
                            curve=curve))

    # Base-rate drift — is the intercept fighting the tape?
    if len(y) > 252:
        full, trail = float(y.mean()), float(y[-252:].mean())
        if abs(trail - full) > BASE_RATE_DRIFT_PP:
            out.append(_finding("WARN", "base-rate drift",
                                f"trailing-252 up-rate {trail:.1%} vs full-history "
                                f"{full:.1%}", trailing=trail, full=full))

    # Coefficient fade across expanding refits.
    fits: list[tuple[int, np.ndarray]] = []
    for frac in (0.5, 0.7, 0.85, 1.0):
        n = int(len(y) * frac)
        if n < od._MIN_TRAIN:
            continue
        Xtr = Xraw[:n]
        mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1.0
        fits.append((n, od._fit_logistic(
            np.column_stack([np.ones(n), (Xtr - mu) / sd]), y[:n], l2=1.0)))
    if len(fits) >= 3:
        for i, feat in enumerate(active):
            seq = [float(b[i + 1]) for _n, b in fits]
            if all(abs(seq[j + 1]) < abs(seq[j]) for j in range(len(seq) - 1)) \
               and abs(seq[0]) > 0 and abs(seq[-1]) <= abs(seq[0]) * (1 - FADE_PCT):
                out.append(_finding("WARN", "coefficient fade",
                                    f"{feat}: |β| decays every refit, "
                                    f"{seq[0]:+.3f} (n={fits[0][0]}) → {seq[-1]:+.3f} "
                                    f"(n={fits[-1][0]})", feature=feat, betas=seq))

    # Name the active set explicitly: "which factors are actually in the
    # model today" is the first question anyone asks of an audit, and it also
    # catches the payload's set silently drifting from the current one.
    out.append(_finding("INFO", "active factors",
                        f"in the model: {', '.join(active)} "
                        f"({len(trainable)} trainable rows)",
                        features=active, n_train=len(trainable)))
    payload_active = (((panel or {}).get("open_direction") or {}).get("model") or {}).get(
        "active_features")
    if payload_active is not None and list(payload_active) != list(active):
        out.append(_finding("CRIT", "panel freshness",
                            f"payload feature set {payload_active} ≠ current {active}",
                            payload=list(payload_active), current=list(active)))

    # Dormant factors — a dormant feature is fine; one nobody can date is not.
    for key in list(od._FEATURE_KEYS) + ["b3_close_gap"]:
        if key in active or key not in frame.columns:
            continue
        cov = int(frame[key].notna().sum())
        joint = int(len(frame.dropna(subset=["y"] + active + [key])))
        gate = {"cci_overnight": od._MIN_CCI_OVERLAP,
                "b3_close_gap": od._MIN_B3_OVERLAP}.get(key)
        if key == "brent_overnight":
            out.append(_finding("INFO", "dormant factor",
                                f"{key}: held out by design (regime tag, not a coefficient)",
                                feature=key, coverage=cov))
            continue
        binding = ("coverage" if gate is not None and cov < gate else "joint-trainable rows")
        need = gate if binding == "coverage" else od._MIN_TRAIN
        have = cov if binding == "coverage" else joint
        recent = int(frame[key].tail(60).notna().sum())
        eta = (f"~{max(1, round((need - have) / max(recent / 12, 1e-9)))}w"
               if have < need and recent else "unknown")
        out.append(_finding("INFO", "dormant factor",
                            f"{key}: coverage {cov}, joint-trainable {joint}, "
                            f"{binding} gate binds ({have}/{need}), ETA {eta}",
                            feature=key, coverage=cov, joint=joint, eta=eta))
    return out


# ── checks: the live track record ────────────────────────────────────────────

def check_track_record(history: list | None, panel: dict | None) -> list[dict]:
    """Live results, kept strictly separate from the walk-forward: acted and
    abstained calls are different populations and mixing them flatters the
    record."""
    out: list[dict] = []
    rows = [r for r in (history or [])
            if r.get("status") == "resolved" and r.get("hit") is not None
            and r.get("source") == "live"]
    acted = [r for r in rows if r.get("direction") in ("Bullish", "Bearish")]
    if not acted:
        return [_finding("INFO", "track record", "no resolved live acted calls yet")]

    hit_rate = sum(bool(r["hit"]) for r in acted) / len(acted)
    out.append(_finding("INFO", "track record",
                        f"live acted {hit_rate:.1%} on {len(acted)} calls "
                        f"({len(rows) - len(acted)} abstained)",
                        hit_rate=hit_rate, n=len(acted)))

    stored = ((panel or {}).get("open_direction") or {}).get("model") or {}
    expect = stored.get("acted_accuracy")
    if expect is not None and len(acted) >= COLD_STREAK_MIN_N and hit_rate < expect - COLD_STREAK_PP:
        out.append(_finding("CRIT", "cold streak",
                            f"live acted {hit_rate:.1%} on {len(acted)} calls vs "
                            f"walk-forward {expect:.1%} — "
                            f"{(expect - hit_rate)*100:.1f}pp below",
                            hit_rate=hit_rate, expected=expect, n=len(acted)))

    # Per-factor: does φ's sign agree with what actually happened?
    by_factor: dict[str, list[tuple[float, bool]]] = {}
    for r in acted:
        up = r.get("actual_dir") == "Up"
        for f in r.get("factors") or []:
            phi = f.get("phi")
            if phi is None or f.get("var_name") is None:
                continue
            by_factor.setdefault(f["var_name"], []).append((float(phi), up))
    for name, pairs in sorted(by_factor.items()):
        n = len(pairs)
        if n < WEAK_FACTOR_MIN_N:
            continue
        agree = sum(1 for phi, up in pairs if (phi >= 0) == up) / n
        mean_phi = float(np.mean([abs(p) for p, _ in pairs]))
        if agree < WEAK_FACTOR_HIT and mean_phi >= WEAK_FACTOR_MIN_PHI:
            out.append(_finding("WARN", "weak factor",
                                f"{name}: φ sign agrees {agree:.1%} (n={n}) while carrying "
                                f"mean |φ| {mean_phi:.3f} — spending confidence without "
                                "earning it",
                                feature=name, agreement=agree, mean_abs_phi=mean_phi, n=n))
        else:
            out.append(_finding("INFO", "factor agreement",
                                f"{name}: φ sign agrees {agree:.1%} (n={n}), mean |φ| "
                                f"{mean_phi:.3f}",
                                feature=name, agreement=agree, mean_abs_phi=mean_phi, n=n))
    return out


# ── report ───────────────────────────────────────────────────────────────────

_ORDER = {"CRIT": 0, "WARN": 1, "INFO": 2}


def build_report(today: dt.date | None = None) -> dict:
    panel = _load(_PANEL)
    history = _load(_HISTORY)
    findings = check_inputs(today) + check_payload(panel, today)
    try:
        frame = od.build_dataset()
    except Exception as e:  # noqa: BLE001 — an audit must survive a broken model
        frame = None
        findings.append(_finding("CRIT", "dataset", f"build_dataset() raised {type(e).__name__}: {e}"))
    findings += check_model(frame, panel)
    findings += check_track_record(history, panel)
    findings.sort(key=lambda f: (_ORDER.get(f["grade"], 9), f["check"]))
    counts = {g: sum(1 for f in findings if f["grade"] == g) for g in ("CRIT", "WARN", "INFO")}
    return {
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "counts": counts,
        "findings": findings,
    }


def compose(report: dict) -> str | None:
    """Telegram text. Only CRIT and WARN reach the phone — INFO stays in the
    JSON, which is where you go once something has already got your attention."""
    loud = [f for f in report["findings"] if f["grade"] in ("CRIT", "WARN")]
    c = report["counts"]
    head = (f"🩺 <b>Model health</b> — {c['CRIT']} critical, {c['WARN']} warning"
            f"{'' if c['WARN'] == 1 else 's'}")
    if not loud:
        return f"{head}\n• all inputs fresh, payload arithmetic exact, no drift flagged"
    lines = [head]
    for f in loud:
        icon = "🔴" if f["grade"] == "CRIT" else "🟠"
        lines.append(f"{icon} <b>{f['check']}</b> — {f['message']}")
    text = "\n".join(lines)
    if len(text) > TELEGRAM_LIMIT:
        keep, tail = [], "\n… truncated"
        for line in lines:
            if sum(len(x) + 1 for x in keep) + len(line) + len(tail) > TELEGRAM_LIMIT:
                break
            keep.append(line)
        text = "\n".join(keep) + tail
    return text


def send(text: str) -> bool:
    tok = os.environ.get("TELEGRAM_MODEL_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_MODEL_CHAT_ID") or os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        print("[model_health] no Telegram env — printing only (dry run)")
        return False
    import requests
    try:
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      data={"chat_id": chat, "text": text, "parse_mode": "HTML"},
                      timeout=20)
        return True
    except Exception as e:  # noqa: BLE001 — never fail the workflow on the send
        print(f"[model_health] send failed: {e}", file=sys.stderr)
        return False


def _loud_signature(report: dict | None) -> list[list[str]] | None:
    """Identity of what the audit is complaining about: the (grade, check)
    pairs at CRIT/WARN, ignoring the message body.

    Ignoring the body is deliberate — "36 sessions stale" becoming "37" is the
    same finding, and keying on it would re-notify every single day until the
    problem was fixed. Escalation is already covered by the daily freshness
    alarm and by 1.16 going red.
    """
    if not report:
        return None
    return sorted([f["grade"], f["check"]] for f in report.get("findings", [])
                  if f["grade"] in ("CRIT", "WARN"))


def main() -> int:
    # Read the previous audit BEFORE overwriting it — it is the dedup state,
    # so 1.17 needs no state file of its own (and adds no second writer to the
    # shared topic_notify_state.json).
    try:
        previous = json.loads(_OUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = None

    report = build_report()
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(report, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    text = compose(report)
    print(text)
    print(f"\n[model_health] {report['counts']} → {_OUT}")

    # 1.17 fires on workflow_run after EVERY 1.16 *and* on its own weekday
    # cron, so a normal weekday triggered it twice ~24 min apart — and compose()
    # returns text even for a clean bill of health, so the same message went out
    # twice a day, every day. Dedup on the findings rather than de-duplicating
    # the triggers: the cron is the safety net for a 1.16 that never starts
    # (queue-cancelled, as in #649), and that net is worth keeping.
    signature = _loud_signature(report)
    if signature == _loud_signature(previous):
        print(f"[model_health] same findings as the last audit ({len(signature)} "
              "loud) — not re-sending")
        return 0
    send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
