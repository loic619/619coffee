# GitHub Actions — open issues log

**Repo:** `loic619/619coffee` · **Opened:** 2026-09-01 · **Last reviewed:** 2026-09-02 (queue view added)
**Evidence window:** 2026-08-25 → 2026-09-01 · audited 2026-09-02 (`frontend/public/data/workflow_activity.json`)

> **How this file works.** Two Claude Code **Routines** keep it current — they
> run on Anthropic's cloud, not in this repo, so there is no workflow here to
> look for. **619coffee — Actions health watch** (daily 13:30 Asia/Saigon) reviews
> what the Actions actually did, ticks off what it can verify, appends new
> findings, updates the *Last reviewed* date, and commits the result to `main`.
> So we never re-derive the same problem twice.
>
> **Status key:** `[ ]` open · `[~]` partly fixed, root cause still open · `[x]` done · `[?]` watch, not yet a problem
>
> Priority is **P1** (silently loses or corrupts data) · **P2** (weakens a safety net) · **P3** (housekeeping).
>
> **This file is also a work queue.** The second routine, **619coffee — Actions
> fix queue** (weekdays 14:30 Asia/Saigon), takes the highest-priority open item,
> fixes it on a branch, ticks the box in the same commit, and opens one pull
> request labelled `auto-fix`. It will not start another until that PR is closed
> or merged — your review sets the pace. Items marked ***(human-only)*** are
> skipped: they need repo settings or a decision from you, which no agent should
> make on your behalf.

---

## Next up

*Rebuilt by the watch routine on every run — if this disagrees with the tables below, the tables win.*

| | Issue | Why it's next |
|---|-------|---------------|
| **In flight** | — | No `auto-fix` PR open. |
| **1st** | **B1** · P1 | Repair CONAB / MDIC Comex detection. Highest-priority item the agent is allowed to touch. |
| **2nd** | **A2** · P2 | Pin ruff. |
| **3rd** | **B2** · P2 | Let the sentinel dispatch its own scraper. |
| **4th** | **C2** · P2 | Count the rescue dispatches. |
| then | **D1 · D2 · D3** · P3 | Housekeeping. |

**Waiting on you — the agent will never take these:** **A1** (branch protection; still the highest-value item in this file) · **C1** (pick a polling strategy).

**Not in the queue:** A3, A4, B4, C3 closed · B3 watching.

---

## A. CI gates — the checks that are supposed to stop bad code

| ID | Status | What it means for you (plain language) | Cause | Proposed fix |
|----|--------|----------------------------------------|-------|--------------|
| **A1** | `[ ]` **P1** *(human-only)* | Your gates go red and **nothing stops**. This has now happened twice in one week. Backend Lint was red for three days while **39 pull requests merged** over it (A3); the smart-quote guard was red for five days while **48 merged** (A4). Both went green again by accident, inside PRs aimed at something else. The checks are smoke alarms with no one in the building. | The workflows run on every PR, but they are not **required status checks** in branch protection on `main`. A red result is just a red icon — GitHub still lets the merge through. | In GitHub → Settings → Branches → `main`, mark **9.1 CI Tests**, **9.2 Backend Lint** and **9.3 Smart-quote guard** as required checks. Five minutes, no code. This is the single highest-value item in this file: A3 and A4 are both symptoms of it. |
| **A2** | `[ ]` **P2** | A tool you don't control can turn your build red overnight, for reasons you never chose. | `lint-backend.yml` runs `pip install --quiet ruff` with **no version pin**. Ruff ships new rules frequently; the next release can start flagging code that was fine yesterday. | Pin it: `pip install ruff==0.15.11`, and bump the version deliberately when you want the new rules. |
| **A3** | `[x]` **P1** | *(Resolved 30 Aug)* Backend Lint failed 63 of 127 runs — not flaky, genuinely broken. | A single unsorted import block (`I001`) in `backend/scraper/probe_port_ids.py`, red on `main` from `bd481087` (27 Aug, #772) through `32862bb6` (29 Aug, #802). Every push run **and** every PR run failed on that one line, and 39 PRs merged over it. **On the introducing commit:** #799's message and a review both attribute it to #778, but the file was *created* by #772 (`git log --diff-filter=A`) already carrying `PORTS, _get, _START_YEAR`, and full-repo ruff flips PASS→FAIL[I001] exactly across `bd481087^ → bd481087`. #778 later reshaped that same line (adding `_HEADERS`); it did not introduce the violation. | Fixed incidentally in `ec1bc457` (#799, 30 Aug) — a one-line reorder folded into an unrelated PR. Closed. A1 is what stops it recurring. |

| **A4** | `[x]` **P1** | *(Resolved 31 Aug — corrected 2 Sep)* The smart-quote guard's 20 failures were **not** the guard doing its job on bad branches. A smart quote was sitting on `main` itself for five days, so the guard went red on innocent branches whose diffs never touched the file. **This is a second instance of A1**, not a non-event. | A typographic quote in `frontend/components/supply/SupplySDTab.tsx` landed with `1afb2660` (#763, 26 Aug) and stayed until `a98835ec` (#803, 31 Aug). Verified by scanning `main` at each commit across the window. | Fixed in #803. Closed. Verify with `git log -S'“' -- frontend/components/supply/SupplySDTab.tsx`. |

**Correction, 2 Sep.** The first version of this file asserted the opposite — that `main` stayed clean and the guard was working as designed, so "don't chase it." That was wrong, and it was wrong for a mechanical reason worth recording: the check used `grep -P '[\x{2018}...]'`, which **errors out** in this environment rather than matching, and the surrounding loop read a non-zero exit as "no hits". Every "clean" it reported was a false negative from a broken detector. Two lessons, both now standing rules for the watch routine: **positive-control any detector before trusting a negative result**, and treat "no action needed" rows as claims to verify, not conclusions — the errors in this file have lived in the dismissals, not the alarms.

---

## B. Source detection — how new monthly data gets noticed

| ID | Status | What it means for you (plain language) | Cause | Proposed fix |
|----|--------|----------------------------------------|-------|--------------|
| **B1** | `[~]` **P1** | Three Brazilian data feeds — **CONAB costs, CONAB safra, and MDIC Comex fertilizer** — silently went **48 days out of date**. Your dashboard was showing July numbers well into late August. The alarm did fire (that's issue B4 below), but an alarm can't fetch data, and nothing acted on it for five days. | `1.17 – Source Sentinel` is supposed to watch these sources and trigger the scraper on publication day. For `conab` and `comex` its detection has **never once fired**: `data/source_sentinels.json` shows `last_found: null`, `signal: null`, still stuck on `confirmed: "2026-07"`. The probe patterns for those two sources are broken. Six other sources (cecafe, dane, ecf, fnc, ucda, vn_customs) detect fine. | **Partly done:** safety-net crons were restored on 30 Aug (12th + 20th of each month) and the data was manually refreshed. **Still open:** fix the two broken probe patterns in `backend/scripts/source_sentinel.py`, or accept detection is dead for these sources and rely on the crons — but then say so in the file, so it stops looking like a bug. |
| **B2** | `[ ]` **P2** | When the sentinel *does* notice something is overdue, it writes a message asking a human to go and run the scraper by hand. That human is you, and it went unread for five days. | The sentinel raised `overdue_alerted` and `blind_alerted` for August and posted *"still undetected 21d past its window — the probe pattern may be broken; run the scraper manually"*. It has no path to actually dispatch the scraper itself. | Give the sentinel the same self-heal path `1.8` already uses: when a source is N days overdue, dispatch its scraper workflow directly instead of asking. The comment in `scraper-monthly-conab.yml` says it best — *"That instruction should not need a human."* |
| **B3** | `[?]` **P3** | Two Vietnam customs sources look half-detected — probably fine, worth one glance. | `vn_customs` and `vn_customs_dest` have a `signal` URL and `confirmed: "2026-08"` but `last_found: null`. Either by design or a stamping gap. | Confirm which. If by design, no action. |
| **B4** | `[x]` **P2** | *(Working correctly)* `1.5 – Check Data Pipeline Freshness` failed 6 of 7 runs. | Not broken — **that workflow's job is to fail when data is stale.** I replayed it against each day's `health.json`: it fired 26–30 Aug on exactly the three B1 feeds, crossing their 45-day limit, and went green again on 31 Aug once they were refreshed. | No action. This one earned its keep. Treat its failures as messages, not incidents. |

---

## C. Scheduling reliability — whether crons actually fire

| ID | Status | What it means for you (plain language) | Cause | Proposed fix |
|----|--------|----------------------------------------|-------|--------------|
| **C1** | `[ ]` **P1** *(human-only — pick an option first)* | Your live-quote poller is scheduled to run ~360 times a week. It actually got **45 scheduled runs — about 12%**. The feed only stayed alive because a rescue mechanism fired **241 emergency runs** to cover the gap. It works, but you are running on the backup generator full-time and the main power has been out for weeks. | GitHub Actions silently throttles high-frequency crons on this repo (documented twice before in `poll-acaphe-quotes.yml`: June and August). The `1.8` freshness checker compensates by dispatching the poller whenever quotes go stale. | Two options, pick one: **(a)** accept the rescue path as the primary mechanism and rewrite the cron down to a low, reliable heartbeat — stop pretending the 15-minute schedule works; **(b)** move the polling loop to a single long-running job (one run that sleeps and polls) instead of many short cron ticks, which GitHub throttles far less. Either way, the current setup hides its own failure. |
| **C2** | `[ ]` **P2** | That rescue mechanism is a single point of failure holding up your most time-sensitive feed, and if it breaks the failure is silent. | `check-live-quotes.yml` self-heals by calling the GitHub API (`actions/workflows/poll-acaphe-quotes.yml/dispatches`), which needs `actions:write`. If the token, permission or API call breaks, the poller drops to its real ~12% cron rate and nothing announces it. | Add a cheap tripwire: alert if scheduled-run count over 24h falls below a floor, or if `1.8` issues more than N rescues in a day. Right now nobody is counting the rescues. |
| **C3** | `[x]` **P3** | *(Closed 2 Sep — solved by rescheduling, not by code.)* The daily review used to read a run-record file that was ~19 hours old, so it could not see the previous afternoon. It now reads one that is twenty minutes old. | The 08:00 Cowork debrief this row was written for no longer exists. Its replacement, the **Actions health watch** routine, runs at 13:30 Asia/Saigon = 06:20 UTC — *after* workflow 0.17 rebuilds `workflow_activity.json` at 06:10 UTC. | No action. The proposed `00:40 UTC` cron on `build-workflow-activity.yml` is **not** needed; do not add it. |

---

## D. Housekeeping — workflows that no longer earn their keep

| ID | Status | What it means for you (plain language) | Cause | Proposed fix |
|----|--------|----------------------------------------|-------|--------------|
| **D1** | `[ ]` **P3** | 97 workflow files, 66 ran this week. Most of the other 31 are legitimately idle (monthly, annual, weekly) — but roughly a dozen are finished one-shot tools that will never run again and just add noise every time you scan the list. | `backfill-*` migrations (b3-conilon, cepea-conilon, conilon-vitoria, enso-thermocline, fx-snapshots, missing-fields, options-history, sentiment, brent-intraday) and `seed-options-oi.yml` were all one-time jobs that have completed. | Move the spent ones to `.github/workflows/_archive/` (GitHub ignores subdirectories), or delete them — git keeps the history either way. Do this once, not repeatedly. |
| **D2** | `[ ]` **P3** | Three near-identical FBX diagnostic probes sit alongside each other; two are superseded. | `0.27 probe-fbx-lanes`, `0.28 probe-fbx-history`, `0.29 probe-fbx-history2` — the second pass exists because the first left holes, and both are now answered by the shipped feature (#809). | Archive `probe-fbx-history` and `probe-fbx-history2`; keep whichever documents the final answer. |
| **D3** | `[ ]` **P3** | One workflow is currently sitting red in your Actions tab for no reason anyone is tracking. | `Z – Backfill: per-contract prices to 10y (manual)` — `backfill-contract-prices.yml`, last run 27 Aug, **ended in failure**. It's a manual tool, so nothing depends on it, but it's the only red thing on the board. | Either fix it or archive it, so "red on the board" means something again. |

---

## E. Watch list — not yet a problem, will become one

| ID | Status | What it means for you (plain language) | Detail | When it bites |
|----|--------|----------------------------------------|--------|---------------|
| **E1** | `[?]` | The two ICE monthly reports (arabica ageing, robusta age allowance) are 32 days old against a 38-day limit, and the catch window that fetches them is **open right now**. | `scraper-ice-monthly-reports.yml` fires 14:00 UTC on the 1st–3rd (then 5th, 8th, 11th as retries). Last data: 2026-07-31. August's capture already missed once — that's why the retry crons exist. | Alarm ~6 Sep if this week's window misses. **Check today's 14:00 UTC run.** |
| **E2** | `[?]` | The Japan AJCA feed is 62 days old against a 70-day limit. | Upload-dated source; the limit already accounts for AJCA's long lag, so this may resolve on its own. | Alarm ~9 Sep. |
| **E3** | `[?]` | `1.13 – ICE Certified Stocks` runs and succeeds several times a day, but its data date hasn't moved past 28 Aug. | Probably benign — ICE publishes T-1 and the runs land before the daily publish, so Friday's date is expected to persist over a weekend. Worth one confirmation that Tuesday's run picks up Monday's data. | Alarm ~3 Sep if the date genuinely isn't advancing. |

---

## Suggested order of work

The agent works the **Next up** queue at the top on its own. This section is what *you* do, and it is short by design.

1. **A1** — five minutes in repo settings. It prevents the whole class of problem in section A, and it matters more now that something other than you opens pull requests: without required checks, a red check on an agent's PR is only a red icon.
2. **C1** — pick (a) or (b). The agent is blocked on this and will stay blocked until you choose.

Everything else is queued. Your job on those is to read one pull request at a time and merge or reject it.
