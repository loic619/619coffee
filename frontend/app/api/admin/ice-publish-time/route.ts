import { NextResponse, type NextRequest } from "next/server";
import { TIER_COOKIE, verifyTier } from "@/lib/gate";

// POST /api/admin/ice-publish-time — what an operator can tell us about a
// business day whose snapshot we do not hold. Two possibilities, two bodies:
//
//   { date, hhmmss }              the report exists, here is its second
//   { date, no_release, reason }  there was no report — the exchange was shut
//
// The sweep covers 10:29–11:00 on purpose: 97% of sessions, at a 96-minute
// worst case instead of the nine hours it would take to cover the full observed
// range. A report outside that window is announced rather than hidden, and the
// only thing that recovers it is a human reading the filename off ICE and
// entering it here. This forwards that to workflow 0.19, which appends the
// observation and re-runs the scraper — tier 0 then fetches the session in one
// request, at any age, because ICE retains historical reports (probe 0.18).
//
// The second body exists because no second will ever close a day that had no
// release: 2026-08-31 was the UK summer bank holiday, the sweep walked the whole
// window with nothing to find, and the day sat on the pending list as a
// permanent to-do. Passing it records the reason and takes it out of the session
// count. It is a claim, not an observation, so it is refused when the record
// already holds a publish second for that date — see record_observation.py.
//
// Authorisation is the signed tier cookie, not a second password. The gate
// already issues `tid` as an HMAC-signed httpOnly cookie and the middleware
// verifies it on every /api/* request — but it only requires SOME valid tier,
// so this route checks for admin specifically. A `user` or `basic` session
// cannot reach the research page that offers this, and must not reach the
// endpoint behind it either.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GH_TOKEN = process.env.GH_DISPATCH_TOKEN;
const REPO_CANDIDATES = [
  process.env.GH_REPO ?? "loic619/619coffee",
  "loicscanu-ctrl/Coffee-intel-map",
];
const WORKFLOW = "ice-record-publish-time.yml";

/** ICE has never published outside this range; anything else is a typo. */
const EARLIEST_S = 9 * 3600;
const LATEST_S = 15 * 3600;
/** Matches MAX_REASON in record_observation.py, which truncates rather than fails. */
const MAX_REASON = 200;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tier = await verifyTier(req.cookies.get(TIER_COOKIE)?.value);
  if (tier !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { date?: unknown; hhmmss?: unknown; no_release?: unknown; reason?: unknown }
    | null;
  const date = String(body?.date ?? "").trim();
  const pass = body?.no_release === true;
  const hhmmss = String(body?.hhmmss ?? "").trim();
  const reason = String(body?.reason ?? "").replace(/\s+/g, " ").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad_date", hint: "YYYY-MM-DD" }, { status: 400 });
  }
  if (new Date(`${date}T00:00:00Z`) > new Date()) {
    return NextResponse.json({ error: "future_date" }, { status: 400 });
  }
  // Weekends are not business days, so nothing ever counts them missing and
  // "no release" says nothing about them.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return NextResponse.json(
      { error: "not_a_business_day", hint: "ICE does not publish at weekends" },
      { status: 400 },
    );
  }

  if (pass) {
    if (!reason) {
      return NextResponse.json(
        { error: "reason_required", hint: "say why — it is the only record of the closure" },
        { status: 400 },
      );
    }
    if (reason.length > MAX_REASON) {
      return NextResponse.json(
        { error: "reason_too_long", hint: `${MAX_REASON} characters` },
        { status: 400 },
      );
    }
  } else {
    if (!/^\d{6}$/.test(hhmmss)) {
      return NextResponse.json(
        { error: "bad_time", hint: "six digits, as it appears in the filename — e.g. 112351" },
        { status: 400 },
      );
    }
    const h = Number(hhmmss.slice(0, 2));
    const m = Number(hhmmss.slice(2, 4));
    const s = Number(hhmmss.slice(4, 6));
    if (m > 59 || s > 59) {
      return NextResponse.json({ error: "bad_time", hint: "not a wall-clock time" }, { status: 400 });
    }
    const secs = h * 3600 + m * 60 + s;
    if (secs < EARLIEST_S || secs > LATEST_S) {
      // Rejected rather than accepted-and-failed: a wrong second is committed to
      // the hit log and then poisons tier 0 for that date until someone notices.
      return NextResponse.json(
        { error: "implausible_time", hint: "ICE publishes between 09:00 and 15:00 UTC" },
        { status: 400 },
      );
    }
  }

  if (!GH_TOKEN) {
    return NextResponse.json(
      { error: "not_configured", hint: "set GH_DISPATCH_TOKEN" },
      { status: 503 },
    );
  }

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
        // The workflow branches on hhmmss being empty, so a pass sends "".
        body: JSON.stringify({
          ref: "main",
          inputs: pass ? { date, hhmmss: "", reason } : { date, hhmmss },
        }),
        cache: "no-store",
        redirect: "manual",
      },
    );
    if (res.status === 204) {
      return NextResponse.json({ ok: true, date, hhmmss: pass ? "" : hhmmss, reason, repo });
    }
    last = { status: res.status, body: (await res.text()).slice(0, 300) };
  }
  return NextResponse.json({ error: "github_error", ...last }, { status: 502 });
}
