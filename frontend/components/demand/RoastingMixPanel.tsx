"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface RegionEntry {
  name: string;
  total_kt: number;
  by_type: Record<string, number>;
}

interface FactoryMix {
  generated_at: string;
  total_kt: number;
  global_by_type: Record<string, number>;
  regions: RegionEntry[];
  note?: string;
}

// ICO's world consumption reference (kt/yr), the same 2023/24 figure the
// coverage tile uses — kept here only to express what the tracked total is a
// share of. Not a precise ratio: capacity and consumption are different things.
const ICO_WORLD_KT = 10_620;

const TYPE_ORDER = ["roastery", "mixed", "soluble", "capsules", "decaf"] as const;
const TYPE_LABELS: Record<string, string> = {
  roastery: "Roasted",
  mixed:    "Mixed site",
  soluble:  "Soluble",
  capsules: "Capsules",
  decaf:    "Decaf",
};
const TYPE_COLORS: Record<string, string> = {
  roastery: "#7c2d12",
  mixed:    "#6366f1",
  soluble:  "#fde68a",
  capsules: "#94a3b8",
  decaf:    "#16a34a",
};

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

function fmtKt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}Mt`;
  return `${Math.round(n)}kt`;
}

export default function RoastingMixPanel() {
  const [data, setData] = useState<FactoryMix | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/factory_mix.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Roasting-mix data not yet available — requires scraper run.
      </div>
    );
  }
  if (!data) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading roasting-mix data…</div>;

  // Stacked bar: x = region, y = total kt, segments = type
  const chartData = data.regions.map(r => ({
    region: r.name,
    ...r.by_type,
    total: r.total_kt,
  }));

  // Global type-share percentages
  const total = data.total_kt;
  const globalShare = TYPE_ORDER.map(t => ({
    type:  t,
    label: TYPE_LABELS[t],
    color: TYPE_COLORS[t],
    kt:    data.global_by_type[t] ?? 0,
    pct:   total > 0 ? ((data.global_by_type[t] ?? 0) / total) * 100 : 0,
  })).filter(g => g.kt > 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Global Roasting Mix</h2>
          <p className="text-xs text-slate-400">
            Consumer-side capacity structure — roasted · mixed · soluble · capsules · decaf
          </p>
        </div>
        <div className="text-[10px] text-slate-500 font-mono text-right">
          <div>{fmtKt(total)} tracked · {data.regions.length} regions</div>
          {/* A bare "5.7 Mt tracked" invites being read as world capacity. It is
              a hand-maintained plant seed, so say what it is a share OF. */}
          {ICO_WORLD_KT > 0 && (
            <div className="text-slate-600">
              ≈{Math.round((total / ICO_WORLD_KT) * 100)}% of world consumption · named plants only
            </div>
          )}
        </div>
      </div>

      {/* Global type-share strip */}
      <div className="space-y-1">
        {/* "Mixed" is a multi-product SITE, not a product — it is the fifth of
            capacity that a plant-level seed cannot split. Calling the strip
            "by end-product" implied it was one. */}
        <div className="text-[9px] text-slate-500 uppercase tracking-wide">Global share by plant output</div>
        <div className="flex h-3 rounded-sm overflow-hidden bg-slate-900 border border-slate-700">
          {globalShare.map(g => (
            <div
              key={g.type}
              className="h-full"
              style={{ width: `${g.pct}%`, background: g.color }}
              title={`${g.label}: ${fmtKt(g.kt)} (${g.pct.toFixed(1)}%)`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono mt-1">
          {globalShare.map(g => (
            <div key={g.type} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: g.color }} />
              <span className="text-slate-300">{g.label}</span>
              <span className="text-slate-500">{fmtKt(g.kt)}</span>
              <span className="text-slate-600">{g.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* By-region stacked bar */}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 12, left: -4, bottom: 0 }} layout="horizontal">
            <XAxis dataKey="region" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} />
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const key = String(name ?? "");
                return [`${Number(v).toLocaleString()} kt`, TYPE_LABELS[key] ?? key];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 9 }}
              formatter={(v: string) => TYPE_LABELS[v] ?? v}
            />
            {TYPE_ORDER.map(t => (
              <Bar key={t} dataKey={t} stackId="mix" fill={TYPE_COLORS[t]} name={t} radius={t === "decaf" ? [2, 2, 0, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Capsules + soluble share = structural shift away from straight roast-and-grind.
        Mills (origin processing) are excluded — this is consumer-side capacity only.
        Capacity figures parsed best-effort from per-plant entries; treat as order-of-magnitude.
      </div>
    </div>
  );
}
