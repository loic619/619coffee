"use client";
import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import PageHeader from "@/components/PageHeader";
import { useFetchJson } from "@/lib/useFetchJson";
import PortActivity from "./PortActivity";

// Charts carry the heavy recharts dependency — lazy-load them (client-only) so
// they stay out of the page's initial bundle. The page chrome renders first.
const FreightHistoryChart = dynamic(
  () => import("./FreightCharts").then((m) => m.FreightHistoryChart),
  { ssr: false, loading: () => <ChartFallback height={260} /> },
);
const DryBulkChart = dynamic(
  () => import("./FreightCharts").then((m) => m.DryBulkChart),
  { ssr: false, loading: () => <ChartFallback height={180} /> },
);

function ChartFallback({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-slate-500 text-[10px] animate-pulse"
      style={{ height }}>
      Loading chart…
    </div>
  );
}

type FreightRoute = {
  id: string;
  from: string;
  to: string;
  rate: number;
  prev: number;
  unit: string;
  proxy: boolean;
};

// One published FBX tradelane, straight from the index — no multiplier, no
// derivation. Distinct from FreightRoute, which is a coffee corridor that may
// be an estimate scaled off one of these.
type FbxIndex = {
  code: string;
  name: string;
  rate: number;
  date: string;
  prev: number | null;
  prev_date: string | null;
};

export type FreightData = {
  updated: string;
  routes: FreightRoute[];
  history: Record<string, number | string>[];
  indices?: FbxIndex[];
};

interface DryBulkData {
  ticker: string; name: string; description: string;
  last_price: number; last_date: string;
  mom_pct: number | null; wow_pct: number | null;
  week52_low: number | null; week52_high: number | null;
  series: { date: string; close: number }[];
  source: string;
}

interface Props { data: FreightData | null; }

function BdryPanel({ data }: { data: DryBulkData }) {
  const chartData = useMemo(() => {
    const s = data.series;
    const step = Math.max(1, Math.floor(s.length / 26));
    const sampled: { label: string; close: number }[] = [];
    for (let i = 0; i < s.length; i += step)
      sampled.push({ label: s[i].date.slice(5), close: s[i].close });
    if (sampled[sampled.length - 1]?.label !== s[s.length - 1].date.slice(5))
      sampled.push({ label: s[s.length - 1].date.slice(5), close: s[s.length - 1].close });
    return sampled;
  }, [data]);

  const momColor = data.mom_pct == null ? "#64748b" : data.mom_pct >= 0 ? "#22c55e" : "#ef4444";
  const wowColor = data.wow_pct == null ? "#64748b" : data.wow_pct >= 0 ? "#22c55e" : "#ef4444";
  const w52Range = data.week52_high != null && data.week52_low != null ? data.week52_high - data.week52_low : null;
  const w52Pos   = w52Range && w52Range > 0 ? ((data.last_price - (data.week52_low ?? 0)) / w52Range) * 100 : null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
            Dry Bulk Freight · {data.ticker}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">{data.description}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-mono font-bold text-slate-100">${data.last_price.toFixed(2)}</div>
          <div className="text-[9px] font-mono" style={{ color: momColor }}>
            {data.mom_pct != null ? `${data.mom_pct >= 0 ? "+" : ""}${data.mom_pct}% MoM` : "—"}
          </div>
        </div>
      </div>

      {w52Pos != null && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[8px] text-slate-500 font-mono">
            <span>52w L ${data.week52_low?.toFixed(2)}</span>
            <span>52w H ${data.week52_high?.toFixed(2)}</span>
          </div>
          <div className="relative h-2 bg-slate-800 rounded-full">
            <div className="absolute h-full bg-blue-500/30 rounded-full" style={{ width: `${w52Pos}%` }} />
            <div className="absolute w-2 h-2 bg-blue-400 rounded-full top-0 -translate-x-1/2" style={{ left: `${Math.min(98, w52Pos)}%` }} />
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <DryBulkChart chartData={chartData} ticker={data.ticker} />
      )}

      <div className="grid grid-cols-3 gap-3 text-[9px] font-mono border-t border-slate-800 pt-2">
        <div>
          <div className="text-slate-500">WoW</div>
          <div style={{ color: wowColor }}>
            {data.wow_pct != null ? `${data.wow_pct >= 0 ? "+" : ""}${data.wow_pct}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-slate-500">As of</div>
          <div className="text-slate-400">{data.last_date}</div>
        </div>
        <div>
          <div className="text-slate-500">Exchange</div>
          <div className="text-slate-400">NYSE Arca</div>
        </div>
      </div>

      <div className="text-[9px] text-slate-500 italic border-t border-slate-800 pt-2">
        Rising {data.ticker} → tighter dry bulk freight → higher CIF fertilizer cost into Brazil.
        Tracks Capesize + Supramax freight futures. Source: {data.source}.
      </div>
    </div>
  );
}

// The twelve lanes Freightos publishes, as published. None of them is a coffee
// corridor — FBX has no South America → Europe leg and nothing out of Africa —
// so this sits below the route table rather than replacing it: it is the raw
// source, useful for seeing whether a move in the coffee estimates is a real
// ocean-freight move or an artefact of the one index they are scaled from.
function FbxIndexTable({ indices }: { indices: FbxIndex[] }) {
  const rows = useMemo(
    () => [...indices].sort((a, b) => a.code.localeCompare(b.code)),
    [indices],
  );

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
        <span className="text-xs font-semibold text-slate-300">FBX Tradelanes — All Published Indices</span>
        <span className="text-[10px] text-slate-500 ml-3">40ft container · Freightos Baltic Index</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-slate-500 bg-slate-800/40">
              <th className="text-left px-4 py-2">Index</th>
              <th className="text-left px-4 py-2">Lane</th>
              <th className="text-right px-4 py-2">Rate</th>
              <th className="text-right px-4 py-2">Prev</th>
              <th className="text-right px-4 py-2">Chg</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">As of</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const chg = r.prev == null ? null : r.rate - r.prev;
              const pct = r.prev ? (chg! / r.prev) * 100 : null;
              // Freight is a cost: falling is the friendly direction.
              const chgColor = chg == null ? "text-slate-600" : chg <= 0 ? "text-emerald-400" : "text-red-400";
              return (
                <tr key={r.code} className="border-t border-slate-800 text-slate-300">
                  <td className="px-4 py-2 text-slate-400">{r.code}</td>
                  <td className="px-4 py-2 font-sans">{r.name}</td>
                  <td className="px-4 py-2 text-right font-bold text-sky-300">
                    ${r.rate.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {r.prev == null ? "—" : `$${r.prev.toLocaleString("en-US")}`}
                  </td>
                  <td className={`px-4 py-2 text-right font-bold ${chgColor}`}>
                    {chg == null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toLocaleString("en-US")}`}
                    {pct != null && (
                      <span className="ml-1 text-[9px] font-normal opacity-70">
                        {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500 whitespace-nowrap">{r.date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-slate-800 text-[9px] text-slate-500 italic">
        Every lane FBX publishes. None covers a coffee export corridor — there is no South America → Europe
        and no African index — so the corridors above marked <span className="not-italic">~est.</span> are these
        numbers scaled, not quotes. Prev is the most recent observation at least seven days old; the index is
        scraped Fri &amp; Sun, so the comparison span varies.
      </div>
    </div>
  );
}

export default function FreightClient({ data }: Props) {
  const { data: farmerEcon, loading: dryLoading, error: dryError } =
    useFetchJson<{ fertilizer?: { dry_bulk?: DryBulkData } }>("/data/farmer_economics.json");
  const dryBulk: DryBulkData | null = farmerEcon?.fertilizer?.dry_bulk ?? null;
  const dryLoaded = !dryLoading || dryError !== null;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Freight"
        subtitle="Container & dry-bulk freight indicators"
        healthKeys={["freight"]}
      />
      <div className="p-6 space-y-4">

      {/* Container freight chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">
          Freight Rate Evolution — USD / FEU
        </div>
        {data?.updated && (
          <div className="text-[10px] text-slate-500 mb-3">Last updated: {data.updated}</div>
        )}

        {(!data || data.history.length === 0) && (
          <div className="h-[260px] flex items-center justify-center text-slate-500 text-xs">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {data && data.history.length > 0 && (
          <FreightHistoryChart history={data.history} />
        )}
      </div>

      {/* Route table */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
          <span className="text-xs font-semibold text-slate-300">Current Spot Rates — Coffee Corridors</span>
          <span className="text-[10px] text-slate-500 ml-3">40ft container · FBX index</span>
        </div>

        {(!data || data.routes.length === 0) && (
          <div className="px-4 py-6 text-xs text-slate-500">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {data && data.routes.length > 0 && (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-slate-500 bg-slate-800/40">
                <th className="text-left px-4 py-2">Origin</th>
                <th className="text-left px-4 py-2">Destination</th>
                <th className="text-right px-4 py-2">Rate</th>
                <th className="text-right px-4 py-2">Prev</th>
                <th className="text-right px-4 py-2">Chg</th>
                <th className="text-right px-4 py-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.map((r) => {
                const chg = r.rate - r.prev;
                const chgColor = chg <= 0 ? "text-emerald-400" : "text-red-400";
                return (
                  <tr key={r.id} className="border-t border-slate-800 text-slate-300">
                    <td className="px-4 py-2">{r.from}</td>
                    <td className="px-4 py-2">
                      {r.to}
                      {r.proxy && <span className="ml-1 text-[9px] text-slate-500 font-sans">~est.</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-sky-300">
                      ${r.rate.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      ${r.prev.toLocaleString("en-US")}
                    </td>
                    <td className={`px-4 py-2 text-right font-bold ${chgColor}`}>
                      {chg >= 0 ? "+" : ""}{chg.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{r.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Every published FBX lane, unscaled */}
      {data?.indices && data.indices.length > 0 && (
        <FbxIndexTable indices={data.indices} />
      )}

      {/* Port activity — IMF PortWatch */}
      <PortActivity />

      {/* Dry bulk freight indicator */}
      {dryBulk ? (
        <BdryPanel data={dryBulk} />
      ) : (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-[10px] text-slate-500 italic">
          {dryLoaded
            ? "Dry bulk freight indicator not yet available — pending the next dry-bulk scrape."
            : "Loading dry bulk indicator…"}
        </div>
      )}
      </div>
    </div>
  );
}
