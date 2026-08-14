"""
morning_brief.py
Sends a daily Telegram morning brief. Message is built by telegram/handlers/brief.py.

Required env vars:
  TELEGRAM_BOT_TOKEN  — from @BotFather
  TELEGRAM_CHAT_ID    — your chat or group id
  DATABASE_URL        — postgres DSN (optional, unused now but kept for compat)

Optional env vars:
  DATA_DIR            — path to frontend/public/data (auto-detected from repo root)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import requests

# ── Path setup ─────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR  = Path(os.environ.get("DATA_DIR", str(_REPO_ROOT / "frontend" / "public" / "data")))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

# ── Send policy (freshness gate) ──────────────────────────────────────────────
# The brief must show the latest session's prices. It used to RACE the pipeline —
# the settle lands in futures_chain.json ~03:20 UTC, the brief fired ~03:21, and
# on the losing side it sent yesterday's file; the once-per-day idempotency guard
# then blocked the fresh re-fire. The gate below makes the brief send only inside
# a morning window AND once the data is actually the latest session, with a
# fallback so a holiday / stalled pipeline never leaves the brief unsent.
# Window opens at 03:00 (not 02:00): the pre-open RC call is produced by the
# 1.16 open-direction job at 03:00 UTC and the brief chains on its completion.
# Opening earlier let the 1.4-chained trigger (~02:55) burn the once-per-day
# send BEFORE the prediction existed. Pre-03:00 fires skip with exit 75 (not
# recorded as delivered), so the 1.16-chained fire still delivers.
_SEND_WINDOW_UTC  = (3, 9)    # only send between 03:00 and 09:00 UTC
_STALE_FALLBACK_H = 7         # if still stale by 07:00 UTC, send anyway (holiday / pipeline failure)
_SKIP_EXIT_CODE   = 75        # "skipped, not a failure — a later trigger will deliver it"


def _expected_session(now: datetime) -> date:
    """Most recent trading session the brief should already reflect: the latest
    weekday strictly before `now`'s UTC date (Fri covers Sat/Sun/Mon mornings)."""
    d = now.date() - timedelta(days=1)
    while d.weekday() >= 5:          # Sat=5, Sun=6 → roll back
        d -= timedelta(days=1)
    return d


def _futures_pub_date() -> date | None:
    """Session date carried by futures_chain.json (the price the brief quotes)."""
    fc = _load("futures_chain.json")
    if not isinstance(fc, dict):
        return None
    for mkt in ("robusta", "arabica"):
        pub = (fc.get(mkt) or {}).get("pub_date")
        if pub:
            try:
                return date.fromisoformat(str(pub)[:10])
            except ValueError:
                continue
    return None


def _send_decision(now: datetime) -> tuple[bool, str]:
    """(should_send, reason). Gate the brief to the morning window + fresh
    prices, with a fallback send once past _STALE_FALLBACK_H so it's never
    silently skipped on a holiday or a stalled pipeline.

    The brief deliberately does NOT wait for the open-direction call. That was
    tried on 2026-08-14 and rejected: GitHub fires the 1.16 cron 1.5-3h late,
    so waiting pushed the whole brief to ~05:00-06:00 UTC (~12:00-13:00 VN).
    The call is delivered by its own alert the moment 1.16 finishes instead —
    see backend/scraper/alerts/ — which keeps the brief early AND gets the
    call out as soon as it exists.
    """
    h = now.hour
    if not (_SEND_WINDOW_UTC[0] <= h < _SEND_WINDOW_UTC[1]):
        return False, f"outside send window {_SEND_WINDOW_UTC[0]:02d}-{_SEND_WINDOW_UTC[1]:02d} UTC (h={h})"
    pub, exp = _futures_pub_date(), _expected_session(now)
    if pub is not None and pub >= exp:
        return True, f"fresh (futures {pub} >= expected {exp})"
    if h >= _STALE_FALLBACK_H:
        return True, f"stale (futures {pub} < expected {exp}) but past {_STALE_FALLBACK_H:02d}:00 fallback — sending anyway"
    return False, f"stale (futures {pub} < expected {exp}) before {_STALE_FALLBACK_H:02d}:00 — waiting for fresh data"


# ── JSON loader (kept for backwards-compat with existing tests) ───────────────

def _load(filename: str) -> dict | list | None:
    path = _DATA_DIR / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Utility functions (kept for backwards-compat with existing tests) ─────────

def _pct_change(change: float | None, prev: float | None) -> float | None:
    if not isinstance(change, (int, float)) or not isinstance(prev, (int, float)) or prev == 0:
        return None
    return change / prev * 100


def _rain_cue(mtd: float, lo: float, hi: float) -> str:
    if mtd < lo:
        return "record-dry"
    if mtd > hi:
        return "record-wet"
    span = hi - lo
    if span <= 0:
        return "normal"
    frac = (mtd - lo) / span
    if frac <= 0.25:
        return "dry"
    if frac >= 0.75:
        return "wet"
    return "normal"


def _split_message(text: str, limit: int = 3900) -> list[str]:
    chunks: list[str] = []
    cur = ""

    def _flush() -> None:
        nonlocal cur
        if cur:
            chunks.append(cur)
            cur = ""

    for block in text.split("\n\n"):
        candidate = block if not cur else f"{cur}\n\n{block}"
        if len(candidate) <= limit:
            cur = candidate
            continue
        _flush()
        if len(block) <= limit:
            cur = block
            continue
        for line in block.split("\n"):
            cand2 = line if not cur else f"{cur}\n{line}"
            if len(cand2) <= limit:
                cur = cand2
            else:
                _flush()
                cur = line if len(line) <= limit else line[:limit]
                if len(line) > limit:
                    _flush()
    _flush()
    return chunks or [text[:limit]]


_SUPPLY_FILES = [
    ("farmer_economics", "Brazil"),
    ("vietnam_supply",   "Vietnam"),
    ("colombia_supply",  "Colombia"),
    ("honduras_supply",  "Honduras"),
    ("indonesia_supply", "Indonesia"),
    ("uganda_supply",    "Uganda"),
    ("ethiopia_supply",  "Ethiopia"),
]


def _weather_rows() -> list[dict]:
    rows: list[dict] = []
    for fname, country in _SUPPLY_FILES:
        data = _load(f"{fname}.json")
        weather = data.get("weather") if isinstance(data, dict) else None
        if not weather:
            continue
        for reg in weather.get("regions", []):
            mtd = reg.get("rain_mtd_mm")
            lo  = reg.get("rain_hist_min")
            hi  = reg.get("rain_hist_max")
            has_rain = all(isinstance(v, (int, float)) for v in (mtd, lo, hi))
            rows.append({
                "country": country,
                "name":    reg.get("name", "?"),
                "drought": reg.get("drought", "NONE"),
                "csi":     reg.get("csi_30d_level", "NONE"),
                "mtd":     mtd if has_rain else None,
                "lo":      lo  if has_rain else None,
                "hi":      hi  if has_rain else None,
                "cue":     _rain_cue(mtd, lo, hi) if has_rain else None,
            })
    return rows


def _supply_weather_section() -> str:
    # `esc` escapes scraped region names before they land in this HTML message
    # (imported lazily so this scraper module doesn't pull telegram at import).
    from telegram.sender import esc

    rows = _weather_rows()
    if not rows:
        return ""

    out = ["<b>━ SUPPLY & WEATHER</b>"]
    rain_rows = [r for r in rows if r["mtd"] is not None]

    if rain_rows:
        for r in rain_rows:
            tag_bits = []
            if r["drought"] == "HIGH":
                tag_bits.append("drought HIGH")
            if r["csi"] == "HIGH":
                tag_bits.append("CSI HIGH")
            tag = (" · " + ", ".join(tag_bits)) if tag_bits else ""
            out.append(
                f"  {r['country']}/{esc(r['name'])}: MTD {r['mtd']:.0f}mm · "
                f"hist {r['lo']:.0f}–{r['hi']:.0f} (this date) · {r['cue']}{tag}"
            )
    else:
        alerts = []
        for r in rows:
            if r["drought"] == "HIGH":
                alerts.append(f"  DROUGHT HIGH — {r['country']}/{esc(r['name'])}")
            if r["csi"] == "HIGH":
                alerts.append(f"  CSI HIGH — {r['country']}/{esc(r['name'])}")
        if len(out) == 1 and not alerts:
            return ""
        out.extend(alerts)

    return "\n".join(out)


# ── Message builder ───────────────────────────────────────────────────────────

def build_message(db=None) -> str:
    from telegram.handlers.brief import build_brief_message
    return build_brief_message(db)


def send_telegram(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[morning_brief] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    # Telegram rejects any sendMessage body over 4096 chars with HTTP 400, which
    # used to make an over-long brief fail silently. Split on paragraph/line
    # boundaries (well under the limit) and send the parts in order; the send
    # only counts as success if every chunk is delivered.
    chunks = _split_message(text)
    if len(chunks) > 1:
        print(f"[morning_brief] brief is {len(text)} chars — splitting into {len(chunks)} messages")
    ok = True
    for i, chunk in enumerate(chunks, 1):
        resp = requests.post(url, data={
            "chat_id":    TELEGRAM_CHAT_ID,
            "text":       chunk,
            "parse_mode": "HTML",
        }, timeout=15)
        if resp.ok:
            label = f"part {i}/{len(chunks)}" if len(chunks) > 1 else "message"
            print(f"[morning_brief] Telegram {label} sent OK")
        else:
            print(f"[morning_brief] Telegram error on part {i}/{len(chunks)}: "
                  f"{resp.status_code} {resp.text[:200]}")
            ok = False
    return ok


def main():
    # The brief reads only the published static JSON (no DB) and posts once, so
    # there's no DB connection and no heavy deps — just gate, build, and send.
    now = datetime.now(UTC)
    should_send, reason = _send_decision(now)
    print(f"[morning_brief] send decision @ {now:%Y-%m-%d %H:%M UTC}: "
          f"{'SEND' if should_send else 'SKIP'} — {reason}")
    if not should_send:
        # Exit non-zero so the workflow's once-per-day idempotency guard does NOT
        # record this run as a delivered brief — a later trigger (once the data
        # lands / the window opens) will send it.
        sys.exit(_SKIP_EXIT_CODE)
    msg = build_message()
    print("[morning_brief] Message preview:\n")
    print(msg.encode("ascii", "replace").decode())
    print()
    sys.exit(0 if send_telegram(msg) else 1)


if __name__ == "__main__":
    main()
