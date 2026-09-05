"""Where everything lives. One place, so a moved file breaks one line."""
from __future__ import annotations

from pathlib import Path

SRC = Path(__file__).resolve().parent
STUDY = SRC.parent                      # backend/research/enso_arbitrage
ROOT = STUDY.parents[2]                 # repo root
BACKEND = ROOT / "backend"
PUB = ROOT / "frontend" / "public" / "data"
SEED = BACKEND / "seed"
REPO_DATA = ROOT / "data"

DATA = STUDY / "data"
RAW = DATA / "raw"
MANIFEST = DATA / "MANIFEST.json"
OUT = STUDY / "outputs"
OUT_TABLES = OUT / "tables"
OUT_CHARTS = OUT / "charts"
OUT_RESULTS = OUT / "results"

#: Slot for a user-supplied Vietnam farmgate history (see README). Columns:
#: date,price_vnd_per_kg. Absent → the study runs on the repo's 2021→ series.
VN_LOCAL_OVERRIDE = DATA / "vietnam_local_history.csv"


def ensure_out() -> None:
    for d in (OUT, OUT_TABLES, OUT_CHARTS, OUT_RESULTS):
        d.mkdir(parents=True, exist_ok=True)
