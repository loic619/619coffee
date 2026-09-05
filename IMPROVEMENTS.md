# Improvement backlog

**Repo:** `loic619/619coffee` · **Opened:** 2026-09-02

> **What this is.** An idea bank, filled by the **619coffee — Improvement focus** routine,
> which runs twice a day and each time studies **one** part of the app in depth. Every
> session must leave exactly one concrete, evidenced proposal here. Shipping is not its
> job: the **619coffee — Actions fix queue** routine drains this list one pull request at
> a time, after it has cleared any open failure work in `ACTIONS_ISSUES.md`.
>
> More goes in than comes out, and that is the design. This is a ranked list to pick
> from, not a to-do list to finish. Prune it whenever you like — deleting a row is a
> legitimate answer.
>
> **Health problems do not belong here.** Anything broken goes in `ACTIONS_ISSUES.md`.
> This file is only for things that work but could be better.

---

## The rota

**One run a day, at 09:00 Asia/Saigon**, alternating between that weekday's two topics.
It used to run twice a day; that was halved on 2026-09-03 after the account hit its monthly
spend limit and a session was refused outright. A slot that doesn't run is worth nothing, so
the cadence now fits the budget.

So each weekday still has an **AM** and a **PM** topic below, but they are covered on
alternating weeks: Monday week 1 takes Futures, Monday week 2 takes Daily Brief, and so on.
Every topic comes round once a fortnight. **Which one is due is in the Rotation state block —
read it, don't guess from the clock.**

| Day | AM | PM |
|-----|----|----|
| **Monday** | Futures tab | Daily Brief tab |
| **Tuesday** | Supply — next sub-tab in the cycle | Supply — the one after it |
| **Wednesday** | Demand — consumption | Macro tab |
| **Thursday** | Freight tab | COT tab |
| **Friday** | Map tab | UX (cross-cutting: any tab) |
| **Saturday** | Data Map — next topic in the cycle | Workflow efficiency: what worked, what can be improved |
| **Sunday** | Research: propose a new paper / question | Research: improve the oldest existing piece |

### Rotation state — update this every time you use it

**AM/PM alternation** (which half of today's row to take):

| Day | Last taken | Take next |
|-----|-----------|-----------|
| Monday | — | **AM** (Futures) |
| Tuesday | — | **AM** (Supply, first sub-tab) |
| Wednesday | — | **AM** (Demand — consumption) |
| Thursday | AM (Freight) — 2026-09-04 | **PM** (COT) |
| Friday | AM (Map) — 2026-09-04 | **PM** (UX, cross-cutting) |
| Saturday | AM (Data Map — workflow) — 2026-09-05 | **PM** (Workflow efficiency) |
| Sunday | — | **AM** (Research — new idea) |

After a run, set that day's "Last taken" to what you took and flip "Take next" to the other half.


**Supply sub-tabs** (Tuesday, one per fortnight now, in page order).
There are **eleven** — the authoritative list is `TABS` in `frontend/app/supply/page.tsx`:
`Brazil → Vietnam → Colombia → Indonesia → Ethiopia → Honduras → Uganda → Total → S&D → ENSO → Fertilizers →` back to Brazil.
(Origins first, ordered by export volume, then the cross-cutting views — the order `ORIGINS` + `CROSS` declare.)

- **Next up:** Brazil
- **Last covered:** — (cycle not yet started)

**Data Map topics** (Saturday AM, one per week, in order):
`workflow → data → UX → security →` back to workflow.

- **Next up:** data
- **Last covered:** workflow — 2026-09-05 (IMP-003)

**Research** (Sunday):
- **Newest piece:** — · **Oldest not yet revisited:** — (Sunday PM picks this one)

---

## Backlog

Ranked within each tab, best first. `[ ]` open · `[~]` partly done · `[x]` shipped · `[-]` dropped.

**Effort** is a rough read for the fixer: **S** ≈ one file, **M** ≈ a few files, **L** ≈ needs a decision from Loic first.

| ID | Status | Tab | The improvement, in plain language | Evidence it's worth doing | Where | Effort |
|----|--------|-----|-------------------------------------|---------------------------|-------|--------|
| IMP-002 | [ ] | Freight | The freight chart draws four lines, and three of them are the same line. "VN → EU", "BR → EU" and "ET → EU" are all one Freightos index — FBX11, Asia → North Europe — multiplied by 1.00, 0.58 and 0.70. They cannot ever disagree: when rates jumped in June, all three moved **+37.6%** on the same day, because they are one number drawn at three heights. A reader watching three corridors spike together reads it as three markets confirming each other; it is one market. Only "VN → US" is a genuinely separate index. The table underneath does mark these lanes `~est.`, but the chart says nothing — same lanes, honest in the table, silent in the picture. Fix: draw the estimated lines dashed, put `~est.` in the chart legend, and say in the caption what each one is scaled from. The estimate itself is fine and should stay — it just needs to look like an estimate. | `freight.json` (updated 2026-09-04), `routes[].basis`: `br-eu` = FBX11 × 0.58, `co-eu` = × 0.55, `et-eu` = × 0.70, `vn-ham` = × 1.02; `br-us` = FBX03 × 0.45; only `vn-eu` (FBX11 × 1.0) and `vn-us` (FBX01 × 1.0) are unscaled. Checked against the stored series, not just the config: across **all 106 history rows** each of `br-eu`, `co-eu`, `et-eu`, `vn-ham` is an exact constant multiple of `vn-eu`, ratios varying only by integer rounding (`br-eu`/`vn-eu` ∈ {0.5798…0.5802}). The June step: 2026-06-04 → 06-06 `vn-eu` 2970→4087 (+37.6%), `br-eu` 1722→2371 (+37.7%), `et-eu` 2079→2861 (+37.6%) — vs `vn-us` +51.3%, the one line carrying its own information. `CHART_LINES` (`FreightCharts.tsx:14-19`) plots vn-eu / br-eu / vn-us / et-eu, i.e. **3 of 4 plotted lines are FBX11**, and the legend prints plain lane names with no estimate marker. This is not a sourcing gap to be fixed later: `probe_fbx_lanes.py:1-31` asked whether a real South-America→Europe or Africa→Europe lane exists, and per `ACTIONS_ISSUES.md` D2 it was answered by the shipped FBX tradelane table — none of the 13 published indices covers a coffee corridor. So the scaling is permanent and labelling it is the final fix, not a stopgap. Note the JSON already carries `basis` and `prev_date` on every route and the frontend type (`FreightClient.tsx:29-37`) declares neither, so both are dropped on the floor today. | `frontend/app/freight/FreightCharts.tsx` — `FreightHistoryChart` (lines 21-87): take an extra prop (e.g. `routes` or a `Record<key, {proxy, basis}>`), give proxy lanes `strokeDasharray="4 3"`, and extend the existing `Legend formatter` at line 78 to append `~est.` — the label map is already there. Add a one-line caption under the chart naming the basis (`BR → EU ≈ FBX11 × 0.58`). `frontend/app/freight/FreightClient.tsx` — add `basis` + `prev_date` to the `FreightRoute` type (lines 29-37) and pass `routes={data.routes}` at line 370. Worth showing the same basis in the corridor table's `~est.` tooltip (line 408) while in there. Out of scope: the corridor table's `Chg` column reads `+0` in green for 6 of 7 routes today because FBX11 was flat 08-28 → 09-04 — that is real, not a bug. Also leave `Step6`-style rank scatters and the FBX index table alone. | M |
| IMP-001 | [ ] | Map | The threat bar across the top of the map overstates how bad things are. Ethiopia's chip today says "3 critical" — but only 1 of those 3 is critical; the other 2 are one notch down. The chip is pairing the country's *total* alert count with its *worst* severity word, so a country with 1 critical and 20 mild watches would read "21 critical". Show the count and the severity separately — e.g. "3 alerts · worst critical", or a small breakdown "1 critical · 2 alert" — so the number means what it says. | `agronomic_alerts.json` (generated_at `2026-09-03T06:38Z`) has `summary.by_severity = {alert: 3, watch: 4, critical: 2}` across 9 alerts. Ethiopia's own mix is `{critical: 1, alert: 2}`, Uganda's is `{critical: 1}` — yet the chips render "3 critical" and "1 critical", making Ethiopia look 3× the threat it is and indistinguishable in kind from Uganda's single genuine critical. The rollup at `AgronomicTicker.tsx:112-118` computes `count` (all alerts) and `worst` (max severity) as independent fields, then line 161 prints them adjacent: `<span>{r.count} {r.worst}</span>`. | `frontend/components/map/AgronomicTicker.tsx` — line 161 (chip label); optionally carry a per-severity tally out of the `rollups` memo at lines 100-120. Chip background colour by `worst` is correct and should stay. | S |
| IMP-003 | [ ] | Data Map | The "Silent" alarm on the workflow panel — the one thing on that page meant to catch a scheduled job that has quietly stopped running — is currently wrong about every workflow it names. It lists 11 jobs as "no runs", and all 11 are healthy: they are monthly, quarterly or annual jobs (UN Comtrade imports fires on the 15th, USITC on the 16th, Eurostat on the 17th, the German coffee-tax scraper on the 24th, roaster results four times a year) and the panel only looks back 7 days, so of course they did not run. Nothing is broken; the alarm simply cannot tell "did not run" from "was not due". The real cost is not the noise: a genuinely dead daily scraper would appear as a 12th amber card in a list of 11 harmless ones, and nobody would pick it out. Fix: only raise the alarm when the cron would actually have fired inside the window, and put the rest in a quieter "not due this week" group so the monthly jobs stay visible without posing as incidents. | `workflow_activity.json` (generated `2026-09-04T21:19Z`) covers **2026-08-28 → 09-04**, i.e. days-of-month {28,29,30,31,1,2,3,4}. The `silent` list (`WorkflowActivity.tsx:117-123`) is every inventory workflow that declares a cron and produced no run — today exactly **11**, and every one has a fixed day-of-month outside that set: `scraper-slow-data.yml` `0 3 12 * *`, `build-oni-history.yml` `0 6 10 * *`, `scraper-coffee-imports.yml` `0 7 15 * *`, `ucda-monthly-reports.yml` `0 3 16 * *`, `scraper-usitc-imports.yml` `30 7 16 * *`, `scraper-eurostat-imports.yml` `0 8 17 * *`, `scraper-kaffeesteuer.yml` `0 8 24 * *`, `scraper-earnings.yml` + `scraper-roaster-results.yml` `… 15 2,5,8,11 *`, `refresh-balance-sheets.yml` `0 6 20 6,12 *`, `scraper-coffee-footprint.yml` `43 5 8 9 *`. **0 of 11 were due** — checked by matching each cron's day-of-month/month field against the window's eight dates, not by eye. It is structural, not a bad day: a day-15 monthly cron falls outside a rolling 7-day window on ~23 days in 30, so these cards are on screen most of the time, and the four non-monthly ones are outside it ~97% of the time. Meanwhile 43 of the 54 scheduled workflows did run, so the daily/hourly population — the only one the alarm can actually judge — is fully covered and currently produces zero true alarms. The panel's own header comment calls this "the one panel whose whole job is to be trusted when it cries wolf" and records an earlier false-alarm bug (joining on mutable display name instead of file) fixed for exactly this reason; the cadence blind spot is the same class of defect, still open. Caveat on my checking: this clone is shallow (2 revisions of the activity file), so today's file is the only snapshot I could re-verify directly — the cron expressions themselves carry the rest of the argument. | `frontend/components/data-map/WorkflowActivity.tsx` — the `silent` memo, lines 117-123: keep the join on `file` (that fix must stay), and add a due-check before flagging. The window is whole days and `data.days` already holds the eight ISO dates, so the check needs only the cron's day-of-month / month / day-of-week fields tested against those dates — minute and hour can be ignored, and it is safer to skip the first day (the window opens at 21:19 UTC) than to risk re-introducing a false positive. Split the result into `due` and `notDue`; `SilentList` (lines 367-393) renders `due` as the amber "no runs" cards it does today and `notDue` as a collapsed grey line each ("monthly · next due 2026-09-12"). Label the filter button at line 209 with the `due` count only, so `Silent 0` becomes the healthy state it is supposed to be, and amend the footer sentence at lines 296-299 to say the alarm covers workflows that were **due** this week. No data or generator change is needed — `crons` is already in `workflows_inventory.json` and already read here (line 105). Out of scope: the `renamed` / `errored` / `capped` / `degraded` banners, which are all correct, and the inventory table in `frontend/app/data-map/page.tsx:337-365`. | S |

---

## Token discipline — read this before you start

Every session starts a fresh cloud session with no memory, so what you read is what you pay for.
The rules below are not politeness; they are the difference between a cheap run and a wasteful one.

1. **Start from `docs/AGENT_INDEX.md`.** It maps every tab to its page, its component directory
   and the data files it reads. Go straight there. Do not `grep` across the repo to find where a
   tab lives — the index already knows, and there are 1,200 tracked files.
2. **Never read a large JSON file into context.** `workflow_activity.json` is 26 KB and
   `workflows_inventory.json` is 38 KB — reading both costs ~16,000 tokens for facts a one-line
   query answers in ~150. Always pipe through `python3 -c` or `jq` and read the summary:
   `python3 -c "import json;d=json.load(open(F));print(...)"`. The same goes for any data file
   over a few KB: query it, don't open it.
3. **Read whole source files only when you are going to reason about them.** To locate something,
   use `grep -n` with context, not `cat`.
4. **Budget: about 15 file reads.** If you are past that and still hunting, the index is missing
   something — say so in your summary so it can be fixed, and work with what you have.

## Rules for the routine writing here

1. **One proposal per session.** Not two, not zero. If the obvious thing is already listed, go deeper into the same area rather than widening to another tab.
2. **It must be real.** Open the actual code and data for that tab; name the file and the change. A proposal you could have written without looking is not a result. If after genuine study the honest answer is that the area is in good shape, say so in the session summary and log the *smallest true* improvement you did find — never invent one to fill the slot.
3. **Plain language in the impact column.** Loic is not a developer: say what changes for the person using the page. Keep the technical detail in the other columns.
4. **Specific enough to implement.** Another agent must be able to act on it without redoing your investigation.
5. **Check for duplicates** before adding, and update the rotation state above so the next session knows where the cycle got to.
6. **Never delete or rewrite `[x]` or `[-]` rows.** This file is a record of what was considered, including what was rejected.
