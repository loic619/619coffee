"""enso_indices.py — NOAA CPC weekly Niño 3.4 SST + monthly SOI fetcher.

Two trader-relevant ENSO indices live behind plain text files on NOAA CPC:

  • Niño 3.4 weekly SST anomalies
      https://www.cpc.ncep.noaa.gov/data/indices/wksst8110.for
      Fixed-width ASCII, refreshed every Monday. Columns: date + four
      Niño regions (1+2, 3, 3.4, 4), each with raw SST and SST anomaly.
      The 3.4 anomaly is the headline signal — >+0.5 °C is El Niño,
      <-0.5 °C is La Niña.

  • SOI monthly standardized index
      https://www.cpc.ncep.noaa.gov/data/indices/soi
      Year-row × month-column matrix. NOAA publishes two sections —
      raw 'ANOMALY' and 'STANDARDIZED DATA'; we parse the standardized
      one (matches trader convention). Sustained negative SOI couples
      with positive Niño 3.4 to confirm an ocean–atmosphere El Niño.

Why two indices and not just ONI:
  The existing `enso.json` already carries ONI (the 3-month rolling
  mean of Niño 3.4 SST). That's slow-moving — it lags the turn by
  ~6 weeks. Weekly Niño 3.4 catches the surface SST shift earlier;
  SOI catches the atmospheric coupling. Together they let a desk see
  the regime change before it lands in the rolling ONI value the
  rest of the dashboard already uses.

⚠ Network: NOAA CPC is reachable from GitHub Actions runners but
NOT from the Claude Code sandbox (same outbound-allowlist gate that
blocks FNC). Fetchers run on the runner; the sandbox can only inspect
what's already committed to the repo.

Both endpoints serve the full history every request — the files are
KB-scale, so 'incremental' = 'fetch full series, overwrite'. The
`--backfill` flag exists for parallelism with FNC's pattern and to
signal operator intent in the workflow log; functionally the two
modes are identical.

Usage
-----
    cd backend
    python -m scraper.sources.enso_indices              # preview only
    python -m scraper.sources.enso_indices --write      # parse + write
    python -m scraper.sources.enso_indices --backfill --write  # explicit seed
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import requests

from scraper.validate_export import safe_write_json

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "frontend" / "public" / "data"
OUT_PATH = DATA_DIR / "enso_indices.json"

# Multiple URL candidates per index — NOAA has moved files over the years
# and serves several variants concurrently. We try each in order and use
# the first that returns 200. The dry-run on 22 Jun 2026 surfaced that
# one of the original URLs returned no usable text; URL fallback covers
# the silent-move case without needing a code change.
NINO34_URL_CANDIDATES = [
    # 1991-2020 climatology — NOAA's current default base period.
    "https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for",
    # 1981-2010 climatology — older base period, still served.
    "https://www.cpc.ncep.noaa.gov/data/indices/wksst8110.for",
    # `.bnd` extension served alongside `.for` historically.
    "https://www.cpc.ncep.noaa.gov/data/indices/wksst8110.bnd",
    # No-www variant (some NOAA mirrors omit the subdomain).
    "https://cpc.ncep.noaa.gov/data/indices/wksst9120.for",
    "https://cpc.ncep.noaa.gov/data/indices/wksst8110.for",
]
SOI_URL_CANDIDATES = [
    "https://www.cpc.ncep.noaa.gov/data/indices/soi",
    "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/soi.txt",
    "https://cpc.ncep.noaa.gov/data/indices/soi",
]

_BROWSER_HEADERS = {
    "User-Agent": "619coffee/enso-indices (https://github.com/loic619/619coffee)",
    "Accept": "text/plain, */*",
}

# NOAA sentinel for "missing month" in the SOI matrix. Filtered before
# emitting so the frontend chart doesn't see -999.9 spikes.
_SOI_MISSING = -999.9

# Niño 3.4 thresholds (°C). Used by the parser only to log a phase
# label for the LATEST week — the JSON ships raw anomalies, the
# frontend can render the bands its own way.
NINO34_EL_NINO_THRESHOLD = 0.5
NINO34_LA_NINA_THRESHOLD = -0.5
# NOAA standardized SOI thresholds. Australian BOM convention multiplies
# these by 10 (so ±7 in BOM ≈ ±0.7 here); we ship the NOAA scale, the
# frontend can render either.
SOI_LA_NINA_THRESHOLD = 0.5
SOI_EL_NINO_THRESHOLD = -0.5

_MONTH_ABBR_TO_NUM = {
    "JAN":  1, "FEB":  2, "MAR":  3, "APR":  4,
    "MAY":  5, "JUN":  6, "JUL":  7, "AUG":  8,
    "SEP":  9, "OCT": 10, "NOV": 11, "DEC": 12,
}

# A Niño 3.4 data line starts with a DDMMMYYYY token, optionally preceded
# by a single leading space (NOAA pads data lines with one space but
# header lines without). Anchored at line-start with optional space.
_NINO34_DATE_RE = re.compile(r"^\s*(?P<dd>\d{2})(?P<mon>[A-Z]{3})(?P<yyyy>\d{4})\b")

# SOI: rows start with a 4-digit year followed by 12 numeric columns.
# NOAA fixed-width formatting fuses negative numbers with adjacent fields
# (e.g. ` -0.9-999.9-999.9`), so we can't rely on whitespace separation
# — we extract numbers via _SIGNED_DECIMAL_RE on the row tail.
_SOI_ROW_RE = re.compile(r"^\s*(?P<yr>(?:19|20)\d{2})\b(?P<rest>.*)$")

# Robust signed-decimal extractor used by BOTH parsers. NOAA pads its
# fixed-width files with single-space gaps that get visually swallowed
# by a leading minus sign (`20.6-0.1`, `-0.9-999.9`). `.split()` then
# returns half the columns it should. Walking the row with a regex
# that matches signed-decimal tokens recovers all of them in order,
# regardless of whether spaces survived between them.
_SIGNED_DECIMAL_RE = re.compile(r"-?\d+\.\d+")


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class Nino34Weekly:
    week_ending: str        # "YYYY-MM-DD" (Wednesday — NOAA's week-ending convention)
    sst_anomaly: float      # °C anomaly from the 1991-2020 base period


@dataclass
class SoiMonthly:
    month: str              # "YYYY-MM"
    soi: float              # NOAA standardized SOI


# ── HTTP fetching ───────────────────────────────────────────────────────────


def _fetch(url: str, *, timeout: int = 30) -> str | None:
    """Plain GET with a polite UA. Returns text on 200, None otherwise so
    one endpoint failing doesn't kill the other one. NOAA is normally
    very stable; we still treat connectivity as best-effort and log."""
    try:
        resp = requests.get(url, headers=_BROWSER_HEADERS, timeout=timeout)
    except requests.RequestException as e:
        logger.warning(f"[enso] GET {url} → request error: {e}")
        return None
    if resp.status_code != 200:
        logger.warning(f"[enso] GET {url} → HTTP {resp.status_code}")
        return None
    return resp.text


def _fetch_first_ok(urls: list[str]) -> tuple[str | None, str | None]:
    """Walk the URL candidate list in order, return (text, winning_url)
    for the first 200 response. Returns (None, None) if all candidates
    fail. We log the winner explicitly so the workflow operator can
    see which mirror NOAA is actually serving from this week without
    spelunking the diff."""
    for url in urls:
        text = _fetch(url)
        if text:
            logger.info(f"[enso] fetched OK: {url} ({len(text):,} bytes)")
            return text, url
    return None, None


# ── parsers ─────────────────────────────────────────────────────────────────


def parse_nino34(text: str) -> list[Nino34Weekly]:
    """Read the Niño-region weekly file and return the Niño 3.4 anomaly
    series. The file's data lines look like (real format, with one
    leading space and NEGATIVE NUMBERS FUSED to the preceding SST):

         02SEP1981     20.6-0.1     24.8-0.1     26.5-0.2     28.3-0.3
         17JUN2026     26.1 3.0     28.5 1.9     29.3 1.7     30.2 1.3

    After date strip + _SIGNED_DECIMAL_RE the row yields 8 numbers,
    one (SST, SSTA) pair per region in left-to-right order:
        [0,1]  SST + SSTA Niño 1+2
        [2,3]  SST + SSTA Niño 3
        [4,5]  SST + SSTA Niño 3.4  ← target = index 5
        [6,7]  SST + SSTA Niño 4

    Header rows skipped via the date regex; rows yielding fewer than 8
    numbers dropped. The .split()-based v1 parser missed everything in
    weeks where SSTA Niño 1+2 was negative because the space ahead of
    `-0.1` was eaten by the minus sign."""
    out: list[Nino34Weekly] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        m = _NINO34_DATE_RE.match(line)
        if not m:
            continue
        dd, mon, yyyy = m.group("dd"), m.group("mon"), m.group("yyyy")
        mn = _MONTH_ABBR_TO_NUM.get(mon)
        if mn is None:
            continue
        # Extract the eight signed decimals from the line tail (after
        # the date token). NOAA pads with leading whitespace and fuses
        # negative numbers — re.findall ignores both.
        tail = line[m.end():]
        nums = _SIGNED_DECIMAL_RE.findall(tail)
        if len(nums) < 8:
            logger.debug(f"[enso] nino34: only {len(nums)} numbers on line {line!r}")
            continue
        try:
            ssta_34 = float(nums[5])
        except ValueError:
            continue
        out.append(Nino34Weekly(
            week_ending=f"{yyyy}-{mn:02d}-{int(dd):02d}",
            sst_anomaly=round(ssta_34, 2),
        ))
    out.sort(key=lambda r: r.week_ending)
    return out


def parse_soi(text: str) -> list[SoiMonthly]:
    """Read the CPC SOI file and return the STANDARDIZED monthly series.

    The file has two sections — raw 'ANOMALY' followed by 'STANDARDIZED
    DATA'. We only want the second one (matches trader convention and
    the comparability with Australian BOM). Each row in either section
    is `YEAR  JAN  FEB  ... DEC` with 12 numeric columns.

    The transition between sections is marked by the column header
    `YEAR    JAN    FEB    ...` — we keep a flag that flips when we
    see the standardized-section banner. Sentinel -999.9 = missing
    month is filtered out so the chart doesn't get phantom spikes."""
    out: list[SoiMonthly] = []
    in_standardized = False
    saw_header_after_standardized_banner = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        up = line.upper()
        # Section banner — everything after this line that matches the
        # row regex belongs to the standardized series.
        if "STANDARDIZED" in up and "DATA" in up:
            in_standardized = True
            saw_header_after_standardized_banner = False
            continue
        if not in_standardized:
            continue
        # The first header row inside the section is "YEAR JAN FEB ..."
        # — skip it, but only once per section.
        if not saw_header_after_standardized_banner and up.startswith("YEAR"):
            saw_header_after_standardized_banner = True
            continue
        m = _SOI_ROW_RE.match(line)
        if not m:
            continue
        yr = int(m.group("yr"))
        # Same negative-number fusion bug as Niño 3.4: a v1 .split() on
        # `1.1   1.4   1.2  -0.6  -0.9-999.9-999.9` returned 5 tokens
        # because the leading minus sign ate the gap. Use re.findall to
        # walk the row and extract all 12 signed decimals in order.
        cols = _SIGNED_DECIMAL_RE.findall(m.group("rest"))
        if len(cols) < 12:
            logger.debug(f"[enso] soi: short row for year {yr}: {len(cols)} cols")
            continue
        for i, raw_v in enumerate(cols[:12]):
            try:
                v = float(raw_v)
            except ValueError:
                continue
            if abs(v - _SOI_MISSING) < 0.01:
                continue
            out.append(SoiMonthly(
                month=f"{yr:04d}-{i+1:02d}",
                soi=round(v, 2),
            ))
    out.sort(key=lambda r: r.month)
    return out


# ── orchestration ───────────────────────────────────────────────────────────


def _phase_for_nino34(sst_anomaly: float | None) -> str:
    if sst_anomaly is None:
        return "unknown"
    if sst_anomaly >= NINO34_EL_NINO_THRESHOLD:
        return "el-nino"
    if sst_anomaly <= NINO34_LA_NINA_THRESHOLD:
        return "la-nina"
    return "neutral"


def build_payload(
    nino34: list[Nino34Weekly],
    soi: list[SoiMonthly],
) -> dict:
    """Compose the JSON the frontend reads. The frontend can render
    whatever subset it needs — we ship the full history so charts can
    re-bin to any window without a re-fetch."""
    latest_n34 = nino34[-1] if nino34 else None
    latest_soi = soi[-1]    if soi    else None
    return {
        "scraped_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "nino34": {
            "source":        "NOAA CPC weekly SST anomalies (wksst8110.for)",
            "source_url":    NINO34_URL_CANDIDATES[0],
            "unit":          "°C SST anomaly vs 1991-2020 climatology",
            "thresholds":    {"el_nino": NINO34_EL_NINO_THRESHOLD,
                              "la_nina": NINO34_LA_NINA_THRESHOLD},
            "latest": {
                "week_ending":  latest_n34.week_ending if latest_n34 else None,
                "sst_anomaly":  latest_n34.sst_anomaly if latest_n34 else None,
                "phase":        _phase_for_nino34(latest_n34.sst_anomaly if latest_n34 else None),
            },
            "weekly":        [asdict(r) for r in nino34],
        },
        "soi": {
            "source":        "NOAA CPC monthly standardized SOI",
            "source_url":    SOI_URL_CANDIDATES[0],
            "unit":          "standardized index (BOM convention × 10)",
            "thresholds":    {"el_nino": SOI_EL_NINO_THRESHOLD,
                              "la_nina": SOI_LA_NINA_THRESHOLD},
            "latest": {
                "month":     latest_soi.month if latest_soi else None,
                "soi":       latest_soi.soi   if latest_soi else None,
            },
            "monthly":       [asdict(r) for r in soi],
        },
    }


def _persist(doc: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe_write_json(OUT_PATH, doc, trailing_newline=True)


def _fmt_signed(v: float | None, fmt: str = "+.2f") -> str:
    """Format a number with an explicit sign, or '—' when None. Lets
    the summary log line tolerate a partial fetch (one endpoint
    succeeded, the other came back empty) instead of crashing the
    workflow on the format call — the v1 dry-run failure mode."""
    if v is None:
        return "—"
    return f"{v:{fmt}}"


def run(*, write: bool, backfill: bool, diag: bool = False) -> int:
    """Fetch both indices, build the JSON, optionally persist.

    backfill is informational — both endpoints return the full history
    every request, so backfill vs incremental refresh exercises the
    same code path. The flag is kept for operator clarity and parity
    with FNC's pattern.

    `diag` dumps a head/tail snippet of each fetched text to the log
    so the operator can confirm the file format hasn't drifted when
    debugging from a workflow run."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    mode = "backfill" if backfill else "refresh"
    logger.info(f"[enso] mode={mode}")

    n34_text, n34_url = _fetch_first_ok(NINO34_URL_CANDIDATES)
    soi_text, soi_url = _fetch_first_ok(SOI_URL_CANDIDATES)

    if diag:
        for name, text in [("nino34", n34_text), ("soi", soi_text)]:
            if text:
                lines = text.splitlines()
                head = "\n".join(lines[:5])
                tail = "\n".join(lines[-5:])
                logger.info(f"[enso] --diag {name} ({len(lines)} lines)\n--- head ---\n{head}\n--- tail ---\n{tail}")
            else:
                logger.info(f"[enso] --diag {name}: <no text fetched>")

    if not n34_text and not soi_text:
        logger.error("[enso] FATAL: both NOAA endpoints unreachable across all URL candidates")
        return 1

    nino34 = parse_nino34(n34_text) if n34_text else []
    soi    = parse_soi(soi_text)    if soi_text    else []

    if not nino34 and not soi:
        logger.error("[enso] FATAL: 0 rows parsed from both endpoints — format may have drifted; re-run with --diag")
        return 1
    # Partial success is allowed — we ship whichever index parsed and
    # log a warning so the operator notices the asymmetry.
    if not nino34:
        logger.warning(f"[enso] nino34: 0 rows from {n34_url or 'no successful URL'} — re-run with --diag")
    if not soi:
        logger.warning(f"[enso] soi: 0 rows from {soi_url or 'no successful URL'} — re-run with --diag")

    doc = build_payload(nino34, soi)
    latest_n34 = doc["nino34"]["latest"]
    latest_soi = doc["soi"]["latest"]
    logger.info(
        f"[enso] nino34: {len(nino34)} weekly rows "
        f"(latest {latest_n34['week_ending'] or '—'} = "
        f"{_fmt_signed(latest_n34['sst_anomaly'])} °C, "
        f"phase={latest_n34['phase']})"
    )
    logger.info(
        f"[enso] soi:    {len(soi)} monthly rows "
        f"(latest {latest_soi['month'] or '—'} = "
        f"{_fmt_signed(latest_soi['soi'])})"
    )

    if write:
        _persist(doc)
        logger.info(f"[enso] wrote {OUT_PATH}")
    else:
        logger.info("[enso] preview only — pass --write to persist")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write",    action="store_true", help="Persist parsed JSON")
    ap.add_argument("--backfill", action="store_true",
                    help="Operator-intent flag for the full-history seed run. "
                         "Functionally identical to the default refresh — the "
                         "endpoints always serve the full series.")
    ap.add_argument("--diag", action="store_true",
                    help="Log head/tail of each fetched text so the operator "
                         "can confirm NOAA's file format from the workflow log.")
    args = ap.parse_args()
    return run(write=args.write, backfill=args.backfill, diag=args.diag)


if __name__ == "__main__":
    sys.exit(main())
