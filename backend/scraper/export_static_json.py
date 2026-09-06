"""
export_static_json.py — thin orchestrator.

Queries the database and exports static JSON files consumed directly by the
Vercel frontend (no live Render API call at page load). The per-topic exporters
live in scraper/exporters/<domain>.py; this module only owns the topic registry
(`_exporters`) and the run loop (`_run_exporters`, with `--only` topic slicing
and per-topic failure isolation).

    cd backend
    python -m scraper.export_static_json [--only cot,latest_prices,…]

Failure isolation
=================
Every topic exporter is invoked inside a try/except. A broken `cot` exporter
will no longer abort `news`, `freight`, `weather`, etc. — each topic runs
independently and the orchestrator logs which ones skipped. The `health`
exporter then runs last with the per-topic success map (`exporters_published_at`)
so a silently-failed topic shows up as stale in `health.json` and the daily
freshness workflow (1.5) raises a Telegram alert on the next cycle.
"""

import sys
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from scraper.exporters.base import OUT_DIR
from scraper.exporters.cot import export_cot, export_macro_cot
from scraper.exporters.demand import export_demand_stocks, export_factory_mix_step
from scraper.exporters.enso_arbitrage import export_enso_arbitrage
from scraper.exporters.export_expectations import export_expectations
from scraper.exporters.front_spread import export_front_spread
from scraper.exporters.futures import (
    export_futures_chain,
    export_futures_price_history,
    export_oi_fnd_chart,
)
from scraper.exporters.health import export_health
from scraper.exporters.macro import (
    export_freight,
    export_retail_cpi,
    export_treasury_yields,
    export_us_cpi,
)
from scraper.exporters.news import export_news
from scraper.exporters.price_elasticity import export_price_elasticity
from scraper.exporters.prices import export_latest_prices, export_vn_physical_prices
from scraper.exporters.supply import (
    export_colombia,
    export_ethiopia,
    export_farmer_economics,
    export_farmer_selling,
    export_honduras,
    export_indonesia,
    export_uganda,
    export_vietnam_last,
    export_vietnam_supply,
    export_vn_export_by_destination,
)
from scraper.exporters.vn_midmonth import export_vn_midmonth
from scraper.exporters.workflow_failures import export_workflow_failures


def _exporters(db):
    """Ordered registry of (topic-key, exporter) pairs.

    `main()` runs the full list (nightly cron / manual). Passing `only=[…]`
    runs just that slice — workflow 1.4 maps each upstream scraper trigger to
    the topics it actually affects, avoiding a full 22-topic re-export on every
    run. `health` always runs so the freshness manifest stays current.

    The exporters here raise on failure; the orchestrator's _run_exporters
    catches and reports per-topic. That replaces the older pattern of inline
    try/except wrappers around individual entries (news, country_pins,
    enso) — those entries no longer special-case their failures because the
    outer loop handles every topic uniformly.

    oi_history.json is owned solely by the Daily OI workflow (1.3) and is NOT
    exported here (avoids clobbering 1.3's fresher copy with a stale one).
    """
    from scraper.exporters.conilon_basis import export_conilon_basis
    from scraper.exporters.cot_cropyear_xray import export_cot_cropyear_xray
    from scraper.exporters.cot_options_book import export_cot_options_book
    from scraper.exporters.cot_sept_study import export_cot_sept_study
    from scraper.exporters.cot_swap_identity import export_cot_swap_identity
    from scraper.exporters.ice_publish_times import export_ice_publish_times
    from scraper.exporters.intraday_drift import export_intraday_drift
    from scraper.exporters.open_direction_factors import export_open_direction_factors
    from scraper.exporters.options_expiry_study import export_options_expiry_study
    from scraper.exporters.options_flow_cot import export_options_flow_cot
    from scraper.exporters.options_gamma_map import export_options_gamma_map
    from scraper.exporters.options_oi_walls import export_options_oi_walls
    from scraper.exporters.options_optionization import export_options_optionization
    from scraper.exporters.options_skew import export_options_skew
    from scraper.exporters.options_vrp import export_options_vrp
    from scraper.exporters.publish_model_inputs import export_model_inputs
    from scraper.exporters.tender_parity import export_tender_parity
    from scraper.exporters.yield_rainfall import export_yield_rainfall
    from scraper.sources.brazil_arabica_fisico import export_brazil_arabica_fisico
    from scraper.sources.brazil_b3_arabica import export_brazil_b3_arabica
    from scraper.sources.brazil_b3_conilon import export_brazil_b3_conilon
    from scraper.sources.brazil_coffeecopa import export_brazil_coffeecopa
    from scraper.sources.brazil_conilon_vitoria import export_brazil_conilon_vitoria
    from scraper.sources.cepea_conilon_indicator import export_cepea_conilon_indicator
    from scraper.sources.origin_prices_history import export_origin_prices_history

    def _country_pins():
        from scraper.build_country_pins import export_country_pins
        export_country_pins()

    def _world_consumption():
        # After stocks (it reads demand_stocks.json) and after any admin edit
        # to the hub lines, so the consensus is built from current inputs.
        from scraper.build_world_consumption import export as export_world_consumption
        export_world_consumption()

    def _enso_intel():
        # The measured teleconnection is refreshed FIRST: it is derived from
        # the weather history the pipeline has just rewritten, and the risk
        # pins are scored against it. Rebuilding the pins from a stale
        # measurement is the drift this whole module exists to avoid.
        from scraper.build_enso_intel import export_enso_intel
        from scraper.enso_teleconnection import export as export_teleconnection
        export_teleconnection()
        export_enso_intel()

    return [
        ("world_consumption",     _world_consumption),
        ("futures_chain",         lambda: export_futures_chain(db)),
        ("oi_fnd_chart",          lambda: export_oi_fnd_chart(db)),
        ("futures_price_history", lambda: export_futures_price_history(db)),
        ("front_spread",          lambda: export_front_spread()),
        ("vn_midmonth",           lambda: export_vn_midmonth()),
        ("export_expectations",   lambda: export_expectations()),
        ("workflow_failures",     lambda: export_workflow_failures()),
        ("enso_arbitrage",        lambda: export_enso_arbitrage()),
        ("cot",                   lambda: export_cot(db)),
        ("macro_cot",             lambda: export_macro_cot(db)),
        ("freight",               lambda: export_freight(db)),
        ("farmer_economics",      lambda: export_farmer_economics(db)),
        ("farmer_selling",        lambda: export_farmer_selling()),
        ("vietnam_last",          lambda: export_vietnam_last()),
        ("vietnam_supply",        lambda: export_vietnam_supply()),
        ("vn_export_by_destination", lambda: export_vn_export_by_destination()),
        ("colombia",              lambda: export_colombia(db)),
        ("honduras",              lambda: export_honduras(db)),
        ("indonesia",             lambda: export_indonesia(db)),
        ("uganda",                lambda: export_uganda(db)),
        ("ethiopia",              lambda: export_ethiopia(db)),
        ("demand_stocks",         lambda: export_demand_stocks(db)),
        ("factory_mix",           lambda: export_factory_mix_step()),
        ("retail_cpi",            lambda: export_retail_cpi(db)),
        ("us_cpi",                lambda: export_us_cpi(db)),
        ("treasury_yields",       lambda: export_treasury_yields()),
        ("latest_prices",         lambda: export_latest_prices(db)),
        ("vn_physical_prices",    lambda: export_vn_physical_prices(db)),
        # Must run BEFORE origin_prices_history: it writes brazil_arabica_fisico.json,
        # from which origin_prices_history reads the Brazil Arabica trimmed mean.
        ("brazil_arabica_fisico", lambda: export_brazil_arabica_fisico()),
        ("brazil_b3_arabica",     lambda: export_brazil_b3_arabica()),
        ("brazil_b3_conilon",     lambda: export_brazil_b3_conilon()),
        ("brazil_coffeecopa",     lambda: export_brazil_coffeecopa()),
        ("brazil_conilon_vitoria", lambda: export_brazil_conilon_vitoria()),
        ("cepea_conilon_indicator", lambda: export_cepea_conilon_indicator()),
        ("origin_prices_history", lambda: export_origin_prices_history(db)),
        ("tender_parity",         lambda: export_tender_parity()),
        # Derived: needs origin_prices_history, fx_history and
        # futures_price_history already on disk.
        ("price_elasticity",      lambda: export_price_elasticity()),
        ("cot_sept_study",        lambda: export_cot_sept_study()),
        ("cot_cropyear_xray",     lambda: export_cot_cropyear_xray()),
        ("cot_swap_identity",     lambda: export_cot_swap_identity()),
        ("cot_options_book",      lambda: export_cot_options_book()),
        ("options_expiry_study",  lambda: export_options_expiry_study()),
        ("options_gamma_map",     lambda: export_options_gamma_map()),
        ("options_vrp",           lambda: export_options_vrp()),
        ("options_skew",          lambda: export_options_skew()),
        ("options_flow_cot",      lambda: export_options_flow_cot()),
        ("options_oi_walls",      lambda: export_options_oi_walls()),
        ("options_optionization", lambda: export_options_optionization()),
        ("open_direction_factors", lambda: export_open_direction_factors()),
        ("model_inputs",          lambda: export_model_inputs()),
        ("intraday_drift",        lambda: export_intraday_drift()),
        ("yield_rainfall",        lambda: export_yield_rainfall()),
        ("conilon_basis",         lambda: export_conilon_basis()),
        ("ice_publish_times",     lambda: export_ice_publish_times()),
        ("news",                  lambda: export_news(db)),
        ("country_pins",          _country_pins),
        ("enso",                  _enso_intel),
        # `health` is intentionally absent — main() runs it after the loop so
        # it can see which other topics published successfully on this run.
    ]


def _run_exporters(db, only_set: set[str] | None) -> dict[str, str]:
    """Run each topic exporter inside a try/except. Returns {topic: iso_ts}
    for the topics that published successfully on this invocation.

    A topic that raises is logged + annotated and omitted from the returned
    map — the remaining topics still run. The outer caller passes the map
    to export_health so health.json's per-exporter timestamps reflect what
    actually published.

    DB session safety
    =================
    SQLAlchemy leaves a Session in an aborted-transaction state after a
    query raises — the next query attempt then fails with "This Session's
    transaction has been rolled back due to a previous exception" until
    rollback() is called. Without an explicit rollback per failure, this
    function's "isolation" would cascade the failure to every subsequent
    DB-touching exporter. The rollback() is always safe: no-op when no
    transaction is active, and we swallow any rollback-itself error so
    the loop continues even if the DB is unreachable mid-run.

    Failure surfacing
    =================
    Each failure prints a GitHub Actions error annotation in addition to
    the stderr log line. The annotation shows red in the Actions UI but
    does NOT change the job's exit code — so downstream workflow_run
    chains (redeploy-vercel, morning-brief) still fire normally with the
    topics that did publish. The persistent-failure signal lives in
    health.json["exporters"] and the daily 1.5 freshness check.
    """
    published_at: dict[str, str] = {}
    timings: list[tuple[str, float]] = []
    for key, fn in _exporters(db):
        if only_set is not None and key not in only_set:
            continue
        t0 = perf_counter()
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — isolate one topic from the rest
            # GitHub Actions annotation — red in the UI, doesn't fail the job.
            print(f"::error title=Exporter {key} failed::{type(e).__name__}: {e}", file=sys.stderr)
            # Human-readable log line for raw stderr / non-GHA runs.
            print(f"  {key} → skipped ({type(e).__name__}: {e})", file=sys.stderr)
            # Reset the session so the NEXT exporter's queries don't fail
            # against an aborted transaction (see docstring).
            try:
                db.rollback()
            except Exception:  # noqa: BLE001 — best-effort; loop must continue
                pass
            continue
        elapsed = perf_counter() - t0
        timings.append((key, elapsed))
        published_at[key] = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    # Per-topic timing. The full nightly export spends ~5.5 min in this loop
    # across ~37 topics and used to report nothing but success, so a single
    # slow query was invisible. Slowest-first, with the total, so a regression
    # shows up in the workflow log without extra tooling.
    if timings:
        total = sum(t for _k, t in timings)
        slowest = sorted(timings, key=lambda kv: kv[1], reverse=True)[:8]
        print(f"\n  timing: {len(timings)} topics in {total:.1f}s — slowest:")
        for key, secs in slowest:
            share = (secs / total * 100) if total else 0
            print(f"    {secs:7.2f}s  {share:4.1f}%  {key}")
    return published_at


def main(only=None):
    only_set = set(only) if only else None
    # Building the registry with a None db only reads the keys — the exporters
    # aren't invoked. Computed unconditionally: it validates --only below, and
    # health.json needs it on every run to prune topics that no longer exist.
    known = {k for k, _ in _exporters(None)} | {"health"}
    if only_set is not None:
        unknown = only_set - known
        if unknown:
            raise SystemExit(f"Unknown export topic(s): {', '.join(sorted(unknown))}. Known: {', '.join(sorted(known))}")
    print(f"Exporting static JSON files... [{'full' if only_set is None else ','.join(sorted(only_set))}]")
    db = SessionLocal()
    try:
        published_at = _run_exporters(db, only_set)
        # health always runs last — its freshness manifest reflects the topics
        # that just published. Passing exporters_published_at lets it record
        # per-topic success/failure independently of the per-scraper signal;
        # passing the registry lets it tell a topic that merely didn't run this
        # time from one that has been deleted (see export_health's docstring).
        export_health(db, exporters_published_at=published_at, known_exporters=known)
    finally:
        db.close()
    print(f"Done → {OUT_DIR}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Export DB → static JSON for the frontend.")
    ap.add_argument("--only", default="", help="comma-separated topic keys to export (default: all topics)")
    args = ap.parse_args()
    topics = [t.strip() for t in args.only.split(",") if t.strip()]
    main(topics or None)
