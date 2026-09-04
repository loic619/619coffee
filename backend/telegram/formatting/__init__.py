"""Shared Telegram formatting primitives.

Every command's message is assembled from these, so a change to the visual
language happens in one place instead of across seven handlers.

The house style, in four layers, is the order a trader reads in:
    1. what is happening   — the headline snapshot
    2. what changed        — d/d, WoW, MoM, YoY movement
    3. what matters        — the signal or interpretation
    4. detail              — numbers to inspect, not to parse at a glance

One hard constraint shapes all of it: sender.py sends parse_mode="HTML", and
Telegram renders HTML in a PROPORTIONAL font. Padded columns only line up
inside <pre>, so anything tabular goes through tables.py; everything else
(headers, prose, signal lines) stays proportional and may use <b>. The two
are mutually exclusive — Telegram does not render <b> inside <pre>.
"""
from telegram.formatting.indicators import (  # noqa: F401
    ALERT,
    FLAT,
    INFO,
    WARN,
    WATCH,
    arrow,
    severity,
)
from telegram.formatting.numbers import (  # noqa: F401
    compare,
    delta,
    num,
    pct,
    signed,
)
from telegram.formatting.sections import (  # noqa: F401
    RULE,
    footer,
    header,
    title,
)
from telegram.formatting.tables import kv, pre, table  # noqa: F401
