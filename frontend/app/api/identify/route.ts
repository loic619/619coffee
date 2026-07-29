// POST /api/identify — the "who are you" gate submit.
//
// No password: the welcome form posts a first name + surname. We (1) set a
// long-lived `cid` cookie so the visitor isn't asked again, and (2) record the
// name against their IP in Upstash so the /admin access log can show WHO each
// IP is, not just the raw address. Fault-tolerant: a missing/slow Upstash never
// blocks the redirect — the cookie (the actual gate) is set regardless.
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const IP_HASH_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days — matches the middleware
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;     // 1 year

// Drop control chars, collapse whitespace, cap length. The name is rendered as
// React text in the admin table (auto-escaped) so this is about tidiness, not
// XSS — but we still strip anything that could break the Redis command/cookie.
function clean(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 40);
}

// Only same-origin relative paths — never an absolute/protocol-relative URL
// (open-redirect guard).
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

async function recordName(ip: string, full: string): Promise<void> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  const ipKey = `access:ips:${ip}`;
  const pipeline = [
    ["SADD", "access:ips", ip],
    ["HSET", ipKey, "name", full],
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
    // best-effort — the cookie below is what actually lets them in
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  const first = clean(String(form?.get("first") ?? ""));
  const last = clean(String(form?.get("last") ?? ""));
  const next = safeNext(String(form?.get("next") ?? "/"));
  const full = [first, last].filter(Boolean).join(" ").trim();

  // No name entered — bounce back to the form with an error flag.
  if (!full) {
    const url = new URL("/welcome", req.url);
    url.searchParams.set("next", next);
    url.searchParams.set("err", "1");
    return NextResponse.redirect(url, 303);
  }

  await recordName(clientIp(req), full);

  const res = NextResponse.redirect(new URL(next, req.url), 303);
  // Next encodes/decodes the cookie value itself — store the plain name.
  res.cookies.set("cid", full, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
