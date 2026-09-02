import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pathAllowed, signTier, tierForPassword, verifyTier } from "@/lib/gate";

// A stable secret for the signing tests so they don't depend on process env.
const OLD_ENV = { ...process.env };
beforeEach(() => {
  process.env.GATE_SECRET = "test-secret";
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllEnvs();
});

describe("tier cookie signing", () => {
  it("round-trips a signed tier", async () => {
    for (const t of ["admin", "user", "basic"] as const) {
      expect(await verifyTier(await signTier(t))).toBe(t);
    }
  });

  it("rejects a forged cookie (right tier, wrong signature)", async () => {
    expect(await verifyTier("admin.deadbeef")).toBeNull();
    expect(await verifyTier("admin.")).toBeNull();
    expect(await verifyTier("admin")).toBeNull();
  });

  it("rejects an unknown tier even if the signature format looks valid", async () => {
    const forged = await signTier("admin");
    const swapped = forged.replace(/^admin/, "superadmin");
    expect(await verifyTier(swapped)).toBeNull();
  });

  it("a cookie signed under a DIFFERENT secret does not verify", async () => {
    process.env.GATE_SECRET = "attacker-guess";
    const forged = await signTier("admin");
    process.env.GATE_SECRET = "test-secret";
    expect(await verifyTier(forged)).toBeNull();
  });

  it("empty / malformed input is denied, not thrown", async () => {
    expect(await verifyTier(undefined)).toBeNull();
    expect(await verifyTier("")).toBeNull();
    expect(await verifyTier("nonsense")).toBeNull();
  });
});

describe("secret hardening", () => {
  it("in production, a missing GATE_SECRET denies rather than falling back", async () => {
    // The old behaviour derived the secret from the in-repo passwords, so an
    // attacker who read the repo could forge a cookie. Now: no secret in prod
    // means verification cannot succeed at all — fail closed.
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.GATE_SECRET;
    const anything = "admin.0000000000000000000000000000000000000000000000000000000000000000";
    expect(await verifyTier(anything)).toBeNull();
    // And even a cookie that WAS validly signed cannot be re-verified without
    // the secret, so nobody is admitted on the default key.
  });
});

describe("route ACL", () => {
  it("basic (guest) sees every market tab but nothing behind it", () => {
    for (const p of ["/", "/news", "/futures", "/cot", "/freight", "/supply/brazil", "/demand", "/macro", "/map"]) {
      expect(pathAllowed("basic", p), p).toBe(true);
    }
    expect(pathAllowed("basic", "/research")).toBe(false);
    expect(pathAllowed("basic", "/data-map")).toBe(false);
    expect(pathAllowed("basic", "/admin")).toBe(false);
  });
  it("user (member) adds Research, still not the owner's surfaces", () => {
    expect(pathAllowed("user", "/futures")).toBe(true);
    expect(pathAllowed("user", "/research")).toBe(true);
    expect(pathAllowed("user", "/data-map")).toBe(false);
    expect(pathAllowed("user", "/admin")).toBe(false);
  });
  it("admin sees everything", () => {
    for (const p of ["/", "/research", "/admin", "/data-map", "/anything"]) {
      expect(pathAllowed("admin", p)).toBe(true);
    }
  });
});

describe("password → tier", () => {
  it("maps configured passwords and rejects the rest", () => {
    process.env.GATE_PW_ADMIN = "pw-a";
    process.env.GATE_PW_USER = "pw-u";
    process.env.GATE_PW_BASIC = "pw-b";
    expect(tierForPassword("pw-a")).toBe("admin");
    expect(tierForPassword("pw-u")).toBe("user");
    expect(tierForPassword("pw-b")).toBe("basic");
    expect(tierForPassword("wrong")).toBeNull();
    expect(tierForPassword("")).toBeNull();
  });

  it("the burned in-repo passwords no longer work anywhere", () => {
    // These three shipped as defaults while the repo was public.
    for (const env of [{}, { NODE_ENV: "production" }]) {
      Object.assign(process.env, env);
      delete process.env.GATE_PW_ADMIN;
      delete process.env.GATE_PW_USER;
      delete process.env.GATE_PW_BASIC;
      for (const pw of ["saigonbia", "kombucha", "cocacola"]) {
        expect(tierForPassword(pw)).toBeNull();
      }
    }
  });

  it("in production, a tier with no env password has no working password", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.GATE_PW_ADMIN;
    delete process.env.GATE_PW_USER;
    delete process.env.GATE_PW_BASIC;
    for (const pw of ["dev-admin", "dev-user", "dev-basic", "", "anything"]) {
      expect(tierForPassword(pw)).toBeNull();
    }
  });
});
