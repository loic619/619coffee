# backend/tests/test_front_price_series.py
"""Front-month daily price series: monotonic rolls + roll-day metadata.

The Industry Pulse price line draws one segment per contract, so it needs to
know (a) which contract each day was priced from and (b) the outgoing
contract's settle on the roll date, to close the old segment where it actually
ended. It also needs rolls not to oscillate: raw max-OI really did flip robusta
N26→K26→N26 across 2026-05-01/05-04.
"""
from scraper import symbols as sym
from scraper.exporters.futures import _front_price_series


def _day(**contracts):
    """{'RCU26': (oi, price), ...} → {SYMBOL: {'oi': .., 'price': ..}}"""
    return {s: {"oi": oi, "price": px} for s, (oi, px) in contracts.items()}


def test_expiry_key_orders_by_delivery_not_alphabetically():
    assert sym.expiry_key("RCU26") < sym.expiry_key("RCX26")
    assert sym.expiry_key("RCX26") < sym.expiry_key("RCF27")   # year rolls over
    assert sym.expiry_key("KCH26") < sym.expiry_key("KCZ26")
    assert sym.expiry_key("garbage") == 999999


def test_front_follows_max_oi_and_labels_the_contract():
    archive = {
        "2026-07-30": _day(RCU26=(50_000, 3800), RCX26=(10_000, 3810)),
        "2026-07-31": _day(RCU26=(48_000, 3790), RCX26=(12_000, 3800)),
    }
    rows = _front_price_series(archive)
    assert [r["contract"] for r in rows] == ["RCU26", "RCU26"]
    assert [r["price"] for r in rows] == [3800, 3790]
    assert "prev_contract" not in rows[0]


def test_roll_day_carries_outgoing_settle():
    archive = {
        "2026-07-31": _day(RCU26=(48_000, 3790), RCX26=(12_000, 3800)),
        "2026-08-03": _day(RCU26=(20_000, 3786), RCX26=(40_000, 3784)),
    }
    rows = _front_price_series(archive)
    roll = rows[1]
    assert roll["contract"] == "RCX26"
    assert roll["price"] == 3784           # incoming, its own price
    assert roll["prev_contract"] == "RCU26"
    assert roll["prev_price"] == 3786      # outgoing, same date
    # The gap between them is the roll spread, not a move.
    assert roll["prev_price"] != roll["price"]


def test_roll_is_monotonic_no_flip_flop():
    # The real robusta case: OI briefly puts K26 ahead of N26 again.
    archive = {
        "2026-04-30": _day(RCK26=(10_000, 3560), RCN26=(45_000, 3360)),
        "2026-05-01": _day(RCK26=(46_000, 3568), RCN26=(44_000, 3364)),  # K26 spikes
        "2026-05-04": _day(RCK26=(20_000, 3570), RCN26=(50_000, 3366)),
    }
    rows = _front_price_series(archive)
    # Front never steps back to the earlier expiry, so there is no roll at all.
    assert [r["contract"] for r in rows] == ["RCN26"] * 3
    assert not any("prev_contract" in r for r in rows)


def test_forward_roll_still_happens_after_monotonic_guard():
    archive = {
        "2026-08-03": _day(RCU26=(50_000, 3786), RCX26=(10_000, 3784)),
        "2026-08-04": _day(RCU26=(10_000, 3780), RCX26=(55_000, 3770)),
    }
    rows = _front_price_series(archive)
    assert [r["contract"] for r in rows] == ["RCU26", "RCX26"]
    assert rows[1]["prev_price"] == 3780


def test_missing_oi_carries_last_front_forward():
    # ICE publishes OI a day behind price: the newest day has price, no OI.
    archive = {
        "2026-08-03": _day(RCX26=(40_000, 3784)),
        "2026-08-04": {"RCX26": {"price": 3770}, "RCF27": {"price": 3800}},
    }
    rows = _front_price_series(archive)
    assert [r["contract"] for r in rows] == ["RCX26", "RCX26"]
    assert rows[1]["price"] == 3770


def test_days_without_any_price_are_skipped():
    archive = {
        "2026-08-03": _day(RCX26=(40_000, 3784)),
        "2026-08-04": {"RCX26": {"oi": 1, "price": None}},
    }
    assert [r["date"] for r in _front_price_series(archive)] == ["2026-08-03"]
