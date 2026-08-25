// Research-article metadata overrides.
//
//   GET     everyone behind the site gate — the overrides ARE the titles the
//           reader sees, so they cannot be admin-only or edits would be
//           invisible to the people they were made for.
//   PUT     admin only. Body: { id, patch }. Merges into the stored override.
//   DELETE  admin only. ?id=… drops the override so the article follows its
//           source again.
//
// The admin check is the signed `tid` cookie, verified server-side — the same
// gate the middleware enforces. Hiding the edit UI from non-admins is a
// courtesy; this is the actual control. A `tierv` cookie says "admin" in
// plain text and is client-readable, so it is worth nothing here.
import { NextResponse, type NextRequest } from "next/server";
import { TIER_COOKIE, verifyTier } from "@/lib/gate";
import { upstashConfigured, upstashPipeline } from "@/lib/upstashRest";
import { OVERRIDES_KEY, sanitize, type Override, type OverrideMap } from "@/lib/research/overrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(req: NextRequest): Promise<boolean> {
  return (await verifyTier(req.cookies.get(TIER_COOKIE)?.value)) === "admin";
}

async function readAll(): Promise<OverrideMap> {
  const res = await upstashPipeline<[Record<string, string> | string[] | null]>(
    [["HGETALL", OVERRIDES_KEY]]);
  const raw = res?.[0];
  if (!raw) return {};
  // Upstash returns HGETALL as a flat [k, v, k, v] array over REST.
  const entries: [string, string][] = Array.isArray(raw)
    ? raw.reduce<[string, string][]>((acc, _v, i, arr) =>
        (i % 2 ? acc : [...acc, [String(arr[i]), String(arr[i + 1])]]), [])
    : Object.entries(raw);
  const out: OverrideMap = {};
  for (const [id, json] of entries) {
    try { out[id] = JSON.parse(json) as Override; } catch { /* skip a bad row */ }
  }
  return out;
}

export async function GET() {
  if (!upstashConfigured()) return NextResponse.json({ overrides: {}, storage: false });
  return NextResponse.json({ overrides: await readAll(), storage: true });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  if (!upstashConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  let body: { id?: unknown; patch?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id.slice(0, 80) : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Merge rather than replace: the editor sends only the field it changed, so
  // a partial save must not silently drop the other overrides on that article.
  const current = (await readAll())[id] ?? {};
  const next: Override = { ...current, ...sanitize(body.patch) };
  // An empty string clears a field — sanitize() drops it, so honour the
  // clear explicitly instead of leaving the old value in place.
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  for (const k of ["title", "subtitle", "kicker", "note"] as const) {
    if (patch[k] === "") delete next[k];
  }
  next.edited_at = new Date().toISOString();

  const ok = await upstashPipeline([["HSET", OVERRIDES_KEY, id, JSON.stringify(next)]]);
  if (ok === null) return NextResponse.json({ error: "write failed" }, { status: 502 });
  return NextResponse.json({ id, override: next });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!upstashConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  const ok = await upstashPipeline([["HDEL", OVERRIDES_KEY, id]]);
  if (ok === null) return NextResponse.json({ error: "delete failed" }, { status: 502 });
  return NextResponse.json({ id, reset: true });
}
