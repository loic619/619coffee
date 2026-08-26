"""Tests for validate_export.py — each validator has a passing and a failing case."""
from datetime import UTC, date, timedelta


def today_str():
    return date.today().isoformat()


def old_date_str():
    return (date.today() - timedelta(days=30)).isoformat()


# ── futures_chain ─────────────────────────────────────────────────────────────

def test_validate_futures_chain_passes():
    from scraper.validate_export import validate_futures_chain
    good = {
        "arabica": {"pub_date": today_str(), "contracts": [{}] * 6},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, reason = validate_futures_chain(good)
    assert ok, reason


def test_validate_futures_chain_missing_robusta():
    from scraper.validate_export import validate_futures_chain
    bad = {"arabica": {"pub_date": today_str(), "contracts": [{}] * 6}}
    ok, _ = validate_futures_chain(bad)
    assert not ok


def test_validate_futures_chain_stale():
    from scraper.validate_export import validate_futures_chain
    bad = {
        "arabica": {"pub_date": old_date_str(), "contracts": [{}] * 6},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, _ = validate_futures_chain(bad)
    assert not ok


def test_validate_futures_chain_too_few_contracts():
    from scraper.validate_export import validate_futures_chain
    bad = {
        "arabica": {"pub_date": today_str(), "contracts": [{}] * 3},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, _ = validate_futures_chain(bad)
    assert not ok


# ── farmer_economics ──────────────────────────────────────────────────────────

def test_validate_farmer_economics_passes():
    from datetime import datetime

    from scraper.validate_export import validate_farmer_economics
    now = datetime.now(UTC).isoformat()
    good = {
        "weather": {"regions": []},
        "fertilizer": {"items": [{"name": "Urea"}]},
        "scraped_at": now,
    }
    ok, reason = validate_farmer_economics(good)
    assert ok, reason


def test_validate_farmer_economics_null_weather():
    from scraper.validate_export import validate_farmer_economics
    bad = {"weather": None, "fertilizer": {"items": [{}]}, "scraped_at": "2099-01-01T00:00:00Z"}
    ok, _ = validate_farmer_economics(bad)
    assert not ok


def test_validate_farmer_economics_empty_fertilizer():
    from datetime import datetime

    from scraper.validate_export import validate_farmer_economics
    now = datetime.now(UTC).isoformat()
    bad = {"weather": {"regions": []}, "fertilizer": {"items": []}, "scraped_at": now}
    ok, _ = validate_farmer_economics(bad)
    assert not ok


# ── cot ───────────────────────────────────────────────────────────────────────

def test_validate_cot_passes():
    from scraper.validate_export import validate_cot
    good = [{"date": today_str(), "ny": {}, "ldn": {}}]
    ok, reason = validate_cot(good)
    assert ok, reason


def test_validate_cot_empty():
    from scraper.validate_export import validate_cot
    ok, _ = validate_cot([])
    assert not ok


def test_validate_cot_stale():
    from scraper.validate_export import validate_cot
    bad = [{"date": old_date_str()}]
    ok, _ = validate_cot(bad)
    assert not ok


# ── macro_cot ─────────────────────────────────────────────────────────────────

def test_validate_macro_cot_passes():
    from scraper.validate_export import validate_macro_cot
    ok, reason = validate_macro_cot([{"date": today_str()}])
    assert ok, reason


def test_validate_macro_cot_empty():
    from scraper.validate_export import validate_macro_cot
    ok, _ = validate_macro_cot([])
    assert not ok


# ── freight ───────────────────────────────────────────────────────────────────

def test_validate_freight_passes():
    from scraper.validate_export import validate_freight
    ok, reason = validate_freight({"routes": [{"name": "Santos-Hamburg"}], "history": []})
    assert ok, reason


def test_validate_freight_empty_routes():
    from scraper.validate_export import validate_freight
    ok, _ = validate_freight({"routes": [], "history": []})
    assert not ok


# ── oi_fnd_chart ──────────────────────────────────────────────────────────────

def test_validate_oi_fnd_chart_passes():
    from scraper.validate_export import validate_oi_fnd_chart
    ok, reason = validate_oi_fnd_chart({"arabica": [], "robusta": []})
    assert ok, reason


def test_validate_oi_fnd_chart_missing_key():
    from scraper.validate_export import validate_oi_fnd_chart
    ok, _ = validate_oi_fnd_chart({"arabica": []})
    assert not ok


# ── oi_history ────────────────────────────────────────────────────────────────

def test_validate_oi_history_passes():
    from scraper.validate_export import validate_oi_history
    ok, reason = validate_oi_history({"arabica": [{"date": today_str()}], "robusta": [{"date": today_str()}]})
    assert ok, reason


def test_validate_oi_history_empty():
    from scraper.validate_export import validate_oi_history
    ok, _ = validate_oi_history({"arabica": [], "robusta": [{"date": today_str()}]})
    assert not ok


# ── quant_report ──────────────────────────────────────────────────────────────

def test_validate_quant_report_passes():
    from datetime import UTC, datetime

    from scraper.validate_export import validate_quant_report
    fresh = datetime.now(UTC).isoformat()
    ok, reason = validate_quant_report({
        "currency_index": {
            "scraped_at":  fresh,
            "index_value": 105.4,
            "currencies":  [{"daily_chg": 0.1}] * 12,
        },
    })
    assert ok, reason


def test_validate_quant_report_empty():
    from scraper.validate_export import validate_quant_report
    ok, _ = validate_quant_report({"currency_index": []})
    assert not ok


def test_validate_quant_report_stale_rejected():
    """6-day-old scraped_at should fail — guards against silent yfinance failures."""
    from scraper.validate_export import validate_quant_report
    ok, reason = validate_quant_report({
        "currency_index": {
            "scraped_at": "2026-05-08T00:00:00+00:00",
            "currencies": [{"daily_chg": 0.1}] * 12,
        },
    })
    assert not ok
    assert "old" in reason


def test_validate_quant_report_thin_data_rejected():
    """If only a few currencies have daily_chg, the index is unreliable — reject."""
    from datetime import UTC, datetime

    from scraper.validate_export import validate_quant_report
    fresh = datetime.now(UTC).isoformat()
    ok, reason = validate_quant_report({
        "currency_index": {
            "scraped_at": fresh,
            "currencies": [{"daily_chg": None}] * 10 + [{"daily_chg": 0.1}] * 2,
        },
    })
    assert not ok
    assert "daily_chg" in reason


# ── cecafe_daily ──────────────────────────────────────────────────────────────

def test_validate_cecafe_daily_passes():
    from scraper.validate_export import validate_cecafe_daily
    ok, reason = validate_cecafe_daily({"updated": today_str(), "arabica": {"2026-04": 1000}, "conillon": {}})
    assert ok, reason


def test_validate_cecafe_daily_empty():
    from scraper.validate_export import validate_cecafe_daily
    ok, _ = validate_cecafe_daily({"updated": today_str(), "arabica": {}, "conillon": {}})
    assert not ok


def test_validate_cecafe_daily_v2_schema_passes():
    """v2 dual-source schema must validate — this was the bug that reverted
    the freshly-written file and kept embarques from ever committing."""
    from scraper.validate_export import validate_cecafe_daily
    doc = {
        "updated": today_str(),
        "_schema": "v2",
        "sources": {
            "embarques":    {"arabica": {}, "conillon": {"2026-06": {"1": 2520}}, "soluvel": {}},
            "certificados": {"arabica": {"2026-06": {"1": 93535}}, "conillon": {}, "soluvel": {}},
        },
    }
    ok, reason = validate_cecafe_daily(doc)
    assert ok, reason


def test_validate_cecafe_daily_v2_empty_fails():
    """v2 with both sources empty should still be rejected."""
    from scraper.validate_export import validate_cecafe_daily
    doc = {
        "updated": today_str(),
        "_schema": "v2",
        "sources": {
            "embarques":    {"arabica": {}, "conillon": {}, "soluvel": {}},
            "certificados": {"arabica": {}, "conillon": {}, "soluvel": {}},
        },
    }
    ok, _ = validate_cecafe_daily(doc)
    assert not ok


# ── earnings ──────────────────────────────────────────────────────────────────

def test_validate_earnings_passes():
    from scraper.validate_export import validate_earnings
    ok, reason = validate_earnings({"scraped_at": today_str(), "companies": [{"ticker": "CAFE"}]})
    assert ok, reason


def test_validate_earnings_empty():
    from scraper.validate_export import validate_earnings
    ok, _ = validate_earnings({"scraped_at": today_str(), "companies": []})
    assert not ok


# ── kaffeesteuer ──────────────────────────────────────────────────────────────

def test_validate_kaffeesteuer_passes():
    from scraper.validate_export import validate_kaffeesteuer
    ok, reason = validate_kaffeesteuer({"2025-01": 12345, "2025-02": 11000})
    assert ok, reason


def test_validate_kaffeesteuer_empty():
    from scraper.validate_export import validate_kaffeesteuer
    ok, _ = validate_kaffeesteuer({})
    assert not ok


# ── safe_write_json ───────────────────────────────────────────────────────────

def test_safe_write_json_writes_on_pass(tmp_path):
    from scraper.validate_export import safe_write_json, validate_macro_cot
    dest = tmp_path / "macro_cot.json"
    result = safe_write_json(dest, [{"date": "2026-04-01"}], validate_macro_cot)
    assert result is True
    assert dest.exists()


def test_safe_write_json_idempotent_skip(tmp_path):
    """Re-writing identical data is a no-op (string short-circuit, no re-parse)."""
    from scraper.validate_export import safe_write_json, validate_macro_cot
    dest = tmp_path / "macro_cot.json"
    payload = [{"date": "2026-04-01"}]
    assert safe_write_json(dest, payload, validate_macro_cot) is True     # first write
    mtime = dest.stat().st_mtime_ns
    assert safe_write_json(dest, payload, validate_macro_cot) is False     # identical → skip
    assert dest.stat().st_mtime_ns == mtime                               # file untouched


def test_safe_write_json_keeps_old_on_fail(tmp_path):
    import json

    from scraper.validate_export import safe_write_json, validate_macro_cot
    dest = tmp_path / "macro_cot.json"
    dest.write_text(json.dumps([{"date": "2026-01-01"}]))
    result = safe_write_json(dest, [], validate_macro_cot)  # empty list fails
    assert result is False
    data = json.loads(dest.read_text())
    assert data == [{"date": "2026-01-01"}]   # old data preserved


# ── price_swing_guard (volatility) ────────────────────────────────────────────

def _ok_validator(_d):
    return True, "ok"


def test_price_swing_guard_passes_small_move():
    from scraper.validate_export import price_swing_guard
    old = {"tickers": [{"label": "VN FAQ", "value": "100,000 VND ($1,234)"}]}
    new = {"tickers": [{"label": "VN FAQ", "value": "102,000 VND ($1,250)"}]}  # +2%
    ok, reason = price_swing_guard(0.30)(old, new)
    assert ok, reason


def test_price_swing_guard_rejects_unit_error():
    """VN FAQ parsed as 10,000 instead of 100,000 VND — a 90% drop — is rejected."""
    from scraper.validate_export import price_swing_guard
    old = {"tickers": [{"label": "VN FAQ", "value": "100,000 VND ($1,234)"}]}
    new = {"tickers": [{"label": "VN FAQ", "value": "10,000 VND ($123)"}]}
    ok, reason = price_swing_guard(0.30)(old, new)
    assert not ok
    assert "VN FAQ" in reason and "parsing error" in reason


def test_price_swing_guard_handles_brazilian_format():
    """Regression: CON T7 is Brazilian-formatted ('.' thousands, ',' decimal).
    A move from 980,00 to 1.050,00 BRL is +7%, not a spurious ~100% swing that
    would freeze latest_prices.json (see the June-2026 ticker freeze)."""
    from scraper.validate_export import _first_number, price_swing_guard
    assert _first_number("980,00 BRL ($3,158)") == 980.0
    assert _first_number("1.050,00 BRL ($3,383)") == 1050.0
    assert _first_number("100.000 VND ($1,234)") == 100000.0   # BR-style thousands
    old = {"tickers": [{"label": "CON T7", "value": "980,00 BRL ($3,158)"}]}
    new = {"tickers": [{"label": "CON T7", "value": "1.050,00 BRL ($3,383)"}]}
    ok, reason = price_swing_guard(0.30)(old, new)
    assert ok, reason


def test_price_swing_guard_first_write_not_blocked(tmp_path):
    """No prior file → sanity guard is skipped, write proceeds."""
    import json

    from scraper.validate_export import price_swing_guard, safe_write_json
    dest = tmp_path / "latest_prices.json"
    payload = {"tickers": [{"label": "KC1", "value": "273.45"}]}
    written = safe_write_json(dest, payload, _ok_validator, sanity_fn=price_swing_guard(0.30))
    assert written is True
    assert json.loads(dest.read_text()) == payload


def test_safe_write_json_sanity_keeps_old_on_swing(tmp_path):
    """A >30% swing vs the prior good file is rejected; the old file is kept."""
    import json

    from scraper.validate_export import price_swing_guard, safe_write_json
    dest = tmp_path / "latest_prices.json"
    good = {"tickers": [{"label": "KC1", "value": "273.45"}]}
    dest.write_text(json.dumps(good))
    bad = {"tickers": [{"label": "KC1", "value": "27.35"}]}  # ~90% drop
    written = safe_write_json(dest, bad, _ok_validator, sanity_fn=price_swing_guard(0.30))
    assert written is False
    assert json.loads(dest.read_text()) == good   # old data preserved


# ── futures_chain / fx_history / scalar swing guards ──────────────────────────

def test_futures_chain_swing_guard_passes_normal_move():
    from scraper.validate_export import futures_chain_swing_guard
    old = {"arabica": {"contracts": [{"symbol": "KCU26", "last": 334.25}]},
           "robusta": {"contracts": [{"symbol": "RMN26", "last": 3872}]}}
    new = {"arabica": {"contracts": [{"symbol": "KCU26", "last": 330.0}]},
           "robusta": {"contracts": [{"symbol": "RMN26", "last": 3900}]}}
    assert futures_chain_swing_guard()(old, new)[0] is True


def test_futures_chain_swing_guard_rejects_units_error():
    """KC (cents) misread as dollars — 334.25 → 3.34 — is rejected."""
    from scraper.validate_export import futures_chain_swing_guard
    old = {"arabica": {"contracts": [{"symbol": "KCU26", "last": 334.25}]}, "robusta": {"contracts": []}}
    new = {"arabica": {"contracts": [{"symbol": "KCU26", "last": 3.34}]}, "robusta": {"contracts": []}}
    ok, reason = futures_chain_swing_guard()(old, new)
    assert not ok and "KCU26" in reason


def test_futures_chain_swing_guard_skips_new_symbol():
    """A newly-listed contract with no prior counterpart is not blocked."""
    from scraper.validate_export import futures_chain_swing_guard
    old = {"arabica": {"contracts": [{"symbol": "KCU26", "last": 334.25}]}, "robusta": {"contracts": []}}
    new = {"arabica": {"contracts": [{"symbol": "KCZ26", "last": 1.0}]}, "robusta": {"contracts": []}}
    assert futures_chain_swing_guard()(old, new)[0] is True


def test_fx_history_swing_guard_rejects_rescale():
    """BRL latest close 5.1 → 0.51 (a dropped digit / inversion) is rejected."""
    from scraper.validate_export import fx_history_swing_guard
    old = {"pairs": {"BRL=X": {"history": [{"date": "2026-07-10", "close": 5.1}]}}}
    new = {"pairs": {"BRL=X": {"history": [{"date": "2026-07-11", "close": 0.51}]}}}
    ok, reason = fx_history_swing_guard()(old, new)
    assert not ok and "BRL=X" in reason


def test_fx_history_swing_guard_passes_normal_move():
    from scraper.validate_export import fx_history_swing_guard
    old = {"pairs": {"BRL=X": {"history": [{"date": "2026-07-10", "close": 5.1}]}}}
    new = {"pairs": {"BRL=X": {"history": [{"date": "2026-07-11", "close": 5.15}]}}}
    assert fx_history_swing_guard()(old, new)[0] is True


def test_scalar_swing_guard_on_currency_index():
    from scraper.validate_export import scalar_swing_guard
    g = scalar_swing_guard("currency_index", "index_value")
    assert g({"currency_index": {"index_value": 107.9}},
             {"currency_index": {"index_value": 108.5}})[0] is True
    ok, reason = g({"currency_index": {"index_value": 107.9}},
                   {"currency_index": {"index_value": 10.79}})
    assert not ok and "index_value" in reason
    # Missing on one side → skip (model-output sections absent on first write).
    assert g({}, {"currency_index": {"index_value": 10.79}})[0] is True


# ── safe_write_json: atomicity-only mode + trailing newline (rollout params) ──

def test_safe_write_json_no_validator_writes_atomically(tmp_path):
    from scraper.validate_export import safe_write_json
    p = tmp_path / "x.json"
    assert safe_write_json(p, {"a": 1}) is True          # validate_fn=None
    assert not (tmp_path / "x.json.tmp").exists()          # tmp renamed away
    import json
    assert json.loads(p.read_text()) == {"a": 1}


def test_safe_write_json_trailing_newline_and_format(tmp_path):
    import json

    from scraper.validate_export import safe_write_json
    p = tmp_path / "y.json"
    safe_write_json(p, {"k": "é"}, ensure_ascii=False, trailing_newline=True)
    txt = p.read_text(encoding="utf-8")
    assert txt == json.dumps({"k": "é"}, indent=2, ensure_ascii=False) + "\n"
