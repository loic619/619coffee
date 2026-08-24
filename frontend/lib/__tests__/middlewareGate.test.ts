/**
 * Regression test for the data gate.
 *
 * The audit's finding was that /data/*.json and /api/* were served to anonymous
 * visitors because the gate only inspected page NAVIGATIONS. These tests drive
 * the real middleware and assert the shape of the fix, so a future "skip
 * sub-resources" optimisation cannot quietly re-open it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { signTier } from "@/lib/gate";

const ORIGIN = "https://example.test";

beforeEach(() => {
  vi.unstubAllEnvs();
  process.env.GATE_SECRET = "middleware-test-secret";
  delete process.env.SITE_GATE_ENABLED;
  // No Upstash in tests → logAccess() short-circuits, so nothing is logged.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

/** A request as a scripted fetch would make it (this is how the audit probed). */
function anon(path: string, dest = "empty"): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: { "user-agent": "Mozilla/5.0", "sec-fetch-dest": dest },
  });
}

async function signedIn(path: string, tier: "admin" | "user" | "basic", dest = "empty") {
  const req = anon(path, dest);
  req.cookies.set("cid", "Test User");
  req.cookies.set("tid", await signTier(tier));
  return req;
}

const DATA_PATHS = [
  "/data/news.json",
  "/data/latest_prices.json",
  "/data/factories.json",
  "/data/countries.json",
];

describe("anonymous access to the data surface", () => {
  it.each(DATA_PATHS)("%s is refused with 401, not served", async (path) => {
    const res = await middleware(anon(path));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
  });

  it("refuses API routes too", async () => {
    for (const p of ["/api/live", "/api/refresh-acaphe", "/api/vietnam-last"]) {
      expect((await middleware(anon(p))).status).toBe(401);
    }
  });

  it("answers with JSON rather than redirecting — these are fetched by scripts", async () => {
    const res = await middleware(anon("/data/news.json"));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("still refuses when the request looks like a document navigation", async () => {
    // The old gate keyed on sec-fetch-dest; a hand-crafted request could claim
    // to be anything. Neither value may yield data.
    expect((await middleware(anon("/data/news.json", "document"))).status).toBe(401);
  });

  it("rejects a forged tier cookie", async () => {
    const req = anon("/data/news.json");
    req.cookies.set("cid", "Mallory");
    req.cookies.set("tid", "admin.0000000000000000000000000000000000000000000000000000000000000000");
    expect((await middleware(req)).status).toBe(401);
  });

  it("leaves the login surface reachable", async () => {
    for (const p of ["/welcome", "/api/identify"]) {
      expect((await middleware(anon(p, "document"))).status).not.toBe(401);
    }
  });
});

describe("signed-in access is unaffected", () => {
  it.each(DATA_PATHS)("%s is served to a signed-in visitor", async (path) => {
    const res = await middleware(await signedIn(path, "admin"));
    expect(res.status).not.toBe(401);
  });

  it("every tier can read data (this is a login gate, not per-tier isolation)", async () => {
    for (const tier of ["admin", "user", "basic"] as const) {
      const res = await middleware(await signedIn("/data/news.json", tier));
      expect(res.status).not.toBe(401);
    }
  });
});

describe("fail-closed when GATE_SECRET is missing in production", () => {
  it("a previously valid cookie no longer opens the data surface", async () => {
    const req = await signedIn("/data/news.json", "admin");
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.GATE_SECRET;
    expect((await middleware(req)).status).toBe(401);
  });
});

describe("the kill switch still works", () => {
  it("SITE_GATE_ENABLED=false opens everything again", async () => {
    // GATE_ENABLED is a module-level const, so the env has to be set before the
    // module is evaluated — hence resetModules + a fresh dynamic import rather
    // than assigning process.env inside the test body.
    vi.resetModules();
    process.env.SITE_GATE_ENABLED = "false";
    const { middleware: openMiddleware } = await import("@/middleware");
    expect((await openMiddleware(anon("/data/news.json"))).status).not.toBe(401);
    delete process.env.SITE_GATE_ENABLED;
    vi.resetModules();
  });
});
