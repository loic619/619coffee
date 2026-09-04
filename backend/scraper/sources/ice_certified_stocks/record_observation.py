"""
record_observation.py — the two things an operator can tell us about a lost day.

The robusta stock CSV is served under an HHMMSS-stamped URL with no index, and
the sweep deliberately covers only 10:29–11:00. A session published outside that
window is announced on Telegram and listed as pending on the Admin research
page, because the one thing that recovers it is a human reading the second off
the ICE filename.

That is one of TWO reasons a business day can have no snapshot, and the page
could only express the first:

  * **the second is unknown** — there was a report, we failed to guess it.
    The operator supplies the six digits, tier 0 fetches it in one GET.
  * **there was no report at all** — ICE Futures Europe was closed. 2026-08-31
    was the UK summer bank holiday; the sweep walked the whole window because
    nothing existed to find. No second will ever close that day, and leaving it
    on the pending list makes a permanent to-do out of a non-event.

Both write to a small JSON record the exporter reads, and both are dispatched by
workflow 0.19 from the research page. The logic lives here rather than in a YAML
heredoc because it is the part with rules in it — see the consistency guards
below — and rules in a workflow file are rules nothing tests.

Invariants worth stating, because each one is a way the record could go wrong:

  * A date is in at most one of the two files. They are contradictory claims:
    knowing the publish second means there WAS a release.
  * Marking a day no-release when its second is already known is refused, not
    silently applied — that is an operator mistake, and overwriting a real
    observation with a claim that it never happened is the worst outcome.
  * Recording a second for a day previously marked no-release withdraws the
    mark. Evidence beats classification: if the file exists, the market was open.
  * Weekends are refused. They are not business days, so nothing counts them as
    missing and "no release" says nothing.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HITS = HERE / "stock_report_hits.json"
NO_RELEASE = HERE / "no_release_days.json"

MAX_REASON = 200


# ── validation ───────────────────────────────────────────────────────────────

def validate_date(value: str) -> str:
    """A past-or-present weekday, as YYYY-MM-DD."""
    d = (value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise ValueError(f"bad date: {value!r} — want YYYY-MM-DD")
    try:
        day = dt.date.fromisoformat(d)
    except ValueError as exc:
        raise ValueError(f"not a calendar date: {value!r}") from exc
    if day > dt.date.today():
        raise ValueError(f"{d} is in the future")
    if day.weekday() >= 5:
        raise ValueError(f"{d} is a {day.strftime('%A')} — ICE does not publish at weekends")
    return d


def validate_hhmmss(value: str) -> str:
    """The six digits as they appear in the filename."""
    t = (value or "").strip()
    if not re.fullmatch(r"\d{6}", t):
        raise ValueError(f"bad time: {value!r} — want HHMMSS, e.g. 112351")
    hh, mm, ss = int(t[:2]), int(t[2:4]), int(t[4:6])
    if not (0 <= hh < 24 and 0 <= mm < 60 and 0 <= ss < 60):
        raise ValueError(f"not a wall-clock time: {t}")
    return t


def validate_reason(value: str) -> str:
    """Why there was no release. Required — the whole point is the audit trail."""
    r = " ".join((value or "").split())
    if not r:
        raise ValueError("a reason is required — it is the only record of why the day is closed")
    return r[:MAX_REASON]


# ── pure record edits ────────────────────────────────────────────────────────

def put_hit(doc: dict, date: str, hhmmss: str, source: str = "operator") -> dict:
    """Set the publish second for `date`, replacing any previous entry.

    "bootstrap" rows are the seed guesses shipped before any capture existed;
    they sort first and are never touched.
    """
    hits = [h for h in doc.get("hits", []) if h.get("date") != date]
    hits.append({"date": date, "hhmmss": hhmmss, "source": source})
    hits.sort(key=lambda h: (h.get("date") != "bootstrap", h.get("date", "")))
    return {**doc, "hits": hits}


def hit_for(doc: dict, date: str) -> dict | None:
    for h in doc.get("hits", []):
        if h.get("date") == date:
            return h
    return None


def put_no_release(doc: dict, date: str, reason: str, at: str | None = None) -> dict:
    """Mark `date` as a day ICE published nothing, replacing any previous mark."""
    days = [d for d in doc.get("days", []) if d.get("date") != date]
    days.append({
        "date": date,
        "reason": reason,
        "source": "operator",
        "recorded": at or dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    days.sort(key=lambda d: d.get("date", ""))
    return {**doc, "days": days}


def drop_no_release(doc: dict, date: str) -> dict:
    return {**doc, "days": [d for d in doc.get("days", []) if d.get("date") != date]}


def marked_no_release(doc: dict, date: str) -> bool:
    return any(d.get("date") == date for d in doc.get("days", []))


# ── file I/O ─────────────────────────────────────────────────────────────────

_NO_RELEASE_NOTE = (
    "Business days on which ICE Futures Europe published no robusta "
    "certified-stock report at all — exchange holidays and closures. These are "
    "not misses: no publish second exists to find, so they are excluded from "
    "the session count rather than left pending forever."
)


def _load(path: Path, default: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return dict(default)


def _save(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def record_time(date: str, hhmmss: str, hits_path: Path = HITS,
                no_release_path: Path = NO_RELEASE) -> str:
    date, hhmmss = validate_date(date), validate_hhmmss(hhmmss)
    _save(hits_path, put_hit(_load(hits_path, {"hits": []}), date, hhmmss))
    msg = f"recorded {date} -> {hhmmss}"

    # Evidence beats classification: a filename we can name is proof the market
    # was open, so an earlier "no release" mark on that day was wrong.
    nr = _load(no_release_path, {"note": _NO_RELEASE_NOTE, "days": []})
    if marked_no_release(nr, date):
        _save(no_release_path, drop_no_release(nr, date))
        msg += " (withdrew its 'no release' mark — the report exists)"
    return msg


def record_no_release(date: str, reason: str, hits_path: Path = HITS,
                      no_release_path: Path = NO_RELEASE, at: str | None = None) -> str:
    date, reason = validate_date(date), validate_reason(reason)

    existing = hit_for(_load(hits_path, {"hits": []}), date)
    if existing:
        # Refused rather than applied. Overwriting a real observation with a
        # claim that it never happened is the one edit here that destroys data.
        raise ValueError(
            f"{date} already has a recorded publish time ({existing.get('hhmmss')}) — "
            "it did release. Nothing to pass."
        )

    doc = _load(no_release_path, {"note": _NO_RELEASE_NOTE, "days": []})
    doc.setdefault("note", _NO_RELEASE_NOTE)
    _save(no_release_path, put_no_release(doc, date, reason, at=at))
    return f"marked {date} as no release — {reason}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", required=True, help="session date, YYYY-MM-DD")
    ap.add_argument("--hhmmss", default="", help="publish time from the filename; omit to pass the day")
    ap.add_argument("--reason", default="", help="why there was no release (when --hhmmss is omitted)")
    args = ap.parse_args(argv)
    # Read the paths off the module at CALL time, not from the default argument,
    # so a test can point both files at a tmpdir.
    try:
        print(record_time(args.date, args.hhmmss, HITS, NO_RELEASE) if args.hhmmss.strip()
              else record_no_release(args.date, args.reason, HITS, NO_RELEASE))
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
