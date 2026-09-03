"""VN river-flow tracker: bulletin dating, archive roots, history accumulation."""
import datetime as dt
import json

from scraper.sources import vn_dam_levels as m

RIVERS = [
    {"river": "Dak Bla", "river_vn": "ĐăkBla", "provinces": ["Gia Lai", "Kon Tum"], "station": "Kon Tum",
     "actual_mm3": 13.77, "tbnn_pct": -80.0, "forecast_tbnn_pct": -77.0, "signal": "critical"},
    {"river": "Srepok", "river_vn": "Srêpôk", "provinces": ["Dak Lak"], "station": "Giang Sơn",
     "actual_mm3": 22.75, "tbnn_pct": -60.0, "forecast_tbnn_pct": -43.0, "signal": "critical"},
]


def test_bulletin_date_comes_from_the_file_name():
    url = "https://kttv.gov.vn//upload/thuyvan2/2026/8/22/dbqg_nnhn_20260822_1500.pdf"
    assert m.date_from_pdf_url(url) == dt.date(2026, 8, 22)
    assert m.date_from_pdf_url("https://x/y.pdf") is None


def test_candidates_try_both_archive_roots_newest_first():
    urls = m.pdf_url_candidates(dt.date(2026, 8, 22))
    assert urls == [
        "https://kttv.gov.vn/upload/thuyvan2/2026/8/22/dbqg_nnhn_20260822_1500.pdf",
        "https://kttv.gov.vn/upload/thuyvan1/2026/8/22/dbqg_nnhn_20260822_1500.pdf",
    ]


def test_history_upsert_keys_on_bulletin_date():
    h = m.upsert_history([], m.history_entry(dt.date(2026, 8, 22), RIVERS, "u1"))
    h = m.upsert_history(h, m.history_entry(dt.date(2026, 8, 12), RIVERS, "u0"))
    h = m.upsert_history(h, m.history_entry(dt.date(2026, 8, 22), RIVERS[:1], "u1b"))
    assert [e["date"] for e in h] == ["2026-08-12", "2026-08-22"]
    assert h[1]["pdf_url"] == "u1b" and len(h[1]["rivers"]) == 1
    assert h[0]["rivers"][0] == {"river": "Dak Bla", "station": "Kon Tum", "actual_mm3": 13.77,
                                 "tbnn_pct": -80.0, "forecast_tbnn_pct": -77.0}


def test_build_appends_to_history_and_keeps_it_across_runs(tmp_path, monkeypatch):
    out = tmp_path / "vn_water_levels.json"
    monkeypatch.setattr(m, "OUT_PATH", out)
    monkeypatch.setattr(m, "HAS_PDFPLUMBER", True)
    monkeypatch.setattr(m, "parse_bulletin", lambda _b: [dict(r) for r in RIVERS])

    class _Resp:
        content = b"%PDF"
        def raise_for_status(self): pass
    monkeypatch.setattr(m.requests, "get", lambda *a, **k: _Resp())

    url1 = "https://kttv.gov.vn/upload/thuyvan2/2026/8/22/dbqg_nnhn_20260822_1500.pdf"
    monkeypatch.setattr(m, "_find_latest_pdf_url", lambda: (url1, dt.date(2026, 8, 22)))
    doc = m.build_vn_water_levels()
    assert doc["bulletin_date"] == "2026-08-22"
    assert [e["date"] for e in doc["history"]] == ["2026-08-22"]

    url2 = "https://kttv.gov.vn/upload/thuyvan2/2026/9/1/dbqg_nnhn_20260901_1500.pdf"
    monkeypatch.setattr(m, "_find_latest_pdf_url", lambda: (url2, dt.date(2026, 9, 1)))
    doc = m.build_vn_water_levels()
    assert [e["date"] for e in json.loads(out.read_text())["history"]] == ["2026-08-22", "2026-09-01"]
    assert doc["rivers"][0]["signal"] == "critical"


def test_backfill_saves_as_it_goes_and_stops_on_its_time_budget(tmp_path, monkeypatch):
    out = tmp_path / "vn_water_levels.json"
    monkeypatch.setattr(m, "OUT_PATH", out)
    monkeypatch.setattr(m, "HAS_PDFPLUMBER", True)
    monkeypatch.setattr(m, "parse_bulletin", lambda _b: [dict(r) for r in RIVERS])
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)
    # Only the 2nd and 4th of the month exist, under the newer archive root.
    hits = {"2026/8/2/", "2026/8/4/"}
    monkeypatch.setattr(m, "_head_ok", lambda url, timeout=10: "thuyvan2" in url and any(h in url for h in hits))

    class _Resp:
        content = b"%PDF"
        def raise_for_status(self): pass
    monkeypatch.setattr(m.requests, "get", lambda *a, **k: _Resp())

    # A clock that runs out after the third day is examined.
    ticks = iter([0, 0, 0, 0, 10_000, 10_000])
    monkeypatch.setattr(m.time, "monotonic", lambda: next(ticks, 10_000))
    s = m.backfill("2026-08-01", "2026-08-10", budget_s=100)
    assert s["parsed"] == 1 and s["stopped_at"] == "2026-08-04"
    saved = json.loads(out.read_text())
    assert [e["date"] for e in saved["history"]] == ["2026-08-02"]
    assert saved["history"][0]["pdf_url"].startswith("https://kttv.gov.vn/upload/thuyvan2/2026/8/2/")

    # Re-run from where it stopped: the 2nd is skipped (on file), the 4th is added.
    monkeypatch.setattr(m.time, "monotonic", lambda: 0)
    s = m.backfill("2026-08-04", "2026-08-10", budget_s=100)
    assert s["parsed"] == 1 and s["stopped_at"] is None
    assert [e["date"] for e in json.loads(out.read_text())["history"]] == ["2026-08-02", "2026-08-04"]


def test_build_without_a_bulletin_keeps_the_last_one_on_file(tmp_path, monkeypatch):
    out = tmp_path / "vn_water_levels.json"
    out.write_text(json.dumps({"history": [m.history_entry(dt.date(2026, 8, 22), RIVERS, "u")]}))
    monkeypatch.setattr(m, "OUT_PATH", out)
    monkeypatch.setattr(m, "HAS_PDFPLUMBER", True)
    monkeypatch.setattr(m, "_find_latest_pdf_url", lambda: (None, None))
    doc = m.build_vn_water_levels()
    assert doc["bulletin_date"] == "2026-08-22"
    assert doc["has_live_data"] is True
    assert [e["date"] for e in doc["history"]] == ["2026-08-22"]
