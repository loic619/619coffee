#!/usr/bin/env python3
"""source_sentinel.py — publication-day detection for the monthly supply scrapers.

One cheap daily sweep replaces date-guessing: each monthly source has a
RELEASE WINDOW (derived from where its cron used to sit, opened a few days
earlier). The sentinel probes a source when
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


def probe_link_hash(pages: list[str], href_re: str, prev_signal: str | None) -> tuple[bool, str | None]:
    """Hash the sorted set of matching hrefs across listing pages. A GET
    failure on one page keeps the other pages' links (partial hash would
    false-positive, so any page failure aborts this probe run instead)."""
    links: set[str] = set()
    for page in pages:
        try:
            r = requests.get(page, headers=HEADERS, timeout=TIMEOUT)
            if r.status_code != 200:
                return False, prev_signal
            links.update(re.findall(href_re, r.text))
        except requests.RequestException:
            return False, prev_signal
    if not links:
        return False, prev_signal
    sig = hashlib.sha256("\n".join(sorted(links)).encode()).hexdigest()
    changed = prev_signal is not None and sig != prev_signal
    return changed, sig


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


SOURCES: list[dict] = [
    {
        "key": "cecafe", "label": "Cecafé monthly export report",
        "window_start": 8, "kind": "head_month", "urls": _cecafe_urls,
        "workflows": ["scraper-cecafe.yml"],
    },
    {
        "key": "dane", "label": "DANE Colombia exports XLS",
        "window_start": 1, "kind": "head_month", "urls": _dane_urls,
        "workflows": ["scraper-monthly-colombia.yml"],
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
    },
    {
        "key": "ucda", "label": "UCDA Uganda monthly report",
        "window_start": 5, "kind": "link_hash",
        "pages": ["https://ugandacoffee.go.ug/resource-center/reports/monthly-reports"],
        "href_re": r'href="([^"]*(?:file-download|sites/default/files)[^"]*)"',
        "workflows": ["scraper-monthly-uganda.yml"],
    },
    {
        "key": "conab", "label": "CONAB safra de café",
        "window_start": 5, "kind": "link_hash",
        "pages": ["https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/safra-de-cafe"],
        "href_re": r'href="([^"]+\.(?:pdf|xls[x]?))"',
        "workflows": ["scraper-monthly-conab.yml"],
    },
    {
        "key": "comex", "label": "MDIC Comex bulk import CSV",
        "window_start": 8, "kind": "lastmod",
        # The current year's file gains a month in place — Last-Modified moves.
        "url": lambda pub: f"https://balanca.economia.gov.br/balanca/bd/comexstat-bd/ncm/IMP_{pub.year}.csv",
        "workflows": ["scraper-monthly-br-fertilizer.yml"],
    },
    {
        "key": "vn_customs", "label": "Vietnam Customs monthly bulletins",
        "window_start": 8, "kind": "head_month", "urls": _vn_urls,
        # 2x (exports) and 1n (imports/fertilizer) land in the same monthly drop.
        "workflows": ["scraper-monthly-vn-exports.yml", "scraper-monthly-vn-fertilizer.yml"],
    },
]


# ── Dispatch + notify ────────────────────────────────────────────────────────

def dispatch_workflow(wf: str, dry: bool) -> bool:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    if dry or not repo or not token:
        print(f"  [dry] would dispatch {wf}")
        return True
    r = requests.post(
        f"https://api.github.com/repos/{repo}/actions/workflows/{wf}/dispatches",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json={"ref": "main"}, timeout=TIMEOUT,
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

def run(today: dt.date, dry: bool) -> int:
    state: dict = {}
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))

    expected = _period(today)
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    fired: list[str] = []

    for src in SOURCES:
        key = src["key"]
        st = state.get(key)
        baseline = st is None
        confirmed = None if baseline else st.get("confirmed")

        if not baseline and not should_probe(today.day, confirmed, expected, src["window_start"]):
            print(f"[{key}] idle (confirmed {confirmed}, window opens day {src['window_start']})")
            continue

        prev_signal = None if baseline else st.get("signal")
        if src["kind"] == "head_month":
            found, signal = probe_head_month(src["urls"](today))
        elif src["kind"] == "lastmod":
            found, signal = probe_lastmod(src["url"](today), prev_signal)
        else:
            found, signal = probe_link_hash(src["pages"], src["href_re"], prev_signal)

        entry = {"confirmed": confirmed, "signal": signal if signal is not None else prev_signal,
                 "last_probe": now_iso, "last_found": (st or {}).get("last_found")}

        if baseline:
            # First run: record the world as-is, never dispatch. head_month
            # sources whose current target already exists count as confirmed.
            entry["confirmed"] = expected if (src["kind"] == "head_month" and found) else _prev_period(expected)
            print(f"[{key}] baseline — confirmed={entry['confirmed']}, signal={'set' if entry['signal'] else 'none'}")
        elif found:
            entry["confirmed"] = expected
            entry["last_found"] = now_iso
            print(f"[{key}] NEW RELEASE detected ({src['label']}) → dispatching {src['workflows']}")
            all_ok = all(dispatch_workflow(wf, dry) for wf in src["workflows"])
            fired.append(src["label"] + ("" if all_ok else " (dispatch FAILED)"))
        else:
            late = today.day < src["window_start"] or confirmed not in (expected, _prev_period(expected))
            print(f"[{key}] probed — nothing new{' (late release, probing daily)' if late else ''}")

        state[key] = entry

    if not dry:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if fired:
        telegram("📡 source sentinel: new release detected →\n" + "\n".join(f"• {f}" for f in fired), dry)
    print(f"[sentinel] done — {len(fired)} release(s) detected.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="probe only: no state write, no dispatch, no telegram")
    args = ap.parse_args()
    return run(dt.date.today(), args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
