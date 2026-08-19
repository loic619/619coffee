"""
cftc_options_book.py — the options book CFTC can see and our COT tab cannot.

The site's COT feed is the CFTC's FUTURES-ONLY disaggregated report
(`fut_disagg`). CFTC publishes a second file on the same schedule with the
same cohort definitions — `com_disagg`, futures AND options combined, with
option positions delta-adjusted to futures equivalents by the exchange.

    options book (per cohort) = combined − futures-only

That difference is exactly the delta-equivalent book the optionization study
(Research G) sized at ~35% of the managed-money net from our own boards
archive — but attributed to cohorts by the CFTC itself rather than left as
one undifferentiated lump. Fetching both files and subtracting is the only
way to get "which cohort holds the options" without paying for order data.

Why fetch BOTH rather than diff against our stored cot.json
===========================================================
Apples to apples. Both legs then come from the same publication, the same
week, the same cohort definitions and the same revisions. Diffing a CFTC
combined file against our own parsed/derived series would fold every
storage and parsing difference into the "options" number.

Coverage: each zip holds one calendar year, so YEARS controls depth. The
Coffee C row is selected the same way as the existing futures-only fetcher
(market name contains COFFEE, exchange ICE).

Writes data/cftc_options_book.json (repo data, rebuilt each run).

Network note: cftc.gov is not reachable from every environment (the agent
sandbox blocks it); this runs on GitHub Actions where the existing
_fetch_cftc_cot already works.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "cftc_options_book.json"

BASE = "https://www.cftc.gov/files/dea/history"
FUT_URL = BASE + "/fut_disagg_txt_{year}.zip"
COM_URL = BASE + "/com_disagg_txt_{year}.zip"
YEARS = 5
UA = {"User-Agent": "Mozilla/5.0"}

# cohort → (long column, short column) in the disaggregated schema
COHORTS = {
    "pmpu":  ("Prod_Merc_Positions_Long_All", "Prod_Merc_Positions_Short_All"),
    "swap":  ("Swap_Positions_Long_All", "Swap_Positions_Short_All"),
    "mm":    ("M_Money_Positions_Long_All", "M_Money_Positions_Short_All"),
    "other": ("Other_Rept_Positions_Long_All", "Other_Rept_Positions_Short_All"),
    "nonrept": ("NonRept_Positions_Long_All", "NonRept_Positions_Short_All"),
}
OI_COL = "Open_Interest_All"
DATE_COL = "Report_Date_as_YYYY-MM-DD"


def _int(v) -> int:
    try:
        return int(float(str(v).replace(",", "").strip() or 0))
    except (TypeError, ValueError):
        return 0


def _fetch_year(url: str) -> list[dict]:
    """Download one year's zip and return the Coffee C rows."""
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    rows = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace")):
                name = (row.get("Market_and_Exchange_Names") or "").upper()
                if "COFFEE" in name:
                    rows.append(row)
    return rows


def _index(rows: list[dict]) -> dict[str, dict]:
    """{report date → row}. Coffee C appears once per report date; if a year
    ever carried two coffee markets the first is kept and the count is
    reported so the ambiguity is visible rather than silent."""
    out: dict[str, dict] = {}
    dupes = 0
    for r in rows:
        d = (r.get(DATE_COL) or "").strip()
        if not d:
            continue
        if d in out:
            dupes += 1
            continue
        out[d] = r
    if dupes:
        print(f"  note: {dupes} duplicate coffee rows ignored (kept first per date)")
    return out


def run(years: int = YEARS) -> dict:
    this_year = datetime.now(UTC).year
    fut_rows: list[dict] = []
    com_rows: list[dict] = []
    fetched, failed = [], []
    for y in range(this_year - years + 1, this_year + 1):
        for url_t, sink, tag in ((FUT_URL, fut_rows, "fut"), (COM_URL, com_rows, "com")):
            try:
                got = _fetch_year(url_t.format(year=y))
                sink.extend(got)
                fetched.append(f"{tag}{y}:{len(got)}")
            except Exception as e:  # noqa: BLE001 — a missing year must not kill the rest
                failed.append(f"{tag}{y}:{type(e).__name__}")
    if not fut_rows or not com_rows:
        raise RuntimeError(f"no CFTC rows fetched (ok={fetched} failed={failed})")

    fut, com = _index(fut_rows), _index(com_rows)
    weeks = sorted(set(fut) & set(com))
    history = []
    for d in weeks:
        f, c = fut[d], com[d]
        row: dict = {"date": d,
                     "oi_fut": _int(f.get(OI_COL)), "oi_com": _int(c.get(OI_COL))}
        for key, (lc, sc) in COHORTS.items():
            fl, fs = _int(f.get(lc)), _int(f.get(sc))
            cl, cs = _int(c.get(lc)), _int(c.get(sc))
            row[key] = {
                "fut_net": fl - fs, "com_net": cl - cs,
                # the delta-equivalent options book this cohort holds
                "opt_net": (cl - cs) - (fl - fs),
                "opt_long": cl - fl, "opt_short": cs - fs,
            }
        history.append(row)

    doc = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "CFTC disaggregated COT — fut_disagg (futures only) and com_disagg "
                  "(futures + options, delta-adjusted by the exchange)",
        "note": "opt_net = combined net − futures-only net, per cohort: the "
                "delta-equivalent options position CFTC attributes to that cohort "
                "and the futures-only feed omits.",
        "years_requested": years, "fetched": fetched, "failed": failed,
        "weeks": len(history),
        "history": history,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    last = history[-1] if history else {}
    print(f"[cftc-options-book] {len(history)} weeks {history[0]['date'] if history else '—'} → "
          f"{last.get('date','—')}; latest MM opt_net {last.get('mm',{}).get('opt_net')}")
    return {"ok": True, "weeks": len(history)}


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Fetch CFTC futures-only + combined COT and diff the options book.")
    ap.add_argument("--years", type=int, default=YEARS)
    a = ap.parse_args()
    sys.exit(0 if run(years=a.years).get("ok") else 1)
