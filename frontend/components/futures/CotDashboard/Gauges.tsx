"use client";
import type { ReactNode } from "react";
import type { CotMarketPositions, ProcessedCotRow } from "@/lib/cot/types";
import { HM_CAT_COLORS } from "./constants";
import SectionHeader from "./SectionHeader";
import { fmtLotK as fmtLot } from "@/lib/formatters";

type PositionField = keyof CotMarketPositions;
type Mkt = "ny" | "ldn";

// 5-year window (weekly reports). The published cot.json carries ~6y, so this
// is fully backed by real data; shorter histories just clamp.
const WEEKS_5Y = 260;

/** Range statistics for one series: the 5y track, the 52w band, this week
 *  and last. Built from whatever weeks carry a value, so the combined
 *  (futures + options) series, which starts in 2022, simply has a shorter
 *  track. */
type Stats = {
  curr: number; prev: number;
  min5: number; max5: number;   // 5-year range (the bar track)
  min52: number; max52: number; // 52-week range (solid band inside it)
  weeks: number;                // weeks of data behind the 5y range
};

function statsOf(vals5: (number | null | undefined)[], vals52: (number | null | undefined)[]): Stats | null {
  const v5 = vals5.filter((v): v is number => v != null);
  const v52 = vals52.filter((v): v is number => v != null);
  if (v5.length < 2 || v52.length < 1) return null;
  const curr = v52[v52.length - 1];
  const prev = v52.length >= 2 ? v52[v52.length - 2] : curr;
  return {
    curr, prev,
    min5: Math.min(...v5), max5: Math.max(...v5),
    min52: Math.min(...v52), max52: Math.max(...v52),
    weeks: v5.length,
  };
}

const pctIn = (s: Stats, v: number) =>
  s.max5 > s.min5 ? Math.max(0, Math.min(100, (v - s.min5) / (s.max5 - s.min5) * 100)) : 50;

const COLOR_OPT = "#c084fc";        // violet — distinct from every cohort colour
const COLOR_OI  = "#e2e8f0";        // total open interest — neutral, it is everyone

export default function CotGauges({ data }: { data: ProcessedCotRow[] }) {
  const hist5y = data.slice(-WEEKS_5Y);
  const hist52 = data.slice(-52);
  const curr = hist52[hist52.length - 1];

  type GRData = {
    label: string; color: string; isSpread?: boolean;
    /** Futures-only report — what every other table on the page shows. */
    fut: Stats;
    /** Futures + options COMBINED (delta-adjusted): futures + the cohort's
     *  options book, week by week. Undefined when no combined report covers
     *  the latest week. */
    comb?: Stats;
    /** Options book for this cohort+side (combined − futures) this week.
     *  Delta-adjusted, so it can be NEGATIVE — a delta-short book offsetting
     *  the futures leg. */
    opt?: number;
    /** |options| as a share of the cohort's FUTURES NET (long − short).
     *  Undefined when net is ~0. */
    optPctOfNet?: number;
  };

  const optKey = (market: Mkt): "nyOpt" | "ldnOpt" => (market === "ny" ? "nyOpt" : "ldnOpt");

  const mkRow = (market: Mkt, label: string, cat: string, field: PositionField, isSpread?: boolean): GRData | null => {
    const fut = statsOf(hist5y.map(d => d[market]?.[field] ?? 0), hist52.map(d => d[market]?.[field] ?? 0));
    if (!fut) return null;

    // Combined series: futures + options where the combined report exists.
    const combOf = (d: ProcessedCotRow) => {
      const o = d[optKey(market)]?.[field];
      return o == null ? null : (d[market]?.[field] ?? 0) + o;
    };
    const opt = curr[optKey(market)]?.[field];
    const comb = opt == null ? undefined : (statsOf(hist5y.map(combOf), hist52.map(combOf)) ?? undefined);

    // Options size relative to the cohort's FUTURES NET. Net (not the single
    // leg) is the reference the desk cares about: "how big is the options
    // book against the position this cohort actually carries".
    const futs = curr[market];
    const netField: PositionField = field.endsWith("Short")
      ? (field.replace("Short", "Long") as PositionField) : field;
    const shortField: PositionField = netField.replace("Long", "Short") as PositionField;
    const net = isSpread ? 0 : (futs?.[netField] ?? 0) - (futs?.[shortField] ?? 0);
    const optPctOfNet = opt != null && Math.abs(net) > 1e-9
      ? (opt / Math.abs(net)) * 100 : undefined;

    return { label, color: HM_CAT_COLORS[cat] ?? "#64748b", isSpread, fut, comb, opt: opt ?? undefined, optPctOfNet };
  };

  // Total open interest of the market's futures — all cohorts, both sides,
  // spreads counted once. The frame every gauge below sits inside.
  const mkTotalOi = (market: Mkt): GRData | null => {
    const oi = (d: ProcessedCotRow) => (market === "ny" ? d.oiNY : d.oiLDN) || null;
    const fut = statsOf(hist5y.map(oi), hist52.map(oi));
    return fut ? { label: "Total OI · futures", color: COLOR_OI, fut } : null;
  };

  const present = (rows: (GRData | null)[]) => rows.filter((r): r is GRData => r != null);

  const marketRows = (market: Mkt) => ({
    totalOi: mkTotalOi(market),
    longRows: present([
      mkRow(market, "PMPU Long",    "PMPU",      "pmpuLong"),
      mkRow(market, "Swap Long",    "Swap",      "swapLong"),
      mkRow(market, "MM Long",      "MM",        "mmLong"),
      mkRow(market, "Other Long",   "Other Rpt", "otherLong"),
      mkRow(market, "Non-Rep Long", "Non-Rep",   "nonRepLong"),
    ]),
    shortRows: present([
      mkRow(market, "PMPU Short",    "PMPU",      "pmpuShort"),
      mkRow(market, "Swap Short",    "Swap",      "swapShort"),
      mkRow(market, "MM Short",      "MM",        "mmShort"),
      mkRow(market, "Other Short",   "Other Rpt", "otherShort"),
      mkRow(market, "Non-Rep Short", "Non-Rep",   "nonRepShort"),
    ]),
    spreadRows: present([
      mkRow(market, "MM Spread",    "MM",        "mmSpread",    true),
      mkRow(market, "Swap Spread",  "Swap",      "swapSpread",  true),
      mkRow(market, "Other Spread", "Other Rpt", "otherSpread", true),
    ]),
  });

  const ny  = marketRows("ny");
  const ldn = marketRows("ldn");

  // Bar length is proportional to the series' 5y range SIZE, relative to the
  // widest cohort range in the same market column — a swap-long range of ~5k
  // lots renders ~4x shorter than a PMPU-long range of ~22k, so range
  // magnitudes are comparable at a glance. The combined bars share the scale
  // with their futures bar. Total OI is on its own scale (it is an order of
  // magnitude bigger and would flatten every cohort) and always spans the
  // column. Small floor keeps tiny rows usable.
  const maxSpanOf = (rows: ReturnType<typeof marketRows>) =>
    Math.max(1, ...[...rows.longRows, ...rows.shortRows, ...rows.spreadRows]
      .flatMap(r => [r.fut.max5 - r.fut.min5, r.comb ? r.comb.max5 - r.comb.min5 : 0]));
  const MIN_TRACK_PCT = 8;

  const pctColor = (pct: number) => {
    if (pct >= 80) return "#ef4444";
    if (pct >= 60) return "#f97316";
    if (pct <= 20) return "#22c55e";
    if (pct <= 40) return "#84cc16";
    return "#94a3b8";
  };

  const extremes = [
    ...[...ny.longRows, ...ny.shortRows].map(r => ({ ...r, mkt: "NY" })),
    ...[...ldn.longRows, ...ldn.shortRows].map(r => ({ ...r, mkt: "LDN" })),
  ].map(r => ({ ...r, pct: pctIn(r.fut, r.fut.curr) })).filter(r => r.pct >= 80 || r.pct <= 20);

  /** One track: faded 5y range, solid 52w band, previous-week tick, current
   *  dot (green = added vs last week, red = reduced). `accent` tints the band
   *  so the combined bar reads as a different series from the futures one. */
  const renderTrack = (s: Stats, trackPct: number, accent?: string) => {
    const pct = pctIn(s, s.curr);
    const prevPct = pctIn(s, s.prev);
    const band52L = pctIn(s, s.min52);
    const band52W = Math.max(1.5, pctIn(s, s.max52) - band52L);
    const delta = s.curr - s.prev;
    const dotColor = delta > 0 ? "#22c55e" : delta < 0 ? "#ef4444" : "#94a3b8";
    const band = accent ? `${accent}66` : "rgba(59,130,246,0.45)";
    const track = accent ? `${accent}1f` : "rgba(59,130,246,0.12)";
    return (
      <div style={{ width: `${trackPct}%` }}>
        <div style={{ position: "relative", height: 9, background: track, borderRadius: 5, border: "1px solid #1e293b" }}
          title={`${s.weeks}w range: ${fmtLot(s.min5)}–${fmtLot(s.max5)} · 52w: ${fmtLot(s.min52)}–${fmtLot(s.max52)}`}>
          <div style={{ position: "absolute", left: `${band52L}%`, top: 0, height: "100%", width: `${band52W}%`, background: band, borderRadius: 4 }} />
          <div style={{ position: "absolute", top: 1, left: `calc(${prevPct}% - 1px)`, width: 2, height: 7, background: accent ?? "#60a5fa", borderRadius: 1 }} title={`Prev: ${fmtLot(s.prev)}`} />
          <div style={{ position: "absolute", top: 0, left: `calc(${pct}% - 4px)`, width: 9, height: 9, background: dotColor, borderRadius: "50%", border: "2px solid #0f172a", boxShadow: `0 0 4px ${dotColor}80` }}
            title={`Current: ${fmtLot(s.curr)} (${delta >= 0 ? "+" : ""}${fmtLot(delta)})`} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1 }}>
          <span style={{ fontSize: 8, color: "#334155" }}>{fmtLot(s.min5)}</span>
          <span style={{ fontSize: 8, color: "#334155" }}>{fmtLot(s.max5)}</span>
        </div>
      </div>
    );
  };

  /** Header line above a track: label · level · percentile · weekly change. */
  const renderHead = (label: string, labelColor: string, s: Stats, isSpread?: boolean, tail?: ReactNode, size = 10) => {
    const pct = pctIn(s, s.curr);
    const delta = s.curr - s.prev;
    return (
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1, alignItems: "baseline", flexWrap: "wrap", columnGap: 4 }}>
        <span style={{ fontSize: size, color: labelColor, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <span style={{ color: "#475569" }}>{fmtLot(s.curr)}</span>
          <span style={{ color: isSpread ? "#a78bfa" : pctColor(pct), fontWeight: 600 }}>{Math.round(pct)}th</span>
          <span style={{ color: delta >= 0 ? "#22c55e" : "#ef4444", fontSize: 8 }}>
            {delta >= 0 ? "▲" : "▼"} {fmtLot(Math.abs(delta))}
          </span>
          {tail}
        </span>
      </div>
    );
  };

  const renderGauge = (r: GRData, maxSpan: number) => {
    const trackOf = (s: Stats) => Math.max(MIN_TRACK_PCT, ((s.max5 - s.min5) / maxSpan) * 100);
    return (
      <div key={r.label} style={{ marginBottom: 6 }}>
        {renderHead(r.label, r.color, r.fut, r.isSpread)}
        {renderTrack(r.fut, trackOf(r.fut))}
        {/* Second gauge, stacked: the same cohort+side once its options are
            counted (futures + options, delta-adjusted). Same range mechanics,
            violet so it reads as a different report. The tail says what the
            options alone add — signed, and as a share of the cohort's
            futures net. */}
        {r.comb && r.opt != null && (
          <div style={{ marginTop: 2 }}>
            {renderHead("incl. options", COLOR_OPT, r.comb, r.isSpread, (
              <span style={{ fontSize: 8, color: "#64748b" }}>
                opt {r.opt >= 0 ? "+" : ""}{fmtLot(r.opt)}
                {r.optPctOfNet != null && (
                  <span style={{ color: COLOR_OPT }}> · {r.optPctOfNet >= 0 ? "+" : ""}{r.optPctOfNet.toFixed(0)}% of net</span>
                )}
              </span>
            ), 9)}
            {renderTrack(r.comb, trackOf(r.comb), COLOR_OPT)}
          </div>
        )}
      </div>
    );
  };

  const subHead = (t: string) => (
    <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1.5">{t}</div>
  );

  const marketColumn = (title: string, rows: ReturnType<typeof marketRows>) => {
    const maxSpan = maxSpanOf(rows);
    return (
      <div style={{ minWidth: 0 }}>
        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 pb-1.5 border-b border-slate-800 truncate">{title}</div>
        {/* Total open interest first: the size of the whole market the cohort
            gauges below are slices of. Own scale, full width. */}
        {rows.totalOi && (
          <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: "1px dashed #334155" }}>
            {renderHead(rows.totalOi.label, COLOR_OI, rows.totalOi.fut)}
            {renderTrack(rows.totalOi.fut, 100)}
          </div>
        )}
        {subHead("Longs")}
        {rows.longRows.map(r => renderGauge(r, maxSpan))}
        {subHead("Shorts")}
        {rows.shortRows.map(r => renderGauge(r, maxSpan))}
        <div style={{ borderTop: "1px dashed #334155", marginTop: 8, paddingTop: 6 }}>
          {subHead("Spreading positions")}
          {rows.spreadRows.map(r => renderGauge(r, maxSpan))}
        </div>
      </div>
    );
  };

  return (
    <>
      <SectionHeader icon="Sliders" title="Positioning Gauges"
        subtitle="Total OI first, then each cohort and side as two stacked gauges: futures-only (blue) and futures + options combined, delta-adjusted (violet). On every bar: faded = 5-year range · solid band = 52-week range · tick = previous week · dot = current week (green = added, red = reduced); cohort bar length ∝ range size. The violet line's tail is what the options alone add — signed, and as a % of the cohort's futures net." />
      {extremes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 mb-4 flex flex-wrap gap-3">
          <span className="text-[10px] text-slate-500 font-semibold self-center uppercase tracking-wider">Extremes (5y, futures):</span>
          {extremes.map(r => (
            <span key={`${r.mkt}-${r.label}`} style={{ fontSize: 11, color: pctColor(r.pct) }}>
              {r.mkt} {r.label} {Math.round(r.pct)}th
            </span>
          ))}
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        {/* Always two equal columns — Arabica left, Robusta right — on every
            breakpoint (grid-cols-2 = repeat(2, minmax(0,1fr)), truly equal). */}
        <div className="grid grid-cols-2 gap-x-3 sm:gap-x-6">
          {marketColumn("Arabica · NY", ny)}
          {marketColumn("Robusta · LDN", ldn)}
        </div>
      </div>
    </>
  );
}
