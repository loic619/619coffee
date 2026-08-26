---
name: run-app
description: Launch the Coffee-intel-map Next.js frontend locally and drive it in a headless browser to see a change actually render. Use this whenever the task involves looking at the app rather than reasoning about it — screenshotting a tab, checking a chart or panel renders, confirming a UI fix worked, verifying a gauge/label/badge shows the right value, reproducing a visual bug, or answering "does it look right?". Also use it proactively before merging a frontend change, since typecheck, lint and unit tests all pass cleanly on rendering bugs. Covers the auth gate, the required env vars, and the browser setup, none of which are guessable.
---

# Running this app to look at it

`tsc`, ESLint and vitest have all passed green while the page showed a
warehouse "100% full" on 4,000 bags and two freshness chips glowing red for a
non-existent problem. Rendering bugs are invisible to every check that does not
open the page. That is what this skill is for.

The whole loop is: **build → start with gate env → drive → look at the PNG.**

## 1. Build and start

Everything runs from `frontend/`. The app is a production build; `next dev`
also works but is slower to first paint.

```bash
cd frontend
npm install                       # if node_modules is missing (container is ephemeral)
npm i -D playwright --no-save     # driver only; do NOT run `playwright install`

npx next build

# Pick a port nothing is on, then start with the gate configured:
(lsof -ti:3002 | xargs -r kill -9) 2>/dev/null; sleep 2
GATE_PW_USER="$APP_ACCESS" GATE_SECRET='local-only-throwaway' \
  nohup npx next start -p 3002 > /tmp/next.log 2>&1 &
timeout 60 bash -c 'until curl -sf http://localhost:3002/ >/dev/null; do sleep 1; done' && echo UP
```

Poll the port — don't `sleep`. If it doesn't come up, read `/tmp/next.log`.

**After any rebuild, fully kill and restart the server.** A running server
keeps serving the old chunk manifest, so the browser requests hashes that no
longer exist and every asset 400s while the page renders empty. This looks
exactly like a broken change and is not one.

## 2. The auth gate

`middleware.ts` gates the whole site and answers un-identified requests with
401, including the `/data/*.json` files the panels fetch — so a gated page
renders empty rather than redirecting. Two things matter:

- **`SITE_GATE_ENABLED=false` does not work.** Edge middleware inlines env at
  build time, and even rebuilding with it set leaves the gate up. Don't spend
  time on it; go through the gate instead.
- **The password is checked against `GATE_PW_USER`**, which lives in Vercel and
  is absent locally. Set it at server start to whatever you'll send. Signing
  the tier cookie also needs `GATE_SECRET` or the login bounces with `err=3`.

Put the access code in `APP_ACCESS` in the environment. Never hardcode it in a
file — this repo is public.

If the login bounces with `err=2` the code and `GATE_PW_USER` disagree; `err=1`
means the name was empty; `err=3` means `GATE_SECRET` is unset.

## 3. Drive it

`scripts/drive.mjs` handles gate login, the browser setup and error capture:

```bash
APP_ACCESS='<code>' node ../.claude/skills/run-app/scripts/drive.mjs \
  --path '/demand?tab=certified' \
  --wait 'text=Antwerp' \
  --out /tmp/certified.png --full
```

| flag | meaning |
|---|---|
| `--path` | route to open, query string included |
| `--wait` | selector to wait for — pick real content, not a heading |
| `--out` | PNG path |
| `--full` | full-page capture instead of the viewport |
| `--click` | selector to click before the screenshot (toggles, sort buttons) |
| `--port`, `--width`, `--height`, `--settle` | overrides |

It prints any console errors, page errors and ≥400 responses. **Then read the
PNG.** A screenshot you didn't look at proves nothing — an empty page and a
correct one both exit 0.

To assert on values rather than eyeball them, add a `page.evaluate` block to a
copy of the script and print what you find; that is how "Antwerp 11%,
Trieste 0%" got confirmed rather than assumed.

## 4. Routes

Sub-tabs deep-link, so you can go straight to one:

- `/demand?tab=certified` — also `destination`, `spot`, `consumption`,
  `imports`, `listed`
- `/futures`, `/cot`, `/macro`, `/supply`, `/freight`, `/news`, `/map`,
  `/data-map`, `/enso`, `/signals`

**The query key is not always `tab`.** `/supply` uses `?origin=` — so
`/supply?tab=sd` silently falls through to Brazil and you screenshot the wrong
page while everything reports success. Check the `useUrlState(...)` call in the
page component for the key it actually reads, and check the `url:` line the
driver prints against what rendered.
- `/research/<tab>`

Tiers matter: signing in with the **user** code lands on `/map` and may not be
allowed everywhere. If a page redirects unexpectedly, that's `pathAllowed()` in
`lib/gate.ts`, not a bug in your change.

## Gotchas that cost real time

- **`waitUntil: 'networkidle'` never settles** — the app polls live data, so
  navigation times out at 60s. Use `domcontentloaded` plus `--wait`.
- **Headless UAs are treated as bots.** `middleware.ts` matches "headless" in
  the user-agent; the driver already overrides it.
- **Don't run `playwright install`.** The image ships Chromium under
  `/opt/pw-browsers/`, and the bundled revision won't match what npm expects —
  the driver globs for the installed one.
- **Port hygiene — `lsof` does not work in this container.** `lsof -ti:3002`
  prints nothing even while the server is demonstrably serving, so the
  recommended `lsof -ti:PORT | xargs -r kill -9` is a silent no-op and the old
  server survives every "restart". The new one then dies with `EADDRINUSE`
  while `curl` still answers — from the *old* process — so the readiness poll
  goes green and you spend the next twenty minutes debugging a fix that is
  correctly built and simply not being served. Kill by PID instead, and
  confirm the restart bound:

  ```bash
  ps -eo pid,cmd | grep -E "next-server|next start" | grep -v grep   # find them
  kill -9 <pids>
  # after starting:
  grep -c EADDRINUSE /tmp/next.log   # must be 0 — curl alone will not tell you
  ```

  When a change looks like it did not take, check `grep -o '.\{60\}<your new
  string>' .next/static/chunks/app/<route>/page-*.js` first: if the string is
  in the bundle, the build is fine and you have a stale *server*, not a stale
  build.
- **`--full` is a no-op on pages that scroll in an inner container.** `/macro`,
  and any page whose root is `h-full overflow-y-auto`, never scrolls the
  document, so `fullPage: true` returns a viewport-sized image and the panel
  you wanted is simply absent. Scroll the element into view first
  (`locator(sel).scrollIntoViewIfNeeded()`) and screenshot the viewport, or
  assert on the DOM rather than the picture.

- **`:has-text()` matches substrings.** `button:has-text("port")` clicks the
  **Imports** tab, not the sort control, and you screenshot the wrong page
  while everything reports success. Use `button:text-is("port")` for an exact
  match, or `getByRole('button', { name: 'port', exact: true })` in a custom
  script. Always check the `url:` line the driver prints — it catches exactly
  this.
- **`503 /api/live` is expected locally** and harmless: the live-quote endpoint
  has no upstream configured outside Vercel. The ticker reads "No market data".
  Everything driven by the committed JSON still renders. Don't chase it.
- **Data comes from `frontend/public/data/*.json` in the repo**, so the local
  app shows exactly the committed data. To test a data change, edit the JSON
  and reload — no scraper run needed.

## If this skill is wrong

The gate, the env var names and the image's browser path are the parts most
likely to drift. If you had to work around something here, fix this file in the
same PR — a stale recipe costs the next session more than no recipe.
