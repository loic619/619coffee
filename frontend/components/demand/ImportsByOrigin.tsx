"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface Origin {
  name: string;
  by_year: Record<string, number>;
  latest_mt: number | null;
}
interface ImportsData {
  updated: string;
  source: string;
  is_seed?: boolean;
  years: number[];
  origins: Origin[];
  total_by_year: Record<string, number>;
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const PALETTE = ["#16a34a", "#f59e0b", "#0ea5e9", "#a855f7", "#ef4444", "#06b6d4", "#84cc16", "#ec4899"];
const fmtKt = (mt: number | null | undefined) => (mt == null ? "—" : `${Math.round(mt / 1000).toLocaleString()} kt`);

// Generic "imports by country of origin" card — used for both USITC (US) and
// Eurostat (EU). `src` is a /data/*.json with {years, origins[], total_by_year}.
export default function ImportsByOrigin({ src, heading, blurb, seedKey }: {
  src: string; heading: string; blurb: string; seedKey?: string;
}) {
  const [data, setData] = useState<ImportsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(src)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, [src]);

  const ranking = useMemo(() =>
    (data?.origins ?? [])
      .map(o => ({ name: o.name, kt: (o.latest_mt ?? 0) / 1000 }))
      .filter(o => o.kt > 0),
  [data]);

  const topNames = useMemo(() => ranking.slice(0, 6).map(r => r.name), [ranking]);
  const trend = useMemo(() => {
    if (!data) return [];
    return data.years.map(y => {
      const row: Record<string, number | string> = { year: y };
      for (const o of data.origins) {
        if (topNames.includes(o.name)) row[o.name] = (o.by_year[String(y)] ?? 0) / 1000;
      }
      return row;
    });
  }, [data, topNames]);

  if (error) return null;
  if (!data) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading import-origin data…</div>;
  if (ranking.length === 0) {
    return <div className="p-4 text-xs text-slate-500">No import-origin data yet — awaiting first scraper pull.</div>;
  }

  const latestYear = data.years[data.years.length - 1];
  const total = data.total_by_year[String(latestYear)];
  const TOP_BAR = 20, TOP_TABLE = 30;
  const rankBar = ranking.slice(0, TOP_BAR);
  const rankTable = ranking.slice(0, TOP_TABLE);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">{heading}</h2>
          <p className="text-xs text-slate-400">{blurb} · {data.source}</p>
        </div>
        <div className="text-[10px] font-mono text-slate-400">
          {latestYear} total: <span className="text-white">{fmtKt(total)}</span>
          <span className="text-slate-600"> · updated {data.updated.slice(0, 10)}</span>
        </div>
      </div>

      {data.is_seed && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          ⚠ Preview/seed figures — replaced by the live pull once the scraper runs
          {seedKey ? <span className="text-amber-300/70"> ({seedKey})</span> : null}.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Imports by country of origin — {latestYear} · top {TOP_BAR} of {ranking.length} (kt)
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankBar} layout="vertical" margin={{ top: 0, right: 14, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} width={84} interval={0} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(0)} kt`, "Imports"]} />
                <Bar dataKey="kt" radius={[0, 2, 2, 0]}>
                  {rankBar.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Top-6 origins — import trend (kt/yr)
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} width={40} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, n: unknown) => [`${Number(v).toFixed(0)} kt`, String(n)]} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {topNames.map((n, i) => (
                  <Line key={n} dataKey={n} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.8} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left  px-2 py-1.5">Origin</th>
              <th className="text-right px-2 py-1.5">{latestYear} imports</th>
              <th className="text-right px-2 py-1.5">Share</th>
            </tr>
          </thead>
          <tbody>
            {rankTable.map((r, i) => (
              <tr key={r.name} className="border-b border-slate-800 hover:bg-slate-800/40">
                <td className="px-2 py-1 text-slate-200 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {r.name}
                </td>
                <td className="px-2 py-1 text-right font-mono text-amber-300">{fmtKt(r.kt * 1000)}</td>
                <td className="px-2 py-1 text-right font-mono text-slate-400">
                  {total ? `${((r.kt * 1000 / total) * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
