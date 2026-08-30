"""
topic_notify_daily.py — the per-source daily Telegram texts.

These replace the monolithic morning brief (workflow 1.6, retired 2026-08-14).
Instead of one 03:45 digest that had to WAIT for every upstream job, each
source gets its own short text fired the moment its scraper commits — so the
prices text arrives with the prices, the open call arrives with the call, and
a slow job delays only its own message.

Composers here deliberately REUSE the brief's section builders
(telegram/handlers/brief.py), so the wording, formatting and edge cases are
the ones already in production — this is a re-cut of the brief, not a rewrite.

Idempotency: chained triggers fire whenever their workflow completes, which is
several times a day for some (1.4 Export-and-Publish runs 3-4×). Each text is
therefore fingerprinted and sent only when the FINGERPRINT CHANGES, i.e. when
the underlying numbers actually moved. State lives in
data/topic_notify_state.json, committed by the workflow that sent it.

CLI:  cd backend && PYTHONPATH=. python -m scraper.topic_notify_daily <topic>
Env:  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (absent → compose-and-print only)
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_STATE = _ROOT / "data" / "topic_notify_state.json"


# ── send-once-per-change state ───────────────────────────────────────────────

def _fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _load_state() -> dict:
    try:
        return json.loads(_STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def already_sent(topic: str, text: str) -> bool:
    """True when this exact text was the last one sent for the topic."""
    return _load_state().get(topic, {}).get("fingerprint") == _fingerprint(text)


def mark_sent(topic: str, text: str) -> None:
    state = _load_state()
    state[topic] = {
        "fingerprint": _fingerprint(text),
        "sent_at": dt.datetime.now(dt.UTC).isoformat(),
    }
    _STATE.parent.mkdir(parents=True, exist_ok=True)
    _STATE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")


# ── composers (thin wrappers over the brief's proven section builders) ───────
# Each returns the message text, or None when there is nothing to say.

def _brief():
    """Imported lazily: keeps this module importable (and testable) without
    pulling the telegram package in when only the state helpers are used."""
    from telegram.handlers import brief
    return brief


def compose_prices(now: dt.datetime) -> str | None:
    """RC + KC futures: price, daily change and the front-next calendar spread."""
    b = _brief()
    chain = b.load("futures_chain.json")
    if not chain:
        return None
    acaphe, archive = b.load("acaphe_live.json"), b._load_archive()
    rc_line, _letter, _px, _sym = b._rc_section(chain, acaphe, archive)
    kc_line = b._kc_section(chain, acaphe, archive)
    if "unavailable" in rc_line and "unavailable" in kc_line:
        return None
    pub = ((chain.get("robusta") or {}).get("pub_date")
           or (chain.get("arabica") or {}).get("pub_date") or "?")
    # Roll context under each market: front letter, days to FND, its OI and
    # where that OI sits against the same point of previous roll cycles.
    today = now.date()
    parts = [f"📈 <b>Futures — session {pub}</b>"]
    for line, market in ((rc_line, "robusta"), (kc_line, "arabica")):
        parts.append("")                       # blank line between blocks
        parts.append(line)
        for extra in (b._fnd_roll_line(market, today), b._fnd_spec_line(market, today)):
            if extra:
                parts.append(extra)
    return "\n".join(parts)


def compose_origin_prices(now: dt.datetime) -> str | None:
    """Origin farmgate/FOB quotes with their basis vs the nearby future."""
    b = _brief()
    chain = b.load("futures_chain.json")
    archive = b._load_archive()
    _rc, front_letter, front_price, front_sym = b._rc_section(
        chain, b.load("acaphe_live.json"), archive)
    origins = (b.load("origin_prices_history.json") or {}).get("origins") or {}
    fx_hist = b.load("fx_history.json")

    lines = [
        b._physical_line("VN FAQ", "vietnam", "VN_FAQ", "VND",
                         (origins.get("vietnam") or {}).get("history") or [],
                         fx_hist, "VND=X", archive, front_price, front_letter,
                         front_sym, unit_to_usd_mt=1000.0),
        b._physical_line("CON T7", "brazil_conilon", "CON_T7", "BRL",
                         (origins.get("brazil_conilon") or {}).get("history") or [],
                         fx_hist, "BRL=X", archive, front_price, front_letter,
                         front_sym, unit_to_usd_mt=1000.0 / 60.0),
        b._physical_line("UGA S15", "uganda", "UGA_S15", "USD",
                         (origins.get("uganda") or {}).get("history") or [],
                         b._synthetic_fx_one(origins.get("uganda")), "USD=1",
                         archive, front_price, front_letter, front_sym,
                         unit_to_usd_mt=1000.0 / 45.3592),
    ]
    body = "\n".join(l for l in lines if l)
    return f"🌍 <b>Origin prices</b>\n{body}" if body else None


def compose_certified(now: dt.datetime) -> str | None:
    # The builder already emits its own "🪤 Certified stocks" header.
    b = _brief()
    return b._cert_stocks_block() or None


def compose_brazil_daily(now: dt.datetime) -> str | None:
    """Cecafé daily registrations + the origin export pace."""
    b = _brief()
    # The builder already emits its own "🚢 Exports" header.
    return b._exports_block(b.load("cecafe_daily.json"),
                            b.load("vietnam_supply.json"),
                            b.load("uganda_supply.json"),
                            now.date()) or None


def compose_cci(now: dt.datetime) -> str | None:
    """Coffee Currency Index — the coffee-trade-weighted FX basket."""
    b = _brief()
    ci = (b.load("quant_report.json") or {}).get("currency_index") or {}
    val, dpct, z = ci.get("index_value"), ci.get("daily_delta_pct"), ci.get("zscore")
    if val is None:
        return None
    txt = f"💱 <b>Coffee Currency Index</b> {val:,.2f}"
    if isinstance(dpct, (int, float)):
        txt += f" ({dpct:+.2f}% d/d)"
    if isinstance(z, (int, float)):
        stretch = ("stretched strong" if z >= 1 else
                   "stretched weak" if z <= -1 else "near normal")
        txt += f"\n• z {z:+.2f} vs 1y — {stretch}"
    return txt


def compose_open_call(now: dt.datetime) -> str | None:
    """The pre-open RC direction call, the moment 1.16 publishes it.

    placeholder=False: as a standalone alert, "no call yet" must stay silent —
    returning text here is what fires a Telegram push.
    """
    b = _brief()
    return b._open_direction_block(now.date(), placeholder=False)


def compose_weather(now: dt.datetime) -> str | None:
    b = _brief()
    block = b._weather_block(now.date())
    return block or None


def _fmt_k(v: float) -> str:
    return f"{v / 1000:.1f}k" if abs(v) >= 1000 else f"{v:.0f}"


def _fmt_strike(k: float) -> str:
    return f"{k:g}"


def compose_options(now: dt.datetime) -> str | None:
    """Options report note — front board per market: OI + P/C, ΔOI with top
    movers, ITM vs max pain, ATM IV (d/d) and 25Δ risk reversal. Mirrors the
    Options tab; sent once per session (fingerprint dedup)."""
    b = _brief()
    doc = b.load("options_oi.json")
    markets = (doc or {}).get("markets") or {}
    hist = (doc or {}).get("history") or []
    session = None
    blocks: list[str] = []
    for mkt, label, unit in (("robusta", "RC", "$/MT"), ("arabica", "KC", "¢/lb")):
        contracts = (markets.get(mkt) or {}).get("contracts") or []
        if not contracts:
            continue
        c = contracts[0]                       # front expiry — same as the tab
        st = c.get("strikes") or []
        t = c.get("totals") or {}
        px = c.get("future_price")
        session = c.get("session_date") or session
        call_oi, put_oi = t.get("call_oi") or 0, t.get("put_oi") or 0
        tot = call_oi + put_oi
        if not tot:
            continue
        pc = put_oi / call_oi if call_oi else None
        itm = (t.get("itm_call_oi") or 0) + (t.get("itm_put_oi") or 0)
        # max pain: settlement minimising total intrinsic payout
        max_pain, best = None, float("inf")
        for k in st:
            pay = sum((s.get("call_oi") or 0) * max(k["strike"] - s["strike"], 0)
                      + (s.get("put_oi") or 0) * max(s["strike"] - k["strike"], 0)
                      for s in st)
            if pay < best:
                best, max_pain = pay, k["strike"]
        # ΔOI totals + top movers
        d_call = d_put = 0.0
        any_chg = False
        movers: list[tuple[float, float, float, str]] = []
        for s in st:
            for side, key in (("C", "call_chg"), ("P", "put_chg")):
                v = s.get(key)
                if v is None:
                    continue
                any_chg = True
                if side == "C":
                    d_call += v
                else:
                    d_put += v
                if v:
                    movers.append((abs(v), v, s["strike"], side))
        movers.sort(key=lambda x: -x[0])
        # ATM IV now/prev + underlying future OI from the session history
        entries = []
        for r in hist:
            raw = r.get(mkt)
            arr = raw if isinstance(raw, list) else [raw] if raw else []
            entries += [e for e in arr if e.get("underlying") == c.get("underlying")]
        ivs = [e["atm_iv"] for e in entries if e.get("atm_iv")]
        fut_oi = next((e["fut_oi"] for e in reversed(entries)
                       if e.get("fut_oi") is not None), None)
        # 25Δ risk reversal off the live board
        c25 = min((s for s in st if s.get("call_delta") is not None
                   and s.get("call_iv") is not None),
                  key=lambda s: abs(s["call_delta"] - 0.25), default=None)
        p25 = min((s for s in st if s.get("put_delta") is not None
                   and s.get("put_iv") is not None),
                  key=lambda s: abs(s["put_delta"] + 0.25), default=None)
        rr = (p25["put_iv"] - c25["call_iv"]) * 100 if c25 and p25 else None

        px_txt = (f"{px:,.0f}" if px and px >= 1000 else
                  f"{px:.2f}" if px is not None else "?")
        dte = c.get("days_to_expiry")
        lines = [f"<b>{label}</b> {c.get('underlying', '?')} · fut {px_txt} {unit}"
                 f" · exp {str(c.get('option_expiry') or '?')[5:10]}"
                 + (f" ({dte:.0f}d)" if dte is not None else "")]
        oi_line = f"· OI {_fmt_k(tot)} (C {_fmt_k(call_oi)} / P {_fmt_k(put_oi)}"
        if pc is not None:
            oi_line += f" · P/C {pc:.2f}"
        lines.append(oi_line + ")")
        if any_chg:
            chg = f"· ΔOI C {d_call:+,.0f} / P {d_put:+,.0f}"
            if movers:
                top = ", ".join(f"{v:+,.0f} {_fmt_strike(k)}{side}"
                                for _, v, k, side in movers[:3])
                chg += f" · top: {top}"
            else:
                chg += " · flat"
            lines.append(chg)
        itm_line = f"· ITM {100 * itm / tot:.0f}% ({_fmt_k(itm)} lots"
        if fut_oi:
            itm_line += f" vs fut OI {_fmt_k(fut_oi)}"
        itm_line += ")"
        if max_pain is not None:
            itm_line += f" · max pain {_fmt_strike(max_pain)}"
            if px:
                itm_line += f" ({(max_pain - px) / px * 100:+.1f}%)"
        lines.append(itm_line)
        vol_line = None
        if ivs:
            vol_line = f"· ATM IV {ivs[-1] * 100:.1f}%"
            if len(ivs) > 1:
                vol_line += f" ({(ivs[-1] - ivs[-2]) * 100:+.1f}pt d/d)"
        if rr is not None:
            vol_line = (vol_line or "·") + (
                f" · 25Δ RR {rr:+.1f}pt ({'puts' if rr > 0 else 'calls'} over)")
        if vol_line:
            lines.append(vol_line)
        blocks.append("\n".join(lines))
    if not blocks:
        return None
    head = session or str((doc or {}).get("updated") or "")[:10] or "?"
    return "\n\n".join([f"🎯 <b>Options — session {head}</b>"] + blocks)


def compose_week_ahead(now: dt.datetime) -> str | None:
    """Upcoming releases/events — the one brief section with no scraper of its
    own, kept as a small standalone note so retiring the brief loses nothing."""
    b = _brief()
    block = b._upcoming_events_section(now)
    return block or None


# A saca is 60 kg; 1 lb = 0.45359237 kg → 132.2774 lb per saca. Both B3 boards
# quote per saca, so the moves need restating in the units the desks actually
# trade against: cents/lb for arabica (vs KC) and USD/tonne for conilon (vs RC).
LB_PER_SACA = 60 / 0.45359237
SACAS_PER_TONNE = 1000 / 60


def _b3_last_date(doc: dict | None) -> str | None:
    hist = (doc or {}).get("history") or []
    return hist[-1].get("date") if hist else None


def _b3_line(doc: dict | None, label: str, sym: str,
             usd_per_brl: float | None = None,
             header_day: str | None = None) -> str | None:
    """One B3 market's close: front contract, price, and the day's move with
    that move restated in the market's reference unit.

    Arabica is already quoted in USD, so cents/lb is pure arithmetic. Conilon
    is in BRL, so USD/t needs the session's FX — without it the conversion is
    omitted rather than guessed.
    """
    hist = (doc or {}).get("history") or []
    if not hist:
        return None
    last = hist[-1]
    px = last.get("front_price")
    if px is None:
        return None
    prev = next((e.get("front_price") for e in reversed(hist[:-1])
                 if e.get("front_price") is not None), None)
    move = ""
    if prev:
        chg = px - prev
        arrow = "▲" if chg > 0 else "▼" if chg < 0 else "→"
        if sym == "US$":                      # USD/saca → US cents/lb
            conv = f" ({chg / LB_PER_SACA * 100:+.2f} ¢/lb)"
        elif usd_per_brl:                     # BRL/saca → USD/tonne
            conv = f" ({chg * SACAS_PER_TONNE / usd_per_brl:+,.0f} $/t)"
        else:
            conv = ""
        move = f" {arrow}{chg:+,.2f} ({chg / prev * 100:+.1f}%){conv}"
    # One header covers both markets, but the two files settle independently
    # and can end on different days. When this line is older than the header,
    # say so on the line itself — otherwise the reader sees a stale close
    # wearing a fresh date, which is worse than seeing no date at all. Observed
    # 2026-08-30: Friday's arabica close printed under a Sunday header.
    own = last.get("date")
    asof = f" <i>(as of {own})</i>" if header_day and own and own != header_day else ""
    return (f"• {label} {sym} {px:,.2f}/saca"
            f" ({last.get('front_month', '?')}){move}{asof}")


def compose_b3(now: dt.datetime) -> str | None:
    """B3 (Brazil) closing futures — Arábica 4/5 (ICF) and Conilon 7/8 (CNL).

    Domestic settlement against NY/London: the pair says how much of a move is
    Brazil-specific rather than global. The two files carry different units
    (arabica US$/saca, conilon R$/saca), so each line states its own.
    """
    b = _brief()
    ara, con = b.load("brazil_b3_arabica.json"), b.load("brazil_b3_conilon.json")
    day = _b3_key() or "?"
    # Conilon's USD/t conversion needs the session's rate, not today's.
    usd_per_brl = b._fx_close_on(b.load("fx_history.json"), "BRL=X", day)
    lines = [x for x in (_b3_line(ara, "Arábica 4/5 (ICF)", "US$", header_day=day),
                         _b3_line(con, "Conilon 7/8 (CNL)", "R$", usd_per_brl,
                                  header_day=day)) if x]
    if not lines:
        return None
    return f"🇧🇷 <b>B3 close — {day}</b>\n" + "\n".join(lines)


# ── what counts as "the same report" ─────────────────────────────────────────
# Fingerprinting the whole message assumes the text only changes when there is
# genuine news. That does not hold for the market topics: 1.4 re-exports 3-4×
# a day and acaphe/FX refresh intraday, so a cent of drift produced a fresh
# fingerprint and the same session's prices went out three times on 2026-08-19
# (21:11, 02:38, 02:40). These topics are therefore deduped on the IDENTITY of
# the report — the session or quote day they describe — so a recomputation of
# an already-sent session stays silent while a genuinely new one still fires.

def _session_key() -> str | None:
    """Trading session the futures message headlines."""
    chain = _brief().load("futures_chain.json") or {}
    return ((chain.get("robusta") or {}).get("pub_date")
            or (chain.get("arabica") or {}).get("pub_date"))


def _origin_quote_key() -> str | None:
    """Newest farmgate quote date across the origins the message prints."""
    origins = (_brief().load("origin_prices_history.json") or {}).get("origins") or {}
    dates = [(o.get("history") or [{}])[-1].get("date") for o in origins.values()]
    return max((d for d in dates if d), default=None)


def _b3_key() -> str | None:
    b = _brief()
    dates = [((b.load(f) or {}).get("history") or [{}])[-1].get("date")
             for f in ("brazil_b3_arabica.json", "brazil_b3_conilon.json")]
    return max((d for d in dates if d), default=None)


DEDUP_KEYS = {
    "prices":        _session_key,
    "origin_prices": _origin_quote_key,
    "b3":            _b3_key,
}


# Text that moves with the CLOCK rather than with the data. The brief's
# staleness tag (" (2d old)") is measured against today, so an unchanged
# report renders differently either side of midnight UTC — and fingerprinting
# the raw text reads that as news. It re-sent the certified stocks message on
# 2026-08-21 with byte-identical figures: the only diff was London gaining
# "(2d old)". Stripped from the dedup MARK only; the message the reader
# receives still carries the tag. Covers certified and brazil_daily, the two
# composers that embed it.
_VOLATILE_RE = re.compile(r"\s*<i>\(\d+d old\)</i>")


def _dedup_mark(topic: str, text: str) -> str:
    """The string whose change means "this is a new report". Falls back to the
    message text with clock-relative decorations normalised out, so a topic
    without an explicit key still re-sends only on real changes."""
    fn = DEDUP_KEYS.get(topic)
    if fn:
        try:
            key = fn()
        except Exception as e:  # noqa: BLE001 — never block a send on this
            print(f"[topic_daily] {topic}: dedup key failed ({e}) — using content")
            key = None
        if key:
            return f"{topic}@{key}"
    return _VOLATILE_RE.sub("", text)


TOPICS = {
    "prices":        compose_prices,
    "b3":            compose_b3,
    "origin_prices": compose_origin_prices,
    "options":       compose_options,
    "certified":     compose_certified,
    "brazil_daily":  compose_brazil_daily,
    "cci":           compose_cci,
    "open_call":     compose_open_call,
    "weather":       compose_weather,
    "week_ahead":    compose_week_ahead,
}


def send(text: str) -> None:
    import os

    import requests
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        print("[topic_daily] telegram not configured — printing only")
        return
    try:
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      data={"chat_id": chat, "text": text, "parse_mode": "HTML"},
                      timeout=20)
    except Exception as e:  # noqa: BLE001 — best-effort by design
        print(f"[topic_daily] send failed: {e}")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in TOPICS:
        print(f"usage: python -m scraper.topic_notify_daily <{'|'.join(TOPICS)}>")
        return 2
    topic = sys.argv[1]
    try:
        text = TOPICS[topic](dt.datetime.now(dt.UTC))
    except Exception as e:  # noqa: BLE001 — a broken composer must not fail the scraper
        print(f"[topic_daily] {topic}: compose failed — {e}")
        return 0
    if not text:
        print(f"[topic_daily] {topic}: nothing to report")
        return 0
    mark = _dedup_mark(topic, text)
    if already_sent(topic, mark):
        print(f"[topic_daily] {topic}: already reported — skipping")
        return 0
    print(text)
    send(text)
    mark_sent(topic, mark)
    return 0


if __name__ == "__main__":
    sys.exit(main())
