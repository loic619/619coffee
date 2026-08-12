"""
cepea_conilon_indicator.py — CEPEA/ESALQ conilon (robusta) daily indicator.

Source: noticiasagricolas.com.br republisher of the CEPEA/ESALQ indicator
(cepea.org.br itself is Cloudflare-walled from CI — see cepea.py):
    https://www.noticiasagricolas.com.br/cotacoes/cafe/indicador-cepea-esalq-cafe-conillon[/YYYY-MM-DD]

The page carries a `Data | Valor R$ | Variação(%)` table (one row per
session), so every fetch can upsert several dates at once. The date-URL
suffix backfills history the same way brazil_conilon_vitoria.py does for
the Vitória disponível market.

Outputs frontend/public/data/cepea_conilon_indicator.json:
    {unit, source, updated, history:[{date, price, var}]}
The B3 panel overlays `price` with the CNL futures and the Cooabriel CON7
quote so the three conilon references can be read together.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "frontend" / "public" / "data" / "cepea_conilon_indicator.json"
BASE = ("https://www.noticiasagricolas.com.br/cotacoes/cafe/"
        "indicador-cepea-esalq-cafe-conillon")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

_BRL_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
_DATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _brl(s: str) -> float | None:
    m = _BRL_RE.search(s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def fetch(date_iso: str | None = None, timeout: int = 30) -> list[dict]:
    """Return every `{date, price, var}` row of the indicator table on the
    latest page (or the page as of `date_iso`). The target table is the one
    whose header mentions "Valor" — same discriminator cepea.py uses so a
    sidebar cotação table can't be picked up by mistake."""
    url = BASE + (f"/{date_iso}" if date_iso else "")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        html = r.read().decode("utf-8", "replace")

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for table in soup.find_all("table"):
        hdr = " ".join(c.get_text(" ", strip=True).lower() for c in table.find_all("th"))
        if "valor" not in hdr:
            continue
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) < 2:
                continue
            dm = _DATE_RE.search(cells[0])
            price = _brl(cells[1])
            if not dm or price is None:
                continue
            rows.append({
                "date": f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}",
                "price": price,
                "var": cells[2] if len(cells) > 2 else "",
            })
        if rows:
            break
    return rows


def _load() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d.setdefault("history", [])
        return d
    except Exception:
        return {
            "unit": "BRL/saca_60kg",
            "source": "CEPEA/ESALQ conilon indicator via noticiasagricolas.com.br",
            "history": [],
        }


def _save(doc: dict) -> None:
    doc["history"] = sorted(doc["history"], key=lambda e: e["date"])
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def export_cepea_conilon_indicator() -> None:
    """Daily: fetch the latest indicator page and upsert every row it shows."""
    try:
        rows = fetch()
    except Exception as e:  # noqa: BLE001
        print(f"  cepea_conilon_indicator → fetch failed: {type(e).__name__}: {e}")
        return
    if not rows:
        print("  cepea_conilon_indicator → no rows parsed")
        return
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    by_date.update({r["date"]: r for r in rows})
    doc["history"] = list(by_date.values())
    _save(doc)
    latest = max(rows, key=lambda r: r["date"])
    print(f"  cepea_conilon_indicator.json → {len(rows)} rows upserted, "
          f"latest {latest['date']}: R$ {latest['price']}")


def backfill(start: str, end: str | None = None, delay: float = 0.12) -> None:
    """Walk business days [start, end], upserting every table row each page
    shows (pages usually carry a window of sessions, so already-covered dates
    are skipped). end defaults to today."""
    end_d = date.fromisoformat(end) if end else date.today()
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    d = date.fromisoformat(start)
    fetched = 0
    while d <= end_d:
        if d.weekday() < 5 and d.isoformat() not in by_date:
            try:
                rows = fetch(d.isoformat(), timeout=20)
                by_date.update({r["date"]: r for r in rows})
                fetched += 1
            except Exception as e:  # noqa: BLE001
                print(f"    {d.isoformat()}: {type(e).__name__}")
            time.sleep(delay)
        d += timedelta(days=1)
    doc["history"] = list(by_date.values())
    _save(doc)
    hist = doc["history"]
    print(f"[backfill] {fetched} page fetches; history now {len(hist)} dates "
          f"{hist[0]['date']}..{hist[-1]['date']}" if hist else "[backfill] empty")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "backfill":
        backfill(sys.argv[2] if len(sys.argv) > 2 else "2022-06-01",
                 sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        export_cepea_conilon_indicator()
