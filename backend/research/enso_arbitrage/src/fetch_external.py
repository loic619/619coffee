"""Fetch the external price series the Tier-1 study needs. Runner-side only.

The Claude Code sandbox has no outbound HTTPS, so this runs on a GitHub Actions
runner (workflow `research-enso-arbitrage-fetch.yml`) and commits what it finds
under `data/raw/`, with a MANIFEST recording url, retrieval time, size and
sha256 for every file. Nothing here parses anything into a study series — that
is `load_external.py`, which runs anywhere, offline, from the committed raw
files. Keeping the two apart is what makes the study reproducible from raw.

What is fetched, and why each one is on the list
------------------------------------------------
ICO (approved)          The International Coffee Organization publishes, back to
                        1990, monthly averages of the ICE New York and London
                        futures and of its group indicator prices. That history
                        is the whole reason Tier 1 exists: the repo's own price
                        record is 5 years long and contains one ENSO episode per
                        phase. ICO has reorganised its site more than once, so
                        the file names are not guessed — the historical-data
                        pages are crawled and every price/futures spreadsheet
                        they link to is taken.
World Bank Pink Sheet   (approved) Monthly ICO Other Milds and Robustas
                        indicator prices from 1960, USD/kg. A second, physical
                        ex-dock variant of the arbitrage for robustness.
Stooq KC.F / RC.F       Daily continuous front-month history for both
                        exchanges. FALLBACK ONLY for the ICO futures files, and
                        the same source the production scraper already falls
                        back to. Roll method undocumented, so it is a
                        cross-check rather than a primary series.
FRED (IMF) indicators   The IMF's copy of the same ICO indicator prices, 1990→.
                        Used only to validate the Pink Sheet parse — two
                        independent copies of one series catch a column error.

Every download is best-effort: a source that fails is recorded in the manifest
as failed and the run continues, so one moved file cannot cost the others.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
RAW = DATA / "raw"
MANIFEST = DATA / "MANIFEST.json"

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
TIMEOUT = 60
MAX_FILE_BYTES = 30 * 1024 * 1024
MAX_CRAWL_FILES = 40
DOC_EXT = (".xls", ".xlsx", ".csv", ".pdf")

# Hosts a crawl may follow links to. Anything else is dropped without a request.
ALLOWED_HOSTS = {"ico.org", "www.ico.org", "icocoffee.org", "www.icocoffee.org",
                 "worldbank.org", "www.worldbank.org", "thedocs.worldbank.org",
                 "stooq.com", "fred.stlouisfed.org"}

SOURCES: list[dict] = [
    {
        "id": "ico_historical",
        "kind": "crawl",
        "pages": [
            "https://www.ico.org/new_historical.asp",
            "https://ico.org/new_historical.asp",
            "https://www.ico.org/coffee_prices.asp",
            "https://www.ico.org/prices/",
            "https://icocoffee.org/resources/historical-data/",
            "https://icocoffee.org/resources/coffee-prices/",
            "https://ico.org/resources/historical-data-on-the-global-coffee-trade/",
            "https://icocoffee.org/documents/",
        ],
        "match": r"(price|futures|indicator|grower|new.?york|london|monthly|averag|histor|xls)",
        "note": "ICO historical data: NY/London futures and indicator prices, monthly, 1990→ (approved).",
    },
    {
        "id": "ico_direct",
        "kind": "files",
        "urls": [
            # ICO's own page links these paths on ico.org and they 404 there
            # (site migrated 2024→); the same paths on the new domain are tried.
            "https://icocoffee.org/historical/1990%20onwards/Excel/3c%20-%20Indicator%20prices.xlsx",
            "https://www.icocoffee.org/historical/1990%20onwards/Excel/3c%20-%20Indicator%20prices.xlsx",
            "https://icocoffee.org/historical/1990%20onwards/Excel/3a%20-%20Prices%20paid%20to%20growers.xlsx",
            "https://www.icocoffee.org/historical/1990%20onwards/Excel/3a%20-%20Prices%20paid%20to%20growers.xlsx",
            "https://icocoffee.org/historical/1990%20onwards/Excel/1a%20-%20Total%20production.xlsx",
            "https://ico.org/wp-content/uploads/historical/1990%20onwards/Excel/3c%20-%20Indicator%20prices.xlsx",
            "https://www.ico.org/historical/1990%20onwards/Excel/3a%20-%20Prices%20paid%20to%20growers.xlsx",
            "https://www.ico.org/historical/1990%20onwards/Excel/3b%20-%20Retail%20prices.xlsx",
            "https://www.ico.org/historical/1990%20onwards/Excel/2a%20-%20Prices%20paid%20to%20growers.xlsx",
            "https://www.ico.org/historical/1990%20onwards/Excel/1a%20-%20Total%20production.xlsx",
            "https://www.ico.org/historical/1990%20onwards/Excel/1e%20-%20Exports%20-%20crop%20year.xlsx",
            "https://www.ico.org/prices/pr-prices.pdf",
        ],
        "note": "ICO files by their historical names, in case the crawl pages have moved.",
    },
    {
        # The document id in the URL changes with every monthly release; the
        # pinned one below is a Jan-2025 snapshot (data to 2024M12). The CMO
        # page is crawled FIRST so the current file lands alongside it.
        "id": "worldbank_pink_sheet_current",
        "kind": "crawl",
        "pages": ["https://www.worldbank.org/en/research/commodity-markets"],
        "match": r"CMO-Historical-Data-Monthly",
        "note": "World Bank CMO 'Pink Sheet', latest monthly release (approved).",
    },
    {
        "id": "worldbank_pink_sheet_monthly",
        "kind": "files",
        "urls": [
            "https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021/related/"
            "CMO-Historical-Data-Monthly.xlsx",
        ],
        "note": "World Bank CMO 'Pink Sheet', monthly, 1960→: COFFEE_ARABIC / COFFEE_ROBUS (approved). Jan-2025 snapshot.",
    },
    {
        "id": "stooq_kc_f_daily",
        "kind": "files",
        "urls": ["https://stooq.com/q/d/l/?s=kc.f&i=d"],
        "filename": "kc_f_daily.csv",
        "note": "Stooq continuous front KC. Fallback for ICO NY futures; roll method undocumented.",
    },
    {
        "id": "stooq_rc_f_daily",
        "kind": "files",
        "urls": ["https://stooq.com/q/d/l/?s=rc.f&i=d"],
        "filename": "rc_f_daily.csv",
        "note": "Stooq continuous front RC. Fallback for ICO London futures; roll method undocumented.",
    },
    {
        "id": "fred_imf_other_milds",
        "kind": "files",
        "urls": ["https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCOFFOTMUSDM"],
        "filename": "PCOFFOTMUSDM.csv",
        "note": "IMF Other Mild Arabicas (ICO indicator) via FRED, monthly 1990→. Parse cross-check only.",
    },
    {
        "id": "fred_imf_robusta",
        "kind": "files",
        "urls": ["https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCOFFROBUSDM"],
        "filename": "PCOFFROBUSDM.csv",
        "note": "IMF Robusta (ICO indicator) via FRED, monthly 1990→. Parse cross-check only.",
    },
]


# ── plumbing ─────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _safe_name(url: str, fallback: str | None = None) -> str:
    if fallback:
        return fallback
    name = Path(urlparse(url).path).name or "download"
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name[:120]


def _get(url: str, session: requests.Session, stream_max: int = MAX_FILE_BYTES) -> tuple[int, bytes, str, str]:
    """Return (status, body, content_type, final_url). Never raises."""
    try:
        r = session.get(url, timeout=TIMEOUT, allow_redirects=True, stream=True)
        body = b""
        for chunk in r.iter_content(chunk_size=65536):
            body += chunk
            if len(body) > stream_max:
                r.close()
                return r.status_code, body, "too_large", r.url
        return r.status_code, body, r.headers.get("Content-Type", ""), r.url
    except Exception as exc:  # noqa: BLE001 — every failure is recorded, not raised
        return 0, b"", f"error:{type(exc).__name__}:{exc}"[:200], url


def _looks_like_html(body: bytes, ctype: str) -> bool:
    head = body[:400].lower()
    return "text/html" in ctype.lower() or b"<html" in head or b"<!doctype html" in head


def _save(source_id: str, url: str, body: bytes, ctype: str, final_url: str, status: int,
          filename: str | None, note: str) -> dict:
    d = RAW / source_id
    d.mkdir(parents=True, exist_ok=True)
    entry = {"source": source_id, "url": url, "final_url": final_url, "status": status,
             "content_type": ctype, "bytes": len(body), "retrieved_at": _now(), "note": note}
    ok = status == 200 and body and ctype != "too_large"
    # A 200 that is really an HTML error page must not be filed as data.
    if ok and _looks_like_html(body, ctype) and not url.endswith((".htm", ".html", "/")):
        ok = False
        entry["problem"] = "html_body_for_document_url"
    if ok:
        name = _safe_name(final_url if not filename else url, filename)
        path = d / name
        path.write_bytes(body)
        entry.update({"file": str(path.relative_to(DATA.parent)), "sha256": _sha256(body), "ok": True})
    else:
        entry["ok"] = False
    return entry


def _links(page_html: str, base: str) -> list[tuple[str, str]]:
    """(absolute_url, anchor_text) for every <a href> on the page; bs4 if present, regex otherwise."""
    out = []
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(page_html, "html.parser")
        for a in soup.find_all("a", href=True):
            out.append((urljoin(base, a["href"]), a.get_text(" ", strip=True)))
    except ImportError:
        for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', page_html, re.I | re.S):
            out.append((urljoin(base, m.group(1)), re.sub(r"<[^>]+>", " ", m.group(2)).strip()))
    return out


def crawl(pages: list[str], match: str, session: requests.Session, source_id: str, note: str,
          manifest: list[dict], max_files: int = MAX_CRAWL_FILES) -> None:
    rx = re.compile(match, re.I)
    seen: set[str] = set()
    taken = 0
    for page in pages:
        status, body, ctype, final = _get(page, session)
        manifest.append({"source": source_id, "url": page, "final_url": final, "status": status,
                         "content_type": ctype, "bytes": len(body), "retrieved_at": _now(),
                         "role": "index_page", "ok": status == 200})
        if status != 200 or not body:
            print(f"  [{source_id}] index {page} → {status}")
            continue
        html = body.decode("utf-8", "replace")
        links = _links(html, final)
        # Keep the index page and its full link list: when a site has moved,
        # the diagnostic that matters is "what does it link to", not "0 files".
        d = RAW / source_id
        d.mkdir(parents=True, exist_ok=True)
        tag = re.sub(r"[^a-z0-9]+", "_", urlparse(final).netloc + urlparse(final).path)[:80]
        (d / f"index_{tag}.html").write_bytes(body)
        (d / f"links_{tag}.txt").write_text("\n".join(f"{h}\t{t[:100]}" for h, t in links), encoding="utf-8")
        cands = []
        for href, text in links:
            host = urlparse(href).netloc.lower()
            if host not in ALLOWED_HOSTS:
                continue
            path = urlparse(href).path.lower()
            # a document is a known extension, OR a download/upload path whose
            # text or url talks about prices — sites hide extensions behind
            # download handlers, and an HTML body is rejected at save time anyway
            doc_like = path.endswith(DOC_EXT) or "download" in href.lower() or "wp-content/uploads" in href.lower() \
                or "/documents/" in href.lower()
            if not doc_like:
                continue
            if not (rx.search(href) or rx.search(text or "")):
                continue
            if href in seen:
                continue
            seen.add(href)
            cands.append((href, text))
        print(f"  [{source_id}] index {page} → {status}, {len(links)} links, {len(cands)} candidates")
        for href, text in cands:
            if taken >= max_files:
                print(f"  [{source_id}] cap of {max_files} files reached")
                return
            s, b, ct, fu = _get(href, session)
            e = _save(source_id, href, b, ct, fu, s, None, f"{note} · link text: {text[:80]}")
            e["anchor_text"] = text[:200]
            e["found_on"] = page
            manifest.append(e)
            taken += 1
            print(f"     {'ok ' if e.get('ok') else 'MISS'} {s} {len(b):>9} B  {href}")


def fetch_files(src: dict, session: requests.Session, manifest: list[dict]) -> int:
    got = 0
    for url in src["urls"]:
        s, b, ct, fu = _get(url, session)
        e = _save(src["id"], url, b, ct, fu, s, src.get("filename"), src["note"])
        manifest.append(e)
        print(f"  [{src['id']}] {'ok ' if e.get('ok') else 'MISS'} {s} {len(b):>9} B  {url}")
        got += 1 if e.get("ok") else 0
    if not got and src.get("fallback_crawl"):
        fc = src["fallback_crawl"]
        crawl(fc["pages"], fc["match"], session, src["id"], src["note"] + " (via fallback crawl)", manifest)
    return got


# ── an index of what landed, so the next step can be planned without opening every file ──

def _preview(path: Path) -> list[str]:
    lines: list[str] = []
    suf = path.suffix.lower()
    try:
        if suf == ".xlsx":
            import openpyxl
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            for ws in wb.worksheets[:12]:
                lines.append(f"  sheet `{ws.title}` max_row={getattr(ws, 'max_row', '?')}")
                for i, row in enumerate(ws.iter_rows(values_only=True)):
                    if i >= 8:
                        break
                    lines.append("    " + " | ".join("" if c is None else str(c)[:18] for c in row[:12]))
        elif suf == ".xls":
            import xlrd
            wb = xlrd.open_workbook(path)
            for sh in wb.sheets()[:12]:
                lines.append(f"  sheet `{sh.name}` rows={sh.nrows} cols={sh.ncols}")
                for r in range(min(8, sh.nrows)):
                    lines.append("    " + " | ".join(str(sh.cell_value(r, c))[:18] for c in range(min(12, sh.ncols))))
        elif suf == ".csv":
            with path.open("r", encoding="utf-8", errors="replace") as fh:
                for i, line in enumerate(fh):
                    if i >= 6:
                        break
                    lines.append("    " + line.rstrip()[:160])
            n = sum(1 for _ in path.open("r", encoding="utf-8", errors="replace"))
            lines.append(f"  rows={n}")
        elif suf == ".pdf":
            try:
                import pdfplumber
                with pdfplumber.open(path) as pdf:
                    lines.append(f"  pages={len(pdf.pages)}")
                    txt = (pdf.pages[0].extract_text() or "")[:600]
                    lines.extend("    " + t for t in txt.splitlines()[:10])
            except ImportError:
                lines.append("  (pdfplumber not installed)")
    except Exception as exc:  # noqa: BLE001 — a preview failure is information, not a stop
        lines.append(f"  preview failed: {type(exc).__name__}: {exc}")
    return lines


def write_index(manifest: list[dict]) -> Path:
    out = RAW / "INDEX.md"
    parts = ["# Raw external files — what landed\n",
             f"_Generated {_now()} by fetch_external.py. Previews only; the study reads these through "
             "`load_external.py`._\n"]
    for e in manifest:
        if not e.get("ok") or not e.get("file"):
            continue
        p = DATA.parent / e["file"]
        parts.append(f"\n## {e['file']}\n\n- source `{e['source']}` · {e['bytes']} B · sha256 `{e.get('sha256', '')[:16]}…`"
                     f"\n- url: {e['url']}\n- note: {e.get('note', '')}\n")
        parts.append("```")
        parts.extend(_preview(p))
        parts.append("```")
    failed = [e for e in manifest if not e.get("ok")]
    if failed:
        parts.append("\n## Not retrieved\n")
        for e in failed:
            parts.append(f"- `{e['source']}` {e.get('status')} {e.get('content_type', '')[:60]} — {e['url']}")
    out.write_text("\n".join(parts) + "\n", encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", nargs="*", help="source ids to fetch (default: all)")
    args = ap.parse_args(argv)

    RAW.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept": "*/*"})
    manifest: list[dict] = []
    for src in SOURCES:
        if args.only and src["id"] not in args.only:
            continue
        print(f"== {src['id']}")
        if src["kind"] == "crawl":
            crawl(src["pages"], src["match"], session, src["id"], src["note"], manifest)
        else:
            fetch_files(src, session, manifest)

    ok = [e for e in manifest if e.get("ok") and e.get("file")]
    doc = {"generated_at": _now(), "files_ok": len(ok), "entries": manifest,
           "note": "Raw external inputs for backend/research/enso_arbitrage. Every file is listed with the url "
                   "it came from, when, its size and sha256. Re-run the fetch workflow to refresh; the study "
                   "itself never touches the network."}
    MANIFEST.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    idx = write_index(manifest)
    print(f"\n{len(ok)} files retrieved; manifest {MANIFEST}; index {idx}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
