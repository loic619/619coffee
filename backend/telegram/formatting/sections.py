"""Message scaffolding: title, section headers, footer."""
from __future__ import annotations

RULE = "━━━━━━━━━━━━━━━━"


def title(text: str, subtitle: str | None = None) -> str:
    """Message head. Bold, proportional — never inside a <pre>."""
    head = f"<b>{text}</b>"
    return f"{head}\n{subtitle}" if subtitle else head


def header(emoji: str, label: str) -> str:
    """A ruled section header:

        ━━━━━━━━━━━━━━━━
        📈 MARKET
        ━━━━━━━━━━━━━━━━
    """
    return f"{RULE}\n{emoji} <b>{label.upper()}</b>\n{RULE}"


def footer(commands: list[str]) -> str:
    """Command strip. Callers pass only registered commands — the brief's
    footer once advertised six that fell through to 'Unknown command.'"""
    return " · ".join(f"/{c.lstrip('/')}" for c in commands)
