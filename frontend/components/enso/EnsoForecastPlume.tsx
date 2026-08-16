"use client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { EnsoForecastSeason } from "@/lib/enso";

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

export default function EnsoForecastPlume({ forecast }: { forecast: EnsoForecastSeason[] }) {
  if (!forecast || forecast.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 text-xs text-slate-500">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Forecast probability plume</div>
        IRI/CPC probability forecast not yet published. This populates from the monthly
        ENSO forecast scrape (NOAA/IRI is reachable only from CI).
      </div>
    );
  }

  // recharts stacks in render order: La Niña (cool, bottom) → Neutral → El Niño (warm, top).
  const data = forecast.map((f) => ({
    season: f.season,
    "La Niña": f.la_nina,
    Neutral: f.neutral,
    "El Niño": f.el_nino,
  }));

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
        ENSO probability plume · next {forecast.length} overlapping 3-month seasons (IRI/CPC)
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} stackOffset="expand" margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
            <XAxis dataKey="season" stroke="#64748b" tick={{ fontSize: 9 }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 9 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip
              contentStyle={TT_STYLE}
              labelStyle={{ color: "#94a3b8", fontSize: 10 }}
              formatter={(v) => (typeof v === "number" ? `${v}%` : "—")}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            <Area type="monotone" dataKey="La Niña" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.55} strokeWidth={0} />
            <Area type="monotone" dataKey="Neutral" stackId="1" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.45} strokeWidth={0} />
            <Area type="monotone" dataKey="El Niño" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.55} strokeWidth={0} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
