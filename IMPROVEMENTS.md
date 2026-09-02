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

Which slot is running is decided by the date and time in **Asia/Saigon**: a run starting
before 12:00 is **AM**, at or after 12:00 is **PM**.

| Day | AM | PM |
|-----|----|----|
| **Monday** | Futures Exchange tab | News tab |
| **Tuesday** | Supply — next sub-tab in the cycle | Supply — the one after it |
| **Wednesday** | Demand — consumption | Macro tab |
| **Thursday** | Freight tab | COT tab |
| **Friday** | Map tab | UX (cross-cutting: any tab) |
| **Saturday** | Data Map — next topic in the cycle | Workflow efficiency: what worked, what can be improved |
| **Sunday** | Research: propose a new paper / question | Research: improve the oldest existing piece |

### Rotation state — update this every time you use it

**Supply sub-tabs** (Tuesday, two per week, ~6 weeks per full cycle, in page order):
`Brazil → Colombia → Honduras → Ethiopia → Vietnam → Indonesia → Uganda → Total → Fertilizers → ENSO → S&D → Origin →` back to Brazil.

- **Next up:** Brazil (AM), Colombia (PM)
- **Last covered:** — (cycle not yet started)

**Data Map topics** (Saturday AM, one per week, in order):
`workflow → data → UX → security →` back to workflow.

- **Next up:** workflow
- **Last covered:** —

**Research** (Sunday):
- **Newest piece:** — · **Oldest not yet revisited:** — (Sunday PM picks this one)

---

## Backlog

Ranked within each tab, best first. `[ ]` open · `[~]` partly done · `[x]` shipped · `[-]` dropped.

**Effort** is a rough read for the fixer: **S** ≈ one file, **M** ≈ a few files, **L** ≈ needs a decision from Loic first.

| ID | Status | Tab | The improvement, in plain language | Evidence it's worth doing | Where | Effort |
|----|--------|-----|-------------------------------------|---------------------------|-------|--------|
| IMP-001 | [ ] | Demand → Consumption | The page tells you the app tracks the whole world's coffee demand. It doesn't. The "coverage" figure compares a USDA **forecast for 2026** against an ICO **actual for 2023/24** — two different things, two to three years apart — and the answer comes out at 100.5%, in green. Compared year-for-year the app covers roughly 92–96% of world demand, i.e. 400–900 kt is missing. One footnote goes further and calls the gap "markets USDA PSD does not break out", when arithmetically there is no gap left to explain. Fix: compare the same year on both sides, say which year each side is, and stop colouring the difference green/red — it is a coverage number, not good or bad news. | `demand_stocks.json → world_consumption`: `tracked_consumption_mt` 10,678,140 at `tracked_latest_year` "2026" vs `ico_reference` 10,620,000 at marketing year "2023/24" → `tracked_vs_ico_pct` 100.5. Summing the same file's `growth_markets[].annual` for one year at a time gives 9,742 kt (2023), 10,220 kt (2024), 10,309 kt (2025), 10,678 kt (2026) across the same 49 countries — so like-for-like coverage against ICO 2023/24 is 91.7% or 96.2% depending on whether PSD's `Market_Year` labels the start or the end of the split year (fixer must confirm; the conclusion holds either way). The 2026 figure is also a forecast, not an actual: `psd_coffee.py:248` notes "USDA FAS publishes the coffee PSD in June (new marketing year)" and health.json stamps `psd_coffee` 2026-06-01. Same mismatch reaches a second panel: `GrowthMarketsPanel.tsx:482` prints "100% of ICO world" and `:500-502` prints "10,660 kt of the ICO world reference 10,620 kt (100%); the remainder is markets USDA PSD does not break out" — a remainder of **minus** 40 kt. ICO side is a hard-coded constant last set to 2023/24 and is now two ICO publications behind. | `backend/scraper/export_stocks.py` `_world_consumption()` (lines 288-336) — emit a tracked total for the ICO reference's own year alongside the latest-year total; `frontend/components/demand/WorldConsumptionWidget.tsx` (lines 43-85) — label both years, use the matched-year total for coverage, drop the emerald/red tone; `frontend/components/demand/GrowthMarketsPanel.tsx` (lines 482, 500-502) — same matched-year figure, and reword the "remainder" sentence. | M |

---

## Rules for the routine writing here

1. **One proposal per session.** Not two, not zero. If the obvious thing is already listed, go deeper into the same area rather than widening to another tab.
2. **It must be real.** Open the actual code and data for that tab; name the file and the change. A proposal you could have written without looking is not a result. If after genuine study the honest answer is that the area is in good shape, say so in the session summary and log the *smallest true* improvement you did find — never invent one to fill the slot.
3. **Plain language in the impact column.** Loic is not a developer: say what changes for the person using the page. Keep the technical detail in the other columns.
4. **Specific enough to implement.** Another agent must be able to act on it without redoing your investigation.
5. **Check for duplicates** before adding, and update the rotation state above so the next session knows where the cycle got to.
6. **Never delete or rewrite `[x]` or `[-]` rows.** This file is a record of what was considered, including what was rejected.
