from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta

from contract_dates import trading_days_to
from telegram.data import load
from telegram.sender import esc

# ── Constants ─────────────────────────────────────────────────────────────────

# Farmgate-to-FOB cost per origin (USD/tonne). Mirrors frontend/components/
# map/MarketTicker.tsx FOB_COST_USD — must stay in sync. Used so the basis
# line is at-port parity vs. the nearby futures contract.
_FOB_COST_USD: dict[str, int] = {
    "VN_FAQ":  100,   # Vietnam: ~$65 logistics + ~$35 exporter margin
    "CON_T7":  200,   # Brazil Conilon: logistics + quality upgrade to Class 1
    "UGA_S15": 265,   # Uganda: ~$228 Northern Corridor logistics + ~$37 margin
}

# Brazil frost-monitor window. Per user spec: "June to late August. From Sept
# it should focus on rain same as other countries." Inclusive on both ends.
_FROST_MONTHS = {6, 7, 8}

# Frost alert trigger: any monitored region whose 7-day forecast min temp
# drops to or below this threshold. 4°C is the operational rule-of-thumb
# coffee farmers use — leaves start showing damage around 3-4°C.
_FROST_TEMP_C = 4.0

# VHI severity threshold — NOAA STAR convention. Matches the same constant
# in backend/scripts/weather_news_emit.py.
_VHI_STRESS_THRESHOLD = 40.0


# ── Small helpers ─────────────────────────────────────────────────────────────

def _arrow(a, b) -> str:
    if a is None or b is None:
        return "?"
    return "▲" if a > b else "▼" if a < b else "→"


def _sign(n: float | int, fmt: str = ",.0f") -> str:
    if n is None:
        return ""
    if n == 0:
        return "0"
    return f"{n:+{fmt}}"


def _staleness_tag(data_date: str | date | datetime | None, today: date | None = None) -> str:
    """Return a short inline tag like " (2d old)" when `data_date` is more
    than one day behind `today`; empty string when fresh (today or yesterday).

    Used inline next to date-bearing section headers (Brazil daily reg, NY
    certified, London certified) so the reader sees at a glance when the
    figures aren't from yesterday's session. The threshold of >1 day matches
    the brief's "morning" cadence: it fires before today's data could
    realistically have settled, so yesterday's data is the expected case,
    not a staleness signal.

    Weekend / business-day awareness is intentionally NOT in scope here —
    a Monday brief showing Friday data IS technically 3d old; the tag fires
    truthfully and the operator (who knows Cecafé/ICE don't publish weekends)
    discounts mentally. Encoding weekend rules per-source here would just
    push the brittleness around.
    """
    if data_date is None:
        return ""
    # Parse into date if string/datetime
    if isinstance(data_date, str):
        s = data_date.strip()
        if not s:
            return ""
        try:
            # Accept YYYY-MM-DD or ISO datetime; strip time / tz if any.
            d = date.fromisoformat(s[:10])
        except ValueError:
            return ""
    elif isinstance(data_date, datetime):
        d = data_date.date()
    elif isinstance(data_date, date):
        d = data_date
    else:
        return ""
    if today is None:
        today = datetime.now(UTC).date()
    gap = (today - d).days
    if gap <= 1:
        return ""
    return f" <i>({gap}d old)</i>"


# ── Futures (RC + KC) — price + spread ────────────────────────────────────────

def _front_two(market_contracts: list[dict]) -> tuple[dict | None, dict | None]:
    """The liquid front contract + the next delivery (for the price line and the
    front-next calendar spread).

    The futures_chain ships contracts sorted by expiration, but the nearest one
    is NOT always the traded one: in the weeks before First Notice the market
    rolls forward, so the front month goes illiquid — a thin, stale-LOOKING last
    print on a handful of lots — while open interest has already moved to the next
    delivery. Taking contracts[0] then quotes the dying contract (e.g. RMN26 at
    3761 on 2 lots when the liquid RMU26 trades 3564), which reads as "stale" /
    "past" data even though the file is current.

    So the front is the genuinely liquid contract (max open interest, tie-broken
    by volume), and the second is the next contract after it by expiry."""
    cs = [c for c in (market_contracts or []) if c.get("last") is not None]
    if not cs:
        return None, None
    front = max(cs, key=lambda c: (c.get("oi") or 0, c.get("volume") or 0))
    try:
        idx = market_contracts.index(front)
    except ValueError:
        idx = 0
    second = next((c for c in market_contracts[idx + 1:] if c.get("last") is not None), None)
    return front, second


def _archive_two_recent_dates(archive: dict | None, market: str) -> tuple[str | None, str | None]:
    """Return (today, prior) ISO dates from the per-contract archive — used
    for spread daily-change. Falls back to (None, None) if the archive can't
    yield two distinct dates."""
    if not archive:
        return None, None
    by_date = archive.get(market) or {}
    if len(by_date) < 2:
        return None, None
    dates = sorted(by_date.keys(), reverse=True)
    return dates[0], dates[1]


def _spread_with_change(archive: dict | None, market: str,
                        front_sym: str | None, second_sym: str | None) -> tuple[float | None, float | None]:
    """Returns (today's front-second spread, day-over-day delta in spread).
    Uses the per-contract archive so we can read yesterday's settlement
    without needing a DB session. Returns floats so KC's 0.05-cent tick
    precision survives — caller rounds for display."""
    if not archive or not front_sym or not second_sym:
        return None, None
    today_d, prev_d = _archive_two_recent_dates(archive, market)
    if not today_d or not prev_d:
        return None, None
    today_cells = (archive[market] or {}).get(today_d, {})
    prev_cells  = (archive[market] or {}).get(prev_d, {})

    # Archive uses canonical RC* for robusta; futures_chain may use RM*.
    # Normalize the lookup so spread math survives the symbol convention.
    def _lookup(cells: dict, sym: str) -> float | None:
        for cand in (sym, sym.replace("RM", "RC", 1), sym.replace("RC", "RM", 1)):
            v = cells.get(cand)
            if v and v.get("price") is not None:
                return float(v["price"])
        return None

    cur_f  = _lookup(today_cells, front_sym)
    cur_s  = _lookup(today_cells, second_sym)
    prev_f = _lookup(prev_cells,  front_sym)
    prev_s = _lookup(prev_cells,  second_sym)
    if cur_f is None or cur_s is None:
        return None, None
    cur_spread = cur_f - cur_s
    if prev_f is None or prev_s is None:
        return cur_spread, None
    return cur_spread, cur_spread - (prev_f - prev_s)


def _contract_letter(sym: str) -> str:
    """RMN26 → N. Used so the spread line reads "N-U" instead of "RMN26-RMU26"."""
    m = re.search(r"^[A-Z]{2}([A-Z])\d{2}$", sym)
    return m.group(1) if m else "?"


def _rc_section(chain: dict | None, acaphe: dict | None, archive: dict | None) -> tuple[str, str | None, float | None, str | None]:
    """RC line with daily price change + N-U spread + spread daily change.
    Returns (line, front letter, front price, front symbol) so downstream
    basis lines can re-use the same front contract for yesterday's lookup."""
    if not chain:
        return "RC  data unavailable", None, None, None
    contracts = (chain.get("robusta") or {}).get("contracts") or []
    front, second = _front_two(contracts)
    if not front or front.get("last") is None:
        return "RC  data unavailable", None, None, None
    front_sym = front.get("symbol", "?")
    front_last = front["last"]
    letter = _contract_letter(front_sym)

    # Daily price change — from Barchart's settle delta (futures_chain.json
    # already carries `chg` per contract = today's settle - yesterday's settle).
    # That's the true closing-vs-closing tick. Acaphe was the previous source
    # but it's an intraday Vietnamese feed whose last poll fires at 19:45 UTC,
    # so a 03:09 UTC brief was reading a Thursday-late-afternoon snapshot
    # instead of Thursday's actual close. Acaphe stays as a fallback in case
    # Barchart hasn't published `chg` yet.
    change = front.get("chg")
    if change is None and acaphe:
        rob_live = acaphe.get("robusta") or []
        if rob_live:
            change = rob_live[0].get("change")
    arrow   = ("▲" if change and change > 0 else "▼" if change and change < 0 else "→") if change is not None else "→"
    delta_s = f"{arrow}{change:+,.0f}" if change is not None else arrow

    parts = [f"RC   {front_last:,.0f}  {delta_s}   ({front_sym})"]
    if second and second.get("symbol"):
        spread, spread_chg = _spread_with_change(archive, "robusta", front_sym, second["symbol"])
        if spread is not None:
            second_letter = _contract_letter(second["symbol"])
            # RC trades in whole-dollar/MT ticks → integer format is right here.
            chg_part = f" ({round(spread_chg):+,d})" if spread_chg is not None else ""
            parts.append(f"   · {letter}-{second_letter} spread at {round(spread):,}{chg_part}")
    return "\n".join(parts), letter, front_last, front_sym


def _kc_section(chain: dict | None, acaphe: dict | None, archive: dict | None) -> str:
    if not chain:
        return "KC  data unavailable"
    contracts = (chain.get("arabica") or {}).get("contracts") or []
    front, second = _front_two(contracts)
    if not front or front.get("last") is None:
        return "KC  data unavailable"
    front_sym = front.get("symbol", "?")
    front_last = front["last"]
    letter = _contract_letter(front_sym)

    # Daily price change — Barchart settle delta from futures_chain.json.
    # See _rc_section for the Acaphe-vs-Barchart timing rationale.
    change = front.get("chg")
    if change is None and acaphe:
        arab_live = acaphe.get("arabica") or []
        if arab_live:
            change = arab_live[0].get("change")
    arrow   = ("▲" if change and change > 0 else "▼" if change and change < 0 else "→") if change is not None else "→"
    delta_s = f"{arrow}{change:+.2f}" if change is not None else arrow

    parts = [f"KC   {front_last:.2f}  {delta_s}   ({front_sym})"]
    if second and second.get("symbol"):
        spread, spread_chg = _spread_with_change(archive, "arabica", front_sym, second["symbol"])
        if spread is not None:
            second_letter = _contract_letter(second["symbol"])
            # KC trades in 0.05-cent ticks, so spreads land on 2-decimal values
            # (e.g. 4.75, not 6). Use 2dp here and let RC keep integer formatting.
            chg_part = f" ({spread_chg:+,.2f})" if spread_chg is not None else ""
            parts.append(f"   · {letter}-{second_letter} spread at {spread:,.2f}{chg_part}")
    return "\n".join(parts)


# ── Physical cash lines (VN/BR/UG) with basis + day-over-day delta ───────────

def _last_two_prices(series: list[dict]) -> tuple[dict | None, dict | None]:
    """Latest then prior — series is in chronological order (date asc)."""
    if not series or len(series) < 1:
        return None, None
    latest = series[-1]
    prev = series[-2] if len(series) >= 2 else None
    return latest, prev


def _basis_for_date(price_local: float, currency_per_usd: float | None,
                    rc_price_usd_mt: float | None, fob_usd: int,
                    unit_to_usd_mt: float = 1000.0) -> int | None:
    """USD/MT basis vs front Robusta: (local→USD) + fob − futures.

    `unit_to_usd_mt` is the multiplier to get USD/MT from (local_price / fx).
    Default 1000 is for "VND per kg" and "USD per kg" patterns: divide by
    fx (local-per-USD) gives USD/kg, multiply by 1000 gives USD/MT.
    """
    if currency_per_usd is None or currency_per_usd == 0 or rc_price_usd_mt is None:
        return None
    usd_mt = price_local / currency_per_usd * unit_to_usd_mt
    return round(usd_mt + fob_usd - rc_price_usd_mt)


def _fx_close_on(fx_history: dict | None, pair: str, on_date: str) -> float | None:
    """Looks up the FX close for `on_date`; falls back to the most-recent
    close on or before that date if the exact day is missing (weekend / FX
    holiday)."""
    if not fx_history:
        return None
    pair_doc = (fx_history.get("pairs") or {}).get(pair) or {}
    history = pair_doc.get("history") or []
    best: float | None = None
    for row in history:
        d = row.get("date")
        if d and d <= on_date and row.get("close") is not None:
            best = float(row["close"])
    return best


_MONTH_LETTER_ORDER = {"F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
                       "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12}


def _sort_by_expiration(symbols: list[str]) -> list[str]:
    """Order contract symbols by chronological expiration (front first).
    A robusta archive row keyed by RCN26/RCU26/RCF27 sorts as N26 → U26 →
    F27, not the alphabetic F27 → N26 sort that picks the wrong front."""
    def _key(s: str):
        # Expecting [A-Z]{2}[A-Z]\d{2}; degrade gracefully otherwise.
        if len(s) < 5:
            return (9999, 99, s)
        letter = s[-3]
        try:
            yy = int(s[-2:])
        except ValueError:
            return (9999, 99, s)
        return (2000 + yy, _MONTH_LETTER_ORDER.get(letter, 99), s)
    return sorted(symbols, key=_key)


def _rc_price_on(archive: dict | None, on_date: str, front_sym: str | None = None) -> float | None:
    """Front Robusta settle on or before `on_date`. When `front_sym` is given
    we look up that specific contract (so yesterday's basis uses the same
    contract as today's basis); otherwise we pick the chronologically front
    contract from the archive row."""
    if not archive:
        return None
    rob = archive.get("robusta") or {}
    for d in sorted([d for d in rob.keys() if d <= on_date], reverse=True):
        cells = rob[d] or {}
        if front_sym:
            # Try the given symbol first, then both RM/RC conventions.
            for cand in (front_sym, front_sym.replace("RM", "RC", 1), front_sym.replace("RC", "RM", 1)):
                v = cells.get(cand)
                if v and v.get("price") is not None:
                    return float(v["price"])
        # Fallback: chronologically-front contract that has a price.
        for sym in _sort_by_expiration(list(cells.keys())):
            v = cells[sym]
            if v.get("price") is not None:
                return float(v["price"])
    return None


def _physical_line(label: str, origin_key: str, fob_key: str,
                   currency_label: str, history: list[dict],
                   fx_history: dict | None, fx_pair: str,
                   archive: dict | None, rc_price_today: float | None,
                   front_letter: str | None, front_sym: str | None = None,
                   *, unit_to_usd_mt: float = 1000.0) -> str:
    """One physical-price line: "VN FAQ  86,700 VND · N-64 (+5) FOB"

    `(+5)` is the day-over-day change in the at-port basis (today vs prior
    physical-price entry — typically yesterday, but tolerates weekend gaps),
    shown in parens so it visually separates from the basis itself.
    "FOB" tags the line as a loadable-on-vessel parity figure, not raw
    farmgate.
    """
    if not history or rc_price_today is None:
        return ""
    cur, prev = _last_two_prices(history)
    if not cur:
        return ""
    cur_date  = cur.get("date") or ""
    cur_price = cur.get("price")
    if cur_price is None:
        return ""
    fob = _FOB_COST_USD.get(fob_key, 0)
    fx_today = _fx_close_on(fx_history, fx_pair, cur_date) if fx_history else None
    # FX scrape lags the physical scrape on weekends; if no FX for the cur_date,
    # fall back to the most-recent FX. Without FX we still show the local price
    # but skip the basis math.
    if fx_today is None:
        return f"{label}  {cur_price:,.0f} {currency_label}"

    cur_basis = _basis_for_date(cur_price, fx_today, rc_price_today, fob, unit_to_usd_mt)
    if cur_basis is None:
        return f"{label}  {cur_price:,.0f} {currency_label}"

    letter = front_letter or "N"
    delta_part = ""
    if prev and prev.get("price") is not None and prev.get("date"):
        prev_date = prev["date"]
        fx_prev = _fx_close_on(fx_history, fx_pair, prev_date)
        rc_prev = _rc_price_on(archive, prev_date, front_sym)
        prev_basis = _basis_for_date(prev["price"], fx_prev, rc_prev, fob, unit_to_usd_mt)
        if prev_basis is not None:
            delta = cur_basis - prev_basis
            delta_part = f" ({_sign(delta, 'd')})"

    cur_local = f"{cur_price:,.0f} {currency_label}"
    return f"{label}  {cur_local} · {letter}{cur_basis:+d}{delta_part} FOB"


# ── Weather section ──────────────────────────────────────────────────────────

def _seed_weather_path(origin_key: str):
    """Locate backend/seed/weather_history/{origin}.json relative to the
    morning brief's data dir (which sits at frontend/public/data)."""
    from telegram.data import data_dir
    repo_root = data_dir().parent.parent.parent
    return repo_root / "backend" / "seed" / "weather_history" / f"{origin_key}.json"


def _load_seed_weather(origin_key: str) -> dict | None:
    import json as _json
    p = _seed_weather_path(origin_key)
    if not p.exists():
        return None
    try:
        return _json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _yesterday_avg(seed: dict | None, field: str, today: date) -> tuple[float | None, str | None]:
    """Average `field` (rain / tmean / …) across all regions on the most
    recent date ≤ today. Returns (value, date_used) so the brief can label
    the day correctly (the seed sometimes has today's data too — then
    "yesterday" is two days back). None when nothing usable is in scope."""
    if not seed:
        return None, None
    regions = seed.get("regions") or {}
    if not regions:
        return None, None
    target = (today - timedelta(days=1)).isoformat()
    values: list[float] = []
    for region_data in regions.values():
        if not isinstance(region_data, dict):
            continue
        v = region_data.get(target)
        if isinstance(v, dict) and isinstance(v.get(field), (int, float)):
            values.append(float(v[field]))
    if not values:
        return None, None
    return sum(values) / len(values), target


def _vn_weather_today_rain(vn_weather: dict | None, today: date) -> tuple[float | None, float | None]:
    """Returns (yesterday's mean rain mm across VN provinces, 10-yr average
    rain for the same calendar day). The "vs forecast" comparison the spec
    asked for is actually a "vs climatology" comparison — there's no stored
    forecast-snapshot history to diff against, but the 10-yr daily average
    gives the trader the same "wetter or drier than typical" signal."""
    seed = _load_seed_weather("vn")
    actual, _ = _yesterday_avg(seed, "rain", today)
    if actual is None:
        return None, None
    # 10-year average for the same day: walk the seed for the {month}-{day}
    # entry across recent years and average.
    regions = (seed or {}).get("regions") or {}
    md = (today - timedelta(days=1)).strftime("-%m-%d")
    historic: list[float] = []
    for region_data in regions.values():
        if not isinstance(region_data, dict):
            continue
        for d, v in region_data.items():
            if d.endswith(md) and isinstance(v, dict) and isinstance(v.get("rain"), (int, float)):
                if d != (today - timedelta(days=1)).isoformat():   # exclude the day we measured
                    historic.append(float(v["rain"]))
    avg = sum(historic) / len(historic) if historic else None
    return actual, avg


def _vn_mtd_rain(today: date) -> tuple[float | None, float | None]:
    """Month-to-date rain (sum from day 1 through yesterday) averaged across
    VN Central Highlands provinces, plus the 10-yr same-window average for
    a "wetter / drier than typical so far this month" reading.

    Both numbers are mean-across-regions, not summed — matches how the
    yesterday-rain line is computed so the two figures are directly
    comparable.
    """
    seed = _load_seed_weather("vn")
    if not seed:
        return None, None
    regions = (seed or {}).get("regions") or {}
    if not regions:
        return None, None
    yday = today - timedelta(days=1)
    first = yday.replace(day=1)
    region_totals: list[float] = []
    for region_data in regions.values():
        if not isinstance(region_data, dict):
            continue
        total = 0.0
        days_present = 0
        d = first
        while d <= yday:
            v = region_data.get(d.isoformat())
            if isinstance(v, dict) and isinstance(v.get("rain"), (int, float)):
                total += float(v["rain"])
                days_present += 1
            d += timedelta(days=1)
        if days_present:
            region_totals.append(total)
    if not region_totals:
        return None, None
    mtd_mean = sum(region_totals) / len(region_totals)

    # 10-yr average of the same first-of-month → same-day window across the
    # last 10 calendar years (excluding the current year so the comparison is
    # against history, not history-blended-with-today).
    year_totals: list[float] = []
    for back in range(1, 11):
        target_year = yday.year - back
        first_hist = first.replace(year=target_year)
        yday_hist = yday.replace(year=target_year)
        per_region: list[float] = []
        for region_data in regions.values():
            if not isinstance(region_data, dict):
                continue
            tot = 0.0
            days_present = 0
            d = first_hist
            while d <= yday_hist:
                v = region_data.get(d.isoformat())
                if isinstance(v, dict) and isinstance(v.get("rain"), (int, float)):
                    tot += float(v["rain"])
                    days_present += 1
                d += timedelta(days=1)
            if days_present:
                per_region.append(tot)
        if per_region:
            year_totals.append(sum(per_region) / len(per_region))
    avg10 = sum(year_totals) / len(year_totals) if year_totals else None
    return mtd_mean, avg10


def _vn_month_status(vn_weather: dict | None, today: date) -> str:
    """"ok" or "at risk" based on monthly_actual_cur vs monthly_dry_warn for
    the current month (averaged across Central Highlands provinces)."""
    if not vn_weather:
        return ""
    provs = vn_weather.get("provinces") or []
    if not provs:
        return ""
    idx = today.month - 1
    actuals: list[float] = []
    warns: list[float] = []
    for p in provs:
        ac = p.get("monthly_actual_cur") or []
        wn = p.get("monthly_dry_warn") or []
        if idx < len(ac) and ac[idx] is not None:
            actuals.append(float(ac[idx]))
        if idx < len(wn) and wn[idx] is not None:
            warns.append(float(wn[idx]))
    if not actuals or not warns:
        return ""
    return "at risk" if sum(actuals) / len(actuals) < sum(warns) / len(warns) else "ok"


def _vn_vhi(vn_vhi: dict | None) -> tuple[float | None, list[str]]:
    """Latest VHI averaged across VN provinces + names of provinces currently
    in stress (vhi < threshold). Stress names are surfaced in the brief so
    "vhi at xx" can flip to "vhi at xx (Dak Lak, Gia Lai stressed)"."""
    if not vn_vhi:
        return None, []
    provs = vn_vhi.get("provinces") or {}
    values: list[float] = []
    stressed: list[str] = []
    for name, payload in provs.items():
        latest = (payload or {}).get("vhi_latest") or {}
        v = latest.get("vhi")
        if isinstance(v, (int, float)):
            values.append(float(v))
            if v < _VHI_STRESS_THRESHOLD:
                stressed.append(name)
    avg = sum(values) / len(values) if values else None
    return avg, stressed


def _brazil_frost_alerts(today: date) -> tuple[list[str], date | None]:
    """Return (regions in frost-risk territory, date measured).

    Reads tmean from the last 3 days of backend/seed/weather_history/brazil.json
    (the only daily temp series we ship). Frost risk fires when any monitored
    region's tmean fell to or below 10°C — a Brazilian highland diurnal range
    of ~6-8°C between tmean and tmin means a 10°C tmean corresponds to a
    tmin in the 2-4°C frost zone.

    Looking back 3 days catches a cold front that already arrived even if
    the most-recent day had partial sun. The brief surfaces the worst-case
    region, not all of them.
    """
    seed = _load_seed_weather("brazil")
    if not seed:
        return [], None
    regions = seed.get("regions") or {}
    if not regions:
        return [], None
    # Front-line frost-vulnerable regions only — Espírito Santo is too low-
    # altitude to get frost.
    targets = {"Sul de Minas", "Cerrado", "Paraná"}
    worst: list[tuple[str, float, str]] = []
    for name, region_data in regions.items():
        if name not in targets or not isinstance(region_data, dict):
            continue
        for back in (1, 2, 3):
            d_iso = (today - timedelta(days=back)).isoformat()
            v = region_data.get(d_iso)
            if isinstance(v, dict) and isinstance(v.get("tmean"), (int, float)):
                tmean = float(v["tmean"])
                # _FROST_TEMP_C is the tmin threshold; the tmean equivalent is
                # roughly tmin + diurnal_range/2, conservatively +6°C.
                if tmean <= _FROST_TEMP_C + 6.0:
                    worst.append((name, tmean, d_iso))
                    break
    alerts = sorted(set(name for name, _, _ in worst))
    most_recent = max((d for _, _, d in worst), default=None)
    return alerts, date.fromisoformat(most_recent) if most_recent else None


def _brazil_rain_status(brazil_weather: dict | None, today: date) -> str:
    """Post-frost-season rain check, same logic as Vietnam."""
    return _vn_month_status(brazil_weather, today)


def _weather_block(today: date) -> str | None:
    br_weather = load("brazil_weather.json")
    vn_weather = load("vn_weather.json")
    vn_vhi     = load("vhi_vn.json")

    lines = ["☁️ <b>Weather</b>"]

    # Brazil: frost vs rain, depending on the month
    if today.month in _FROST_MONTHS:
        alerts, when = _brazil_frost_alerts(today)
        if alerts:
            names = ", ".join(esc(a) for a in alerts[:3])
            when_str = when.strftime("%d %b") if when else "recent obs"
            lines.append(f"Brazil: frost season — <b>ALERT</b> {names} ({when_str} tmean cold)")
        else:
            lines.append("Brazil: frost season — no cold-front signal in recent observations")
    else:
        rain_status = _brazil_rain_status(br_weather, today)
        if rain_status:
            lines.append(f"Brazil: month rainfall {rain_status}")

    # Vietnam: rain yesterday + MTD with 10y-avg comparison + month status + VHI
    vn_actual, _ = _vn_weather_today_rain(vn_weather, today)
    if vn_actual is not None:
        vn_rain_part = f"Vietnam: {vn_actual:.1f}mm rain yesterday"
        mtd, mtd_avg = _vn_mtd_rain(today)
        if mtd is not None and mtd_avg is not None:
            diff = mtd - mtd_avg
            vn_rain_part += f" (month to day at {mtd:.0f}mm, {_sign(diff, '.0f')}mm vs 10y avg)"
        elif mtd is not None:
            vn_rain_part += f" (month to day at {mtd:.0f}mm)"
        status = _vn_month_status(vn_weather, today)
        if status:
            vn_rain_part += f", full month forecast {status}"
        lines.append(vn_rain_part)

    avg_vhi, stressed = _vn_vhi(vn_vhi)
    if avg_vhi is not None:
        flag = ""
        if avg_vhi < _VHI_STRESS_THRESHOLD:
            flag = " <b>ALERT</b>"
        elif stressed:
            flag = f" ({', '.join(esc(s) for s in stressed[:3])} stressed)"
        lines.append(f"VHI at {avg_vhi:.0f}{flag}")

    return "\n".join(lines) if len(lines) > 1 else None


# ── Exports section ──────────────────────────────────────────────────────────

def _brazil_daily_block(daily: dict | None) -> str:
    if not daily:
        return ""
    # cecafe_daily.json now nests categories under sources.embarques (shipments)
    # — fall back to top-level keys for older snapshots.
    daily = (daily.get("sources") or {}).get("embarques") or daily
    section = daily.get("arabica") or {}
    if not section:
        return ""
    month = sorted(section.keys())[-1]
    days  = sorted(section[month].keys(), key=int)
    day   = days[-1]

    arab = section[month][day]
    con  = (daily.get("conillon") or {}).get(month, {}).get(day, 0)
    sol  = (daily.get("soluvel") or {}).get(month, {}).get(day, 0)
    total = arab + con + sol

    yr, mo = map(int, month.split("-"))
    mo -= 1
    if mo == 0:
        mo, yr = 12, yr - 1
    pm = f"{yr:04d}-{mo:02d}"
    day_int = int(day)

    def prior(key: str) -> int | None:
        s = (daily.get(key) or {}).get(pm) or {}
        avail = sorted(s.keys(), key=int)
        best = next((d for d in reversed(avail) if int(d) <= day_int), None)
        return s[best] if best else None

    p_arab = prior("arabica")
    p_con  = prior("conillon")
    p_sol  = prior("soluvel")

    data_date = f"{month}-{int(day):02d}"
    lines = [
        f"<b>Brazil daily reg</b> ({data_date}){_staleness_tag(data_date)}: {total:,} bags",
        "MoM:",
    ]
    for lbl, cur, prv in [("Arabica", arab, p_arab), ("Conilon", con, p_con), ("Soluble", sol, p_sol)]:
        if prv is not None:
            d = cur - prv
            lines.append(f"  {_arrow(cur, prv)}{_sign(d, ',d')} {lbl}")
        else:
            lines.append(f"  {lbl}: {cur:,}")
    return "\n".join(lines)


def _vn_monthly_export_block(vn_supply: dict | None, today: date) -> str:
    """Vietnam monthly export — show only when there's a release this month
    (matching exports.last_updated)."""
    if not vn_supply:
        return ""
    ex = vn_supply.get("exports") or {}
    monthly = ex.get("monthly") or []
    if not monthly:
        return ""
    latest = monthly[-1]
    last_month = latest.get("month")
    if last_month != ex.get("last_updated"):
        return ""
    # Only surface when the release is reasonably fresh — within the last 31
    # days from today so we don't shout about a 3-month-old release every day.
    try:
        y, m = map(int, last_month.split("-"))
        latest_d = date(y, m, 1)
    except (ValueError, AttributeError):
        return ""
    if (today - latest_d).days > 35:
        return ""
    bags_k = latest.get("total_k_bags") or 0
    tons = round(bags_k * 1000 * 60 / 1000)  # k-bags × 1000 × 60kg / 1000 = MT
    # YoY: same month one year prior.
    prev_month = f"{int(last_month.split('-')[0])-1}-{last_month.split('-')[1]}"
    prev = next((r for r in monthly if r.get("month") == prev_month), None)
    prev_tons = round((prev.get("total_k_bags") or 0) * 60) if prev else None
    if prev_tons:
        diff_pct = (tons - prev_tons) / prev_tons * 100
        return f"<b>Vietnam ({last_month})</b>: {tons:,} tons, {_sign(diff_pct, '.1f')}% vs last year"
    return f"<b>Vietnam ({last_month})</b>: {tons:,} tons"


def _uganda_monthly_export_block(ug_supply: dict | None, today: date) -> str:
    if not ug_supply:
        return ""
    ex = ug_supply.get("exports") or {}
    monthly = ex.get("monthly") or []
    if not monthly:
        return ""
    latest = monthly[-1]
    last_month = latest.get("month")
    if last_month != ex.get("last_updated"):
        return ""
    try:
        y, m = map(int, last_month.split("-"))
        latest_d = date(y, m, 1)
    except (ValueError, AttributeError):
        return ""
    if (today - latest_d).days > 35:
        return ""
    bags = latest.get("total_bags") or 0
    tons = round(bags * 60 / 1000)
    prev_month = f"{int(last_month.split('-')[0])-1}-{last_month.split('-')[1]}"
    prev = next((r for r in monthly if r.get("month") == prev_month), None)
    prev_tons = round((prev.get("total_bags") or 0) * 60 / 1000) if prev else None
    if prev_tons:
        diff_pct = (tons - prev_tons) / prev_tons * 100
        return f"<b>Uganda ({last_month})</b>: {tons:,} tons, {_sign(diff_pct, '.1f')}% vs last year"
    return f"<b>Uganda ({last_month})</b>: {tons:,} tons"


def _exports_block(daily: dict | None, vn_supply: dict | None,
                   ug_supply: dict | None, today: date) -> str | None:
    brazil = _brazil_daily_block(daily)
    vn     = _vn_monthly_export_block(vn_supply, today)
    ug     = _uganda_monthly_export_block(ug_supply, today)
    parts = [p for p in (brazil, vn, ug) if p]
    if not parts:
        return None
    return "🚢 <b>Exports</b>\n" + "\n\n".join(parts)


# ── Certified stocks ─────────────────────────────────────────────────────────

def _arabica_origin_top(snapshot: dict, n: int = 3) -> list[str]:
    """Top-n origins of the coffee that went through grading TODAY.

    Since June 2026 the ICE report carries a per-origin grading matrix
    (passed_by_origin / failed_by_origin), which is what "the origins that
    were graded" actually means. Before that only the standing stock
    composition was available, so fall back to sections.total_certified
    .by_origin — the origins already in the warehouses, which is a different
    question and only stands in when the real answer is not published.
    """
    graded: dict[str, int] = {}
    for key in ("passed_by_origin", "failed_by_origin"):
        for name, info in (snapshot.get(key) or {}).items():
            graded[name] = graded.get(name, 0) + ((info or {}).get("total") or 0)
    if not graded:
        sections = snapshot.get("sections") or {}
        by_origin = (sections.get("total_certified") or {}).get("by_origin") or {}
        graded = {name: ((info or {}).get("total") or 0) for name, info in by_origin.items()}
    pairs = sorted(graded.items(), key=lambda x: x[1], reverse=True)
    return [name for name, total in pairs[:n] if total]


def _port_decreases(prev_by_port: dict, cur_by_port: dict) -> list[tuple[str, int]]:
    """Every port that lost stock day-over-day, largest drop first.

    Neither exchange publishes decertification directly, so it is inferred
    from per-port stock falling. Reading only the single largest port
    understates it badly: on 42 of the last 59 arabica sessions MORE THAN ONE
    port dropped (2026-08-18: NOLA -750, but -2,126 across four ports), so
    the caller sums these rather than quoting the biggest.
    """
    if not prev_by_port or not cur_by_port:
        return []
    drops = [(p, (prev_by_port.get(p) or 0) - (cur_by_port.get(p) or 0)) for p in cur_by_port]
    return sorted([(p, d) for p, d in drops if d > 0], key=lambda t: -t[1])


def _decert_line(prev_by_port: dict | None, cur_by_port: dict | None, unit: str) -> str:
    """The decertified line, ALWAYS rendered.

    Omitting it on a quiet day made "nothing was decertified" look identical
    to "this exchange isn't tracked" — which is exactly how it read when New
    York was silent while London showed a figure. An explicit "none" answers
    the question instead of leaving it open.
    """
    drops = _port_decreases(prev_by_port or {}, cur_by_port or {})
    if not drops:
        return "· Decertified: none"
    total = sum(d for _, d in drops)
    top_port, top_mag = drops[0]
    if len(drops) == 1:
        return f"· Decertified: {total:,} {unit} in {top_port}"
    return (f"· Decertified: {total:,} {unit} across {len(drops)} ports "
            f"(most {top_port} {top_mag:,})")


def _cert_arabica_section(doc: dict | None) -> str:
    if not doc:
        return ""
    snaps = doc.get("snapshots") or []
    if not snaps:
        return ""
    cur = snaps[-1]
    prev = snaps[-2] if len(snaps) >= 2 else None
    # The xls publishes the two OUTCOMES of the day's grading; the number that
    # went through it is their sum. Reading passed_today_bags as "graded" made
    # the line report 320 graded and 1,280 passed on 2026-08-27 — more passed
    # than graded, which cannot happen.
    passed = cur.get("passed_today_bags") or 0
    failed = cur.get("failed_today_bags") or 0
    graded = passed + failed
    total  = cur.get("total_bags") or 0
    origins = _arabica_origin_top(cur)
    report_date = cur.get("report_date") or cur.get("date") or ""

    lines = [f"<b>New York</b>: {report_date}{_staleness_tag(report_date)}"]
    if graded:
        # Only list top origins when ACTUAL grading happened today — that's
        # when the origin attribution is meaningful (which countries supplied
        # the bags that were graded). On a no-grading day, the list is just
        # noise about what's already sitting in the warehouses.
        origin_str = f" · top origins {', '.join(origins)}" if origins else ""
        lines.append(f"· Grading: {graded:,} bags graded, {passed:,} passed, "
                     f"{failed:,} failed{origin_str}")
    else:
        lines.append("· Grading: none")

    if prev and prev.get("total_bags") is not None:
        delta = total - prev["total_bags"]
        lines.append(f"· Stocks: {total:,} bags ({_sign(delta, ',d')})")
    else:
        lines.append(f"· Stocks: {total:,} bags")

    lines.append(_decert_line(prev.get("by_port") if prev else {}, cur.get("by_port"), "bags"))
    return "\n".join(lines)


def _cert_robusta_section(doc: dict | None) -> str:
    if not doc:
        return ""
    snaps = doc.get("snapshots") or []
    if not snaps:
        return ""
    cur = snaps[-1]
    prev = snaps[-2] if len(snaps) >= 2 else None
    graded = cur.get("lots_graded_today") or 0
    total  = cur.get("total_lots_certified") or 0
    report_date = cur.get("cut_off_date") or cur.get("date") or ""

    lines = [
        f"<b>London</b>: {report_date}{_staleness_tag(report_date)}",
        f"· Grading: {graded:,} lots graded",
    ]
    if prev and prev.get("total_lots_certified") is not None:
        delta = total - prev["total_lots_certified"]
        lines.append(f"· Stocks: {total:,} lots ({_sign(delta, ',d')})")
    else:
        lines.append(f"· Stocks: {total:,} lots")
    lines.append(_decert_line(prev.get("by_port_lots") if prev else {}, cur.get("by_port_lots"), "lots"))
    return "\n".join(lines)


def _cert_stocks_block() -> str | None:
    arabica = load("certified_stocks_arabica.json")
    robusta = load("certified_stocks_robusta.json")
    ny = _cert_arabica_section(arabica)
    ld = _cert_robusta_section(robusta)
    parts = [p for p in (ny, ld) if p]
    if not parts:
        return None
    return "🪤 <b>Certified stocks</b>\n" + "\n\n".join(parts)


# ── Upcoming events (Coming up · next 24h) ───────────────────────────────────
# Display label per events.json category code. Kept compact ([XXX] prefix
# style) to match the brief's text-dense tone — no emoji decoration.
_EVENT_CATEGORY_LABEL = {
    "wasde":           "WASDE",
    "ico":             "ICO",
    "vietnam_customs": "VN",
    "cecafe":          "CECAFÉ",
    "fnd":             "FND",
    "central_bank":    "CB",
    "other":           "EVT",
}


def _k_lots(n: float) -> str:
    """31139 → '31.1k'; small numbers stay whole."""
    return f"{n / 1000:.1f}k" if abs(n) >= 1000 else f"{n:,.0f}"


def _front_fnd(market: str) -> tuple[str, date, int, int, list[int]] | None:
    """The contract heading into First Notice Day, from oi_fnd_chart.json:
    (letter, FND date, trading-days-to-FND of the newest reading, its open
    interest, prior contracts' OI at that same distance from their own FND).
    """
    rows = (load("oi_fnd_chart.json") or {}).get(market) or []
    if len(rows) < 2:
        return None
    cur = rows[-1]
    pts = [p for p in (cur.get("data") or []) if p.get("oi") is not None]
    if not pts:
        return None
    latest = max(pts, key=lambda p: p["day"])    # highest day = closest to FND
    try:
        fnd = date.fromisoformat(str(cur.get("fnd")))
    except ValueError:
        return None
    day = latest["day"]
    peers = [p["oi"] for prev in rows[:-1] for p in (prev.get("data") or [])
             if p.get("day") == day and p.get("oi") is not None]
    return (cur.get("label") or "?")[:1], fnd, day, latest["oi"], peers


# COT market key per futures chart market.
_COT_KEY = {"arabica": "ny", "robusta": "ldn"}


def _fnd_spec_line(market: str, today: date) -> str | None:
    """Speculative exposure sitting in the contract that is about to reach
    FND, and the daily pace needed to be out of it in time.

    Managed money cannot stand for delivery, so every one of those lots has
    to be offset or rolled before FND — the pace is what turns "OI is heavy"
    into "here is the flow that must happen, per session".

    ESTIMATE, and worth knowing how: the COT reports a market's total
    positions, not a per-contract split, so managed-money gross long/short is
    apportioned by the front contract's share of open interest. Two caveats
    ride on that — the COT totals are as of the report's Tuesday while the
    front-month OI is current, and specs concentrate in the liquid front
    months rather than spreading pro-rata, so this most likely UNDERstates
    the real front-month position.
    """
    front = _front_fnd(market)
    rows = load("cot.json")
    if front is None or not isinstance(rows, list) or not rows:
        return None
    _letter, fnd, _day, front_oi, _peers = front
    cot = (rows[-1].get(_COT_KEY.get(market, "")) or {})
    mm_long, mm_short, oi_total = cot.get("mm_long"), cot.get("mm_short"), cot.get("oi_total")
    if not oi_total or mm_long is None or mm_short is None:
        return None

    share = min(1.0, front_oi / oi_total)
    net = (mm_long - mm_short) * share
    side = "long" if net > 0 else "short" if net < 0 else "flat"
    sign = "+" if net > 0 else "-" if net < 0 else ""
    line = f"Est. spec net position of {sign}{_k_lots(abs(net))} {side}"

    sessions = -trading_days_to(today, fnd)      # trading_days_to is signed
    if sessions > 0 and net != 0:
        line += (f" → clear pace of {_k_lots(abs(net) / sessions)} "
                 f"per session ({sessions} left)")
    return "   · " + line


def _fnd_roll_line(market: str, today: date) -> str | None:
    """The front contract's run into First Notice Day: which letter, how long
    it has left, its open interest, and how that OI compares with the same
    point in earlier contracts' roll cycles.

    OI drains mechanically as FND approaches, so the raw number alone says
    nothing about whether this roll is heavy or light. The comparison is
    therefore like-for-like — every prior contract's OI at the SAME number of
    trading days from its own FND — expressed as a min–max position (0% = at
    the lightest of that history, 100% = at the heaviest), the same
    normalisation the COT coverage figures use.

    Returns None rather than a partial line when the chart data is missing or
    too thin to compare against (needs at least two prior contracts).
    """
    front = _front_fnd(market)
    if front is None:
        return None
    letter, fnd, day, oi, peers = front

    days_left = (fnd - today).days
    if days_left > 0:
        when = f"FND ({letter}) in {days_left}d"
        sessions = -trading_days_to(today, fnd)
        if sessions > 0:
            when += f" / {sessions} sessions"
    elif days_left == 0:
        when = f"FND ({letter}) today"
    else:
        when = f"FND ({letter}) passed"
    oi_bits = [f"OI {_k_lots(oi)}"]

    if len(peers) >= 2:
        lo, hi = min(peers), max(peers)
        if hi > lo:
            raw = (oi - lo) / (hi - lo) * 100
            pct = max(0.0, min(100.0, raw))
            # Breaking the envelope is the informative case — record-heavy or
            # record-light OI into this FND — so say so rather than let the
            # clamp read as a coincidental 0/100.
            edge = (" (above prior range)" if raw > 100 else
                    " (below prior range)" if raw < 0 else "")
            oi_bits.append(f"{pct:.0f}% min-max{edge}")
    return "   · " + when + "\n   · " + " · ".join(oi_bits)


def _upcoming_events_section(now: datetime | None = None) -> str | None:
    """Format the "Coming up · next 24h" block.

    Reads events.json (hand-curated + build_events_calendar.py output) and
    returns a block for events dated today or tomorrow (UTC day boundary —
    events are stored YYYY-MM-DD without timezone). Returns None when
    nothing's scheduled so the brief silently omits the section.
    """
    doc = load("events.json")
    if not isinstance(doc, dict):
        return None
    events = doc.get("events") or []
    if not events:
        return None

    today_d = (now or datetime.now(UTC)).date()
    tomorrow_d = today_d + timedelta(days=1)
    today_iso, tomorrow_iso = today_d.isoformat(), tomorrow_d.isoformat()

    upcoming = [
        e for e in events
        if isinstance(e, dict) and e.get("date") in (today_iso, tomorrow_iso)
    ]
    if not upcoming:
        return None

    upcoming.sort(key=lambda e: (e.get("date") or "", e.get("category") or ""))

    lines = ["🗓 <b>Coming up · next 24h</b>"]
    for e in upcoming:
        when = "Today   " if e["date"] == today_iso else "Tomorrow"
        cat = _EVENT_CATEGORY_LABEL.get(e.get("category") or "other", "EVT")
        title = esc((e.get("title") or "").strip())
        lines.append(f"  {when} · [{cat}] {title}")
    return "\n".join(lines)


# ── Main assembly ────────────────────────────────────────────────────────────

def _load_archive() -> dict | None:
    """contract_prices_archive.json lives at the repo root in production
    (data/contract_prices_archive.json, alongside oi_history.json). Fall
    back to DATA_DIR/contract_prices_archive.json so test fixtures can
    drop a tiny archive next to the other JSONs without recreating the
    repo-root layout."""
    import json as _json
    try:
        from telegram.data import data_dir
        _dd = data_dir()
        for candidate in (
            _dd.parent.parent.parent / "data" / "contract_prices_archive.json",
            _dd / "contract_prices_archive.json",
        ):
            if candidate.exists():
                return _json.loads(candidate.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _open_direction_block(today: date, placeholder: bool = True) -> str | None:
    """One-liner from the pre-open overnight-gap model (03:00 UTC run).

    The call is only valid FOR today's session. `placeholder` decides what a
    missing or stale payload renders:
      True  — an explicit "pending"/"not available" status line. Right for a
              COMBINED message (the /brief digest) that gets sent regardless:
              a silently absent prediction reads as "no view".
      False — None. Right for the STANDALONE open_call alert, where a return
              value is what triggers a Telegram send: nobody wants a daily
              push saying the prediction isn't ready.
    A stale call is never rendered as if it were today's, either way.
    """
    q = load("quant_report.json")
    od = (q or {}).get("open_direction") or {}
    p_up = od.get("prob_up")
    direction = od.get("direction")
    if not od.get("available"):
        return ("🔮 RC open call: <b>not available</b> (model produced no call for this session)"
                if placeholder else None)
    if od.get("for_session") != today.isoformat():
        if not placeholder:
            return None
        for_s = od.get("for_session") or "?"
        return (f"🔮 RC open call: <b>pending</b> — latest call is for {esc(str(for_s))}, "
                f"not today's session")
    if p_up is None or direction is None:
        return ("🔮 RC open call: <b>not available</b> (incomplete model output)"
                if placeholder else None)
    exp_usd = od.get("expected_gap_usd_mt")
    exp_s = (f" · exp. {'+' if exp_usd > 0 else ''}{exp_usd:,.0f}$/t"
             if isinstance(exp_usd, (int, float)) else "")
    if direction == "Abstain":
        head = f"🔮 RC open call: <b>Undefined</b> ({p_up * 100:.0f}% up — inside the ±10pp no-call band)"
    else:
        conf = p_up if direction == "Bullish" else 1 - p_up
        head = f"🔮 RC open call: <b>{direction}</b> {conf * 100:.0f}%{exp_s}"
    drivers = []
    for f in (od.get("features") or [])[:2]:
        usd = f.get("usd_per_ton")
        usd_s = f" ({'+' if usd > 0 else ''}{usd:,.0f}$/t)" if isinstance(usd, (int, float)) else ""
        drivers.append(f"{f.get('label')} {f.get('raw_fmt')}{usd_s}")
    if drivers:
        head += "\n     " + " · ".join(drivers)
    # Regime tags (decision support): the NY-shock setup is the model's
    # highest-conviction situation (88% historical hit-rate, n=42); harvest /
    # vol tags give the market context the numbers were made in.
    reg = od.get("regime") or {}
    if reg.get("ny_shock"):
        head += "\n     ⚡ NY-shock setup (|KC after-close| ≥0.8%) — historically 88% hit-rate"
    if reg.get("oil_shock") and reg.get("brent_overnight_pct") is not None:
        head += (f"\n     🛢 Brent {reg['brent_overnight_pct']:+.1f}% overnight — "
                 "oil-shock context (Brent led robusta opens in 2022-style regimes)")
    tags = []
    if reg.get("harvest_active"):
        tags.append("harvest window")
    if reg.get("vol_regime"):
        tags.append(f"{reg['vol_regime']}-vol tape")
    if tags and direction != "Abstain":
        head += f"\n     regime: {' · '.join(tags)}"
    # Drift alarm: the model monitors its own live record and says so when it
    # is running cold, instead of letting a decayed model keep calling quietly.
    track = od.get("track") or {}
    if track.get("cold_streak"):
        rate = track.get("rolling_hit_rate")
        n = track.get("rolling_n")
        head += (f"\n     ⚠️ <b>cold streak</b> — live hit-rate "
                 f"{rate * 100:.0f}% over last {n} calls; treat with caution")
    return head


def _currency_index_block() -> str | None:
    """Coffee Currency Index — the trade-weighted producer-vs-consumer FX
    basket from quant_report.json (same figures as the macro tab's CCI panel).

    Reading convention mirrors the app: the index rises when PRODUCER
    currencies strengthen against the USD, which is price-supportive (origin
    sellers need fewer USD per local unit), so ▲ = bullish, ▼ = bearish. The
    z-score says how stretched the level is against its own history.
    """
    ci = (load("quant_report.json") or {}).get("currency_index") or {}
    level = ci.get("index_value")
    if not isinstance(level, (int, float)):
        return None
    pct = ci.get("daily_delta_pct")
    z = ci.get("zscore")

    bits = [f"💱 <b>CCI</b> {level:.2f}"]
    if isinstance(pct, (int, float)):
        lean = "bullish" if pct > 0 else "bearish" if pct < 0 else "flat"
        bits.append(f"{'▲' if pct > 0 else '▼' if pct < 0 else '→'} {pct:+.2f}% d/d ({lean})")
    if isinstance(z, (int, float)):
        bits.append(f"z {z:+.2f}")
    line = " · ".join(bits)

    # The two currencies that actually moved the index today (by contribution,
    # i.e. weight × move) — the "why" behind the headline number.
    movers = [c for c in (ci.get("currencies") or [])
              if isinstance(c.get("contribution"), (int, float))
              and isinstance(c.get("daily_chg"), (int, float))]
    movers.sort(key=lambda c: abs(c["contribution"]), reverse=True)
    if movers:
        drivers = " · ".join(
            f"{esc(str(c.get('ticker', '?')).replace('=X', ''))} {c['daily_chg']:+.2f}%"
            for c in movers[:2]
        )
        line += f"\n     driven by {drivers}"
    return line


def build_brief_message(db=None) -> str:
    now = datetime.now(UTC)
    today = now.date()
    try:
        day_str = now.strftime("%a %-d %b")
    except ValueError:
        day_str = now.strftime("%a %d %b").lstrip("0").replace(" 0", " ")

    chain    = load("futures_chain.json")
    acaphe   = load("acaphe_live.json")
    archive  = _load_archive()
    daily    = load("cecafe_daily.json")
    vn_sup   = load("vietnam_supply.json")
    ug_sup   = load("uganda_supply.json")
    origin_prices = load("origin_prices_history.json")
    fx_hist  = load("fx_history.json")

    rc_line, front_letter, front_price, front_sym = _rc_section(chain, acaphe, archive)
    kc_line = _kc_section(chain, acaphe, archive)

    origins = (origin_prices or {}).get("origins") or {}
    vn_line = _physical_line(
        "VN FAQ", "vietnam", "VN_FAQ", "VND",
        (origins.get("vietnam") or {}).get("history") or [],
        fx_hist, "VND=X", archive, front_price, front_letter, front_sym,
        unit_to_usd_mt=1000.0,   # VND/kg → USD/kg × 1000 = USD/MT
    )
    br_line = _physical_line(
        "CON T7", "brazil_conilon", "CON_T7", "BRL",
        (origins.get("brazil_conilon") or {}).get("history") or [],
        fx_hist, "BRL=X", archive, front_price, front_letter, front_sym,
        unit_to_usd_mt=1000.0 / 60.0,   # BRL/saca-60kg → USD/(60kg) × 1000/60 = USD/MT
    )
    ug_line = _physical_line(
        "UGA S15", "uganda", "UGA_S15", "USD",
        (origins.get("uganda") or {}).get("history") or [],
        # Uganda is already quoted USD/cwt — no FX conversion → use a "1" pair.
        # We feed a synthetic fx-1 history by reusing the same date list.
        _synthetic_fx_one(origins.get("uganda")), "USD=1",
        archive, front_price, front_letter, front_sym,
        unit_to_usd_mt=1000.0 / 45.3592,  # USD/cwt → USD/MT (1 cwt = 45.3592 kg)
    )

    weather = _weather_block(today)
    exports = _exports_block(daily, vn_sup, ug_sup, today)
    certs   = _cert_stocks_block()
    coming  = _upcoming_events_section(now)

    parts: list[str] = [f"☕ <b>Coffee Intel · {day_str}</b>", ""]
    parts.append(rc_line)
    parts.append(kc_line)
    open_call = _open_direction_block(today)
    if open_call:
        parts.append(open_call)
    cci = _currency_index_block()
    if cci:
        parts.append(cci)
    # Blank line between futures (RC/KC + their spread lines) and the
    # physical block — visual break since the two groups read differently
    # (futures = on-exchange, physical = farmgate-to-FOB basis).
    if vn_line or br_line or ug_line:
        parts.append("")
    if vn_line:
        parts.append(vn_line)
    if br_line:
        parts.append(br_line)
    if ug_line:
        parts.append(ug_line)

    if weather:
        parts.append("")
        parts.append(weather)
    if exports:
        parts.append("")
        parts.append(exports)
    if certs:
        parts.append("")
        parts.append(certs)
    if coming:
        parts.append("")
        parts.append(coming)

    parts.append("")
    # Only commands DISPATCH actually registers. This line used to advertise
    # /stock, /certified, /vietnam, /uganda, /freight and /macro — six of the
    # nine fell through to "Unknown command." every morning.
    parts.append("/prices · /quote · /cot · /brazil · /ecf · /kaffeesteuer · /help")
    return "\n".join(parts)


def _synthetic_fx_one(origin_doc: dict | None) -> dict | None:
    """Build a fake fx_history where every close = 1.0, for origins already
    quoted in USD. Lets `_physical_line` keep one code path for FX-aware
    and USD-native origins."""
    if not origin_doc:
        return None
    hist = (origin_doc or {}).get("history") or []
    return {"pairs": {"USD=1": {"history": [
        {"date": r.get("date"), "close": 1.0} for r in hist if r.get("date")
    ]}}}


def handle(args: str, context: dict) -> str:
    return build_brief_message()
