# backend/tests/test_source_sentinel.py
"""The sentinel's window/late probing rule:
probe inside the release window until the month is confirmed, and keep
probing daily past the window — including across the month boundary — while
a release is late."""
import importlib.util
import json
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


_PDF_JUN = ("https://www.ecf-coffee.org/wp-content/uploads/2026/06/"
            "2026-Stocks-European-Ports.pdf")
_PDF_AUG = ("https://www.ecf-coffee.org/wp-content/uploads/2026/08/"
            "2026-Stocks-European-Ports.pdf")
_ECF_POST_RE = r'href="(https?://(?:www\.)?ecf-coffee\.org/stocks-in-european-ports-[^/"?#]+)[^"]*"'


def test_pdf_key_orders_reissues_then_years():
    # Same data year, newer upload wins.
    assert ss._pdf_key(_PDF_AUG) > ss._pdf_key(_PDF_JUN)
    # A newer DATA year outranks an older year's later re-upload.
    nxt = "https://www.ecf-coffee.org/wp-content/uploads/2027/01/2027-Stocks-European-Ports.pdf"
    assert ss._pdf_key(nxt) > ss._pdf_key(_PDF_AUG)
    assert ss._pdf_key("not-a-pdf") == (0, 0, 0)


def test_pdf_upload_fires_on_a_newer_reissue(tmp_path, monkeypatch):
    # Data built from the June upload; the post now links the August one.
    (tmp_path / "ecf.json").write_text(
        f'{{"monthly": [{{"period": "2026-04", "source_pdf": "{_PDF_JUN}"}}]}}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    post = "https://www.ecf-coffee.org/stocks-in-european-ports-may-june-2026"
    _stub_get(monkeypatch, {
        "listing": _FakeResp(f'<a href="{post}/">May-June</a>'),
        post: _FakeResp(f'<a href="{_PDF_AUG}">PDF</a>'),
    })
    found, signal = ss.probe_pdf_upload(["listing"], _ECF_POST_RE, "ecf.json")
    assert found is True and signal == _PDF_AUG


def test_pdf_upload_quiet_when_data_cites_the_same_pdf(tmp_path, monkeypatch):
    (tmp_path / "ecf.json").write_text(
        f'{{"monthly": [{{"period": "2026-04", "source_pdf": "{_PDF_JUN}"}}]}}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    post = "https://www.ecf-coffee.org/stocks-in-european-ports-march-april-2026"
    _stub_get(monkeypatch, {
        "listing": _FakeResp(f'<a href="{post}/">Mar-Apr</a>'),
        post: _FakeResp(f'<a href="{_PDF_JUN}">PDF</a>'),
    })
    assert ss.probe_pdf_upload(["listing"], _ECF_POST_RE, "ecf.json") == (False, _PDF_JUN)


def test_pdf_upload_never_false_positives_on_failure(tmp_path, monkeypatch):
    (tmp_path / "ecf.json").write_text(f'{{"monthly": [{{"source_pdf": "{_PDF_JUN}"}}]}}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    # Listing unreachable → no signal at all.
    _stub_get(monkeypatch, {"listing": ss.requests.RequestException("boom")})
    assert ss.probe_pdf_upload(["listing"], _ECF_POST_RE, "ecf.json") == (False, None)
    # Listing loads but carries no PDF anywhere → still no detection.
    _stub_get(monkeypatch, {"listing": _FakeResp("<p>nothing here</p>")})
    assert ss.probe_pdf_upload(["listing"], _ECF_POST_RE, "ecf.json") == (False, None)


def test_string_in_file_verification(tmp_path, monkeypatch):
    (tmp_path / "ecf.json").write_text(f'{{"monthly": [{{"source_pdf": "{_PDF_JUN}"}}]}}')
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    base = {"kind": "string_in_file", "file": "ecf.json",
            "dispatched_at": "2026-08-12T06:00:00+00:00"}
    assert ss.check_ingested({**base, "expected": _PDF_JUN}) is True
    assert ss.check_ingested({**base, "expected": _PDF_AUG}) is False
    assert ss.check_ingested({**base, "file": "missing.json", "expected": _PDF_JUN}) is False


def test_build_verify_from_signal_carries_any_kind():
    src = {"verify": {"kind": "string_in_file", "file": "ecf.json", "from_signal": True}}
    v = ss.build_verify(src, "2026-08", "t", _PDF_AUG)
    assert v["kind"] == "string_in_file" and v["expected"] == _PDF_AUG
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


def test_verify_only_closes_pending_checks_without_probing(tmp_path, monkeypatch):
    """--verify-only runs after a scraper commits so the digest lands the same
    day: it must close out a pending check but never probe or dispatch."""
    import datetime as dt
    (tmp_path / "data").mkdir()
    (tmp_path / "out.json").write_text('{"series": [{"month": "2026-07"}]}')
    state = {"cecafe": {
        "confirmed": "2026-07", "signal": None, "last_probe": None, "last_found": None,
        "verify": {"kind": "month_in_file", "file": "out.json", "expected": "2026-07",
                   "dispatched_at": "2026-08-12T06:00:00+00:00", "status": "pending"},
    }}
    (tmp_path / "data" / "source_sentinels.json").write_text(json.dumps(state))
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    monkeypatch.setattr(ss, "STATE_PATH", tmp_path / "data" / "source_sentinels.json")
    monkeypatch.setattr(ss, "SOURCES", [{
        "key": "cecafe", "label": "Cecafé monthly export report", "window_start": 1,
        "kind": "head_month", "urls": lambda pub: ["http://x"],
        "workflows": ["scraper-cecafe.yml"],
        "verify": {"kind": "month_in_file", "file": "out.json", "lag": 1},
    }])
    monkeypatch.setattr(ss, "_topic_specs", lambda: [])

    def _boom(*a, **k):
        raise AssertionError("verify-only must not probe")
    monkeypatch.setattr(ss, "probe_head_month", _boom)
    dispatched, sent = [], []
    monkeypatch.setattr(ss, "dispatch_workflow", lambda *a, **k: dispatched.append(a))
    monkeypatch.setattr(ss, "telegram", lambda msg, dry: sent.append(msg))

    assert ss.run(dt.date(2026, 8, 13), dry=False, verify_only=True) == 0
    assert not dispatched
    assert len(sent) == 1 and "ingestion check passed" in sent[0]
    written = json.loads((tmp_path / "data" / "source_sentinels.json").read_text())
    assert written["cecafe"]["verify"]["status"] == "ok"
    # The probe-side state is untouched — a verify pass must not look like a sweep.
    assert written["cecafe"]["confirmed"] == "2026-07"
    assert written["cecafe"]["last_probe"] is None


def test_topic_dedup_key_is_persisted(tmp_path, monkeypatch):
    """The COT/freight text must be sent ONCE per new report. The state file
    used to be flushed before the topic loop ran, so the dedup key never
    reached disk and every run re-sent the same text while the composer's
    freshness gate stayed open."""
    import datetime as dt
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "source_sentinels.json").write_text("{}")
    monkeypatch.setattr(ss, "ROOT", tmp_path)
    monkeypatch.setattr(ss, "STATE_PATH", tmp_path / "data" / "source_sentinels.json")
    monkeypatch.setattr(ss, "SOURCES", [])
    sent = []
    monkeypatch.setattr(ss, "telegram", lambda msg, dry: sent.append(msg))
    monkeypatch.setattr(ss, "_topic_specs",
                        lambda: [("cot", lambda: "2026-08-11", lambda now: "📊 COT text")])

    ss.run(dt.date(2026, 8, 12), dry=False)
    assert sent == ["📊 COT text"]
    written = json.loads((tmp_path / "data" / "source_sentinels.json").read_text())
    assert written["_topics"]["cot"] == "2026-08-11"

    # Second run, same report → silent.
    ss.run(dt.date(2026, 8, 12), dry=False)
    assert len(sent) == 1
