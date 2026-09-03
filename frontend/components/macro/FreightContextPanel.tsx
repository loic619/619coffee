"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Route {
  id:    string;
  from:  string;
  to:    string;
  rate:  number;
  prev:  number;
  unit:  string;
  proxy: boolean;
}

interface HistoryPoint {
  date: string;
  [routeId: string]: number | string;
}

interface FreightData {
  updated: string;
  routes:  Route[];
  history: HistoryPoint[];
}

function fmtChg(now: number, prev: number): { text: string; cls: string } {
  if (!prev) return { text: "—", cls: "text-slate-500" };
  const v = ((now - prev) / prev) * 100;
  const sign = v >= 0 ? "+" : "";
  const cls  = v >= 0 ? "text-red-400" : "text-emerald-400";
  return { text: `${sign}${v.toFixed(1)}%`, cls };
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 96;
  const H = 24;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.4" points={pts} />
    </svg>
  );
}

export default function FreightContextPanel() {
  const [data,  setData]  = useState<FreightData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/freight.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const histByRoute = useMemo(() => {
    const m: Record<string, number[]> = {};
    if (!data?.history) return m;
    for (const point of data.history) {
      for (const [k, v] of Object.entries(point)) {
        if (k === "date" || typeof v !== "number") continue;
        (m[k] ||= []).push(v);
      }
    }
    return m;
  }, [data]);

  if (error) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Freight data unavailable — freight.json failed to load.
      </div>
    );
  }
  if (!data) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading freight data…</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        {/* This is a SUMMARY of the Freight tab, reading the same file. The
            link makes that explicit — otherwise two surfaces on the same
            subject look like two sources that might disagree. */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-white">Origin Freight Costs</h2>
          <Link href="/freight" className="text-[11px] text-sky-400 hover:text-sky-300 underline underline-offset-2">
            Full lanes, history &amp; dry bulk → Freight tab
          </Link>
        </div>
        <p className="text-xs text-slate-400">
          Container rates from key coffee origins. Rising freight compresses miller and roaster margins;
          the spread between VN-EU and BR-EU is a robusta-vs-arabica logistics arbitrage signal.
          Source: Freightos FBX · as-of {data.updated}
        </p>
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="text-left  px-3 py-2">Route</th>
              <th className="text-right px-3 py-2">Rate</th>
              <th className="text-right px-3 py-2">Unit</th>
              <th className="text-right px-3 py-2">Δ vs prev</th>
              <th className="text-left  px-3 py-2 hidden md:table-cell">Trend (~60 days)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {data.routes.map(r => {
              const chg = fmtChg(r.rate, r.prev);
              const series = histByRoute[r.id];
              return (
                <tr key={r.id} className="hover:bg-slate-800/60">
                  <td className="px-3 py-2 text-slate-200">
                    {r.from} → {r.to}
                    {r.proxy && (
                      <span className="ml-2 text-[9px] uppercase tracking-wide text-slate-500 border border-slate-700 rounded px-1 py-px">
                        proxy
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-100">
                    {r.rate.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-[10px] text-slate-500">{r.unit}</td>
                  <td className={`px-3 py-2 text-right font-mono ${chg.cls}`}>{chg.text}</td>
                  <td className="px-3 py-2 hidden md:table-cell">
                    {series && series.length > 1 ? (
                      <Sparkline values={series} color="#0ea5e9" />
                    ) : (
                      <span className="text-[9px] text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
