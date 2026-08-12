"""
brazil_b3_conilon.py — B3 "Contrato Futuro de Café Conilon" (CNL) daily curve.

Source: B3's public DerivativeQuotation JSON API (same endpoint family the
b3_icf arabica ticker uses — no Playwright, reachable from CI):
    https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/CNL

Contract: coffea canephora tipo 7/8, delivery Vitória-ES, quoted in
R$ per 60-kg saca, expiries Jan/Mar/May/Jul/Sep/Nov. Launched Sep 2024.

The API serves only the current snapshot (no history endpoint), so this
module ACCUMULATES a daily series: each run upserts today's entry —
front contract + full curve — into brazil_b3_conilon.json. Field used is
prvsDayAdjstmntPric (ajuste diário — official daily settlement).

No dated public source for CNL settlements
==========================================
Probed 2026-08-12, looking for history to seed the conilon-basis research:
  * the legacy BM&F "Ajustes do Pregão" bulletin
    (www2.bmf.com.br/…/boletim1/Ajustes1.asp) is retired — every dated
    request answers with a ~600-byte stub containing no contract table;
  * arquivos.b3.com.br AjustesDoPregao tables return no CNL rows;
  * noticiasagricolas publishes 11 coffee quote pages and none of them is
    the B3 conilon future (it mirrors B3 arabica 4/5 only).
So the series genuinely can only build forward from the day this scraper
was switched on. Don't re-litigate it without a new source.

Output frontend/public/data/brazil_b3_conilon.json:
    {unit, source, updated, history:[{date, front_month, front_price,
                                      contracts:[{month, symb, price, oi, expiry}]}]}
"""
from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[3]          # repo root
OUT = ROOT / "frontend" / "public" / "data" / "brazil_b3_conilon.json"
URL = "https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/CNL"

MONTH_CODES = {
    "F": "Jan", "G": "Feb", "H": "Mar", "J": "Apr", "K": "May",
    "M": "Jun", "N": "Jul", "Q": "Aug", "U": "Sep", "V": "Oct",
    "X": "Nov", "Z": "Dec",
}


def _label(symb: str) -> str:
    """'CNLF27' → \"Jan '27\"."""
    if len(symb) >= 6:
        return f"{MONTH_CODES.get(symb[3], '?')} '{symb[4:6]}"
    return symb


def fetch(timeout: int = 20) -> list[dict]:
    """Return the CNL futures curve, nearest expiry first.

    contract = {"month" (display), "symb", "price" (R$/saca settlement),
                "oi" (open contracts), "expiry" (YYYY-MM-DD)}.
    Only contracts with a settlement price are included.
    """
    resp = requests.get(URL, headers={"User-Agent": "Mozilla/5.0",
                                      "Accept": "application/json"}, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    if data.get("BizSts", {}).get("cd") != "OK":
        raise RuntimeError(f"B3 API status not OK: {data.get('BizSts')}")

    contracts = []
    for c in data.get("Scty", []):
        try:
            if c.get("mkt", {}).get("cd") != "FUT":
                continue
            price = c.get("SctyQtn", {}).get("prvsDayAdjstmntPric")
            if price is None:
                continue
            summ = c.get("asset", {}).get("AsstSummry", {})
            contracts.append({
                "month":  _label(c.get("symb", "")),
                "symb":   c.get("symb", ""),
                "price":  float(price),
                "oi":     summ.get("opnCtrcts"),
                "expiry": summ.get("mtrtyCode", ""),
            })
        except (TypeError, ValueError):
            continue
    contracts.sort(key=lambda c: c["expiry"] or "9999-99-99")
    return contracts


def _front(contracts: list[dict]) -> dict:
    """Nearest not-yet-expired contract (falls back to first listed)."""
    today = date.today().isoformat()
    live = [c for c in contracts if (c["expiry"] or "9999") > today]
    return (live or contracts or [{}])[0]


def _load() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d.setdefault("history", [])
        return d
    except Exception:
        return {
            "unit": "BRL/saca_60kg",
            "source": "B3 — Contrato Futuro de Café Conilon (CNL), DerivativeQuotation API",
            "note": "front_price = nearest live contract's daily settlement (ajuste); "
                    "history accumulates daily — B3 exposes no history endpoint.",
            "history": [],
        }


def export_brazil_b3_conilon() -> None:
    """Daily: fetch the CNL curve and upsert today's entry."""
    try:
        contracts = fetch()
    except Exception as e:  # noqa: BLE001
        print(f"  brazil_b3_conilon → fetch failed: {type(e).__name__}: {e}")
        return
    if not contracts:
        print("  brazil_b3_conilon → no priced contracts in API response")
        return
    front = _front(contracts)
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    today = date.today().isoformat()
    by_date[today] = {
        "date": today,
        "front_month": front.get("month"),
        "front_price": front.get("price"),
        "contracts": contracts,
    }
    doc["history"] = sorted(by_date.values(), key=lambda e: e["date"])
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  brazil_b3_conilon.json → {today}: front {front.get('month')} "
          f"R$ {front.get('price')} ({len(contracts)} contracts)")


if __name__ == "__main__":
    import sys
    if "--probe" in sys.argv:
        # Diagnostic: dump the raw curve without writing the JSON.
        for c in fetch():
            print(f"  {c['symb']}  {c['month']:8} R$ {c['price']:>10.2f}  "
                  f"OI {c['oi']}  expiry {c['expiry']}")
    else:
        export_brazil_b3_conilon()
