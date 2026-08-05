// Shared access-gate model: password → tier, tier → allowed routes, and the
// HMAC-signed tier cookie. Used by the edge middleware (verification + ACL),
// /api/identify (login), and TabNav (cosmetic tab filtering).
//
// Tiers (one shared password each — set in the Vercel env to override the
// in-repo defaults; NOTE the repo is public, so treat the defaults as
// "colleague-gate", not real secrets, and rotate via env when needed):
//   admin (GATE_PW_ADMIN)  — everything, incl. the /admin tracking dashboard
//   user  (GATE_PW_USER)   — everything except tracking, research, data-map
//   basic (GATE_PW_BASIC)  — supply, demand, futures, freight only

export type Tier = "admin" | "user" | "basic";

export const TIER_COOKIE = "tid";        // httpOnly, HMAC-signed "tier.sig"
export const TIER_VIEW_COOKIE = "tierv"; // client-readable, cosmetic only (TabNav)

export function tierForPassword(pw: string): Tier | null {
  const table: Record<string, Tier> = {
    [process.env.GATE_PW_ADMIN ?? "saigonbia"]: "admin",
    [process.env.GATE_PW_USER ?? "kombucha"]: "user",
    [process.env.GATE_PW_BASIC ?? "cocacola"]: "basic",
  };
  return table[pw] ?? null;
}

// Signing secret. Overridable via GATE_SECRET; the fallback is derived from
// the password set, so forging a tier cookie requires knowing a password —
// at which point you could simply log in.
function secret(): string {
  return (
    process.env.GATE_SECRET ??
    `${process.env.GATE_PW_ADMIN ?? "saigonbia"}|${process.env.GATE_PW_USER ?? "kombucha"}|${process.env.GATE_PW_BASIC ?? "cocacola"}|coffee-gate-v1`
  );
}

async function hmacHex(msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signTier(tier: Tier): Promise<string> {
  return `${tier}.${await hmacHex(tier)}`;
}

export async function verifyTier(cookieValue: string | undefined): Promise<Tier | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return null;
  const tier = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (tier !== "admin" && tier !== "user" && tier !== "basic") return null;
  const expect = await hmacHex(tier);
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0 ? (tier as Tier) : null;
}

// ── Route ACL (page navigations only; sub-resources are not gated) ───────────

const BASIC_PREFIXES = ["/supply", "/demand", "/futures", "/freight"];
const USER_BLOCKED = ["/research", "/data-map", "/admin"];

export function pathAllowed(tier: Tier, pathname: string): boolean {
  if (tier === "admin") return true;
  if (tier === "user") return !USER_BLOCKED.some((p) => pathname.startsWith(p));
  return BASIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Where to send a tier when its requested path isn't allowed. */
export function tierHome(tier: Tier): string {
  return tier === "basic" ? "/futures" : "/";
}

/** Tab hrefs a tier may see in the nav (cosmetic — middleware enforces). */
export function tierAllowsTab(tier: Tier | null, href: string): boolean {
  if (!tier) return true; // unknown → render all; middleware still enforces
  return pathAllowed(tier, href);
}
