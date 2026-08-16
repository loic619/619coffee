"use client";
import { useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { CHART_STYLE } from "./constants";
import SectionHeader from "./SectionHeader";

type MtKey = "pmpuLongMT_NY" | "pmpuLongMT_LDN" | "pmpuShortMT_NY" | "pmpuShortMT_LDN";

// Color conventions (per user spec):
//   Industry SHORT (farmers / producers hedging) → brown
//   Industry LONG  (roasters / commercial buyers) → green
// Note these swapped from the original; bar chart in Panel B mirrors the
// same convention so weekly deltas read the same as the level chart.
const COLOR_SHORT = "#92400e";  // amber-900 — farmers
const COLOR_LONG  = "#22c55e";  // green-500 — roasters
const COLOR_PRICE = "#f59e0b";  // amber-500 — price line
const COLOR_SWITCH = "#3b82f6"; // blue-500 — contract switch markers (circles on price line)

// Time-window options (weeks).
const WINDOW_OPTIONS: { label: string; weeks: number }[] = [
  { label: "1Y",  weeks: 52 },
  { label: "3Y",  weeks: 156 },
  { label: "5Y",  weeks: 260 },
];

export default function Step4IndustryPulse({ data }: { data: ProcessedCotRow[] }) {
  // Default to 1Y to match the previous behaviour; user can expand to 3Y / 5Y.
  const [windowWeeks, setWindowWeeks] = useState<number>(52);
  const windowed = data.slice(-windowWeeks);

  // Hide contract-switch labels in multi-year views — 20+ labels overlap
  // unreadably. Lines still show; labels only render in the 1Y view.
  const showSwitchLabels = windowWeeks <= 52;

  const mtFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

  const mkChart = (market: "ny" | "ldn") => {
    const longKey:  MtKey = market === "ny" ? "pmpuLongMT_NY"  : "pmpuLongMT_LDN";
    const shortKey: MtKey = market === "ny" ? "pmpuShortMT_NY" : "pmpuShortMT_LDN";
    const priceKey: "priceNY" | "priceLDN" = market === "ny" ? "priceNY" : "priceLDN";
    const contractKey: "priceContractNY" | "priceContractLDN" =
      market === "ny" ? "priceContractNY" : "priceContractLDN";
    const prices   = windowed.map(d => d[priceKey]).filter(v => v > 0);
    const priceDomain: [number, number] = prices.length
      ? [Math.floor(Math.min(...prices) / 100) * 100, Math.ceil(Math.max(...prices) / 100) * 100]
      : [0, 500];

    // Detect week-to-week contract switches. Each switch becomes a small
    // blue circle on the price line at that week, so the reader sees
    // exactly when the price track jumped to a different underlying
    // contract (the max-OI rule rolls liquidity as the front goes into FND).
    //
    // The `prev && curr` truthy guard is load-bearing: it ensures the first
    // legacy → first-max-OI transition (null → "KCH6" etc.) is NOT marked
    // as a contract switch. Don't simplify to `prev !== curr`.
    const switchByDate = new Map<string, { from: string; to: string }>();
    for (let i = 1; i < windowed.length; i++) {
      const prev = windowed[i - 1][contractKey];
      const curr = windowed[i][contractKey];
      if (prev && curr && prev !== curr) {
        switchByDate.set(windowed[i].date, { from: prev, to: curr });
      }
    }
    const mtVals = windowed.flatMap(d => [d[longKey], d[shortKey]]).filter(v => v > 0);
    const mtDomain: [number, number] = mtVals.length
      ? [Math.floor(Math.min(...mtVals) / 1000) * 1000, Math.ceil(Math.max(...mtVals) / 1000) * 1000]
      : [0, 100000];
    const deltaData = windowed.slice(1).map((d, i) => {
      const dl  = d[longKey]  - windowed[i][longKey];
      const ds  = d[shortKey] - windowed[i][shortKey];
      const efp = market === "ny" ? d.efpMT : 0;
      return { date: d.date, deltaLong: dl, deltaShort: ds, efpMT: efp };
    });
    return (
      <div>
        {/* Panel A — levels (lines, no Area fill) */}
        <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl h-[300px] mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={windowed} margin={{ top: 8, right: 6, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10}
                tickFormatter={v => windowWeeks > 52 ? v.slice(0, 7) : v.slice(5)} />
              {/* Tight axis widths (no rotated "MT" title — the section is titled
                  "Metric Tons" and ticks carry the k suffix) so the plot isn't
                  boxed in by left+right gutters. */}
              <YAxis yAxisId="left" stroke="#475569" fontSize={10} tickFormatter={mtFmt} domain={mtDomain} width={34} />
              <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} domain={priceDomain} width={36} />
              <Tooltip contentStyle={CHART_STYLE} formatter={((v, name) => [
                name === "Price" ? Number(v).toFixed(0) : `${(Number(v) / 1000).toFixed(1)}k MT`, name as NameType,
              ]) satisfies Formatter<ValueType, NameType>} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line yAxisId="left"  type="monotone" dataKey={longKey}  name="Industry Long (roasters)"  stroke={COLOR_LONG}  strokeWidth={2} dot={false} />
              <Line yAxisId="left"  type="monotone" dataKey={shortKey} name="Industry Short (farmers)"  stroke={COLOR_SHORT} strokeWidth={2} dot={false} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey={priceKey}
                name="Price"
                stroke={COLOR_PRICE}
                strokeWidth={2}
                // Custom dot: blue circle only on weeks where the underlying
                // contract changed. Every other point renders nothing (the
                // function returns an invisible 0×0 element so recharts is happy).
                dot={(props: { cx?: number; cy?: number; payload?: { date?: string } }) => {
                  const sw = props.payload?.date ? switchByDate.get(props.payload.date) : undefined;
                  if (!sw || props.cx == null || props.cy == null) {
                    // Recharts requires a ReactElement return; render an empty
                    // group rather than null to satisfy the type contract.
                    return <g key={`empty-${props.payload?.date ?? "x"}`} />;
                  }
                  return (
                    <g key={`sw-${props.payload?.date}`}>
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={5}
                        fill={COLOR_SWITCH}
                        stroke="#0f172a"
                        strokeWidth={1.5}
                      >
                        <title>{`Contract switch: ${sw.from} → ${sw.to}`}</title>
                      </circle>
                      {showSwitchLabels && (
                        <text
                          x={props.cx}
                          y={props.cy - 10}
                          fill={COLOR_SWITCH}
                          fontSize={9}
                          textAnchor="middle"
                        >
                          → {sw.to}
                        </text>
                      )}
                    </g>
                  );
                }}
                // activeDot keeps the hover-highlight behaviour intact.
                activeDot={{ r: 5, fill: COLOR_PRICE }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Panel B — weekly deltas (bars), colors match Panel A */}
        <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={deltaData} margin={{ top: 8, right: 6, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10}
                tickFormatter={v => windowWeeks > 52 ? v.slice(0, 7) : v.slice(5)} />
              <YAxis stroke="#475569" fontSize={10} tickFormatter={mtFmt} width={34} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <Tooltip contentStyle={CHART_STYLE} formatter={((v, name) => [`${(Number(v) / 1000).toFixed(1)}k MT`, name as NameType]) satisfies Formatter<ValueType, NameType>} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="deltaLong"  name="Δ Long (roasters, wk)"  fill={COLOR_LONG}  opacity={0.85} barSize={4} />
              <Bar dataKey="deltaShort" name="Δ Short (farmers, wk)"  fill={COLOR_SHORT} opacity={0.85} barSize={4} />
              {market === "ny" && <Line type="monotone" dataKey="efpMT" name="EFP Physical" stroke={COLOR_PRICE} strokeWidth={1.5} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <div id="cot-section-4">
      <SectionHeader icon="Factory" title="Industry Pulse (Metric Tons)"
        subtitle="PMPU Gross Long (roasters, green) & Short (farmers, brown) vs Price. Blue circles on the price line mark weeks where the underlying contract changed. Bottom: weekly position changes (NY includes EFP physical delivery)." />

      {/* Time-window selector */}
      <div className="flex items-center gap-1 mb-3 px-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-widest mr-2">Window</span>
        {WINDOW_OPTIONS.map(opt => (
          <button
            key={opt.weeks}
            onClick={() => setWindowWeeks(opt.weeks)}
            className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              windowWeeks === opt.weeks
                ? "bg-slate-800 text-amber-400 border border-slate-700"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-slate-600 font-mono">
          {windowed.length} weeks · {windowed[0]?.date ?? "—"} → {windowed[windowed.length - 1]?.date ?? "—"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
          {mkChart("ny")}
        </div>
        <div>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
          {mkChart("ldn")}
        </div>
      </div>
    </div>
  );
}
