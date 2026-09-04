"""source_health.py — degraded state and backoff for the live-quotes watchdog.

The problem this replaces, measured in the failure study: `check-live-quotes`
did two things in one breath when it found the quote feed stale — it dispatched
a rescue poll AND exited 1 — while holding no state between runs. One hour of an
upstream outage therefore produced a failed check, a rescue run and an alert;
the next hour, having forgotten everything, produced exactly the same three. On
a twelve-hour outage that is 12 red runs and 12 identical alerts describing one
event, and no amount of retry tuning fixes it, because backoff is impossible
without memory.

Two ideas, and they are separate:

  1. ATTEMPTING A RECOVERY IS NOT A SYSTEM FAILURE. Detecting staleness,
     dispatching a rescue and standing down is the watchdog working. That run
     should be green. A run goes red when recovery has repeatedly FAILED —
     which is the thing a person actually needs to look at.

  2. THE SOURCE HAS A STATE, and it lives between runs. `degraded` is a fact the
     system holds, not one it rediscovers hourly.

Backoff schedules, all counted in consecutive stale checks (the checker is
hourly, so they read as hours):

    RESCUE_AT     1, 2, 4, 8, 16, 32   powers of two — a doubling retry
    ALERT_AT      1, 4, 12, 24, 48     first detection, then escalations
    RED_AT           4, 12, 24, 48     escalations only

So a twelve-hour outage yields 4 rescue attempts, 3 alerts and 2 red runs
instead of 12/12/12 — and each red run means "recovery has failed repeatedly",
which is a claim worth paging on.

One deliberate exception: if we DECIDED to rescue and the dispatch itself
failed, that is always loud. The old workflow wrapped the dispatch in
`if curl -sf`, so when the `actions:write` scope was lost the rescue silently
stopped firing while the check kept passing — a self-healing system that had
quietly stopped healing and still reported success.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Consecutive stale checks at which each thing happens.
RESCUE_AT = (1, 2, 4, 8, 16, 32, 64)
ALERT_AT = (1, 4, 12, 24, 48)
RED_AT = (4, 12, 24, 48)


def initial_state() -> dict:
    return {"status": "healthy", "consecutive_stale": 0,
            "first_stale_at": None, "rescue_attempts": 0,
            "last_rescue_at": None, "alerts_sent": 0}


def load_state(raw: object) -> dict:
    """Tolerate anything the store hands back.

    A missing, empty or corrupt key must read as HEALTHY, not as a crash: the
    watchdog losing its memory is not itself an incident, and a checker that
    dies on a bad state value is worse than one that starts counting again.
    """
    base = initial_state()
    if isinstance(raw, dict):
        for k in base:
            if k in raw:
                base[k] = raw[k]
    if not isinstance(base.get("consecutive_stale"), int) or base["consecutive_stale"] < 0:
        base["consecutive_stale"] = 0
    if base["status"] not in ("healthy", "degraded"):
        base["status"] = "healthy"
    return base


@dataclass
class Decision:
    """What to do about this check, and why."""
    rescue: bool = False
    alert: bool = False
    kind: str = ""              # detected | escalation | recovered | rescue_failed | ""
    exit_code: int = 0
    reason: str = ""
    state: dict = field(default_factory=initial_state)


def decide(state: dict, stale: bool, now_iso: str, stale_reason: str = "") -> Decision:
    """Fold this check's observation into the source's health state.

    `stale` is the observation; everything else follows from how long it has
    been true. Note a FRESH check after a degraded spell is itself worth one
    alert — an outage that silently ends leaves the reader unsure whether it
    ever did.
    """
    s = load_state(state)
    n = s["consecutive_stale"]

    if not stale:
        if s["status"] == "degraded":
            hours = n
            out = Decision(
                alert=True, kind="recovered", exit_code=0,
                reason=f"live_quotes is fresh again after {hours} stale check(s)",
                state=initial_state())
            return out
        return Decision(exit_code=0, reason="fresh", state=initial_state())

    n += 1
    s["consecutive_stale"] = n
    s["status"] = "degraded"
    if not s.get("first_stale_at"):
        s["first_stale_at"] = now_iso

    rescue = n in RESCUE_AT
    if rescue:
        s["rescue_attempts"] = int(s.get("rescue_attempts") or 0) + 1
        s["last_rescue_at"] = now_iso

    alert = n in ALERT_AT
    if alert:
        s["alerts_sent"] = int(s.get("alerts_sent") or 0) + 1

    red = n in RED_AT
    kind = "escalation" if red else ("detected" if alert else "")

    if red:
        reason = (f"{stale_reason or 'live_quotes stale'} — still degraded after {n} checks "
                  f"and {s['rescue_attempts']} rescue attempt(s); recovery is not working")
    elif alert:
        reason = (f"{stale_reason or 'live_quotes stale'} — rescue dispatched, "
                  f"backing off (check {n})")
    else:
        reason = f"still degraded (check {n}) — holding, no alert"

    return Decision(rescue=rescue, alert=alert, kind=kind,
                    exit_code=1 if red else 0, reason=reason, state=s)


def rescue_dispatch_failed(d: Decision, stale_reason: str = "") -> Decision:
    """Escalate a decision whose rescue could not be dispatched.

    Always loud, whatever the backoff said. A self-healing loop that has quietly
    stopped being able to heal — the lost `actions:write` scope — is exactly the
    failure the old `if curl -sf` guard hid, and it hid it while reporting
    success.
    """
    return Decision(
        rescue=d.rescue, alert=True, kind="rescue_failed", exit_code=1,
        reason=(f"{stale_reason or 'live_quotes stale'} — AND the rescue dispatch itself "
                f"failed. The self-heal path is broken (check actions:write scope)."),
        state=d.state)


def summarise(d: Decision) -> str:
    """One line for the job summary / log."""
    bits = [f"exit={d.exit_code}", f"stale_streak={d.state.get('consecutive_stale', 0)}",
            f"status={d.state.get('status')}"]
    if d.rescue:
        bits.append("rescue=dispatched")
    if d.alert:
        bits.append(f"alert={d.kind}")
    return " ".join(bits) + f" :: {d.reason}"
