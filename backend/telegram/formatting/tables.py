"""Monospace blocks — the only place columns actually line up.

Telegram renders parse_mode=HTML in a proportional font, so padded columns
in ordinary text do not align: '3,557' and '310.30' occupy different widths
and the whole column drifts. <pre> is the only element that gets a monospace
face, so every aligned table goes through here.

Two consequences the callers have to live with:
  * no <b> inside a block — Telegram does not render nested tags in <pre>;
  * a long row scrolls sideways on a narrow phone rather than wrapping, so
    keep tables to roughly 34 characters.
"""
from __future__ import annotations

import html
from collections.abc import Sequence

# A phone in portrait fits ~34 monospace characters before scrolling.
WIDTH_BUDGET = 34


def pre(text: str) -> str:
    """Wrap preformatted text, escaping it — Telegram parses entities inside
    <pre>, so an unescaped '&' or '<' breaks the whole sendMessage."""
    return f"<pre>{html.escape(text, quote=False)}</pre>"


def table(rows: Sequence[Sequence[object]], align: str = "", gap: int = 2) -> str:
    """Column-aligned <pre> block.

    `align` is one character per column — 'l' (default) or 'r'. Cells are
    str()'d; None renders as an em dash so a gap never reads as zero.

        table([["RC", "3,557", "▲2"]], align="lrr")

    Column widths use len() on the rendered string. That is exact for the
    ASCII digits and letters these tables carry; the arrows and flags are
    single code points and occupy one monospace cell.
    """
    if not rows:
        return ""
    grid = [["—" if c is None else str(c) for c in row] for row in rows]
    ncols = max(len(r) for r in grid)
    grid = [r + [""] * (ncols - len(r)) for r in grid]
    widths = [max(len(r[i]) for r in grid) for i in range(ncols)]

    out = []
    for row in grid:
        cells = []
        for i, cell in enumerate(row):
            a = align[i] if i < len(align) else "l"
            cells.append(cell.rjust(widths[i]) if a == "r" else cell.ljust(widths[i]))
        out.append((" " * gap).join(cells).rstrip())
    return pre("\n".join(out))


def kv(pairs: Sequence[tuple[str, object]], gap: int = 2) -> str:
    """Two-column label/value block — the common case of table()."""
    return table([[k, v] for k, v in pairs], align="lr", gap=gap)


def width_of(block: str) -> int:
    """Longest line in a rendered block, for checking the width budget."""
    body = block.replace("<pre>", "").replace("</pre>", "")
    return max((len(line) for line in body.splitlines()), default=0)
