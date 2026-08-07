import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

// Password-gated write path for the crop-estimate "edit mode" on the origin
// S&D cards. The admin password never reaches GitHub: it's checked here
// (SHA-256, constant-time), and only the validated seasons payload is
// forwarded as a workflow_dispatch to apply-crop-estimate-edit.yml, which
// re-validates, rewrites the origin's balance-sheet JSON and commits — so
// every edit lives in git history and goes live on the auto-redeploy
// (~2 min). Reuses the same GH_DISPATCH_TOKEN fine-grained PAT as
// /api/refresh-acaphe (Actions: read+write on this repo only).
//
// The stored credential is a SHA-256 hex digest of the admin password —
// set CROP_EDIT_PASSWORD_SHA256 in the Vercel env to rotate it without a
// code change.

const PASSWORD_SHA256 =
  process.env.CROP_EDIT_PASSWORD_SHA256 ??
  "fa5c94503096a33ea7988754863bccc6116738e11c99da730b32a8d4854e26d1";

const GH_TOKEN = process.env.GH_DISPATCH_TOKEN;
// Same rename-proof candidate probing as /api/refresh-acaphe: GitHub 301s
// renamed-repo API calls and fetch downgrades a redirected POST to GET,
// silently breaking workflow_dispatch — so probe candidates explicitly.
const REPO_CANDIDATES = [
  process.env.GH_REPO ?? "loic619/619coffee",
  "loicscanu-ctrl/Coffee-intel-map",
];
const WORKFLOW = "apply-crop-estimate-edit.yml";

const ORIGINS = new Set(["brazil", "colombia", "indonesia", "uganda", "vietnam"]);
const SEASON_RE = /^\d{4}\/\d{2}$/;
const UPDATED_RE = /^\d{4}-\d{2}$/;
const SOURCE_KEY_RE = /^[a-z0-9_]{1,20}$/;
const MAX_MBAGS = 200;

export const dynamic = "force-dynamic";
export const revalidate = 0;

function passwordOk(pw: unknown): boolean {
  if (typeof pw !== "string" || pw.length === 0 || pw.length > 128) return false;
  const got = createHash("sha256").update(pw).digest();
  const want = Buffer.from(PASSWORD_SHA256, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

interface SeasonIn {
  season?: unknown;
  forecast?: unknown;
  production?: unknown;
}

/** Returns a normalized seasons array, or a string describing the problem. */
function validateSeasons(seasons: unknown):
  | { season: string; forecast: boolean; production: Record<string, number> }[]
  | string {
  if (!Array.isArray(seasons) || seasons.length < 1 || seasons.length > 40) {
    return "seasons must be a list of 1–40 entries";
  }
  const out: { season: string; forecast: boolean; production: Record<string, number> }[] = [];
  const seen = new Set<string>();
  for (const raw of seasons as SeasonIn[]) {
    const label = raw?.season;
    if (typeof label !== "string" || !SEASON_RE.test(label)) {
      return `bad season label ${JSON.stringify(label)}`;
    }
    if (seen.has(label)) return `duplicate season ${label}`;
    seen.add(label);
    const prod = raw?.production;
    if (!prod || typeof prod !== "object" || Array.isArray(prod)) {
      return `${label}: production must be an object`;
    }
    const entries = Object.entries(prod as Record<string, unknown>);
    if (entries.length < 1 || entries.length > 10) {
      return `${label}: production needs 1–10 source values`;
    }
    const production: Record<string, number> = {};
    for (const [k, v] of entries) {
      if (!SOURCE_KEY_RE.test(k)) return `${label}: bad source key ${JSON.stringify(k)}`;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_MBAGS) {
        return `${label}.${k}: value must be in (0, ${MAX_MBAGS}] million bags`;
      }
      production[k] = v;
    }
    out.push({ season: label, forecast: raw?.forecast === true, production });
  }
  return out;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (!passwordOk(body.password)) {
    // Flat delay keeps a brute-force loop slow without leaking which part
    // of the check failed.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const action = body.action ?? "save";
  if (action === "verify") {
    return NextResponse.json({ ok: true });
  }
  if (action !== "save") {
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  const origin = body.origin;
  if (typeof origin !== "string" || !ORIGINS.has(origin)) {
    return NextResponse.json({ error: "unknown_origin" }, { status: 400 });
  }
  const updated = body.updated;
  if (typeof updated !== "string" || !UPDATED_RE.test(updated)) {
    return NextResponse.json({ error: "bad_updated_stamp" }, { status: 400 });
  }
  const seasons = validateSeasons(body.seasons);
  if (typeof seasons === "string") {
    return NextResponse.json({ error: "invalid_seasons", detail: seasons }, { status: 400 });
  }

  const payload = JSON.stringify({ origin, updated, seasons });
  if (payload.length > 60_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 400 });
  }

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
          body: JSON.stringify({ ref: "main", inputs: { payload } }),
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
