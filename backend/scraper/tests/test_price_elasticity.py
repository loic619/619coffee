# backend/scraper/tests/test_price_elasticity.py
"""Pass-through elasticity: the three ways this silently produces nonsense.

Each of these was a real defect in the first cut, and none of them announces
itself — the chart renders, the numbers look like numbers, and they are wrong.
"""
from datetime import date, timedelta

from scraper.exporters import price_elasticity as pe


def _futures(n: int, start: float = 3000.0, step: float = 10.0,
             contract: str = "RCX26") -> tuple[list[str], list[float], list[str]]:
    """n consecutive calendar days. Real dates — the window cutoff parses them."""
    d0 = date(2026, 1, 1)
    dates = [(d0 + timedelta(days=i)).isoformat() for i in range(n)]
    return dates, [start + step * i for i in range(n)], [contract] * n


# ── 1. publication lag ───────────────────────────────────────────────────────

def test_a_lagged_origin_is_read_against_the_session_it_actually_saw():
    """Vietnam's 09:00 ICT print reflects London's PREVIOUS close.

    Local moves here are a clean 50% of the futures move one session earlier.
    Read at lag 0 the relationship is invisible; at lag −1 it is exactly 50%.
    """
    # The path must be IRREGULAR: on a constant-step ramp every Δf is identical
    # and no lag shift can change the answer, so the test would pass vacuously.
    path = [3000, 3040, 3010, 3095, 3050, 3062, 3130, 3090, 3175, 3120, 3200, 3180]
    dates, _, contract = _futures(len(path))
    price = [float(p) for p in path]
    # local on day i mirrors the futures move of day i−1, at half size
    local = {dates[i]: 1000.0 + 0.5 * (price[i - 1] - price[0]) for i in range(1, len(path))}

    lagged = pe._observations(local, dates, price, contract, lag=-1)
    naive = pe._observations(local, dates, price, contract, lag=0)
    assert pe._beta([(df, dl) for _, df, dl in lagged]) == 0.5
    naive_beta = pe._beta([(df, dl) for _, df, dl in naive])
    assert abs(naive_beta - 0.5) > 0.2, (
        f"misaligned should destroy the relationship, got {naive_beta:.3f}")


# ── 2. sparse series ─────────────────────────────────────────────────────────

def test_a_weekly_origin_contributes_real_week_over_week_moves():
    """Differencing a carried-forward price is what made Guatemala read −27%.

    Four days in five would have Δlocal exactly zero, and the fifth would carry
    a week of movement against one day of futures. Print-to-print keeps the
    week's move matched to the week's futures move.
    """
    dates, price, contract = _futures(21)
    weekly = {dates[i]: 1000.0 + 0.8 * (price[i] - price[0]) for i in range(0, 21, 5)}
    obs = pe._observations(weekly, dates, price, contract, lag=0)
    assert len(obs) == 4, "one observation per consecutive pair of prints"
    assert pe._beta([(df, dl) for _, df, dl in obs] * 3) == 0.8


def test_no_observation_is_built_from_a_carried_forward_value():
    """Only dates the origin actually printed on may start or end a change."""
    dates, price, contract = _futures(12)
    local = {dates[0]: 1000.0, dates[6]: 1200.0}
    obs = pe._observations(local, dates, price, contract, lag=0)
    assert [o[0] for o in obs] == [dates[6]]


# ── 3. contract rolls ────────────────────────────────────────────────────────

def test_a_roll_gap_is_not_a_market_move():
    """The price steps by the calendar spread when the front contract changes.

    Counting that as a futures move injects a fake Δf with no matching Δl and
    drags the slope toward zero.
    """
    dates, price, contract = _futures(10)
    contract = ["RCX26"] * 5 + ["RCZ26"] * 5          # roll between index 4 and 5
    local = {d: 1000.0 + 0.5 * (price[i] - price[0]) for i, d in enumerate(dates)}
    obs = pe._observations(local, dates, price, contract, lag=0)
    spans = [o[0] for o in obs]
    assert dates[5] not in spans, "the pair spanning the roll must be dropped"
    assert len(obs) == 8


# ── the estimator itself ─────────────────────────────────────────────────────

def test_beta_refuses_a_window_with_too_little_futures_movement():
    """A near-flat denominator is what makes the naive ratio explode."""
    assert pe._beta([(0.0, 5.0)] * 40) is None
    assert pe._beta([(10.0, 5.0)] * (pe._MIN_PAIRS - 1)) is None
    assert pe._beta([(10.0, 5.0)] * pe._MIN_PAIRS) == 0.5


def test_leadership_is_never_called_from_a_single_origin():
    """'Leading' is a comparison; with one series there is nothing to compare."""
    cfg = {
        "label": "t", "futures_key": "robusta", "futures_unit": "usd_mt",
        "origins": {"solo": {"name": "Solo", "color": "#fff", "lag": 0,
                             "grades": ["solo"]}},
    }
    dates, price, _ = _futures(40)
    futures = {"robusta": [{"date": d, "price": p, "contract": "RCX26"}
                           for d, p in zip(dates, price)]}
    origins = {"solo": {"currency": "USD", "unit": "cents_lb",
                        "history": [{"date": d, "price": 100.0 + i}
                                    for i, d in enumerate(dates)]}}
    built = pe._build_market(cfg, futures, origins, {})
    assert built is not None
    assert all(r["leader"] is None for r in built["series"])
    assert built["leader_7d"] is None


def test_local_currency_is_converted_before_differencing():
    """A VND price rises when the dong weakens even if the coffee did not move.

    Left in local currency, that FX drift is read as pass-through.
    """
    dates, price, _ = _futures(30)
    futures = {"robusta": [{"date": d, "price": p, "contract": "RCX26"}
                           for d, p in zip(dates, price)]}
    # Flat in USD: the VND price rises exactly in step with the weakening dong.
    origins = {"vn": {"currency": "VND", "unit": "per_kg",
                      "history": [{"date": d, "price": 100.0 * (1 + 0.01 * i)}
                                  for i, d in enumerate(dates)]}}
    fx = {"VND=X": {"history": [{"date": d, "close": 25000.0 * (1 + 0.01 * i)}
                               for i, d in enumerate(dates)]}}
    cfg = {"label": "t", "futures_key": "robusta", "futures_unit": "usd_mt",
           "origins": {"vn": {"name": "VN", "color": "#fff", "lag": 0,
                              "grades": ["vn"]}}}
    built = pe._build_market(cfg, futures, origins, fx)
    betas = [r["elasticity"].get("vn") for r in built["series"]
             if "vn" in r["elasticity"]]
    assert betas, "expected some windows to produce a reading"
    assert all(abs(b) < 1.0 for b in betas), f"FX drift leaked into the beta: {betas[:5]}"
