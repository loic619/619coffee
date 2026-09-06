# Green → shelf: retail coffee pass-through

How much of a green coffee price move reaches the consumer, how long it takes,
and whether the answer is the same in every consuming market.
The paper is **`REPORT.md`**. This file is how to reproduce it.

The study is **offline and deterministic**. It fetches nothing: the green leg
comes from `backend/research/enso_arbitrage/outputs/results/monthly_series.csv`
(World Bank Pink Sheet, already fetched, manifested and checksummed there) and
everything else from `frontend/public/data/*.json`. Nothing under
`backend/scraper` imports this package except the exporter, and CI's pytest job
does not collect these tests — it runs `tests/ scraper/tests/ telegram/tests/`.

There is deliberately **no `requirements.txt` here**. The analysis stack is
identical to the ENSO study's, and a second requirements file in the tree is a
second Python-project marker for Vercel's build detection. Install from
`../enso_arbitrage/requirements.txt`.

## Layout

```
backend/research/retail_passthrough/
  README.md                this file
  REPORT.md                the paper
  src/
    paths.py               where everything lives
    data.py                loaders: green, retail, CPI, FX, German tax volume
    model.py               lag profile, ECM, cointegration, the cost-share anchor,
                           asymmetry + its bootstrap-calibrated null
    study.py               runs everything → outputs/
    charts.py              outputs/charts/*.png
  tests/test_core.py       unit tests for the pure logic
  outputs/
    results/*.csv|json     machine-readable results
    tables/*.md            the same, as markdown the report quotes
    charts/*.png           nine figures
```

The frontend article lives at `frontend/components/research/RetailPassthrough.tsx`
and is fed by `backend/scraper/exporters/retail_passthrough.py`, which reshapes
`outputs/results/` into `frontend/public/data/retail_passthrough.json`. That
exporter is stdlib-only and **is** covered by CI.

## Reproduce

```bash
cd backend
pip install -r research/enso_arbitrage/requirements.txt

PYTHONPATH=. python -m research.retail_passthrough.src.study     # ~80 s
PYTHONPATH=. python -m research.retail_passthrough.src.charts    # ~10 s
PYTHONPATH=. python -m pytest research/retail_passthrough/tests -q

# then refresh the frontend payload
PYTHONPATH=. python -c "from scraper.exporters.retail_passthrough import export; export()"
```

`--n-sur N` on the study cuts the surrogate count for a fast pass
(`--n-sur 200` runs in about 20 s); the committed outputs use 2 000.

Runtime is dominated by two resampling loops: 2 000 phase-randomised surrogates
per lag profile (seven profiles — one headline, six cross-market) and 1 000
recursive bootstrap replications for the asymmetry null.

## The four questions, and where each is answered

| question | function | output |
|---|---|---|
| **When** does a green move reach the shelf? | `model.lag_profile` + `model.plateau` | `lag_profile_us.csv`, `02_lag_profile.png` |
| **How much** arrives? | `model.engle_granger`, `model.ecm` | `summary.json`, `03_cumulative_passthrough.png` |
| Is that **a lot or a little**? | `model.implied_retail`, `model.dollar_episode`, `model.cost_share_grid` | `cost_share_grid.csv`, `04`/`07`.png |
| Do rises pass faster than falls? | `model.asymmetric_ecm` + `model.asymmetry_bootstrap_p` | `summary.json`, `05_asymmetry.png` |
| Is any of it the **same elsewhere**? | `study.cross_market` | `cross_market.csv`, `09_cross_market.png` |

## Three things to know before changing anything here

**1. Never `dropna()` before `diff()`.** Both US CPI series are missing
2025-10, in the middle of the study's decisive window. Dropping it closes the
hole and turns November into a two-month change wearing a one-month label. That
bug moved the correlation peak by a month and flipped the asymmetry verdict.
`model._aligned` puts both legs on a gap-free monthly grid with holes preserved;
use it, and `tests/test_core.py` will catch you if you don't.

**2. The asymmetry p-value must be the bootstrap one.** The asymptotic HAC Wald
test over-rejects here — about 10 % at a nominal 5 % on symmetric synthetic
data. `asymmetry_bootstrap_p` simulates the symmetric null and returns a
correctly sized p. Quoting the asymptotic number would turn a non-result into a
finding, which is exactly what happened in the first draft.

**3. θ is an elasticity, not a pass-through rate.** It only becomes a rate after
division by the green cost share of the retail price, which this repo does not
hold. Every claim about "how much survives" goes through `cost_share_grid` or
`dollar_episode`, both of which hand the reader the denominator rather than
assuming one.

## The gaps

- **No retail price *level* anywhere.** Everything in §7 of the report is a
  bound rather than a measurement. BLS `APU0000717311` (US ground roast, per lb)
  or Japan's Retail Price Survey (¥ per 100 g) would fix it.
- **No Japan or China retail series at all**, so §11's cross-market answer
  covers the US, the euro area and Brazil only.
- Fetching any of those means a GitHub Actions workflow, as with the ENSO
  study's `fetch_external.py` — the analysis sandbox has no outbound network.
