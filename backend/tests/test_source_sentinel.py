# backend/tests/test_source_sentinel.py
"""The sentinel's window/late probing rule:
probe inside the release window until the month is confirmed, and keep
probing daily past the window — including across the month boundary — while
a release is late."""
import importlib.util
import sys
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "source_sentinel",
    Path(__file__).resolve().parents[1] / "scripts" / "source_sentinel.py",
)
ss = importlib.util.module_from_spec(_SPEC)
sys.modules["source_sentinel"] = ss
_SPEC.loader.exec_module(ss)


def test_idle_before_window_when_last_month_confirmed():
    # Aug 3, window opens day 8, July was found → nothing to do yet.
    assert ss.should_probe(3, "2026-07", "2026-08", 8) is False


def test_probes_inside_window_until_confirmed():
    assert ss.should_probe(8, "2026-07", "2026-08", 8) is True
    assert ss.should_probe(15, "2026-07", "2026-08", 8) is True


def test_idle_once_month_confirmed():
    assert ss.should_probe(20, "2026-08", "2026-08", 8) is False


def test_late_release_probes_daily_past_window():
    # Day 25, window long over, still not confirmed → keep probing (late).
    assert ss.should_probe(25, "2026-07", "2026-08", 8) is True


def test_late_release_spills_across_month_boundary():
    # Sept 2 (before Sept's window): August NEVER landed (confirmed=July)
    # → probe daily even pre-window.
    assert ss.should_probe(2, "2026-07", "2026-09", 8) is True
    # …but if August DID land, wait for Sept's window as usual.
    assert ss.should_probe(2, "2026-08", "2026-09", 8) is False


def test_prev_period_year_boundary():
    assert ss._prev_period("2026-01") == "2025-12"
    assert ss._prev_period("2026-08") == "2026-07"


def test_month_url_builders_shapes():
    import datetime as dt
    pub = dt.date(2026, 8, 6)
    # Cecafé: July data published in August, Portuguese month name.
    assert ss._cecafe_urls(pub) == [
        "https://www.cecafe.com.br/site/wp-content/uploads/graficos/relatorio_exp_julho_2026.zip"
    ]
    # DANE: M+2 → June data, Spanish 3-letter month.
    assert ss._dane_urls(pub)[0].endswith("anex-EXPORTACIONES-jun2026.xls")
    # VN: July data (t7) under 2026/8/<day>, days 1..6 only so far.
    vn = ss._vn_urls(pub)
    assert len(vn) == 6
    assert vn[0] == "https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2026/8/1/2026-t7-2x(vn-sb).pdf"


def test_january_data_lags_wrap_year():
    import datetime as dt
    pub = dt.date(2026, 1, 10)
    assert "dezembro_2025" in ss._cecafe_urls(pub)[0]          # M+1 wraps
    assert "nov2025" in ss._dane_urls(pub)[0]                  # M+2 wraps
    assert "2025-t12" in ss._vn_urls(pub)[0]                   # M+1 wraps
