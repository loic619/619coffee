"""Parse the committed raw external files into study series. Offline.

Every reader returns a monthly-PeriodIndex frame in USD per tonne and says
exactly which cells it read, so a column shift in a re-fetched file breaks
loudly here and nowhere else.
"""
from __future__ import annotations

import glob
import re
from pathlib import Path

import pandas as pd

from .paths import RAW

USD_PER_KG_TO_USD_T = 1000.0


def _pink_sheet_path() -> Path | None:
    """Prefer the current release (crawled) over the pinned Jan-2025 snapshot."""
    cands = sorted(glob.glob(str(RAW / "worldbank_pink_sheet_current" / "*.xlsx")))
    cands += sorted(glob.glob(str(RAW / "worldbank_pink_sheet_monthly" / "*.xlsx")))
    return Path(cands[0]) if cands else None


def pink_sheet() -> tuple[pd.DataFrame, dict]:
    """World Bank CMO 'Pink Sheet', sheet `Monthly Prices`.

    Columns read: `Coffee, Arabica` (ICO Other Milds indicator, ex-dock NY /
    Bremen-Hamburg, $/kg) and `Coffee, Robusta` (ICO Robustas indicator,
    ex-dock NY / Le Havre-Marseille, $/kg). Returned in USD/t as
    other_milds_usd_t, robustas_usd_t, plus the log premium. 1960-01 →.
    """
    path = _pink_sheet_path()
    if path is None:
        raise FileNotFoundError("no Pink Sheet under data/raw — run the fetch workflow")
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Monthly Prices"]
    rows = list(ws.iter_rows(values_only=True))
    hdr = next(i for i, r in enumerate(rows) if r and any(isinstance(c, str) and c.startswith("Coffee") for c in r))
    names = [str(c).strip() if c is not None else "" for c in rows[hdr]]
    units = [str(c).strip() if c is not None else "" for c in rows[hdr + 1]]
    ia = names.index("Coffee, Arabica")
    ir = names.index("Coffee, Robusta")
    assert units[ia] == "($/kg)" and units[ir] == "($/kg)", (units[ia], units[ir])
    data = {}
    for r in rows[hdr + 2:]:
        if not r or not isinstance(r[0], str) or not re.fullmatch(r"\d{4}M\d{2}", r[0]):
            continue
        per = pd.Period(r[0].replace("M", "-"), freq="M")
        a, b = r[ia], r[ir]
        data[per] = (float(a) if isinstance(a, int | float) else float("nan"),
                     float(b) if isinstance(b, int | float) else float("nan"))
    df = pd.DataFrame.from_dict(data, orient="index", columns=["other_milds_usd_kg", "robustas_usd_kg"]).sort_index()
    df["other_milds_usd_t"] = df["other_milds_usd_kg"] * USD_PER_KG_TO_USD_T
    df["robustas_usd_t"] = df["robustas_usd_kg"] * USD_PER_KG_TO_USD_T
    import numpy as np
    df["ind_arb_log"] = np.log(df["other_milds_usd_t"]) - np.log(df["robustas_usd_t"])
    df["ind_arb_usd"] = df["other_milds_usd_t"] - df["robustas_usd_t"]
    meta = {"file": str(path.relative_to(RAW.parent.parent)), "sheet": "Monthly Prices",
            "columns": {"arabica": names[ia], "robusta": names[ir]}, "units": "$/kg → USD/t",
            "first": str(df.index.min()), "last": str(df.dropna().index.max()), "n": int(df.dropna().shape[0])}
    return df[["other_milds_usd_t", "robustas_usd_t", "ind_arb_log", "ind_arb_usd"]], meta


def ico_futures_monthly() -> tuple[pd.DataFrame | None, dict]:
    """ICO monthly averages of the ICE New York and London futures, if the fetch
    landed them. Returns None (and a note) until it does — the study then runs
    Tier 1 on the indicator series and says so."""
    files = sorted(glob.glob(str(RAW / "ico_historical" / "*.xls*")))
    if not files:
        return None, {"status": "not retrieved", "note": "ICO historical-data pages linked no spreadsheet the crawl "
                                                        "could take; see data/raw/ico_historical/links_*.txt"}
    return None, {"status": "retrieved but no parser yet", "files": [Path(f).name for f in files]}
