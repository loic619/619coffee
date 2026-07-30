"""NOAA STAR Vegetation Health Index (VHI) — text parser + fetcher.

Source:
    GET https://www.star.nesdis.noaa.gov/smcd/emb/vci/VH/get_TS_admin.php
        ?country=BRA&provinceID=13&year1=2023&year2=2026&type=Mean

VHI blends VCI (vegetation condition) and TCI (temperature condition) into
a single 0–100 health score per ISO week. VHI is the headline signal; TCI
also ships (it is the satellite heat-stress witness for the IPHM
heat-stress rules); VCI is parsed but dropped to keep the JSON lean.

Response shape (CSV-ish text with a header line + column-header line):

    13 Minas Gerais
    year, week, SMN, SMT, VCI, TCI, VHI, empty
    2023,  1, 0.188, 298.63, 67.58, 28.53, 48.06,
    2023,  2, 0.185, 298.54, 65.34, 30.12, 47.73,
    ...

Trader-facing severity bins (mirrors the SPI/SPEI red→amber→green ramp):
    VHI <  40    drought / stress
    VHI 40–60    fair
    VHI >  60    healthy
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import requests

VHI_URL = "https://www.star.nesdis.noaa.gov/smcd/emb/vci/VH/get_TS_admin.php"
DEFAULT_HEADERS = {
    # HTTP header values must be latin-1; no em-dashes, smart quotes, etc.
    "User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelVHI/1.0; fair-use educational)",
    "Accept":     "text/plain, */*",
}


@dataclass(frozen=True)
class VhiRow:
    year:  int
    week:  int
    vhi:   float
    vci:   float | None = None
    tci:   float | None = None

    def iso_week_key(self) -> str:
        """'2026-W23' — matches the ISO-week format used elsewhere in the repo."""
        return f"{self.year}-W{self.week:02d}"


_HEADER_PROVINCE_RE = re.compile(r"^\s*(\d+)\s+(.+?)\s*$")
_COLUMN_HEADER_RE = re.compile(r"^\s*year\s*,", re.IGNORECASE)


def parse_vhi_text(text: str) -> dict[str, Any]:
    """Parse a NOAA STAR VHI province response into a structured dict.

    Returns:
        {
          "province_id":   int | None,
          "province_name": str | None,
          "rows":          [VhiRow, ...],   # chronological
        }

    Pure: no I/O, no globals consulted. Tolerates trailing commas, extra
    whitespace, blank lines, and a missing first-line header (treats the
    file as headerless if the first non-empty line looks like a column
    header rather than a province metadata line).
    """
    province_id: int | None = None
    province_name: str | None = None
    rows: list[VhiRow] = []

    saw_column_header = False
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue

        # Province metadata: a numeric leading token followed by a name.
        # Only honoured before we've seen the column header.
        if province_id is None and not saw_column_header:
            m = _HEADER_PROVINCE_RE.match(line)
            if m and not _COLUMN_HEADER_RE.match(line):
                try:
                    province_id   = int(m.group(1))
                    province_name = m.group(2).strip()
                    continue
                except ValueError:
                    pass

        # Column header — skip it.
        if _COLUMN_HEADER_RE.match(line):
            saw_column_header = True
            continue

        # Data row: comma-separated, with a trailing empty cell. We tolerate
        # whitespace and accept 7-or-8-column rows so a future NOAA tweak
        # (dropping the empty trailing field) doesn't break us.
        parts = [p.strip() for p in line.rstrip(",").split(",")]
        # Drop trailing empty cells (the documented "empty" 8th column,
        # plus any defensive trailing commas).
        while parts and parts[-1] == "":
            parts.pop()
        # Expected order: year, week, SMN, SMT, VCI, TCI, VHI
        if len(parts) < 7:
            continue
        try:
            year = int(parts[0])
            week = int(parts[1])
            vci  = float(parts[4])
            tci  = float(parts[5])
            vhi  = float(parts[6])
        except (ValueError, IndexError):
            continue
        if not (1 <= week <= 53):
            continue
        if not (0.0 <= vhi <= 100.0):
            # NOAA occasionally emits sentinel values (e.g. -999) when a
            # week is out of season or masked by cloud cover — skip them.
            continue
        rows.append(VhiRow(year=year, week=week, vhi=round(vhi, 2),
                           vci=round(vci, 2), tci=round(tci, 2)))

    return {
        "province_id":   province_id,
        "province_name": province_name,
        "rows":          rows,
    }


# ── Severity bin (mirrors SPI/SPEI red→amber→green ramp) ─────────────────────

def vhi_severity(value: float | None) -> str:
    """One of 'stress' (<40), 'fair' (40–60), 'healthy' (>60), or 'unknown'."""
    if value is None:
        return "unknown"
    if value < 40.0:
        return "stress"
    if value <= 60.0:
        return "fair"
    return "healthy"


# ── Live fetch ───────────────────────────────────────────────────────────────

def _sanitize_header_value(v: str) -> str:
    """Ensure a header value is latin-1-encodable (HTTP requirement).

    Defensive: PR #137 cleaned the em-dash from User-Agent, but the
    Saturday 2026-05-30 CI run still failed with
        UnicodeEncodeError: 'latin-1' codec can't encode character '\\u2014'
        in position 69
    despite the local probe showing only ASCII headers on the wire.
    Something on the GH runner's session — likely a default header
    injected by an environment variable or a charset_normalizer hook —
    contained an em-dash beyond what our DEFAULT_HEADERS controls.
    This helper strips/replaces any non-latin-1 char so even an injected
    value can't crash the request. ASCII-only inputs pass through.
    """
    try:
        v.encode("latin-1")
        return v
    except UnicodeEncodeError:
        return v.encode("ascii", errors="replace").decode("ascii")


def _safe_session(session: requests.Session | None) -> requests.Session:
    """Return a session whose default headers are KNOWN-SAFE (latin-1).

    Resets session.headers to a minimal ASCII baseline before any of our
    headers go on, so a runner-injected default (the suspected cause of
    the 2026-05-30 em-dash crash that didn't reproduce locally) can't
    sneak through. Pulls existing session keys via .get so other config
    (proxies, adapters, cert paths) is preserved.
    """
    s = session or requests.Session()
    # Wipe the inherited defaults — requests injects User-Agent,
    # Accept-Encoding, Accept, Connection on Session() init from
    # requests.utils.default_headers(), which CAN include charset_normalizer
    # info on some installs. Replace with our sanitized baseline.
    s.headers.clear()
    for k, v in DEFAULT_HEADERS.items():
        s.headers[k] = _sanitize_header_value(v)
    # Keep-alive is the requests default; restore it explicitly so the
    # pool reuses connections across our 34 per-region calls.
    s.headers["Connection"] = "keep-alive"
    s.headers["Accept-Encoding"] = "gzip, deflate"
    return s


def fetch_vhi(country: str, province_id: int,
              year1: int, year2: int,
              type_: str = "Mean", timeout: float = 30.0,
              session: requests.Session | None = None,
              ) -> dict[str, Any]:
    """Fetch and parse a single province's VHI timeseries.

    Sandbox blocks egress to star.nesdis.noaa.gov; the live call only
    works in CI. Returns parse_vhi_text() output with the request params
    threaded through so callers can match the response to the origin map.
    """
    s = _safe_session(session)
    params = {
        "country":    country,
        "provinceID": province_id,
        "year1":      year1,
        "year2":      year2,
        "type":       type_,
    }
    r = s.get(VHI_URL, params=params, timeout=timeout)
    r.raise_for_status()
    parsed = parse_vhi_text(r.text)
    parsed["country"] = country
    parsed["query_province_id"] = province_id
    return parsed


def latest_and_recent(rows: list[VhiRow], n_recent: int = 12,
                      ) -> dict[str, Any]:
    """Pick the headline figures the frontend wants:
        vhi_latest  = most-recent (year, week, vhi, severity)
        vhi_recent  = trailing n_recent weeks as a chart-ready list

    Pure helper so the fetcher and tests stay decoupled.
    """
    if not rows:
        return {"vhi_latest": None, "vhi_recent": []}
    chronological = sorted(rows, key=lambda r: (r.year, r.week))
    tail = chronological[-n_recent:]
    head = chronological[-1]
    return {
        "vhi_latest": {
            "year":      head.year,
            "week":      head.week,
            "iso_week":  head.iso_week_key(),
            "vhi":       head.vhi,
            # TCI (thermal condition, low = heat stress) feeds the IPHM
            # heat-stress rules as the satellite second witness.
            "tci":       head.tci,
            "severity":  vhi_severity(head.vhi),
        },
        "vhi_recent": [
            {"iso_week": r.iso_week_key(), "vhi": r.vhi}
            for r in tail
        ],
    }
