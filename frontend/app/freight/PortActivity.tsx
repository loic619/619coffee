"use client";
import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useFetchJson } from "@/lib/useFetchJson";
import type { SeasonalRow } from "./FreightCharts";
import { VESSEL_TYPE_META, VESSEL_TYPE_KEYS, type VesselTypeKey } from "./vesselTypes";
import { calIdx, MONTHS } from "./seasonal";

// Heavy recharts bundle — lazy-load (client-only) like the other freight charts.
const SeasonalChart = dynamic(
  () => import("./FreightCharts").then((m) => m.SeasonalChart),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse" /> },
);

const METRICS = [
  { key: "portcalls", label: "Port Calls",        sub: "Arrival of ships · daily count" },
  { key: "import",    label: "Incoming Shipment", sub: "Estimated imports · metric tons" },
  { key: "export",    label: "Outgoing Shipment", sub: "Estimated exports · metric tons" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

type SeriesPoint = { date: string } & Record<string, number | string>;
// Index lists ports without their (heavy) series; the series lives in a
// per-port file fetched on demand.
type PortMeta = {
  key: string; portid: string; name: string; label: string;
  country: string; note: string; start: string; end: string;
};
type Port = PortMeta & { series: SeriesPoint[] };
type PortActivityIndex = {
  updated: string; source: string; dataset: string;
  vessel_types: string[]; ports: PortMeta[];
};

export default function PortActivity() {
  const [portKey, setPortKey] = useState<string>("");
  // Defaults aimed at the coffee question: container exports are the flow
  // that matters at these ports, so open on that rather than on all vessel
  // types and total port calls.
  const [metric, setMetric] = useState<MetricKey>("export");
  // Both views are seasonal calendar overlays: "daily" = per-day; "cumulative"
  // = running total from Jan 1. Cumulative reads better on open — raw daily
  // export tonnage is spiky, so the running total shows the season's pace.
  const [view, setView] = useState<"daily" | "cumulative">("cumulative");
  // Right-hand month chart: how many months back from the latest data month.
  const [monthOffset, setMonthOffset] = useState(0);
  // Which vessel types are shown — toggled via the chips below. Container
  // only by default; the other types are noise for a coffee read, and the
  // Reset control restores all five.
  const [activeTypes, setActiveTypes] = useState<VesselTypeKey[]>(["container"]);
  // Per-port series fetched lazily and cached so re-selecting a port is instant.
  const [portCache, setPortCache] = useState<Record<string, Port>>({});

  const toggleType = (k: VesselTypeKey) =>
    setActiveTypes((cur) =>
      cur.includes(k) ? cur.filter((t) => t !== k) : [...VESSEL_TYPE_KEYS.filter((t) => cur.includes(t) || t === k)],
    );

  // Lightweight index — useFetchJson handles AbortController + error states.
  const { data, loading: idxLoading, error: idxError } =
    useFetchJson<PortActivityIndex>("/data/port_activity/index.json");
  const loaded = !idxLoading || idxError !== null;

  // Seed portKey with the first port once the index has resolved (one-shot).
  useEffect(() => {
    if (data && !portKey) setPortKey(data.ports?.[0]?.key ?? "");
  }, [data, portKey]);

  // Per-port series fetched lazily. Pass null to skip when the cache already
  // holds the series — useFetchJson aborts the previous request when portKey
  // changes mid-flight.
  const needsFetch = portKey && !portCache[portKey];
  const { data: fetchedPort } = useFetchJson<Port>(
    needsFetch ? `/data/port_activity/${portKey}.json` : null,
  );
  useEffect(() => {
    if (fetchedPort) setPortCache((c) => ({ ...c, [fetchedPort.key]: fetchedPort }));
  }, [fetchedPort]);

  const port = portCache[portKey];
  const portMeta = useMemo(
    () => data?.ports.find((p) => p.key === portKey) ?? data?.ports[0],
    [data, portKey],
  );

  const unit = metric === "portcalls" ? "count" : "tons";
  const activeMetric = METRICS.find((m) => m.key === metric)!;

  // Seasonal (year-over-year) data, built once for both views. Each year is
  // aligned on a Jan→Dec calendar index. We produce two row sets:
  //   • daily      — raw per-day total (no smoothing)
  //   • cumulative — running total from Jan 1
  // Each overlays the latest 3 years (current / prev / prev2) and a grey min–max
  // band across the *prior* years (excluding the current year).
  const seasonal = useMemo(() => {
    if (!port) return null;
    const byYear: Record<number, Record<number, number>> = {};   // collapsed daily
    const cumByYear: Record<number, Record<number, number>> = {}; // running total
    const run: Record<number, number> = {};
    // port.series is already date-sorted (scraper orders by year,month,day), so a
    // single forward pass yields a correct running total per year.
    for (const pt of port.series) {
      const [Y, M, D] = pt.date.split("-").map(Number);
      const idx = calIdx(M, D);
      const val = activeTypes.reduce((a, t) => a + (Number(pt[`${metric}_${t}`]) || 0), 0);
      (byYear[Y] ||= {})[idx] = val;
      run[Y] = (run[Y] || 0) + val;
      (cumByYear[Y] ||= {})[idx] = run[Y];
    }
    const allYears = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    if (allYears.length === 0) return null;
    const curY = allYears[allYears.length - 1];
    const prevY = curY - 1;
    const prev2Y = curY - 2;

    const priorYears = allYears.filter((y) => y < curY); // band excludes current year
    const buildRows = (src: Record<number, Record<number, number>>): SeasonalRow[] => {
      const out: SeasonalRow[] = [];
      for (let i = 1; i <= 365; i++) {
        const band = priorYears.map((y) => src[y]?.[i]).filter((v): v is number => v != null);
        out.push({
          idx: i,
          cur: src[curY]?.[i] ?? null,
          prev: src[prevY]?.[i] ?? null,
          prev2: src[prev2Y]?.[i] ?? null,
          band: band.length ? [Math.min(...band), Math.max(...band)] : null,
        });
      }
      return out;
    };
    const rows = buildRows(byYear);     // raw daily counts (no smoothing)
    const cumRows = buildRows(cumByYear);

    // YTD: current year vs prior year over the same elapsed calendar window.
    const curIdxs = Object.keys(byYear[curY]).map(Number);
    const latest = curIdxs.length ? Math.max(...curIdxs) : 0;
    const ytd = (y: number) =>
      Object.entries(byYear[y] || {}).reduce((a, [i, v]) => (Number(i) <= latest ? a + v : a), 0);
    const ytdCur = ytd(curY);
    const ytdPrev = ytd(prevY);
    const ytdPct = ytdPrev > 0 ? ((ytdCur - ytdPrev) / ytdPrev) * 100 : null;

    return {
      rows, cumRows,
      years: { cur: curY, prev: prevY, prev2: prev2Y }, ytdCur, ytdPct,
    };
  }, [port, metric, activeTypes]);

  // Right-hand chart: cumulative within one calendar month, anchored by
  // `monthOffset` months back from the latest data month — so you can scrub
  // back to view the month-to-date of past months. The anchor year is the
  // "current" (red) line; prior years overlay with the grey min–max band.
  const monthly = useMemo(() => {
    if (!port) return null;
    const toIdx = (s: string) => Number(s.slice(0, 4)) * 12 + (Number(s.slice(5, 7)) - 1);
    const latestIdx = toIdx(port.series[port.series.length - 1].date);
    const earliestIdx = toIdx(port.series[0].date);
    const maxOffset = latestIdx - earliestIdx;
    const off = Math.min(Math.max(monthOffset, 0), maxOffset);
    const anchorIdx = latestIdx - off;
    const anchorY = Math.floor(anchorIdx / 12);
    const anchorM = (anchorIdx % 12) + 1;

    const domByYear: Record<number, Record<number, number>> = {};
    const run: Record<number, number> = {};
    let days = 0;
    for (const pt of port.series) {
      if (Number(pt.date.slice(5, 7)) !== anchorM) continue;
      const Y = Number(pt.date.slice(0, 4));
      const D = Number(pt.date.slice(8, 10));
      const val = activeTypes.reduce((a, t) => a + (Number(pt[`${metric}_${t}`]) || 0), 0);
      run[Y] = (run[Y] || 0) + val;
      (domByYear[Y] ||= {})[D] = run[Y];
      if (D > days) days = D;
    }
    const prior = Object.keys(domByYear).map(Number).filter((y) => y < anchorY);
    const rows: SeasonalRow[] = [];
    for (let d = 1; d <= days; d++) {
      const band = prior.map((y) => domByYear[y]?.[d]).filter((v): v is number => v != null);
      rows.push({
        idx: d,
        cur: domByYear[anchorY]?.[d] ?? null,
        prev: domByYear[anchorY - 1]?.[d] ?? null,
        prev2: domByYear[anchorY - 2]?.[d] ?? null,
        band: band.length ? [Math.min(...band), Math.max(...band)] : null,
      });
    }
    // Day-of-month ticks: 1, 5, 10, … plus the last day.
    const ticks = [1];
    for (let d = 5; d < days; d += 5) ticks.push(d);
    if (ticks[ticks.length - 1] !== days) ticks.push(days);

    return {
      rows, ticks, days, off, maxOffset,
      name: MONTHS[anchorM - 1], label: `${MONTHS[anchorM - 1]} ${anchorY}`,
      years: { cur: anchorY, prev: anchorY - 1, prev2: anchorY - 2 },
    };
  }, [port, metric, activeTypes, monthOffset]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
            Port Activity — IMF PortWatch
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Satellite-tracked vessel calls &amp; trade-volume estimates at coffee export gateways
          </div>
        </div>
        {/* Port selector */}
        {data && portMeta && (
          <select
            value={portKey}
            onChange={(e) => setPortKey(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 px-2 py-1 focus:outline-none focus:border-sky-600"
          >
            {data.ports.map((p) => (
              <option key={p.key} value={p.key}>{p.label} · {p.country}</option>
            ))}
          </select>
        )}
      </div>

      {/* Empty / loading state */}
      {!data && (
        <div className="h-[300px] flex items-center justify-center text-slate-500 text-xs text-center px-6">
          {loaded
            ? "Port activity data not yet available — pending the first PortWatch scrape (workflow 1.11)."
            : "Loading port activity…"}
        </div>
      )}

      {data && portMeta && (
        <>
          {/* Metric tabs + view toggle */}
          <div className="flex items-end justify-between gap-2 border-b border-slate-800">
            <div className="flex gap-1">
              {METRICS.map((m) => {
                const on = m.key === metric;
                return (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                      on ? "border-sky-500 text-sky-300" : "border-transparent text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-0.5 mb-1 bg-slate-800 rounded p-0.5">
              {([["daily", "Daily"], ["cumulative", "Cumulative"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2.5 py-0.5 text-[10px] rounded transition-colors ${
                    view === v ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Sub-header: metric description + YTD-vs-prior-year */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[10px] text-slate-500">
              {activeMetric.sub}
              {seasonal && (
                <span className="ml-2 text-slate-400">
                  · {seasonal.years.cur} YTD {unit === "tons"
                      ? `${Math.round(seasonal.ytdCur).toLocaleString("en-US")} t`
                      : `${Math.round(seasonal.ytdCur).toLocaleString("en-US")} calls`}
                  {seasonal.ytdPct != null && (
                    <span className={seasonal.ytdPct >= 0 ? "text-emerald-400 ml-1" : "text-red-400 ml-1"}>
                      ({seasonal.ytdPct >= 0 ? "+" : ""}{seasonal.ytdPct.toFixed(1)}% vs {seasonal.years.prev})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Vessel-type filter — toggle which types are shown/summed */}
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider mr-1">Vessel types</span>
            {VESSEL_TYPE_META.map((t) => {
              const on = activeTypes.includes(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => toggleType(t.key)}
                  aria-pressed={on}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                    on
                      ? "border-slate-600 bg-slate-800 text-slate-200"
                      : "border-slate-800 bg-transparent text-slate-500 hover:text-slate-400"
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: on ? t.color : "transparent", border: `1px solid ${t.color}` }}
                  />
                  {t.label}
                </button>
              );
            })}
            {activeTypes.length !== VESSEL_TYPE_META.length && (
              <button
                onClick={() => setActiveTypes([...VESSEL_TYPE_KEYS])}
                className="ml-1 px-2 py-0.5 text-[10px] rounded-full text-sky-400 hover:text-sky-300"
              >
                Reset
              </button>
            )}
          </div>

          {!port ? (
            <div className="h-[300px] flex items-center justify-center text-slate-500 text-xs animate-pulse">
              Loading {portMeta.label}…
            </div>
          ) : activeTypes.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-slate-500 text-xs">
              Select at least one vessel type to display.
            </div>
          ) : seasonal ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Full-year seasonal (daily or cumulative per the toggle) */}
              <div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                  Full year · {view === "cumulative" ? "cumulative" : "daily"}
                </div>
                <SeasonalChart
                  data={view === "cumulative" ? seasonal.cumRows : seasonal.rows}
                  unit={unit}
                  years={seasonal.years}
                />
              </div>
              {/* Selected month, cumulative day-by-day — scrub back in time with ◀ ▶ */}
              {monthly && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider">
                      {monthly.label} · month-to-date cumulative
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setMonthOffset((o) => Math.min(monthly.maxOffset, o + 1))}
                        disabled={monthly.off >= monthly.maxOffset}
                        aria-label="Previous month"
                        className="px-1.5 py-0.5 text-[11px] leading-none rounded bg-slate-800 text-slate-300 enabled:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ◀
                      </button>
                      <button
                        onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
                        disabled={monthly.off <= 0}
                        aria-label="Next month"
                        className="px-1.5 py-0.5 text-[11px] leading-none rounded bg-slate-800 text-slate-300 enabled:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ▶
                      </button>
                      {monthly.off > 0 && (
                        <button
                          onClick={() => setMonthOffset(0)}
                          className="ml-0.5 px-1.5 py-0.5 text-[9px] rounded text-sky-400 hover:text-sky-300"
                        >
                          Latest
                        </button>
                      )}
                    </div>
                  </div>
                  <SeasonalChart
                    data={monthly.rows}
                    unit={unit}
                    years={monthly.years}
                    xDomain={[1, monthly.days]}
                    xTicks={monthly.ticks}
                    xTickFormat={(d) => `${d}`}
                    xLabelFormat={(d) => `${monthly.name} ${d}`}
                  />
                </div>
              )}
            </div>
          ) : null}

          <div className="text-[9px] text-slate-500 italic border-t border-slate-800 pt-2 flex justify-between flex-wrap gap-1">
            <span>{portMeta.name} ({portMeta.portid}) — {portMeta.note}</span>
            <span>
              Source: {data.source}
              {data.updated && ` · updated ${data.updated.slice(0, 10)}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
