"""check_live_quotes.py — the live-quotes watchdog, with a memory.

Reads `live_quotes` from Upstash, decides what this observation means given the
source's recent history (see source_health), and acts: dispatch a rescue poll,
alert, or stay quiet. The decision logic is pure and unit-tested next door; this
file is only the I/O around it.

Replaces ~70 lines of inline shell in check-live-quotes.yml. That shell could
not be tested, and its two defects were invisible in it: it exited 1 on every
stale check (so an outage produced one red run per hour, all describing one
event) and it wrapped the rescue dispatch in `if curl -sf`, so losing the
`actions:write` scope stopped the self-heal SILENTLY while the check kept
reporting success.

Env:
    UPSTASH_REDIS_REST_URL / _TOKEN   required; absent = skip (opt-in workflow)
    TELEGRAM_BOT_TOKEN / _CHAT_ID     optional; absent = log only
    GITHUB_TOKEN, GITHUB_REPOSITORY   required to dispatch the rescue
    STALE_HOURS                       default 2
"""
from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime

import requests
from backend.scraper import source_health as H

HEALTH_KEY = "live_quotes_health"
QUOTES_KEY = "live_quotes"
RESCUE_WORKFLOW = "poll-acaphe-quotes.yml"
TIMEOUT = 20


# ── Upstash ─────────────────────────────────────────────────────────────────
def _redis(base: str, token: str, *path: str) -> object:
    url = f"{base.rstrip('/')}/" + "/".join(path)
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json().get("result")


def _redis_set(base: str, token: str, key: str, value: dict) -> None:
    url = f"{base.rstrip('/')}/set/{key}"
    requests.post(url, headers={"Authorization": f"Bearer {token}"},
                  data=json.dumps(value), timeout=TIMEOUT).raise_for_status()


def _as_dict(raw: object) -> dict | None:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        try:
            v = json.loads(raw)
            return v if isinstance(v, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def staleness(payload: dict | None, stale_hours: float, now: datetime) -> tuple[bool, str]:
    """(is_stale, human reason). A missing payload counts as stale, not as an error."""
    if not payload:
        return True, "Upstash key live_quotes is empty (poller never wrote, or key evicted)"
    fetched = payload.get("fetched_at")
    if not fetched:
        return True, "fetched_at missing from payload (poller may be misconfigured)"
    try:
        ts = datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
    except ValueError:
        return True, f"fetched_at unparseable: {fetched!r}"
    age_h = (now - ts).total_seconds() / 3600
    if age_h > stale_hours:
        return True, f"live_quotes is {age_h:.1f}h old (threshold {stale_hours}h) — poller is down"
    return False, f"fresh ({age_h:.2f}h old)"


# ── side effects ────────────────────────────────────────────────────────────
def dispatch_rescue() -> bool:
    tok, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not tok or not repo:
        print("[live-quotes] no GITHUB_TOKEN/REPOSITORY — cannot dispatch rescue")
        return False
    try:
        r = requests.post(
            f"https://api.github.com/repos/{repo}/actions/workflows/{RESCUE_WORKFLOW}/dispatches",
            headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"},
            json={"ref": "main"}, timeout=TIMEOUT)
        if r.status_code >= 300:
            print(f"[live-quotes] rescue dispatch HTTP {r.status_code}: {r.text[:200]}")
            return False
        return True
    except requests.RequestException as e:                 # noqa: BLE001 — reported
        print(f"[live-quotes] rescue dispatch failed: {type(e).__name__}: {e}")
        return False


ICON = {"detected": "🟡", "escalation": "🚨", "recovered": "✅", "rescue_failed": "🛑"}


def notify(kind: str, reason: str) -> None:
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    run = (f"https://github.com/{os.environ.get('GITHUB_REPOSITORY','')}"
           f"/actions/runs/{os.environ.get('GITHUB_RUN_ID','')}")
    text = f"{ICON.get(kind, 'ℹ️')} Live quotes — {reason} — {run}"
    print(f"[live-quotes] alert: {text}")
    if not tok or not chat:
        return
    try:
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      data={"chat_id": chat, "text": text}, timeout=TIMEOUT)
    except requests.RequestException as e:                 # noqa: BLE001 — best effort
        print(f"[live-quotes] telegram send failed: {type(e).__name__}: {e}")


def main() -> int:
    base = os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if not base or not token:
        print("::warning::Upstash credentials not configured — skipping freshness check.")
        return 0

    now = datetime.now(UTC)
    stale_hours = float(os.environ.get("STALE_HOURS", "2"))

    try:
        quotes = _as_dict(_redis(base, token, "get", QUOTES_KEY))
        state = _as_dict(_redis(base, token, "get", HEALTH_KEY)) or H.initial_state()
    except requests.RequestException as e:                 # noqa: BLE001
        # The store itself being unreachable IS a system failure, and it is not
        # the source's fault — no backoff applies, and no state can be saved.
        print(f"::error::Upstash unreachable: {type(e).__name__}: {e}")
        notify("escalation", f"the health store itself is unreachable ({type(e).__name__})")
        return 1

    stale, reason = staleness(quotes, stale_hours, now)
    print(f"[live-quotes] {reason}")

    d = H.decide(state, stale=stale, now_iso=now.isoformat(), stale_reason=reason)

    if d.rescue and not dispatch_rescue():
        d = H.rescue_dispatch_failed(d, reason)

    if d.alert:
        notify(d.kind, d.reason)

    try:
        _redis_set(base, token, HEALTH_KEY, d.state)
    except requests.RequestException as e:                 # noqa: BLE001
        # Losing the write is not worth failing the run over — the next check
        # re-detects and restarts the ladder, which load_state is built for.
        print(f"::warning::could not persist health state: {type(e).__name__}: {e}")

    line = H.summarise(d)
    print(f"[live-quotes] {line}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"## Live quotes watchdog\n\n```\n{line}\n```\n")
    if d.exit_code:
        print(f"::error::{d.reason}")
    return d.exit_code


if __name__ == "__main__":
    sys.exit(main())
