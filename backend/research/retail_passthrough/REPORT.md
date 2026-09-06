# From the port to the shelf — how much of a green coffee move reaches the consumer, when, and where

*Study run: `backend/research/retail_passthrough`. Every figure below is written
by `src/study.py` into `outputs/`; this file quotes them and adds nothing of its
own. Regenerate with `cd backend && PYTHONPATH=. python -m research.retail_passthrough.src.study`
followed by `… .src.charts`.*

---

## Executive summary

The idea-box entry that prompted this study (IMP-004) reported that a 12-month
change in the green price predicts a 12-month change in the US retail coffee
index five months later with a slope of about 0.18, and read that as **"only a
fifth of a green move survives to the shelf."**

The slope replicates — 0.181, HAC p < 10⁻¹² — and it survives deflation. The
reading does not. A log-log slope is an **elasticity**, and an elasticity is a
pass-through rate only after you divide by the green cost share of the retail
price. Nothing in this repository measures that share, which is why it went
missing; this study bounds it instead, from inside the data.

| | |
|---|---|
| **Timing** | The US shelf responds over a **band of 3–9 months**, peaking at 5. The peak survives a max-\|r\| phase-randomised surrogate test at the family level (p = 0.003), so it is not an artefact of scanning 25 lags — but quoting "5 months" as *the* lag is false precision. |
| **Magnitude** | Green and US retail **cointegrate** (Engle–Granger p = 0.006), so a long-run elasticity is meaningful: **θ = 0.288** (HAC SE 0.046). The 0.181 slope is a blend of a *zero* impact effect and a year of slow accumulation, not the long-run number. |
| **The denominator** | θ inverted at the sample-mean green cost implies a shelf price of **$16.12/kg ($7.31/lb)**. And over 2019-05 → 2026-07, complete pass-through *in dollars* requires only that green was **under 29 % of the 2019 shelf price** — a bar almost any plausible cost share clears. **"A fifth survives" is not what these data say.** |
| **Is it the same everywhere?** | **No.** Of six market × currency specifications, **only the United States clears a family-wise test** (p = 0.003 against 0.079 for the euro area and 0.78–0.79 for Brazil), and only the US cointegrates. What *does* travel is the magnitude: the 12-month slope is 0.18 (US), 0.17 (EU, green in USD), 0.15 (EU, green in EUR) and the break-even cost share is 24–34 % in every consuming market. |
| **Asymmetry** | **Not established.** The point estimates look like rockets and feathers — a shelf price below its long-run level is pulled up with a 6.1-month half-life, one above it takes 26 months — but the size-corrected p is **0.071**, and the short-run split is nowhere (p = 0.31). |
| **Demand (null)** | German coffee-tax volume shows **no response to price at any of 13 lags**. Nothing here says the 2021–25 price spike destroyed demand. |

**Two caveats outrank the others.** First, the long-run relationship is
identified almost entirely by the 2020s spike: split the sample and the
pre-2020 half does not cointegrate (θ = 0.123, EG p = 0.21) while the 2020→ half
gives θ = 0.336. One episode is one episode, whatever the monthly n says — the
effective sample size behind θ is **9.8**, not 186. Second, **the retail leg is
an index, not a price**, so everything in §7 is a bound or an inversion rather
than a measurement.

---

## 1. Research question

Three questions, answered separately, because a study that merges them can pass
one and fail the others without anyone noticing:

1. **Statistical** — is there a detectable, correctly-sized relationship between
   the green price and a consumer coffee price index?
2. **Economic** — is the magnitude what a cost-pass-through model predicts, once
   the green cost share is accounted for?
3. **Predictive** — does the relationship give a usable lead on the shelf?

And, added after the first pass on the reader's question: **is the answer the
same in every consuming market?** §11.

## 2. Hypotheses, stated before the results were seen

- **H1** Green leads retail by months, not weeks — roasters buy forward and
  retailers reprice on a cycle.
- **H2** The long-run elasticity is *below 1* and roughly equal to the green
  cost share of a retail pack, because everything else in the pack (roasting,
  packaging, distribution, brand, retail margin) is not priced in green coffee.
- **H3** Increases pass faster than decreases.
- **H4** A price spike of this size reduces volume.
- **H5** (added with §11) The relationship looks the same in every consuming
  market, since they all buy from the same world market.

H1 holds as a band, in the US. H2 holds and is the study's main contribution.
H3 does **not** survive a correctly-sized test. H4 fails. H5 fails on timing and
holds on magnitude.

## 3. Data

Everything is already in the repository; this study fetched nothing.

### 3.1 The green leg

`outputs/results/monthly_series.csv` in **`backend/research/enso_arbitrage`** —
ICO indicator prices from the World Bank CMO "Pink Sheet", monthly, 1960→,
already fetched, manifested and checksummed there. Reusing that file rather
than re-fetching keeps one provenance record for one series.

- `arabica` = Other Milds, `robusta` = Robustas, both USD/t.
- The headline green series is a **70/30 arabica/robusta blend**, varied to
  50/50, 90/10 and each pure leg in §10.
- Converted to **USD per kilo of *roasted* coffee** at a **0.84 roast yield**: a
  roaster loses about 16 % of the green weight to water, so a kilo of roasted
  coffee embodies ~1.19 kg of green. Skipping this step understates the green
  share by about a fifth. θ itself is a log-log slope and is *invariant* to the
  yield — the yield only moves the level the anchor inverts to
  (`outputs/tables/roast_yield_sensitivity.md`).
- For non-dollar markets the green leg is converted into the **local currency**
  before the regression (§11), because a euro shelf price regressed on a dollar
  green price is partly a regression on the exchange rate.

### 3.2 The retail leg

`frontend/public/data/retail_cpi.json`:

| key | series | span | role |
|---|---|---|---|
| `us_coffee` | BLS **CUSR0000SEFP01**, SA | 2011-01 → 2026-07 | **headline** |
| `us` | BLS **CUSR0000SEFP02**, SA | 2011-01 → 2026-07 | second market |
| `eu` | Eurostat HICP CP01211, DE/FR/IT/ES proxy | 2015-12 → **2025-12** | second market |
| `brazil` | IPCA café moído, BCB SGS 1635 | 2011-01 → 2026-07 | second market |

**These are indices, not prices.** Their bases are arbitrary, so only their
changes are comparable and none of them yields a price per kilo. That single
limitation is what §7 is built around.

### 3.3 Deflator, FX, volume

- **US CPI-U all items** (`us_cpi.json`) — the repo holds a rolling ~10-year
  window, so every real-terms result starts **2017-01** on 114 months.
- **FX** (`fx_history.json`, majors from 2020-01) — EUR, BRL. `EURUSD=X` is
  quoted USD-per-EUR and is inverted before use.
- **German Kaffeesteuer receipts** (`kaffeesteuer.json`, 2016-05→) ÷ the
  statutory **€2.19/kg** — unchanged since 1993, so receipts divide cleanly into
  tonnes. This is the **only monthly quantity series in the repo for a consuming
  market**, which is what makes H4 askable. Two caveats travel with it: soluble
  coffee is taxed at €4.78/kg and is not separated in the receipts, and receipts
  are booked when duty is paid, not at the till.

### 3.4 Data-quality findings

Three. All are filed rather than fixed here — this study changes no production
code — but the third had to be handled inside the study because it changes
results.

1. **`retail_cpi.json` series names look transposed.** The file calls
   CUSR0000SEFP01 "Coffee, all" and CUSR0000SEFP02 "Roasted coffee", and
   `backend/scraper/sources/retail_cpi.py:51` states SEFP02 is roasted-only
   while SEFP01 is the broader group. The data contradict that ordering: an
   aggregate cannot be *more* volatile than its dominant component, yet SEFP01
   has a 12-month-change SD of **6.7 %** against SEFP02's **2.7 %**, the two
   correlate only **0.47** on 12-month changes, and SEFP02 does not cointegrate
   with green at all. Whatever the correct labels are, the current ones are
   inconsistent with the series behind them. **This study cites both by series
   ID and treats the names as unverified.**
2. **The EU basket is 7 months stale** (ends 2025-12 while the US and Brazil run
   to 2026-07).
3. **Both US series are missing 2025-10** — a single interior hole, in the
   middle of the largest green move in the sample. Any code that drops missing
   values *before* differencing silently closes it, and November is then
   differenced against September while wearing a one-month label. The first
   version of this study did exactly that. Correcting it moved the correlation
   peak by a whole month **and flipped the asymmetry verdict from "asymmetric"
   to "not established"** (§9). Every estimator here now works on a gap-free
   monthly grid with the hole preserved as missing (`model._aligned`), and the
   bootstrap re-holes each simulated path so the null faces the same gap.

## 4. Method

### 4.1 Timing

Pearson and Spearman correlations of monthly **log changes** at lags 0…24, with
three layers of protection against the obvious failure mode — scanning 25 lags
and reporting the best one:

- **Bartlett effective N** at every lag, so the p-values price in the fact that
  both series are persistent.
- **BH-FDR** across the 25 lags.
- A **max-|r| phase-randomised surrogate test**: 2 000 surrogates preserving each
  series' own spectrum, and the p-value is the fraction whose *largest* |r| over
  the whole lag range beats the observed largest. This is the family-wise number
  and it is the one quoted — in §11 it is the number that separates the US from
  everywhere else.

The result is reported as the **contiguous band** of lags clearing the surrogate
95 % envelope around the peak, not as the argmax.

### 4.2 Magnitude

A two-step **error-correction model**, because "how much" and "how fast" are two
coefficients and a single regression conflates them:

```
long run    ln R_t = μ + θ ln G_t + u_t
short run   Δln R_t = α + Σᵢ βᵢ Δln G_{t−i} + γ û_{t−1} + φ Δln R_{t−1} + ε_t
```

θ is the long-run elasticity, β₀ the impact effect, γ the speed the gap closes.
The level regression is only meaningful if the two series **cointegrate**;
`engle_granger` tests that first and every row of §10 and §11 says which side of
that line it falls on.

IMP-004's specification — a 12-month change on a 12-month change — is kept and
reported beside the ECM, so the report can show what it says *and* what it is
worth. Its 168 observations carry an effective sample of **17.8**: 12-month
windows overlap eleven times in twelve.

All inference is **Newey–West HAC**. The toolkit (`effective_n`, `bh_fdr`,
`surrogate_ccf`, `block_bootstrap_ci`, `newey_west_ols`) is imported verbatim
from `research/enso_arbitrage/src/stats.py` — house standard, already tested.

### 4.3 The denominator

Under **complete** long-run pass-through θ is not "the fraction that survives" —
it *is* the green cost share, because d ln R / d ln G = (∂R/∂G)(G/R) and ∂R/∂G
is the green needed per unit sold. So θ implies a retail price level given a
green price, and that level can be checked against a shelf. Two forms, both
computed inside the repo:

- **The inversion.** retail = (green cost per roasted kg) / θ.
- **The dollar test**, which needs no price level at all. Over a window green
  rose by a known **Δ$** and the retail index rose by a known **factor f**. For
  the shelf to have carried the whole increase, the base shelf price must
  satisfy P₀(f − 1) ≥ Δ$, so P₀_min = Δ$/(f − 1) — and dividing by the base green
  cost, complete pass-through needs only that green was under
  **G₀(f − 1)/Δ$** of the base shelf price. That is a bound on a *share*, and a
  share has a ceiling of 1 whatever the shelf price was.

### 4.4 Asymmetry, and why its p-value is simulated

The standard rockets-and-feathers specification splits **both** the short-run
terms and the error correction by sign and tests β⁺ = β⁻ and γ⁺ = γ⁻:

```
Δln R = α + Σ β⁺ᵢ Δln G⁺ + Σ β⁻ᵢ Δln G⁻ + γ⁺ û⁺ + γ⁻ û⁻ + φ Δln R₋₁ + ε
```

**The asymptotic HAC Wald test over-rejects here.** On symmetric synthetic data
built the way this study's own test suite builds it, a nominal 5 % test fires
about **10 %** of the time and a nominal 1 % about **3 %**. Quoting the
asymptotic p alone would overstate the evidence, so the null is simulated: the
fitted **symmetric** ECM is run forward recursively on the real green series
with its own residuals resampled in 12-month moving blocks, 1 000 times, and the
p-value is the fraction of null replications reaching the observed statistic.
The simulated test fires about 3 % of the time at a nominal 5 %. **The bootstrap
p is the one the verdict uses.** γ in the null DGP is clipped to (−1, 0], which
is the conservative choice: it makes the simulated shelf price *more* willing to
come back down, which is exactly the behaviour being tested.

## 5. Timing results — United States

`outputs/tables/lag_profile_us.md`, chart `02_lag_profile.png`.

| lag (months) | 0 | 1 | 2 | **3** | **4** | **5** | **6** | **7** | **8** | **9** | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| r | 0.02 | 0.00 | 0.07 | **0.24** | **0.24** | **0.32** | **0.30** | **0.27** | **0.26** | **0.19** | 0.14 |
| BH q | 0.98 | 0.98 | 0.59 | **0.02** | **0.02** | **0.004** | **0.004** | **0.01** | **0.01** | 0.07 | 0.20 |

- **Peak: lag 5, r = 0.319.** Family-wise surrogate **p = 0.003**, so the peak is
  not a product of the search.
- **Contemporaneous correlation is zero** (r = 0.02). Whatever moves the shelf
  this month, it is not this month's green price.
- **The band is 3–9 months.** Ten of the 25 lags clear the surrogate envelope.
  Within 3–9 the differences are not distinguishable, so "the shelf moves five
  months later" is a plateau read as a spike. Planning off month 5 alone will be
  wrong about as often as it is right — and the argmax is fragile enough that
  restoring one missing observation (§3.4.3) moved it between 5 and 6.

## 6. Magnitude results — United States

`outputs/results/summary.json`, chart `03_cumulative_passthrough.png`.

| | |
|---|---|
| Engle–Granger p | **0.0059** → cointegrated; the long-run regression is not spurious |
| Residual ADF p | 0.0012 |
| **θ (long run)** | **0.288**, HAC SE 0.046 → 95 % CI [0.20, 0.38] |
| β₀ (impact) | 0.006, p = 0.52 — **nothing arrives in the first month** |
| Σβ after 3 / 6 / 12 months | 0.018 / 0.083 / 0.268 |
| γ (symmetric) | 0.001, p = 0.97 — see below |
| n / n_eff | 186 / **9.8** |
| IMP-004's 12-month slope | 0.181, HAC p < 10⁻¹², n_eff **17.8** |

Read together these say something the single slope cannot: **a green move
arrives at essentially zero on impact and accumulates to θ over about a year.**
The 0.181 twelve-month slope sits *between* the impact effect and the long run,
which is what such a slope has to do — it is a weighted blend of the two, and
reporting it as "how much survives" answers neither question.

**The symmetric γ is not significant** (p = 0.97), which means the correction
channel is not identified in the symmetric specification; the distributed lag is
doing all the work. That is worth stating plainly rather than quietly leaning on
θ: in the symmetric model θ is estimated from the level relationship and the
short-run dynamics reproduce it, but the model gives no evidence about the
*speed* of correction.

## 7. The denominator — the point of the study

Charts `04_cost_share_grid.png`, `07_dollar_episode.png`;
`outputs/tables/cost_share_grid.md`.

### 7.1 The inversion

At the **sample-mean** green cost of $4.64/kg roasted-equivalent, θ = 0.288
implies a shelf price of **$16.12/kg = $7.31/lb**. That is the price at which θ
*equals* the green cost share, i.e. at which pass-through is exactly complete.
A reader who paid less than $7.31/lb on average over 2011–2026 is looking at
incomplete pass-through; one who paid more is looking at over-shooting. The grid
tabulates the whole range so the reader supplies the number the repo does not
hold:

| shelf price | $4.54/lb | $5.44/lb | **$6.80/lb** | $8.16/lb | $9.07/lb | $11.34/lb |
|---|---|---|---|---|---|---|
| implied green cost share | 0.46 | 0.39 | **0.31** | 0.26 | 0.23 | 0.19 |
| θ ÷ share | 0.62 | 0.75 | **0.93** | 1.12 | 1.24 | 1.55 |

At the latest month the same inversion gives $27.95/kg ($12.68/lb) — but that
number is a statement about **how far the current spike still has to travel**,
not a prediction: θ is an average over a sample in which green ranged from
$2.78 to $9.62 per roasted kilo, so it is an average cost share, not today's.

### 7.2 The dollar test — no price level required

Over the sample's own green trough-to-latest window, **2019-05 → 2026-07**:

- green cost rose **+$5.27/kg** roasted-equivalent (from $2.78 to $8.05)
- the retail index rose **+55.0 %**
- complete pass-through therefore requires the 2019 shelf price to have been at
  least **$9.58/kg ($4.35/lb)** — equivalently, that green was under **29.0 %**
  of it.

**A 29 % bar is not a demanding one.** Under any green cost share below 29 %,
retail added *more* dollars than green did. "Only a fifth survives" would
require the green share of a 2019 US coffee pack to have been above 29 % *and*
the elasticity to be read without a denominator. The first is an empirical
claim the repo cannot settle; the second is an error.

### 7.3 And the mirror image, which is why the folk story exists

Run the same test to the green **peak** instead of to the latest month —
**2019-05 → 2025-02**:

- green +$6.84/kg, retail only **+28.7 %**
- complete pass-through would require green to have been under **11.7 %** of the
  2019 shelf price.

So at the top of the spike the shelf was visibly behind, and an observer
measuring then would have concluded — correctly, for that moment — that most of
the increase was being absorbed. Seventeen months later green had fallen back
and the shelf was still climbing. **That is the 3–9 month band showing up in
dollars.** The "only a fifth survives" reading is what a contemporaneous
snapshot of a slow adjustment looks like.

## 8. Demand — the null

`outputs/tables/demand_by_lag.md`, chart `08_demand.png`.

German coffee-tax receipts divided by the €2.19/kg statutory rate give monthly
tonnes cleared to consumption, 2016-05 → 2026-07. Regressing Δln volume on
Δln retail price at lags 0…12, with month dummies (coffee clearances have a hard
December):

- **0 of 13 lags significant at 5 %.** The largest coefficient is −1.87 at lag 4
  with p = 0.068.
- The HAC test in this specification over-rejects mildly (~6.8 % at a nominal
  5 %, measured over 400 replications), which means the distortion only ever
  *manufactures* a demand response. Finding none is the conservative direction.

**Nothing in these data supports the claim that the 2021–25 price spike
destroyed volume.** The honest caveats cut both ways: the price series is an EU
basket rather than a German one, the volume series mixes soluble at a different
tax rate, and receipts lead the till by the trade's own stock cycle. Any of
those could hide a real elasticity. But none of them manufactures the null.

## 9. Asymmetry — not established

`outputs/results/summary.json`, chart `05_asymmetry.png`.

| | estimate | HAC SE | asymptotic p | **bootstrap p** |
|---|---|---|---|---|
| Σβ⁺ (green rising) | 0.101 | | | |
| Σβ⁻ (green falling) | −0.063 | | | |
| **Σβ⁺ = Σβ⁻** | gap 0.165 | | 0.151 | **0.309** |
| γ⁺ (shelf above long run) | −0.026 | 0.014 | 0.067 | |
| γ⁻ (shelf below long run) | −0.108 | 0.031 | 0.0004 | |
| **γ⁺ = γ⁻** | | | 0.024 | **0.071** |
| half-life, shelf above | 26.3 months | | | |
| half-life, shelf below | 6.1 months | | | |

The point estimates are the rockets-and-feathers pattern in textbook form: when
the shelf price sits *below* the level green justifies it is pulled up with a
**6.1-month half-life**; when it sits *above*, the half-life is **26 months**,
which over any horizon anyone trades is close to no correction at all. The gap
is a factor of four.

**It does not survive a correctly-sized test.** The asymptotic p of 0.024 becomes
**0.071** once the null is simulated, and two asymmetry tests are run, so the
Bonferroni-halved threshold is 0.025. The short-run split — the place IMP-004
looked — is nowhere near: 0.309 bootstrap, and IMP-004's own sign-split (two
slopes, 0.243 up against 0.151 down) has an interaction p of 0.113. Two slopes
looking different is not a finding.

This verdict is *fragile in the honest direction*. In the first version of this
study, which bridged the missing 2025-10 observation (§3.4.3), the same test
returned an asymptotic p of 0.0013 and a bootstrap p of 0.014, and the report
called the asymmetry a finding. One recovered month of missing data moved it to
0.071. A result that a single observation can carry across the threshold is
reported as **not established**, and this section exists to say so rather than
to be quietly deleted.

## 10. Robustness — United States

`outputs/tables/robustness.md`, chart `06_robustness.png`.

| market | spec | n | EG p | θ | 12-month slope |
|---|---|---|---|---|---|
| **US SEFP01** | **blend 70/30, nominal** | 186 | **0.006** | **0.288** | **0.181** |
| US SEFP01 | arabica only | 186 | 0.020 | 0.273 | 0.170 |
| US SEFP01 | robusta only | 186 | 0.001 | 0.272 | 0.111 |
| US SEFP01 | blend 50/50 | 186 | 0.001 | 0.295 | 0.185 |
| US SEFP01 | blend 90/10 | 186 | 0.013 | 0.278 | 0.174 |
| US SEFP01 | real, CPI-deflated (2017→) | 114 | 0.279 | 0.086 | 0.154 |
| US SEFP02 | blend 70/30, nominal | 186 | 0.350 | 0.219 | 0.028 |
| EU HICP basket | blend 70/30, nominal | 121 | 0.096 | 0.298 | 0.172 |
| Brazil IPCA café moído | green in BRL | 79 | 0.476 | 0.320 | 0.070 |

- **θ ≈ 0.27–0.30 across every green definition.** The blend weight, which had
  to be assumed, barely matters: pure arabica, pure robusta, 50/50 and 90/10 all
  land inside the headline's confidence interval.
- **Deflation does not kill the slope** (0.181 → 0.154), which was IMP-004's
  most exposed claim and it survives. The *ECM* on the deflated series does not
  cointegrate, but that is a 114-month sample, not a contradiction.

### 10.1 Subsamples — the caveat that outranks the rest

`outputs/tables/subsamples.md`:

| sample | n | EG p | θ | 12-month slope |
|---|---|---|---|---|
| full | 186 | 0.006 | 0.288 | 0.181 |
| pre-2020 | 108 | **0.207** | 0.123 | 0.111 |
| 2020→ | 78 | 0.013 | 0.336 | 0.164 |

**The long-run relationship is identified by the 2020s spike.** Before 2020 the
two series do not cointegrate and θ is less than half its full-sample value. The
12-month slope is more stable (0.111 → 0.164) but still rises.

Two readings, and the data cannot separate them: either pass-through genuinely
strengthened, or the pre-2020 window simply lacks a shock large enough to
identify a long-run relationship — green moved between $2.78 and $6.41 over nine
years, and most of that was noise around $3.50. The second is the more
parsimonious explanation and it is why the effective sample size, **9.8**, is
quoted next to θ everywhere in this report.

## 11. Is the relationship the same in every market?

`outputs/tables/cross_market.md`, chart `09_cross_market.png`. Six
market × currency specifications, each asked the same four questions. Where a
market's retail index is denominated in its own currency, the green leg is
converted into that currency first.

| market | green in | n | span | peak lag | band | **family p** | EG p | θ | 12-m slope | break-even cost share |
|---|---|---|---|---|---|---|---|---|---|---|
| **United States** SEFP01 | USD | 186 | 2011-01→2026-07 | **5** | **3–9** | **0.003** | **0.006** | **0.288** | **0.181** | **29 %** |
| United States SEFP02 | USD | 186 | 2011-01→2026-07 | 9 | 9 | 0.265 | 0.350 | 0.219 | 0.028 | 14 % |
| Euro area | USD | 121 | 2015-12→2025-12 | 11 | 10–11 | 0.079 | 0.096 | 0.298 | 0.172 | 24 % |
| Euro area | EUR | 72 | 2020-01→2025-12 | 6 | 5–6 | 0.388 | 0.665 | 0.313 | 0.147 | 30 % |
| Brazil | USD | 187 | 2011-01→2026-07 | 1 | 1 | 0.780 | 0.149 | 0.461 | 0.016 | 34 % |
| Brazil | BRL | 79 | 2020-01→2026-07 | 7 | 7 | 0.791 | 0.476 | 0.320 | 0.070 | 28 % |

**The timing does not travel.** Only the United States clears the family-wise
surrogate test. The euro area at p = 0.079 is *suggestive* — its lag profile has
a visible hump from month 4 to month 16 and several lags clear their own
envelopes — but with 121 months against the US's 186 the surrogate envelope is
half again as wide, and a hump that does not clear it is not a result. Brazil is
noise at any lag (p = 0.78 and 0.79).

**The magnitude does travel**, at least between the US and the euro area: 12-month
slopes of 0.181 and 0.172 (0.147 in euros), and θ of 0.288 against 0.298. But
the euro area does not cointegrate at 5 %, so its θ is a level regression
without a licence and is quoted here only to show that it lands in the same
place, not as an estimate.

**§7's conclusion is the most portable thing in the study.** The break-even cost
share — the share of the shelf price green would have had to be for the observed
retail move to fall short of complete pass-through — is **24–34 % in every
consuming market**, computed independently in each. Whatever else differs, no
market's retail price moved so little that "only a fifth survives" is the
natural reading.

**Currency matters, and cannot be separated from sample length.** Converting the
euro-area green leg into euros moves the peak from month 11 to month 6 and the
family p from 0.079 to 0.388 — but it also shortens the sample from 121 months
to 72, because the repo's FX history starts in 2020. Both specifications are
reported; neither is preferred.

**Brazil is a different question, not a weaker answer.** It is a *producing*
country whose domestic roasters buy from the local crop, so its retail price has
no reason to track a world indicator month by month — and it does not, in either
currency. Its retail index nonetheless rose **65 %** over the same window, the
largest move of any market here. Brazil's shelf moved most and tracked the world
price least, which is a result about market structure rather than about
pass-through.

### 11.1 Japan, China, and the markets this study cannot reach

**The repository holds no retail coffee price series for Japan or China**, so
neither could be tested. Both are gaps worth closing, and one of them would fix
the study's biggest limitation at the same time:

- **Japan** — the Statistics Bureau's Retail Price Survey publishes coffee at an
  actual **¥ per 100 g**. That is a price *level*, not an index, which means it
  would turn every bound in §7 into a measurement, in the world's third-largest
  coffee-importing market. Highest-value single fetch available.
- **China** — NBS publishes CPI subcategories but no monthly coffee line;
  realistically nothing at this frequency.
- **A US price level** — BLS APU0000717311 (ground roast, per lb) would do the
  same job for the headline market and is the single most valuable addition to
  this study.

All three are fetches, and in this repository fetches run on a GitHub Actions
runner, not in the analysis sandbox.

**Online prices (Amazon and similar) were considered and rejected.** They fail
on the one dimension this study needs: there is no retrievable monthly history
going back years, so a lag structure cannot be estimated from them at all; a
snapshot of today's listings cannot answer a question about timing. Scraping
them would also be against those sites' terms. A shelf-price *level* from an
official statistical agency does everything an online price would do here, with
provenance.

## 12. Limitations

1. **No price level anywhere.** The retail leg is an index. §7 works around this
   with bounds and inversions, but one official average-price series (BLS
   APU0000717311, or Japan's ¥/100 g) would convert every bound in this report
   into a measurement. Highest-value next fetch by a wide margin.
2. **One episode.** See §10.1. n = 186 months, n_eff = 9.8.
3. **One month is missing** from both US series (2025-10) and it sits inside the
   decisive window. It is handled correctly rather than filled, but its absence
   is what separates a §9 "finding" from a §9 "not established".
4. **The blend is assumed, not observed.** No data on the actual arabica/robusta
   mix in any retail basket. §10 shows it barely matters, which is luck rather
   than design.
5. **The cost share is bounded, not measured.** Everything in §7 is an
   *if–then*. The if is the reader's.
6. **Roast yield 0.84 is a convention.** θ is invariant to it; the implied price
   level moves ±5 % across 0.80–0.88.
7. **The retail series names are unverified.** See §3.4.1.
8. **Real terms cover 2017→ only**, because the repo's CPI file is a rolling
   window; FX covers 2020→, which caps every non-dollar specification.
9. **The demand leg pairs an EU price with German volume** and cannot separate
   soluble.
10. **Nothing here identifies a causal mechanism.** A cost-pass-through model is
    consistent with these numbers; so is a story where green and retail both
    respond to a common driver with different lags. Cointegration constrains the
    long run; it does not name the cause.

## 13. Conclusion

**Statistically**, yes, in the United States: green leads US retail coffee over a
3–9 month band, the peak survives a family-wise surrogate test, and the two
series cointegrate. Nowhere else in the repo's data does the timing survive the
same test.

**Economically**, the headline number is not the one IMP-004 reported. θ = 0.288
is an elasticity, and an elasticity is only a pass-through rate once divided by
the green cost share. Inverted, θ implies a $7.31/lb sample-average shelf price;
tested in dollars, complete pass-through over 2019–2026 needs nothing more than
a green share below 29 % — and the equivalent bar is 24–34 % in every other
consuming market tested. The data are **consistent with near-complete long-run
pass-through** and **inconsistent with "only a fifth survives"** unless green
was an implausibly large share of the pack.

**Predictively**, the usable content is thin and it is not the elasticity. It is
the shape: nothing arrives in month one, and the response builds over 3–9
months. The tempting addition — that a shelf price above its justified level
never comes back down — is the right *sign* and the wrong *confidence*: it does
not survive a correctly-sized test, and one missing month is enough to move it
across the line.

**The status of each claim:**

| claim | status |
|---|---|
| Green leads US retail, peak at 5 months, band 3–9 | 🟢 **finding** — family-wise p = 0.003 |
| Cointegrated; θ = 0.288 | 🟢 **finding** — but n_eff = 9.8, one episode |
| θ ≈ the green cost share ⇒ near-complete pass-through | 🟡 **argued, not measured** — needs a retail price level |
| The same break-even cost share (24–34 %) holds in every market | 🟢 **finding** — computed independently six times |
| "Only a fifth of a green move survives" | 🔴 **not supported** — conflates an elasticity with a pass-through rate |
| The lag structure is the same everywhere | 🔴 **not supported** — only the US clears a family-wise test |
| Asymmetric correction (up fast, down slow) | 🟡 **suggestive, not established** — bootstrap p = 0.071 |
| Asymmetric short-run response | 🔴 **not established** — bootstrap p = 0.31 |
| The price spike cut demand | 🔴 **no evidence** — 0 of 13 lags |

---

### Appendix A — figures

| file | what it shows |
|---|---|
| `01_levels.png` | the two legs, own panels, with the dollar-test window shaded |
| `02_lag_profile.png` | correlation by lag with the surrogate envelope; the band, not the spike |
| `03_cumulative_passthrough.png` | Σβ by horizon against θ and against IMP-004's slope |
| `04_cost_share_grid.png` | pass-through rate against the shelf price the reader supplies |
| `05_asymmetry.png` | γ⁺ vs γ⁻ with HAC bars; Σβ⁺ vs Σβ⁻ |
| `06_robustness.png` | θ ± HAC 95 % across nine specifications, cointegration marked |
| `07_dollar_episode.png` | dollars added to the shelf ÷ dollars added to green, against the cost share |
| `08_demand.png` | German volume elasticity by lag — the null |
| `09_cross_market.png` | six markets' lag profiles side by side; only one clears its family test |

### Appendix B — self-audit

Things that would have made this report wrong, and what was done about them:

- **Scanning 25 lags and reporting the best.** → max-|r| phase-randomised
  surrogate test at the family level; the band, not the argmax. In §11 this is
  the test that separates one real result from five that look like results.
- **A spurious level regression.** → Engle–Granger first; every robustness and
  cross-market row says which side of the line it is on, and the ones that fail
  are marked rather than quietly averaged in.
- **Quoting n = 186 for a persistent monthly series.** → Bartlett effective N
  beside every estimate. It is 9.8.
- **Bridging a missing month.** → found while checking why two code paths
  disagreed about the peak lag; the US CPI has no 2025-10 and `dropna()` before
  `diff()` had been closing it. Fixed everywhere, tested against regression, and
  the asymmetry finding it had been propping up was downgraded.
- **Trusting an asymptotic Wald test that over-rejects.** → measured the size
  distortion (10 % at a nominal 5 %), built a recursive block bootstrap under a
  symmetric null, and quoted its p instead.
- **Reading an elasticity as a pass-through rate.** → the whole of §7.
- **Letting one episode masquerade as a sample.** → §10.1, named as the caveat
  that outranks the others.
- **Reporting a demand elasticity from the largest of 13 coefficients.** →
  reported the count of significant lags (zero) instead, and measured that the
  test's distortion runs toward false positives.
- **Regressing a euro price on a dollar cost.** → §11 converts the green leg
  into each market's own currency and reports both versions where the FX history
  is too short to choose.
