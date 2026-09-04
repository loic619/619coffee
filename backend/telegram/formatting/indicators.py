"""Direction and severity marks — the visual vocabulary, defined once."""
from __future__ import annotations

# Direction
UP    = "▲"
DOWN  = "▼"
FLAT  = "→"

# Severity, in descending order of "act on this now".
ALERT = "🔴"   # act on this
WARN  = "⚠️"   # a condition worth naming
WATCH = "🟠"   # developing, not yet actionable
INFO  = "🟡"   # context

_SEVERITY = {
    "alert": ALERT,
    "warn":  WATCH,   # the engines' WARN tier means "watch", not "danger"
    "info":  INFO,
}


def arrow(cur: float | None, prev: float | None) -> str:
    """Direction mark for cur vs prev. FLAT when either side is unknown, so a
    missing comparison never renders as a move that did not happen."""
    if cur is None or prev is None:
        return FLAT
    return UP if cur > prev else DOWN if cur < prev else FLAT


def severity(level: str) -> str:
    """Signal-engine tier ('alert' | 'warn' | 'info') → its mark."""
    return _SEVERITY.get(str(level).strip().lower(), INFO)
