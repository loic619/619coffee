"use client";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

// Monthly import trend (kt) from a `{ "YYYY-MM": mt }` map on a data file.
export default function MonthlyTrend({ src, field = "monthly_total", heading, color = "#0ea5e9" }: {
  src: string; field?: string; heading: string; color?: string;
}) {
  const [map, setMap] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(src).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => setMap((d?.[field] as Record<string, number>) ?? {})).catch(() => setErr(true));
  }, [src, field]);

  const data = useMemo(() =>
    Object.entries(map ?? {})
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, mt]) => ({ m, kt: mt / 1000 })),
  [map]);

  if (err) return null;
  if (!map) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading monthly series…</div>;
  if (data.length === 0) return null;

  const latest = data[data.length - 1];
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">{heading}</div>
        <div className="text-[10px] font-mono text-slate-400">
          latest <span className="text-white">{latest.m}</span>: {Math.round(latest.kt)} kt
        </div>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false}
              minTickGap={28} tickFormatter={(m: string) => m.slice(0, 4)} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={v => `${v}kt`} width={40} />
            <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${Number(v).toFixed(1)} kt`, "Imports"]} />
            <Line dataKey="kt" stroke={color} strokeWidth={1.6} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[9px] text-slate-500 italic mt-1">Monthly net imports, HS 0901 (kt). Gaps = months not yet reported.</div>
    </div>
  );
}
