// Edge middleware — runs at Vercel's edge on every matched request.
//
// Purpose: log access for the /admin/access dashboard so we can see who's
// visiting (IP, country/city, path, UA, referrer, timestamp). Filters out
// known bots and non-page sub-resources so the log is a clean stream of
// real human page loads. Fault-tolerant: a slow / unreachable Upstash
// does not block the response (2 s timeout on the log call, errors
// swallowed).
//
// Storage on Upstash (REST, JSON pipeline):
//   access:log              — capped list (LTRIM to last 5000 hits),
//                             each entry is a JSON-encoded record.
//   access:ips              — set of distinct IPs ever seen.
//   access:ips:<ip>         — hash with first_seen / last_seen / last_path /
//                             last_country / last_city / last_ua / hits.
//                             TTL 60 days so quiet IPs roll off.
//
// Future gate: setting SITE_GATE_ENABLED=true + ADMIN_PASSWORD lets the
// same middleware redirect un-logged-in visitors to /admin/login. Left
// off for now per the "open + log" decision (see chat 2026-06-17).
import { NextResponse, type NextRequest } from "next/server";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const MAX_LOG_ENTRIES = 5000;
const IP_HASH_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days
const UPSTASH_TIMEOUT_MS = 2000;

// Name gate: redirect un-identified visitors to /welcome (first name + surname,
// no password). On by default; set SITE_GATE_ENABLED="false" in the env to
// disable (kill-switch — the app goes fully open again, still logged).
const GATE_ENABLED = process.env.SITE_GATE_ENABLED !== "false";

// Substring matches against the lowercased User-Agent. Conservative list —
// uptime monitors, search-engine crawlers, headless browsers, generic CLI.
const BOT_UA_FRAGMENTS = [
  "bot", "crawler", "spider", "scraper", "fetcher",
  "facebookexternalhit", "linkedinbot", "twitterbot",
  "uptimerobot", "pingdom", "statuscake", "betteruptime",
  "ahrefs", "semrush", "mj12bot", "dotbot", "petalbot",
  "bingpreview", "google-inspectiontool", "google-pagespeed",
  "headlesschrome", "puppeteer", "playwright", "phantomjs",
  "vercel-screenshot", "lighthouse",
  "curl/", "wget/", "python-requests", "python-urllib",
  "go-http-client", "node-fetch",
];

function isBot(ua: string): boolean {
  if (!ua) return true; // no-UA requests are nearly always crawlers/scripts
  const lower = ua.toLowerCase();
  return BOT_UA_FRAGMENTS.some((frag) => lower.includes(frag));
}

// Real top-level page loads only — skip XHR/fetch for JSON, images, fonts,
// etc. that fire as side-effects of a page render. Modern browsers send
// `sec-fetch-dest: document` for navigations, which is the definitive
// signal; older clients fall through to the extension check.
function isPageLoad(request: NextRequest, pathname: string): boolean {
  const dest = request.headers.get("sec-fetch-dest");
  if (dest === "document") return true;
  if (dest) return false;
  return !/\.(json|js|mjs|css|map|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot)$/i.test(pathname);
}

async function logAccess(payload: unknown): Promise<void> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // Upstash unreachable, timed out, or rate-limited — drop this entry
    // silently. The user-facing page must not block on logging.
  } finally {
    clearTimeout(timer);
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Never log/gate the admin surface itself — would flood the log with the
  // owner's own visits and could lock the owner out of their own dashboard.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  // The gate's own surface must always be reachable, cookie or not.
  const isGateRoute = pathname === "/welcome" || pathname.startsWith("/api/identify");

  // Who is this? `cid` is set by /api/identify (first name + surname). Next
  // decodes the cookie value on read, so this is the plain name.
  const name = (request.cookies.get("cid")?.value ?? "").trim();

  // ── Name gate ────────────────────────────────────────────────────────────
  // Redirect any un-identified real page navigation to /welcome. Data/asset
  // sub-requests are left alone (the page they belong to is already gated).
  if (GATE_ENABLED && !name && !isGateRoute && isPageLoad(request, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Don't log the gate page itself — pre-identify noise.
  if (isGateRoute) return NextResponse.next();

  const ua = request.headers.get("user-agent") ?? "";
  if (isBot(ua)) return NextResponse.next();
  if (!isPageLoad(request, pathname)) return NextResponse.next();

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const geo = request.geo ?? {};
  const ts = new Date().toISOString();

  const entry = {
    ts,
    ip,
    name,
    country: geo.country ?? null,
    region: geo.region ?? null,
    city: geo.city ?? null,
    path: pathname,
    ua,
    ref: request.headers.get("referer") ?? "",
  };

  // Single round-trip pipeline so the response only waits once on Upstash.
  // Field-list HSET uses Upstash's "HSET key f v f v …" form.
  const ipKey = `access:ips:${ip}`;
  // Field-list HSET (Upstash "HSET key f v f v …"). Include the visitor's name
  // when we know it so the rollup stays fresh even between logins; omit the
  // field entirely when unknown so we never blank out a previously-set name.
  const hsetArgs = [
    "HSET", ipKey,
    "last_seen", ts,
    "last_path", entry.path,
    "last_country", entry.country ?? "",
    "last_region", entry.region ?? "",
    "last_city", entry.city ?? "",
    "last_ua", entry.ua,
  ];
  if (name) hsetArgs.push("name", name);

  const pipeline = [
    ["LPUSH", "access:log", JSON.stringify(entry)],
    ["LTRIM", "access:log", "0", String(MAX_LOG_ENTRIES - 1)],
    ["SADD", "access:ips", ip],
    hsetArgs,
    ["HSETNX", ipKey, "first_seen", ts],
    ["HINCRBY", ipKey, "hits", "1"],
    ["EXPIRE", ipKey, String(IP_HASH_TTL_SECONDS)],
  ];

  await logAccess(pipeline);
  return NextResponse.next();
}

// Run on everything that could be a real page, skip Next internals + static
// asset routes. Admin paths are filtered inside the handler (above) so
// /admin/* still goes through Next's normal pipeline.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|robots\\.txt|sitemap\\.xml).*)",
  ],
};
