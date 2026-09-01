# Working in this repo

## Delivering work: branch and PR

Sessions are assigned a branch name like `claude/inspiring-fermat-0Atkw`. Several
of these already exist on the remote as **stale snapshots from old sessions**,
months behind `main`, with no pull request ever opened against them. Pushing a
fresh commit to one fails non-fast-forward, and resolving that would mean
force-resetting history nobody has reviewed.

**Do not ask what to do about this. The answer is fixed:**

1. Cut a new branch from current `origin/main`, named for the change
   (`claude/brief-grading-passed-graded`, not the assigned session name).
2. Push it and open a PR against `main`.
3. Leave any pre-existing `claude/*` branch untouched — never force-push,
   reset, or delete one.

This is what PRs #793–#799 did. Merging still needs a explicit go-ahead; only
the branch choice is settled.

## CI

`ruff` and `pytest` run on every PR. Both must be green before merging.

A red check on a file your diff never touched is usually inherited from `main`
(e.g. the `probe_port_ids.py` import order that arrived with #772 and broke
ruff on every branch cut after it — ruff-bisected in the #814 review; #799's
"inherited from #778" was a misdiagnosis, so don't trust that anchor). Fix it
as its own commit, say so in the PR, and carry on — it is not a reason to stop
and ask.

## Verifying frontend changes

`tsc`, ESLint and vitest all pass green on rendering bugs. Anything that
changes what a panel displays gets checked by actually opening the page — see
the `run-app` skill, which covers the auth gate, env vars and browser setup.
