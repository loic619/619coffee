"""
brazil_coffeecopa.py — Copa Café buying table: Brazilian physical arabica by
grade (Rio Minas, Duro) and cata (defect share), R$ per 60-kg saca.

Source. https://coffeecopa.com/tabela/ ships an empty <table> and fills it
client-side from a PUBLIC Google Sheet (found by probing the page 2026-09-03;
the probe workflow has been removed — this docstring is what it learned):

    sheet   1wNX2fPobme6rAE869H8Zrv82K8eCjaDadE30DHU48tc, tab "Preços"
    url     https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:json&sheet=Preços
    body    JSONP: "/*O_o*/\\ngoogle.visualization.Query.setResponse({...});"
    cols    Qualidade (string) | Cata (number, 0.2 = 20%) | Preço (number, R$) | D..G empty
    rows    Rio Minas 20/25/30%, Duro 20/25/30%, Cereja Descascado 10% (no price)

The sheet carries no date. The page only refreshes its table between 09:30
and 18:00 BRT (a browser-side gate — the sheet answers any time), so a fetch
before 09:30 BRT reads the list posted the previous business day and is dated
that way; a weekday fetch after 09:30 is dated the same day. That is the
"price list in force" convention, the same idea as the conilon accumulator
dating rows by the session they describe rather than the clock.

The unit is not printed anywhere on the page. R$ 1.300–1.600 per unit against
the same week's Tipo 6/7 físico trimmed mean of R$ 1.690/saca puts it beyond
doubt: this is R$ per saca de 60 kg, the universal quoting unit for Brazilian
physical arabica.

Output frontend/public/data/brazil_coffeecopa.json:
    {unit, source, url, updated,
     latest:  {date, quotes},
     history: [{date, fetched_at, quotes: {rio_minas_20, rio_minas_25, rio_minas_30,
                                            duro_20, duro_25, duro_30, ...}}]}
The B3 panel overlays rio_minas_20 / duro_20 on the arábica board, converted
to US$/saca at that day's BRL close, and draws their differential to NY.
"""
from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "frontend" / "public" / "data" / "brazil_coffeecopa.json"

SHEET_ID = "1wNX2fPobme6rAE869H8Zrv82K8eCjaDadE30DHU48tc"
GVIZ_URL = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
            "/gviz/tq?tqx=out:json&sheet=Pre%C3%A7os")
PAGE_URL = "https://coffeecopa.com/tabela/"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")

BRT = ZoneInfo("America/Sao_Paulo")
TABLE_OPENS = time(9, 30)


def _slug(qualidade: str) -> str:
    s = qualidade.strip().lower()
    s = (s.replace("ç", "c").replace("ã", "a").replace("á", "a").replace("é", "e")
          .replace("ê", "e").replace("í", "i").replace("ó", "o").replace("ú", "u"))
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def parse_gviz(text: str) -> list[dict]:
    """The sheet's rows as [{grade, slug, cata, price}], priced rows only.

    `grade` is the sheet's own label (trimmed — "Duro " carries a trailing
    space), `cata` the defect share as a percentage integer, `price` R$/saca.
    """
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("gviz response carries no JSON object")
    payload = json.loads(text[start:end + 1])
    if payload.get("status") not in (None, "ok"):
        raise RuntimeError(f"gviz status {payload.get('status')}: {payload.get('errors')}")
    table = payload.get("table") or {}
    labels = [(c.get("label") or "").strip().lower() for c in table.get("cols") or []]
    try:
        i_q = labels.index("qualidade")
        i_c = labels.index("cata")
        i_p = next(i for i, l in enumerate(labels) if l.startswith("pre"))
    except (ValueError, StopIteration) as e:
        raise ValueError(f"gviz columns changed: {labels}") from e

    def val(cells: list, i: int):
        return cells[i].get("v") if i < len(cells) and cells[i] else None

    out: list[dict] = []
    for row in table.get("rows") or []:
        cells = row.get("c") or []
        grade, cata, price = val(cells, i_q), val(cells, i_c), val(cells, i_p)
        if not grade or price is None:
            continue
        try:
            cata_pct = int(round(float(cata) * 100)) if cata is not None else None
            out.append({"grade": str(grade).strip(), "slug": _slug(str(grade)),
                        "cata": cata_pct, "price": float(price)})
        except (TypeError, ValueError):
            continue
    return out


def fetch(timeout: int = 30) -> list[dict]:
    resp = requests.get(GVIZ_URL, headers={"User-Agent": UA}, timeout=timeout)
    resp.raise_for_status()
    return parse_gviz(resp.text)


def _previous_business_day(d: date) -> date:
    out = d - timedelta(days=1)
    while out.weekday() >= 5:
        out -= timedelta(days=1)
    return out


def session_date(now_brt: datetime) -> date:
    """The business day whose price list a fetch at `now_brt` is reading: the
    same day once the table has opened (weekday, ≥ 09:30 BRT), otherwise the
    previous business day."""
    d = now_brt.date()
    if d.weekday() < 5 and now_brt.time() >= TABLE_OPENS:
        return d
    return _previous_business_day(d)


def quote_key(row: dict) -> str:
    """'Rio Minas' @ 20% → 'rio_minas_20'."""
    return f"{row['slug']}_{row['cata']}" if row.get("cata") is not None else row["slug"]


def _load() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d.setdefault("history", [])
        return d
    except Exception:
        return {
            "unit": "BRL/saca_60kg",
            "source": "Copa Café — tabela de compra (coffeecopa.com), via its public Google Sheet",
            "url": PAGE_URL,
            "note": "Buying prices by grade and cata (defect share). The sheet carries no "
                    "date; rows are dated by the business day whose list was in force "
                    "at fetch time (table opens 09:30 BRT). Accumulates daily.",
            "history": [],
        }


def export_brazil_coffeecopa(now: datetime | None = None) -> None:
    """Daily: read the sheet and upsert the day's quotes under their session date."""
    try:
        rows = fetch()
    except Exception as e:  # noqa: BLE001
        print(f"  brazil_coffeecopa → fetch failed: {type(e).__name__}: {e}")
        return
    if not rows:
        print("  brazil_coffeecopa → no priced rows in the sheet")
        return
    now_utc = now or datetime.now(UTC)
    day = session_date(now_utc.astimezone(BRT)).isoformat()
    quotes = {quote_key(r): r["price"] for r in rows}

    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    by_date[day] = {"date": day, "fetched_at": now_utc.isoformat(timespec="minutes"),
                    "quotes": quotes}
    doc["history"] = sorted(by_date.values(), key=lambda e: e["date"])
    doc["grades"] = [{"key": quote_key(r), "grade": r["grade"], "cata": r["cata"]} for r in rows]
    doc["latest"] = {"date": day, "quotes": quotes}
    doc["updated"] = now_utc.isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  brazil_coffeecopa.json → {day}: " +
          ", ".join(f"{k} R$ {v:.0f}" for k, v in quotes.items()))


if __name__ == "__main__":
    import sys
    if "--probe" in sys.argv:
        for r in fetch():
            print(f"  {r['grade']:20} {r['cata']}%  R$ {r['price']:.2f}  → {quote_key(r)}")
    else:
        export_brazil_coffeecopa()
