# backend/tests/test_topic_notify.py
"""Topical Telegram composers: freshness gates and content shape."""
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraper import topic_notify as tn  # noqa: E402


def _at(s):
    return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)


def test_cot_gate_and_content(tmp_path, monkeypatch):
    monkeypatch.setattr(tn, "DATA", tmp_path)
    rows = [
        {"date": "2026-07-28", "ny": {"mm_long": 40, "mm_short": 10, "oi_total": 100},
         "ldn": {"mm_long": 30, "mm_short": 5, "oi_total": 90}},
        {"date": "2026-08-04", "ny": {"mm_long": 45, "mm_short": 10, "oi_total": 110},
         "ldn": {"mm_long": 28, "mm_short": 6, "oi_total": 95}},
    ]
    (tmp_path / "cot.json").write_text(json.dumps(rows))
    txt = tn.compose_cot(_at("2026-08-06T06:00"))
    assert "2026-08-04" in txt and "MM adding to longs" in txt
    # a week later the same report is old news → silent
    assert tn.compose_cot(_at("2026-08-12T06:00")) is None


def test_freight_gate_and_arrows(tmp_path, monkeypatch):
    monkeypatch.setattr(tn, "DATA", tmp_path)
    (tmp_path / "freight.json").write_text(json.dumps({
        "updated": "2026-08-07",
        "routes": [{"from": "Santos", "to": "NY", "rate": 4115, "prev": 4054, "unit": "USD/FEU"},
                   {"from": "HCMC", "to": "Rtm", "rate": 5531, "prev": 5531, "unit": "USD/FEU"}],
    }))
    txt = tn.compose_freight(_at("2026-08-08T06:00"))
    assert "+1.5% w/w" in txt and "(= w/w)" in txt
    assert tn.compose_freight(_at("2026-08-20T06:00")) is None


def test_imports_yoy_and_top_origins(tmp_path, monkeypatch):
    monkeypatch.setattr(tn, "DATA", tmp_path)
    (tmp_path / "us_coffee_imports.json").write_text(json.dumps({
        "updated": "2026-07-16T09:35:22Z",
        "total_by_year": {"2024": 1000000, "2025": 1100000},
        "origins": [{"name": "Brazil", "by_year": {"2025": 400000}},
                    {"name": "Peru", "by_year": {"2025": 50000}}],
    }))
    txt = tn.compose_us_imports(_at("2026-07-17T06:00"))
    assert "+10.0% y/y" in txt and "Brazil 400.0k t" in txt


def test_origin_digest_missing_month_is_none(tmp_path, monkeypatch):
    monkeypatch.setattr(tn, "DATA", tmp_path)
    (tmp_path / "cecafe.json").write_text(json.dumps({"series": [{"date": "2026-06", "total": 5}]}))
    assert tn.compose_origin_digest("cecafe", "2026-07") is None
    assert "Total 5 bags" in tn.compose_origin_digest("cecafe", "2026-06")
    assert tn.compose_origin_digest("unknown_source", "2026-06") is None


def test_cy_months_and_ctd():
    # Brazil crop year starts July: June is month 12 of the cycle.
    assert tn._cy_months("2026-06", 7)[0] == "2025-07"
    assert len(tn._cy_months("2026-06", 7)) == 12
    # Vietnam Oct start: July is month 10.
    assert tn._cy_months("2026-07", 10)[0] == "2025-10"
    assert len(tn._cy_months("2026-07", 10)) == 10
    vals = {"2025-07": 10, "2025-08": 10, "2024-07": 8, "2024-08": 8}
    ctd, prev = tn._ctd(vals, "2025-08", 7)
    assert ctd == 20 and prev == 16


def test_cot_full_overview_from_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(tn, "DATA", tmp_path)
    monkeypatch.setattr(tn, "ROOT", tmp_path)  # archive absent → OI split omitted
    rows = [
        {"date": "2026-07-28",
         "ny": {"mm_long": 42400, "mm_short": 8900, "oi_total": 164400,
                 "pmpu_long": 32600, "pmpu_short": 62700,
                 "price_ny": 317.3, "structure_ny": -15.55}},
        {"date": "2026-08-04",
         "ny": {"mm_long": 41151, "mm_short": 9710, "oi_total": 168814,
                 "pmpu_long": 36374, "pmpu_short": 64347,
                 "price_ny": 308.8, "structure_ny": -18.4}},
    ]
    (tmp_path / "cot.json").write_text(json.dumps(rows))
    txt = tn.compose_cot(dt.datetime(2026, 8, 6, 6, tzinfo=dt.timezone.utc))
    assert "Total OI change of +4.4 k lots" in txt
    assert "Price -2.7% (-8 cents/lb)" in txt
    assert "moving toward backwardation, inverted at 6.0% (vs 4.9% LW)" in txt
    assert "Roasters are covering for +3.8 k lots (+64.2 k tons)" in txt
    assert "reaching 618.7 k tons" in txt
    assert "Producers are selling for +1.6 k lots" in txt
    assert "MM liquidating longs (-1.2 k lots" in txt
    assert "Net long of 31.4 k lots" in txt


def test_ecf_digest_totals_and_split(tmp_path, monkeypatch):
    monkeypatch.setattr(tn, "DATA", tmp_path)
    (tmp_path / "ecf_history.json").write_text(json.dumps({"monthly": [
        {"period": "2025-04", "value_mt": 450000},
        {"period": "2026-03", "value_mt": 396190},
        {"period": "2026-04", "value_mt": 408956, "value_raw": 6815933,
         "arabica_washed_mt": 136093, "arabica_unwashed_mt": 122093,
         "robusta_mt": 150769},
    ]}))
    txt = tn.compose_origin_digest("ecf", "2026-04")
    assert txt.startswith("🇪🇺 European port stocks (ECF) 2026-04 (+3.2% m/m / -9.1% y/y):")
    assert "Arabica / Robusta / Total" in txt
    assert "2026-04: 258.2k t / 150.8k t / 409.0k t" in txt
    # Prior month lacks the type breakdown → dashes, total still shown.
    assert "2026-03: — / — / 396.2k t" in txt
    # Missing month → silent.
    assert tn.compose_origin_digest("ecf", "2026-06") is None


def test_dedup_keys_read_latest(tmp_path, monkeypatch):
    monkeypatch.setattr(tn, "DATA", tmp_path)
    (tmp_path / "cot.json").write_text(json.dumps([{"date": "2026-08-04"}]))
    (tmp_path / "freight.json").write_text(json.dumps({"updated": "2026-08-07"}))
    assert tn.latest_cot_key() == "2026-08-04"
    assert tn.latest_freight_key() == "2026-08-07"
