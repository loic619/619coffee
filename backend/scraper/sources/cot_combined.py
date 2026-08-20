# backend/scraper/sources/cot_combined.py
"""Futures-AND-OPTIONS combined COT ingestion for coffee (NY + LDN).

Why this exists
---------------
Every COT number this project already stores is futures-ONLY. The
optionization study says it outright: "CFTC fut_disagg (futures ONLY) for NY;
ICE London for RC — the options book is invisible to these cohort numbers."
So the positioning gauges could show a cohort's futures book but never the
options book sitting next to it.

Both exchanges publish a combined (futures + delta-equivalent options) variant
of the same disaggregated report, with an identical column schema:

  NY  — CFTC  com_disagg_txt_{year}.zip, market "COFFEE C - ICE FUTURES U.S."
  LDN — the SAME ICE file the futures scraper already downloads, under the
        market name "ICE Robusta Coffee Futures and Options - ICE Futures
        Europe" (the futures-only rows are "ICE Robusta Coffee Futures").

The options book is then simply combined − futures, per (category, side).
That subtraction happens at export time so futures stays the single source of
truth for its own numbers; this module only stores the combined report.

Sign note: combined figures are delta-adjusted, so an options leg can be
NEGATIVE (a delta-short call book pulls a cohort's combined long below its
futures long). Nothing here clamps it.
"""
import io
import sys
import zipfile

import pandas as pd

from scraper.sources.macro_cot import (
    _CFTC_DATE_COL,
    _CFTC_MARKET_COL,
    _CFTC_MM_LONG,
    _CFTC_MM_SHORT,
    _CFTC_MM_SPREAD,
    _COL_NR_LONG,
    _COL_NR_SHORT,
    _COL_OTHER_LONG,
    _COL_OTHER_SHORT,
    _COL_OTHER_SPREAD,
    _COL_PMPU_LONG,
    _COL_PMPU_SHORT,
    _COL_SWAP_LONG,
    _COL_SWAP_SHORT,
    _COL_SWAP_SPREAD,
    _match_market_rows,
    _row_int,
)
from scraper.utils.http import get_with_backoff

# Market names of the COMBINED report, per market. The futures-only names the
# rest of the pipeline uses live in COMMODITY_SPECS; these are their
# futures-and-options twins in the very same files.
COMBINED_FILTERS = {
    "ny":  "COFFEE C - ICE FUTURES U.S.",
    "ldn": "ICE Robusta Coffee Futures and Options - ICE Futures Europe",
}

# (category, side) → source column. Mirrors cot_schema._CATEGORIES_WITH_SPREAD:
# pmpu and nr have no spread column.
_FIELD_COLUMNS: dict[tuple[str, str], str] = {
    ("pmpu",  "long"):   _COL_PMPU_LONG,
    ("pmpu",  "short"):  _COL_PMPU_SHORT,
    ("swap",  "long"):   _COL_SWAP_LONG,
    ("swap",  "short"):  _COL_SWAP_SHORT,
    ("swap",  "spread"): _COL_SWAP_SPREAD,
    ("mm",    "long"):   _CFTC_MM_LONG,
    ("mm",    "short"):  _CFTC_MM_SHORT,
    ("mm",    "spread"): _CFTC_MM_SPREAD,
    ("other", "long"):   _COL_OTHER_LONG,
    ("other", "short"):  _COL_OTHER_SHORT,
    ("other", "spread"): _COL_OTHER_SPREAD,
    ("nr",    "long"):   _COL_NR_LONG,
    ("nr",    "short"):  _COL_NR_SHORT,
}


def download_cftc_combined_df(year: int) -> pd.DataFrame:
    """CFTC futures-AND-options disaggregated file for `year`.

    Same archive layout as the futures-only `fut_disagg_txt_{year}.zip` the
    macro scraper pulls — only the `com_` prefix differs.
    """
    url = f"https://www.cftc.gov/files/dea/history/com_disagg_txt_{year}.zip"
    resp = get_with_backoff(url, timeout=(10, 60))
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        name = [n for n in z.namelist() if n.endswith((".txt", ".csv"))][0]
        with z.open(name) as f:
            return pd.read_csv(f, low_memory=False)


def parse_combined(df: pd.DataFrame, market_filter: str,
                   weeks_back: int | None = None) -> dict:
    """{report_date: {(category, side): oi}} for one market, newest first.

    `weeks_back=None` parses every report row in the file (used for the
    multi-year backfill); an int keeps only that many most-recent weeks.
    """
    rows = _match_market_rows(df, _CFTC_MARKET_COL, market_filter)
    if rows.empty:
        print(f"[cot_combined] WARNING: no rows matched '{market_filter}'", file=sys.stderr)
        return {}
    rows = rows.copy()
    rows["_date_parsed"] = pd.to_datetime(rows[_CFTC_DATE_COL], format="%y%m%d", errors="coerce")
    rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
    if weeks_back is not None:
        rows = rows.head(weeks_back)

    out: dict = {}
    for _, row in rows.iterrows():
        out[row["_date_parsed"].date()] = {
            key: _row_int(row, col, None) for key, col in _FIELD_COLUMNS.items()
        }
    return out


def upsert_combined(db, market: str, report_date, fields: dict) -> None:
    """Insert/update one market-week of combined positions (narrow rows)."""
    from models import CotCombinedPosition
    try:
        for (category, side), oi in fields.items():
            existing = (db.query(CotCombinedPosition)
                          .filter_by(date=report_date, market=market,
                                     category=category, side=side)
                          .first())
            if existing:
                existing.oi = oi
            else:
                db.add(CotCombinedPosition(date=report_date, market=market,
                                           category=category, side=side, oi=oi))
        db.commit()
    except Exception:
        db.rollback()
        raise


def fetch_and_upsert(db, *, years: list[int], ice_df: pd.DataFrame | None = None,
                     weeks_back: int | None = None) -> int:
    """Ingest the combined report for `years`; returns market-weeks written.

    `ice_df` lets a caller that already downloaded the ICE file (the COT
    scraper does) pass it in rather than re-fetching. ICE publishes one file
    per year covering both variants, so it is only used for the latest year.
    """
    from scraper.db import create_cot_combined_table
    create_cot_combined_table()

    written = 0
    for year in sorted(set(years)):
        # ── NY (CFTC combined) ────────────────────────────────────────────
        try:
            cftc = download_cftc_combined_df(year)
            by_date = parse_combined(cftc, COMBINED_FILTERS["ny"], weeks_back)
            for d, fields in by_date.items():
                upsert_combined(db, "ny", d, fields)
            written += len(by_date)
            print(f"[cot_combined] ny {year}: {len(by_date)} weeks", file=sys.stderr)
        except Exception as e:
            print(f"[cot_combined] ny {year} failed: {e}", file=sys.stderr)

        # ── LDN (ICE combined rows, same file as futures-only) ────────────
        try:
            from scraper.sources.macro_cot import _download_ice_df
            df = ice_df if ice_df is not None else _download_ice_df(year)
            by_date = parse_combined(df, COMBINED_FILTERS["ldn"], weeks_back)
            for d, fields in by_date.items():
                upsert_combined(db, "ldn", d, fields)
            written += len(by_date)
            print(f"[cot_combined] ldn {year}: {len(by_date)} weeks", file=sys.stderr)
        except Exception as e:
            print(f"[cot_combined] ldn {year} failed: {e}", file=sys.stderr)
        ice_df = None   # a passed-in frame only covers its own year

    return written
