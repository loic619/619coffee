"use client";
/**
 * Per-tab freshness strip. Renders the SAME shared freshness object as the
 * News tab's FreshnessGrid (lib/freshness) — data as-of dates with per-feed
 * publication-lag thresholds — so a feed can never show different freshness
 * on different tabs. Pass `keys` to scope the strip to the tab's feeds.
 */
import { useEffect, useState } from "react";
import {
  FEED_META,
  feedFreshness,
  freshnessLabel,
  freshnessTooltip,
  loadHealth,
  type FeedStatus,
  type HealthFile,
} from "@/lib/freshness";

function dotColor(s: FeedStatus) {
  if (s === "today" || s === "ok") return "bg-green-500";
  if (s === "stale") return "bg-amber-400";
  return "bg-slate-600";
}

export function DataHealthBar({ keys }: { keys?: string[] }) {
  const [health, setHealth] = useState<HealthFile | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    loadHealth().then((d) => d && setHealth(d));
  }, []);

  if (!health || !now) return null;

  const shownKeys = keys ?? Object.keys(FEED_META);
  const items = shownKeys
    .filter((k) => health.scrapers && k in (health.scrapers ?? {}))
    .map((k) => feedFreshness(health, k, now));
  if (!items.length) return null;

  const hasStale = items.some((i) => i.status === "stale");

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 rounded text-[11px] border ${
        hasStale ? "bg-amber-950/30 border-amber-800/40" : "bg-slate-900 border-slate-800"
      }`}
    >
      <span className="text-slate-500 font-medium shrink-0">Data freshness</span>
      {items.map((f) => (
        <span key={f.key} className="flex items-center gap-1" title={freshnessTooltip(f)}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor(f.status)}`} />
          <span className={f.status === "stale" ? "text-amber-400" : "text-slate-400"}>
            {f.meta.label}
            <span className="text-slate-600 ml-0.5">{freshnessLabel(f, "compact")}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
