"""/help — the command list, grouped by what you would open it for.

Descriptions live in one table here, but the LIST of commands is taken from
DISPATCH at render time. That is deliberate: the /brief footer used to carry a
hand-written list and drifted into advertising six commands that did not
exist. A described-but-unregistered command cannot appear here, and a
registered one that nobody described still shows up (with a placeholder) so it
cannot go missing silently.
"""
from __future__ import annotations

from telegram.formatting import header, title

# command → one-line description, in the order each group should read.
_GROUPS: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("📈", "market", [
        ("prices", "Live market snapshot"),
        ("quote",  "Build a robusta quotation"),
    ]),
    ("📊", "fundamentals", [
        ("brief",        "Morning market brief"),
        ("cot",          "COT positioning"),
        ("exports",      "Origin export volumes"),
        ("imports",      "Consumer imports"),
        ("brazil",       "Brazil daily registrations"),
        ("ecf",          "European port stocks"),
        ("kaffeesteuer", "German clearances"),
    ]),
    ("⚙️", "data", [
        ("run",  "Trigger a scraper"),
        ("help", "This message"),
    ]),
]

_EXAMPLES = [
    "/quote basis=+50",
    "/quote basis=-140 eudr bb",
    "/run prices",
]


def handle(args: str, context: dict) -> str:
    # Imported here, not at module scope: commands.py imports this module, so
    # a top-level import would be circular.
    from telegram.commands import DISPATCH

    described = {cmd for _, _, rows in _GROUPS for cmd, _ in rows}
    parts = [title("☕ COFFEE INTEL BOT", "what would you like to look at?")]

    for emoji, label, rows in _GROUPS:
        # Proportional, not a <pre> table: this list has no numbers to align,
        # and "/kaffeesteuer  German clearances" is 41 characters — inside a
        # <pre> that scrolls sideways on a phone instead of wrapping.
        live = [f"<b>/{cmd}</b> — {desc}" for cmd, desc in rows if cmd in DISPATCH]
        if live:
            parts += [header(emoji, label), "\n".join(live)]

    # A registered command nobody described — surfaced rather than dropped.
    undescribed = sorted(set(DISPATCH) - described)
    if undescribed:
        parts += [header("•", "also registered"),
                  "\n".join(f"<b>/{c}</b>" for c in undescribed)]

    parts += [header("💡", "examples"), "\n".join(_EXAMPLES),
              "Tip: /brief is the best starting point for the full picture."]
    return "\n\n".join(parts)
