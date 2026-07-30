"""Agronomic alert engine — IPHM rules over the live weather + VHI feeds.

Sits at the end of the daily 1.10 weather workflow. Reads:
  - frontend/public/data/{origin}_weather.json   (SPI, SPEI, temp, forecast)
  - frontend/public/data/vhi_{origin}.json       (latest VHI per region)

Writes:
  - frontend/public/data/agronomic_alerts.json   (canonical per-region detail)
  - frontend/public/data/signals.json            (flattened append — Telegram
                                                  bot picks up via existing
                                                  signals[] consumer)

Stateless v1: no audit log of historical alerts. Severity tiers (Watch /
Alert / Critical) map to lowercase in the flattened signals.json so the
existing quant-signal consumer applies the same filtering.

Usage:
    python -m scraper.agronomic_alerts            # preview (no write)
    python -m scraper.agronomic_alerts --write    # persist both JSONs
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from scraper.rules import frost_model as _fm
from scraper.rules.iphm_thresholds import IPHM_RULES

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"

ALERTS_PATH  = DATA_DIR / "agronomic_alerts.json"
SIGNALS_PATH = DATA_DIR / "signals.json"

# Origin key (as used everywhere in the repo) → ISO-3 code (as used in IPHM
# rule `origins` filters). Must match the keys in fetch_origin_weather.ORIGINS
# and the country_iso3 fields in backend/seed/vhi_province_ids.json.
ORIGIN_ISO3 = {
    "brazil":    "BRA",
    "colombia":  "COL",
    "honduras":  "HND",
    "indonesia": "IDN",
    "uganda":    "UGA",
    "ethiopia":  "ETH",
    "vn":        "VNM",
}

# Fields evaluated against forward-looking forecast data, not observed
# history. If any condition in a fired rule references one of these, the
# alert's timeframe is "forecast"; otherwise "current".
FORECAST_FIELDS: set[str] = {"temp_min", "forecast_7d_rain", "forecast_hot_days"}

# Country-level fallback for the region arabica production share when the
# weather JSON doesn't carry per-region prod splits (only Brazil + Indonesia
# publish them today). Used by the rust rule's arabica_share condition.
DEFAULT_ARABICA_SHARE = {
    "brazil": 0.7, "colombia": 1.0, "honduras": 1.0, "ethiopia": 1.0,
    "vn": 0.02, "uganda": 0.2, "indonesia": 0.15,
}

HOT_DAY_TMAX_C = 34.0            # forecast day counts as "hot" at/above this Tmax

WATER_PATH = DATA_DIR / "vn_water_levels.json"
WATER_MAX_AGE_DAYS   = 30        # ignore a stale bulletin
WATER_LOW_TBNN_PCT   = -30.0     # flows ≤ this % vs normal → escalate VN drought
WATER_OK_TBNN_PCT    = -10.0     # flows ≥ this % vs normal → cap VN drought at alert

_SEV_ORDER = {"watch": 0, "alert": 1, "critical": 2}
_SEV_UP    = {"watch": "alert", "alert": "critical", "critical": "critical"}
_STREAK_GAP_DAYS = 3             # tolerated gap between runs before a streak resets


# ── Field extraction ─────────────────────────────────────────────────────────

def extract_region_values(
    prov: dict[str, Any],
    weather_doc: dict[str, Any],
    vhi_prov: dict[str, Any] | None,
    cur_month_idx: int,
    origin: str | None = None,
) -> dict[str, float]:
    """Flatten a region's signals into a {field: value} dict for rule eval.

    `cur_month_idx` is 0-based (Jan=0). Missing values are simply absent from
    the output — _evaluate_rule then returns None when a rule references a
    missing field, which is the right "we don't know" answer (better than
    silently zero-filling).
    """
    out: dict[str, float] = {}
    for f in ("spi_1", "spi_3", "spei_1", "spei_3"):
        v = prov.get(f)
        if v is not None:
            out[f] = float(v)

    if vhi_prov:
        latest = vhi_prov.get("vhi_latest") or {}
        if latest.get("vhi") is not None:
            out["vhi"] = float(latest["vhi"])
        if latest.get("tci") is not None:
            out["tci"] = float(latest["tci"])

    # Arabica share of the region's production (rust susceptibility). Prefer
    # the per-region prod split; fall back to crop_type; else the origin-level
    # default (only Brazil + Indonesia publish per-region splits today).
    ara, rob = prov.get("prod_mt_k_arabica"), prov.get("prod_mt_k_robusta")
    if isinstance(ara, (int, float)) and isinstance(rob, (int, float)) and (ara + rob) > 0:
        out["arabica_share"] = round(float(ara) / float(ara + rob), 2)
    else:
        ct = (prov.get("crop_type") or "").lower()
        if ct == "arabica":
            out["arabica_share"] = 1.0
        elif ct == "robusta":
            out["arabica_share"] = 0.0
        elif origin in DEFAULT_ARABICA_SHARE:
            out["arabica_share"] = DEFAULT_ARABICA_SHARE[origin]

    # Surface soil-moisture fraction (0–1), where the feed carries it.
    if prov.get("essm_fraction") is not None:
        out["essm"] = float(prov["essm_fraction"])

    monthly_temps = prov.get("monthly_actual_temp_cur") or []
    if (0 <= cur_month_idx < len(monthly_temps)
            and monthly_temps[cur_month_idx] is not None):
        out["temp_mean"] = float(monthly_temps[cur_month_idx])

    fc_rain = prov.get("forecast_7d_rain") or []
    if fc_rain:
        out["forecast_7d_rain"] = float(sum(fc_rain))

    # Country-level 7-day forecast minimum. No IPHM rule consumes this
    # anymore — frost moved to the per-region physics engine in v2
    # (brazil_frost_alerts) — but it's kept in the field catalogue for
    # any future generic rule and for the field documentation.
    fc_doc = weather_doc.get("forecast_7d") or []
    temp_mins = [r.get("temp_min_c") for r in fc_doc
                 if isinstance(r, dict) and r.get("temp_min_c") is not None]
    if temp_mins:
        out["temp_min"] = float(min(temp_mins))

    # Forecast hot-day count (country-level Tmax feed — coarse but directional).
    temp_maxes = [r.get("temp_max_c") for r in fc_doc
                  if isinstance(r, dict) and r.get("temp_max_c") is not None]
    if temp_maxes:
        out["forecast_hot_days"] = float(sum(1 for t in temp_maxes if t >= HOT_DAY_TMAX_C))

    return out


# ── Rule evaluation ──────────────────────────────────────────────────────────

def _condition_holds(field: str, op: str, threshold: float,
                     value: float) -> bool:
    if op == "min":
        return value >= threshold
    if op == "max":
        return value <= threshold
    raise ValueError(f"unknown condition op: {op!r}")


def evaluate_rule(rule: dict[str, Any], values: dict[str, float],
                  iso3: str, month: int) -> dict[str, Any] | None:
    """Apply one rule to one region. Returns an alert dict if all conditions
    hold (and any origin/month filters allow it); None otherwise.

    Pure (no I/O, no globals consulted). Easy to unit-test against synthetic
    {field: value} fixtures.
    """
    if "origins" in rule and iso3 not in rule["origins"]:
        return None
    if "months" in rule and month not in rule["months"]:
        return None

    triggers: dict[str, float] = {}
    timeframe = "current"
    for cond_key, threshold in rule["conditions"].items():
        if cond_key.endswith("_min"):
            field, op = cond_key[:-4], "min"
        elif cond_key.endswith("_max"):
            field, op = cond_key[:-4], "max"
        else:
            return None  # unknown condition shape — fail closed

        v = values.get(field)
        if v is None:
            return None  # data missing → can't fire (no false positives)
        if not _condition_holds(field, op, threshold, v):
            return None

        triggers[field] = round(v, 2)
        if field in FORECAST_FIELDS:
            timeframe = "forecast"

    return {
        "threat_id":     rule["threat_id"],
        "family":        rule.get("family", rule["threat_id"]),
        "name":          rule["name"],
        "severity":      rule["severity"],
        "timeframe":     timeframe,
        "market_impact": rule["market_impact"],
        "triggers":      triggers,
        # engine-internal, stripped before publishing
        "_persist":      int(rule.get("min_persist_days", 0)),
        "_exit":         rule.get("exit_conditions"),
    }


def evaluate_region(values: dict[str, float], iso3: str, month: int,
                    rules: list[dict[str, Any]] | None = None,
                    ) -> list[dict[str, Any]]:
    """Run every rule against one region. Returns the list of fired alerts."""
    rules = rules if rules is not None else IPHM_RULES
    fired: list[dict[str, Any]] = []
    for rule in rules:
        a = evaluate_rule(rule, values, iso3, month)
        if a is not None:
            fired.append(a)
    return fired


def reduce_families(fired: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse a region's fired rules to one alert per threat family — the
    highest severity tier that fired (the ladder semantics)."""
    best: dict[str, dict[str, Any]] = {}
    for a in fired:
        f = a.get("family") or a["threat_id"]
        if f not in best or _SEV_ORDER[a["severity"]] > _SEV_ORDER[best[f]["severity"]]:
            best[f] = a
    return list(best.values())


def exit_conditions_clear(exit_conds: dict[str, float],
                          values: dict[str, float]) -> bool:
    """True when ALL exit conditions hold → a hysteresis-guarded alert may
    clear. A missing field keeps the alert active (conservative: data outage
    must not silently clear a critical)."""
    for cond_key, threshold in exit_conds.items():
        if cond_key.endswith("_min"):
            field, op = cond_key[:-4], "min"
        elif cond_key.endswith("_max"):
            field, op = cond_key[:-4], "max"
        else:
            return False
        v = values.get(field)
        if v is None or not _condition_holds(field, op, threshold, v):
            return False
    return True


# ── Brazil frost: per-region, physics-based, graduated (Phase 2) ─────────────

# Regions the physics can actually frost. Espírito Santo (coastal, warm) is
# intentionally excluded — the old country-wide rule applied a single national
# minimum to every region and would false-positive there. Kept explicit so a
# data glitch can't fire a spurious coastal frost alert.
BRAZIL_FROST_REGIONS = {"Sul de Minas", "Cerrado", "Paraná"}

# Southern-hemisphere frost season, with April/September shoulders. The
# physics is the real gate (no frost is produced in warm months); this only
# stops a freak off-season cold-front reading from raising an alert.
FROST_MONTHS = {4, 5, 6, 7, 8, 9}

FROST_THREAT_ID = "brazil_frost_risk"
_FROST_TYPE_LABEL = {
    "advective": "advective (wind-driven cold air mass)",
    "black":     "black frost (dry hard freeze)",
    "radiative": "radiative (clear, calm night)",
    "none":      "marginal",
}


def _frost_message(detail: dict, severity: str) -> str:
    """Human-readable, severity- and mechanism-aware market-impact line."""
    surf = detail.get("surface_c")
    surf_txt = f"{surf:.1f} °C canopy" if isinstance(surf, (int, float)) else "sub-zero canopy"
    hrs = detail.get("hours_below_0") or 0
    mech = _FROST_TYPE_LABEL.get(detail.get("frost_type", "none"), "frost")
    when = detail.get("date", "the forecast window")
    if severity == _fm.SEV_CRITICAL:
        return (f"Critical frost on {when}: {mech}, {surf_txt}"
                f"{f', {hrs} h below 0' if hrs else ''}. Systemic damage to next "
                f"season's vegetative growth likely — physical-market impact.")
    if severity == _fm.SEV_ALERT:
        return (f"Frost on {when}: {mech}, {surf_txt}. Protective action advised; "
                f"leaf burn / tip dieback possible.")
    return (f"Marginal frost risk on {when}: {surf_txt}. Monitor overnight lows.")


def _frost_alert(detail: dict, severity: str) -> dict:
    """One alert dict in the same shape evaluate_rule() emits."""
    return {
        "threat_id":     FROST_THREAT_ID,
        "name":          f"{severity.title()} Frost Threat",
        "severity":      severity,
        "timeframe":     "forecast",
        "market_impact": _frost_message(detail, severity),
        "triggers": {
            "type":          detail.get("frost_type", "none"),
            "surface_c":     detail.get("surface_c"),
            "air_min_c":     detail.get("air_min_c"),
            "hours_below_0": detail.get("hours_below_0", 0),
            "date":          detail.get("date"),
        },
    }


def brazil_frost_alerts(fe_doc: dict | None, month: int) -> dict[str, list[dict]]:
    """Per-region graduated frost alerts for Brazil, read from the physics
    engine's per-region `frost_detail` (published in farmer_economics.json by
    the supply exporter). Returns {region: [alert]} for regions with a
    fireable frost; empty out of season or when the data is absent (degrades
    silently — no false alarms on a missing/stale file)."""
    if month not in FROST_MONTHS:
        return {}
    weather = (fe_doc or {}).get("weather") or {}
    out: dict[str, list[dict]] = {}
    for region in weather.get("regions") or []:
        name = region.get("name")
        if name not in BRAZIL_FROST_REGIONS:
            continue
        detail = region.get("frost_detail")
        if not detail:
            continue
        sev = _fm.severity(
            detail.get("risk", "-"), detail.get("frost_type", "none"),
            detail.get("surface_c"), detail.get("hours_below_0", 0),
        )
        if sev is None:
            continue
        out[name] = [_frost_alert(detail, sev)]
    return out


# ── Driver — read JSONs, evaluate, write outputs ─────────────────────────────

def _load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


# exit-guarded rules looked up by threat_id when re-materializing a held alert
_EXIT_RULES = {r["threat_id"]: r for r in IPHM_RULES if r.get("exit_conditions")}


def _vn_water_context() -> dict[str, float]:
    """{province: worst tbnn_pct} from the VN water bulletin, if fresh."""
    doc = _load_json(WATER_PATH)
    if not isinstance(doc, dict):
        return {}
    try:
        upd = dt.datetime.fromisoformat((doc.get("updated") or "").replace("Z", "+00:00"))
        if (dt.datetime.now(dt.UTC) - upd).days > WATER_MAX_AGE_DAYS:
            return {}
    except ValueError:
        return {}
    ctx: dict[str, float] = {}
    for river in doc.get("rivers") or []:
        pct = river.get("tbnn_pct")
        if pct is None:
            continue
        for prov in river.get("provinces") or []:
            ctx[prov] = min(ctx.get(prov, 0.0), float(pct))
    return ctx


def _vn_water_adjust(alert: dict[str, Any], region: str,
                     water: dict[str, float]) -> dict[str, Any]:
    """Condition a VN drought alert on the irrigation buffer: escalate when
    river/reservoir flows are far below normal, cap at 'alert' when they are
    near-normal. Non-drought families and unmapped regions pass through."""
    if alert.get("family") != "drought_stress" or region not in water:
        return alert
    pct = water[region]
    a = dict(alert)
    a.setdefault("triggers", {})["water_tbnn_pct"] = round(pct, 1)
    if pct <= WATER_LOW_TBNN_PCT:
        a["severity"] = _SEV_UP[a["severity"]]
        a["market_impact"] = (a["market_impact"] +
                              f" River/reservoir flows {pct:+.0f}% vs normal — irrigation buffer thin.")
    elif pct >= WATER_OK_TBNN_PCT and a["severity"] == "critical":
        a["severity"] = "alert"
        a["market_impact"] = (a["market_impact"] +
                              f" Flows {pct:+.0f}% vs normal — irrigation buffer intact (severity capped).")
    return a


def build() -> dict[str, Any]:
    """Run the engine across every origin. Returns the agronomic_alerts payload.

    v3 pipeline per region: evaluate all rules → persistence-gate each fired
    rule (min_persist_days of continuous presence, tracked in the payload's
    `state` block across runs) → collapse each threat family to its highest
    eligible tier → re-materialize hysteresis-held alerts whose exit
    conditions haven't cleared → VN drought severities conditioned on the
    water bulletin.
    """
    today = dt.date.today()
    today_iso = today.isoformat()
    cur_month = today.month       # 1-based for the months[] filter
    cur_month_idx = cur_month - 1   # 0-based for array indexing

    prev_state: dict[str, dict] = (_load_json(ALERTS_PATH) or {}).get("state") or {}
    new_state: dict[str, dict] = {}
    water_ctx = _vn_water_context()

    def _streak_days(key: str) -> int:
        """Update the presence streak for (origin|region|threat) and return its
        length in days. A gap longer than _STREAK_GAP_DAYS resets the streak."""
        st = prev_state.get(key)
        first = today_iso
        if st:
            try:
                last = dt.date.fromisoformat(st["last_seen"])
                if (today - last).days <= _STREAK_GAP_DAYS:
                    first = st["first_seen"]
            except (KeyError, ValueError):
                pass
        new_state[key] = {"first_seen": first, "last_seen": today_iso}
        return (today - dt.date.fromisoformat(first)).days

    origins_out: dict[str, dict[str, list[dict]]] = {}
    severity_counter: Counter[str] = Counter()
    threat_counter:   Counter[str] = Counter()
    total = 0

    for origin, iso3 in ORIGIN_ISO3.items():
        wx = _load_json(DATA_DIR / f"{origin}_weather.json")
        vhi = _load_json(DATA_DIR / f"vhi_{origin}.json") or {}
        if not wx:
            continue

        vhi_provs = (vhi.get("provinces") or {}) if isinstance(vhi, dict) else {}
        per_region: dict[str, list[dict]] = {}

        for prov in wx.get("provinces") or []:
            name = prov.get("name")
            if not name:
                continue
            values = extract_region_values(
                prov, wx, vhi_provs.get(name), cur_month_idx, origin,
            )
            fired = evaluate_region(values, iso3, cur_month)

            # persistence gate, then ladder reduction
            eligible = []
            for a in fired:
                days = _streak_days(f"{origin}|{name}|{a['threat_id']}")
                if days >= a.get("_persist", 0):
                    eligible.append(a)
            chosen = reduce_families(eligible)

            # hysteresis: a previously-active exit-guarded alert whose entry
            # failed today stays (at its severity) until the exits clear —
            # including outranking any lower tier of its family that fired.
            for key, st in prev_state.items():
                if not st.get("active"):
                    continue
                o2, r2, tid = key.split("|", 2)
                if o2 != origin or r2 != name:
                    continue
                rule = _EXIT_RULES.get(tid)
                if not rule:
                    continue
                fam = rule.get("family", tid)
                cur_fam = next((c for c in chosen if c["family"] == fam), None)
                if cur_fam and cur_fam["threat_id"] == tid:
                    continue                      # still firing at this tier
                if exit_conditions_clear(rule["exit_conditions"], values):
                    continue                      # genuinely recovered → clears
                held = {
                    "threat_id": tid, "family": fam,
                    "name": rule["name"], "severity": rule["severity"],
                    "timeframe": "current",
                    "market_impact": rule["market_impact"] +
                        " (held — recovery thresholds not yet met)",
                    "triggers": {k: round(values[k], 2) for k in
                                 {c[:-4] for c in rule["exit_conditions"]} if k in values},
                    "status": "recovering",
                    "_persist": 0, "_exit": rule["exit_conditions"],
                }
                chosen = [c for c in chosen if c["family"] != fam] + [held]
                new_state.setdefault(key, {"first_seen": st.get("first_seen", today_iso),
                                           "last_seen": today_iso})

            # VN drought severities conditioned on the irrigation buffer
            if origin == "vn" and water_ctx:
                chosen = [_vn_water_adjust(a, name, water_ctx) for a in chosen]

            if chosen:
                published = []
                for a in chosen:
                    new_state.setdefault(f"{origin}|{name}|{a['threat_id']}",
                                         {"first_seen": today_iso, "last_seen": today_iso})
                    new_state[f"{origin}|{name}|{a['threat_id']}"]["active"] = True
                    pub = {k: v for k, v in a.items() if not k.startswith("_")}
                    published.append(pub)
                    severity_counter[pub["severity"]] += 1
                    threat_counter[pub["threat_id"]] += 1
                    total += 1
                per_region[name] = published

        if per_region:
            origins_out[origin] = per_region

    # Brazil frost is handled separately from the generic IPHM rules: it's
    # per-region and physics-based (advective / duration / black frost), read
    # from farmer_economics.json's frost_detail rather than a country-wide
    # forecast minimum. Merge its graduated alerts into the Brazil block.
    fe_doc = _load_json(DATA_DIR / "farmer_economics.json")
    for region, alerts in brazil_frost_alerts(fe_doc, cur_month).items():
        origins_out.setdefault("brazil", {}).setdefault(region, []).extend(alerts)
        for a in alerts:
            severity_counter[a["severity"]] += 1
            threat_counter[a["threat_id"]] += 1
            total += 1

    return {
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "ruleset_version": "iphm-v3",
        "origins": origins_out,
        "summary": {
            "total_alerts": total,
            "by_severity": dict(severity_counter),
            "by_threat":   dict(threat_counter),
        },
        # engine memory: presence streaks + active flags for persistence and
        # hysteresis across runs. Not rendered by UIs.
        "state": new_state,
    }


# ── signals.json flatten/merge ───────────────────────────────────────────────

# Keep flattened alerts confined to a single category so the existing
# quant-signal block stays clean and so re-runs are idempotent.
SIGNALS_CATEGORY      = "AGRO"
SIGNALS_CATEGORY_LABEL = "Agronomic"
SIGNALS_MARKET         = "PHYS"   # physical/agronomic, not NY/LDN futures


def flatten_for_signals(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Project the agronomic_alerts payload into signals.json-shaped entries.

    Severity passes through unchanged (the IPHM ruleset is already lowercase
    to match the quant-signal convention). `timeframe` is promoted to a
    top-level field so UIs can filter `s.timeframe === "forecast"` without
    regex-sniffing the human-readable text. Each entry's id is deterministic
    so a daily run replaces the prior day's entries cleanly (the merge below
    drops any prior AGRO rows).
    """
    out: list[dict[str, Any]] = []
    for origin, regions in (payload.get("origins") or {}).items():
        for region, alerts in regions.items():
            for a in alerts:
                trigger_bits = ", ".join(f"{k}={v}" for k, v in a["triggers"].items())
                out.append({
                    "id": f"AGRO_{origin}_{region}_{a['threat_id']}".replace(" ", "_"),
                    "name":          a["name"],
                    "category":      SIGNALS_CATEGORY,
                    "categoryLabel": SIGNALS_CATEGORY_LABEL,
                    "market":        SIGNALS_MARKET,
                    "severity":      a["severity"],
                    "timeframe":     a["timeframe"],
                    "score":         0,            # not a price-direction score
                    "magnitude":     "medium",
                    "text":          f"{origin}/{region}: {a['market_impact']}  [{trigger_bits}]",
                })
    return out


def merge_into_signals_json(payload: dict[str, Any], write: bool) -> int:
    """Replace any existing AGRO rows in signals.json with today's set.

    Returns the number of agronomic rows ultimately present. If signals.json
    doesn't exist yet (cold runner state) we no-op gracefully — the canonical
    agronomic_alerts.json is still authoritative.
    """
    existing = _load_json(SIGNALS_PATH)
    if not isinstance(existing, dict) or "signals" not in existing:
        return 0
    others = [s for s in existing.get("signals") or []
              if s.get("category") != SIGNALS_CATEGORY]
    fresh = flatten_for_signals(payload)
    existing["signals"] = others + fresh
    existing["generatedAt"] = dt.datetime.now(dt.UTC).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")
    if write:
        SIGNALS_PATH.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return len(fresh)


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true",
                    help="Persist agronomic_alerts.json + merged signals.json")
    args = ap.parse_args(argv)

    payload = build()
    n_total = payload["summary"]["total_alerts"]
    by_sev   = payload["summary"]["by_severity"]
    by_th    = payload["summary"]["by_threat"]

    print(f"[agronomic] {n_total} alerts across {len(payload['origins'])} origins")
    print(f"  by severity: {dict(by_sev)}")
    print(f"  by threat:   {dict(by_th)}")

    if args.write:
        ALERTS_PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        n_merged = merge_into_signals_json(payload, write=True)
        print(f"  → wrote {ALERTS_PATH.name}")
        print(f"  → merged {n_merged} rows into {SIGNALS_PATH.name}")
    else:
        print("(preview only — re-run with --write to persist)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
