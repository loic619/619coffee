const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL;
export const API_URL = RAW_API_URL || "http://localhost:8000";

// Browser-side guard: if NEXT_PUBLIC_API_URL was not baked into the build, the
// app will silently try to talk to localhost from the user's machine. Surface
// it loudly in DevTools so misconfigured deploys are obvious.
if (typeof window !== "undefined" && !RAW_API_URL && window.location.hostname !== "localhost") {
  // eslint-disable-next-line no-console
  console.error(
    "[api] NEXT_PUBLIC_API_URL is not set — falling back to http://localhost:8000. " +
    "Set it in your hosting provider's environment variables and redeploy."
  );
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
// Map preserves insertion order — re-inserting a key on hit makes it the most
// recent, so eviction below targets the oldest entry. Bounded so the cache
// can't grow indefinitely on a long-lived tab.
const _cache = new Map<string, { data: unknown; ts: number }>();

// No API call may hang forever. On the server this runs during `next build`,
// where a cold or unresponsive backend used to stall static generation past
// Next's 60 s per-page limit and fail the whole deploy (/freight, the only
// page that fetches at build time, has a committed static fallback that a
// hang never reaches — `.catch()` only fires on rejection, not on a stall).
// Short budget server-side so the build falls back fast; roomier in the
// browser, where a slow response is still better than none.
const API_TIMEOUT_MS = typeof window === "undefined" ? 6_000 : 20_000;

function _timeoutSignal(): AbortSignal | undefined {
  // Guard for runtimes without AbortSignal.timeout (Node <17.3 / older Safari):
  // no signal is the previous behaviour, not a crash.
  try {
    return AbortSignal.timeout(API_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

async function apiGet<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  // `...init` last so an explicit caller signal still wins.
  const res = await fetch(url, { signal: _timeoutSignal(), ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fetch failed: ${res.status} ${url} ${body.slice(0, 200)}`);
  }
  return res.json() as T;
}

async function cachedFetch<T = unknown>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    _cache.delete(url);
    _cache.set(url, hit);
    return hit.data as T;
  }
  const data = await apiGet<T>(path);
  _cache.set(url, { data, ts: Date.now() });
  if (_cache.size > CACHE_MAX_ENTRIES) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  return data;
}

export function clearApiCache(): void {
  _cache.clear();
}

/**
 * Cached fetch for static `/data/*.json` files, sharing the same TTL cache as
 * cachedFetch. Several components (MarketTicker, CoffeeMap, AcapheLiveQuotes)
 * independently read the same static file on a page; this de-duplicates those
 * into one network request within the 5-minute window. Also de-dupes
 * concurrent in-flight requests for the same path.
 */
const _inflight = new Map<string, Promise<unknown>>();
export async function cachedFetchStatic<T = unknown>(path: string): Promise<T> {
  const key = `static:${path}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    _cache.delete(key);
    _cache.set(key, hit);
    return hit.data as T;
  }
  const existing = _inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = (async () => {
    const res = await fetch(path, { signal: _timeoutSignal() });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${path}`);
    const data = (await res.json()) as T;
    _cache.set(key, { data, ts: Date.now() });
    if (_cache.size > CACHE_MAX_ENTRIES) {
      const oldest = _cache.keys().next().value;
      if (oldest !== undefined) _cache.delete(oldest);
    }
    return data;
  })().finally(() => _inflight.delete(key));

  _inflight.set(key, p);
  return p;
}

export interface CountryPin {
  type: string;
  lat: number;
  lng: number;
  name: string;
  data?: { prod?: string; stock?: string; cons?: string; intel?: string };
}

export type FactoryType =
  | "mill"
  | "roastery"
  | "soluble"
  | "decaf"
  | "capsules"
  | "mixed"
  | "unknown";

export interface FactoryPin {
  lat: number;
  lng: number;
  name: string;
  company?: string;
  capacity?: string;
  /** Numeric capacity in kilotonnes/year, parsed from the leading "Xk" in `capacity`. */
  cap_kt?: number | null;
  type?: FactoryType | null;
}

export async function fetchMapCountries(): Promise<CountryPin[]> {
  // Static-first: producer pins are published to /data/countries.json from the
  // supply-tab data. Fall back to the live API if a backend is configured.
  try {
    return await cachedFetchStatic<CountryPin[]>("/data/countries.json");
  } catch {
    return apiGet<CountryPin[]>("/api/map/countries", { cache: "no-store" });
  }
}

export async function fetchMapFactories(): Promise<FactoryPin[]> {
  // Static-first: factory locations are reference data published to
  // /data/factories.json. Fall back to the live API if a backend is configured.
  try {
    return await cachedFetchStatic<FactoryPin[]>("/data/factories.json");
  } catch {
    return apiGet<FactoryPin[]>("/api/map/factories", { cache: "no-store" });
  }
}

export interface NewsItem {
  id: number;
  title: string;
  body: string;
  source: string;
  category: string;
  tags: string[];
  pub_date: string;
  /** Map pin coordinates — present on geo-tagged items, null/missing otherwise. */
  lat?: number | null;
  lng?: number | null;
  /** Free-form JSON or URL stored by scrapers; consumers handle as opaque string. */
  meta?: string | null;
  /** Gemini- or rule-classified bull/bear verdict for this headline.
   *  Present whenever EITHER the deterministic classifier (`classify_sentiment.py`,
   *  covering ICE OI / COT / agronomic / Cecafe / Barchart / ENSO) fired OR
   *  the Gemini classifier saw it in its most-recent batch. Consumers should
   *  render the pill only when present. */
  sentiment?: "Bullish" | "Bearish" | "Neutral";
  sentiment_confidence?: number;
  /** Which path produced the verdict — "deterministic" for rule-based,
   *  "gemini" for LLM. Useful for trust calibration in tooltips. */
  sentiment_method?: "deterministic" | "gemini";
  /** Short rule-fired explanation; only emitted for `sentiment_method === "deterministic"`. */
  sentiment_reason?: string;
}

export async function fetchNews(category?: string): Promise<NewsItem[]> {
  // Static-first: the export publishes the recent feed to /data/news.json
  // (unfiltered), so apply any category filter client-side. Fall back to the
  // live API only if the static file isn't served.
  try {
    const all = await cachedFetchStatic<NewsItem[]>("/data/news.json");
    return category ? all.filter(n => n.category === category) : all;
  } catch {
    const path = category ? `/api/news?category=${encodeURIComponent(category)}` : "/api/news";
    return apiGet<NewsItem[]>(path, { cache: "no-store" });
  }
}

export async function fetchFreight() {
  return cachedFetch("/api/freight");
}

export interface CotMarketRow {
  pmpu_long: number | null;   pmpu_short: number | null;
  swap_long: number | null;   swap_short: number | null;   swap_spread: number | null;
  mm_long: number | null;     mm_short: number | null;     mm_spread: number | null;
  other_long: number | null;  other_short: number | null;  other_spread: number | null;
  nr_long: number | null;     nr_short: number | null;
  oi_total?: number | null;
}

export interface CotWeekly {
  date: string;
  ny:  CotMarketRow | null;
  ldn: CotMarketRow | null;
}

export async function fetchCot(after?: string): Promise<CotWeekly[]> {
  // Static-first: the daily export publishes /data/cot.json (the source of
  // truth for this static-deployed site). Fall back to the live API only if
  // the static file can't be served (e.g. a deploy that does run the backend).
  try {
    const all = await cachedFetchStatic<CotWeekly[]>("/data/cot.json");
    return after ? all.filter(w => w.date > after) : all;
  } catch {
    const path = after ? `/api/cot?after=${encodeURIComponent(after)}` : "/api/cot";
    return cachedFetch(path);
  }
}

export interface MacroCotEntry {
  symbol: string;
  sector: "hard" | "grains" | "meats" | "softs" | "micros";
  name: string;
  mm_long: number;
  mm_short: number;
  mm_spread: number;
  oi_total: number;
  close_price: number | null;
  gross_exposure_usd: number | null;
  net_exposure_usd: number | null;
  // Exchange initial margin × lots (RJO Brien guide eff. 3/14/2026).
  // = (mm_long + mm_short) × outright_rate + mm_spread × spread_rate.
  // Surfaces in Step1GlobalFlow as the "Initial Margin" KPI.
  initial_margin_usd: number | null;
}

export interface MacroCotWeek {
  date: string;
  commodities: MacroCotEntry[];
}

export async function fetchMacroCot(after?: string): Promise<MacroCotWeek[]> {
  // Static-first (see fetchCot): the export publishes /data/macro_cot.json.
  try {
    const all = await cachedFetchStatic<MacroCotWeek[]>("/data/macro_cot.json");
    return after ? all.filter(w => w.date > after) : all;
  } catch {
    const path = after ? `/api/macro-cot?after=${encodeURIComponent(after)}` : "/api/macro-cot";
    return cachedFetch(path);
  }
}
