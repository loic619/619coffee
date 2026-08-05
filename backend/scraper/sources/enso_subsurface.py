"""enso_subsurface.py — NOAA Warm Water Volume (WWV) monthly index.

The "subsurface heat alert" — Phase 2 of the ENSO command-center upgrade.

WWV is the volume of equatorial Pacific water above the 20 °C isotherm
(the thermocline depth), measured over 5°N-5°S × 120°E-80°W. It's the
textbook leading indicator for ENSO:

  • When WWV accumulates at depth in the western/central Pacific,
    a downwelling Kelvin wave propagates eastward and surfaces as
    El Niño 4-6 MONTHS later.
  • When WWV drains, La Niña follows.

The existing ENSO tab already shows Niño 3.4 (the surface ocean
signal) + SOI (the atmospheric pressure side). Both react after
the ocean has already coupled to the atmosphere. WWV runs AHEAD
of both — it sees the regime change before the SST does. For a
trading desk that's the most valuable window: positioning before
the headline indicators move.

⚠ Network: NOAA endpoints are reachable from GitHub Actions runners
but NOT from the Claude Code sandbox (same outbound-allowlist gate
that blocks the other NOAA fetchers). The fetcher runs on the runner;
the sandbox can only inspect what's already committed to the repo.

The WWV text file serves the FULL history every request (KB-scale),
so 'backfill' and 'refresh' exercise the same code path — the
--backfill flag is operator intent for the workflow log, mirroring
the enso_indices pattern.

Usage
-----
    cd backend
    python -m scraper.sources.enso_subsurface              # preview
    python -m scraper.sources.enso_subsurface --write      # parse + write
    python -m scraper.sources.enso_subsurface --diag       # log fetched text
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
OUT_PATH = DATA_DIR / "enso_subsurface.json"

# Multiple WWV URL candidates — NOAA hosts the same index under several
# paths and the canonical location shifts over time. The same pattern
# saved us on enso_indices v1 (where the initially-chosen URL 404'd
# and v2 added a fallback list). The fetcher walks these in order
# and uses the first 200 response, logging the winner.
#
# The v1 dispatch on 22 Jun 2026 showed all the PMEL/PSL/CPC paths I
# initially guessed returned 404. v2 expands the list with paths
# derived from IRI/LDEO Climate Data Library (Columbia U. — they
# maintain authoritative mirrors of the PMEL ENSO indices) plus
# additional PMEL endpoints that have appeared in NOAA documentation.
WWV_URL_CANDIDATES = [
    # IRI/LDEO Climate Data Library — Columbia U. maintains stable
    # mirrors with CSV/text export endpoints. Their `data.tsv`
    # endpoint format reliably serves a header line + two columns
    # (year-month-fraction, value). Most likely to be live today.
    "https://iridl.ldeo.columbia.edu/SOURCES/.PMEL/.WWV/dods.tsv",
    "https://iridl.ldeo.columbia.edu/SOURCES/.PMEL/.WWV/data.tsv",
    "https://iridl.ldeo.columbia.edu/SOURCES/.PMEL/.WWV/wwv/T/firstgridcenter/T/lastgridcenter/RANGE/data.tsv",
    # PMEL paths under the active /tao/ tree (different from the
    # legacy /elnino/sites/ path that 404'd in v1).
    "https://www.pmel.noaa.gov/tao/wwv/data/wwv.dat",
    "https://www.pmel.noaa.gov/tao/elnino/wwv/data/wwv.dat",
    # CPC published "T-300m anomaly" is a related subsurface index
    # if WWV proper isn't accessible — the OC indices file bundles
    # multiple subsurface monitoring metrics including heat content.
    "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/MJO/oc_indices.txt",
    # Legacy paths kept for completeness — if NOAA restores any of
    # them, we'll pick them up automatically without a code change.
    "https://www.pmel.noaa.gov/elnino/sites/default/files/wwv.dat",
    "https://www.pmel.noaa.gov/sites/default/files/tao/wwv.dat",
    "https://www.psl.noaa.gov/data/correlation/wwv.data",
]

_BROWSER_HEADERS = {
    "User-Agent": "619coffee/enso-subsurface (https://github.com/loic619/619coffee)",
    "Accept": "text/plain, */*",
}

# NOAA's missing-value sentinel for WWV — same convention as SOI.
_MISSING_SENTINELS = (-999.9, -99.99, 999.9)

# Trader-relevant thresholds in 10^14 m³ anomaly. Empirical from the
# literature: |WWV anomaly| > 1.0 historically precedes a Niño 3.4
# surface event of the same sign within 4-6 months. Values reported
# in the JSON; the frontend can render bands its own way.
WWV_EL_NINO_LEAD_THRESHOLD = 1.0
WWV_LA_NINA_LEAD_THRESHOLD = -1.0

# Robust signed-decimal extractor — same approach that fixed enso_indices
# v3, extended in v3 here to support scientific notation. The PMEL WWV
# file at /tao/wwv/data/wwv.dat serves values like `0.2700635E+15`
# (volume in m³). Without the exponent capture, the parser truncates
# to the mantissa `0.27` and shows a wildly wrong anomaly value.
_SIGNED_DECIMAL_RE = re.compile(r"-?\d+\.\d+(?:[Ee][+-]?\d+)?")

# A WWV row in PSL year-matrix format: 4-digit year followed by 12
# monthly columns (and optional annual column).
_YEAR_ROW_RE = re.compile(r"^\s*(?P<yr>(?:19|20)\d{2})\b(?P<rest>.*)$")

# A WWV row in flat YYYYMM ... format. PMEL's wwv.dat actually serves:
#   YYYYMM   VOLUME      ANOMALY
#   202605   0.2671554E+16  0.2700635E+15
# We want the ANOMALY (3rd column), not the absolute volume (2nd).
# v2 captured only the first decimal it found (the volume) and shipped
# nonsensical +0.27 values; v3 walks all decimals on the row and picks
# the second one explicitly.
_YYYYMM_FLAT_RE = re.compile(
    r"^\s*(?P<yyyymm>(?:19|20)\d{2}(?:0[1-9]|1[0-2]))\s+(?P<rest>.*)$"
)

# WWV anomaly normalization factor — PMEL reports the anomaly in m³;
# the literature (and the trader-relevant ±1.0 threshold) uses
# 10^14 m³ as the unit. Divide raw values by this to land in those
# units. 0.2700635E+15 m³ / 1e14 = 2.70 (× 10^14 m³).
_WWV_UNIT_DIVISOR = 1e14


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class WwvMonthly:
    month: str              # "YYYY-MM"
    wwv_anomaly: float      # 10^14 m³ anomaly vs PMEL's reference climatology


# ── HTTP fetching ───────────────────────────────────────────────────────────


def _fetch(url: str, *, timeout: int = 30) -> str | None:
    """Plain GET. Returns text on 200, None on any error so one
    endpoint failing doesn't kill the run."""
    try:
        resp = requests.get(url, headers=_BROWSER_HEADERS, timeout=timeout)
    except requests.RequestException as e:
        logger.warning(f"[wwv] GET {url} → request error: {e}")
        return None
    if resp.status_code != 200:
        logger.warning(f"[wwv] GET {url} → HTTP {resp.status_code}")
        return None
    return resp.text


def _fetch_first_ok(urls: list[str]) -> tuple[str | None, str | None]:
    """Walk the URL candidate list, return (text, winning_url) for the
    first 200 response. Returns (None, None) if all candidates fail.
    Logs the winner so the workflow operator sees which mirror NOAA
    is actually serving from this week."""
    for url in urls:
        text = _fetch(url)
        if text:
            logger.info(f"[wwv] fetched OK: {url} ({len(text):,} bytes)")
            return text, url
    return None, None


# ── parsers ─────────────────────────────────────────────────────────────────


def _is_missing(v: float) -> bool:
    return any(abs(v - s) < 0.05 for s in _MISSING_SENTINELS)


def parse_wwv_year_matrix(text: str) -> list[WwvMonthly]:
    """Parse PSL/PMEL year-row matrix format. Each row:
        YEAR  JAN  FEB  MAR ... DEC  [ANN]
    Returns monthly entries with sentinels filtered. Header rows and
    any line not starting with a 4-digit year are skipped. Designed
    to tolerate negative-number fusion (same as enso_indices v3)."""
    out: list[WwvMonthly] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        # PSL files often have a "1980 2025" header line at the top
        # specifying the year range. Skip anything that yields more
        # than just a year + monthly values when extracted.
        m = _YEAR_ROW_RE.match(line)
        if not m:
            continue
        yr = int(m.group("yr"))
        # 1900-2099 is the only sane WWV range.
        if yr < 1970 or yr > 2099:
            continue
        nums = _SIGNED_DECIMAL_RE.findall(m.group("rest"))
        # Skip header-style "1980 2025" two-int line (no decimals).
        if len(nums) < 12:
            continue
        for i, raw_v in enumerate(nums[:12]):
            try:
                v = float(raw_v)
            except ValueError:
                continue
            if _is_missing(v):
                continue
            out.append(WwvMonthly(
                month=f"{yr:04d}-{i+1:02d}",
                wwv_anomaly=round(v, 3),
            ))
    out.sort(key=lambda r: r.month)
    return out


def parse_wwv_yyyymm_flat(text: str) -> list[WwvMonthly]:
    """Parse PMEL's flat format. Each data line is:
        YYYYMM    VOLUME (m³)        ANOMALY (m³)
        202605    0.2671554E+16      0.2700635E+15
    We want the ANOMALY (column 3). The volume column is a slowly-
    drifting absolute value around 2.6 × 10^16 m³ — not the signal
    a trader cares about; the anomaly relative to climatology is.
    Anomaly values divide by 1e14 to land in the trader-convention
    "× 10^14 m³" units (so a +2.7 reading matches PMEL's published
    charts and the ±1.0 threshold the literature uses)."""
    out: list[WwvMonthly] = []
    for raw_line in text.splitlines():
        m = _YYYYMM_FLAT_RE.match(raw_line)
        if not m:
            continue
        yyyymm = m.group("yyyymm")
        nums = _SIGNED_DECIMAL_RE.findall(m.group("rest"))
        if len(nums) < 2:
            # File has only volume column (no anomaly) — can't use it.
            continue
        try:
            v_raw = float(nums[1])    # column 3 in the file (index 1 in `nums`)
        except ValueError:
            continue
        if _is_missing(v_raw):
            continue
        out.append(WwvMonthly(
            month=f"{yyyymm[:4]}-{yyyymm[4:6]}",
            wwv_anomaly=round(v_raw / _WWV_UNIT_DIVISOR, 3),
        ))
    out.sort(key=lambda r: r.month)
    return out


def parse_wwv(text: str) -> list[WwvMonthly]:
    """Try both parsing strategies — flat then year-matrix. NOAA serves
    WWV in both layouts across its various mirror URLs; whichever
    layout produces more rows wins. (If both produce zero we return
    [] and the caller logs the failure for the diag operator.)"""
    flat   = parse_wwv_yyyymm_flat(text)
    matrix = parse_wwv_year_matrix(text)
    if len(flat) >= len(matrix):
        logger.info(f"[wwv] using flat parser ({len(flat)} rows vs matrix's {len(matrix)})")
        return flat
    logger.info(f"[wwv] using year-matrix parser ({len(matrix)} rows vs flat's {len(flat)})")
    return matrix


# ── orchestration ───────────────────────────────────────────────────────────


def _lead_signal(wwv_anomaly: float | None) -> str:
    """Map a WWV anomaly to its trader-relevant lead signal — the
    expected SST response 4-6 months from now."""
    if wwv_anomaly is None:
        return "unknown"
    if wwv_anomaly >= WWV_EL_NINO_LEAD_THRESHOLD:
        return "el-nino-pending"
    if wwv_anomaly <= WWV_LA_NINA_LEAD_THRESHOLD:
        return "la-nina-pending"
    return "neutral"


def _fmt_signed(v: float | None, fmt: str = "+.2f") -> str:
    """Crash-safe signed-number formatter. enso_indices v2 added this
    after a v1 dispatch crashed on a None value mid-log line."""
    if v is None:
        return "—"
    return f"{v:{fmt}}"


def build_payload(monthly: list[WwvMonthly], source_url: str | None) -> dict:
    """Compose the JSON the frontend reads. Ships full history so the
    chart can re-window without a re-fetch + a `latest` summary card."""
    latest = monthly[-1] if monthly else None
    return {
        "scraped_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "wwv": {
            "source":     "NOAA PMEL — Warm Water Volume (5°N-5°S, 120°E-80°W, above 20 °C isotherm)",
            "source_url": source_url or WWV_URL_CANDIDATES[0],
            "unit":       "10^14 m³ anomaly vs climatology",
            "thresholds": {
                "el_nino_lead": WWV_EL_NINO_LEAD_THRESHOLD,
                "la_nina_lead": WWV_LA_NINA_LEAD_THRESHOLD,
            },
            "lead_months": "4–6",  # Empirical from McPhaden & co. — see PMEL ENSO docs.
            "latest": {
                "month":        latest.month       if latest else None,
                "wwv_anomaly":  latest.wwv_anomaly if latest else None,
                "lead_signal":  _lead_signal(latest.wwv_anomaly if latest else None),
            },
            "monthly":    [asdict(r) for r in monthly],
        },
    }


def _persist(doc: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe_write_json(OUT_PATH, doc, trailing_newline=True)


def run(*, write: bool, backfill: bool, diag: bool = False) -> int:
    """Fetch WWV, build the JSON, optionally persist.

    backfill is informational — the endpoint serves the full history
    every request, so backfill vs incremental refresh is the same
    code path. `diag` dumps a head/tail snippet of the fetched text
    so the operator can confirm the file format from a workflow run."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    mode = "backfill" if backfill else "refresh"
    logger.info(f"[wwv] mode={mode}")

    text, winning_url = _fetch_first_ok(WWV_URL_CANDIDATES)

    if diag:
        if text:
            lines = text.splitlines()
            head = "\n".join(lines[:8])
            tail = "\n".join(lines[-5:])
            logger.info(f"[wwv] --diag wwv ({len(lines)} lines)\n--- head ---\n{head}\n--- tail ---\n{tail}")
        else:
            logger.info("[wwv] --diag wwv: <no text fetched>")

    if not text:
        logger.error("[wwv] FATAL: WWV unreachable across all URL candidates")
        return 1

    monthly = parse_wwv(text)
    if not monthly:
        logger.error("[wwv] FATAL: 0 rows parsed — format may have drifted; re-run with --diag")
        return 1

    doc = build_payload(monthly, winning_url)
    latest = doc["wwv"]["latest"]
    logger.info(
        f"[wwv] {len(monthly)} monthly rows "
        f"(latest {latest['month'] or '—'} = "
        f"{_fmt_signed(latest['wwv_anomaly'])} × 10^14 m³, "
        f"lead_signal={latest['lead_signal']})"
    )

    if write:
        _persist(doc)
        logger.info(f"[wwv] wrote {OUT_PATH}")
    else:
        logger.info("[wwv] preview only — pass --write to persist")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write",    action="store_true", help="Persist parsed JSON")
    ap.add_argument("--backfill", action="store_true",
                    help="Operator-intent flag for the full-history seed run. "
                         "Functionally identical to default refresh — the "
                         "endpoint always serves the full series.")
    ap.add_argument("--diag", action="store_true",
                    help="Log head/tail of the fetched text so the operator "
                         "can confirm the file format from the workflow log.")
    args = ap.parse_args()
    return run(write=args.write, backfill=args.backfill, diag=args.diag)


if __name__ == "__main__":
    sys.exit(main())
