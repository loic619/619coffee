"""ICE certified-stocks → news-feed commentary.

Reads the two snapshot lists produced by `orchestrate.run()`, computes the
day-over-day delta for each market, and renders a factual commentary line
via `scraper.commentary.render`. The line is stored on a NewsItem with the
text embedded under `meta._commentary` so the news.json exporter can
promote it to a top-level `commentary` field.

Pure helpers (commentary computation) are kept separate from the DB write
so unit tests can pin the wording without spinning up a session.

Units convention (see _arabica_snapshot / _robusta_snapshot):
  • Arabica: `total_bags` (60 kg bags), `passed_today_bags`, `failed_today_bags`
  • Robusta: `total_lots_certified` (10 t lots), `lots_graded_today`

The "decertified in [port]" clause from the spec template is intentionally
omitted in this slice — neither snapshot exposes a clean per-port decert
delta yet. The Jinja conditional in the template makes the clause vanish
when `decert_delta` is falsy, so this degrades cleanly when the field
shows up later.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime

from scraper.commentary import embed_commentary, render, signed, thousep


def _last_two(snapshots: list[dict]) -> tuple[dict, dict] | None:
    """Return (previous, latest) iff there are at least two snapshots and
    they carry usable totals. None when the window is too short or empty."""
    if not snapshots or len(snapshots) < 2:
        return None
    return snapshots[-2], snapshots[-1]


def compute_arabica_commentary(snapshots: list[dict]) -> tuple[str, str] | None:
    """Return (date_iso, commentary_text) for KC Arabica, or None when the
    snapshot window is too short / fields are missing."""
    pair = _last_two(snapshots)
    if pair is None:
        return None
    prev, cur = pair
    cur_total  = cur.get("total_bags")
    prev_total = prev.get("total_bags")
    if cur_total is None or prev_total is None:
        return None
    delta = cur_total - prev_total
    # Both scalars are OUTCOMES of the day's grading — passed_today_bags is
    # not "the amount graded" and failed_today_bags is not decertification.
    # Reading them that way had the line quote the passed count as the graded
    # total (320 rather than 1,600 on 2026-08-27).
    grading = (cur.get("passed_today_bags") or 0) + (cur.get("failed_today_bags") or 0)
    text = render("ice_certified_stocks", {
        "market":        "KC Arabica",
        "delta_signed":  signed(delta),
        "units":         "bags",
        "total":         thousep(cur_total),
        "grading_delta": grading,
        "decert_delta":  0,      # per-port decert not yet wired — clause stays hidden
        "port":          None,
    })
    return cur["date"], text


def compute_robusta_commentary(snapshots: list[dict]) -> tuple[str, str] | None:
    """Return (date_iso, commentary_text) for RC Robusta, or None when the
    snapshot window is too short / fields are missing."""
    pair = _last_two(snapshots)
    if pair is None:
        return None
    prev, cur = pair
    cur_total  = cur.get("total_lots_certified")
    prev_total = prev.get("total_lots_certified")
    if cur_total is None or prev_total is None:
        return None
    delta = cur_total - prev_total
    grading = cur.get("lots_graded_today") or 0
    text = render("ice_certified_stocks", {
        "market":        "RC Robusta",
        "delta_signed":  signed(delta),
        "units":         "lots",
        "total":         thousep(cur_total),
        "grading_delta": grading,
        "decert_delta":  0,
        "port":          None,
    })
    return cur["date"], text


def _news_item_for(market: str, date_iso: str, text: str, source_url: str | None) -> dict:
    """Shape the dict that `upsert_news_item` expects. `meta` carries both the
    structured `_commentary` block (lifted to news.json's top-level
    `commentary` by the exporter) and a freeform `source_url` for traceability."""
    meta_obj: dict = {"source_url": source_url} if source_url else {}
    embed_commentary(meta_obj, text=text, has_update=True, is_latest_trading_day=True)
    return {
        "title":    f"ICE {market} Certified Stocks – {date_iso}",
        "body":     text,
        "source":   "ICE",
        "category": "supply",
        "lat":      None,
        "lng":      None,
        "tags":     ["ice", "certified-stocks", market.lower().split()[0], "auto-commentary"],
        "meta":     json.dumps(meta_obj, ensure_ascii=False),
        "pub_date": datetime.now(UTC),
    }


def emit(arabica_json: dict, robusta_json: dict,
         *, arabica_source_url: str | None = None,
         robusta_source_url: str | None = None) -> int:
    """Upsert one news item per market into the news_feed DB. Returns the
    number of items written (0–2). No-op when DATABASE_URL isn't set —
    keeps local runs / smoke tests from needing a DB.

    Idempotency: `upsert_news_item` dedupes by `title`, and the title carries
    the snapshot date, so re-running the same day is a no-op while a new day
    creates a new row.
    """
    import os
    if not os.environ.get("DATABASE_URL"):
        print("[ice-news] DATABASE_URL unset — skipping news_feed upsert")
        return 0

    # Late imports so a DB-less environment (local dev, smoke tests) can still
    # import this module to exercise the pure helpers above.
    from scraper.db import get_session, upsert_news_item

    written = 0
    with get_session() as db:
        for market_label, snapshots_key, compute_fn, src_url in (
            ("KC Arabica", "snapshots", compute_arabica_commentary, arabica_source_url),
            ("RC Robusta", "snapshots", compute_robusta_commentary, robusta_source_url),
        ):
            source_json = arabica_json if market_label.startswith("KC") else robusta_json
            snapshots = source_json.get(snapshots_key) or []
            result = compute_fn(snapshots)
            if result is None:
                print(f"[ice-news] {market_label}: no commentary (need ≥2 snapshots with totals)")
                continue
            date_iso, text = result
            upsert_news_item(db, _news_item_for(market_label, date_iso, text, src_url))
            written += 1
            print(f"[ice-news] {market_label} {date_iso}: {text}")
    return written
