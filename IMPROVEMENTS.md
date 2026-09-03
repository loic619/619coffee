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
| Thursday | — | **AM** (Freight) |
| Friday | — | **AM** (Map) |
| Saturday | — | **AM** (Data Map) |
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
| — | | | *Empty. The first session fills this in.* | | | |

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
