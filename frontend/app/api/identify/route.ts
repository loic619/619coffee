// POST /api/identify — the login-gate submit.
//
// The welcome form posts first name + surname + a shared tier password:
//   admin (full incl. tracking) · user (no tracking/research/data-map) ·
//   basic (supply/demand/futures/freight only) — see lib/gate.ts.
// On success we set (1) the long-lived `cid` name cookie (feeds the /admin
// IP↔name tracker), (2) the HMAC-signed `tid` tier cookie the middleware
// enforces, and (3) a client-readable `tierv` used only to filter the tab
// band. Upstash recording is best-effort — the cookies are the actual gate.
import { NextResponse, type NextRequest } from "next/server";
import { signTier, tierForPassword, tierHome, pathAllowed, TIER_COOKIE, TIER_VIEW_COOKIE } from "@/lib/gate";

export const runtime = "nodejs";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const IP_HASH_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days — matches the middleware
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;     // 1 year

// Drop control chars, collapse whitespace, cap length (tidiness — the value is
// rendered as React text in the admin table, which escapes it anyway).
function clean(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 40);
}

// Only same-origin relative paths — never absolute/protocol-relative (open-redirect guard).
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function recordIdentity(ip: string, full: string, tier: string): Promise<void> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  const ipKey = `access:ips:${ip}`;
  const pipeline = [
    ["SADD", "access:ips", ip],
    ["HSET", ipKey, "name", full, "tier", tier],
    ["EXPIRE", ipKey, String(IP_HASH_TTL_SECONDS)],
    // Keep every distinct name ever seen from this IP (shared/office IPs).
    ["SADD", `${ipKey}:names`, full],
    ["EXPIRE", `${ipKey}:names`, String(IP_HASH_TTL_SECONDS)],
  ];
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(pipeline),
    });
  } catch {
    // best-effort — the cookies below are what actually let them in
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  // One `name` field. The form used to split first name / surname, which
  // assumes a shape many of this audience's names do not have — two surnames
  // are normal in Latin America and Iberia, and Indonesian or Ethiopian names
  // often do not split at all. The legacy pair is still accepted so an old
  // cached form does not bounce.
  const name = clean(String(form?.get("name") ?? ""));
  const first = clean(String(form?.get("first") ?? ""));
  const last = clean(String(form?.get("last") ?? ""));
  const password = String(form?.get("password") ?? "").trim();
  const next = safeNext(String(form?.get("next") ?? "/"));
  const full = (name || [first, last].filter(Boolean).join(" ")).trim();

  const bounce = (err: string) => {
    const url = new URL("/welcome", req.url);
    url.searchParams.set("next", next);
    url.searchParams.set("err", err);
    return NextResponse.redirect(url, 303);
  };

  if (!full) return bounce("1");            // name missing
  const tier = tierForPassword(password);
  if (!tier) return bounce("2");            // wrong / missing password

  // Sign the tier cookie BEFORE recording anything. If GATE_SECRET is missing
  // in production, signTier throws — bounce with a config error rather than
  // 500, and never admit the visitor on an unsigned/guessable cookie.
  let signed: string;
  try {
    signed = await signTier(tier);
  } catch {
    return bounce("3");                     // server misconfigured (no GATE_SECRET)
  }

  await recordIdentity(clientIp(req), full, tier);

  // Land on the requested page if this tier may see it, else its home tab.
  const dest = pathAllowed(tier, next) ? next : tierHome(tier);
  const res = NextResponse.redirect(new URL(dest, req.url), 303);
  const base = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: COOKIE_MAX_AGE };
  res.cookies.set("cid", full, { ...base, httpOnly: true });
  res.cookies.set(TIER_COOKIE, signed, { ...base, httpOnly: true });
  res.cookies.set(TIER_VIEW_COOKIE, tier, { ...base, httpOnly: false }); // cosmetic (TabNav)
  return res;
}
