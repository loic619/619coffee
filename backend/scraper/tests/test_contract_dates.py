"""Tests for the shared contract_dates module (deduped FND / trading-day math)."""
from datetime import date

from contract_dates import (
    calc_fnd,
    first_business_day,
    subtract_business_days,
    trading_days_to,
)


def test_first_business_day_skips_weekend():
    # 2026-05-01 is a Friday → itself
    assert first_business_day(2026, 5) == date(2026, 5, 1)
    # 2026-08-01 is a Saturday → 2026-08-03 (Mon)
    assert first_business_day(2026, 8) == date(2026, 8, 3)


def test_subtract_business_days():
    # back 1 business day from Mon 2026-05-04 → Fri 2026-05-01
    assert subtract_business_days(date(2026, 5, 4), 1) == date(2026, 5, 1)


def test_calc_fnd_kc_is_7_rc_is_4_business_days():
    assert calc_fnd("KCK26") == date(2026, 4, 22)   # 7 biz days before 2026-05-01
    assert calc_fnd("RCK26") == date(2026, 4, 27)   # 4 biz days before
    assert calc_fnd("rmk26") == date(2026, 4, 27)   # case-insensitive, RM == RC offset
    # KC notices earlier than RC for the same delivery month
    assert calc_fnd("KCK26") < calc_fnd("RCK26")


def test_calc_fnd_rejects_bad_symbols():
    assert calc_fnd("KC") is None
    assert calc_fnd("ZZ99") is None
    assert calc_fnd("") is None


def test_trading_days_to_signed_and_zero():
    assert trading_days_to(date(2026, 1, 5), date(2026, 1, 12)) == -5   # Mon→next Mon
    assert trading_days_to(date(2026, 1, 12), date(2026, 1, 5)) == 0    # d1 >= fnd


# ── Holidays inside the count move the date — the reason this module exists ──
# Mirrors frontend/lib/__tests__/fnd.test.ts exactly; the two must agree.

def test_kcz26_lands_on_19_nov_not_20_thanksgiving_inside_the_count():
    assert calc_fnd("KCZ26") == date(2026, 11, 19)


def test_rmf26_lands_on_24_dec_not_26_christmas_and_boxing_day_inside_the_count():
    assert calc_fnd("RMF26") == date(2025, 12, 24)


def test_rmu26_lands_on_25_aug_not_26_summer_bank_holiday_inside_the_count():
    assert calc_fnd("RMU26") == date(2026, 8, 25)


def test_a_count_with_no_holiday_matches_weekend_maths():
    assert calc_fnd("KCU26") == date(2026, 8, 21)


def test_market_for():
    from contract_dates import market_for
    assert market_for("KCZ26") == "us"
    assert market_for("RMU26") == "eu"
    assert market_for("RCU26") == "eu"
    assert market_for("nope") is None


def test_trading_days_skip_the_contracts_own_holidays():
    # Mon 23 Nov → Tue 1 Dec 2026 is 6 US trading days (Thanksgiving skipped), 7 EU.
    assert trading_days_to(date(2026, 11, 23), date(2026, 12, 1), "us") == -5
    assert trading_days_to(date(2026, 11, 23), date(2026, 12, 1), "eu") == -6


# ── Ground truth: ICE's own expiry table ─────────────────────────────────────
# Read from ice.com on 2026-09-03 by probe 0.30 (product 15 = Coffee "C",
# 37089079 = Robusta). The exchange's published First Notice Days, not a
# derivation. Mirrors frontend/lib/__tests__/fnd.test.ts.
ICE_PUBLISHED_FND = {
    "KCU26": "2026-08-21", "KCZ26": "2026-11-19", "KCH27": "2027-02-18", "KCK27": "2027-04-22",
    "KCN27": "2027-06-22", "KCU27": "2027-08-23", "KCZ27": "2027-11-19", "KCH28": "2028-02-18",
    "RMU26": "2026-08-25", "RMX26": "2026-10-27", "RMF27": "2026-12-24", "RMH27": "2027-02-23",
    "RMK27": "2027-04-27", "RMN27": "2027-06-25", "RMU27": "2027-08-25", "RMX27": "2027-10-26",
    "RMF28": "2027-12-28", "RMH28": "2028-02-24",
}


def test_matches_ice_published_expiry_table():
    bad = {s: str(calc_fnd(s)) for s, d in ICE_PUBLISHED_FND.items() if str(calc_fnd(s)) != d}
    assert not bad, f"disagree with ICE: {bad}"
