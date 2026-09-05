# ENSO × coffee arbitrage — a lead/lag study

Does El Niño or La Niña have a statistically robust, economically material,
forward-looking relationship with (A) the New York–London arabica-over-robusta
premium and (B) the Vietnam-robusta-vs-Brazil-arabica physical premium?
The paper is **`REPORT.md`**. This file is how to reproduce it.

Everything here is isolated from the application: nothing under
`backend/scraper` imports this package, CI's pytest job does not collect its
tests (it runs `tests/ scraper/tests/ telegram/tests/`), and the only network
access is the fetch workflow, which runs on a GitHub Actions runner and commits
raw files with a manifest. The study itself is offline and deterministic
(seeded).

## Layout

```
backend/research/enso_arbitrage/
  README.md                this file
  REPORT.md                the paper
  requirements.txt         analysis stack (numpy, pandas, scipy, statsmodels, matplotlib)
  data/
    MANIFEST.json          every external file: url, retrieved_at, bytes, sha256
    raw/<source>/…         the files exactly as downloaded (+ crawl index pages and link lists)
    vietnam_local_history.csv   OPTIONAL — your own Vietnam farmgate history; see below
  src/
    fetch_external.py      runner-side fetch (ICO, World Bank Pink Sheet, NOAA ONI, fallbacks)
    load_external.py       raw files → study series (offline)
    repo_data.py           readers for the repo's own series (futures archive, origin prices, FX, ENSO, stocks, weather…)
    arbitrage.py           the two dependent variables, transformations
    enso.py                ONI / Niño 3.4 / SOI; official episodes; real-time signals
    stats.py               CCF, Bartlett effective N, block bootstrap, phase-randomised surrogates, max-|r|, BH-FDR, HAC OLS
    events.py              onset-aligned event study, placebo, episode table
    mechanism.py           ENSO → rainfall → supply → stocks → arbitrage links; ENSO-vs-weather regression
    predictive.py          forward changes after real-time signals
    study.py               runs everything → outputs/
    charts.py              outputs/charts/*.png
  tests/test_core.py       unit tests for the pure logic
  outputs/
    results/*.csv|json     machine-readable results (all lags, families, events, regressions, …)
    tables/*.md            the tables REPORT.md quotes
    charts/*.png           the figures
  notes/futures_price_history_defect.md   production defect found on the way (not fixed here)
```

## Reproduce

```bash
cd backend
pip install -r research/enso_arbitrage/requirements.txt

# 1. unit tests (pure logic, ~10 s)
pytest research/enso_arbitrage/tests -q

# 2. the study: repo data + data/raw → outputs/results and outputs/tables (~5 min)
PYTHONPATH=. python -m research.enso_arbitrage.src.study            # 2,000 surrogates
PYTHONPATH=. python -m research.enso_arbitrage.src.study --n-sur 200 # quick pass

# 3. the figures
PYTHONPATH=. python -m research.enso_arbitrage.src.charts
```

Seeds are fixed (surrogates 7, block bootstrap 11, event bootstrap 3, placebo 5,
predictive 9), so two runs on the same inputs give the same numbers.

### Refreshing the external data

Dispatch **`Z – Research: ENSO × arbitrage — fetch external series (manual)`**
on the study branch (or `python -m research.enso_arbitrage.src.fetch_external`
on any machine with internet). It writes `data/raw/` and `data/MANIFEST.json`
and commits them. A `--only <source ids>` run replaces those sources' entries
and keeps the rest.

What it tries, and what it found on 2026-09-05:

| source | result |
|---|---|
| World Bank CMO "Pink Sheet", monthly (current release + pinned Jan-2025 snapshot) | ✅ 1960-01 → 2026-08 — **the Tier-1 series** |
| NOAA CPC `oni.ascii.txt` (1950 →) | ✅ extends the repo's 1980→ seed |
| ICO historical data (indicator prices, prices paid to growers, …) | ❌ ICO's own page links `…/historical/1990 onwards/Excel/3c - Indicator prices.xlsx` and it **404s on both `ico.org` and `icocoffee.org`** (site migrated). No ICE-futures monthly file exists in ICO's list at all — those averages live only inside monthly report PDFs. |
| Stooq continuous KC.F / RC.F (fallback) | ❌ bot-check page |
| FRED (IMF) indicator copies (cross-check) | ❌ timeout from the runner |

The manifest keeps every attempt, successful or not.

## Plugging in a Vietnam farmgate history

Tier 2 is limited by the Vietnam local series (repo: giacaphe, 2021-05 →). If
you have a longer one, drop it at

```
backend/research/enso_arbitrage/data/vietnam_local_history.csv
```

with two columns, `date` (YYYY-MM-DD) and `price_vnd_per_kg`, and re-run step 2.
`repo_data.vietnam_local()` picks it up in place of the repo series and the
provenance is written into `outputs/results/summary.json`. Nothing else changes.
The Brazil leg (noticiasagricolas Tipo 6/7, 2023-06 →) is the other bound; a
CEPEA arabica history (daily since 1996) would extend it the same way — say so
and a matching slot is a five-line change in `repo_data.py`.

## Reading the outputs

- `results/ccf_family_summary.csv` — one row per (tier, arbitrage, transform,
  ENSO index): best lag, r, n, effective n, Bartlett p, BH q, per-lag surrogate
  p, **max-|r| surrogate p** (the test for "does the best lag survive having
  been searched for"), block-bootstrap CI.
- `results/ccf_all_lags.csv` — every lag of every family (12,000+ tests).
- `results/event_*` — onset-aligned paths, summaries with placebo bands, and
  the per-episode table (`event_table_tier1.csv`).
- `results/regressions_tier1.csv` — HAC regressions incl. the ONI⁺/ONI⁻ asymmetry.
- `results/mechanism_chain.csv`, `tables/enso_vs_weather.md` — the mechanism.
- `results/predictive_conditional.csv` — forward changes after real-time signals.
- `results/lag_response_table.csv` — the one-table answer per phase × arbitrage.
- `results/summary.json` — sample sizes, provenance, OOS, crop-year regressions.
