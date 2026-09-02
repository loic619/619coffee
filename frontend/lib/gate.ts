// Shared access-gate model: password → tier, tier → allowed routes, and the
// HMAC-signed tier cookie. Used by the edge middleware (verification + ACL),
// /api/identify (login), and TabNav (cosmetic tab filtering).
//
// Tiers (one shared password each, from the env). The product story, stated
// by the owner on 2026-09-02, is:
//   basic (GATE_PW_BASIC)  — a guest: any member of the public the owner has
//                            agreed to let in. Every market tab, nothing
//                            behind it: no Research, no Data Map, no admin.
//   user  (GATE_PW_USER)   — a member: everything a guest sees plus Research.
//   admin (GATE_PW_ADMIN)  — the owner: everything, incl. Data Map, the
//                            /admin tracking dashboard, and the admin-only
//                            functions inside Research.
// (Before this, `basic` saw only four tabs and `user` could not open
// Research — the config contradicted the story.)
//
// The passwords used to carry in-repo defaults ("colleague-gate" era). The repo
// was public, so those three strings were world-readable for as long as it was
// — and an unset env var meant the published value still logged you in. They
// are gone: in production a tier with no env password simply has no password
// that works. The dev defaults below are deliberately obvious and only ever
// apply outside production, so a local checkout still runs with zero setup.

export type Tier = "admin" | "user" | "basic";

export const TIER_COOKIE = "tid";        // httpOnly, HMAC-signed "tier.sig"
export const TIER_VIEW_COOKIE = "tierv"; // client-readable, cosmetic only (TabNav)

const DEV_PASSWORDS: Record<Tier, string> = {
  admin: "dev-admin",
  user: "dev-user",
  basic: "dev-basic",
};

export function tierForPassword(pw: string): Tier | null {
  if (!pw) return null;
  const isProd = process.env.NODE_ENV === "production";
  const configured: [Tier, string | undefined][] = [
    ["admin", process.env.GATE_PW_ADMIN ?? (isProd ? undefined : DEV_PASSWORDS.admin)],
    ["user", process.env.GATE_PW_USER ?? (isProd ? undefined : DEV_PASSWORDS.user)],
    ["basic", process.env.GATE_PW_BASIC ?? (isProd ? undefined : DEV_PASSWORDS.basic)],
  ];
  for (const [tier, expected] of configured) {
    if (expected && pw === expected) return tier;
  }
  return null;
}

// Signing secret. MUST come from GATE_SECRET in production.
//
// The old fallback derived the secret from the tier passwords. Those passwords
// ship in this file as in-repo defaults, so the fallback secret was public —
// anyone who could read the repo could compute a valid `tid` and mint
// themselves an admin cookie. That is the whole gate defeated by reading one
// file. There is no safe default for a signing key: a signed cookie is only
// as trustworthy as the secret being unknown to the visitor.
//
// So: require GATE_SECRET. In production its absence is fatal (callers below
// treat a thrown secret() as "deny / cannot issue"), which fails CLOSED — the
// site still serves /welcome, but nobody is admitted until the env is set,
// rather than silently admitting everyone on a guessable key. A fixed dev
// value keeps local runs and tests working without any env.
const DEV_SECRET = "dev-only-insecure-gate-secret-not-for-production";

function secret(): string {
  const s = process.env.GATE_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GATE_SECRET is not set — refusing to sign/verify tiers with a default key");
  }
  return DEV_SECRET;
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
  // A missing secret() throws in production — treat that as "cannot verify,
  // therefore not authenticated" rather than letting it fault the middleware.
  let expect: string;
  try {
    expect = await hmacHex(tier);
  } catch {
    return null;
  }
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0 ? (tier as Tier) : null;
}

// ── Route ACL (page navigations only; sub-resources are not gated) ───────────

// Deny-lists, not allow-lists: a new market tab is visible to everyone by
// default, and only the owner's surfaces have to be named.
const ADMIN_ONLY = ["/data-map", "/admin"];
const MEMBER_AND_UP = ["/research"];

export function pathAllowed(tier: Tier, pathname: string): boolean {
  if (tier === "admin") return true;
  if (ADMIN_ONLY.some((p) => pathname.startsWith(p))) return false;
  if (tier === "user") return true;
  return !MEMBER_AND_UP.some((p) => pathname.startsWith(p));
}

/** Where to send a tier when its requested path isn't allowed. Root is the
 *  Daily Brief, which every tier may open. */
export function tierHome(_tier: Tier): string {
  return "/";
}

/** Tab hrefs a tier may see in the nav (cosmetic — middleware enforces). */
export function tierAllowsTab(tier: Tier | null, href: string): boolean {
  if (!tier) return true; // unknown → render all; middleware still enforces
  return pathAllowed(tier, href);
}
