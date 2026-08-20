# Open Price Direction — model research findings

Living record of feature decisions + evidence for the Robusta open-price-direction
work. Every candidate is judged on **walk-forward, out-of-sample** performance
(expanding window, refit periodically, standardise-on-past), scored as **edge =
OOS accuracy − rolling-majority baseline**, with sign-stability, per-year
consistency, significance and calibration checks.

## Target & firing
- **Predicts:** direction of the **overnight gap** — RC open ÷ prior 17:30-London
  close − 1 (up/down), with an **abstain band** on low-confidence days.
- **Fires:** 03:00 UTC (Mon–Fri, own job), pre-open; prediction feeds the Telegram brief.
- **Roll days excluded** from the target (front-contract change → spurious gap).

## Feature verdicts (overnight-gap target, ~900 OOS days 2022–2026)

| Feature | Decision | Evidence |
|---|---|---|
| `kc_after_rc_diff` (NY move 17:30→18:30 London, after RC closes) | **KEEP** | +2.8pp edge, AUC 0.57, sign 100% stable, 3/5 yrs +, better when confident (top-third 62.9%). The core lead signal. |
| `days_since_roll` (position in bi-monthly roll cycle) | **KEEP (provisional)** | Marginal **+1.1pp** over kc_after → combined **+3.9pp**, AUC 0.58, p1=0.019, 4/5 yrs; **confirmed on untouched last-30% holdout (+2.9pp marginal)**. Cycle shape: gaps tilt down mid-cycle (~day 10), up late-cycle (~day 37). |
| `cci_overnight` (CCI 17:30-close → 03:00 UTC, %→$/t) | **SHIP LIVE (forward-validate)** | No historical intraday FX → can't back-test; ships live, graded forward-only. |
| `kc_rc_gap_z` (arb level, windows 7/15/21) | **DROP** | Negative edge, AUC 0.48, unstable sign; adding it *lowers* the combined edge. Arb doesn't predict the overnight gap. |
| `kc_rc_gap_ret` (arb daily change) | **DROP** | Redundant with the level + roll-contaminated. |
| `rc_ret_1d` (prior-day return) | **DROP** | No signal (per design intuition). |
| `rc_overnight_gap`, `rc_open15_ret` | **OUTCOMES, not features** | These *are* the open behaviour we grade against. |
| harvest / frost / day-of-year seasonality | **DROP (this model)** | All ≤0 marginal, unstable — frequency-mismatched + too few annual cycles. Reserve for the longer-horizon model. |
| term structure, daily-BRL, index-roll, month-end, weekend | **DROP** | No usable edge on this target. |

## BUG FIXED 2026-08-20 — a thin optional feature took the model DARK
`run()` trains on `frame.dropna(subset=["y"] + active)` — **listwise**. A
feature that clears only its COVERAGE gate does not add a column to the
training set, it **truncates the training set to its own span**.

Live sequence: `cci_overnight` crossed its 40-session coverage gate on
**2026-07-29** → `active_features()` admitted it → training collapsed
**1,168 → 51 rows** → below `_MIN_TRAIN` (252) → `run()` returned
*"Only 51 labelled sessions"* → the log module's `else` branch leaves the
panel payload untouched, so the Macro tab would serve a frozen prediction
with no error surfaced anywhere.

**Fix:** `active_features()` now applies a TRAINABILITY gate — a candidate
joins only if, with it, `dropna(["y"] + active + [candidate])` still clears
`_MIN_TRAIN`. Candidates are tested most-covered-first so a thin feature
cannot block a well-covered one. Verified: active set returns to
`[kc_after_rc_diff, days_since_roll]`, train 1,168, `run()` available and
reproducing the live payload exactly (edge 0.0448, acted 0.6358).
Regression test: `test_thin_optional_feature_cannot_destroy_the_training_set`.

Also: `_cci_overnight_series()`'s bare `except` now LOGS the reason. It
imports `fetch_currency_index` (which pulls numpy/pandas/requests at module
level), so a missing dependency silently disabled the feature forever and
looked identical to "not enough data yet".

**Real activation bar for cci_overnight is 252 trainable rows, not 40** —
tracked in the retest watchdog (`cci_trainable`). The same trap awaited
`b3_close_gap`; it is now covered by the same gate.

### Did the fixes improve the backtest? No — they RESTORED it.
Measured after the fix (2026-08-20), against the live payload:

| | value |
|---|---|
| active features | `kc_after_rc_diff`, `days_since_roll` |
| n_train | 1,168 |
| n_test (walk-forward OOS) | 916 |
| accuracy / baseline / **edge** | 57.97% / 53.49% / **+4.48pp** |
| acted accuracy (outside the ±10pp band) | **63.58%** on 346 calls |
| abstain rate | 62.2% |

Identical to the pre-outage numbers, and that is the correct outcome: no
feature was added and no coefficient changed. The fixes restored the model's
ability to produce a call at all, plus the alerting that would have caught
the three-week outage on day two. Nothing in #718/#719 could have moved the
backtest, because none of it touched the fitted model.

The three items that *could* move it are all still pending data, not code:
`cci_overnight` (51 trainable rows of 252), `b3_close_gap` (0 of 40 — see the
capture bug below), and `rc_last_1630`. Each is gated to be graded on its own
walk-forward marginal before it can join.

### What the FX backfill can and cannot buy (arithmetic, 2026-08-20)
Only ~2/3 of calendar sessions are trainable (roll days are unlabelled and
`kc_after_rc_diff` has holes), so the two gates sit far apart in calendar
terms:

| CCI coverage backfilled | core-trainable rows gained |
|---|---|
| last 200 sessions | 171 |
| last 260 sessions | 189 |
| last 300 sessions | 198 |
| last 360 sessions | 239 |
| **last 384 sessions** | **252 — the gate** |

So a 200-session backfill clears the 40-day coverage gate many times over and
makes the feature *testable* on a sample worth believing (n=51 today is not),
but does **not** on its own put it in the model.

### Backfill executed 2026-08-20 — and cci_overnight GRADES OUT NULL
Two runs of workflow 1.16b were needed, and the first one's failure was the
informative part.

**Run 2 (40,000 bars/pair): added nothing for the liquid pairs.** Not
retention — a hard **5,000-record cap on the response**. Every one of the
twelve pairs returned exactly 5,000 rows against a 40,000 ask
(`data/fx_backfill_source_reach.json`). At 96 bars a session that is ~52
sessions of a liquid pair, which is precisely where BRL/EUR/JPY stopped. A
bigger number was never going to work.

**Run 3 (paged): 56 → 317 usable days.** `--backfill` now walks the window
backwards via a *probed* cut-off parameter (`end`, 8 pages). 2,429 new
pair-days, coverage from 2025-04-04, and — the number that makes gap-filling
from this source defensible at all — **677 overlapping pair-days with 0
mismatches** against the forward capture.

Trainable rows went **51 → 207**. Still short of 252, but finally enough to
grade the feature honestly:

| test | result |
|---|---|
| corr(cci_overnight, y) | **+0.052** (t = 0.75, n = 207) |
| sign-rule accuracy | **50.2%** vs a 53.1% majority baseline — *worse* |
| walk-forward accuracy, core | 0.6437 (edge +0.1149, 87 matched OOS days) |
| walk-forward accuracy, core + cci | **0.6437 — identical** |
| acted | 66.7% on 30 → 68.8% on 32 (two extra calls; noise) |

**Verdict: no evidence of value.** Note what happened to the earlier read — at
n=51 the correlation was +0.156 and looked mildly encouraging; with four times
the data it collapses to +0.052 and the sign rule underperforms a coin
weighted by the base rate. That is the small-sample mirage this whole
grade-before-activation discipline exists to catch. The watchdog's action for
`cci_trainable` now says RETIRE rather than ACTIVATE, pending one confirming
re-run at 252. (min_train was 120 for this test, below production's 252,
because the sample does not reach it — a research read, not an activation.)

**Two bugs the backfill exposed, both fixed:**
- `_cci_trainable_rows()` in the watchdog counted "days with ≥6 pairs that are
  also RC sessions" and reported **314/252 MATURE** while `active_features()`
  correctly refused at 207. It ignored listwise deletion — roll days are
  unlabelled and `kc_after_rc_diff` has holes, which costs about a third of
  the days. It now replicates the model's own dropna. A watchdog that fires
  before the gate it watches is worse than no watchdog.
- `_KEEP_DAYS` was 500 and the backfill filled it *exactly*; the next run
  would have begun dropping the oldest rows, and a dropped day is
  unrecoverable once the source's own window has moved past it. Raised to
  1,200.

## `b3_close_gap` (PR #697, 2026-08) — the model's OWN B3 feature, DORMANT
Not to be confused with the rejected `b3_after_kc` below — **different
construction, different test.**
- **`b3_close_gap`** (in the model, dormant): B3 arabica's move from its
  price **at the KC close** to its **official fechamento**, from the
  two-phase capture (`capture_b3_at_kc_close.py` →
  `b3_kc_close_snapshots.json`). Isolates only the window after New York
  settles. Ships dormant behind `_MIN_B3_OVERLAP = 40` sessions and joins
  `active_features()` automatically once the gate clears — forward-only
  accumulation, same pattern as `cci_overnight`.
- **`b3_after_kc`** (rejected, below): B3's **whole day** residualised
  against KC's whole day (rolling-60 beta), reconstructed from daily front
  prices. Necessarily mixes the full session's co-movement and BRL noise.
- **Consequence: the rejection below does NOT test the live feature.** The
  research card states this explicitly above its verdict. The retest
  watchdog tracks the 40-session gate (`b3_close_gap` entry) so the feature
  is graded on its own walk-forward evidence BEFORE it activates, rather
  than joining the deployed model ungraded.
- Status at time of writing: 0/40 sessions with a usable gap captured.

### BUG FIXED 2026-08-20 — the capture had never once fired
That "0/40" was not slow accumulation. Auditing why the model still showed
`b3_close_gap` absent a week after PR #697 shipped: the snapshot file held
only `b3_final` rows and no `at_kc_close`, so the gap was never computable.

The `kc_close` phase fired on cron `'33 17'` UTC behind a **13:28–13:52 NY**
fence around the 13:30 settle. GitHub runs crons late as a matter of course.
Every scheduled fire of runs 1–6 landed at **17:52–17:56 UTC = 13:52–13:56
NY** and every one was rejected — the first by *one minute*:

```
[b3-kc-close] 13:53 NY is outside the KC-close window — skip
```

The fence was solving the wrong problem: its only job is to admit exactly one
of the two DST crons per season, and the other is an hour away, so it can be
loose. Fixed by moving the crons to `:25` (five minutes AHEAD of the settle —
drift is one-way late, so aiming early and waiting is reliable while aiming
late is not), widening the window to **13:20–14:30 NY**, and making an early
fire WAIT for the settle rather than discard the run. Rows now record
`captured_ny` / `late_min` so a capture that drifted far from the settle can
be filtered instead of silently trusted; `kc_close` merges into an existing
row rather than replacing it, so a hand-dispatched backfill cannot delete the
day's `b3_final`. Regression test replays the real fire times:
`scraper/tests/test_b3_kc_close_guard.py`.

The same class of bug in the phase router was fixed alongside: `date -u +%H`
compared `= 21`, so a `21:37` fechamento slot that drifted past 22:00 would
have been routed to `kc_close` and skipped. Now `-ge 21`.

**Lesson, third time this month:** a guard tuned to when a job is *scheduled*
rather than when it *actually runs* fails closed and silently. Both the
cci_overnight collapse and this one presented as "the feature is patiently
accumulating".

## B3 late-close factors (2026-08) — arabica REJECTED at the gate; conilon DATA-STARVED
Owner hypothesis: B3 São Paulo trades ~2.4h after KC's NY close (arabica ICF)
and ~3h after London's RC close (conilon CNL); the late window could carry
Brazil physical / BRL / weather news into the next ICE open. Timing checked
and VIABLE for both: B3 settles print ~21:00 London, well before the 03:00
UTC firing.

- **`b3_after_kc` (arabica)** — ICF front daily return RESIDUAL vs the
  same-day KC settle return (rolling-60 beta; both legs roll-cleaned) = the
  information B3 printed that KC's close did not contain. On 490 aligned
  sessions (2023-09→2026-08): lead corr **+0.04 (t 0.8)**, flat every year.
  Walk-forward: univariate **−0.4pp**; marginal on the MATCHED 200-day OOS
  window **+0.5pp** (61.0%→61.5%), and of the 31 calls it flipped it won 16
  (52% — a coin toss). **REJECTED.** Raw (un-residualised) ICF return shows
  r≈−0.11, but that is just the prior-day reversal shared with `rc_ret_1d`
  — no B3-specific content. ICF file grows daily; retest trigger ~400
  matched OOS days (~mid-2027).
- **`cnl_after_rc` (conilon)** — construction identical vs the RC close.
  B3 exposes no CNL history; the accumulator (brazil_b3_conilon.json)
  started 2026-08 and holds single-digit sessions. Per the evidence rule it
  cannot enter; **retest at ~300 sessions** (~late 2027), zero new
  infrastructure. Same pattern as the Vietnam-physical candidate.
- **Power analysis (2026-08 follow-up)** — "coin flip overall, but does
  STRONG variation predict?" Bucketed by past-only |z| of the residual
  (expanding std): |z|<1 skill −8.6pp; 1≤|z|<2 **+1.7pp** (n=60, n.s.);
  |z|≥2 **27.3% sign accuracy on 22 days** — the strongest B3 moves point
  the WRONG way (reversal shape). The inverted (fade) read hits ~73% but is
  binomial z ≈ 1.3 vs the bucket's own blind baseline after a multi-bucket
  slice — NOT promotable. The honest contrast: a real conditional signal
  shows accuracy rising with strength (the model's own confidence curve
  does: 56.5%→63.6%); B3's curve is non-monotone. **Verdict: strength does
  not rescue the factor; the wrong-way tail is logged as an accumulation
  flag (re-look as a fade candidate at ~40 tail days).** No model change.
- **Harvest seasonality + last-hour pre-hedging (2026-08, owner hypotheses)**
  Window = May–Sep (Brazil arabica main + conilon overlap).
  * **H1 — is the B3 gap worth more in harvest?** Directionally yes, still
    not significant: b3→gap r **+0.13 (t 1.66, n 164)** in harvest vs
    **−0.00** off-season. The sign the hypothesis predicts, but below the
    bar, and the slice was chosen after seeing the full-sample null. B3's
    late window is not even busier in harvest (mean |move| 0.77% vs 0.94%).
    No model change — but this specific CELL is now the retest target as
    ICF accrues, rather than the whole factor.
  * **H2 — last-hour pre-hedging: TREND STARTER, not reversal.** KC's last
    hour (17:30→18:30 Ldn) predicts the next *gap* identically in both
    seasons (it is the model's own feature — no seasonality). But its power
    over the next session's POST-OPEN DRIFT is almost entirely seasonal:
    r **+0.16 (t 3.67)** in harvest vs **+0.03 (t 0.78)** off. On heavy last
    hours (|z|≥1.5) drift continues **69.0%** in harvest (n=71, z 3.2 vs a
    coin flip) vs 56.0% off-season, worth **+0.90%** aligned drift per
    event. Heavy SELLING is the sharper half (75.0% continuation vs 62.9%
    for buying) — the asymmetry a pre-hedging story implies.
    Seasonal contrast itself: z 1.69 (suggestive, not decisive).
    **Verdict: no new feature — this is a DIFFERENT TARGET than the model
    predicts** (gap vs intraday drift), and on the gap the last hour shows
    no seasonality at all. It justifies a separate intraday-drift study,
    and it explains WHY the model runs hot in harvest months: the feature
    it already owns is genuinely more informative then.
  * **London's own last hour is not testable yet** — `rc_last_1630` was
    never stored. Added to the daily refresher 2026-08 (and the fetcher /
    backfill anchor set); the RC-side version of H2 activates at ~120
    harvest sessions.
- **FOLLOW-UP STUDY (2026-08-19): the drift signal on its own horizon.**
  The H2 finding above was recorded, not used, because it lives on a target
  this model does not trade. Tested properly (`intraday_drift.py`, research
  card "The harvest last hour"): a SIGN rule — |z|≥1.5 on the prior KC last
  hour, harvest months only, trade RC open→close drift in that direction,
  nothing fitted — returns **75.9% hit, +1.05% mean drift per event
  (t 4.44), $36.8/t net of costs on n=54**, positive in all five harvest
  seasons; the same rule off-season earns **+0.05% (t 0.20)**. Survives:
  gap control (corr −0.055; residualising the gap out makes it STRONGER,
  +1.16% t 5.05), weekly block bootstrap (95% CI [+0.60, +1.67],
  P(>0)=100%), random-sign placebo (p≈0), and the decisive one — the same
  rule with the feature lagged ONE EXTRA SESSION collapses to −0.16%
  (t −0.59), i.e. the signal is specific to the hour immediately before the
  session it predicts, not generic harvest momentum. It accrues THROUGH the
  session (+0.28% first 15 min vs +0.77% after), so it is not an
  opening-auction artefact; pessimistic entry at 09:15 still yields
  $29.4/t. **Caveat stated in the card: the harvest condition was
  DISCOVERED on this same history, so this is confirmation, not
  out-of-sample.** No model change — different target, different horizon;
  the card is a study, and its forward record accrues from here.
- **Side-finding from the same battery — the factor panel** (now a nightly
  exporter, `open_direction_factors.json`, rendered in the research card):
  rolling-120 lead correlations of all candidates. Two regime facts:
  `kc_after` has roughly TRIPLED in strength (per-year r 0.12 in 2022 →
  0.34 in 2025-26; rolling now ~+0.40), and `rc_ret_1d`'s overnight
  reversal deepened to r −0.42 in 2026 — yet its matched marginal is
  +0.4pp: the reversal is REDUNDANT with kc_after, which the model already
  carries. Correlation strength ≠ marginal value; the panel shows both so
  the distinction stays visible.

## Vietnam physical overnight (candidate 1a) — DATA-STARVED, WAIT
Hypothesis: VN domestic robusta (giacaphe, Dak Lak) moves during Asia hours —
before London opens — so its fresh-morning change should lead the RC open.
Investigated 2026-07: **timing confirmed viable** — the daily scrape (01:07
UTC = 08:07 VN) captures the same-morning price, i.e. the feature is genuinely
knowable pre-open with correct alignment. **But only ~50 days of history
exist** (`origin_prices_history.json` accumulator started 2026-05-14), far
below the ~300 sessions the walk-forward gate needs. Per the evidence rule, it
does NOT enter the model now. Path forward: the accumulator grows daily with
zero new infrastructure — revisit at ~300 rows (~early 2027), or earlier via a
DB backfill if `physical_prices` holds deeper giacaphe history than the
exporter surfaces.

## COT industry × harvest — RE-TESTED ON DEEP DATA (2026-07): REJECTED
The deep backfill (workflow 9.4) banked **613 weekly ICE robusta COT rows
(2014-09 → 2026-06)** in `data/ice_cot_robusta_history.json`. Free robusta
*price* history remains the binding constraint (~2020-10 at best: intraday
17:30 closes + archive fronts + Barchart EOD, merged), so the joined test
sample is 1,454 days / ~7 harvest cycles — two more than the original test,
crucially adding the 2020-10→2021-06 regime.

Result: the purged walk-forward edge FLIPS NEGATIVE — ind_z+harv **−3.8pp**
vs baseline (95% CI [−8.1, +1.0], P(edge>0)=0.065), with 2022 alone at
−15.9pp. The 2×2 directional shape survives qualitatively (heavy-short·harvest
+2.0% fwd-10d vs min-short·harvest −0.3%) but cannot be monetized out of
sample. **Verdict: the earlier +1.5pp was sample luck; do NOT found a
multi-day model on this interaction.** The deep COT file stays banked for
future hypotheses; re-opening this one requires pre-2020 price data (paid or
manual import) AND a materially different formulation.

## COT industry × harvest (original 6y test) — INCONCLUSIVE
Hypothesis: commercial (`pmpu`) positioning conditioned on harvest predicts a
**multi-day** move (min-short during harvest = unsold crop overhang = bearish).

- **Directional pattern is coherent & consistent** (holds on non-overlapping data):
  min-short·harvest = most bearish (fwd-10d −0.1%, 52–57% down); heavy-short·harvest
  = bullish (fwd-10d +2.4%, ~34% down).
- **But it does NOT clear significance.** Naive walk-forward showed +5.6pp; under a
  **10-day purge/embargo** (removing overlapping-return leakage) it deflates to
  **+1.5pp**, and a block-bootstrap gives **95% CI [−3.3, +6.8], P(edge>0)=0.74**.
- **Verdict:** suggestive, not proven on 6 years (~5 harvest cycles). **Next step:
  backfill deeper ICE robusta COT history (~15y)** to get more cycles before
  founding a model on it; treat as experimental/monitored meanwhile.

## Track record / calendar
- Live predictions are logged **append-only** at 03:00 UTC (before the open) and
  resolved after the open — the honest forward record, distinct from the backtest.
- Backtest-seeded history (2022–2026): coverage 79% (abstain band ±0.03),
  hit-rate on acted days **56.5%**.

## Rollout status (2026-07, all stages live)
| Stage | What | Where |
|---|---|---|
| 1 | Append-only prediction log + resolver | `open_direction_log.py`, workflow **1.16** (03:00 UTC Mon–Fri) |
| 2 | Live model swapped to this spec (gap target, proven features, abstain band, exact SHAP) | `open_direction.py`; panel + methodology page updated; DST regression + invariant tests |
| 3 | Intraday-FX snapshots (17:30-London / 03:00-UTC anchors per CCI pair) → activates `cci_overnight` at ≥40 days | `fetch_fx_snapshots.py`, non-blocking step in 1.16 |
| 4 | Telegram brief chains on 1.16 and carries the pre-open RC call | `morning-brief.yml` (cron now the 03:41 fallback), `telegram/handlers/brief.py` |
| 5 | Calendar UI: prediction vs realized open, live vs backtest, stats + table view | `OpenDirectionCalendar.tsx` on the Macro tab |

One prediction → two artifacts: the 03:00 job writes the history row AND
`quant_report.json["open_direction"]` from the same fit, so the panel and the
record can never disagree. `run_quant.py` (21:30) preserves the key untouched.

## Night batch (2026-07-03): brent_overnight — TESTED, then DEMOTED TO A REGIME TAG
Chronology matters here — this is the gate working in real time:
1. Backfilled ~5y of roll-immune Brent overnight anchors (17:30-London →
   03:00-UTC, per-contract, front = max daily volume;
   `data/brent_intraday_anchors.json`, 1,757 days 2019-09 → today; the daily
   1.16 job appends forward).
2. On the TRUNCATED sample (backfill initially ended 2024-10): univariate
   +5.4pp, marginal +1.2pp, sign 100% stable → looked like a keeper.
3. On the COMPLETE sample the marginal collapsed to **+0.11pp** and the
   per-year view exposed it as a **2022-only signal**: Δ+6.1pp in the
   oil-shock year, NEGATIVE marginal in 2023 (−1.4), 2024 (−0.9), 2025
   (−2.5), 2026 (−1.9).
4. Regime-gating (brent active only in high-oil-vol regimes) did not rescue
   it: +0.00pp overall, still −3.1 in 2025.
**Verdict: no model coefficient.** The owner's original framing was the right
product form — Brent matters *during geopolitical stress* — so it ships as a
**regime tag**: `regime.brent_overnight_pct` + `oil_shock` flag (|move| ≥1.5%)
in the payload, panel chip and brief ("🛢 Brent +2.1% overnight — oil-shock
context"). Anchors keep accruing daily; re-evaluate as a coefficient if a
genuine oil-shock regime returns.

## (superseded) initial subsample result — kept for the audit trail
`brent_overnight` = Brent front-month 17:30-London(prev) → 03:00-UTC move,
same anchors as cci_overnight, but reconstructible historically (Brent trades
~24h) via a per-contract Barchart backfill (front = max daily volume, anchors
same-contract → roll-immune; `data/brent_intraday_anchors.json`, ~5y).
Walk-forward verdict: **univariate +5.4pp** (n=700, sign 100% stable, 3/4 yrs),
**marginal +1.2pp** over kc_after+dsr, and exactly the geopolitical
hypothesis: **2022 (oil shock) edge +14.2pp → +20.3pp with brent**. Live model
with brent: wf edge **+5.2pp**, acted accuracy **67.5%** @ 42% coverage
(vs +3.6pp / 63.3% without). Positive sign: brent up overnight ⇒ robusta gaps
up (risk/energy complex tone). Daily forward capture appends new anchors from
the continuous front (backfilled per-contract rows are never overwritten).

Same-night battery — all REJECTED at the gate (marginal vs kc_after+dsr):
vol20 −2.3pp · kc_after×low-vol +0.1 · kc_after×harvest +0.3 · harvest −0.3 ·
days-since-session +0.2 · |kc_after| −1.3. Certified robusta stocks: only ~13
months of history → exploratory windows too small; retest ≥350 days (~2027).
Cecafe daily: current-values only, no committed history — not testable.
Consequence: market situation ships as **regime TAGS** (decision support, not
model inputs): ny_shock (the measured 88% setup), vol regime (confidence
reliable in low-vol only), harvest window. Every factor now also reports its
**z-score** in the payload and the logged factors.

## Owner decision (2026-07): ±10pp "Undefined" band
Calls with |p−50| < 10pp are now **Undefined** (band 0.06 → 0.10). Measured on
the 899-session walk-forward: acted hit-rate **63.6% at 36% coverage** (~1
call per 2.7 sessions), capture +$5.0/t per call vs +$2.1 acting on
everything. Stored direction value remains "Abstain" for record continuity;
all UI surfaces render "Undefined". The seed-regeneration trigger also fires
on band changes so backtest rows relabel consistently (live rows untouched).

## Bearish-call asymmetry (2026-07 analysis) — base rate, not model magic
Raw hit-rates (bear 60.4% vs bull 52.3%) look asymmetric, but robusta gaps
DOWN 55.4% of overnight sessions. Against the correct blind baselines the
skill is roughly symmetric — actually higher on bullish calls:
  bear 60.4% vs blind-bear 55.4% → **+5.0pp skill**
  bull 52.3% vs blind-bull 44.6% → **+7.7pp skill**
Bear-call share varies by month (22%→80%) but tracks each month's own
down-drift (e.g. Oct: 32% up-rate → 74% bear share, 74% bear hit) and each
year's regime (2024: 37% up-rate → bear 68%; 2025: 50% → bear 53%) — i.e.
regime-following via the intercept + drivers, not a calendar anomaly. No
evidence of a flaw; per-month samples (~75) too thin to trade separately.

## Enhancements (2026-07, second wave)
- **Abstain band retuned 0.03 → 0.06** on the real walk-forward probs (sweep
  0.00→0.10, objective: max acted hit-rate s.t. coverage ≥60%): acted accuracy
  56.5% @ 79% coverage → **58.7% @ 60%**. The monotone band→accuracy curve
  (0.10 → 63.5% @ 36%) confirms the probability is informative. Mild selection
  effect acknowledged; the live record is the arbiter.
- **Per-prediction SHAP logging** — every history row (live + regenerated
  backtest seed) stores its per-feature φᵢ, enabling "which feature has been
  earning" analysis on live data later. Live rows are never rewritten.
- **Drift alarm** — the payload carries `track` (live graded n, overall +
  rolling-60 acted hit-rate); the Telegram brief warns "⚠️ cold streak" when
  ≥20 graded live calls run below 50% rolling. The model monitors itself.
- **Magnitude head** — ridge on the same pre-open features predicting the
  SIGNED gap; payload exposes `expected_gap_pct` / `expected_gap_usd_mt`
  (brief: "exp. +16$/t"). Honest OOS read on real data: MAE 0.302% vs 0.308%
  zero-baseline → **skill +0.02** (small); it sizes the call, the classifier
  remains the headline. Both MAEs are published in the model block.
