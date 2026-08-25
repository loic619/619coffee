"""Contract tests for the open-direction classifier (overnight-gap spec).

Pins the properties that make the panel trustworthy:
  1. The SHAP decomposition is EXACTLY additive (Σφᵢ = final − base) — the
     whole point of using logistic regression instead of a tree.
  2. The dataset builder honours the target definition: overnight gap vs the
     prior 17:30 close, roll days unlabelled, features strictly pre-open.
  3. cci_overnight only activates once enough FX snapshot days accumulate.
  4. The walk-forward evaluator's abstain bookkeeping adds up.

These avoid network: they exercise the math directly with synthetic series.
End-to-end payload/log-lifecycle tests live in backend/tests/test_open_direction.py.
"""
import json

import numpy as np
import pytest

pytest.importorskip("pandas", reason="open_direction needs pandas")
import pandas as pd  # noqa: E402

from scraper.quant_model import open_direction as od  # noqa: E402

# ── Logistic fit + exact SHAP ────────────────────────────────────────────────

def test_logistic_fit_separates_clean_data():
    """A linearly separable 1-feature problem should fit to high accuracy."""
    rng = np.random.RandomState(0)
    z = np.concatenate([rng.normal(-2, 0.5, 200), rng.normal(2, 0.5, 200)])
    y = np.concatenate([np.zeros(200), np.ones(200)])
    X = np.column_stack([np.ones(len(z)), z])
    beta = od._fit_logistic(X, y)
    p = 1.0 / (1.0 + np.exp(-(X @ beta)))
    acc = ((p >= 0.5).astype(float) == y).mean()
    assert acc > 0.95
    assert beta[1] > 0          # higher z → higher P(up)


def test_shap_is_exactly_additive():
    """Σ(βᵢ·zᵢ) must equal margin − base_margin with zero residual."""
    rng = np.random.RandomState(1)
    Z = rng.normal(size=(300, 3))
    true_beta = np.array([0.2, 0.8, -0.5, 0.3])
    lin = true_beta[0] + Z @ true_beta[1:]
    p = 1.0 / (1.0 + np.exp(-lin))
    y = (rng.uniform(size=300) < p).astype(float)
    beta = od._fit_logistic(np.column_stack([np.ones(len(Z)), Z]), y)
    z_live = Z[-1]
    phis = beta[1:] * z_live
    margin = beta[0] + float(phis.sum())
    direct = float(np.r_[1.0, z_live] @ beta)
    assert abs(margin - direct) < 1e-12


def test_sigmoid_matches_numpy():
    for x in [-5.0, -0.5, 0.0, 0.3, 4.2]:
        assert abs(od._sigmoid(x) - 1.0 / (1.0 + np.exp(-x))) < 1e-12


# ── Dataset builder (target + alignment) ─────────────────────────────────────

def _write_intraday(tmp_path, n=60, roll_at=(20, 40)):
    dates = pd.bdate_range("2025-01-02", periods=n)
    rows, rc = [], 4000.0
    for i, d in enumerate(dates):
        sym = "RC" + chr(65 + sum(1 for r in roll_at if i >= r))
        rows.append({
            "date": d.strftime("%Y-%m-%d"), "rc_symbol": sym,
            "rc_open_first": rc * 1.001, "rc_last_1730": rc,
            "kc_last_1730": 300.0, "kc_last_1830": 301.5,
        })
        rc *= 1.0005
    p = tmp_path / "intraday.json"
    p.write_text(json.dumps(rows), encoding="utf-8")
    return p, rows


def test_build_dataset_roll_days_unlabelled(tmp_path, monkeypatch):
    p, rows = _write_intraday(tmp_path)
    monkeypatch.setattr(od, "_INTRADAY", p)
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "absent.json")
    frame = od.build_dataset()
    assert int(frame["_roll"].sum()) == 2
    assert frame.loc[frame["_roll"], "gap"].isna().all()
    assert frame.loc[frame["_roll"], "y"].isna().all()
    # non-roll rows: gap computed vs the PRIOR 17:30 close
    d5 = pd.Timestamp(rows[5]["date"])
    expected = rows[5]["rc_open_first"] / rows[4]["rc_last_1730"] - 1.0
    assert abs(frame.at[d5, "gap"] - expected) < 1e-12
    # features are prior-session info
    expected_kc = rows[4]["kc_last_1830"] / rows[4]["kc_last_1730"] - 1.0
    assert abs(frame.at[d5, "kc_after_rc_diff"] - expected_kc) < 1e-12


def test_unavailable_when_intraday_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "_INTRADAY", tmp_path / "nope.json")
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "absent.json")
    out = od.run()
    assert out["available"] is False
    assert "intraday" in out["reason"]


# ── cci_overnight activation threshold ───────────────────────────────────────

def _write_snaps(tmp_path, dates):
    # SNAPSHOT_* — these fixtures stand in for the intraday snapshot file, which
    # only ever contains the Barchart-captured basket. Building them from the
    # published EXPORTERS (widened to eight origins on 2026-08-25) put HNL/UGX/ETB
    # in the fixture and left only 5 of the model's pairs, silently tripping the
    # `used >= 6` gate and making the feature look absent.
    from scraper.quant_model.fetch_currency_index import SNAPSHOT_EXPORTERS, SNAPSHOT_IMPORTERS
    tickers = [t for t, _, _ in SNAPSHOT_EXPORTERS + SNAPSHOT_IMPORTERS][:8]
    days = [{
        "date": d.strftime("%Y-%m-%d"),
        "pairs": {t: {"prev_1730": 5.0, "at_0300": 5.01} for t in tickers},
    } for d in dates]
    p = tmp_path / "fx_intraday_snapshots.json"
    p.write_text(json.dumps({"days": days}), encoding="utf-8")
    return p


def test_cci_overnight_respects_overlap_threshold(tmp_path, monkeypatch):
    p, rows = _write_intraday(tmp_path, n=320, roll_at=(100, 200, 300))
    monkeypatch.setattr(od, "_INTRADAY", p)
    dates = pd.to_datetime([r["date"] for r in rows])

    # below threshold → not enough coverage to activate
    monkeypatch.setattr(od, "_FX_SNAPS",
                        _write_snaps(tmp_path, dates[: od._MIN_CCI_OVERLAP - 1]))
    frame = od.build_dataset()
    n_ok = frame["cci_overnight"].notna().sum() if "cci_overnight" in frame.columns else 0
    assert n_ok < od._MIN_CCI_OVERLAP

    # at threshold → column present with enough coverage
    monkeypatch.setattr(od, "_FX_SNAPS",
                        _write_snaps(tmp_path, dates[: od._MIN_CCI_OVERLAP]))
    frame = od.build_dataset()
    assert frame["cci_overnight"].notna().sum() >= od._MIN_CCI_OVERLAP


def test_thin_optional_feature_cannot_destroy_the_training_set(tmp_path, monkeypatch):
    """Latent bug, fixed 2026-08: run() trains on dropna(["y"] + active)
    — LISTWISE.

    A feature that merely clears its COVERAGE gate but has far less history
    than the model does not add a column, it truncates the training set to
    its own span: 1168 → ~51 rows, below _MIN_TRAIN, so run() returns
    "Only 51 labelled sessions (need >= 252)" and the model goes dark.

    This never fired in production — cci_overnight was independently
    unavailable there (fetch_currency_index needs `requests`, absent from
    the 1.16 runner), so the column never reached the frame. Fixing that
    dependency without this gate is what would trigger it, which is why the
    test guards the gate rather than the incident.
    """
    p, rows = _write_intraday(tmp_path, n=420, roll_at=(100, 200, 300))
    monkeypatch.setattr(od, "_INTRADAY", p)
    dates = pd.to_datetime([r["date"] for r in rows])

    # Coverage gate cleared, but the feature only exists on the last handful
    # of sessions — nowhere near enough to train on.
    thin = od._MIN_CCI_OVERLAP + 5
    assert thin < od._MIN_TRAIN, "test presumes the coverage gate is below MIN_TRAIN"
    monkeypatch.setattr(od, "_FX_SNAPS", _write_snaps(tmp_path, dates[-thin:]))
    frame = od.build_dataset()

    assert frame["cci_overnight"].notna().sum() >= od._MIN_CCI_OVERLAP  # gate cleared
    active = od.active_features(frame)
    assert "cci_overnight" not in active, "thin feature must stay dormant"

    # …and the core model is still trainable, which is the point.
    assert len(frame.dropna(subset=["y"] + active)) >= od._MIN_TRAIN

    # With enough overlapping history the same feature IS admitted.
    monkeypatch.setattr(od, "_FX_SNAPS", _write_snaps(tmp_path, dates))
    frame = od.build_dataset()
    assert "cci_overnight" in od.active_features(frame)


# ── brent_overnight activation + series parse ────────────────────────────────

def _write_brent(tmp_path, dates, include_next=True):
    """Anchor file for the given sessions.

    include_next also writes the NEXT business day — the session run() actually
    predicts. Without it brent_series.get(for_session) is None and every
    assertion lands on the missing-data path instead of the case under test;
    that is precisely how test_brent_is_context_not_coefficient passed for
    months while never exercising its own comment.
    """
    dates = list(dates)
    if include_next and dates:
        dates = dates + [pd.Timestamp(
            np.busday_offset(dates[-1].date(), 1, roll="forward"))]
    days = [{"date": d.strftime("%Y-%m-%d"), "symbol": "CBQ25",
             "prev_1730": 80.0, "at_0300": 80.4} for d in dates]
    p = tmp_path / "brent_intraday_anchors.json"
    p.write_text(json.dumps({"days": days}), encoding="utf-8")
    return p


def test_brent_is_context_not_coefficient(tmp_path, monkeypatch):
    """brent_overnight was tested and REJECTED as a model feature (2022-only
    signal — see findings doc). It must never auto-activate, but its series
    parses correctly and feeds the oil_shock regime tag."""
    p, rows = _write_intraday(tmp_path, n=320, roll_at=(100, 200, 300))
    monkeypatch.setattr(od, "_INTRADAY", p)
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "absent.json")
    dates = pd.to_datetime([r["date"] for r in rows])
    monkeypatch.setattr(od, "_BRENT", _write_brent(tmp_path, dates))

    frame = od.build_dataset()
    assert "brent_overnight" not in od.active_features(frame)   # never a coefficient
    v = frame["brent_overnight"].dropna().iloc[0]               # series still parses
    assert abs(v - 0.005) < 1e-12                               # 80.4/80.0 − 1
    out = od.run()
    assert out["available"]
    assert "brent_overnight" not in out["model"]["active_features"]
    assert "oil_shock" in out["regime"]                          # rides as a tag
    # Now genuinely on the "ok" path: an anchor EXISTS for the predicted
    # session, so this asserts the threshold rather than the absence of data.
    assert out["regime"]["brent_status"] == "ok"
    assert out["regime"]["brent_overnight_pct"] == 0.5
    assert out["regime"]["oil_shock"] is False                   # +0.5% < 1.5% flag


def test_regime_block_present(tmp_path, monkeypatch):
    p, _rows = _write_intraday(tmp_path, n=320, roll_at=(100, 200, 300))
    monkeypatch.setattr(od, "_INTRADAY", p)
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "absent.json")
    monkeypatch.setattr(od, "_BRENT", tmp_path / "absent2.json")
    out = od.run()
    assert out["available"]
    reg = out["regime"]
    assert set(reg) >= {"ny_shock", "vol_regime", "harvest_weight", "harvest_active"}
    assert isinstance(reg["ny_shock"], bool)
    # z present on every feature
    assert all(isinstance(f.get("z"), float) for f in out["features"])


# ── Walk-forward abstain bookkeeping ─────────────────────────────────────────

def test_walk_forward_abstain_accounting():
    rng = np.random.RandomState(3)
    n = 400
    X = rng.normal(size=(n, 2))
    y = (X[:, 0] + rng.normal(0, 1.0, n) > 0).astype(float)
    wf = od._walk_forward_eval(X, y, min_train=252, step=5)
    assert wf is not None
    assert wf["n"] == n - 252
    assert 0.0 <= wf["abstain_rate"] <= 1.0
    assert wf["acted_n"] == round((1 - wf["abstain_rate"]) * wf["n"])
    assert abs(wf["edge"] - (wf["accuracy"] - wf["baseline"])) < 1e-12


def test_stale_brent_reports_unknown_not_calm(tmp_path, monkeypatch):
    """The 2026-07 regression, pinned: anchors stopping well before the
    predicted session must read as UNKNOWN. Publishing False there told the
    Macro panel "oil is calm" for 35 sessions while the feed was dead."""
    p, rows = _write_intraday(tmp_path, n=320, roll_at=(100, 200, 300))
    monkeypatch.setattr(od, "_INTRADAY", p)
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "absent.json")
    dates = pd.to_datetime([r["date"] for r in rows])
    # Freeze the feed 30 sessions before the end — no anchor for for_session.
    monkeypatch.setattr(od, "_BRENT",
                        _write_brent(tmp_path, dates[:-30], include_next=False))

    out = od.run()
    regime = out["regime"]
    assert regime["oil_shock"] is None            # NOT False
    assert regime["brent_status"] == "stale"
    assert regime["brent_overnight_pct"] is None
    assert regime["brent_last_date"] == dates[-31].strftime("%Y-%m-%d")
    assert regime["brent_stale_sessions"] >= 20


def test_absent_brent_file_reports_missing(tmp_path, monkeypatch):
    p, _rows = _write_intraday(tmp_path, n=320, roll_at=(100, 200, 300))
    monkeypatch.setattr(od, "_INTRADAY", p)
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "absent.json")
    monkeypatch.setattr(od, "_BRENT", tmp_path / "no_such_brent.json")

    regime = od.run()["regime"]
    assert regime["oil_shock"] is None
    assert regime["brent_status"] == "missing"
    assert regime["brent_last_date"] is None
    assert regime["brent_stale_sessions"] is None

# ── feature_status: dormancy must state its own cause ────────────────────────

def test_feature_status_distinguishes_absent_from_accruing(tmp_path, monkeypatch):
    """Audit finding, 2026-08-21: cci_overnight had been dormant in production
    since it shipped because _cci_overnight_series imports fetch_currency_index
    → `requests`, which the 1.16 runner does not install. The column never
    reached the frame. From outside, "the dependency is missing" and "still
    accruing, be patient" were indistinguishable — and the watchdog, counting
    rows locally where requests IS installed, reported healthy progress toward
    a gate the live model could never reach.

    `absent` is therefore its own state, and must never read as patience.
    """
    p, rows = _write_intraday(tmp_path, n=420, roll_at=(100, 200, 300))
    monkeypatch.setattr(od, "_INTRADAY", p)
    dates = pd.to_datetime([r["date"] for r in rows])

    # 1. no source at all → absent (the production case)
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "nope.json")
    st = {f["name"]: f for f in od.feature_status(od.build_dataset())}
    assert st["cci_overnight"]["state"] == "absent"
    assert st["cci_overnight"]["coverage"] == 0
    assert "NOT a data-accrual wait" in st["cci_overnight"]["reason"]

    # 2. present but under the coverage gate → accruing
    monkeypatch.setattr(od, "_FX_SNAPS",
                        _write_snaps(tmp_path, dates[: od._MIN_CCI_OVERLAP - 5]))
    st = {f["name"]: f for f in od.feature_status(od.build_dataset())}
    assert st["cci_overnight"]["state"] == "accruing"
    assert st["cci_overnight"]["coverage"] < od._MIN_CCI_OVERLAP

    # 3. coverage cleared but too thin to train on → held (the #719 case)
    monkeypatch.setattr(od, "_FX_SNAPS",
                        _write_snaps(tmp_path, dates[-(od._MIN_CCI_OVERLAP + 5):]))
    frame = od.build_dataset()
    st = {f["name"]: f for f in od.feature_status(frame)}
    assert st["cci_overnight"]["state"] == "held"
    assert st["cci_overnight"]["coverage"] >= od._MIN_CCI_OVERLAP
    assert st["cci_overnight"]["trainable_rows"] < od._MIN_TRAIN
    assert "cci_overnight" not in od.active_features(frame)

    # 4. fully covered → active, and the payload agrees with active_features()
    monkeypatch.setattr(od, "_FX_SNAPS", _write_snaps(tmp_path, dates))
    frame = od.build_dataset()
    st = {f["name"]: f for f in od.feature_status(frame)}
    assert st["cci_overnight"]["state"] == "active"
    assert "cci_overnight" in od.active_features(frame)
    # every state reported is one the model can actually be in
    assert {f["state"] for f in od.feature_status(frame)} <= {
        "absent", "accruing", "held", "active"}
