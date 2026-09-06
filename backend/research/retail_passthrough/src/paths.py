"""Where everything lives. One place, so a moved file breaks one line."""
from __future__ import annotations

from pathlib import Path

SRC = Path(__file__).resolve().parent
STUDY = SRC.parent                          # backend/research/retail_passthrough
ROOT = STUDY.parents[2]                     # repo root
BACKEND = ROOT / "backend"
PUB = ROOT / "frontend" / "public" / "data"

#: The green leg comes from the ENSO study's committed output — the same ICO
#: indicator series, already fetched, manifested and checksummed there. Reusing
#: it means one provenance record for one series rather than two copies that can
#: drift apart.
ENSO_RESULTS = BACKEND / "research" / "enso_arbitrage" / "outputs" / "results"

OUT = STUDY / "outputs"
OUT_TABLES = OUT / "tables"
OUT_CHARTS = OUT / "charts"
OUT_RESULTS = OUT / "results"


def ensure_out() -> None:
    for d in (OUT, OUT_TABLES, OUT_CHARTS, OUT_RESULTS):
        d.mkdir(parents=True, exist_ok=True)
