# ENSO and the coffee arbitrage — a lead/lag study

_backend/research/enso_arbitrage · 2026-09-05 · every number below is produced by `src/study.py` and lives in `outputs/`; nothing here is typed in by hand._

## Executive summary

**Verdicts**

| | NY–London arbitrage (Tier 1, 1960 → 2026, 17 El Niño / 12 La Niña episodes) | Vietnam–Brazil physical arbitrage (Tier 2, 2023-06 → 2026-08, 1 El Niño / 0 La Niña) |
|---|---|---|
| **El Niño** | 🟡 **INTERESTING BUT NOT ROBUST.** The premium *narrows* — robusta outperforms arabica — with the trough about **12 months** after onset: mean −0.10 log (≈ −10 % of the arabica/robusta ratio), in **13 of 17** episodes since 1960. That direction is the opposite of the "El Niño hurts Brazil" story and the same as the one physically robust link in the data: El Niño dries Vietnam's Central Highlands. It does **not** survive multiple-testing correction, is **absent** in the 2010→ sample and out of sample, and **halves** when measured from the signal a desk actually had. | ⚪ **Cannot be evaluated** (one episode, which started on the first month of the series). That one episode moved the same way: −0.33 log at +12 m. |
| **La Niña** | 🔴 **NO CONVINCING EVIDENCE.** No lag, transformation or index comes near significance; the event paths split 7 down / 5 up at 12 months; the real-time signal has a 38 % false-alarm rate and no forward information at any horizon. | ⚪ No La Niña onset inside the series. |

**The three questions, answered separately**

- **Statistical.** Across 150 families and 12,366 lag tests, **no lag survives** Benjamini–Hochberg at q = 0.10, and no Tier-1 family's best lag survives the max-|r| surrogate test (smallest p = 0.39). Only 12 of 1,470 Tier-1 lag tests are below p = 0.05 — *fewer* than the 74 chance would give. The one thing that looks like a signal is the El Niño event study: −0.102 log at +12 m, bootstrap CI [−0.198, −0.011], placebo p = 0.016 at that horizon — but p = 0.11 once the 25 horizons searched are counted, and the 1997–98 episode alone (−0.63) carries a third of it.
- **Economic.** If real, −10 % of the premium ratio over 12 months is about **$300/t at the 1980→ median arabica price and ≈ $775/t at today's**, against a 12-month standard deviation of the premium of 0.21 log: roughly half a normal year's move. Material against trading costs; not against the noise.
- **Predictive.** From the **real-time** signal (Niño 3.4 four weeks past +0.5, false alarms included), the 12-month forward change is −0.047 with a **57 % hit rate** (n = 24) — half the retrospective effect — and the four signals since 2013 average −0.028. The first three months after a signal show a small *widening* (+0.035, 71 %). None of this is distinguishable from neutral months at conventional levels.

**Mechanism.** ENSO → Vietnamese rainfall is the only robust link in the chain (r = −0.48 at a 2-month lag, surrogate p < 0.001): El Niño reliably dries the Central Highlands. Every link from rainfall to prices at monthly frequency is weak, and adding the Brazil and Vietnam rainfall anomalies to the regression does **not** absorb the ENSO coefficient (−0.012 → −0.014). So ENSO cannot be reduced to "an early read on the weather" from this evidence — but neither ENSO nor the weather explains the premium robustly.

**Bottom line for a trader.** An El Niño developing today has, historically, been followed by a robusta-favouring drift in the NY–London premium peaking around a year out. The evidence is suggestive, not established, and it has not shown up since 2013. It is a prior to weigh against the actual Central Highlands dry season — the one thing ENSO does forecast well — not a signal to trade on its own. Hypothesis 2 (La Niña, longer lag) is not supported. Hypothesis 3 (the two arbitrages differ) cannot be tested with one physical episode.

---

## 1. Research question

Does the El Niño–Southern Oscillation carry information about coffee's arabica-over-robusta premium — the New York–London arbitrage, and its physical counterpart between Vietnamese robusta and Brazilian arabica at origin — and if so in which direction, at what lag, how reliably, and could a desk act on it?

Three questions are kept separate throughout, because they have three different answers: **statistical** (is there a relationship that survives the tests a persistent monthly series demands), **economic** (is its size worth anything against the premium's own noise and trading costs), **predictive** (does a signal observable at the time say anything about the next 3–12 months).

## 2. Hypotheses, as stated before any result was seen

1. El Niño has a significant relationship with the coffee arbitrage, potentially with a lag of several months.
2. La Niña also has one, potentially with a longer lag — 6–12 months.
3. The relationship differs between the New York–London arbitrage and the physical Vietnam-robusta / Brazil-arabica arbitrage.

The candidate windows named in the brief — El Niño 1–3, 3–6, 6–9, 9–12, 12–18 months; La Niña 3–6, 6–9, 9–12, 12–18, 18–24 — are treated as hypotheses and are not used to restrict any search. Every lag from −24 to +24 months is tested, and the multiple-testing accounting counts all of them.

No direction was hypothesised. The agronomic prior, for the record, runs the other way from "El Niño hurts Brazil": El Niño tends to bring rain to Brazil's south-east and drought to Vietnam's Central Highlands and Indonesia — a *robusta* supply threat — so if anything El Niño should lift robusta relative to arabica and **narrow** the premium.

## 3. Data

Every series was inspected file by file for coverage, cadence and gaps before anything was computed. Nothing was filled; every exclusion is listed.

### 3.1 The dependent variables' inputs

| Series | Source | Period | Cadence | Unit | Notes |
|---|---|---|---|---|---|
| ICO Other Milds indicator | World Bank CMO "Pink Sheet" (`data/raw/worldbank_pink_sheet_*`), current release + Jan-2025 snapshot; manifest has url, sha256, retrieval time | **1960-01 → 2026-08** | monthly | $/kg → USD/t | ICO's group indicator for washed arabicas, average ex-dock New York / Bremen-Hamburg — the closest ICO indicator to the KC deliverable |
| ICO Robustas indicator | same file | 1960-01 → 2026-08 | monthly | $/kg → USD/t | average ex-dock New York / Le Havre-Marseille |
| KC (Coffee "C") per-contract settles | `data/contract_prices_archive.json` (Barchart, every listed contract per day) | 2021-08-04 → 2026-09-04 | daily | US¢/lb | the study rolls its own nearby from this — **not** from `futures_price_history.json`, whose arabica front is defective (§3.4) |
| RC (Robusta 10-t) per-contract settles | same | 2021-08-04 → 2026-09-04 | daily | USD/t | |
| Vietnam robusta FAQ G2, Dak Lak | giacaphe.com via `origin_prices_history.json` | 2021-05-19 → 2026-09-05 | daily, gaps | VND/kg | thin months in 2021-H2 (1–6 prints), 33-day gap Jun–Jul 2023; **one print excluded** (2023-01-02: 69,400 vs a 41,000 local median — a parse error) |
| Brazil arabica físico Tipo 6/7 | noticiasagricolas trimmed mean of 7 co-op quotes (`brazil_arabica_fisico.json`) | 2023-06-01 → 2026-09-05 | daily | R$/saca 60 kg | clean |
| USD/BRL, USD/VND | Yahoo `BRL=X`, `VND=X` via `fx_history.json` | 2020-01 → | daily | | forward-filled ≤ 5 days across weekends only |

### 3.2 ENSO

| Series | Source | Period | Cadence | Notes |
|---|---|---|---|---|
| **ONI** (Oceanic Niño Index) | NOAA CPC `oni.ascii.txt` (`data/raw/noaa_oni_full`), parsed with the repo's own parser; the repo's 1980→ seed is the fallback | **1950-01 → 2026-07** | monthly (3-month running mean, centre-month anchored) | the classification index; Jul-26 value +1.80 |
| Niño 3.4 SST anomaly | NOAA CPC weekly (`enso_indices.json`), 1991–2020 climatology | 1981-09 → 2026-08 | weekly → monthly mean | the real-time index |
| SOI (standardised) | NOAA CPC (`enso_indices.json`) | 1951-01 → 2026-07 | monthly | sign flipped so that positive = El Niño-like |

There is **no archive of ENSO forecasts** in the repository (the CPC/IRI plume is fetched live and not stored), so anticipation of a forecast can be detected at negative lags but not measured directly.

### 3.3 Controls and mechanism links

| Series | Source | Period |
|---|---|---|
| Daily rainfall and temperature, Sul de Minas + Cerrado (Brazil arabica belt) and Dak Lak + Lam Dong + Dak Nong + Gia Lai (Vietnam Central Highlands) | Open-Meteo store, `backend/seed/weather_history` | 1995-01 → |
| ICE certified stocks, robusta (lots × 10 t) | `certified_stocks_robusta_deep_*` | 1993-10 → (monthly to 2014, daily after) |
| ICE certified stocks, arabica (bags) | `certified_stocks_arabica_deep_*` | 2010-08 → |
| CECAFE Brazil green exports, arabica / conilon | `cecafe.json` | 1990-01 → |
| Brazil arabica and Vietnam robusta harvests (≈ USDA PSD, rounded) | `backend/seed/*_production.json` | 1996 → , annual |
| CFTC / ICE COT managed-money net | `cot.json` | 2020-09 → (too short to use) |
| Freight | `freight.json` | real FBX history only from 2026-03 — **not used** |

### 3.4 Data-quality findings

- **`futures_price_history.json` is wrong for 26 months.** Its arabica "front" rolled `KCZ21 → KCZ23` on 2021-09-06 — a contract two years from delivery — and the exporter's monotonic-roll guard then refused to step back, so a deferred contract was published as the front until 2023-11-03 (545 rows; median 4.3 ¢/lb below the true front, up to 24 ¢/lb). The study does not use that file; it rebuilds the nearby from the per-contract archive by calendar rule. The defect is filed separately (`notes/futures_price_history_defect.md`, issue #848) and **not fixed here**.
- **The Pink Sheet indicator premium is a valid stand-in for the futures premium.** Over the 41 months where both exist (2021-08 → 2024-12), ln(Other Milds / Robustas) and ln(KC / RC) correlate at **0.992 in levels and 0.928 in monthly changes**. The indicator series includes destination freight and a differential; the level differs (mean log premium 0.60 vs 0.52) but the movement is the same series.
- **ICO's own historical files could not be retrieved.** ICO's historical-data page links `…/historical/1990 onwards/Excel/3c - Indicator prices.xlsx` and its siblings, and every one of them returns 404 on both `ico.org` and `icocoffee.org` after ICO's site migration. ICO publishes no NY/London futures history as a file; those monthly averages exist only inside its monthly report PDFs. The Pink Sheet carries the same ICO indicator series, so nothing was lost for the indicator premium, and the futures premium is represented by the repo's own 2021→ series.
- Stooq (fallback for futures) served a bot-check page; FRED timed out from the runner. Both attempts are in the manifest.

## 4. Arbitrage construction

### A — `NY_LONDON_ARB`, the arabica premium over robusta

Two instances of the same definition, the repository's own (`lib/units.ts`, `KcRcCentsPanel.tsx`, Futures methodology §4):

```
kc_usd_t     = KC (US¢/lb) × 22.0462            # 2,204.62 lb per tonne ÷ 100
arb_usd      = kc_usd_t − RC (USD/t)             # USD per tonne
arb_ratio    = kc_usd_t / RC                     # the chain panel's "×ratio"
arb_log      = ln kc_usd_t − ln RC               # the statistical workhorse
```

- **Tier 1 (1960 →):** the same three formulas on the ICO Other Milds and Robustas indicators, USD/t. Called the *ICO indicator premium*.
- **Cross-check (2021-08 →):** on the repo's KC and RC nearbies. The nearby is the earliest-expiring listed contract whose First Notice Day (`backend/contract_dates.py`, holiday-aware) is still more than 5 (KC) / 3 (RC) trading days away, chosen among *all* listed contracts so a partially priced day is a gap rather than a jump. A max-OI variant bounded to the two nearest contracts is kept as robustness. Monthly value = mean of the month's daily prints; a month with fewer than 8 prints is NaN.
- **No FX, freight or cost enters A.** Both legs are USD exchange contracts (or USD ex-dock indicators). That is the repo's convention: costs live in its physical tender-parity ladder, never in the futures spread. Lot sizes (37,500 lb vs 10 t) are irrelevant to a per-tonne spread.
- **Why the log-ratio is primary.** Coffee tripled between 2021 and 2025; the USD/t spread is dominated by the price level, and a level-driven spread against a persistent index is the textbook spurious correlation. The USD/t spread is reported for economic magnitude.

### B — `VN_BR_ARB`, the physical arabica premium at origin

Not implemented anywhere in the repository (its nearest relatives are Brazil's internal arabica-vs-conilon panel and the tender-parity ladder). Built as:

```
vn_usd_t = VND/kg × 1000 / USDVND(t)                    # Dak Lak interior, robusta FAQ G2
br_usd_t = R$/saca × (1000 / 60) / USDBRL(t)            # co-op interior, arabica Tipo 6/7

B1  b1_log = ln br_usd_t − ln vn_usd_t                   # primary: interior basis
B2  b2_log = same with the repo's FOBbing ladders added   # VN: $55 + 1.29 %;  BR arabica: the "CON T7" twin, $62.5 + 5.83 %
B3  b3_log = b1_log − (ln kc_usd_t − ln rc_usd_t)         # differential-of-differentials
```

- B1 compares two prices on the **same basis**: interior / ex-warehouse, standard export grade, before FOB costs. They are different species; no yield or processing conversion between green robusta and green arabica exists and none is pretended. The *level* of B1 is not interpretable across species; its *changes* are, and every statistic runs on changes or the log-ratio.
- B2 uses the repository's FOBbing model (v4). Brazil arabica has no ladder of its own in the repo; `originCosts.ts` borrows the conilon one as a logistics twin, and so does B2, flagged.
- **B3 subtracts the exchange premium out of the physical one.** It equals `(br − kc) − (vn − rc)`: the NY arabica differential at origin minus the London robusta differential at origin. If ENSO shows in A and in B1 but not in B3, the physical result was A wearing a different hat.
- Freight is not added: both legs are sold FOB, and the repository's real freight history begins in March 2026.

### Transformations applied to every series

`level` (reported and flagged), `diff1`, `diff3` (the primary test), `sa` (calendar-month means removed, means estimated on the discovery window only), `sa_diff1`, `z` (standardised on the discovery window). No Hodrick–Prescott filter — it manufactures cycles.

## 5. ENSO methodology

**Continuous indices.** ONI (physical, NOAA's classification index), Niño 3.4 monthly mean of the weeklies (real time), −SOI (atmospheric). Every family is run against all three, and against **ONI⁺ = max(ONI, 0)** and **ONI⁻ = min(ONI, 0)** so that El Niño and La Niña intensity get their own correlations rather than a single symmetric one.

**Official episodes.** NOAA's rule: five consecutive overlapping seasons with ONI ≥ +0.5 (El Niño) or ≤ −0.5 (La Niña); onset = first month of the run; peak = the largest |ONI| inside it. This is a *retrospective* label — NOAA confirms it four to five months after onset (the repo's `enso.py` documents exactly this). Back-to-back same-phase episodes that restart within 12 months of the previous end (1983-10/1984-10, 2007-08/2008-11, 2018-09/2019-10, 2020-09/2021-09 …) are merged in the primary event list, because a 24-month response window would count the same coffee market twice; the un-merged list is run as a sensitivity.

**Real-time signals.** What a desk could have seen: four consecutive weekly Niño 3.4 readings past ±0.5 (known the following Monday), two consecutive ONI months past ±0.5, or one ONI month past ±1.0 — the repo's own "emerging" rule — each shifted by its publication delay (the ONI value centred on month *m* is known from *m+2*). Signals that later fizzled are **kept**: a trader in January 2025 did not know the 2024–25 La Niña would never reach five seasons. Signals within six months of each other are one developing event seen twice and are counted once.

**Availability.** ONI(*m*) averages *m−1, m, m+1* and is published early in *m+2*, so in the correlation tables lags 0 and 1 are physical, not tradeable; only lags ≥ 2 describe information a desk had.

## 6. Statistical methodology

The two series are persistent (monthly ONI autocorrelation ≈ 0.95; the log premium ≈ 0.98), so nothing here assumes independent draws.

- **Cross-correlation, lags −24 … +24** (k > 0: ENSO leads), Pearson and Spearman, for every (arbitrage × transformation × index) family — 150 families, **12,258 tests**.
- **Bartlett effective N** — N / (1 + 2 Σ ρₓ(k) ρᵧ(k)) — and Fisher-z inference on it. This is what turns 800 months of levels into ~65–125 independent observations.
- **Phase-randomised surrogates (2,000 per family).** Each surrogate keeps the ENSO series' full power spectrum — hence its autocorrelation at every lag — and randomises only the Fourier phases, which destroys any cross-relationship. Every surrogate is correlated with the arbitrage at every lag: the same 49-lag search the real series went through. Two things come out: a per-lag surrogate p, and the distribution of the **maximum |r| over all lags** — the honest test for "does the best lag survive having been searched for" (`p_max`).
- **Benjamini–Hochberg FDR** at q = 0.10 within each family, and globally across families' best lags.
- **Moving-block bootstrap** (12-month blocks) for a CI on r at the best lag.
- **Event study** on official onsets: paths of arb(t₀+h) − arb(t₀), h = 0 … 24; mean, median, IQR, min/max, time-to-peak, *consistency* (the share of episodes moving with the mean — the teleconnection module's metric), a CI from resampling **episodes**, and a **placebo**: the same number of onsets drawn from neutral months 2,000 times, giving a band and a per-horizon p, plus a family-wise p for the largest |mean| across the 25 horizons.
- **Regressions** of the 3-month change on ONI(t−k): Newey–West HAC errors (lag ≈ 1.3·√T), the first non-overlapping lag of the dependent variable, month dummies; then Δlog certified stocks as controls; then ONI⁺ and ONI⁻ separately (the asymmetry test). KC and RC prices are never controls for A — they are inside it.
- **Mechanism.** Each link of ENSO → regional rainfall anomaly → next harvest → exports / certified stocks → premium tested with the same toolkit; the Brazil and Vietnam harvests on the ONI over their growing seasons with the biennial cycle controlled; and the regression that the brief singles out — Δ premium on lagged ONI **with and without** the Brazil and Vietnam rainfall anomalies at their own best lags.
- **Out of sample.** Discovery window to 2012-12, validation 2013-01 → 2026-08. The best positive lag is chosen on discovery alone and reported on validation, with the validation window's own max-|r| p in case it had been searched there too. Seasonal means and z-scores are estimated on the discovery window only.
- **Regimes.** Correlation by ENSO state at t−k (the heat-map), and the best lag within terciles of the arabica price level and of certified stocks.
- **Predictive.** Forward changes 3 / 6 / 12 months after each real-time signal (false alarms included), against neutral months and the unconditional distribution, with an episode-resampling CI and a p against neutral draws of the same n; split at 2012-12.

All seeds are fixed. `outputs/results/` holds every number; the tables in this paper are copied from `outputs/tables/`.

## 7. Lead/lag results

### 7.1 The one-table answer

| Event | Arbitrage | Direction | Peak lag | Mean change at peak (log) | 95 % CI (episodes) | Consistency | Placebo p at peak / family | Correlation at best positive lag (ONI⁺/ONI⁻ × Δ3) | Bartlett p | BH q | max-|r| surrogate p | Economic magnitude |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **El Niño** | NY–London (ICO premium, 1960→) | **narrows** (robusta outperforms) | **12 m** | **−0.102** | [−0.198, −0.011] | 13 / 17 = 0.76 | **0.016 / 0.109** | −0.119 at lag 0 | 0.092 | 0.28 | 0.41 | −9.7 % of the ratio ≈ −$296/t @ $3,040 median, ≈ −$775/t @ $7,970 today |
| **La Niña** | NY–London | widens | 21 m | +0.090 | [−0.086, +0.280] | 8 / 12 = 0.67 | 0.137 / 0.351 | −0.072 at lag 13 | 0.28 | 0.99 | 0.99 | +9.4 % if taken at face value — it should not be |
| **El Niño** | VN–BR physical B1 (2023→) | narrows | 13 m | −0.338 | n = 1 | 1 / 1 | 0.30 / 0.34 | +0.69 at lag 14, n_eff = 8 | 0.057 | 0.41 | 0.58 | −28.7 % — one episode |
| **La Niña** | VN–BR physical B1 | — | — | — | n = 0 | — | — | — | — | — | — | no onset in the series |

_Source: `outputs/results/lag_response_table.csv`. "Consistency" is the share of episodes moving with the mean. The correlation columns come from the family with the phase-signed ONI against the 3-month change; the event columns from the onset-aligned paths. Placebo p is against 2,000 draws of the same number of neutral-month onsets; "family" counts the 25 horizons searched._

### 7.2 What the cross-correlations say

150 families (2 tiers × 5 arbitrage series × 6 transformations × 5 ENSO indices), 49 lags each, Pearson and Spearman: **12,366 tests**.

**Tier 1 — nothing survives.** In the 30 families of the ICO indicator premium (6 transformations × 5 indices; 60 counting the repo's 2021→ futures series alongside):

- **0** families whose best lag passes the max-|r| surrogate test at 5 % (smallest p = 0.39);
- **0** lags with BH q < 0.10, in any family;
- Bartlett p < 0.05 at **12 of 1,470** lag tests, where chance alone would produce ≈ 74. The persistence-corrected tests are, if anything, conservative on this data;
- the smallest BH q in the entire tier is 0.28 (ONI⁺ × Δ3, lag 0).

The primary family (ONI → 3-month change in the premium) has its best lag at **k = +1: r = −0.111** (n = 797, effective n = 198), Bartlett p = 0.12, BH q = 0.70, surrogate p_max = 0.73, block-bootstrap CI [−0.224, +0.017]. The correlation is negative from lag −3 to lag +9 and decays to zero by +15:

| lag | r | n_eff | Bartlett p | surrogate p | BH q |
|---|---|---|---|---|---|
| −3 | −0.089 | 197 | 0.21 | 0.24 | 0.70 |
| 0 | −0.107 | 198 | 0.14 | 0.17 | 0.70 |
| +1 | **−0.111** | 198 | 0.12 | 0.16 | 0.70 |
| +3 | −0.104 | 197 | 0.15 | 0.18 | 0.70 |
| +6 | −0.067 | 197 | 0.35 | 0.38 | 0.72 |
| +9 | −0.048 | 197 | 0.50 | 0.53 | 0.82 |
| +12 | −0.037 | 198 | 0.61 | 0.63 | 0.82 |
| +18 | +0.010 | 198 | 0.89 | 0.89 | 0.95 |

Note what a monthly correlation is measuring here: the 3-month *change* against the *level* of the index. A level effect that builds over a year shows as a small correlation spread across many lags — which is exactly the shape above, and exactly what the event study (§8) reports in level terms.

**The hypothesis windows, as hypotheses.** Mean r of ONI⁺ (El Niño intensity) against the 3-month change inside each window from the brief: 1–3 m **−0.115**, 3–6 m −0.110, 6–9 m −0.085, 9–12 m −0.034, 12–18 m +0.019. The effect, such as it is, sits in the first six months of *changes* — which integrates to a trough at ~12 months in *levels* — not at 9–18 months. The smallest BH q anywhere in lags 1–24 is 0.28. For ONI⁻ (La Niña intensity) every window averages |r| < 0.05 and the smallest q is 0.99.

**Best lags on the wrong side of zero.** In the differenced transformations, the largest |r| for ONI⁺, Niño 3.4 and −SOI sits at lags **−17 to −20** (r = +0.10 to +0.17, uncorrected p 0.03–0.07): the arbitrage "leading" ENSO by a year and a half. There is no mechanism by which coffee prices warm the Pacific; this is the ENSO cycle's own ~4-year periodicity aliasing through a 49-lag search, and the surrogate test — which reproduces that periodicity — prices it correctly (p_max 0.41–0.71). It is the clearest demonstration in the study of why the best lag must never be read off the chart.

**Levels.** Reported because the brief asks: ONI × level, best lag +15, r = −0.093 (p = 0.32); Niño 3.4 −0.158 at +15 (p = 0.21); −SOI −0.135 at +12 (p = 0.13). Effective n collapses to 65–125 and nothing approaches significance even before correction.

**The repo's own futures premium (2021 →).** Levels: r = −0.78 at lag 6 with an effective n of **6.6** and surrogate p = 0.47. Sixty-one months containing one episode per phase cannot say anything, and the surrogate band — which reaches ±0.9 there — says so.

### 7.3 Regime × lag (chart 07)

Correlation of ONI(t−k) with the 3-month change, over months whose ENSO state at t−k was El Niño / neutral / La Niña. With the 1950→ index, **no cell** of the Tier-1 grid is below Bartlett p = 0.05. Within El Niño months the correlation is uniformly small and negative out to lag 16 (−0.08 to −0.16); within La Niña months it is small and positive at lags 4–10 and negative at 13–24 (to −0.19). The two phases are not mirror images — but neither shows a cell that would survive correction.

## 8. El Niño event study

Seventeen official onsets since 1960 (back-to-back episodes merged; 19 unmerged). Chart 05.

| h (months) | mean | median | IQR | consistency | CI (episodes) | placebo band | placebo p |
|---|---|---|---|---|---|---|---|
| 3 | −0.009 | −0.014 | [−0.104, +0.036] | 0.53 | [−0.060, +0.044] | [−0.040, +0.048] | 0.67 |
| 6 | −0.057 | −0.010 | [−0.188, +0.042] | 0.53 | [−0.129, +0.019] | [−0.041, +0.071] | 0.066 |
| 9 | −0.073 | −0.099 | [−0.192, +0.022] | 0.65 | [−0.136, −0.005] | [−0.055, +0.092] | 0.066 |
| **12** | **−0.102** | **−0.090** | [−0.211, −0.034] | **0.76** | **[−0.198, −0.011]** | [−0.072, +0.093] | **0.016** |
| 15 | −0.058 | +0.012 | [−0.208, +0.057] | 0.47 | [−0.167, +0.042] | [−0.085, +0.093] | 0.19 |
| 18 | −0.040 | −0.080 | [−0.149, +0.134] | 0.59 | [−0.159, +0.063] | [−0.085, +0.097] | 0.40 |
| 24 | −0.042 | +0.037 | [−0.260, +0.164] | 0.47 | [−0.167, +0.082] | [−0.085, +0.110] | 0.42 |

- **Direction and timing.** The premium drifts down from month 5, troughs at **12 months** (−0.102 log, median −0.090), and mean-reverts by month 18. At 12 months **13 of 17** episodes are negative; at 6 months only 9 of 17.
- **Against the placebo.** At h = 12 the mean sits outside the 95 % band of random neutral onsets (p = 0.016). Counting the 25 horizons the trough was found in, the family-wise p is **0.109**. With back-to-back episodes kept separately (n = 19): −0.080, consistency 0.68, p = 0.042 at h = 12.
- **What carries it.** 1997–98 (−0.63 at 12 m) is by far the largest; without it the mean is −0.069. 1965, 1982, 1991, 2014 and 2023 each contribute −0.15 to −0.26. The four counter-examples (1968, 1972, 2009, 2018) are all moderate events, but so are several of the negatives; intensity does not separate them.
- **The 2023–24 episode**, the only one in the repo's own futures data, followed the template: −0.25 at 12 m in the indicator premium, −0.28 at 15 m in the ICE futures premium.

## 9. La Niña event study

Twelve official onsets since 1960 (18 unmerged). Chart 06.

| h | mean | median | IQR | consistency | CI (episodes) | placebo p |
|---|---|---|---|---|---|---|
| 6 | −0.033 | −0.015 | [−0.104, +0.023] | 0.67 | [−0.080, +0.012] | 0.38 |
| 12 | −0.003 | −0.062 | [−0.105, +0.047] | 0.58 | [−0.106, +0.116] | 0.95 |
| 18 | +0.037 | +0.075 | [−0.125, +0.107] | 0.58 | [−0.107, +0.191] | 0.52 |
| **21** | **+0.090** | +0.134 | [−0.211, +0.208] | 0.67 | [−0.086, +0.280] | 0.14 |
| 24 | +0.080 | +0.101 | [−0.112, +0.247] | 0.67 | [−0.106, +0.270] | 0.20 |

Nothing here is a result. The paths fan out symmetrically (1964: +0.47 at 12 m; 2005: −0.28; 1995: +0.78 at 24 m; 2010: −0.44), the mean never leaves the placebo band, the CI never excludes zero, and the "peak" at 21 months has a family-wise p of 0.35. The hypothesised 6–12-month window averages −0.003 at 12 months. Kept separately, the 18 unmerged episodes give +0.067 at 21 m, consistency 0.61, p = 0.17.

**Asymmetry.** The regression (§10) puts the point directly: the ONI⁺ coefficient is −0.025 to −0.030 (p ≈ 0.05–0.07 at lags 0–3), the ONI⁻ coefficient +0.006 to +0.012 (p > 0.3). Whatever ENSO does to this premium, it does it in El Niño years. La Niña is not "minus El Niño" — it is nothing measurable.

## 10. Regression and controls

Dependent variable: the 3-month change in the log premium. HAC (Newey–West) errors; month dummies; the first non-overlapping lag of the dependent variable. Full table: `outputs/tables/regressions_tier1.md`.

| lag k | specification | ONI coef | HAC p | ONI⁺ coef (p) | ONI⁻ coef (p) | n |
|---|---|---|---|---|---|---|
| 0 | ONI + lagged Δ + month dummies, 1960→ | −0.012 | 0.12 | −0.025 (0.069) | +0.006 (0.65) | 793 |
| 1 | same | −0.012 | 0.13 | −0.026 (0.072) | +0.006 (0.61) | 794 |
| 3 | same | −0.012 | 0.20 | **−0.030 (0.049)** | +0.012 (0.31) | 794 |
| 6 | same | −0.007 | 0.42 | −0.021 (0.15) | +0.010 (0.40) | 794 |
| 12 | same | −0.004 | 0.63 | +0.004 (0.78) | −0.014 (0.40) | 794 |
| 1 | + Δlog certified **robusta** stocks (1993→, same sample) | +0.002 | 0.85 | | | 195 |
| 1 | ONI alone, **2010-08→** sample | +0.002 | 0.87 | | | 193 |
| 1 | + Δlog certified robusta **and arabica** stocks (2010→) | +0.004 | 0.74 | | | 178 |

- One ONI degree at lags 0–3 is worth about −1.2 % on the premium over the next quarter in the full sample — marginal (p 0.12–0.20), and it is the **El Niño half** of the index doing it.
- **The controls do not absorb it; the years do.** In the 2010→ sample the ONI coefficient is zero *before* any stock control enters. Certified stocks add nothing for robusta (p = 0.99); the arabica stock change is itself associated with the premium (+0.05 per Δlog, p = 0.008) but does not change ONI's coefficient because there was nothing left to change. The relationship, whatever it is, belongs to 1960–2009.
- **ENSO vs weather** (1995→, n = 375; the brief's §5). Δ premium on ONI(t−1), then adding the Brazil arabica-belt and Vietnam Central Highlands rainfall anomalies at their own best lags (2 and 3 months):

| | ONI(t−1) | Brazil rain(t−2) | Vietnam rain(t−3) | R² |
|---|---|---|---|---|
| without weather | −0.012 (p 0.125) | | | 0.038 |
| with weather | −0.014 (p 0.20) | **+0.025 (p 0.034)** | +0.006 (p 0.55) | 0.100 |

  The ENSO coefficient does **not** shrink when rainfall enters (it grows 11 %); its p rises only because the standard error does. Brazil rainfall carries its own marginal coefficient (wetter arabica belt → wider premium two months later — a harvest-quality reading is plausible, but one coefficient at p = 0.03 in a searched specification is not a finding). The conclusion the brief asked for — "if ENSO disappears after weather, ENSO was an early warning for the weather" — does **not** obtain; nor does its converse become interesting, because neither variable explains the premium robustly at this frequency.

## 11. Robustness

| test | result |
|---|---|
| **Transformations** (chart 08) | Levels, z, seasonally adjusted, 1- and 3-month changes, seasonally-adjusted changes: the best-lag r for ONI ranges −0.09 to −0.11 and no block-bootstrap CI cleanly excludes zero in the differenced transforms. The "significant" lags in the levels transforms (−0.21 to −0.22 in the 1980→ sample) shrink to −0.09 when the 1960s–70s are included. |
| **Indices** | Niño 3.4 and −SOI agree with ONI in sign at lags 0–3 (r −0.16 and −0.10 at lag 0 on Δ3) and disagree nowhere that matters. |
| **Multiple testing** | BH q ≥ 0.28 everywhere in Tier 1; max-|r| surrogate p ≥ 0.39 everywhere in Tier 1. |
| **Effective sample** | 800 months of levels carry the information of 65–125 independent observations (Bartlett); 3-month changes, 198. The 2021→ futures series: **6.6**. |
| **Out of sample** (discovery 1960–2012, validation 2013–2026) | Δ3: best positive lag on discovery = 1, r = −0.127 (p 0.105) → validation r = −0.058 (p 0.73), same sign. Levels: lag 20, r = −0.143 → validation **+0.038**, sign flips. Had the validation window been searched on its own, its best lag would have p_max = 0.75. **The relationship does not hold out of sample.** |
| **Back-to-back episodes** | merged (primary) vs kept: El Niño −0.102 / −0.080 at 12 m; La Niña +0.090 / +0.067 at 21 m. Direction unchanged, strength lower with more (dependent) events. |
| **Outliers** | 1997–98 is a third of the El Niño effect; the mean without it is −0.069 (still 12 of 16 negative). The Vietnam series had one parse error, excluded and listed. |
| **Market regimes** (`market_regimes_tier1.md`) | Terciles of the arabica price level and of certified stocks give scattered best lags (low-price tercile: lag 22, r −0.22, p 0.013; low robusta stocks: lag 18, r +0.55, p 0.028, n = 69) across 9 cells × 25 lags searched. No regime shows a stable version of the effect; nothing here is built on. |
| **Tier 2 (VN–BR)** | 37 months, one El Niño that began in month 1. Correlations of ±0.7–0.9 appear with effective n of 5–8, and the surrogate band reaches ±0.9: the B3 (net-of-exchange) series is the only place two families pass the surrogate test (r = −0.92 at lag 4, n_eff 6) — that is the 2024 robusta spike, seen once. Direction agrees with Tier 1 (B1 −0.33 at 12 m; B3 −0.36 at 9 m). **Not evidence; not counter-evidence.** |

## 12. Economic interpretation

**Sign.** The naive story — El Niño → Brazilian drought → arabica up → premium widens — is the opposite of what the data show. The premium *narrows*. That is consistent with the one link that is unambiguous in this dataset: **El Niño dries Vietnam's Central Highlands** (rainfall anomaly r = −0.48 at a 2-month lag, effective n 98, surrogate p < 0.001; chart 09). A robusta-supply threat lifts London relative to New York. El Niño's effect on the Brazilian arabica belt's rainfall is, in this store, nil (r = 0.09) — south-east Brazil is not the Nordeste — so there is no offsetting arabica leg.

**Why the chain breaks at prices.** Rainfall anomaly → next harvest (Vietnam robusta, ONI over the fill months: coefficient −0.05, p = 0.41 on n = 28 approximate USDA years; Brazil: +0.04, p = 0.20, with the biennial cycle explaining 78 % of the variance on its own) → exports / certified stocks (nothing robust) → premium (Vietnam rainfall → Δ premium r = 0.09) are each weak at monthly frequency. That is not surprising: production responds with a crop-cycle lag, prices respond to *expectations* of it, and a monthly anomaly is a crude proxy for what the tree experienced. The event study, which lets the effect accumulate over a year, sees more than any single-lag correlation can.

**Size.** −0.10 log is about −10 % of the arabica/robusta ratio: at the 1980→ median Other Milds price ($3,040/t) that is ≈ **$300/t** of premium; at the August 2026 level ($7,970/t) ≈ **$775/t**. The premium's own 12-month change has a standard deviation of 0.21 log, so the average El Niño effect is about half a normal year's move — large enough to matter, small enough to be lost in any single year (the IQR at 12 months runs from −0.21 to −0.03).

**Costs.** A KC/RC spread is a two-leg futures position; commissions and slippage are a few dollars per tonne against a $300–800/t expected move. Costs are not the constraint. Reliability is.

**Asymmetry.** La Niña wets the Central Highlands (the rainfall link is symmetric) but does nothing measurable to the premium. A plausible reading is that abundant robusta supply is absorbed by stocks and by blend substitution without moving the premium, whereas a robusta *shortfall* cannot be — the response is convex. With 12 La Niña episodes this remains a reading, not a result.

## 13. Trading implications

The brief's two questions, answered as the evidence allows.

**"If an El Niño develops today, does the history suggest the NY–London arbitrage moves in a particular direction X months from now?"** — The tendency in the record is a **narrowing** (robusta outperforming arabica) that builds from month 6 and troughs around **month 12**, averaging about −10 % of the ratio, in 13 of the 17 official episodes since 1960. Three things stop that being a signal:

1. it does not survive the multiple-testing correction (family placebo p = 0.11; no correlation survives at all);
2. it is **not visible after 2010** in the regression and **fails out of sample** in every transformation;
3. measured from what a desk actually sees — the four-week Niño 3.4 signal, false alarms included — the 12-month move is **−0.047 with a 57 % hit rate** (n = 24), −0.028 on the four signals since 2013, and the first three months after a signal show a small *widening* (+0.035, 71 %). Retrospective onsets look twice as good (−0.102, 76 %) precisely because they are retrospective.

Practical use, if any: a **mild prior towards robusta strength 6–12 months out**, to be confirmed or discarded by the thing ENSO *does* forecast — the Central Highlands dry season, which this repo already measures daily — not a standalone spread trade. For the event under way now (real-time signal 2026-05, ONI +1.8 in July 2026), the template would put the trough around mid-2027; the template has been wrong four times in seventeen.

**"If a La Niña develops today, is there evidence the Vietnam–Brazil physical arbitrage behaves differently Y–Z months later?"** — **No.** On the NY–London premium, La Niña shows no forward information at 3, 6 or 12 months (hit rates 46–52 %), and its real-time signal fires falsely 38 % of the time. On the physical arbitrage there is no La Niña onset in the data at all.

**Hypothesis 3 (the two arbitrages differ).** Untestable with one physical episode. What can be said: in the one El Niño both series contain, the physical premium moved the same way as the exchange premium, and so did the net-of-exchange series B3 — the 2024 robusta rally was a physical event that the exchanges tracked, not an exchange event.

## 14. Limitations

- **ENSO is a small-n problem however long the series.** Sixty-six years contain 17 usable El Niño and 12 La Niña onsets; a 24-month response window on a ~4-year cycle means adjacent windows overlap. Every event-level statistic here has the power of a couple of dozen observations at best.
- **Tier 1 is the ICO indicator premium, not the futures premium.** They co-move at r = 0.99 (levels) / 0.93 (changes) over 41 months, and the indicator includes destination freight and a differential. ICO's own files could not be retrieved (all 404 after ICO's site migration), and ICO publishes no futures history as a file. The futures premium is represented only by the repo's 2021→ series, which is too short to test.
- **Tier 2 is 37 months with one episode.** The Vietnam series is the binding constraint; the architecture accepts a longer one (`data/vietnam_local_history.csv`) and the study re-runs unchanged. A longer Brazil CEPEA series is a five-line addition.
- **No ENSO forecast archive.** Markets price CPC/IRI forecasts months before the ONI crosses; the negative-lag correlations can flag anticipation but cannot separate it from the forecast.
- **Onset dates are NOAA's, hence retrospective.** The real-time analysis uses the repo's own emerging rule with publication delays; other real-time rules would give somewhat different signal months.
- **Production series are approximate** (rounded USDA PSD), annual, and 28 years long; the crop-year regressions are indicative only.
- **Weather is rainfall and temperature totals**, not the SPI/SPEI/ET0 the repo's drought model uses, averaged over two (Brazil) and four (Vietnam) regions.
- **Confounding is unaddressed at the episode level.** The 2020–23 La Niña coincides with the July 2021 Brazil frost and the post-COVID freight squeeze; 2023–24 El Niño with the robusta shortage. In a study of 29 episodes, these are individual data points, not controls.
- **Certified-stock controls only exist from 1993 (robusta) and 2010 (arabica)**, which is why the controlled regressions run on a sample in which the ENSO effect is absent to begin with.
- **The search was large** — 12,366 correlation tests, 25 horizons × 2 phases × 4 series in the event study, 9 regime cells × 25 lags — and the paper's corrections cover the correlation families and the event horizons, not every cut. Any single uncorrected p in the regime or market-regime tables should be read as exploratory.

## 15. Conclusion

The hypothesis that ENSO has a strong, lagged relationship with the coffee arbitrage — several months for El Niño, longer for La Niña — is **not supported** at the standard the brief set. Across the longest series obtainable (66 years, 29 episodes) no lag survives correction for having been searched, the effect is absent out of sample and in the post-2010 data, and the real-time signal carries at most half of what the retrospective one appears to.

What the data do contain is narrower and more interesting than the hypothesis: an **El Niño-only** tendency for the arabica premium to **narrow** over the following year — the opposite sign to the folk story, and the sign the physical channel predicts, because the one thing ENSO demonstrably does to coffee's weather in this dataset is dry the Central Highlands. It is consistent across 13 of 17 episodes and worth about $300–800/t, and it would need another decade of episodes to become a result. Until then it is a prior, to be updated by the rainfall it is a proxy for.

🟡 **El Niño → NY–London: interesting, not robust.** 🔴 **La Niña → anything: no convincing evidence.** ⚪ **Vietnam–Brazil: not yet testable; the one episode agrees.**

---

### Appendix A — every official ENSO episode inside the Tier-1 series (§9 of the brief)

Change in the log premium from onset; back-to-back episodes merged (`merged` = 1). Full table with all horizons: `outputs/tables/event_table_tier1.md`; unmerged: `event_table_tier1_all.md`.

| onset | phase | peak ONI | months | merged | pre-level | +3 m | +6 m | +9 m | +12 m | +18 m | +24 m |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1963-07 | El Niño | 1.19 | 8 | 0 | 0.27 | -0.028 | +0.017 | -0.069 | -0.049 | +0.205 | +0.041 |
| 1964-05 | La Niña | -0.80 | 9 | 0 | 0.25 | +0.041 | +0.059 | +0.279 | +0.466 | +0.098 | +0.004 |
| 1965-06 | El Niño | 1.82 | 10 | 0 | 0.59 | -0.226 | -0.209 | -0.224 | -0.256 | -0.285 | -0.320 |
| 1968-10 | El Niño | 0.98 | 8 | 0 | 0.14 | +0.018 | +0.066 | -0.016 | +0.063 | +0.138 | +0.037 |
| 1970-07 | La Niña | -1.36 | 19 | 0 | 0.27 | -0.077 | -0.180 | -0.201 | -0.190 | -0.190 | -0.077 |
| 1972-06 | El Niño | 1.84 | 10 | 0 | 0.07 | +0.019 | +0.042 | +0.138 | +0.158 | +0.068 | +0.048 |
| 1973-05 | La Niña | -2.04 | 35 | 1 | 0.24 | -0.037 | -0.111 | -0.067 | -0.183 | -0.220 | -0.218 |
| 1976-09 | El Niño | 0.84 | 18 | 1 | 0.12 | -0.135 | -0.156 | +0.007 | -0.211 | -0.047 | -0.096 |
| 1982-05 | El Niño | 2.14 | 14 | 0 | 0.28 | -0.020 | -0.159 | -0.241 | -0.245 | -0.172 | -0.260 |
| 1983-10 | La Niña | -1.06 | 21 | 1 | 0.07 | +0.002 | +0.011 | -0.032 | -0.064 | +0.067 | +0.158 |
| 1986-09 | El Niño | 1.49 | 17 | 0 | 0.30 | -0.111 | -0.139 | -0.126 | -0.090 | +0.125 | +0.231 |
| 1988-05 | La Niña | -1.85 | 13 | 0 | 0.32 | +0.093 | -0.012 | -0.014 | +0.042 | -0.103 | +0.161 |
| 1991-06 | El Niño | 1.54 | 13 | 0 | 0.61 | -0.014 | -0.243 | -0.136 | -0.176 | -0.219 | -0.344 |
| 1994-10 | El Niño | 0.97 | 5 | 0 | 0.23 | +0.099 | +0.012 | +0.022 | -0.053 | +0.134 | +0.358 |
| 1995-08 | La Niña | -1.05 | 8 | 0 | 0.19 | -0.040 | +0.084 | +0.186 | +0.299 | +0.641 | +0.779 |
| 1997-05 | El Niño | 2.37 | 12 | 0 | 0.89 | -0.108 | -0.308 | -0.292 | -0.632 | -0.678 | -0.560 |
| 1998-07 | La Niña | -1.53 | 32 | 1 | 0.45 | -0.108 | -0.102 | -0.035 | +0.009 | +0.318 | +0.342 |
| 2002-07 | El Niño | 1.19 | 8 | 0 | 0.76 | +0.001 | -0.219 | -0.129 | -0.107 | -0.087 | +0.051 |
| 2004-08 | El Niño | 0.71 | 7 | 0 | 0.73 | +0.247 | +0.303 | +0.055 | -0.039 | -0.132 | -0.352 |
| 2005-11 | La Niña | -0.86 | 5 | 0 | 0.76 | -0.107 | -0.143 | -0.327 | -0.276 | -0.444 | -0.397 |
| 2006-09 | El Niño | 0.88 | 5 | 0 | 0.48 | +0.162 | +0.064 | -0.099 | -0.034 | -0.149 | -0.044 |
| 2007-08 | La Niña | -1.76 | 20 | 1 | 0.26 | +0.005 | -0.035 | -0.078 | -0.079 | +0.133 | +0.381 |
| 2009-07 | El Niño | 1.50 | 9 | 0 | 0.66 | +0.067 | +0.144 | +0.182 | +0.191 | +0.282 | +0.187 |
| 2010-06 | La Niña | -1.57 | 21 | 1 | 0.88 | +0.102 | +0.065 | +0.000 | -0.061 | -0.029 | -0.439 |
| 2014-10 | El Niño | 2.59 | 20 | 0 | 0.72 | -0.104 | -0.188 | -0.192 | -0.147 | -0.113 | -0.221 |
| 2017-11 | La Niña | -0.76 | 5 | 0 | 0.37 | -0.016 | -0.014 | +0.002 | +0.059 | +0.091 | +0.216 |
| 2018-09 | El Niño | 1.05 | 19 | 1 | 0.44 | +0.036 | +0.016 | +0.105 | +0.142 | +0.329 | +0.373 |
| 2020-09 | La Niña | -1.11 | 29 | 1 | 0.79 | -0.047 | -0.016 | -0.012 | -0.064 | +0.082 | +0.045 |
| 2023-06 | El Niño | 1.99 | 11 | 0 | 0.67 | -0.057 | -0.010 | -0.221 | -0.254 | -0.080 | +0.164 |

### Appendix B — figures

| | |
|---|---|
| `outputs/charts/01_enso_vs_ny_london.png` | ONI and the NY–London premium, 1960 → 2026, official episodes shaded; the repo's futures premium overlaid from 2021 |
| `02_enso_vs_vn_br.png` | the same for the physical premium B1 and its net-of-exchange form B3 |
| `03_ccf_enso_ny_london.png` | cross-correlation ONI → NY–London, levels and 3-month changes, with the surrogate 95 % band and any BH-significant lags marked |
| `04_ccf_enso_vn_br.png` | the same for B1 — note the ±0.9 surrogate band |
| `05_event_study_el_nino.png` · `06_event_study_la_nina.png` | onset-aligned paths, mean, median, IQR and the placebo band, Tier 1 and Tier 2 side by side |
| `07_regime_lag_heatmap.png` | r by ENSO state at t−k × lag, both arbitrages |
| `08_robustness_transforms.png` | best-lag r with block-bootstrap CI across every transformation and phase-signed index |
| `09_mechanism_chain.png` | the chain, link by link, with the survivors of the surrogate test marked |
| `10_predictive_conditional.png` | forward change 3 / 6 / 12 months after a real-time signal, El Niño vs La Niña vs neutral |

### Appendix C — self-audit

| check | answer |
|---|---|
| Future information used? | No: real-time signals carry publication delays; seasonal means and z-scores use the discovery window only; the ONI's centre-month anchoring is stated and lags 0–1 flagged as non-tradeable. |
| Frequencies mixed incorrectly? | Everything is monthly; daily prices averaged with a minimum-prints rule; weekly Niño 3.4 averaged by week-ending month. |
| Look-ahead in the arbitrage? | The nearby is rolled by a calendar rule from the per-contract archive; the defective published front series is not used. |
| Cherry-picked lag? | Every lag reported; the best lag is tested with the max-|r| surrogate, and both the strongest and the hypothesis-window lags are shown. |
| Multiple testing? | 12,366 tests counted; BH within and across families; family-wise placebo over horizons. |
| Autocorrelation? | Bartlett effective n, HAC regressions, block bootstrap, phase-randomised surrogates. |
| Seasonality? | Month dummies in every regression; seasonally-adjusted transforms; calendar-month demeaning on the discovery window. |
| Formulas and units? | §4; the ¢/lb → USD/t constant is the repo's; VND/kg and R$/saca conversions are tested (`tests/test_core.py`). |
| Missing data? | Listed, never filled: one Vietnam print excluded, thin months dropped by rule, ICO/Stooq/FRED failures in the manifest. |
| Outliers driving it? | 1997–98 carries a third of the El Niño effect; reported with and without. |
| Survives robustness? | Direction yes; significance no (§11). |
| Holds out of sample? | No (§11). |
| Economically large after costs? | Yes if real (§12); reliability, not cost, is the limit. |
