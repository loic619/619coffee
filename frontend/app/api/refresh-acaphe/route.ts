import { NextResponse } from "next/server";

// Triggers a manual GitHub Actions workflow_dispatch on the Acaphe poller,
// so the user can refresh live quotes outside the */15-min cron schedule
// (useful when the cron is throttled or when the user wants intraday data
// during a fast-moving session). The poll itself takes ~60–90s end-to-end
// (Playwright cold start + scrape + Redis write); the frontend polls /api/live
// for fresh data on a short interval after the dispatch.
//
// Requires the GH_DISPATCH_TOKEN env var to be set in Vercel — a fine-grained
// GitHub PAT with `Actions: read+write` permission on this repo only. When the
// token is missing the endpoint returns 503 so the UI can degrade gracefully
// to "data re-fetch" without breaking.

const GH_TOKEN = process.env.GH_DISPATCH_TOKEN;
// Rename-proof: try the new owner/repo first, fall back to the old one.
// GitHub redirects renamed-repo API calls with a 301, but fetch downgrades a
// redirected POST to GET, silently breaking workflow_dispatch — so we probe
// candidates explicitly instead of trusting the redirect. Overridable via
// GH_REPO in the Vercel env if the names change again.
const REPO_CANDIDATES = [
  process.env.GH_REPO ?? "loic619/619coffee",
  "loicscanu-ctrl/Coffee-intel-map",
];
const WORKFLOW = "poll-acaphe-quotes.yml";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  if (!GH_TOKEN) {
    return NextResponse.json(
      { error: "not_configured", hint: "set GH_DISPATCH_TOKEN env var" },
      { status: 503 },
    );
  }

  try {
    let last: { status: number; body: string } = { status: 0, body: "" };
    for (const repo of REPO_CANDIDATES) {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GH_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ ref: "main" }),
          cache: "no-store",
          redirect: "manual",
        },
      );

      if (res.status === 204) {
        return NextResponse.json({ ok: true, repo });
      }
      last = { status: res.status, body: await res.text() };
      // 404 (repo not at this name) or 301 (renamed) → try the next candidate.
      if (res.status !== 404 && res.status !== 301) break;
    }
    return NextResponse.json(
      { error: "github_error", status: last.status, body: last.body },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
