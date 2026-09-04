/**
 * "Something new here since you last looked" — the badge logic for tabs,
 * sub-tabs and sections.
 *
 * The signal is health.json, the same file every freshness chip reads: a feed
 * is NEW for a scope when its data changed (data_changed_at, else the pipeline
 * run) after the reader last opened that scope. Last-open times live in
 * localStorage per scope, so the badge is personal to the browser, shows on
 * the first visit (no baseline — everything is new), and clears the moment
 * the scope is opened. No server, no account, nothing to sync.
 *
 * Scopes are strings: "tab:/supply", "supply:brazil", "brazil:exports",
 * "futures:options", "demand:spot", "news:headlines". Each scope lists the
 * feed keys (FEED_META keys) that live on it.
 */
import { useEffect, useState } from "react";
import { loadHealth, type HealthFile } from "@/lib/freshness";

// ── Which feeds live where ──────────────────────────────────────────────────

export const TAB_FEEDS: Record<string, string[]> = {
  "/news":     ["futures", "cot", "ice_certified_daily", "news_sentiment"],
  "/futures":  ["futures", "cot", "macro_cot", "origin_prices"],
  "/cot":      ["cot", "macro_cot"],
  "/freight":  ["freight", "port_activity"],
  "/supply":   ["brazil_exports", "cecafe_daily", "vietnam_exports", "colombia_exports", "indonesia_exports",
                "uganda_exports", "ethiopia_exports", "honduras_exports", "weather", "enso", "enso_indices",
                "enso_subsurface", "fertilizer_wb", "fertilizer_comex", "vn_water", "conab_costs", "conab_safra",
                "vietnam_price"],
  "/demand":   ["ecf", "psd_coffee", "ajca", "population", "ice_certified_daily", "spot_coffee", "us_imports", "eu_imports"],
  "/macro":    ["macro_cot", "freight", "quant_currency_index", "us_cpi", "retail_cpi", "fx_history"],
  "/signals":  ["open_direction", "news_sentiment", "macro_cot"],
  "/map":      ["port_activity", "weather", "origin_prices"],
};

export const SUPPLY_FEEDS: Record<string, string[]> = {
  brazil:      ["brazil_exports", "cecafe_daily", "conab_costs", "conab_safra"],
  vietnam:     ["vietnam_exports", "vietnam_price", "vn_water"],
  colombia:    ["colombia_exports"],
  indonesia:   ["indonesia_exports"],
  ethiopia:    ["ethiopia_exports"],
  honduras:    ["honduras_exports"],
  uganda:      ["uganda_exports"],
  total:       ["brazil_exports", "vietnam_exports", "colombia_exports", "indonesia_exports", "uganda_exports",
                "ethiopia_exports", "honduras_exports"],
  sd:          ["psd_coffee"],
  enso:        ["enso", "enso_indices", "enso_subsurface"],
  fertilizers: ["fertilizer_wb", "fertilizer_comex"],
};

export const BRAZIL_SUBTAB_FEEDS: Record<string, string[]> = {
  "exports":          ["brazil_exports", "cecafe_daily"],
  "supply-demand":    ["psd_coffee", "conab_safra"],
  "farmer-economics": ["conab_costs"],
  "weather":          ["weather"],
  "analogs":          ["weather"],
};

export const FUTURES_TAB_FEEDS: Record<string, string[]> = {
  price:     ["futures", "origin_prices"],
  options:   ["futures"],
  quotation: ["futures", "vietnam_price"],
};

export const DEMAND_TAB_FEEDS: Record<string, string[]> = {
  certified:   ["ice_certified_daily", "ice_arabica_ageing", "ice_robusta_age_allowance"],
  destination: ["ecf", "ajca"],
  spot:        ["spot_coffee"],
  demand:      ["psd_coffee", "population"],
  imports:     ["us_imports", "eu_imports"],
  earnings:    [],
  listed:      [],
};

export const NEWS_SECTION_FEEDS: Record<string, string[]> = {
  headlines: ["news_sentiment"],
};

// ── The rule ────────────────────────────────────────────────────────────────

/** When a feed's content last changed: the release stamp, else the run. */
export function changedAt(health: HealthFile, key: string): string | null {
  return health.data_changed_at?.[key] ?? health.scrapers?.[key] ?? null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const padded = iso.length === 7 ? `${iso}-01` : iso;
  const t = Date.parse(padded);
  return Number.isFinite(t) ? t : null;
}

/** Feed keys that changed after `seenIso` (every stamped key when there is
 *  no baseline yet). */
export function newSince(health: HealthFile | null, keys: string[], seenIso: string | null): string[] {
  if (!health) return [];
  const seen = ms(seenIso);
  return keys.filter((k) => {
    const t = ms(changedAt(health, k));
    return t != null && (seen == null || t > seen);
  });
}

// ── Last-open store (localStorage, per scope) ──────────────────────────────

const PREFIX = "cim:seen:";
const listeners = new Set<() => void>();
let version = 0;

export function readSeen(scope: string): string | null {
  try { return localStorage.getItem(PREFIX + scope); } catch { return null; }
}

export function markSeen(scope: string, iso: string = new Date().toISOString()): void {
  try { localStorage.setItem(PREFIX + scope, iso); } catch { /* private mode — badge just persists */ }
  version++;
  listeners.forEach((fn) => fn());
}

// ── Hooks ───────────────────────────────────────────────────────────────────

let healthPromise: Promise<HealthFile | null> | null = null;
/** One health.json fetch per page load, shared by every badge. */
export function useHealth(): HealthFile | null {
  const [health, setHealth] = useState<HealthFile | null>(null);
  useEffect(() => {
    let alive = true;
    healthPromise ??= loadHealth();
    healthPromise.then((h) => { if (alive) setHealth(h); });
    return () => { alive = false; };
  }, []);
  return health;
}

/** Keys new for `scope` since it was last opened. Opening it (`active`)
 *  records the visit, which clears the badge on this and every other
 *  badge for the same scope. */
export function useNewBadge(scope: string, keys: string[], active: boolean): { count: number; keys: string[] } {
  const health = useHealth();
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((v) => v + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  useEffect(() => {
    if (active) markSeen(scope);
  }, [active, scope]);
  // `version` is read so the memo below is recomputed after every markSeen.
  void version;
  const fresh = active ? [] : newSince(health, keys, readSeen(scope));
  return { count: fresh.length, keys: fresh };
}
