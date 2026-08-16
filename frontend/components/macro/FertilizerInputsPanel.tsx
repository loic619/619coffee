"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";

interface FertilizerHistoryPoint {
  month: string;   // "YYYY-MM"
  price: number;   // USD/MT
}

interface FertilizerItem {
  name:         string;
  price_usd_mt: number;
  mom_pct:      number;
  input_weight: number;
  base_usd_per_bag?: number;
  history?:     FertilizerHistoryPoint[];
}

interface FarmerEconomics {
  fertilizer?: {
    items?:          FertilizerItem[];
    prices_as_of?:   string;
    next_application?: string;
  };
}

const COLOR: Record<string, string> = {
  "Urea (N)": "#22c55e",
  "MAP (P)":  "#3b82f6",
  "KCl (K)":  "#f97316",
};

export default function FertilizerInputsPanel() {
  const [data,  setData]  = useState<FarmerEconomics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // ── Hooks must run before any early return (rules-of-hooks) ──────────────
  // Both useMemo and the conditional branches that follow depend on `items`,
  // so the merge runs every render — the previous version had useMemo
  // sitting after `if (error) return …` which broke Vercel's build (eslint
  // react-hooks/rules-of-hooks).
  const items = data?.fertilizer?.items;
  const chartData = useMemo(() => {
    if (!items) return [];
    const monthMap = new Map<string, Record<string, number | string>>();
    for (const it of items) {
      for (const pt of it.history ?? []) {
        const row = monthMap.get(pt.month) ?? { month: pt.month };
        row[it.name] = pt.price;
        monthMap.set(pt.month, row);
      }
    }
    return Array.from(monthMap.values()).sort((a, b) =>
      String(a.month).localeCompare(String(b.month)),
    );
  }, [items]);

  if (error) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Fertilizer input cost data unavailable.
      </div>
    );
  }
  if (!data || !items || items.length === 0) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading fertilizer inputs…</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Fertilizer Inputs (N-P-K)</h2>
          <p className="text-xs text-slate-400">
            Headline N-P-K prices that drive coffee production cost on the supply side.
            Heavy moves here compress farmer margins and feed into next-cycle break-even economics.
            Source: World Bank Pink Sheet · {data.fertilizer?.prices_as_of ?? "—"}
            {data.fertilizer?.next_application
              ? ` · next application window: ${data.fertilizer.next_application}`
              : ""}
          </p>
        </div>
        <Link
          href="/supply"
          className="text-[11px] text-sky-400 hover:text-sky-300 whitespace-nowrap"
        >
          Full breakdown in Supply →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {items.map(it => {
          const cls = it.mom_pct >= 0 ? "text-red-400" : "text-emerald-400";
          return (
            <div key={it.name} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: COLOR[it.name] ?? "#64748b" }}
                />
                <span className="text-slate-200 text-[11px]">{it.name}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-base font-bold font-mono text-slate-100">
                  ${it.price_usd_mt.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="text-[10px] text-slate-500 font-normal">/MT</span>
                </div>
                <div className={`text-sm font-bold font-mono ${cls}`}>
                  {it.mom_pct >= 0 ? "+" : ""}{it.mom_pct.toFixed(1)}%
                </div>
              </div>
              <div className="text-[9px] text-slate-500 mt-1">
                {(it.input_weight * 100).toFixed(0)}% of coffee input mix · MoM change
              </div>
            </div>
          );
        })}
      </div>

      {chartData.length >= 2 && (
        <div className="mt-2 bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
              Historical prices (USD/MT)
            </h3>
            <span className="text-[9px] text-slate-500 font-mono">
              {chartData[0].month} → {chartData[chartData.length - 1].month}
            </span>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="month"
                  stroke="#475569"
                  fontSize={9}
                  tickFormatter={(v: string) => v.slice(2)}   /* "2026-04" → "26-04" */
                  minTickGap={28}
                />
                <YAxis
                  stroke="#475569"
                  fontSize={9}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", fontSize: 11 }}
                  formatter={(v) => [`$${Number(v).toFixed(0)}/MT`, ""] as [string, string]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {items.map((it) => (
                  <Line
                    key={it.name}
                    type="monotone"
                    dataKey={it.name}
                    name={it.name}
                    stroke={COLOR[it.name] ?? "#64748b"}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
