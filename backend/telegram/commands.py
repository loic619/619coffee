from __future__ import annotations

from telegram.handlers import (
    brazil,
    brief,
    cot,
    ecf,
    exports,
    imports,
    kaffeesteuer,
    prices,
    quote,
    run,
)
from telegram.handlers import (
    help as help_handler,
)

DISPATCH: dict[str, object] = {
    "brief":        brief.handle,
    "cot":          cot.handle,
    "brazil":       brazil.handle,
    "ecf":          ecf.handle,
    "exports":      exports.handle,
    "imports":      imports.handle,
    "help":         help_handler.handle,
    "kaffeesteuer": kaffeesteuer.handle,
    "prices":       prices.handle,
    "quote":        quote.handle,
    "run":          run.handle,
}
