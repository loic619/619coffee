"""
fetch_sucafina_reports.py — weekly Sucafina EMEA origin reports → dashboard.

The landing page https://sucafina.com/emea/lp/origin-report lists one link per
week ("22 July 2026", "15 July 2026", …), each pointing at a PDF on the
Kontent.ai asset CDN (assets-…kc-usercontent.com). The PDFs carry short
per-origin market notes written by Sucafina's sister companies — exactly the
origin-news feed that replaced the Daily Coffee News RSS source.

Mechanics:
  1. The landing page sits behind bot protection (plain requests → 403), so it
     is loaded with Playwright (the repo's proven CI path for such sites) and
     every anchor whose text parses as a date is collected.
  2. PDFs are fetched through the same browser context (CDN assets download
     fine there; a plain-requests fallback is attempted first since the CDN is
     usually open).
  3. Text is extracted with pdfplumber and split into per-origin sections by
     heading detection against a known origin vocabulary. Reports whose
     headings don't match (layout drift, image-only PDFs) still ship with the
     raw text/URL — the panel always has at least the link.

Output (merged by date, last ~30 weeks kept):
  frontend/public/data/sucafina_reports.json
  {"scraped_at": …, "reports": [{"date": "2026-07-22", "label": "22 July 2026",
      "url": …, "origins": {"Brazil": "…", "Vietnam": "…"}, "parse_ok": true}]}

Run: weekly workflow (.github/workflows/scraper-sucafina.yml) or manually.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_REPO    = Path(__file__).resolve().parents[2]
OUT_PATH = _REPO / "frontend" / "public" / "data" / "sucafina_reports.json"

_PAGE = "https://sucafina.com/emea/lp/origin-report"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

_KEEP_WEEKS = 30

_MONTHS = {m.lower(): i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"])}
_MONTHS.update({m[:3].lower(): v for m, v in list(_MONTHS.items())})
_MONTHS["sept"] = 9   # common 4-letter abbreviation

# Section headings recognised inside the PDFs. Order matters only for display;
# matching is case-insensitive on short heading-like lines.
_ORIGINS = [
    "Global", "Market", "Macro", "Outlook",
    "Brazil", "Vietnam", "Colombia", "Indonesia", "Uganda", "India",
    "Ethiopia", "Kenya", "Tanzania", "Rwanda", "Burundi", "Honduras",
    "Guatemala", "Nicaragua", "El Salvador", "Costa Rica", "Peru", "Mexico",
    "Papua New Guinea", "Ivory Coast", "Côte d'Ivoire", "Cameroon", "Congo",
    "DR Congo", "Yemen", "China", "Laos", "Myanmar", "Ecuador", "Bolivia",
]


def _parse_date(text: str) -> str | None:
    """'22 July 2026' / '24 Jun 2026' → '2026-07-22' (None if not a date)."""
    m = re.match(r"^\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\s*$", text or "")
    if not m:
        return None
    mon = _MONTHS.get(m.group(2).lower())
    if not mon:
        return None
    try:
        return f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(1)):02d}"
    except ValueError:
        return None


async def _collect(existing_dates: set[str]) -> list[dict]:
    """[{date,label,url,pdf_bytes}] for links whose date isn't stored yet."""
    from playwright.async_api import async_playwright
    out: list[dict] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=_UA)
        pg = await ctx.new_page()
        try:
            await pg.goto(_PAGE, wait_until="domcontentloaded", timeout=60000)
            await pg.wait_for_timeout(5000)          # Kontent hydration
            links = await pg.evaluate(
                "() => [...document.querySelectorAll('a')]"
                ".map(a => ({t: (a.textContent||'').trim(), h: a.href}))"
                ".filter(x => x.h)")
            dated = []
            for l in links:
                iso = _parse_date(l["t"])
                if iso:
                    dated.append({"date": iso, "label": l["t"], "url": l["h"]})
            print(f"[sucafina] page links: {len(links)} · dated: {len(dated)}")
            if not dated:
                # diagnostics for layout drift — first 15 link texts
                for l in links[:15]:
                    print(f"  link: {l['t'][:50]!r} → {l['h'][:80]}")
            for d in dated:
                if d["date"] in existing_dates:
                    continue
                resp = await pg.request.get(d["url"], timeout=60000)
                if resp.ok:
                    d["pdf_bytes"] = await resp.body()
                    print(f"[sucafina] {d['date']}: downloaded {len(d['pdf_bytes'])//1024}KB")
                    out.append(d)
                else:
                    print(f"[sucafina] {d['date']}: download failed HTTP {resp.status}")
        except Exception as e:  # noqa: BLE001
            print(f"[sucafina] page error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out


def _split_origins(text: str) -> dict[str, str]:
    """Split report text into {origin: section} by heading lines."""
    sections: dict[str, list[str]] = {}
    current = None
    vocab = {o.lower(): o for o in _ORIGINS}
    for raw in (text or "").splitlines():
        line = raw.strip()
        key = re.sub(r"[:\s]+$", "", line).lower()
        if key in vocab and len(line) <= 40:
            current = vocab[key]
            sections.setdefault(current, [])
            continue
        if current and line:
            sections[current].append(line)
    return {k: " ".join(v).strip() for k, v in sections.items() if v}


def parse_pdf(pdf_bytes: bytes) -> tuple[dict[str, str], str]:
    """(origin sections, full text). Empty sections ⇒ heading detection failed
    (layout drift or image-only PDF) — the raw text still ships."""
    import pdfplumber
    parts = []
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    full = "\n".join(parts).strip()
    return _split_origins(full), full


def run() -> dict:
    existing: list[dict] = []
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding="utf-8")).get("reports") or []
        except Exception:
            existing = []
    have = {r["date"] for r in existing}

    fresh = asyncio.run(_collect(have))
    added = 0
    for d in fresh:
        try:
            origins, full = parse_pdf(d.pop("pdf_bytes"))
        except Exception as e:  # noqa: BLE001
            print(f"[sucafina] {d['date']}: pdf parse failed — {e}")
            origins, full = {}, ""
        parse_ok = bool(origins)
        if not parse_ok:
            print(f"[sucafina] {d['date']}: no origin headings matched "
                  f"({len(full)} chars of text) — shipping raw")
        existing.append({
            **d,
            "origins": origins,
            # raw fallback so the panel is never empty; capped to keep the JSON sane
            "full_text": "" if parse_ok else full[:8000],
            "parse_ok": parse_ok,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        })
        added += 1

    if not added:
        print("[sucafina] no new reports")
        return {"ok": True, "added": 0, "total": len(existing)}

    reports = sorted(existing, key=lambda r: r["date"], reverse=True)[:_KEEP_WEEKS]
    OUT_PATH.write_text(json.dumps(
        {"scraped_at": datetime.utcnow().isoformat() + "Z",
         "source": _PAGE, "reports": reports},
        ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for r in reports if r.get("parse_ok"))
    print(f"[sucafina] +{added} new · {len(reports)} stored ({ok} fully parsed) "
          f"· latest {reports[0]['date']}")
    return {"ok": True, "added": added, "total": len(reports)}


if __name__ == "__main__":
    argparse.ArgumentParser(description="Fetch Sucafina weekly origin-report PDFs.").parse_args()
    status = run()
    sys.exit(0 if status.get("ok") else 1)
