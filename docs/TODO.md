# TODO / follow-ups

## ECF port stocks — fix the contaminated months, then widen the scatter
`ArrivalsVsStockChange` regresses EU arrivals (1-month lag, rolling 2-month)
against the change in ECF port stocks. It works, but only from **2020-01**,
because 11 of the 151 ECF months are not physically believable and running the
regression across them **inverts** the result:

| window | n | slope | R² |
|---|---|---|---|
| full series (contaminated) | 149 | −0.10 | 0.001 |
| trusted window (2020-01→) | 76 | +0.77 | 0.30 |

The damage is two clusters: 2019 drops from 745,601 MT to ~370,000 for four
months and returns to 807,387; 2014 changes basis mid-year (some rows carry only
`ports` bag counts, some `value_mt`). Aggregate port stocks do not halve and
double, so these are parse artefacts.

- [ ] **Fix `ecf_stocks` parsing backwards.** Establish what the 2019 block and
      the 2014 rows are actually counting — most likely a partial port table or
      a unit switch in the PDF. `sanitiseLevels()` already drops isolated
      spikes; a sustained four-month block at half level is beyond what any
      short-window filter can honestly distinguish from truth, which is why the
      date cutoff exists rather than a cleverer filter.
- [ ] **Then lower `TRUSTED_FROM`** in `frontend/lib/arrivalsVsStocks.ts` and the
      two-period split (`CUT = "2018-10"`) starts working on its own — the
      component already splits when the data reaches back far enough, so no UI
      change is needed.
- [ ] **Open question — measure.** The reference chart plots *exporters'* green
      shipments to Western Europe; we plot *Eurostat extra-EU arrivals*. Same
      flow, opposite reporter. Worth checking whether the mirror explains any of
      the R² gap (theirs 0.54 for 2018-24, ours 0.30 for 2020-26) before reading
      the difference as a genuine change in the relationship.


## Brazil farmer-selling "echo" — tune against live data + dual-crop UI (Step 3)
Backend shipped: Google-News (pt-BR) echo discovery + crop-year-aware dual-crop
parser writing an additive `crops` block to farmer_selling_brazil.json. CI now
collects echo data; the live fetch was not testable in the sandbox.
- [ ] **Tune the regex against real echoes.** Watch the first CI runs'
      `[farmer_selling]` logs / the `crops` block; the `_parse_dual_crop`
      heuristic is calibrated to canonical Safras phrasing and will need
      adjustment for real article variance (and 4-digit `2026/2027` forms).
- [ ] **Step 3 — dual-crop UI.** Once the `crops` shape is stable in prod,
      update `FarmerSellingPanel.tsx` to dual progress bars (current-crop
      commercialization + new-crop advance sales) and formally retire the
      static 83% seed in favour of `data["crops"]`.

## Weather — activate SPI (run the one-shot baseline workflow)
SPI-1/SPI-3 are wired into fetch_origin_weather.py but dormant until the 30-yr
calibration seed exists. The archive host is sandbox-blocked but reachable from
GitHub runners, so the build runs in CI (no local step).
- [ ] **Dispatch `0.3 – One-shot — Build SPI baselines`** (workflow_dispatch,
      blank origins = all). It commits `backend/seed/spi_30yr_baselines.json`;
      the next weather-fetch run then emits `spi_1`/`spi_3`/`spi_month` per
      region. Safe to dry-run first.
- [ ] **VHI** — NOAA STAR weekly Vegetation Health Index, bbox-averaged per
      region into `{origin}_weather.json` (`vhi`/`vhi_week`). Scraper + weekly
      workflow (`0.5`) shipped; parsing/aggregation unit-tested. **Verify on the
      first CI run** that `VHI_URL`/CSV format match NOAA's live product — only
      `fetch_vhi.py`'s fetch/parse layer would need tweaking if not (the bbox
      aggregation is format-agnostic).

## Phase-3 cut — delete the price-regex fallback (target: on/after 2026-06-09)
The exporters strangler is at Phase 2 (dual-read) + a CI gate. The fallback
regex is the safety net; delete it only after production proves the structured
`price_data` path handled exports cleanly for 14 straight days.
- **Readiness criterion:** `frontend/public/data/health.json` never emits
  `latest_prices_used_regex_fallback` for 14 consecutive days (≥ ~5–10 trading
  days, covering a weekend + any contract rollover). Automated by
  `.github/workflows/phase3-readiness-check.yml`, which pings Telegram with a
  GO / NOT-ready verdict from 2026-06-09 onward.
- [ ] **When GO fires, delete:** `_build_tickers_from_news` and `_vn_faq_from_news`
      in `backend/scraper/exporters/prices.py`; the regex branches in
      `extract_physical_price` (`backend/scraper/db.py`) below the
      `price_data` short-circuit. Leave the structured path as the only one.
      The `latest_prices` fallback `if not tickers:` block + the health-flag
      signal + the CI gate can then go too. Unit tests already pin the
      structured path, so the suite flags anything still leaning on the regex.

## Brazil farmer-selling (Safras) — RESOLVED (harvest live; sales scraper correct)
Scraper now discovers via coffee-category RSS (EN + PT), classifies sales vs
harvest, requires a %-in-title (rejects price/estimate/other-crop noise), picks
the most-recent by crop-year + May-start survey month, and is crop-year-aware.
- [x] **Harvest pace LIVE** — `harvest` block committed (77%, 2025/26, as of Jul 16);
      "Harvest pace · Brazil" card renders. Auto-flips to 2026/27 when Safras posts a
      %-harvest article for the new crop.
- [x] **Sales scraper correct** — only true surveys are Jul-25 (31%) + Feb-25 (88%);
      newest (31%) is guard-skipped vs the seed, no noise selected. Will advance on
      the next EN/PT commercialization survey with a % headline.
- [ ] **Product decision (open):** the displayed 83%/77% is an unsourced seed (newer
      than any sourced article). Keep it, or reset to the latest sourced figure so the
      panel is fully scraper-driven? Harvest=77% (Jul-2025) is also last-crop until a
      2026/27 %-harvest article appears.

## CI — sliced 1.4 export (commit 75398fb) — mechanism VERIFIED in production
The "1.4 – Export and Publish" workflow exports only the topic slice tied to each
trigger and gates `npm ci` + signals to COT-relevant runs.

- [x] **News slice CONFIRMED.** Commit `4cac0f0` (1.4 run, 2026-05-25 09:32)
      touched exactly `news.json`, `latest_prices.json`, `vn_physical_prices.json`
      + `health.json` (always-on) and **no `signals.json`** — i.e. it sliced to the
      news topics, skipped the other ~18, and kept the npm/signals gate off. Proves
      the scope-decision, `--only` filter, health-always-runs, and signals-gating.
- [ ] **COT slice** — confirm on the next 2.3 run: commits only
      `cot.json`/`cot_recent.json`/`macro_cot.json`/`oi_fnd_chart.json` (+ `signals.json`).
      (Same mechanism as the verified news path, different topic list.)
- [x] **Daily-OI slice CONFIRMED.** Commit `086c803` (1.4 fired by a manual 1.3,
      2026-05-25 11:16) touched only `latest_prices.json` + `health.json`
      (`futures_chain`/`oi_fnd_chart` re-exported but unchanged) — no `signals.json`,
      none of the other ~18 topics. Scoping + npm/signals gating confirmed.
- [x] **Full export — CONFIRMED.** Commit `5770cdb` (full dispatch) wrote 14 files incl. `signals.json`,
      `farmer_economics`, `demand_stocks` + all supply files (not the 4-file news slice).
- Safety net: the nightly cron runs a full export, so a missed file self-heals.

## Weather — backend follow-ups (frontend rendering fixed in WeatherCharts)
Frontend now renders missing months as gaps (not 0) and shows per-region crop
share in the filter. Remaining items are in the data pipeline:

- [x] **Vietnam weather stale — DONE & verified.** `vn` added to the daily
      pipeline; `vn_weather.json` now `updated=2026-05-25` with a `weather_history/vn.json`
      created. Refreshes daily; freshness blind spot resolved.
- [x] **Backfill Jan/early-Feb 2026 — DONE & verified.** Archive reachable from
      CI; after the region-resilience + fill-null-fields + merge-upsert fixes, the
      re-run filled all 7 origins with complete Jan–May rain AND temperature (no
      gaps). Daily accumulation preserves it going forward.
- [x] **Temp gap for Jimma/Copán — DONE & verified.** The 0.4 re-run with the
      `(tmax+tmin)/2` fallback filled them; all 7 origins now have complete
      Jan–May temperatures (no nulls).
- [x] **Monthly Rainfall current-month now projected to month-end** (weighted,
      same basis as the cumulative chart) so the partial month is comparable to the
      full-month climatology — fixes the "VN 112.5 vs daily 129.9" confusion. The
      residual weighted-vs-Dak-Lak-station difference is by design (daily chart is
      single-station).
- [x] **Production-at-risk readout** added — surfaces the % of selected production
      whose projected current-month rainfall is in its drought-risk zone, naming the
      regions (counters weighted-average masking). Frontend-only, live.
- [x] **Daily Accumulated chart prod-weighted — DONE & verified.** After the 0.4
      run, all 7 origins have populated per-province `daily_accum_cur` (through
      day 25), so the daily chart now weights across selected regions and responds
      to the filter. `daily_accum_ly` is empty (no 2025 daily history) → last-year
      line uses the climatology fallback, as designed.
- [ ] **Honduras May rainfall deficit — monitor (not a bug).** Already surfaced by
      the production-at-risk readout (Honduras flags ~72% of production below
      drought-risk rainfall). Re-check once May is complete to see if late rains
      narrowed the gap (the figure is month-to-date).
