from __future__ import annotations

import re
from datetime import date

from telegram.data import load
from telegram.formatting import header, num, signed, table, title

STC = {1:"H",2:"H",3:"K",4:"K",5:"N",6:"N",7:"U",8:"U",9:"X",10:"X",11:"F",12:"F"}
MA  = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
       7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}

ADDON_DIFFS = {"eudr": 50, "rfa": 60, "4c": 15, "bb": 15, "jute": 25}
ADDON_FLAGS = list(ADDON_DIFFS.keys())


def parse_args(raw: str) -> dict:
    tokens = raw.strip().lower().split()
    result = {k: False for k in ADDON_FLAGS}
    result["basis"] = None
    for t in tokens:
        if t.startswith("basis="):
            try:
                result["basis"] = int(t.split("=", 1)[1])
            except ValueError:
                pass
        elif t in ADDON_FLAGS:
            result[t] = True
    return result


def _rc_prices(chain: dict) -> dict[str, float]:
    prices: dict[str, float] = {}
    for c in chain.get("robusta", {}).get("contracts", []):
        m = re.match(r'^R[MC]([FGHJKMNQUVXZ])\d{2}$', c.get("symbol", ""), re.I)
        if m:
            letter = m.group(1).upper()
            if letter not in prices:
                prices[letter] = c["last"]
    return prices


def _vn_faq_usd(latest: dict) -> float | None:
    for t in latest.get("tickers", []):
        if t.get("label") == "VN FAQ":
            m = re.search(r'\$([0-9,]+)', t["value"])
            if m:
                return float(m.group(1).replace(",", ""))
    return None


def compute_months(
    basis: int,
    rc_prices: dict[str, float],
    today_month: int,
    today_day: int,
    addons: int,
) -> list[tuple[str, str, int | None]]:
    offset = 1 if today_day >= 14 else 0
    today_year = date.today().year
    rows = []
    cum_spread = 0
    last_letter: str | None = None
    for i in range(8):
        yr, mo = today_year, today_month + offset + i
        while mo > 12:
            mo -= 12
            yr += 1
        letter = STC[mo]
        cyr = yr + 1 if letter == "F" and mo >= 11 else yr
        sym   = f"RM{letter}{str(cyr)[2:]}"
        label = f"{MA[mo]}-{str(yr)[2:]}"
        if last_letter and letter != last_letter:
            fp = rc_prices.get(last_letter)
            tp = rc_prices.get(letter)
            if fp and tp:
                cum_spread += round(fp - tp)
        last_letter = letter
        cp = rc_prices.get(letter)
        diff = basis + i * 30 + cum_spread + addons if cp is not None else None
        rows.append((label, sym, diff))
    return rows


def handle(args: str, context: dict) -> str:
    chain  = load("futures_chain.json")
    latest = load("latest_prices.json")
    if not chain or not latest:
        return "RC price data unavailable."

    rc = _rc_prices(chain)
    if not rc:
        return "RC front price not available."

    today = date.today()
    a = parse_args(args)

    front_contracts = chain.get("robusta", {}).get("contracts", [])
    front_price = front_contracts[0]["last"] if front_contracts else None
    front_sym   = front_contracts[0].get("symbol", "?") if front_contracts else "?"

    vn_usd = _vn_faq_usd(latest)
    basis = a["basis"]
    if basis is None:
        basis = round(vn_usd - front_price) if vn_usd and front_price else 0

    addons = sum(ADDON_DIFFS[k] for k in ["eudr", "rfa", "4c", "bb", "jute"] if a.get(k))
    rows = compute_months(basis, rc, today.month, today.day, addons)

    # Contract legend — unique letters in appearance order. Each shipment
    # month prices off one of these, which is why the letter travels with the
    # differential in the shipment table rather than being dropped: "Nov-26
    # +178" is not a quotation until you know which contract it prices off.
    legend_letters: list[str] = []
    for _, sym, _ in rows:
        m = re.match(r'^RM([A-Z])', sym)
        if m and m.group(1) not in legend_letters:
            legend_letters.append(m.group(1))

    fut_rows: list[list] = [["", "last", "vs front"]]
    prev_price: float | None = None
    for letter in legend_letters:
        price = rc.get(letter)
        if price is None:
            continue
        if prev_price is None:
            fut_rows.append([letter, num(price), "front"])
        else:
            fut_rows.append([letter, num(price), signed(round(prev_price - price))])
        prev_price = price

    # Quality + packing labels
    certs = [k.upper() for k in ["eudr", "rfa", "4c"] if a.get(k)]
    quality = "Basis G2" + (" " + " ".join(certs) if certs else "")
    if a.get("bb"):
        packing = "Big bags"
    elif a.get("jute"):
        packing = "Jute bags"
    else:
        packing = "Bulk"

    # Shipment rows: month, its pricing contract + differential, and the
    # all-in price. The last column is new — the reader was previously doing
    # 3,557 + 107 in their head on every row.
    ship_rows: list[list] = [["", "diff", "price"]]
    for label, sym, diff in rows:
        m = re.match(r'^RM([A-Z])', sym)
        letter = m.group(1) if m else "?"
        if diff is None:
            ship_rows.append([label, "—", "—"])
            continue
        base = rc.get(letter)
        ship_rows.append([label, f"{letter} {diff:+d}",
                          num(base + diff) if base is not None else "—"])

    basis_s = signed(basis) if basis else "0"
    parts = [
        title("☕ ROBUSTA QUOTATION", f"VN FAQ · {quality} · {packing}"),
        f"Basis: {front_sym} {basis_s}",
        header("📈", "futures"),
        table(fut_rows, align="lrr"),
        header("🚢", "shipment"),
        table(ship_rows, align="lrr"),
        "/quote basis=+50 — adjusts all rows\n/quote basis=-140 eudr rfa bb",
    ]
    return "\n\n".join(parts)
