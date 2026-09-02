"use client";
/**
 * Freshness — THE single source of truth for data-freshness across the app.
 *
 * One dictionary (FEED_META) + one evaluation function (feedFreshness) shared
 * by every surface that renders freshness:
 *   - FreshnessGrid  ("Hot off the press", News tab)
 *   - DataHealthBar  (per-tab strip via PageHeader / origin tabs)
 * Both render the SAME object, so a feed can never show different freshness on
 * different tabs again.
 *
 * Two date semantics, both carried in health.json:
 *   scrapers[key]  — when the pipeline last ran (ops health)
 *   data_asof[key] — what period the DATA covers (reader-facing freshness);
 *                    written by the health exporter for periodic feeds, falls
 *                    back to scrapers when absent or identical (daily feeds).
 * Displays prefer data_asof; the stale threshold follows: when the data lags
 * the pipeline (a monthly report), dataThresholdDays — the report's real
 * publication lag — replaces thresholdDays.
 */

export const FEED_CATEGORIES = [
  "Futures",
  "COT",
  "Weather",
  "Supply (origins)",
  "Demand & stocks",
  "ENSO",
  "Freight",
  "Fertilizer",
  "Macro",
  "Other",
] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

export interface FeedMeta {
  label: string;
  category: FeedCategory;
  /** Pipeline cadence window (days): past this, the RUN is overdue. */
  thresholdDays: number;
  /** Data-period window (days) for feeds whose data lags the run (publication
   *  lag of the underlying report). Used when data_asof ≠ scrapers. */
  dataThresholdDays?: number;
}

// Cadence conventions:
//   Daily M-F: 4d (weekend skip). Weekly COT: 11d (Fri release of Tue data,
//   worst-case 3+7). Freight: 9d (Fri+Sun publish, weekly index date — see
//   check-scrapers-freshness.yml). Monthly: 35d. Bi-monthly (ECF): 70d.
//   Biannual (USDA coffee PSD, June + December): 210d.
export const FEED_META: Record<string, FeedMeta> = {
  futures:              { label: "Barchart futures", category: "Futures",          thresholdDays: 4 },
  cot:                  { label: "CFTC COT",         category: "COT",              thresholdDays: 11 },
  macro_cot:            { label: "Macro COT",        category: "COT",              thresholdDays: 11 },
  freight:              { label: "Freight rates",    category: "Freight",          thresholdDays: 9 },
  weather:              { label: "Origin weather",   category: "Weather",          thresholdDays: 3 },
  enso:                 { label: "NOAA ENSO ONI",    category: "ENSO",             thresholdDays: 35, dataThresholdDays: 45 },
  fertilizer_wb:        { label: "World Bank fert.", category: "Fertilizer",       thresholdDays: 35, dataThresholdDays: 75 },
  fertilizer_comex:     { label: "Comex fert.",      category: "Fertilizer",       thresholdDays: 35 },
  ecf:                  { label: "ECF stocks",       category: "Demand & stocks",  thresholdDays: 70, dataThresholdDays: 140 }, // Apr data publishes ~mid-Jun; worst-case data age pre-refresh ~4.5mo
  psd_coffee:           { label: "USDA PSD",         category: "Demand & stocks",  thresholdDays: 210 },
  ajca:                 { label: "AJCA Japan",       category: "Demand & stocks",  thresholdDays: 70 },
  // World Bank SP.POP.TOTL — annual (job runs 15 Jul). Matches the 400*24h in
  // check-scrapers-freshness.yml; anything shorter alerts for eleven months.
  population:           { label: "World Bank pop.",   category: "Demand & stocks",  thresholdDays: 400 },
  ice_certified_daily:       { label: "ICE certified daily",   category: "Demand & stocks", thresholdDays: 4 },
  ice_arabica_ageing:        { label: "ICE arabica ageing",    category: "Demand & stocks", thresholdDays: 40 },
  ice_robusta_age_allowance: { label: "ICE robusta age-allow.", category: "Demand & stocks", thresholdDays: 40 },
  conab_costs:          { label: "CONAB costs",      category: "Supply (origins)", thresholdDays: 35 },
  conab_safra:          { label: "CONAB safra",      category: "Supply (origins)", thresholdDays: 35 },
  cecafe_daily:         { label: "Cecafé daily",     category: "Supply (origins)", thresholdDays: 4 },
  brazil_exports:       { label: "BR exports",       category: "Supply (origins)", thresholdDays: 35, dataThresholdDays: 55 },
  colombia_exports:     { label: "CO exports",       category: "Supply (origins)", thresholdDays: 4,  dataThresholdDays: 90 },
  honduras_exports:     { label: "HN exports",       category: "Supply (origins)", thresholdDays: 4,  dataThresholdDays: 120 },
  ethiopia_exports:     { label: "ET exports",       category: "Supply (origins)", thresholdDays: 4,  dataThresholdDays: 120 },
  vietnam_exports:      { label: "VN exports",       category: "Supply (origins)", thresholdDays: 4,  dataThresholdDays: 75 },
  indonesia_exports:    { label: "ID exports",       category: "Supply (origins)", thresholdDays: 4,  dataThresholdDays: 130 },
  // UG freshness now reads uganda_monthly.json's `updated` (stamped when the
  // UCDA scraper runs, scheduled monthly on the 16th) — so the scrape
  // threshold is one cycle + buffer, and the data threshold matches UCDA's
  // publish lag (~6 weeks after month end) + one missed cycle. 45d (not 40):
  // a mid-cycle manual dispatch phase-shifts the stamp, making the healthy
  // worst-case gap ~42d (e.g. run on the 5th → next scheduled write the
  // 16th of the following month). Matches the 45d limit the backend
  // check-scrapers-freshness workflow puts on the same key. The old 4/130
  // pair sat on the export pipeline's daily timestamp and stayed green
  // through a silently-cancelled monthly harvest (Jul 2026).
  uganda_exports:       { label: "UG exports",       category: "Supply (origins)", thresholdDays: 45, dataThresholdDays: 90 },
  vietnam_price:        { label: "VN domestic price", category: "Supply (origins)", thresholdDays: 4 },
  origin_prices:        { label: "Origin price hub", category: "Supply (origins)", thresholdDays: 4 },
  quant_currency_index: { label: "Currency index",   category: "Macro",            thresholdDays: 4 },
  retail_cpi:           { label: "Retail CPI",       category: "Macro",            thresholdDays: 35, dataThresholdDays: 75 },
  us_cpi:               { label: "US CPI",           category: "Macro",            thresholdDays: 45, dataThresholdDays: 75 },
  fx_history:           { label: "FX history",       category: "Macro",            thresholdDays: 4 },
  // Newer feature feeds (news-desk revamp)
  news_sentiment:       { label: "News sentiment",   category: "Macro",            thresholdDays: 4,  dataThresholdDays: 6 },
  open_direction:       { label: "Open-direction log", category: "Macro",          thresholdDays: 4 },
  port_activity:        { label: "Port activity",    category: "Freight",          thresholdDays: 9,  dataThresholdDays: 18 }, // weekly Wed fetch; PortWatch lags ~1wk + tolerate one missed cron
  spot_coffee:          { label: "Spot offers (ATTE)", category: "Demand & stocks", thresholdDays: 9, dataThresholdDays: 12 }, // weekly Mon
  us_imports:           { label: "US imports",       category: "Demand & stocks",  thresholdDays: 35, dataThresholdDays: 100 }, // USITC monthly, ~2mo lag
  eu_imports:           { label: "EU imports",       category: "Demand & stocks",  thresholdDays: 35, dataThresholdDays: 100 }, // Eurostat monthly, ~2mo lag
  enso_indices:         { label: "Niño3.4 / SOI",    category: "ENSO",             thresholdDays: 9,  dataThresholdDays: 14 }, // weekly Tue CPC
  enso_subsurface:      { label: "Subsurface WWV",   category: "ENSO",             thresholdDays: 35, dataThresholdDays: 60 }, // monthly PMEL
  vn_water:             { label: "VN river flow",    category: "Weather",          thresholdDays: 9 }, // NCHMF bulletins
};

export interface HealthFile {
  generated_at?: string | null;
  scrapers?: Record<string, string | null>;
  data_asof?: Record<string, string | null>;
  /** When each feed's DATA PERIOD last changed — i.e. when a release actually
   *  landed, as opposed to the scraper merely re-running. Absent on old files. */
  data_changed_at?: Record<string, string | null>;
  exporters?: Record<string, string | null>;
}

/**
 * Load health.json. Retry + last-known-good fallback are provided by the
 * GLOBAL data-fetch guard (lib/dataFetchGuard — installed app-wide in the
 * root layout), so this stays a single attempt with shape validation.
 */
export async function loadHealth(): Promise<HealthFile | null> {
  try {
    const r = await fetch(`/data/health.json?_=${Date.now()}`);
    if (!r.ok) return null;
    const d = (await r.json()) as HealthFile;
    return d && typeof d === "object" && d.scrapers ? d : null;
  } catch {
    return null;
  }
}

export type FeedStatus = "today" | "ok" | "stale" | "missing";

export interface FeedFreshness {
  key: string;
  meta: FeedMeta;
  /** Reader-facing date: data_asof || scrapers. Month grain = "YYYY-MM". */
  iso: string | null;
  /** Pipeline run date (scrapers). */
  pipelineIso: string | null;
  /** True when the data period lags the pipeline run (periodic report). */
  lagging: boolean;
  /** Age of `iso` in whole days (month grain anchored to day 28). */
  days: number | null;
  /** When a NEW data period last landed (release), and its age in days.
   *  Null when the exporter hasn't recorded one yet. */
  dataChangedIso: string | null;
  dataChangedDays: number | null;
  /** Age of the PIPELINE run in whole days — "when did this feed last
   *  refresh", which is what "recent activity" means. Distinct from `days`
   *  (the data period's age) for periodic feeds. */
  pipelineDays: number | null;
  /** The threshold that applies (dataThresholdDays when lagging). */
  thresholdDays: number;
  status: FeedStatus;
}

export function ageDays(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const padded = iso.length === 7 ? `${iso}-28` : iso;
  const t = new Date(padded).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

const FALLBACK_META: FeedMeta = { label: "", category: "Other", thresholdDays: 30 };

/** THE evaluation — every surface derives its display from this object. */
export function feedFreshness(health: HealthFile, key: string, now: Date): FeedFreshness {
  const meta = FEED_META[key] ?? { ...FALLBACK_META, label: key };
  const pipelineIso = health.scrapers?.[key] ?? null;
  const iso = health.data_asof?.[key] ?? pipelineIso;
  const lagging = !!iso && !!pipelineIso && iso !== pipelineIso;
  const thresholdDays = lagging ? (meta.dataThresholdDays ?? meta.thresholdDays) : meta.thresholdDays;
  const days = ageDays(iso, now);
  const pipelineDays = ageDays(pipelineIso, now);
  const dataChangedIso = health.data_changed_at?.[key] ?? null;
  const dataChangedDays = ageDays(dataChangedIso, now);
  const status: FeedStatus =
    days == null ? "missing" : days === 0 ? "today" : days <= thresholdDays ? "ok" : "stale";
  return { key, meta, iso, pipelineIso, lagging, days, pipelineDays, dataChangedIso, dataChangedDays, thresholdDays, status };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Display string for a freshness date. Month periods ("2026-06") render as
 *  the data window ("thru Jun-26"); timestamps render as relative age —
 *  "long" = "today / 2d ago / 3mo ago", "compact" = "3h / 2d / 3mo". */
export function freshnessLabel(f: Pick<FeedFreshness, "iso" | "days">, style: "long" | "compact" = "long"): string {
  const { iso, days } = f;
  if (!iso) return "—";
  if (iso.length === 7) {
    const [y, m] = iso.split("-").map(Number);
    return `thru ${MON[(m || 1) - 1]}-${String(y).slice(2)}`;
  }
  if (days == null) return "—";
  if (style === "compact") {
    const h = (Date.now() - Date.parse(iso)) / 3_600_000;
    if (Number.isFinite(h) && h < 24) return h < 1 ? `${Math.round(h * 60)}m` : `${Math.round(h)}h`;
    if (days <= 60) return `${days}d`;
    return `${Math.round(days / 30)}mo`;
  }
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days <= 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** Hover text: data date + pipeline date when they differ + the active window. */
export function freshnessTooltip(f: FeedFreshness): string {
  if (!f.iso) return `${f.meta.label} · no data`;
  return (
    `${f.meta.label} · data as-of ${f.iso} (${freshnessLabel(f, "long")})` +
    (f.lagging ? `\npipeline last ran ${String(f.pipelineIso).slice(0, 10)}` : "") +
    `\noverdue after ${f.thresholdDays}d`
  );
}
