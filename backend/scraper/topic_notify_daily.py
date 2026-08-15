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
    parts = [f"📈 <b>Futures — session {pub}</b>", rc_line]
    rc_roll = b._fnd_roll_line("robusta", today)
    if rc_roll:
        parts.append(rc_roll)
    parts.append(kc_line)
    kc_roll = b._fnd_roll_line("arabica", today)
    if kc_roll:
        parts.append(kc_roll)
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


def compose_week_ahead(now: dt.datetime) -> str | None:
    """Upcoming releases/events — the one brief section with no scraper of its
    own, kept as a small standalone note so retiring the brief loses nothing."""
    b = _brief()
    block = b._upcoming_events_section(now)
    return block or None


TOPICS = {
    "prices":        compose_prices,
    "origin_prices": compose_origin_prices,
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
    if already_sent(topic, text):
        print(f"[topic_daily] {topic}: unchanged since last send — skipping")
        return 0
    print(text)
    send(text)
    mark_sent(topic, text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
