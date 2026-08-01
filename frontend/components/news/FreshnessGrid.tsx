"use client";
/**
 * "Hot off the press" — every feed from health.json grouped into editorial
 * categories, each a chip showing the TRUE data as-of date. Renders the SAME
 * shared freshness object as the per-tab DataHealthBar (lib/freshness) — one
 * source of truth, two surfaces.
 *
 * Chips prefer data_asof over the pipeline timestamp; monthly periods render
 * as "thru Jun-26"; overdue keys off each feed's publication-lag threshold.
 * Today's refreshes pulse softly so the eye lands on them first.
 */
import { useEffect, useState } from "react";
import {
  FEED_CATEGORIES,
  feedFreshness,
  freshnessLabel,
  freshnessTooltip,
  loadHealth,
  type FeedCategory,
  type FeedFreshness,
  type HealthFile,
} from "@/lib/freshness";
import { getFeedNote } from "@/lib/report/insights";
import Markdown from "@/lib/report/markdown";

// Feed key → briefing chart id whose headline fact best summarises the update.
// Feeds without a mapped insight simply show no datapoint (label + date only).
const FEED_TO_CHART: Record<string, string> = {
  futures: "daily_quotes",
  cot: "cot_overview",
  macro_cot: "cot_global_flow",
  freight: "freight_hcm_eu",
  weather: "origin_weather_all",
  enso: "enso_oni",
  fertilizer_wb: "fertilizer_inputs",
  ecf: "ecf_port_stocks",
  psd_coffee: "brazil_supply_demand",
  ice_certified_daily: "certified_stocks_tiles",
  cecafe_daily: "brazil_daily_registration",
  vietnam_price: "vn_domestic_price",
  brazil_exports: "brazil_monthly_volume",
  vietnam_exports: "vietnam_monthly_volume",
  indonesia_exports: "indonesia_monthly_volume",
  uganda_exports: "uganda_monthly_volume",
  quant_currency_index: "coffee_currency_index",
  retail_cpi: "retail_cpi",
  us_cpi: "us_cpi",
  fx_history: "fx_timeseries",
  origin_prices: "origin_farmgate_prices",
  news_sentiment: "news_sentiment",
  open_direction: "open_direction_calendar",
  port_activity: "port_activity",
  spot_coffee: "spot_tiles",
  us_imports: "us_imports_origin",
  eu_imports: "eu_imports_origin",
  enso_indices: "enso_divergence",
  enso_subsurface: "enso_subsurface",
};

/**
 * Recent activity — the most recently updated feeds, each paired with ONE key
 * datapoint (the headline fact of its briefing chart, same generators as the
 * report's auto-comments). Recent = updated within 3 days; falls back to the
 * 5 most recent so the list is never empty over a weekend.
 */
function RecentActivity({ feeds }: { feeds: FeedFreshness[] }) {
  const [facts, setFacts] = useState<Record<string, string | null>>({});

  const fresh = feeds
    .filter((f) => f.iso)
    .sort((a, b) => (b.iso ?? "").localeCompare(a.iso ?? ""));
  const within3d = fresh.filter((f) => f.days != null && f.days <= 3);
  const shown = (within3d.length >= 3 ? within3d : fresh.slice(0, 5)).slice(0, 8);

  const shownKey = shown.map((f) => f.key).join(",");
  useEffect(() => {
    let alive = true;
    for (const f of shown) {
      const chart = FEED_TO_CHART[f.key];
      if (!chart) continue;
      getFeedNote(chart).then((t) => {
        if (alive && t) setFacts((prev) => (prev[f.key] === t ? prev : { ...prev, [f.key]: t }));
      });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shownKey is shown's identity
  }, [shownKey]);

  if (!shown.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        Recent activity
        <span className="ml-2 font-normal normal-case text-slate-600">latest updates · key datapoints per feed</span>
      </div>
      <ul className="divide-y divide-slate-800">
        {shown.map((f) => (
          <li key={f.key} className="py-1.5 first:pt-0 last:pb-0">
            <div className="flex items-baseline gap-2">
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 self-center ${f.status === "today" ? "bg-emerald-400" : "bg-slate-500"}`} />
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-300" title={freshnessTooltip(f)}>
                {f.meta.label}
              </span>
              <span className="text-[10px] font-mono text-slate-500">{freshnessLabel(f, "long")}</span>
            </div>
            {facts[f.key] && (
              <Markdown className="mt-1 pl-3.5 text-[11px] leading-relaxed text-slate-300 space-y-0.5 [&_ul]:space-y-0.5">
                {facts[f.key]!}
              </Markdown>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Chip tone: binary cascade against the feed's active threshold. Within the
// window = neutral (mid-cycle normal); past it = rose. No gradient — overdue
// is overdue, and the trader needs to see it.
function _tone(f: FeedFreshness): string {
  if (f.status === "missing") return "text-slate-700 border-slate-800 bg-slate-900";
  if (f.status === "today")   return "text-emerald-300 border-emerald-800/60 bg-emerald-950/40";
  if (f.status === "ok")      return "text-slate-300   border-slate-700      bg-slate-900";
  return                             "text-rose-300    border-rose-800/60    bg-rose-950/40";
}

function FeedChip({ f }: { f: FeedFreshness }) {
  const pulse = f.status === "today" ? "animate-pulse-soft" : "";
  return (
    <span
      title={freshnessTooltip(f)}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-mono ${_tone(f)} ${pulse}`}
    >
      <span className="opacity-75 uppercase tracking-wider truncate max-w-[10rem]">{f.meta.label}</span>
      <span>{freshnessLabel(f, "long")}</span>
    </span>
  );
}

export default function FreshnessGrid() {
  const [data, setData] = useState<HealthFile | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [tryCount, setTryCount] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    setNow(new Date());
    // loadHealth retries with backoff and falls back to the session's
    // last-known-good copy — a deploy-window blip shouldn't blank the grid.
    loadHealth().then((d) => { if (alive) { if (d) setData(d); else setError(true); } });
    return () => { alive = false; };
  }, [tryCount]);

  if (!now) return null;
  if (error) {
    return (
      <div className="text-xs text-slate-500 italic flex items-center gap-2">
        <span>Freshness signal temporarily unavailable — health.json could not be loaded.</span>
        <button
          onClick={() => setTryCount((c) => c + 1)}
          className="not-italic px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data) return <div className="text-xs text-slate-500 animate-pulse">Reading freshness…</div>;

  const feeds = Object.keys(data.scrapers ?? {}).map((k) => feedFreshness(data, k, now));

  // Group by editorial category; unknown keys land in "Other" (via FEED_META
  // fallback) so a new scraper never silently disappears.
  const byCategory = new Map<FeedCategory, FeedFreshness[]>();
  for (const cat of FEED_CATEGORIES) byCategory.set(cat, []);
  for (const f of feeds) byCategory.get(f.meta.category)!.push(f);
  for (const list of Array.from(byCategory.values())) {
    list.sort((a, b) => (b.iso ?? "").localeCompare(a.iso ?? ""));
  }

  const nToday = feeds.filter((f) => f.status === "today").length;
  const nStale = feeds.filter((f) => f.status === "stale").length;
  const nMissing = feeds.filter((f) => f.status === "missing").length;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Hot off the press
          <span className="ml-2 font-normal normal-case text-[10px] text-slate-500">
            true data as-of per feed
          </span>
        </h2>
        <div className="text-[10px] text-slate-400 font-mono">
          <span className="text-emerald-300">{nToday}</span> today ·{" "}
          <span className="text-rose-300">{nStale}</span> stale ·{" "}
          <span className="text-slate-500">{nMissing}</span> missing
        </div>
      </div>
      <RecentActivity feeds={feeds} />
      <div className="grid grid-cols-2 gap-3">
        {FEED_CATEGORIES.map((cat) => {
          const list = byCategory.get(cat) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={cat} className="bg-slate-900 border border-slate-700 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{cat}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map((f) => (
                  <FeedChip key={f.key} f={f} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* tiny CSS for a calmer pulse than tailwind's default */}
      <style jsx>{`
        :global(.animate-pulse-soft) {
          animation: pulseSoft 2.4s ease-in-out infinite;
        }
        @keyframes pulseSoft {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
          50%      { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
        }
      `}</style>
    </section>
  );
}
