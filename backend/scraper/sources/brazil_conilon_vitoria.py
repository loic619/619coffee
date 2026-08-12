"""
brazil_conilon_vitoria.py — physical conilon at Vitória-ES (CNL delivery point).

Source: noticiasagricolas.com.br "Café Conillon Disponível - Vitória (ES)"
    https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-conillon-disponivel-vitoria-es[/YYYY-MM-DD]

The page quotes R$/saca-60kg per grade from two reporters — the Centro do
Comércio de Café de Vitória (Tipo 7/8, the benchmark spec the B3 CNL future
delivers against) and Cooperativa São Gabriel (Tipo 7, Tipo 8). We keep every
quote for research and expose the CCCV Tipo 7/8 price as the headline. The
date-URL suffix backfills to at least mid-2022, giving the deep history the
young CNL contract (Sep 2024 launch) cannot provide itself.

Outputs frontend/public/data/brazil_conilon_vitoria.json:
    {unit, source, updated, history:[{date, benchmark, quotes:[{section,tipo,price,var}]}]}
The B3 panel overlays `benchmark` behind the CNL futures line.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "frontend" / "public" / "data" / "brazil_conilon_vitoria.json"
BASE = ("https://www.noticiasagricolas.com.br/cotacoes/cafe/"
        "cafe-conillon-disponivel-vitoria-es")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

_BRL_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
_DATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _brl(s: str) -> float | None:
    m = _BRL_RE.search(s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def fetch(date_iso: str | None = None, timeout: int = 30) -> tuple[str | None, list[dict]]:
    """Return (fechamento_iso, quotes) for a date or the latest page.

    quotes = [{"section", "tipo", "price" (R$/saca), "var" (str)}]. Section
    header rows carry no price and set the reporter for the rows below.
    """
    url = BASE + (f"/{date_iso}" if date_iso else "")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        html = r.read().decode("utf-8", "replace")

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    fm = re.search(r"Fechamento[:\s]*" + _DATE_RE.pattern, html)
    fech = f"{fm.group(3)}-{fm.group(2)}-{fm.group(1)}" if fm else None

    quotes: list[dict] = []
    for table in soup.find_all("table"):
        hdr = " ".join(c.get_text(" ", strip=True).lower() for c in table.find_all("th"))
        if "tipo" not in hdr or "pre" not in hdr:
            continue
        section = ""
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if not cells or not cells[0]:
                continue
            price = _brl(cells[1]) if len(cells) > 1 else None
            if price is None:
                section = cells[0]        # reporter header row (prices are ***)
                continue
            quotes.append({"section": section, "tipo": cells[0], "price": price,
                           "var": cells[2] if len(cells) > 2 else ""})
        if quotes:
            break
    return fech, quotes


def _benchmark(quotes: list[dict]) -> float | None:
    """CCCV Tipo 7/8 (the CNL delivery spec); fall back to the first quote."""
    for q in quotes:
        if "7/8" in q["tipo"]:
            return q["price"]
    return quotes[0]["price"] if quotes else None


def _entry(fech: str, quotes: list[dict]) -> dict:
    return {"date": fech, "benchmark": _benchmark(quotes), "quotes": quotes}


def _load() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d.setdefault("history", [])
        return d
    except Exception:
        return {
            "unit": "BRL/saca_60kg",
            "source": "noticiasagricolas.com.br — Café Conillon Disponível Vitória (ES)",
            "note": "benchmark = CCCV Tipo 7/8 (B3 CNL delivery spec); quotes keep every grade.",
            "history": [],
        }


def _save(doc: dict) -> None:
    doc["history"] = sorted(doc["history"], key=lambda e: e["date"])
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def _cooabriel_t7(entry: dict) -> float | None:
    """Cooabriel (Coop. Agrária dos Cafeicultores de São Gabriel) Tipo 7 quote.

    This is the same number the Cooabriel scraper reads off the co-op's own
    site — NA republishes it here, dated by the page's Fechamento (trading)
    date rather than by scrape time.
    """
    for q in entry.get("quotes", []):
        if "Gabriel" in q.get("section", "") and q.get("tipo", "").strip() == "Tipo 7":
            return q.get("price")
    return None


def latest_cooabriel_t7() -> tuple[str | None, float | None]:
    """(trading_date, price) of the most recent Cooabriel Tipo 7 quote."""
    doc = _load()
    for entry in reversed(doc.get("history") or []):
        price = _cooabriel_t7(entry)
        if price is not None:
            return entry["date"], price
    return None, None


def seed_origin_history() -> None:
    """Rebuild origin_prices_history.json → brazil_conilon.history from this
    archive's Cooabriel Tipo 7 series (one-time; daily runs append forward).

    Replaces the 90-day self-collected series, which was also stamped one
    trading day late — every point here carries the page's Fechamento date.
    """
    oph = ROOT / "frontend" / "public" / "data" / "origin_prices_history.json"
    points = []
    for entry in _load().get("history") or []:
        price = _cooabriel_t7(entry)
        if price is not None:
            points.append({"date": entry["date"], "price": price})
    if not points:
        print("[seed] no Cooabriel T7 points found")
        return
    d = json.loads(oph.read_text(encoding="utf-8"))
    d["origins"].setdefault("brazil_conilon", {})["history"] = points
    oph.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[seed] brazil_conilon.history ← {len(points)} points "
          f"({points[0]['date']}..{points[-1]['date']})")


def export_brazil_conilon_vitoria() -> None:
    """Daily: fetch the latest Vitória disponível table and upsert its entry."""
    try:
        fech, quotes = fetch()
    except Exception as e:  # noqa: BLE001
        print(f"  brazil_conilon_vitoria → fetch failed: {type(e).__name__}: {e}")
        return
    if not fech or not quotes:
        print("  brazil_conilon_vitoria → no quotes parsed")
        return
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    by_date[fech] = _entry(fech, quotes)
    doc["history"] = list(by_date.values())
    _save(doc)
    print(f"  brazil_conilon_vitoria.json → {fech}: {len(quotes)} quotes, "
          f"benchmark R$ {by_date[fech]['benchmark']}")


def backfill(start: str, end: str | None = None, delay: float = 0.12) -> None:
    """Walk business days [start, end], upsert each date (deduped by the page's
    actual Fechamento date, so holidays collapse). end defaults to today."""
    end_d = date.fromisoformat(end) if end else date.today()
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    d = date.fromisoformat(start)
    fetched = 0
    while d <= end_d:
        if d.weekday() < 5:
            try:
                fech, quotes = fetch(d.isoformat(), timeout=20)
                if fech and quotes:
                    by_date[fech] = _entry(fech, quotes)
                    fetched += 1
            except Exception as e:  # noqa: BLE001
                print(f"    {d.isoformat()}: {type(e).__name__}")
            time.sleep(delay)
        d += timedelta(days=1)
    doc["history"] = list(by_date.values())
    _save(doc)
    print(f"[backfill] {fetched} business-day fetches; history now "
          f"{len(doc['history'])} dates {doc['history'][0]['date']}..{doc['history'][-1]['date']}")


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "daily"
    if cmd == "backfill":
        backfill(sys.argv[2] if len(sys.argv) > 2 else "2022-06-01",
                 sys.argv[3] if len(sys.argv) > 3 else None)
    elif cmd == "seed-origin":
        seed_origin_history()
    else:
        export_brazil_conilon_vitoria()
