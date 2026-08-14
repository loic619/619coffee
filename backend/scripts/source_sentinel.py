#!/usr/bin/env python3
"""source_sentinel.py — publication-day detection for the monthly supply scrapers.

One cheap daily sweep replaces date-guessing: each monthly source has a
RELEASE WINDOW (derived from where its cron used to sit, opened a few days
earlier). Sources that publish every N months set "cadence": N (ECF is
bi-monthly) — the overdue alarm and the baseline then expect one release per
N months instead of one per month. The sentinel probes a source when
  • today is inside its window and this month's release hasn't been seen, OR
  • the release is LATE — probing continues every day past the window (even
    across the month boundary) until it lands.
On detection it marks the month confirmed, dispatches the source's heavy
scraper workflow(s) via the in-repo GitHub API, and pings Telegram so the
trial is observable. Existing monthly crons stay untouched during the trial
as the safety net; the scrapers are idempotent so a double-run is harmless.

Probe kinds (all ~1 s, no Playwright):
  head_month   — HEAD a deterministic month-stamped file URL (Cecafe, DANE,
                 VN customs bulletin). 200 = published.
  lastmod      — HEAD a fixed URL; ETag/Last-Modified/Length change = new
                 month appended (MDIC Comex bulk CSV).
  link_hash    — GET listing page(s), extract matching hrefs, hash the
                 sorted set; change = a new bulletin was posted (FNC, UCDA,
                 CONAB).

State lives in data/source_sentinels.json (committed by the workflow):
  {key: {"confirmed": "YYYY-MM", "signal": "...", "last_probe": iso,
         "last_found": iso}}
First-ever run for a key is a BASELINE: record the current signal, dispatch
nothing (the cron era already covered the current month), and let the next
real change fire.

Usage:  python backend/scripts/source_sentinel.py [--dry-run]
Env:    GITHUB_TOKEN + GITHUB_REPOSITORY  (workflow dispatch)
        TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (optional, notifications)
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
STATE_PATH = ROOT / "data" / "source_sentinels.json"

# Post-dispatch ingestion check: the expected data month must appear in the
# scraper's committed output (or its health.json timestamp must advance)
# within this many days of the dispatch, else alert.
VERIFY_DEADLINE_DAYS = 3
# A source still undetected this long past its window opening gets a
# "probe may be broken" alert (once per month) — the safety net that
# replaced the removed crons.
OVERDUE_ALERT_DAYS = 21

HEADERS = {"User-Agent": "Mozilla/5.0 (619coffee source-sentinel; +https://github.com/loic619/619coffee)"}
TIMEOUT = 25

MONTHS_PT = {
    1: "janeiro", 2: "fevereiro", 3: "marco", 4: "abril",
    5: "maio", 6: "junho", 7: "julho", 8: "agosto",
    9: "setembro", 10: "outubro", 11: "novembro", 12: "dezembro",
}
MMM_ES = {
    1: "ene", 2: "feb", 3: "mar", 4: "abr", 5: "may", 6: "jun",
    7: "jul", 8: "ago", 9: "sep", 10: "oct", 11: "nov", 12: "dic",
}


def _period(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _prev_period(period: str) -> str:
    y, m = int(period[:4]), int(period[5:7])
    return f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"


def _shift_period(period: str, by: int) -> str:
    y, m = _shift_month(int(period[:4]), int(period[5:7]), by)
    return f"{y:04d}-{m:02d}"


def _shift_month(year: int, month: int, by: int) -> tuple[int, int]:
    m = month + by
    y = year
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return y, m


def should_probe(today_day: int, confirmed: str | None, expected: str, window_start: int) -> bool:
    """The window/late rule (unit-tested):
    • already confirmed for this month → idle;
    • inside/after the window this month → probe;
    • before the window → probe ONLY if last month's release never landed
      (late spillover across the month boundary)."""
    if confirmed == expected:
        return False
    if today_day >= window_start:
        return True
    return confirmed != _prev_period(expected)


# ── Probes ────────────────────────────────────────────────────────────────────

def _head(url: str) -> requests.Response:
    return requests.head(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)


def probe_head_month(urls: list[str]) -> tuple[bool, str | None]:
    """True when any candidate month-stamped URL exists (HTTP 200)."""
    for u in urls:
        try:
            if _head(u).status_code == 200:
                return True, u
        except requests.RequestException:
            continue
    return False, None


def probe_lastmod(url: str, prev_signal: str | None) -> tuple[bool, str | None]:
    """Signal = ETag|Last-Modified|Length of a fixed URL; change = new data."""
    try:
        r = _head(url)
    except requests.RequestException:
        return False, prev_signal
    if r.status_code != 200:
        return False, prev_signal
    sig = "|".join([
        r.headers.get("ETag", ""), r.headers.get("Last-Modified", ""),
        r.headers.get("Content-Length", ""),
    ])
    changed = prev_signal is not None and sig != prev_signal
    return changed, sig


def probe_link_hash(pages: list[str], href_re: str, prev_signal: str | None,
                    headers: dict | None = None) -> tuple[bool, str | None]:
    """Hash the sorted set of matching hrefs across listing pages. A GET
    failure on one page keeps the other pages' links (partial hash would
    false-positive, so any page failure aborts this probe run instead)."""
    links: set[str] = set()
    for page in pages:
        try:
            r = requests.get(page, headers=headers or HEADERS, timeout=TIMEOUT)
            if r.status_code != 200:
                print(f"    link_hash: GET {page} → HTTP {r.status_code}")
                return False, prev_signal
            links.update(re.findall(href_re, r.text))
        except requests.RequestException as e:
            print(f"    link_hash: GET {page} failed ({type(e).__name__})")
            return False, prev_signal
    if not links:
        # Silent-failure guard: a site redesign that breaks href_re otherwise
        # looks identical to "nothing published" forever.
        print(f"    link_hash: href_re matched NOTHING across {len(pages)} page(s)")
        return False, prev_signal
    sig = hashlib.sha256("\n".join(sorted(links)).encode()).hexdigest()
    changed = prev_signal is not None and sig != prev_signal
    return changed, sig


_SLUG_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
_SLUG_PERIOD_RE = re.compile(
    rf"-({'|'.join(_SLUG_MONTHS)})(?:-({'|'.join(_SLUG_MONTHS)}))?-(\d{{4}})$")


def _period_from_slug(slug: str) -> str | None:
    """'stocks-in-european-ports-may-june-2026' → '2026-06'. A month RANGE
    resolves to its SECOND month — the data-as-of month ECF reports against
    (same rule the ecf_stocks scraper uses)."""
    m = _SLUG_PERIOD_RE.search(slug.lower())
    if not m:
        return None
    second = m.group(2) or m.group(1)
    return f"{int(m.group(3)):04d}-{_SLUG_MONTHS[second]:02d}"


_ECF_PDF_RE = re.compile(
    r'https?://(?:www\.)?ecf-coffee\.org/wp-content/uploads/'
    r'(\d{4})/(\d{2})/[^"\'<>\s]*?(\d{4})-Stocks-European-Ports[^"\'<>\s]*?\.pdf',
    re.I,
)


def _pdf_key(url: str) -> tuple[int, int, int]:
    """(data_year, upload_year, upload_month) — orders re-issues of the same
    yearly PDF, which is how ECF ships each bi-monthly update."""
    m = _ECF_PDF_RE.search(url or "")
    return (int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else (0, 0, 0)


def probe_pdf_upload(pages: list[str], post_re: str, data_file: str,
                     headers: dict | None = None, max_posts: int = 4) -> tuple[bool, str | None]:
    """ABSOLUTE publication check for ECF: the newest stocks PDF the site
    offers vs the newest our data was actually built from.

    ECF releases by re-uploading the current year's PDF under a fresh
    /uploads/YYYY/MM/ path, so the upload path — not the post text — is the
    real publication signal. ecf_history.json records the source_pdf of every
    row, giving a stateless "is the site ahead of us?" comparison that works
    on the very first probe. Any fetch failure yields no signal rather than a
    false positive."""
    blobs: list[str] = []
    posts: list[str] = []
    for page in pages:
        try:
            r = requests.get(page, headers=headers or HEADERS, timeout=TIMEOUT)
        except requests.RequestException as e:
            print(f"    pdf_upload: GET {page} failed ({type(e).__name__})")
            continue
        if r.status_code != 200:
            print(f"    pdf_upload: GET {page} → HTTP {r.status_code}")
            continue
        blobs.append(r.text)
        for u in re.findall(post_re, r.text):
            if u not in posts:
                posts.append(u)
    # The PDFs usually hang off the individual post pages, not the listing.
    for post in posts[:max_posts]:
        try:
            r = requests.get(post, headers=headers or HEADERS, timeout=TIMEOUT)
            if r.status_code == 200:
                blobs.append(r.text)
        except requests.RequestException:
            continue
    if not blobs:
        print("    pdf_upload: no ECF page reachable")
        return False, None

    site = max((m.group(0) for b in blobs for m in _ECF_PDF_RE.finditer(b)),
               key=_pdf_key, default=None)
    if not site:
        print(f"    pdf_upload: no stocks PDF link found across {len(blobs)} page(s)")
        return False, None
    try:
        text = (ROOT / data_file).read_text(encoding="utf-8")
    except OSError:
        text = ""
    have = max((m.group(0) for m in _ECF_PDF_RE.finditer(text)), key=_pdf_key, default=None)
    print(f"    pdf_upload: site {site.rsplit('/uploads/', 1)[-1]}, "
          f"ingested {have.rsplit('/uploads/', 1)[-1] if have else 'none'}")
    return (have is None or _pdf_key(site) > _pdf_key(have)), site


def probe_link_period(pages: list[str], href_re: str, data_file: str,
                      headers: dict | None = None) -> tuple[bool, str | None]:
    """ABSOLUTE publication check: the newest period advertised on the listing
    page vs the newest period already in our data.

    Unlike link_hash (a CHANGE detector that must first record a baseline and
    is therefore blind to anything published before its first probe), this
    answers "is there a published report we haven't ingested?" from scratch on
    every run. Partial page failures are tolerated — missing a page can only
    cost a detection, never invent one."""
    slugs: set[str] = set()
    reached = 0
    for page in pages:
        try:
            r = requests.get(page, headers=headers or HEADERS, timeout=TIMEOUT)
        except requests.RequestException as e:
            print(f"    link_period: GET {page} failed ({type(e).__name__})")
            continue
        if r.status_code != 200:
            print(f"    link_period: GET {page} → HTTP {r.status_code}")
            continue
        reached += 1
        slugs.update(re.findall(href_re, r.text))
    if not reached:
        print("    link_period: no listing page reachable")
        return False, None
    periods = sorted(p for p in (_period_from_slug(s) for s in slugs) if p)
    if not periods:
        print(f"    link_period: {len(slugs)} slug(s) matched on {reached} page(s), none dated")
        return False, None
    site = periods[-1]
    have = _months_in_json(ROOT / data_file)
    latest_have = max(have) if have else None
    print(f"    link_period: site latest {site} ({len(periods)} posts), "
          f"ingested latest {latest_have or 'none'}")
    return (latest_have is None or site > latest_have), site


# ── Source catalogue ─────────────────────────────────────────────────────────
# window_start = a few days before where the old cron sat, so early releases
# are caught without probing all month. data_lag = data month vs publication
# month for the head_month URL builders.

def _cecafe_urls(pub: dt.date) -> list[str]:
    y, m = _shift_month(pub.year, pub.month, -1)   # M+1 publication
    return [f"https://www.cecafe.com.br/site/wp-content/uploads/graficos/relatorio_exp_{MONTHS_PT[m]}_{y}.zip"]


def _dane_urls(pub: dt.date) -> list[str]:
    y, m = _shift_month(pub.year, pub.month, -2)   # M+2 publication
    return [f"https://www.dane.gov.co/files/operaciones/EXPORTACIONES/anex-EXPORTACIONES-{MMM_ES[m]}{y}.xls"]


def _vn_urls(pub: dt.date) -> list[str]:
    """Modern-variant candidate URLs for the 2x bulletin, publication days
    1..today of the current month (the scraper itself tries every variant —
    the sentinel only needs the common modern one to spot the drop)."""
    dy, dm = _shift_month(pub.year, pub.month, -1)  # M+1 publication
    return [
        f"https://files.customs.gov.vn/CustomsCMS/TONG_CUC/{pub.year}/{pub.month}/{d}/{dy}-t{dm}-2x(vn-sb).pdf"
        for d in range(1, min(pub.day, 28) + 1)
    ]


def _vn5x_urls(pub: dt.date) -> list[str]:
    """Same drop pattern as the 2x, different stem: the 5x '(ta-sb)' by-country
    matrix behind the export-by-destination series."""
    dy, dm = _shift_month(pub.year, pub.month, -1)  # M+1 publication
    return [
        f"https://files.customs.gov.vn/CustomsCMS/TONG_CUC/{pub.year}/{pub.month}/{d}/{dy}-t{dm}-5x(ta-sb).pdf"
        for d in range(1, min(pub.day, 28) + 1)
    ]


SOURCES: list[dict] = [
    {
        "key": "cecafe", "label": "Cecafé monthly export report",
        "window_start": 8, "kind": "head_month", "urls": _cecafe_urls,
        "workflows": ["scraper-cecafe.yml"],
        "verify": {"kind": "month_in_file", "file": "frontend/public/data/cecafe.json", "lag": 1},
    },
    {
        "key": "dane", "label": "DANE Colombia exports XLS",
        "window_start": 1, "kind": "head_month", "urls": _dane_urls,
        "workflows": ["scraper-monthly-colombia.yml"],
        "verify": {"kind": "month_in_file", "file": "frontend/public/data/colombia_supply.json", "lag": 2},
    },
    {
        "key": "fnc", "label": "FNC Colombia monthly bulletin",
        "window_start": 1, "kind": "link_hash",
        "pages": [
            "https://federaciondecafeteros.org/wp/informe-mensual-de-cifras/",
            "https://federaciondecafeteros.org/informemensualdeexporaciones/",
        ],
        "href_re": r'href="([^"]+\.pdf)"',
        "workflows": ["scraper-monthly-colombia.yml"],
        "verify": {"kind": "month_in_file", "file": "frontend/public/data/colombia_supply.json", "lag": 1},
    },
    {
        "key": "ucda", "label": "UCDA Uganda monthly report",
        "window_start": 5, "kind": "link_hash",
        "pages": ["https://ugandacoffee.go.ug/resource-center/reports/monthly-reports"],
        "href_re": r'href="([^"]*(?:file-download|sites/default/files)[^"]*)"',
        "workflows": ["scraper-monthly-uganda.yml"],
        "verify": {"kind": "month_in_file", "file": "frontend/public/data/uganda_monthly.json", "lag": 2},
    },
    {
        "key": "conab", "label": "CONAB safra de café",
        "window_start": 5, "kind": "link_hash",
        "pages": ["https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/safra-de-cafe"],
        "href_re": r'href="([^"]+\.(?:pdf|xls[x]?))"',
        "workflows": ["scraper-monthly-conab.yml"],
        "verify": {"kind": "health_ts", "keys": ["conab_costs", "conab_safra"]},
    },
    {
        "key": "comex", "label": "MDIC Comex bulk import CSV",
        "window_start": 8, "kind": "lastmod",
        # The current year's file gains a month in place — Last-Modified moves.
        "url": lambda pub: f"https://balanca.economia.gov.br/balanca/bd/comexstat-bd/ncm/IMP_{pub.year}.csv",
        "workflows": ["scraper-monthly-br-fertilizer.yml"],
        "verify": {"kind": "health_ts", "keys": ["fertilizer_comex"]},
    },
    {
        "key": "vn_customs", "label": "Vietnam Customs monthly bulletins",
        "window_start": 8, "kind": "head_month", "urls": _vn_urls,
        # 2x (exports) and 1n (imports/fertilizer) land in the same monthly drop.
        "workflows": ["scraper-monthly-vn-exports.yml", "scraper-monthly-vn-fertilizer.yml"],
        # Exports cache is the sharp signal; the fertilizer file shares the drop.
        "verify": {"kind": "month_in_file", "file": "backend/scraper/cache/vn_coffee_export.json", "lag": 1},
    },
    {
        "key": "vn_customs_dest", "label": "Vietnam Customs by-destination (5X)",
        "window_start": 8, "kind": "head_month", "urls": _vn5x_urls,
        "workflows": ["vn-customs-by-country.yml"],
        # This workflow's bare-dispatch default is 'probe' (diagnostic, no
        # commit); the data-landing path is backfill with a short lookback.
        "workflow_inputs": {"vn-customs-by-country.yml": {"mode": "backfill", "months": "2"}},
        "verify": {"kind": "month_in_file", "file": "frontend/public/data/vn_export_by_destination.json", "lag": 1},
    },
    {
        "key": "ecf", "label": "ECF European port stocks",
        # ECF ships each bi-monthly update by RE-UPLOADING the current year's
        # PDF under a fresh /uploads/YYYY/MM/ path — the post list barely moves.
        # So the probe compares the newest PDF upload the site offers against
        # the source_pdf our data was built from. Absolute (site vs data, not
        # vs a stored fingerprint), so it also catches a report published
        # before the sentinel ever looked.
        "window_start": 25, "cadence": 2, "kind": "pdf_upload", "absolute": True,
        "pages": [
            "https://www.ecf-coffee.org/category/publications/stocks/",
            "https://www.ecf-coffee.org/category/whats-new/news/",
        ],
        # Trailing "/" (the WordPress permalink form), query strings and
        # fragments all tolerated after the URL — an earlier stricter pattern
        # matched nothing on the real page and failed silently.
        "post_re": r'href="(https?://(?:www\.)?ecf-coffee\.org/stocks-in-european-ports-[^/"?#]+)[^"]*"',
        "data_file": "frontend/public/data/ecf_history.json",
        # ECF's WAF 403s bot-looking UAs — probe with the scraper's Chrome UA.
        "headers": {
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/124.0.0.0 Safari/537.36"),
            "Accept-Language": "en-US,en;q=0.9",
        },
        "workflows": ["scraper-ecf-stocks.yml"],
        # Ingested = the data now cites the very PDF we detected.
        "verify": {"kind": "string_in_file", "file": "frontend/public/data/ecf_history.json",
                   "from_signal": True},
    },
]


# ── Post-dispatch ingestion verification ─────────────────────────────────────

def _months_in_json(path: Path) -> set[str]:
    """All strict YYYY-MM strings appearing as dict keys or 'month'/'period' values."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    out: set[str] = set()

    def walk(o, depth=0):
        if depth > 6:
            return
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(k, str) and re.fullmatch(r"\d{4}-\d{2}", k):
                    out.add(k)
                if k in ("month", "period") and isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}", v):
                    out.add(v)
                walk(v, depth + 1)
        elif isinstance(o, list):
            for it in o[:800]:
                walk(it, depth + 1)

    walk(data)
    return out


def _parse_any_ts(ts: str) -> dt.datetime | None:
    try:
        d = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=dt.UTC)
    except (ValueError, AttributeError):
        return None


def check_ingested(verify: dict) -> bool:
    """Did the dispatched scraper actually land the update in the repo?"""
    if verify["kind"] == "month_in_file":
        return verify["expected"] in _months_in_json(ROOT / verify["file"])
    if verify["kind"] == "string_in_file":
        # e.g. the source PDF the detection pointed at is now cited in the data.
        try:
            return verify["expected"] in (ROOT / verify["file"]).read_text(encoding="utf-8")
        except OSError:
            return False
    # health_ts: every listed health.json scraper timestamp must postdate the dispatch.
    try:
        scr = json.loads((ROOT / "frontend/public/data/health.json").read_text(encoding="utf-8"))["scrapers"]
    except (OSError, json.JSONDecodeError, KeyError):
        return False
    dispatched = _parse_any_ts(verify["dispatched_at"])
    if dispatched is None:
        return False
    for key in verify["keys"]:
        ts = _parse_any_ts(scr.get(key) or "")
        if ts is None or ts <= dispatched:
            return False
    return True


def build_verify(src: dict, pub_period: str, now_iso: str,
                 signal: str | None = None) -> dict | None:
    spec = src.get("verify")
    if not spec:
        return None
    v = {"kind": spec["kind"], "dispatched_at": now_iso, "status": "pending"}
    if spec.get("from_signal"):
        # Absolute probes already resolved exactly what to look for (the data
        # month, or the source PDF the release was detected at).
        if not signal:
            return None
        v["file"] = spec["file"]
        v["expected"] = signal
    elif spec["kind"] == "month_in_file":
        y, m = int(pub_period[:4]), int(pub_period[5:7])
        ey, em = _shift_month(y, m, -spec["lag"])
        if spec.get("snap_even") and em % 2:
            # Bi-monthly pairs end on even months; a release detected one
            # month past its slot still carries the same pair's data.
            ey, em = _shift_month(ey, em, -1)
        v["file"] = spec["file"]
        v["expected"] = f"{ey:04d}-{em:02d}"
    else:
        v["keys"] = spec["keys"]
    return v


# ── Dispatch + notify ────────────────────────────────────────────────────────

def dispatch_workflow(wf: str, dry: bool, inputs: dict | None = None) -> bool:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    if dry or not repo or not token:
        print(f"  [dry] would dispatch {wf} inputs={inputs}")
        return True
    body: dict = {"ref": "main"}
    if inputs:
        body["inputs"] = inputs
    r = requests.post(
        f"https://api.github.com/repos/{repo}/actions/workflows/{wf}/dispatches",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json=body, timeout=TIMEOUT,
    )
    ok = r.status_code == 204
    print(f"  dispatch {wf}: {'ok' if ok else f'FAILED {r.status_code} {r.text[:120]}'}")
    return ok


def telegram(msg: str, dry: bool) -> None:
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if dry or not tok or not chat:
        return
    try:
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      data={"chat_id": chat, "text": msg}, timeout=TIMEOUT)
    except requests.RequestException:
        pass


# ── Main ─────────────────────────────────────────────────────────────────────

def run(today: dt.date, dry: bool, verify_only: bool = False) -> int:
    state: dict = {}
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))

    expected = _period(today)
    now = dt.datetime.now(dt.UTC)
    now_iso = now.isoformat(timespec="seconds")
    fired: list[str] = []
    verified: list[str] = []
    alerts: list[str] = []

    for src in SOURCES:
        key = src["key"]
        st = state.get(key)
        baseline = st is None
        confirmed = None if baseline else st.get("confirmed")

        # ── Phase 0: ingestion verification for a previous dispatch ──────────
        # Runs regardless of the probe decision (the source is usually idle by
        # the time we verify). Pending → ok when the update is visible in the
        # committed data; pending past the deadline → alert once.
        if st and (v := st.get("verify")) and v.get("status") == "pending":
            if check_ingested(v):
                v["status"] = "ok"
                exp = v.get("expected") or ""
                what = exp or ", ".join(v.get("keys", []))
                if what.startswith("http"):   # a source PDF — show its upload path
                    what = what.rsplit("/uploads/", 1)[-1]
                line = f"{src['label']} — {what} now in the data"
                # Attach the headline numbers so the export figures ride the
                # confirmation the moment they land (best-effort). A non-month
                # marker (e.g. a PDF URL) lets the digest pick the newest month.
                digest = _origin_digest(key, exp if re.fullmatch(r"\d{4}-\d{2}", exp) else None)
                if digest:
                    line += "\n" + digest
                verified.append(line)
                print(f"[{key}] ingestion VERIFIED ({v.get('expected') or ','.join(v.get('keys', []))})")
            else:
                disp = _parse_any_ts(v["dispatched_at"])
                if disp and (now - disp).days >= VERIFY_DEADLINE_DAYS:
                    v["status"] = "alerted"
                    alerts.append(f"{src['label']}: dispatched {v['dispatched_at'][:10]} but the update "
                                  f"never appeared in the data — check the scraper run")
                    print(f"[{key}] ingestion NOT verified after {VERIFY_DEADLINE_DAYS}d — alerting")
                else:
                    print(f"[{key}] ingestion pending (dispatched {v['dispatched_at'][:10]})")

        # --verify-only: this run exists purely to close the loop on an
        # already-dispatched release the moment its data is committed, so the
        # digest lands the same day instead of waiting for tomorrow's sweep.
        # No probing, no dispatching — the mutated verify dict is already part
        # of `state` (same object), so the status change persists.
        if verify_only:
            continue

        if not baseline and not should_probe(today.day, confirmed, expected, src["window_start"]):
            print(f"[{key}] idle (confirmed {confirmed}, window opens day {src['window_start']})")
            continue

        prev_signal = None if baseline else st.get("signal")
        if src["kind"] == "head_month":
            found, signal = probe_head_month(src["urls"](today))
        elif src["kind"] == "lastmod":
            found, signal = probe_lastmod(src["url"](today), prev_signal)
        elif src["kind"] == "pdf_upload":
            found, signal = probe_pdf_upload(src["pages"], src["post_re"],
                                             src["data_file"], src.get("headers"))
        elif src["kind"] == "link_period":
            found, signal = probe_link_period(src["pages"], src["href_re"],
                                              src["data_file"], src.get("headers"))
        else:
            found, signal = probe_link_hash(src["pages"], src["href_re"], prev_signal,
                                            src.get("headers"))

        entry = {"confirmed": confirmed, "signal": signal if signal is not None else prev_signal,
                 "last_probe": now_iso, "last_found": (st or {}).get("last_found"),
                 "verify": (st or {}).get("verify"),
                 "overdue_alerted": (st or {}).get("overdue_alerted")}

        if baseline and not (src.get("absolute") and found):
            # First run: record the world as-is, never dispatch. head_month
            # sources whose current target already exists count as confirmed.
            # Cadence-N sources start N months back so a release already due
            # keeps the daily late-spillover probing until it lands. An
            # `absolute` probe is exempt — it compares site vs data rather
            # than vs a stored signal, so a hit on the first run is real.
            entry["confirmed"] = (expected if (src["kind"] == "head_month" and found)
                                  else _shift_period(expected, -src.get("cadence", 1)))
            print(f"[{key}] baseline — confirmed={entry['confirmed']}, signal={'set' if entry['signal'] else 'none'}")
        elif found:
            entry["confirmed"] = expected
            entry["last_found"] = now_iso
            print(f"[{key}] NEW RELEASE detected ({src['label']}) → dispatching {src['workflows']}")
            all_ok = all(dispatch_workflow(wf, dry, src.get("workflow_inputs", {}).get(wf))
                         for wf in src["workflows"])
            fired.append(f"{src['label']} — "
                         + (f"{signal} report" if src.get("absolute") and signal
                            else f"{expected} publication")
                         + ("" if all_ok else " (dispatch FAILED)"))
            entry["verify"] = build_verify(src, expected, now_iso, signal)
        else:
            late = today.day < src["window_start"] or confirmed not in (expected, _prev_period(expected))
            print(f"[{key}] probed — nothing new{' (late release, probing daily)' if late else ''}")
            # ── Overdue alarm: undetected long past the window opening. With
            # the crons gone, this is what catches a silently-broken probe
            # (e.g. the source changed its URL pattern). Once per month.
            days_over = _days_past_window(today, confirmed, src["window_start"],
                                          src.get("cadence", 1))
            if days_over >= OVERDUE_ALERT_DAYS and entry.get("overdue_alerted") != expected:
                entry["overdue_alerted"] = expected
                alerts.append(f"{src['label']}: still undetected {days_over}d past its window — "
                              f"the probe pattern may be broken; run the scraper manually")
                print(f"[{key}] OVERDUE {days_over}d past window — alerting")

        state[key] = entry

    if not dry:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    # ── Weekly topic texts (COT / freight) — their JSONs materialize via the
    # export pipeline, so they ride this daily run, deduped once per new
    # report/update through the state file.
    topics_state = state.setdefault("_topics", {})
    for topic, key_fn, compose in _topic_specs():
        try:
            data_key = key_fn()
            if not data_key or topics_state.get(topic) == data_key:
                continue
            text = compose(now)
            if text:
                telegram(text, dry)
                topics_state[topic] = data_key
                print(f"[topic:{topic}] sent for {data_key}")
            elif not _fresh_enough(topic, data_key, now):
                # data key changed long ago (pre-rollout backlog) — mark seen
                # without sending so we don't replay history.
                topics_state[topic] = data_key
        except Exception as e:  # noqa: BLE001 — topics must never break the sweep
            print(f"[topic:{topic}] skipped ({e})")

    lines = []
    if fired:
        lines.append("📡 NEW RELEASE — scraper dispatched:\n" + "\n".join(f"• {f}" for f in fired))
    if verified:
        lines.append("✅ ingestion check passed (follow-up on an earlier dispatch — no new fetch):\n"
                     + "\n".join(f"• {v}" for v in verified))
    if alerts:
        lines.append("⚠️ needs a look →\n" + "\n".join(f"• {a}" for a in alerts))
    if lines:
        telegram("source sentinel:\n" + "\n".join(lines), dry)
    mode = "verify-only" if verify_only else "sweep"
    print(f"[sentinel] done ({mode}) — {len(fired)} detected, {len(verified)} verified, "
          f"{len(alerts)} alert(s).")
    return 0


def _topic_specs():
    sys.path.insert(0, str(ROOT / "backend"))
    from scraper import topic_notify as tn
    return [
        ("cot",     tn.latest_cot_key,     tn.compose_cot),
        ("freight", tn.latest_freight_key, tn.compose_freight),
    ]


def _fresh_enough(topic: str, data_key: str, now: dt.datetime) -> bool:
    """True while the composer's own freshness gate could still fire for this
    key (cot: 4 d, freight: 1.5 d) — used to age out pre-rollout backlog."""
    try:
        d = dt.datetime.fromisoformat(data_key[:10]).replace(tzinfo=dt.UTC)
    except ValueError:
        return False
    return (now - d).total_seconds() <= (4 if topic == "cot" else 1.5) * 86400


def _origin_digest(sentinel_key: str, month: str | None) -> str | None:
    """Headline numbers for a verified month via scraper.topic_notify —
    lazily imported; any failure degrades to the plain confirmation line.
    month=None is legitimate for sources verified by something other than a
    month (ECF): the composer then reports the newest month it holds."""
    try:
        sys.path.insert(0, str(ROOT / "backend"))
        from scraper.topic_notify import compose_origin_digest
        return compose_origin_digest(sentinel_key, month)
    except Exception:  # noqa: BLE001
        return None


def _days_past_window(today: dt.date, confirmed: str | None, window_start: int,
                      cadence: int = 1) -> int:
    """Days since the window opened for the oldest month still pending.
    Pending month = `cadence` months after the last confirmed one (clamped to
    the current month); 0 when nothing is pending yet."""
    expected = _period(today)
    if confirmed is None or confirmed >= expected:
        return 0
    y, m = int(confirmed[:4]), int(confirmed[5:7])
    py, pm = _shift_month(y, m, cadence)
    pend = f"{py:04d}-{pm:02d}"
    if pend > expected:
        return 0
    open_date = dt.date(int(pend[:4]), int(pend[5:7]), min(window_start, 28))
    return max(0, (today - open_date).days)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="probe only: no state write, no dispatch, no telegram")
    ap.add_argument("--verify-only", action="store_true",
                    help="skip probing/dispatch; just close out pending ingestion checks "
                         "(run after a scraper commits so its digest lands the same day)")
    args = ap.parse_args()
    return run(dt.date.today(), args.dry_run, args.verify_only)


if __name__ == "__main__":
    sys.exit(main())
