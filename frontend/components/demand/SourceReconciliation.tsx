"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

interface CtCountry { annual: { year: number; total_mt: number | null }[] }

// Annual reconciliation: a primary national source (USITC/Eurostat) vs UN
// Comtrade, with the year-by-year % gap so the Comtrade global panel can be
// read with that systematic gap in mind. `comtradeKey` is the country key in
// coffee_imports.json (e.g. "usa"); for the EU bloc pass `comtradeSrc` instead.
export default function SourceReconciliation({
  primarySrc, primaryField = "total_by_year", primaryLabel,
  comtradeKey, comtradeSrc, comtradeField = "total_by_year", heading, emptyNote,
}: {
  primarySrc: string; primaryField?: string; primaryLabel: string;
  comtradeKey?: string; comtradeSrc?: string; comtradeField?: string; heading: string;
  emptyNote?: string;
}) {
  const [primary, setPrimary] = useState<Record<string, number> | null>(null);
  const [comtrade, setComtrade] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(primarySrc).then(r => r.json())
      .then(d => setPrimary((d?.[primaryField] as Record<string, number>) ?? {})).catch(() => setErr(true));
    if (comtradeSrc) {
      fetch(comtradeSrc).then(r => r.json())
        .then(d => setComtrade((d?.[comtradeField] as Record<string, number>) ?? {})).catch(() => setErr(true));
    } else {
      fetch("/data/coffee_imports.json").then(r => r.json())
        .then(d => {
          const c: CtCountry | undefined = d?.countries?.[comtradeKey ?? ""];
          const by: Record<string, number> = {};
          for (const a of c?.annual ?? []) if (a.total_mt != null) by[String(a.year)] = a.total_mt;
          setComtrade(by);
        }).catch(() => setErr(true));
    }
  }, [primarySrc, primaryField, comtradeKey, comtradeSrc, comtradeField]);

  const { rows, meanGap } = useMemo(() => {
    const p = primary ?? {}, c = comtrade ?? {};
    // only reconcile years where Comtrade actually has a (non-zero) figure
    const years = Object.keys(p).filter(y => (c[y] ?? 0) > 0).sort();
    const rows = years.map(y => {
      const pk = p[y] / 1000, ck = c[y] / 1000;
      return { year: y, primary: Math.round(pk), comtrade: Math.round(ck),
               gap: pk ? ((ck - pk) / pk) * 100 : 0 };
    });
    const gaps = rows.map(r => r.gap);
    const meanGap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
    return { rows, meanGap };
  }, [primary, comtrade]);

  if (err) return null;
  if (!primary || !comtrade) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading reconciliation…</div>;
  if (rows.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">{heading}</div>
        <p className="text-xs text-slate-400 leading-relaxed">
          {emptyNote ?? `No overlapping UN Comtrade figures to reconcile against ${primaryLabel}.`}
        </p>
      </div>
    );
  }

  const tone = Math.abs(meanGap) < 2 ? "text-emerald-300" : Math.abs(meanGap) < 8 ? "text-amber-300" : "text-red-300";
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">{heading}</div>
        <div className="text-[10px] font-mono text-slate-400">
          mean gap <span className={tone}>{meanGap >= 0 ? "+" : ""}{meanGap.toFixed(1)}%</span>
          <span className="text-slate-600"> (Comtrade vs {primaryLabel})</span>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="kt" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}kt`} width={42} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}%`} width={34} />
            <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) =>
              n === "gap" ? [`${Number(v).toFixed(1)}%`, "gap"]
                : [`${Number(v).toLocaleString()} kt`, n === "primary" ? primaryLabel : "Comtrade"]} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) =>
              v === "primary" ? primaryLabel : v === "comtrade" ? "UN Comtrade" : "gap %"} />
            <Bar yAxisId="kt" dataKey="primary" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
            <Bar yAxisId="kt" dataKey="comtrade" fill="#f59e0b" radius={[2, 2, 0, 0]} />
            <Line yAxisId="pct" dataKey="gap" stroke="#e2e8f0" strokeWidth={1.6} dot={{ r: 2 }} strokeDasharray="3 2" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[9px] text-slate-500 italic mt-1">
        Annual HS-0901 import totals: {primaryLabel} (primary) vs UN Comtrade. A consistent gap means you can read
        Comtrade&rsquo;s global figures with roughly that offset in mind; near-zero means they agree.
      </div>
    </div>
  );
}
