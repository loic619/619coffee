"""topic_notify.py — topical Telegram texts, sent when their data just landed.

Each composer reads the committed JSON it reports on and is FRESHNESS-GATED:
it returns None (→ nothing sent) unless the underlying data updated within
its gate window. Wiring:

  cot         — after the COT scraper (2.3); fires only on the ingest day
                (Fri evening), silent on the Mon–Thu no-new-report runs.
  freight     — after the freight scraper (1.2, Fri + Sun).
  us_imports  — after the USITC scraper (3.9, monthly).
  eu_imports  — after the Eurostat scraper (3.10, monthly).
  enso        — after the ENSO indices scraper (0.7, weekly Tue).
  origin digests — composed BY THE SENTINEL when a monthly origin release
                passes its ingestion check (compose_origin_digest), so the
                export numbers ride the ✅ message the moment they land.

CLI:  cd backend && python -m scraper.topic_notify <topic>
Env:  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (absent → compose-and-print only)

Stdlib + requests only — safe from any workflow and from the sentinel.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "public" / "data"
CACHE = ROOT / "backend" / "scraper" / "cache"


def _load(path: Path) -> dict | list | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _parse_ts(ts: str | None) -> dt.datetime | None:
    if not ts:
        return None
    try:
        if len(ts) == 10:
            return dt.datetime.strptime(ts, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
        d = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def _fresh(ts: str | None, days: float, now: dt.datetime) -> bool:
    d = _parse_ts(ts)
    return d is not None and (now - d).total_seconds() <= days * 86400


def _arrow(cur: float | None, prev: float | None) -> str:
    if cur is None or prev is None or prev == 0:
        return ""
    pct = (cur - prev) / abs(prev) * 100
    if abs(pct) < 0.05:
        return " (= w/w)"
    return f" ({'+' if pct >= 0 else ''}{pct:.1f}% w/w)"


def _yoy(cur: float | None, prev: float | None) -> str:
    if cur is None or not prev:
        return ""
    pct = (cur - prev) / abs(prev) * 100
    return f" ({'+' if pct >= 0 else ''}{pct:.1f}% y/y)"


def _fmt(n: float | None, dec: int = 0) -> str:
    return "—" if n is None else f"{n:,.{dec}f}"


# ── Weekly topics ────────────────────────────────────────────────────────────

def compose_cot(now: dt.datetime) -> str | None:
    """NY + LDN managed-money positioning for the freshly-ingested week.
    Gate: newest report date within 4 days (the Friday-evening ingest of a
    Tuesday-dated report); Mon–Thu runs see an older report and stay silent."""
    rows = _load(DATA / "cot.json")
    if not isinstance(rows, list) or len(rows) < 2:
        return None
    cur, prev = rows[-1], rows[-2]
    if not _fresh(cur.get("date"), 4, now):
        return None

    def mkt(label: str, c: dict | None, p: dict | None) -> str | None:
        if not c:
            return None
        net = (c.get("mm_long") or 0) - (c.get("mm_short") or 0)
        pnet = ((p.get("mm_long") or 0) - (p.get("mm_short") or 0)) if p else None
        delta = f" ({'+' if net - pnet >= 0 else ''}{net - pnet:,} w/w)" if pnet is not None else ""
        return (f"{label}: MM net {net:+,} lots{delta} · "
                f"OI {_fmt(c.get('oi_total'))}")

    parts = [x for x in (mkt("NY arabica", cur.get("ny"), prev.get("ny")),
                         mkt("LDN robusta", cur.get("ldn"), prev.get("ldn"))) if x]
    if not parts:
        return None
    return f"📊 COT — report dated {cur['date']}:\n" + "\n".join(f"• {p}" for p in parts)


def compose_freight(now: dt.datetime) -> str | None:
    """Route rates with w/w movement. Gate: freight.json updated ≤1 day ago."""
    d = _load(DATA / "freight.json")
    if not isinstance(d, dict) or not _fresh(d.get("updated"), 1.5, now):
        return None
    lines = []
    for r in d.get("routes") or []:
        if r.get("rate") is None:
            continue
        lines.append(f"• {r.get('from','?')}→{r.get('to','?')}: "
                     f"{_fmt(r['rate'])} {r.get('unit','')}{_arrow(r.get('rate'), r.get('prev'))}")
    if not lines:
        return None
    return f"🚢 Freight rates ({d.get('updated')}):\n" + "\n".join(lines)


def _imports_text(path: Path, flag: str, dest: str, now: dt.datetime) -> str | None:
    d = _load(path)
    if not isinstance(d, dict) or not _fresh(d.get("updated"), 2, now):
        return None
    totals = d.get("total_by_year") or {}
    years = sorted(totals)
    if not years:
        return None
    y = years[-1]
    prev_y = years[-2] if len(years) > 1 else None
    top = sorted(
        ((o.get("name"), (o.get("by_year") or {}).get(y)) for o in d.get("origins") or []),
        key=lambda t: -(t[1] or 0),
    )[:3]
    top_txt = ", ".join(f"{n} { _fmt(v/1000,1)}k t" for n, v in top if v)
    return (f"{flag} {dest} coffee imports — {y}: {_fmt(totals[y]/1000,1)}k t"
            f"{_yoy(totals.get(y), totals.get(prev_y) if prev_y else None)}\n"
            f"• top origins: {top_txt}")


def compose_us_imports(now: dt.datetime) -> str | None:
    return _imports_text(DATA / "us_coffee_imports.json", "🇺🇸", "US", now)


def compose_eu_imports(now: dt.datetime) -> str | None:
    return _imports_text(DATA / "eu_coffee_imports.json", "🇪🇺", "EU", now)


def compose_enso(now: dt.datetime) -> str | None:
    """Weekly Niño-3.4 anomaly + phase, plus WWV when available."""
    d = _load(DATA / "enso_indices.json")
    if not isinstance(d, dict) or not _fresh(d.get("scraped_at"), 2, now):
        return None
    latest = (d.get("nino34") or {}).get("latest") or {}
    if latest.get("sst_anomaly") is None:
        return None
    phase = (latest.get("phase") or "?").replace("-", " ")
    txt = (f"🌊 ENSO weekly — Niño 3.4 anomaly {latest['sst_anomaly']:+.1f}°C "
           f"({phase}), week ending {latest.get('week_ending','?')}")
    sub = _load(DATA / "enso_subsurface.json") or {}
    wwv_latest = ((sub.get("wwv") or {}).get("latest") or {})
    if isinstance(wwv_latest, dict) and wwv_latest.get("value") is not None:
        txt += f"\n• warm-water volume {wwv_latest['value']:+.2f}×10¹⁴ m³ ({wwv_latest.get('month','?')})"
    return txt


# ── Origin export digests (invoked by the sentinel on verified ingestion) ────

def compose_origin_digest(sentinel_key: str, month: str) -> str | None:
    """Headline export numbers for the month the sentinel just verified.
    Returns None when the month is missing or the source has no digest."""
    try:
        if sentinel_key == "cecafe":
            d = _load(DATA / "cecafe.json") or {}
            rows = {r.get("date"): r for r in d.get("series") or []}
            r, p = rows.get(month), rows.get(_year_back(month))
            if not r:
                return None
            return (f"🇧🇷 Brazil (Cecafé) {month}: total {_fmt(r.get('total'))} bags"
                    f"{_yoy(r.get('total'), (p or {}).get('total'))} — "
                    f"arabica {_fmt(r.get('arabica'))}, conillon {_fmt(r.get('conillon'))}")
        if sentinel_key == "ucda":
            d = _load(DATA / "uganda_monthly.json") or {}
            rows = {r.get("month"): r for r in d.get("series") or []}
            r, p = rows.get(month), rows.get(_year_back(month))
            if not r:
                return None
            return (f"🇺🇬 Uganda (UCDA) {month}: {_fmt(r.get('total_bags'))} bags"
                    f"{_yoy(r.get('total_bags'), (p or {}).get('total_bags'))} — "
                    f"robusta {_fmt(r.get('robusta_bags'))}, arabica {_fmt(r.get('arabica_bags'))}")
        if sentinel_key in ("dane", "fnc"):
            d = _load(DATA / "colombia_supply.json") or {}
            rows = {r.get("month"): r for r in (d.get("exports") or {}).get("monthly") or []}
            r, p = rows.get(month), rows.get(_year_back(month))
            if not r:
                return None
            return (f"🇨🇴 Colombia {month}: {_fmt(r.get('total_k_bags'))}k bags "
                    f"({_fmt(r.get('total_t'))} t){_yoy(r.get('total_t'), (p or {}).get('total_t'))}")
        if sentinel_key == "vn_customs":
            d = _load(CACHE / "vn_coffee_export.json") or {}
            rows = {r.get("month"): r for r in d.get("monthly") or []}
            r = rows.get(month)
            if not r:
                return None
            p = rows.get(_year_back(month))
            return (f"🇻🇳 Vietnam {month}: {_fmt(r.get('tonnes'))} t exported"
                    f"{_yoy(r.get('tonnes'), (p or {}).get('tonnes'))} — "
                    f"YTD {_fmt(r.get('ytd_cum_qty_tonnes'))} t")
        if sentinel_key == "vn_customs_dest":
            d = _load(DATA / "vn_export_by_destination.json") or {}
            month_vals = sorted(
                ((c, v.get(month)) for c, v in (d.get("countries") or {}).items() if v.get(month)),
                key=lambda t: -t[1],
            )[:5]
            if not month_vals:
                return None
            tops = ", ".join(f"{c} {_fmt(v)}t" for c, v in month_vals)
            return f"🇻🇳 Vietnam destinations {month}: top — {tops}"
    except Exception:  # noqa: BLE001 — a digest must never break the sentinel
        return None
    return None


def _year_back(month: str) -> str:
    return f"{int(month[:4]) - 1}-{month[5:7]}"


# ── Dedup keys for sentinel-driven topics ────────────────────────────────────
# cot.json / freight.json are produced by the export pipeline (not the scraper
# workflows), so their notifications ride the daily sentinel run instead —
# these keys let it send exactly once per new report/update.

def latest_cot_key() -> str | None:
    rows = _load(DATA / "cot.json")
    return rows[-1].get("date") if isinstance(rows, list) and rows else None


def latest_freight_key() -> str | None:
    d = _load(DATA / "freight.json")
    return d.get("updated") if isinstance(d, dict) else None


# ── Send + CLI ───────────────────────────────────────────────────────────────

TOPICS = {
    "cot": compose_cot,
    "freight": compose_freight,
    "us_imports": compose_us_imports,
    "eu_imports": compose_eu_imports,
    "enso": compose_enso,
}


def send(text: str) -> None:
    import os
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        print("[topic_notify] telegram not configured — printing only")
        return
    try:
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      data={"chat_id": chat, "text": text}, timeout=20)
    except requests.RequestException as e:  # best-effort by design
        print(f"[topic_notify] send failed: {e}")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in TOPICS:
        print(f"usage: python -m scraper.topic_notify <{'|'.join(TOPICS)}>")
        return 2
    topic = sys.argv[1]
    text = TOPICS[topic](dt.datetime.now(dt.timezone.utc))
    if text is None:
        print(f"[topic_notify] {topic}: data not fresh (or absent) — nothing to send")
        return 0
    print(text)
    send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
