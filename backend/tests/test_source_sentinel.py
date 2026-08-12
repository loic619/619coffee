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


# ── Ingestion verification + overdue alarm ────────────────────────────────────

def test_build_verify_month_in_file_applies_lag():
    src = {"verify": {"kind": "month_in_file", "file": "frontend/public/data/cecafe.json", "lag": 1}}
    v = ss.build_verify(src, "2026-08", "2026-08-10T06:37:00+00:00")
    assert v["expected"] == "2026-07" and v["status"] == "pending"
    v2 = ss.build_verify({"verify": {"kind": "month_in_file", "file": "x", "lag": 2}}, "2026-01", "t")
    assert v2["expected"] == "2025-11"  # wraps the year


def test_build_verify_health_ts_and_absent():
    v = ss.build_verify({"verify": {"kind": "health_ts", "keys": ["conab_costs"]}}, "2026-08", "t")
    assert v["keys"] == ["conab_costs"]
    assert ss.build_verify({}, "2026-08", "t") is None


def test_check_ingested_month_in_file(tmp_path, monkeypatch):
    f = tmp_path / "out.json"
    f.write_text('{"series": [{"month": "2026-06"}, {"month": "2026-07"}]}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    ok = ss.check_ingested({"kind": "month_in_file", "file": "out.json", "expected": "2026-07",
                            "dispatched_at": "2026-08-10T06:00:00+00:00"})
    missing = ss.check_ingested({"kind": "month_in_file", "file": "out.json", "expected": "2026-08",
                                 "dispatched_at": "2026-08-10T06:00:00+00:00"})
    assert ok is True and missing is False


def test_check_ingested_health_ts(tmp_path, monkeypatch):
    h = tmp_path / "frontend" / "public" / "data"
    h.mkdir(parents=True)
    (h / "health.json").write_text(
        '{"scrapers": {"conab_costs": "2026-08-12T05:00:00", "conab_safra": "2026-08-01T05:00:00"}}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    base = {"kind": "health_ts", "dispatched_at": "2026-08-10T06:00:00+00:00"}
    assert ss.check_ingested({**base, "keys": ["conab_costs"]}) is True     # advanced past dispatch
    assert ss.check_ingested({**base, "keys": ["conab_safra"]}) is False    # still pre-dispatch
    assert ss.check_ingested({**base, "keys": ["conab_costs", "conab_safra"]}) is False  # ALL must advance


def test_days_past_window_overdue_paths():
    import datetime as dt
    # July confirmed, window opens day 8 → Aug 30 is 22d past the Aug-8 opening.
    assert ss._days_past_window(dt.date(2026, 8, 30), "2026-07", 8) == 22
    # Nothing pending (this month already confirmed) → 0.
    assert ss._days_past_window(dt.date(2026, 8, 30), "2026-08", 8) == 0
    # Two months behind: pending month is the one after confirmed → even longer overdue.
    assert ss._days_past_window(dt.date(2026, 9, 10), "2026-07", 8) == (dt.date(2026, 9, 10) - dt.date(2026, 8, 8)).days


def test_shift_period_wraps_years():
    assert ss._shift_period("2026-08", -2) == "2026-06"
    assert ss._shift_period("2026-01", -2) == "2025-11"
    assert ss._shift_period("2025-12", 2) == "2026-02"


def test_build_verify_snap_even_for_bimonthly():
    spec = {"verify": {"kind": "month_in_file", "file": "x", "lag": 1, "snap_even": True}}
    v_even = ss.build_verify(spec, "2026-07", "t")   # end-of-July release → June pair-end
    v_odd = ss.build_verify(spec, "2026-08", "t")    # slipped to early August → July snaps to June
    assert v_even["expected"] == "2026-06"
    assert v_odd["expected"] == "2026-06"
    # Year wrap: January detection → December (even) stays.
    assert ss.build_verify(spec, "2026-01", "t")["expected"] == "2025-12"


def test_period_from_slug_uses_second_month():
    assert ss._period_from_slug("stocks-in-european-ports-may-june-2026") == "2026-06"
    assert ss._period_from_slug("stocks-in-european-ports-november-december-2025") == "2025-12"
    # Single-month slug: that month is the period.
    assert ss._period_from_slug("stocks-in-european-ports-march-2024") == "2024-03"
    assert ss._period_from_slug("some-other-post") is None


class _FakeResp:
    def __init__(self, text="", status=200):
        self.text, self.status_code = text, status


def _stub_get(monkeypatch, pages: dict):
    """pages: {url → _FakeResp | Exception}."""
    def fake(url, headers=None, timeout=None):
        r = pages[url]
        if isinstance(r, Exception):
            raise r
        return r
    monkeypatch.setattr(ss.requests, "get", fake)


def _listing(*slugs):
    return "".join(f'<a href="https://www.ecf-coffee.org/{s}/">x</a>' for s in slugs)


def test_link_period_fires_when_site_ahead_of_data(tmp_path, monkeypatch):
    (tmp_path / "ecf.json").write_text(
        '{"monthly": [{"period": "2026-02"}, {"period": "2026-04"}]}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    _stub_get(monkeypatch, {"p1": _FakeResp(_listing(
        "stocks-in-european-ports-march-april-2026",
        "stocks-in-european-ports-may-june-2026"))})
    href = r'href="https?://(?:www\.)?ecf-coffee\.org/(stocks-in-european-ports-[^/"?#]+)/?"'
    found, signal = ss.probe_link_period(["p1"], href, "ecf.json")
    assert found is True and signal == "2026-06"


def test_link_period_quiet_when_data_is_current(tmp_path, monkeypatch):
    (tmp_path / "ecf.json").write_text('{"monthly": [{"period": "2026-06"}]}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    _stub_get(monkeypatch, {"p1": _FakeResp(_listing("stocks-in-european-ports-may-june-2026"))})
    href = r'href="https?://(?:www\.)?ecf-coffee\.org/(stocks-in-european-ports-[^/"?#]+)/?"'
    found, signal = ss.probe_link_period(["p1"], href, "ecf.json")
    assert found is False and signal == "2026-06"


def test_link_period_tolerates_a_dead_page_but_not_all(tmp_path, monkeypatch):
    (tmp_path / "ecf.json").write_text('{"monthly": [{"period": "2026-04"}]}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    href = r'href="https?://(?:www\.)?ecf-coffee\.org/(stocks-in-european-ports-[^/"?#]+)/?"'
    # One page 404s, the other carries the new post → still detected.
    _stub_get(monkeypatch, {
        "dead": _FakeResp(status=404),
        "live": _FakeResp(_listing("stocks-in-european-ports-may-june-2026")),
    })
    assert ss.probe_link_period(["dead", "live"], href, "ecf.json") == (True, "2026-06")
    # Every page unreachable → no signal, and never a false positive.
    _stub_get(monkeypatch, {"dead": ss.requests.RequestException("boom")})
    assert ss.probe_link_period(["dead"], href, "ecf.json") == (False, None)


def test_build_verify_from_signal_uses_detected_period():
    src = {"verify": {"kind": "month_in_file", "file": "ecf.json", "from_signal": True}}
    v = ss.build_verify(src, "2026-08", "t", "2026-06")
    assert v["expected"] == "2026-06" and v["file"] == "ecf.json"
    # No signal → nothing to verify against.
    assert ss.build_verify(src, "2026-08", "t", None) is None


def test_months_in_json_reads_period_values(tmp_path, monkeypatch):
    f = tmp_path / "ecf.json"
    f.write_text('{"monthly": [{"period": "2026-04", "value_mt": 408956}]}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    assert ss.check_ingested({"kind": "month_in_file", "file": "ecf.json", "expected": "2026-04",
                              "dispatched_at": "2026-08-10T06:00:00+00:00"}) is True


def test_days_past_window_bimonthly_cadence():
    import datetime as dt
    # Confirmed July (cadence 2) → next release pending for September; its
    # window opens Sep 25, so Sep 10 is NOT overdue (monthly math would say
    # pending=August and already count 16 days).
    assert ss._days_past_window(dt.date(2026, 9, 10), "2026-07", 25, 2) == 0
    # Oct 10 with nothing since July: pending Sep window opened Sep 25 → 15d.
    assert ss._days_past_window(dt.date(2026, 10, 10), "2026-07", 25, 2) == 15
    # Current month confirmed → nothing pending.
    assert ss._days_past_window(dt.date(2026, 9, 30), "2026-09", 25, 2) == 0


def test_vn5x_urls_mirror_2x_with_5x_stem():
    import datetime as dt
    pub = dt.date(2026, 8, 6)
    v = ss._vn5x_urls(pub)
    assert len(v) == 6
    assert v[0] == "https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2026/8/1/2026-t7-5x(ta-sb).pdf"
    assert "2025-t12-5x" in ss._vn5x_urls(dt.date(2026, 1, 10))[0]  # year wrap
