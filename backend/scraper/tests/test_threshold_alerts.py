"""Edge-triggered threshold alerts: fire once when a condition turns true,
stay quiet while it holds, re-arm when it clears."""
from scraper.threshold_alerts import compose, evaluate

RULES = [
    {"id": "kc-above-400", "metric": "kc_front", "op": ">", "value": 400, "label": "KC front settles above 400 ¢/lb"},
    {"id": "rc-below-3000", "metric": "rc_front", "op": "<", "value": 3000, "label": "RC front settles below 3,000 USD/MT"},
]


def test_fires_once_when_condition_becomes_true():
    fired, st, rows = evaluate(RULES, {}, {"kc_front": (405.0, "2026-09-02"), "rc_front": (3500.0, "2026-09-02")}, "t1")
    assert [f["id"] for f in fired] == ["kc-above-400"]
    assert st["kc-above-400"]["armed"] is False
    assert st["rc-below-3000"]["armed"] is True
    assert rows[0]["condition"] is True and rows[1]["condition"] is False


def test_does_not_refire_while_condition_holds():
    _, st, _ = evaluate(RULES, {}, {"kc_front": (405.0, "d1"), "rc_front": (3500.0, "d1")}, "t1")
    fired, st2, _ = evaluate(RULES, st, {"kc_front": (410.0, "d2"), "rc_front": (3500.0, "d2")}, "t2")
    assert fired == []
    assert st2["kc-above-400"]["last_fired"] == "t1"


def test_rearms_after_condition_clears_then_fires_again():
    _, st, _ = evaluate(RULES, {}, {"kc_front": (405.0, "d1"), "rc_front": (3500.0, "d1")}, "t1")
    _, st, _ = evaluate(RULES, st, {"kc_front": (390.0, "d2"), "rc_front": (3500.0, "d2")}, "t2")
    assert st["kc-above-400"]["armed"] is True
    fired, st, _ = evaluate(RULES, st, {"kc_front": (401.0, "d3"), "rc_front": (3500.0, "d3")}, "t3")
    assert [f["id"] for f in fired] == ["kc-above-400"]
    assert st["kc-above-400"]["last_fired"] == "t3"


def test_missing_metric_leaves_rule_untouched():
    fired, st, rows = evaluate(RULES, {}, {"kc_front": (None, None), "rc_front": (2900.0, "d1")}, "t1")
    assert [f["id"] for f in fired] == ["rc-below-3000"]
    assert rows[0]["condition"] is None and rows[0]["current"] is None
    assert st["kc-above-400"]["armed"] is True


def test_message_names_the_rule_the_value_and_the_rearm_rule():
    fired, _, _ = evaluate(RULES, {}, {"kc_front": (405.25, "2026-09-02"), "rc_front": (3500.0, "d")}, "t1")
    text = compose(fired[0])
    assert "KC front settles above 400" in text
    assert "405.25" in text and "¢/lb" in text and "as of 2026-09-02" in text
    assert "Re-arms" in text
