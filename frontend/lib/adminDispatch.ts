import { createHash, timingSafeEqual } from "node:crypto";

// Shared server-side plumbing for the admin write paths (crop estimates and
// the world balance sheet). Both gate on the same password and both reach
// GitHub the same way, so the check lives in one place rather than being
// copied per route — a second copy is how one of them ends up with a weaker
// comparison than the other.
//
// The stored credential is a SHA-256 hex digest; set CROP_EDIT_PASSWORD_SHA256
// in the Vercel env to rotate without a code change.

const PASSWORD_SHA256 =
  process.env.CROP_EDIT_PASSWORD_SHA256 ??
  "fa5c94503096a33ea7988754863bccc6116738e11c99da730b32a8d4854e26d1";

const GH_TOKEN = process.env.GH_DISPATCH_TOKEN;
// Rename-proof candidate probing: GitHub 301s renamed-repo API calls and
// fetch downgrades a redirected POST to GET, silently breaking
// workflow_dispatch — so probe candidates explicitly rather than trusting
// the redirect.
const REPO_CANDIDATES = [
  process.env.GH_REPO ?? "loic619/619coffee",
  "loicscanu-ctrl/Coffee-intel-map",
];

/** Constant-time password check. */
export function passwordOk(pw: unknown): boolean {
  if (typeof pw !== "string" || pw.length === 0 || pw.length > 128) return false;
  const got = createHash("sha256").update(pw).digest();
  const want = Buffer.from(PASSWORD_SHA256, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export type DispatchResult =
  | { ok: true; repo: string }
  | { ok: false; status: number; error: string; body?: string };

/** workflow_dispatch a workflow with a `payload` string input, plus any
 *  extra string inputs the workflow declares.
 *
 *  A 204 here means GITHUB ACCEPTED THE DISPATCH — not that the run
 *  succeeded, and not even that it will run. Callers must not report a
 *  write as committed on the strength of this result. */
export async function dispatchWorkflow(
  workflow: string, payload: string, extraInputs: Record<string, string> = {},
): Promise<DispatchResult> {
  if (!GH_TOKEN) {
    return { ok: false, status: 503, error: "not_configured" };
  }
  let last = { status: 0, body: "" };
  for (const repo of REPO_CANDIDATES) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main", inputs: { payload, ...extraInputs } }),
        cache: "no-store",
        redirect: "manual",
      },
    );
    if (res.status === 204) return { ok: true, repo };
    last = { status: res.status, body: await res.text() };
    if (res.status !== 404 && res.status !== 301) break;
  }
  return { ok: false, status: 502, error: "github_error", body: last.body };
}
