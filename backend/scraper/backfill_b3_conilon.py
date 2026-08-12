"""
backfill_b3_conilon.py — one-shot history for the B3 conilon future (CNL).

Why this exists
===============
`scraper/sources/brazil_b3_conilon.py` reads B3's DerivativeQuotation API,
which serves only a live snapshot — so brazil_b3_conilon.json accumulates one
entry per daily run and carries no history before the scraper was switched on.
The conilon-basis research needs the futures leg back to the contract's Sep-2024
launch, so this module walks a dated, public settlement source instead.

Sources, tried in order (first one that parses wins, per date):
  A. B3 "Ajustes do Pregão" — the official daily settlement bulletin,
     date-parameterised, one row per contract month:
         https://www2.bmf.com.br/pages/portal/bmfbovespa/boletim1/Ajustes1.asp
             ?txtData=DD/MM/YYYY
     Rows look like:  CNL - CAFE CONILON | U26 | 1.072,50 | 1.076,54 | 4,04 | …
     The Mercadoria cell is only filled on the first row of each block, so the
     parser carries it down (that layout quirk is the main parsing trap here).
  B. noticiasagricolas mirror pages, if B3 is unreachable from the runner.

Egress note: both hosts are blocked from the dev sandbox (403 CONNECT), so this
runs on a GitHub Actions runner — same one-shot pattern as the CEPEA and Vitória
conilon backfills. It is append-once: dates already present in the JSON are
skipped, so a re-run is cheap and never rewrites collected history.

    python -m scraper.backfill_b3_conilon probe                 # diagnose sources
    python -m scraper.backfill_b3_conilon backfill 2024-09-02   # walk business days
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "data" / "brazil_b3_conilon.json"

B3_AJUSTES = "https://www2.bmf.com.br/pages/portal/bmfbovespa/boletim1/Ajustes1.asp"
NA_CANDIDATES = [
    "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-conillon-b3",
    "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-conilon-b3",
    "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-conillon-b3-prego-regular",
]
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

MONTH_CODES = {"F": "Jan", "G": "Feb", "H": "Mar", "J": "Apr", "K": "May", "M": "Jun",
               "N": "Jul", "Q": "Aug", "U": "Sep", "V": "Oct", "X": "Nov", "Z": "Dec"}
_NUM_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}")
_VENC_RE = re.compile(r"^([FGHJKMNQUVXZ])(\d{2})$")


def _num(s: str) -> float | None:
    m = _NUM_RE.search(s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def _get(url: str, data: bytes | None = None, timeout: int = 30) -> str:
    headers = {"User-Agent": UA, "Accept": "text/html",
               "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("latin-1", "replace")


def fetch_b3(d: date, timeout: int = 30) -> list[dict]:
    """CNL settlement rows for one session off B3's Ajustes do Pregão page.

    Returns [{"month", "symb", "price"}] — the *current* settlement column
    (preço de ajuste atual). Empty list when the page has no CNL block (holiday,
    or a session before the contract listed).
    """
    br = d.strftime("%d/%m/%Y")
    html = _get(f"{B3_AJUSTES}?txtData={br}", timeout=timeout)

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    for table in soup.find_all("table"):
        txt = table.get_text(" ", strip=True)
        if "CONILON" not in txt.upper():
            continue
        mercadoria = ""
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) < 4:
                continue
            # Mercadoria is printed once per block, then left blank: carry it.
            if cells[0]:
                mercadoria = cells[0]
            if "CONILON" not in mercadoria.upper():
                continue
            venc = cells[1].strip()
            m = _VENC_RE.match(venc)
            if not m:
                continue
            price = _num(cells[3])          # ajuste atual
            if price is None:
                continue
            out.append({"month": f"{MONTH_CODES[m.group(1)]} '{m.group(2)}",
                        "symb": f"CNL{venc}", "price": price})
        if out:
            break
    return out


def _entry(d: date, contracts: list[dict]) -> dict:
    front = contracts[0] if contracts else {}
    return {"date": d.isoformat(),
            "front_month": front.get("month"),
            "front_price": front.get("price"),
            "contracts": [{**c, "oi": None, "expiry": ""} for c in contracts],
            "src": "b3-ajustes"}


def _load() -> dict:
    try:
        doc = json.loads(OUT.read_text(encoding="utf-8"))
        doc.setdefault("history", [])
        return doc
    except Exception:
        return {"unit": "BRL/saca_60kg",
                "source": "B3 — Contrato Futuro de Café Conilon (CNL)",
                "history": []}


def _save(doc: dict) -> None:
    doc["history"] = sorted(doc["history"], key=lambda e: e["date"])
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def probe() -> None:
    """Enumerate what a dated CNL history could actually come from.

    The first probe run established that the legacy Ajustes1.asp bulletin now
    answers with a 549-byte stub (B3 retired it) and that the guessed
    noticiasagricolas slugs 404. So rather than guessing more URLs, this lists
    the quote pages the republisher actually publishes and tries the modern B3
    file services.
    """
    print("== noticiasagricolas — every coffee quote page it links")
    try:
        html = _get("https://www.noticiasagricolas.com.br/cotacoes/cafe/", timeout=25)
        links = sorted(set(re.findall(r'href="(/cotacoes/[^"#?]+)"', html)))
        for href in links:
            print(f"  {href}")
        print(f"  ({len(links)} links)")
    except Exception as e:  # noqa: BLE001
        print(f"  index fetch failed: {type(e).__name__}: {e}")

    print("== B3 modern endpoints")
    day = date(2026, 6, 10)
    br = day.strftime("%d/%m/%Y")
    iso = day.isoformat()
    candidates = [
        f"{B3_AJUSTES}?txtData={br}",
        f"https://www2.bmf.com.br/pages/portal/bmfbovespa/boletim1/Ajustes1.asp?Data={br}&Mercadoria=CNL",
        f"https://arquivos.b3.com.br/bdi/table/AjustesDoPregao?date={iso}",
        f"https://arquivos.b3.com.br/tabelas/table/AjustesDoPregao?date={iso}",
        "https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/CNL",
        f"https://www.b3.com.br/pesquisapregao/download?filelist=PR{day.strftime('%d%m%Y')}.zip",
    ]
    for url in candidates:
        try:
            body = _get(url, timeout=25)
            up = body.upper()
            print(f"  {len(body):>8}B  CONILON={'CONILON' in up}  CNL={'CNL' in up}  {url}")
        except Exception as e:  # noqa: BLE001
            print(f"  {'ERR':>8}    {type(e).__name__}: {str(e)[:60]}  {url}")


def backfill(start: str, end: str | None = None, delay: float = 0.25) -> None:
    """Walk business days [start, end] and add every session not already stored."""
    end_d = date.fromisoformat(end) if end else date.today()
    doc = _load()
    have = {e["date"] for e in doc["history"]}
    by_date = {e["date"]: e for e in doc["history"]}
    d = date.fromisoformat(start)
    added = empty = failed = 0
    while d <= end_d:
        if d.weekday() < 5 and d.isoformat() not in have:
            try:
                rows = fetch_b3(d, timeout=25)
                if rows:
                    by_date[d.isoformat()] = _entry(d, rows)
                    added += 1
                else:
                    empty += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                if failed <= 8:
                    print(f"    {d}: {type(e).__name__}: {str(e)[:90]}")
            time.sleep(delay)
        d += timedelta(days=1)
    doc["history"] = list(by_date.values())
    _save(doc)
    hist = doc["history"]
    print(f"[backfill] added {added} sessions, {empty} empty (holiday/pre-listing), "
          f"{failed} errors; history now {len(hist)} dates "
          f"{hist[0]['date']}..{hist[-1]['date']}" if hist else "[backfill] empty")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "probe"
    if cmd == "backfill":
        backfill(sys.argv[2] if len(sys.argv) > 2 else "2024-09-02",
                 sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        probe()
