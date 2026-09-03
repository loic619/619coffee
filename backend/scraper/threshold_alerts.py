"""
threshold_alerts.py — "tell me when": admin threshold alerts over Telegram.

Every tab in the app is a reference surface; nothing reached a reader who was
not looking at the screen. This is the smallest thing that changes that: a
handful of rules in data/alert_thresholds.json ("KC front settles above X",
"certified robusta below Y lots"), checked after every export, posted to the
admin Telegram channel when a condition BECOMES true.

Edge-triggered, not level-triggered. A rule fires once when its condition
turns true and then disarms; it re-arms only after the condition has been
observed false again. A market sitting above a line for a fortnight is one
message, not fourteen. State lives in data/alert_state.json (committed).

The channel is admin-only and the app never links to it; the Research · Admin
page shows the rules, their current values and their armed state — read-only.
Rules are edited in the repo.

Run:  cd backend && PYTHONPATH=. python -m scraper.threshold_alerts [--dry]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES_PATH = ROOT / "data" / "alert_thresholds.json"
STATE_PATH = ROOT / "data" / "alert_state.json"
PUBLIC_PATH = ROOT / "frontend" / "public" / "data" / "alert_thresholds.json"
DATA = ROOT / "frontend" / "public" / "data"

OPS = {
    ">":  lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "<":  lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
}


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


# ── Metrics: one function per watched number, each returning (value, as_of) ──

def _front(market: str) -> tuple[float | None, str | None]:
    chain = _load(DATA / "futures_chain.json").get(market) or {}
    cs = chain.get("contracts") or []
    if not cs or cs[0].get("last") is None:
        return None, None
    return float(cs[0]["last"]), chain.get("pub_date")


def _cert(file: str, key: str) -> tuple[float | None, str | None]:
    snaps = _load(DATA / file).get("snapshots") or []
    if not snaps or snaps[-1].get(key) is None:
        return None, None
    return float(snaps[-1][key]), snaps[-1].get("date")


def _cci() -> tuple[float | None, str | None]:
    """Coffee Currency Index level — lives under quant_report.json['currency_index']."""
    ci = _load(DATA / "quant_report.json").get("currency_index") or {}
    v = ci.get("index_value")
    if not isinstance(v, (int, float)):
        return None, None
    as_of = ci.get("scraped_at")
    return float(v), (str(as_of)[:10] if as_of else None)


METRICS = {
    "kc_front":     lambda: _front("arabica"),
    "rc_front":     lambda: _front("robusta"),
    "kc_cert_bags": lambda: _cert("certified_stocks_arabica.json", "total_bags"),
    "rc_cert_lots": lambda: _cert("certified_stocks_robusta.json", "total_lots_certified"),
    "cci":          _cci,
}


# ── Evaluation ────────────────────────────────────────────────────────────────

def evaluate(rules: list[dict], state: dict, values: dict[str, tuple[float | None, str | None]],
             now_iso: str) -> tuple[list[dict], dict, list[dict]]:
    """Returns (fired, new_state, published_rows).

    Pure: no I/O, so it is testable. `state[rule_id] = {armed, last_value,
    last_fired, last_as_of}`. A rule with a missing metric is left untouched.
    """
    fired: list[dict] = []
    new_state = {k: dict(v) for k, v in state.items()}
    rows: list[dict] = []
    for r in rules:
        rid, metric, op, threshold = r["id"], r["metric"], r["op"], float(r["value"])
        value, as_of = values.get(metric, (None, None))
        st = new_state.setdefault(rid, {"armed": True, "last_value": None, "last_fired": None, "last_as_of": None})
        cond = None
        if value is not None and op in OPS:
            cond = OPS[op](value, threshold)
            if cond and st.get("armed", True):
                fired.append({**r, "value": threshold, "observed": value, "as_of": as_of})
                st.update({"armed": False, "last_fired": now_iso})
            elif not cond and not st.get("armed", True):
                st["armed"] = True          # condition cleared → re-arm
            st.update({"last_value": value, "last_as_of": as_of})
        rows.append({
            "id": rid, "metric": metric, "op": op, "threshold": threshold, "label": r.get("label", rid),
            "current": value, "as_of": as_of, "condition": cond,
            "armed": st.get("armed", True), "last_fired": st.get("last_fired"),
        })
    return fired, new_state, rows


def _fmt(metric: str, v: float) -> str:
    if metric in ("kc_front", "cci"):
        return f"{v:,.2f}"
    return f"{v:,.0f}"


def compose(f: dict) -> str:
    unit = {"kc_front": "¢/lb", "rc_front": "USD/MT", "kc_cert_bags": "bags",
            "rc_cert_lots": "lots", "cci": ""}.get(f["metric"], "")
    return (f"🔔 <b>Threshold</b> — {f['label']}\n"
            f"{f['metric']}: <b>{_fmt(f['metric'], f['observed'])}</b> {unit}"
            f" (rule {f['op']} {_fmt(f['metric'], f['value'])})"
            + (f" · as of {f['as_of']}" if f.get("as_of") else "")
            + "\nRe-arms once the condition clears.")


def send(text: str) -> bool:
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        print("[alerts] telegram not configured — printing only")
        return False
    try:
        import requests
        requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                      data={"chat_id": chat, "text": text, "parse_mode": "HTML"}, timeout=20)
        return True
    except Exception as e:  # noqa: BLE001 — best-effort by design
        print(f"[alerts] send failed: {e}")
        return False


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="evaluate and print; write nothing, send nothing")
    a = ap.parse_args(argv)

    cfg = _load(RULES_PATH)
    rules = cfg.get("rules") or []
    if not rules:
        print("[alerts] no rules — nothing to do")
        return 0
    state = _load(STATE_PATH)
    values = {m: fn() for m, fn in METRICS.items()}
    now_iso = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")

    fired, new_state, rows = evaluate(rules, state, values, now_iso)
    for row in rows:
        cur = "—" if row["current"] is None else _fmt(row["metric"], row["current"])
        print(f"  {row['id']:<24} {row['metric']:<13} {cur:>12} {row['op']} {_fmt(row['metric'], row['threshold']):>10}"
              f"  cond={row['condition']}  armed={row['armed']}")
    print(f"[alerts] {len(fired)} to fire")
    for f in fired:
        text = compose(f)
        print(text)
        if not a.dry:
            send(text)

    if a.dry:
        return 0
    STATE_PATH.write_text(json.dumps(new_state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    PUBLIC_PATH.write_text(json.dumps({
        "checked_at": now_iso,
        "delivery": "admin Telegram channel",
        "rules": rows,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"[alerts] state → {STATE_PATH.relative_to(ROOT)} · published → {PUBLIC_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
