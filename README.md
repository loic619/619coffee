# 619coffee
Get a visual of coffee intel

## Deploying the live-quotes poller

The `acaphe_poller` is a long-running process that polls acaphe.com every
30 seconds and pushes the latest coffee quotes to Upstash Redis (which the
frontend `/api/live` route reads). When the poller isn't running, live
quotes go stale and the `Check Live Quotes Freshness` workflow alerts.

There are two ways to run it:

### Option A — Render (recommended, ~5 min)

The repo ships with a Render Blueprint (`render.yaml`) that provisions a
worker service from `backend/Dockerfile.acaphe-poller`.

1. **GitHub** — make sure the repo is pushed (it is).
2. **Render** → Dashboard → **New** → **Blueprint** → connect this repo.
   Render reads `render.yaml` and proposes the `acaphe-poller` worker.
3. Click **Apply**, then in the new service's settings set the env vars:
   - `UPSTASH_REDIS_REST_URL`     — same value as Vercel's `/api/live` already uses
   - `UPSTASH_REDIS_REST_TOKEN`   — same
   - `DATABASE_URL` *(optional)* — set if you want the poller to also persist
     Vietnam physical prices to Postgres
4. Hit **Deploy**. First boot takes ~3 min (Chromium install). After that,
   you should see in the logs:
   ```
   [acaphe] Polling every 30s → /app/...
   [acaphe] Pushed live_quotes (N items)
   ```
5. Trigger **Actions → Check Live Quotes Freshness → Run workflow** to
   confirm the alert clears. You should see `✓ Live quotes are fresh`.

**Cost**: the `starter` plan is ~$7/mo. Free tier works but the worker
sleeps after 15 min of inactivity (defeats the purpose). The CPU/RAM
footprint is tiny — Chromium runs once at startup, then it's just an
HTTP-poll loop.

### Option B — your own machine

Same shape, just run locally:

```bash
cd backend
pip install -r scraper/requirements.txt
playwright install chromium
export UPSTASH_REDIS_REST_URL=...
export UPSTASH_REDIS_REST_TOKEN=...
python -m scraper.acaphe_poller
```

Quotes only stay fresh while the process runs. The freshness-check
workflow alerts within a few hours when it's down.

### Stopping or moving the poller

The check workflow alerts when `live_quotes` is older than 6 hours. If
you need to pause the poller (maintenance, hosting migration, etc.):

1. Stop the worker service.
2. Disable the `Check Live Quotes Freshness` workflow under Actions
   to silence alerts during the downtime.
3. Re-enable when the poller is running again.
