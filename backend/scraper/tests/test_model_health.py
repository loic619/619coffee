"""Tests for the open-direction model audit (workflow 1.17).

The audit's whole value is that it fails loudly on things the rest of the
pipeline passes over silently — a frozen model input, a payload whose
arithmetic no longer matches its own spec. So these tests care most about
which findings are graded CRIT, and about the audit staying read-only.
"""
import datetime as dt
import json

import numpy as np

from scraper.quant_model import model_health as mh


def _panel(**over) -> dict:
    """A payload that is internally consistent by construction, so any CRIT a
    test sees is the one it injected."""
    base, phis = -0.2, [0.30, -0.05]
    final = base + sum(phis)
    od = {
        "available": True,
        "for_session": dt.date.today().isoformat(),
        "base_margin": base,
        "final_margin": final,
        "final_prob": 1.0 / (1.0 + np.exp(-final)),
        "prob_up": 1.0 / (1.0 + np.exp(-final)),
        "direction": "Abstain",
        "features": [{"var_name": "kc_after_rc_diff", "phi": phis[0]},
                     {"var_name": "days_since_roll", "phi": phis[1]}],
        "target": {"abstain_band": 0.10},
        "model": {"acted_accuracy": 0.637, "active_features":
                  ["kc_after_rc_diff", "days_since_roll"]},
    }
    od.update(over)
    return {"open_direction": od}


# ── input freshness: the check that closes the Brent gap ─────────────────────

def test_frozen_input_is_critical(tmp_path, monkeypatch):
    fresh = tmp_path / "fresh.json"
    frozen = tmp_path / "frozen.json"
    today = dt.date(2026, 8, 21)
    fresh.write_text(json.dumps({"days": [{"date": "2026-08-20"}]}))
    frozen.write_text(json.dumps({"days": [{"date": "2026-07-03"}]}))
    monkeypatch.setattr(mh, "_INPUTS", {"live_feed": fresh, "dead_feed": frozen})

    out = mh.check_inputs(today)
    crit = [f for f in out if f["grade"] == "CRIT"]
    assert len(crit) == 1 and crit[0]["input"] == "dead_feed"
    assert crit[0]["stale_sessions"] == 35          # the real July→August gap
    assert [f["grade"] for f in out if f["input"] == "live_feed"] == ["INFO"]


def test_input_inside_the_grace_window_stays_silent(tmp_path, monkeypatch):
    """A weekend or one failed run must not page anyone."""
    p = tmp_path / "f.json"
    p.write_text(json.dumps({"days": [{"date": "2026-08-18"}]}))
    monkeypatch.setattr(mh, "_INPUTS", {"feed": p})
    out = mh.check_inputs(dt.date(2026, 8, 21))     # 3 sessions
    assert [f["grade"] for f in out] == ["INFO"]


def test_missing_input_file_is_critical(tmp_path, monkeypatch):
    monkeypatch.setattr(mh, "_INPUTS", {"gone": tmp_path / "nope.json"})
    out = mh.check_inputs(dt.date(2026, 8, 21))
    assert out[0]["grade"] == "CRIT" and "missing" in out[0]["message"]


# ── payload arithmetic ───────────────────────────────────────────────────────

def test_broken_shap_identity_is_critical():
    bad = _panel()
    bad["open_direction"]["features"][0]["phi"] = 0.99   # Σφ no longer reconciles
    crit = [f for f in mh.check_payload(bad) if f["grade"] == "CRIT"]
    assert any(f["check"] == "SHAP identity" for f in crit)


def test_consistent_payload_reports_the_identity_as_exact():
    out = mh.check_payload(_panel())
    assert not [f for f in out if f["grade"] == "CRIT"]
    assert any(f["check"] == "SHAP identity" and f["grade"] == "INFO" for f in out)


def test_direction_disagreeing_with_its_own_band_is_critical():
    # prob_up 0.72 is far outside ±0.10, so "Abstain" contradicts the rule.
    p = _panel(prob_up=0.72, direction="Abstain")
    crit = [f for f in mh.check_payload(p) if f["grade"] == "CRIT"]
    assert any(f["check"] == "direction rule" for f in crit)


def test_sigmoid_mismatch_is_critical():
    p = _panel()
    p["open_direction"]["final_prob"] = 0.999          # not sigmoid(final_margin)
    crit = [f for f in mh.check_payload(p) if f["grade"] == "CRIT"]
    assert any(f["check"] == "sigmoid" for f in crit)


def test_stale_panel_marker_is_reported_verbatim():
    p = _panel(stale={"since": "2026-07-29", "reason": "training set collapsed"})
    crit = [f for f in mh.check_payload(p) if f["grade"] == "CRIT"]
    msg = " ".join(f["message"] for f in crit)
    assert "2026-07-29" in msg and "training set collapsed" in msg


def test_unavailable_panel_is_critical_and_short_circuits():
    out = mh.check_payload({"open_direction": {"available": False, "reason": "no data"}})
    assert len(out) == 1 and out[0]["grade"] == "CRIT" and "no data" in out[0]["message"]


def test_panel_far_behind_the_calendar_is_critical():
    p = _panel(for_session="2026-08-01")
    crit = [f for f in mh.check_payload(p, dt.date(2026, 8, 21)) if f["grade"] == "CRIT"]
    assert any(f["check"] == "panel freshness" for f in crit)


# ── track record ─────────────────────────────────────────────────────────────

def _rows(n, hit_rate, direction="Bullish", source="live"):
    hits = int(round(n * hit_rate))
    return [{"status": "resolved", "source": source, "direction": direction,
             "hit": i < hits, "actual_dir": "Up" if i < hits else "Down",
             "factors": [{"var_name": "kc_after_rc_diff", "phi": 0.2}]}
            for i in range(n)]


def test_cold_streak_is_critical_only_with_enough_calls():
    panel = _panel()                       # walk-forward expectation 63.7%
    thin = mh.check_track_record(_rows(10, 0.20), panel)
    assert not [f for f in thin if f["check"] == "cold streak"]      # n < 30

    cold = mh.check_track_record(_rows(40, 0.20), panel)
    crit = [f for f in cold if f["check"] == "cold streak"]
    assert crit and crit[0]["grade"] == "CRIT"


def test_acted_and_abstained_are_counted_separately():
    """Mixing them flatters the record — abstains are not calls."""
    rows = _rows(20, 0.7) + _rows(30, 0.0, direction="Abstain")
    out = mh.check_track_record(rows, _panel())
    rec = [f for f in out if f["check"] == "track record"][0]
    assert rec["n"] == 20 and "30 abstained" in rec["message"]


def test_backtest_rows_are_not_counted_as_live():
    out = mh.check_track_record(_rows(50, 0.9, source="backtest"), _panel())
    assert out[0]["message"] == "no resolved live acted calls yet"


def test_weak_factor_flags_confidence_without_accuracy():
    # φ always positive, outcome down half the time → agreement ~50%.
    rows = []
    for i in range(40):
        rows.append({"status": "resolved", "source": "live", "direction": "Bullish",
                     "hit": True, "actual_dir": "Up" if i % 2 else "Down",
                     "factors": [{"var_name": "loud_but_wrong", "phi": 0.4}]})
    warn = [f for f in mh.check_track_record(rows, _panel())
            if f["check"] == "weak factor"]
    assert warn and warn[0]["feature"] == "loud_but_wrong"
    assert warn[0]["agreement"] < mh.WEAK_FACTOR_HIT


# ── message ──────────────────────────────────────────────────────────────────

def test_message_carries_loud_findings_only_and_fits_telegram():
    report = {"counts": {"CRIT": 1, "WARN": 1, "INFO": 3},
              "findings": [
                  {"grade": "CRIT", "check": "input freshness", "message": "feed FROZEN"},
                  {"grade": "WARN", "check": "base-rate drift", "message": "drifted"},
                  {"grade": "INFO", "check": "walk-forward", "message": "quiet detail"}]}
    text = mh.compose(report)
    assert "feed FROZEN" in text and "drifted" in text
    assert "quiet detail" not in text            # INFO stays in the JSON
    assert len(text) <= mh.TELEGRAM_LIMIT


def test_message_truncates_rather_than_being_rejected():
    findings = [{"grade": "CRIT", "check": f"c{i}", "message": "x" * 300}
                for i in range(60)]
    text = mh.compose({"counts": {"CRIT": 60, "WARN": 0, "INFO": 0},
                       "findings": findings})
    assert len(text) <= mh.TELEGRAM_LIMIT and text.endswith("truncated")


def test_all_clear_still_says_something():
    text = mh.compose({"counts": {"CRIT": 0, "WARN": 0, "INFO": 4}, "findings": []})
    assert "0 critical" in text and "all inputs fresh" in text


def test_dry_run_composes_without_sending(monkeypatch, capsys):
    monkeypatch.delenv("TELEGRAM_MODEL_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_MODEL_CHAT_ID", raising=False)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert mh.send("anything") is False
    assert "dry run" in capsys.readouterr().out


# ── read-only guarantee ──────────────────────────────────────────────────────

def test_the_audit_never_writes_the_models_own_record(tmp_path, monkeypatch):
    """An auditor that can edit the record is not an auditor."""
    history = tmp_path / "open_direction_history.json"
    panel = tmp_path / "quant_report.json"
    history.write_text(json.dumps([{"status": "resolved", "hit": True,
                                    "source": "live", "direction": "Bullish"}]))
    panel.write_text(json.dumps(_panel()))
    before = (history.read_bytes(), panel.read_bytes())

    monkeypatch.setattr(mh, "_HISTORY", history)
    monkeypatch.setattr(mh, "_PANEL", panel)
    monkeypatch.setattr(mh, "_OUT", tmp_path / "model_health.json")
    monkeypatch.setattr(mh, "_INPUTS", {})
    monkeypatch.setattr(mh.od, "build_dataset", lambda: None)
    monkeypatch.setattr(mh, "send", lambda _t: False)

    assert mh.main() == 0
    assert (history.read_bytes(), panel.read_bytes()) == before
    assert (tmp_path / "model_health.json").exists()


def test_a_broken_dataset_is_a_finding_not_a_crash(monkeypatch, tmp_path):
    """The audit must survive the very breakage it is there to report."""
    def boom():
        raise RuntimeError("frame shape changed")
    monkeypatch.setattr(mh.od, "build_dataset", boom)
    monkeypatch.setattr(mh, "_INPUTS", {})
    monkeypatch.setattr(mh, "_PANEL", tmp_path / "absent.json")
    monkeypatch.setattr(mh, "_HISTORY", tmp_path / "absent.json")
    report = mh.build_report()
    assert any(f["check"] == "dataset" and f["grade"] == "CRIT"
               for f in report["findings"])
