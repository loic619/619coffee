"use client";
// Positioning in WEEKS OF COVER — the view research brokers publish as
// "Market Positioning", rebuilt on our own consumption basis.
//
// Lots are not a scale anyone reasons in. Divided by weekly consumption they
// become one: "the trade is short eleven weeks of demand" is a sentence a
// trader can act on, and it makes KC and RC comparable, which raw lots never
// are — a KC lot is 17.01 t against a robusta lot's 10 t.
//
// The denominator is a choice, so it is shown on the panel rather than buried:
// consumption comes from the app's own world balance sheet, which means this
// panel cannot quietly disagree with the Demand tab.
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import { cachedFetchStatic } from "@/lib/api";
import {
  basisFromHubs, DEFAULT_BASIS, lotsPerWeek, netCommercial, toWeeksOfCover,
  type CoverBasis, type Market,
} from "@/lib/cot/weeksOfCover";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { CHART_STYLE } from "./constants";
import SectionHeader from "./SectionHeader";

// Same convention as the MT panel above it, so the two read as one section:
//   industry SHORT (producers hedging) → brown
//   industry LONG  (roasters covering) → green
const COLOR_SHORT = "#92400e";
const COLOR_LONG  = "#22c55e";
const COLOR_SPEC  = "#3987e5";

const WINDOWS = [
  { label: "1Y", weeks: 52 },
  { label: "3Y", weeks: 156 },
  { label: "5Y", weeks: 260 },
];

export default function WeeksOfCoverPanel({ data }: { data: ProcessedCotRow[] }) {
  const [windowWeeks, setWindowWeeks] = useState(156);
  const [basis, setBasis] = useState<CoverBasis>(DEFAULT_BASIS);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    cachedFetchStatic<{ demand_hubs?: unknown; crop_year?: string }>("/data/world_balance_sheet.json")
      .then(w => {
        const b = basisFromHubs(w.demand_hubs);
        if (alive && b) { setBasis(b); setLive(true); }
      })
      .catch(() => { /* committed fallback already in state */ });
    return () => { alive = false; };
  }, []);

  const windowed = data.slice(-windowWeeks);

  const chart = (market: Market) => {
    const pts = toWeeksOfCover(windowed, market, basis);
    if (!pts.length) return null;
    const last = pts[pts.length - 1];
    const perWeek = lotsPerWeek(market === "ny" ? basis.ny : basis.ldn, market);
    const label = market === "ny" ? "KC · Arabica" : "RC · Robusta";
    const annual = market === "ny" ? basis.ny : basis.ldn;

    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-baseline justify-between mb-1">
          <h4 className="text-sm font-semibold text-slate-200">{label}</h4>
          <span className="text-[10px] font-mono text-slate-500">
            {annual.toFixed(1)}m bags/yr ÷ 52 = {Math.round(perWeek).toLocaleString()} lots/week
          </span>
        </div>
        <div className="mb-2 text-[10px] text-slate-400">
          Net commercial{" "}
          <span className={`font-semibold ${netCommercial(last) < 0 ? "text-amber-400" : "text-emerald-400"}`}>
            {netCommercial(last) >= 0 ? "+" : ""}{netCommercial(last).toFixed(1)} weeks
          </span>{" "}
          · roasters {last.roaster.toFixed(1)} · producers {last.producer.toFixed(1)} · spec{" "}
          {last.spec >= 0 ? "+" : ""}{last.spec.toFixed(1)}
        </div>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pts} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_STYLE.borderColor} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} minTickGap={40} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={44}
                tickFormatter={(v: number) => `${v}w`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip
                contentStyle={{ background: CHART_STYLE.backgroundColor,
                  border: `1px solid ${CHART_STYLE.borderColor}`, borderRadius: 4, fontSize: 11 }}
                formatter={(v, n) => [`${Number(v ?? 0).toFixed(2)} weeks`, String(n)]} />
              <Line dataKey="roaster" name="Roaster cover" stroke={COLOR_LONG}
                strokeWidth={1.6} dot={false} />
              <Line dataKey="producer" name="Producer / trade short" stroke={COLOR_SHORT}
                strokeWidth={1.6} dot={false} />
              <Line dataKey="spec" name="Speculative net" stroke={COLOR_SPEC}
                strokeWidth={1.6} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {([["Roaster cover (commercial long)", COLOR_LONG],
             ["Producer / trade short", COLOR_SHORT],
             ["Speculative net (MM + other)", COLOR_SPEC]] as [string, string][]).map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 mt-6">
      <SectionHeader
        icon="Scale"
        title="Positioning in weeks of cover"
        subtitle="The same COT positions divided by weekly world consumption. Puts KC and RC on one scale and makes a position today comparable with one five years ago."
      />

      <div className="flex items-center gap-2 mb-4">
        {WINDOWS.map(w => (
          <button key={w.label} onClick={() => setWindowWeeks(w.weeks)}
            className={`px-2.5 py-1 rounded text-xs border transition ${
              windowWeeks === w.weeks
                ? "bg-amber-600 border-amber-500 text-slate-950 font-semibold"
                : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
            {w.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-slate-500">
          basis: world balance sheet{live ? "" : " (committed fallback — live fetch unavailable)"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {chart("ny")}
        {chart("ldn")}
      </div>

      <p className="mt-3 text-[10px] text-slate-500">
        Weeks = position ÷ (annual consumption ÷ 52), with consumption read from the app&rsquo;s own world
        balance sheet and lot sizes of {17.01} t (KC) and {10} t (RC). Producer short is plotted negative so
        the two sides of the trade sit either side of zero. The denominator is a convention, not a
        measurement: brokers publishing this view pick their own, so levels are comparable{" "}
        <em>within</em> this panel and across time, but not against another house&rsquo;s chart.
      </p>
    </div>
  );
}
