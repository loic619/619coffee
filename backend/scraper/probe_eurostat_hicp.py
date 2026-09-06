"""
probe_eurostat_hicp.py — why does the EU coffee HICP series stop at 2025-12?

Why. `retail_cpi.json`'s `eu` series ends **2025-12** while the US and Brazil
run to 2026-07, and it has been frozen there across at least two successful
scraper runs (2026-08-16 and 2026-09-01, identical: 121 periods, same last
value). The retail pass-through study (#852) had to demote the euro area to a
robustness check because of it.

The scraper is not obviously broken. `_fetch_eurostat` already tries the
EU27_2020 aggregate, decides it is stale, and falls back to a weighted
DE/FR/IT/ES basket whose whole justification is that member states publish
2-3 weeks after month-end. Both runs took the fallback path — the shipped
series is named "(DE/FR/IT/ES basket proxy)" — and the fallback ALSO ended at
2025-12.

That is the shape worth explaining. Five geos stopping on the same month is not
five independent publication lags, and a lag does not land exactly on a
year boundary. The leading hypothesis is that the request is pinned to a
retired index base: the URL hardcodes `unit=I15` (2015 = 100), and HICP is
rebased on the fives — 2005, 2015, and on this timing 2025 = 100 arriving with
the January 2026 index. If that happened, `I15` legitimately has no data after
2025-12 and the current numbers live under a different `unit` code.

That is a hypothesis, not a finding, and it is exactly the kind that is cheap to
test against the source and expensive to guess at. So this asks Eurostat three
things directly:

  1. WHICH UNITS EXIST for prc_hicp_midx, from the dataflow's own codelist —
     rather than assuming I15 and I25 are the only candidates.
  2. FOR EACH (unit x geo), the first and last period actually returned, so a
     retired base and a genuine publication lag can be told apart: a retired
     base ends on a year boundary for every geo at once; a lag ends raggedly
     and differently per country.
  3. WHETHER THE BASKET'S ALL-FOUR RULE is what truncates it. `_fetch_eurostat_basket`
     keeps only periods present in all of DE/FR/IT/ES, so one laggard country
     silently caps the whole series. Printed per country so that can be ruled
     in or out independently of the unit question.

Read the output before changing the scraper. If a newer base is current, the fix
is to stop hardcoding a base and select the freshest available; if instead every
unit stops at 2025-12, the series really is discontinued at source and the
honest fix is to say so on the chart rather than to keep fetching.

Writes nothing, commits nothing. Run via workflow 0.29 (dispatch-only).

    cd backend && python -m scraper.probe_eurostat_hicp
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date

import requests

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0"
DATAFLOW = "prc_hicp_midx"
COICOP = "CP01211"                       # Coffee, tea and cocoa → Coffee
GEOS = ("EU27_2020", "DE", "FR", "IT", "ES")
#: The unit the scraper hardcodes today, plus the base a 2026 rebase would use.
#: The codelist lookup below supersedes this if it succeeds — these are only the
#: fallback when the structure endpoint is unavailable.
FALLBACK_UNITS = ("I15", "I25", "I05")

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "application/json",
}


def _get(url: str, timeout: int = 45):
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
    except Exception as e:
        return None, f"request failed: {e}"
    if r.status_code != 200:
        return None, f"HTTP {r.status_code}"
    try:
        return r.json(), None
    except Exception as e:
        return None, f"not JSON: {e}"


def available_units() -> list[str]:
    """Ask the dataflow which unit codes it actually carries.

    Eurostat answers a dimension-only request with the full codelist, so one
    call with no unit filter names every base without downloading the data.
    """
    body, err = _get(f"{BASE}/data/{DATAFLOW}?format=JSON&lang=EN&coicop={COICOP}"
                     f"&geo=DE&lastTimePeriod=1")
    if err:
        print(f"  codelist lookup failed ({err}) — falling back to {FALLBACK_UNITS}")
        return list(FALLBACK_UNITS)
    try:
        cat = body["dimension"]["unit"]["category"]
        labels = cat.get("label") or {}
        codes = list(cat["index"]) if not isinstance(cat["index"], dict) else list(cat["index"].keys())
        for c in codes:
            print(f"    {c:8s} {labels.get(c, '')}")
        # a one-period request pins the unit dimension to whatever was returned,
        # so merge with the fallbacks rather than trusting it to be exhaustive
        return sorted(set(codes) | set(FALLBACK_UNITS))
    except (KeyError, TypeError):
        print(f"  codelist absent from response — falling back to {FALLBACK_UNITS}")
        return list(FALLBACK_UNITS)


def span(unit: str, geo: str) -> tuple[str | None, str | None, int, str | None]:
    """(first, last, n, error) for one unit x geo combination."""
    url = (f"{BASE}/data/{DATAFLOW}?format=JSON&lang=EN"
           f"&unit={unit}&coicop={COICOP}&geo={geo}")
    body, err = _get(url)
    if err:
        return None, None, 0, err
    try:
        idx = body["dimension"]["time"]["category"]["index"]
        values = body["value"]
    except (KeyError, TypeError):
        return None, None, 0, "unexpected JSON-stat shape"
    periods = (sorted(idx, key=lambda p: idx[p]) if isinstance(idx, dict) else list(idx))
    have = [p for i, p in enumerate(periods)
            if (values.get(str(i)) if isinstance(values, dict) else
                (values[i] if i < len(values) else None)) is not None]
    if not have:
        return None, None, 0, "no observations"
    return have[0], have[-1], len(have), None


def span_coicop(unit: str, geo: str, coicop: str) -> tuple[str | None, str | None, int, str | None]:
    """`span`, but for an arbitrary item code rather than the configured one."""
    global COICOP
    saved, COICOP = COICOP, coicop
    try:
        return span(unit, geo)
    finally:
        COICOP = saved


def coffee_codes() -> list[tuple[str, str]]:
    """Every coicop code in the dataflow whose label mentions coffee.

    Asked of the source rather than guessed: HICP's item classification was
    revised for the 2026 index, so the code coffee is published under today is
    not something to assume from the code it used in 2025.
    """
    body, err = _get(f"{BASE}/data/{DATAFLOW}?format=JSON&lang=EN&unit=I15&geo=DE"
                     f"&lastTimePeriod=1")
    if err:
        print(f"  coicop codelist lookup failed ({err})")
        return []
    try:
        cat = body["dimension"]["coicop"]["category"]
        labels = cat.get("label") or {}
    except (KeyError, TypeError):
        print("  coicop codelist absent from response")
        return []
    hits = [(c, lab) for c, lab in labels.items() if "coffee" in lab.lower()]
    if not hits:
        print(f"  no coicop label mentions coffee (codelist has {len(labels)} entries)")
    return sorted(hits)


def hicp_datasets() -> list[tuple[str, str, str]]:
    """(code, title, last-update) for every prc_hicp* dataset Eurostat publishes.

    Read from the dissemination inventory rather than guessed, because the point
    of this pass is to find a dataset id nobody in this repo knows about yet.
    """
    url = ("https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt"
           "?lang=en")
    try:
        r = requests.get(url, headers={**HEADERS, "Accept": "text/plain"}, timeout=90)
        r.raise_for_status()
        text = r.text
    except Exception as e:
        print(f"  catalogue fetch failed: {e}")
        return []
    # The TOC indents the title column with tabs to show hierarchy, so column
    # positions shift by depth. Find the field that IS a dataset code instead of
    # trusting an index — the first parse assumed parts[1] and silently matched
    # nothing, which reads exactly like "Eurostat has no such dataset".
    code_re = re.compile(r"^prc_hicp[a-z0-9_]*$")
    out: list[tuple[str, str, str]] = []
    shown = 0
    for line in text.splitlines():
        parts = [p.strip().strip('"') for p in line.split("\t")]
        codes = [p for p in parts if code_re.match(p)]
        if not codes:
            continue
        code = codes[0]
        title = next((p for p in parts if p and p != code and not code_re.match(p)), "")
        dates = [p for p in parts if re.match(r"^\d{2}[./]\d{2}[./]\d{4}", p)]
        updated = dates[0] if dates else ""
        if shown < 3:                      # so a future shape change is visible
            print(f"    raw: {parts}")
            shown += 1
        out.append((code, title, updated))
    if not out:
        print(f"  TOC fetched ({len(text)} chars) but no prc_hicp* code matched")
    # newest last-update first, so a live replacement surfaces at the top
    out.sort(key=lambda t: t[2][-4:] + t[2][3:5] + t[2][:2], reverse=True)
    return out


def dataset_span(dataflow: str) -> tuple[str | None, str | None, int, str | None]:
    """First/last period of the German all-items series in an arbitrary dataflow.

    coicop and unit are left unfiltered on purpose — a replacement table may well
    use different codes for both, and the question here is only whether the table
    is being updated at all.
    """
    body, err = _get(f"{BASE}/data/{dataflow}?format=JSON&lang=EN&geo=DE", timeout=60)
    if err:
        return None, None, 0, err
    try:
        idx = body["dimension"]["time"]["category"]["index"]
    except (KeyError, TypeError):
        return None, None, 0, "no time dimension"
    periods = (sorted(idx, key=lambda p: idx[p]) if isinstance(idx, dict) else list(idx))
    if not periods:
        return None, None, 0, "no periods"
    return periods[0], periods[-1], len(periods), None


def item_labels(dataflow: str) -> dict[str, str]:
    """The item-classification codelist of an arbitrary dataflow.

    The dimension is `coicop` in the old tables and may be named differently in
    the ECOICOP v2 ones, so the dimension is found by looking for the one whose
    labels mention consumption items rather than by assuming its name.
    """
    body, err = _get(f"{BASE}/data/{dataflow}?format=JSON&lang=EN&geo=DE&lastTimePeriod=1",
                     timeout=60)
    if err:
        print(f"    codelist fetch failed for {dataflow}: {err}")
        return {}
    dims = (body or {}).get("dimension") or {}
    for name in ("coicop", "coicop18", "ecoicop2", "coicop2", "item", "prod"):
        cat = (dims.get(name) or {}).get("category") or {}
        if cat.get("label"):
            print(f"    (item dimension is '{name}')")
            return cat["label"]
    # not one of the expected names — say what IS there rather than returning {}
    print(f"    no known item dimension; dataflow has: {sorted(dims.keys())}")
    return {}


def months_behind(period: str | None, today: date) -> int | None:
    if not period or len(period) < 7:
        return None
    try:
        y, m = int(period[:4]), int(period[5:7])
    except ValueError:
        return None
    return (today.year - y) * 12 + (today.month - m)


def main() -> int:
    today = date.today()
    print(f"Eurostat {DATAFLOW} / coicop={COICOP} — probe run {today}")
    print("The shipped series ends 2025-12. Scraper hardcodes unit=I15.\n")

    print("1. Units the dataflow carries")
    units = available_units()
    print(f"  probing: {', '.join(units)}\n")

    print("2. First and last observation, per unit x geo")
    print(f"  {'unit':6s} {'geo':10s} {'first':9s} {'last':9s} {'n':>5s}  lag  note")
    grid: dict[str, dict[str, str | None]] = {}
    for unit in units:
        grid[unit] = {}
        for geo in GEOS:
            first, last, n, err = span(unit, geo)
            grid[unit][geo] = last
            lag = months_behind(last, today)
            lag_s = "—" if lag is None else f"{lag:>3d}"
            note = err or ("CURRENT" if lag is not None and lag <= 2 else "")
            print(f"  {unit:6s} {geo:10s} {first or '—':9s} {last or '—':9s} {n:>5d}  {lag_s}  {note}")

    print("\n3. Reading")
    fresh = {u: {g: p for g, p in row.items() if (months_behind(p, today) or 99) <= 2}
             for u, row in grid.items()}
    winners = [u for u, row in fresh.items() if row]
    if winners:
        print("  A current base EXISTS. The series is not discontinued — the scraper is")
        print("  pinned to a retired one. Freshest units and how far they reach:")
        for u in winners:
            print(f"    unit={u}: " + ", ".join(f"{g}→{p}" for g, p in sorted(fresh[u].items())))
        print("  Fix: stop hardcoding unit=I15; pick the freshest base the dataflow offers.")
    else:
        print("  NO unit is current for any geo. Either coffee HICP really did stop at")
        print("  2025-12 at source, or the request shape is wrong in some other way.")
        print("  Do NOT 'fix' the scraper on this evidence — label the chart instead.")

    i15 = grid.get("I15", {})
    ends = {g: p for g, p in i15.items() if p}
    if ends and len(set(ends.values())) == 1:
        print(f"\n  Every geo on I15 ends at the SAME period ({next(iter(set(ends.values())))}).")
        print("  That is one structural cause, not five independent publication lags.")
    elif ends:
        print(f"\n  I15 end dates DIFFER by geo: {ends}")
        print("  That is a publication lag. Note the basket keeps only periods present")
        print("  in all four countries, so the earliest of these caps the whole series —")
        print("  which would be a scraper bug independent of the unit question.")

    # ── pass 2 ───────────────────────────────────────────────────────────────
    # The first run of this probe (2026-09-06) ruled the base out: the codelist
    # offers only I15 / I05 / I96 — there is no 2025 base — and EVERY unit x geo
    # ends at 2025-12. So the dataflow is either wholly stalled, or CP01211 has
    # stopped being the code coffee is published under. Those need telling apart
    # before anything is changed, and only the source can do it.
    print("\n5. Is the DATAFLOW stalled, or just this item code?")
    for probe_coicop, what in (("CP00", "all-items HICP"), ("CP0121", "coffee/tea/cocoa parent")):
        first, last, n, err = span_coicop("I15", "DE", probe_coicop)
        lag = months_behind(last, today)
        print(f"  DE {probe_coicop:8s} ({what:26s}) {first or '—':9s} → {last or '—':9s} "
              f"n={n:<5d} lag={'—' if lag is None else lag}  {err or ''}")
    print("  If all-items is CURRENT and CP01211 is not, the dataflow is healthy and")
    print("  the item code is the problem — HICP's classification was revised for the")
    print("  2026 index, so coffee may simply live under a different code now.")

    print("\n6. Which coicop codes carry coffee, and how far do they reach?")
    for code, label in coffee_codes():
        first, last, n, err = span_coicop("I15", "DE", code)
        lag = months_behind(last, today)
        flag = "  <<< CURRENT" if lag is not None and lag <= 3 else ""
        print(f"  {code:10s} {label[:44]:44s} {first or '—':9s} → {last or '—':9s} "
              f"n={n:<5d} lag={'—' if lag is None else lag}{flag}  {err or ''}")

    # ── pass 3 ───────────────────────────────────────────────────────────────
    # The second run ruled the item code out too: all-items HICP for Germany
    # (CP00) also ends 2025-12. Every unit, every geo, every coicop — including
    # the headline aggregate — stops on the same month. A flagship monthly
    # release does not go nine months late, so the remaining explanation is that
    # this DATASET has been frozen and superseded, which is what a classification
    # revision does to the old table. Ask the catalogue which prc_hicp datasets
    # exist and which of them are actually being updated.
    print("\n7. Every prc_hicp* dataset in the catalogue, newest data first")
    cands = hicp_datasets()
    if not cands:
        print("  catalogue lookup failed — cannot name a replacement from here")
    for code, title, updated in cands:
        print(f"  {code:24s} last-update {updated or '—':12s} {title[:60]}")

    print("\n8. Which of those actually carry a current German all-items index?")
    for code, _title, _upd in cands:
        if "midx" not in code and "mmor" not in code and "manr" not in code:
            continue                      # index / monthly-rate tables only
        first, last, n, err = dataset_span(code)
        lag = months_behind(last, today)
        flag = "  <<< CURRENT" if lag is not None and lag <= 3 else ""
        print(f"  {code:24s} {first or '—':9s} → {last or '—':9s} n={n:<5d} "
              f"lag={'—' if lag is None else lag}{flag}  {err or ''}")
    # ── pass 4 ───────────────────────────────────────────────────────────────
    # Pass 3 named it. The catalogue calls the dataset the scraper uses
    # "HICP - monthly data (index) (1996-2025)" — Eurostat closed it, last
    # updated 06.02.2026 — and lists a new "HICP - ECOICOP ver.2" folder beside
    # it. So this is a classification changeover, and what remains is the
    # replacement's dataset id and the code coffee carries under ECOICOP v2.
    # Neither is safe to guess: the whole point of a revision is that codes move.
    # ── pass 5 ───────────────────────────────────────────────────────────────
    # Pass 4's shortlist was wrong in an instructive way: it filtered candidates
    # by NAME (midx/manr/mmor) and so tested only the three frozen tables, while
    # the ones the catalogue shows being updated on 01.09.2026 — minr, ainr,
    # fpd, ct, iw — were skipped precisely because they are named differently.
    # A classification changeover renames things; that is the whole point. So
    # shortlist by LAST-UPDATE DATE instead, which is a fact about whether a
    # table is alive rather than a guess about what it is called.
    print("\n9. Datasets Eurostat is still updating (last-update within ~90 days)")
    def _upd_key(u: str) -> str:
        return (u[-4:] + u[3:5] + u[:2]) if len(u) == 10 else ""
    cutoff = _upd_key(today.strftime("%d.%m.%Y"))
    cutoff = f"{int(cutoff[:4]):04d}{int(cutoff[4:6]) - 3:02d}{cutoff[6:]}" if cutoff else ""
    seen: set[str] = set()
    v2 = []
    for code, title, updated in cands:
        if code in seen or not _upd_key(updated) or _upd_key(updated) < cutoff:
            continue
        seen.add(code)
        v2.append((code, title, updated))
        print(f"  {code:28s} last-update {updated:12s} {title[:58]}")
    if not v2:
        print("  none updated recently — printing EVERY prc_hicp* dataset instead")
        v2 = [c for c in cands if c[0] not in seen and not seen.add(c[0])]
        for code, title, updated in v2:
            print(f"  {code:28s} last-update {updated or '—':12s} {title[:58]}")

    print("\n10. Which of the LIVE tables carries a current German series?")
    live: list[str] = []
    for code, _t, _u in v2:
        first, last, n, err = dataset_span(code)
        lag = months_behind(last, today)
        flag = ""
        if lag is not None and lag <= 3:
            flag, _ = "  <<< CURRENT", live.append(code)
        print(f"  {code:28s} {first or '—':9s} → {last or '—':9s} n={n:<5d} "
              f"lag={'—' if lag is None else lag}{flag}  {err or ''}")

    print("\n11. Where coffee lives in the replacement")
    for code in live[:4]:
        labels = item_labels(code)
        hits = [(c, lab) for c, lab in labels.items() if "coffee" in lab.lower()]
        print(f"  {code}: {len(labels)} item codes, {len(hits)} mention coffee")
        for c, lab in sorted(hits):
            print(f"      {c:12s} {lab[:56]}")
    if not live:
        print("  no replacement table came back current — do not edit the scraper yet")

    print("\n12. The replacement, measured per geo — everything the fix needs")
    for code in live[:2]:
        labels = item_labels(code)
        dim = "coicop18" if labels else "coicop"
        for item, lab in sorted((c, l) for c, l in labels.items() if "coffee" in l.lower()):
            print(f"  {code} / {dim}={item}  ({lab[:40]})")
            for geo in GEOS:
                body, err = _get(f"{BASE}/data/{code}?format=JSON&lang=EN"
                                 f"&{dim}={item}&geo={geo}")
                if err:
                    print(f"      {geo:10s} {err}")
                    continue
                try:
                    idx = body["dimension"]["time"]["category"]["index"]
                    vals = body["value"]
                    units = list((body["dimension"].get("unit") or {}).get("category", {}).get("index") or [])
                except (KeyError, TypeError):
                    print(f"      {geo:10s} unexpected shape")
                    continue
                per = sorted(idx, key=lambda x: idx[x]) if isinstance(idx, dict) else list(idx)
                have = [pp for i, pp in enumerate(per)
                        if (vals.get(str(i)) if isinstance(vals, dict) else None) is not None]
                print(f"      {geo:10s} {have[0] if have else '—':9s} → {have[-1] if have else '—':9s} "
                      f"n={len(have):<5d} units={units}")

    print("\n4. Raw grid (for the PR)")
    print(json.dumps(grid, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
