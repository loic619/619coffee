# Open-direction model — full audit, 2026-08-21

Commissioned after a run of pipeline failures made the model's output hard to
trust. The question was not "is the edge big" but **"is anything it reports
actually true"**. Everything below is measured against the shipped data and
the git record; where a claim could not be verified it is labelled as such.

**Verdict: the model itself is sound. The pipeline around it was not, and one
widely-repeated incident report was wrong.**

---

## 0. A correction, first

Several places in this repo (this doc included), plus PR #720's description,
stated that the model **went dark for three weeks from 2026-07-29** and served
a frozen prediction. **That never happened.**

Git history of `frontend/public/data/quant_report.json` across the window:

| date | available | for_session | n_train | active_features |
|---|---|---|---|---|
| 2026-08-07 | true | 2026-08-07 | 1,159 | kc_after_rc_diff, days_since_roll |
| 2026-08-10 | true | 2026-08-10 | 1,160 | kc_after_rc_diff, days_since_roll |
| … every trading day … | true | advancing | +1/day | unchanged |
| 2026-08-20 | true | 2026-08-20 | 1,168 | kc_after_rc_diff, days_since_roll |

`open_direction_history.json` agrees: live predictions with distinct `p_up`
values on 2026-07-30, 07-31, 08-04 … 08-19. The outage was **inferred from
reading the code path and never checked against the record.**

The bug fixed in #719 is real — a thin optional feature *would* truncate the
training set — but it is a latent bug, not an incident. See §4 for why it
never fired, which is its own finding.

---

## 1. Live track record vs the backtest claim

The acid test: does the model score live what it claims in backtest?

| | acted accuracy | n |
|---|---|---|
| backtest (walk-forward OOS) | 63.58% | 346 |
| **live, graded** | **77.8%** | **18** |

Live is *better*, but n = 18 — the 95% interval is roughly 52–94%, so this is
consistent with the backtest and with almost anything else. **It is not yet
evidence of anything.** Two details that make it honest rather than flattering:

- On the 18 acted sessions the majority-class baseline was 61.1%, so the model
  beat its own sample's base rate (77.8% vs 61.1%), not just a coin.
- 14 of 33 live calls were Abstain — the band is doing real work, not being
  quietly bypassed to inflate the record.

**Verdict: consistent, far too small to conclude. Revisit at n ≥ 100.**

---

## 2. Is the edge real, or a harness artifact?

**Placebo test** — shuffle the labels, re-run the entire walk-forward, 40 draws:

```
REAL      edge = +0.0448
PLACEBO   edge = -0.0058 ± 0.0079   (max +0.0087)
          real edge sits +6.4 sd above the placebo distribution
          placebo draws beating the real edge: 0/40
```

A leaking harness scores well on shuffled labels. This one does not.
**Verdict: the edge is real, and the evaluation harness is not leaking.**

---

## 3. Look-ahead

The decisive test is lagging the information-carrying feature by one session.
Genuine overnight information must die; drift or leakage would survive.

| spec | edge |
|---|---|
| `kc_after_rc_diff` alone | **+0.0295** |
| `kc_after_rc_diff` alone, **lagged one session** | **−0.0109** |
| `days_since_roll` alone | +0.0251 |
| `days_since_roll` alone, lagged | +0.0295 |

`kc_after_rc_diff` collapses to *negative* edge when staled — correct.
`days_since_roll` is lag-invariant because it is a deterministic counter, so
the lag test says nothing about it either way (an early version of this audit
misread that as suspicious; it is not).

Structural checks also pass: features for session *t* are built from session
*t−1* fields, roll days are unlabelled, and the target is `rc_open_first`
against the **prior** `rc_last_1730`. Pinned by
`test_no_lookahead_alignment` and `test_roll_days_unlabelled`.

**Verdict: no look-ahead.**

---

## 4. `days_since_roll` — a calendar counter carrying half the edge

Worth scrutiny: over half the headline edge comes from a feature with no
market content. Split-half suggested it had died (H1 +0.1146, H2 +0.0000),
but split-half retrains on 384 rows and is far weaker than the production
estimator. The authoritative comparison is **matched OOS dates**:

| window | `kc_after` only | live spec (`+dsr`) | dsr contributes |
|---|---|---|---|
| all OOS (n=916) | +0.0295 | **+0.0448** | +0.0153 |
| last 500 | +0.0200 | **+0.0380** | +0.0180 |
| last 250 | +0.0280 | **+0.0640** | +0.0360 |

It earns its place on accuracy, recently included. **But there is a real
trade-off the panel does not surface:**

| window | `kc_after` only | live spec |
|---|---|---|
| acted accuracy, all OOS | **65.2%** on 276 | 63.6% on 346 |
| acted accuracy, last 250 | **66.3%** on 83 | 61.3% on 106 |

Adding `days_since_roll` makes the model **act more often at lower
precision**. Net correct-calls-above-coin is near-identical between the two.
Which you want depends on whether you value coverage or hit-rate — that is a
product decision, not a bug, and it is currently made implicitly.

**Verdict: legitimate, but the coverage/precision trade-off should be an
explicit choice.**

---

## 5. Data integrity

`intraday_kc_rc_15min.json` (1,510 rows, 2020-10-06 → 2026-08-19):

- 0 duplicate dates, correctly sorted.
- Longest run of identical consecutive values: **2** on every price field — no
  carried-forward scraper output.
- 4 missing weekdays since 2025-08-01, all exchange holidays (2025-12-25,
  2026-01-01, 2026-04-03, 2026-05-25).
- Field gaps: `kc_last_1830` missing 15.8%, `kc_last_1730` 9.1%. These are
  handled by listwise deletion — 1,270 of 1,510 rows carry the feature.

**Verdict: clean.**

---

## 6. Payload integrity

A fresh model run reproduces the served payload **bit-for-bit** — `prob_up`,
both margins, `n_train`, `edge`, `acted_accuracy`, `acted_n`,
`abstain_rate`, `active_features`, all identical to the last digit. SHAP
additivity residual **exactly 0.0**.

**Verdict: what the Macro tab shows is what the model computed.**

---

## 7. The real problem — the silent-failure surface

This is where the trust was actually lost, and every item is a case of
something being *invisibly* off rather than wrong.

| finding | status |
|---|---|
| **`cci_overnight` dead in production since it shipped.** `_cci_overnight_series` imports `fetch_currency_index` → `requests`, which the 1.16 runner does not install (`pip install numpy pandas playwright`). The column never reached the frame. Locally — where `requests` exists — it looked healthy, so the watchdog counted progress toward a gate the live model could never reach. | **found here** |
| **`intraday_kc_rc_15min.json` watched by nothing.** The model's only real input — target *and* sole market feature — had no ARTIFACTS entry and no `health.json` scraper key. | fixed: 5-day watch |
| Brent anchors frozen 49 days; `oil_shock` silently false. | fixed #724 |
| B3 at-KC-close capture had never once fired (cron drift vs a 24-min guard). | fixed earlier |
| Watchdog reported `314/252 MATURE` while the model correctly refused at 207. | fixed #723 |
| Watchdog's b3 threshold was the pre-#719 bar (40 vs the real 252). | fixed #724 |
| Frozen panel payload was indistinguishable from a live one. | fixed #720 |

### The pattern

Every one of these is the same shape: **a component reported a state adjacent
to its true one, and nothing compared the two.** A feature that is absent
looked like a feature that is accruing. A capture that never fired looked like
one patiently waiting. A counter measuring usable days looked like one
measuring trainable rows.

The fix applied here is `model.feature_status` in the payload — every optional
feature now reports `active` / `accruing` / `held` / **`absent`** with its
reason, so "the dependency is missing" can never again read as "be patient".
Under production dependencies it now says, out loud:

```
cci_overnight   absent   series unavailable — the builder returned nothing
                         (missing dependency or unreadable source),
                         NOT a data-accrual wait
```

---

## 8. What is NOT verified

Stated plainly, because an audit that implies more coverage than it has is
worse than none:

- **Upstream price truth.** Everything reconciles internally, but no
  independent source was cross-checked against Barchart's 15-min bars. If
  Barchart is wrong, this audit would not know.
- **Why `CB*1` stopped returning Brent bars.** The sandbox proxy blocks
  Barchart; the fallback in #724 makes the fix independent of the cause, but
  the cause is still unknown.
- **The live record.** n = 18. Everything in §1 is provisional.
- **Regime tags** (`ny_shock` 88% hit-rate, `vol_regime`) were not re-derived
  here. They are decision support, not model inputs, but their numbers were
  taken on trust.

---

## 9. Recommendations

1. **Decide `cci_overnight`'s fate now, not at 252.** It graded null on the
   best sample obtainable (corr +0.052, sign rule 50.2% vs a 53.1% baseline,
   zero walk-forward marginal). As written it will auto-activate on reaching
   252 trainable rows. Retiring it explicitly is cleaner than relying on a
   future re-grade.
2. **Make the coverage/precision trade-off in §4 explicit** — pick whether the
   panel optimises acted hit-rate or number of calls.
3. **Fix or drop the `requests` dependency** in `_cci_overnight_series`. If
   `cci_overnight` is retired, drop the import path entirely.
4. **Re-audit the live record at n ≥ 100** (~5 months at the current abstain
   rate). That is the only number that will settle §1.
