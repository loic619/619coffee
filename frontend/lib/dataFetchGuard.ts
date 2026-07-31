"use client";
/**
 * Global data-fetch guard — THE common resilience layer for static data files.
 *
 * The app reads ~120 `/data/*.json` files from ~85 components, each with its
 * own ad-hoc `fetch().catch(...)`. A transient failure (deploy-window 404,
 * CDN blip, flaky network) therefore blanks whichever panel happened to fetch
 * at the wrong moment. Instead of migrating every call site, this module
 * patches `window.fetch` ONCE for same-origin GET `/data/*.json` requests:
 *
 *   1. RETRY   — up to 3 attempts with backoff (400ms / 800ms). Non-OK counts
 *                as retryable: these are committed static files, so a 404 is
 *                almost always a deploy window, not a real absence.
 *   2. FALLBACK — on success, small payloads (<300 KB) are cached in
 *                sessionStorage; when all attempts fail, the last-known-good
 *                copy is served as a synthetic 200 (header `x-data-guard: lkg`)
 *                so panels keep rendering data from earlier in the session.
 *   3. PASS-THROUGH — everything else (APIs, cross-origin, POSTs) is untouched.
 *
 * Installed via module side-effect on first client import (see
 * components/DataFetchGuard.tsx, mounted in the root layout), so it wraps
 * fetch before any component effect fires. Idempotent by window flag.
 */

declare global {
  interface Window { __dataFetchGuardInstalled?: boolean }
}

const ATTEMPTS = 3;
const BACKOFF_MS = 400;
const MAX_CACHE_BYTES = 300_000;
const LKG_PREFIX = "lkg:";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Same-origin GET for a static data JSON? (relative "/data/…" or same host) */
function isDataRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET") return false;
  const url = urlOf(input);
  if (url.startsWith("/data/")) return url.includes(".json");
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/data/") && u.pathname.endsWith(".json");
  } catch {
    return false;
  }
}

function cacheKey(input: RequestInfo | URL): string {
  const url = urlOf(input);
  try {
    const u = new URL(url, window.location.origin);
    return LKG_PREFIX + u.pathname; // strip cache-busters (?_=…)
  } catch {
    return LKG_PREFIX + url.split("?")[0];
  }
}

function readLkg(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeLkg(key: string, text: string): void {
  if (text.length > MAX_CACHE_BYTES) return;
  try {
    sessionStorage.setItem(key, text);
  } catch {
    // Quota — drop all guard entries and retry once; give up silently after.
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(LKG_PREFIX)) sessionStorage.removeItem(k);
      }
      sessionStorage.setItem(key, text);
    } catch { /* private mode / hard quota */ }
  }
}

export function installDataFetchGuard(): void {
  if (typeof window === "undefined" || window.__dataFetchGuardInstalled) return;
  window.__dataFetchGuardInstalled = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isDataRequest(input, init)) return origFetch(input, init);

    const key = cacheKey(input);
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const r = await origFetch(input, init);
        if (r.ok) {
          // Cache a copy for the fallback path without consuming the body the
          // caller will read.
          r.clone().text().then((t) => writeLkg(key, t)).catch(() => {});
          return r;
        }
        lastResponse = r;
      } catch (err) {
        // AbortError = caller cancelled (unmount/navigation) — respect it.
        if (err instanceof DOMException && err.name === "AbortError") throw err;
      }
      if (attempt < ATTEMPTS - 1) await sleep(BACKOFF_MS * (attempt + 1));
    }

    const cached = readLkg(key);
    if (cached != null) {
      return new Response(cached, {
        status: 200,
        headers: { "Content-Type": "application/json", "x-data-guard": "lkg" },
      });
    }
    // No fallback available — surface the real failure to the caller.
    return lastResponse ?? origFetch(input, init);
  };
}

// Side-effect install on first client import — before any component effect
// can fire a data fetch.
installDataFetchGuard();
