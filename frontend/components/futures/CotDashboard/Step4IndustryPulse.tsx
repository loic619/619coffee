"use client";
import { useEffect, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { ResponsiveContainer } from "@/components/ui/FocusableChart";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";
import { cachedFetchStatic } from "@/lib/api";
import { buildPriceSegments, SEG_KEYS, type PriceDay, type SegmentRow } from "@/lib/cot/priceSegments";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { CHART_STYLE } from "./constants";
import SectionHeader from "./SectionHeader";
import WeeksOfCoverPanel from "./WeeksOfCoverPanel";

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

type PriceHistory = { arabica?: PriceDay[]; robusta?: PriceDay[] };

export default function Step4IndustryPulse({ data }: { data: ProcessedCotRow[] }) {
  // Default to 1Y to match the previous behaviour; user can expand to 3Y / 5Y.
  const [windowWeeks, setWindowWeeks] = useState<number>(52);
  const [prices, setPrices] = useState<PriceHistory | null>(null);
  const windowed = data.slice(-windowWeeks);

  useEffect(() => {
    cachedFetchStatic<PriceHistory>("/data/futures_price_history.json")
      .then(setPrices)
      .catch(() => setPrices({}));   // price line degrades to empty; PMPU still renders
  }, []);

  // Hide contract-switch labels in multi-year views — 20+ labels overlap
  // unreadably. Lines still show; labels only render in the 1Y view.
  const showSwitchLabels = windowWeeks <= 52;

  const mtFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

  const mkChart = (market: "ny" | "ldn") => {
    const longKey:  MtKey = market === "ny" ? "pmpuLongMT_NY"  : "pmpuLongMT_LDN";
    const shortKey: MtKey = market === "ny" ? "pmpuShortMT_NY" : "pmpuShortMT_LDN";
    const priceDays = (market === "ny" ? prices?.arabica : prices?.robusta) ?? [];

    // ── Daily x-axis ─────────────────────────────────────────────────────────
    // Rows are TRADING DAYS (~5/week) so the price line shows real daily
    // detail. PMPU stays weekly: its values land only on COT dates and the
    // lines bridge the intervening days via connectNulls, so the positioning
    // curves keep exactly the shape they had on the old weekly axis.
    const windowStart = windowed[0]?.date ?? "";
    const dayRows = priceDays.filter(p => p.date >= windowStart);
    const cotByDate = new Map(windowed.map(w => [w.date, w]));
    // Union: every trading day, plus any COT date the price feed lacks (market
    // holiday) so no weekly point is silently dropped.
    const allDates = Array.from(new Set([
      ...dayRows.map(p => p.date),
      ...windowed.map(w => w.date),
    ])).sort();
    // Segment the daily price by contract (pure + unit-tested), then merge the
    // weekly PMPU values onto their COT dates.
    const segRows = buildPriceSegments(allDates, dayRows);
    const rows = segRows.map(r => {
      const cot = cotByDate.get(r.date);
      return cot ? { ...r, [longKey]: cot[longKey], [shortKey]: cot[shortKey] } : r;
    });

    const priceVals = dayRows.map(p => p.price).filter(v => v > 0);
    const priceDomain: [number, number] = priceVals.length
      ? [Math.floor(Math.min(...priceVals) / 100) * 100, Math.ceil(Math.max(...priceVals) / 100) * 100]
      : [0, 500];
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

    // Blue circle (+ label in the 1Y view) at the first point of each new
    // contract, drawn only by the <Line> that actually owns that segment.
    const rollDot = (ownKey: string, props: { cx?: number; cy?: number; payload?: SegmentRow }) => {
      const p = props.payload;
      if (!p || p.rollKey !== ownKey || props.cx == null || props.cy == null) {
        // Recharts requires a ReactElement return; render an empty group.
        return <g key={`empty-${p?.date ?? "x"}`} />;
      }
      return (
        <g key={`sw-${p.date}`}>
          <circle cx={props.cx} cy={props.cy} r={4} fill={COLOR_SWITCH} stroke="#0f172a" strokeWidth={1.5}>
            <title>{`New contract: ${p.rollTo} (${p.date})`}</title>
          </circle>
          {showSwitchLabels && (
            <text x={props.cx} y={props.cy - 9} fill={COLOR_SWITCH} fontSize={9} textAnchor="middle">
              → {p.rollTo}
            </text>
          )}
        </g>
      );
    };

    // Custom tooltip: the daily axis means most rows have no PMPU values, and
    // one of the two price keys is always null — the default tooltip would
    // list those as blanks. Show only what this day actually has.
    const tip = (props: TooltipContentProps<ValueType, NameType>) => {
      if (!props.active || !props.payload?.length) return null;
      const row = props.payload[0]?.payload as SegmentRow | undefined;
      const entries = props.payload.filter(e => e.value != null && e.value !== "");
      if (!entries.length) return null;
      const seen = new Set<string>();
      return (
        <div style={{ background: CHART_STYLE.backgroundColor, border: `1px solid ${CHART_STYLE.borderColor}`, padding: "6px 9px", borderRadius: 4, fontSize: 11 }}>
          <p style={{ color: "#94a3b8", margin: "0 0 3px" }}>{String(props.label)}</p>
          {entries.map((e, i) => {
            const isPrice = (SEG_KEYS as readonly string[]).includes(String(e.dataKey));
            const name = isPrice ? "Price" : String(e.name);
            if (seen.has(name)) return null;
            seen.add(name);
            return (
              <p key={i} style={{ color: e.color, margin: "1px 0" }}>
                {name}
                {isPrice && row?.rollTo ? ` (${row.rollTo})` : ""}
                : {isPrice ? Number(e.value).toFixed(2) : `${(Number(e.value) / 1000).toFixed(1)}k MT`}
              </p>
            );
          })}
        </div>
      );
    };

    return (
      <div>
        {/* Panel A — levels (lines, no Area fill) */}
        <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl h-[300px] mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 6, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10}
                interval="preserveStartEnd" minTickGap={38}
                tickFormatter={v => windowWeeks > 52 ? v.slice(0, 7) : v.slice(5)} />
              {/* Tight axis widths (no rotated "MT" title — the section is titled
                  "Metric Tons" and ticks carry the k suffix) so the plot isn't
                  boxed in by left+right gutters. */}
              <YAxis yAxisId="left" stroke="#475569" fontSize={10} tickFormatter={mtFmt} domain={mtDomain} width={34} />
              <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} domain={priceDomain} width={36} />
              <Tooltip content={tip} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {/* connectNulls bridges the non-COT days so the weekly
                  positioning curves keep their original shape. */}
              <Line yAxisId="left" type="monotone" dataKey={longKey} name="Industry Long (roasters)"
                stroke={COLOR_LONG} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey={shortKey} name="Industry Short (farmers)"
                stroke={COLOR_SHORT} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              {/* Two alternating price lines = one visual series that breaks at
                  every roll. Only the first carries the legend entry. */}
              {SEG_KEYS.map((k, i) => (
                <Line key={k} yAxisId="right" type="monotone" dataKey={k}
                  name="Price" legendType={i === 0 ? "line" : "none"}
                  stroke={COLOR_PRICE} strokeWidth={2}
                  dot={props => rollDot(k, props)} activeDot={{ r: 4, fill: COLOR_PRICE }}
                  isAnimationActive={false} />
              ))}
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
        subtitle="PMPU Gross Long (roasters, green) & Short (farmers, brown), weekly, vs the DAILY front-month price. Each contract is its own price segment: on a roll day the outgoing contract ends at its settle and the incoming one starts at its own price, so the gap is the roll spread — not a move. Blue circle marks the new contract. Bottom: weekly position changes (NY includes EFP physical delivery)." />

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

      {/* The same positions on a scale a trader reasons in. Tonnes answer
          "how much"; weeks of cover answer "how much, relative to what the
          world drinks" — which is the question the level was always a proxy
          for, and the only form in which KC and RC are comparable. */}
      <WeeksOfCoverPanel data={data} />
    </div>
  );
}
